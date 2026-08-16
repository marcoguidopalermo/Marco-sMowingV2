/* eslint-disable */
// Storage-health measurement — runs from the nightly scheduled pass. BOUNDED:
// it reads the appData main doc once, and for growth-surface collections it
// uses count() aggregates + a small sampled read for average doc size (never a
// full-collection scan). ISOLATED by the caller (a measurement failure never
// affects the sync). Writes a single small stats doc the admin card reads.
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {sendNotification} from "../notifications.js";

type DB = admin.firestore.Firestore;

const DOC_LIMIT = 1_048_576;      // Firestore 1 MiB per-doc cap
const FREE_TIER = 1_073_741_824;  // 1 GiB Firestore free tier
const SAMPLE = 20;                // docs sampled per collection for avg size
const SUPER_ADMIN = "marcoguidopalermo@gmail.com";  // warnings are Marco-only

// ── Firestore's REAL storage sizing ────────────────────────────────────────
// https://firebase.google.com/docs/firestore/storage-size
//
// This used to be `Buffer.byteLength(JSON.stringify(v))`. JSON length is NOT
// how Firestore charges: it counts quotes, commas, braces and full decimal
// number text, none of which are stored. Measured against the live appData
// doc it read 838,260 B where the true size was 732,103 B — 14% high, which
// showed 79.9% of the 1 MiB cap when the document was actually at 69.8%. A
// gauge that errs toward the alarm is worse than no gauge, so it now applies
// the documented per-type rules.
const u8 = (s: string): number => Buffer.byteLength(s, "utf8");

function valueBytes(v: unknown): number {
  if (v === null || v === undefined) return 1;
  if (typeof v === "boolean") return 1;
  if (typeof v === "number") return 8;            // integer and double alike
  if (typeof v === "string") return u8(v) + 1;
  if (v instanceof admin.firestore.Timestamp) return 8;
  if (v instanceof admin.firestore.GeoPoint) return 16;
  if (v instanceof admin.firestore.DocumentReference) return docNameBytes(v.path);
  if (Buffer.isBuffer(v)) return v.length;
  if (Array.isArray(v)) return v.reduce((s: number, e) => s + valueBytes(e), 0);
  if (typeof v === "object") {
    let s = 0;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      s += u8(k) + 1 + valueBytes(val);           // map key costs name + 1
    }
    return s;
  }
  return 0;
}

// Document name size: each collection/document id in the path costs its UTF-8
// length + 1, plus 16 bytes.
function docNameBytes(path: string): number {
  return path.split("/").reduce((s, seg) => s + u8(seg) + 1, 0) + 16;
}

// Total stored size of a document: name + fields (each name + 1 + value)
// + 32 bytes of per-document overhead.
function documentBytes(data: Record<string, unknown>, path: string): number {
  let s = docNameBytes(path) + 32;
  for (const [k, v] of Object.entries(data)) s += u8(k) + 1 + valueBytes(v);
  return s;
}

// count() aggregate + sampled average doc size → {docs, bytes estimate}.
async function measureCollection(
  db: DB, path: string,
): Promise<{ name: string; docs: number; bytes: number }> {
  const name = path.split("/").pop() || path;
  try {
    const col = db.collection(path);
    const cnt = await col.count().get();
    const docs = cnt.data().count;
    if (docs === 0) return { name, docs: 0, bytes: 0 };
    const sample = await col.limit(SAMPLE).get();
    let sum = 0;
    for (const d of sample.docs) sum += documentBytes(d.data(), d.ref.path);
    const avg = sample.size ? sum / sample.size : 0;
    return { name, docs, bytes: Math.round(avg * docs) };
  } catch (e) {
    logger.warn("storage measure collection failed", { path, error: String(e) });
    return { name, docs: 0, bytes: 0 };
  }
}

export async function runStorageMeasurement(
  db: DB, appId: string, _todayStr: string, nowMs: number, warnings: string[],
): Promise<void> {
  const PUB = `artifacts/${appId}/public/data`;

  // ── Headline: the appData main doc's STORED size vs the 1 MiB cap ──
  const mainPath = `${PUB}/appData/main`;
  const mainSnap = await db.doc(mainPath).get();
  const mainData = mainSnap.data() || {};
  const mainBytes = documentBytes(mainData, mainPath);
  // Largest fields on the main doc — so the card can point at what to trim.
  // Field cost is its name + 1 + the value, matching how the total is built,
  // so the parts sum to the whole (less the fixed name + 32 B overhead).
  const fieldSizes = Object.entries(mainData)
    .map(([k, v]) => ({ field: k, bytes: u8(k) + 1 + valueBytes(v) }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 6);

  // ── Growth surfaces: bounded count() + sampled avg size per collection ──
  const COLLECTIONS = [
    "performanceMonths", "scheduleMonths", "multiDayJobs",
    "contractingProjects", "contractingProgressReports", "contractingInvoices",
    "contractingWorkOrders", "contractingPropertyDocs",
    "notificationCentre", "notificationLog", "pushTokens", "notificationPrefs",
    "roleMasterRoles", "roleMasterResponsibilities", "roleMasterTemplates",
    "roleMasterPolicies", "roleTaskInstances", "salesMasterQuotes",
    "marketingContent", "marketingShots", "marketingLinks",
  ];
  const collections: { name: string; docs: number; bytes: number }[] = [];
  for (const c of COLLECTIONS) {
    const m = await measureCollection(db, `${PUB}/${c}`);
    if (m.docs > 0) collections.push(m);
  }

  const collectionsBytes = collections.reduce((s, c) => s + c.bytes, 0);
  const totalBytes = mainBytes + collectionsBytes;
  const pct = Math.round((mainBytes / DOC_LIMIT) * 1000) / 10;   // one decimal

  // ── Deduped warning (super admin only) — once per crossing ──────────────
  // Severity re-arms only after dropping below 80% and crossing up again.
  // 'red' (≥90) escalates from 'amber'; neither re-fires while still elevated.
  const statsRef = db.doc(`${PUB}/appStats/storage`);
  const prevWarn = ((await statsRef.get()).data() as any)?.warnState || "none";
  const level: "none" | "amber" | "red" = pct >= 90 ? "red" : pct >= 80 ? "amber" : "none";
  let toSend: "amber" | "red" | null = null;
  if (level === "red" && prevWarn !== "red") toSend = "red";
  else if (level === "amber" && prevWarn === "none") toSend = "amber";

  const stats = {
    measuredAt: nowMs,
    main: {bytes: mainBytes, limit: DOC_LIMIT, pct, fields: fieldSizes},
    collections,          // [{name, docs, bytes}]
    totalBytes,
    freeTier: FREE_TIER,
    warnState: level,     // dedupe state for the crossing logic above
  };
  await statsRef.set(stats);
  warnings.push(`storage_measure main=${Math.round(mainBytes / 1024)}KB pct=${pct} warn=${toSend || "-"}`);

  // Push to the super admin only (never all admins). Isolated so a send
  // failure can't fail the measurement or the sync. The global "storage"
  // type toggle is still honored inside sendNotification.
  if (toSend) {
    try {
      const kb = Math.round(mainBytes / 1024);
      await sendNotification([SUPER_ADMIN], "storage", {
        title: toSend === "red" ? "🔴 Storage critical" : "⚠️ Storage warning",
        body: `Main data document at ${pct}% of its 1 MiB limit (${kb} KB). Archive a growth surface soon.`,
        url: "/",
      });
    } catch (e) {
      logger.warn("storage warning push failed", {error: String(e)});
    }
  }
}

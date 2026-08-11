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

// Byte length of a value's JSON serialization (approximates stored size).
function jsonBytes(v: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(v ?? null), "utf8"); } catch { return 0; }
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
    for (const d of sample.docs) sum += jsonBytes(d.data());
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

  // ── Headline: the appData main doc's serialized size vs the 1 MiB cap ──
  const mainSnap = await db.doc(`${PUB}/appData/main`).get();
  const mainData = mainSnap.data() || {};
  const mainBytes = jsonBytes(mainData);
  // Largest fields on the main doc — so the card can point at what to trim.
  const fieldSizes = Object.entries(mainData)
    .map(([k, v]) => ({ field: k, bytes: jsonBytes(v) }))
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

/* eslint-disable */
// Web push (FCM) — send layer, gating, dedupe, notification centre, dashboard
// log. All storage is bounded and off the appData main doc. Notification
// failures are isolated by callers (never fail a sync or a triggering write).
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const REGION = "us-central1";
const APP_ID = "crewmaster";
const PUB = `artifacts/${APP_ID}/public/data`;
const PRIV = `artifacts/${APP_ID}/private/data`;
const CENTRE_CAP = 100;
const LOG_CAP = 500;

export type Category =
  | "announcements" | "repairs" | "workorders" | "leases" | "fleet" | "policies";

// Global kill switches + per-trigger sub-toggles. Defaults: all ON except the
// dormant policy sign-off. Enforced SERVER-SIDE here.
interface AudienceSpec { roles?: string[]; divisions?: string[]; people?: string[] }
interface GlobalConfig {
  globals?: Partial<Record<Category, boolean>>;
  subToggles?: Record<string, boolean>;   // e.g. workorders_created / workorders_assigned
  // Editable recipient audiences, keyed per trigger. Broadcast types
  // (workorders_created / leases / fleet) OVERRIDE their default when set;
  // "*_extra" keys (repairs_extra / workorders_assigned_extra) ADD on top of
  // the structural recipients that define the event's meaning.
  audiences?: Record<string, AudienceSpec>;
}

const normEmail = (v: unknown): string =>
  typeof v === "string" ? v.trim().toLowerCase() : "";
const key = (email: string): string => encodeURIComponent(email);

interface SendPayload { title: string; body: string; url?: string }

async function loadConfig(): Promise<GlobalConfig> {
  const snap = await db.doc(`${PUB}/notificationConfig/globals`).get();
  return (snap.data() as GlobalConfig) || {};
}

// Append to a recipient's bounded notification centre (newest first, capped).
async function appendCentre(email: string, category: Category, p: SendPayload) {
  const ref = db.doc(`${PUB}/notificationCentre/${key(email)}`);
  await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as {items?: any[]} | undefined;
    const items = cur?.items || [];
    const entry = {
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      category, title: p.title, body: p.body, url: p.url || "/",
      at: Date.now(), read: false,
    };
    tx.set(ref, {userId: email, items: [entry, ...items].slice(0, CENTRE_CAP)}, {merge: true});
  });
}

async function removeToken(email: string, token: string) {
  const ref = db.doc(`${PUB}/pushTokens/${key(email)}`);
  const snap = await ref.get();
  const tokens = ((snap.data() as any)?.tokens || []).filter((t: any) => t.token !== token);
  await ref.set({userId: email, tokens}, {merge: true});
}

async function logSend(category: Category, p: SendPayload, recipientCount: number, delivered: number) {
  try {
    await db.collection(`${PUB}/notificationLog`).add({
      category, title: p.title, body: p.body, recipientCount, delivered, at: Date.now(),
    });
  } catch (e) {
    logger.warn("notif log write failed", {error: String(e)});
  }
}

// ── The single send entry point ──────────────────────────────────────────
// Checks the global toggle, each user's category preference, writes the centre
// entry (inbox works without push), sends to tokens, prunes dead ones, logs.
export async function sendNotification(
  userEmails: string[], category: Category, p: SendPayload, subToggle?: string,
): Promise<{recipients: number; delivered: number; pruned: number; skipped?: string}> {
  const cfg = await loadConfig();
  if (cfg.globals?.[category] === false) return {recipients: 0, delivered: 0, pruned: 0, skipped: "global_off"};
  if (subToggle && cfg.subToggles?.[subToggle] === false) return {recipients: 0, delivered: 0, pruned: 0, skipped: "subtoggle_off"};

  const uids = [...new Set(userEmails.map(normEmail).filter(Boolean))];
  const recipients: string[] = [];
  for (const uid of uids) {
    const pref = (await db.doc(`${PUB}/notificationPrefs/${key(uid)}`).get()).data() as any;
    const master = pref?.master !== false;               // default ON
    const catOn = pref?.categories?.[category] !== false; // default ON
    if (master && catOn) recipients.push(uid);
  }
  return deliverTo(recipients, category, p);
}

// Delivery core — no gating. Writes each recipient's centre entry, sends to
// their tokens, prunes dead ones, logs. Callers gate before reaching here
// (sendNotification checks toggles/prefs; the test sender bypasses them).
async function deliverTo(
  recipients: string[], category: Category, p: SendPayload,
): Promise<{recipients: number; delivered: number; pruned: number}> {
  // Centre entries (inbox even without a push token) + collect tokens.
  const tokens: string[] = [];
  const owner = new Map<string, string>();
  for (const uid of recipients) {
    await appendCentre(uid, category, p);
    const td = (await db.doc(`${PUB}/pushTokens/${key(uid)}`).get()).data() as any;
    for (const t of (td?.tokens || [])) { tokens.push(t.token); owner.set(t.token, uid); }
  }

  let delivered = 0; let pruned = 0;
  if (tokens.length) {
    try {
      // DATA-ONLY — the service worker builds the notification (avoids the
      // double-display that a `notification` payload causes on web push).
      const res = await admin.messaging().sendEachForMulticast({
        tokens,
        data: {title: p.title, body: p.body, url: p.url || "/", category},
        webpush: {headers: {Urgency: "high"}, fcmOptions: {link: p.url || "/"}},
      });
      const dead: string[] = [];
      res.responses.forEach((r, i) => {
        if (r.success) { delivered++; return; }
        const code = (r.error as any)?.code || "";
        if (/not-registered|invalid-argument|invalid-registration-token/.test(code)) dead.push(tokens[i]);
      });
      for (const t of dead) { try { await removeToken(owner.get(t)!, t); } catch { /* noop */ } }
      pruned = dead.length;
    } catch (e) {
      logger.warn("multicast send failed", {error: String(e)});
    }
  }
  await logSend(category, p, recipients.length, delivered);
  return {recipients: recipients.length, delivered, pruned};
}

// ── Dedupe markers (scheduled types) — bounded, TTL-cleaned ────────────────
export async function alreadySent(marker: string): Promise<boolean> {
  return (await db.doc(`${PRIV}/notificationDedupe/${encodeURIComponent(marker)}`).get()).exists;
}
export async function markSent(marker: string): Promise<void> {
  await db.doc(`${PRIV}/notificationDedupe/${encodeURIComponent(marker)}`).set({at: Date.now()});
}
// Called from the scheduled pass: trim old dedupe markers + old log entries.
export async function cleanupNotifications(): Promise<void> {
  const cutoff = Date.now() - 400 * 24 * 3600 * 1000;
  const stale = await db.collection(`${PRIV}/notificationDedupe`).where("at", "<", cutoff).limit(200).get();
  for (const d of stale.docs) await d.ref.delete();
  const logSnap = await db.collection(`${PUB}/notificationLog`).orderBy("at", "desc").offset(LOG_CAP).limit(100).get();
  for (const d of logSnap.docs) await d.ref.delete();
}

// ── Audience resolution helpers ────────────────────────────────────────────
async function loadEmployees(): Promise<any[]> {
  const main = (await db.doc(`${PUB}/appData/main`).get()).data() as any;
  return (main?.employees || []) as any[];
}
const empEmail = (e: any): string => normEmail(e.linkedUserEmail || e.email);
async function emailsForRole(roles: string[]): Promise<string[]> {
  const emps = await loadEmployees();
  return emps.filter((e) => roles.includes(e.systemRole || "worker")).map(empEmail).filter(Boolean);
}
// Marco (super admin) + Tony (contractingManager) + Linda (property_manager).
async function contractingManagerEmails(): Promise<string[]> {
  const emps = await loadEmployees();
  const out = new Set<string>(["marcoguidopalermo@gmail.com"]);
  for (const e of emps) {
    if (e.contractingManager || e.systemRole === "property_manager") { const em = empEmail(e); if (em) out.add(em); }
  }
  return [...out];
}
// Resolve an editable audience spec (roles + divisions + explicit people) to a
// concrete email list. Empty/absent spec → [].
async function resolveSpec(spec: AudienceSpec | undefined): Promise<string[]> {
  if (!spec) return [];
  const out = new Set<string>();
  const emps = await loadEmployees();
  if (spec.roles?.length) {
    for (const e of emps) {
      if (spec.roles.includes(e.systemRole || "worker")) { const em = empEmail(e); if (em) out.add(em); }
    }
  }
  if (spec.divisions?.length) {
    const wanted = spec.divisions.map((d) => (d || "").toLowerCase());
    for (const e of emps) {
      const div = (e.managedDivision || "").toLowerCase();
      const crew = (e.primaryCrew || "").toLowerCase();
      if (wanted.some((d) => d && (div === d || crew.includes(d)))) { const em = empEmail(e); if (em) out.add(em); }
    }
  }
  for (const p of (spec.people || [])) { const em = normEmail(p); if (em) out.add(em); }
  return [...out];
}
const hasSpec = (s: AudienceSpec | undefined): boolean =>
  !!s && !!((s.roles?.length) || (s.divisions?.length) || (s.people?.length));
// Broadcast audience: stored spec OVERRIDES the structural default when set.
async function audienceFor(
  cfg: GlobalConfig, key: string, fallback: () => Promise<string[]>,
): Promise<string[]> {
  const spec = cfg.audiences?.[key];
  return hasSpec(spec) ? resolveSpec(spec) : fallback();
}

async function adminsAndManagers(): Promise<string[]> {
  const set = new Set(await emailsForRole(["admin", "manager"]));
  set.add("marcoguidopalermo@gmail.com");
  return [...set];
}

// ═══════════════════════ CALLABLES ═══════════════════════
// Register a device push token for the signed-in user (multi-device).
export const registerPushToken = onCall({region: REGION}, async (req) => {
  const email = normEmail(req.auth?.token?.email);
  if (!email) throw new HttpsError("unauthenticated", "Sign in required.");
  const {token, platform} = (req.data || {}) as {token?: string; platform?: string};
  if (!token) throw new HttpsError("invalid-argument", "token required");
  const ref = db.doc(`${PUB}/pushTokens/${key(email)}`);
  const cur = ((await ref.get()).data() as any)?.tokens || [];
  const now = Date.now();
  const existing = cur.find((t: any) => t.token === token);
  const tokens = existing
    ? cur.map((t: any) => (t.token === token ? {...t, lastSeenAt: now} : t))
    : [...cur, {token, platform: platform || "web", createdAt: now, lastSeenAt: now}];
  await ref.set({userId: email, tokens}, {merge: true});
  return {ok: true, count: tokens.length};
});

// Bulletin "Send notification" → targeted announcement.
export const pushAnnouncement = onCall({region: REGION}, async (req) => {
  const email = normEmail(req.auth?.token?.email);
  if (!email) throw new HttpsError("unauthenticated", "Sign in required.");
  const emps = await loadEmployees();
  const me = emps.find((e) => empEmail(e) === email);
  const role = me?.systemRole || (email === "marcoguidopalermo@gmail.com" ? "admin" : "worker");
  if (!["admin", "manager"].includes(role) && email !== "marcoguidopalermo@gmail.com") {
    throw new HttpsError("permission-denied", "Managers/admins only.");
  }
  const {audience, division, roleGroup, title, body, bulletinId} = (req.data || {}) as any;
  let targets: string[] = [];
  if (audience === "division" && division) {
    targets = emps.filter((e) => (e.managedDivision === division || e.primaryCrew?.toLowerCase?.().includes(division))).map(empEmail);
  } else if (audience === "role" && roleGroup) {
    targets = await emailsForRole(Array.isArray(roleGroup) ? roleGroup : [roleGroup]);
  } else {
    targets = emps.map(empEmail); // everyone
  }
  const res = await sendNotification(targets.filter(Boolean), "announcements",
    {title: title || "Announcement", body: body || "", url: bulletinId ? `/#bulletins` : "/#bulletins"});
  return res;
});

// MechanicMaster: repair assigned → notify the assigned mechanic(s).
export const pushRepairAssigned = onCall({region: REGION}, async (req) => {
  const email = normEmail(req.auth?.token?.email);
  if (!email) throw new HttpsError("unauthenticated", "Sign in required.");
  const {mechanicEmails, title, priority, reportedBy, taskId} = (req.data || {}) as any;
  if (!Array.isArray(mechanicEmails) || !mechanicEmails.length) return {recipients: 0, delivered: 0, pruned: 0};
  const pri = priority === "high" ? "🔴 HIGH PRIORITY · " : "";
  // Structural (assigned mechanics) + admin-configured extras on top.
  const cfg = await loadConfig();
  const extra = await resolveSpec(cfg.audiences?.repairs_extra);
  const recips = [...new Set([...mechanicEmails.map(normEmail), ...extra])];
  const res = await sendNotification(recips, "repairs",
    {title: `${pri}Repair assigned`, body: `${title || "Repair"}${reportedBy ? ` · reported by ${reportedBy}` : ""}`, url: taskId ? `/#mechanic` : "/#mechanic"});
  return res;
});

// Dashboard "Send test to me" → sample of a type to the caller's own devices
// only. Bypasses the global kill switch + the caller's own prefs (so a disabled
// or muted type is still testable), but logs like any real send.
const TEST_SAMPLES: Record<Category, {title: string; body: string; url: string}> = {
  announcements: {title: "📣 Announcement", body: "This is how an announcement will look.", url: "/#bulletins"},
  repairs: {title: "🔧 Repair assigned", body: "Sample repair · reported by a crew member.", url: "/#mechanic"},
  workorders: {title: "🏠 New work order", body: "Sample work order · a property · HIGH.", url: "/#contracting"},
  leases: {title: "📄 Lease expiry in 60 days", body: "Sample property · Unit 1 · tenant.", url: "/#contracting"},
  fleet: {title: "🚚 Registration expiring in 30 days", body: "Sample fleet unit.", url: "/#mechanic"},
  policies: {title: "📝 Policy sign-off", body: "Sample policy acknowledgement.", url: "/"},
};
export const sendTestNotification = onCall({region: REGION}, async (req) => {
  const email = normEmail(req.auth?.token?.email);
  if (!email) throw new HttpsError("unauthenticated", "Sign in required.");
  const emps = await loadEmployees();
  const me = emps.find((e) => empEmail(e) === email);
  const role = me?.systemRole || (email === "marcoguidopalermo@gmail.com" ? "admin" : "worker");
  if (role !== "admin" && email !== "marcoguidopalermo@gmail.com") {
    throw new HttpsError("permission-denied", "Admins only.");
  }
  const category = ((req.data || {}) as any).category as Category;
  const sample = TEST_SAMPLES[category];
  if (!sample) throw new HttpsError("invalid-argument", "unknown category");
  const res = await deliverTo([email], category,
    {title: sample.title, body: `TEST · ${sample.body}`, url: sample.url});
  return res;
});

// ═══════════════════════ WORK ORDER TRIGGERS (subcollection) ═══════════════
// Created → Marco+Tony. Assigned → each NEWLY-ADDED assignee (array diff).
export const onWorkOrderWrite = onDocumentWritten(
  {region: REGION, document: `${PUB}/contractingWorkOrders/{id}`},
  async (event) => {
    try {
      const before = event.data?.before.data() as any;
      const after = event.data?.after.data() as any;
      if (!after) return;                       // deleted
      const assigneesOf = (w: any): string[] =>
        (w?.assigneeIds && w.assigneeIds.length ? w.assigneeIds : (w?.assigneeId ? [w.assigneeId] : []));
      const cfg = await loadConfig();

      // CREATED — broadcast; stored audience overrides the default managers.
      if (!before) {
        const mgrs = await audienceFor(cfg, "workorders_created", contractingManagerEmails);
        await sendNotification(mgrs, "workorders", {
          title: "New work order",
          body: `${after.title || "Work order"} · ${after.property || ""}${after.priority === "high" ? " · HIGH" : ""}${after.createdBy?.name ? ` · logged by ${after.createdBy.name}` : ""}`,
          url: "/#contracting",
        }, "workorders_created");
      }

      // ASSIGNED — only newly-added ids (not existing assignees on edit).
      const beforeIds = new Set(assigneesOf(before));
      const added = assigneesOf(after).filter((id: string) => !beforeIds.has(id));
      if (added.length) {
        // Resolve assignee employee ids → their login emails.
        const emps = await loadEmployees();
        const emails = added
          .map((id: string) => emps.find((e) => e.id === id))
          .map((e: any) => empEmail(e || {}))
          .filter(Boolean);
        // Structural (new assignees) + admin-configured extras on top.
        const extra = await resolveSpec(cfg.audiences?.workorders_assigned_extra);
        const recips = [...new Set([...emails, ...extra])];
        if (recips.length) {
          await sendNotification(recips, "workorders", {
            title: "Work order assigned to you",
            body: `${after.title || "Work order"} · ${after.property || ""}`,
            url: "/#contracting",
          }, "workorders_assigned");
        }
      }
    } catch (e) {
      logger.warn("onWorkOrderWrite notif failed (isolated)", {error: String(e)});
    }
  },
);

// ═══════════════════════ SCHEDULED SCAN (lease + fleet) ════════════════════
// Called from the existing scheduled pass — ISOLATED by the caller.
const DAY = 86_400_000;
function ymdToMs(s: string): number { const [y, m, d] = s.split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1).getTime(); }
function daysUntil(endYmd: string, nowMs: number): number {
  const start = new Date(nowMs); start.setHours(0, 0, 0, 0);
  return Math.round((ymdToMs(endYmd) - start.getTime()) / DAY);
}
export async function runNotificationScan(nowMs: number, warnings: string[]): Promise<void> {
  const cfg = await loadConfig();

  // ── Lease / move-out (60 days + at the date) → Marco + Tony + Linda ──
  if (cfg.globals?.leases !== false) {
    const recips = await audienceFor(cfg, "leases", contractingManagerEmails);
    const props = await db.collection(`${PUB}/contractingPropertyDocs`).get();
    for (const doc of props.docs) {
      const p = doc.data() as any;
      if (p.active === false) continue;
      for (const u of (p.units || [])) {
        const t = u.tenancy; if (!t) continue;
        const moveOut = t.moveOutAt || t.computedEnd;
        const endYmd = moveOut || (t.status === "fixed_term" ? t.leaseEnd : undefined);
        if (!endYmd) continue;
        const d = daysUntil(endYmd, nowMs);
        const tenant = (t.tenants || []).map((x: any) => x.name).filter(Boolean).join(", ") || "tenant";
        const label = moveOut ? "Move-out" : "Lease expiry";
        if (d <= 60 && d > 0) {
          const marker = `lease-${t.id}-60d`;
          if (!(await alreadySent(marker))) {
            await sendNotification(recips, "leases", {title: `${label} in ${d} days`, body: `${p.name} · ${u.name} · ${tenant}`, url: "/#contracting"});
            await markSent(marker);
          }
        }
        if (d <= 0) {
          const marker = `lease-${t.id}-due`;
          if (!(await alreadySent(marker))) {
            await sendNotification(recips, "leases", {title: `${label} reached`, body: `${p.name} · ${u.name} · ${tenant}`, url: "/#contracting"});
            await markSent(marker);
          }
        }
      }
    }
  }

  // ── Fleet document expiry (30 days + at expiry) → admins + managers ──
  if (cfg.globals?.fleet !== false) {
    const recips = await audienceFor(cfg, "fleet", adminsAndManagers);
    const main = (await db.doc(`${PUB}/appData/main`).get()).data() as any;
    const fleet = (main?.fleet || []) as any[];
    for (const unit of fleet) {
      const docs = collectFleetDocExpiries(unit);
      for (const {id, label, ymd} of docs) {
        const d = daysUntil(ymd, nowMs);
        if (d <= 30 && d > 0) {
          const marker = `fleetdoc-${id}-30d`;
          if (!(await alreadySent(marker))) {
            await sendNotification(recips, "fleet", {title: `${label} expiring in ${d} days`, body: `${unit.name || unit.id}`, url: "/#mechanic"});
            await markSent(marker);
          }
        }
        if (d <= 0) {
          const marker = `fleetdoc-${id}-exp`;
          if (!(await alreadySent(marker))) {
            await sendNotification(recips, "fleet", {title: `${label} expired`, body: `${unit.name || unit.id}`, url: "/#mechanic"});
            await markSent(marker);
          }
        }
      }
    }
  }

  await cleanupNotifications();
  warnings.push("notification_scan_ok");
}

// Fleet doc expiry dates carried on the unit (registration/insurance/safety/
// plate/CVOR). Defensive — reads whatever ISO/ymd fields exist.
function collectFleetDocExpiries(unit: any): {id: string; label: string; ymd: string}[] {
  const out: {id: string; label: string; ymd: string}[] = [];
  const push = (field: string, label: string) => {
    const v = unit[field];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) out.push({id: `${unit.id}-${field}`, label, ymd: v.slice(0, 10)});
  };
  push("registrationExpiry", "Registration");
  push("insuranceExpiry", "Insurance");
  push("safetyExpiry", "Safety");
  push("plateExpiry", "Plate");
  push("cvorExpiry", "CVOR");
  return out;
}

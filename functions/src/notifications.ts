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
  | "announcements" | "repairs" | "workorders" | "leases" | "fleet" | "policies"
  | "storage" | "marketing"
  // Crew/scheduling messages TO a manager. Today that is a worker reporting
  // they are not on a crew; it is its own category so a manager can mute
  // marketing chatter without muting somebody telling them they are stranded.
  | "crew";

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
  // Quiet hours (Toronto). Default: enabled, 20:00–08:00. Pushes in the window
  // are held + delivered at window end; centre entries still land immediately.
  quietHours?: {enabled?: boolean; startHour?: number; endHour?: number};
  // Per-type "bypass quiet hours" (default OFF). For future urgent categories.
  bypassQuiet?: Partial<Record<Category, boolean>>;
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

// ── Quiet hours (default 8 PM–8 AM Toronto) ─────────────────────────────────
// During the window, pushes are HELD (queued) and delivered in one catch-up
// when the window ends; notification-centre entries still land immediately.
function torontoHour(nowMs: number): number {
  const s = new Date(nowMs).toLocaleString("en-US", {timeZone: "America/Toronto", hour12: false, hour: "2-digit"});
  return parseInt(s, 10) % 24;
}
function quietActive(cfg: GlobalConfig, nowMs: number): boolean {
  const q = cfg.quietHours || {};
  if (q.enabled === false) return false;
  const start = typeof q.startHour === "number" ? q.startHour : 20;
  const end = typeof q.endHour === "number" ? q.endHour : 8;
  if (start === end) return false;
  const h = torontoHour(nowMs);
  return start < end ? (h >= start && h < end) : (h >= start || h < end);
}
async function enqueuePush(recipients: string[], category: Category, p: SendPayload) {
  await db.collection(`${PUB}/notificationQueue`).add({
    category, title: p.title, body: p.body, url: p.url || "/", recipients, at: Date.now(),
  });
}

// Write each recipient's bounded centre entry (inbox works without push).
async function appendCentres(recipients: string[], category: Category, p: SendPayload) {
  for (const uid of recipients) await appendCentre(uid, category, p);
}

// Push to recipients' tokens (NO centre write — that's done separately so the
// inbox lands immediately even when the push is held for quiet hours). Prunes
// dead tokens, logs the send.
async function pushToTokens(
  recipients: string[], category: Category, p: SendPayload,
): Promise<{delivered: number; pruned: number}> {
  const tokens: string[] = [];
  const owner = new Map<string, string>();
  for (const uid of recipients) {
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
  return {delivered, pruned};
}

// Immediate deliver (centre + push) — no quiet gate. Used by the test sender.
async function deliverTo(
  recipients: string[], category: Category, p: SendPayload,
): Promise<{recipients: number; delivered: number; pruned: number}> {
  await appendCentres(recipients, category, p);
  const r = await pushToTokens(recipients, category, p);
  return {recipients: recipients.length, ...r};
}

// ── The single send entry point ──────────────────────────────────────────
// Checks the global toggle, each user's category preference, writes the centre
// entry (inbox works without push). The PUSH is sent now, unless quiet hours
// are active and the type doesn't bypass them (and no deliverNow override), in
// which case it's queued for the end-of-window catch-up.
export async function sendNotification(
  userEmails: string[], category: Category, p: SendPayload,
  subToggle?: string, opts?: {deliverNow?: boolean},
): Promise<{recipients: number; delivered: number; pruned: number; skipped?: string; queued?: boolean}> {
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
  // Inbox lands immediately; only the buzz waits.
  await appendCentres(recipients, category, p);
  const bypass = cfg.bypassQuiet?.[category] === true;
  if (!opts?.deliverNow && !bypass && quietActive(cfg, Date.now())) {
    await enqueuePush(recipients, category, p);
    return {recipients: recipients.length, delivered: 0, pruned: 0, queued: true};
  }
  const r = await pushToTokens(recipients, category, p);
  return {recipients: recipients.length, delivered: r.delivered, pruned: r.pruned};
}

// ── Quiet-hours catch-up ────────────────────────────────────────────────────
// Called from the scheduled pass. When the quiet window is NOT active, deliver
// every queued push in one pass — RE-CHECKING gates at delivery time (global
// toggle + each recipient's current prefs). No-op while still quiet. Isolated
// by the caller. (Centre entries were already written at enqueue time.)
export async function runQuietFlush(nowMs: number, warnings: string[]): Promise<void> {
  const cfg = await loadConfig();
  if (quietActive(cfg, nowMs)) { warnings.push("quiet_flush skipped (still quiet)"); return; }
  const snap = await db.collection(`${PUB}/notificationQueue`).orderBy("at").limit(300).get();
  if (snap.empty) { warnings.push("quiet_flush empty"); return; }
  let delivered = 0;
  for (const doc of snap.docs) {
    const q = doc.data() as any;
    const category = q.category as Category;
    try {
      if (cfg.globals?.[category] === false) { await doc.ref.delete(); continue; } // global off now
      const recips: string[] = [];
      for (const uid of (q.recipients || [])) {
        const pref = (await db.doc(`${PUB}/notificationPrefs/${key(uid)}`).get()).data() as any;
        if (pref?.master !== false && pref?.categories?.[category] !== false) recips.push(uid);
      }
      if (recips.length) {
        const r = await pushToTokens(recips, category, {title: q.title, body: q.body, url: q.url});
        delivered += r.delivered;
      }
    } catch (e) {
      logger.warn("quiet flush item failed", {error: String(e)});
    }
    await doc.ref.delete();
  }
  warnings.push(`quiet_flush delivered=${delivered} items=${snap.size}`);
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
  const {audience, division, roleGroup, title, body, bulletinId, deliverNow} = (req.data || {}) as any;
  let targets: string[] = [];
  if (audience === "division" && division) {
    targets = emps.filter((e) => (e.managedDivision === division || e.primaryCrew?.toLowerCase?.().includes(division))).map(empEmail);
  } else if (audience === "role" && roleGroup) {
    targets = await emailsForRole(Array.isArray(roleGroup) ? roleGroup : [roleGroup]);
  } else {
    targets = emps.map(empEmail); // everyone
  }
  // deliverNow = the poster chose to pierce quiet hours for this bulletin.
  const res = await sendNotification(targets.filter(Boolean), "announcements",
    {title: title || "Announcement", body: body || "", url: bulletinId ? `/#bulletins` : "/#bulletins"},
    undefined, {deliverNow: !!deliverNow});
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

// A worker on nobody's crew today telling their manager they are available.
//
// RECIPIENTS ARE RESOLVED HERE, never passed in: the client sends no addresses,
// so this cannot be used to message arbitrary people. The caller's own employee
// record gives their division; that division's manager(s) plus any all-division
// manager are the recipients.
//
// This notifies. It does NOT assign — crew composition stays the manager's
// decision (see MyCrewToday for why).
export const pushAvailableForWork = onCall({region: REGION}, async (req) => {
  const email = normEmail(req.auth?.token?.email);
  if (!email) throw new HttpsError("unauthenticated", "Sign in required.");
  const emps = await loadEmployees();
  const me = emps.find((e) => empEmail(e) === email);
  if (!me) throw new HttpsError("permission-denied", "No employee record for this account.");

  // A worker's division comes from primaryCrew ("Lawn" / "Small Project" /
  // "Large Project"); a manager carries managedDivision ("lawn"/"small"/"large"
  // /"all"). Map the former onto the latter's vocabulary.
  const crew = (me.primaryCrew || "").toLowerCase();
  const myDiv = crew.includes("lawn") ? "lawn"
    : crew.includes("small") ? "small"
      : crew.includes("large") ? "large" : null;
  const DIV_LABEL: Record<string, string> = {
    lawn: "Lawn Division", small: "Small Projects", large: "Large Projects",
  };

  const active = (e: any): boolean => {
    const v = String(e.status || "").toLowerCase();
    return !e.isTestUser && !(v.includes("away") || v.includes("inactive") ||
      v.includes("archive") || v.includes("terminat"));
  };
  const addr = (e: any): string => {
    const em = empEmail(e);
    return em && em !== email ? em : "";     // never notify the caller themselves
  };

  // OWN DIVISION MANAGER ONLY. Previously every all-division manager was copied
  // too, which meant a lawn worker's "I'm available" also went to people with no
  // say over the lawn roster — noise that trains a manager to ignore the type.
  let recips: string[] = [];
  let routedTo = "";
  if (myDiv) {
    recips = emps
      .filter((e) => active(e) && String(e.managedDivision || "").toLowerCase() === myDiv)
      .map(addr).filter(Boolean);
    routedTo = `${DIV_LABEL[myDiv]} manager`;
  }
  // FALLBACK TO ADMIN when the division has no manager set — or when the person
  // has no division to route by. Somebody stranded must always reach a human;
  // silence here would be the worst outcome of the whole feature.
  if (recips.length === 0) {
    recips = emps
      .filter((e) => active(e) && ((e.systemRole === "admin") ||
        String(e.managedDivision || "").toLowerCase() === "all"))
      .map(addr).filter(Boolean);
    routedTo = myDiv ? `admin (no ${DIV_LABEL[myDiv]} manager set)` : "admin (no division set)";
  }
  recips = [...new Set(recips)];
  if (recips.length === 0) {
    // Honest failure rather than a silent success: the button said it would tell
    // somebody, and there is nobody to tell.
    throw new HttpsError("failed-precondition", "No manager or admin is set up to receive this yet.");
  }

  const date = String((req.data || {}).date || "").slice(0, 10);
  const when = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
  const name = me.name || email;
  const divLabel = myDiv ? DIV_LABEL[myDiv] : "no division";
  const res = await sendNotification(recips, "crew", {
    // Name and division in BOTH title and body: a manager reading a lock screen
    // needs to know who and which crew without opening anything.
    title: `🙋 ${name} is available — ${divLabel}`,
    body: `${name} (${divLabel}) is not on a crew${when ? ` on ${when}` : " today"} and is available to work.`,
    url: "/#schedule",
  });
  return {...res, routedTo};
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
  storage: {title: "⚠️ Storage warning", body: "Sample — main data document nearing its size limit.", url: "/"},
  marketing: {title: "💬 Sample commented on clip #0058", body: "Sample — trim the intro, the drone shot is the hook.", url: "/#marketing"},
  crew: {title: "🙋 Sample is available", body: "Sample — not on a crew today, available to work.", url: "/#schedule"},
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

// ═══════════════════════ MARKETING TRIGGERS ════════════════════════════════
// The marketing board is worked by two or three people, so every type here
// notifies THE OTHERS and never the person who caused the event — a push about
// your own comment is noise, and noise is how a channel gets muted.
//
// All three go through sendNotification like everything else: the "marketing"
// kill switch, each person's category preference, quiet hours and the held-push
// catch-up all apply without a line of special-casing. Each trigger is wrapped
// so a notification failure can never fail the write that caused it, and each
// takes a dedupe marker so an at-least-once trigger retry can't ping twice.

// Marketing access is the marketing systemRole plus two people BY NAME —
// mirrors MARKETING_EMAILS in App.tsx, where Marco and James hold the marketing
// duties but are admins (canViewMarketing is false for the admin role).
const MARKETING_BY_NAME = ["marcoguidopalermo@gmail.com", "sales@marcosmowing.com"];
async function marketingUserEmails(): Promise<string[]> {
  const emps = await loadEmployees();
  const out = new Set<string>(MARKETING_BY_NAME);
  for (const e of emps) {
    if ((e.systemRole || "") === "marketing") { const em = empEmail(e); if (em) out.add(em); }
  }
  return [...out];
}
// Everyone on the board except the actor, plus any admin-configured extras.
async function marketingRecipients(actor: unknown): Promise<string[]> {
  const cfg = await loadConfig();
  const extra = await resolveSpec(cfg.audiences?.marketing_extra);
  const me = normEmail(actor);
  const all = [...new Set([...(await marketingUserEmails()), ...extra])];
  return all.filter((e) => e && e !== me);
}

// Mirror of commentSubject() in src/components/MarketingComments.tsx: a message
// with no subject fields is a clip message keyed by `clip`, which is what every
// message written before subjects existed looks like.
function subjectOf(c: any): {type: string; id: string} {
  const t = ["clip", "link", "todo", "music"].includes(c?.subjectType) ? String(c.subjectType) : "clip";
  const id = String((t === "clip" ? (c?.subjectId || c?.clip) : c?.subjectId) || "");
  return {type: t, id};
}
const snip = (v: unknown, n: number): string => {
  const s = String(v || "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
// What the comment is about, in words, plus the on-page anchor to open on tap.
async function describeSubject(c: any): Promise<{label: string; anchor: string}> {
  const {type, id} = subjectOf(c);
  if (!id) return {label: "", anchor: ""};
  if (type === "clip") {
    return {label: `clip ${/^\d+$/.test(id) ? `#${id.padStart(4, "0")}` : `#${id}`}`, anchor: `clip-${id}`};
  }
  if (type === "link") {
    const d = (await db.doc(`${PUB}/marketingLinks/${id}`).get()).data() as any;
    return {label: d?.title ? `"${snip(d.title, 40)}"` : "a reference link", anchor: `link-${id}`};
  }
  if (type === "music") {
    // Named explicitly rather than left to the to-do fallback below, which
    // would look the id up in marketingTodos and call a track "a to-do".
    const d = (await db.doc(`${PUB}/marketingMusic/${id}`).get()).data() as any;
    return {label: d?.title ? `"${snip(d.title, 40)}"` : "a track", anchor: `music-${id}`};
  }
  const d = (await db.doc(`${PUB}/marketingTodos/${id}`).get()).data() as any;
  return {label: d?.text ? `"${snip(d.text, 40)}"` : "a to-do", anchor: `todo-${id}`};
}

// (a) NEW COMMENT — on a clip thread, a reference link or a to-do. The main
// one: a comment nobody sees is a conversation that doesn't happen. Fires on
// CREATE only; an edit or a delete is not an event worth a buzz.
export const onMarketingCommentWrite = onDocumentWritten(
  {region: REGION, document: `${PUB}/marketingFeedback/{id}`},
  async (event) => {
    try {
      const before = event.data?.before.data() as any;
      const after = event.data?.after.data() as any;
      if (before || !after) return;
      const marker = `mktcomment-${event.params.id}`;
      if (await alreadySent(marker)) return;
      await markSent(marker);
      const recips = await marketingRecipients(after.createdBy?.email);
      if (!recips.length) return;
      const {label, anchor} = await describeSubject(after);
      const who = after.createdBy?.name || "Someone";
      await sendNotification(recips, "marketing", {
        title: `💬 ${who} commented${label ? ` on ${label}` : ""}`,
        body: snip(after.text, 140),
        url: `/#marketing${anchor ? `/${anchor}` : ""}`,
      }, "marketing_comment");
    } catch (e) {
      logger.warn("onMarketingCommentWrite notif failed (isolated)", {error: String(e)});
    }
  },
);

// (b) CLIP SENT TO THE POST QUEUE — the marketer's cue that something is
// approved and ready to schedule. Fires when a row is created, and when an
// already-posted clip is re-queued for a re-post. A reorder, a note edit or
// marking something posted is not an event.
export const onMarketingPostQueueWrite = onDocumentWritten(
  {region: REGION, document: `${PUB}/marketingPostQueue/{clip}`},
  async (event) => {
    try {
      const before = event.data?.before.data() as any;
      const after = event.data?.after.data() as any;
      if (!after || after.status === "posted") return;
      if (before && before.status !== "posted") return;   // already waiting to go out
      const clip = String(event.params.clip);
      // The marker carries the queue position, which is rewritten on every
      // (re-)queue — so a trigger retry is suppressed but a genuine re-queue
      // later still gets through.
      const marker = `mktqueue-${clip}-${before ? "re" : "new"}-${after.order || 0}`;
      if (await alreadySent(marker)) return;
      await markSent(marker);
      const recips = await marketingRecipients(after.queuedBy?.email);
      if (!recips.length) return;
      const label = /^\d+$/.test(clip) ? `#${clip.padStart(4, "0")}` : `#${clip}`;
      const who = after.queuedBy?.name || "Someone";
      await sendNotification(recips, "marketing", {
        title: `📤 Clip ${label} is ready to post`,
        body: `${who} sent it to the post queue${after.note ? ` · ${snip(after.note, 100)}` : ""}`,
        url: `/#marketing/pq-${clip}`,
      }, "marketing_postqueue");
    } catch (e) {
      logger.warn("onMarketingPostQueueWrite notif failed (isolated)", {error: String(e)});
    }
  },
);

// (c) NEW TO-DO — HIGH PRIORITY ONLY by default. Every routine task pinging
// everyone is how a channel gets muted, and the list is on screen anyway; a
// high-priority item is the one that shouldn't wait to be noticed. The
// marketing_todo_all sub-toggle opts IN to normal-priority items for anyone who
// disagrees; marketing_todo mutes the type entirely.
export const onMarketingTodoWrite = onDocumentWritten(
  {region: REGION, document: `${PUB}/marketingTodos/{id}`},
  async (event) => {
    try {
      const before = event.data?.before.data() as any;
      const after = event.data?.after.data() as any;
      if (before || !after) return;                       // creates only
      const high = after.priority === "high";
      if (!high) {
        const cfg = await loadConfig();
        if (cfg.subToggles?.marketing_todo_all !== true) return;
      }
      const marker = `mkttodo-${event.params.id}`;
      if (await alreadySent(marker)) return;
      await markSent(marker);
      const recips = await marketingRecipients(after.addedBy?.email);
      if (!recips.length) return;
      const who = after.addedBy?.name || "Someone";
      await sendNotification(recips, "marketing", {
        title: `${high ? "🚩" : "✅"} ${who} added a${high ? " high-priority" : ""} to-do`,
        body: snip(after.text, 140),
        url: `/#marketing/todo-${event.params.id}`,
      }, "marketing_todo");
    } catch (e) {
      logger.warn("onMarketingTodoWrite notif failed (isolated)", {error: String(e)});
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

/* eslint-disable require-jsdoc, valid-jsdoc, max-len */
// Server-side rolling/catch-up archive + auto-finalize. Runs from the
// SCHEDULED sync so the appData doc is kept lean on the server clock without
// an admin opening the board. This is a straight port of the frontend
// archive logic (App.tsx / lib/performanceMonths) — SAME guards (per-day
// settlement, 14-day window, unlock suppression), SAME copy → verify →
// backup → remove, SAME audit events. It moves storage only; it contains NO
// efficiency/bonus math, so it can never drift from the pay calculations.
import type {firestore} from "firebase-admin";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

const MS_DAY = 86_400_000;
const ARCHIVE_WINDOW_DAYS = 14;
const UNLOCK_GRACE_MS = 72 * 3_600_000;
const SHEET_SIZE_WARN_BYTES = 700 * 1024;

type PerfLog = {
  division?: string;
  crewNumber?: number;
  approvalStatus?: string;
  approvedAt?: string;
  waivedAt?: string;
  [k: string]: unknown;
};
type PerfMap = Record<string, Record<string, PerfLog>>;

const monthOf = (d: string): string => (d || "").slice(0, 7);

// Whole days between `date` and `today` (both YYYY-MM-DD), noon-UTC anchored.
function dayAge(date: string, today: string): number {
  const a = Date.parse(`${date}T12:00:00Z`);
  const b = Date.parse(`${today}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return -1;
  return Math.floor((b - a) / MS_DAY);
}

const isCrewDaySettled = (l: PerfLog): boolean =>
  l?.approvalStatus === "approved" || l?.approvalStatus === "waived";

function isDaySettled(dayMap: Record<string, PerfLog>): boolean {
  const ls = Object.values(dayMap || {});
  return ls.length > 0 && ls.every(isCrewDaySettled);
}

function latestSettlementMs(dayMap: Record<string, PerfLog>): number {
  let m = 0;
  for (const l of Object.values(dayMap || {})) {
    for (const t of [l.approvedAt, l.waivedAt]) {
      if (t) {
        const ms = Date.parse(t);
        if (Number.isFinite(ms) && ms > m) m = ms;
      }
    }
  }
  return m;
}

// An admin-unlocked day is suppressed until the grace passes OR it is
// re-settled (approval/waive newer than the unlock).
function isArchiveSuppressed(
  date: string,
  dayMap: Record<string, PerfLog>,
  unlockedDays: Record<string, number>,
  now: number,
): boolean {
  const u = unlockedDays?.[date];
  if (!u) return false;
  if (now - u >= UNLOCK_GRACE_MS) return false;
  if (latestSettlementMs(dayMap) > u) return false;
  return true;
}

// Dates eligible to archive now: settled, aged >= window, not already
// archived, not unlock-suppressed. Cross-month, no backward limit.
function scanArchivableDays(
  perf: PerfMap,
  today: string,
  archivedDays: Record<string, number>,
  unlockedDays: Record<string, number>,
  now: number,
): string[] {
  const out: string[] = [];
  for (const [date, dayMap] of Object.entries(perf || {})) {
    if (archivedDays?.[date]) continue;
    if (dayAge(date, today) < ARCHIVE_WINDOW_DAYS) continue;
    if (!isDaySettled(dayMap)) continue;
    if (isArchiveSuppressed(date, dayMap, unlockedDays, now)) continue;
    out.push(date);
  }
  return out.sort();
}

function groupByMonth(dates: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const d of dates.slice().sort()) (out[monthOf(d)] = out[monthOf(d)] || []).push(d);
  return out;
}

const clean = (o: unknown): unknown =>
  JSON.parse(JSON.stringify(o, (_k, v) => (v === undefined ? null : v)));

// Merge `addDays` into performanceMonths/{ym} (never overwrites prior days),
// re-read to VERIFY the day count, warn if the sheet nears its own cap, then
// write a belt-and-suspenders backup. Returns the merged day count, or null
// on any failure (caller then removes NOTHING from the doc).
async function writeAndVerifySheet(
  db: firestore.Firestore,
  appId: string,
  ym: string,
  addDays: Record<string, Record<string, PerfLog>>,
  meta: { terminal: boolean; by: string; now: number },
  warnings: string[],
): Promise<number | null> {
  try {
    const ref = db.doc(`artifacts/${appId}/public/data/performanceMonths/${ym}`);
    const snap = await ref.get();
    const existing = snap.exists ? (snap.data() as Record<string, unknown>) || {} : {};
    const existingDays = (existing.days as Record<string, Record<string, PerfLog>>) || {};
    const mergedDays = {...existingDays, ...addDays};
    const mergedCount = Object.keys(mergedDays).length;
    const expected =
      Object.keys(existingDays).length +
      Object.keys(addDays).filter((d) => !(d in existingDays)).length;
    const payload: Record<string, unknown> = {
      ...existing,
      month: ym,
      days: mergedDays,
      dayCount: mergedCount,
      lastArchivedAt: meta.now,
      lastArchivedBy: meta.by,
    };
    if (meta.terminal) {
      payload.pushedAt = meta.now;
      payload.pushedBy = meta.by;
      payload.pushedByName = meta.by;
    }
    const cleaned = clean(payload);
    const bytes = JSON.stringify(cleaned).length;
    if (bytes > SHEET_SIZE_WARN_BYTES) {
      warnings.push(`month_sheet_large ym=${ym} bytes=${bytes} (nearing 1 MiB cap)`);
    }
    await ref.set(cleaned as admin.firestore.DocumentData);
    const check = await ref.get();
    const got = check.exists ?
      Object.keys(((check.data() as Record<string, unknown>)?.days as object) || {}).length :
      -1;
    if (got !== expected) {
      warnings.push(`archive_verify_failed ym=${ym} got=${got} expected=${expected} — no removal`);
      return null;
    }
    await db
      .doc(`artifacts/${appId}/public/data/performanceMonthsBackup/${ym}-${meta.now}`)
      .set(cleaned as admin.firestore.DocumentData);
    return got;
  } catch (err) {
    warnings.push(`archive_sheet_error ym=${ym} ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

interface AuditEntry {
  type: string;
  crewLabel: string;
  valueLabel: string;
  valueAfter: number;
  reasonNote: string;
}

/**
 * Run the rolling/catch-up archive + auto-finalize against the live appData
 * doc. Reads the doc fresh (after the main sync write), moves settled aged
 * days to their month sheets, finalizes completed settled months, and writes
 * audit entries. Self-contained + idempotent — a no-op when nothing qualifies.
 * @param {firestore.Firestore} db Admin Firestore handle.
 * @param {string} appId The tenant app id.
 * @param {string} todayStr Toronto YYYY-MM-DD (server clock).
 * @param {number} nowMs Epoch ms (server clock).
 * @param {string[]} warnings Sync summary warnings sink.
 * @return {Promise<{archivedDays: number; finalized: string[]}>} Result.
 */
export async function runArchivePass(
  db: firestore.Firestore,
  appId: string,
  todayStr: string,
  nowMs: number,
  warnings: string[],
): Promise<{ archivedDays: number; finalized: string[] }> {
  const ref = db.doc(`artifacts/${appId}/public/data/appData/main`);
  const snap = await ref.get();
  const data = (snap.data() as Record<string, unknown>) || {};
  const performance = (data.performance as PerfMap) || {};
  const pushedMonths = ((data.pushedMonths as string[]) || []).slice();
  const archivedDays = {...((data.archivedDays as Record<string, number>) || {})};
  const unlockedDays = {...((data.unlockedDays as Record<string, number>) || {})};

  const by = "scheduled sync";
  const audits: AuditEntry[] = [];
  const update: Record<string, unknown> = {};
  let mutated = false;

  // ── 1. Rolling partial push + catch-up scan ──────────────────────────
  const archivable = scanArchivableDays(performance, todayStr, archivedDays, unlockedDays, nowMs);
  const byMonth = groupByMonth(archivable);
  for (const [ym, monthDates] of Object.entries(byMonth)) {
    const addDays: Record<string, Record<string, PerfLog>> = {};
    for (const d of monthDates) if (performance[d]) addDays[d] = performance[d];
    if (Object.keys(addDays).length === 0) continue;
    // eslint-disable-next-line no-await-in-loop
    const verified = await writeAndVerifySheet(db, appId, ym, addDays, {terminal: false, by, now: nowMs}, warnings);
    if (verified === null) continue; // leave these days in the doc
    let crewDays = 0;
    for (const d of Object.keys(addDays)) {
      update[`performance.${d}`] = admin.firestore.FieldValue.delete();
      archivedDays[d] = nowMs;
      delete unlockedDays[d];
      crewDays += Object.keys(addDays[d]).length;
      mutated = true;
    }
    audits.push({
      type: "performance_day_archived",
      crewLabel: ym,
      valueLabel: "days",
      valueAfter: Object.keys(addDays).length,
      reasonNote:
        `Auto-archived ${Object.keys(addDays).length} settled day(s) of ${ym} → sheet ` +
        `(rolling, >${ARCHIVE_WINDOW_DAYS}d, server). ${crewDays} crew-days. ` +
        `Full detail on performanceMonths/${ym}.`,
    });
  }

  // ── 2. Auto-finalize completed, fully-settled months >14d past ───────
  const thisMonth = monthOf(todayStr);
  const dayOfMonth = Number(todayStr.slice(8, 10));
  const candidates = new Set<string>();
  for (const d of Object.keys(performance)) {
    const m = monthOf(d);
    if (m < thisMonth && !pushedMonths.includes(m)) candidates.add(m);
  }
  for (const d of Object.keys(archivedDays)) {
    const m = monthOf(d);
    if (m < thisMonth && !pushedMonths.includes(m)) candidates.add(m);
  }
  const finalized: string[] = [];
  for (const ym of [...candidates].sort()) {
    const [y, m] = ym.split("-").map(Number);
    const monthsBack = (Number(thisMonth.slice(0, 4)) - y) * 12 + (Number(thisMonth.slice(5, 7)) - m);
    const eligible = monthsBack > 1 || (monthsBack === 1 && dayOfMonth >= ARCHIVE_WINDOW_DAYS);
    if (!eligible) continue;
    // In-doc days of this month that were NOT archived above. If ANY is
    // unsettled, the month isn't finalizable; otherwise merge the settled
    // stragglers into the sheet and finalize.
    const inDoc = Object.keys(performance).filter((d) => monthOf(d) === ym && !archivedDays[d]);
    if (inDoc.some((d) => !isDaySettled(performance[d]))) continue; // unsettled → skip
    const archivedForYm = Object.keys(archivedDays).filter((d) => monthOf(d) === ym).length;
    if (inDoc.length === 0 && archivedForYm === 0) continue; // nothing to finalize
    const mergeDays: Record<string, Record<string, PerfLog>> = {};
    for (const d of inDoc) mergeDays[d] = performance[d];
    // eslint-disable-next-line no-await-in-loop
    const verified = await writeAndVerifySheet(db, appId, ym, mergeDays, {terminal: true, by, now: nowMs}, warnings);
    if (verified === null) continue;
    for (const d of inDoc) {
      update[`performance.${d}`] = admin.firestore.FieldValue.delete();
      mutated = true;
    }
    // Collapse this month's per-day markers into the month marker.
    for (const d of Object.keys(archivedDays)) if (monthOf(d) === ym) delete archivedDays[d];
    if (!pushedMonths.includes(ym)) pushedMonths.push(ym);
    finalized.push(ym);
    mutated = true;
    audits.push({
      type: "performance_month_pushed",
      crewLabel: ym,
      valueLabel: "days",
      valueAfter: verified,
      reasonNote:
        `Auto-finalized ${ym} → sheet (${verified} days, server, >${ARCHIVE_WINDOW_DAYS}d past). ` +
        `Locked; full detail on performanceMonths/${ym}. Trends summary regenerates on next view.`,
    });
  }

  if (!mutated) return {archivedDays: 0, finalized: []};

  // Net-reducing doc update: strip archived/finalized dates, refresh markers.
  update.archivedDays = archivedDays;
  update.unlockedDays = unlockedDays;
  update.pushedMonths = pushedMonths.slice().sort();
  await ref.update(update);

  // Audit — fire-and-forget; never block the sync on an audit failure.
  const auditCol = db.collection(`artifacts/${appId}/private/data/performanceActivityLog`);
  await Promise.all(
    audits.map(async (a) => {
      try {
        await auditCol.add({
          type: a.type,
          timestamp: nowMs,
          userId: "system:archive",
          userName: "Scheduled archive",
          userRole: "admin",
          targetDate: todayStr,
          crewId: a.type === "performance_month_pushed" ? "performance-month" : "performance-day",
          crewLabel: a.crewLabel,
          valueLabel: a.valueLabel,
          valueAfter: a.valueAfter,
          reasonNote: a.reasonNote,
        });
      } catch (err) {
        logger.warn("archive audit write failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  const archivedCount = Object.keys(update).filter((k) => k.startsWith("performance.")).length;
  logger.info("archive pass complete", {archivedDays: archivedCount, finalized});
  return {archivedDays: archivedCount, finalized};
}

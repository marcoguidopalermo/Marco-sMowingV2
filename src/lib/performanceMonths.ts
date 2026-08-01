// Push Month helpers — pure functions shared by the app (App.tsx push
// action + auto-push) and mirrored by the one-time push-month.mjs script.
// A "month" is a 'YYYY-MM' string. Nothing here reads or mutates Firestore.
import { PerformanceLog } from '../types';

export type PerfMap = Record<string, Record<string, PerformanceLog>>;

// 'YYYY-MM-DD' → 'YYYY-MM'.
export function monthOfDate(date: string): string {
  return (date || '').slice(0, 7);
}

// All date keys of `performance` that fall in `ym`, sorted ascending.
export function datesInMonth(performance: PerfMap, ym: string): string[] {
  return Object.keys(performance || {})
    .filter((d) => monthOfDate(d) === ym)
    .sort();
}

// Extract a month's full day→crew map (deep — caller may serialize/store).
export function extractMonth(performance: PerfMap, ym: string): PerfMap {
  const out: PerfMap = {};
  for (const d of datesInMonth(performance, ym)) out[d] = performance[d];
  return out;
}

// Distinct months present in a performance map, ascending.
export function monthsPresent(performance: PerfMap): string[] {
  const s = new Set<string>();
  for (const d of Object.keys(performance || {})) s.add(monthOfDate(d));
  return [...s].sort();
}

// A crew-day is "settled" only when approved or waived — the two terminal
// states. Anything else (pending / undefined / legacy) blocks a push,
// because pushing locks the month and we must never lock incomplete pay data.
export function isCrewDaySettled(log: PerformanceLog): boolean {
  return log?.approvalStatus === 'approved' || log?.approvalStatus === 'waived';
}

// Whether a crew-day has ANY real work. The scheduled sync writes a pending
// PerformanceLog for EVERY crew on the day's schedule, including crews that had
// zero synced work (jobs:[], employeeAH:{}) — a no-work placeholder. This is the
// SINGLE source of truth for "real work", shared by the month-finalize gate and
// the outstanding-days banner (approvalOversight) so the two rules can never
// disagree about which crew-days matter.
export function logHasRealWork(log: PerformanceLog): boolean {
  if ((log?.jobs?.length ?? 0) > 0) return true;
  for (const v of Object.values(log?.employeeAH || {})) if ((Number(v) || 0) > 0) return true;
  const ts = (log as { employeeTimesheets?: Record<string, unknown> })?.employeeTimesheets;
  if (ts && Object.keys(ts).length > 0) return true;
  return false;
}

// Sum of a crew-day's attributed actual hours (employeeAH).
export function logActualHours(log: PerformanceLog): number {
  let ah = 0;
  for (const v of Object.values(log?.employeeAH || {})) ah += Number(v) || 0;
  return Math.round(ah * 10) / 10;
}

// ── Rolling partial push (per-day archiving) ─────────────────────────────
// Settled days older than this window archive to their month sheet, keeping
// the main doc lean continuously so it never hits the 1 MiB cap mid-month.
// The window lets corrections happen in the main doc first (avoids churn).
export const ARCHIVE_WINDOW_DAYS = 14;
// After an admin unlocks an archived day it is still settled + aged, so
// without a guard the next cycle would re-archive it immediately. We
// suppress auto-archive for this long OR until the day is re-settled.
export const UNLOCK_GRACE_MS = 72 * 60 * 60 * 1000;
// Month sheets are themselves 1 MiB-capped docs. Warn (admin-facing) well
// before a busy month's sheet nears its own cap. No auto-split in this build.
export const SHEET_SIZE_WARN_BYTES = 700 * 1024;

// Whole calendar days between `date` and `today` (both 'YYYY-MM-DD'),
// anchored at noon UTC so DST/tz can't shift the boundary. -1 on bad input.
export function dayAge(date: string, today: string): number {
  const d = Date.parse(`${date}T12:00:00Z`);
  const t = Date.parse(`${today}T12:00:00Z`);
  if (Number.isNaN(d) || Number.isNaN(t)) return -1;
  return Math.floor((t - d) / 86_400_000);
}

// A DATE is settled only when every crew-day on it is settled (and there is
// at least one crew-day). Mirrors the per-month guard at day granularity.
export function isDaySettled(dayMap: Record<string, PerformanceLog>): boolean {
  const logs = Object.values(dayMap || {});
  if (logs.length === 0) return false;
  return logs.every(isCrewDaySettled);
}

// Newest approval/waive timestamp (ms) across a date's crew-days, 0 if none.
// Used by the unlock race guard to detect "re-settled since unlock".
export function latestSettlementMs(dayMap: Record<string, PerformanceLog>): number {
  let max = 0;
  for (const log of Object.values(dayMap || {})) {
    for (const t of [log.approvedAt, log.waivedAt]) {
      if (t) { const ms = Date.parse(t); if (!Number.isNaN(ms) && ms > max) max = ms; }
    }
  }
  return max;
}

// Is auto-archive suppressed for `date` because an admin just unlocked it?
// Suppression ends as soon as EITHER the grace period passes OR the day is
// re-settled after the unlock (approvedAt/waivedAt newer than unlockedAt).
export function isArchiveSuppressed(
  date: string,
  dayMap: Record<string, PerformanceLog>,
  unlockedDays: Record<string, number> | undefined,
  now: number,
): boolean {
  const u = unlockedDays?.[date];
  if (!u) return false;
  if (now - u >= UNLOCK_GRACE_MS) return false;       // grace elapsed
  if (latestSettlementMs(dayMap) > u) return false;   // re-settled since unlock
  return true;
}

// Dates in `docPerformance` (the main-doc copy) eligible to archive now:
// settled, aged >= window, not already archived, not unlock-suppressed.
// Cross-month with NO backward limit — this IS the catch-up scan, so a
// late-approved straggler from any prior month is caught and routed to ITS
// month's sheet. Idempotent: returns [] when nothing qualifies.
export function scanArchivableDays(
  docPerformance: PerfMap,
  today: string,
  opts: {
    windowDays: number;
    archivedDays?: Record<string, number>;
    unlockedDays?: Record<string, number>;
    now: number;
  },
): string[] {
  const { windowDays, archivedDays, unlockedDays, now } = opts;
  const out: string[] = [];
  for (const [date, dayMap] of Object.entries(docPerformance || {})) {
    if (archivedDays?.[date]) continue;                              // already on a sheet
    if (dayAge(date, today) < windowDays) continue;                 // too recent — keep in doc
    if (!isDaySettled(dayMap)) continue;                            // unsettled — always keep in doc
    if (isArchiveSuppressed(date, dayMap, unlockedDays, now)) continue; // just unlocked
    out.push(date);
  }
  return out.sort();
}

// Group dates by their month ('YYYY-MM'), preserving order.
export function groupDatesByMonth(dates: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const d of dates.slice().sort()) {
    const m = monthOfDate(d);
    (out[m] = out[m] || []).push(d);
  }
  return out;
}

export interface UnsettledCrewDay {
  date: string;
  crewId: string;
  division: string;
  crewNumber: number;
  crewLabel: string;
  status: string;      // 'pending' | legacy
  ah: number;          // attributed actual hours (0 for a placeholder)
  jobCount: number;
  hasWork: boolean;    // logHasRealWork — the finalize gate only counts these
}
export interface MonthSettlement {
  settled: boolean;              // no REAL-work crew-day is unsettled
  dayCount: number;
  crewDayCount: number;
  blocking: UnsettledCrewDay[];      // unsettled AND has real work — GATES the month
  emptyPending: UnsettledCrewDay[];  // unsettled placeholders (no work) — do NOT gate
}

// Settlement status for a month. Split into what actually gates finalization
// (unsettled crew-days WITH real work) and content-less placeholders (a
// scheduled crew that never worked). Placeholders no longer block a push — an
// empty crew that carries no BH/AH/timesheets has no pay data to lock — but they
// are still returned so the UI can surface and bulk-clean them.
export function monthSettlementStatus(performance: PerfMap, ym: string): MonthSettlement {
  const dates = datesInMonth(performance, ym);
  const blocking: UnsettledCrewDay[] = [];
  const emptyPending: UnsettledCrewDay[] = [];
  let crewDayCount = 0;
  for (const date of dates) {
    const dayMap = performance[date] || {};
    for (const [crewId, log] of Object.entries(dayMap)) {
      crewDayCount++;
      if (isCrewDaySettled(log)) continue;
      const entry: UnsettledCrewDay = {
        date, crewId,
        division: log.division ?? 'Unassigned',
        crewNumber: log.crewNumber ?? 0,
        crewLabel: `${log.division ?? '?'} #${log.crewNumber ?? '?'}`,
        status: log.approvalStatus || 'pending',
        ah: logActualHours(log),
        jobCount: log.jobs?.length ?? 0,
        hasWork: logHasRealWork(log),
      };
      (entry.hasWork ? blocking : emptyPending).push(entry);
    }
  }
  return { settled: blocking.length === 0, dayCount: dates.length, crewDayCount, blocking, emptyPending };
}

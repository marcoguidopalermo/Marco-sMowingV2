// RoleMaster pure logic — recurrence math + instance helpers. Shared by the
// UI, the dry-run, and mirrored EXACTLY by functions/src/jobber/roleMaster.ts
// (the functions codebase can't import from src/). No Firestore, no I/O.
import {
  RoleRecurrence, RoleMasterDuty, RoleMasterRole, RoleTaskInstance,
} from '../types';

// 31 days so the NEXT occurrence of every monthly duty is always captured
// (longest fixed-day month gap is 31 days). The window is (today, today+31]
// — today itself is excluded: its occurrences were materialized on a prior
// run 31 days earlier, so re-including today would only ever create an
// already-due-today task with no lead time.
export const ROLE_GEN_HORIZON_DAYS = 31;
export const ROLE_MISSED_AFTER_DAYS = 14;

const MS_DAY = 86_400_000;

// 'YYYY-MM-DD' → epoch ms at NOON UTC (tz-safe day math).
export function dateToMs(d: string): number {
  return Date.parse(`${d}T12:00:00Z`);
}
// epoch ms → 'YYYY-MM-DD' (UTC).
export function msToDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
export function addDaysStr(d: string, n: number): string {
  return msToDate(dateToMs(d) + n * MS_DAY);
}
export function dowOf(d: string): number {
  return new Date(`${d}T12:00:00Z`).getUTCDay();
}
// Whole days from `d` to `today` (positive = d is in the past).
export function daysAgo(d: string, today: string): number {
  return Math.floor((dateToMs(today) - dateToMs(d)) / MS_DAY);
}
// Last calendar day of the month containing `d`.
export function lastDayOfMonth(year: number, monthIdx0: number): number {
  return new Date(Date.UTC(year, monthIdx0 + 1, 0)).getUTCDate();
}

export function instanceId(dutyId: string, date: string): string {
  return `${dutyId}-${date}`;
}

// Occurrence dates for a recurrence within [fromDate, toDate] inclusive.
// weekly: every `dayOfWeek`. biweekly: every 14 days from `anchorDate` (only
// forward + backward multiples that land in range). monthly: `dayOfMonth`
// (clamped to the month's length) or the last calendar day.
export function computeOccurrences(
  rec: RoleRecurrence,
  fromDate: string,
  toDate: string,
): string[] {
  const out: string[] = [];
  const fromMs = dateToMs(fromDate);
  const toMs = dateToMs(toDate);
  if (!(fromMs <= toMs)) return out;

  if (rec.kind === 'weekly' || rec.kind === 'biweekly') {
    if (rec.kind === 'weekly') {
      const target = rec.dayOfWeek ?? 1;
      for (let ms = fromMs; ms <= toMs; ms += MS_DAY) {
        const d = msToDate(ms);
        if (dowOf(d) === target) out.push(d);
      }
    } else {
      // biweekly: anchor + 14k. Walk k forward from an anchor aligned at or
      // before fromDate.
      const anchor = rec.anchorDate || fromDate;
      const anchorMs = dateToMs(anchor);
      // first occurrence >= fromMs on the 14-day lattice
      const period = 14 * MS_DAY;
      let k = Math.ceil((fromMs - anchorMs) / period);
      let ms = anchorMs + k * period;
      // guard against fp drift
      while (ms < fromMs) ms += period;
      for (; ms <= toMs; ms += period) out.push(msToDate(ms));
    }
  } else if (rec.kind === 'monthly') {
    // Iterate each month touched by the window.
    let cur = new Date(`${fromDate.slice(0, 7)}-01T12:00:00Z`);
    const end = new Date(`${toDate.slice(0, 7)}-01T12:00:00Z`);
    while (cur.getTime() <= end.getTime()) {
      const y = cur.getUTCFullYear();
      const m = cur.getUTCMonth();
      const last = lastDayOfMonth(y, m);
      const day = rec.dayOfMonth === 'last'
        ? last
        : Math.min(Number(rec.dayOfMonth ?? 1) || 1, last);
      const d = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dMs = dateToMs(d);
      if (dMs >= fromMs && dMs <= toMs) out.push(d);
      cur = new Date(Date.UTC(y, m + 1, 1, 12));
    }
  } else if (rec.kind === 'yearly') {
    // One occurrence per year at month/day (clamped to the month length).
    const mo = Math.min(12, Math.max(1, Number(rec.month ?? 1) || 1));
    const fromY = Number(fromDate.slice(0, 4));
    const toY = Number(toDate.slice(0, 4));
    for (let y = fromY; y <= toY; y++) {
      const last = lastDayOfMonth(y, mo - 1);
      const day = Math.min(Number(rec.day ?? 1) || 1, last);
      const d = `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dMs = dateToMs(d);
      if (dMs >= fromMs && dMs <= toMs) out.push(d);
    }
  }
  return out.sort();
}

// MM-DD band membership, year-wrap aware. Normal band (from <= to):
// from <= md <= to. Wrapping band (from > to, e.g. 11-01..03-31):
// md >= from OR md <= to.
export function inSeasonWindow(date: string, sw?: { fromMonthDay: string; toMonthDay: string }): boolean {
  if (!sw || !sw.fromMonthDay || !sw.toMonthDay) return true;
  const md = date.slice(5); // 'MM-DD'
  const from = sw.fromMonthDay;
  const to = sw.toMonthDay;
  if (from <= to) return md >= from && md <= to;
  return md >= from || md <= to;   // wrap
}

// [activeFrom, activeUntil] inclusive; either bound optional.
export function inActiveWindow(date: string, from?: string, until?: string): boolean {
  if (from && date < from) return false;
  if (until && date > until) return false;
  return true;
}

// All gates a date must pass to be generatable for a duty.
export function dateGenerable(date: string, duty: RoleMasterDuty): boolean {
  return inActiveWindow(date, duty.activeFrom, duty.activeUntil) &&
    inSeasonWindow(date, duty.seasonWindow);
}

export interface GeneratedInstanceSeed {
  id: string;
  dutyId: string;
  roleId: string;
  occurrenceDate: string;
  dueDate: number;
  title: string;
  category: string;
  dueSoonDays: number;
}

// The instances a single active duty on an assigned role WOULD generate over
// the horizon, minus what already exists. Pure — the engine/dry-run wraps I/O.
export function plannedInstancesForDuty(
  duty: RoleMasterDuty,
  role: RoleMasterRole,
  today: string,
  existingIds: Set<string>,
  horizonDays = ROLE_GEN_HORIZON_DAYS,
): GeneratedInstanceSeed[] {
  if (!duty.active || !role.active || !role.assignedEmployeeId) return [];
  // Window is (today, today+horizon] — exclude today (see horizon note).
  const from = addDaysStr(today, 1);
  const to = addDaysStr(today, horizonDays);
  const occ = computeOccurrences(duty.recurrence, from, to);
  const seeds: GeneratedInstanceSeed[] = [];
  for (const date of occ) {
    // Duration + seasonal gates (both must hold when set).
    if (!dateGenerable(date, duty)) continue;
    const id = instanceId(duty.id, date);
    if (existingIds.has(id)) continue;
    // Due end-of-day of the occurrence (noon-UTC anchor + 12h ≈ EOD-ish;
    // the UI's day-diff only cares about the calendar day).
    seeds.push({
      id, dutyId: duty.id, roleId: role.id, occurrenceDate: date,
      dueDate: dateToMs(date), title: duty.name, category: duty.category,
      dueSoonDays: duty.dueSoonDays ?? 2,
    });
  }
  return seeds;
}

// Urgency state for a live open instance (or any dated task).
export type Urgency = 'upcoming' | 'due_soon' | 'due_today' | 'overdue';
export function urgencyFor(dueMs: number, dueSoonDays: number, today: string): Urgency {
  const dueDay = msToDate(dueMs);
  const diff = -daysAgo(dueDay, today); // days until due (negative = overdue)
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'due_today';
  if (diff <= (dueSoonDays ?? 2)) return 'due_soon';
  return 'upcoming';
}

// Whether an open instance has aged into a permanent 'missed'.
export function isMissed(inst: RoleTaskInstance, today: string): boolean {
  if (inst.status !== 'open') return false;
  return daysAgo(inst.occurrenceDate, today) > ROLE_MISSED_AFTER_DAYS;
}

export function isTerminal(status: RoleInstanceStatusLike): boolean {
  return status === 'done' || status === 'done_late' ||
    status === 'skipped' || status === 'missed' || status === 'voided';
}
type RoleInstanceStatusLike = RoleTaskInstance['status'];

// ── Chart / display helpers ─────────────────────────────────────────────
const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthDayLabel = (md: string): string => {
  const [m, d] = md.split('-').map(Number);
  return `${MONTH_NAMES[(m || 1) - 1]} ${d || 1}`;
};

// Full human-readable recurrence incl. season/duration, e.g.
// "Weekly · Fri", "Yearly · Mar 15", "Weekly · Mon · May 1–Oct 30".
export function describeRecurrence(duty: RoleMasterDuty): string {
  const r = duty.recurrence;
  let base: string;
  if (r.kind === 'weekly') base = `Weekly · ${DOW_NAMES[r.dayOfWeek ?? 1]}`;
  else if (r.kind === 'biweekly') base = `Biweekly${r.anchorDate ? ` · from ${r.anchorDate}` : ''}`;
  else if (r.kind === 'monthly') base = `Monthly · ${r.dayOfMonth === 'last' ? 'last day' : `day ${r.dayOfMonth ?? 1}`}`;
  else base = `Yearly · ${MONTH_NAMES[(Number(r.month ?? 1) || 1) - 1]} ${r.day ?? 1}`;
  if (duty.seasonWindow?.fromMonthDay && duty.seasonWindow?.toMonthDay) {
    base += ` · ${monthDayLabel(duty.seasonWindow.fromMonthDay)}–${monthDayLabel(duty.seasonWindow.toMonthDay)}`;
  }
  return base;
}

export function isEnded(duty: RoleMasterDuty, today: string): boolean {
  return !!duty.activeUntil && today > duty.activeUntil;
}
export function inSeasonNow(duty: RoleMasterDuty, today: string): boolean {
  return inSeasonWindow(today, duty.seasonWindow);
}
// Next date (>= today) the duty re-enters its season band; null if none/always.
export function seasonResumeDate(duty: RoleMasterDuty, today: string): string | null {
  if (!duty.seasonWindow?.fromMonthDay) return null;
  for (let i = 0; i <= 366; i++) {
    const d = addDaysStr(today, i);
    if (inSeasonWindow(d, duty.seasonWindow)) return d;
  }
  return null;
}

// The next scheduled occurrence (>= today) that would actually generate —
// respecting recurrence, season, and duration bounds. null if none within
// ~2 years (e.g. ended). For chart "Next due" even before generation.
export function nextOccurrence(duty: RoleMasterDuty, today: string): string | null {
  const to = addDaysStr(today, 740);
  for (const date of computeOccurrences(duty.recurrence, today, to)) {
    if (dateGenerable(date, duty)) return date;
  }
  return null;
}

export interface DutyChartStatus {
  kind: 'overdue' | 'due_soon' | 'caught_up' | 'neutral';
  count: number;          // outstanding overdue count (for 🔴 N)
  note?: string;          // 'Inactive' | 'Ended' | 'Dormant' etc.
}
// Status derived from a duty's OPEN instances (+ inactive/ended/dormant gates).
export function dutyChartStatus(
  duty: RoleMasterDuty,
  openInstances: RoleTaskInstance[],
  today: string,
): DutyChartStatus {
  if (!duty.active) return { kind: 'neutral', count: 0, note: 'Inactive' };
  if (isEnded(duty, today)) return { kind: 'neutral', count: 0, note: 'Ended' };
  if (!inSeasonNow(duty, today)) return { kind: 'neutral', count: 0, note: 'Dormant' };
  let overdue = 0; let dueSoon = 0;
  for (const i of openInstances) {
    const u = urgencyFor(i.dueDate, i.dueSoonDays ?? duty.dueSoonDays ?? 2, today);
    if (u === 'overdue') overdue++;
    else if (u === 'due_soon' || u === 'due_today') dueSoon++;
  }
  if (overdue > 0) return { kind: 'overdue', count: overdue };
  if (dueSoon > 0) return { kind: 'due_soon', count: dueSoon };
  return { kind: 'caught_up', count: 0 };
}

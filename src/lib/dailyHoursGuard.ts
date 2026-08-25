// IMPOSSIBLE-HOURS GUARD — the signal that a punch was entered twice.
//
// Tyberious could not clock in, so Dave entered a punch and Liam entered a
// punch. Both landed, 9.50h and 9.45h for the same shift, and nothing said
// anything until payroll. A single employee over ~12 hours in one day is
// almost always that: two people fixing the same problem.
//
// WARN, NEVER BLOCK. Long days are real — a storm cleanup, a late install —
// and refusing them would push somebody into splitting a punch across two
// days, which is worse than an honest 14-hour entry. The point is that it
// cannot happen ACCIDENTALLY, not that it cannot happen.
import { TimeEntry } from '../types';

/** Seeded at 12. Admin-editable via settings.dailyHoursWarnThreshold. */
export const DAILY_HOURS_WARN_DEFAULT = 12;

export const dailyHoursThreshold = (
  settings?: { dailyHoursWarnThreshold?: number } | null,
): number => {
  const v = Number(settings?.dailyHoursWarnThreshold);
  return Number.isFinite(v) && v > 0 ? v : DAILY_HOURS_WARN_DEFAULT;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Hours a single punch contributes. An open punch counts as zero — it has no span yet. */
export function punchHours(e: Pick<TimeEntry, 'clockIn' | 'clockOut'>): number {
  if (!e?.clockIn || !e.clockOut) return 0;
  const a = Date.parse(e.clockIn); const b = Date.parse(e.clockOut);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return (b - a) / 3_600_000;
}

/**
 * Every closed punch that employee has on that calendar day, by CLOCK-IN date
 * — the same anchor the sync and the pay chunks use, so a shift that runs past
 * midnight belongs to the day it started.
 */
export function entriesForEmployeeDate(
  entries: TimeEntry[] | undefined, email: string, date: string,
): TimeEntry[] {
  const want = (email || '').trim().toLowerCase();
  if (!want || !date) return [];
  return (entries || []).filter(e =>
    (e.userEmail || '').trim().toLowerCase() === want
    && (e.clockIn || '').slice(0, 10) === date);
}

export function hoursForEmployeeDate(
  entries: TimeEntry[] | undefined, email: string, date: string,
): number {
  return round2(entriesForEmployeeDate(entries, email, date)
    .reduce((s, e) => s + punchHours(e), 0));
}

export interface DailyHoursWarning {
  over: boolean;
  existingHours: number;
  addedHours: number;
  totalHours: number;
  threshold: number;
  /** Ready to show verbatim — names the person, what is already there, and the total. */
  message: string;
}

/**
 * The warning shown at the POINT OF ENTRY, before a second punch is saved.
 * "Tyberious already has 8.2 hours logged today — adding this makes 16.4."
 *
 * `excludeId` lets an EDIT of an existing punch measure itself correctly
 * rather than counting its own old duration twice.
 */
export function checkDailyHours(input: {
  entries: TimeEntry[] | undefined;
  email: string;
  name?: string;
  date: string;
  addedHours: number;
  threshold: number;
  excludeId?: string;
}): DailyHoursWarning {
  const existing = round2(entriesForEmployeeDate(input.entries, input.email, input.date)
    .filter(e => e.id !== input.excludeId)
    .reduce((s, e) => s + punchHours(e), 0));
  const added = round2(Math.max(0, input.addedHours));
  const total = round2(existing + added);
  const who = input.name || input.email || 'This employee';
  return {
    over: total > input.threshold,
    existingHours: existing,
    addedHours: added,
    totalHours: total,
    threshold: input.threshold,
    message: existing > 0
      ? `${who} already has ${existing} hour${existing === 1 ? '' : 's'} logged on `
        + `${input.date} — adding this makes ${total}. Over ${input.threshold} hours in a `
        + 'day is usually a punch entered twice.'
      : `${total} hours on ${input.date} is over the ${input.threshold}-hour mark for `
        + `${who}. Check this is a real long day and not a duplicate.`,
  };
}

// ── REVIEW FLAG ────────────────────────────────────────────────────────────
export interface OverHoursDay {
  email: string;
  name: string;
  date: string;
  hours: number;
  entryCount: number;
  /** Two or more punches is the duplicate shape; one long punch is a different problem. */
  looksDuplicated: boolean;
}

/**
 * Every employee-day over the threshold, newest first. Used by the TimeMaster
 * review flag and the payroll lens, so anything that slipped past the
 * entry-time warning is visible BEFORE pay runs rather than after.
 */
export function overHoursDays(
  entries: TimeEntry[] | undefined, threshold: number, opts?: { from?: string; to?: string },
): OverHoursDay[] {
  const byKey = new Map<string, { name: string; hours: number; n: number }>();
  for (const e of entries || []) {
    const date = (e.clockIn || '').slice(0, 10);
    if (!date) continue;
    if (opts?.from && date < opts.from) continue;
    if (opts?.to && date > opts.to) continue;
    const email = (e.userEmail || '').trim().toLowerCase();
    if (!email) continue;
    const k = `${email}|${date}`;
    const cur = byKey.get(k) || { name: e.userName || email, hours: 0, n: 0 };
    cur.hours += punchHours(e);
    cur.n += 1;
    if (e.userName) cur.name = e.userName;
    byKey.set(k, cur);
  }
  const out: OverHoursDay[] = [];
  for (const [k, v] of byKey) {
    if (round2(v.hours) <= threshold) continue;
    const [email, date] = k.split('|');
    out.push({
      email, date, name: v.name, hours: round2(v.hours), entryCount: v.n,
      looksDuplicated: v.n > 1,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Is this specific entry part of an over-threshold day? Drives the row badge. */
export function entryIsOverHours(
  entry: TimeEntry, entries: TimeEntry[] | undefined, threshold: number,
): boolean {
  const date = (entry.clockIn || '').slice(0, 10);
  if (!date) return false;
  return hoursForEmployeeDate(entries, entry.userEmail, date) > threshold;
}

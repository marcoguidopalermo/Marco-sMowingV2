// PER-PERSON HOURS FOR A SELECTED RANGE (TimeMaster → All Users).
//
// The arithmetic is computeHoursWorkedBetween — the pay-chunk function — and
// nothing here re-derives a duration. What this module decides is only WHICH
// punches are in the range and how a running punch is reported.
//
// WHICH PUNCHES. The caller's `inRange` predicate, i.e. the same clock-in rule
// the punch list and the Payroll column use: a punch is in the range if it
// STARTED in it, and it counts in full. computeHoursWorkedBetween is therefore
// called with an unbounded window. Given the range bounds instead, it would
// clip an overnight shift at the edge — a 10pm-6am plow shift on the last
// night of a period would total 2h here while the list beside it shows 8h.
//
// RUNNING PUNCHES are NOT in the total. A running punch grows every minute, so
// a total that includes it looks final and is not. It is reported beside the
// total instead: how many are running and how long they have run so far.
import type { TimeEntry } from '../types';
import { computeHoursWorkedBetween } from './payChunkUtils';

export interface RangeTotalRow {
  email: string;
  name: string;
  /** Closed punches in the range — the figure that is final. */
  hours: number;
  closedCount: number;
  /** Punches in the range still running (no clock-out). Not in `hours`. */
  runningCount: number;
  /** How long those have run up to now. Not in `hours`. */
  runningHoursSoFar: number;
}

export interface RangeTotals {
  rows: RangeTotalRow[];
  total: { hours: number; runningCount: number; runningHoursSoFar: number; people: number };
}

const ALL_TIME = [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY] as const;

export function rangeTotalsByPerson(
  people: { email: string; name: string }[],
  entries: TimeEntry[],
  inRange: (e: TimeEntry) => boolean,
): RangeTotals {
  const rows: RangeTotalRow[] = [];
  const counted = new Set<string>();   // the grand total counts each login once
  const total = { hours: 0, runningCount: 0, runningHoursSoFar: 0, people: 0 };
  for (const p of people) {
    const key = (p.email || '').toLowerCase();
    const mine = entries.filter(e => (e.userEmail || '').toLowerCase() === key && inRange(e));
    const closed = mine.filter(e => !!e.clockOut);
    const running = mine.filter(e => !e.clockOut);
    const row: RangeTotalRow = {
      email: p.email,
      name: p.name,
      hours: computeHoursWorkedBetween(key, ALL_TIME[0], ALL_TIME[1], closed),
      closedCount: closed.length,
      runningCount: running.length,
      runningHoursSoFar: computeHoursWorkedBetween(key, ALL_TIME[0], ALL_TIME[1], running),
    };
    rows.push(row);
    if (key && !counted.has(key)) {
      counted.add(key);
      total.hours += row.hours;
      total.runningCount += row.runningCount;
      total.runningHoursSoFar += row.runningHoursSoFar;
      if (row.closedCount + row.runningCount > 0) total.people++;
    }
  }
  return { rows, total };
}

/** "36.62 h" — two decimals, the precision payroll is entered at. */
export const formatRangeHours = (h: number): string => `${(Math.round(h * 100) / 100).toFixed(2)} h`;

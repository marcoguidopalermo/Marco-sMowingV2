import { PerformanceLog, ManagedDivision } from '../types';
import { logHasRealWork } from './performanceMonths';

// Cross-date oversight for crew-days that are neither approved nor
// waived — i.e. still "outstanding." Read-derived from the in-memory
// performance map; no new storage. Today is excluded (project crews
// don't close out until end of day, so today is never "overdue").

export interface OutstandingCrewDay {
  date: string;
  crewId: string;
  // PerformanceLog.division (e.g. "Lawn Division"). Logs with no
  // division are surfaced as "Unassigned" — they must not masquerade
  // under a real division's filter.
  division: string;
  crewNumber: number;
  crewLabel: string;  // "Lawn Division #3"
  // Mirrors PerformanceLog.isAdHoc — keys the 'adhoc' division filter
  // the same way the crew-card list does.
  isAdHoc: boolean;
}

// A crew-day counts as outstanding when its approvalStatus is neither
// 'approved' nor 'waived' (covers 'pending' and legacy undefined).
function isOutstanding(log: Pick<PerformanceLog, 'approvalStatus'>): boolean {
  const s = log?.approvalStatus;
  return s !== 'approved' && s !== 'waived';
}

// "Real work" is defined once in performanceMonths.logHasRealWork and shared by
// BOTH the month-finalize gate and this outstanding-days scan, so a placeholder
// day can never be counted by one rule and hidden by the other (the bug that let
// empty crew-days block a month while staying invisible in the banner).
const hasRealWork = logHasRealWork;

// Outstanding-tracking start date. The approval workflow launched
// 2026-07-01, so every June-and-earlier crew-day would read as
// "outstanding" forever. Days before this floor are suppressed from
// the outstanding scan — DISPLAY ONLY. Their approvalStatus is never
// touched (no mass-approve/waive), and they stay excluded from
// bonus/MTD exactly as before (isBonusEligible requires 'approved').
export const OUTSTANDING_TRACKING_START = '2026-07-01';

// Scan the whole performance map for outstanding crew-days strictly
// before `today` (and on/after OUTSTANDING_TRACKING_START), optionally
// only within the last `withinDays` days. Sorted newest-date first.
export function scanOutstandingCrewDays(
  performance: Record<string, Record<string, PerformanceLog>>,
  today: string,
  withinDays?: number,
): OutstandingCrewDay[] {
  const out: OutstandingCrewDay[] = [];
  let earliest: string | null = null;
  if (withinDays != null) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - withinDays);
    earliest = d.toISOString().slice(0, 10);
  }
  for (const [date, dayLogs] of Object.entries(performance || {})) {
    if (date >= today) continue;              // exclude today + future
    if (date < OUTSTANDING_TRACKING_START) continue; // pre-launch backlog suppressed (view only)
    if (earliest && date < earliest) continue; // window floor
    for (const [crewId, log] of Object.entries(dayLogs || {})) {
      if (!log || !isOutstanding(log)) continue;
      // No-work placeholder → not outstanding (nothing to approve/waive).
      // A day with real work that's merely unapproved still flags.
      if (!hasRealWork(log)) continue;
      const division = log.division || 'Unassigned';
      const crewNumber = log.crewNumber ?? 0;
      out.push({
        date,
        crewId,
        division,
        crewNumber,
        crewLabel: `${division} #${crewNumber}`,
        isAdHoc: !!log.isAdHoc,
      });
    }
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

export interface DivisionOutstanding {
  division: string;
  count: number;
  dates: string[]; // distinct dates, newest-first
}

// Roll a flat outstanding list up by division for the admin oversight
// summary ("Small Projects: 4 outstanding across 3 days").
export function groupOutstandingByDivision(
  list: OutstandingCrewDay[],
): DivisionOutstanding[] {
  const byDiv = new Map<string, { count: number; dates: Set<string> }>();
  for (const o of list) {
    const e = byDiv.get(o.division) || { count: 0, dates: new Set<string>() };
    e.count += 1;
    e.dates.add(o.date);
    byDiv.set(o.division, e);
  }
  return [...byDiv.entries()]
    .map(([division, e]) => ({
      division,
      count: e.count,
      dates: [...e.dates].sort((a, b) => (a < b ? 1 : -1)),
    }))
    .sort((a, b) => b.count - a.count);
}

// Map the crew-day division name (e.g. "Lawn Division") to the
// ManagedDivision code stored on an Employee (lawn/small/large).
// Mirrors the mapping used elsewhere (App.tsx defaultDivisionFilter).
export function divisionNameToCode(division: string): ManagedDivision | null {
  const d = (division || '').toLowerCase();
  if (d.includes('lawn')) return 'lawn';
  if (d.includes('small')) return 'small';
  if (d.includes('large')) return 'large';
  return null;
}

// True when a manager's managedDivision covers the given crew-day
// division. 'all' covers everything; an unset managedDivision covers
// nothing (they're not a division manager).
export function managerCoversDivision(
  managedDivision: ManagedDivision | undefined | null,
  division: string,
): boolean {
  if (!managedDivision) return false;
  if (managedDivision === 'all') return true;
  return divisionNameToCode(division) === managedDivision;
}

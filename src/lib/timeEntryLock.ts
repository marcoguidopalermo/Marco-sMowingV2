// WHEN A PUNCH IS READ-ONLY.
//
// TimeMaster punches and PerformanceMaster crew-days are separate stores. A
// punch is what payroll pays from; a crew-day's employeeAH is what efficiency
// and bonus are computed from. The Jobber sync is the only thing that carries
// one into the other — and it SKIPS approved and waived crew-days by design,
// because those are locked pay data.
//
// So a punch corrected after its crew-day was approved changes what payroll
// pays and never reaches employeeAH. The two numbers then disagree for the
// same work, silently and permanently: nothing re-reads the punch, and nothing
// flags the gap. That has already happened — a punch edited two days after its
// crew-day was signed off left a 0.1h gap nobody could see.
//
// The rule here is the same one the rest of the app uses for locked data:
// pushed months and archived days are read-only outright, and an approved or
// waived crew-day must be unapproved before its inputs can change. Unapproving
// is what lets the sync run again and carry the correction through, so the
// loop closes properly instead of leaving the two stores to drift.
import { AppData, Employee, PerformanceLog } from '../types';
import { formatYmdInToronto } from './dateUtils';

export type TimeEntryLockReason =
  | 'month-pushed'
  | 'day-archived'
  | 'crew-day-approved'
  | 'crew-day-waived';

export interface TimeEntryLock {
  locked: boolean;
  reason?: TimeEntryLockReason;
  /** Ready to show verbatim — says what to do, not just that it failed. */
  message?: string;
  /** The crew-day standing in the way, when there is one. */
  crewLabel?: string;
  date?: string;
}

const UNLOCKED: TimeEntryLock = { locked: false };

/** The Toronto calendar day a punch belongs to — the same anchor the sync uses. */
export function punchDate(clockIn: string): string {
  const d = new Date(clockIn);
  return Number.isNaN(d.getTime()) ? '' : formatYmdInToronto(d);
}

export function timeEntryLock(input: {
  /** The punch being edited, deleted, or added. */
  clockIn: string;
  /** Whose punch it is. */
  userEmail: string;
  employees: Employee[] | undefined;
  performance: AppData['performance'] | undefined;
  pushedMonths: string[] | undefined;
  archivedDays: Record<string, unknown> | undefined;
}): TimeEntryLock {
  const date = punchDate(input.clockIn);
  if (!date) return UNLOCKED;                 // unparseable — let validation handle it

  if ((input.pushedMonths || []).includes(date.slice(0, 7))) {
    return {
      locked: true, reason: 'month-pushed', date,
      message: `${date} is in a month that has been pushed to its sheet, so it is `
        + 'read-only. Time for a closed month cannot be changed here. An admin can '
        + 'still remove a duplicate punch with a stated reason, but the crew-day\'s '
        + 'hours can no longer be corrected to match — so the two would disagree.',
    };
  }
  if ((input.archivedDays || {})[date]) {
    return {
      locked: true, reason: 'day-archived', date,
      message: `${date} has been archived to a sheet, so it is read-only. An admin `
        + 'can still remove a duplicate punch with a stated reason — the crew-day\'s '
        + 'hours are corrected on the sheet along with it.',
    };
  }

  // Which crew-day, if any, is carrying this person's hours that day. Matching
  // is by employee id resolved from the punch's login email, exactly how the
  // sync attributes call-in hours.
  const email = (input.userEmail || '').trim().toLowerCase();
  if (!email) return UNLOCKED;
  const emp = (input.employees || []).find(e =>
    (e.linkedUserEmail || e.email || '').trim().toLowerCase() === email);
  if (!emp) return UNLOCKED;                  // nobody's crew hours depend on it

  const dayLogs = (input.performance || {})[date] || {};
  for (const log of Object.values(dayLogs) as PerformanceLog[]) {
    if (!log) continue;
    // Only a crew-day that actually carries this person is in the way. A crew
    // they were not on has no claim on their hours.
    if (!(emp.id in (log.employeeAH || {}))) continue;
    const status = log.approvalStatus;
    if (status !== 'approved' && status !== 'waived') continue;
    const crewLabel = `${log.division ?? '?'} #${log.crewNumber ?? '?'}`;
    return {
      locked: true,
      reason: status === 'approved' ? 'crew-day-approved' : 'crew-day-waived',
      crewLabel, date,
      message: `${emp.name}'s hours for ${date} are locked by ${crewLabel}, which is `
        + `${status}. Changing the punch now would move payroll without moving the `
        + `crew-day's hours, so the two would disagree. Unapprove ${crewLabel} on `
        + 'that date first, then edit — the next sync carries the correction through.',
    };
  }
  return UNLOCKED;
}

// ── WHERE A CREW-DAY CORRECTION HAS TO BE WRITTEN ──────────────────────────
// Deleting a duplicate punch on a settled day must also correct that crew-day's
// employeeAH, or payroll drops while the crew-day keeps the hours — the exact
// divergence that had TimeMaster and PerformanceMaster disagreeing about the
// same work.
//
// The catch is that the corrected day does not always belong in the same place.
// syncToCloud STRIPS every rolling-archived date from the doc write, so writing
// an archived day into appData reports success and persists nothing. It has to
// go to the month sheet instead. A pushed month cannot be corrected at all.
export type CorrectionTarget = 'doc' | 'month-sheet' | 'unavailable';

export function crewDayCorrectionTarget(input: {
  date: string;
  pushedMonths?: string[] | null;
  archivedDays?: Record<string, unknown> | null;
}): CorrectionTarget {
  const date = input.date || '';
  if (!date) return 'unavailable';
  if ((input.pushedMonths || []).includes(date.slice(0, 7))) return 'unavailable';
  if ((input.archivedDays || {})[date]) return 'month-sheet';
  return 'doc';
}

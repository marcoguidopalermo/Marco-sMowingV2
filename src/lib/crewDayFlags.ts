// CREW-DAY FLAGS — the rules around raising and resolving a flag.
//
// James audits yesterday's crew-days daily. Whether a worker was actually on a
// crew is only verifiable while it is fresh; a week later there is nothing left
// to check against. A flag is how he asks a question about a specific crew-day
// and gets an answer back.
//
// The consequence that gives the audit teeth: an open flag UNAPPROVES the
// crew-day, so it stops counting toward efficiency, bonus and month totals
// until a manager signs it off. Everything here therefore moves approval STATE
// and nothing else — no BH, AH, deduction or pay number is read or written by
// any function in this file.
import {
  CrewDayFlag, ManagedDivision, PerformanceLog, UserRole,
} from '../types';
import { managerCoversDivision } from './approvalOversight';
import { can } from './permissions';

// ── WHO ────────────────────────────────────────────────────────────────────
// Raising a flag is an AUDIT act: it unapproves somebody else's crew-day, so
// it is held to admin. James Serediukk audits daily and holds systemRole
// 'admin', so "admin and James" is exactly this set — there is no second
// carve-out to keep in step, and if that ever stops being true this is the one
// place to widen.
export function canFlagCrewDay(role: UserRole | null | undefined): boolean {
  return role === 'admin';
}

// Resolving is a MANAGER act, and specifically the manager whose division owns
// the crew-day — they are the one who knows whether the hours are right.
// Admins can resolve anything, because somebody has to be able to close a flag
// for a division whose manager is away.
//
// The role test is canApprovePerformance, not a role name, and deliberately:
// resolving a flag RE-APPROVES the crew-day, so anyone who may resolve must
// already be someone who may approve. Tying it to the existing permission means
// approval authority is defined in exactly one place. (Checking division
// coverage alone was not enough — managedDivision is just a field, and a worker
// carrying one would have passed.)
export function canResolveFlag(
  role: UserRole | null | undefined,
  managedDivision: ManagedDivision | null | undefined,
  division: string,
): boolean {
  if (!can('canApprovePerformance', role)) return false;
  if (role === 'admin') return true;
  return managerCoversDivision(managedDivision, division);
}

// ── WHEN ───────────────────────────────────────────────────────────────────
// A flag only means something while the day can still change. Once a month is
// pushed to its sheet (or a day is rolling-archived) the crew-day is read-only
// and its numbers have already been counted — unapproving it there would move
// nothing, so the UI says so instead of pretending.
export type FlagBlockedReason =
  | 'month-pushed'      // the whole month went to a performanceMonths sheet
  | 'day-archived'      // this day was rolling-archived to a sheet
  | 'future-date';      // nothing to audit yet

export interface FlagEligibility {
  allowed: boolean;
  reason?: FlagBlockedReason;
  /** Ready to show verbatim. Neutral: this is a limitation, not a refusal. */
  message?: string;
}

export function crewDayFlaggable(input: {
  date: string;
  today: string;
  pushedMonths: string[] | undefined;
  archivedDays: Record<string, unknown> | undefined;
}): FlagEligibility {
  if (input.date > input.today) {
    return {
      allowed: false, reason: 'future-date',
      message: 'That day has not happened yet.',
    };
  }
  if ((input.pushedMonths || []).includes(input.date.slice(0, 7))) {
    return {
      allowed: false, reason: 'month-pushed',
      message: 'This month has been pushed to its sheet, so the day is archived '
        + 'and read-only. Flagging it could not change what it counts toward.',
    };
  }
  if ((input.archivedDays || {})[input.date]) {
    return {
      allowed: false, reason: 'day-archived',
      message: 'This day has been archived to a sheet, so it is read-only. '
        + 'Flagging it could not change what it counts toward.',
    };
  }
  return { allowed: true };
}

// ── VALIDATION ─────────────────────────────────────────────────────────────
// Both notes are required, and for the same reason: a flag with no reason is
// just an unapproval the manager can't act on, and a resolution with no note is
// a manager saying "dealt with it" and leaving no answer on the record. The
// point of the loop is that both ends say something.
export const MIN_NOTE_LENGTH = 3;

export const noteIsUsable = (v: string | null | undefined): boolean =>
  typeof v === 'string' && v.trim().length >= MIN_NOTE_LENGTH;

// ── STATE ──────────────────────────────────────────────────────────────────
export const isOpen = (f: CrewDayFlag): boolean => f.status === 'open';

/** The open flag on a crew-day, if any. At most one is raised at a time. */
export function openFlagFor(
  flags: CrewDayFlag[], date: string, crewId: string,
): CrewDayFlag | undefined {
  return flags.find(f => f.date === date && f.crewId === crewId && isOpen(f));
}

/** Every flag ever raised on a crew-day, newest first — the permanent record. */
export function flagHistoryFor(
  flags: CrewDayFlag[], date: string, crewId: string,
): CrewDayFlag[] {
  return flags
    .filter(f => f.date === date && f.crewId === crewId)
    .sort((a, b) => b.raisedAt - a.raisedAt);
}

/** Dates with at least one open flag — for the outstanding-days banner. */
export function datesWithOpenFlags(flags: CrewDayFlag[]): Set<string> {
  const out = new Set<string>();
  for (const f of flags) if (isOpen(f)) out.add(f.date);
  return out;
}

export function openFlagsByDivision(flags: CrewDayFlag[]): Map<string, CrewDayFlag[]> {
  const m = new Map<string, CrewDayFlag[]>();
  for (const f of flags) {
    if (!isOpen(f)) continue;
    const k = f.division || 'Unassigned';
    m.set(k, [...(m.get(k) || []), f]);
  }
  return m;
}

// ── APPROVAL TRANSITIONS ───────────────────────────────────────────────────
// The only two places approval state moves because of a flag. Both return a
// NEW log; neither reads or writes a single number on it.

/**
 * Raising a flag unapproves the crew-day. The approval metadata is cleared the
 * same way onUnapprove clears it, so a flagged day is indistinguishable from
 * any other pending day to every downstream reader (bonus, MTD, month totals).
 * That is the point: no consumer needs to learn about flags to stop counting it.
 */
export function applyFlagToLog(log: PerformanceLog): PerformanceLog {
  return {
    ...log,
    approvalStatus: 'pending',
    approvedAt: undefined,
    approvedBy: undefined,
    approvedByName: undefined,
  };
}

/**
 * Resolving puts the day back and records who signed it off.
 *
 * A day that was WAIVED before the flag returns to waived, carrying its waiver
 * metadata untouched. Waived is excluded from bonus by construction, so
 * promoting it to approved would change what the day counts toward — a pay
 * consequence a flag must never have. Anything else becomes approved: the
 * manager signing off IS the approval, including for a day that was still
 * pending when it was flagged.
 */
export function applyResolutionToLog(
  log: PerformanceLog,
  flag: Pick<CrewDayFlag, 'previousApprovalStatus'>,
  resolver: { email: string; name: string },
  atISO: string,
): PerformanceLog {
  if (flag.previousApprovalStatus === 'waived') {
    return { ...log, approvalStatus: 'waived' };
  }
  return {
    ...log,
    approvalStatus: 'approved',
    approvedAt: atISO,
    approvedBy: resolver.email,
    approvedByName: resolver.name,
  };
}

// ── LANGUAGE ───────────────────────────────────────────────────────────────
// One place, so no screen invents "error" or "violation". A flag is a question.
export const FLAG_LABELS = {
  open: 'Needs attention',
  resolved: 'Resolved',
  action: 'Flag for review',
  flaggedBadge: 'Flagged for review',
  resolveAction: 'Sign off',
  reasonPrompt: 'What should the manager look at?',
  resolutionPrompt: 'What did you find? (a change, or why it is correct)',
} as const;

// CLOCKING SOMEBODY ELSE IN OR OUT.
//
// A phone is dead, or somebody forgot. The manager starts their clock now
// rather than reconstructing the punch from memory hours later — a real
// timestamp beats a remembered one.
//
// But this is one person creating PAY DATA for another, so the whole design is
// about never letting that be invisible or unattributed: who did it is stamped
// on the punch, a reason is required, and the marker renders on the employee's
// own timesheet as well as the manager's view. A punch you did not make should
// never be something you have to discover.
import { Employee, TimeEntry, UserRole } from '../types';
import { managedDivisionKey } from './availabilityView';

// ── WHO MAY CLOCK WHOM ─────────────────────────────────────────────────────

export type ClockDenyReason =
  | 'not-permitted'      // the role cannot do this at all
  | 'other-division'     // a manager reaching outside their own division
  | 'no-division';       // the target has no division to check against

export interface ClockPermission {
  allowed: boolean;
  reason?: ClockDenyReason;
  message?: string;
}

/**
 * Admin: anybody. Manager: their own division only.
 *
 * A manager's `managedDivision` is compared against the TARGET's division,
 * derived from primaryCrew the same way the availability view derives it, so
 * "their division" means the same thing on both screens.
 *
 * An all-division manager covers everyone, which is what 'all' has always
 * meant elsewhere in the app.
 */
export function canClockFor(
  actor: { role: UserRole | null | undefined; managedDivision?: string | null },
  target: Employee | null | undefined,
): ClockPermission {
  if (!target) return { allowed: false, reason: 'not-permitted', message: 'No employee record.' };
  if (actor.role === 'admin') return { allowed: true };
  if (actor.role !== 'manager') {
    return {
      allowed: false, reason: 'not-permitted',
      message: 'Only a manager or admin can clock somebody else in or out.',
    };
  }
  const mine = (actor.managedDivision || '').toLowerCase();
  if (!mine) {
    return {
      allowed: false, reason: 'not-permitted',
      message: 'You are not set up as a division manager.',
    };
  }
  if (mine === 'all') return { allowed: true };
  const theirs = managedDivisionKey(target);
  if (!theirs) {
    return {
      allowed: false, reason: 'no-division',
      message: `${target.name} has no division set, so they are outside your division's roster.`,
    };
  }
  if (theirs !== mine) {
    return {
      allowed: false, reason: 'other-division',
      message: `${target.name} is not in your division.`,
    };
  }
  return { allowed: true };
}

// ── WHAT STATE THE CLOCK IS IN ─────────────────────────────────────────────
// A punch with a clockIn and no clockOut is RUNNING. `isUnclosed` marks a
// punch the system gave up on (a shift left open past its day); that is not a
// running clock and must not be stopped as though it were — it is an edit.

export const isRunningPunch = (e: TimeEntry): boolean =>
  !!e.clockIn && !e.clockOut && !e.isUnclosed;

export function runningPunchFor(
  entries: TimeEntry[] | undefined, email: string,
): TimeEntry | undefined {
  const want = (email || '').trim().toLowerCase();
  if (!want) return undefined;
  return (entries || []).find(e =>
    (e.userEmail || '').trim().toLowerCase() === want && isRunningPunch(e));
}

export interface ClockActionGuard {
  ok: boolean;
  message?: string;
}

/** Refuse a second clock-in rather than creating a duplicate open punch. */
export function guardStart(
  entries: TimeEntry[] | undefined, target: Employee, email: string,
): ClockActionGuard {
  const running = runningPunchFor(entries, email);
  if (running) {
    return {
      ok: false,
      message: `${target.name} is already clocked in (since `
        + `${new Date(running.clockIn).toLocaleTimeString()}). Stop that punch instead.`,
    };
  }
  return { ok: true };
}

/** Refuse a stop with nothing running rather than leaving an orphan. */
export function guardStop(
  entries: TimeEntry[] | undefined, target: Employee, email: string,
): ClockActionGuard {
  if (!runningPunchFor(entries, email)) {
    return { ok: false, message: `${target.name} is not clocked in right now.` };
  }
  return { ok: true };
}

// ── THE REASON ─────────────────────────────────────────────────────────────
// Required, not optional, and for the same reason the edit flow requires one:
// somebody else's pay is being written. "phone dead", "forgot to punch".
export const MIN_REASON_LENGTH = 3;
export const reasonIsUsable = (v: string | null | undefined): boolean =>
  typeof v === 'string' && v.trim().length >= MIN_REASON_LENGTH;

// ── BUILDING THE PUNCH ─────────────────────────────────────────────────────

/** The note left on the entry, in the same shape the edit flow uses. */
export const onBehalfNote = (
  kind: 'in' | 'out', actorName: string, reason: string,
): string => `[Clocked ${kind} by ${actorName}] ${reason.trim()}`;

export function buildOnBehalfStart(input: {
  target: Employee;
  email: string;
  actor: { email: string; name: string };
  reason: string;
  nowIso: string;
  id: string;
}): TimeEntry {
  return {
    id: input.id,
    userEmail: input.email,
    userName: input.target.name,
    clockIn: input.nowIso,
    notes: [{
      author: input.actor.email,
      authorName: input.actor.name,
      timestamp: input.nowIso,
      text: onBehalfNote('in', input.actor.name, input.reason),
    }],
    // NOT manualEntry: this is a real clock-in at a real time, just tapped by
    // somebody else. Marking it manual would misreport it as a reconstruction.
    startedBy: { email: input.actor.email, name: input.actor.name },
  };
}

export function applyOnBehalfStop(
  entry: TimeEntry,
  actor: { email: string; name: string },
  reason: string,
  nowIso: string,
): TimeEntry {
  return {
    ...entry,
    clockOut: nowIso,
    stoppedBy: { email: actor.email, name: actor.name },
    notes: [...(entry.notes || []), {
      author: actor.email,
      authorName: actor.name,
      timestamp: nowIso,
      text: onBehalfNote('out', actor.name, reason),
    }],
  };
}

/** "Started by Jonah" / "Started by Jonah · Stopped by Liam" — or null for a self-punch. */
export function onBehalfLabel(e: Pick<TimeEntry, 'startedBy' | 'stoppedBy'>): string | null {
  const parts: string[] = [];
  if (e.startedBy?.name) parts.push(`Started by ${e.startedBy.name}`);
  if (e.stoppedBy?.name) parts.push(`Stopped by ${e.stoppedBy.name}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

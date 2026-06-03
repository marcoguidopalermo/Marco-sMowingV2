import { MechanicTask, TaskActivity } from '../types';

// Multi-mechanic collaboration on repair tasks.
//
// This module is the SINGLE source of truth for turning a 'completed'
// activity row into the set of mechanics who worked on it, and how the
// work-credit ($-progress-of-work, NOT clocked hours / pay) splits among
// them. It deliberately knows nothing about pay chunks or TimeEntry: pay
// is computed elsewhere from real clocked hours and is untouched by this
// feature. Here we only answer "which completed repairs count, and by how
// much, for a given mechanic".

export interface Worker {
  userEmail: string;
  userName: string;
  // Fraction of the single repair credited to this worker. Even split:
  // N workers => 1/N each, summing to 1 (one repair).
  share: number;
}

export interface Assignee {
  userEmail: string;
  userName: string;
}

// Normalize the workers credited by a 'completed' activity row.
//
// Back-compat: a legacy row written before this feature has no
// payload.workers — it is treated as a single worker (the completer on
// userEmail/userName) with share 1, so old data reads exactly as before.
export function workersForCompletion(a: TaskActivity): Worker[] {
  const raw = a.payload?.workers;
  if (Array.isArray(raw) && raw.length > 0) {
    const cleaned = raw
      .filter((w: any) => w && typeof w.userEmail === 'string' && w.userEmail)
      .map((w: any) => ({
        userEmail: w.userEmail as string,
        userName: (typeof w.userName === 'string' && w.userName) ? w.userName : (w.userEmail as string),
        share: (typeof w.share === 'number' && Number.isFinite(w.share) && w.share > 0) ? w.share : 0,
      }));
    if (cleaned.length > 0) {
      const sum = cleaned.reduce((s, w) => s + w.share, 0);
      // Missing / invalid shares → fall back to an even split so the
      // credit still sums to one repair.
      if (sum <= 0) {
        const even = 1 / cleaned.length;
        return cleaned.map(w => ({ ...w, share: even }));
      }
      return cleaned;
    }
  }
  return [{
    userEmail: a.userEmail || '',
    userName: a.userName || a.userEmail || 'Unknown',
    share: 1,
  }];
}

// Total work-credit share this completion gives a specific mechanic
// (0 if they aren't among the workers). Summed in case the same email
// appears more than once.
export function shareForMechanic(a: TaskActivity, email: string): number {
  const me = (email || '').toLowerCase();
  if (!me) return 0;
  let s = 0;
  for (const w of workersForCompletion(a)) {
    if ((w.userEmail || '').toLowerCase() === me) s += w.share;
  }
  return s;
}

// Effective assignees of a task: prefer the assignees[] list when
// present, else fall back to the legacy single assignedTo, else none.
export function assigneesForTask(
  task: Pick<MechanicTask, 'assignees' | 'assignedTo'> | null | undefined,
): Assignee[] {
  if (!task) return [];
  if (Array.isArray(task.assignees) && task.assignees.length > 0) {
    return task.assignees
      .filter(a => a && a.userEmail)
      .map(a => ({ userEmail: a.userEmail, userName: a.userName || a.userEmail }));
  }
  if (task.assignedTo && task.assignedTo.userEmail) {
    return [{ userEmail: task.assignedTo.userEmail, userName: task.assignedTo.userName || task.assignedTo.userEmail }];
  }
  return [];
}

// A display-friendly first name for a worker/assignee.
export function shortName(userName: string, userEmail: string): string {
  const src = (userName || '').trim() || (userEmail || '').split('@')[0] || '';
  if (!src) return 'Unknown';
  const parts = src.split(/\s+/).filter(Boolean);
  const first = parts[0] || src;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

// The other workers on a completion, excluding `excludeEmail` — used to
// render "collaborated with X" on completed-repair rows. Returns first
// names. When `excludeEmail` is empty (admin view) every worker is
// returned, so the caller can show the full crew.
export function collaboratorNames(a: TaskActivity, excludeEmail: string): string[] {
  const me = (excludeEmail || '').toLowerCase();
  return workersForCompletion(a)
    .filter(w => !me || (w.userEmail || '').toLowerCase() !== me)
    .map(w => shortName(w.userName, w.userEmail));
}

// "Sam", "Sam & Lee", "Sam, Lee & Pat" — for the collaborated-with line.
export function joinNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

// Format a (possibly fractional) work-credit count for display. Whole
// numbers render plain; split credit renders with one decimal
// (e.g. 2.5 repairs from sharing two repairs evenly).
export function formatCredit(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

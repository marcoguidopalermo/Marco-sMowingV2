// THE FLAG RECORD — every question raised about a crew-day, and its answer.
//
// The individual flag is a correction. The PATTERN is the management
// information: which division accumulates flags, whether they get answered, how
// quickly. That is what a review conversation needs, and it is why this exists
// as a record rather than as a second place to review crew-days — the daily
// entry board already shows the crew-day, and the flag is raised there.
//
// READ-ONLY and derived. Nothing here writes, and nothing here reads a BH, AH
// or pay number: a flag moves approval STATE only.
import { CrewDayFlag, Employee, ManagedDivision } from '../types';
import { divisionNameToCode } from './approvalOversight';
import { isActiveEmployee } from './availabilityView';

export interface FlagFilters {
  /** 'all' | 'open' | 'resolved' */
  status?: 'all' | 'open' | 'resolved';
  /** Exact PerformanceLog.division, or 'all'. */
  division?: string;
  /** Employee id of the responsible manager, or 'all'. */
  managerId?: string;
  /** Inclusive YYYY-MM-DD bounds on the crew-day's DATE (not when it was raised). */
  from?: string;
  to?: string;
}

export interface ManagerRef {
  id: string;
  name: string;
  managedDivision: ManagedDivision;
}

// The manager ACCOUNTABLE for a crew-day's division — the person who has to
// answer the flag. Resolved from managedDivision, matching how the notification
// routes, so the rollup names the same person who got the push.
//
// An all-division manager is a fallback, never a first choice: naming them for
// a division that has its own manager would attribute somebody else's flags to
// them, which is exactly the wrong thing for a per-manager rollup.
export function managerForDivision(
  employees: Employee[], division: string,
): ManagerRef | null {
  const code = divisionNameToCode(division);
  const active = (employees || []).filter(isActiveEmployee);
  if (code) {
    const own = active.find(e => e.managedDivision === code);
    if (own) return { id: own.id, name: own.name, managedDivision: code };
  }
  const all = active.find(e => e.managedDivision === 'all');
  if (all) return { id: all.id, name: all.name, managedDivision: 'all' };
  return null;
}

export interface FlagRow {
  flag: CrewDayFlag;
  /** The manager accountable for answering it. null when the division has none. */
  manager: ManagerRef | null;
  /** Whole days between raising and resolving; null while still open. */
  daysToResolve: number | null;
}

const MS_DAY = 86_400_000;

/** Newest first, by when the flag was RAISED. */
export function buildFlagRows(
  flags: CrewDayFlag[], employees: Employee[],
): FlagRow[] {
  return [...(flags || [])]
    .sort((a, b) => b.raisedAt - a.raisedAt)
    .map(flag => ({
      flag,
      manager: managerForDivision(employees, flag.division),
      daysToResolve: flag.resolvedAt
        ? Math.max(0, Math.floor((flag.resolvedAt - flag.raisedAt) / MS_DAY))
        : null,
    }));
}

export function filterFlagRows(rows: FlagRow[], f: FlagFilters): FlagRow[] {
  const status = f.status || 'all';
  return rows.filter(r => {
    if (status !== 'all' && r.flag.status !== status) return false;
    if (f.division && f.division !== 'all' && r.flag.division !== f.division) return false;
    // A flag whose division has no manager is only matched by 'all' — it must
    // not silently land under whoever happens to be listed first.
    if (f.managerId && f.managerId !== 'all' && r.manager?.id !== f.managerId) return false;
    if (f.from && r.flag.date < f.from) return false;
    if (f.to && r.flag.date > f.to) return false;
    return true;
  });
}

/** Every division that appears in the record, so the filter offers real values. */
export function divisionsInRecord(flags: CrewDayFlag[]): string[] {
  return [...new Set((flags || []).map(f => f.division || 'Unassigned'))].sort();
}

// ── THE PER-MANAGER ROLLUP ─────────────────────────────────────────────────
export interface ManagerRollupRow {
  managerId: string;
  managerName: string;
  divisions: string[];
  total: number;
  open: number;
  resolved: number;
  /** Mean whole days to resolve, over resolved flags only. null when none. */
  avgDaysToResolve: number | null;
}

/**
 * Flags for one month (YYYY-MM), grouped by the accountable manager. Counted by
 * the crew-day's DATE, not by when the flag was raised: a flag raised on the 1st
 * about the 31st belongs to the month being reviewed, which is the month the
 * conversation is about.
 *
 * Flags whose division has no manager are grouped under a single unattributed
 * row rather than dropped — an unanswerable flag is the most important kind to
 * see, since it holds a crew-day out of pay with nobody assigned to release it.
 */
export const UNATTRIBUTED_ID = '__unattributed__';

export function buildManagerRollup(
  flags: CrewDayFlag[], employees: Employee[], month: string,
): ManagerRollupRow[] {
  const rows = buildFlagRows(flags, employees)
    .filter(r => r.flag.date.slice(0, 7) === month);

  const acc = new Map<string, {
    name: string; divisions: Set<string>; total: number; open: number;
    resolved: number; resolveDays: number[];
  }>();
  for (const r of rows) {
    const id = r.manager?.id || UNATTRIBUTED_ID;
    const name = r.manager?.name || 'No manager assigned';
    const e = acc.get(id) || {
      name, divisions: new Set<string>(), total: 0, open: 0, resolved: 0,
      resolveDays: [] as number[],
    };
    e.divisions.add(r.flag.division || 'Unassigned');
    e.total += 1;
    if (r.flag.status === 'open') e.open += 1;
    else {
      e.resolved += 1;
      if (r.daysToResolve !== null) e.resolveDays.push(r.daysToResolve);
    }
    acc.set(id, e);
  }

  return [...acc.entries()]
    .map(([managerId, e]) => ({
      managerId,
      managerName: e.name,
      divisions: [...e.divisions].sort(),
      total: e.total,
      open: e.open,
      resolved: e.resolved,
      avgDaysToResolve: e.resolveDays.length
        ? Math.round((e.resolveDays.reduce((s, d) => s + d, 0) / e.resolveDays.length) * 10) / 10
        : null,
    }))
    // Most OPEN first — those are the ones still costing a day its approval.
    .sort((a, b) => b.open - a.open || b.total - a.total
      || a.managerName.localeCompare(b.managerName));
}

/** Managers who appear in the record, for the filter dropdown. */
export function managersInRecord(
  flags: CrewDayFlag[], employees: Employee[],
): ManagerRef[] {
  const seen = new Map<string, ManagerRef>();
  for (const r of buildFlagRows(flags, employees)) {
    if (r.manager && !seen.has(r.manager.id)) seen.set(r.manager.id, r.manager);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

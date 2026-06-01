import {
  Crew,
  PerformanceLog,
  CrewSizeAllowanceRow,
  AppSettings,
} from '../types';
import { DEFAULT_CREW_SIZE_ALLOWANCE } from '../constants';

// Scheduled crew size = roster on the schedule minus people the
// manager explicitly removed from this crew's perf entry, AND
// minus any isTestUser sentinel that happens to be on the roster
// (test users are ghosts to performance math — see types.ts on
// the isTestUser flag). Drop-in helpers (workers/managers whose
// hours land via the split or "Add Unscheduled Employee" flows)
// live in employeeAH only and are intentionally NOT counted
// toward the bracket here either.
export function scheduledCrewSize(
  crew: Pick<Crew, 'employees'> | undefined | null,
  log: Pick<PerformanceLog, 'removedEmployees'> | undefined | null,
  testUserIds?: Set<string> | null,
): number {
  if (!crew) return 0;
  const removed = new Set(log?.removedEmployees || []);
  return (crew.employees || []).filter(id =>
    !removed.has(id) && !(testUserIds && testUserIds.has(id)),
  ).length;
}

// Returns the allowance pct for a given scheduled size, using the
// supplied table (or the seeded default). The table is treated as a
// step function: walk the rows in ascending minSize and keep the
// last matching pct. Negative sizes / empty tables → 0%.
export function pctForSize(
  size: number,
  table?: CrewSizeAllowanceRow[] | null,
): number {
  const rows = (table && table.length > 0 ? table : DEFAULT_CREW_SIZE_ALLOWANCE)
    .slice()
    .sort((a, b) => a.minSize - b.minSize);
  let pct = 0;
  for (const row of rows) {
    if (size >= row.minSize) pct = row.pct;
    else break;
  }
  return pct;
}

// Resolves the allowance for a crew-day, preferring the stamped
// snapshot on the log so retuning the table later doesn't rewrite
// history. Falls back to a live compute against the current
// settings table when no stamp exists (typical for today before the
// first sync, or for legacy data written before this feature).
export interface CrewAllowanceResult {
  size: number;
  pct: number;
  source: 'stamped' | 'live';
}

export function getCrewAllowance(
  crew: Pick<Crew, 'employees'> | undefined | null,
  log: Pick<PerformanceLog, 'removedEmployees' | 'crewSizeAllowance'> | undefined | null,
  settings: Pick<AppSettings, 'crewSizeAllowance'> | undefined | null,
  testUserIds?: Set<string> | null,
): CrewAllowanceResult {
  // Live-recompute the size (cheap) so we can detect a stamp that
  // was written before test-user exclusion landed. When the stamp
  // disagrees with a smaller live size — i.e., a test user was
  // included in an older stamp — prefer the corrected live value
  // and re-derive pct from current settings. Stamps that match
  // the live size are honoured (history stays frozen).
  const liveSize = scheduledCrewSize(crew, log || null, testUserIds);
  const stamp = log?.crewSizeAllowance;
  if (stamp && Number.isFinite(stamp.size) && Number.isFinite(stamp.pct)) {
    if (stamp.size === liveSize) {
      return { size: stamp.size, pct: stamp.pct, source: 'stamped' };
    }
    const correctedPct = pctForSize(liveSize, settings?.crewSizeAllowance);
    return { size: liveSize, pct: correctedPct, source: 'live' };
  }
  const pct = pctForSize(liveSize, settings?.crewSizeAllowance);
  return { size: liveSize, pct, source: 'live' };
}

// Additive: 70% raw + 10% allowance = 80% adjusted. Floors at 0;
// no upper cap (matches the spec — efficiency can already exceed
// 100% on highly productive days). Returns null when rawEff is null
// so "no data" surfaces cleanly upstream.
export function adjustedEfficiency(
  rawEff: number | null,
  allowancePct: number,
): number | null {
  if (rawEff === null || !Number.isFinite(rawEff)) return null;
  const adj = rawEff + (Number.isFinite(allowancePct) ? allowancePct : 0);
  return Math.max(0, Number(adj.toFixed(1)));
}

// Short tag string for compact display, e.g. "incl. 10% 3-man adj".
// Returns null when pct === 0 so callers can omit the tag entirely.
export function allowanceTag(size: number, pct: number): string | null {
  if (!pct || pct === 0) return null;
  return `incl. ${pct}% ${size}-man adj`;
}

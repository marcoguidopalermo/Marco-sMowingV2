import {
  Crew,
  PerformanceLog,
  CrewSizeAllowanceRow,
  AppSettings,
} from '../types';
import { DEFAULT_CREW_SIZE_ALLOWANCE } from '../constants';
import { flattenEmployeeIntervals } from './efficiency';

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

// Concurrency-aware allowance computation for a crew-day, given
// the persisted per-employee timesheet intervals. Returns the
// time-weighted effective pct plus the segment breakdown (kept for
// audit). Headline `size` is the highest concurrent headcount seen
// across the day so existing "N-man" display strings still make
// sense. Returns null when no usable intervals exist (caller falls
// back to the flat roster-based pct).
function computeTimeWindowedAllowance(
  log: Pick<PerformanceLog, 'employeeTimesheets' | 'removedEmployees'>,
  table: CrewSizeAllowanceRow[] | undefined | null,
  testUserIds?: Set<string> | null,
  nowMs?: number,
): {
  size: number;
  effectivePct: number;
  segments: { size: number; pct: number; durationMs: number }[];
} | null {
  const intervals = flattenEmployeeIntervals(
    log.employeeTimesheets, log.removedEmployees, testUserIds, nowMs,
  );
  if (intervals.length === 0) return null;
  const breakSet = new Set<number>();
  for (const iv of intervals) {
    breakSet.add(iv.start);
    breakSet.add(iv.end);
  }
  const points = Array.from(breakSet).sort((a, b) => a - b);
  const segments: { size: number; pct: number; durationMs: number }[] = [];
  let maxSize = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const t1 = points[i];
    const t2 = points[i + 1];
    const dur = t2 - t1;
    if (dur <= 0) continue;
    const present = new Set<string>();
    for (const iv of intervals) {
      if (iv.start <= t1 && iv.end >= t2) present.add(iv.empId);
    }
    if (present.size === 0) continue;
    if (present.size > maxSize) maxSize = present.size;
    segments.push({
      size: present.size,
      pct: pctForSize(present.size, table || undefined),
      durationMs: dur,
    });
  }
  let totalMs = 0;
  let weighted = 0;
  for (const s of segments) {
    totalMs += s.durationMs;
    weighted += s.pct * s.durationMs;
  }
  if (totalMs === 0) return null;
  return {
    size: maxSize,
    effectivePct: Number((weighted / totalMs).toFixed(2)),
    segments,
  };
}

// Resolves the allowance for a crew-day, preferring the stamped
// snapshot on the log so retuning the table later doesn't rewrite
// history. Falls back to a live compute against the current
// settings table when no stamp exists (typical for today before the
// first sync, or for legacy data written before this feature).
//
// Resolution order (post solo-time work):
//   1. Stamp with effectivePct present → use it (concurrency-aware
//      stamp from a recent sync, frozen history).
//   2. Stamp with only pct + size matching live → use it (legacy
//      flat stamp, frozen history).
//   3. Log has employeeTimesheets → live-compute the time-weighted
//      effective pct (no stamp but data exists — happens between
//      sync runs, or on a re-tuned settings table for a date the
//      sync hasn't re-stamped).
//   4. Fall through to the flat roster-based pct (today's
//      behavior; legacy data, manual-entry days, no timesheets).
export interface CrewAllowanceResult {
  size: number;
  pct: number;
  source: 'stamped' | 'live';
  // True when the result reflects per-segment time-weighting from
  // intervals (vs the flat roster-based number). Surfaced for any
  // UI that wants to disclose how the pct was derived.
  concurrencyAware?: boolean;
  segments?: { size: number; pct: number; durationMs: number }[];
}

export function getCrewAllowance(
  crew: Pick<Crew, 'employees'> | undefined | null,
  log: Pick<PerformanceLog, 'removedEmployees' | 'crewSizeAllowance' | 'employeeTimesheets'> | undefined | null,
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
  // Step 1 — stamp with effectivePct (new format). Honour it
  // verbatim regardless of liveSize: the size disagreement check
  // only mattered for legacy stamps that didn't already know about
  // test-user exclusion. The effectivePct stamp is computed inside
  // the sync from intervals (which already filter test users), so
  // it doesn't need a corrective re-derive at read time.
  if (stamp && Number.isFinite(stamp.effectivePct)) {
    return {
      size: stamp.size,
      pct: stamp.effectivePct as number,
      source: 'stamped',
      concurrencyAware: true,
      segments: stamp.segments,
    };
  }
  // Step 2 — legacy flat stamp.
  if (stamp && Number.isFinite(stamp.size) && Number.isFinite(stamp.pct)) {
    if (stamp.size === liveSize) {
      return { size: stamp.size, pct: stamp.pct, source: 'stamped' };
    }
    // Stamp written before test-user exclusion. Prefer live size
    // and re-derive — same as before.
    const correctedPct = pctForSize(liveSize, settings?.crewSizeAllowance);
    return { size: liveSize, pct: correctedPct, source: 'live' };
  }
  // Step 3 — no stamp, but intervals exist. Live-compute the
  // time-weighted pct so the partial-departure case is priced
  // correctly even between sync runs.
  if (log?.employeeTimesheets) {
    const tw = computeTimeWindowedAllowance(
      log, settings?.crewSizeAllowance, testUserIds,
    );
    if (tw) {
      return {
        size: tw.size,
        pct: tw.effectivePct,
        source: 'live',
        concurrencyAware: true,
        segments: tw.segments,
      };
    }
  }
  // Step 4 — flat roster pct.
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

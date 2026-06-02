import { PerformanceLog, DeductionValue } from '../types';

// Walk a per-emp interval map into a flat array filtered for test
// users + removed empIds. Open shifts (endAt === null) are clamped
// to nowMs. Exported because both the BH-split helper and the
// allowance helper share this primitive.
export interface EmpIntervalMs { empId: string; start: number; end: number }

export function flattenEmployeeIntervals(
  timesheets: Record<string, { startAt: string; endAt: string | null }[]> | undefined,
  removedEmployees: string[] | undefined,
  testUserIds: Set<string> | undefined | null,
  nowMs?: number,
): EmpIntervalMs[] {
  if (!timesheets) return [];
  const now = nowMs ?? Date.now();
  const removed = new Set(removedEmployees || []);
  const out: EmpIntervalMs[] = [];
  for (const [empId, list] of Object.entries(timesheets)) {
    if (removed.has(empId)) continue;
    if (testUserIds && testUserIds.has(empId)) continue;
    for (const ts of list || []) {
      const start = new Date(ts.startAt).getTime();
      const end = ts.endAt ? new Date(ts.endAt).getTime() : now;
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        out.push({ empId, start, end });
      }
    }
  }
  return out;
}

// Concurrency-weighted hours per employee. For each [t1, t2) slice
// where the set of concurrently-clocked workers P is constant,
// each worker in P earns (t2 - t1) / |P| hours. The sum across
// workers equals the union time (each minute counted exactly once),
// so Σ cwh = total clocked-union time — never the sum-with-
// overcounting cAH. This is used ONLY for splitting cBH among
// individuals (and for the allowance segments); it does NOT
// replace cAH. When the entire crew clocked together for one
// shared interval, cwh_i = totalTime / N for each worker and the
// resulting eBH share collapses to today's eAH/cAH split exactly.
export function concurrencyWeightedShares(
  log: Pick<PerformanceLog, 'employeeTimesheets' | 'removedEmployees'>,
  testUserIds?: Set<string> | null,
  nowMs?: number,
): Record<string, number> {
  const result: Record<string, number> = {};
  const intervals = flattenEmployeeIntervals(
    log.employeeTimesheets, log.removedEmployees, testUserIds, nowMs,
  );
  if (intervals.length === 0) return result;
  const breakpoints = new Set<number>();
  for (const iv of intervals) {
    breakpoints.add(iv.start);
    breakpoints.add(iv.end);
  }
  const points = Array.from(breakpoints).sort((a, b) => a - b);
  for (let i = 0; i < points.length - 1; i++) {
    const t1 = points[i];
    const t2 = points[i + 1];
    const sliceMs = t2 - t1;
    if (sliceMs <= 0) continue;
    const presentIds: string[] = [];
    for (const iv of intervals) {
      if (iv.start <= t1 && iv.end >= t2) presentIds.push(iv.empId);
    }
    if (presentIds.length === 0) continue;
    const sliceHrs = sliceMs / 3600000;
    const sharePerPerson = sliceHrs / presentIds.length;
    for (const id of presentIds) {
      result[id] = (result[id] || 0) + sharePerPerson;
    }
  }
  return result;
}

// Hours to deduct from a worker's AH. Mirrors PerformanceBoard's local
// deductHours (lines 23-28) exactly. Kept here so the My Crew Today
// "Yesterday" card uses the byte-identical formula Advanced Reporting
// uses for individual efficiency.
export function deductHours(d: DeductionValue | undefined): number {
  if (d == null) return 0;
  if (typeof d === 'number' || typeof d === 'string') return Number(d) || 0;
  if (typeof d === 'object' && 'hours' in d) return Number((d as any).hours) || 0;
  return 0;
}

export interface EmpEffStat {
  bh: number;
  ah: number;
}

export interface CrewTotals {
  cBH: number;
  rawAH: number;
  deducAH: number;
  cAH: number;
}

// Single source of truth for the four crew-day numbers every
// downstream calc needs. Test users are excluded from BOTH the AH
// numerator and the matching deductions, so the remaining real
// members still split 100% of cBH among themselves (preserving the
// "Σ individuals = company total" invariant). Drop-in helpers
// (employeeAH keys outside crew.employees) are still summed — they
// helped, they get credit.
export function crewTotals(
  log: Pick<PerformanceLog, 'jobs' | 'employeeAH' | 'deductions'>,
  testUserIds?: Set<string> | null,
): CrewTotals {
  const cBH = (log.jobs || []).reduce(
    (s: number, j) => s + Number((j as { bh?: unknown }).bh || 0),
    0,
  );
  let rawAH = 0;
  for (const [empId, ah] of Object.entries(log.employeeAH || {})) {
    if (testUserIds && testUserIds.has(empId)) continue;
    rawAH += Number(ah || 0);
  }
  let deducAH = 0;
  for (const [empId, v] of Object.entries(log.deductions || {})) {
    if (testUserIds && testUserIds.has(empId)) continue;
    deducAH += deductHours(v as DeductionValue);
  }
  const cAH = Math.max(0, rawAH - deducAH);
  return { cBH, rawAH, deducAH, cAH };
}

// Per-employee BH/AH accumulator. Routes the crew totals through
// crewTotals() so any test-user filter applied there also flows
// through the per-employee BH share. The iteration itself also
// skips test users, so they never accrue a row in `into`.
//
// When log.employeeTimesheets is present and every eAH-bearing
// worker also has at least one interval, the BH split switches to
// concurrency-weighted: eBH_i = cBH × (cwh_i / Σ cwh) where cwh_i
// is each worker's time-presence weight (each minute they were on
// the clock, divided by the count of workers present that minute).
// The cwh is scaled by (eAH_i / rawAH_i) so deductions still
// reduce a worker's BH share — preserving today's semantic exactly
// when there's no concurrency mismatch. When the entire crew
// clocked together, the new formula collapses to today's
// eAH/cAH split bit-for-bit (verified analytically: cwh_i =
// totalTime / N → ratio = eAH_i / cAH).
//
// Hard constraint: cAH and crew efficiency % are unchanged. This
// helper only affects how cBH is partitioned among individuals.
export function accumulateEmployeeEff(
  log: PerformanceLog,
  into: Record<string, EmpEffStat>,
  testUserIds?: Set<string> | null,
): Record<string, EmpEffStat> {
  const { cBH, cAH } = crewTotals(log, testUserIds || null);

  // Phase 1: today's eAH compute, unchanged. Drives both AH
  // accumulation and the deduction-scaling for the concurrency
  // branch below.
  const eAHByEmpId: Record<string, { eAH: number; rawAH: number }> = {};
  Object.entries(log.employeeAH || {}).forEach(([empId, ah]) => {
    if (testUserIds && testUserIds.has(empId)) return;
    const baseAH = Number(ah || 0);
    const indvDeduc = deductHours(log.deductions?.[empId] as DeductionValue);
    const eAH = Math.max(0, baseAH - indvDeduc);
    if (eAH > 0) eAHByEmpId[empId] = { eAH, rawAH: baseAH };
  });
  const eAHIds = Object.keys(eAHByEmpId);
  if (eAHIds.length === 0) return into;

  // Phase 2: try concurrency-weighted BH split. Only engages when
  // (a) timesheets persisted, (b) every eAH-bearing worker has a
  // positive cwh (no missing intervals → no partial split), and
  // (c) the scaled total > 0. Any miss → fall through to today's
  // flat formula so legacy data + manual-entry days keep working.
  let scaledCwh: Record<string, number> | null = null;
  let scaledTotal = 0;
  if (log.employeeTimesheets) {
    const cwhRaw = concurrencyWeightedShares(log, testUserIds || null);
    const allCovered = eAHIds.every(id => (cwhRaw[id] || 0) > 0);
    if (allCovered) {
      scaledCwh = {};
      for (const id of eAHIds) {
        const { eAH, rawAH } = eAHByEmpId[id];
        const scale = rawAH > 0 ? eAH / rawAH : 0;
        const v = cwhRaw[id] * scale;
        scaledCwh[id] = v;
        scaledTotal += v;
      }
      if (scaledTotal <= 0) scaledCwh = null;
    }
  }

  // Phase 3: accumulate. eAH always uses today's value (cAH and
  // efficiency stay identical). Only eBH switches between the two
  // formulas.
  for (const empId of eAHIds) {
    const { eAH } = eAHByEmpId[empId];
    const eBH = scaledCwh
      ? cBH * (scaledCwh[empId] / scaledTotal)
      : (cAH > 0 ? cBH * (eAH / cAH) : 0);
    if (!into[empId]) into[empId] = { bh: 0, ah: 0 };
    into[empId].ah += eAH;
    into[empId].bh += eBH;
  }
  return into;
}

// Efficiency % from an accumulated stat. Returns null when AH is zero so
// callers can render "No performance data" instead of NaN / Infinity.
export function efficiencyPct(stat: EmpEffStat | undefined | null): number | null {
  if (!stat || !Number.isFinite(stat.ah) || stat.ah <= 0) return null;
  if (!Number.isFinite(stat.bh)) return null;
  return Number(((stat.bh / stat.ah) * 100).toFixed(1));
}

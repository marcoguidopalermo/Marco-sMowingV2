import { PerformanceLog, DeductionValue } from '../types';

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
// through the per-employee BH share (eBH = cBH * eAH / cAH). The
// iteration itself also skips test users, so they never accrue a
// row in `into`.
export function accumulateEmployeeEff(
  log: PerformanceLog,
  into: Record<string, EmpEffStat>,
  testUserIds?: Set<string> | null,
): Record<string, EmpEffStat> {
  const { cBH, cAH } = crewTotals(log, testUserIds || null);
  Object.entries(log.employeeAH || {}).forEach(([empId, ah]) => {
    if (testUserIds && testUserIds.has(empId)) return;
    const baseAH = Number(ah || 0);
    const indvDeduc = deductHours(log.deductions?.[empId] as DeductionValue);
    const eAH = Math.max(0, baseAH - indvDeduc);
    if (eAH > 0) {
      const eBH = cAH > 0 ? cBH * (eAH / cAH) : 0;
      if (!into[empId]) into[empId] = { bh: 0, ah: 0 };
      into[empId].ah += eAH;
      into[empId].bh += eBH;
    }
  });
  return into;
}

// Efficiency % from an accumulated stat. Returns null when AH is zero so
// callers can render "No performance data" instead of NaN / Infinity.
export function efficiencyPct(stat: EmpEffStat | undefined | null): number | null {
  if (!stat || !Number.isFinite(stat.ah) || stat.ah <= 0) return null;
  if (!Number.isFinite(stat.bh)) return null;
  return Number(((stat.bh / stat.ah) * 100).toFixed(1));
}

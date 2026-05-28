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

// Per-employee BH/AH accumulator copied character-for-character from
// PerformanceBoard.calcReports's empStats block (the inner loop in
// lines 998-1008). Same crew-net-AH denominator, same proportional
// crew-BH share, same eAH > 0 gate. Workers with zero net AH contribute
// nothing.
export function accumulateEmployeeEff(
  log: PerformanceLog,
  into: Record<string, EmpEffStat>,
): Record<string, EmpEffStat> {
  const cBH = (log.jobs || []).reduce((s: number, j: any) => s + Number(j.bh || 0), 0);
  const rawAH = Object.values(log.employeeAH || {}).reduce((s: number, v: any) => s + Number(v || 0), 0);
  let deducAH = 0;
  for (const v of Object.values(log.deductions || {})) deducAH += deductHours(v as DeductionValue);
  const cAH = Math.max(0, rawAH - deducAH);

  Object.entries(log.employeeAH || {}).forEach(([empId, ah]) => {
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

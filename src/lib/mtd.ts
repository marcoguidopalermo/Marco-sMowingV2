import {
  AppSettings,
  Crew,
  DeductionValue,
  Employee,
  PerformanceLog,
} from '../types';
import { accumulateEmployeeEff, deductHours, EmpEffStat } from './efficiency';
import { getCrewAllowance } from './crewAllowance';

export interface MtdEmployeeStat {
  empId: string;
  name: string;
  bh: number;
  ah: number;
}

export interface MtdResult {
  monthStart: string;       // YYYY-MM-DD, 1st of the calendar month
  monthEnd: string;         // YYYY-MM-DD, today (Toronto)
  monthLabel: string;       // "JUNE", "JULY", etc.
  companyBH: number;
  companyAH: number;
  // Adjusted via the per-crew snapshotted allowance (the virtual-BH
  // aggregation method). null when companyAH === 0.
  companyAdjustedEfficiency: number | null;
  // Per-employee MTD BH/AH shares, sorted by BH desc. Sum of `bh`
  // across this array equals `companyBH` (to floating-point — round
  // at display only).
  perEmployee: MtdEmployeeStat[];
}

// Toronto YYYY-MM-DD anchor → month start + end + display label.
// Defensive: malformed `today` returns a degenerate range so callers
// render zeros instead of crashing.
export function getMonthRange(today: string): {
  start: string;
  end: string;
  label: string;
} {
  const [yStr, mStr] = (today || '').split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return { start: today, end: today, label: '' };
  }
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  // Noon UTC avoids the "month name shifts on a TZ edge" trap; we
  // only care about the month name, not the day-of-month rendering.
  const label = new Date(`${start}T12:00:00Z`)
    .toLocaleDateString('en-US', { month: 'long' })
    .toUpperCase();
  return { start, end: today, label };
}

// Calendar-month aggregation across appData.performance. Composes
// existing helpers (accumulateEmployeeEff, getCrewAllowance) and
// adds the cAH===0 / cBH>0 even-split fallback so the per-employee
// totals still sum to companyBH (the invariant the spec calls out).
//
// Cost: 20-ish weekdays × O(crews) per day, each touching small
// jobs / employeeAH maps. Sub-millisecond on any device; no
// Firestore reads — AppData is already in memory.
export function buildMtd(
  today: string,
  performance: Record<string, Record<string, PerformanceLog>>,
  schedules: Record<string, Crew[]>,
  employees: Employee[],
  settings?: AppSettings | null,
): MtdResult {
  const { start, end, label } = getMonthRange(today);
  const empById = new Map(employees.map(e => [e.id, e]));
  const empStats: Record<string, EmpEffStat> = {};
  let companyBH = 0;
  let companyAH = 0;
  let companyAdjustedNumerator = 0;

  for (const [date, dayLogs] of Object.entries(performance || {})) {
    if (date < start || date > end) continue;
    const daySchedule = schedules[date] || [];
    for (const [crewId, log] of Object.entries(dayLogs || {})) {
      const cBH = (log.jobs || []).reduce(
        (s: number, j) => s + Number((j as { bh?: unknown }).bh || 0),
        0,
      );
      const rawAH = Object.values(log.employeeAH || {}).reduce(
        (s: number, v) => s + Number(v || 0),
        0,
      );
      let deducAH = 0;
      for (const v of Object.values(log.deductions || {})) {
        deducAH += deductHours(v as DeductionValue);
      }
      const cAH = Math.max(0, rawAH - deducAH);

      const crewObj = daySchedule.find(c => c.id === crewId);
      const allowance = getCrewAllowance(crewObj, log, settings || null);

      companyBH += cBH;
      companyAH += cAH;
      // Virtual-BH method: per-crew adjusted eff = (cBH + cAH×pct/100) / cAH.
      // Summing the numerators and dividing by ΣcAH yields the AH-weighted
      // average of crew adjusted efficiencies — the mathematically correct
      // company-level adjusted number when each crew has its own snapshot.
      companyAdjustedNumerator += cBH + (cAH * allowance.pct) / 100;

      // Per-employee BH share — proportional to each member's eAH.
      // Drop-in helpers (employeeAH keys outside crew.employees) get a
      // proportional slice via the same identity (Σ eBH = cBH when cAH > 0).
      if (cAH > 0) {
        accumulateEmployeeEff(log, empStats);
        continue;
      }

      // Edge case: BH credited but no AH yet. The default helper
      // would lose `cBH` from the per-employee sum and break the
      // invariant. Even-split across the scheduled roster
      // (crew.employees − removedEmployees) so each scheduled
      // member carries `cBH / size` and the totals still match.
      if (cBH > 0) {
        const removed = new Set(log.removedEmployees || []);
        const roster = (crewObj?.employees || []).filter(
          id => !removed.has(id),
        );
        if (roster.length === 0) {
          // Pathological — no roster, no AH, but cBH credited.
          // Falling through here intentionally drops the share so
          // the company-sum invariant breaks loudly rather than
          // silently mis-attributing. In practice this never fires.
          continue;
        }
        const shareBH = cBH / roster.length;
        for (const empId of roster) {
          if (!empStats[empId]) empStats[empId] = { bh: 0, ah: 0 };
          empStats[empId].bh += shareBH;
        }
      }
    }
  }

  const companyAdjustedEfficiency = companyAH > 0
    ? Number(((companyAdjustedNumerator / companyAH) * 100).toFixed(1))
    : null;

  const perEmployee: MtdEmployeeStat[] = Object.entries(empStats)
    .map(([empId, stat]) => ({
      empId,
      name: empById.get(empId)?.name || empId,
      bh: Number(stat.bh.toFixed(1)),
      ah: Number(stat.ah.toFixed(1)),
    }))
    .sort((a, b) => b.bh - a.bh);

  return {
    monthStart: start,
    monthEnd: end,
    monthLabel: label,
    companyBH: Number(companyBH.toFixed(1)),
    companyAH: Number(companyAH.toFixed(1)),
    companyAdjustedEfficiency,
    perEmployee,
  };
}

// Convenience: per-employee MTD BH for the logged-in user.
// Returns 0 when there's no signed-in Employee record or no MTD
// contribution this month.
export function selfMtdBH(
  result: MtdResult,
  currentEmpId: string | null | undefined,
): number {
  if (!currentEmpId) return 0;
  const row = result.perEmployee.find(e => e.empId === currentEmpId);
  return row?.bh ?? 0;
}

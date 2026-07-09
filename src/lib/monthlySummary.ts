// Monthly summary — compact, comparable, bonus-basis snapshot of one
// completed (or in-progress) month. Computed ONLY via the shared bonus
// functions (buildMtd / buildDivisionMtd / countBonusJobs), so every month
// on the Trends page is directly comparable to the bonus totals. Read-only:
// nothing here writes performance, archiving, or pay data.
import {
  AppSettings, Crew, Employee, PerformanceLog,
  MonthlySummary, MonthlyDivisionSummary,
} from '../types';
import { DIVISIONS } from '../constants';
import {
  buildMtd, buildDivisionMtd, countBonusJobs, getMonthRange,
} from './mtd';

const rawEff = (bh: number, ah: number): number | null =>
  ah > 0 ? Number(((bh / ah) * 100).toFixed(1)) : null;

// The whole-month trick: buildMtd/buildDivisionMtd exclude `today` and key
// their range off getMonthRange(today).start. Passing 'YYYY-MM-32' makes
// the range resolve to the target month (start derives monthName correctly)
// while the `< today` string compare includes every real day of the month.
export function monthAnchor(ym: string): string {
  return `${ym}-32`;
}

// Divisions present in a month's data (falls back to the fixed set order).
function divisionsInMonth(
  ym: string,
  performance: Record<string, Record<string, PerformanceLog>>,
): string[] {
  const seen = new Set<string>();
  for (const [date, dayLogs] of Object.entries(performance || {})) {
    if (date.slice(0, 7) !== ym) continue;
    for (const log of Object.values(dayLogs || {})) {
      if (log.division) seen.add(log.division);
    }
  }
  // Stable, familiar ordering first, then any stragglers.
  const ordered = DIVISIONS.filter(d => seen.has(d));
  for (const d of seen) if (!ordered.includes(d)) ordered.push(d);
  return ordered;
}

// Crew-day settlement mix for the month (transparency only).
function crewDayCounts(
  ym: string,
  performance: Record<string, Record<string, PerformanceLog>>,
): { approved: number; pending: number; waived: number } {
  let approved = 0, pending = 0, waived = 0;
  for (const [date, dayLogs] of Object.entries(performance || {})) {
    if (date.slice(0, 7) !== ym) continue;
    for (const log of Object.values(dayLogs || {})) {
      if (log.approvalStatus === 'approved') approved++;
      else if (log.approvalStatus === 'waived') waived++;
      else pending++;
    }
  }
  return { approved, pending, waived };
}

export function buildMonthlySummary(
  ym: string,
  performance: Record<string, Record<string, PerformanceLog>>,
  schedules: Record<string, Crew[]>,
  employees: Employee[],
  settings: AppSettings | null | undefined,
  meta: { generatedBy: string; finalized: boolean; now: number; todayOverride?: string },
): MonthlySummary {
  // Finalized months use the whole-month anchor ('YYYY-MM-32' includes every
  // real day). A live month-to-date pass passes the real `today` so it
  // matches the MTD widgets exactly (which exclude the partial current day).
  const today = meta.todayOverride || monthAnchor(ym);
  const company = buildMtd(today, performance, schedules, employees, settings ?? null);
  const monthLabel = getMonthRange(today).monthName || ym;

  const divisions: MonthlyDivisionSummary[] = divisionsInMonth(ym, performance).map(div => {
    const d = buildDivisionMtd(today, div, performance, schedules, employees, settings ?? null);
    return {
      division: div,
      bh: d.divisionBH,
      ah: d.divisionAH,
      rawEff: rawEff(d.divisionBH, d.divisionAH),
      adjustedEff: d.divisionAdjustedEfficiency,
      jobs: countBonusJobs(today, performance, schedules, div),
      perCrew: d.perCrew.map(c => ({
        crewKey: c.crewKey,
        crewLabel: c.crewLabel,
        crewNumber: c.crewNumber,
        bh: c.bh,
        ah: c.ah,
        adjustedEff: c.adjustedEfficiency,
      })),
    };
  });

  return {
    month: ym,
    monthLabel,
    basis: 'approved-days',
    cutoff: company.cutoff,
    company: {
      bh: company.companyBH,
      ah: company.companyAH,
      rawEff: rawEff(company.companyBH, company.companyAH),
      adjustedEff: company.companyAdjustedEfficiency,
      jobs: countBonusJobs(today, performance, schedules),
      employees: company.perEmployee.length,
    },
    divisions,
    perEmployee: company.perEmployee.map(e => ({ empId: e.empId, name: e.name, bh: e.bh, ah: e.ah })),
    crewDayCounts: crewDayCounts(ym, performance),
    generatedAt: meta.now,
    generatedBy: meta.generatedBy,
    finalized: meta.finalized,
  };
}

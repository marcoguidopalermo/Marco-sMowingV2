// Pure analysis over a finalized month's crew-day data (the performanceMonths
// sheet's `days` map). Powers the Month Sheets analysis layer: month stats +
// a sortable/filterable crew-day list that taps through to the read-only board.
// No React, no Firestore. Efficiency = BH / AH (the standard raw ratio).
import { PerformanceLog } from '../types';

export type DaysMap = Record<string, Record<string, PerformanceLog>>;
const round1 = (n: number) => Math.round((Number(n) || 0) * 10) / 10;
const effOf = (bh: number, ah: number): number | null => ah > 0 ? Math.round((bh / ah) * 100) : null;

export function bhOf(log: PerformanceLog): number {
  let bh = 0; for (const j of log?.jobs || []) bh += Number(j.bh) || 0; return round1(bh);
}
export function ahOf(log: PerformanceLog): number {
  let ah = 0; for (const v of Object.values(log?.employeeAH || {})) ah += Number(v) || 0; return round1(ah);
}

export interface CrewDayRow {
  date: string; crewId: string; division: string; crewNumber: number; crewLabel: string;
  bh: number; ah: number; eff: number | null;
  approvalStatus: string;
}
export interface DivisionAvg { division: string; eff: number | null; bh: number; ah: number; crewDays: number }
export interface DayAgg { date: string; bh: number; ah: number; eff: number | null }
export interface MonthStats {
  dayCount: number; crewDayCount: number;
  totalBH: number; totalAH: number; eff: number | null;
  divisions: DivisionAvg[];
  bestDay: DayAgg | null; worstDay: DayAgg | null;
}

export function crewDayRows(days: DaysMap): CrewDayRow[] {
  const rows: CrewDayRow[] = [];
  for (const [date, dayMap] of Object.entries(days || {})) {
    for (const [crewId, log] of Object.entries(dayMap || {})) {
      const bh = bhOf(log); const ah = ahOf(log);
      rows.push({
        date, crewId,
        division: log.division || 'Unassigned', crewNumber: log.crewNumber ?? 0,
        crewLabel: `${log.division ?? '?'} #${log.crewNumber ?? '?'}`,
        bh, ah, eff: effOf(bh, ah), approvalStatus: log.approvalStatus || 'pending',
      });
    }
  }
  return rows;
}

export function monthStats(days: DaysMap): MonthStats {
  const rows = crewDayRows(days);
  const totalBH = round1(rows.reduce((s, r) => s + r.bh, 0));
  const totalAH = round1(rows.reduce((s, r) => s + r.ah, 0));
  // Division averages (weighted by BH/AH — a true efficiency, not a mean of ratios).
  const byDiv = new Map<string, { bh: number; ah: number; n: number }>();
  for (const r of rows) { const e = byDiv.get(r.division) || { bh: 0, ah: 0, n: 0 }; e.bh += r.bh; e.ah += r.ah; e.n++; byDiv.set(r.division, e); }
  const divisions: DivisionAvg[] = [...byDiv.entries()]
    .map(([division, e]) => ({ division, bh: round1(e.bh), ah: round1(e.ah), eff: effOf(e.bh, e.ah), crewDays: e.n }))
    .sort((a, b) => (b.eff ?? -1) - (a.eff ?? -1));
  // Per-day aggregate efficiency → best / worst (only days with AH).
  const byDay = new Map<string, { bh: number; ah: number }>();
  for (const r of rows) { const e = byDay.get(r.date) || { bh: 0, ah: 0 }; e.bh += r.bh; e.ah += r.ah; byDay.set(r.date, e); }
  const dayAggs: DayAgg[] = [...byDay.entries()]
    .map(([date, e]) => ({ date, bh: round1(e.bh), ah: round1(e.ah), eff: effOf(e.bh, e.ah) }))
    .filter(d => d.eff !== null)
    .sort((a, b) => (b.eff as number) - (a.eff as number));
  return {
    dayCount: byDay.size, crewDayCount: rows.length, totalBH, totalAH, eff: effOf(totalBH, totalAH),
    divisions, bestDay: dayAggs[0] || null, worstDay: dayAggs[dayAggs.length - 1] || null,
  };
}

// Sort crew-day rows worst-first or best-first by efficiency (null AH last).
export function sortCrewDayRows(rows: CrewDayRow[], dir: 'worst' | 'best'): CrewDayRow[] {
  const withEff = rows.filter(r => r.eff !== null);
  const noEff = rows.filter(r => r.eff === null);
  withEff.sort((a, b) => dir === 'worst' ? (a.eff as number) - (b.eff as number) : (b.eff as number) - (a.eff as number));
  return [...withEff, ...noEff];
}

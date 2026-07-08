// Push Month helpers — pure functions shared by the app (App.tsx push
// action + auto-push) and mirrored by the one-time push-month.mjs script.
// A "month" is a 'YYYY-MM' string. Nothing here reads or mutates Firestore.
import { PerformanceLog } from '../types';

export type PerfMap = Record<string, Record<string, PerformanceLog>>;

// 'YYYY-MM-DD' → 'YYYY-MM'.
export function monthOfDate(date: string): string {
  return (date || '').slice(0, 7);
}

// All date keys of `performance` that fall in `ym`, sorted ascending.
export function datesInMonth(performance: PerfMap, ym: string): string[] {
  return Object.keys(performance || {})
    .filter((d) => monthOfDate(d) === ym)
    .sort();
}

// Extract a month's full day→crew map (deep — caller may serialize/store).
export function extractMonth(performance: PerfMap, ym: string): PerfMap {
  const out: PerfMap = {};
  for (const d of datesInMonth(performance, ym)) out[d] = performance[d];
  return out;
}

// Distinct months present in a performance map, ascending.
export function monthsPresent(performance: PerfMap): string[] {
  const s = new Set<string>();
  for (const d of Object.keys(performance || {})) s.add(monthOfDate(d));
  return [...s].sort();
}

// A crew-day is "settled" only when approved or waived — the two terminal
// states. Anything else (pending / undefined / legacy) blocks a push,
// because pushing locks the month and we must never lock incomplete pay data.
export function isCrewDaySettled(log: PerformanceLog): boolean {
  return log?.approvalStatus === 'approved' || log?.approvalStatus === 'waived';
}

export interface MonthSettlement {
  settled: boolean;
  dayCount: number;
  crewDayCount: number;
  blocking: Array<{ date: string; crewLabel: string; status: string }>;
}

// Is every crew-day in `ym` settled? Returns the blocking crew-days if not.
export function monthSettlementStatus(performance: PerfMap, ym: string): MonthSettlement {
  const dates = datesInMonth(performance, ym);
  const blocking: MonthSettlement['blocking'] = [];
  let crewDayCount = 0;
  for (const date of dates) {
    const dayMap = performance[date] || {};
    for (const [, log] of Object.entries(dayMap)) {
      crewDayCount++;
      if (!isCrewDaySettled(log)) {
        blocking.push({
          date,
          crewLabel: `${log.division ?? '?'} #${log.crewNumber ?? '?'}`,
          status: log.approvalStatus || 'pending',
        });
      }
    }
  }
  return { settled: blocking.length === 0, dayCount: dates.length, crewDayCount, blocking };
}

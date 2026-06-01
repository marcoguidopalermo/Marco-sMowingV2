import {
  AppSettings,
  Crew,
  Employee,
  PerformanceLog,
} from '../types';
import { crewTotals } from './efficiency';
import { getCrewAllowance, adjustedEfficiency } from './crewAllowance';

// Minimum credited BH a crew needs before it's eligible for ranking.
// Below this we treat the crew as "not enough data yet" — keeps the
// leaderboard from crowning a crew that's barely started.
export const LEADERBOARD_MIN_BH = 5;

export interface CrewLeaderboardEntry {
  crew: Crew;
  crewLabel: string;
  bh: number;
  ah: number;
  // Adjusted efficiency = rawEfficiency + allowancePct. This is the
  // headline number for ranking and display everywhere — callers can
  // still read rawEfficiency / allowancePct for the breakdown UI.
  efficiency: number | null;
  rawEfficiency: number | null;
  allowancePct: number;
  scheduledSize: number;
  jobCount: number;
  memberNames: string[];
  // True when bh > LEADERBOARD_MIN_BH. Eligible entries are ranked
  // by adjusted efficiency desc; ineligible ones fall to the bottom group.
  eligible: boolean;
}

// Crew-level totals wrapper — routes through the shared
// crewTotals() in lib/efficiency.ts so test-user exclusion is
// applied consistently with every other surface (PerformanceBoard,
// MTD, accumulateEmployeeEff). Adds the efficiency % and jobCount
// the ranking display needs on top.
function crewSummary(
  log: PerformanceLog,
  testUserIds?: Set<string> | null,
): { bh: number; ah: number; efficiency: number | null; jobCount: number } {
  const { cBH: bh, cAH: ah } = crewTotals(log, testUserIds || null);
  const efficiency = ah > 0 ? Number(((bh / ah) * 100).toFixed(1)) : null;
  return { bh, ah, efficiency, jobCount: (log.jobs || []).length };
}

// Builds an unranked leaderboard for a given Toronto date. Crews
// scheduled that day with no performance entry surface as
// zero/ineligible rather than being dropped, so a crew that hasn't
// reported anything yet still appears in the Dashboard "not enough
// data" group. Each entry carries both the raw efficiency and the
// crew-size allowance applied so callers can show the breakdown.
export function buildCrewLeaderboard(
  date: string,
  schedules: Record<string, Crew[]>,
  performance: Record<string, Record<string, PerformanceLog>>,
  employees: Employee[],
  settings?: AppSettings | null,
): CrewLeaderboardEntry[] {
  const dayCrews = schedules[date] || [];
  const dayPerf = performance[date] || {};
  const empById = new Map(employees.map(e => [e.id, e]));
  // Test-user sentinel(s) are ghosts to every performance number.
  // Derive once per call and forward to the helpers so crew size,
  // crew AH, and the per-employee BH share all stay consistent.
  const testUserIds = new Set(
    employees.filter(e => e.isTestUser).map(e => e.id),
  );

  const entries: CrewLeaderboardEntry[] = [];
  for (const crew of dayCrews) {
    const log = dayPerf[crew.id];
    const totals = log
      ? crewSummary(log, testUserIds)
      : { bh: 0, ah: 0, efficiency: null, jobCount: 0 };
    const allowance = getCrewAllowance(crew, log || null, settings || null, testUserIds);
    const adjusted = adjustedEfficiency(totals.efficiency, allowance.pct);
    const memberNames = (crew.employees || [])
      .filter(id => !testUserIds.has(id))
      .map(id => empById.get(id)?.name || '')
      .filter(Boolean);
    entries.push({
      crew,
      crewLabel: `${crew.division} #${crew.crewNumber}`,
      bh: totals.bh,
      ah: totals.ah,
      efficiency: adjusted,
      rawEfficiency: totals.efficiency,
      allowancePct: allowance.pct,
      scheduledSize: allowance.size,
      jobCount: totals.jobCount,
      memberNames,
      eligible: totals.bh > LEADERBOARD_MIN_BH,
    });
  }
  return entries;
}

// Splits the unranked list into [eligible (sorted by eff desc),
// ineligible (original schedule order)] and concatenates so a single
// render can iterate the result and show the "not enough data" group
// at the bottom via the `eligible` flag on each row.
export function rankLeaderboard(
  entries: CrewLeaderboardEntry[],
): CrewLeaderboardEntry[] {
  const eligible = entries.filter(e => e.eligible);
  const ineligible = entries.filter(e => !e.eligible);
  eligible.sort((a, b) => {
    const ea = a.efficiency ?? -Infinity;
    const eb = b.efficiency ?? -Infinity;
    return eb - ea;
  });
  return [...eligible, ...ineligible];
}

// Returns the spotlight winner — the highest-efficiency eligible
// crew — or null if no crew has yet crossed the BH threshold.
export function topCrew(
  entries: CrewLeaderboardEntry[],
): CrewLeaderboardEntry | null {
  const ranked = rankLeaderboard(entries);
  const first = ranked[0];
  return first && first.eligible ? first : null;
}

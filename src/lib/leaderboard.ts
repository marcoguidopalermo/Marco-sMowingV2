import { Crew, Employee, PerformanceLog, DeductionValue } from '../types';
import { deductHours } from './efficiency';

// Minimum credited BH a crew needs before it's eligible for ranking.
// Below this we treat the crew as "not enough data yet" — keeps the
// leaderboard from crowning a crew that's barely started.
export const LEADERBOARD_MIN_BH = 5;

export interface CrewLeaderboardEntry {
  crew: Crew;
  crewLabel: string;
  bh: number;
  ah: number;
  efficiency: number | null;
  jobCount: number;
  memberNames: string[];
  // True when bh > LEADERBOARD_MIN_BH. Eligible entries are ranked
  // by efficiency desc; ineligible ones fall to the bottom group.
  eligible: boolean;
}

// Crew-level totals — character-for-character the same math
// PerformanceBoard does in calcReports's per-crew block (BH summed
// from jobs; net AH = max(0, raw AH − total deductions);
// efficiency = BH / AH × 100). Reuses deductHours from efficiency.ts.
function crewTotals(log: PerformanceLog): {
  bh: number;
  ah: number;
  efficiency: number | null;
  jobCount: number;
} {
  const bh = (log.jobs || []).reduce(
    (s, j) => s + Number(j.bh || 0),
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
  const ah = Math.max(0, rawAH - deducAH);
  const efficiency = ah > 0 ? Number(((bh / ah) * 100).toFixed(1)) : null;
  return { bh, ah, efficiency, jobCount: (log.jobs || []).length };
}

// Builds an unranked leaderboard for a given Toronto date. Crews
// scheduled that day with no performance entry surface as
// zero/ineligible rather than being dropped, so a crew that hasn't
// reported anything yet still appears in the Dashboard "not enough
// data" group.
export function buildCrewLeaderboard(
  date: string,
  schedules: Record<string, Crew[]>,
  performance: Record<string, Record<string, PerformanceLog>>,
  employees: Employee[],
): CrewLeaderboardEntry[] {
  const dayCrews = schedules[date] || [];
  const dayPerf = performance[date] || {};
  const empById = new Map(employees.map(e => [e.id, e]));

  const entries: CrewLeaderboardEntry[] = [];
  for (const crew of dayCrews) {
    const log = dayPerf[crew.id];
    const totals = log
      ? crewTotals(log)
      : { bh: 0, ah: 0, efficiency: null, jobCount: 0 };
    const memberNames = (crew.employees || [])
      .map(id => empById.get(id)?.name || '')
      .filter(Boolean);
    entries.push({
      crew,
      crewLabel: `${crew.division} #${crew.crewNumber}`,
      bh: totals.bh,
      ah: totals.ah,
      efficiency: totals.efficiency,
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

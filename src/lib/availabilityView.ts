// WHO IS FREE TODAY — the read-only model behind the schedule board's
// Availability toggle.
//
// The morning question this answers: crews are being reshuffled before they
// leave, so a manager needs to see who isn't on a crew yet, which crews are
// running above or below their normal size, and who is away. Nothing here
// writes; every value is derived from data the board already holds.
//
// DELIBERATELY ABSENT: any notion of an employee being "extra", "spare" or
// "borrowed". Crews get reshuffled and the schedule ends up correct, so a
// marker for that would describe a state that exists only during a morning
// conversation and would rot the first time somebody forgot to clear it.
// Above/below normal is computed live from the schedule instead.
import type { AppData, Crew, Employee } from '../types';
import { getResourceAvailability } from './availability';
import { addDaysToronto } from './dateUtils';

// Map an employee's primaryCrew onto the schedule board's division names, so
// this view's division filter lines up with the board's own control. Office /
// Snow / unset carry no division and appear only under "All".
export function employeeDivisionName(emp: Pick<Employee, 'primaryCrew'>): string | null {
  switch (emp.primaryCrew) {
    case 'Lawn': return 'Lawn Division';
    case 'Small Project': return 'Small Projects';
    case 'Large Project': return 'Large Projects';
    default: return null;
  }
}

// Statuses that count as currently employed. An ALLOWLIST on purpose: if a
// status this doesn't know about ever appears, the person is left out rather
// than offered up as free labour. Being wrongly absent from the list is a
// question someone asks; being wrongly present sends a manager to assign
// somebody who has left.
const EMPLOYED_STATUSES = new Set(['Active', 'Away']);
export const isEmployed = (e: Pick<Employee, 'status' | 'isTestUser'>): boolean =>
  !e.isTestUser && EMPLOYED_STATUSES.has(String(e.status));

export const crewKey = (division: string, crewNumber: number): string =>
  `${division} #${crewNumber}`;

// ── TYPICAL CREW SIZE ──────────────────────────────────────────────────────
// Restored from the capacity work (Capacity v1.4, lib/capacity.ts) rather than
// redefined: four weeks of STRICTLY PAST scheduled days, reduced to a MEDIAN.
// That version was dropped when capacity was rebuilt around declared figures,
// so there was no live definition left to share — this is the same rule, moved
// somewhere it can be reused, not a second one invented alongside it.
//
// Why those choices, from the original:
//   · 28 days — long enough to be representative, short enough to track a crew
//     that has genuinely changed shape this season.
//   · Strictly past — a day still in progress is only half-assigned, and a day
//     roughed in for next week is not evidence of anything.
//   · Median, not mean or latest — one rain day, one split crew or one
//     half-built day moves a mean and dominates a "latest", but barely moves a
//     median.
//
// NOTE this is NOT the schedule-derived sizing the capacity types warn against.
// That warning is about Jobber ASSIGNEES, which are route slots rather than
// people. This counts crew.employees — the people a manager put on a crew.
export const TYPICAL_LOOKBACK_DAYS = 28;

export interface TypicalSize {
  size: number;
  days: number;                       // past scheduled days it was drawn from
  source: 'observed' | 'declared';
}

export function typicalCrewSizes(
  schedules: Record<string, Crew[]>,
  testUserIds: Set<string>,
  today: string,
  lookbackDays: number = TYPICAL_LOOKBACK_DAYS,
): Map<string, TypicalSize> {
  const from = addDaysToronto(today, -lookbackDays);
  const past = new Map<string, number[]>();
  for (const [date, crews] of Object.entries(schedules || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!(date < today && date >= from)) continue;
    for (const crew of crews || []) {
      if (!crew?.division || !crew?.crewNumber) continue;
      const size = (crew.employees || []).filter(id => !testUserIds.has(id)).length;
      if (size <= 0) continue;                   // an empty day is not evidence
      const key = crewKey(crew.division, crew.crewNumber);
      const arr = past.get(key);
      if (arr) arr.push(size); else past.set(key, [size]);
    }
  }
  const out = new Map<string, TypicalSize>();
  for (const [key, arr] of past) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
    out.set(key, { size: Math.round(median), days: sorted.length, source: 'observed' });
  }
  return out;
}

// ── THE DAY MODEL ──────────────────────────────────────────────────────────
export interface PersonRow {
  id: string;
  name: string;
  division: string | null;            // who they normally work with
}
export interface AwayRow extends PersonRow {
  kind: 'booked_off' | 'absent';
  reason: string;                     // 'vacation' | 'sick' | 'other'
}
export interface CrewHeadcount {
  key: string;
  division: string;
  crewNumber: number;
  today: number;
  typical: TypicalSize | null;
  // today − typical. null when there is no typical to compare against, which
  // is different from 0 and must not render as "on norm".
  delta: number | null;
  people: PersonRow[];
}
export interface AvailabilityDay {
  date: string;
  division: string;                   // 'All' or a DIVISIONS entry
  unassigned: PersonRow[];
  away: AwayRow[];
  crews: CrewHeadcount[];
  // Roster totals for the chosen division, so the header can say 12 of 18
  // rather than leaving the reader to add up cards.
  totals: { employed: number; assigned: number; unassigned: number; away: number };
}

export function buildAvailabilityDay(
  appData: Pick<AppData, 'employees' | 'schedules' | 'dailyAbsences' | 'fleet'>,
  date: string,
  division: string,
  lookbackDays: number = TYPICAL_LOOKBACK_DAYS,
): AvailabilityDay {
  const employees = appData.employees || [];
  const testUserIds = new Set(employees.filter(e => e.isTestUser).map(e => e.id));
  const roster = employees.filter(isEmployed);
  const byId = new Map(roster.map(e => [e.id, e]));

  const inDivision = (d: string | null) => division === 'All' || d === division;
  const row = (e: Employee): PersonRow => ({
    id: e.id, name: e.name, division: employeeDivisionName(e),
  });

  const unassigned: PersonRow[] = [];
  const away: AwayRow[] = [];
  let assigned = 0;

  for (const e of roster) {
    const div = employeeDivisionName(e);
    if (!inDivision(div)) continue;
    // The SAME resolver the board uses to decide whether someone can be
    // dropped on a crew, so this view can never disagree with the board about
    // who is free.
    const st = getResourceAvailability(e.id, 'employee', date, appData as AppData);
    switch (st.status) {
      case 'available':
        unassigned.push(row(e));
        break;
      case 'assigned':
        assigned++;
        break;
      case 'booked_off':
        away.push({ ...row(e), kind: 'booked_off', reason: st.reason });
        break;
      case 'absent':
        away.push({ ...row(e), kind: 'absent', reason: st.reason });
        break;
      default:
        break;
    }
  }
  unassigned.sort((a, b) => (a.division || 'zz').localeCompare(b.division || 'zz') || a.name.localeCompare(b.name));
  away.sort((a, b) => a.name.localeCompare(b.name));

  const typical = typicalCrewSizes(appData.schedules || {}, testUserIds, date, lookbackDays);
  const crews: CrewHeadcount[] = [];
  for (const crew of (appData.schedules || {})[date] || []) {
    if (!crew?.division || !crew?.crewNumber) continue;
    if (!inDivision(crew.division)) continue;
    const ids = (crew.employees || []).filter(id => !testUserIds.has(id));
    const key = crewKey(crew.division, crew.crewNumber);
    const t = typical.get(key) || null;
    crews.push({
      key,
      division: crew.division,
      crewNumber: crew.crewNumber,
      today: ids.length,
      typical: t,
      delta: t ? ids.length - t.size : null,
      people: ids.map(id => {
        const e = byId.get(id);
        return e ? row(e) : { id, name: 'Unknown', division: null };
      }),
    });
  }
  crews.sort((a, b) => a.division.localeCompare(b.division) || a.crewNumber - b.crewNumber);

  const employed = roster.filter(e => inDivision(employeeDivisionName(e))).length;
  return {
    date,
    division,
    unassigned,
    away,
    crews,
    totals: { employed, assigned, unassigned: unassigned.length, away: away.length },
  };
}

// WHO IS FREE TODAY — the read-only model behind the schedule board's
// Availability toggle.
//
// The morning question this answers: crews are being reshuffled before they
// leave, so a manager needs to see who isn't on a crew yet, how many people
// each crew actually has today, and who is away. Nothing here writes; every
// value is derived from data the board already holds.
//
// DELIBERATELY ABSENT: any notion of an employee being "extra", "spare" or
// "borrowed". Crews get reshuffled and the schedule ends up correct, so a
// marker for that would describe a state that exists only during a morning
// conversation and would rot the first time somebody forgot to clear it.
// Also absent, and for a different reason, is any inferred "usual" crew size —
// see LENDABLE_MIN_HEADCOUNT below.
import type { AppData, Crew, Employee } from '../types';
import { getResourceAvailability } from './availability';

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

// ── LENDABLE ───────────────────────────────────────────────────────────────
// A crew with two or more people has somebody who could move to another crew
// this morning. A crew of one does not, and is shown but never flagged.
//
// THERE IS DELIBERATELY NO "USUAL SIZE" HERE. An earlier version compared
// today's headcount against a norm inferred from past scheduled days, and that
// comparison is not what the decision turns on — a manager reshuffling at 6:45
// wants to know who is actually standing there, not whether the count is
// unusual. Inference had also already caused a real bug once: the capacity
// version read the furthest-forward built day, so a thin day roughed in for
// next week defined the norm and three of four Small Projects crews reported
// the wrong size. Today's headcount is a fact; a norm is a statistic that can
// be wrong, and being wrong here costs someone a crew member.
export const LENDABLE_MIN_HEADCOUNT = 2;

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
  // Today's ACTUAL headcount — people on the crew, test users excluded.
  today: number;
  // Two or more people, so one of them could go somewhere else this morning.
  canLend: boolean;
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

  const crews: CrewHeadcount[] = [];
  for (const crew of (appData.schedules || {})[date] || []) {
    if (!crew?.division || !crew?.crewNumber) continue;
    if (!inDivision(crew.division)) continue;
    const ids = (crew.employees || []).filter(id => !testUserIds.has(id));
    crews.push({
      key: crewKey(crew.division, crew.crewNumber),
      division: crew.division,
      crewNumber: crew.crewNumber,
      today: ids.length,
      canLend: ids.length >= LENDABLE_MIN_HEADCOUNT,
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

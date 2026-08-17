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

// INACTIVE vs AWAY — two different things that were being shown as one.
//
// The Personnel screen's status control offers exactly "Active" and "Away
// (Indefinite)", and "Away (Indefinite)" means NOT CURRENTLY WORKING HERE. It
// is not booked-off: booked-off comes from employee.awayDates (a dated vacation
// range) and same-day absence comes from dailyAbsences. Availability was
// treating status 'Away' as an absence and listing those people under "Away
// today" beside someone on vacation, which reads as "back next week" for
// somebody who is not on the roster at all.
//
// So inactive people are EXCLUDED from availability entirely rather than
// relabelled: they are not in the roster count, not unassigned, and not away.
// A manager placing crews at 6:45 is choosing among people who work here; a
// former or indefinitely-away employee is not a candidate, and showing them in
// any bucket only invites the question of why they are there. The count of them
// is surfaced as a footnote so nobody silently disappears.
//
// The substring test matches the one App.tsx already uses to decide who can be
// impersonated, so "Inactive", "Archived" and "Terminated" behave the same way
// if they ever appear — one definition of inactive, not two.
export const isInactiveEmployeeStatus = (status: string | undefined): boolean => {
  const v = (status || '').toLowerCase();
  return v.includes('away') || v.includes('inactive')
    || v.includes('archive') || v.includes('terminat');
};

// Currently working here.
export const isActiveEmployee = (e: Pick<Employee, 'status' | 'isTestUser'>): boolean =>
  !e.isTestUser && !isInactiveEmployeeStatus(e.status);

// ── WHO THIS VIEW IS ABOUT ─────────────────────────────────────────────────
// Availability answers "who is waiting to be put on a crew". That is a narrower
// set than "everyone employed", and the two kept disagreeing: the count included
// office staff and the managers doing the placing, while the list showed neither.
//
// A DENYLIST of roles, not an allowlist, and the distinction is not stylistic.
// resolveRole() treats a MISSING systemRole as 'worker', and on live data 19 of
// the ~20 people actually appearing on crews have no systemRole set at all. An
// allowlist of ['worker','foreman'] would therefore have hidden almost every
// crew member. Excluding named non-crew roles keeps unset records — the actual
// crew — where they belong.
//
// EXCLUDED, and why:
//   admin, manager      — they DO the morning placement; they are not waiting
//                         to be placed. (Note: three division managers do also
//                         work on crews. They still appear by name on their
//                         crew card, which reads from crew.employees; they are
//                         just not counted in the placeable roster.)
//   mechanic            — verified against live schedules: across every day
//                         built, no mechanic has ever been placed on a crew.
//                         They work the shop, not a route.
//   contractor          — Palermo's tenant; its own scheduling entirely.
//   property_manager    — leases and properties, not crews.
//   marketing           — marketing-only role, sees nothing else in the app.
// INCLUDED: worker, foreman, and any record with no systemRole (the crew).
const NON_PLACEABLE_ROLES = new Set<string>([
  'admin', 'manager', 'mechanic', 'contractor', 'property_manager', 'marketing',
]);
export const PLACEABLE_ROLES_NOTE = 'crew members and foremen';

// Somebody a manager could put on a crew this morning: active, in a crew
// division, and not in a role that does something else.
//
// A DIVISION IS REQUIRED. Office / Snow / unset primaryCrew resolve to no
// division (see employeeDivisionName) and are excluded from both the list and
// the counts — the two must agree, and an office record that is "unassigned"
// every day of the year was never a candidate for a crew.
export const isPlaceableOnCrew = (e: Employee): boolean =>
  isActiveEmployee(e)
  && !NON_PLACEABLE_ROLES.has(String(e.systemRole || 'worker'))
  && employeeDivisionName(e) !== null;

// Active employees this view deliberately leaves out, so the screen can say so
// rather than letting a roster count quietly disagree with the company.
export const countNonPlaceable = (employees: Employee[]): number =>
  employees.filter(e => isActiveEmployee(e) && !isPlaceableOnCrew(e)).length;

// How many records are being withheld as inactive, so the view can say so
// rather than letting people quietly vanish from a roster count.
export const countInactive = (
  employees: Pick<Employee, 'status' | 'isTestUser'>[],
): number => employees.filter(e => !e.isTestUser && isInactiveEmployeeStatus(e.status)).length;

export const crewKey = (division: string, crewNumber: number): string =>
  `${division} #${crewNumber}`;

// ── LENDABLE ───────────────────────────────────────────────────────────────
// A crew of THREE or more has somebody who could move this morning. A crew of
// two cannot spare one — that would leave a person working alone — so two is
// shown like any other count and never flagged.
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
export const LENDABLE_MIN_HEADCOUNT = 3;

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

// ── WHO IS MY MANAGER ──────────────────────────────────────────────────────
// A worker's division comes from primaryCrew ("Lawn" / "Small Project" /
// "Large Project"); a manager carries managedDivision ("lawn" / "small" /
// "large" / "all"). This maps the first onto the second's vocabulary.
//
// MIRRORED SERVER-SIDE in functions/src/notifications.ts (pushAvailableForWork)
// which resolves recipients itself and never trusts an address from the client.
// This copy exists only so the screen can SAY whose attention it is about to
// get — if the two ever disagree, the server's answer is the one that delivers.
export const managedDivisionKey = (emp: Pick<Employee, 'primaryCrew'>): string | null => {
  const c = (emp.primaryCrew || '').toLowerCase();
  if (c.includes('lawn')) return 'lawn';
  if (c.includes('small')) return 'small';
  if (c.includes('large')) return 'large';
  return null;
};

export interface ManagerRef {
  id: string;
  name: string;
  email: string;
  scope: string;                      // managedDivision, or 'admin'
}

// OWN DIVISION MANAGER ONLY, falling back to admin.
//
// Not every manager: a lawn worker saying "I'm available" should reach whoever
// runs the lawn roster, not everyone with a management role. Copying people who
// have no say over that roster is how a notification type teaches its audience
// to ignore it.
//
// The fallback matters more than the primary path — somebody stranded must
// always reach a human. If the division has no manager set, or the person has no
// division to route by, it goes to admin (and to any all-division manager, who
// is an admin for this purpose).
//
// MIRRORED SERVER-SIDE in functions/src/notifications.ts (pushAvailableForWork),
// which resolves recipients itself and never trusts an address from the client.
// This copy only decides what the screen SAYS; the server's answer is the one
// that delivers, and the two rules are kept identical on purpose.
export function managersForEmployee(
  employees: Employee[],
  emp: Pick<Employee, 'id' | 'primaryCrew'> | null | undefined,
): ManagerRef[] {
  if (!emp) return [];
  const mine = managedDivisionKey(emp);
  const ref = (e: Employee, scope: string): ManagerRef | null => {
    if (e.id === emp.id) return null;              // never yourself
    if (!isActiveEmployee(e)) return null;         // an inactive manager can't act
    const email = (e.linkedUserEmail || e.email || '').trim();
    if (!email) return null;                       // nobody to notify
    return { id: e.id, name: e.name || email, email, scope };
  };

  if (mine) {
    const own = employees
      .filter(e => (e.managedDivision || '').toLowerCase() === mine)
      .map(e => ref(e, mine))
      .filter((m): m is ManagerRef => m !== null);
    if (own.length > 0) return own.sort((a, b) => a.name.localeCompare(b.name));
  }
  // Fallback: admin, plus all-division managers.
  return employees
    .filter(e => e.systemRole === 'admin' || (e.managedDivision || '').toLowerCase() === 'all')
    .map(e => ref(e, 'admin'))
    .filter((m): m is ManagerRef => m !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── BUILT vs UNBUILT ───────────────────────────────────────────────────────
// A day only tells you something about availability once somebody has actually
// scheduled it. Before that, NOBODY is on a crew, so a naive "who isn't on a
// crew" reading reports the entire roster as free — and every future day in a
// month grid lights up as fully available, which is not information, it is
// noise that hides the days that do mean something.
//
// The test is whether any crew that day has at least one person on it. Crews
// created but left empty are mid-build and count as unbuilt for the same
// reason: the assignment work hasn't happened yet, so the absence of
// assignments says nothing about who is free.
export function isDayBuilt(schedules: Record<string, Crew[]>, date: string): boolean {
  const crews = (schedules || {})[date] || [];
  return crews.some(c => (c?.employees || []).length > 0);
}

export interface AvailabilityMonthDay {
  date: string;
  built: boolean;
  // Only meaningful when built. On an unbuilt day these are empty rather than
  // "everyone", so a caller that forgets to check `built` under-reports rather
  // than claiming the whole roster is available.
  unassigned: PersonRow[];
  count: number;
  crewCount: number;
}

// One entry per date in [fromDate, toDate] inclusive. Used by the month grid;
// the daily view calls buildAvailabilityDay directly for the day it shows.
export function buildAvailabilityMonth(
  appData: Pick<AppData, 'employees' | 'schedules' | 'dailyAbsences' | 'fleet'>,
  fromDate: string,
  toDate: string,
  division: string,
): AvailabilityMonthDay[] {
  const out: AvailabilityMonthDay[] = [];
  const schedules = appData.schedules || {};
  // Walk by string date rather than by Date arithmetic so a DST boundary
  // cannot skip or repeat a day.
  const cur = new Date(`${fromDate}T12:00:00Z`);
  const end = new Date(`${toDate}T12:00:00Z`);
  while (cur <= end) {
    const date = cur.toISOString().slice(0, 10);
    const built = isDayBuilt(schedules, date);
    if (built) {
      // No extra filtering here: buildAvailabilityDay's roster is already the
      // placeable set, so office staff, managers and admin are out of both the
      // month and the day by construction rather than by two separate rules
      // that could drift apart.
      const day = buildAvailabilityDay(appData, date, division);
      out.push({
        date, built: true,
        unassigned: day.unassigned,
        count: day.unassigned.length,
        crewCount: day.crews.length,
      });
    } else {
      out.push({ date, built: false, unassigned: [], count: 0, crewCount: 0 });
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function buildAvailabilityDay(
  appData: Pick<AppData, 'employees' | 'schedules' | 'dailyAbsences' | 'fleet'>,
  date: string,
  division: string,
): AvailabilityDay {
  const employees = appData.employees || [];
  const testUserIds = new Set(employees.filter(e => e.isTestUser).map(e => e.id));
  // The placeable roster — see isPlaceableOnCrew. Every bucket and every
  // total below is computed over exactly this set, so the numbers and the lists
  // can never disagree.
  const roster = employees.filter(isPlaceableOnCrew);
  // Name lookup spans EVERY employee record, not just the placeable roster.
  // Crew cards list whoever the schedule put on the crew — including a working
  // division manager, who is deliberately outside the roster — and resolving
  // those names from the narrowed roster rendered them as "Unknown".
  const byId = new Map(employees.map(e => [e.id, e]));

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

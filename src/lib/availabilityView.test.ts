// Tests for the availability model.
//   npm test -- availabilityView
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildAvailabilityDay, isEmployed, employeeDivisionName, LENDABLE_MIN_HEADCOUNT,
} from './availabilityView';
import type { AppData, Crew, Employee } from '../types';

const emp = (o: Partial<Employee> & { id: string; name: string }): Employee => ({
  status: 'Active', hasLicense: false, hasClassA: false, hasHeavyMachinery: false,
  awayDates: [], ...o,
} as Employee);

const crew = (division: string, crewNumber: number, employees: string[]): Crew => ({
  id: `${division}-${crewNumber}`, division, crewNumber, employees, fleet: [], inventory: [],
});

const app = (o: Partial<AppData>): AppData => ({
  employees: [], schedules: {}, dailyAbsences: {}, fleet: [], ...o,
} as AppData);

console.log('\nRoster membership');
test('employed = Active or Away, never a test user', () => {
  assert.equal(isEmployed(emp({ id: 'a', name: 'A' })), true);
  assert.equal(isEmployed(emp({ id: 'b', name: 'B', status: 'Away' })), true);
  assert.equal(isEmployed(emp({ id: 'c', name: 'C', isTestUser: true })), false);
  // An unknown status is EXCLUDED, not included — the safe direction is to
  // omit someone rather than offer a departed employee as free labour.
  assert.equal(isEmployed(emp({ id: 'd', name: 'D', status: 'Terminated' })), false);
  assert.equal(isEmployed(emp({ id: 'e', name: 'E', status: 'Inactive' })), false);
});
test('division name maps primaryCrew onto the board’s division names', () => {
  assert.equal(employeeDivisionName({ primaryCrew: 'Lawn' }), 'Lawn Division');
  assert.equal(employeeDivisionName({ primaryCrew: 'Small Project' }), 'Small Projects');
  assert.equal(employeeDivisionName({ primaryCrew: 'Large Project' }), 'Large Projects');
  // Office / Snow / unset carry no division.
  assert.equal(employeeDivisionName({ primaryCrew: 'Office' }), null);
  assert.equal(employeeDivisionName({}), null);
});

console.log('\nThe day model');
const people: Employee[] = [
  emp({ id: 'l1', name: 'Lawn One', primaryCrew: 'Lawn' }),
  emp({ id: 'l2', name: 'Lawn Two', primaryCrew: 'Lawn' }),
  emp({ id: 'l3', name: 'Lawn Three', primaryCrew: 'Lawn' }),
  emp({ id: 's1', name: 'Small One', primaryCrew: 'Small Project' }),
  emp({ id: 'o1', name: 'Office One', primaryCrew: 'Office' }),
  emp({ id: 'gone', name: 'Departed', status: 'Terminated' }),
  emp({ id: 'test', name: 'Test User', isTestUser: true }),
];

test('unassigned = employed, not away, not on a crew today', () => {
  const d = buildAvailabilityDay(app({
    employees: people,
    schedules: { '2026-08-17': [crew('Lawn Division', 1, ['l1'])] },
  }), '2026-08-17', 'All');
  assert.deepEqual(d.unassigned.map(p => p.id).sort(), ['l2', 'l3', 'o1', 's1']);
  // Departed and test users never appear anywhere.
  assert.ok(!d.unassigned.some(p => p.id === 'gone' || p.id === 'test'));
  // And the division travels with the name, so it's obvious who they work with.
  assert.equal(d.unassigned.find(p => p.id === 'l2')!.division, 'Lawn Division');
  assert.equal(d.unassigned.find(p => p.id === 'o1')!.division, null);
});

test('booked off and absent are separated, and are not "unassigned"', () => {
  const d = buildAvailabilityDay(app({
    employees: [
      emp({ id: 'v', name: 'Vacationer', primaryCrew: 'Lawn', awayDates: [{ start: '2026-08-15', end: '2026-08-20' }] }),
      emp({ id: 'sick', name: 'Sick Person', primaryCrew: 'Lawn' }),
      emp({ id: 'ind', name: 'Away Indef', primaryCrew: 'Lawn', status: 'Away' }),
      emp({ id: 'free', name: 'Free Person', primaryCrew: 'Lawn' }),
    ],
    dailyAbsences: { '2026-08-17': ['sick'] },
  }), '2026-08-17', 'All');
  assert.deepEqual(d.unassigned.map(p => p.id), ['free']);
  const away = new Map(d.away.map(a => [a.id, a]));
  assert.equal(away.get('v')!.kind, 'booked_off');
  assert.equal(away.get('v')!.reason, 'vacation');
  assert.equal(away.get('sick')!.kind, 'absent');
  assert.equal(away.get('sick')!.reason, 'sick');
  assert.equal(away.get('ind')!.kind, 'absent');
  assert.equal(d.totals.away, 3);
});

test('every employed person in the division lands in exactly one bucket', () => {
  const d = buildAvailabilityDay(app({
    employees: people,
    schedules: { '2026-08-17': [crew('Lawn Division', 1, ['l1', 'l2'])] },
  }), '2026-08-17', 'All');
  assert.equal(d.totals.assigned + d.totals.unassigned + d.totals.away, d.totals.employed);
});

test('crew headcount is today’s ACTUAL count, and 2+ is flagged as lendable', () => {
  const schedules: Record<string, Crew[]> = {
    // Past days are irrelevant now — a crew that ran 5 last week and 1 today
    // reads as 1, with no norm anywhere in the answer.
    '2026-08-13': [crew('Lawn Division', 3, ['l1', 'l2', 'l3', 's1', 'o1'])],
    '2026-08-17': [
      crew('Lawn Division', 1, ['l1', 'l2', 'l3']),   // 3 → lendable
      crew('Lawn Division', 2, ['s1', 'o1']),         // 2 → lendable (the boundary)
      crew('Lawn Division', 3, ['l1']),               // 1 → shown, NOT lendable
    ],
  };
  const d = buildAvailabilityDay(app({ employees: people, schedules }), '2026-08-17', 'All');
  const by = new Map(d.crews.map(c => [c.key, c]));
  assert.equal(by.get('Lawn Division #1')!.today, 3);
  assert.equal(by.get('Lawn Division #1')!.canLend, true);
  // Exactly at the threshold counts.
  assert.equal(by.get('Lawn Division #2')!.today, 2);
  assert.equal(by.get('Lawn Division #2')!.canLend, true);
  // A crew of one is listed but never offered up.
  assert.equal(by.get('Lawn Division #3')!.today, 1);
  assert.equal(by.get('Lawn Division #3')!.canLend, false);
  assert.equal(LENDABLE_MIN_HEADCOUNT, 2);
});
test('past days cannot influence today’s headcount at all', () => {
  // The whole reason the norm was dropped: a thin or fat day elsewhere in the
  // schedule must not change what this view reports for today.
  const base: Record<string, Crew[]> = { '2026-08-17': [crew('Lawn Division', 1, ['l1', 'l2'])] };
  const withHistory: Record<string, Crew[]> = {
    '2026-08-10': [crew('Lawn Division', 1, ['l1', 'l2', 'l3', 's1'])],
    '2026-08-18': [crew('Lawn Division', 1, ['l1'])],            // future, thin
    ...base,
  };
  const a = buildAvailabilityDay(app({ employees: people, schedules: base }), '2026-08-17', 'All');
  const b = buildAvailabilityDay(app({ employees: people, schedules: withHistory }), '2026-08-17', 'All');
  assert.deepEqual(
    a.crews.map(c => ({ key: c.key, today: c.today, canLend: c.canLend })),
    b.crews.map(c => ({ key: c.key, today: c.today, canLend: c.canLend })),
  );
});
test('an empty crew reads as 0 and is not lendable', () => {
  const d = buildAvailabilityDay(app({
    employees: people,
    schedules: { '2026-08-17': [crew('Lawn Division', 1, [])] },
  }), '2026-08-17', 'All');
  assert.equal(d.crews[0].today, 0);
  assert.equal(d.crews[0].canLend, false);
});
test('test users do not pad a headcount into being lendable', () => {
  const d = buildAvailabilityDay(app({
    employees: [...people, emp({ id: 'test2', name: 'Test Two', isTestUser: true })],
    schedules: { '2026-08-17': [crew('Lawn Division', 1, ['l1', 'test2'])] },
  }), '2026-08-17', 'All');
  assert.equal(d.crews[0].today, 1);
  assert.equal(d.crews[0].canLend, false);
});

test('the division filter narrows people AND crews together', () => {
  const schedules: Record<string, Crew[]> = {
    '2026-08-17': [crew('Lawn Division', 1, ['l1']), crew('Small Projects', 1, ['s1'])],
  };
  const lawn = buildAvailabilityDay(app({ employees: people, schedules }), '2026-08-17', 'Lawn Division');
  assert.deepEqual(lawn.crews.map(c => c.key), ['Lawn Division #1']);
  assert.deepEqual(lawn.unassigned.map(p => p.id).sort(), ['l2', 'l3']);
  // Office staff carry no division, so they only show under All.
  assert.ok(!lawn.unassigned.some(p => p.id === 'o1'));
  const all = buildAvailabilityDay(app({ employees: people, schedules }), '2026-08-17', 'All');
  assert.ok(all.unassigned.some(p => p.id === 'o1'));
});

test('a day with no schedule built shows everyone as unassigned, no crews', () => {
  const d = buildAvailabilityDay(app({ employees: people }), '2026-08-17', 'All');
  assert.equal(d.crews.length, 0);
  assert.equal(d.unassigned.length, 5);       // the 5 employed, non-test people
  assert.equal(d.totals.assigned, 0);
});

test('a person on two crews is counted once as assigned', () => {
  // Shouldn't happen, but the resolver returns the first match and the model
  // must not double-count the roster if it does.
  const d = buildAvailabilityDay(app({
    employees: people,
    schedules: { '2026-08-17': [crew('Lawn Division', 1, ['l1']), crew('Lawn Division', 2, ['l1'])] },
  }), '2026-08-17', 'All');
  assert.equal(d.totals.assigned, 1);
  assert.equal(d.totals.assigned + d.totals.unassigned + d.totals.away, d.totals.employed);
});

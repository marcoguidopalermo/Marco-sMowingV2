// Tests for the availability model.
//   npm test -- availabilityView
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildAvailabilityDay, typicalCrewSizes, isEmployed, employeeDivisionName, crewKey,
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

console.log('\nTypical crew size (28-day past median)');
test('median of past scheduled sizes, ignoring today and the future', () => {
  const schedules: Record<string, Crew[]> = {
    '2026-08-10': [crew('Lawn Division', 1, ['a', 'b', 'c'])],
    '2026-08-11': [crew('Lawn Division', 1, ['a', 'b', 'c'])],
    '2026-08-12': [crew('Lawn Division', 1, ['a'])],            // one thin day
    '2026-08-13': [crew('Lawn Division', 1, ['a', 'b', 'c'])],
    '2026-08-17': [crew('Lawn Division', 1, ['a'])],            // TODAY — excluded
    '2026-08-18': [crew('Lawn Division', 1, ['a'])],            // future — excluded
  };
  const t = typicalCrewSizes(schedules, new Set(), '2026-08-17');
  const v = t.get(crewKey('Lawn Division', 1))!;
  assert.equal(v.size, 3, 'a single thin day must not drag the norm down');
  assert.equal(v.days, 4, 'only the four past days count');
  assert.equal(v.source, 'observed');
});
test('a day outside the 28-day window is not evidence', () => {
  const schedules: Record<string, Crew[]> = {
    '2026-06-01': [crew('Lawn Division', 1, ['a', 'b', 'c', 'd', 'e'])],   // long ago
    '2026-08-16': [crew('Lawn Division', 1, ['a', 'b'])],
  };
  const t = typicalCrewSizes(schedules, new Set(), '2026-08-17');
  assert.equal(t.get(crewKey('Lawn Division', 1))!.size, 2);
  assert.equal(t.get(crewKey('Lawn Division', 1))!.days, 1);
});
test('empty crew-days and test users are excluded from the norm', () => {
  const schedules: Record<string, Crew[]> = {
    '2026-08-14': [crew('Lawn Division', 1, [])],                 // built but unstaffed
    '2026-08-15': [crew('Lawn Division', 1, ['a', 'b', 'test'])],
  };
  const t = typicalCrewSizes(schedules, new Set(['test']), '2026-08-17');
  const v = t.get(crewKey('Lawn Division', 1))!;
  assert.equal(v.size, 2);
  assert.equal(v.days, 1, 'the unstaffed day contributes nothing');
});
test('an even number of days averages the two middle values, then rounds', () => {
  const schedules: Record<string, Crew[]> = {
    '2026-08-13': [crew('Lawn Division', 1, ['a'])],
    '2026-08-14': [crew('Lawn Division', 1, ['a', 'b'])],
    '2026-08-15': [crew('Lawn Division', 1, ['a', 'b', 'c'])],
    '2026-08-16': [crew('Lawn Division', 1, ['a', 'b', 'c', 'd'])],
  };
  // median of [1,2,3,4] = 2.5 → 3
  assert.equal(typicalCrewSizes(schedules, new Set(), '2026-08-17').get(crewKey('Lawn Division', 1))!.size, 3);
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

test('headcount vs typical: above, below, on norm, and no norm at all', () => {
  const schedules: Record<string, Crew[]> = {
    // Four past days at three people for #1, two for #2.
    '2026-08-13': [crew('Lawn Division', 1, ['l1', 'l2', 'l3']), crew('Lawn Division', 2, ['s1', 'o1'])],
    '2026-08-14': [crew('Lawn Division', 1, ['l1', 'l2', 'l3']), crew('Lawn Division', 2, ['s1', 'o1'])],
    '2026-08-17': [
      crew('Lawn Division', 1, ['l1', 'l2', 'l3', 's1']),   // 4 vs 3 → +1, one to lend
      crew('Lawn Division', 2, ['o1']),                      // 1 vs 2 → −1, short
      crew('Lawn Division', 3, ['l1']),                      // brand new crew → no norm
    ],
  };
  const d = buildAvailabilityDay(app({ employees: people, schedules }), '2026-08-17', 'All');
  const by = new Map(d.crews.map(c => [c.key, c]));
  assert.equal(by.get('Lawn Division #1')!.delta, 1);
  assert.equal(by.get('Lawn Division #2')!.delta, -1);
  // A crew with no history has NO delta — that is not the same as "on norm",
  // and must never render as a crew sitting exactly at its usual size.
  assert.equal(by.get('Lawn Division #3')!.typical, null);
  assert.equal(by.get('Lawn Division #3')!.delta, null);
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

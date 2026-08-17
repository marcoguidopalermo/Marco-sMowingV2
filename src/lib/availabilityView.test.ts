// Tests for the availability model.
//   npm test -- availabilityView
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildAvailabilityDay, buildAvailabilityMonth, isDayBuilt,
  isEmployed, employeeDivisionName, LENDABLE_MIN_HEADCOUNT,
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

console.log('\nBuilt vs unbuilt days');
test('a day is BUILT only when some crew actually has a person on it', () => {
  assert.equal(isDayBuilt({ '2026-08-17': [crew('Lawn Division', 1, ['l1'])] }, '2026-08-17'), true);
  // No entry at all.
  assert.equal(isDayBuilt({}, '2026-08-17'), false);
  // Entry exists but is an empty array.
  assert.equal(isDayBuilt({ '2026-08-17': [] }, '2026-08-17'), false);
  // Crews created but nobody assigned — mid-build. The absence of assignments
  // says nothing about who is free, so this is NOT built.
  assert.equal(isDayBuilt({ '2026-08-17': [crew('Lawn Division', 1, [])] }, '2026-08-17'), false);
  // One staffed crew among empty ones is enough.
  assert.equal(isDayBuilt({
    '2026-08-17': [crew('Lawn Division', 1, []), crew('Lawn Division', 2, ['l1'])],
  }, '2026-08-17'), true);
});

test('an UNBUILT day reports nobody free — never the whole roster', () => {
  // This is the bug the distinction exists to prevent: with no schedule, every
  // employee is "not on a crew", so a naive read makes every future day look
  // fully available and the month grid becomes noise.
  const month = buildAvailabilityMonth(
    app({ employees: people, schedules: {} }), '2026-08-17', '2026-08-19', 'All',
  );
  assert.equal(month.length, 3);
  for (const d of month) {
    assert.equal(d.built, false);
    assert.equal(d.count, 0, `unbuilt ${d.date} reported ${d.count} people free`);
    assert.deepEqual(d.unassigned, []);
  }
});

test('a BUILT day reports its genuine unassigned people', () => {
  const month = buildAvailabilityMonth(app({
    employees: people,
    schedules: { '2026-08-18': [crew('Lawn Division', 1, ['l1', 'l2'])] },
  }), '2026-08-17', '2026-08-19', 'All');
  const by = new Map(month.map(d => [d.date, d]));
  assert.equal(by.get('2026-08-17')!.built, false);
  assert.equal(by.get('2026-08-19')!.built, false);
  const built = by.get('2026-08-18')!;
  assert.equal(built.built, true);
  assert.equal(built.crewCount, 1);
  // l3, s1 and o1 are employed, not away, and not on a crew that day.
  assert.deepEqual(built.unassigned.map(p => p.id).sort(), ['l3', 'o1', 's1']);
  assert.equal(built.count, 3);
});

test('the month range is inclusive and walks every day exactly once', () => {
  const month = buildAvailabilityMonth(app({ employees: people }), '2026-08-01', '2026-08-31', 'All');
  assert.equal(month.length, 31);
  assert.equal(month[0].date, '2026-08-01');
  assert.equal(month[30].date, '2026-08-31');
  assert.equal(new Set(month.map(d => d.date)).size, 31, 'a date was repeated or skipped');
});

test('the month range crosses a DST boundary without skipping or repeating a day', () => {
  // Toronto springs forward on 2026-03-08. Date arithmetic in local time can
  // drop or double a day here; the walk is UTC-anchored so it cannot.
  const month = buildAvailabilityMonth(app({ employees: people }), '2026-03-01', '2026-03-31', 'All');
  assert.equal(month.length, 31);
  assert.equal(new Set(month.map(d => d.date)).size, 31);
  assert.ok(month.some(d => d.date === '2026-03-08'));
});

test('the month honours the division filter', () => {
  const schedules: Record<string, Crew[]> = {
    '2026-08-18': [crew('Lawn Division', 1, ['l1'])],
  };
  const lawn = buildAvailabilityMonth(app({ employees: people, schedules }), '2026-08-18', '2026-08-18', 'Lawn Division');
  // Lawn people not on the crew: l2, l3. Office/Small are out of scope.
  assert.deepEqual(lawn[0].unassigned.map(p => p.id).sort(), ['l2', 'l3']);
  const all = buildAvailabilityMonth(app({ employees: people, schedules }), '2026-08-18', '2026-08-18', 'All');
  assert.deepEqual(all[0].unassigned.map(p => p.id).sort(), ['l2', 'l3', 'o1', 's1']);
});

test('someone booked off is not counted as free on a built day', () => {
  const month = buildAvailabilityMonth(app({
    employees: [
      emp({ id: 'on', name: 'On Crew', primaryCrew: 'Lawn' }),
      emp({ id: 'free', name: 'Free', primaryCrew: 'Lawn' }),
      emp({ id: 'off', name: 'Off', primaryCrew: 'Lawn', awayDates: [{ start: '2026-08-18', end: '2026-08-18' }] }),
    ],
    schedules: { '2026-08-18': [crew('Lawn Division', 1, ['on'])] },
  }), '2026-08-18', '2026-08-18', 'All');
  assert.deepEqual(month[0].unassigned.map(p => p.id), ['free']);
  assert.equal(month[0].count, 1);
});

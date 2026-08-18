// Tests for the flag record and the per-manager rollup.
//   npm test -- flagRecord
//
// The rollup is management information, so the thing that matters most is that
// it attributes flags to the RIGHT manager — and that an unanswerable flag
// (a division with no manager) is visible rather than quietly filed under
// whoever happens to be listed first.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildFlagRows, buildManagerRollup, divisionsInRecord, filterFlagRows,
  managerForDivision, managersInRecord, UNATTRIBUTED_ID,
} from './flagRecord';
import { CrewDayFlag, Employee } from '../types';

const MS_DAY = 86_400_000;
const T = Date.parse('2026-08-10T12:00:00Z');

const emp = (o: Partial<Employee> & { id: string; name: string }): Employee => ({
  status: 'Active', hasLicense: false, hasClassA: false, hasHeavyMachinery: false,
  awayDates: [], ...o,
} as Employee);

const EMPLOYEES = [
  emp({ id: 'm-lawn', name: 'Lena', managedDivision: 'lawn' }),
  emp({ id: 'm-small', name: 'Sam', managedDivision: 'small' }),
  emp({ id: 'm-all', name: 'Olive', managedDivision: 'all' }),
  emp({ id: 'w1', name: 'Worker' }),
];

const flag = (o: Partial<CrewDayFlag> = {}): CrewDayFlag => ({
  id: 'f1', date: '2026-08-05', crewId: 'crew-1', crewLabel: 'Lawn Division #3',
  division: 'Lawn Division', reason: 'Kyle has hours but no crew.',
  raisedBy: { email: 'james@x.test', name: 'James' }, raisedAt: T,
  status: 'open', ...o,
});

console.log('\nWho is accountable for answering a flag');
test("a division's own manager is named, not the all-division manager", () => {
  const m = managerForDivision(EMPLOYEES, 'Lawn Division');
  assert.equal(m?.id, 'm-lawn');
  assert.equal(m?.name, 'Lena');
});
test('an all-division manager is the FALLBACK when a division has none', () => {
  const m = managerForDivision(EMPLOYEES, 'Large Projects');
  assert.equal(m?.id, 'm-all');
  assert.equal(m?.managedDivision, 'all');
});
test('an unrecognised division falls back to the all-division manager', () => {
  assert.equal(managerForDivision(EMPLOYEES, 'Unassigned')?.id, 'm-all');
});
test('with nobody managing anything, there is no manager rather than a wrong one', () => {
  assert.equal(managerForDivision([emp({ id: 'w1', name: 'W' })], 'Lawn Division'), null);
});
test('an inactive manager is not named — they cannot answer it', () => {
  const away = [emp({ id: 'm-lawn', name: 'Lena', managedDivision: 'lawn', status: 'Inactive' })];
  assert.equal(managerForDivision(away, 'Lawn Division'), null);
});

console.log('\nThe record, newest first');
test('rows are ordered by when the flag was raised, newest first', () => {
  const rows = buildFlagRows([
    flag({ id: 'old', raisedAt: T - 3 * MS_DAY }),
    flag({ id: 'new', raisedAt: T }),
    flag({ id: 'mid', raisedAt: T - MS_DAY }),
  ], EMPLOYEES);
  assert.deepEqual(rows.map(r => r.flag.id), ['new', 'mid', 'old']);
});
test('days-to-resolve is counted for resolved flags and null while open', () => {
  const rows = buildFlagRows([
    flag({ id: 'open' }),
    flag({ id: 'done', status: 'resolved', resolvedAt: T + 2 * MS_DAY, resolutionNote: 'Lent from #2.' }),
  ], EMPLOYEES);
  assert.equal(rows.find(r => r.flag.id === 'open')!.daysToResolve, null);
  assert.equal(rows.find(r => r.flag.id === 'done')!.daysToResolve, 2);
});
test('a same-day resolution reads as 0 days, not null', () => {
  const rows = buildFlagRows([
    flag({ status: 'resolved', resolvedAt: T + 3 * 3_600_000 }),
  ], EMPLOYEES);
  assert.equal(rows[0].daysToResolve, 0);
});

console.log('\nFilters');
const FLAGS = [
  flag({ id: 'a', division: 'Lawn Division', date: '2026-08-05', status: 'open' }),
  flag({ id: 'b', division: 'Small Projects', crewLabel: 'Small Projects #1', date: '2026-08-06', status: 'resolved', resolvedAt: T + MS_DAY, resolutionNote: 'Correct — second crew arrived at noon.' }),
  flag({ id: 'c', division: 'Lawn Division', date: '2026-07-28', status: 'resolved', resolvedAt: T }),
];
const rows = () => buildFlagRows(FLAGS, EMPLOYEES);

test('status filter', () => {
  assert.deepEqual(filterFlagRows(rows(), { status: 'open' }).map(r => r.flag.id), ['a']);
  assert.deepEqual(
    filterFlagRows(rows(), { status: 'resolved' }).map(r => r.flag.id).sort(),
    ['b', 'c'],
  );
  assert.equal(filterFlagRows(rows(), { status: 'all' }).length, 3);
});
test('division filter', () => {
  assert.deepEqual(
    filterFlagRows(rows(), { division: 'Lawn Division' }).map(r => r.flag.id).sort(),
    ['a', 'c'],
  );
});
test('manager filter follows accountability, not who raised it', () => {
  assert.deepEqual(
    filterFlagRows(rows(), { managerId: 'm-lawn' }).map(r => r.flag.id).sort(),
    ['a', 'c'],
  );
  assert.deepEqual(filterFlagRows(rows(), { managerId: 'm-small' }).map(r => r.flag.id), ['b']);
});
test('date range filters on the CREW-DAY date, not when it was raised', () => {
  // Every flag here was raised on 2026-08-10; only their crew-days differ.
  assert.deepEqual(
    filterFlagRows(rows(), { from: '2026-08-01', to: '2026-08-31' }).map(r => r.flag.id).sort(),
    ['a', 'b'],
  );
  assert.deepEqual(filterFlagRows(rows(), { to: '2026-07-31' }).map(r => r.flag.id), ['c']);
});
test('filters compose', () => {
  const got = filterFlagRows(rows(), {
    status: 'resolved', division: 'Lawn Division', from: '2026-07-01',
  });
  assert.deepEqual(got.map(r => r.flag.id), ['c']);
});
test('a flag with no accountable manager is matched only by "all"', () => {
  const orphan = [flag({ id: 'o', division: 'Large Projects' })];
  const r = buildFlagRows(orphan, [emp({ id: 'w1', name: 'W' })]);
  assert.equal(filterFlagRows(r, { managerId: 'm-lawn' }).length, 0);
  assert.equal(filterFlagRows(r, { managerId: 'all' }).length, 1);
});
test('the filter dropdowns offer only values that appear in the record', () => {
  assert.deepEqual(divisionsInRecord(FLAGS), ['Lawn Division', 'Small Projects']);
  assert.deepEqual(managersInRecord(FLAGS, EMPLOYEES).map(m => m.name), ['Lena', 'Sam']);
});

console.log('\nThe per-manager rollup — the management information');
test('flags group by accountable manager with open and resolved split out', () => {
  const roll = buildManagerRollup(FLAGS, EMPLOYEES, '2026-08');
  assert.equal(roll.length, 2);
  const lena = roll.find(r => r.managerId === 'm-lawn')!;
  assert.equal(lena.total, 1);
  assert.equal(lena.open, 1);
  assert.equal(lena.resolved, 0);
  const sam = roll.find(r => r.managerId === 'm-small')!;
  assert.equal(sam.total, 1);
  assert.equal(sam.resolved, 1);
  assert.equal(sam.avgDaysToResolve, 1);
});
test('the month is the CREW-DAY month, so July flags stay out of August', () => {
  const roll = buildManagerRollup(FLAGS, EMPLOYEES, '2026-08');
  assert.equal(roll.reduce((s, r) => s + r.total, 0), 2, 'flag c is a July crew-day');
  const july = buildManagerRollup(FLAGS, EMPLOYEES, '2026-07');
  assert.deepEqual(july.map(r => r.managerId), ['m-lawn']);
  assert.equal(july[0].resolved, 1);
});
test('most OPEN first — those still cost a day its approval', () => {
  const many = [
    flag({ id: 'x1', division: 'Small Projects', date: '2026-08-01', status: 'resolved', resolvedAt: T }),
    flag({ id: 'x2', division: 'Small Projects', date: '2026-08-02', status: 'resolved', resolvedAt: T }),
    flag({ id: 'y1', division: 'Lawn Division', date: '2026-08-03', status: 'open' }),
  ];
  const roll = buildManagerRollup(many, EMPLOYEES, '2026-08');
  assert.equal(roll[0].managerId, 'm-lawn', 'one open outranks two resolved');
});
test('avgDaysToResolve averages only resolved flags, and is null with none', () => {
  const mixed = [
    flag({ id: 'r1', date: '2026-08-01', status: 'resolved', resolvedAt: T + 2 * MS_DAY }),
    flag({ id: 'r2', date: '2026-08-02', status: 'resolved', resolvedAt: T + 5 * MS_DAY }),
    flag({ id: 'o1', date: '2026-08-03', status: 'open' }),
  ];
  const roll = buildManagerRollup(mixed, EMPLOYEES, '2026-08');
  assert.equal(roll[0].avgDaysToResolve, 3.5);
  const allOpen = buildManagerRollup([flag({ date: '2026-08-01' })], EMPLOYEES, '2026-08');
  assert.equal(allOpen[0].avgDaysToResolve, null);
});
test('an UNANSWERABLE flag is surfaced, not dropped', () => {
  // A division with no manager holds a crew-day out of pay with nobody assigned
  // to release it — the most important row in the table, so it must appear.
  const roll = buildManagerRollup(
    [flag({ division: 'Large Projects', date: '2026-08-04' })],
    [emp({ id: 'w1', name: 'W' })],
    '2026-08',
  );
  assert.equal(roll.length, 1);
  assert.equal(roll[0].managerId, UNATTRIBUTED_ID);
  assert.equal(roll[0].managerName, 'No manager assigned');
  assert.equal(roll[0].open, 1);
});
test('a manager covering two divisions shows both', () => {
  const roll = buildManagerRollup([
    flag({ id: 'p', division: 'Large Projects', date: '2026-08-01' }),
    flag({ id: 'q', division: 'Unassigned', date: '2026-08-02' }),
  ], EMPLOYEES, '2026-08');
  assert.equal(roll[0].managerId, 'm-all');
  assert.deepEqual(roll[0].divisions, ['Large Projects', 'Unassigned']);
});
test('an empty record produces an empty rollup rather than throwing', () => {
  assert.deepEqual(buildManagerRollup([], EMPLOYEES, '2026-08'), []);
  assert.deepEqual(buildFlagRows([], EMPLOYEES), []);
});

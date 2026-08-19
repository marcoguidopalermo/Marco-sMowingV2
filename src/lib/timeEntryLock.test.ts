// Tests for when a punch becomes read-only.
//   npm test -- timeEntryLock
//
// The failure this prevents: a punch corrected after its crew-day was approved
// moves payroll and never moves employeeAH, because the sync skips approved
// days. Payroll and efficiency then disagree about the same work, silently.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { punchDate, timeEntryLock } from './timeEntryLock';
import type { Employee } from '../types';

const emp = (o: Partial<Employee> & { id: string; name: string }): Employee => ({
  status: 'Active', hasLicense: false, hasClassA: false, hasHeavyMachinery: false,
  awayDates: [], ...o,
} as Employee);

const TY = emp({ id: 'e-ty', name: 'Tyberious', linkedUserEmail: 'ty@x.test' });
const OTHER = emp({ id: 'e-other', name: 'Ana', linkedUserEmail: 'ana@x.test' });

const log = (o: Record<string, unknown> = {}) => ({
  division: 'Lawn Division', crewNumber: 5, isAdHoc: false, jobs: [],
  employeeAH: { 'e-ty': 7.2 }, deductions: {}, ...o,
} as any);

// 16:21Z is 12:21 in Toronto — safely mid-afternoon either side of the offset.
const CLOCK_IN = '2026-08-18T16:21:00.000Z';
const DATE = '2026-08-18';

const lock = (o: Record<string, unknown> = {}) => timeEntryLock({
  clockIn: CLOCK_IN,
  userEmail: 'ty@x.test',
  employees: [TY, OTHER],
  performance: { [DATE]: { 'crew-1': log({ approvalStatus: 'approved' }) } },
  pushedMonths: [],
  archivedDays: {},
  ...o,
} as any);

console.log('\nThe punch belongs to a Toronto day');
test('a punch is anchored to the Toronto calendar day, like the sync', () => {
  assert.equal(punchDate(CLOCK_IN), '2026-08-18');
  // 01:30Z on the 19th is 21:30 on the 18th in Toronto — still the 18th's shift.
  assert.equal(punchDate('2026-08-19T01:30:00.000Z'), '2026-08-18');
});
test('an unparseable clock-in yields no date and never locks', () => {
  assert.equal(punchDate('nonsense'), '');
  assert.equal(lock({ clockIn: 'nonsense' }).locked, false);
});

console.log('\nWhat locks');
test('an APPROVED crew-day carrying this person locks their punch', () => {
  const l = lock();
  assert.equal(l.locked, true);
  assert.equal(l.reason, 'crew-day-approved');
  assert.equal(l.crewLabel, 'Lawn Division #5');
  assert.match(l.message!, /Unapprove Lawn Division #5/);
  assert.match(l.message!, /would disagree/, 'it says WHY, not just no');
});
test('a WAIVED crew-day locks too — it is terminal in the same way', () => {
  const l = lock({ performance: { [DATE]: { 'crew-1': log({ approvalStatus: 'waived' }) } } });
  assert.equal(l.locked, true);
  assert.equal(l.reason, 'crew-day-waived');
});
test('a pushed month locks outright, whatever the crew-day says', () => {
  const l = lock({ pushedMonths: ['2026-08'], performance: {} });
  assert.equal(l.locked, true);
  assert.equal(l.reason, 'month-pushed');
  assert.match(l.message!, /read-only/);
});
test('a rolling-archived day locks even when its month is open', () => {
  const l = lock({ archivedDays: { [DATE]: true }, performance: {} });
  assert.equal(l.locked, true);
  assert.equal(l.reason, 'day-archived');
});
test('a pushed month outranks an approved crew-day in the message', () => {
  // Both are true; the month is the blunter fact and should be what is said.
  assert.equal(lock({ pushedMonths: ['2026-08'] }).reason, 'month-pushed');
});

console.log('\nWhat must NOT lock');
test('a PENDING crew-day does not lock — that is the whole point of pending', () => {
  assert.equal(lock({ performance: { [DATE]: { 'crew-1': log({ approvalStatus: 'pending' }) } } }).locked, false);
});
test('a crew-day with no approvalStatus at all does not lock', () => {
  assert.equal(lock({ performance: { [DATE]: { 'crew-1': log() } } }).locked, false);
});
test("an approved crew-day that does NOT carry this person has no claim on their punch", () => {
  // Ana's crew was signed off; that says nothing about Tyberious's hours.
  const l = lock({
    performance: { [DATE]: { 'crew-9': log({ approvalStatus: 'approved', employeeAH: { 'e-other': 8 } }) } },
  });
  assert.equal(l.locked, false);
});
test('an approved crew-day on a DIFFERENT date does not lock', () => {
  assert.equal(lock({
    performance: { '2026-08-17': { 'crew-1': log({ approvalStatus: 'approved' }) } },
  }).locked, false);
});
test('a punch by somebody with no employee record does not lock', () => {
  // Nobody's crew hours depend on it, so there is nothing to protect.
  assert.equal(lock({ userEmail: 'stranger@x.test' }).locked, false);
});
test('a blank or missing email does not lock', () => {
  assert.equal(lock({ userEmail: '' }).locked, false);
  assert.equal(lock({ userEmail: undefined }).locked, false);
});
test('email matching is case- and whitespace-insensitive on both sides', () => {
  assert.equal(lock({ userEmail: '  TY@X.TEST ' }).locked, true);
  assert.equal(lock({ employees: [emp({ id: 'e-ty', name: 'T', linkedUserEmail: ' TY@X.test ' })] }).locked, true);
});
test('an employee linked by `email` rather than linkedUserEmail still matches', () => {
  assert.equal(lock({ employees: [emp({ id: 'e-ty', name: 'T', email: 'ty@x.test' })] }).locked, true);
});
test('missing performance / employees are handled rather than throwing', () => {
  assert.equal(lock({ performance: undefined, employees: undefined }).locked, false);
  assert.equal(lock({ pushedMonths: undefined, archivedDays: undefined, performance: {} }).locked, false);
});

console.log('\nThe message names the fix');
test('the approved message tells you to unapprove, and why it matters', () => {
  const m = lock().message!;
  assert.match(m, /Tyberious/);
  assert.match(m, /2026-08-18/);
  assert.match(m, /Unapprove/);
  assert.match(m, /sync carries the correction/);
});

// Tests for the impossible-hours guard.
//   npm test -- dailyHoursGuard
//
// The case that produced it: Tyberious could not clock in, Dave entered a punch
// and Liam entered a punch, and nothing said anything until payroll.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  checkDailyHours, DAILY_HOURS_WARN_DEFAULT, dailyHoursThreshold,
  entriesForEmployeeDate, entryIsOverHours, hoursForEmployeeDate, overHoursDays,
  punchHours,
} from './dailyHoursGuard';
import type { TimeEntry } from '../types';

const e = (o: Partial<TimeEntry> & { id: string }): TimeEntry => ({
  userEmail: 'ty@x.test', userName: 'Tyberious', notes: [],
  clockIn: '2026-08-24T16:00:00.000Z', clockOut: '2026-08-25T01:30:00.000Z', ...o,
} as TimeEntry);

// The real pair, to the minute.
const DUP = [
  e({ id: 'a', clockIn: '2026-08-24T16:00:00.000Z', clockOut: '2026-08-25T01:30:00.000Z' }), // 9.50
  e({ id: 'b', clockIn: '2026-08-24T16:03:00.000Z', clockOut: '2026-08-25T01:30:00.000Z' }), // 9.45
];

console.log('\nThe threshold is a setting, seeded at 12');
test('defaults to 12 and honours an override', () => {
  assert.equal(DAILY_HOURS_WARN_DEFAULT, 12);
  assert.equal(dailyHoursThreshold(undefined), 12);
  assert.equal(dailyHoursThreshold({}), 12);
  assert.equal(dailyHoursThreshold({ dailyHoursWarnThreshold: 14 }), 14);
});
test('a nonsense override falls back rather than disabling the guard', () => {
  for (const v of [0, -3, NaN, 'x' as any]) {
    assert.equal(dailyHoursThreshold({ dailyHoursWarnThreshold: v }), 12, String(v));
  }
});

console.log('\nCounting a day');
test('a punch contributes its closed span', () => {
  assert.equal(Math.round(punchHours(DUP[0]) * 100) / 100, 9.5);
});
test('an OPEN punch contributes nothing — there is no span yet', () => {
  assert.equal(punchHours(e({ id: 'o', clockOut: undefined })), 0);
});
test('a reversed or unparseable punch contributes nothing rather than a negative', () => {
  assert.equal(punchHours(e({ id: 'r', clockIn: '2026-08-24T20:00:00Z', clockOut: '2026-08-24T10:00:00Z' })), 0);
  assert.equal(punchHours(e({ id: 'n', clockIn: 'nope', clockOut: 'nope' })), 0);
});
test('the day is anchored to CLOCK-IN, so an overnight shift stays on its start day', () => {
  // Both real punches clock out after midnight UTC; both belong to the 24th.
  assert.equal(entriesForEmployeeDate(DUP, 'ty@x.test', '2026-08-24').length, 2);
  assert.equal(entriesForEmployeeDate(DUP, 'ty@x.test', '2026-08-25').length, 0);
});
test('matching is case-insensitive on the address', () => {
  assert.equal(entriesForEmployeeDate(DUP, ' TY@X.TEST ', '2026-08-24').length, 2);
});
test("another employee's punches never count toward this one", () => {
  const mixed = [...DUP, e({ id: 'x', userEmail: 'other@x.test' })];
  assert.equal(hoursForEmployeeDate(mixed, 'ty@x.test', '2026-08-24'), 18.95);
});

console.log('\nTHE REAL CASE: the warning that would have caught it');
test('the second punch is warned about, naming what is already there', () => {
  const w = checkDailyHours({
    entries: [DUP[0]], email: 'ty@x.test', name: 'Tyberious',
    date: '2026-08-24', addedHours: 9.45, threshold: 12,
  });
  assert.equal(w.over, true);
  assert.equal(w.existingHours, 9.5);
  assert.equal(w.totalHours, 18.95);
  assert.match(w.message, /Tyberious already has 9.5 hours logged on 2026-08-24/);
  assert.match(w.message, /adding this makes 18.95/);
  assert.match(w.message, /usually a punch entered twice/);
});
test('the FIRST punch of a normal day is not warned about', () => {
  const w = checkDailyHours({
    entries: [], email: 'ty@x.test', date: '2026-08-24', addedHours: 9.5, threshold: 12,
  });
  assert.equal(w.over, false);
});
test('a genuinely long single day warns too — it is a check, not an accusation', () => {
  const w = checkDailyHours({
    entries: [], email: 'ty@x.test', name: 'Tyberious',
    date: '2026-08-24', addedHours: 14, threshold: 12,
  });
  assert.equal(w.over, true);
  assert.match(w.message, /Check this is a real long day/);
});
test('editing an existing punch does not count its own old hours twice', () => {
  const w = checkDailyHours({
    entries: DUP, email: 'ty@x.test', date: '2026-08-24',
    addedHours: 9.5, threshold: 12, excludeId: 'b',
  });
  assert.equal(w.existingHours, 9.5, 'only the OTHER punch counts');
  assert.equal(w.totalHours, 19);
});
test('exactly at the threshold does not warn; a minute over does', () => {
  const at = checkDailyHours({ entries: [], email: 'a@x.test', date: '2026-08-24', addedHours: 12, threshold: 12 });
  assert.equal(at.over, false);
  const over = checkDailyHours({ entries: [], email: 'a@x.test', date: '2026-08-24', addedHours: 12.02, threshold: 12 });
  assert.equal(over.over, true);
});

console.log('\nThe review flag');
test('an over-threshold day is listed, and a two-punch day reads as duplicated', () => {
  const days = overHoursDays(DUP, 12);
  assert.equal(days.length, 1);
  assert.equal(days[0].hours, 18.95);
  assert.equal(days[0].entryCount, 2);
  assert.equal(days[0].looksDuplicated, true, 'two punches is the duplicate shape');
  assert.equal(days[0].name, 'Tyberious');
});
test('one long punch is flagged but NOT as a duplicate — different problem', () => {
  const long = [e({ id: 'l', clockIn: '2026-08-11T23:53:00Z', clockOut: '2026-08-17T22:31:00Z' })];
  const days = overHoursDays(long, 12);
  assert.equal(days.length, 1);
  assert.equal(days[0].looksDuplicated, false);
});
test('a normal day is not listed', () => {
  assert.deepEqual(overHoursDays([DUP[0]], 12), []);
});
test('the range filter bounds the scan to a pay period', () => {
  assert.equal(overHoursDays(DUP, 12, { from: '2026-08-01', to: '2026-08-31' }).length, 1);
  assert.equal(overHoursDays(DUP, 12, { from: '2026-09-01' }).length, 0);
});
test('days sort newest first', () => {
  const older = [
    e({ id: 'o1', clockIn: '2026-06-01T16:00:00Z', clockOut: '2026-06-02T01:30:00Z' }),
    e({ id: 'o2', clockIn: '2026-06-01T16:00:00Z', clockOut: '2026-06-02T06:34:00Z' }),
  ];
  assert.deepEqual(overHoursDays([...DUP, ...older], 12).map(d => d.date),
    ['2026-08-24', '2026-06-01']);
});
test('an entry on an over-threshold day is badged; one on a normal day is not', () => {
  assert.equal(entryIsOverHours(DUP[0], DUP, 12), true);
  assert.equal(entryIsOverHours(DUP[0], [DUP[0]], 12), false);
});
test('an empty or missing list yields nothing rather than throwing', () => {
  assert.deepEqual(overHoursDays([], 12), []);
  assert.deepEqual(overHoursDays(undefined, 12), []);
  assert.equal(hoursForEmployeeDate(undefined, 'a@x.test', '2026-08-24'), 0);
});

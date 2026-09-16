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

// ── WHICH DAY IS A PUNCH ON ──────────────────────────────────────────────────
// One definition: the TORONTO date of the clock-in (punchDate), the same day
// the sync credits. These used to take the UTC date, so every clock-in after
// 8pm EDT — 7pm EST, when snow crews start — counted toward the next day.
import { crewDayAfterPunchRemoval } from './dailyHoursGuard';

const k = (o: Partial<TimeEntry> & { id: string }): TimeEntry =>
  e({ userEmail: 'plow@x.test', userName: 'Plow', ...o });

console.log('\nA punch belongs to the Toronto day it STARTED');
test('a shift crossing midnight belongs entirely to the day it started', () => {
  // Sep 14 21:00 EDT -> Sep 15 01:00 EDT. UTC: 01:00Z-05:00Z on Sep 15.
  const night = k({ id: 'n', clockIn: '2026-09-15T01:00:00.000Z', clockOut: '2026-09-15T05:00:00.000Z' });
  assert.equal(hoursForEmployeeDate([night], 'plow@x.test', '2026-09-14'), 4);
  assert.equal(hoursForEmployeeDate([night], 'plow@x.test', '2026-09-15'), 0);
});

test('a 10pm-6am plow shift is that night\'s, and does not stack onto the next day shift', () => {
  // Dec 10 22:00 EST -> Dec 11 06:00 EST, then a day shift Dec 11 08:00-16:00 EST.
  const plow = k({ id: 'p', clockIn: '2026-12-11T03:00:00.000Z', clockOut: '2026-12-11T11:00:00.000Z' });
  const day = k({ id: 'd', clockIn: '2026-12-11T13:00:00.000Z', clockOut: '2026-12-11T21:00:00.000Z' });
  assert.equal(hoursForEmployeeDate([plow, day], 'plow@x.test', '2026-12-10'), 8);
  assert.equal(hoursForEmployeeDate([plow, day], 'plow@x.test', '2026-12-11'), 8);
  // UTC bucketing called this a 16-hour "punch entered twice" day.
  assert.deepEqual(overHoursDays([plow, day], 12), []);
  assert.equal(entryIsOverHours(day, [plow, day], 12), false);
});

test('a genuinely duplicated evening shift is still caught, on the night it was worked', () => {
  const a = k({ id: 'a', clockIn: '2026-12-11T00:30:00.000Z', clockOut: '2026-12-11T08:30:00.000Z' }); // Dec 10 19:30-03:30 EST
  const b = k({ id: 'b', clockIn: '2026-12-11T00:35:00.000Z', clockOut: '2026-12-11T08:30:00.000Z' });
  const flagged = overHoursDays([a, b], 12);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].date, '2026-12-10');
  assert.equal(flagged[0].looksDuplicated, true);
});

console.log('\nDaylight saving: the cutoff moves from 8pm to 7pm');
test('summer: 8:30pm EDT is still today (UTC already says tomorrow)', () => {
  const p = k({ id: 's', clockIn: '2026-09-15T00:30:00.000Z', clockOut: '2026-09-15T04:30:00.000Z' }); // Sep 14 20:30 EDT
  assert.equal(entriesForEmployeeDate([p], 'plow@x.test', '2026-09-14').length, 1);
});

test('winter: 7:00pm EST is today — the exact minute UTC rolls over', () => {
  const at7 = k({ id: 'w7', clockIn: '2026-12-11T00:00:00.000Z', clockOut: '2026-12-11T08:00:00.000Z' });   // Dec 10 19:00 EST
  const at659 = k({ id: 'w6', clockIn: '2026-12-10T23:59:00.000Z', clockOut: '2026-12-11T08:00:00.000Z' }); // Dec 10 18:59 EST
  assert.equal(entriesForEmployeeDate([at7, at659], 'plow@x.test', '2026-12-10').length, 2);
  assert.equal(entriesForEmployeeDate([at7, at659], 'plow@x.test', '2026-12-11').length, 0);
});

test('fall-back day (Nov 1 2026): both 1am hours and the evening belong to Nov 1', () => {
  const firstOne = k({ id: 'f1', clockIn: '2026-11-01T05:30:00.000Z', clockOut: '2026-11-01T05:45:00.000Z' });  // 01:30 EDT
  const secondOne = k({ id: 'f2', clockIn: '2026-11-01T06:30:00.000Z', clockOut: '2026-11-01T06:45:00.000Z' }); // 01:30 EST (repeated hour)
  const evening = k({ id: 'f3', clockIn: '2026-11-02T00:30:00.000Z', clockOut: '2026-11-02T01:30:00.000Z' });   // Nov 1 19:30 EST
  const eveBefore = k({ id: 'f0', clockIn: '2026-10-31T23:30:00.000Z', clockOut: '2026-11-01T00:30:00.000Z' }); // Oct 31 19:30 EDT
  const all = [firstOne, secondOne, evening, eveBefore];
  assert.deepEqual(entriesForEmployeeDate(all, 'plow@x.test', '2026-11-01').map(x => x.id).sort(), ['f1', 'f2', 'f3']);
  assert.deepEqual(entriesForEmployeeDate(all, 'plow@x.test', '2026-10-31').map(x => x.id), ['f0']);
});

test('spring-forward day (Mar 14 2027): the night before stays the night before', () => {
  const satNight = k({ id: 'm0', clockIn: '2027-03-14T01:00:00.000Z', clockOut: '2027-03-14T09:00:00.000Z' }); // Mar 13 20:00 EST
  const afterMidnight = k({ id: 'm1', clockIn: '2027-03-14T05:30:00.000Z', clockOut: '2027-03-14T06:00:00.000Z' }); // Mar 14 00:30 EST
  const sunEvening = k({ id: 'm2', clockIn: '2027-03-14T23:30:00.000Z', clockOut: '2027-03-15T03:00:00.000Z' }); // Mar 14 19:30 EDT
  const all = [satNight, afterMidnight, sunEvening];
  assert.deepEqual(entriesForEmployeeDate(all, 'plow@x.test', '2027-03-13').map(x => x.id), ['m0']);
  assert.deepEqual(entriesForEmployeeDate(all, 'plow@x.test', '2027-03-14').map(x => x.id).sort(), ['m1', 'm2']);
});

test('the payroll-period review scans Toronto days, so a period ending Dec 10 includes that night', () => {
  const a = k({ id: 'a', clockIn: '2026-12-11T00:30:00.000Z', clockOut: '2026-12-11T08:30:00.000Z' });
  const b = k({ id: 'b', clockIn: '2026-12-11T00:35:00.000Z', clockOut: '2026-12-11T08:30:00.000Z' });
  assert.equal(overHoursDays([a, b], 12, { from: '2026-11-30', to: '2026-12-10' }).length, 1);
  assert.equal(overHoursDays([a, b], 12, { from: '2026-12-11', to: '2026-12-24' }).length, 0);
});

console.log('\nRemoving a duplicate corrects the crew-day that carried it');
test('an evening duplicate removed from Dec 10 corrects Dec 10, not Dec 11', () => {
  const kept = k({ id: 'kept', clockIn: '2026-12-11T00:30:00.000Z', clockOut: '2026-12-11T08:30:00.000Z' }); // Dec 10 19:30 EST, 8h
  const dup = k({ id: 'dup', clockIn: '2026-12-11T00:35:00.000Z', clockOut: '2026-12-11T08:30:00.000Z' });
  const nextDay = k({ id: 'next', clockIn: '2026-12-11T13:00:00.000Z', clockOut: '2026-12-11T21:00:00.000Z' }); // Dec 11 day shift
  const r = crewDayAfterPunchRemoval(dup, [kept, dup, nextDay], 'plow@x.test');
  assert.ok(r);
  assert.equal(r!.date, '2026-12-10');           // UTC would have said 2026-12-11
  assert.equal(r!.hours, 8);
  assert.deepEqual(r!.intervals, [{ startAt: kept.clockIn, endAt: kept.clockOut }]);
});

test('removing the only punch leaves zero hours and no intervals on its day', () => {
  const only = k({ id: 'only', clockIn: '2026-12-11T03:00:00.000Z', clockOut: '2026-12-11T11:00:00.000Z' });
  const r = crewDayAfterPunchRemoval(only, [only], 'plow@x.test');
  assert.deepEqual(r, { date: '2026-12-10', hours: 0, intervals: [] });
});

// Per-person range totals for TimeMaster's All Users list.
//   npm test -- rangeTotals
import { test, vi, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { formatRangeHours, rangeTotalsByPerson } from './rangeTotals';
import * as payChunkUtils from './payChunkUtils';
import type { TimeEntry } from '../types';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const p = (o: Partial<TimeEntry> & { id: string }): TimeEntry => ({
  userEmail: 'kris@x.test', userName: 'Kris', notes: [],
  clockIn: '2026-09-14T12:45:00.000Z', clockOut: '2026-09-14T20:55:00.000Z', ...o,
} as TimeEntry);
const PEOPLE = [{ email: 'kris@x.test', name: 'Kris' }, { email: 'tony@x.test', name: 'Tony' }];
// The range rule the caller passes: STARTED on/after Sep 14 00:00 and on/before Sep 27 23:59 (EDT).
const SEP14_27 = (e: TimeEntry) => {
  const t = Date.parse(e.clockIn);
  return t >= Date.parse('2026-09-14T04:00:00.000Z') && t <= Date.parse('2026-09-28T03:59:59.999Z');
};

test('totals each person over closed punches in the range, and a grand total', () => {
  const entries = [
    p({ id: 'a' }),                                                                                  // 8.17h
    p({ id: 'b', clockIn: '2026-09-15T12:38:00.000Z', clockOut: '2026-09-15T20:10:00.000Z' }),       // 7.53h
    p({ id: 'old', clockIn: '2026-09-11T13:00:00.000Z', clockOut: '2026-09-11T21:05:00.000Z' }),     // before range
    p({ id: 't', userEmail: 'tony@x.test', userName: 'Tony', clockIn: '2026-09-14T12:00:00.000Z', clockOut: '2026-09-14T20:15:00.000Z' }), // 8.25h
  ];
  const r = rangeTotalsByPerson(PEOPLE, entries, SEP14_27);
  assert.equal(formatRangeHours(r.rows[0].hours), '15.70 h');
  assert.equal(r.rows[0].closedCount, 2);
  assert.equal(formatRangeHours(r.rows[1].hours), '8.25 h');
  assert.equal(formatRangeHours(r.total.hours), '23.95 h');
  assert.equal(r.total.people, 2);
});

test('the arithmetic is computeHoursWorkedBetween, not a replica', () => {
  const spy = vi.spyOn(payChunkUtils, 'computeHoursWorkedBetween');
  rangeTotalsByPerson(PEOPLE.slice(0, 1), [p({ id: 'a' })], SEP14_27);
  assert.ok(spy.mock.calls.length >= 1);
  const [email, from, to] = spy.mock.calls[0];
  assert.equal(email, 'kris@x.test');
  assert.equal(from, Number.NEGATIVE_INFINITY);   // unbounded: the range is chosen by clock-in, never clipped
  assert.equal(to, Number.POSITIVE_INFINITY);
});

test('a running punch is NOT in the total; it is reported beside it', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T15:32:00.000Z'));
  const entries = [
    p({ id: 'closed' }),                                                        // 8.17h
    p({ id: 'open', clockIn: '2026-09-16T12:32:00.000Z', clockOut: undefined }), // running 3h so far
  ];
  const r = rangeTotalsByPerson(PEOPLE.slice(0, 1), entries, SEP14_27);
  assert.equal(formatRangeHours(r.rows[0].hours), '8.17 h');
  assert.equal(r.rows[0].runningCount, 1);
  assert.equal(formatRangeHours(r.rows[0].runningHoursSoFar), '3.00 h');
  assert.equal(formatRangeHours(r.total.hours), '8.17 h');
  assert.equal(r.total.runningCount, 1);
});

test('an overnight shift that started in the range counts in full, as the punch list shows it', () => {
  // Sat Sep 26 22:00 -> Sun Sep 27 06:00... and one starting on the LAST night, Sep 27 22:00 -> Sep 28 06:00.
  const last = p({ id: 'n', clockIn: '2026-09-28T02:00:00.000Z', clockOut: '2026-09-28T10:00:00.000Z' });
  const r = rangeTotalsByPerson(PEOPLE.slice(0, 1), [last], SEP14_27);
  assert.equal(formatRangeHours(r.rows[0].hours), '8.00 h');   // clipped at the range edge it would be 2.00 h
});

test('a person with nothing in the range totals 0 and is not counted as a person', () => {
  const r = rangeTotalsByPerson(PEOPLE, [p({ id: 'a' })], SEP14_27);
  assert.equal(r.rows[1].hours, 0);
  assert.equal(r.total.people, 1);
});

test('the same login under two spellings is counted once in the grand total', () => {
  const people = [{ email: 'Kris@x.test', name: 'Kris' }, { email: 'kris@x.test', name: 'Kris' }];
  const r = rangeTotalsByPerson(people, [p({ id: 'a' })], SEP14_27);
  assert.equal(formatRangeHours(r.total.hours), '8.17 h');
});

test('an inverted punch (out before in) adds nothing rather than subtracting', () => {
  const bad = p({ id: 'x', clockIn: '2026-09-14T20:00:00.000Z', clockOut: '2026-09-14T12:00:00.000Z' });
  const r = rangeTotalsByPerson(PEOPLE.slice(0, 1), [p({ id: 'a' }), bad], SEP14_27);
  assert.equal(formatRangeHours(r.rows[0].hours), '8.17 h');
});

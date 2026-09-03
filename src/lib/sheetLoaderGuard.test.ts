// THE CLASS GUARD: no loader may decide by pushedMonths alone.
//   npm test -- sheetLoaderGuard
//
// Three readers shipped the same defect, one at a time — the MTD widgets
// (2026-08-26, 49% of a month's BH vanished), findResolvablePartial, and the
// date-range report (2026-09-03, 558 of 1,411 jobs shown). Each was fixed as an
// instance. This covers the CLASS.
//
// THE ENFORCEMENT IS THE TYPE, NOT THIS FILE. ensureMonthLoaded takes a
// SheetMonth, which only monthsNeedingSheet can produce, so gating a fetch on
// pushedMonths alone is a COMPILE error. Verified by reintroducing the exact
// defect: TS2345, "Argument of type 'string' is not assignable to parameter of
// type 'SheetMonth'".
//
// A guard that scanned the source text was written first and was WORTHLESS —
// its context window picked up an `archivedDays` from a neighbouring lock check
// and excused the very defect it existed to catch. It is not kept. What is kept
// is the behaviour of the rule itself.
//
// The rule: a month's days reach a sheet by TWO routes.
//   pushedMonths   the whole month was finalised and moved
//   archivedDays   the rolling archive moved individual days as they aged
// August 2026 is the standing counter-example: never pushed, yet 15 of its 31
// days are on performanceMonths/2026-08.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { monthsNeedingSheet } from './performanceOverlay';

console.log('\nThe rule catches the August shape');
test('AUGUST 2026: not pushed, days archived — the sheet is still needed', () => {
  const need = monthsNeedingSheet({
    today: '2026-09-03',
    pushedMonths: ['2026-07'],                 // August is NOT here
    archivedDays: { '2026-08-05': 1, '2026-08-12': 1 },
    rangeFrom: '2026-08-01', rangeTo: '2026-08-31',
  });
  assert.ok(need.includes('2026-08'),
    'the exact case that made the report read 558 of 1,411 jobs');
});
test('a pushed month in the range is needed too', () => {
  const need = monthsNeedingSheet({
    today: '2026-09-03', pushedMonths: ['2026-07'], archivedDays: {},
    rangeFrom: '2026-07-01', rangeTo: '2026-07-31',
  });
  assert.deepEqual(need, ['2026-07']);
});
test('a range spanning several months asks for each of them', () => {
  const need = monthsNeedingSheet({
    today: '2026-09-03',
    pushedMonths: ['2026-07'],
    archivedDays: { '2026-08-05': 1 },
    rangeFrom: '2026-06-15', rangeTo: '2026-09-02',
  });
  assert.deepEqual(need, ['2026-07', '2026-08']);
});
test('a range needing nothing asks for nothing', () => {
  assert.deepEqual(monthsNeedingSheet({
    today: '2026-09-03', pushedMonths: [], archivedDays: {},
    rangeFrom: '2026-09-01', rangeTo: '2026-09-03',
  }), []);
});
test('a range crossing a year boundary still enumerates correctly', () => {
  const need = monthsNeedingSheet({
    today: '2027-01-05', pushedMonths: ['2026-12'], archivedDays: {},
    rangeFrom: '2026-11-20', rangeTo: '2027-01-05',
  });
  assert.deepEqual(need, ['2026-12']);
});

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { filterSortAR, ageOf, sortAmount, totalOf, type ARRow } from './arList';

const r = (n: string, client: string, balance: number, days: number, due = '2026-10-01', age?: ARRow['age']): ARRow => ({ invoiceNumber: n, client, balance, daysOverdue: days, dueDate: due, age });
const rows = [r('1', 'beta Co', 100, 95), r('2', 'Alpha', 4746, 120), r('3', 'Gamma', 452, 40), r('4', 'delta', 30, 0, '2026-11-05'), r('5', 'Echo', 900, 0, '2026-10-25'), r('6', 'Alpha', 50, 100)];

test('filter to 90+ and sort by amount, high to low', () => {
  assert.deepEqual(filterSortAR(rows, 'd90plus', 'amountDesc').map(x => x.invoiceNumber), ['2', '1', '6']);
  assert.equal(totalOf(filterSortAR(rows, 'd90plus', 'amountDesc')), 4896);
});
test('filter and sort work together; "all" clears the filter', () => {
  assert.deepEqual(filterSortAR(rows, 'd31_60', 'amountDesc').map(x => x.invoiceNumber), ['3']);
  assert.deepEqual(filterSortAR(rows, 'all', 'amountAsc').map(x => x.invoiceNumber), ['4', '6', '1', '3', '5', '2']);
});
test('default sort: oldest first, then not-yet-due by soonest due date', () => {
  assert.deepEqual(filterSortAR(rows, 'all', 'overdue').map(x => x.invoiceNumber), ['2', '6', '1', '3', '5', '4']);
});
test('client A–Z ignores case; ties by amount', () => {
  assert.deepEqual(filterSortAR(rows, 'all', 'client').map(x => x.invoiceNumber), ['2', '6', '1', '4', '5', '3']);
});
test('age from days when a row carries none; an explicit age wins', () => {
  assert.deepEqual([0, 1, 30, 31, 60, 61, 90, 91].map(d => ageOf(r('x', 'x', 1, d))), ['notDue', 'd1_30', 'd1_30', 'd31_60', 'd31_60', 'd61_90', 'd61_90', 'd90plus']);
  assert.equal(ageOf(r('x', 'x', 1, 5, undefined, 'd90plus')), 'd90plus');
});
test('amount sort for the side lists', () => {
  assert.deepEqual(sortAmount([{ balance: 1 }, { balance: 3 }, { balance: 2 }], 'asc').map(x => x.balance), [1, 2, 3]);
});

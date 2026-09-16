// The TimeMaster panel's punch rows must run in time order.
//   npm test -- punchRows
//
// They were sorted on the "Sep 10" display label, and as text "Sep 10" comes
// before "Sep 2": from the 10th of any month the later days sat between the
// 1st and the 2nd, the list ended on the 9th, and a week of billable hours
// read as missing.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { punchRowsByClockIn } from './contracting';

const at = (d: number, h = 13) => ({ clockIn: `2026-09-${String(d).padStart(2, '0')}T${h}:00:00.000Z` });

test('days 10+ follow day 9, not day 1', () => {
  // Newest first, the way appData.timeEntries arrives.
  const entries = [16, 15, 14, 11, 10, 9, 8, 2, 1].map(d => at(d));
  const days = punchRowsByClockIn(entries, () => 8).map(r => r.day);
  assert.deepEqual(days, ['Sep 1', 'Sep 2', 'Sep 8', 'Sep 9', 'Sep 10', 'Sep 11', 'Sep 14', 'Sep 15', 'Sep 16']);
});

test('same-day punches stay in clock order', () => {
  const rows = punchRowsByClockIn([at(14, 21), at(14, 12)], e => Number(e.clockIn.slice(11, 13)));
  assert.deepEqual(rows.map(r => r.hours), [12, 21]);
});

test('month boundary orders by date, not by month name', () => {
  const rows = punchRowsByClockIn([{ clockIn: '2026-09-01T13:00:00.000Z' }, { clockIn: '2026-08-31T13:00:00.000Z' }], () => 1);
  assert.deepEqual(rows.map(r => r.day), ['Aug 31', 'Sep 1']);
});

// Tests for RoleMaster recurrence generation.
//   npm test -- roleMaster
//
// Focused on the 'weekdays' kind added for the daily crew-day audit. The
// generator is deliberately duplicated in functions/src/jobber/roleMaster.ts
// (the functions codebase cannot import src/), so a change here needs the same
// change there — the branches are written to mirror each other line for line.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { computeOccurrences, describeRecurrence } from './roleMaster';

console.log('\nEvery-weekday recurrence (the daily crew-day audit)');
test('weekdays fires Mon–Fri and skips the weekend', () => {
  // 2026-08-17 is a Monday; the 22nd and 23rd are Sat and Sun.
  const days = computeOccurrences({ kind: 'weekdays' }, '2026-08-17', '2026-08-24');
  assert.deepEqual(days, [
    '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21',
    '2026-08-24',
  ]);
});
test('weekdays ignores dayOfWeek — the point is every working day', () => {
  const a = computeOccurrences({ kind: 'weekdays' }, '2026-08-17', '2026-08-21');
  const b = computeOccurrences({ kind: 'weekdays', dayOfWeek: 3 }, '2026-08-17', '2026-08-21');
  assert.deepEqual(a, b);
  assert.equal(a.length, 5);
});
test('a weekend-only window yields nothing rather than an unexpected instance', () => {
  // Generating a duty nobody is expected to do trains people to ignore overdue.
  assert.deepEqual(computeOccurrences({ kind: 'weekdays' }, '2026-08-22', '2026-08-23'), []);
});
test('an inverted window yields nothing', () => {
  assert.deepEqual(computeOccurrences({ kind: 'weekdays' }, '2026-08-21', '2026-08-17'), []);
});
test('describeRecurrence names it plainly', () => {
  assert.equal(
    describeRecurrence({ recurrence: { kind: 'weekdays' } } as any),
    'Every weekday · Mon–Fri',
  );
});

console.log('\nThe existing kinds still behave');
test('weekly still fires only on its day', () => {
  const days = computeOccurrences({ kind: 'weekly', dayOfWeek: 3 }, '2026-08-17', '2026-08-31');
  for (const d of days) assert.equal(new Date(`${d}T12:00:00Z`).getUTCDay(), 3);
  assert.equal(days.length, 2);
});
test('monthly still clamps to the length of the month', () => {
  const days = computeOccurrences({ kind: 'monthly', dayOfMonth: 31 }, '2026-02-01', '2026-02-28');
  assert.deepEqual(days, ['2026-02-28']);
});

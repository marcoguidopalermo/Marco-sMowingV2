// Tests for efficiency adjustments.
//   npm test -- efficiencyAdjustments
//
// The invariants that matter: raw figures are never edited, pay is never
// involved, and an adjustment cannot run open-ended.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  adjustedAH, adjustmentNotice, appliesTo, coversDate, EXTENSION_FLAG_AT,
  extensionCount, isOverExtended, resolveAdjustments, spanDays,
  validateAdjustment,
} from './efficiencyAdjustments';
import { creditBreakdown, hoursBreakdown } from './crewAllowance';
import type { EfficiencyAdjustment } from '../types';

const adj = (o: Partial<EfficiencyAdjustment> & { id: string }): EfficiencyAdjustment => ({
  unit: 'hours', amount: -0.5, reason: 'filming', scope: 'crew', crewId: 'c1',
  startDate: '2026-08-25', endDate: '2026-08-25', createdAt: 1,
  createdBy: { email: 'm@x.test', name: 'Marco' }, ...o,
} as EfficiencyAdjustment);

const ctx = { date: '2026-08-25', division: 'Lawn Division', crewId: 'c1' };

console.log('\nScope: crew, division, company');
test('a crew adjustment hits only that crew', () => {
  const a = adj({ id: 'a', scope: 'crew', crewId: 'c1' });
  assert.equal(appliesTo(a, ctx), true);
  assert.equal(appliesTo(a, { ...ctx, crewId: 'c2' }), false);
});
test('a division adjustment hits every crew in that division', () => {
  const a = adj({ id: 'a', scope: 'division', division: 'Lawn Division', crewId: undefined });
  assert.equal(appliesTo(a, ctx), true);
  assert.equal(appliesTo(a, { ...ctx, crewId: 'c9' }), true);
  assert.equal(appliesTo(a, { ...ctx, division: 'Small Projects' }), false);
});
test('division matching is case-insensitive', () => {
  const a = adj({ id: 'a', scope: 'division', division: 'lawn division', crewId: undefined });
  assert.equal(appliesTo(a, ctx), true);
});
test('a company adjustment hits everything, including a crew with no division', () => {
  const a = adj({ id: 'a', scope: 'company', crewId: undefined });
  assert.equal(appliesTo(a, ctx), true);
  assert.equal(appliesTo(a, { date: ctx.date }), true);
});
test('a voided adjustment applies to nothing', () => {
  assert.equal(appliesTo(adj({ id: 'a', voided: true }), ctx), false);
});

console.log('\nDate range');
test('a single-day adjustment covers only its day', () => {
  const a = adj({ id: 'a', startDate: '2026-08-25', endDate: '2026-08-25' });
  assert.equal(coversDate(a, '2026-08-25'), true);
  assert.equal(coversDate(a, '2026-08-24'), false);
  assert.equal(coversDate(a, '2026-08-26'), false);
});
test('a range is inclusive at both ends', () => {
  const a = adj({ id: 'a', startDate: '2026-05-01', endDate: '2026-09-30' });
  for (const d of ['2026-05-01', '2026-07-14', '2026-09-30']) {
    assert.equal(coversDate(a, d), true, d);
  }
  assert.equal(coversDate(a, '2026-04-30'), false);
  assert.equal(coversDate(a, '2026-10-01'), false);
});
test('span counts inclusive days', () => {
  assert.equal(spanDays(adj({ id: 'a', startDate: '2026-08-25', endDate: '2026-08-25' })), 1);
  assert.equal(spanDays(adj({ id: 'a', startDate: '2026-08-25', endDate: '2026-08-27' })), 3);
});

console.log('\nComposition is additive');
test('two hours adjustments sum, and both are itemized', () => {
  const r = resolveAdjustments([
    adj({ id: 'a', unit: 'hours', amount: -0.5, reason: 'filming' }),
    adj({ id: 'b', unit: 'hours', amount: -1, reason: 'shop meeting' }),
  ], ctx);
  assert.equal(r.hours, -1.5);
  assert.deepEqual(r.hourItems.map(i => i.label), ['filming', 'shop meeting']);
});
test('hours and percentage on the same day BOTH apply — different questions', () => {
  const r = resolveAdjustments([
    adj({ id: 'a', unit: 'hours', amount: -0.5, reason: 'filming' }),
    adj({ id: 'b', unit: 'percent', amount: 8, reason: 'Lush inherited pricing', scope: 'division', division: 'Lawn Division', crewId: undefined }),
  ], ctx);
  assert.equal(r.hours, -0.5);
  assert.equal(r.pct, 8);
  assert.equal(r.matched.length, 2);
});
test('itemization reads narrowest-first: crew, then division, then company', () => {
  const r = resolveAdjustments([
    adj({ id: 'co', unit: 'percent', amount: 1, reason: 'company', scope: 'company', crewId: undefined }),
    adj({ id: 'cr', unit: 'percent', amount: 2, reason: 'crew', scope: 'crew', crewId: 'c1' }),
    adj({ id: 'dv', unit: 'percent', amount: 3, reason: 'division', scope: 'division', division: 'Lawn Division', crewId: undefined }),
  ], ctx);
  assert.deepEqual(r.pctItems.map(i => i.label), ['crew', 'division', 'company']);
  assert.equal(r.pct, 6);
});
test('nothing matching resolves to zero, not to undefined', () => {
  const r = resolveAdjustments([], ctx);
  assert.equal(r.hours, 0);
  assert.equal(r.pct, 0);
  assert.deepEqual(r.matched, []);
  assert.equal(resolveAdjustments(undefined, ctx).hours, 0);
});

console.log('\nRaw is never edited — the adjustment is applied on read');
test('adjusted AH is derived; the raw number passed in is unchanged', () => {
  const rawAH = 7.5;
  const out = adjustedAH(rawAH, -0.5);
  assert.equal(out, 7);
  assert.equal(rawAH, 7.5, 'the caller’s raw value is untouched');
});
test('a removal larger than the day floors at zero rather than going negative', () => {
  assert.equal(adjustedAH(2, -5), 0);
});
test('a positive hours adjustment adds', () => {
  assert.equal(adjustedAH(7, 1.5), 8.5);
});

console.log('\nThe itemized display, reusing the credit mechanism');
test('the hours line reads raw, each item, adjusted', () => {
  assert.equal(
    hoursBreakdown(7.5, [{ label: 'filming', amount: -0.5 }], 7),
    '7.5 AH raw · −0.5 filming · 7 adjusted',
  );
});
test('the percentage line reads the same way, signed correctly', () => {
  assert.equal(
    creditBreakdown(74, [{ label: 'Lush inherited pricing', pct: 8 }], 82),
    '74% raw · +8% Lush pricing · 82% adjusted'.replace('Lush pricing', 'Lush inherited pricing'),
  );
});
test('a NEGATIVE percentage renders as a minus, not "+-"', () => {
  const s = creditBreakdown(90, [{ label: 'correction', pct: -3 }], 87)!;
  assert.ok(s.includes('−3% correction'), s);
  assert.ok(!s.includes('+-'), s);
});
test('the existing 3-man and trainee credits still render as before', () => {
  assert.equal(
    creditBreakdown(70, [{ label: '3-man', pct: 10 }, { label: 'trainee', pct: 5 }], 85),
    '70% raw · +10% 3-man · +5% trainee · 85% adjusted',
  );
});
test('no items means no line at all — an unadjusted day looks unadjusted', () => {
  assert.equal(hoursBreakdown(7.5, [], 7.5), null);
  assert.equal(creditBreakdown(74, [], 74), null);
});

console.log('\nTime bounding and extension flagging');
test('an end date is required — nothing runs open-ended', () => {
  const e = validateAdjustment({
    unit: 'percent', amount: 8, reason: 'Lush', scope: 'company',
    startDate: '2026-05-01', endDate: '',
  });
  assert.equal(e?.field, 'endDate');
  assert.match(e!.message, /open-ended/);
});
test('an end before the start is refused', () => {
  const e = validateAdjustment({
    unit: 'hours', amount: -1, reason: 'filming', scope: 'company',
    startDate: '2026-08-25', endDate: '2026-08-24',
  });
  assert.equal(e?.field, 'endDate');
});
test('a reason is required', () => {
  for (const r of ['', '  ', 'x']) {
    assert.equal(validateAdjustment({
      unit: 'hours', amount: -1, reason: r, scope: 'company',
      startDate: '2026-08-25', endDate: '2026-08-25',
    })?.field, 'reason');
  }
});
test('zero and implausible amounts are refused in both units', () => {
  const base = { reason: 'x reason', scope: 'company' as const, startDate: '2026-08-25', endDate: '2026-08-25' };
  assert.equal(validateAdjustment({ ...base, unit: 'hours', amount: 0 })?.field, 'amount');
  assert.equal(validateAdjustment({ ...base, unit: 'hours', amount: 25 })?.field, 'amount');
  assert.equal(validateAdjustment({ ...base, unit: 'percent', amount: 101 })?.field, 'amount');
  assert.equal(validateAdjustment({ ...base, unit: 'percent', amount: -8 }), null, 'a negative percent is legitimate');
});
test('crew and division scopes need a target', () => {
  const base = { unit: 'hours' as const, amount: -1, reason: 'filming', startDate: '2026-08-25', endDate: '2026-08-25' };
  assert.equal(validateAdjustment({ ...base, scope: 'crew' })?.field, 'scope');
  assert.equal(validateAdjustment({ ...base, scope: 'division' })?.field, 'scope');
  assert.equal(validateAdjustment({ ...base, scope: 'crew', crewId: 'c1' }), null);
});
test(`flagged once extended ${EXTENSION_FLAG_AT} times — creep reads as creep`, () => {
  const once = adj({ id: 'a', extensions: [{ at: 1, by: 'M', fromEndDate: '2026-06-30', toEndDate: '2026-07-31' }] });
  assert.equal(extensionCount(once), 1);
  assert.equal(isOverExtended(once), false);
  const twice = adj({ id: 'a', extensions: [
    { at: 1, by: 'M', fromEndDate: '2026-06-30', toEndDate: '2026-07-31' },
    { at: 2, by: 'M', fromEndDate: '2026-07-31', toEndDate: '2026-08-31' },
  ] });
  assert.equal(isOverExtended(twice), true);
});

console.log('\nThe notification is worded as the favour it usually is');
test('removing hours reads as an improvement, never as a deduction', () => {
  const n = adjustmentNotice(adj({
    id: 'a', unit: 'hours', amount: -0.5, reason: 'filming',
    scope: 'crew', crewLabel: 'Lawn Division #3',
  }));
  assert.match(n.body, /30 min removed from your crew's hours for filming/);
  assert.match(n.body, /improves your efficiency/);
  assert.match(n.body, /pay is unchanged/);
  assert.ok(!/deduct/i.test(n.body + n.title), 'the word "deduction" must never appear');
  assert.match(n.title, /Lawn Division #3/);
});
test('adding percentage also reads as an improvement', () => {
  const n = adjustmentNotice(adj({
    id: 'a', unit: 'percent', amount: 8, reason: 'Lush inherited pricing',
    scope: 'division', division: 'Lawn Division', crewId: undefined,
  }));
  assert.match(n.body, /8% added to your crew's efficiency/);
  assert.match(n.body, /improves your efficiency/);
  assert.match(n.title, /Lawn Division division/);
});
test('an adjustment that genuinely lowers efficiency says so honestly', () => {
  const n = adjustmentNotice(adj({ id: 'a', unit: 'percent', amount: -5, reason: 'over-credited last week' }));
  assert.match(n.body, /lowers your efficiency/);
  assert.match(n.body, /pay is unchanged/);
});
test('whole hours read as hours, not as minutes', () => {
  const n = adjustmentNotice(adj({ id: 'a', unit: 'hours', amount: -2, reason: 'shop meeting' }));
  assert.match(n.body, /2 hrs removed/);
});

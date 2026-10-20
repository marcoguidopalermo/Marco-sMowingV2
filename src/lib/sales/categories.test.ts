// Sales by category and division — made-up invoices.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { invoiceBreakdown, quoteCategoryBreakdown, divisionBH, dollarsPerBH, COMMERCIAL_SNOW, UNATTRIBUTED, type InvoiceRow } from './categories';

const inv = (n: string, d: string, li: InvoiceRow['li'], m: 1 | 2 | 3, w: Record<string, number>): InvoiceRow => {
  const sub = li.reduce((s, l) => s + (Number((l as any)[2]) || 0), 0);
  return { id: n, n, d: `${d}T16:00:00Z`, st: 'paid', sub, tot: Math.round(sub * 113) / 100, cl: 'Client ' + n, url: '#' + n, li, m, w };
};
const rows: InvoiceRow[] = [
  inv('1', '2026-07-10', [['Mowing (Weekly)', 'Mowing (Weekly)', 1000], ['Gold Lawn Care Package', 0, 300]], 1, { 'Lawn Division': 1 }),
  inv('2', '2026-07-12', [['Sod Installation', 'Sod Installation', 3000], ['Hedge trimming', 'Hedge trimming', 500], ['15% off', 0, -300]], 1, { 'Large Projects': 0.75, 'Small Projects': 0.25 }),
  inv('3', '2026-08-01', [['Terra Vista - Snow Plowing', 0, 800], ['Parking lot sweeping', 0, 200]], 3, {}),
  inv('4', '2026-08-02', [['Landscaping Project', 0, 2000]], 2, { 'Small Projects': 1 }),
  inv('5', '2026-08-03', [['L6060 Kubota Tractor plus Blower', 0, 20000], ['Extra trimming in backyard', 0, 150], ['lawn ripped', 0, 220]], 3, {}),
  inv('6', '2025-12-30', [['Mowing (Weekly)', 'Mowing (Weekly)', 999]], 1, { 'Lawn Division': 1 }),
];
const R = { from: '2026-01-01', to: '2026-12-31' };
const b = invoiceBreakdown(rows, R);

test('categories: decisions applied; discount off the largest service; landscaping project 50/50; assets excluded', () => {
  const c = Object.fromEntries(b.byCategory.map(x => [x.key, x.pre]));
  assert.deepEqual(c, { 'Lawn mowing': 1000, 'Lawn care': 300, 'Sod': 2700, 'Hedges & shrubs': 500, 'Snow': 800, 'Sweeping': 200, 'Hardscape & gravel': 1000, 'Garden beds & landscaping': 1000, 'Other': 370 });
  assert.equal(b.total.pre, 7870);
  assert.equal(b.invoices, 5);
  assert.deepEqual(b.assets.map(a => [a.n, a.amount]), [['5', 20000]]);
});
test('divisions: snow → Commercial snow; rest by method 1/2 weights; unattributed kept and listed', () => {
  const d = Object.fromEntries(b.byDivision.map(x => [x.key, [x.pre, x.method1, x.method2]]));
  assert.deepEqual(d['Lawn Division'], [1300, 1300, 0]);
  assert.deepEqual(d['Large Projects'], [2400, 2400, 0]);
  assert.deepEqual(d['Small Projects'], [2800, 800, 2000]);
  assert.deepEqual(d[COMMERCIAL_SNOW], [800, 0, 0]);
  assert.deepEqual(d[UNATTRIBUTED], [570, 0, 0]);
  assert.equal(b.byDivision.reduce((s, x) => s + x.pre, 0), b.total.pre);
  assert.deepEqual(b.unattributed.map(u => [u.n, u.amount]), [['5', 370], ['3', 200]]);
});
test('lists: trimming and unmapped lines, with invoice details', () => {
  assert.deepEqual(b.trimming.map(t => [t.n, t.cl, t.d, t.text, t.amount]), [['5', 'Client 5', '2026-08-03', 'Extra trimming in backyard', 150]]);
  assert.deepEqual(b.unmapped.map(t => [t.n, t.text]), [['5', 'lawn ripped']]);
});
test('month by month; tax-inclusive pro rata; overrides apply', () => {
  assert.deepEqual(b.months, ['2026-07', '2026-08']);
  assert.equal(b.monthly[0].total, 4500);
  assert.equal(b.total.incl, Math.round(7870 * 1.13 * 100) / 100);
  const o = invoiceBreakdown(rows, R, { names: { 'lawn ripped': 'Sod' } });
  assert.equal(o.byCategory.find(x => x.key === 'Sod')!.pre, 2920);
});
test('quotes: won (sent in range) and pipeline by category; optional lines only when selected', () => {
  const q = (s: string, sent: string, li: any) => ({ s, sent: `${sent}T16:00:00Z`, sub: 1, tot: 1.13, li });
  const out = quoteCategoryBreakdown([
    q('approved', '2026-07-01', [['Mowing (Weekly)', 'Mowing (Weekly)', 500, 0, -1], ['Dethatching', 'Dethatching', 200, 1, 0]]),
    q('awaiting_response', '2026-08-01', [['Sod Installation', 'Sod Installation', 4000, 0, -1], ['Hedge trimming', 'Hedge trimming', 300, 1, 1]]),
  ], R);
  assert.deepEqual(out.won.ranked.map(x => [x.key, x.pre]), [['Lawn mowing', 500]]);
  assert.deepEqual(out.pipeline.ranked.map(x => [x.key, x.pre]), [['Sod', 4000], ['Hedges & shrubs', 300]]);
});
test('BH per division only for months that have BH; $ per BH over those months', () => {
  const info = divisionBH({ '2026-07': { 'Lawn Division': 26, 'Large Projects': 30 } }, b.months);
  assert.deepEqual([info.withBH, info.without], [['2026-07'], ['2026-08']]);
  assert.equal(dollarsPerBH(b, 'Lawn Division', info), 50);
  assert.equal(dollarsPerBH(b, 'Large Projects', info), 80);
  assert.equal(dollarsPerBH(b, COMMERCIAL_SNOW, info), null);
  const cur = divisionBH({ '2026-07': { 'Lawn Division': 26 }, '2026-08': { 'Lawn Division': 10 } }, b.months, '2026-08');
  assert.deepEqual([cur.withBH, cur.inProgress, cur.bh['Lawn Division']], [['2026-07'], '2026-08', 26]);   // the month in progress is left out
});
test('lines as stored by the pull (objects — Firestore has no nested arrays) categorise the same', () => {
  const stored: InvoiceRow = { id: 'o', n: 'o', d: '2026-07-10T16:00:00Z', st: 'paid', sub: 1300, tot: 1469, cl: 'C', url: '#', m: 1, w: { 'Lawn Division': 1 },
    li: [{ t: 'Mowing (Weekly)', k: 'Mowing (Weekly)', a: 1000 }, { t: 'Gold Lawn Care Package', a: 300 }] };
  const out = invoiceBreakdown([stored], R);
  assert.deepEqual(out.byCategory.map(x => [x.key, x.pre]), [['Lawn mowing', 1000], ['Lawn care', 300]]);
  const q = quoteCategoryBreakdown([{ s: 'awaiting_response', sent: '2026-07-01T16:00:00Z', sub: 1, tot: 1, li: [{ t: 'Sod Installation', k: 'Sod Installation', a: 4000 }, { t: 'Hedge trimming', a: 300, o: 1, s: 0 }] }], R);
  assert.deepEqual(q.pipeline.ranked.map(x => [x.key, x.pre]), [['Sod', 4000]]);
});

import { categoryDivisionMap, FALLBACK_MIN_BASIS } from './categories';
import { lineOverrideKey } from '../../../functions/src/shared/serviceCategories';
test('method 4: unattributed money goes to the division crew records put that category in — only where clear', () => {
  const big: InvoiceRow[] = [
    inv('10', '2026-07-01', [['Mowing (Weekly)', 'Mowing (Weekly)', 9000]], 1, { 'Lawn Division': 1 }),
    inv('11', '2026-07-02', [['Sod Installation', 'Sod Installation', 6000]], 1, { 'Large Projects': 1 }),
    inv('12', '2026-07-03', [['Sod Installation', 'Sod Installation', 5000]], 1, { 'Small Projects': 1 }),   // sod: Large 55% — not clear
    inv('13', '2026-08-01', [['Seasonal Mowing Instalment', 0, 900], ['Sod Installation', 'Sod Installation', 400], ['Parking lot sweeping', 0, 300]], 3, {}),
  ];
  const map = Object.fromEntries(categoryDivisionMap(big).map(c => [c.category, c]));
  assert.equal(map['Lawn mowing'].division, 'Lawn Division'); assert.equal(map['Lawn mowing'].used, true);
  assert.equal(map['Sod'].used, false);                                  // 55% < 60%
  const out = invoiceBreakdown(big, R);
  const d = Object.fromEntries(out.byDivision.map(x => [x.key, [x.pre, x.method4]]));
  assert.deepEqual(d['Lawn Division'], [9900, 900]);
  assert.deepEqual(d[UNATTRIBUTED], [700, 0]);                           // sod (unclear) + sweeping (no evidence)
  assert.deepEqual(out.unattributed.map(u => [u.n, u.amount]), [['13', 700]]);
  assert.ok(FALLBACK_MIN_BASIS > 0);
});
test('per-invoice override wins over every rule, for that invoice only', () => {
  const two = [
    inv('6948', '2026-08-20', [['Additional Requested Trimming', 0, 400]], 1, { 'Lawn Division': 1 }),
    inv('7041', '2026-08-31', [['Additional Requested Trimming', 0, 400]], 1, { 'Lawn Division': 1 }),
  ];
  const o = { lines: { [lineOverrideKey('6948', 'Additional Requested Trimming')]: { category: 'Lawn mowing' as const, by: 'Marco', at: 1, note: 'mowing trimming' } } };
  const out = invoiceBreakdown(two, R, o);
  assert.deepEqual(out.byCategory.map(x => [x.key, x.pre]).sort(), [['Lawn mowing', 400], ['Other', 400]]);
  assert.deepEqual(out.trimming.map(t => t.n), ['7041']);              // #6948 no longer listed as trimming
});

// The service map (2026-10-21) — made-up lines.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { serviceCategory, DIVISION_OF, SERVICE_CATEGORIES } from './serviceMap';
import { serviceBreakdown, type InvoiceRow } from './categories';
import { addDays } from './periods';

test('each category belongs to exactly one division (fees and unassigned to none)', () => {
  for (const c of SERVICE_CATEGORIES) assert.equal(!!DIVISION_OF[c], c !== 'Fees & adjustments' && c !== 'Unassigned', c);
});
test('lines → categories, per the new structure', () => {
  const cases: [string, string, string][] = [
    ['Lawn mowing', 'Brush clearing', 'Lawn mowing'],
    ['Lawn care', 'Gold Lawn Care Package', 'Lawn care'],
    ['Other', 'Condo 54 - Spring Lawn Treatment', 'Lawn care'],
    ['Other', 'Lawn restoration treatment', 'Lawn care'],
    ['Other', 'Weed Management', 'Lawn care'],
    ['Lawn care', 'ADD ON - Dethatching', 'Dethatching'],
    ['Lawn care', 'Aerate + Dethatch', 'Dethatching'],
    ['Lawn care', 'De-weeding driveway + weed spray application (Hourly)', 'Cleanups & gardens'],
    ['Other', 'Driveway Weed Removal & Spray', 'Cleanups & gardens'],
    ['Cleanups', 'Spring Cleanup', 'Cleanups & gardens'],
    ['Hedges & shrubs', 'Hedge trimming', 'Arborist'],
    ['Tree & stump', 'tree trimming', 'Arborist'],
    ['Tree & stump', 'Stump Grinding', 'Stump grinding'],
    ['Hardscape & gravel', 'Laying Paving Stones', 'Hardscape'],
    ['Hardscape & gravel', 'Extra stones for front walkway', 'Hardscape'],
    ['Hardscape & gravel', 'CHANGE ORDER - Extra stone edging', 'Hardscape'],
    ['Hardscape & gravel', 'Landscaping Project', 'Hardscape'],
    ['Hardscape & gravel', 'Crusher fine driveway installation', 'Driveways'],
    ['Other', 'Full driveway (front addition included)', 'Driveways'],
    ['Hardscape & gravel', 'River rock bed installation', 'Gravel & rock'],
    ['Hardscape & gravel', 'Lawn Grading - drainage', 'Grading & drainage'],
    ['Hardscape & gravel', 'Asphalt Road Repair', 'Grading & drainage'],
    ['Hardscape & gravel', 'Roadway Re-levelling (done 1x/year)', 'Grading & drainage'],
    ['Other', 'Lawn Ripped', 'Grading & drainage'],
    ['Other', 'Field Repair', 'Grading & drainage'],
    ['Garden beds & landscaping', 'Top Soil Delivery', 'Soil & prep'],
    ['Garden beds & landscaping', 'Rototill + soil application', 'Soil & prep'],
    ['Garden beds & landscaping', 'Mulching', 'Cleanups & gardens'],
    ['Dump runs', 'Dump Run - minimum charge', 'Dump runs'],
    ['Other', 'Disposal Fee [$100]', 'Dump runs'],
    ['Other', 'Hauling/disposal fee [per cubic yard]', 'Dump runs'],
    ['Sweeping', 'Driveway Sweeping', 'Sweeping'],
    ['Snow', 'Snow plowing driveway', 'Commercial snow'],
    ['Snow', 'Return Visit', 'Commercial snow'],
    ['Other', 'Credit Card Processing Fee [3%]', 'Fees & adjustments'],
    ['Other', 'Deposit', 'Fees & adjustments'],
    ['Other', 'Add On - Follow-up visits', 'Fees & adjustments'],
    ['Other', 'Rush + Travel Fee [$450]', 'Fees & adjustments'],
    ['Other', 'Fence Repair', 'Unassigned'],
    ['Arborist', 'anything', 'Arborist'],               // an override in the new categories wins
  ];
  for (const [base, text, want] of cases) assert.equal(serviceCategory(base, text), want, text);
});

const inv = (n: string, d: string, li: InvoiceRow['li'], w: Record<string, number> = { 'Lawn Division': 1 }): InvoiceRow => {
  const sub = li.reduce((s, l) => s + (Number((l as any)[2]) || 0), 0);
  return { id: n, n, d: `${d}T16:00:00Z`, st: 'paid', sub, tot: Math.round(sub * 113) / 100, cl: 'C' + n, url: '#', li, m: 1, w };
};
const rows: InvoiceRow[] = [
  inv('1', '2026-05-04', [['Mowing (Weekly)', 'Mowing (Weekly)', 1000], ['30% OFF - Late start discount', 0, -300]]),
  inv('2', '2026-05-20', [['Dethatching', 'Dethatching', 400], ['Gold Lawn Care Package', 0, 600], ['Disposal Fee', 0, 50]], { 'Small Projects': 1 }),
  inv('3', '2026-06-11', [['Crusher fine driveway installation', 0, 5000], ['River rock bed', 0, 1000], ['Bundle Discount', 0, -500], ['Credit Card Processing Fee [3%]', 0, 150]], { 'Small Projects': 1 }),
  inv('4', '2026-09-28', [['Landscaping project', 0, 30000]], { 'Large Projects': 1 }),
  inv('5', '2026-01-15', [['Snow plowing', 0, 2000], ['Return Visit', 0, 100]], {}),
  inv('6', '2026-08-03', [['Sale of 2007 F-150', 0, 1000], ['Fence Repair', 0, 480]], {}),
];
test('a division is the sum of its categories; one total for both; equipment sales out', () => {
  const b = serviceBreakdown(rows, { from: '2026-01-01', to: '2026-12-31' });
  const c = Object.fromEntries(b.byCategory.map(x => [x.key, x.pre]));
  assert.deepEqual(c, {
    'Lawn mowing': 700, 'Lawn care': 600, 'Dethatching': 400, 'Dump runs': 50,
    'Driveways': 4500, 'Gravel & rock': 1000, 'Fees & adjustments': 150,                       // the discount came off the largest (driveway)
    'Hardscape': 15000, 'Cleanups & gardens': 15000,                                              // #7306-style 50/50 kept
    'Commercial snow': 2100, 'Unassigned': 480,
  });
  const d = Object.fromEntries(b.byDivision.map(x => [x.key, x.pre]));
  assert.deepEqual(d, { 'Lawn': 1300, 'Small Projects': 15400, 'Large Projects': 20550, 'Commercial snow': 2100 });
  assert.equal(b.total.pre, 39980);
  assert.equal(b.byDivision.reduce((s, x) => s + x.share, 0) + b.outside.reduce((s, x) => s + x.share, 0), 1);
  assert.deepEqual(b.assets.map(a => a.text), ['Sale of 2007 F-150']);
  assert.deepEqual(b.checks, []);
});
test('built-in check holds for every date range', () => {
  for (let i = 0; i < 365; i += 9) for (const len of [0, 6, 30, 120]) {
    const from = addDays('2026-01-01', i), to = addDays(from, len);
    const b = serviceBreakdown(rows, { from, to });
    assert.deepEqual(b.checks, [], `${from}..${to}`);
    for (const dv of b.byDivision) assert.equal(dv.pre, Math.round(b.byCategory.filter(x => DIVISION_OF[x.key] === dv.key).reduce((s, x) => s + x.pre, 0) * 100) / 100);
  }
});

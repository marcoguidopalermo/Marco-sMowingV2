// One-off materials typed on a quote ("Artificial turf — $1,500").
//   npm test -- customMaterials
//
// They must behave like rate-sheet materials everywhere the price is concerned
// — total, BH identity, price-first — and never be counted as pure profit when
// nobody has said what they cost.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  bhFromPrice, buildQuoteSnapshot, computeProfitTable, computeQuote, customQtyLabel, DEFAULT_SALES_RATES,
  priceFirstWorking, priceFromBH, profitRevenue,
} from './salesMaster';
import type { SalesCustomMaterial, SalesRates } from '../types';

// The worked sod example from verify-salesmaster: $1,000 of rate-sheet
// materials ($740 cost), 20 BH of Sod at $120/hr (labour cost $30/hr).
const RATES: SalesRates = DEFAULT_SALES_RATES;
const SOD = RATES.services.find(s => s.id === 'svc-sod')!;
const LINES = [
  { materialId: 'mat-sod', qty: 1000 },
  { materialId: 'mat-soil', qty: 6 },
  { materialId: 'mat-disposal', qty: 2 },
];
const TURF: SalesCustomMaterial = { id: 'c1', description: 'Artificial turf', charge: 1500 };

console.log('\nThe price side: exactly like a preset material');
test('the charge is in materials, the total, and the breakdown split', () => {
  const q = computeQuote(SOD, LINES, 20, RATES, [TURF]);
  assert.equal(q.presetMaterialsCharged, 1000);
  assert.equal(q.customMaterialsCharged, 1500);
  assert.equal(q.materialsCharged, 2500);
  assert.equal(q.labourCharge, 2400);
  assert.equal(q.quoteTotal, 4900);
  assert.deepEqual(q.customLines, [{ id: 'c1', description: 'Artificial turf', qty: 1, unitCharge: 1500, charge: 1500 }]);
});

test('price ⇄ BH identity holds with the custom charge in materials', () => {
  const q = computeQuote(SOD, LINES, 20, RATES, [TURF]);
  assert.equal(bhFromPrice(4900, q.materialsCharged, q.serviceRate), 20);
  assert.equal(priceFromBH(20, q.materialsCharged, q.serviceRate), 4900);
  // +$1,200 all flows to BH, materials held constant.
  assert.equal(bhFromPrice(6100, q.materialsCharged, q.serviceRate), 30);
});

test('price-first working counts the custom line as materials', () => {
  const q = computeQuote(SOD, LINES, 0, RATES, [TURF]);
  const w = priceFirstWorking(6100, q.materialsCharged, q.serviceRate);
  assert.equal(w.exact, 30);
  assert.match(w.working, /\$6,100\.00 − \$2,500\.00 materials = \$3,600\.00 ÷ \$120\/hr = 30 BH/);
});

test('a quote with no custom lines is unchanged (the existing sod example)', () => {
  const q = computeQuote(SOD, LINES, 20, RATES);
  const pt = computeProfitTable(q, SOD, RATES);
  assert.equal(q.quoteTotal, 3400);
  assert.equal(pt.revenue, 3400);
  assert.deepEqual(pt.cols.map(c => c.gp), [2060, 1910, 1660]);
  assert.deepEqual(pt.excludedLines, []);
});

console.log('\nThe profit side');
test('with a cost entered, the line is in material cost and profit, all three scenarios', () => {
  const q = computeQuote(SOD, LINES, 20, RATES, [{ ...TURF, cost: 1100 }]);
  const pt = computeProfitTable(q, SOD, RATES);
  assert.equal(q.materialsCost, 740 + 1100);
  assert.equal(pt.revenue, 4900);
  assert.deepEqual(pt.excludedLines, []);
  // 4900 − (1840 + 600/750/1000)
  assert.deepEqual(pt.cols.map(c => c.gp), [2460, 2310, 2060]);
  assert.deepEqual(pt.cols.map(c => c.margin), [50.2, 47.14, 42.04]);
});

test('with the cost BLANK, its charge is not counted as profit — the line is named instead', () => {
  const q = computeQuote(SOD, LINES, 20, RATES, [TURF]);
  const pt = computeProfitTable(q, SOD, RATES);
  assert.equal(q.materialsCost, 740);                    // nothing assumed for the turf
  assert.equal(q.unknownCostCharge, 1500);
  assert.equal(pt.excludedCharge, 1500);
  assert.deepEqual(pt.excludedLines.map(c => c.description), ['Artificial turf']);
  assert.equal(pt.revenue, 3400);
  // Exactly the no-turf job's profit — NOT 3560/3410/3160, which is what
  // treating the turf as free would have reported.
  assert.deepEqual(pt.cols.map(c => c.gp), [2060, 1910, 1660]);
  assert.deepEqual(pt.cols.map(c => c.margin), [60.59, 56.18, 48.82]);
});

test('a cost of 0 typed deliberately is a known zero, not unknown', () => {
  const q = computeQuote(SOD, LINES, 20, RATES, [{ ...TURF, cost: 0 }]);
  const pt = computeProfitTable(q, SOD, RATES);
  assert.deepEqual(pt.excludedLines, []);
  assert.equal(pt.revenue, 4900);
  assert.equal(pt.cols[0].gp, 3560);
});

test('mixed: one known, one unknown', () => {
  const q = computeQuote(SOD, LINES, 20, RATES, [
    { ...TURF, cost: 1100 },
    { id: 'c2', description: 'Boulder', charge: 400 },
  ]);
  assert.equal(q.materialsCharged, 2900);
  assert.equal(profitRevenue(q), 4900);                   // 5300 total − 400 unknown
  assert.equal(computeProfitTable(q, SOD, RATES).cols[0].gp, 2460);
});

console.log('\nSaved quotes and the rate sheet');
test('a saved quote keeps its custom lines (charge and cost) and reopens to the same total', () => {
  const q = computeQuote(SOD, LINES, 20, RATES, [{ ...TURF, cost: 1100 }, { id: 'c2', description: 'Boulder', charge: 400 }]);
  const snap = buildQuoteSnapshot('quote-1', 'Backyard', SOD, q, RATES);
  assert.deepEqual(snap.customMaterials, [
    { id: 'c1', description: 'Artificial turf', qty: 1, unitCharge: 1500, charge: 1500, unitCost: 1100, cost: 1100 },
    { id: 'c2', description: 'Boulder', qty: 1, unitCharge: 400, charge: 400 },
  ]);
  const reopened = computeQuote(SOD, snap.lines.map(l => ({ materialId: l.materialId, qty: l.qty })), snap.bh, RATES, snap.customMaterials);
  assert.equal(reopened.quoteTotal, snap.quoteTotal);
  assert.equal(reopened.materialsCharged, snap.materialsCharged);
});

test('an older saved quote with no customMaterials field still computes', () => {
  const q = computeQuote(SOD, LINES, 20, RATES, undefined);
  assert.equal(q.quoteTotal, 3400);
  assert.deepEqual(q.customLines, []);
});

test('custom lines never touch the rate sheet', () => {
  const before = JSON.stringify(RATES);
  const q = computeQuote(SOD, LINES, 20, RATES, [TURF]);
  buildQuoteSnapshot('quote-2', 'x', SOD, q, RATES);
  computeProfitTable(q, SOD, RATES);
  assert.equal(JSON.stringify(RATES), before);
  assert.equal(RATES.materials.some(m => /turf/i.test(m.name)), false);
});

console.log('\nQuantity × unit charge');
// "Artificial turf — 300 sq ft × $5.00 = $1,500" — the same turf as above,
// entered by the unit instead of as a lump sum.
const TURF_QTY: SalesCustomMaterial = { id: 'c1', description: 'Artificial turf', qty: 300, unit: 'sq ft', unitCharge: 5, charge: 0 };

test('the line total is qty × unit charge — a typed charge is ignored', () => {
  const q = computeQuote(SOD, LINES, 20, RATES, [{ ...TURF_QTY, charge: 99999 }]);
  assert.equal(q.customLines[0].charge, 1500);
  assert.equal(q.customMaterialsCharged, 1500);
  assert.equal(q.materialsCharged, 2500);
  assert.equal(q.quoteTotal, 4900);
});

test('by-the-unit and lump-sum entries of the same turf give identical quotes and profit', () => {
  const a = computeQuote(SOD, LINES, 20, RATES, [{ ...TURF_QTY, unitCost: 11 / 3 }]);
  const b = computeQuote(SOD, LINES, 20, RATES, [{ ...TURF, cost: 1100 }]);
  assert.equal(a.quoteTotal, b.quoteTotal);
  assert.equal(a.materialsCost, b.materialsCost);
  assert.deepEqual(computeProfitTable(a, SOD, RATES).cols, computeProfitTable(b, SOD, RATES).cols);
});

test('unit cost: line cost = qty × unit cost, all three scenarios', () => {
  const q = computeQuote(SOD, LINES, 20, RATES, [{ ...TURF_QTY, unitCost: 3.5 }]);
  assert.equal(q.customLines[0].cost, 1050);
  assert.equal(q.materialsCost, 740 + 1050);
  // 4900 − (1790 + 600/750/1000)
  assert.deepEqual(computeProfitTable(q, SOD, RATES).cols.map(c => c.gp), [2510, 2360, 2110]);
});

test('unit cost blank: margin unknown, the line total is left out of profit', () => {
  const q = computeQuote(SOD, LINES, 20, RATES, [TURF_QTY]);
  const pt = computeProfitTable(q, SOD, RATES);
  assert.equal(q.unknownCostCharge, 1500);
  assert.equal(pt.revenue, 3400);
  assert.deepEqual(pt.cols.map(c => c.gp), [2060, 1910, 1660]);
});

test('price ⇄ BH and price-first use the computed line total', () => {
  const q = computeQuote(SOD, LINES, 20, RATES, [TURF_QTY]);
  assert.equal(bhFromPrice(6100, q.materialsCharged, q.serviceRate), 30);
  assert.match(priceFirstWorking(6100, q.materialsCharged, q.serviceRate).working, /− \$2,500\.00 materials/);
});

test('blank qty is the default 1; qty 0 is zero', () => {
  assert.equal(computeQuote(SOD, [], 0, RATES, [{ ...TURF_QTY, qty: undefined }]).customLines[0].charge, 5);
  assert.equal(computeQuote(SOD, [], 0, RATES, [{ ...TURF_QTY, qty: 0 }]).customLines[0].charge, 0);
});

test('a saved quantity line reopens with its qty, unit and prices', () => {
  const q = computeQuote(SOD, LINES, 20, RATES, [{ ...TURF_QTY, unitCost: 3.5 }]);
  const snap = buildQuoteSnapshot('quote-3', 'Turf', SOD, q, RATES);
  assert.deepEqual(snap.customMaterials, [
    { id: 'c1', description: 'Artificial turf', qty: 300, unit: 'sq ft', unitCharge: 5, charge: 1500, unitCost: 3.5, cost: 1050 },
  ]);
  const reopened = computeQuote(SOD, LINES, 20, RATES, snap.customMaterials);
  assert.equal(reopened.quoteTotal, snap.quoteTotal);
  assert.equal(reopened.materialsCost, q.materialsCost);
});

test('a lump-sum line saved before quantities existed reads as 1 × its amount', () => {
  // Exactly the stored shape of a pre-quantity quote.
  const old = [{ id: 'c1', description: 'Artificial turf', charge: 1500, cost: 1100 }, { id: 'c2', description: 'Boulder', charge: 400 }];
  const q = computeQuote(SOD, LINES, 20, RATES, old);
  assert.equal(q.quoteTotal, 5300);
  assert.equal(q.materialsCost, 1840);
  assert.equal(q.unknownCostCharge, 400);
  assert.deepEqual(q.customLines.map(c => [c.qty, c.unitCharge, c.charge, c.cost]), [[1, 1500, 1500, 1100], [1, 400, 400, undefined]]);
  assert.deepEqual(q.customLines.map(customQtyLabel), ['', '']);   // breakdown reads as before
});

test('breakdown label: "300 sq ft @ $5.00"', () => {
  assert.equal(customQtyLabel({ qty: 300, unit: 'sq ft', unitCharge: 5 }), '300 sq ft @ $5.00');
  assert.equal(customQtyLabel({ qty: 12, unitCharge: 8.5 }), '12 @ $8.50');
  assert.equal(customQtyLabel({ qty: 1, unit: 'each', unitCharge: 400 }), '1 each @ $400.00');
  assert.equal(customQtyLabel({ qty: 1, unitCharge: 400 }), '');
});

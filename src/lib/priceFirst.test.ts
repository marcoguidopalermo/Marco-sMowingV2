// Price-first quoting — the working, the precision, and Marco's example.
//   npm test -- priceFirst
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  priceFirstWorking, bhFromPrice, priceFromBH, computeQuote, round2,
  DEFAULT_SALES_RATES,
} from './salesMaster';
import type { SalesRates } from '../types';


// Marco's example: 10 yards crusher fines, target price $4,500. Crusher fines
// live on the live rate sheet; the figures below are the ones in his own
// worked example — $60/yd charge and a $120/hr service.
const RATES: SalesRates = {
  ...DEFAULT_SALES_RATES,
  services: [{ id: 'svc-hardscape', name: 'Hardscape', chargeRatePerHr: 120, labourCostPerHr: 30, active: true }],
  materials: [{ id: 'mat-crusher', name: 'Crusher Fines', unit: 'yard', costPerUnit: 42, chargePerUnit: 60, active: true }],
};
const SERVICE = RATES.services[0];
const LINES = [{ materialId: 'mat-crusher', qty: 10 }];

console.log("\nMarco's example — 10 yards crusher fines, target $4,500");
test('materials charge computes from the rate sheet: 10 × $60 = $600', () => {
  const q = computeQuote(SERVICE, LINES, 0, RATES);
  assert.equal(q.materialsCharged, 600);
  assert.equal(q.serviceRate, 120);
});
test('target price $4,500 → 32.5 BH', () => {
  const q = computeQuote(SERVICE, LINES, 0, RATES);
  const w = priceFirstWorking(4500, q.materialsCharged, q.serviceRate);
  assert.equal(w.labourBudget, 3900);
  assert.equal(w.exact, 32.5);
  assert.equal(w.display, 32.5);
  assert.equal(w.rounds, false, 'this one lands exactly on 2 dp');
});
test('the working reads as the arithmetic it is', () => {
  const w = priceFirstWorking(4500, 600, 120);
  assert.equal(w.working, '$4,500.00 − $600.00 materials = $3,900.00 ÷ $120/hr = 32.5 BH');
});
test('the resulting BH re-derives the target price exactly', () => {
  const w = priceFirstWorking(4500, 600, 120);
  const q = computeQuote(SERVICE, LINES, w.exact, RATES);
  assert.equal(q.quoteTotal, 4500);
  assert.equal(q.labourCharge, 3900);
});

console.log('\nTwo-way, live');
test('price → BH → price is a round trip', () => {
  const bh = bhFromPrice(4500, 600, 120);
  assert.equal(priceFromBH(bh, 600, 120), 4500);
});
test('BH → price → BH is a round trip', () => {
  const price = priceFromBH(32.5, 600, 120);
  assert.equal(price, 4500);
  assert.equal(bhFromPrice(price, 600, 120), 32.5);
});
test('changing materials moves the BH, not the target price', () => {
  // Same $4,500 target, one more yard of fines: labour budget shrinks by $60.
  const q = computeQuote(SERVICE, [{ materialId: 'mat-crusher', qty: 11 }], 0, RATES);
  const w = priceFirstWorking(4500, q.materialsCharged, q.serviceRate);
  assert.equal(w.materialsCharged, 660);
  assert.equal(w.exact, 32);
});

console.log('\nPrecision');
test('BH displays at 2 dp, consistent with the split precision', () => {
  const w = priceFirstWorking(4437.50, 600, 120);
  // (4437.50 − 600) / 120 = 31.979166…
  assert.equal(w.display, 31.98);
  assert.equal(w.rounds, true);
});
test('the EXACT figure is kept so the typed total stays exact', () => {
  const w = priceFirstWorking(4437.50, 600, 120);
  const q = computeQuote(SERVICE, LINES, w.exact, RATES);
  assert.equal(q.quoteTotal, 4437.50, 'the price the estimator typed is what the quote totals');
});
test('and it states what snapping to 2 dp would cost', () => {
  const w = priceFirstWorking(4437.50, 600, 120);
  assert.equal(w.roundedPrice, 4437.60);
  assert.notEqual(w.roundedPrice, w.targetPrice);
});
test('a figure that lands on 2 dp reports no rounding at all', () => {
  const w = priceFirstWorking(4500, 600, 120);
  assert.equal(w.rounds, false);
  assert.equal(w.roundedPrice, 4500);
});

console.log('\nGuards');
test('a price below the materials cost is flagged, not silently negative', () => {
  const w = priceFirstWorking(500, 600, 120);
  assert.equal(w.shortfall, true);
  assert.equal(w.valid, false);
});
test('no service rate → no conversion, and the working says why', () => {
  const w = priceFirstWorking(4500, 600, 0);
  assert.equal(w.valid, false);
  assert.equal(w.exact, 0);
  assert.match(w.working, /pick a service/);
});
test('a price exactly equal to materials is valid and yields 0 BH', () => {
  const w = priceFirstWorking(600, 600, 120);
  assert.equal(w.valid, true);
  assert.equal(w.exact, 0);
});

console.log('\nThe profit panel sees the resulting BH like any other');
test('profit figures follow the price-first BH', () => {
  const w = priceFirstWorking(4500, 600, 120);
  const q = computeQuote(SERVICE, LINES, w.exact, RATES);
  // Labour cost at $30/hr against 32.5 BH, materials cost 10 × $42.
  assert.equal(q.materialsCost, 420);
  assert.equal(round2(q.bh * 30), 975);
});

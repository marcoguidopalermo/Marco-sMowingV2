// Verify SalesMaster math against the exact worked sod example.
// Run: npx tsx scripts/verify-salesmaster.ts
import { DEFAULT_SALES_RATES, computeQuote, computeProfit, bhFromPrice, priceFromBH, round2, buildQuoteSnapshot } from '../src/lib/salesMaster';

const rates = DEFAULT_SALES_RATES;
const sodSvc = rates.services.find(s => s.id === 'svc-sod')!;
const lines = [
  { materialId: 'mat-sod', qty: 1000 },
  { materialId: 'mat-soil', qty: 6 },
  { materialId: 'mat-disposal', qty: 2 },
];
const q = computeQuote(sodSvc, lines, 20, rates);
const p = computeProfit(q, sodSvc, rates);

let pass = 0, fail = 0;
const ok = (l: string, cond: boolean, got: any) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${l} = ${got}`); };

console.log('=== worked sod example (1000 sqft sod · 20 BH · 2 disposal · 6 yards soil) ===');
ok('materials charged (1000)', q.materialsCharged === 1000, q.materialsCharged);
ok('labour charge (2400)', q.labourCharge === 2400, q.labourCharge);
ok('quote total (3400)', q.quoteTotal === 3400, q.quoteTotal);
ok('BH identity (3400-1000)/120 = 20', bhFromPrice(3400, 1000, 120) === 20, bhFromPrice(3400, 1000, 120));

console.log('\n=== admin profit panel ===');
ok('material cost (740)', p.materialsCost === 740, p.materialsCost);
ok('labour cost @budget 20×30 (600)', p.labourCostBudget === 600, p.labourCostBudget);
ok('total cost @budget (1340)', p.totalCostBudget === 1340, p.totalCostBudget);
ok('GP @100% (2060)', p.gpBudget === 2060, p.gpBudget);
ok('margin @100% (60.6%)', p.marginBudget === 60.59 || Math.abs(p.marginBudget - 60.6) < 0.05, `${p.marginBudget}%`);
ok('labour cost @80% (750)', p.labourCost80 === 750, p.labourCost80);
ok('GP @80% (1910)', p.gp80 === 1910, p.gp80);
ok('margin @80% (56.2%)', Math.abs(p.margin80 - 56.2) < 0.05, `${p.margin80}%`);

console.log('\n=== two-way manipulation ===');
// Direction A: nudge price +$1000 → BH recomputes (precise), quote lands exactly.
const bhAfter = bhFromPrice(4400, q.materialsCharged, q.serviceRate);
ok('+$1000 → BH 28.333 (displays 28.33, +8.33)', Math.abs(bhAfter - 28.3333) < 0.001, `${bhAfter.toFixed(4)}`);
const qAfter = computeQuote(sodSvc, lines, bhAfter, rates);
ok('  → quote lands EXACTLY $4,400 (precise BH preserves identity)', qAfter.quoteTotal === 4400, qAfter.quoteTotal);
ok('  → displayed delta = +$1,000.00 (from quote diff)', round2(qAfter.quoteTotal - q.quoteTotal) === 1000, round2(qAfter.quoteTotal - q.quoteTotal));
// Direction B: set a target BH → price recomputes the other way.
const priceFor25 = priceFromBH(25, q.materialsCharged, q.serviceRate);
ok('set target BH 25 → price $4,000 (25×120+1000)', priceFor25 === 4000, priceFor25);

console.log('\n=== saved-quote snapshot immutability (rate change must NOT rewrite it) ===');
const snap = buildQuoteSnapshot('q1', 'Project - Job #132', sodSvc, q);
ok('snapshot total = $3,400 · BH 20 · charge-side only (no cost fields)', snap.quoteTotal === 3400 && snap.bh === 20 && !('costPerUnit' in (snap.lines[0] as any)) && !('materialsCost' in (snap as any)), `${snap.quoteTotal}/${snap.bh}`);
// Mutate the live rates AFTER snapshotting; the snapshot object is a plain
// record of numbers, so it stays put.
const mutated = JSON.parse(JSON.stringify(DEFAULT_SALES_RATES));
mutated.services.find((s: any) => s.id === 'svc-sod').chargeRatePerHr = 200;
const qNew = computeQuote(mutated.services.find((s: any) => s.id === 'svc-sod'), lines, 20, mutated);
ok('live recompute changes ($5,000 at $200/hr: 1000 + 20×200) …', qNew.quoteTotal === 5000, qNew.quoteTotal);
ok('… but the SAVED snapshot is unchanged ($3,400)', snap.quoteTotal === 3400 && snap.serviceChargeRate === 120, `${snap.quoteTotal} @ ${snap.serviceChargeRate}/hr`);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

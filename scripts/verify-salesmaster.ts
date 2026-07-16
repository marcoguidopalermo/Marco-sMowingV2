// Verify SalesMaster math against the exact worked sod example.
// Run: npx tsx scripts/verify-salesmaster.ts
import { DEFAULT_SALES_RATES, computeQuote, computeProfitTable, bhFromPrice, priceFromBH, round2, buildQuoteSnapshot } from '../src/lib/salesMaster';

const rates = DEFAULT_SALES_RATES;
const sodSvc = rates.services.find(s => s.id === 'svc-sod')!;
const lines = [
  { materialId: 'mat-sod', qty: 1000 },
  { materialId: 'mat-soil', qty: 6 },
  { materialId: 'mat-disposal', qty: 2 },
];
const q = computeQuote(sodSvc, lines, 20, rates);
const pt = computeProfitTable(q, sodSvc, rates);

let pass = 0, fail = 0;
const ok = (l: string, cond: boolean, got: any) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${l} = ${got}`); };

console.log('=== worked sod example (1000 sqft sod · 20 BH · 2 disposal · 6 yards soil) ===');
ok('materials charged (1000)', q.materialsCharged === 1000, q.materialsCharged);
ok('labour charge (2400)', q.labourCharge === 2400, q.labourCharge);
ok('quote total (3400)', q.quoteTotal === 3400, q.quoteTotal);
ok('BH identity (3400-1000)/120 = 20', bhFromPrice(3400, 1000, 120) === 20, bhFromPrice(3400, 1000, 120));

console.log('\n=== admin profit panel — 3 scenarios (overhead $30/BH) ===');
ok('overhead per BH seeded ($30)', pt.overheadPerBH === 30 && pt.hasOverhead, pt.overheadPerBH);
ok('overhead allocation (20×30 = 600, constant)', pt.overhead === 600, pt.overhead);
const [c100, c80, c60] = pt.cols;
const row = (label: string, a: number, b: number, c: number, ea: number, eb: number, ec: number) =>
  ok(`${label.padEnd(20)} ${a} / ${b} / ${c}`, a === ea && b === eb && Math.abs(c - ec) < 0.02, `${a}/${b}/${c}`);
row('actual hours', c100.actualHours, c80.actualHours, c60.actualHours, 20, 25, 33.33);
row('labour cost', c100.labourCost, c80.labourCost, c60.labourCost, 600, 750, 1000);
row('material cost', c100.materialCost, c80.materialCost, c60.materialCost, 740, 740, 740);
row('gross profit', c100.gp, c80.gp, c60.gp, 2060, 1910, 1660);
row('gp margin %', c100.margin, c80.margin, c60.margin, 60.59, 56.18, 48.82);
row('net after ovhd', c100.net, c80.net, c60.net, 1460, 1310, 1060);
row('net margin %', c100.netMargin, c80.netMargin, c60.netMargin, 42.94, 38.53, 31.18);
// hide net rows when overhead is 0
const noOvhd = computeProfitTable(q, sodSvc, { ...rates, overheadPerBH: 0 });
ok('overheadPerBH 0 → hasOverhead false (net rows hidden)', noOvhd.hasOverhead === false, noOvhd.hasOverhead);

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
const snap = buildQuoteSnapshot('q1', 'Project - Job #132', sodSvc, q, rates);
ok('snapshot total $3,400 · BH 20 · overhead $30 snapshotted · no material/labour cost fields', snap.quoteTotal === 3400 && snap.bh === 20 && snap.overheadPerBH === 30 && !('costPerUnit' in (snap.lines[0] as any)) && !('materialsCost' in (snap as any)), `${snap.quoteTotal}/${snap.bh}/ovhd ${snap.overheadPerBH}`);
// Mutate the live rates AFTER snapshotting; the snapshot object is a plain
// record of numbers, so it stays put.
const mutated = JSON.parse(JSON.stringify(DEFAULT_SALES_RATES));
mutated.services.find((s: any) => s.id === 'svc-sod').chargeRatePerHr = 200;
const qNew = computeQuote(mutated.services.find((s: any) => s.id === 'svc-sod'), lines, 20, mutated);
ok('live recompute changes ($5,000 at $200/hr: 1000 + 20×200) …', qNew.quoteTotal === 5000, qNew.quoteTotal);
ok('… but the SAVED snapshot is unchanged ($3,400)', snap.quoteTotal === 3400 && snap.serviceChargeRate === 120, `${snap.quoteTotal} @ ${snap.serviceChargeRate}/hr`);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

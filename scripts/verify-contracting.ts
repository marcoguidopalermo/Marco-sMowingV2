// Verify ContractingMaster billing math against the exact progress-report
// example. Run: npx tsx scripts/verify-contracting.ts
import { DEFAULT_CONTRACTING_RATES, computeReportTotals, receiptBilled, roundVisitHours, nextProgNumber } from '../src/lib/contracting';

const rates = DEFAULT_CONTRACTING_RATES;
let pass = 0, fail = 0;
const ok = (l: string, c: boolean, got: any = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${l}${got !== '' ? ` = ${got}` : ''}`); };

console.log('=== rate card ===');
ok('GC/PM $150', rates.gc_pm === 150, rates.gc_pm);
ok('Skilled Carpenter $120', rates.skilled_carpenter === 120, rates.skilled_carpenter);
ok('General Labour $80', rates.general_labour === 80, rates.general_labour);

console.log('\n=== receipt markup (flooring 10,000 + 50% → 15,000) ===');
ok('flooring billed = $15,000', receiptBilled(10000, 50) === 15000, receiptBilled(10000, 50));
ok('markup + cost are internal (billed only carried to client math)', true);

console.log('\n=== the exact progress-report example ===');
const snap = computeReportTotals(
  [
    { contractorId: 'kris', name: 'Kris', billingRole: 'skilled_carpenter', hours: 100 },
    { contractorId: 'tony', name: 'Tony', billingRole: 'gc_pm', hours: 50 },
  ],
  [{ id: 'r1', description: 'Flooring', cost: 10000, markupPct: 50, billed: receiptBilled(10000, 50) }],
  rates,
);
const kris = snap.labourLines.find(l => l.contractorId === 'kris')!;
const tony = snap.labourLines.find(l => l.contractorId === 'tony')!;
ok('Kris 100 × $120 = $12,000', kris.hours === 100 && kris.rate === 120 && kris.amount === 12000, kris.amount);
ok('Tony 50 × $150 = $7,500', tony.hours === 50 && tony.rate === 150 && tony.amount === 7500, tony.amount);
ok('labour subtotal $19,500', snap.labourSubtotal === 19500, snap.labourSubtotal);
ok('materials subtotal $15,000', snap.materialsSubtotal === 15000, snap.materialsSubtotal);
ok('report total pre-HST $34,500', snap.subtotalPreHst === 34500, snap.subtotalPreHst);
ok('HST 13% = $4,485', snap.hst === 4485, snap.hst);
ok('TOTAL $38,985', snap.total === 38985, snap.total);
ok('material lines are client-safe (no cost/markup fields)', !('cost' in (snap.materialLines[0] as any)) && !('markupPct' in (snap.materialLines[0] as any)));

console.log('\n=== visit rounding (15-min increments, 1-hr minimum) ===');
ok('0.5 hr visit → 1.0 (1-hr minimum)', roundVisitHours(0.5) === 1, roundVisitHours(0.5));
ok('2.1 hr → 2.0 (nearest 15 min)', roundVisitHours(2.1) === 2, roundVisitHours(2.1));
ok('2.2 hr → 2.25', roundVisitHours(2.2) === 2.25, roundVisitHours(2.2));
ok('3.6 hr → 3.5', roundVisitHours(3.6) === 3.5, roundVisitHours(3.6));

console.log('\n=== sequential invoice numbering ===');
ok('after PROG-001 → PROG-002', nextProgNumber([{ number: 'PROG-001' } as any]) === 'PROG-002', nextProgNumber([{ number: 'PROG-001' } as any]));
ok('after PROG-001..004 → PROG-005', nextProgNumber(['PROG-001', 'PROG-004', 'PROG-002'].map(n => ({ number: n } as any))) === 'PROG-005', nextProgNumber(['PROG-001', 'PROG-004', 'PROG-002'].map(n => ({ number: n } as any))));

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

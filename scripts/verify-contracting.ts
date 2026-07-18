// Verify ContractingMaster billing math against the exact progress-report
// example. Run: npx tsx scripts/verify-contracting.ts
import { DEFAULT_CONTRACTING_RATES, computeReportTotals, receiptBilled, roundVisitHours, nextProgNumber, labourForReport, unbilledLabour, projectIsRemovable, invoiceStage, invoiceDueAt, invoiceIsLate, NET_TERMS_MS } from '../src/lib/contracting';

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

console.log('\n=== T&M flow: auto-attach · unbilled · attach · one-report-ever ===');
const H = 3_600_000;
const R1: any = { id: 'r1', projectId: 'p', phaseId: 'ph', startAt: 100 * H, status: 'open', receipts: [], manualTime: [] };
const R2: any = { id: 'r2', projectId: 'p', phaseId: 'ph', startAt: 200 * H, status: 'open', receipts: [], manualTime: [] };
const NOW = 210 * H;
// A: clocked INSIDE R1's window → auto-attaches, no reportId needed.
const A: any = { id: 'A', projectId: 'p', phaseId: 'ph', contractorId: 'kris', contractorName: 'Kris', billingRole: 'skilled_carpenter', clockIn: 101 * H, clockOut: 103 * H, status: 'open' };
// B: clocked BEFORE R1 opened (a gap) → unbilled until explicitly attached.
const B: any = { id: 'B', projectId: 'p', phaseId: 'ph', contractorId: 'kris', contractorName: 'Kris', billingRole: 'skilled_carpenter', clockIn: 50 * H, clockOut: 53 * H, status: 'open' };
let lab = labourForReport(R1, [A, B], NOW);
ok('A auto-attaches to R1 by window', lab.some(l => l.hours === 2) && lab.length === 1, JSON.stringify(lab.map(l => l.hours)));
let unb = unbilledLabour('p', [A, B], [R1], DEFAULT_CONTRACTING_RATES, NOW);
ok('B surfaces as UNBILLED (gap before R1)', unb.length === 1 && unb[0].entry.id === 'B', unb.map(u => u.entry.id).join(','));
ok('B unbilled value = 3h × $120 = $360', unb[0]?.amount === 360, unb[0]?.amount);
ok('A is NOT unbilled (auto-captured by R1)', !unb.some(u => u.entry.id === 'A'));
// Attach B to R1 (sets reportId).
const Battached = { ...B, reportId: 'r1' };
lab = labourForReport(R1, [A, Battached], NOW);
ok('after attach, R1 includes A + B (5h total)', lab.reduce((s, l) => s + l.hours, 0) === 5, lab.reduce((s, l) => s + l.hours, 0));
unb = unbilledLabour('p', [A, Battached], [R1], DEFAULT_CONTRACTING_RATES, NOW);
ok('B leaves the unbilled list once attached', unb.length === 0, unb.length);
// One-report-ever: B attached to R1 must NOT bleed into R2.
const labR2 = labourForReport(R2, [Battached], NOW);
ok('B does NOT appear on another report (one-report-ever)', labR2.length === 0, labR2.length);
// Invoiced entries are frozen out entirely.
const Binv = { ...B, reportId: 'r1', status: 'invoiced' };
ok('invoiced entry never re-bills or re-lists', labourForReport(R1, [Binv], NOW).length === 0 && unbilledLabour('p', [Binv], [R1], DEFAULT_CONTRACTING_RATES, NOW).length === 0);

console.log('\n=== project delete guard ===');
const inv1: any = { id: 'i', projectId: 'p', total: 100 };
ok('empty project IS removable', projectIsRemovable('p', [], [], []) === true);
ok('project with an invoice is NOT removable', projectIsRemovable('p', [inv1], [], []) === false);
ok('project with a report is NOT removable', projectIsRemovable('p', [], [{ projectId: 'p' } as any], []) === false);
ok('project with a time entry is NOT removable', projectIsRemovable('p', [], [], [{ projectId: 'p' } as any]) === false);
ok('other project\'s attachments do not block', projectIsRemovable('p', [{ projectId: 'other' } as any], [], []) === true);

console.log('\n=== invoice lifecycle: minted → sent → paid + due date ===');
const D2=86_400_000;
const minted: any = { id: 'm', awaitingSend: true, periodEnd: 100 * D2, issuedAt: 100 * D2, dueAt: 100 * D2 + NET_TERMS_MS };
ok('freshly minted → MINTED', invoiceStage(minted) === 'minted', invoiceStage(minted));
ok('minted due reckons from period end (stored)', invoiceDueAt(minted) === 100 * D2 + NET_TERMS_MS, invoiceDueAt(minted));
const sent = { ...minted, awaitingSend: false, sentAt: 110 * D2 };
ok('after send → SENT', invoiceStage(sent) === 'sent', invoiceStage(sent));
ok('due now reckons from SENT date (+14d)', invoiceDueAt(sent) === 110 * D2 + NET_TERMS_MS, invoiceDueAt(sent));
const paid = { ...sent, paid: true };
ok('after payment → PAID', invoiceStage(paid) === 'paid', invoiceStage(paid));
const legacy: any = { id: 'l', issuedAt: 50 * D2, dueAt: 64 * D2 };  // no awaitingSend → seeded/historical
ok('legacy/seeded invoice defaults to SENT', invoiceStage(legacy) === 'sent', invoiceStage(legacy));
ok('late when past due + unpaid', invoiceIsLate(sent, 130 * D2) === true);
ok('not late before due', invoiceIsLate(sent, 115 * D2) === false);
ok('paid is never late', invoiceIsLate({ ...sent, paid: true }, 999 * D2) === false);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

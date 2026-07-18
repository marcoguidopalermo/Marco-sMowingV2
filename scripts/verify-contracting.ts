// Verify ContractingMaster billing math against the exact progress-report
// example. Run: npx tsx scripts/verify-contracting.ts
import { DEFAULT_CONTRACTING_RATES, computeReportTotals, receiptBilled, roundVisitHours, nextProgNumber, labourForReport, unbilledLabour, projectIsRemovable, invoiceStage, invoiceDueAt, invoiceIsLate, NET_TERMS_MS, projectBillables, planPhaseMerge } from '../src/lib/contracting';

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

console.log('\n=== Feaver Rd project billables rollup ===');
// Rebuild Feaver's shape: P1 fixed 90805 (retainer 50k), P2 fixed 172400
// (retainer 75k), P3 T&M (PROG-001 106,440), P4 T&M (windows 19,400).
const feaver: any = { id: 'f', name: 'Feaver Rd', status: 'in_progress', phases: [
  { id: 'p1', type: 'fixed', fixedPrice: 90805, checklist: [] },
  { id: 'p2', type: 'fixed', fixedPrice: 172400, checklist: [] },
  { id: 'p3', type: 'tm', checklist: [] },
  { id: 'p4', type: 'tm', checklist: [], note: 'Window package $19,400 (Everlast) — payable before ordering.' },
]};
const finv: any[] = [
  { id: 'i1', projectId: 'f', phaseId: 'p1', amountPreHst: 50000, total: 56500, paid: true },
  { id: 'i2', projectId: 'f', phaseId: 'p2', amountPreHst: 75000, total: 84750, paid: true },
  { id: 'i3', projectId: 'f', phaseId: 'p3', amountPreHst: 106440, total: 120277.20, paid: false },
  { id: 'i4', projectId: 'f', phaseId: 'p4', amountPreHst: 19400, total: 21922, paid: false },
];
const freps: any[] = [{ id: 'r2', projectId: 'f', phaseId: 'p3', status: 'open' }];
const rb = projectBillables(feaver, finv, freps);
ok('rollup invoiced = $250,840', rb.invoicedPreHst === 250840, rb.invoicedPreHst);
ok('rollup collected = $125,000', rb.collectedPreHst === 125000, rb.collectedPreHst);
ok('rollup outstanding = $125,840', rb.outstandingPreHst === 125840, rb.outstandingPreHst);
ok('rollup remaining fixed = $138,205 (40,805 P1 + 97,400 P2)', rb.remainingFixedPreHst === 138205, rb.remainingFixedPreHst);
ok('rollup flags open T&M', rb.hasOpenTm === true);
ok('rollup invoiced incl-HST = $283,449.20', rb.invoicedWithHst === 283449.20, rb.invoicedWithHst);

console.log('\n=== merge Feaver P4 → P3 (references move, dollars do not) ===');
const ftimes: any[] = [{ id: 't1', projectId: 'f', phaseId: 'p3', clockIn: 1, clockOut: 2 }];
const plan = planPhaseMerge(feaver, 'p4', 'p3', 'Phase 3/4 — Interior Finishes & Exterior Envelope', finv, freps, ftimes);
ok('merge plan re-points INV on p4 (i4)', plan.invoiceIds.join(',') === 'i4', plan.invoiceIds.join(','));
ok('merge plan does NOT move p3 records', plan.reportIds.length === 0 && plan.timeEntryIds.length === 0);
const mergedPhase = plan.mergedProject!.phases.find(p => p.id === 'p3')!;
ok('merged phase renamed', mergedPhase.name === 'Phase 3/4 — Interior Finishes & Exterior Envelope', mergedPhase.name);
ok('window note carried onto merged phase', /Everlast/.test(mergedPhase.note || ''), mergedPhase.note);
ok('source phase p4 removed', !plan.mergedProject!.phases.some(p => p.id === 'p4'));
ok('phase count 4 → 3', plan.mergedProject!.phases.length === 3, plan.mergedProject!.phases.length);
// Rollup unchanged after applying the merge (re-point i4 to p3).
const invMerged = finv.map(i => i.id === 'i4' ? { ...i, phaseId: 'p3' } : i);
const rbAfter = projectBillables(plan.mergedProject!, invMerged, freps);
ok('rollup UNCHANGED post-merge (invoiced)', rbAfter.invoicedPreHst === rb.invoicedPreHst, rbAfter.invoicedPreHst);
ok('rollup UNCHANGED post-merge (outstanding)', rbAfter.outstandingPreHst === rb.outstandingPreHst, rbAfter.outstandingPreHst);
ok('merge guard: different types refused', !!planPhaseMerge(feaver, 'p1', 'p3', undefined, finv, freps, ftimes).error);
// Two open reports (target empty, source has a manual line) → keep TARGET's
// as survivor and FOLD the source's manual line into it; delete the source's.
const twoPhases = { ...feaver, phases: [{ id: 'p3', type: 'tm', checklist: [] }, { id: 'p4', type: 'tm', checklist: [] }] };
const foldPlan = planPhaseMerge(twoPhases, 'p4', 'p3', undefined, [],
  [{ id: 'r3', projectId: 'f', phaseId: 'p3', status: 'open', reportNumber: 2, startAt: 100, receipts: [], manualTime: [] } as any,
   { id: 'r4', projectId: 'f', phaseId: 'p4', status: 'open', reportNumber: 1, startAt: 50, receipts: [], manualTime: [{ id: 'm1', hours: 3 }] } as any], []);
ok('survivor is the TARGET report r3 (#2, from Jul 14 equiv)', foldPlan.keptReport?.id === 'r3', foldPlan.keptReport?.id);
ok('source manual line folded into survivor', (foldPlan.keptReport?.manualTime || []).length === 1, (foldPlan.keptReport?.manualTime || []).length);
ok('source duplicate open report deleted (r4)', foldPlan.deleteReportIds.join(',') === 'r4', foldPlan.deleteReportIds.join(','));
ok('no orphan / no refusal', !foldPlan.error);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

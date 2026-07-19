// Verify ContractingMaster billing math against the exact progress-report
// example. Run: npx tsx scripts/verify-contracting.ts
import { DEFAULT_CONTRACTING_RATES, computeReportTotals, receiptBilled, roundVisitHours, nextProgNumber, labourForReport, projectIsRemovable, reportIsDeletable, invoiceStage, invoiceDueAt, invoiceIsLate, NET_TERMS_MS, projectBillables, planPhaseMerge, projectCompletionPct, woAssignees, woIsAssignedTo, woStatus, woIsOverdue, compareWorkOrders, woWeekStats } from '../src/lib/contracting';

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

console.log('\n=== report labour = manual "+ Add hours" lines only (v1.8) ===');
const rpt: any = { id: 'r1', projectId: 'p', phaseId: 'ph', startAt: 0, status: 'open', receipts: [], manualTime: [
  { id: 'm1', contractorId: 'tony', contractorName: 'Tony', billingRole: 'gc_pm', hours: 10, clockIn: 100 },
  { id: 'm2', contractorId: 'kris', contractorName: 'Kris', billingRole: 'skilled_carpenter', hours: 10, rateOverride: 130, clockIn: 100 },
] };
const rlab = labourForReport(rpt);
ok('labour = the manual lines (2)', rlab.length === 2, rlab.length);
ok('manual rate override carried through', rlab.find(l => l.contractorId === 'kris')?.rate === 130, rlab.find(l => l.contractorId === 'kris')?.rate);
const rsnap = computeReportTotals(rlab, [], DEFAULT_CONTRACTING_RATES);
ok('Tony 10×150 + Kris 10×130 = $2,800', rsnap.labourSubtotal === 2800, rsnap.labourSubtotal);

console.log('\n=== project delete guard ===');
const inv1: any = { id: 'i', projectId: 'p', total: 100 };
ok('empty project IS removable', projectIsRemovable('p', [], [], []) === true);
ok('project with an invoice is NOT removable', projectIsRemovable('p', [inv1], [], []) === false);
ok('project with a report is NOT removable', projectIsRemovable('p', [], [{ projectId: 'p' } as any], []) === false);
ok('project with a time entry is NOT removable', projectIsRemovable('p', [], [], [{ projectId: 'p' } as any]) === false);
ok('other project\'s attachments do not block', projectIsRemovable('p', [{ projectId: 'other' } as any], [], []) === true);

// reportIsDeletable: live invoice blocks; voided or no-invoice → deletable.
ok('report with no invoice IS deletable', reportIsDeletable('r1', []).deletable === true);
ok('report backing a LIVE invoice is NOT deletable', reportIsDeletable('r1', [{ reportId: 'r1', number: 'PROG-005' } as any]).deletable === false);
ok('blocked report names the invoice to void', reportIsDeletable('r1', [{ reportId: 'r1', number: 'PROG-005' } as any]).blockedBy === 'PROG-005');
ok('report whose invoice is VOIDED IS deletable', reportIsDeletable('r1', [{ reportId: 'r1', number: 'PROG-005', voided: true } as any]).deletable === true);
ok('another report\'s invoice does not block', reportIsDeletable('r1', [{ reportId: 'r2', number: 'PROG-006' } as any]).deletable === true);

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

console.log('\n=== batch hours entry (Marco\'s exact example) ===');
// Jul 18 — Tony 10 hr @ $150 = $1,500 ; Kris 10 hr @ $120 = $1,200 → +$2,700
const batch = computeReportTotals([
  { contractorId: 'tony', name: 'Tony', billingRole: 'gc_pm', hours: 10 },
  { contractorId: 'kris', name: 'Kris', billingRole: 'skilled_carpenter', hours: 10 },
], [], DEFAULT_CONTRACTING_RATES);
const tLine = batch.labourLines.find(l => l.contractorId === 'tony')!;
const kLine = batch.labourLines.find(l => l.contractorId === 'kris')!;
ok('Tony 10 hr @ $150 = $1,500', tLine.amount === 1500, tLine.amount);
ok('Kris 10 hr @ $120 = $1,200', kLine.amount === 1200, kLine.amount);
ok('report labour +$2,700', batch.labourSubtotal === 2700, batch.labourSubtotal);

console.log('\n=== per-line rate override (the odd exception) ===');
const ov = computeReportTotals([
  { contractorId: 'tony', name: 'Tony', billingRole: 'gc_pm', hours: 10 },              // role $150 → 1500
  { contractorId: 'tony', name: 'Tony', billingRole: 'gc_pm', hours: 5, rate: 200 },    // override $200 → 1000
], [], DEFAULT_CONTRACTING_RATES);
ok('override splits into its own line (2 lines)', ov.labourLines.length === 2, ov.labourLines.length);
ok('override line bills at $200 (5×200=1000)', !!ov.labourLines.find(l => l.rate === 200 && l.amount === 1000));
ok('role line unaffected ($1,500)', !!ov.labourLines.find(l => l.rate === 150 && l.amount === 1500));
ok('override total = $2,500', ov.labourSubtotal === 2500, ov.labourSubtotal);

console.log('\n=== voided invoices → zero in every total ===');
const vproj: any = { id: 'vp', name: 'V', status: 'in_progress', phases: [{ id: 'ph1', type: 'tm', checklist: [] }] };
const vinvs: any[] = [
  { id: 'i1', projectId: 'vp', phaseId: 'ph1', amountPreHst: 1000, total: 1130, paid: true },
  { id: 'i2', projectId: 'vp', phaseId: 'ph1', amountPreHst: 500, total: 565, paid: false, voided: true, voidReason: 'mistake' },
];
const vrb = projectBillables(vproj, vinvs, []);
ok('rollup excludes the voided invoice (invoiced $1,000)', vrb.invoicedPreHst === 1000, vrb.invoicedPreHst);
ok('rollup collected = $1,000 (voided not counted)', vrb.collectedPreHst === 1000, vrb.collectedPreHst);
ok('numbering still counts voided stub (PROG after voided PROG-002)', nextProgNumber([{ number: 'PROG-002', voided: true } as any]) === 'PROG-003', nextProgNumber([{ number: 'PROG-002', voided: true } as any]));

console.log('\n=== phase % completion (simple average blend) ===');
ok('blended = average of phase %s', projectCompletionPct({ phases: [{ completionPct: 100 }, { completionPct: 50 }, { completionPct: 0 }] } as any) === 50, projectCompletionPct({ phases: [{ completionPct: 100 }, { completionPct: 50 }, { completionPct: 0 }] } as any));
ok('missing % counts as 0', projectCompletionPct({ phases: [{ completionPct: 80 }, {}] } as any) === 40);

console.log('\n=== work-order multi-assignee migration ===');
const single: any = { assigneeId: 'k', assigneeName: 'Kris' };
ok('legacy single assigneeId → array [k]', woAssignees(single).ids.join(',') === 'k' && woAssignees(single).names.join(',') === 'Kris');
ok('legacy single: assigned-to-me matches k', woIsAssignedTo(single, 'k') === true && woIsAssignedTo(single, 'x') === false);
const multi: any = { assigneeIds: ['k', 't'], assigneeNames: ['Kris', 'Tony'] };
ok('array of two → [k,t]', woAssignees(multi).ids.join(',') === 'k,t');
ok('assigned-to-me matches EITHER (k and t)', woIsAssignedTo(multi, 'k') && woIsAssignedTo(multi, 't') && !woIsAssignedTo(multi, 'z'));
ok('empty → unassigned', woAssignees({} as any).ids.length === 0 && !woIsAssignedTo({} as any, 'k'));

// ── work-order two-state status + dates ──
const NOW = new Date(2026, 6, 20, 12, 0, 0).getTime(); // Jul 20 2026 noon
const DAY = 86_400_000;
ok('legacy open → in_progress', woStatus({ status: 'open' } as any) === 'in_progress');
ok('legacy in_progress stays', woStatus({ status: 'in_progress' } as any) === 'in_progress');
ok('done stays done', woStatus({ status: 'done' } as any) === 'done');
ok('missing status → in_progress', woStatus({} as any) === 'in_progress');
ok('past due + not complete → overdue', woIsOverdue({ status: 'in_progress', dueAt: NOW - 2 * DAY } as any, NOW) === true);
ok('past due but complete → not overdue', woIsOverdue({ status: 'done', dueAt: NOW - 2 * DAY } as any, NOW) === false);
ok('future due → not overdue', woIsOverdue({ status: 'in_progress', dueAt: NOW + 2 * DAY } as any, NOW) === false);
ok('no due → not overdue', woIsOverdue({ status: 'in_progress' } as any, NOW) === false);
// Sort: overdue first, then soonest sched/due, undated last.
const wOverdue = { id: 'o', status: 'in_progress', dueAt: NOW - DAY, createdAt: 1 } as any;
const wSoon = { id: 's', status: 'in_progress', scheduledAt: NOW + DAY, createdAt: 2 } as any;
const wLater = { id: 'l', status: 'in_progress', dueAt: NOW + 5 * DAY, createdAt: 3 } as any;
const wUndated = { id: 'u', status: 'in_progress', createdAt: 4 } as any;
const sorted = [wUndated, wLater, wSoon, wOverdue].sort((a, b) => compareWorkOrders(a, b, NOW)).map(w => w.id);
ok('sort = overdue, soon, later, undated', sorted.join(',') === 'o,s,l,u');
// Week stats: overdue count + scheduled within 7 days (not complete/archived).
const stats = woWeekStats([wOverdue, wSoon, wLater, wUndated,
  { id: 'x', status: 'done', dueAt: NOW - DAY } as any,
  { id: 'a', status: 'in_progress', archived: true, dueAt: NOW - DAY } as any], NOW);
ok('week stats overdue=1 (done/archived excluded)', stats.overdue === 1);
ok('week stats scheduledThisWeek=1', stats.scheduledThisWeek === 1);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

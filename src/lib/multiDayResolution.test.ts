// Tests for month-end partial-job resolution helpers.
//   npm test -- multiDayResolution
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  scanBlockingPartialJobs, remainingBHOf, creditedBHOf, creditedPctOf,
  voidLedger, carryLedger, completeLedger, monthResolutionSummary, scanOpenPartials,
} from './multiDayResolution';

const log = (o: any) => ({ division: 'Lawn Division', crewNumber: 1, isAdHoc: false, jobs: [], employeeAH: {}, ...o } as any);

// A visit: total 35 BH, ~85% credited over prior days = 29.7, remaining 5.3.
const ledger = {
  jobberVisitId: 'v1', jobberJobId: 'j1', jobberJobNumber: 1, title: 'Peter Simpson', totalBH: 35,
  isLawnJob: false, manualOverride: false, status: 'in_progress',
  completionHistory: [
    { targetDate: '2026-07-10', percentComplete: 50, creditedBH: 17.5, crewId: 'cA', markedAt: 1, markedBy: 'x', markedByName: 'X', isRetroactive: false },
    { targetDate: '2026-07-14', percentComplete: 85, creditedBH: 12.2, crewId: 'cB', markedAt: 2, markedBy: 'x', markedByName: 'X', isRetroactive: false },
  ],
} as any;

console.log('multiDayResolution — BH math:');
test('credited / remaining / pct', () => {
  assert.equal(creditedBHOf(ledger), 29.7);
  assert.equal(remainingBHOf(ledger), 5.3);   // 35 − 29.7
  assert.equal(creditedPctOf(ledger), 85);
});
test('remaining never negative (over-credited ledger)', () => {
  assert.equal(remainingBHOf({ ...ledger, totalBH: 20 } as any), 0);
});

console.log('\nmultiDayResolution — blocking scan:');
const perf = {
  '2026-07-14': {
    cB: log({ crewNumber: 2, approvalStatus: 'pending', jobs: [
      { desc: 'Peter Simpson', jobberVisitId: 'v1', jobberJobId: 'j1', bh: 0, totalBH: 35, awaitingCompletionReview: true }, // blocks
    ] }),
    cC: log({ crewNumber: 3, approvalStatus: 'pending', jobs: [
      { desc: 'Other', jobberVisitId: 'v2', bh: 0, totalBH: 10, isIncompleteVisit: true, awaitingCompletionReview: true }, // opt-in continuation — does NOT block
    ] }),
    cD: log({ crewNumber: 4, approvalStatus: 'approved', jobs: [
      { desc: 'Approved', jobberVisitId: 'v3', bh: 5, totalBH: 5, awaitingCompletionReview: true }, // approved day — ignored
    ] }),
  },
  '2026-07-10': { cA: log({ jobs: [{ desc: 'Peter Simpson', jobberVisitId: 'v1', bh: 17.5, totalBH: 35 }] }) },
};
test('surfaces only the blocking awaiting-review visit; excludes continuation + approved', () => {
  const items = scanBlockingPartialJobs(perf, { v1: ledger }, '2026-07');
  assert.equal(items.length, 1);
  const it = items[0];
  assert.equal(it.jobberVisitId, 'v1');
  assert.equal(it.title, 'Peter Simpson');
  assert.equal(it.remainingBH, 5.3);
  assert.equal(it.creditedPct, 85);
  assert.equal(it.priorDate, '2026-07-14');
  assert.deepEqual(it.blockingDays.map(b => b.date), ['2026-07-14']);
  assert.equal(it.defaultTarget!.date, '2026-07-14'); // last day worked
});
test('already-resolved ledgers are not surfaced again', () => {
  const voided = voidLedger(ledger, 'job cancelled', { email: 'm', name: 'Marco' }, '2026-07', 100);
  assert.equal(scanBlockingPartialJobs(perf, { v1: voided }, '2026-07').length, 0);
});

console.log('\nmultiDayResolution — resolutions (credited BH never changes):');
test('VOID closes the remainder, keeps completionHistory + credited BH intact', () => {
  const v = voidLedger(ledger, 'scope changed', { email: 'm', name: 'Marco' }, '2026-07', 123);
  assert.equal(v.status, 'complete');
  assert.equal(v.resolvedKind, 'voided');
  assert.equal(v.resolvedBH, 5.3);
  assert.equal(v.voidedRemainder!.bh, 5.3);
  assert.equal(v.voidedRemainder!.reason, 'scope changed');
  assert.deepEqual(v.completionHistory, ledger.completionHistory); // untouched
  assert.equal(creditedBHOf(v), 29.7);                              // credited BH unchanged
});
test('CARRY marks carried, leaves ledger OPEN (not complete)', () => {
  const c = carryLedger(ledger, { email: 'm', name: 'Marco' }, '2026-07', 1);
  assert.equal(c.resolvedKind, 'carried');
  assert.equal(c.status, 'in_progress');   // stays live for a future day
  assert.equal(c.resolvedBH, 5.3);
});
test('COMPLETE marks 100% (BH credit is a separate history entry the caller appends)', () => {
  const done = completeLedger(ledger, 5.3, { email: 'm', name: 'Marco' }, '2026-07', 1);
  assert.equal(done.resolvedKind, 'completed');
  assert.equal(done.status, 'complete');
  assert.equal(done.resolvedBH, 5.3);
  assert.deepEqual(done.completionHistory, ledger.completionHistory); // helper doesn't touch history
});

console.log('\nmultiDayResolution — resolutions summary:');
test('summary counts N + BH per kind for the month', () => {
  const mdj = {
    a: voidLedger({ ...ledger, jobberVisitId: 'a', totalBH: 20, completionHistory: [{ creditedBH: 4.4 } as any] } as any, 'data error', { email: 'm', name: 'M' }, '2026-07', 1),
    b: voidLedger({ ...ledger, jobberVisitId: 'b', totalBH: 12, completionHistory: [] } as any, 'cancelled', { email: 'm', name: 'M' }, '2026-07', 1),
    c: carryLedger({ ...ledger, jobberVisitId: 'c' } as any, { email: 'm', name: 'M' }, '2026-07', 1),
    d: completeLedger({ ...ledger, jobberVisitId: 'd' } as any, 5.25, { email: 'm', name: 'M' }, '2026-08', 1), // different month
  };
  const s = monthResolutionSummary(mdj as any, '2026-07');
  assert.equal(s.voided.n, 2);
  assert.equal(s.voided.bh, 27.6);   // (20−4.4)=15.6 + (12−0)=12 = 27.6
  assert.equal(s.carried.n, 1);
  assert.equal(s.completed.n, 0);    // d is August
});

console.log('\nmultiDayResolution — EVERY open partial, not only blocking ones:');
// The Loretta case: a real partial whose crew-days are all settled. It blocks
// nothing, so scanBlockingPartialJobs never returned it and no UI could reach
// it — it just accumulated. Same pathology as the sync's doc-base gap.
const settledLedger = {
  jobberVisitId: 'vL', jobberJobId: 'jL', jobberJobNumber: 4601,
  title: 'Loretta Cutbush - Sod (Backyard)', totalBH: 20,
  isLawnJob: false, manualOverride: false, status: 'in_progress',
  completionHistory: [
    { targetDate: '2026-08-10', percentComplete: 45, creditedBH: 9, crewId: 'cS', markedAt: 1, markedBy: 'x', markedByName: 'Liam', isRetroactive: false },
  ],
} as any;
const settledPerf = {
  '2026-08-07': { cW: log({ division: 'Small Projects', approvalStatus: 'waived', jobs: [
    { desc: 'Loretta Cutbush', jobberVisitId: 'vL', bh: 0, totalBH: 20, awaitingCompletionReview: true },
  ] }) },
  '2026-08-10': { cS: log({ division: 'Small Projects', approvalStatus: 'approved', jobs: [
    { desc: 'Loretta Cutbush', jobberVisitId: 'vL', bh: 9, totalBH: 20 },
  ] }) },
};

test('THE GAP: a partial with no blocking rows is invisible to the blocking scan', () => {
  assert.equal(scanBlockingPartialJobs(settledPerf, { vL: settledLedger }, '2026-08').length, 0);
});
test('…but scanOpenPartials finds it, with the right remaining BH', () => {
  const open = scanOpenPartials(settledPerf, { vL: settledLedger });
  assert.equal(open.length, 1);
  assert.equal(open[0].jobberVisitId, 'vL');
  assert.equal(open[0].totalBH, 20);
  assert.equal(open[0].creditedBH, 9);
  assert.equal(open[0].remainingBH, 11);
  assert.equal(open[0].creditedPct, 45);
  assert.equal(open[0].priorDate, '2026-08-10');
  assert.equal(open[0].ym, '2026-08');
});
test('it is reported as NOT blocking — the distinction the UI keeps', () => {
  const open = scanOpenPartials(settledPerf, { vL: settledLedger });
  assert.equal(open[0].blocksMonth, false);
  assert.deepEqual(open[0].blockingDays, []);
});
test('a waived or approved day never counts as blocking', () => {
  // Aug 7 carries awaitingCompletionReview but is WAIVED; Aug 10 is APPROVED.
  const open = scanOpenPartials(settledPerf, { vL: settledLedger });
  assert.equal(open[0].blocksMonth, false);
});
test('defaultTarget is the last crew-day that worked it', () => {
  const open = scanOpenPartials(settledPerf, { vL: settledLedger });
  assert.equal(open[0].defaultTarget?.date, '2026-08-10');
  assert.equal(open[0].defaultTarget?.crewId, 'cS');
});
test('a blocking partial is ALSO returned, and flagged as blocking', () => {
  const open = scanOpenPartials(perf, { v1: ledger });
  assert.equal(open.length, 1);
  assert.equal(open[0].blocksMonth, true);
  assert.equal(open[0].blockingDays.length, 1);
  assert.equal(open[0].blockingDays[0].date, '2026-07-14');
});
test('blocking partials sort ahead of non-blocking ones', () => {
  const open = scanOpenPartials(
    { ...perf, ...settledPerf }, { vL: settledLedger, v1: ledger },
  );
  assert.deepEqual(open.map(o => o.blocksMonth), [true, false]);
});

console.log('\nWhat scanOpenPartials must NOT return:');
test('a COMPLETE ledger is not an open partial', () => {
  assert.deepEqual(scanOpenPartials(settledPerf, { vL: { ...settledLedger, status: 'complete' } }), []);
});
test('an already-resolved ledger is not offered again', () => {
  for (const patch of [
    { resolvedKind: 'carried' }, { resolvedKind: 'voided' }, { resolvedKind: 'completed' },
    { voidedRemainder: { bh: 11, reason: 'x', byEmail: 'a', byName: 'A', at: 1 } },
    { dismissedCarryForward: true },
  ]) {
    assert.deepEqual(
      scanOpenPartials(settledPerf, { vL: { ...settledLedger, ...patch } }), [],
      `${JSON.stringify(patch)} must be excluded`,
    );
  }
});
test('a ledger with nothing credited yet is not a PARTIAL', () => {
  // Nothing part-done means nothing to resolve — it is just untouched work.
  assert.deepEqual(
    scanOpenPartials(settledPerf, { vL: { ...settledLedger, completionHistory: [] } }), [],
  );
});
test('a fully-credited ledger still marked in_progress is not offered', () => {
  const full = { ...settledLedger, completionHistory: [
    { ...settledLedger.completionHistory[0], percentComplete: 100, creditedBH: 20 },
  ] };
  assert.deepEqual(scanOpenPartials(settledPerf, { vL: full }), []);
});
test('an over-credited ledger yields no remaining, so it is not offered', () => {
  assert.deepEqual(scanOpenPartials(settledPerf, { vL: { ...settledLedger, totalBH: 5 } }), []);
});
test('an empty ledger map is handled', () => {
  assert.deepEqual(scanOpenPartials(settledPerf, {}), []);
  assert.deepEqual(scanOpenPartials({}, undefined), []);
});
test('a partial with no performance rows at all still surfaces from its ledger', () => {
  // The rows may have gone to a pushed month sheet. The ledger is the source.
  const open = scanOpenPartials({}, { vL: settledLedger });
  assert.equal(open.length, 1);
  assert.equal(open[0].remainingBH, 11);
  assert.equal(open[0].blocksMonth, false);
  assert.equal(open[0].defaultTarget, null);
});

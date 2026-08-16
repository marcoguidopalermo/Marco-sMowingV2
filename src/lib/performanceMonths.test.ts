// Tests for the month-finalize reconciliation: content-less placeholder
// crew-days must NOT gate a month, but real unsettled work must.
//   npm test -- performanceMonths
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { monthSettlementStatus, logHasRealWork, logActualHours } from './performanceMonths';
import { scanOutstandingCrewDays } from './approvalOversight';

const log = (o: any) => ({ division: 'Lawn Division', crewNumber: 1, isAdHoc: false, jobs: [], employeeAH: {}, ...o } as any);

console.log('performanceMonths — finalize reconciliation:');

test('logHasRealWork: jobs OR positive AH OR timesheets = work; empty = none', () => {
  assert.equal(logHasRealWork(log({})), false);                                   // placeholder
  assert.equal(logHasRealWork(log({ jobs: [{}] })), true);
  assert.equal(logHasRealWork(log({ employeeAH: { e1: 6.1 } })), true);
  assert.equal(logHasRealWork(log({ employeeAH: { e1: 0 } })), false);
  assert.equal(logHasRealWork(log({ employeeTimesheets: { e1: {} } })), true);
  assert.equal(logActualHours(log({ employeeAH: { e1: 6.1, e2: 4 } })), 10.1);
});

test('empty placeholder pending days do NOT gate the month (settled=true)', () => {
  // The July scenario: only content-less scheduled crews left unsettled.
  const perf = {
    '2026-07-01': {
      c1: log({ division: 'Lawn Division', crewNumber: 1, jobs: [{}], employeeAH: { e: 6 }, approvalStatus: 'approved' }),
      c2: log({ division: 'Small Projects', crewNumber: 1, approvalStatus: 'pending' }), // empty placeholder
      c3: log({ division: 'Small Projects', crewNumber: 2, approvalStatus: 'pending' }), // empty placeholder
    },
    '2026-07-08': {
      c4: log({ division: 'Lawn Division', crewNumber: 3, approvalStatus: 'pending' }),   // empty placeholder
      c5: log({ division: 'Lawn Division', crewNumber: 4, jobs: [{}], approvalStatus: 'waived' }),
    },
  };
  const s = monthSettlementStatus(perf, '2026-07');
  assert.equal(s.settled, true, 'month with only empty placeholders must finalize');
  assert.equal(s.blocking.length, 0);
  assert.equal(s.emptyPending.length, 3);            // the 3 hidden days, now surfaced
  assert.deepEqual(s.emptyPending.map(e => e.crewLabel).sort(),
    ['Lawn Division #3', 'Small Projects #1', 'Small Projects #2']);
  assert.ok(s.emptyPending.every(e => !e.hasWork && e.status === 'pending'));
});

test('real unsettled work STILL gates the month', () => {
  const perf = {
    '2026-07-02': {
      c1: log({ jobs: [{}], employeeAH: { e: 6 }, approvalStatus: 'pending' }), // real work, unsettled
      c2: log({ approvalStatus: 'pending' }),                                    // empty placeholder
    },
  };
  const s = monthSettlementStatus(perf, '2026-07');
  assert.equal(s.settled, false);
  assert.equal(s.blocking.length, 1);
  assert.equal(s.blocking[0].hasWork, true);
  assert.equal(s.emptyPending.length, 1);
});

test('the finalize gate and the outstanding banner agree on which days matter', () => {
  const perf = {
    '2026-07-05': {
      c1: log({ jobs: [{}], approvalStatus: 'pending' }), // real, unsettled → both flag
      c2: log({ approvalStatus: 'pending' }),             // placeholder → neither gates/flags
    },
  };
  const gate = monthSettlementStatus(perf, '2026-07').blocking.map(b => b.crewId);
  const banner = scanOutstandingCrewDays(perf, '2026-08-01').map(o => o.crewId);
  assert.deepEqual(gate, ['c1']);
  assert.deepEqual(banner, ['c1']); // placeholder c2 hidden from BOTH — reconciled
});

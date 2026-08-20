// Tests for the month-finalize reconciliation: content-less placeholder
// crew-days must NOT gate a month, but real unsettled work must.
//   npm test -- performanceMonths
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { monthSettlementStatus, logHasRealWork, logActualHours, extractMonth } from './performanceMonths';
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

console.log('\nThe approval note survives the month push');
test('extractMonth carries the note, its author and its timestamp onto the sheet', () => {
  // The explanation must survive with the day it explains — a month sheet that
  // kept the odd number and dropped the reason for it would be worse than
  // useless to whoever reads it later.
  const perf = {
    '2026-08-14': {
      c1: {
        division: 'Lawn Division', crewNumber: 3, isAdHoc: false,
        jobs: [{ bh: 12 }], employeeAH: { e1: 16 }, deductions: {},
        approvalStatus: 'approved',
        approvalNote: 'Truck broke down, 2 hrs waiting on a tow.',
        approvalNoteBy: { email: 'jonah@x.test', name: 'Jonah Lahtinen' },
        approvalNoteAt: 1787000000000,
      },
    },
    '2026-09-02': { c2: { division: 'Lawn Division', crewNumber: 3, isAdHoc: false, jobs: [], employeeAH: {}, deductions: {} } },
  } as any;
  const sheet = extractMonth(perf, '2026-08');
  const carried = sheet['2026-08-14'].c1 as any;
  assert.equal(carried.approvalNote, 'Truck broke down, 2 hrs waiting on a tow.');
  assert.equal(carried.approvalNoteBy.name, 'Jonah Lahtinen');
  assert.equal(carried.approvalNoteAt, 1787000000000);
  assert.ok(!sheet['2026-09-02'], 'only the pushed month goes to the sheet');
});
test('a day with no note pushes cleanly rather than carrying empty keys', () => {
  const perf = {
    '2026-08-14': { c1: { division: 'L', crewNumber: 1, isAdHoc: false, jobs: [], employeeAH: {}, deductions: {} } },
  } as any;
  const carried = extractMonth(perf, '2026-08')['2026-08-14'].c1 as any;
  assert.equal('approvalNote' in carried, false);
});

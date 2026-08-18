// Tests for crew-day flag rules.
//   npm test -- crewDayFlags
//
// The two things that must never break: a flag moves approval STATE and no
// number, and it never converts a waived day into one that counts for pay.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  applyFlagToLog, applyResolutionToLog, canFlagCrewDay, canResolveFlag,
  crewDayFlaggable, datesWithOpenFlags, flagHistoryFor, noteIsUsable,
  openFlagFor, openFlagsByDivision,
} from './crewDayFlags';
import { CrewDayFlag, PerformanceLog } from '../types';

const flag = (o: Partial<CrewDayFlag> = {}): CrewDayFlag => ({
  id: 'flag-1', date: '2026-08-17', crewId: 'crew-1',
  crewLabel: 'Lawn Division #3', division: 'Lawn Division',
  reason: 'Kyle is on the timesheet but not on any crew.',
  raisedBy: { email: 'james@x.test', name: 'James' },
  raisedAt: 1, status: 'open', ...o,
});

const log = (o: Partial<PerformanceLog> = {}): PerformanceLog => ({
  division: 'Lawn Division', crewNumber: 3, isAdHoc: false,
  jobs: [{ bh: 12 } as any], employeeAH: { e1: 6, e2: 6 },
  deductions: { e1: 0.5 } as any, ...o,
});

console.log('\nWho may flag, who may resolve');
test('only an admin may raise a flag', () => {
  assert.equal(canFlagCrewDay('admin'), true);
  for (const r of ['manager', 'worker', 'mechanic', 'contractor', null, undefined] as any[]) {
    assert.equal(canFlagCrewDay(r), false, `${r} must not be able to flag`);
  }
});
test("a division manager may resolve their OWN division's flag, not another's", () => {
  assert.equal(canResolveFlag('manager', 'lawn', 'Lawn Division'), true);
  assert.equal(canResolveFlag('manager', 'lawn', 'Small Projects'), false);
  assert.equal(canResolveFlag('manager', 'small', 'Small Projects'), true);
});
test('an all-division manager and an admin may resolve anything', () => {
  assert.equal(canResolveFlag('manager', 'all', 'Large Projects'), true);
  assert.equal(canResolveFlag('admin', null, 'Large Projects'), true);
  assert.equal(canResolveFlag('admin', undefined, 'Anything At All'), true);
});
test('somebody with no managed division cannot resolve', () => {
  assert.equal(canResolveFlag('manager', null, 'Lawn Division'), false);
});
test('a WORKER carrying a managedDivision still cannot resolve', () => {
  // managedDivision is just a field. Coverage alone is not authority — the
  // role must be able to approve performance, because resolving re-approves.
  assert.equal(canResolveFlag('worker' as any, 'lawn', 'Lawn Division'), false);
  assert.equal(canResolveFlag('mechanic' as any, 'all', 'Lawn Division'), false);
});

console.log('\nWhich days can be flagged');
const elig = (o: Partial<Parameters<typeof crewDayFlaggable>[0]> = {}) => crewDayFlaggable({
  date: '2026-08-17', today: '2026-08-18',
  pushedMonths: [], archivedDays: {}, ...o,
});
test("yesterday, in the open month, is flaggable", () => {
  assert.equal(elig().allowed, true);
});
test('a day in a PUSHED month is not flaggable, and says why', () => {
  const e = elig({ pushedMonths: ['2026-08'] });
  assert.equal(e.allowed, false);
  assert.equal(e.reason, 'month-pushed');
  assert.match(e.message!, /read-only/);
  assert.ok(!/error|violation/i.test(e.message!), 'the language stays neutral');
});
test('a rolling-archived DAY is not flaggable even when the month is open', () => {
  const e = elig({ archivedDays: { '2026-08-17': true } });
  assert.equal(e.allowed, false);
  assert.equal(e.reason, 'day-archived');
});
test('a future date is not flaggable', () => {
  assert.equal(elig({ date: '2026-08-19' }).reason, 'future-date');
});
test('today itself is flaggable — the floor is future, not past', () => {
  assert.equal(elig({ date: '2026-08-18' }).allowed, true);
});

console.log('\nBoth notes are required');
test('a reason or resolution note must carry something', () => {
  for (const bad of ['', '   ', 'x', null, undefined, 42 as any]) {
    assert.equal(noteIsUsable(bad), false, `${JSON.stringify(bad)} must not pass`);
  }
  assert.equal(noteIsUsable('Kyle is not on a crew'), true);
  assert.equal(noteIsUsable('  fine '), true);
});

console.log('\nApproval state moves, numbers do not');
test('flagging unapproves and clears the approval stamp', () => {
  const before = log({
    approvalStatus: 'approved', approvedAt: '2026-08-17T20:00:00Z',
    approvedBy: 'mgr@x.test', approvedByName: 'Manager',
  });
  const after = applyFlagToLog(before);
  assert.equal(after.approvalStatus, 'pending');
  assert.equal(after.approvedAt, undefined);
  assert.equal(after.approvedBy, undefined);
  assert.equal(after.approvedByName, undefined);
});
test('THE INVARIANT: flagging touches no number on the crew-day', () => {
  const before = log({ approvalStatus: 'approved' });
  const after = applyFlagToLog(before);
  assert.deepEqual(after.jobs, before.jobs);
  assert.deepEqual(after.employeeAH, before.employeeAH);
  assert.deepEqual(after.deductions, before.deductions);
  assert.equal(after.division, before.division);
  assert.equal(after.crewNumber, before.crewNumber);
});
test('resolving re-approves and stamps the manager who signed off', () => {
  const after = applyResolutionToLog(
    log({ approvalStatus: 'pending' }),
    { previousApprovalStatus: 'approved' },
    { email: 'mgr@x.test', name: 'Manager' },
    '2026-08-18T14:00:00Z',
  );
  assert.equal(after.approvalStatus, 'approved');
  assert.equal(after.approvedBy, 'mgr@x.test');
  assert.equal(after.approvedByName, 'Manager');
  assert.equal(after.approvedAt, '2026-08-18T14:00:00Z');
});
test('THE PAY TRAP: a WAIVED day returns to waived, never to approved', () => {
  // Waived is excluded from bonus by construction. Promoting it to approved on
  // resolution would silently make the day count toward pay — a consequence a
  // flag must never have.
  const before = log({
    approvalStatus: 'pending',
    waivedReason: 'Shop day', waivedBy: 'mgr@x.test', waivedAt: '2026-08-17T20:00:00Z',
  });
  const after = applyResolutionToLog(
    before, { previousApprovalStatus: 'waived' },
    { email: 'mgr@x.test', name: 'Manager' }, '2026-08-18T14:00:00Z',
  );
  assert.equal(after.approvalStatus, 'waived');
  assert.equal(after.approvedBy, undefined, 'it never gains an approval stamp');
  assert.equal(after.waivedReason, 'Shop day', 'the waiver metadata is untouched');
});
test('a day that was PENDING when flagged becomes approved — the sign-off is the approval', () => {
  const after = applyResolutionToLog(
    log(), { previousApprovalStatus: 'pending' },
    { email: 'mgr@x.test', name: 'Manager' }, '2026-08-18T14:00:00Z',
  );
  assert.equal(after.approvalStatus, 'approved');
});
test('resolving touches no number either', () => {
  const before = log({ approvalStatus: 'pending' });
  const after = applyResolutionToLog(
    before, { previousApprovalStatus: 'approved' },
    { email: 'm@x.test', name: 'M' }, '2026-08-18T14:00:00Z',
  );
  assert.deepEqual(after.jobs, before.jobs);
  assert.deepEqual(after.employeeAH, before.employeeAH);
  assert.deepEqual(after.deductions, before.deductions);
});

console.log('\nLooking flags up');
const FLAGS = [
  flag({ id: 'f1', raisedAt: 100 }),
  flag({ id: 'f2', raisedAt: 200, status: 'resolved', resolutionNote: 'Kyle was lent from #2.' }),
  flag({ id: 'f3', date: '2026-08-16', crewId: 'crew-9', division: 'Small Projects' }),
];
test('the OPEN flag on a crew-day is found, resolved ones ignored', () => {
  assert.equal(openFlagFor(FLAGS, '2026-08-17', 'crew-1')?.id, 'f1');
  assert.equal(openFlagFor(FLAGS, '2026-08-17', 'crew-2'), undefined);
});
test('history keeps resolved flags — the record is permanent', () => {
  const h = flagHistoryFor(FLAGS, '2026-08-17', 'crew-1');
  assert.deepEqual(h.map(f => f.id), ['f2', 'f1'], 'newest first');
  assert.equal(h[0].resolutionNote, 'Kyle was lent from #2.');
});
test('dates with open flags drive the banner, resolved ones drop out', () => {
  assert.deepEqual([...datesWithOpenFlags(FLAGS)].sort(), ['2026-08-16', '2026-08-17']);
  assert.deepEqual([...datesWithOpenFlags([FLAGS[1]])], []);
});
test('open flags group by division for manager routing', () => {
  const g = openFlagsByDivision(FLAGS);
  assert.deepEqual(g.get('Lawn Division')?.map(f => f.id), ['f1']);
  assert.deepEqual(g.get('Small Projects')?.map(f => f.id), ['f3']);
});
test('a flag with no division groups under Unassigned rather than vanishing', () => {
  const g = openFlagsByDivision([flag({ id: 'fx', division: '' })]);
  assert.equal(g.get('Unassigned')?.length, 1);
});

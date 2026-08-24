// Tests for clocking somebody else in or out.
//   npm test -- clockOnBehalf
//
// This is one person creating pay data for another, so the tests are mostly
// about the things that must never happen quietly: an unattributed punch, a
// duplicate open clock, an orphan stop, or a manager reaching outside their
// own division.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  applyOnBehalfStop, buildOnBehalfStart, canClockFor, guardStart, guardStop,
  isRunningPunch, onBehalfLabel, onBehalfNote, reasonIsUsable, runningPunchFor,
} from './clockOnBehalf';
import type { Employee, TimeEntry } from '../types';

const emp = (o: Partial<Employee> & { id: string; name: string }): Employee => ({
  status: 'Active', hasLicense: false, hasClassA: false, hasHeavyMachinery: false,
  awayDates: [], ...o,
} as Employee);

const LAWN = emp({ id: 'e1', name: 'Tyberious', primaryCrew: 'Lawn', linkedUserEmail: 'ty@x.test' });
const SMALL = emp({ id: 'e2', name: 'Justin', primaryCrew: 'Small Project', linkedUserEmail: 'j@x.test' });
const NODIV = emp({ id: 'e3', name: 'Cody', linkedUserEmail: 'c@x.test' });

const punch = (o: Partial<TimeEntry> = {}): TimeEntry => ({
  id: 't1', userEmail: 'ty@x.test', userName: 'Tyberious',
  clockIn: '2026-08-24T13:00:00.000Z', notes: [], ...o,
} as TimeEntry);

console.log('\nWho may clock whom');
test('an admin may clock anybody', () => {
  for (const t of [LAWN, SMALL, NODIV]) {
    assert.equal(canClockFor({ role: 'admin' }, t).allowed, true, t.name);
  }
});
test('a manager may clock their OWN division', () => {
  assert.equal(canClockFor({ role: 'manager', managedDivision: 'lawn' }, LAWN).allowed, true);
});
test("a manager may NOT clock another division, and is told whose they are not", () => {
  const p = canClockFor({ role: 'manager', managedDivision: 'lawn' }, SMALL);
  assert.equal(p.allowed, false);
  assert.equal(p.reason, 'other-division');
  assert.match(p.message!, /Justin is not in your division/);
});
test('an all-division manager covers everyone, as "all" does elsewhere', () => {
  assert.equal(canClockFor({ role: 'manager', managedDivision: 'all' }, SMALL).allowed, true);
});
test('an employee with no division is outside every division manager’s reach', () => {
  const p = canClockFor({ role: 'manager', managedDivision: 'lawn' }, NODIV);
  assert.equal(p.allowed, false);
  assert.equal(p.reason, 'no-division');
});
test('a manager with no division set cannot clock anybody', () => {
  assert.equal(canClockFor({ role: 'manager', managedDivision: '' }, LAWN).allowed, false);
  assert.equal(canClockFor({ role: 'manager' }, LAWN).allowed, false);
});
test('workers, foremen and mechanics cannot clock others at all', () => {
  for (const r of ['worker', 'foreman', 'mechanic', 'contractor', null, undefined] as any[]) {
    assert.equal(canClockFor({ role: r, managedDivision: 'all' }, LAWN).allowed, false, String(r));
  }
});
test('a missing target is refused rather than throwing', () => {
  assert.equal(canClockFor({ role: 'admin' }, null).allowed, false);
});

console.log('\nWhat counts as a running clock');
test('a punch with no clock-out is running', () => {
  assert.equal(isRunningPunch(punch()), true);
});
test('a closed punch is not running', () => {
  assert.equal(isRunningPunch(punch({ clockOut: '2026-08-24T21:00:00.000Z' })), false);
});
test('an UNCLOSED punch is not a running clock — that is an edit, not a stop', () => {
  // isUnclosed marks a shift the system gave up on. Stopping it as though it
  // were live would stamp "now" onto a punch from days ago.
  assert.equal(isRunningPunch(punch({ isUnclosed: true })), false);
});
test('the running punch is found by email, case-insensitively', () => {
  const list = [punch({ id: 'a', clockOut: '2026-08-24T20:00:00.000Z' }), punch({ id: 'b' })];
  assert.equal(runningPunchFor(list, 'TY@X.TEST')?.id, 'b');
  assert.equal(runningPunchFor(list, 'other@x.test'), undefined);
  assert.equal(runningPunchFor(undefined, 'ty@x.test'), undefined);
});

console.log('\nGuards');
test('starting a second clock is refused, naming when the first began', () => {
  const g = guardStart([punch()], LAWN, 'ty@x.test');
  assert.equal(g.ok, false);
  assert.match(g.message!, /already clocked in/);
  assert.match(g.message!, /Stop that punch instead/);
});
test('starting is allowed when nothing is running', () => {
  assert.equal(guardStart([punch({ clockOut: '2026-08-24T20:00:00.000Z' })], LAWN, 'ty@x.test').ok, true);
  assert.equal(guardStart([], LAWN, 'ty@x.test').ok, true);
});
test('stopping with nothing running is refused rather than orphaning a punch', () => {
  const g = guardStop([], LAWN, 'ty@x.test');
  assert.equal(g.ok, false);
  assert.match(g.message!, /not clocked in right now/);
});
test('stopping is allowed when a clock is running', () => {
  assert.equal(guardStop([punch()], LAWN, 'ty@x.test').ok, true);
});
test('an unclosed punch does not make a start look like a duplicate', () => {
  assert.equal(guardStart([punch({ isUnclosed: true })], LAWN, 'ty@x.test').ok, true);
  assert.equal(guardStop([punch({ isUnclosed: true })], LAWN, 'ty@x.test').ok, false);
});

console.log('\nThe reason is required');
test('a blank or trivial reason does not pass', () => {
  for (const v of ['', '   ', 'x', null, undefined, 12 as any]) {
    assert.equal(reasonIsUsable(v), false, JSON.stringify(v));
  }
  assert.equal(reasonIsUsable('phone dead'), true);
});

console.log('\nThe punch carries who did it');
const ACTOR = { email: 'jonah@x.test', name: 'Jonah Lahtinen' };
test('a start is stamped with startedBy and carries the reason as a note', () => {
  const e = buildOnBehalfStart({
    target: LAWN, email: 'ty@x.test', actor: ACTOR, reason: 'phone dead',
    nowIso: '2026-08-24T13:00:00.000Z', id: 't-new',
  });
  assert.equal(e.startedBy?.name, 'Jonah Lahtinen');
  assert.equal(e.userName, 'Tyberious');
  assert.equal(e.clockIn, '2026-08-24T13:00:00.000Z');
  assert.equal(e.clockOut, undefined, 'it is running, not a closed span');
  assert.equal(e.notes[0].text, '[Clocked in by Jonah Lahtinen] phone dead');
  assert.equal(e.notes[0].authorName, 'Jonah Lahtinen');
});
test('it is NOT flagged as a manual entry — the time is real, only the tap was not', () => {
  const e = buildOnBehalfStart({
    target: LAWN, email: 'ty@x.test', actor: ACTOR, reason: 'phone dead',
    nowIso: '2026-08-24T13:00:00.000Z', id: 't-new',
  });
  assert.equal(e.manualEntry, undefined);
  assert.equal(e.manualHoursOnly, undefined);
});
test('a stop is stamped with stoppedBy and appends its own note', () => {
  const out = applyOnBehalfStop(
    punch({ notes: [{ author: 'a', authorName: 'A', timestamp: 'x', text: 'earlier' }] }),
    ACTOR, 'forgot to punch out', '2026-08-24T21:30:00.000Z',
  );
  assert.equal(out.clockOut, '2026-08-24T21:30:00.000Z');
  assert.equal(out.stoppedBy?.name, 'Jonah Lahtinen');
  assert.equal(out.notes.length, 2, 'the earlier note is kept');
  assert.equal(out.notes[1].text, '[Clocked out by Jonah Lahtinen] forgot to punch out');
});
test('stopping preserves the original clock-in — a stop never rewrites the start', () => {
  const before = punch();
  const after = applyOnBehalfStop(before, ACTOR, 'r', '2026-08-24T21:30:00.000Z');
  assert.equal(after.clockIn, before.clockIn);
  assert.equal(after.userEmail, before.userEmail);
});

console.log('\nThe visible marker');
test('a self-punch has no marker', () => {
  assert.equal(onBehalfLabel(punch()), null);
});
test('started, stopped, and both read correctly', () => {
  assert.equal(onBehalfLabel({ startedBy: ACTOR }), 'Started by Jonah Lahtinen');
  assert.equal(onBehalfLabel({ stoppedBy: ACTOR }), 'Stopped by Jonah Lahtinen');
  assert.equal(
    onBehalfLabel({ startedBy: ACTOR, stoppedBy: { email: 'l@x.test', name: 'Liam' } }),
    'Started by Jonah Lahtinen · Stopped by Liam',
  );
});
test('the note text names the direction and the person', () => {
  assert.equal(onBehalfNote('in', 'Jonah', ' phone dead '), '[Clocked in by Jonah] phone dead');
  assert.equal(onBehalfNote('out', 'Jonah', 'forgot'), '[Clocked out by Jonah] forgot');
});

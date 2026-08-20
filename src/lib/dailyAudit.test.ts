// Tests for the daily audit assembly.
//   npm test -- dailyAudit
//
// The point of the view is catching a worker who clocked hours but is on no
// crew — the error that becomes unverifiable a week later. That case gets the
// most attention here.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildAuditHistory, buildDailyAudit } from './dailyAudit';
import { CrewDayFlag, PerformanceLog } from '../types';

const DATE = '2026-08-17';

const emp = (id: string, name: string, o: Record<string, unknown> = {}) => ({
  id, name, status: 'Active', hasLicense: false, hasClassA: false,
  hasHeavyMachinery: false, awayDates: [], primaryCrew: 'Lawn', ...o,
}) as any;

const log = (o: Partial<PerformanceLog> = {}): PerformanceLog => ({
  division: 'Lawn Division', crewNumber: 3, isAdHoc: false,
  jobs: [{ bh: 8, title: 'Mow Elm St' }, { bh: 4, title: 'Trim Oak Ave' }] as any,
  employeeAH: { e1: 8, e2: 8 }, deductions: {}, approvalStatus: 'approved', ...o,
});

const punch = (email: string, inISO: string, outISO: string) => ({
  id: `t-${email}-${inISO}`, userEmail: email, userName: email,
  clockIn: inISO, clockOut: outISO, notes: [],
}) as any;

const base = (o: Record<string, unknown> = {}) => ({
  appData: {
    employees: [emp('e1', 'Ana'), emp('e2', 'Ben'), emp('e3', 'Cara')],
    schedules: { [DATE]: [{ id: 'crew-1', division: 'Lawn Division', crewNumber: 3, employees: ['e1', 'e2'], fleet: [], inventory: [], supplies: [], notes: '' }] },
    performance: { [DATE]: { 'crew-1': log() } },
    settings: {},
    timeEntries: [],
    ...(o.appData as object || {}),
  },
  date: DATE,
  flags: (o.flags as CrewDayFlag[]) || [],
  audits: (o.audits as any) || {},
}) as any;

console.log('\nThe crew-day rows');
test('a crew-day carries its people, jobs and the two hour figures', () => {
  const a = buildDailyAudit(base());
  assert.equal(a.crews.length, 1);
  const c = a.crews[0];
  assert.equal(c.crewLabel, 'Lawn Division #3');
  assert.deepEqual(c.people.map(p => p.name), ['Ana', 'Ben']);
  assert.equal(c.headcount, 2);
  assert.equal(c.jobCount, 2);
  assert.deepEqual(c.jobTitles, ['Mow Elm St', 'Trim Oak Ave']);
  assert.equal(c.cBH, 12);
  assert.equal(c.cAH, 16);
});
test('efficiency is cBH over cAH, and null when there are no hours', () => {
  assert.equal(buildDailyAudit(base()).crews[0].rawEfficiency, 75);
  const noAH = buildDailyAudit(base({
    appData: { performance: { [DATE]: { 'crew-1': log({ employeeAH: {} }) } } },
  }));
  assert.equal(noAH.crews[0].rawEfficiency, null);
  assert.equal(noAH.crews[0].adjustedEfficiency, null);
});
test('a drop-in with AH but no roster place is shown as a drop-in, not hidden', () => {
  const a = buildDailyAudit(base({
    appData: { performance: { [DATE]: { 'crew-1': log({ employeeAH: { e1: 8, e2: 8, e3: 4 } }) } } },
  }));
  const cara = a.crews[0].people.find(p => p.id === 'e3')!;
  assert.equal(cara.dropIn, true);
  assert.equal(cara.ah, 4);
  assert.equal(a.crews[0].people.find(p => p.id === 'e1')!.dropIn, false);
});
test('a removed worker is not counted on the crew', () => {
  const a = buildDailyAudit(base({
    appData: { performance: { [DATE]: { 'crew-1': log({ removedEmployees: ['e2'] }) } } },
  }));
  assert.deepEqual(a.crews[0].people.map(p => p.id), ['e1']);
  assert.equal(a.crews[0].headcount, 1);
});
test('a placeholder crew-day with no real work is left out entirely', () => {
  const a = buildDailyAudit(base({
    appData: { performance: { [DATE]: { 'crew-1': log({ jobs: [], employeeAH: {}, deductions: {} }) } } },
  }));
  assert.equal(a.crews.length, 0);
  assert.equal(a.totals.crewDays, 0);
});
test('a name resolves even for somebody outside the placeable roster', () => {
  // A working division manager on a crew rendered as "Unknown" when names were
  // resolved from the narrowed roster. Same trap as the availability view.
  const a = buildDailyAudit(base({
    appData: {
      employees: [emp('e1', 'Ana'), emp('e2', 'Ben'), emp('m1', 'Mo', { systemRole: 'manager', managedDivision: 'lawn' })],
      performance: { [DATE]: { 'crew-1': log({ employeeAH: { e1: 8, e2: 8, m1: 6 } }) } },
    },
  }));
  assert.equal(a.crews[0].people.find(p => p.id === 'm1')?.name, 'Mo');
});

console.log('\nTHE ERROR: worked, but on no crew');
test('somebody who clocked hours and is on no crew is surfaced first', () => {
  const a = buildDailyAudit(base({
    appData: {
      employees: [emp('e1', 'Ana'), emp('e2', 'Ben'), emp('e3', 'Cara', { linkedUserEmail: 'cara@x.test' })],
      timeEntries: [punch('cara@x.test', `${DATE}T13:00:00Z`, `${DATE}T21:00:00Z`)],
    },
  }));
  assert.equal(a.workedButUnassignedCount, 1);
  assert.equal(a.unassigned[0].name, 'Cara');
  assert.equal(a.unassigned[0].worked, true);
  assert.equal(a.unassigned[0].hoursWorked, 8);
});
test('somebody unassigned who did NOT work is listed but not counted as an error', () => {
  const a = buildDailyAudit(base());
  assert.equal(a.workedButUnassignedCount, 0);
  assert.deepEqual(a.unassigned.map(u => u.name), ['Cara']);
  assert.equal(a.unassigned[0].worked, false);
});
test('a drop-in credited with AH is NOT reported as unassigned', () => {
  const a = buildDailyAudit(base({
    appData: {
      employees: [emp('e1', 'Ana'), emp('e2', 'Ben'), emp('e3', 'Cara', { linkedUserEmail: 'cara@x.test' })],
      performance: { [DATE]: { 'crew-1': log({ employeeAH: { e1: 8, e2: 8, e3: 8 } }) } },
      timeEntries: [punch('cara@x.test', `${DATE}T13:00:00Z`, `${DATE}T21:00:00Z`)],
    },
  }));
  assert.equal(a.unassigned.length, 0, 'the crew-day already accounts for her');
});
test("punches on OTHER dates don't count toward this day", () => {
  const a = buildDailyAudit(base({
    appData: {
      employees: [emp('e1', 'Ana'), emp('e2', 'Ben'), emp('e3', 'Cara', { linkedUserEmail: 'cara@x.test' })],
      timeEntries: [punch('cara@x.test', '2026-08-16T13:00:00Z', '2026-08-16T21:00:00Z')],
    },
  }));
  assert.equal(a.workedButUnassignedCount, 0);
});
test('an OPEN punch contributes no hours — there is no closed span to count', () => {
  const open = { id: 't-open', userEmail: 'cara@x.test', userName: 'c', clockIn: `${DATE}T13:00:00Z`, notes: [] } as any;
  const a = buildDailyAudit(base({
    appData: {
      employees: [emp('e1', 'Ana'), emp('e2', 'Ben'), emp('e3', 'Cara', { linkedUserEmail: 'cara@x.test' })],
      timeEntries: [open],
    },
  }));
  assert.equal(a.unassigned[0].hoursWorked, 0);
});
test('admins and managers are not reported as unassigned — they are not crew', () => {
  const a = buildDailyAudit(base({
    appData: {
      employees: [emp('e1', 'Ana'), emp('e2', 'Ben'),
        emp('a1', 'Admin', { systemRole: 'admin' }),
        emp('m1', 'Mgr', { systemRole: 'manager', managedDivision: 'lawn' })],
    },
  }));
  assert.deepEqual(a.unassigned.map(u => u.name), []);
});

console.log('\nFlags and totals');
const openFlag: CrewDayFlag = {
  id: 'f1', date: DATE, crewId: 'crew-1', crewLabel: 'Lawn Division #3',
  division: 'Lawn Division', reason: 'Cara has hours but no crew.',
  raisedBy: { email: 'j@x.test', name: 'James' }, raisedAt: 1, status: 'open',
};
test('an open flag attaches to its crew-day and counts in the totals', () => {
  const a = buildDailyAudit(base({ flags: [openFlag] }));
  assert.equal(a.crews[0].openFlag?.id, 'f1');
  assert.equal(a.totals.flagged, 1);
  assert.equal(a.crews[0].flagCount, 1);
});
test('a RESOLVED flag leaves the day unflagged but stays in the record', () => {
  const a = buildDailyAudit(base({
    flags: [{ ...openFlag, status: 'resolved', resolutionNote: 'Lent from #2.' }],
  }));
  assert.equal(a.crews[0].openFlag, undefined);
  assert.equal(a.totals.flagged, 0);
  assert.equal(a.crews[0].flagCount, 1, 'history is permanent');
});
test('totals split approved from unapproved', () => {
  const a = buildDailyAudit(base({
    appData: {
      performance: { [DATE]: {
        'crew-1': log(),
        'crew-2': log({ crewNumber: 4, approvalStatus: 'pending' }),
        'crew-3': log({ crewNumber: 5, approvalStatus: 'waived' }),
      } },
    },
  }));
  assert.equal(a.totals.crewDays, 3);
  assert.equal(a.totals.approved, 1);
  assert.equal(a.totals.unapproved, 2);
  assert.equal(a.totals.cBH, 36);
});
test('the audited marker comes through when the date has been signed off', () => {
  const a = buildDailyAudit(base({
    audits: { [DATE]: { date: DATE, auditedBy: { email: 'j@x.test', name: 'James' }, auditedAt: 5, crewDayCount: 1, flaggedCount: 0 } },
  }));
  assert.equal(a.audited?.auditedBy.name, 'James');
});

console.log('\nThe audited/not-audited history');
const hist = (o: Record<string, unknown> = {}) => buildAuditHistory({
  performance: {}, audits: {}, today: '2026-08-18', days: 7, ...o,
} as any);
test('weekends are skipped — a Sunday with no audit is not a gap', () => {
  const days = hist().map(d => d.date);
  for (const d of days) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    assert.ok(dow !== 0 && dow !== 6, `${d} is a weekend and should be skipped`);
  }
});
test('a past weekday WITH work and no audit is reported as missed', () => {
  const h = hist({ performance: { '2026-08-17': { c1: log() } } });
  const d = h.find(x => x.date === '2026-08-17')!;
  assert.equal(d.missed, true);
  assert.equal(d.audited, false);
});
test('a day with NO work is not a gap, even unaudited', () => {
  const h = hist({ performance: { '2026-08-17': { c1: log({ jobs: [], employeeAH: {} }) } } });
  const d = h.find(x => x.date === '2026-08-17')!;
  assert.equal(d.noWork, true);
  assert.equal(d.missed, false);
});
test('an audited day carries who signed it off and what they saw', () => {
  const h = hist({
    performance: { '2026-08-17': { c1: log() } },
    audits: { '2026-08-17': { date: '2026-08-17', auditedBy: { email: 'j@x.test', name: 'James' }, auditedAt: 9, crewDayCount: 4, flaggedCount: 1 } },
  });
  const d = h.find(x => x.date === '2026-08-17')!;
  assert.equal(d.audited, true);
  assert.equal(d.auditedByName, 'James');
  assert.equal(d.crewDayCount, 4);
  assert.equal(d.flaggedCount, 1);
  assert.equal(d.missed, false);
});
test('today is never in the history — it is not yesterday yet', () => {
  assert.ok(!hist().some(d => d.date === '2026-08-18'));
});

console.log('\nApproval notes reach the auditor');
test('a crew-day with a note is surfaced with the numbers it explains', () => {
  const a = buildDailyAudit(base({
    appData: { performance: { [DATE]: { 'crew-1': log({
      approvalNote: 'Truck broke down, 2 hrs waiting on a tow.',
      approvalNoteBy: { email: 'jonah@x.test', name: 'Jonah Lahtinen' },
      approvalNoteAt: 1,
    }) } } },
  }));
  assert.equal(a.explained.length, 1);
  assert.equal(a.explained[0].approvalNote, 'Truck broke down, 2 hrs waiting on a tow.');
  assert.equal(a.explained[0].approvalNoteBy, 'Jonah Lahtinen');
  // The point is the note ARRIVES WITH the figures that prompted the question.
  assert.equal(a.explained[0].cBH, 12);
  assert.equal(a.explained[0].cAH, 16);
  assert.equal(a.explained[0].rawEfficiency, 75);
});
test('a day with no notes has an empty explained list, not a stray row', () => {
  assert.deepEqual(buildDailyAudit(base()).explained, []);
});
test('a blank or whitespace note does not count as an explanation', () => {
  for (const n of ['', '   ']) {
    const a = buildDailyAudit(base({
      appData: { performance: { [DATE]: { 'crew-1': log({ approvalNote: n }) } } },
    }));
    assert.deepEqual(a.explained, [], `note=${JSON.stringify(n)}`);
  }
});
test('the note falls back to the approver when no note author is stamped', () => {
  const a = buildDailyAudit(base({
    appData: { performance: { [DATE]: { 'crew-1': log({
      approvalNote: 'Trainee first week.', approvedByName: 'Liam Asselstine',
    }) } } },
  }));
  assert.equal(a.explained[0].approvalNoteBy, 'Liam Asselstine');
});

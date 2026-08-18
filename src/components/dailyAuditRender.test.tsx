// Renders the daily audit view and asserts what James actually reads.
//   npm test -- dailyAuditRender
//
// Beyond "it doesn't crash": the error this view exists to catch (somebody who
// clocked hours but is on no crew) has to be visible, the flag controls have to
// respect who is allowed to use them, and the language has to stay neutral —
// this is a question about a crew-day, not an accusation.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DailyAuditView from './DailyAuditView';
import type { AppData, CrewDayFlag, Employee } from '../types';

const TODAY = new Date().toISOString().slice(0, 10);
const yesterday = (() => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
})();

const emp = (o: Partial<Employee> & { id: string; name: string }): Employee => ({
  status: 'Active', hasLicense: false, hasClassA: false, hasHeavyMachinery: false,
  awayDates: [], primaryCrew: 'Lawn', ...o,
} as Employee);

const appData = (o: Partial<AppData> = {}): AppData => ({
  employees: [emp({ id: 'e1', name: 'Ana' }), emp({ id: 'e2', name: 'Ben' })],
  schedules: {
    [yesterday]: [{
      id: 'crew-1', division: 'Lawn Division', crewNumber: 3,
      employees: ['e1', 'e2'], fleet: [], inventory: [], supplies: [], notes: '',
    }],
  },
  performance: {
    [yesterday]: {
      'crew-1': {
        division: 'Lawn Division', crewNumber: 3, isAdHoc: false,
        jobs: [{ bh: 12, title: 'Mow Elm St' }],
        employeeAH: { e1: 8, e2: 8 }, deductions: {},
        approvalStatus: 'approved',
      },
    },
  },
  settings: {}, timeEntries: [], pushedMonths: [], archivedDays: {},
  ...o,
} as unknown as AppData);

const render = (o: {
  data?: AppData; flags?: CrewDayFlag[]; audits?: Record<string, any>;
  role?: any; managedDivision?: any;
} = {}) => renderToStaticMarkup(h(DailyAuditView, {
  appData: o.data || appData(),
  flags: o.flags || [],
  audits: o.audits || {},
  role: o.role ?? 'admin',
  managedDivision: o.managedDivision ?? null,
  onFlag: async () => true,
  onResolve: async () => true,
  onMarkAudited: async () => true,
} as any));

const openFlag: CrewDayFlag = {
  id: 'f1', date: yesterday, crewId: 'crew-1', crewLabel: 'Lawn Division #3',
  division: 'Lawn Division', reason: 'Cara has hours but is on no crew.',
  raisedBy: { email: 'james@x.test', name: 'James' }, raisedAt: Date.now(),
  status: 'open', previousApprovalStatus: 'approved',
};

console.log('\nThe crew-day is legible');
test('crew, people, jobs and all four numbers are on the page', () => {
  const html = render();
  assert.ok(html.includes('Lawn Division #3'));
  assert.ok(html.includes('Ana') && html.includes('Ben'));
  assert.ok(html.includes('Mow Elm St'));
  assert.ok(html.includes('>12<'), 'BH');
  assert.ok(html.includes('>16<'), 'AH');
  assert.ok(html.includes('75%'), 'efficiency');
});
test('the view opens on YESTERDAY, which is what the duty is about', () => {
  const html = render();
  const label = new Date(`${yesterday}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric',
  });
  assert.ok(html.includes(label), `expected the header to show ${label}`);
});

console.log('\nTHE ERROR: worked, but on no crew');
test('somebody who clocked hours off-crew is called out with their hours', () => {
  const html = render({
    data: appData({
      employees: [emp({ id: 'e1', name: 'Ana' }), emp({ id: 'e2', name: 'Ben' }),
        emp({ id: 'e3', name: 'Cara', linkedUserEmail: 'cara@x.test' })],
      timeEntries: [{
        id: 't1', userEmail: 'cara@x.test', userName: 'Cara', notes: [],
        clockIn: `${yesterday}T13:00:00Z`, clockOut: `${yesterday}T21:00:00Z`,
      }],
    } as any),
  });
  assert.ok(html.includes('1 worked but on no crew'));
  assert.ok(html.includes('Cara'));
  assert.ok(html.includes('8h'), 'their hours are shown, not just their name');
});
test('an unassigned person with NO hours is listed separately, not as an error', () => {
  const html = render({
    data: appData({
      employees: [emp({ id: 'e1', name: 'Ana' }), emp({ id: 'e2', name: 'Ben' }),
        emp({ id: 'e3', name: 'Cara' })],
    } as any),
  });
  assert.ok(!html.includes('worked but on no crew'));
  assert.ok(html.includes('Not on a crew, no hours recorded'));
  assert.ok(html.includes('Cara'));
});

console.log('\nFlagging respects who may do it');
test('an admin sees the flag control', () => {
  assert.ok(render({ role: 'admin' }).includes('Flag for review'));
});
test('a manager does NOT see the flag control — flagging is an admin act', () => {
  assert.ok(!render({ role: 'manager', managedDivision: 'lawn' }).includes('Flag for review'));
});
test('a flagged crew-day shows the question and who asked it', () => {
  const html = render({ flags: [openFlag] });
  assert.ok(html.includes('Flagged for review'));
  assert.ok(html.includes('Cara has hours but is on no crew.'));
  assert.ok(html.includes('James'));
});
test("the OWNING division's manager sees Sign off; another division's does not", () => {
  const mine = render({ flags: [openFlag], role: 'manager', managedDivision: 'lawn' });
  assert.ok(mine.includes('Sign off'));
  const theirs = render({ flags: [openFlag], role: 'manager', managedDivision: 'small' });
  assert.ok(!theirs.includes('Sign off'));
  assert.ok(theirs.includes('Lawn Division manager to sign off.'));
});

console.log('\nA pushed month says so instead of offering a flag');
test('the flag control is replaced by an explanation, not silently missing', () => {
  const html = render({
    data: appData({ pushedMonths: [yesterday.slice(0, 7)] } as any),
  });
  assert.ok(!html.includes('Flag for review'));
  assert.ok(html.includes('read-only'));
});

console.log('\nThe audited marker and the history');
test('an unaudited day offers to be marked audited', () => {
  assert.ok(render().includes('Mark audited'));
});
test('an audited day names who signed it off instead', () => {
  const html = render({
    audits: { [yesterday]: {
      date: yesterday, auditedBy: { email: 'j@x.test', name: 'James' },
      auditedAt: Date.now(), crewDayCount: 1, flaggedCount: 0,
    } },
  });
  assert.ok(!html.includes('Mark audited'));
  assert.ok(html.includes('Audited'));
  assert.ok(html.includes('James'));
});
test('the history legend explains what the colours mean', () => {
  const html = render();
  assert.ok(html.includes('Recent weekdays'));
  assert.ok(html.includes('Weekends excluded'));
});

console.log('\nLanguage stays neutral');
test('nothing on the page calls this an error or a violation', () => {
  const html = render({ flags: [openFlag] });
  for (const word of ['violation', 'offence', 'guilty', 'blame', 'fault']) {
    assert.ok(!new RegExp(word, 'i').test(html), `"${word}" must not appear`);
  }
  assert.ok(html.includes('Needs attention'));
});

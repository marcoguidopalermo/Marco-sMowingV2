// Renders the Daily Audit RECORD and asserts what a review conversation reads.
//   npm test -- dailyAuditRender
//
// This screen is a record, not a review surface: flagging happens on the daily
// entry board. So the tests check that the flag action is GONE from here, that
// open flags lead, that the per-manager rollup attributes correctly, and that
// the two things worth keeping — the audited weekday history and the
// clocked-but-unassigned list — are still present.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DailyAuditView from './DailyAuditView';
import type { AppData, CrewDayFlag, Employee } from '../types';

const TODAY = new Date().toISOString().slice(0, 10);
const shift = (n: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const yesterday = shift(-1);

const emp = (o: Partial<Employee> & { id: string; name: string }): Employee => ({
  status: 'Active', hasLicense: false, hasClassA: false, hasHeavyMachinery: false,
  awayDates: [], primaryCrew: 'Lawn', ...o,
} as Employee);

const appData = (o: Partial<AppData> = {}): AppData => ({
  employees: [
    emp({ id: 'e1', name: 'Ana' }), emp({ id: 'e2', name: 'Ben' }),
    emp({ id: 'm-lawn', name: 'Lena', managedDivision: 'lawn' }),
  ],
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
        employeeAH: { e1: 8, e2: 8 }, deductions: {}, approvalStatus: 'approved',
      },
    },
  },
  settings: {}, timeEntries: [], pushedMonths: [], archivedDays: {},
  ...o,
} as unknown as AppData);

const flag = (o: Partial<CrewDayFlag> = {}): CrewDayFlag => ({
  id: 'f1', date: yesterday, crewId: 'crew-1', crewLabel: 'Lawn Division #3',
  division: 'Lawn Division', reason: 'Cara has hours but is on no crew.',
  raisedBy: { email: 'james@x.test', name: 'James' }, raisedAt: Date.now(),
  status: 'open', previousApprovalStatus: 'approved', ...o,
});

const render = (o: {
  data?: AppData; flags?: CrewDayFlag[]; audits?: Record<string, any>; role?: any;
} = {}) => renderToStaticMarkup(h(DailyAuditView, {
  appData: o.data || appData(),
  flags: o.flags || [],
  audits: o.audits || {},
  role: o.role ?? 'admin',
  onMarkAudited: async () => true,
  onOpenCrewDay: () => {},
} as any));

console.log('\nThis is a record, not a review surface');
test('the flag action is GONE — flagging happens on the daily entry board', () => {
  const html = render({ flags: [flag()] });
  assert.ok(!html.includes('Flag for review'), 'no flag control here');
  assert.ok(!html.includes('Sign off'), 'no sign-off control here either');
});
test('crew-day detail is not duplicated — no job titles, no BH/AH columns', () => {
  const html = render({ flags: [flag()] });
  assert.ok(!html.includes('Mow Elm St'), 'the entry board shows the jobs');
  assert.ok(!html.includes('>Adj<'), 'no efficiency columns');
});

console.log('\nOpen flags lead');
test('an open flag appears with its reason and the cost of leaving it', () => {
  const html = render({ flags: [flag()] });
  assert.ok(html.includes('1 needs attention'));
  assert.ok(html.includes('Cara has hours but is on no crew.'));
  assert.ok(html.includes('Not counting toward efficiency or bonus until signed off.'));
});
test('with nothing open, it says so rather than showing an empty box', () => {
  const html = render();
  assert.ok(html.includes('Nothing needs attention'));
  assert.ok(html.includes('No crew-day has been flagged yet.'));
});
test('a resolved flag shows the answer, not just the question', () => {
  const html = render({
    flags: [flag({
      status: 'resolved', resolvedBy: { email: 'l@x.test', name: 'Lena' },
      resolvedAt: Date.now(), resolutionNote: 'Cara was lent to #2 — hours are correct.',
    })],
  });
  assert.ok(html.includes('Signed off'));
  assert.ok(html.includes('Lena'));
  assert.ok(html.includes('Cara was lent to #2 — hours are correct.'));
  assert.ok(html.includes('Nothing needs attention'), 'and it is not in the open list');
});

console.log('\nThe per-manager rollup');
test('flags are attributed to the accountable manager, with open vs resolved', () => {
  const thisMonth = TODAY.slice(0, 7);
  const html = render({
    flags: [
      flag({ id: 'a', date: `${thisMonth}-02`, status: 'open' }),
      flag({ id: 'b', date: `${thisMonth}-03`, status: 'resolved', resolvedAt: Date.now(), resolutionNote: 'ok' }),
    ],
  });
  assert.ok(html.includes('By manager'));
  assert.ok(html.includes('Lena'));
  assert.ok(html.includes('2 total'));
  assert.ok(html.includes('1 open'));
  assert.ok(html.includes('1 resolved'));
});
test('a division with no manager is shown as unattributed, not hidden', () => {
  const thisMonth = TODAY.slice(0, 7);
  const html = render({
    data: appData({ employees: [emp({ id: 'e1', name: 'Ana' })] } as any),
    flags: [flag({ date: `${thisMonth}-02`, division: 'Large Projects' })],
  });
  assert.ok(html.includes('No manager assigned'));
});
test('an empty month says so rather than rendering a blank table', () => {
  assert.ok(render().includes('No flags on crew-days in this month.'));
});

console.log('\nFilters are offered from real values');
test('the division and manager dropdowns list only what is in the record', () => {
  const html = render({ flags: [flag({ division: 'Small Projects' })] });
  assert.ok(html.includes('Any status'));
  assert.ok(html.includes('Any division'));
  assert.ok(html.includes('Any manager'));
  assert.ok(html.includes('Small Projects'));
  assert.ok(!html.includes('>Large Projects<'), 'a division with no flags is not offered');
});

console.log('\nWhat was kept from the old view');
test('the audited weekday history is still here, with its legend', () => {
  const html = render();
  assert.ok(html.includes('Weekdays audited'));
  assert.ok(html.includes('Weekends excluded'));
});
test('the clocked-but-unassigned list is still here — the unverifiable error', () => {
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
  assert.ok(html.includes('8h'));
});
test('marking a date audited is still available to an admin', () => {
  assert.ok(render().includes('Mark audited'));
  assert.ok(!render({ role: 'manager' }).includes('Mark audited'));
});
test('an audited date names who signed it off', () => {
  const html = render({
    audits: { [yesterday]: {
      date: yesterday, auditedBy: { email: 'j@x.test', name: 'James' },
      auditedAt: Date.now(), crewDayCount: 1, flaggedCount: 0,
    } },
  });
  assert.ok(!html.includes('Mark audited'));
  assert.ok(html.includes('Audited'));
});

console.log('\nLanguage stays neutral');
test('nothing calls this an error or a violation', () => {
  const html = render({ flags: [flag()] });
  for (const word of ['violation', 'offence', 'guilty', 'blame', 'fault']) {
    assert.ok(!new RegExp(word, 'i').test(html), `"${word}" must not appear`);
  }
  assert.ok(html.includes('Needs attention'));
});

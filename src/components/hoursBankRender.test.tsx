// Hours bank — RENDER smoke test.
//   npx tsx src/components/hoursBankRender.test.tsx
//
// The arithmetic has its own tests (lib/hoursBank.test.ts). This asserts the
// things only a render can tell you: that the components mount at all, and —
// the part that matters — that the read-only surfaces contain no write path.
// A ledger of money owed should not depend on someone remembering which prop
// hides the buttons, so the absence of those buttons is a test.
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import type { Employee, HoursBankEntry } from '../types';
import { HoursBankAdmin, HoursBankLedger, MyHoursBank } from './HoursBank';
import { DEFAULT_PAY_PERIOD } from '../lib/payPeriods';

let pass = 0, fail = 0;
const test = (n: string, fn: () => void) => {
  try { fn(); pass++; console.log(`  ✓ ${n}`); }
  catch (e) { fail++; console.error(`  ✗ ${n}\n      ${(e as Error).message}`); }
};

const REC = { email: 'marco@x.com', name: 'Marco' };
const AUG = (d: number) => Date.parse(`2026-08-${String(d).padStart(2, '0')}T12:00:00Z`);
const entry = (o: Partial<HoursBankEntry>): HoursBankEntry => ({
  id: 'x', employeeId: 'e1', employeeName: 'Pat Lindgren', type: 'banked',
  hours: 8, recordedAt: AUG(12), recordedBy: REC, ...o,
});
const LEDGER: HoursBankEntry[] = [
  entry({ id: 'a', hours: 8, periodStart: '2026-08-04', periodEnd: '2026-08-17' }),
  entry({ id: 'b', type: 'paid_out', hours: -3, paidOn: '2026-08-20', recordedAt: AUG(20) }),
];
const ALL: Record<string, HoursBankEntry> = {
  a: LEDGER[0], b: LEDGER[1],
  c: entry({ id: 'c', employeeId: 'e2', employeeName: 'Sam Okafor', hours: 12 }),
};
const EMPLOYEES = [
  { id: 'e1', name: 'Pat Lindgren', status: 'Active', primaryCrew: 'Lawn' },
  { id: 'e2', name: 'Sam Okafor', status: 'Active', primaryCrew: 'Small Project' },
] as unknown as Employee[];

console.log('\nThe ledger renders');
test('balance, both entry types and the running balance are all on the page', () => {
  const html = renderToStaticMarkup(h(HoursBankLedger, { entries: LEDGER }));
  assert.match(html, /5\.0 hrs/);            // the balance: 8 − 3
  assert.match(html, /Banked/);
  assert.match(html, /Paid out/);
  assert.match(html, /bal 8\.0 hrs/);        // running balance at the first entry
  assert.match(html, /bal 5\.0 hrs/);        // and after the payout
});
test('every entry carries its audit line — who recorded it and when', () => {
  const html = renderToStaticMarkup(h(HoursBankLedger, { entries: LEDGER }));
  assert.match(html, /recorded Aug 12, 2026 by Marco/);
  assert.match(html, /recorded Aug 20, 2026 by Marco/);
});
test('a reversal shows its reason, and the entry it reversed is struck through', () => {
  const reversed = [...LEDGER, entry({
    id: 'r', type: 'reversal', hours: -8, reversesId: 'a',
    reversalReason: 'banked to the wrong week', recordedAt: AUG(13),
  })];
  const html = renderToStaticMarkup(h(HoursBankLedger, { entries: reversed }));
  assert.match(html, /banked to the wrong week/);
  assert.match(html, /line-through/);
  assert.match(html, /reversed/);
});
test('an empty ledger says so rather than rendering an empty box', () => {
  assert.match(renderToStaticMarkup(h(HoursBankLedger, { entries: [] })), /No banked hours yet/);
});

console.log('\nRead-only means no write path in the markup');
test('the employee self view offers nothing to click but the history', () => {
  const html = renderToStaticMarkup(h(MyHoursBank, { entries: LEDGER, collapsible: true }));
  assert.match(html, /view only/);
  assert.doesNotMatch(html, /Reverse/);
  assert.doesNotMatch(html, /Add banked/);
  assert.doesNotMatch(html, /Record payout/);
});
test('an employee with no ledger gets no card at all', () => {
  assert.equal(renderToStaticMarkup(h(MyHoursBank, { entries: [] })), '');
});
test('a MANAGER sees the balances and the total, and no way to write', () => {
  const html = renderToStaticMarkup(h(HoursBankAdmin, {
    all: ALL, employees: EMPLOYEES, canManage: false, onAddEntry: () => {},
    payPeriodCfg: DEFAULT_PAY_PERIOD,
  }));
  assert.match(html, /Pat Lindgren/);
  assert.match(html, /Company total/);
  assert.match(html, /View only/);
  assert.doesNotMatch(html, /Add banked hours/);
  assert.doesNotMatch(html, /Record payout/);
});
test('an ADMIN gets both write actions', () => {
  const html = renderToStaticMarkup(h(HoursBankAdmin, {
    all: ALL, employees: EMPLOYEES, canManage: true, onAddEntry: () => {},
    payPeriodCfg: DEFAULT_PAY_PERIOD,
  }));
  assert.match(html, /Add banked hours/);
  assert.match(html, /Record payout/);
});

console.log('\nScope');
test('the company total is every outstanding balance, biggest first', () => {
  const html = renderToStaticMarkup(h(HoursBankAdmin, {
    all: ALL, employees: EMPLOYEES, canManage: true, onAddEntry: () => {},
    payPeriodCfg: DEFAULT_PAY_PERIOD,
  }));
  // Sam 12 + Pat 5 = 17, and Sam leads the list.
  assert.match(html, /17\.0 hrs/);
  assert.ok(html.indexOf('Sam Okafor') < html.indexOf('Pat Lindgren'));
});
test('a division-scoped manager sees only their own division’s ledgers', () => {
  const html = renderToStaticMarkup(h(HoursBankAdmin, {
    all: ALL, employees: EMPLOYEES, canManage: false, onAddEntry: () => {},
    restrictToIds: new Set(['e1']), restrictionNote: 'Showing the lawn division.',
    payPeriodCfg: DEFAULT_PAY_PERIOD,
  }));
  assert.match(html, /Pat Lindgren/);
  assert.doesNotMatch(html, /Sam Okafor/);
  assert.match(html, /5\.0 hrs/);            // the total is the scoped total
  assert.doesNotMatch(html, /17\.0 hrs/);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

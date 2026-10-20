// OfficeMaster page.
//   npm test -- officeRender
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import OfficeMaster, { type OfficeARDoc } from './OfficeMaster';
import type { FleetItem } from '../types';
import type { OfficeDeadline } from '../lib/office/deadlines';
import { SEED_DEADLINES } from '../lib/office/deadlines';
import { DEFAULT_PAY_PERIOD } from '../lib/payPeriods';
import { formatTodayInToronto, addDaysToronto } from '../lib/dateUtils';

const T = formatTodayInToronto();
const fleet = [
  { id: 'f-t4', name: '2013 F-250', unitNumber: 4, type: 'truck', status: 'Active', weightClass: '', repairTags: [], regExpiry: addDaysToronto(T, 12) },
  { id: 'f-t9', name: '2022 F-250', unitNumber: 9, type: 'truck', status: 'Active', weightClass: '', repairTags: [] },
  { id: 'f-old', name: 'Old truck', unitNumber: 2, type: 'truck', status: 'Active', weightClass: '', repairTags: [], disposal: { kind: 'sold', date: '2026-01-01' } },
] as unknown as FleetItem[];
const seeds: OfficeDeadline[] = SEED_DEADLINES.map((s, i) => ({ id: `s${i}`, kind: 'deadline', status: 'open', dueDate: null, ...s }));
const overdue: OfficeDeadline = { id: 'n1', kind: 'notice', title: 'MTO letter', category: 'government', dueDate: addDaysToronto(T, -2), status: 'open' };
const AR: OfficeARDoc = {
  status: 'ok', lastSuccessAt: Date.now() - 5 * 60000, lastAttemptAt: Date.now() - 5 * 60000, paidCheck: 'full',
  data: {
    owed: 1575.5, invoiceCount: 2,
    aging: { notDue: { count: 1, amount: 500 }, d1_30: { count: 0, amount: 0 }, d31_60: { count: 0, amount: 0 }, d61_90: { count: 0, amount: 0 }, d90plus: { count: 1, amount: 1075.5 } },
    chase: [{ invoiceId: 'i4', invoiceNumber: '1234', client: 'Example Client', balance: 1075.5, total: 1200, dueDate: '2026-07-01', daysOverdue: 111, lastPayment: { date: '2026-08-01', amount: 124.5 }, url: 'https://secure.getjobber.com/invoices/1' }],
    mismatches: [{ kind: 'paid_with_balance', invoiceNumber: '999', client: 'Odd Client', status: 'paid', balance: 12.34, url: '' }],
    noInvoiceClients: [{ client: 'No Invoice Co', clientId: 'c7', balance: 640, url: '' }],
    credits: { clients: 1, amount: -40 }, badDebt: { count: 0, amount: 0 },
    reconciliation: { openInvoices: 1575.5, owedWithoutInvoice: 640, clientBalancesOwed: 2215.5, difference: 0, clientsWithOpenInvoices: 2, clientsNotMatching: 0 },
    duplicatesRemoved: 3,
  },
};
const page = (ar: OfficeARDoc | null | undefined, extra: object = {}) => renderToStaticMarkup(h(OfficeMaster, {
  fleet, deadlines: [...seeds, overdue], ar, payPeriod: DEFAULT_PAY_PERIOD, today: T, currentUser: { email: 'office@x', name: 'Dave' },
  onSaveDeadlines: async () => true, onRefreshAR: async () => ({ status: 'ok' }), onOpenFleetUnit: () => {}, ...extra,
}));

test('all sections render with live data', () => {
  const html = page(AR);
  for (const s of ['Company deadlines &amp; notices', 'Fleet compliance', 'Payroll', 'Accounts receivable', 'Tasks']) assert.match(html, new RegExp(s));
  assert.match(html, /\$1,575\.50/);
  assert.match(html, /Example Client/);
  assert.match(html, /111d/);
  assert.match(html, /last paid Aug 1, 2026/);
  assert.match(html, /marked paid but still has a balance/);
  assert.match(html, /owing without an invoice \$640\.00/);
  assert.match(html, /client balances \$2,215\.50 ✓/);
  assert.match(html, /Payroll due (today|in \d+ days?)/);
});
test('fleet: dated units listed, missing dates visible, sold units excluded', () => {
  const html = page(AR);
  assert.match(html, /#4 2013 F-250/);
  assert.match(html, /expires in 12 days/);
  assert.match(html, /Not entered \(1\)/);
  assert.match(html, /#9 2022 F-250 · Registration/);
  assert.doesNotMatch(html, /Old truck/);
});
test('deadlines: overdue notice red; the four seeds wait for a date', () => {
  const html = page(AR);
  assert.match(html, /MTO letter/);
  assert.match(html, /2 days overdue/);
  assert.match(html, /Needs a date \(4\)/);
  for (const s of SEED_DEADLINES) assert.match(html, new RegExp(s.title));
  assert.match(html, /1 deadline overdue/);
});
test('A/R never shows a confident 0: no pull yet, failed pull, listen error', () => {
  assert.match(page(null), /Data unavailable — no successful pull yet/);
  assert.match(page(null), /A\/R: data unavailable/);
  const failed = page({ ...AR, status: 'error', lastError: 'Jobber GraphQL: hidden due to permissions', lastAttemptAt: Date.now() });
  assert.match(failed, /Data unavailable/);
  assert.match(failed, /hidden due to permissions/);
  assert.match(failed, /figures below are from the last successful pull/);
  assert.match(page(undefined, { arListenError: 'Missing or insufficient permissions.' }), /Data unavailable<\/b> — Missing or insufficient permissions/);
});

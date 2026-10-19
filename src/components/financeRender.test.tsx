// FinanceMaster page and fleet badge.
//   npm test -- financeRender
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import FinanceMaster, { FinanceBadge } from './FinanceMaster';
import type { FinanceAgreement } from '../lib/finance/types';
import type { FleetItem } from '../types';
import { financeByUnit } from '../lib/finance/portfolio';
import { financeAuditEntry, prepareForSave } from '../lib/finance/edit';

const TODAY = '2026-10-19';
const unit = (id: string, n: number): FleetItem => ({ id, name: 'Tractor', type: 'tractor', status: 'Active', weightClass: '', repairTags: [], unitNumber: n } as unknown as FleetItem);
const FLEET = [unit('f-l1', 1), unit('f-l2', 2), { ...unit('f-old', 9), disposal: { kind: 'sold', date: '2026-09-01' } } as FleetItem];
const TRACTORS: FinanceAgreement = {
  id: 'tractors', status: 'active', lender: 'Example Credit', agreementNumber: 'EX-1', type: 'lease_residual', aprPct: 3,
  startDate: '2026-08-01', maturityDate: '2030-08-01', termMonths: 48, acquisitionCost: 16_000_000, financedAmount: 16_000_000,
  plan: { frequency: 'monthly', amount: 750_000, firstPaymentDate: '2026-09-01', paymentCount: 48 },
  tax: { mode: 'added', ratePct: 13 }, residual: 6_000_000, residualTaxable: true, endOfTermPlan: 'undecided',
  assets: [
    { fleetUnitId: 'f-l1', labelSnapshot: '#1 Tractor', allocatedValue: 8_000_000, residualShare: 3_000_000 },
    { fleetUnitId: 'f-l2', labelSnapshot: '#2 Tractor', allocatedValue: 8_000_000, residualShare: 3_000_000 },
  ],
  assetIds: ['f-l1', 'f-l2'],
};
const PROPOSAL: FinanceAgreement = { ...TRACTORS, id: 'p', status: 'proposed', lender: 'Other Bank', maturityDate: '2029-08-01' };
const page = (agreements: FinanceAgreement[]) => renderToStaticMarkup(h(FinanceMaster, {
  agreements, fleet: FLEET, today: TODAY, currentUser: { email: 'm', name: 'M' }, onSave: async () => true,
}));

test('the list shows the agreement, its units and maturity; the private notice is shown', () => {
  const html = page([TRACTORS]);
  assert.match(html, /Only you can see this/);
  assert.match(html, /Example Credit/);
  assert.match(html, /#1 Tractor, #2 Tractor/);
  assert.match(html, /Aug 2030/);
  assert.match(html, /\$7,500\/mo/);
  assert.match(html, /46 pmts/);
});
test('proposed agreements are not in the Active list or the active totals', () => {
  const html = page([TRACTORS, PROPOSAL]);
  assert.doesNotMatch(html, /Other Bank/);
  assert.match(html, />1<\/div><div class="text-\[11px\] text-slate-500">\$7,500\/mo if signed/);
});
test('soft-deleted agreements disappear', () => {
  assert.match(page([{ ...TRACTORS, deletedAt: 1 }]), /No agreements yet/);
});
test('empty state', () => {
  assert.match(page([]), /No agreements yet/);
});
test('the fleet badge: financed + maturity, residual share in the tooltip', () => {
  const idx = financeByUnit([TRACTORS], TODAY).current;
  const html = renderToStaticMarkup(h(FinanceBadge, { items: idx.get('f-l1') }));
  assert.match(html, /Financed · Aug 2030/);
  assert.match(html, /Residual \$30,000 allocated to this unit/);
  assert.equal(renderToStaticMarkup(h(FinanceBadge, { items: idx.get('nope') })), '');
});
test('audit: lists what moved; nothing when nothing did; asset ids kept in step', () => {
  const after = { ...TRACTORS, plan: { ...TRACTORS.plan, amount: 700_000 } };
  assert.deepEqual(financeAuditEntry(TRACTORS, after, 1, 'Marco')!.changes, ['Payment: $7,500.00 → $7,000.00']);
  assert.equal(financeAuditEntry(TRACTORS, { ...TRACTORS }, 1, 'Marco'), null);
  assert.deepEqual(financeAuditEntry(undefined, TRACTORS, 1, 'Marco')!.changes, ['Created']);
  assert.deepEqual(prepareForSave({ ...TRACTORS, assetIds: [], assets: [...TRACTORS.assets, { fleetUnitId: null, labelSnapshot: 'blower', allocatedValue: 0 }] }).assetIds, ['f-l1', 'f-l2']);
});

import { ContractsView, WhatsLeftBarView, FinanceUnitPanel } from './FinanceMaster';
import { agreementFigures, whatsLeft } from '../lib/finance/calc';
import { MOWER_LOAN } from '../lib/finance/mowerLoan.fixture';

test('the bar: segments with amounts and "17 of 36 payments made"', () => {
  const bar = whatsLeft(MOWER_LOAN, agreementFigures(MOWER_LOAN, TODAY), TODAY);
  const html = renderToStaticMarkup(h(WhatsLeftBarView, { bar }));
  assert.match(html, /Down \/ trade-in <b[^>]*>\$24,000<\/b>/);
  assert.match(html, /Paid <b[^>]*>\$40,222<\/b>/);
  assert.match(html, /Still owing <b[^>]*>\$44,954<\/b>/);
  assert.match(html, /Not in the schedule <b[^>]*>\$26\.01<\/b>/);
  assert.doesNotMatch(html, /Residual due/);
  assert.match(html, /17 of 36 payments made/);
});
test('the unit panel shows that unit\'s slice of the bar', () => {
  const idx = financeByUnit([MOWER_LOAN], TODAY).current;
  const html = renderToStaticMarkup(h(FinanceUnitPanel, { unitId: 'f-stand-48a', items: idx.get('f-stand-48a'), today: TODAY }));
  assert.match(html, /only you see this/);
  assert.match(html, /\$2,366\/mo group · 0%/);
  assert.match(html, /17 of 36 payments made/);
});
test('Contracts: lists every document with its agreement; missing-contract list shows gaps', () => {
  const doc = (name: string, docType: any, at: number) => ({ url: 'https://x/' + name, path: 'financing/x/' + name, name, size: 1, contentType: 'application/pdf', uploadedAt: at, uploadedBy: { email: '', name: '' }, kind: 'pdf' as const, docType });
  const withQuote = { ...MOWER_LOAN, documents: [doc('quote-1234.pdf', 'quote', Date.UTC(2026, 9, 19))] };
  const withContract = { ...TRACTORS, documents: [doc('tractor-lease.pdf', 'lease_contract', Date.UTC(2026, 7, 1))] };
  const fleetById = new Map(FLEET.map(u => [u.id, u]));
  const html = renderToStaticMarkup(h(ContractsView, { agreements: [withQuote, withContract], fleetById, currentUser: { email: '', name: '' }, onSave: async () => true }));
  assert.match(html, /quote-1234\.pdf/);
  assert.match(html, /tractor-lease\.pdf/);
  assert.match(html, /Lease contract/);
  assert.match(html, /Missing contract \(1\)/);           // the mower loan has only a quote
  assert.match(html, /Example Credit \(via Example Dealer\)/);
  assert.ok(html.indexOf('quote-1234') < html.indexOf('tractor-lease')); // newest first
});

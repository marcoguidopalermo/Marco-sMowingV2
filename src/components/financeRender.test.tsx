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
const unit = (id: string, n: number): FleetItem => ({ id, name: 'Kubota L6070', type: 'tractor', status: 'Active', weightClass: '', repairTags: [], unitNumber: n } as unknown as FleetItem);
const FLEET = [unit('f-l1', 1), unit('f-l2', 2), { ...unit('f-old', 9), disposal: { kind: 'sold', date: '2026-09-01' } } as FleetItem];
const L6070: FinanceAgreement = {
  id: 'kubota', status: 'active', lender: 'Kubota Credit', agreementNumber: 'KC-1', type: 'lease_residual', aprPct: 2.49,
  startDate: '2026-08-01', maturityDate: '2030-08-01', termMonths: 48, acquisitionCost: 17_413_000, financedAmount: 17_413_000,
  plan: { frequency: 'monthly', amount: 820_000, firstPaymentDate: '2026-09-01', paymentCount: 48 },
  tax: { mode: 'added', ratePct: 13 }, residual: 7_248_800, residualTaxable: true, endOfTermPlan: 'undecided',
  assets: [
    { fleetUnitId: 'f-l1', labelSnapshot: '#1 Kubota L6070', allocatedValue: 8_706_500, residualShare: 3_624_400 },
    { fleetUnitId: 'f-l2', labelSnapshot: '#2 Kubota L6070', allocatedValue: 8_706_500, residualShare: 3_624_400 },
  ],
  assetIds: ['f-l1', 'f-l2'],
};
const PROPOSAL: FinanceAgreement = { ...L6070, id: 'p', status: 'proposed', lender: 'RBC', maturityDate: '2029-08-01' };
const page = (agreements: FinanceAgreement[]) => renderToStaticMarkup(h(FinanceMaster, {
  agreements, fleet: FLEET, today: TODAY, currentUser: { email: 'm', name: 'M' }, onSave: async () => true,
}));

test('the list shows the agreement, its units and maturity; the private notice is shown', () => {
  const html = page([L6070]);
  assert.match(html, /Only you can see this/);
  assert.match(html, /Kubota Credit/);
  assert.match(html, /#1 Kubota L6070, #2 Kubota L6070/);
  assert.match(html, /Aug 2030/);
  assert.match(html, /\$8,200\/mo/);
  assert.match(html, /46 pmts/);
});
test('proposed agreements are not in the Active list or the active totals', () => {
  const html = page([L6070, PROPOSAL]);
  assert.doesNotMatch(html, /RBC/);
  assert.match(html, />1<\/div><div class="text-\[11px\] text-slate-500">\$8,200\/mo if signed/);
});
test('soft-deleted agreements disappear', () => {
  assert.match(page([{ ...L6070, deletedAt: 1 }]), /No agreements yet/);
});
test('empty state', () => {
  assert.match(page([]), /No agreements yet/);
});
test('the fleet badge: financed + maturity, residual share in the tooltip', () => {
  const idx = financeByUnit([L6070], TODAY).current;
  const html = renderToStaticMarkup(h(FinanceBadge, { items: idx.get('f-l1') }));
  assert.match(html, /Financed · Aug 2030/);
  assert.match(html, /Residual \$36,244 allocated to this unit/);
  assert.equal(renderToStaticMarkup(h(FinanceBadge, { items: idx.get('nope') })), '');
});
test('audit: lists what moved; nothing when nothing did; asset ids kept in step', () => {
  const after = { ...L6070, plan: { ...L6070.plan, amount: 700_000 } };
  assert.deepEqual(financeAuditEntry(L6070, after, 1, 'Marco')!.changes, ['Payment: $8,200.00 → $7,000.00']);
  assert.equal(financeAuditEntry(L6070, { ...L6070 }, 1, 'Marco'), null);
  assert.deepEqual(financeAuditEntry(undefined, L6070, 1, 'Marco')!.changes, ['Created']);
  assert.deepEqual(prepareForSave({ ...L6070, assetIds: [], assets: [...L6070.assets, { fleetUnitId: null, labelSnapshot: 'blower', allocatedValue: 0 }] }).assetIds, ['f-l1', 'f-l2']);
});

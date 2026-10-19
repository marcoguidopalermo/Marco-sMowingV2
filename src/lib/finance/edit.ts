// Editing helpers for agreements: a blank agreement, the audit diff, and
// the derived fields kept in step on every save. Pure — tested.
import type { FinanceAgreement, AuditEntry } from './types';
import { AGREEMENT_TYPE_LABEL, FREQUENCY_LABEL, END_PLAN_LABEL } from './types';
import { addMonths } from './schedule';
import { fmtMoney } from './money';

export function newAgreementId(now = Date.now()): string {
  return `fin-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function blankAgreement(today: string, now = Date.now()): FinanceAgreement {
  return {
    id: newAgreementId(now),
    status: 'active',
    lender: '',
    type: 'lease_residual',
    startDate: today,
    maturityDate: addMonths(today, 48),
    termMonths: 48,
    acquisitionCost: 0,
    financedAmount: 0,
    aprPct: null,
    plan: { frequency: 'monthly', amount: 0, firstPaymentDate: addMonths(today, 1), paymentCount: 48 },
    tax: { mode: 'added', ratePct: 13 },
    endOfTermPlan: 'undecided',
    assets: [],
    assetIds: [],
    extraPayments: [],
    paymentChanges: [],
    documents: [],
  };
}

/** Keep the query index and snapshots in step before a save. */
export function prepareForSave(a: FinanceAgreement): FinanceAgreement {
  const assetIds = [...new Set((a.assets || []).map(x => x.fleetUnitId).filter((x): x is string => !!x))];
  return { ...a, assetIds, lender: (a.lender || '').trim() };
}

const money = (n: unknown) => (typeof n === 'number' ? fmtMoney(n, { cents: true }) : '—');
const pct = (n: unknown) => (typeof n === 'number' ? `${n}%` : '—');
const plain = (n: unknown) => (n == null || n === '' ? '—' : String(n));

type Getter = [label: string, get: (a: FinanceAgreement) => string];
const FIELDS: Getter[] = [
  ['Status', a => plain(a.status)],
  ['Ended', a => plain(a.endedAt)],
  ['End reason', a => plain(a.endReason)],
  ['Lender', a => plain(a.lender)],
  ['Agreement #', a => plain(a.agreementNumber)],
  ['Borrower', a => plain(a.borrower)],
  ['Type', a => AGREEMENT_TYPE_LABEL[a.type] || a.type],
  ['Start', a => plain(a.startDate)],
  ['Maturity', a => plain(a.maturityDate)],
  ['Term (months)', a => plain(a.termMonths)],
  ['Acquisition cost', a => money(a.acquisitionCost)],
  ['Down payment', a => money(a.downPayment)],
  ['Trade-in credit', a => money(a.tradeInCredit)],
  ['Trade-ins', a => (a.tradeIns || []).map(t => `${t.description}${t.serial ? ` S/N ${t.serial}` : ''} ${money(t.value)}`).join('; ') || '—'],
  ['HST financed', a => money(a.taxFinanced)],
  ['Financed amount', a => money(a.financedAmount)],
  ['APR', a => pct(a.aprPct)],
  ['Frequency', a => FREQUENCY_LABEL[a.plan.frequency] || a.plan.frequency],
  ['Payment', a => money(a.plan.amount)],
  ['First payment', a => plain(a.plan.firstPaymentDate)],
  ['Number of payments', a => plain(a.plan.paymentCount)],
  ['Skipped months', a => (a.plan.skipMonths || []).join(', ') || '—'],
  ['Tax', a => `${a.tax.mode} ${a.tax.ratePct}%`],
  ['Residual', a => money(a.residual)],
  ['Residual taxable', a => (a.residualTaxable ? 'yes' : 'no')],
  ['Lender balance', a => (a.balanceOverride ? `${money(a.balanceOverride.amount)} as of ${a.balanceOverride.asOf}` : '—')],
  ['End-of-term plan', a => END_PLAN_LABEL[a.endOfTermPlan] || a.endOfTermPlan],
  ['One-off payments', a => (a.extraPayments || []).map(x => `${x.date} ${x.kind} ${money(x.amount)}`).join('; ') || '—'],
  ['Payment changes', a => (a.paymentChanges || []).map(x => `from ${x.from} ${money(x.amount)}`).join('; ') || '—'],
  ['Equipment', a => (a.assets || []).map(x => `${x.labelSnapshot || x.description || '?'}${x.purchasePrice != null ? ` price ${money(x.purchasePrice)}` : ''} alloc ${money(x.allocatedValue)}${x.disposal ? ` (${x.disposal.kind} ${x.disposal.date || 'date unknown'})` : ''}${x.removedAt ? ` (removed ${x.removedAt})` : ''}`).join('; ') || '—'],
  ['Documents', a => (a.documents || []).map(d => d.name).join('; ') || '—'],
  ['Notes', a => plain(a.notes)],
  ['To confirm', a => (a.flags || []).join('; ') || '—'],
  ['Deleted', a => (a.deletedAt ? 'yes' : 'no')],
];

/** One audit entry listing what moved ("Payment: $8,200.00 → $7,000.00"), or null if nothing did. */
export function financeAuditEntry(before: FinanceAgreement | undefined, after: FinanceAgreement, at: number, by: string): AuditEntry | null {
  if (!before) return { at, by, changes: ['Created'] };
  const changes: string[] = [];
  for (const [label, get] of FIELDS) {
    const x = get(before), y = get(after);
    if (x !== y) changes.push(`${label}: ${x} → ${y}`);
  }
  return changes.length ? { at, by, changes } : null;
}

// FinanceMaster calculation core.
//   npx vitest run src/lib/finance
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { FinanceAgreement } from './types';
import { buildSchedule, addMonths } from './schedule';
import { agreementFigures, validateAgreement, paymentsPerYear, assetShare } from './calc';
import { portfolio, cashFlowByMonth, byYear, residualBuckets, financeByUnit, splitEvenly, spikeMonths } from './portfolio';
import { dollars } from './money';

const $ = dollars;

function agreement(p: Partial<FinanceAgreement> & { id: string }): FinanceAgreement {
  return {
    status: 'active', lender: 'Example Credit', type: 'loan', startDate: '2026-01-01', maturityDate: '2026-12-01', termMonths: 12,
    acquisitionCost: $(0), financedAmount: $(0), aprPct: null,
    plan: { frequency: 'monthly', amount: $(1000), firstPaymentDate: '2026-01-01', paymentCount: 12 },
    tax: { mode: 'none', ratePct: 0 }, endOfTermPlan: 'undecided', assets: [], assetIds: [],
    ...p,
  };
}

// Made-up figures (real terms don't live in the repo), shaped like the case
// FinanceMaster exists for: a group of 7 tractors on a 48-month lease with a
// residual, $80,000 each, 3%, Aug 2026 – Aug 2030, $7,500/month for the
// group, buyout $210,000 ($30,000 a tractor).
const TRACTOR_IDS = ['f-l1', 'f-l2', 'f-l3', 'f-l4', 'f-l5', 'f-l6', 'f-l7'];
const RESIDUAL_SHARES = splitEvenly($(210_000), 7);
const TRACTORS = agreement({
  id: 'tractors-7', type: 'lease_residual', aprPct: 3,
  startDate: '2026-08-01', maturityDate: '2030-08-01', termMonths: 48,
  acquisitionCost: $(80_000 * 7), financedAmount: $(80_000 * 7),
  plan: { frequency: 'monthly', amount: $(7_500), firstPaymentDate: '2026-09-01', paymentCount: 48 },
  tax: { mode: 'added', ratePct: 13 }, residual: $(210_000), residualTaxable: true,
  assets: TRACTOR_IDS.map((id, i) => ({ fleetUnitId: id, labelSnapshot: `Tractor #${i + 1}`, allocatedValue: $(80_000), residualShare: RESIDUAL_SHARES[i] })),
  assetIds: TRACTOR_IDS,
});
// Four tractors already maturing in 2029 (residual $240,000), and a truck
// with a $35,000 residual in 2028.
const FOUR = agreement({
  id: 'tractors-4', type: 'lease_residual', startDate: '2025-06-01', maturityDate: '2029-06-01', termMonths: 48,
  acquisitionCost: $(360_000), financedAmount: $(360_000),
  plan: { frequency: 'monthly', amount: $(4_100), firstPaymentDate: '2025-07-01', paymentCount: 48 },
  residual: $(240_000),
  assets: ['f-a', 'f-b', 'f-c', 'f-d'].map(id => ({ fleetUnitId: id, labelSnapshot: id, allocatedValue: $(90_000) })),
  assetIds: ['f-a', 'f-b', 'f-c', 'f-d'],
});
const TRUCK = agreement({
  id: 'truck-10', type: 'lease_residual', startDate: '2024-04-01', maturityDate: '2028-04-01', termMonths: 48,
  acquisitionCost: $(120_000), financedAmount: $(120_000),
  plan: { frequency: 'monthly', amount: $(1_900), firstPaymentDate: '2024-05-01', paymentCount: 48 },
  residual: $(35_000),
  assets: [{ fleetUnitId: 'f-t10', labelSnapshot: '#10 2024 F-550', allocatedValue: $(120_000) }], assetIds: ['f-t10'],
});
const FLEET = [...TRACTOR_IDS, 'f-a', 'f-b', 'f-c', 'f-d'].map(id => ({ id, type: 'tractor' })).concat([{ id: 'f-t10', type: 'truck' }]);
const TODAY = '2026-10-19';

console.log('\nThe 7-tractor lease');
test('48 monthly payments Sep 2026 – Aug 2030, then the buyout at maturity', () => {
  const s = buildSchedule(TRACTORS);
  const reg = s.filter(p => p.kind === 'regular');
  assert.equal(reg.length, 48);
  assert.equal(reg[0].date, '2026-09-01');
  assert.equal(reg[47].date, '2030-08-01');
  const res = s.filter(p => p.kind === 'residual');
  assert.equal(res.length, 1);
  assert.equal(res[0].date, '2030-08-01');
  assert.equal(res[0].preTax, $(210_000));
  assert.equal(res[0].total, $(237_300)); // HST on the buyout
  assert.equal(reg[0].total, $(8_475)); // $7,500 + 13%
});
test('on Oct 19, 2026: 2 paid, 46 to go, $7,500 a month, residual ahead', () => {
  const f = agreementFigures(TRACTORS, TODAY);
  assert.equal(f.displayStatus, 'financed');
  assert.equal(f.paymentsMade, 2);
  assert.equal(f.paymentsRemaining, 46);
  assert.equal(f.monthlyEquivalent, $(7_500));
  assert.equal(f.residualRemaining, $(210_000));
  assert.equal(f.remainingPreTax, $(7_500 * 46 + 210_000));
  assert.equal(f.balanceSource, 'remaining_payments'); // a lease: obligation, not a balance
  assert.equal(f.nextPayment?.date, '2026-11-01');
  assert.equal(f.daysToMaturity, 1382);
  // Lender receives 48 × 7,500 + 210,000 = 570,000 on 560,000 financed.
  assert.equal(f.totalPayments, $(570_000));
  assert.equal(f.costOfBorrowing, $(10_000));
});
test('each tractor carries $30,000 of the residual; shares add up exactly', () => {
  assert.equal(assetShare(TRACTORS, TRACTORS.assets[0]).residual, $(30_000));
  assert.equal(RESIDUAL_SHARES.reduce((s, x) => s + x, 0), $(210_000));
  assert.equal(validateAgreement(TRACTORS).length, 0);
  assert.equal(assetShare(TRACTORS, TRACTORS.assets[0]).payment, Math.round($(7_500) / 7));
});

console.log('\nThe clash: 4 tractors in 2029, and 7 more on 36 vs 48 months');
const SEVEN_36 = { ...TRACTORS, id: 'proposal-36', status: 'proposed' as const, maturityDate: '2029-08-01', termMonths: 36, plan: { ...TRACTORS.plan, paymentCount: 36, amount: $(10_400) } };
test('on 36 months, 11 tractor buyouts land in 2029', () => {
  const rows = byYear([FOUR, TRUCK, SEVEN_36], 2026, 2031);
  const y2029 = rows.find(r => r.year === 2029)!;
  assert.equal(y2029.units, 4);
  assert.equal(y2029.proposedUnits, 7);
  assert.equal(y2029.units + y2029.proposedUnits, 11);
  assert.equal(y2029.residual, $(240_000));
});
test('on 48 months, the seven move to 2030 — residuals by year', () => {
  const rows = byYear([FOUR, TRUCK, TRACTORS], 2027, 2030);
  assert.deepEqual(rows.map(r => [r.year, r.residual / 100]), [[2027, 0], [2028, 35_000], [2029, 240_000], [2030, 210_000]]);
  assert.equal(rows[3].units, 7);
  assert.equal(rows[2].units, 4);
});
test('portfolio: totals by category, proposed kept apart', () => {
  const p = portfolio([FOUR, TRUCK, TRACTORS, SEVEN_36], FLEET, TODAY);
  assert.equal(p.total.agreements, 3);
  assert.equal(p.total.units, 12);
  assert.equal(p.byCategory.Tractors.units, 11);
  assert.equal(p.byCategory.Trucks.units, 1);
  assert.equal(p.total.monthly, $(7_500 + 4_100 + 1_900));
  assert.equal(p.total.residual, $(210_000 + 240_000 + 35_000));
  assert.equal(p.proposed.agreements, 1);
  assert.equal(p.proposed.units, 7);
});
test('cash flow: buyout months stand out; proposed is separate', () => {
  const rows = cashFlowByMonth([FOUR, TRUCK, TRACTORS, SEVEN_36], '2026-11-01', 60);
  assert.equal(rows.length, 60);
  assert.equal(rows[0].month, '2026-11');
  assert.equal(rows[0].active, $(8_475 + 4_100 + 1_900));
  assert.equal(rows[0].proposed, $(10_400 * 1.13));
  const jun29 = rows.find(r => r.month === '2029-06')!;
  assert.equal(jun29.residual, $(240_000));
  const spikes = spikeMonths(rows);
  assert.deepEqual(spikes, ['2028-04', '2029-06', '2030-08']);
});
test('residual exposure buckets from today', () => {
  const b = residualBuckets([FOUR, TRUCK, TRACTORS, SEVEN_36], TODAY);
  assert.equal(b['0-12'].amount, 0);
  assert.equal(b['12-24'].amount, $(35_000));   // Apr 2028 = 17 months
  assert.equal(b['24-36'].amount, $(240_000));  // Jun 2029 = 32 months
  assert.equal(b['36+'].amount, $(210_000));    // Aug 2030 = 46 months; the proposal is not exposure
});
test('per unit: the badge index finds each tractor', () => {
  const { current } = financeByUnit([FOUR, TRACTORS, SEVEN_36], TODAY);
  assert.equal(current.get('f-l3')!.length, 2); // active + proposed
  assert.equal(current.get('f-l3')![0].agreement.id, 'tractors-7');
  assert.equal(current.get('f-a')![0].residualShare, $(60_000));
  assert.equal(current.has('f-t10'), false);
});

console.log('\nPayment plans');
test('seasonal: Dec–Mar skipped, skipped months do not count', () => {
  const a = agreement({ id: 's', plan: { frequency: 'monthly', amount: $(500), firstPaymentDate: '2026-11-15', paymentCount: 10, skipMonths: [12, 1, 2, 3] } });
  const d = buildSchedule(a).map(p => p.date);
  assert.deepEqual(d, ['2026-11-15', '2027-04-15', '2027-05-15', '2027-06-15', '2027-07-15', '2027-08-15', '2027-09-15', '2027-10-15', '2027-11-15', '2028-04-15']);
  assert.equal(paymentsPerYear(a), 8);
  assert.equal(agreementFigures(a, '2026-10-01').monthlyEquivalent, $(500 * 8 / 12));
});
test('annual and quarterly; deferred first payment', () => {
  const ann = agreement({ id: 'a', plan: { frequency: 'annual', amount: $(12_000), firstPaymentDate: '2027-05-01', paymentCount: 3 } });
  assert.deepEqual(buildSchedule(ann).map(p => p.date), ['2027-05-01', '2028-05-01', '2029-05-01']);
  assert.equal(agreementFigures(ann, TODAY).monthlyEquivalent, $(1_000));
  const q = agreement({ id: 'q', plan: { frequency: 'quarterly', amount: $(3_000), firstPaymentDate: '2026-01-31', paymentCount: 3 } });
  assert.deepEqual(buildSchedule(q).map(p => p.date), ['2026-01-31', '2026-04-30', '2026-07-31']);
});
test('month-end clamp does not drift', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-01-31', 2), '2026-03-31');
  assert.equal(addMonths('2027-12-31', 2), '2028-02-29');
});
test('tax included vs added vs none', () => {
  const inc = buildSchedule(agreement({ id: 'i', tax: { mode: 'included', ratePct: 13 }, plan: { frequency: 'monthly', amount: $(1_130), firstPaymentDate: '2026-01-01', paymentCount: 1 } }))[0];
  assert.deepEqual([inc.preTax, inc.tax, inc.total], [$(1_000), $(130), $(1_130)]);
  const addd = buildSchedule(agreement({ id: 'a', tax: { mode: 'added', ratePct: 13 }, plan: { frequency: 'monthly', amount: $(1_000), firstPaymentDate: '2026-01-01', paymentCount: 1 } }))[0];
  assert.deepEqual([addd.preTax, addd.tax, addd.total], [$(1_000), $(130), $(1_130)]);
});
test('a unit paid out mid-term: payment change from that date', () => {
  const a = { ...TRACTORS, paymentChanges: [{ from: '2027-05-01', amount: $(7_000) }] };
  const reg = buildSchedule(a).filter(p => p.kind === 'regular');
  assert.equal(reg[7].preTax, $(7_500)); // Apr 2027
  assert.equal(reg[8].preTax, $(7_000)); // May 2027
});
test('extra payments and fees; the residual is skipped when the plan is to return', () => {
  const a = agreement({ id: 'x', residual: $(5_000), maturityDate: '2026-12-01', extraPayments: [{ date: '2026-06-15', amount: $(250), kind: 'fee' }] });
  assert.equal(buildSchedule(a).filter(p => p.kind === 'fee').length, 1);
  assert.equal(buildSchedule(a).filter(p => p.kind === 'residual').length, 1);
  assert.equal(buildSchedule({ ...a, endOfTermPlan: 'return' }).filter(p => p.kind === 'residual').length, 0);
});
test('an agreement ended early (bought out) has no payments after the end', () => {
  const a = { ...TRACTORS, status: 'ended' as const, endedAt: '2028-02-15', endReason: 'bought_out' as const, extraPayments: [{ date: '2028-02-15', amount: $(400_000), kind: 'payoff' as const }] };
  const s = buildSchedule(a);
  assert.equal(s[s.length - 1].date, '2028-02-15');
  assert.equal(s[s.length - 1].kind, 'payoff');
  assert.equal(agreementFigures(a, TODAY).displayStatus, 'paid_off');
  assert.equal(portfolio([a], FLEET, TODAY).total.agreements, 0);
});

console.log('\nBalances');
// $100,000 at 6% over 12 months: payment $8,606.64.
const LOAN = agreement({ id: 'loan', aprPct: 6, financedAmount: $(100_000), acquisitionCost: $(100_000), startDate: '2026-01-01', maturityDate: '2027-01-01',
  plan: { frequency: 'monthly', amount: $(8_606.64), firstPaymentDate: '2026-02-01', paymentCount: 12 } });
test('loan with APR: estimated balance amortizes to ~0', () => {
  const mid = agreementFigures(LOAN, '2026-07-01');
  assert.equal(mid.balanceSource, 'estimate');
  assert.ok(Math.abs(mid.balance! - $(50_748)) < $(150), `after 6 of 12 payments ${mid.balance}`);
  const end = agreementFigures(LOAN, '2026-12-31');
  assert.ok(end.balance! < $(9_000) && end.balance! > $(8_400), `before last payment ${end.balance}`);
  assert.equal(agreementFigures(LOAN, '2027-01-02').displayStatus, 'paid_off');
});
test('a lender balance overrides the estimate', () => {
  const a = { ...LOAN, aprPct: null, balanceOverride: { amount: $(50_000), asOf: '2026-06-15' } };
  const f = agreementFigures(a, '2026-07-10');
  assert.equal(f.balanceSource, 'lender');
  assert.equal(f.balanceAsOf, '2026-06-15');
  assert.equal(f.balance, $(50_000 - 8_606.64)); // less the Jul 1 payment
});
test('a lease past maturity, undecided, keeps showing', () => {
  const f = agreementFigures(FOUR, '2029-07-01');
  assert.equal(f.displayStatus, 'past_maturity');
  assert.equal(f.residualRemaining, $(240_000));
  assert.equal(agreementFigures({ ...FOUR, status: 'ended', endedAt: '2029-06-01', endReason: 'returned' }, '2029-07-01').displayStatus, 'ended');
});

console.log('\nChecks');
test('allocations that do not add up are a warning, missing dates an error', () => {
  const bad = { ...TRACTORS, assets: TRACTORS.assets.slice(0, 6) };
  const issues = validateAgreement(bad);
  assert.ok(issues.some(i => i.level === 'warning' && /Allocations/.test(i.message)));
  assert.ok(issues.some(i => i.level === 'warning' && /Residual shares/.test(i.message)));
  assert.ok(validateAgreement({ ...TRACTORS, maturityDate: '' }).some(i => i.level === 'error'));
  assert.ok(validateAgreement({ ...TRACTORS, maturityDate: '2030-06-01' }).some(i => /after maturity/.test(i.message)));
});

// Per-agreement figures derived from the terms (never stored).
// V1 assumes every scheduled payment on or before `today` was made.
import type { FinanceAgreement, Ymd, AgreementAsset } from './types';
import { FREQUENCY_MONTHS, isLease } from './types';
import { buildSchedule, daysBetween, paymentAmountOn, isValidYmd, type ScheduledPayment } from './schedule';
import { cents, add, ZERO, type Cents } from './money';

export type DisplayStatus = 'proposed' | 'financed' | 'past_maturity' | 'paid_off' | 'ended';
export type BalanceSource = 'lender' | 'estimate' | 'remaining_payments' | 'none';

export const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
  proposed: 'Proposed', financed: 'Financed', past_maturity: 'Past maturity', paid_off: 'Paid off', ended: 'Ended',
};

export interface AgreementFigures {
  schedule: ScheduledPayment[];
  displayStatus: DisplayStatus;
  paymentsMade: number;            // regular payments on or before today
  paymentsRemaining: number;       // regular payments after today
  paidTotal: Cents;                // everything paid so far (with tax)
  remainingTotal: Cents;           // everything still to pay (with tax, incl. residual unless returned)
  remainingPreTax: Cents;
  residualRemaining: Cents;        // residual/balloon still ahead (pre-tax)
  totalPayments: Cents;            // whole agreement, pre-tax (what the lender receives)
  costOfBorrowing: Cents;          // totalPayments − financed amount (pre-tax; never below 0)
  monthlyEquivalent: Cents;        // regular payment (pre-tax) spread per month, seasonal skips included
  currentPayment: Cents;           // regular payment (with tax) in force today
  nextPayment: ScheduledPayment | null;
  balance: Cents | null;           // loans: lender figure or estimate; leases: remaining obligation
  balanceSource: BalanceSource;
  balanceAsOf: Ymd | null;
  daysToMaturity: number | null;
}

/** Regular payments per year after seasonal skips (monthly with Dec–Mar off → 8). */
export function paymentsPerYear(a: FinanceAgreement): number {
  const step = FREQUENCY_MONTHS[a.plan.frequency] || 1;
  const skip = new Set(a.plan.skipMonths || []);
  if (!skip.size || !isValidYmd(a.plan.firstPaymentDate)) return 12 / step;
  const first = Number(a.plan.firstPaymentDate.slice(5, 7));
  let n = 0;
  for (let k = 0; k < 12; k += step) if (!skip.has(((first - 1 + k) % 12) + 1)) n++;
  return n;
}

/**
 * Loan balance from APR: start at the financed amount on the start date,
 * accrue simple daily interest between payments, subtract each pre-tax
 * payment. A lender statement (balanceOverride) replaces the start point.
 */
export function estimateLoanBalance(a: FinanceAgreement, schedule: ScheduledPayment[], today: Ymd): Cents {
  const apr = Number(a.aprPct) || 0;
  let bal = a.financedAmount, from = a.startDate;
  const o = a.balanceOverride;
  if (o && isValidYmd(o.asOf) && o.asOf <= today) { bal = o.amount; from = o.asOf; }
  for (const p of schedule) {
    if (p.date <= from) continue;
    if (p.date > today) break;
    bal += bal * (apr / 100) * Math.max(0, daysBetween(from, p.date)) / 365;
    bal -= p.preTax;
    from = p.date;
    if (bal <= 0) return ZERO;
  }
  bal += bal * (apr / 100) * Math.max(0, daysBetween(from, today)) / 365;
  return cents(Math.max(0, Math.round(bal)));
}

export function agreementFigures(a: FinanceAgreement, today: Ymd): AgreementFigures {
  const schedule = buildSchedule(a);
  const done = schedule.filter(p => p.date <= today);
  const ahead = schedule.filter(p => p.date > today);
  const regularDone = done.filter(p => p.kind === 'regular').length;
  const regularAhead = ahead.filter(p => p.kind === 'regular').length;
  const totalPayments = add(...schedule.map(p => p.preTax));
  const remainingPreTax = add(...ahead.map(p => p.preTax));
  let residualRemaining = add(...ahead.filter(p => p.kind !== 'regular').map(p => p.preTax));

  let displayStatus: DisplayStatus;
  if (a.status === 'proposed') displayStatus = 'proposed';
  else if (a.status === 'ended') displayStatus = a.endReason === 'paid_off' || a.endReason === 'bought_out' ? 'paid_off' : 'ended';
  // A lease whose residual date has passed stays open until the outcome
  // (buyout / return / refinance) is recorded — it keeps alerting.
  else if (!ahead.length && isLease(a.type) && (a.residual || 0) > 0) displayStatus = 'past_maturity';
  else if (!ahead.length) displayStatus = 'paid_off';
  else displayStatus = 'financed';

  if (displayStatus === 'past_maturity') residualRemaining = cents(a.residual || 0);

  let balance: Cents | null = null, balanceSource: BalanceSource = 'none', balanceAsOf: Ymd | null = null;
  const o = a.balanceOverride;
  if (displayStatus === 'financed' || displayStatus === 'past_maturity') {
    const lender = o && isValidYmd(o.asOf) && o.asOf <= today ? o : null;
    if (lender && !(Number(a.aprPct) > 0)) {
      // Lender figure less the payments made since its date.
      const since = schedule.filter(p => p.date > lender.asOf && p.date <= today);
      balance = cents(Math.max(0, lender.amount - since.reduce((s, p) => s + p.preTax, 0)));
      balanceSource = 'lender'; balanceAsOf = lender.asOf;
    } else if (lender || (!isLease(a.type) && Number(a.aprPct) > 0)) {
      // Rolled forward from the lender figure (or from the start) with the APR.
      balance = estimateLoanBalance(a, schedule, today);
      balanceSource = lender ? 'lender' : 'estimate'; balanceAsOf = lender ? lender.asOf : today;
    } else {
      balance = remainingPreTax; balanceSource = 'remaining_payments'; balanceAsOf = today;
    }
  }

  const perYear = paymentsPerYear(a);
  const regularNow = paymentAmountOn(a, today);
  const currentReg = schedule.find(p => p.kind === 'regular' && p.date > today) || [...schedule].reverse().find(p => p.kind === 'regular');
  const preTaxNow = a.tax.mode === 'included' && a.tax.ratePct > 0 ? Math.round(regularNow / (1 + a.tax.ratePct / 100)) : regularNow;

  return {
    schedule,
    displayStatus,
    paymentsMade: regularDone,
    paymentsRemaining: regularAhead,
    paidTotal: add(...done.map(p => p.total)),
    remainingTotal: add(...ahead.map(p => p.total)),
    remainingPreTax,
    residualRemaining,
    totalPayments,
    costOfBorrowing: cents(Math.max(0, totalPayments - a.financedAmount)),
    monthlyEquivalent: cents(Math.round(preTaxNow * perYear / 12)),
    currentPayment: currentReg ? currentReg.total : ZERO,
    nextPayment: ahead[0] || null,
    balance,
    balanceSource,
    balanceAsOf,
    daysToMaturity: isValidYmd(a.maturityDate) ? daysBetween(today, a.maturityDate) : null,
  };
}

// ── One unit's share of an agreement ────────────────────────────────────────
export const liveAssets = (a: FinanceAgreement): AgreementAsset[] => (a.assets || []).filter(x => !x.removedAt);

/** The share of an agreement that belongs to one asset (by allocated value unless set explicitly). */
export function assetShare(a: FinanceAgreement, asset: AgreementAsset): { residual: Cents; payment: Cents; fraction: number } {
  const live = liveAssets(a);
  const totalAlloc = live.reduce((s, x) => s + (x.allocatedValue || 0), 0);
  const fraction = totalAlloc > 0 ? (asset.allocatedValue || 0) / totalAlloc : (live.length ? 1 / live.length : 0);
  return {
    fraction,
    residual: cents(asset.residualShare != null ? asset.residualShare : Math.round((a.residual || 0) * fraction)),
    payment: cents(asset.paymentShare != null ? asset.paymentShare : Math.round(a.plan.amount * fraction)),
  };
}

// ── Checks shown on the editor (warnings never block a save) ────────────────
export interface Issue { level: 'error' | 'warning'; message: string }

export function validateAgreement(a: FinanceAgreement): Issue[] {
  const out: Issue[] = [];
  const err = (message: string) => out.push({ level: 'error', message });
  const warn = (message: string) => out.push({ level: 'warning', message });
  if (!a.lender?.trim()) err('Lender is required.');
  if (!isValidYmd(a.startDate)) err('Start date is required.');
  if (!isValidYmd(a.maturityDate)) err('Maturity date is required.');
  if (isValidYmd(a.startDate) && isValidYmd(a.maturityDate) && a.maturityDate < a.startDate) err('Maturity is before the start date.');
  if (!isValidYmd(a.plan.firstPaymentDate)) err('First payment date is required.');
  if (!(a.plan.paymentCount > 0)) err('Number of payments must be at least 1.');
  if (!(a.plan.amount >= 0)) err('Payment amount is required.');
  if (!(a.financedAmount >= 0)) err('Financed amount is required.');
  if (a.status === 'ended' && !isValidYmd(a.endedAt)) err('An ended agreement needs an end date.');
  if ((a.plan.skipMonths || []).length >= 12) err('Every month is skipped.');

  const expectFinanced = (a.acquisitionCost || 0) - (a.downPayment || 0) - (a.tradeInCredit || 0) + (a.taxFinanced || 0);
  if (a.acquisitionCost > 0 && expectFinanced !== a.financedAmount) {
    warn(`Price − down − trade-ins${a.taxFinanced ? ' + financed HST' : ''} = ${(expectFinanced / 100).toFixed(2)}, but the financed amount is ${(a.financedAmount / 100).toFixed(2)}.`);
  }
  if ((a.tradeIns || []).length) {
    const tr = (a.tradeIns || []).reduce((s, x) => s + (x.value || 0), 0);
    if (tr !== (a.tradeInCredit || 0)) warn(`Trade-ins add up to ${(tr / 100).toFixed(2)}, not the trade-in credit ${((a.tradeInCredit || 0) / 100).toFixed(2)}.`);
  }
  const live = liveAssets(a);
  if (!live.length) warn('No equipment on this agreement.');
  for (const x of live) if (x.disposal && !x.disposal.date) warn(`${x.labelSnapshot || x.description || 'A unit'} is marked ${x.disposal.kind} — date not entered yet.`);
  const alloc = live.reduce((s, x) => s + (x.allocatedValue || 0), 0);
  if (live.length && alloc !== a.financedAmount && alloc !== a.acquisitionCost) {
    warn(`Allocations add up to ${(alloc / 100).toFixed(2)}, not the financed amount ${(a.financedAmount / 100).toFixed(2)} or the acquisition cost.`);
  }
  if ((a.residual || 0) > 0 && live.some(x => x.residualShare != null)) {
    const rs = live.reduce((s, x) => s + (x.residualShare || 0), 0);
    if (rs !== a.residual) warn(`Residual shares add up to ${(rs / 100).toFixed(2)}, not the residual ${((a.residual || 0) / 100).toFixed(2)}.`);
  }
  if (isValidYmd(a.maturityDate)) {
    const last = buildSchedule({ ...a, status: 'active', residual: 0, extraPayments: [] }).pop();
    if (last && last.date > a.maturityDate) warn(`The last regular payment (${last.date}) falls after maturity (${a.maturityDate}).`);
  }
  if (a.balanceOverride && !isValidYmd(a.balanceOverride.asOf)) err('The lender balance needs an as-of date.');
  if (a.type === 'lease_1_buyout' && (a.residual || 0) > 100) warn('A $1-buyout lease with a residual over $1.');
  return out;
}

// ── "What's left" bars ──────────────────────────────────────────────────────
// Down payment / trade-ins, then what has been paid, what is still owing in
// regular payments, and the residual / balloon still due. All before tax —
// the lender's figures, so the bar adds up to the price that was financed.
export interface WhatsLeftBar {
  down: Cents;          // cash down + trade-in credit
  paid: Cents;          // payments made so far (incl. any one-offs already paid)
  owing: Cents;         // regular payments (and fees / payoffs) still ahead
  residual: Cents;      // residual / balloon still ahead
  unscheduled: Cents;   // financed amount the schedule doesn't cover (flag)
  total: Cents;
  made: number;
  count: number;        // regular payments in all
}
const isEndPayment = (k: string) => k === 'residual' || k === 'balloon' || k === 'residual_buyout';

export function whatsLeft(a: FinanceAgreement, f: AgreementFigures, today: Ymd): WhatsLeftBar {
  let paid = 0, owing = 0, residual = 0;
  for (const p of f.schedule) {
    if (p.date <= today) paid += p.preTax;
    else if (isEndPayment(p.kind)) residual += p.preTax;
    else owing += p.preTax;
  }
  if (f.displayStatus === 'past_maturity') residual = f.residualRemaining;
  const down = (a.downPayment || 0) + (a.tradeInCredit || 0);
  const unscheduled = Math.max(0, a.financedAmount - f.totalPayments);
  return {
    down: cents(down), paid: cents(paid), owing: cents(owing), residual: cents(residual), unscheduled: cents(unscheduled),
    total: cents(down + paid + owing + residual + unscheduled),
    made: f.paymentsMade, count: f.paymentsMade + f.paymentsRemaining,
  };
}

/** One unit's slice of the agreement bar: its share by allocated value (residual by its own share when set). */
export function unitWhatsLeft(a: FinanceAgreement, bar: WhatsLeftBar, asset: AgreementAsset): WhatsLeftBar {
  const s = assetShare(a, asset);
  const k = (n: number) => cents(Math.round(n * s.fraction));
  const residual = asset.residualShare != null && (a.residual || 0) > 0
    ? cents(Math.round(bar.residual * (asset.residualShare / (a.residual || 1))))
    : k(bar.residual);
  const out = { ...bar, down: k(bar.down), paid: k(bar.paid), owing: k(bar.owing), residual, unscheduled: k(bar.unscheduled) };
  return { ...out, total: cents(out.down + out.paid + out.owing + out.residual + out.unscheduled) };
}

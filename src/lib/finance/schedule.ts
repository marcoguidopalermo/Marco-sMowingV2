// Agreement terms → dated payments. The single source for cash flow,
// remaining payments, balances and maturity views (spec §"Timeline").
import type { FinanceAgreement, Ymd, ExtraKind } from './types';
import { FREQUENCY_MONTHS } from './types';
import { cents, type Cents } from './money';

// ── Dates (YYYY-MM-DD, calendar arithmetic; no time zones) ──────────────────
const parse = (s: Ymd) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const ymd = (y: number, m: number, d: number): Ymd => `${y}-${pad(m)}-${pad(d)}`;
/** Add calendar months, clamping the day (Jan 31 + 1 → Feb 28/29). */
export function addMonths(s: Ymd, n: number): Ymd {
  const { y, m, d } = parse(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  return ymd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}
export const monthKey = (s: Ymd) => s.slice(0, 7);
export const yearOf = (s: Ymd) => Number(s.slice(0, 4));
export const ymdMs = (s: Ymd) => { const { y, m, d } = parse(s); return Date.UTC(y, m - 1, d); };
export const daysBetween = (a: Ymd, b: Ymd) => Math.round((ymdMs(b) - ymdMs(a)) / 86_400_000);
/** Whole months from a to b (by calendar month, ignoring days). */
export const monthsBetween = (a: Ymd, b: Ymd) => { const x = parse(a), y = parse(b); return (y.y - x.y) * 12 + (y.m - x.m); };
export const isValidYmd = (s: unknown): s is Ymd => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(ymdMs(s));

// ── Payments ────────────────────────────────────────────────────────────────
export type PaymentKind = 'regular' | 'residual' | ExtraKind;

export interface ScheduledPayment {
  date: Ymd;
  kind: PaymentKind;
  preTax: Cents;      // before HST
  tax: Cents;
  total: Cents;       // what leaves the account
  index?: number;     // 1-based, regular payments only
}

function withTax(amount: number, mode: 'included' | 'added' | 'none', ratePct: number): { preTax: Cents; tax: Cents; total: Cents } {
  const amt = Math.round(amount);
  if (mode === 'none' || !(ratePct > 0)) return { preTax: cents(amt), tax: cents(0), total: cents(amt) };
  if (mode === 'added') {
    const tax = Math.round(amt * ratePct / 100);
    return { preTax: cents(amt), tax: cents(tax), total: cents(amt + tax) };
  }
  // included: the amount already contains the tax
  const pre = Math.round(amt / (1 + ratePct / 100));
  return { preTax: cents(pre), tax: cents(amt - pre), total: cents(amt) };
}

/** The regular payment amount in force on a date (latest change wins). */
export function paymentAmountOn(a: FinanceAgreement, date: Ymd): number {
  let amt = a.plan.amount;
  for (const c of [...(a.paymentChanges || [])].sort((x, y) => x.from.localeCompare(y.from))) {
    if (c.from <= date) amt = c.amount;
  }
  return amt;
}

/**
 * Every payment the agreement implies, in date order:
 * - regular payments from the first payment date, every 1/3/6/12 months,
 *   skipping seasonal skip-months (skipped months don't count), until the
 *   number of payments is reached;
 * - one-off payments (balloon, payoff, fees);
 * - the lease residual at maturity, unless the plan is to return it;
 * - nothing after an early end (endedAt).
 */
export function buildSchedule(a: FinanceAgreement): ScheduledPayment[] {
  const out: ScheduledPayment[] = [];
  const { plan, tax } = a;
  const step = FREQUENCY_MONTHS[plan.frequency] || 1;
  const skip = new Set(plan.skipMonths || []);
  if (isValidYmd(plan.firstPaymentDate) && plan.paymentCount > 0 && plan.amount >= 0) {
    let date = plan.firstPaymentDate, made = 0, guard = 0;
    while (made < plan.paymentCount && guard++ < 2000) {
      if (!skip.has(Number(date.slice(5, 7)))) {
        made++;
        out.push({ date, kind: 'regular', index: made, ...withTax(paymentAmountOn(a, date), tax.mode, tax.ratePct) });
      }
      date = addMonths(plan.firstPaymentDate, step * (guard));
    }
  }
  for (const x of a.extraPayments || []) {
    if (!isValidYmd(x.date)) continue;
    const t = x.taxable ? withTax(x.amount, 'added', tax.ratePct) : withTax(x.amount, 'none', 0);
    out.push({ date: x.date, kind: x.kind, ...t });
  }
  if ((a.residual || 0) > 0 && isValidYmd(a.maturityDate) && a.endOfTermPlan !== 'return') {
    const t = a.residualTaxable ? withTax(a.residual!, 'added', tax.ratePct) : withTax(a.residual!, 'none', 0);
    out.push({ date: a.maturityDate, kind: 'residual', ...t });
  }
  const cut = a.status === 'ended' && a.endedAt ? a.endedAt : null;
  return out
    .filter(p => !cut || p.date <= cut)
    .sort((x, y) => x.date.localeCompare(y.date) || (x.kind === 'regular' ? -1 : 1));
}

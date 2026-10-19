// Company-wide views over all agreements: totals, categories, cash flow by
// month, maturities and residuals by year, residual exposure buckets, and
// the per-unit index behind the fleet "Financed" badge.
import type { FinanceAgreement, Ymd } from './types';
import { agreementFigures, liveAssets, assetShare, type AgreementFigures } from './calc';
import { addMonths, monthKey, monthsBetween, yearOf, isValidYmd } from './schedule';
import { add, cents, ZERO, type Cents } from './money';

export type Category = 'Tractors' | 'Trucks' | 'Trailers' | 'Other';
export const CATEGORIES: Category[] = ['Tractors', 'Trucks', 'Trailers', 'Other'];

interface FleetLike { id: string; type?: string }

export function categoryOfType(type: string | undefined): Category {
  switch ((type || '').toLowerCase()) {
    case 'tractor': return 'Tractors';
    case 'truck': return 'Trucks';
    case 'trailer': return 'Trailers';
    default: return 'Other';
  }
}

/** An agreement's category = the category holding most of its allocated value. */
export function agreementCategory(a: FinanceAgreement, fleetById: Map<string, FleetLike>): Category {
  const weight = new Map<Category, number>();
  for (const x of liveAssets(a)) {
    const c = categoryOfType(x.fleetUnitId ? fleetById.get(x.fleetUnitId)?.type : undefined);
    weight.set(c, (weight.get(c) || 0) + (x.allocatedValue || 1));
  }
  let best: Category = 'Other', w = -1;
  for (const c of CATEGORIES) if ((weight.get(c) || 0) > w) { best = c; w = weight.get(c) || 0; }
  return best;
}

/** Agreements that count: not soft-deleted. */
export const visibleAgreements = (all: FinanceAgreement[]) => all.filter(a => !a.deletedAt);

export interface Totals {
  agreements: number;
  units: number;
  monthly: Cents;            // pre-tax monthly equivalent of regular payments
  remaining: Cents;          // everything still to pay, pre-tax (incl. residuals)
  residual: Cents;           // residuals / balloons still ahead, pre-tax
  balance: Cents;            // loan balances + lease remaining obligations
  acquisition: Cents;
}
const emptyTotals = (): Totals => ({ agreements: 0, units: 0, monthly: ZERO, remaining: ZERO, residual: ZERO, balance: ZERO, acquisition: ZERO });
function addTo(t: Totals, a: FinanceAgreement, f: AgreementFigures) {
  t.agreements++;
  t.units += liveAssets(a).length;
  t.monthly = add(t.monthly, f.monthlyEquivalent);
  t.remaining = add(t.remaining, f.remainingPreTax);
  t.residual = add(t.residual, f.residualRemaining);
  t.balance = add(t.balance, f.balance || 0);
  t.acquisition = add(t.acquisition, a.acquisitionCost || 0);
}

export interface Portfolio {
  total: Totals;                         // active (financed / past maturity) only
  byCategory: Record<Category, Totals>;
  proposed: Totals;                      // proposed agreements, kept apart
  figures: Map<string, AgreementFigures>;
}

export function portfolio(all: FinanceAgreement[], fleet: FleetLike[], today: Ymd): Portfolio {
  const fleetById = new Map(fleet.map(u => [u.id, u]));
  const total = emptyTotals(), proposed = emptyTotals();
  const byCategory = Object.fromEntries(CATEGORIES.map(c => [c, emptyTotals()])) as Record<Category, Totals>;
  const figures = new Map<string, AgreementFigures>();
  for (const a of visibleAgreements(all)) {
    const f = agreementFigures(a, today);
    figures.set(a.id, f);
    if (f.displayStatus === 'proposed') { addTo(proposed, a, f); continue; }
    if (f.displayStatus !== 'financed' && f.displayStatus !== 'past_maturity') continue;
    addTo(total, a, f);
    addTo(byCategory[agreementCategory(a, fleetById)], a, f);
  }
  return { total, byCategory, proposed, figures };
}

// ── Cash flow ───────────────────────────────────────────────────────────────
export interface CashFlowMonth {
  month: string;              // YYYY-MM
  active: Cents;              // with tax — what leaves the account
  proposed: Cents;
  residual: Cents;            // part of `active` that is residual / balloon / payoff
  byAgreement: Record<string, Cents>;
}

/** `months` calendar months starting with the month of `from`. */
export function cashFlowByMonth(all: FinanceAgreement[], from: Ymd, months: number): CashFlowMonth[] {
  const start = from.slice(0, 7) + '-01';
  const rows: CashFlowMonth[] = Array.from({ length: months }, (_, i) => ({
    month: monthKey(addMonths(start, i)), active: ZERO, proposed: ZERO, residual: ZERO, byAgreement: {},
  }));
  const idx = new Map(rows.map((r, i) => [r.month, i]));
  for (const a of visibleAgreements(all)) {
    if (a.status === 'ended' && !a.endedAt) continue;
    const f = agreementFigures(a, from);
    for (const p of f.schedule) {
      const i = idx.get(monthKey(p.date));
      if (i == null) continue;
      const r = rows[i];
      if (a.status === 'proposed') r.proposed = add(r.proposed, p.total);
      else {
        r.active = add(r.active, p.total);
        if (p.kind !== 'regular') r.residual = add(r.residual, p.total);
      }
      r.byAgreement[a.id] = add(r.byAgreement[a.id] || 0, p.total);
    }
  }
  return rows;
}

/** Months whose outflow is at least `factor` × the median month — the spikes to label. */
export function spikeMonths(rows: CashFlowMonth[], factor = 2, includeProposed = false): string[] {
  const vals = rows.map(r => r.active + (includeProposed ? r.proposed : 0));
  const sorted = vals.filter(v => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return [];
  const median = sorted[Math.floor(sorted.length / 2)];
  return rows.filter((_, i) => vals[i] >= median * factor && vals[i] > 0).map(r => r.month);
}

// ── Maturities and residuals by year ────────────────────────────────────────
export interface YearRow {
  year: number;
  maturing: { id: string; lender: string; units: number; residual: Cents; date: Ymd; proposed: boolean }[];
  units: number;              // active units maturing
  residual: Cents;            // active residual due (pre-tax)
  proposedUnits: number;
  proposedResidual: Cents;
  payments: Cents;            // active outflow in the year, with tax
}

export function byYear(all: FinanceAgreement[], fromYear: number, toYear: number): YearRow[] {
  const rows: YearRow[] = [];
  for (let y = fromYear; y <= toYear; y++) rows.push({ year: y, maturing: [], units: 0, residual: ZERO, proposedUnits: 0, proposedResidual: ZERO, payments: ZERO });
  const at = (y: number) => rows[y - fromYear];
  for (const a of visibleAgreements(all)) {
    if (a.status === 'ended') {
      // Payments up to the end still count toward that year's outflow.
      for (const p of agreementFigures(a, `${fromYear}-01-01`).schedule) { const r = at(yearOf(p.date)); if (r) r.payments = add(r.payments, p.total); }
      continue;
    }
    const proposed = a.status === 'proposed';
    const sched = agreementFigures(a, `${fromYear}-01-01`).schedule;
    const residual = add(...sched.filter(p => p.kind !== 'regular').map(p => p.preTax));
    if (isValidYmd(a.maturityDate)) {
      const r = at(yearOf(a.maturityDate));
      if (r) {
        const units = liveAssets(a).length;
        r.maturing.push({ id: a.id, lender: a.lender, units, residual, date: a.maturityDate, proposed });
        if (proposed) { r.proposedUnits += units; r.proposedResidual = add(r.proposedResidual, residual); }
        else { r.units += units; r.residual = add(r.residual, residual); }
      }
    }
    if (!proposed) for (const p of sched) { const r = at(yearOf(p.date)); if (r) r.payments = add(r.payments, p.total); }
  }
  return rows;
}

// ── Residual exposure buckets (months from today) ───────────────────────────
export type BucketKey = '0-12' | '12-24' | '24-36' | '36+';
export const BUCKETS: BucketKey[] = ['0-12', '12-24', '24-36', '36+'];

export function residualBuckets(all: FinanceAgreement[], today: Ymd): Record<BucketKey, { amount: Cents; agreements: string[] }> {
  const out = Object.fromEntries(BUCKETS.map(b => [b, { amount: ZERO, agreements: [] as string[] }])) as Record<BucketKey, { amount: Cents; agreements: string[] }>;
  for (const a of visibleAgreements(all)) {
    if (a.status !== 'active') continue;
    for (const p of agreementFigures(a, today).schedule) {
      if (p.kind === 'regular' || p.date <= today) continue;
      const m = monthsBetween(today, p.date);
      const b: BucketKey = m < 12 ? '0-12' : m < 24 ? '12-24' : m < 36 ? '24-36' : '36+';
      out[b].amount = add(out[b].amount, p.preTax);
      if (!out[b].agreements.includes(a.id)) out[b].agreements.push(a.id);
    }
  }
  return out;
}

// ── Per fleet unit (badge + Finance panel) ──────────────────────────────────
export interface UnitFinance {
  agreement: FinanceAgreement;
  figures: AgreementFigures;
  residualShare: Cents;
  paymentShare: Cents;
}

/** fleetUnitId → its current agreements (active / proposed), newest first; history kept separately. */
export function financeByUnit(all: FinanceAgreement[], today: Ymd): { current: Map<string, UnitFinance[]>; history: Map<string, FinanceAgreement[]> } {
  const current = new Map<string, UnitFinance[]>(), history = new Map<string, FinanceAgreement[]>();
  for (const a of visibleAgreements(all)) {
    const figures = agreementFigures(a, today);
    for (const x of a.assets || []) {
      if (!x.fleetUnitId) continue;
      const live = !x.removedAt && (a.status === 'active' || a.status === 'proposed');
      if (!live) { history.set(x.fleetUnitId, [...(history.get(x.fleetUnitId) || []), a]); continue; }
      const s = assetShare(a, x);
      const list = current.get(x.fleetUnitId) || [];
      list.push({ agreement: a, figures, residualShare: s.residual, paymentShare: s.payment });
      current.set(x.fleetUnitId, list.sort((p, q) => (q.agreement.startDate || '').localeCompare(p.agreement.startDate || '')));
    }
  }
  return { current, history };
}

/** Splits a total across n shares that add back up exactly (last share absorbs the rounding). */
export function splitEvenly(total: number, n: number): Cents[] {
  if (n <= 0) return [];
  const each = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => cents(i === n - 1 ? total - each * (n - 1) : each));
}

/** Splits a total in proportion to weights; the shares add back up exactly (largest remainders). */
export function allocateByWeight(total: number, weights: number[]): Cents[] {
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (!weights.length) return [];
  if (sum <= 0) return splitEvenly(total, weights.length);
  const raw = weights.map(w => (total * Math.max(0, w)) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((x, y) => y[0] - x[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return out.map(n => cents(n));
}

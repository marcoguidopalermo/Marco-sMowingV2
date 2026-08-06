// BONUS PAYOUT MARKERS — the layer that records what happened to a share
// after it was calculated.
//
// THE BOUNDARY THIS FILE DEFENDS: it consumes a BonusResult and never
// produces one. Efficiency, division pools, per-person shares and the tier
// ladder are computed in lib/bonusTiers from the monthly summaries, and
// nothing here touches them. Excluding someone does NOT change what they
// earned — it records that the earned amount is not being paid.
//
// EXCLUSION DOES NOT REDISTRIBUTE. An excluded share is removed from what
// the company pays out; every other person's figure is byte-identical to
// what it was before. That is deliberate: redistributing would silently
// change what colleagues earned because of an unrelated employment event.
import type {
  BonusPayoutRecord, BonusPayoutMark, BonusMarkState, BonusExcludeReason,
} from '../types';
import type { BonusResult } from './bonusTiers';

export const EXCLUDE_REASONS: { key: BonusExcludeReason; label: string }[] = [
  { key: 'left_before_month_end', label: 'Left before month end' },
  { key: 'not_yet_eligible', label: 'Not yet eligible' },
  { key: 'other', label: 'Other' },
];

export const reasonLabel = (r: BonusExcludeReason | undefined, note?: string): string => {
  if (!r) return '';
  const base = EXCLUDE_REASONS.find(x => x.key === r)?.label || r;
  return r === 'other' && note ? `${base}: ${note}` : base;
};

export const stateOf = (
  rec: BonusPayoutRecord | undefined,
  empId: string,
): BonusMarkState | 'unmarked' => rec?.marks?.[empId]?.state ?? 'unmarked';

export const markOf = (
  rec: BonusPayoutRecord | undefined,
  empId: string,
): BonusPayoutMark | undefined => rec?.marks?.[empId];

// Money is summed in CENTS so a long list of shares can't drift a cent.
const cents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

export interface PayoutTotals {
  // What the bonus calculation produced. NEVER altered by marking.
  calculated: number;
  // The sum of excluded people's calculated shares — withheld, not moved.
  excluded: number;
  // calculated − excluded. What actually goes out.
  toPay: number;
}

export interface PayoutProgress {
  // Rows carrying an actual payout (> $0) — a $0 row can't be "paid".
  payable: number;
  paid: number;
  excluded: number;
  totals: PayoutTotals;
}

export interface PayoutSummary {
  company: PayoutTotals;
  byDivision: Record<string, PayoutTotals>;
  progress: PayoutProgress;
}

// Applies the marks to an already-computed BonusResult. Pure: the input
// result is not mutated and no figure in it is recomputed.
export function summarisePayout(
  result: BonusResult | null | undefined,
  rec: BonusPayoutRecord | undefined,
): PayoutSummary {
  const empty: PayoutTotals = { calculated: 0, excluded: 0, toPay: 0 };
  if (!result) {
    return { company: { ...empty }, byDivision: {}, progress: { payable: 0, paid: 0, excluded: 0, totals: { ...empty } } };
  }

  let calcC = 0;
  let exclC = 0;
  let payable = 0;
  let paidCount = 0;
  let excludedCount = 0;

  for (const p of result.perPerson) {
    const c = cents(p.total);
    calcC += c;
    const st = stateOf(rec, p.empId);
    if (st === 'excluded') {
      exclC += c;
      excludedCount++;
    } else if (c > 0) {
      // Only rows that actually pay something count toward "N of M paid" —
      // otherwise a $0 row would sit unpaid forever and the readout would
      // never reach completion.
      payable++;
      if (st === 'paid') paidCount++;
    }
  }

  const byDivision: Record<string, PayoutTotals> = {};
  for (const d of result.divisions) {
    let dCalc = 0;
    let dExcl = 0;
    for (const pp of d.perPerson) {
      const c = cents(pp.payout);
      dCalc += c;
      if (stateOf(rec, pp.empId) === 'excluded') dExcl += c;
    }
    byDivision[d.division] = {
      calculated: fromCents(dCalc),
      excluded: fromCents(dExcl),
      toPay: fromCents(dCalc - dExcl),
    };
  }

  const company: PayoutTotals = {
    calculated: fromCents(calcC),
    excluded: fromCents(exclC),
    toPay: fromCents(calcC - exclC),
  };
  return {
    company,
    byDivision,
    progress: { payable, paid: paidCount, excluded: excludedCount, totals: company },
  };
}

// The next state when a toggle is tapped: tapping the active state clears it.
export function nextState(
  current: BonusMarkState | 'unmarked',
  tapped: BonusMarkState,
): BonusMarkState | 'unmarked' {
  return current === tapped ? 'unmarked' : tapped;
}

export interface ApplyMarkArgs {
  rec: BonusPayoutRecord | undefined;
  ym: string;
  empId: string;
  empName: string;
  to: BonusMarkState | 'unmarked';
  amount: number;
  reason?: BonusExcludeReason;
  reasonNote?: string;
  by: string;
  byName: string;
  at: number;
}

// Produces the NEW record for a single toggle, with its audit entry appended.
// Append-only: an audit entry is written for every transition including
// clearing, because "who un-marked this as paid" is exactly the question a
// payout dispute asks.
export function applyMark(args: ApplyMarkArgs): BonusPayoutRecord {
  const { rec, ym, empId, empName, to, amount, reason, reasonNote, by, byName, at } = args;
  const from = stateOf(rec, empId);
  const marks: Record<string, BonusPayoutMark> = { ...(rec?.marks || {}) };
  if (to === 'unmarked') {
    delete marks[empId];
  } else {
    marks[empId] = {
      empId,
      empName,
      state: to,
      amountAtMark: amount,
      by,
      byName,
      at,
      ...(to === 'excluded' && reason ? { reason } : {}),
      ...(to === 'excluded' && reason === 'other' && reasonNote ? { reasonNote } : {}),
    };
  }
  const audit = [
    ...(rec?.audit || []),
    {
      at, by, byName, empId, empName, from, to, amount,
      ...(to === 'excluded' && reason ? { reason } : {}),
      ...(to === 'excluded' && reason === 'other' && reasonNote ? { reasonNote } : {}),
    },
  ];
  return { ym, marks, audit };
}

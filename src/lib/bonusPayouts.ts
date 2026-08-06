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
  BonusAmountEdit,
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

export const editOf = (
  rec: BonusPayoutRecord | undefined,
  empId: string,
): BonusAmountEdit | undefined => rec?.edits?.[empId];

// Quick reasons for an adjustment. Free text stays available — unlike
// exclusion (a policy decision with a fixed vocabulary), an adjustment is
// usually one word and occasionally needs its own.
export const AMOUNT_REASONS = ['Rounded up', 'Rounded down', 'Manager discretion'];

// What this person is actually PAID, before the excluded check:
// the adjusted amount when one is set, otherwise the calculated figure.
export function effectiveAmount(
  rec: BonusPayoutRecord | undefined,
  empId: string,
  calculated: number,
): number {
  const e = editOf(rec, empId);
  return e ? e.amount : calculated;
}

// Money is summed in CENTS so a long list of shares can't drift a cent.
const cents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

export interface PayoutTotals {
  // What the bonus calculation produced. NEVER altered by marking or editing.
  calculated: number;
  // The sum of excluded people's calculated shares — withheld, not moved.
  excluded: number;
  // Net effect of adjusted amounts on rows that are actually being paid.
  // Signed: +7.00 means the payout is seven dollars above the calculation.
  adjustments: number;
  // calculated − excluded + adjustments. What actually goes out.
  toPay: number;
}

export interface PayoutProgress {
  // Rows carrying an actual payout (> $0) — a $0 row can't be "paid".
  payable: number;
  paid: number;
  excluded: number;
  edited: number;
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
  const empty: PayoutTotals = { calculated: 0, excluded: 0, adjustments: 0, toPay: 0 };
  if (!result) {
    return {
      company: { ...empty }, byDivision: {},
      progress: { payable: 0, paid: 0, excluded: 0, edited: 0, totals: { ...empty } },
    };
  }

  let calcC = 0;
  let exclC = 0;
  let adjC = 0;
  let payable = 0;
  let paidCount = 0;
  let excludedCount = 0;
  let editedCount = 0;
  // empId → signed adjustment in cents, for proportional division attribution.
  const adjByEmp = new Map<string, number>();

  for (const p of result.perPerson) {
    const c = cents(p.total);
    calcC += c;
    const st = stateOf(rec, p.empId);
    const edit = editOf(rec, p.empId);
    if (edit) editedCount++;
    if (st === 'excluded') {
      // An excluded row pays nothing REGARDLESS of any adjustment. The edit
      // is kept on the record (and shown) but contributes no money.
      exclC += c;
      excludedCount++;
      continue;
    }
    if (edit) {
      const delta = cents(edit.amount) - c;
      adjC += delta;
      adjByEmp.set(p.empId, delta);
    }
    const payC = edit ? cents(edit.amount) : c;
    if (payC > 0) {
      payable++;
      if (st === 'paid') paidCount++;
    }
  }

  const byDivision: Record<string, PayoutTotals> = {};
  for (const d of result.divisions) {
    let dCalc = 0;
    let dExcl = 0;
    let dAdj = 0;
    for (const pp of d.perPerson) {
      const c = cents(pp.payout);
      dCalc += c;
      if (stateOf(rec, pp.empId) === 'excluded') { dExcl += c; continue; }
      // An adjustment is per PERSON; a person can earn across divisions. Split
      // it in proportion to what they earned in each, so the divisions still
      // sum to the company figure. Exact for the single-division case, which
      // is the norm.
      const delta = adjByEmp.get(pp.empId);
      if (delta) {
        const person = result.perPerson.find(x => x.empId === pp.empId);
        const personCalc = person ? cents(person.total) : 0;
        dAdj += personCalc > 0 ? Math.round(delta * (c / personCalc)) :
          // A person with $0 calculated has no proportion to split by — put
          // the whole adjustment on the first division they appear in.
          (person?.byDivision[0]?.division === d.division ? delta : 0);
      }
    }
    byDivision[d.division] = {
      calculated: fromCents(dCalc),
      excluded: fromCents(dExcl),
      adjustments: fromCents(dAdj),
      toPay: fromCents(dCalc - dExcl + dAdj),
    };
  }

  const company: PayoutTotals = {
    calculated: fromCents(calcC),
    excluded: fromCents(exclC),
    adjustments: fromCents(adjC),
    toPay: fromCents(calcC - exclC + adjC),
  };
  return {
    company,
    byDivision,
    progress: {
      payable, paid: paidCount, excluded: excludedCount, edited: editedCount,
      totals: company,
    },
  };
}

export interface ApplyAmountEditArgs {
  rec: BonusPayoutRecord | undefined;
  ym: string;
  empId: string;
  empName: string;
  // null clears the adjustment and returns the row to its calculated figure.
  amount: number | null;
  calculated: number;
  reason?: string;
  by: string;
  byName: string;
  at: number;
}

// Sets or clears an adjusted payout amount. The calculated figure is never
// written over — it is passed in only so the audit and the record can show
// both numbers side by side.
export function applyAmountEdit(args: ApplyAmountEditArgs): BonusPayoutRecord {
  const { rec, ym, empId, empName, amount, calculated, reason, by, byName, at } = args;
  const edits: Record<string, BonusAmountEdit> = { ...(rec?.edits || {}) };
  const before = edits[empId]?.amount ?? calculated;
  if (amount === null) {
    delete edits[empId];
  } else {
    edits[empId] = {
      empId, empName, amount, calculatedAtEdit: calculated,
      by, byName, at,
      ...(reason && reason.trim() ? { reason: reason.trim() } : {}),
    };
  }
  const state = stateOf(rec, empId);
  const audit = [
    ...(rec?.audit || []),
    {
      at, by, byName, empId, empName,
      kind: 'amount' as const,
      from: state, to: state,
      amount: calculated,
      fromAmount: before,
      toAmount: amount === null ? calculated : amount,
      ...(reason && reason.trim() ? { amountReason: reason.trim() } : {}),
    },
  ];
  return { ym, marks: { ...(rec?.marks || {}) }, edits, audit };
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
      at, by, byName, empId, empName, kind: 'state' as const, from, to, amount,
      ...(to === 'excluded' && reason ? { reason } : {}),
      ...(to === 'excluded' && reason === 'other' && reasonNote ? { reasonNote } : {}),
    },
  ];
  return { ym, marks, edits: { ...(rec?.edits || {}) }, audit };
}

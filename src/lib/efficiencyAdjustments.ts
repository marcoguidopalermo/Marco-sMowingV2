// EFFICIENCY ADJUSTMENTS — hours or percentage, with a stated reason.
//
// Applied on READ. Nothing here edits a stored BH or AH figure: the raw
// numbers stay exactly as recorded, the adjustment is resolved when a crew-day
// is rendered or a bonus is computed, and both are shown side by side. That is
// the same contract the 3-man and trainee credits already keep, and this reuses
// their itemized display rather than inventing a second one.
//
// PAY IS UNAFFECTED, without qualification. Pay is computed from time entries
// and the crew-day's own employeeAH; none of this touches either. A crew that
// spends 30 minutes filming is paid for 30 minutes of filming — the adjustment
// only stops those minutes from counting against their efficiency.
import { AdjustmentScope, AdjustmentUnit, EfficiencyAdjustment } from '../types';

export const isLive = (a: EfficiencyAdjustment): boolean => !a.voided;

/** Inclusive on both ends — a one-day adjustment has start === end. */
export const coversDate = (a: EfficiencyAdjustment, date: string): boolean =>
  date >= a.startDate && date <= a.endDate;

/**
 * Does this adjustment apply to this crew-day?
 *
 * Company covers everything; division covers its own; crew covers one. A
 * division adjustment matches on the crew-day's OWN division string, so a crew
 * that moved divisions mid-season is judged by where it worked that day.
 */
export function appliesTo(
  a: EfficiencyAdjustment,
  ctx: { date: string; division?: string; crewId?: string },
): boolean {
  if (!isLive(a) || !coversDate(a, ctx.date)) return false;
  if (a.scope === 'company') return true;
  if (a.scope === 'division') {
    return !!a.division && !!ctx.division
      && a.division.toLowerCase() === ctx.division.toLowerCase();
  }
  return !!a.crewId && a.crewId === ctx.crewId;
}

export interface ResolvedAdjustments {
  /** Signed hours to apply to AH for efficiency only. */
  hours: number;
  /** Signed percentage points to add to adjusted efficiency. */
  pct: number;
  /** Itemized, in the shape creditBreakdown already consumes. */
  hourItems: { label: string; amount: number }[];
  pctItems: { label: string; pct: number }[];
  /** Everything that matched, for tooltips and the audit view. */
  matched: EfficiencyAdjustment[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * ADDITIVE composition. A day carrying a company-wide percentage AND a
 * crew-specific hours removal gets both — they are answering different
 * questions and neither supersedes the other. Two of the same unit simply sum.
 *
 * Ordered narrowest-first (crew, division, company) so the itemization reads
 * from the most specific reason outward, which is how somebody asking "why is
 * this crew at 84%" reads it.
 */
export function resolveAdjustments(
  all: EfficiencyAdjustment[] | undefined,
  ctx: { date: string; division?: string; crewId?: string },
): ResolvedAdjustments {
  const rank: Record<AdjustmentScope, number> = { crew: 0, division: 1, company: 2 };
  const matched = (all || [])
    .filter(a => appliesTo(a, ctx))
    .sort((a, b) => rank[a.scope] - rank[b.scope] || a.createdAt - b.createdAt);
  let hours = 0, pct = 0;
  const hourItems: { label: string; amount: number }[] = [];
  const pctItems: { label: string; pct: number }[] = [];
  for (const a of matched) {
    if (a.unit === 'hours') {
      hours += a.amount;
      hourItems.push({ label: a.reason, amount: a.amount });
    } else {
      pct += a.amount;
      pctItems.push({ label: a.reason, pct: a.amount });
    }
  }
  return { hours: round2(hours), pct: round2(pct), hourItems, pctItems, matched };
}

/**
 * The AH that efficiency is computed against, after hours adjustments.
 * Floors at zero — an adjustment cannot make a crew-day negative-hours, and a
 * removal larger than the day worked is a data-entry error, not a divide by
 * a negative.
 */
export const adjustedAH = (rawAH: number, hoursDelta: number): number =>
  Math.max(0, round2(rawAH + hoursDelta));

// ── TIME BOUNDING ──────────────────────────────────────────────────────────
// Every adjustment has an end date; there is no open-ended form. A seasonal
// correction with no end quietly becomes the baseline, and a year later nobody
// can say whether the number is the crews' or the correction's.

/** Flagged once it has been pushed out twice — the trainee-credit convention. */
export const EXTENSION_FLAG_AT = 2;
export const extensionCount = (a: EfficiencyAdjustment): number =>
  (a.extensions || []).length;
export const isOverExtended = (a: EfficiencyAdjustment): boolean =>
  extensionCount(a) >= EXTENSION_FLAG_AT;

export const spanDays = (a: EfficiencyAdjustment): number => {
  const ms = Date.parse(`${a.endDate}T12:00:00Z`) - Date.parse(`${a.startDate}T12:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) + 1 : 1;
};

export interface AdjustmentDraftError { field: string; message: string }

/** Validation shared by the form and the handler, so both refuse the same things. */
export function validateAdjustment(d: {
  unit: AdjustmentUnit; amount: number; reason: string; scope: AdjustmentScope;
  crewId?: string; division?: string; startDate: string; endDate: string;
}): AdjustmentDraftError | null {
  if (!d.reason || d.reason.trim().length < 3) {
    return { field: 'reason', message: 'A reason is required — it is what makes the number defensible later.' };
  }
  if (!Number.isFinite(d.amount) || d.amount === 0) {
    return { field: 'amount', message: 'Enter an amount other than zero.' };
  }
  if (d.unit === 'percent' && Math.abs(d.amount) > 100) {
    return { field: 'amount', message: 'A percentage adjustment beyond 100 points is almost certainly a typo.' };
  }
  if (d.unit === 'hours' && Math.abs(d.amount) > 24) {
    return { field: 'amount', message: 'An hours adjustment beyond 24 in a day is almost certainly a typo.' };
  }
  if (!d.startDate) return { field: 'startDate', message: 'Pick a start date.' };
  if (!d.endDate) return { field: 'endDate', message: 'Pick an end date — an adjustment cannot run open-ended.' };
  if (d.endDate < d.startDate) {
    return { field: 'endDate', message: 'The end date is before the start date.' };
  }
  if (d.scope === 'crew' && !d.crewId) return { field: 'scope', message: 'Pick a crew.' };
  if (d.scope === 'division' && !d.division) return { field: 'scope', message: 'Pick a division.' };
  return null;
}

// ── ROLLUPS ────────────────────────────────────────────────────────────────
/** Which dates in a range carried any adjustment — so a month reads both ways. */
export function datesWithAdjustments(
  all: EfficiencyAdjustment[] | undefined, dates: string[],
  ctx?: { division?: string },
): Set<string> {
  const out = new Set<string>();
  for (const d of dates) {
    const hit = (all || []).some(a => appliesTo(a, { date: d, division: ctx?.division }))
      || (all || []).some(a => isLive(a) && coversDate(a, d) && a.scope === 'crew');
    if (hit) out.add(d);
  }
  return out;
}

/** "30 min removed from your crew's hours for filming — this improves your efficiency." */
export function adjustmentNotice(a: EfficiencyAdjustment): { title: string; body: string } {
  const helping = a.unit === 'hours' ? a.amount < 0 : a.amount > 0;
  const mag = Math.abs(a.amount);
  const amountText = a.unit === 'hours'
    ? (mag < 1 ? `${Math.round(mag * 60)} min` : `${mag} hr${mag === 1 ? '' : 's'}`)
    : `${mag}%`;
  const verb = a.unit === 'hours'
    ? (a.amount < 0 ? 'removed from' : 'added to')
    : (a.amount > 0 ? 'added to' : 'removed from');
  const what = a.unit === 'hours' ? "your crew's hours" : "your crew's efficiency";
  const scopeText = a.scope === 'company' ? 'company-wide'
    : a.scope === 'division' ? `${a.division} division` : (a.crewLabel || 'your crew');
  return {
    // Never the word "deduction". This is usually a correction in the crew's
    // favour, and calling it a deduction would make somebody defend work they
    // were asked to do.
    title: `Efficiency adjustment · ${scopeText}`,
    body: `${amountText} ${verb} ${what} for ${a.reason.trim()} — this `
      + `${helping ? 'improves' : 'lowers'} your efficiency. Your pay is unchanged; `
      + 'you are paid for every minute worked.',
  };
}

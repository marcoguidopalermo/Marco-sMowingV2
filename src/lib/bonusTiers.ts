// Bonus tier ladder + payout math. PAY-CRITICAL DISCIPLINE: this module only
// does tier lookup + arithmetic. Every efficiency % and BH figure it consumes
// comes from a MonthlySummary (buildDivisionMtd / monthlySummaries) — the
// single shared source crews and admins already see. Nothing here re-derives
// efficiency or BH.
import { BonusTier, MonthlySummary } from '../types';

// STANDARD ladder ($/BH by division adjusted %). Below the lowest threshold
// pays $0; >100% pays $5 (no cap). This is THE official structure — changing
// it is a code change (the in-page sandbox editor is ephemeral only).
export const STANDARD_BONUS_TIERS: BonusTier[] = [
  { minPct: 75, rate: 0.50 },
  { minPct: 80, rate: 1 },
  { minPct: 85, rate: 2 },
  { minPct: 90, rate: 3 },
  { minPct: 95, rate: 4 },
  { minPct: 100, rate: 5 },
];

// $/BH rate for a division's adjusted %. Floor semantics: the highest tier
// whose threshold is <= pct. null (no AH) or below the lowest tier → $0.
export function rateForPct(pct: number | null | undefined, tiers: BonusTier[]): number {
  if (pct == null) return 0;
  const sorted = [...tiers].sort((a, b) => a.minPct - b.minPct);
  let rate = 0;
  for (const t of sorted) if (pct >= t.minPct) rate = t.rate;
  return rate;
}

// Distance to the next tier up + the rate it would pay — for the projection
// "1.2% from $2/BH" hint. null when already at/above the top tier or pct null.
export function nextTier(
  pct: number | null | undefined,
  tiers: BonusTier[],
): { gap: number; rate: number; minPct: number } | null {
  if (pct == null) return null;
  const sorted = [...tiers].sort((a, b) => a.minPct - b.minPct);
  for (const t of sorted) {
    if (pct < t.minPct) return { gap: Number((t.minPct - pct).toFixed(1)), rate: t.rate, minPct: t.minPct };
  }
  return null;
}

export interface BonusDivisionResult {
  division: string;
  adjustedEff: number | null;
  rate: number;
  bh: number;
  pool: number;   // = rate × divisionBH, rounded to cents; per-person sums to this
  perPerson: { empId: string; name: string; bh: number; payout: number }[];
}
export interface BonusPersonResult {
  empId: string;
  name: string;
  total: number;
  byDivision: { division: string; bh: number; rate: number; payout: number }[];
}
export interface BonusResult {
  divisions: BonusDivisionResult[];
  perPerson: BonusPersonResult[];
  companyTotal: number;
}

// Largest-remainder apportionment: floor each raw cent value, then hand out
// the leftover cents to the largest fractional remainders so the parts sum to
// `targetCents` EXACTLY.
function largestRemainderCents(raw: number[], targetCents: number): number[] {
  const floor = raw.map(c => Math.floor(c));
  let distributed = floor.reduce((s, c) => s + c, 0);
  let remaining = targetCents - distributed;
  const cents = floor.slice();
  if (remaining > 0) {
    const order = raw
      .map((c, i) => ({ i, frac: c - Math.floor(c) }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < order.length && remaining > 0; k++) { cents[order[k].i]++; remaining--; }
  } else if (remaining < 0) {
    // Floor can't overshoot a non-negative target, but guard anyway: pull
    // cents from the smallest remainders.
    const order = raw
      .map((c, i) => ({ i, frac: c - Math.floor(c) }))
      .sort((a, b) => a.frac - b.frac);
    for (let k = 0; k < order.length && remaining < 0; k++) { if (cents[order[k].i] > 0) { cents[order[k].i]--; remaining++; } }
  }
  return cents;
}

// Per-person payouts = Σ over divisions of (their BH in that division × that
// division's tier rate). Per-person amounts sum to each division's pool
// exactly (largest-remainder cents); company total = Σ pools.
export function computeBonus(summary: MonthlySummary, tiers: BonusTier[]): BonusResult {
  const divisions: BonusDivisionResult[] = [];
  const personMap: Record<string, { name: string; total: number; byDivision: BonusPersonResult['byDivision'] }> = {};

  for (const d of summary.divisions) {
    const rate = rateForPct(d.adjustedEff, tiers);
    const poolTargetCents = Math.round(d.bh * rate * 100);
    const people = (d.perEmployee || []).filter(p => p.bh > 0);
    const rawCents = people.map(p => p.bh * rate * 100);
    const cents = largestRemainderCents(rawCents, poolTargetCents);
    const perPerson = people.map((p, idx) => ({ empId: p.empId, name: p.name, bh: p.bh, payout: cents[idx] / 100 }));
    const pool = poolTargetCents / 100;
    divisions.push({ division: d.division, adjustedEff: d.adjustedEff, rate, bh: d.bh, pool, perPerson });
    for (const pp of perPerson) {
      if (!personMap[pp.empId]) personMap[pp.empId] = { name: pp.name, total: 0, byDivision: [] };
      personMap[pp.empId].total += pp.payout;
      if (pp.payout > 0 || rate > 0) {
        personMap[pp.empId].byDivision.push({ division: d.division, bh: pp.bh, rate, payout: pp.payout });
      }
    }
  }

  const perPerson = Object.entries(personMap)
    .map(([empId, v]) => ({ empId, name: v.name, total: Number(v.total.toFixed(2)), byDivision: v.byDivision }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const companyTotal = Number(divisions.reduce((s, d) => s + d.pool, 0).toFixed(2));
  return { divisions, perPerson, companyTotal };
}

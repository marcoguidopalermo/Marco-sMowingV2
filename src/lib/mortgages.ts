// MORTGAGES — reference data for renewal planning.
//
// No payments, no ledger, no amortisation schedule: the same restraint the
// tenancy layer keeps. What this exists for is the RENEWAL DATE, because a
// renewal has to be shopped well before it lands, and a term that quietly
// rolls over at the lender's posted rate is expensive in a way nothing else
// here is.
//
// ACCESS is Marco and Tony, enforced by a firestore rule on a top-level
// collection rather than by hiding a panel. Lender, balance and rate are not
// operational data, and the property manager and the contractor both read the
// property record.
import { ContractingMortgage } from '../types';
import { CountdownLevel, ymdToMs } from './propertyMgmt';

// Longer lead than a lease: 60 days is enough to re-let a unit, and nowhere
// near enough to shop a mortgage, get an approval and move a charge.
export const RENEWAL_AMBER_DAYS = 120;

// The two people who may see mortgage terms. Deliberately NOT `isAdmin`: Dave
// and James are admins too, and this is narrower than admin by intent. Widening
// it is adding an address here — and to the matching firestore rule, which is
// what actually enforces it.
export const MORTGAGE_VIEWERS = [
  'marcoguidopalermo@gmail.com',
  'anthonypalermo23@hotmail.com',
];

export const canSeeMortgages = (email: string | null | undefined): boolean =>
  MORTGAGE_VIEWERS.includes((email || '').trim().toLowerCase());

const DAY = 86_400_000;

export interface RenewalCountdown {
  endYmd?: string;
  endMs: number;
  daysLeft?: number;
  level: CountdownLevel;
  label: string;
}

export function renewalCountdown(m: ContractingMortgage, nowMs: number): RenewalCountdown {
  if (!m.termEnd) {
    return { endMs: Infinity, level: 'neutral', label: 'no renewal date set' };
  }
  const start = new Date(nowMs); start.setHours(0, 0, 0, 0);
  const endMs = ymdToMs(m.termEnd);
  const daysLeft = Math.round((endMs - start.getTime()) / DAY);
  const level: CountdownLevel = daysLeft <= 0 ? 'red'
    : daysLeft <= RENEWAL_AMBER_DAYS ? 'amber' : 'neutral';
  return {
    endYmd: m.termEnd, endMs, daysLeft, level,
    label: daysLeft <= 0
      ? 'past renewal — term has rolled'
      : `${daysLeft} day${daysLeft === 1 ? '' : 's'} until renewal`,
  };
}

export const mortgagesForProperty = (
  all: ContractingMortgage[] | undefined, propertyId: string,
): ContractingMortgage[] =>
  (all || []).filter(m => m.propertyId === propertyId)
    .sort((a, b) => (a.termEnd || '9999').localeCompare(b.termEnd || '9999'));

// ── THE ROLLUP ─────────────────────────────────────────────────────────────
export interface MortgageRollup {
  count: number;
  totalBalance: number;
  totalPrincipal: number;
  /**
   * Weighted by CURRENT BALANCE, not a plain mean: a 2% rate on $80k and a 7%
   * rate on $800k do not average to 4.5% in any sense that matters. Mortgages
   * with no balance or no rate are excluded from the weighting rather than
   * counted as zero, which would drag it down and read as good news.
   */
  weightedRate: number | null;
  /** How much balance the weighted rate actually covers — honesty about the gap. */
  ratedBalance: number;
  /** Renewals inside the next 12 months, soonest first. */
  renewals: { mortgage: ContractingMortgage; countdown: RenewalCountdown }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function mortgageRollup(
  all: ContractingMortgage[] | undefined, nowMs: number,
): MortgageRollup {
  const list = all || [];
  let totalBalance = 0, totalPrincipal = 0, ratedBalance = 0, weightedSum = 0;
  for (const m of list) {
    const bal = Number(m.currentBalance) || 0;
    totalBalance += bal;
    totalPrincipal += Number(m.principal) || 0;
    const rate = Number(m.rate);
    if (bal > 0 && Number.isFinite(rate) && rate > 0) {
      ratedBalance += bal;
      weightedSum += bal * rate;
    }
  }
  const horizon = nowMs + 365 * DAY;
  const renewals = list
    .map(m => ({ mortgage: m, countdown: renewalCountdown(m, nowMs) }))
    .filter(r => Number.isFinite(r.countdown.endMs) && r.countdown.endMs <= horizon)
    .sort((a, b) => a.countdown.endMs - b.countdown.endMs);
  return {
    count: list.length,
    totalBalance: round2(totalBalance),
    totalPrincipal: round2(totalPrincipal),
    weightedRate: ratedBalance > 0 ? round2(weightedSum / ratedBalance) : null,
    ratedBalance: round2(ratedBalance),
    renewals,
  };
}

// ── AUDIT ──────────────────────────────────────────────────────────────────
// Field-level, because "edited the mortgage" answers nothing when somebody is
// reconciling a balance against a statement. Only fields that actually moved.
const AUDITED_FIELDS: (keyof ContractingMortgage)[] = [
  'lender', 'principal', 'currentBalance', 'rate', 'rateType',
  'termStart', 'termEnd', 'amortizationYears', 'paymentAmount',
  'paymentFrequency', 'notes',
];

export function mortgageAuditDiff(
  before: ContractingMortgage | undefined,
  after: ContractingMortgage,
  at: number,
  by: string,
): NonNullable<ContractingMortgage['audit']> {
  const out: NonNullable<ContractingMortgage['audit']> = [];
  for (const f of AUDITED_FIELDS) {
    const a = before ? before[f] : undefined;
    const b = after[f];
    if (String(a ?? '') === String(b ?? '')) continue;
    out.push({
      at, by, field: String(f),
      from: before === undefined ? '(new)' : String(a ?? ''),
      to: String(b ?? ''),
    });
  }
  return out;
}

// SHARED DRIVEWAYS AND MULTI-DRIVEWAY PROPERTIES.
//
// Two cases that both take $100 off per driveway and are otherwise nothing
// alike. Keeping them apart is the whole point of this module.
//
// ── 1. SHARED DRIVEWAY — two clients, one physical driveway ────────────────
// We clear it once and bill two people, so each pays $100 less. TWO QUOTE
// RECORDS, linked: two clients, two contracts, two properties, two sets of
// liability. Merging them into one record would model a relationship that does
// not exist — neither client is party to the other's contract, and either can
// leave without the other.
//
// THE DISCOUNT IS CONDITIONAL. It is a discount for sharing the cost, so it is
// only true while both are paying. If one signs and the other does not, we are
// clearing the whole driveway for one payer and would be giving them $100 off
// for the privilege. So:
//
//   pending    neither signed        show the discount, do NOT apply it
//   one-sided  exactly one signed    do NOT apply, and FLAG it
//   active     both signed           apply it, to both
//
// It is also RETROACTIVE by construction: nothing is stored as "discount
// applied", only the pair's state. The moment the second signs, the state
// becomes active and both prices carry the discount — no back-dating, no
// reissue, and nothing to forget.
//
// ── 2. TWO DRIVEWAYS, ONE PROPERTY — one client ────────────────────────────
// One trip, one contract, one payer. $100 off each driveway, UNCONDITIONAL:
// there is only one party, so there is nothing for the discount to depend on.
// ONE quote record holding both driveways.
import type { SnowQuote } from '../types';

/** Which shape a quote is. Absent/unknown reads as a plain single driveway. */
export type DrivewayMode = 'single' | 'shared' | 'multi';

export type SharedPairState =
  | 'unpaired'    // no partner recorded
  | 'pending'     // neither side signed
  | 'one-sided'   // exactly one signed — needs attention
  | 'active';     // both signed — the discount is real

export interface SharedPairing {
  state: SharedPairState;
  /** True only when the discount may be applied to the price. */
  discountApplies: boolean;
  /** True when somebody should look at this pair. */
  needsAttention: boolean;
  thisSigned: boolean;
  partnerSigned: boolean;
  partnerAddress: string;
  message: string;
}

export const isSigned = (q: Pick<SnowQuote, 'signedAt'> | null | undefined): boolean =>
  !!q && typeof q.signedAt === 'number' && q.signedAt > 0;

export function drivewayMode(q: Pick<SnowQuote, 'sharedDrivewayWith' | 'driveways'> | null | undefined): DrivewayMode {
  if (q?.sharedDrivewayWith?.quoteId) return 'shared';
  if ((q?.driveways?.length || 0) > 1) return 'multi';
  return 'single';
}

/**
 * Resolve a shared pair's state from both records.
 * @param {SnowQuote} quote The quote being priced or displayed.
 * @param {SnowQuote|null} partner The paired quote, if it is loaded.
 * @return {SharedPairing} State, whether the discount applies, and why.
 */
export function sharedPairing(
  quote: SnowQuote,
  partner: SnowQuote | null | undefined,
): SharedPairing {
  const link = quote.sharedDrivewayWith;
  const partnerAddress = link?.address || partner?.address || '';
  if (!link?.quoteId) {
    return {
      state: 'unpaired', discountApplies: false, needsAttention: false,
      thisSigned: isSigned(quote), partnerSigned: false, partnerAddress: '',
      message: 'Not paired with another property.',
    };
  }
  const a = isSigned(quote);
  const b = isSigned(partner);
  if (a && b) {
    return {
      state: 'active', discountApplies: true, needsAttention: false,
      thisSigned: a, partnerSigned: b, partnerAddress,
      message: `Both properties under contract — the $100 shared-driveway discount applies.`,
    };
  }
  if (a !== b) {
    // The dangerous one. Whichever side signed is being cleared in full for a
    // single payer, so the discount must NOT be applied and somebody has to
    // know. Named explicitly rather than folded in with "pending".
    return {
      state: 'one-sided', discountApplies: false, needsAttention: true,
      thisSigned: a, partnerSigned: b, partnerAddress,
      message: a
        ? `Signed, but ${partnerAddress || 'the paired property'} has NOT signed. `
          + 'The discount is withheld — we would be clearing the whole driveway for one payer. '
          + 'It applies automatically the moment they sign.'
        : `${partnerAddress || 'The paired property'} has signed and this one has not. `
          + 'Neither side has the discount until both are under contract.',
    };
  }
  return {
    state: 'pending', discountApplies: false, needsAttention: false,
    thisSigned: a, partnerSigned: b, partnerAddress,
    message: 'Pending — the $100 discount applies once both properties are under contract.',
  };
}

/** The sentence a contract should carry for a shared driveway. */
export function sharedDrivewayClause(partnerAddress: string): string {
  const who = partnerAddress.trim() || 'the adjoining property';
  return `Shared driveway with ${who}. $100 shared-driveway discount applies `
    + 'while both properties are under contract.';
}

/** Every pair needing attention, for the flag surface. */
export function unpairedSignings(quotes: SnowQuote[]): {
  quote: SnowQuote; pairing: SharedPairing;
}[] {
  const byId = new Map(quotes.map(q => [q.id, q]));
  const out: { quote: SnowQuote; pairing: SharedPairing }[] = [];
  for (const q of quotes) {
    if (!q.sharedDrivewayWith?.quoteId) continue;
    const p = sharedPairing(q, byId.get(q.sharedDrivewayWith.quoteId) || null);
    if (p.needsAttention) out.push({ quote: q, pairing: p });
  }
  return out;
}

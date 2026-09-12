// SHARED DRIVEWAYS AND MULTI-DRIVEWAY PROPERTIES.
//
// Two cases that both take a flat per-driveway discount and are otherwise
// nothing alike. Keeping them apart is the whole point of this module.
//
// ── 1. SHARED DRIVEWAY — two clients, one physical driveway ────────────────
// We clear it once and bill two people, so each pays the discount less. TWO
// QUOTE RECORDS, linked: two clients, two contracts, two properties, two sets
// of liability. Merging them into one record would model a relationship that does
// not exist — neither client is party to the other's contract, and either can
// leave without the other.
//
// THE DISCOUNT IS CONDITIONAL, AND THE CONDITION IS CARRIED BY THE CONTRACT,
// NOT BY THE PRICE.
//
// A quote is what a client is shown, so it shows the price they would actually
// pay, with the discount in it. "Discount not applied — pending both
// contracts" is an internal state and does not belong in front of a customer.
//
// The condition is still real, and it lives in two places:
//   1. THE CONTRACT WORDING — "<rate> shared-driveway discount applies while
//      both properties are under contract" (sharedDrivewayClause, which takes
//      the rate so the paper names what was quoted). That is what makes it
//      enforceable.
//   2. THE FLAG on the saved-quotes list — every pair where one side is under
//      contract and the other is not (unpairedSignings).
//
// Note what this trades. Because the price is no longer withheld, a one-sided
// pair means we ARE currently giving the discount to a single payer whose
// driveway we clear in full. That is a deliberate choice — the alternative put
// internal state on a customer's quote — but it makes the flag the thing that
// protects the money, rather than a convenience. It is the only guard left.
//
// The pair state below is therefore used for the FLAG, not for pricing.
//
// BOTH AMOUNTS LIVE IN THE RATE SHEET (SnowConfig.SHARED_DRIVEWAY and
// SECOND_DRIVEWAY), as two separate rates. They are the same number today and
// cover different things, so they can move apart without a code change. No
// figure is written into this file — anything here that named one would be the
// copy that goes stale.
//
// ── 2. TWO DRIVEWAYS, ONE PROPERTY — one client ────────────────────────────
// One trip, one contract, one payer. The second-driveway discount off each,
// UNCONDITIONAL: there is only one party, so there is nothing for the discount
// to depend on. ONE quote record holding both driveways.
import type { SnowContract, SnowContractStatus, SnowQuote } from '../types';

/** Which shape a quote is. Absent/unknown reads as a plain single driveway. */
export type DrivewayMode = 'single' | 'shared' | 'multi';

export type SharedPairState =
  | 'unpaired'    // no partner recorded
  | 'pending'     // neither side signed
  | 'one-sided'   // exactly one signed — needs attention
  | 'active';     // both signed — the discount is real

export interface SharedPairing {
  state: SharedPairState;
  // Whether BOTH sides are under contract. No longer gates the price — the
  // quote always shows the discount — but it is what the flag is built on.
  discountApplies: boolean;
  /** True when somebody should look at this pair. */
  needsAttention: boolean;
  thisSigned: boolean;
  partnerSigned: boolean;
  partnerAddress: string;
  message: string;
}

// WHICH CONTRACT STATES COUNT AS "under contract". Defined once, here, so
// changing what counts is a one-line change rather than a hunt. 'approved' is
// the client having agreed; 'booked' is it being on the schedule. Both mean the
// property is paying, which is what the shared discount depends on.
export const UNDER_CONTRACT: SnowContractStatus[] = ['approved', 'booked'];

export const contractIsUnderContract = (c: SnowContract | null | undefined): boolean =>
  !!c && UNDER_CONTRACT.includes(c.status);

/**
 * Is this quote's property under contract? Read from the CONTRACT, never from
 * the quote — the quote holds only a pointer. A quote with no linked contract,
 * or a link to a contract that is not loaded, reads as NOT under contract:
 * the safe answer, because it withholds the discount rather than granting one.
 * @param {SnowQuote} q The quote.
 * @param {Record<string, SnowContract>} contracts Contracts by id.
 * @return {boolean} Whether it is under contract.
 */
export function isSigned(
  q: Pick<SnowQuote, 'contractId'> | null | undefined,
  contracts?: Record<string, SnowContract> | null,
): boolean {
  const id = q?.contractId;
  if (!id) return false;
  return contractIsUnderContract(contracts?.[id]);
}

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
  contracts?: Record<string, SnowContract> | null,
): SharedPairing {
  const link = quote.sharedDrivewayWith;
  const partnerAddress = link?.address || partner?.address || '';
  if (!link?.quoteId) {
    return {
      state: 'unpaired', discountApplies: false, needsAttention: false,
      thisSigned: isSigned(quote, contracts), partnerSigned: false, partnerAddress: '',
      message: 'Not paired with another property.',
    };
  }
  const a = isSigned(quote, contracts);
  const b = isSigned(partner, contracts);
  if (a && b) {
    return {
      state: 'active', discountApplies: true, needsAttention: false,
      thisSigned: a, partnerSigned: b, partnerAddress,
      message: 'Both properties under contract — the shared-driveway discount applies.',
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
          + 'The quoted price already has the shared-driveway discount in it, so we are '
          + 'clearing the whole driveway for one payer at the shared rate. '
          + 'Get the second signature or re-price this side.'
        : `${partnerAddress || 'The paired property'} has signed and this one has not. `
          + 'Their price already has the shared-driveway discount in it, so the pair is '
          + 'short a payer until this side is under contract too.',
    };
  }
  return {
    state: 'pending', discountApplies: false, needsAttention: false,
    thisSigned: a, partnerSigned: b, partnerAddress,
    message: 'Pending — the shared-driveway discount holds once both properties are under contract.',
  };
}

/**
 * The sentence a contract should carry for a shared driveway.
 *
 * THE RATE IS A PARAMETER, not a literal. This string is the enforceable half
 * of the whole arrangement — it is what makes the discount conditional rather
 * than a gift — so it has to name the amount actually quoted. Hardcoded, the
 * first rate-sheet change would have printed "$100" on a contract carrying a
 * different discount, and the paper is what gets argued over.
 *
 * Callers pass the rate from the quote's OWN config version (sharedDrivewayRate
 * of the resolved config), never the live one, so reopening an old quote
 * reproduces the clause it was sent with.
 * @param {string} partnerAddress The paired property.
 * @param {number} rate The shared-driveway discount, in dollars.
 * @return {string} The clause.
 */
export function sharedDrivewayClause(partnerAddress: string, rate: number): string {
  const who = partnerAddress.trim() || 'the adjoining property';
  const amount = `$${(Number(rate) || 0).toLocaleString('en-US')}`;
  return `Shared driveway with ${who}. ${amount} shared-driveway discount applies `
    + 'while both properties are under contract.';
}

/**
 * The sentence a SHARED driveway's contract should carry about premium.
 *
 * Premium is priority response on the VISIT, and a shared driveway is one
 * visit. So the driveway carries one premium charge and each client pays a
 * share of it — which the contract has to say, because "$100 premium" on a
 * page by itself reads as this property's own premium, and the client who
 * later sees the other side's contract for another $100 has been told the
 * wrong thing.
 *
 * ALL-OR-NOTHING is stated here too. You cannot give half a driveway priority
 * response; if one side takes premium and the other does not, there is no
 * coherent service to deliver. The wording makes that a term rather than an
 * operational surprise.
 *
 * The amounts are PARAMETERS, like the discount rate in sharedDrivewayClause
 * and for the same reason: this is the enforceable copy, so it has to name what
 * was actually quoted, and callers pass them from the quote's OWN config
 * version.
 * @param {number} share This property's part of the premium.
 * @param {number} total The single premium charge for the driveway.
 * @return {string} The clause.
 */
export function sharedPremiumClause(share: number, total: number): string {
  const usd = (n: number) => `$${(Number(n) || 0).toLocaleString('en-US')}`;
  const part = share * 2 === total ? ', which is half of that' : '';
  return `Premium service is ${usd(total)} for the shared driveway, cleared once to `
    + `the premium standard. This property's share is ${usd(share)}${part}. `
    + 'Premium applies to the whole driveway or to neither property — both '
    + 'properties must take premium for it to be in effect.';
}

/** Every pair needing attention, for the flag surface. */
export function unpairedSignings(
  quotes: SnowQuote[],
  contracts?: Record<string, SnowContract> | null,
): { quote: SnowQuote; pairing: SharedPairing }[] {
  const byId = new Map(quotes.map(q => [q.id, q]));
  const out: { quote: SnowQuote; pairing: SharedPairing }[] = [];
  for (const q of quotes) {
    if (!q.sharedDrivewayWith?.quoteId) continue;
    const p = sharedPairing(q, byId.get(q.sharedDrivewayWith.quoteId) || null, contracts);
    if (p.needsAttention) out.push({ quote: q, pairing: p });
  }
  return out;
}

/**
 * Both properties of a shared driveway, for display on the record and anywhere
 * the quote is shown. A shared quote that names only one of the two properties
 * is a quote you cannot match to the driveway it is for.
 * @param {SnowQuote} q The quote.
 * @return {string[]} One address for an ordinary quote, two for a shared one.
 */
export function quoteAddresses(q: Pick<SnowQuote, 'address' | 'name' | 'client' | 'sharedDrivewayWith'>): string[] {
  const own = (q.address || q.client || q.name || '').trim();
  const other = (q.sharedDrivewayWith?.address || '').trim();
  return [own, other].filter(Boolean);
}

/**
 * The one way two properties are joined for display. Shared by the saved
 * record and by the live quote header — which reads its two addresses out of
 * the form rather than off a quote, and so cannot call quoteAddressLine. One
 * separator in one place means the two surfaces cannot drift apart.
 * @param {string[]} addresses The addresses, blanks already tolerated.
 * @return {string} "10 Elm St + 12 Elm St", or just the one address.
 */
export const addressLine = (addresses: string[]): string =>
  addresses.map(a => a.trim()).filter(Boolean).join('  +  ');

/** "10 Elm St + 12 Elm St", or just the one address. */
export const quoteAddressLine = (
  q: Pick<SnowQuote, 'address' | 'name' | 'client' | 'sharedDrivewayWith'>,
): string => addressLine(quoteAddresses(q));

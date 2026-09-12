// Shared driveways and multi-driveway properties.
//   npm test -- snowDriveways
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  sharedPairing, drivewayMode, isSigned, sharedDrivewayClause, unpairedSignings,
  UNDER_CONTRACT, contractIsUnderContract, quoteAddresses, quoteAddressLine,
  addressLine,
} from './snowDriveways';
import { priceSnow, SNOW_CONFIG_V1, activeModifiers } from './snowPricing';

const q = (o: any = {}) => ({
  id: 'q1', name: 'A', gridRows: ['11'], lanes: 2, depth: 1, cars: 2, dragCount: 0,
  tier: 1, basePrice: 599, premium: false, busyRoad: false, danger: 0,
  total: 599, isCustom: false, pricingConfigVersion: 'snow-v1', ...o,
} as any);
const link = (id: string, addr: string) => ({ quoteId: id, address: addr, pairId: 'pair-1' });
// Contracts are the ONLY source of truth about being under contract; a quote
// merely points at one.
const contracts = (m: Record<string, string>) => Object.fromEntries(
  Object.entries(m).map(([id, status]) => [id, { id, status } as any]),
);

console.log('\nWhich shape is this quote?');
test('the three modes are distinguishable', () => {
  assert.equal(drivewayMode(q()), 'single');
  assert.equal(drivewayMode(q({ sharedDrivewayWith: link('q2', '12 Elm') })), 'shared');
  assert.equal(drivewayMode(q({ driveways: [{}, {}] })), 'multi');
  assert.equal(drivewayMode(q({ driveways: [{}] })), 'single', 'one driveway is not multi');
  assert.equal(drivewayMode(null), 'single');
});

console.log('\nSHARED: the discount is conditional on BOTH being signed');
test('neither under contract → pending, discount NOT applied', () => {
  const p = sharedPairing(q({ sharedDrivewayWith: link('q2', '12 Elm') }), q({ id: 'q2' }), {});
  assert.equal(p.state, 'pending');
  assert.equal(p.discountApplies, false);
  assert.equal(p.needsAttention, false);
  assert.match(p.message, /once both properties are under contract/);
});
test('both under contract → active, discount applies', () => {
  const p = sharedPairing(
    q({ sharedDrivewayWith: link('q2', '12 Elm'), contractId: 'c1' }),
    q({ id: 'q2', contractId: 'c2' }),
    contracts({ c1: 'booked', c2: 'approved' }),
  );
  assert.equal(p.state, 'active');
  assert.equal(p.discountApplies, true);
  assert.equal(p.needsAttention, false);
});
test('THE DANGEROUS CASE: one signed → flagged, and named as live exposure', () => {
  const p = sharedPairing(
    q({ sharedDrivewayWith: link('q2', '12 Elm'), contractId: 'c1' }),
    q({ id: 'q2' }),
    contracts({ c1: 'booked' }),
  );
  assert.equal(p.state, 'one-sided');
  assert.equal(p.discountApplies, false, 'both sides are NOT under contract');
  assert.equal(p.needsAttention, true);
  assert.match(p.message, /12 Elm has NOT signed/);
  // It must NOT say the discount is withheld or that it resolves itself. The
  // quote already showed the client the discounted price, so this is money out
  // the door until somebody acts.
  assert.ok(!/withheld/i.test(p.message), 'nothing is withheld any more');
  assert.ok(!/automatically/i.test(p.message), 'it does not resolve itself');
  assert.match(p.message, /Get the second signature or re-price/);
});
test('no pairing message names a dollar figure — the rate lives in the sheet', () => {
  // These strings have no config, so a figure in one is a copy that goes stale
  // the first time the rate sheet moves. The price surfaces name the amount.
  const cases = [
    sharedPairing(q({ sharedDrivewayWith: link('q2', '12 Elm'), contractId: 'c1' }),
      q({ id: 'q2', contractId: 'c2' }), contracts({ c1: 'booked', c2: 'booked' })),
    sharedPairing(q({ sharedDrivewayWith: link('q2', '12 Elm'), contractId: 'c1' }),
      q({ id: 'q2' }), contracts({ c1: 'booked' })),
    sharedPairing(q({ sharedDrivewayWith: link('q2', '12 Elm') }), q({ id: 'q2' }), contracts({})),
  ];
  for (const p of cases) assert.ok(!/\$/.test(p.message), `no $ in: ${p.message}`);
});
test('the unsigned side of a one-sided pair is also flagged, worded from its side', () => {
  const p = sharedPairing(
    q({ id: 'q2', sharedDrivewayWith: link('q1', '10 Elm') }),
    q({ id: 'q1', contractId: 'c1' }),
    contracts({ c1: 'booked' }),
  );
  assert.equal(p.state, 'one-sided');
  assert.equal(p.discountApplies, false);
  assert.match(p.message, /10 Elm has signed and this one has not/);
});
test('RETROACTIVE by construction — nothing stores "applied"', () => {
  const mine = q({ sharedDrivewayWith: link('q2', '12 Elm'), contractId: 'c1' });
  const other = q({ id: 'q2', contractId: 'c2' });
  const before = contracts({ c1: 'booked', c2: 'sent' });
  assert.equal(sharedPairing(mine, other, before).discountApplies, false);
  // The partner's CONTRACT moves to booked. Same quote records, untouched.
  const after = contracts({ c1: 'booked', c2: 'booked' });
  assert.equal(sharedPairing(mine, other, after).discountApplies, true);
});
test('and it reverses too — a contract backing out withdraws the discount', () => {
  // The reason the quote must not keep its own copy of "signed".
  const mine = q({ sharedDrivewayWith: link('q2', '12 Elm'), contractId: 'c1' });
  const other = q({ id: 'q2', contractId: 'c2' });
  assert.equal(sharedPairing(mine, other, contracts({ c1: 'booked', c2: 'booked' })).discountApplies, true);
  assert.equal(sharedPairing(mine, other, contracts({ c1: 'booked', c2: 'declined' })).discountApplies, false);
});
test('a partner that is not loaded reads as unsigned, never as signed', () => {
  const p = sharedPairing(q({ sharedDrivewayWith: link('q2', '12 Elm'), contractId: 'c1' }), null, contracts({ c1: 'booked' }));
  assert.equal(p.discountApplies, false, 'absence of evidence is not a signature');
});
test('an unpaired quote is not flagged', () => {
  const p = sharedPairing(q({ contractId: 'c1' }), null, contracts({ c1: 'booked' }));
  assert.equal(p.state, 'unpaired');
  assert.equal(p.needsAttention, false);
});
test('isSigned reads the CONTRACT, never the quote', () => {
  const cs = contracts({ c1: 'booked', c2: 'sent', c3: 'declined', c4: 'approved' });
  assert.equal(isSigned({ contractId: 'c1' }, cs), true);
  assert.equal(isSigned({ contractId: 'c4' }, cs), true, 'approved counts');
  assert.equal(isSigned({ contractId: 'c2' }, cs), false, 'sent is not signed');
  assert.equal(isSigned({ contractId: 'c3' }, cs), false);
});
test('no link, or a link to a contract that is not loaded, is NOT signed', () => {
  // The safe answer: it withholds a discount rather than granting one.
  assert.equal(isSigned({}, contracts({ c1: 'booked' })), false);
  assert.equal(isSigned({ contractId: 'missing' }, contracts({ c1: 'booked' })), false);
  assert.equal(isSigned({ contractId: 'c1' }, null), false);
  assert.equal(isSigned(null, null), false);
});
test('which statuses count is stated in ONE place', () => {
  assert.deepEqual([...UNDER_CONTRACT].sort(), ['approved', 'booked']);
  for (const st of ['quoted', 'sent', 'declined', 'expired'] as const) {
    assert.equal(contractIsUnderContract({ status: st } as any), false, st);
  }
});

console.log('\nThe flag surface lists every pair needing attention');
test('one-sided pairs surface, matched pairs do not', () => {
  const all = [
    q({ id: 'a', sharedDrivewayWith: link('b', '12 Elm'), contractId: 'ca' }),
    q({ id: 'b', sharedDrivewayWith: link('a', '10 Elm') }),
    q({ id: 'c', sharedDrivewayWith: link('d', '3 Oak'), contractId: 'cc' }),
    q({ id: 'd', sharedDrivewayWith: link('c', '1 Oak'), contractId: 'cd' }),
    q({ id: 'e' }),
  ];
  const cs = contracts({ ca: 'booked', cc: 'booked', cd: 'approved' });
  const flagged = unpairedSignings(all, cs).map(f => f.quote.id).sort();
  assert.deepEqual(flagged, ['a', 'b'], 'both sides of the broken pair, neither of the good one');
});

console.log('\nThe contract sentence');
test('it names the paired address and the rate that was quoted', () => {
  assert.equal(
    sharedDrivewayClause('12 Elm St', 100),
    'Shared driveway with 12 Elm St. $100 shared-driveway discount applies while both properties are under contract.',
  );
});
test('THE CLAUSE FOLLOWS THE RATE SHEET — it is not a literal', () => {
  // The contract wording is what makes the discount conditional rather than a
  // gift, so a rate change must reach the paper. Hardcoded, the sheet would be
  // editable and the contract would still promise $100.
  assert.match(sharedDrivewayClause('12 Elm St', 150), /\$150 shared-driveway discount/);
  assert.ok(!/\$100/.test(sharedDrivewayClause('12 Elm St', 150)));
  assert.match(sharedDrivewayClause('12 Elm St', 1250), /\$1,250 shared-driveway discount/);
  assert.match(sharedDrivewayClause('12 Elm St', 0), /\$0 shared-driveway discount/);
});
test('a missing address still reads as a sentence', () => {
  assert.match(sharedDrivewayClause('   ', 100), /with the adjoining property/);
});

console.log('\nPRICING: both discounts are flat, and compose after everything else');
const grid2x1 = [[1, 1]];
test('shared takes exactly $100 off, regardless of lanes', () => {
  const base = priceSnow(grid2x1, {}, SNOW_CONFIG_V1)!;
  const shared = priceSnow(grid2x1, { sharedDriveway: true }, SNOW_CONFIG_V1)!;
  assert.equal(base.total! - shared.total!, 100);
  assert.equal(shared.addBreakdown.sharedDriveway, -100);
});
test('second driveway takes exactly $100 off', () => {
  const base = priceSnow(grid2x1, {}, SNOW_CONFIG_V1)!;
  const second = priceSnow(grid2x1, { secondDriveway: true }, SNOW_CONFIG_V1)!;
  assert.equal(base.total! - second.total!, 100);
});
test('ORDER: discounts apply to the total, after every surcharge', () => {
  // Same $100 whether or not surcharges are present — it is not a percentage
  // and it does not touch the tier base.
  const plain = priceSnow(grid2x1, { sharedDriveway: true }, SNOW_CONFIG_V1)!;
  const loaded = priceSnow(grid2x1, { sharedDriveway: true, busyRoad: true, danger: 200 }, SNOW_CONFIG_V1)!;
  const loadedNoDisc = priceSnow(grid2x1, { busyRoad: true, danger: 200 }, SNOW_CONFIG_V1)!;
  assert.equal(loadedNoDisc.total! - loaded.total!, 100);
  assert.equal(plain.addBreakdown.sharedDriveway, loaded.addBreakdown.sharedDriveway);
});
test('it composes with no-boulevard, which stays PER LANE', () => {
  const both = priceSnow(grid2x1, { noBoulevard: true, sharedDriveway: true }, SNOW_CONFIG_V1)!;
  assert.equal(both.addBreakdown.noBoulevard, -100, '2 lanes x $50');
  assert.equal(both.addBreakdown.sharedDriveway, -100, 'flat, not per lane');
  assert.equal(both.total, 599 - 100 - 100);
});
test('the tier is never changed by a discount', () => {
  const a = priceSnow(grid2x1, {}, SNOW_CONFIG_V1)!;
  const b = priceSnow(grid2x1, { sharedDriveway: true, secondDriveway: true }, SNOW_CONFIG_V1)!;
  assert.equal(a.tier, b.tier);
  assert.equal(a.basePrice, b.basePrice);
});
test('the total floors at 0, never negative', () => {
  const cheap = { ...SNOW_CONFIG_V1, TIER_1: 50 };
  const p = priceSnow(grid2x1, { sharedDriveway: true, secondDriveway: true }, cheap)!;
  assert.equal(p.total, 0);
});
test('BOTH appear in the active-modifiers summary', () => {
  const p = priceSnow(grid2x1, { sharedDriveway: true, secondDriveway: true }, SNOW_CONFIG_V1)!;
  const keys = activeModifiers(p.addBreakdown, p, SNOW_CONFIG_V1).map(m => m.key);
  assert.ok(keys.includes('sharedDriveway'), 'a silent $100 is the thing this list prevents');
  assert.ok(keys.includes('secondDriveway'));
});
test('neither appears when it is not applied', () => {
  const p = priceSnow(grid2x1, {}, SNOW_CONFIG_V1)!;
  const keys = activeModifiers(p.addBreakdown, p, SNOW_CONFIG_V1).map(m => m.key);
  assert.ok(!keys.includes('sharedDriveway'));
  assert.ok(!keys.includes('secondDriveway'));
});

console.log('\nThe QUOTE shows the discounted price; the CONDITION lives elsewhere');
test('the quote applies the discount regardless of pair state', () => {
  // priceSnow takes `sharedDriveway` as a plain input — the caller (the quote)
  // passes true for every shared quote. Withholding it put internal state in
  // front of a customer.
  const g = [[1, 1]];
  const shown = priceSnow(g, { sharedDriveway: true }, SNOW_CONFIG_V1)!;
  const full = priceSnow(g, {}, SNOW_CONFIG_V1)!;
  assert.equal(full.total! - shown.total!, 100, 'the client sees what they would pay');
});
test('the pair state still resolves — it just no longer gates the price', () => {
  const cs = contracts({ c1: 'booked' });
  const p = sharedPairing(
    q({ sharedDrivewayWith: link('q2', '12 Elm'), contractId: 'c1' }),
    q({ id: 'q2' }), cs,
  );
  assert.equal(p.state, 'one-sided');
  assert.equal(p.needsAttention, true, 'the flag is now the ONLY guard on the money');
});
test('the contract wording still carries the condition', () => {
  assert.match(sharedDrivewayClause('12 Elm St', 100), /while both properties are under contract/);
});

console.log('\nBoth properties on the record');
test('a shared quote names BOTH addresses', () => {
  const x = q({ address: '10 Elm St', sharedDrivewayWith: link('q2', '12 Elm St') });
  assert.deepEqual(quoteAddresses(x), ['10 Elm St', '12 Elm St']);
  assert.equal(quoteAddressLine(x), '10 Elm St  +  12 Elm St');
});
test('an ordinary quote names one, with no stray separator', () => {
  assert.equal(quoteAddressLine(q({ address: '10 Elm St' })), '10 Elm St');
});
test('it falls back to client/name for records predating the address field', () => {
  assert.deepEqual(quoteAddresses({ name: 'Old Record' } as any), ['Old Record']);
  assert.deepEqual(quoteAddresses({} as any), []);
});

test('one separator serves the saved record and the live quote header', () => {
  // The header reads two addresses out of the FORM, not off a quote, so it
  // cannot call quoteAddressLine. Both must still join them identically.
  const x = q({ address: '10 Elm St', sharedDrivewayWith: link('q2', '12 Elm St') });
  assert.equal(addressLine(['10 Elm St', '12 Elm St']), quoteAddressLine(x));
  assert.equal(addressLine([' 10 Elm St ', '']), '10 Elm St', 'blanks and padding tolerated');
  assert.equal(addressLine(['', '']), '');
});
test('a pair saved before the second address was typed is still a pair', () => {
  // The LINK makes a record shared, not the partner address. The saved-list row
  // keys off the link for this reason; quoteAddresses reports the one address
  // it has, and the row is what says the second is unnamed.
  const x = q({ address: '10 Elm St', sharedDrivewayWith: link('q2', '') });
  assert.ok(x.sharedDrivewayWith, 'the pairing survives an unnamed partner');
  assert.deepEqual(quoteAddresses(x), ['10 Elm St']);
});

// Shared driveways and multi-driveway properties.
//   npm test -- snowDriveways
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  sharedPairing, drivewayMode, isSigned, sharedDrivewayClause, unpairedSignings,
} from './snowDriveways';
import { priceSnow, SNOW_CONFIG_V1, activeModifiers } from './snowPricing';

const q = (o: any = {}) => ({
  id: 'q1', name: 'A', gridRows: ['11'], lanes: 2, depth: 1, cars: 2, dragCount: 0,
  tier: 1, basePrice: 599, premium: false, busyRoad: false, danger: 0,
  total: 599, isCustom: false, pricingConfigVersion: 'snow-v1', ...o,
} as any);
const link = (id: string, addr: string) => ({ quoteId: id, address: addr, pairId: 'pair-1' });

console.log('\nWhich shape is this quote?');
test('the three modes are distinguishable', () => {
  assert.equal(drivewayMode(q()), 'single');
  assert.equal(drivewayMode(q({ sharedDrivewayWith: link('q2', '12 Elm') })), 'shared');
  assert.equal(drivewayMode(q({ driveways: [{}, {}] })), 'multi');
  assert.equal(drivewayMode(q({ driveways: [{}] })), 'single', 'one driveway is not multi');
  assert.equal(drivewayMode(null), 'single');
});

console.log('\nSHARED: the discount is conditional on BOTH being signed');
test('neither signed → pending, discount NOT applied', () => {
  const p = sharedPairing(q({ sharedDrivewayWith: link('q2', '12 Elm') }), q({ id: 'q2' }));
  assert.equal(p.state, 'pending');
  assert.equal(p.discountApplies, false);
  assert.equal(p.needsAttention, false);
  assert.match(p.message, /once both properties are under contract/);
});
test('both signed → active, discount applies', () => {
  const p = sharedPairing(
    q({ sharedDrivewayWith: link('q2', '12 Elm'), signedAt: 5 }),
    q({ id: 'q2', signedAt: 9 }),
  );
  assert.equal(p.state, 'active');
  assert.equal(p.discountApplies, true);
  assert.equal(p.needsAttention, false);
});
test('THE DANGEROUS CASE: one signed → withheld AND flagged', () => {
  // Otherwise we clear the whole driveway for one payer and discount them for it.
  const p = sharedPairing(
    q({ sharedDrivewayWith: link('q2', '12 Elm'), signedAt: 5 }),
    q({ id: 'q2' }),
  );
  assert.equal(p.state, 'one-sided');
  assert.equal(p.discountApplies, false, 'must NOT discount a single payer');
  assert.equal(p.needsAttention, true);
  assert.match(p.message, /12 Elm has NOT signed/);
  assert.match(p.message, /applies automatically the moment they sign/);
});
test('the unsigned side of a one-sided pair is also flagged, worded from its side', () => {
  const p = sharedPairing(
    q({ id: 'q2', sharedDrivewayWith: link('q1', '10 Elm') }),
    q({ id: 'q1', signedAt: 5 }),
  );
  assert.equal(p.state, 'one-sided');
  assert.equal(p.discountApplies, false);
  assert.match(p.message, /10 Elm has signed and this one has not/);
});
test('RETROACTIVE by construction — nothing stores "applied"', () => {
  const mine = q({ sharedDrivewayWith: link('q2', '12 Elm'), signedAt: 5 });
  assert.equal(sharedPairing(mine, q({ id: 'q2' })).discountApplies, false);
  // The partner signs later. Same records, no back-dating, no reissue.
  assert.equal(sharedPairing(mine, q({ id: 'q2', signedAt: 99 })).discountApplies, true);
});
test('a partner that is not loaded reads as unsigned, never as signed', () => {
  const p = sharedPairing(q({ sharedDrivewayWith: link('q2', '12 Elm'), signedAt: 5 }), null);
  assert.equal(p.discountApplies, false, 'absence of evidence is not a signature');
});
test('an unpaired quote is not flagged', () => {
  const p = sharedPairing(q({ signedAt: 5 }), null);
  assert.equal(p.state, 'unpaired');
  assert.equal(p.needsAttention, false);
});
test('isSigned only accepts a real timestamp', () => {
  for (const v of [undefined, null, 0, -1, 'yes']) assert.equal(isSigned({ signedAt: v } as any), false);
  assert.equal(isSigned({ signedAt: 1 } as any), true);
});

console.log('\nThe flag surface lists every pair needing attention');
test('one-sided pairs surface, matched pairs do not', () => {
  const all = [
    q({ id: 'a', sharedDrivewayWith: link('b', '12 Elm'), signedAt: 1 }),
    q({ id: 'b', sharedDrivewayWith: link('a', '10 Elm') }),
    q({ id: 'c', sharedDrivewayWith: link('d', '3 Oak'), signedAt: 1 }),
    q({ id: 'd', sharedDrivewayWith: link('c', '1 Oak'), signedAt: 2 }),
    q({ id: 'e' }),
  ];
  const flagged = unpairedSignings(all).map(f => f.quote.id).sort();
  assert.deepEqual(flagged, ['a', 'b'], 'both sides of the broken pair, neither of the good one');
});

console.log('\nThe contract sentence');
test('it names the paired address', () => {
  assert.equal(
    sharedDrivewayClause('12 Elm St'),
    'Shared driveway with 12 Elm St. $100 shared-driveway discount applies while both properties are under contract.',
  );
});
test('a missing address still reads as a sentence', () => {
  assert.match(sharedDrivewayClause('   '), /with the adjoining property/);
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

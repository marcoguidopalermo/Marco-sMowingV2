// Unit tests for the lawn pricing engine — every agreed case from the spec.
// No test framework (none installed / allowed); run with the repo's TS runner:
//   npx tsx src/lib/lawnPricing.test.ts
import assert from 'node:assert/strict';
import {
  LAWN_CONFIG_V1, LawnConfig, resolveTierIndex, priceMowing, pricePackages, priceLawn, tierLabel,
  resolveLawnConfig, activeLawnVersionId, lawnVersionId, validateLawnConfig, diffLawnConfig,
  computeSeasonPlan, elapsedSeasonWeeks, seasonEndDate, overgrownReductionPct, remainingInstalments, isValidYmd,
} from './lawnPricing';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}\n      ${(e as Error).message.replace(/\n/g, '\n      ')}`); }
}
const mow = (sqft: number, flags = {}) => priceMowing(resolveTierIndex(sqft)!, flags);

// ── Mowing tiers: weekly + biweekly ─────────────────────────────────────────
console.log('Lawn mowing — all 8 tiers (weekly / biweekly):');
const TABLE: Array<[number, number, number]> = [
  [1500, 960, 720], [4000, 1200, 900], [7000, 1440, 1080], [9500, 1680, 1260],
  [13000, 1920, 1440], [17500, 2160, 1620], [22500, 2400, 1800], [22501, 3000, 2250],
];
for (const [sqft, weekly, biweekly] of TABLE) {
  test(`${sqft} sq ft → weekly ${weekly} / biweekly ${biweekly}`, () => {
    const m = mow(sqft);
    assert.equal(m.weeklyTotal, weekly, 'weekly');
    assert.equal(m.biweeklyTotal, biweekly, 'biweekly');
  });
}

// ── Boundaries ──────────────────────────────────────────────────────────────
console.log('\nLawn mowing — tier boundaries:');
test('1500 → tier 0, 1501 → tier 1', () => {
  assert.equal(resolveTierIndex(1500), 0);
  assert.equal(resolveTierIndex(1501), 1);
});
test('4000 → tier 1, 4001 → tier 2', () => {
  assert.equal(resolveTierIndex(4000), 1);
  assert.equal(resolveTierIndex(4001), 2);
});
test('22500 → $2,400 tier (6), 22501+ → $3,000 tier (7)', () => {
  assert.equal(resolveTierIndex(22500), 6);
  assert.equal(mow(22500).weeklyTotal, 2400);
  assert.equal(resolveTierIndex(22501), 7);
  assert.equal(mow(22501).weeklyTotal, 3000);
});

// ── Derived (annual / monthly / per cut) ────────────────────────────────────
console.log('\nLawn mowing — derived amounts:');
test('4000 weekly → annual 1200, monthly 200, per cut 60', () => {
  const m = mow(4000);
  assert.equal(m.weekly.annual, 1200);
  assert.equal(m.weekly.monthly, 200);
  assert.equal(m.weekly.perCut, 60);
});
test('4000 biweekly → annual 900, monthly 150, per cut 75', () => {
  const m = mow(4000);
  assert.equal(m.biweekly.annual, 900);
  assert.equal(m.biweekly.monthly, 150);
  assert.equal(m.biweekly.perCut, 75);
});

// ── Extras + travel ─────────────────────────────────────────────────────────
console.log('\nLawn mowing — extras + travel:');
test('4000 + push mow → weekly 1400 / biweekly 1050', () => {
  const m = mow(4000, { pushMow: true });
  assert.equal(m.weeklyTotal, 1400); assert.equal(m.biweeklyTotal, 1050);
});
test('4000 + 5 km → weekly 1400 / biweekly 1050', () => {
  const m = mow(4000, { travelZone: 'km5' });
  assert.equal(m.weeklyTotal, 1400); assert.equal(m.biweeklyTotal, 1050);
});
test('4000 + 15 km → weekly 2000 / biweekly 1500', () => {
  const m = mow(4000, { travelZone: 'km15' });
  assert.equal(m.weeklyTotal, 2000); assert.equal(m.biweeklyTotal, 1500);
});
test('4000 + push + hilly + clutter + 15 km → weekly 2600 / biweekly 1950', () => {
  const m = mow(4000, { pushMow: true, veryHilly: true, clutter: true, travelZone: 'km15' });
  assert.equal(m.weeklyTotal, 2600); assert.equal(m.biweeklyTotal, 1950);
});
test('travel zones do not stack — 10 km replaces 5 km (400, not 600)', () => {
  assert.equal(mow(4000, { travelZone: 'km10' }).travel.weekly, 400);
  assert.equal(mow(4000, { travelZone: 'km10' }).weeklyTotal, 1600);
});

// ── Packages (tier index 1) ─────────────────────────────────────────────────
console.log('\nLawn packages (tier index 1 · 1,501–4,000):');
const pkg = (key: string, flags = {}, tpv = 0, tier = 1) => pricePackages(tier, flags, tpv).find(p => p.key === key)!;
test('Bronze 249, Silver 349, Gold 499', () => {
  assert.equal(pkg('bronze').total, 249);
  assert.equal(pkg('silver').total, 349);
  assert.equal(pkg('gold').total, 499);
});
test('Bronze + $50/visit travel → 349 (2 visits)', () => {
  assert.equal(pkg('bronze', {}, 50).total, 349);
});
test('Gold + $50/visit travel → 699 (4 visits)', () => {
  assert.equal(pkg('gold', {}, 50).total, 699);
});
test('Gold + $100/visit travel → 899', () => {
  assert.equal(pkg('gold', {}, 100).total, 899);
});
test('Silver + hilly + clutter → 449', () => {
  assert.equal(pkg('silver', { veryHilly: true, clutter: true }).total, 449);
});
test('package price identical whether mowing is weekly, biweekly, or absent', () => {
  // pricePackages takes no frequency at all — the Gold total is the same object
  // regardless of any mowing choice.
  assert.equal(pkg('gold', {}, 50).total, 699);
  assert.equal(pkg('gold', {}, 50).total, pkg('gold', {}, 50).total);
});
test('push mow does not change any package price', () => {
  // Push mow is not a package flag; passing it changes nothing.
  assert.equal(pricePackages(1, { veryHilly: false, clutter: false } as any, 0).find(p => p.key === 'gold')!.total, 499);
});
test('a tier priced 0 returns "not yet priced", not $0', () => {
  assert.equal(pkg('bronze', {}, 0, 0).priced, false); // tier 0 all zero
  assert.equal(pkg('dethatch').priced, false);          // dethatch tier 1 is 0
  assert.equal(pkg('bronze').priced, true);
});

// ── Edge + version + label ──────────────────────────────────────────────────
console.log('\nLawn — edge cases, version resolution, labels:');
test('0 sq ft / no input → null, no crash', () => {
  assert.equal(priceLawn(0, {}, 0), null);
  assert.equal(resolveTierIndex(0), null);
  assert.equal(resolveTierIndex(-5), null);
});
test('tier labels read as sq ft ranges', () => {
  assert.equal(tierLabel(0), 'Up to 1,500 sq ft');
  assert.equal(tierLabel(1), '1,501–4,000 sq ft');
  assert.equal(tierLabel(7), '22,501+ sq ft');
});
test('config version resolution falls back to v1', () => {
  assert.equal(resolveLawnConfig('lawn-v1', {}).BIWEEKLY_RATIO, 0.75);
  assert.equal(resolveLawnConfig(undefined, null).TIERS[1].weekly, 1200);
  assert.equal(activeLawnVersionId({}), 'lawn-v1');
  assert.equal(lawnVersionId(2), 'lawn-v2');
});
test('priceLawn combines mowing + packages for a size', () => {
  const p = priceLawn(4000, { travelZone: 'in_town' }, 50)!;
  assert.equal(p.tierIndex, 1);
  assert.equal(p.mowing.weeklyTotal, 1200);
  assert.equal(p.packages.find(x => x.key === 'gold')!.total, 699);
});

// Sanity: BIWEEKLY_RATIO applies to the whole weekly total, every case.
test('biweekly = weekly × 0.75 for every tier', () => {
  LAWN_CONFIG_V1.TIERS.forEach((_, i) => {
    const m = priceMowing(i, {});
    assert.equal(m.biweeklyTotal, m.weeklyTotal * 0.75);
  });
});

// ── Rate-sheet: validation + diff + historical resolution ───────────────────
console.log('\nLawn rate sheet — validation + diff + historical resolution:');
const clone = (): LawnConfig => structuredClone(LAWN_CONFIG_V1);

test('validateLawnConfig accepts v1 defaults', () => {
  assert.deepEqual(validateLawnConfig(LAWN_CONFIG_V1), []);
});
test('validation: weekly must be > 0 for every tier', () => {
  const c = clone(); c.TIERS[2].weekly = 0;
  assert.ok(validateLawnConfig(c).some(e => /weekly price must be greater than 0/i.test(e)));
});
test('validation: package prices >= 0 allowed (0 is valid), negative rejected', () => {
  const zero = clone(); // all package zeros already present → still valid
  assert.deepEqual(validateLawnConfig(zero), []);
  const neg = clone(); neg.PACKAGE_PRICES[1].bronze = -1;
  assert.ok(validateLawnConfig(neg).length > 0);
});
test('validation: sq ft bounds must be strictly ascending (no gaps/overlaps)', () => {
  const c = clone(); c.TIERS[2].maxSqFt = 3000; // now 4000 then 3000 → not ascending
  assert.ok(validateLawnConfig(c).some(e => /ascending/i.test(e)));
});
test('validation: last tier must be open-ended', () => {
  const c = clone(); c.TIERS[c.TIERS.length - 1].maxSqFt = 99999;
  assert.ok(validateLawnConfig(c).some(e => /open-ended/i.test(e)));
});
test('validation: ratio must be between 0 and 1; cuts/months/visits > 0', () => {
  assert.ok(validateLawnConfig({ ...clone(), BIWEEKLY_RATIO: 1 }).length > 0);
  assert.ok(validateLawnConfig({ ...clone(), BIWEEKLY_RATIO: 0 }).length > 0);
  assert.ok(validateLawnConfig({ ...clone(), MONTHS: 0 }).length > 0);
  const badVisits = clone(); badVisits.PACKAGES[0].visits = 0;
  assert.ok(validateLawnConfig(badVisits).some(e => /visit counts/i.test(e)));
});
test('diffLawnConfig reports only changed fields, old → new', () => {
  const c = clone(); c.TIERS[1].weekly = 1300; c.PACKAGE_PRICES[1].bronze = 279;
  const changes = diffLawnConfig(LAWN_CONFIG_V1, c);
  assert.equal(changes.length, 2);
  assert.ok(changes.find(x => x.key === 'tier1.weekly' && x.from === '1200' && x.to === '1300'));
  assert.ok(changes.find(x => x.key === 'tier1.bronze' && x.from === '249' && x.to === '279'));
  assert.deepEqual(diffLawnConfig(LAWN_CONFIG_V1, LAWN_CONFIG_V1), []);
});
test('HISTORICAL RESOLUTION: an April (v1) quote keeps its price after v2 raises the tier', () => {
  const V2 = clone(); V2.TIERS[1].weekly = 1320; // 4,000-tier weekly 1200 → 1320
  const versions = { 'lawn-v2': { version: 'lawn-v2', config: V2 } };
  // April quote priced under v1.
  const april = priceMowing(resolveTierIndex(4000, resolveLawnConfig('lawn-v1', versions))!, {}, resolveLawnConfig('lawn-v1', versions));
  assert.equal(april.weeklyTotal, 1200);
  // August: a NEW quote at v2 is higher.
  const augustNew = priceMowing(resolveTierIndex(4000, resolveLawnConfig('lawn-v2', versions))!, {}, resolveLawnConfig('lawn-v2', versions));
  assert.equal(augustNew.weeklyTotal, 1320);
  // The April quote re-resolved against ITS version still shows 1200.
  const aprilReopened = priceMowing(resolveTierIndex(4000, resolveLawnConfig('lawn-v1', versions))!, {}, resolveLawnConfig('lawn-v1', versions));
  assert.equal(aprilReopened.weeklyTotal, 1200, 'historical lawn quote must NOT reprice');
  assert.equal(activeLawnVersionId(versions), 'lawn-v2');
});

// ── Mid-season proration + overgrown + deposit + BH ─────────────────────────
console.log('\nLawn mid-season — proration, overgrown, deposit, BH:');
// Tier 1 (4,000 sq ft) → weekly $1,200 / biweekly $900. SEASON_START 2026-05-25.
const plan = (startDate: string, overgrown = 'normal', config = LAWN_CONFIG_V1) =>
  computeSeasonPlan(priceMowing(1, {}, config), startDate, overgrown, config);
const round = (n: number) => Math.round(n * 100) / 100;

test('signup on SEASON_START → 0 weeks, 0% discount, full price', () => {
  const p = plan('2026-05-25');
  assert.equal(p.discount.elapsedWeeks, 0);
  assert.equal(p.discount.baseDiscountPct, 0);
  assert.equal(p.discount.netDiscountPct, 0);
  assert.equal(p.weekly.proratedTotal, 1200);
});
test('15 June → week 3 → 15% → weekly prorated $1,020', () => {
  const p = plan('2026-06-15');
  assert.equal(p.discount.elapsedWeeks, 3);
  assert.equal(p.discount.netDiscountPct, 15);
  assert.equal(p.weekly.proratedTotal, 1020);
});
test('15 July → week 7 → 35% → weekly $780, deposit $180', () => {
  const p = plan('2026-07-15');
  assert.equal(p.discount.elapsedWeeks, 7);
  assert.equal(p.discount.netDiscountPct, 35);
  assert.equal(p.weekly.proratedTotal, 780);
  assert.equal(p.remainingInstalments, 3); // Aug, Sep, Oct
  assert.equal(p.weekly.deposit, 180);
});
test('10 Aug → week 11 → 55% → weekly $540', () => {
  const p = plan('2026-08-10');
  assert.equal(p.discount.elapsedWeeks, 11);
  assert.equal(p.discount.netDiscountPct, 55);
  assert.equal(p.weekly.proratedTotal, 540);
});
test('signup before season start → 0%, no negative weeks', () => {
  const p = plan('2026-05-01');
  assert.equal(p.discount.elapsedWeeks, 0);
  assert.equal(p.discount.baseDiscountPct, 0);
});
test('signup after season end → capped at 20 weeks', () => {
  assert.equal(elapsedSeasonWeeks('2026-12-01'), 20);
  assert.equal(plan('2026-12-01').discount.baseDiscountPct, 100);
});
test('triple cut at 50% base → 40% final; first-visit BH 1.80 weekly / 2.25 biweekly', () => {
  const p = plan('2026-08-03', 'triple'); // week 10 → 50% base
  assert.equal(p.discount.baseDiscountPct, 50);
  assert.equal(p.discount.overgrownReductionPct, 10); // (3-1)×5
  assert.equal(p.discount.netDiscountPct, 40);
  assert.equal(p.discount.isSurcharge, false);
  assert.equal(round(p.weekly.firstVisitBH), 1.8);
  assert.equal(round(p.biweekly.firstVisitBH), 2.25);
});
test('5× cut at 10% base → net −10%, surcharge, total $1,320 weekly', () => {
  const p = plan('2026-06-08', 'quint'); // week 2 → 10% base
  assert.equal(p.discount.baseDiscountPct, 10);
  assert.equal(p.discount.overgrownReductionPct, 20); // (5-1)×5
  assert.equal(p.discount.netDiscountPct, -10);
  assert.equal(p.discount.isSurcharge, true);
  assert.equal(p.weekly.proratedTotal, 1320);
});
test('4× cut at 5% base → net −10%, surcharge', () => {
  const p = plan('2026-06-01', 'quad'); // week 1 → 5% base
  assert.equal(p.discount.netDiscountPct, -10);
  assert.equal(p.discount.isSurcharge, true);
});
test('surcharge deposit $520 on 8 June signup, and deposit + instalments = prorated total', () => {
  const p = plan('2026-06-08', 'quint');
  assert.equal(p.remainingInstalments, 4); // Jul, Aug, Sep, Oct
  assert.equal(p.weekly.deposit, 520);
  assert.equal(p.weekly.deposit + p.remainingInstalments * p.weekly.monthly, p.weekly.proratedTotal); // 520 + 800 = 1320
});
test('packages are unchanged by start date, overgrown option, or discount', () => {
  const base = pricePackages(1, {}, 0).find(x => x.key === 'bronze')!.total;
  // computeSeasonPlan touches only mowing; packages are priced independently.
  assert.equal(pricePackages(1, {}, 0).find(x => x.key === 'bronze')!.total, base);
  assert.equal(base, 249);
});
test('discount reduction always equals (multiplier − 1) × 5', () => {
  for (const o of LAWN_CONFIG_V1.OVERGROWN) {
    assert.equal(overgrownReductionPct(o.multiplier), (o.multiplier - 1) * 5);
  }
});
test('BH uses FULL price and FULL cut count, not prorated', () => {
  const p = plan('2026-08-10'); // 55% discount
  assert.equal(p.weekly.bhPerVisit, 0.6);   // 1200 / 20 / 100 — not the prorated 540
  assert.equal(p.biweekly.bhPerVisit, 0.75); // 900 / 12 / 100
});
test('prorated total + deposit resolve from an OLD config version after SEASON_START changes', () => {
  // v2 moves the season a week later. An April-stamped v1 quote must still use v1's SEASON_START.
  const V2: LawnConfig = structuredClone(LAWN_CONFIG_V1); V2.SEASON_START = '2026-06-01';
  const versions = { 'lawn-v2': { version: 'lawn-v2', config: V2 } };
  const v1cfg = resolveLawnConfig('lawn-v1', versions); // → defaults (2026-05-25)
  const v2cfg = resolveLawnConfig('lawn-v2', versions); // → 2026-06-01
  // Same 15 July signup resolves to different elapsed weeks per version.
  assert.equal(computeSeasonPlan(priceMowing(1, {}, v1cfg), '2026-07-15', 'normal', v1cfg).discount.elapsedWeeks, 7);
  assert.equal(computeSeasonPlan(priceMowing(1, {}, v2cfg), '2026-07-15', 'normal', v2cfg).discount.elapsedWeeks, 6);
  // v1 quote's prorated/deposit unchanged by v2 existing.
  const v1 = computeSeasonPlan(priceMowing(1, {}, v1cfg), '2026-07-15', 'normal', v1cfg);
  assert.equal(v1.weekly.proratedTotal, 780);
  assert.equal(v1.weekly.deposit, 180);
});
test('season end derives as start + 20 weeks; date validation', () => {
  assert.equal(seasonEndDate(), '2026-10-12');
  assert.equal(remainingInstalments('2026-07-15'), 3);
  assert.ok(isValidYmd('2026-05-25'));
  assert.ok(!isValidYmd('2026-13-40'));
  assert.ok(!isValidYmd('not-a-date'));
});
test('validation: SEASON_START must be real; overgrown multipliers must ascend', () => {
  assert.ok(validateLawnConfig({ ...structuredClone(LAWN_CONFIG_V1), SEASON_START: 'nope' }).some(e => /Season start/i.test(e)));
  const bad = structuredClone(LAWN_CONFIG_V1); bad.OVERGROWN[2].multiplier = 1.5; // 2 then 1.5 → not ascending
  assert.ok(validateLawnConfig(bad).some(e => /ascend/i.test(e)));
  assert.deepEqual(validateLawnConfig(LAWN_CONFIG_V1), []);
});

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

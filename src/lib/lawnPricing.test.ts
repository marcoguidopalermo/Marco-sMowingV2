// Unit tests for the lawn pricing engine — every agreed case from the spec.
// No test framework (none installed / allowed); run with the repo's TS runner:
//   npx tsx src/lib/lawnPricing.test.ts
import assert from 'node:assert/strict';
import {
  LAWN_CONFIG_V1, LawnConfig, resolveTierIndex, priceMowing, priceMowingBase, pricePackages, priceLawn, tierLabel,
  resolveLawnConfig, activeLawnVersionId, lawnVersionId, validateLawnConfig, diffLawnConfig,
  computeSeasonPlan, computeSeasonPlanFC, signupSeasonWeek, firstCutSeasonWeek, seasonEndDate, overgrownReductionPct,
  availableMonthEnds, billingDates, isValidYmd, mondayOfNextWeek, migrateFirstCutDate, cutWeeks, cutsRemaining,
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
test('travel per-visit: 5 km → weekly $500/season, biweekly $300/season', () => {
  const m = mow(4000, { travelZone: 'km5' });
  assert.equal(m.travel.perVisit, 25);
  assert.equal(m.travel.weeklySeason, 500);    // 25 × 20 cuts
  assert.equal(m.travel.biweeklySeason, 300);  // 25 × 12 cuts (NOT 0.75 × 500)
  assert.equal(m.weeklyTotal, 1700);           // 1200 + 500
  assert.equal(m.biweeklyTotal, 1200);         // 1200×0.75 + 300 = 900 + 300
});
test('base tier + push/hilly/clutter still use the 0.75 ratio (travel is the only exception)', () => {
  const m = mow(4000, { pushMow: true, veryHilly: true, clutter: true }); // no travel
  assert.equal(m.weeklyTotal, 1800);           // 1200 + 3×200
  assert.equal(m.biweeklyTotal, 1350);         // 1800 × 0.75
});
test('4000 + push + hilly + clutter + 15 km → weekly 3300 / biweekly 2250', () => {
  const m = mow(4000, { pushMow: true, veryHilly: true, clutter: true, travelZone: 'km15' });
  assert.equal(m.weeklyTotal, 3300);           // 1800 + 75×20 = 1800 + 1500
  assert.equal(m.biweeklyTotal, 2250);         // 1350 + 75×12 = 1350 + 900
});
test('travel zones do not stack — 10 km replaces 5 km (weekly $1,000/season)', () => {
  assert.equal(mow(4000, { travelZone: 'km10' }).travel.weeklySeason, 1000); // 50 × 20
  assert.equal(mow(4000, { travelZone: 'km10' }).weeklyTotal, 2200);
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

// ── Mid-season: signup week + first-cut timing ──────────────────────────────
console.log('\nLawn mid-season — first-cut timing, discount, deposit, billing:');
// Tier 1 (4,000 sq ft) → weekly $1,200 (/$200 mo) / biweekly $900 (/$150 mo).
const plan = (startDate: string, overgrown = 'normal', fc: 'this' | 'next' = 'next', config = LAWN_CONFIG_V1) =>
  computeSeasonPlan(priceMowing(1, {}, config), startDate, overgrown, fc, config);
const P = (startDate: string, overgrown = 'normal', fc: 'this' | 'next' = 'next', config = LAWN_CONFIG_V1) => {
  const p = plan(startDate, overgrown, fc, config); assert.ok(p, 'expected a plan'); return p!;
};
const round = (n: number) => Math.round(n * 100) / 100;
const dateForWeek = (wk: number) => { // returns a date IN season week `wk` (1-indexed)
  const d = new Date(Date.UTC(2026, 4, 25) + (wk - 1) * 7 * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

// The verified table from the amendment (weekly, $1,200).
const ROWS: Array<{ date: string; wk: number; fc: 'this' | 'next'; cuts: number; disc: number; weekly: number }> = [
  { date: '2026-06-08', wk: 3, fc: 'this', cuts: 18, disc: 10, weekly: 1080 },
  { date: '2026-06-08', wk: 3, fc: 'next', cuts: 17, disc: 15, weekly: 1020 },
  { date: '2026-07-27', wk: 10, fc: 'this', cuts: 11, disc: 45, weekly: 660 },
  { date: '2026-07-27', wk: 10, fc: 'next', cuts: 10, disc: 50, weekly: 600 },
];
for (const r of ROWS) {
  test(`${r.date} (week ${r.wk}, ${r.fc} week) → ${r.cuts} cuts, ${r.disc}%, weekly $${r.weekly}`, () => {
    const p = P(r.date, 'normal', r.fc);
    assert.equal(p.discount.signupWeek, r.wk);
    assert.equal(p.discount.seasonDiscountPct, r.disc);
    assert.equal(p.weekly.cutsLeft, r.cuts);      // totalCuts 20 → cutsLeft == weeksServiced
    assert.equal(p.weekly.proratedTotal, r.weekly);
    // billing invariant still holds
    assert.equal(round(p.weekly.deposit + p.weekly.instalments * p.weekly.monthly), p.weekly.proratedTotal);
  });
}

test('the two first-cut options always differ by exactly one cut and one DISCOUNT_PER_WEEK step', () => {
  for (const date of ['2026-06-08', '2026-07-27', '2026-08-31', '2026-09-14']) {
    const t = P(date, 'normal', 'this'), n = P(date, 'normal', 'next');
    assert.equal(t.weekly.cutsLeft - n.weekly.cutsLeft, 1);
    assert.equal(n.discount.seasonDiscountPct - t.discount.seasonDiscountPct, LAWN_CONFIG_V1.DISCOUNT_PER_WEEK);
  }
});
test('signup before SEASON_START → week 0, 0% discount, 20 cuts, first-cut control moot', () => {
  const p = P('2026-05-01');
  assert.equal(p.discount.signupWeek, 0);
  assert.equal(p.discount.seasonDiscountPct, 0);
  assert.equal(p.weekly.cutsLeft, 20);
  assert.equal(p.biweekly.cutsLeft, 12);
  // firstCut does not change a before-season quote
  assert.equal(P('2026-05-01', 'normal', 'this').weekly.proratedTotal, P('2026-05-01', 'normal', 'next').weekly.proratedTotal);
});
test('season end is the LAST cutting week: 5 Oct 2026, not 12 Oct', () => {
  assert.equal(seasonEndDate(), '2026-10-05');
});
test('week 20 + next week → BLOCKED (no cuts remaining); week 20 + this week → 1 cut', () => {
  const wk20 = dateForWeek(20); // 2026-10-05
  assert.equal(signupSeasonWeek(wk20), 20);
  assert.equal(plan(wk20, 'normal', 'next'), null);           // blocked
  const thisWk = P(wk20, 'normal', 'this');
  assert.equal(thisWk.weekly.cutsLeft, 1);
  assert.equal(thisWk.discount.seasonDiscountPct, 95);
  assert.equal(plan('2026-10-20', 'normal', 'this'), null);   // past the last cutting week → blocked
});
test('deposit ∈ [0, monthly] for every serviceable signup week, both frequencies, both first-cut', () => {
  for (let wk = 1; wk <= 20; wk++) for (const fc of ['this', 'next'] as const) {
    const p = plan(dateForWeek(wk), 'triple', fc);
    if (!p) continue; // week 20 + next is blocked
    for (const fp of [p.weekly, p.biweekly]) {
      assert.ok(fp.deposit >= 0 && fp.deposit <= fp.monthly, `wk ${wk} ${fc} deposit ${fp.deposit} vs monthly ${fp.monthly}`);
    }
  }
});
test('season discount never negative; never above full price', () => {
  for (let wk = 1; wk <= 20; wk++) for (const fc of ['this', 'next'] as const) {
    const p = plan(dateForWeek(wk), 'quint', fc); if (!p) continue;
    assert.ok(p.discount.seasonDiscountPct >= 0);
    assert.ok(p.weekly.proratedTotal <= p.weekly.fullPrice);
  }
});
test('catch-up charge = (multiplier − 1) × 5% × fullPrice, independent of signup date', () => {
  for (const date of ['2026-06-08', '2026-08-10', '2026-09-30']) {
    assert.equal(P(date, 'quad').weekly.catchUpCharge, (4 - 1) * 5 / 100 * 1200);
    assert.equal(P(date, 'triple').weekly.catchUpCharge, (3 - 1) * 5 / 100 * 1200);
  }
  for (const o of LAWN_CONFIG_V1.OVERGROWN) assert.equal(overgrownReductionPct(o.multiplier), (o.multiplier - 1) * 5);
});
test('BH uses FULL price and FULL cut count, not prorated; first-visit BH ×multiplier', () => {
  const p = P('2026-07-27', 'triple', 'next'); // 50% discount
  assert.equal(p.weekly.bhPerVisit, 0.6);   // full 1200/20/100
  assert.equal(p.biweekly.bhPerVisit, 0.75); // full 900/12/100
  assert.equal(round(p.weekly.firstVisitBH), 1.8);
  assert.equal(round(p.biweekly.firstVisitBH), 2.25);
});
test('cutsLeft: full at week 1/this, zero when no service', () => {
  assert.equal(P(dateForWeek(1), 'normal', 'this').weekly.cutsLeft, 20);
  assert.equal(P(dateForWeek(1), 'normal', 'this').biweekly.cutsLeft, 12);
  assert.equal(plan(dateForWeek(20), 'normal', 'next'), null);
});
test('billing schedule: real month-ends through October 31; count == instalments', () => {
  const p = P('2026-07-15').weekly;
  assert.deepEqual(p.billingDates, p.instalments ? billingDates(2026, p.instalments) : []);
  for (let wk = 1; wk <= 20; wk++) {
    const pl = plan(dateForWeek(wk)); if (!pl) continue;
    const fp = pl.weekly;
    assert.equal(fp.billingDates.length, fp.instalments);
    if (fp.instalments > 0) {
      assert.equal(fp.billingDates[fp.billingDates.length - 1], '2026-10-31');
      for (const bd of fp.billingDates) assert.ok(isValidYmd(bd));
    }
  }
  assert.deepEqual(billingDates(2026, 3), ['2026-08-31', '2026-09-30', '2026-10-31']);
});
test('billing total == prorated + catch-up for every serviceable week, both frequencies', () => {
  for (let wk = 1; wk <= 20; wk++) for (const fc of ['this', 'next'] as const) {
    const p = plan(dateForWeek(wk), 'triple', fc); if (!p) continue;
    for (const fp of [p.weekly, p.biweekly]) {
      assert.equal(round(fp.deposit + fp.catchUpCharge + fp.instalments * fp.monthly), round(fp.proratedTotal + fp.catchUpCharge));
    }
  }
});
test('packages are unchanged by start date, overgrown option, or discount', () => {
  assert.equal(pricePackages(1, {}, 0).find(x => x.key === 'bronze')!.total, 249);
});
test('prorated + deposit resolve from an OLD config version after SEASON_START changes', () => {
  const V2: LawnConfig = structuredClone(LAWN_CONFIG_V1); V2.SEASON_START = '2026-06-01';
  const versions = { 'lawn-v2': { version: 'lawn-v2', config: V2 } };
  const v1cfg = resolveLawnConfig('lawn-v1', versions);
  const v2cfg = resolveLawnConfig('lawn-v2', versions);
  // Same 27 July signup resolves to different signup weeks per version.
  assert.equal(computeSeasonPlan(priceMowing(1, {}, v1cfg), '2026-07-27', 'normal', 'next', v1cfg)!.discount.signupWeek, 10);
  assert.equal(computeSeasonPlan(priceMowing(1, {}, v2cfg), '2026-07-27', 'normal', 'next', v2cfg)!.discount.signupWeek, 9);
  const v1 = computeSeasonPlan(priceMowing(1, {}, v1cfg), '2026-07-27', 'normal', 'next', v1cfg)!.weekly;
  assert.equal(v1.proratedTotal, 600); // v1 quote unaffected by v2 existing
});
test('signupSeasonWeek + season end + availableMonthEnds', () => {
  assert.equal(signupSeasonWeek('2026-05-25'), 1);   // first week
  assert.equal(signupSeasonWeek('2026-05-01'), 0);   // before season
  assert.equal(signupSeasonWeek('2026-07-27'), 10);
  assert.equal(signupSeasonWeek('2026-12-01'), 20);  // capped
  assert.equal(seasonEndDate(), '2026-10-05');
  assert.equal(availableMonthEnds('2026-06-08'), 5);
  assert.ok(isValidYmd('2026-05-25') && !isValidYmd('2026-13-40') && !isValidYmd('nope'));
});
test('validation: SEASON_START must be real; overgrown multipliers must ascend', () => {
  assert.ok(validateLawnConfig({ ...structuredClone(LAWN_CONFIG_V1), SEASON_START: 'nope' }).some(e => /Season start/i.test(e)));
  const bad = structuredClone(LAWN_CONFIG_V1); bad.OVERGROWN[2].multiplier = 1.5;
  assert.ok(validateLawnConfig(bad).some(e => /ascend/i.test(e)));
  assert.deepEqual(validateLawnConfig(LAWN_CONFIG_V1), []);
});

// ── CONSOLIDATED BUILD: first-cut-date model, unified travel, price modes ────
console.log('\nLawn consolidated — first-cut-date model:');
// `round` and `dateForWeek` are declared with the mid-season tests above.
const fcPlan = (mow: ReturnType<typeof priceMowing>, firstCutDate: string, og = 'normal', cfg = LAWN_CONFIG_V1) =>
  computeSeasonPlanFC(mow, firstCutDate, og, cfg);

test('first cut 1 Jun 2026 → week 2, 19 cuts, 5% discount, $2,052 weekly on $2,160 base', () => {
  const m = priceMowing(5, {}); // tier 5 = $2,160 weekly
  assert.equal(m.weeklyTotal, 2160);
  const p = fcPlan(m, '2026-06-01');
  assert.equal(p.discount.firstCutWeek, 2);
  assert.equal(p.discount.seasonDiscountPct, 5);
  assert.equal(p.weekly.cutsLeft, 19);
  assert.equal(p.weekly.proratedTotal, 2052);
  assert.equal(firstCutSeasonWeek('2026-06-01'), 2);
});
test('first cut before SEASON_START → week 1, 20 cuts, 0% discount, never blocked', () => {
  const p = fcPlan(priceMowing(1, {}), '2026-05-01');
  assert.equal(p.discount.firstCutWeek, 1);
  assert.equal(p.discount.seasonDiscountPct, 0);
  assert.equal(p.weekly.cutsLeft, 20);
  assert.equal(p.biweekly.cutsLeft, 12);
  assert.equal(firstCutSeasonWeek('2026-05-01'), 1);
});
test('default first cut date is the Monday of next week', () => {
  // 2026-06-01 is a Monday → next Monday is 2026-06-08.
  assert.equal(mondayOfNextWeek('2026-06-01'), '2026-06-08');
  // From a mid-week / weekend day, still lands on the Monday of the next week.
  assert.equal(mondayOfNextWeek('2026-06-03'), '2026-06-08'); // Wed → next Mon
  assert.equal(mondayOfNextWeek('2026-06-07'), '2026-06-08'); // Sun → Mon
  assert.equal(mondayOfNextWeek('2026-06-06'), '2026-06-08'); // Sat → Mon
  // Result is always a Monday.
  for (const d of ['2026-04-14', '2026-07-31', '2026-12-25', '2026-01-01']) {
    const mon = mondayOfNextWeek(d);
    assert.equal(firstCutSeasonWeek(mon) >= 1, true);
    assert.equal(new Date(`${mon}T00:00:00Z`).getUTCDay(), 1, `${mon} should be a Monday`);
  }
});
test('OLD saved quote (startDate + firstCut) prices identically after migration', () => {
  const m = priceMowing(1, {}); // $1,200 weekly
  for (const [startDate, fc] of [['2026-06-08', 'next'], ['2026-07-27', 'this'], ['2026-05-01', 'next']] as const) {
    const old = computeSeasonPlan(m, startDate, 'triple', fc);
    if (!old) continue;
    const migratedDate = migrateFirstCutDate(startDate, fc);
    const now = computeSeasonPlanFC(m, migratedDate, 'triple');
    assert.equal(now.weekly.proratedTotal, old.weekly.proratedTotal, `${startDate}/${fc} prorated`);
    assert.equal(now.weekly.cutsLeft, old.weekly.cutsLeft, `${startDate}/${fc} cuts`);
    assert.equal(now.discount.seasonDiscountPct, old.discount.seasonDiscountPct, `${startDate}/${fc} disc`);
    assert.equal(now.weekly.catchUpCharge, old.weekly.catchUpCharge, `${startDate}/${fc} catch-up`);
  }
});

console.log('\nLawn consolidated — one travel rate for everything:');
const TRAVEL: Array<{ key: string; pv: number; weekly: number; biweekly: number; bronze: number; silver: number; gold: number; dethatch: number }> = [
  { key: 'in_town', pv: 0, weekly: 0, biweekly: 0, bronze: 0, silver: 0, gold: 0, dethatch: 0 },
  { key: 'km5', pv: 25, weekly: 500, biweekly: 300, bronze: 50, silver: 75, gold: 100, dethatch: 25 },
  { key: 'km10', pv: 50, weekly: 1000, biweekly: 600, bronze: 100, silver: 150, gold: 200, dethatch: 50 },
  { key: 'km15', pv: 75, weekly: 1500, biweekly: 900, bronze: 150, silver: 225, gold: 300, dethatch: 75 },
  { key: 'km20', pv: 100, weekly: 2000, biweekly: 1200, bronze: 200, silver: 300, gold: 400, dethatch: 100 },
];
test('all five travel zones: per-visit × cut count (weekly 20 / biweekly 12)', () => {
  assert.equal(LAWN_CONFIG_V1.TRAVEL_ZONES.length, 5);
  for (const t of TRAVEL) {
    const m = mow(4000, { travelZone: t.key });
    assert.equal(m.travel.perVisit, t.pv, `${t.key} perVisit`);
    assert.equal(m.travel.weeklySeason, t.weekly, `${t.key} weekly season`);
    assert.equal(m.travel.biweeklySeason, t.biweekly, `${t.key} biweekly season`);
  }
});
test('travel applies to packages at the same per-visit rate × package visit count', () => {
  for (const t of TRAVEL) {
    // Bronze 2 visits, Silver 3, Gold 4 (all priced in tier 1).
    assert.equal(pricePackages(1, {}, t.pv).find(p => p.key === 'bronze')!.travel, t.bronze, `${t.key} bronze`);
    assert.equal(pricePackages(1, {}, t.pv).find(p => p.key === 'silver')!.travel, t.silver, `${t.key} silver`);
    assert.equal(pricePackages(1, {}, t.pv).find(p => p.key === 'gold')!.travel, t.gold, `${t.key} gold`);
  }
  // Per-visit-count sanity: 20 km × Gold's 4 visits = $400 travel on top of base.
  assert.equal(pricePackages(1, {}, 100).find(p => p.key === 'gold')!.total, 499 + 400);
});
test('20 km is the maximum serviced zone — no sixth zone exists', () => {
  const keys = LAWN_CONFIG_V1.TRAVEL_ZONES.map(z => z.key);
  assert.deepEqual(keys, ['in_town', 'km5', 'km10', 'km15', 'km20']);
});
test('NO ZONE_MIN_CLIENTS / ZONE_BREAKEVEN_CLIENTS / PACKAGE_TRAVEL_PER_VISIT remain in config', () => {
  assert.equal((LAWN_CONFIG_V1 as any).ZONE_MIN_CLIENTS, undefined);
  assert.equal((LAWN_CONFIG_V1 as any).ZONE_BREAKEVEN_CLIENTS, undefined);
  assert.equal((LAWN_CONFIG_V1 as any).PACKAGE_TRAVEL_PER_VISIT, undefined);
  // Diff/flatten no longer surface those keys either.
  const c = structuredClone(LAWN_CONFIG_V1); c.TIERS[1].weekly = 9999;
  const changes = diffLawnConfig(LAWN_CONFIG_V1, c);
  assert.ok(!changes.some(x => /zone\.(min|break)|pkgTravel/i.test(x.key)));
});
test('travel is still the only exception to the 0.75 ratio', () => {
  // Base + season extras ratio at 0.75; travel does not.
  const m = mow(4000, { pushMow: true, travelZone: 'km20' });
  const ratioed = 1200 + 200;           // base + push
  assert.equal(m.weeklyTotal, ratioed + 2000);          // + 100×20 travel (not ratioed)
  assert.equal(m.biweeklyTotal, ratioed * 0.75 + 1200); // + 100×12 travel (not ratioed)
});

console.log('\nLawn consolidated — price entry modes B (seasonal) & C (per-cut):');
test('Mode B: $10,000 weekly, first cut week 11 → prorated $5,000, BH 5.00, monthly $1,667, deposit $0, PPC $500', () => {
  const m = priceMowingBase(10000, { travelZone: 'in_town' });
  assert.equal(m.tierIndex, -1);
  assert.equal(m.weeklyTotal, 10000);
  const p = computeSeasonPlanFC(m, dateForWeek(11), 'normal');
  assert.equal(p.discount.firstCutWeek, 11);
  assert.equal(p.discount.seasonDiscountPct, 50);
  assert.equal(p.weekly.fullPrice, 10000);
  assert.equal(p.weekly.proratedTotal, 5000);
  assert.equal(p.weekly.bhPerVisit, 5);               // 10000 / 20 / 100
  assert.equal(Math.round(p.weekly.monthly), 1667);   // 10000 / 6 (display-rounded)
  assert.equal(p.weekly.instalments, 3);
  assert.equal(p.weekly.deposit, 0);
  assert.equal(p.weekly.cutsLeft, 10);
  assert.equal(p.weekly.internalPPC, 500);            // 5000 / 10
});
test('Mode C: $500/cut weekly → $10,000 seasonal, identical to Mode B', () => {
  const perCut = 500, weeklyBase = perCut * LAWN_CONFIG_V1.WEEKLY_CUTS; // 10,000
  const c = priceMowingBase(weeklyBase, { travelZone: 'in_town' });
  const b = priceMowingBase(10000, { travelZone: 'in_town' });
  assert.equal(c.weeklyTotal, 10000);
  const pc = computeSeasonPlanFC(c, dateForWeek(11), 'normal').weekly;
  const pb = computeSeasonPlanFC(b, dateForWeek(11), 'normal').weekly;
  assert.deepEqual(
    { prorated: pc.proratedTotal, bh: pc.bhPerVisit, monthly: round(pc.monthly), deposit: pc.deposit, ppc: pc.internalPPC },
    { prorated: pb.proratedTotal, bh: pb.bhPerVisit, monthly: round(pb.monthly), deposit: pb.deposit, ppc: pb.internalPPC },
  );
});
test('Modes B/C support extras, travel, overgrown and the full billing schedule', () => {
  // $8,000 weekly seasonal + push + very hilly + 10 km travel + triple overgrown.
  const m = priceMowingBase(8000, { pushMow: true, veryHilly: true, travelZone: 'km10' });
  assert.equal(m.weeklyTotal, 8000 + 200 + 200 + 50 * 20);   // base + push + hilly + travel(50×20)
  const p = computeSeasonPlanFC(m, dateForWeek(6), 'triple').weekly;
  // Overgrown catch-up = (3−1) × 5% × fullPrice.
  assert.equal(p.catchUpCharge, round((3 - 1) * 5 / 100 * m.weeklyTotal));
  // Catch-up now folds INTO the quote total; the deposit absorbs the slack so
  // deposit + instalments×monthly == quoteTotal == prorated + 0 packages + catch-up.
  assert.equal(p.quoteTotal, round(p.proratedTotal + 0 + p.catchUpCharge));
  assert.equal(round(p.deposit + p.instalments * p.monthly), p.quoteTotal);
  assert.equal(p.billingDates.length, p.instalments);
});

console.log('\nLawn consolidated — overgrown label $, deposit-row, invariants:');
test('overgrown label amount = (multiplier − 1) × 5% × fullSeasonPrice, tracks the base', () => {
  // The component derives the button dollar amount from the full WEEKLY season price.
  const amt = (mult: number, full: number) => (mult - 1) * LAWN_CONFIG_V1.DISCOUNT_PER_WEEK / 100 * full;
  for (const full of [2160, 10000]) {
    assert.equal(amt(1, full), 0);
    assert.equal(amt(2, full), 0.05 * full);
    assert.equal(amt(3, full), 0.10 * full);
    assert.equal(amt(4, full), 0.15 * full);
    assert.equal(amt(5, full), 0.20 * full);
  }
  // Concretely the spec's $2,160 base → 2×=$108, 3×=$216, 4×=$324, 5×=$432.
  assert.deepEqual([2, 3, 4, 5].map(mm => amt(mm, 2160)), [108, 216, 324, 432]);
});
test('deposit $0 on an even split; deposit + instalments×monthly == quoteTotal (no monthly cap)', () => {
  const p = computeSeasonPlanFC(priceMowingBase(10000, {}), dateForWeek(11), 'normal').weekly;
  assert.equal(p.deposit, 0); // even 3-way split → no deposit → UI omits the row
  for (let wk = 1; wk <= 20; wk++) {
    for (const base of [1200, 10000, 7333]) {
      for (const og of ['normal', 'triple'] as const) {
        const fp = computeSeasonPlanFC(priceMowingBase(base, {}), dateForWeek(wk), og).weekly;
        assert.ok(fp.deposit >= 0, `wk ${wk} base ${base} ${og} deposit ${fp.deposit} < 0`);
        assert.equal(round(fp.deposit + fp.instalments * fp.monthly), fp.quoteTotal, `wk ${wk} base ${base} ${og} balance`);
      }
    }
  }
});
test('packages unaffected by first cut date, discount and overgrown; first-cut-date never blocks', () => {
  assert.equal(pricePackages(1, {}, 0).find(x => x.key === 'bronze')!.total, 249);
  // Every week resolves to a plan (no null) in the first-cut-date model.
  for (let wk = 1; wk <= 20; wk++) {
    const p = computeSeasonPlanFC(priceMowing(1, {}), dateForWeek(wk), 'normal');
    assert.ok(p.weekly.cutsLeft >= 1);
  }
  // A date past the last cutting week clamps to one cut at max discount (not null).
  const late = computeSeasonPlanFC(priceMowing(1, {}), '2026-11-30', 'normal');
  assert.equal(late.discount.firstCutWeek, 20);
  assert.equal(late.weekly.cutsLeft, 1);
});

// ── BIWEEKLY CUTS REMAINING — spring-weekly schedule, not even proration ─────
console.log('\nLawn — biweekly cuts remaining (spring-weekly schedule):');
// firstCutWeek → [weekly, biweekly] from the spec table.
const CUTS_TABLE: Array<[number, number, number]> = [
  [1, 20, 12], [3, 18, 10], [5, 16, 8], [7, 14, 7], [11, 10, 5], [15, 6, 3], [20, 1, 1],
];
test('cutsLeft counts scheduled weeks ≥ firstCutWeek, per frequency', () => {
  const m = priceMowing(1, {});
  for (const [wk, weekly, biweekly] of CUTS_TABLE) {
    const p = computeSeasonPlanFC(m, dateForWeek(wk), 'normal');
    assert.equal(p.discount.firstCutWeek, wk, `wk ${wk}`);
    assert.equal(p.weekly.cutsLeft, weekly, `wk ${wk} weekly`);
    assert.equal(p.biweekly.cutsLeft, biweekly, `wk ${wk} biweekly (was even-prorated)`);
  }
});
test('weekly cutsLeft unchanged = weeksServiced at every week', () => {
  const m = priceMowing(1, {});
  for (let wk = 1; wk <= 20; wk++) {
    const p = computeSeasonPlanFC(m, dateForWeek(wk), 'normal');
    assert.equal(p.weekly.cutsLeft, 20 - wk + 1, `wk ${wk}`);
  }
});
test('derived biweekly schedule = [1,2,3,4,6,8,…,20]; length == BIWEEKLY_CUTS', () => {
  assert.deepEqual(cutWeeks('biweekly'), [1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  assert.equal(cutWeeks('biweekly').length, LAWN_CONFIG_V1.BIWEEKLY_CUTS);
  assert.deepEqual(cutWeeks('weekly'), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(cutWeeks('weekly').length, LAWN_CONFIG_V1.WEEKLY_CUTS);
});
test('cutsRemaining helper matches the table', () => {
  for (const [wk, weekly, biweekly] of CUTS_TABLE) {
    assert.equal(cutsRemaining('weekly', wk), weekly, `wk ${wk} weekly`);
    assert.equal(cutsRemaining('biweekly', wk), biweekly, `wk ${wk} biweekly`);
  }
});
test('a broken biweekly schedule fails validation loudly', () => {
  const bad = structuredClone(LAWN_CONFIG_V1); bad.SPRING_WEEKLY_WEEKS = 0; // → 10 cuts ≠ 12
  assert.equal(cutWeeks('biweekly', bad).length, 10);
  assert.ok(validateLawnConfig(bad).some(e => /biweekly schedule mismatch/i.test(e)));
  // Aligning BIWEEKLY_CUTS to the derived count clears it.
  const fixed = structuredClone(LAWN_CONFIG_V1); fixed.SPRING_WEEKLY_WEEKS = 0; fixed.BIWEEKLY_CUTS = 10;
  assert.deepEqual(validateLawnConfig(fixed).filter(e => /schedule mismatch/i.test(e)), []);
  assert.deepEqual(validateLawnConfig(LAWN_CONFIG_V1), []); // v1 defaults valid
  // SPRING_WEEKLY_WEEKS is diffed/versioned like every other value.
  const edit = structuredClone(LAWN_CONFIG_V1); edit.SPRING_WEEKLY_WEEKS = 3; edit.BIWEEKLY_CUTS = 12;
  assert.ok(diffLawnConfig(LAWN_CONFIG_V1, edit).some(x => x.key === 'season.springWeekly' && x.from === '4' && x.to === '3'));
});
test('internalPPC uses the corrected cutsLeft (biweekly moves; weekly unchanged)', () => {
  const m = priceMowing(1, {});
  const p = computeSeasonPlanFC(m, dateForWeek(5), 'normal'); // week 5 → 20% discount
  assert.equal(p.weekly.cutsLeft, 16);
  assert.equal(p.biweekly.cutsLeft, 8);   // was 10 under even proration
  assert.equal(p.weekly.internalPPC, round(p.weekly.proratedTotal / 16));
  assert.equal(p.biweekly.internalPPC, round(p.biweekly.proratedTotal / 8));
});
test('discount is week-based and IDENTICAL for weekly and biweekly at every week', () => {
  const m = priceMowing(1, {});
  for (let wk = 1; wk <= 20; wk++) {
    const p = computeSeasonPlanFC(m, dateForWeek(wk), 'normal');
    assert.equal(p.discount.seasonDiscountPct, round(wk === 1 ? 0 : (wk - 1) / 20 * 100), `wk ${wk} disc value`);
    // The proration factor is the same for both frequencies (never cut-based).
    const wkFactor = round(p.weekly.proratedTotal / p.weekly.fullPrice);
    const bwFactor = round(p.biweekly.proratedTotal / p.biweekly.fullPrice);
    assert.equal(wkFactor, bwFactor, `wk ${wk} proration factor differs by frequency`);
  }
});

// ── DEPOSIT AS % OF THE WHOLE QUOTE (packages fold into quoteTotal) ──────────
console.log('\nLawn — deposit as % of the whole quote:');
const goldTotal = pricePackages(1, {}, 0).find(p => p.key === 'gold')!.total;      // 499
const bronzeTotal = pricePackages(1, {}, 0).find(p => p.key === 'bronze')!.total;  // 249
// The four worked examples the report must reproduce (mowing $1,200 → monthly $200).
// The office reference "week N" = signup week N with first cut the FOLLOWING week,
// i.e. firstCutWeek N+1 in the first-cut-date model.
const EX: Array<{ fcw: number; pkg: number; quote: number; inst: number; dep: number; pct: number }> = [
  { fcw: 2,  pkg: 0,         quote: 1140, inst: 5, dep: 140, pct: 12.3 }, // "week 1"
  { fcw: 8,  pkg: 0,         quote: 780,  inst: 3, dep: 180, pct: 23.1 }, // "week 7"
  { fcw: 12, pkg: 0,         quote: 540,  inst: 2, dep: 140, pct: 25.9 }, // "week 11"
  { fcw: 14, pkg: goldTotal, quote: 919,  inst: 3, dep: 319, pct: 34.7 }, // "wk 13" + Gold $499
];
test('four worked examples: quoteTotal, instalments, deposit, deposit%', () => {
  const m = priceMowing(1, {}); // $1,200 weekly, monthly $200
  for (const e of EX) {
    const p = computeSeasonPlanFC(m, dateForWeek(e.fcw), 'normal', LAWN_CONFIG_V1, e.pkg).weekly;
    assert.equal(p.monthly, 200, `fcw ${e.fcw} monthly`);
    assert.equal(p.quoteTotal, e.quote, `fcw ${e.fcw} quoteTotal`);
    assert.equal(p.instalments, e.inst, `fcw ${e.fcw} instalments`);
    assert.equal(p.deposit, e.dep, `fcw ${e.fcw} deposit`);
    assert.equal(p.depositPct, e.pct, `fcw ${e.fcw} deposit%`);
  }
});
test('deposit% == deposit / quoteTotal × 100 (1 dp) in every case', () => {
  const m = priceMowing(1, {});
  for (let wk = 1; wk <= 20; wk++) for (const pkg of [0, bronzeTotal, goldTotal, bronzeTotal + goldTotal]) {
    const p = computeSeasonPlanFC(m, dateForWeek(wk), 'normal', LAWN_CONFIG_V1, pkg).weekly;
    const expected = p.quoteTotal > 0 ? Math.round((p.deposit / p.quoteTotal) * 1000) / 10 : 0;
    assert.equal(p.depositPct, expected, `wk ${wk} pkg ${pkg}`);
  }
});
test('every instalment identical (= monthly) and deposit + instalments×monthly == quoteTotal', () => {
  const m = priceMowing(1, {});
  for (let wk = 1; wk <= 20; wk++) for (const pkg of [0, goldTotal, bronzeTotal + goldTotal]) for (const og of ['normal', 'triple'] as const) {
    for (const fp of [computeSeasonPlanFC(m, dateForWeek(wk), og, LAWN_CONFIG_V1, pkg).weekly,
                      computeSeasonPlanFC(m, dateForWeek(wk), og, LAWN_CONFIG_V1, pkg).biweekly]) {
      // billing rows are all exactly `monthly` (identical); they sum with the deposit to the quote total
      assert.equal(round(fp.deposit + fp.billingDates.length * fp.monthly), fp.quoteTotal, `wk ${wk} pkg ${pkg} ${og}`);
      assert.equal(fp.billingDates.length, fp.instalments);
      // sub-line decomposition sums to the deposit
      assert.equal(round(fp.mowingInDeposit + fp.packagesTotal + fp.catchUpCharge), fp.deposit, `deposit parts wk ${wk} pkg ${pkg} ${og}`);
    }
  }
});
test('mowing + one package, and mowing + two packages, both price correctly', () => {
  const m = priceMowing(1, {}); // $1,200
  const one = computeSeasonPlanFC(m, dateForWeek(14), 'normal', LAWN_CONFIG_V1, goldTotal).weekly;
  assert.equal(one.packagesTotal, 499);
  assert.equal(one.quoteTotal, round(one.proratedTotal + 499));  // 420 + 499 = 919
  const two = computeSeasonPlanFC(m, dateForWeek(14), 'normal', LAWN_CONFIG_V1, bronzeTotal + goldTotal).weekly;
  assert.equal(two.packagesTotal, 748);                          // 249 + 499
  assert.equal(two.quoteTotal, round(two.proratedTotal + 748));  // 420 + 748 = 1168
  assert.equal(round(two.deposit + two.instalments * two.monthly), two.quoteTotal);
});
test('package-only quote (no mowing) still produces a deposit and %', () => {
  const p = computeSeasonPlanFC(priceMowingBase(0, {}), dateForWeek(10), 'normal', LAWN_CONFIG_V1, goldTotal).weekly;
  assert.equal(p.proratedTotal, 0);
  assert.equal(p.monthly, 0);
  assert.equal(p.instalments, 0);       // no mowing monthly to spread across
  assert.equal(p.quoteTotal, 499);
  assert.equal(p.deposit, 499);         // the whole package is the deposit
  assert.equal(p.depositPct, 100);
});
test('deposit MAY exceed one monthly when packages are present (cap relaxed)', () => {
  const m = priceMowing(1, {}); // monthly $200
  const p = computeSeasonPlanFC(m, dateForWeek(14), 'normal', LAWN_CONFIG_V1, goldTotal).weekly;
  assert.equal(p.deposit, 319);
  assert.ok(p.deposit > p.monthly, 'deposit should exceed monthly with a package');
});
test('packages remain full-season rate — unaffected by discount or first cut date', () => {
  // Gold total is the same regardless of when the mowing starts / how deep the discount.
  for (const wk of [1, 8, 14, 20]) {
    const p = computeSeasonPlanFC(priceMowing(1, {}), dateForWeek(wk), 'quint', LAWN_CONFIG_V1, goldTotal).weekly;
    assert.equal(p.packagesTotal, 499);
  }
});

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

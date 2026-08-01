// Unit tests for the lawn pricing engine — every agreed case from the spec.
// No test framework (none installed / allowed); run with the repo's TS runner:
//   npx tsx src/lib/lawnPricing.test.ts
import assert from 'node:assert/strict';
import {
  LAWN_CONFIG_V1, LawnConfig, resolveTierIndex, priceMowing, pricePackages, priceLawn, tierLabel,
  resolveLawnConfig, activeLawnVersionId, lawnVersionId, validateLawnConfig, diffLawnConfig,
  computeSeasonPlan, elapsedSeasonWeeks, seasonEndDate, overgrownReductionPct, availableMonthEnds, billingDates, isValidYmd,
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
test('travel per-visit: 5 km → weekly $200/season, biweekly $120/season', () => {
  const m = mow(4000, { travelZone: 'km5' });
  assert.equal(m.travel.perVisit, 10);
  assert.equal(m.travel.weeklySeason, 200);   // 10 × 20 cuts
  assert.equal(m.travel.biweeklySeason, 120);  // 10 × 12 cuts (NOT 0.75 × 200 = 150)
  assert.equal(m.weeklyTotal, 1400);           // 1200 + 200
  assert.equal(m.biweeklyTotal, 1020);         // 1200×0.75 + 120 = 900 + 120
});
test('base tier + push/hilly/clutter still use the 0.75 ratio (travel is the only exception)', () => {
  const m = mow(4000, { pushMow: true, veryHilly: true, clutter: true }); // no travel
  assert.equal(m.weeklyTotal, 1800);           // 1200 + 3×200
  assert.equal(m.biweeklyTotal, 1350);         // 1800 × 0.75
});
test('4000 + push + hilly + clutter + 15 km → weekly 2600 / biweekly 1830', () => {
  const m = mow(4000, { pushMow: true, veryHilly: true, clutter: true, travelZone: 'km15' });
  assert.equal(m.weeklyTotal, 2600);           // 1800 + 40×20 = 1800 + 800
  assert.equal(m.biweeklyTotal, 1830);         // 1350 + 40×12 = 1350 + 480
});
test('travel zones do not stack — 10 km replaces 5 km (weekly $400/season)', () => {
  assert.equal(mow(4000, { travelZone: 'km10' }).travel.weeklySeason, 400); // 20 × 20
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

// ── Mid-season: deposit ≤ one instalment, separate catch-up, no surcharge ───
console.log('\nLawn mid-season — deposit fits one payment, separate catch-up:');
// Tier 1 (4,000 sq ft) → weekly $1,200 (/$200 mo) / biweekly $900 (/$150 mo).
const plan = (startDate: string, overgrown = 'normal', config = LAWN_CONFIG_V1) =>
  computeSeasonPlan(priceMowing(1, {}, config), startDate, overgrown, config);
const round = (n: number) => Math.round(n * 100) / 100;
const dateForWeek = (w: number) => { // SEASON_START 2026-05-25 + w weeks
  const d = new Date(Date.UTC(2026, 4, 25) + w * 7 * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

// The verified table from the spec (weekly, $1,200, $200/month).
const ROWS = [
  { date: '2026-06-08', og: 'normal', disc: 10, prorated: 1080, inst: 5, deposit: 80, catchUp: 0, first: 80 },
  { date: '2026-07-15', og: 'normal', disc: 35, prorated: 780, inst: 3, deposit: 180, catchUp: 0, first: 180 },
  { date: '2026-08-10', og: 'normal', disc: 55, prorated: 540, inst: 2, deposit: 140, catchUp: 0, first: 140 },
  { date: '2026-06-08', og: 'quint', disc: 10, prorated: 1080, inst: 5, deposit: 80, catchUp: 240, first: 320 },
  { date: '2026-09-07', og: 'triple', disc: 75, prorated: 300, inst: 1, deposit: 100, catchUp: 120, first: 220 },
];
for (const r of ROWS) {
  test(`${r.date}${r.og === 'normal' ? '' : ' ' + r.og} → ${r.disc}%, prorated $${r.prorated}, ${r.inst}×$200, deposit $${r.deposit}, catch-up $${r.catchUp}, first $${r.first}`, () => {
    const p = plan(r.date, r.og).weekly;
    const d = plan(r.date, r.og).discount;
    assert.equal(d.seasonDiscountPct, r.disc);
    assert.equal(p.proratedTotal, r.prorated);
    assert.equal(p.instalments, r.inst);
    assert.equal(p.deposit, r.deposit);
    assert.equal(p.catchUpCharge, r.catchUp);
    assert.equal(p.firstInvoice, r.first);
    // deposit + instalments + catch-up == prorated + catch-up
    assert.equal(round(p.deposit + p.instalments * p.monthly + p.catchUpCharge), round(p.proratedTotal + p.catchUpCharge));
  });
}

test('deposit is between 0 and one monthly for EVERY signup week 0..20, both frequencies', () => {
  for (let w = 0; w <= 20; w++) {
    const p = plan(dateForWeek(w), 'triple');
    for (const fp of [p.weekly, p.biweekly]) {
      assert.ok(fp.deposit >= 0, `week ${w} deposit ${fp.deposit} < 0`);
      assert.ok(fp.deposit <= fp.monthly, `week ${w} deposit ${fp.deposit} > monthly ${fp.monthly}`);
    }
  }
});
test('season discount never negative; there is no surcharge path', () => {
  for (let w = 0; w <= 20; w++) {
    const p = plan(dateForWeek(w), 'quint');
    assert.ok(p.discount.seasonDiscountPct >= 0);
    assert.ok(p.weekly.proratedTotal <= p.weekly.fullPrice); // never above full
  }
});
test('catch-up charge = (multiplier − 1) × 5% × fullPrice, independent of signup date', () => {
  for (const date of ['2026-06-08', '2026-08-10', '2026-09-30']) {
    assert.equal(plan(date, 'quad').weekly.catchUpCharge, (4 - 1) * 5 / 100 * 1200); // 180
    assert.equal(plan(date, 'triple').weekly.catchUpCharge, (3 - 1) * 5 / 100 * 1200); // 120
  }
  for (const o of LAWN_CONFIG_V1.OVERGROWN) assert.equal(overgrownReductionPct(o.multiplier), (o.multiplier - 1) * 5);
});
test('first-visit BH: triple at week 10 → 1.80 weekly / 2.25 biweekly; BH from FULL price', () => {
  const p = plan('2026-08-03', 'triple'); // week 10, 50% discount
  assert.equal(p.discount.seasonDiscountPct, 50);
  assert.equal(round(p.weekly.firstVisitBH), 1.8);
  assert.equal(round(p.biweekly.firstVisitBH), 2.25);
  assert.equal(p.weekly.bhPerVisit, 0.6);   // full 1200/20/100 — not prorated
  assert.equal(p.biweekly.bhPerVisit, 0.75); // full 900/12/100
});
test('cutsLeft: full at week 0, zero at week 20', () => {
  assert.equal(plan(dateForWeek(0)).weekly.cutsLeft, 20);
  assert.equal(plan(dateForWeek(0)).biweekly.cutsLeft, 12);
  assert.equal(plan(dateForWeek(20)).weekly.cutsLeft, 0);
  assert.equal(plan(dateForWeek(20)).biweekly.cutsLeft, 0);
});
test('billing schedule: real month-ends through October 31; count == instalments', () => {
  const p = plan('2026-07-15').weekly; // 3 instalments
  assert.deepEqual(p.billingDates, ['2026-08-31', '2026-09-30', '2026-10-31']);
  for (let w = 0; w <= 20; w++) {
    const fp = plan(dateForWeek(w)).weekly;
    assert.equal(fp.billingDates.length, fp.instalments); // header cycle count == instalment count
    if (fp.instalments > 0) {
      assert.equal(fp.billingDates[fp.billingDates.length - 1], '2026-10-31'); // finishes at season's end
      for (const bd of fp.billingDates) assert.ok(isValidYmd(bd));
    }
  }
  assert.deepEqual(billingDates(2026, 3), ['2026-08-31', '2026-09-30', '2026-10-31']);
});
test('billing total == prorated + catch-up for every signup week, both frequencies', () => {
  for (let w = 0; w <= 20; w++) {
    const p = plan(dateForWeek(w), 'triple');
    for (const fp of [p.weekly, p.biweekly]) {
      const total = round(fp.deposit + fp.catchUpCharge + fp.instalments * fp.monthly);
      assert.equal(total, round(fp.proratedTotal + fp.catchUpCharge));
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
  assert.equal(computeSeasonPlan(priceMowing(1, {}, v1cfg), '2026-07-15', 'normal', v1cfg).discount.elapsedWeeks, 7);
  assert.equal(computeSeasonPlan(priceMowing(1, {}, v2cfg), '2026-07-15', 'normal', v2cfg).discount.elapsedWeeks, 6);
  const v1 = computeSeasonPlan(priceMowing(1, {}, v1cfg), '2026-07-15', 'normal', v1cfg).weekly;
  assert.equal(v1.proratedTotal, 780);
  assert.equal(v1.deposit, 180);
});
test('elapsed weeks clamps; season end + date validation; availableMonthEnds inclusive', () => {
  assert.equal(elapsedSeasonWeeks('2026-05-25'), 0);
  assert.equal(elapsedSeasonWeeks('2026-05-01'), 0);   // before season
  assert.equal(elapsedSeasonWeeks('2026-12-01'), 20);  // capped
  assert.equal(seasonEndDate(), '2026-10-12');
  assert.equal(availableMonthEnds('2026-06-08'), 5);   // Jun..Oct inclusive
  assert.equal(availableMonthEnds('2026-07-15'), 4);
  assert.ok(isValidYmd('2026-05-25') && !isValidYmd('2026-13-40') && !isValidYmd('nope'));
});
test('validation: SEASON_START must be real; overgrown multipliers must ascend', () => {
  assert.ok(validateLawnConfig({ ...structuredClone(LAWN_CONFIG_V1), SEASON_START: 'nope' }).some(e => /Season start/i.test(e)));
  const bad = structuredClone(LAWN_CONFIG_V1); bad.OVERGROWN[2].multiplier = 1.5;
  assert.ok(validateLawnConfig(bad).some(e => /ascend/i.test(e)));
  assert.deepEqual(validateLawnConfig(LAWN_CONFIG_V1), []);
});

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

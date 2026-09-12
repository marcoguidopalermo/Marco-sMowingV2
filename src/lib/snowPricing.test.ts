// Unit tests for the snow pricing engine — the agreed cases from the spec.
// No test framework (none is installed / allowed); run with the repo's existing
// TS runner:  npx tsx src/lib/snowPricing.test.ts
// Exits non-zero if any case fails (vitest reports per-case).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  priceSnow, measureGrid, SNOW_PRICING_CONFIG, SNOW_CONFIG_V1, SNOW_PRICING_CONFIG_VERSION, SnowGrid, SnowConfig,
  resolveSnowConfig, activeSnowVersionId, snowVersionId, validateSnowConfig, diffSnowConfig, StoredSnowVersion, noBoulevardRate, activeModifiers, breakdownOfSaved,
  sharedDrivewayRate, secondDrivewayRate, SNOW_FIELD_LABELS,
  premiumRate, premiumSplit, premiumShareNote,
} from './snowPricing';

const ROWS = 6;
const COLS = 4;

// Build a full `lanes × depth` rectangle on a 6×4 grid: the first `lanes`
// columns each get `depth` filled (open) cells, anchored at the street (bottom)
// end. cars = lanes*depth, which matches the spec table.
function shape(lanes: number, depth: number): SnowGrid {
  const g: number[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  for (let c = 0; c < lanes; c++) for (let d = 0; d < depth; d++) g[ROWS - 1 - d][c] = 1;
  return g;
}
// Flip the first `n` open cells (scanning top-to-bottom, left-to-right) to drag.
function withDrag(grid: SnowGrid, n: number): SnowGrid {
  const g = grid.map((r) => [...r]);
  let left = n;
  for (let r = 0; r < g.length && left > 0; r++)
    for (let c = 0; c < g[r].length && left > 0; c++)
      if (g[r][c] === 1) { g[r][c] = 2; left--; }
  return g;
}



// ── The agreed table: shape → lanes×depth, cars, tier, price ────────────────
const TABLE: Array<{ name: string; lanes: number; depth: number; cars: number; tier: 1|2|3|'custom'; price: number }> = [
  { name: 'Single',        lanes: 1, depth: 1, cars: 1,  tier: 1,        price: 599 },
  { name: 'Tandem',        lanes: 1, depth: 2, cars: 2,  tier: 1,        price: 599 },
  { name: 'Deep single',   lanes: 1, depth: 3, cars: 3,  tier: 1,        price: 599 },
  { name: 'Long single',   lanes: 1, depth: 4, cars: 4,  tier: 2,        price: 699 },
  { name: 'Laneway',       lanes: 1, depth: 5, cars: 5,  tier: 2,        price: 699 },
  { name: 'Double wide',   lanes: 2, depth: 1, cars: 2,  tier: 1,        price: 599 },
  { name: 'Double square', lanes: 2, depth: 2, cars: 4,  tier: 2,        price: 699 },
  { name: 'Double deep',   lanes: 2, depth: 3, cars: 6,  tier: 3,        price: 799 },
  { name: 'Quad double',   lanes: 2, depth: 4, cars: 8,  tier: 3,        price: 799 },
  { name: 'Estate',        lanes: 2, depth: 5, cars: 10, tier: 3,        price: 799 },
  { name: 'Triple wide',   lanes: 3, depth: 1, cars: 3,  tier: 2,        price: 699 },
  { name: 'Triple',        lanes: 3, depth: 2, cars: 6,  tier: 3,        price: 799 },
  { name: 'Triple triple', lanes: 3, depth: 3, cars: 9,  tier: 'custom', price: 999 },
  { name: 'Estate L',      lanes: 3, depth: 4, cars: 12, tier: 'custom', price: 999 },
];

console.log('Snow pricing — agreed shape table:');
for (const row of TABLE) {
  test(`${row.name} (${row.lanes}×${row.depth}, ${row.cars} cars) → tier ${row.tier} @ ${row.price}`, () => {
    const p = priceSnow(shape(row.lanes, row.depth));
    assert.ok(p, 'expected a price');
    assert.equal(p!.lanes, row.lanes, 'lanes');
    assert.equal(p!.depth, row.depth, 'depth');
    assert.equal(p!.cars, row.cars, 'cars');
    assert.equal(p!.tier, row.tier, 'tier');
    if (row.tier === 'custom') {
      assert.equal(p!.total, null, 'custom total should be null');
      assert.equal(p!.floor, row.price, 'custom floor');
    } else {
      assert.equal(p!.total, row.price, 'total');
    }
  });
}

console.log('\nSnow pricing — drag + add-ons + edge cases:');

test('1×3 with rear 2 spots dragged, DRAG_RATE 50 → 699', () => {
  const p = priceSnow(withDrag(shape(1, 3), 2));
  assert.equal(p!.dragCount, 2);
  assert.equal(p!.tier, 1);
  assert.equal(p!.addBreakdown.drag, 100);
  assert.equal(p!.total, 699);
});

test('2×4 with 2 dragged, DRAG_RATE 50 → 899', () => {
  const p = priceSnow(withDrag(shape(2, 4), 2));
  assert.equal(p!.dragCount, 2);
  assert.equal(p!.tier, 3);
  assert.equal(p!.total, 899);
});

test('2×2 + 2 drag + busy road + $200 danger + Premium → 1299', () => {
  const p = priceSnow(withDrag(shape(2, 2), 2), { premium: true, busyRoad: true, danger: 200 });
  assert.equal(p!.tier, 2);
  assert.equal(p!.addBreakdown.drag, 100);
  assert.equal(p!.addBreakdown.premium, 200);
  assert.equal(p!.addBreakdown.busyRoad, 100);
  assert.equal(p!.addBreakdown.danger, 200);
  assert.equal(p!.total, 1299);
});

test('3×3 + 2 drag + $100 danger → Custom, floor 1199', () => {
  const p = priceSnow(withDrag(shape(3, 3), 2), { danger: 100 });
  assert.equal(p!.isCustom, true);
  assert.equal(p!.tier, 'custom');
  assert.equal(p!.total, null);
  assert.equal(p!.floor, 1199);
});

test('Empty grid → null, no crash', () => {
  assert.equal(priceSnow([]), null);
  assert.equal(priceSnow(Array.from({ length: ROWS }, () => Array(COLS).fill(0))), null);
});

test('All cells dragged with DRAG_COUNTS_TOWARD_SIZE=false → falls back, still prices', () => {
  const cfg: SnowConfig = { ...SNOW_CONFIG_V1, DRAG_COUNTS_TOWARD_SIZE: false };
  const allDrag: number[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(2));
  const p = priceSnow(allDrag, {}, cfg);
  assert.ok(p, 'should still return a price (fallback), not null');
  // Fallback counts every filled cell: 4 lanes → custom.
  assert.equal(p!.lanes, COLS);
  assert.equal(p!.depth, ROWS);
  assert.equal(p!.isCustom, true);
  assert.equal(p!.dragCount, ROWS * COLS);
  assert.equal(p!.floor, cfg.CUSTOM_FLOOR + ROWS * COLS * cfg.DRAG_RATE);
});

test('measureGrid: dragCount ignores the flag; cars always counts 1 or 2', () => {
  const g = withDrag(shape(1, 3), 2); // 1 open + 2 drag
  const m = measureGrid(g);
  assert.equal(m.cars, 3);
  assert.equal(m.dragCount, 2);
});

test('every priced result is stamped with the config version', () => {
  const p = priceSnow(shape(1, 1), {}, SNOW_CONFIG_V1, SNOW_PRICING_CONFIG_VERSION);
  assert.equal(p!.pricingConfigVersion, SNOW_PRICING_CONFIG_VERSION);
});

console.log('\nSnow pricing — config versioning + historical resolution:');

// A v2 config where Tier 1 rose 599 → 649 and drag rose 50 → 60.
const V2: SnowConfig = { ...SNOW_CONFIG_V1, TIER_1: 649, DRAG_RATE: 60 };
const versions: Record<string, StoredSnowVersion> = {
  // v1 is the implicit hard-coded baseline (never stored); only v2 is a doc.
  'snow-v2': { version: 'snow-v2', config: V2 },
};

test('resolveSnowConfig: v1 falls back to defaults, v2 returns the stored doc', () => {
  assert.equal(resolveSnowConfig('snow-v1', versions).TIER_1, 599);
  assert.equal(resolveSnowConfig('snow-v2', versions).TIER_1, 649);
  // Unknown / missing → defaults (never fail to price).
  assert.equal(resolveSnowConfig('snow-v9', versions).TIER_1, 599);
  assert.equal(resolveSnowConfig(undefined, null).TIER_1, 599);
});

test('activeSnowVersionId: empty → v1, else the highest version', () => {
  assert.equal(activeSnowVersionId({}), 'snow-v1');
  assert.equal(activeSnowVersionId(versions), 'snow-v2');
  assert.equal(snowVersionId(3), 'snow-v3');
});

test('HISTORICAL RESOLUTION: an April (v1) quote keeps its price after an August (v2) rate change', () => {
  const g = shape(1, 1); // Tier 1 single
  // Quoted in April under v1.
  const april = priceSnow(g, {}, resolveSnowConfig('snow-v1', versions), 'snow-v1');
  assert.equal(april!.total, 599);
  assert.equal(april!.pricingConfigVersion, 'snow-v1');
  // August: rates are now v2. A NEW quote of the same driveway prices higher.
  const augustNew = priceSnow(g, {}, resolveSnowConfig('snow-v2', versions), 'snow-v2');
  assert.equal(augustNew!.total, 649);
  // The April quote, re-resolved against ITS version, still shows April's price.
  const aprilReopened = priceSnow(g, {}, resolveSnowConfig('snow-v1', versions), 'snow-v1');
  assert.equal(aprilReopened!.total, 599, 'historical quote must NOT reprice to 649');
});

test('HISTORICAL RESOLUTION: drag add-on resolves per version', () => {
  const g = withDrag(shape(1, 3), 2); // Tier 1 + 2 drag
  assert.equal(priceSnow(g, {}, resolveSnowConfig('snow-v1', versions), 'snow-v1')!.total, 699); // 599 + 2×50
  assert.equal(priceSnow(g, {}, resolveSnowConfig('snow-v2', versions), 'snow-v2')!.total, 769); // 649 + 2×60
});

console.log('\nSnow pricing — validation + audit diff:');

test('validateSnowConfig: accepts v1 defaults', () => {
  assert.deepEqual(validateSnowConfig(SNOW_CONFIG_V1), []);
});

test('validateSnowConfig: rejects non-positive tier, negative add-on, bad danger ladder', () => {
  assert.ok(validateSnowConfig({ ...SNOW_CONFIG_V1, TIER_1: 0 }).length > 0);
  assert.ok(validateSnowConfig({ ...SNOW_CONFIG_V1, PREMIUM: -1 }).length > 0);
  assert.ok(validateSnowConfig({ ...SNOW_CONFIG_V1, DANGER_OPTIONS: [] }).length > 0);
  assert.ok(validateSnowConfig({ ...SNOW_CONFIG_V1, DANGER_OPTIONS: [0, 100, 50] }).length > 0); // not ascending
});

test('diffSnowConfig: reports only changed fields, old → new', () => {
  const changes = diffSnowConfig(SNOW_CONFIG_V1, V2);
  assert.equal(changes.length, 2);
  const t1 = changes.find(c => c.key === 'TIER_1')!;
  assert.equal(t1.from, '599'); assert.equal(t1.to, '649');
  const dr = changes.find(c => c.key === 'DRAG_RATE')!;
  assert.equal(dr.from, '50'); assert.equal(dr.to, '60');
  assert.deepEqual(diffSnowConfig(SNOW_CONFIG_V1, SNOW_CONFIG_V1), []); // no-op
});

console.log('\nNo-boulevard discount — per lane, applied last');
const drive = (lanes: number, depth: number): number[][] =>
  Array.from({ length: depth }, () => Array.from({ length: lanes }, () => 1));

test('subtracts the per-lane rate for every lane', () => {
  const one = priceSnow(drive(1, 3), { noBoulevard: true });
  const two = priceSnow(drive(2, 3), { noBoulevard: true });
  assert.equal(one!.addBreakdown.noBoulevard, -50);
  assert.equal(two!.addBreakdown.noBoulevard, -100, 'a double-lane driveway saves twice');
  assert.equal(two!.addBreakdown.noBoulevardLanes, 2);
});
test('off by default — an untoggled quote prices exactly as before', () => {
  const off = priceSnow(drive(2, 3), {});
  assert.equal(off!.addBreakdown.noBoulevard, 0);
  assert.equal(off!.addBreakdown.noBoulevardLanes, 0);
});
test('THE ORDER: base + surcharges, then the discount, on the TOTAL', () => {
  const plain = priceSnow(drive(2, 3), { busyRoad: true, danger: 100 })!;
  const disc = priceSnow(drive(2, 3), { busyRoad: true, danger: 100, noBoulevard: true })!;
  // Exactly lanes × rate apart, regardless of how large the surcharges are.
  assert.equal(plain.total! - disc.total!, 2 * 50);
  assert.equal(disc.basePrice, plain.basePrice, 'the tier base is untouched');
  assert.equal(disc.tier, plain.tier, 'and a driveway never drops a tier for it');
});
test('it composes with drag, busy road and danger rather than replacing them', () => {
  const p = priceSnow(drive(2, 3), { busyRoad: true, danger: 50, noBoulevard: true })!;
  const b = p.addBreakdown;
  assert.equal(b.busyRoad > 0, true);
  assert.equal(b.danger, 50);
  assert.equal(b.noBoulevard, -100);
  assert.equal(p.adds, b.drag + b.premium + b.busyRoad + b.danger + b.noBoulevard);
  assert.equal(p.total, p.basePrice + p.adds);
});
test('the total floors at zero — a discount can never produce a negative quote', () => {
  const wide = priceSnow(drive(40, 1), { noBoulevard: true });
  if (wide && wide.total !== null) assert.ok(wide.total >= 0, `got ${wide.total}`);
});
test('a config version stored before the discount existed still prices', () => {
  // resolveSnowConfig returns the stored config wholesale, so an older version
  // has no NO_BOULEVARD_PER_LANE key. Undefined there would make the whole
  // total NaN.
  const legacy = { ...SNOW_CONFIG_V1 } as any;
  delete legacy.NO_BOULEVARD_PER_LANE;
  assert.equal(noBoulevardRate(legacy), 50, 'falls back to the v1 rate');
  const p = priceSnow(drive(2, 3), { noBoulevard: true }, legacy);
  assert.equal(Number.isFinite(p!.total!), true);
  assert.equal(p!.addBreakdown.noBoulevard, -100);
});

console.log('\nActive modifiers — derived from the breakdown, never a parallel list');
test('only what actually affected the price appears', () => {
  const p = priceSnow(drive(2, 3), { busyRoad: true, danger: 50, noBoulevard: true })!;
  const mods = activeModifiers(p.addBreakdown, p, SNOW_CONFIG_V1);
  const keys = mods.map(m => m.key).sort();
  assert.deepEqual(keys, ['busyRoad', 'danger', 'noBoulevard']);
  assert.ok(!keys.includes('premium'), 'an unused modifier does not appear at all');
});
test('nothing applied yields an empty list, not a row of zeroes', () => {
  const p = priceSnow(drive(2, 3), {})!;
  assert.deepEqual(activeModifiers(p.addBreakdown, p, SNOW_CONFIG_V1), []);
});
test('THE INVARIANT: the summary sums to exactly the adds the total used', () => {
  // If these can drift, the quote can show one thing and charge another.
  const p = priceSnow(drive(2, 4), { busyRoad: true, danger: 100, noBoulevard: true })!;
  const mods = activeModifiers(p.addBreakdown, p, SNOW_CONFIG_V1);
  assert.equal(mods.reduce((s, m) => s + m.amount, 0), p.adds);
  assert.equal(p.basePrice + mods.reduce((s, m) => s + m.amount, 0), p.total);
});
test('signs are preserved — a discount is negative, a surcharge positive', () => {
  const p = priceSnow(drive(2, 3), { busyRoad: true, noBoulevard: true })!;
  const mods = activeModifiers(p.addBreakdown, p, SNOW_CONFIG_V1);
  assert.ok(mods.find(m => m.key === 'noBoulevard')!.amount < 0);
  assert.ok(mods.find(m => m.key === 'busyRoad')!.amount > 0);
});
test('the no-boulevard label names the lanes it was computed over', () => {
  const p = priceSnow(drive(3, 3), { noBoulevard: true })!;
  const m = activeModifiers(p.addBreakdown, p, SNOW_CONFIG_V1).find(x => x.key === 'noBoulevard')!;
  assert.match(m.label, /3 lanes/);
  assert.equal(m.amount, -150);
});

console.log('\nA SAVED quote rebuilds the same modifiers');
test('breakdownOfSaved matches what the live price produced', () => {
  const live = priceSnow(drive(2, 3), { busyRoad: true, danger: 50, noBoulevard: true })!;
  // What the saved record carries.
  const saved = { lanes: live.lanes, dragCount: live.dragCount, busyRoad: true, danger: 50, noBoulevard: true };
  const rebuilt = breakdownOfSaved(saved, SNOW_CONFIG_V1);
  assert.deepEqual(rebuilt, live.addBreakdown, 'a reopened quote cannot describe a different set');
});
test('a saved quote with no modifiers rebuilds to none', () => {
  const rebuilt = breakdownOfSaved({ lanes: 2, dragCount: 0 }, SNOW_CONFIG_V1);
  assert.deepEqual(activeModifiers(rebuilt, { dragCount: 0 }, SNOW_CONFIG_V1), []);
});
test('an older config version rebuilds against ITS rates, not the current ones', () => {
  const cheap = { ...SNOW_CONFIG_V1, BUSY_ROAD: 40, NO_BOULEVARD_PER_LANE: 20 };
  const rebuilt = breakdownOfSaved({ lanes: 2, dragCount: 0, busyRoad: true, noBoulevard: true }, cheap);
  assert.equal(rebuilt.busyRoad, 40);
  assert.equal(rebuilt.noBoulevard, -40);
});

console.log('\nTHE TWO DRIVEWAY DISCOUNTS ARE RATE-SHEET RATES:');

// A version where ONLY the two driveway discounts moved, and moved APART —
// shared to 150, second to 75. The whole point of two separate fields.
const V3: SnowConfig = { ...SNOW_CONFIG_V1, SHARED_DRIVEWAY: 150, SECOND_DRIVEWAY: 75 };
const dversions: Record<string, StoredSnowVersion> = {
  'snow-v2': { version: 'snow-v2', config: V2 },
  'snow-v3': { version: 'snow-v3', config: V3 },
};

test('the price reads both discounts from the config, not from a literal', () => {
  const g = shape(1, 1);                               // Tier 1, 599
  const c3 = resolveSnowConfig('snow-v3', dversions);
  assert.equal(priceSnow(g, { sharedDriveway: true }, c3)!.total, 599 - 150);
  assert.equal(priceSnow(g, { secondDriveway: true }, c3)!.total, 599 - 75);
  // Both at once (a shared driveway that is also somebody's second) stacks.
  assert.equal(priceSnow(g, { sharedDriveway: true, secondDriveway: true }, c3)!.total, 599 - 225);
});

test('THEY DIVERGE WITHOUT A CODE CHANGE — that is why they are two fields', () => {
  const c3 = resolveSnowConfig('snow-v3', dversions);
  assert.equal(sharedDrivewayRate(c3), 150);
  assert.equal(secondDrivewayRate(c3), 75);
  assert.notEqual(sharedDrivewayRate(c3), secondDrivewayRate(c3), 'one rate could not do this');
  // Equal today, and that is a coincidence of the seed, not a constraint.
  assert.equal(sharedDrivewayRate(SNOW_CONFIG_V1), 100);
  assert.equal(secondDrivewayRate(SNOW_CONFIG_V1), 100);
});

test('A SAVED QUOTE HOLDS THE DISCOUNT IT WAS QUOTED AT, through a rate change', () => {
  const g = shape(1, 1);
  // Quoted under v1, when the shared discount was 100.
  const quoted = priceSnow(g, { sharedDriveway: true }, resolveSnowConfig('snow-v1', dversions), 'snow-v1');
  assert.equal(quoted!.total, 499, '599 − 100');
  assert.equal(quoted!.pricingConfigVersion, 'snow-v1');
  // The sheet then moves the shared discount to 150 (v3 is now live).
  assert.equal(activeSnowVersionId(dversions), 'snow-v3');
  const fresh = priceSnow(g, { sharedDriveway: true }, resolveSnowConfig('snow-v3', dversions), 'snow-v3');
  assert.equal(fresh!.total, 449, 'a NEW quote gets the new discount: 599 − 150');
  // The old quote, re-resolved against ITS stamped version, is unchanged.
  const reopened = priceSnow(g, { sharedDriveway: true }, resolveSnowConfig('snow-v1', dversions), 'snow-v1');
  assert.equal(reopened!.total, 499, 'historical quote must NOT reprice to 449');
  assert.equal(reopened!.addBreakdown.sharedDriveway, -100, 'and its breakdown line holds too');
});

test('the SAVED breakdown resolves per version too — list rows match the quote', () => {
  // breakdownOfSaved is what the saved-list row and a reopened quote render
  // from. Handed the quote's own config it must reproduce the quoted amount.
  const saved = { lanes: 1, sharedDriveway: true, secondDriveway: true };
  const atV1 = breakdownOfSaved(saved, resolveSnowConfig('snow-v1', dversions));
  assert.equal(atV1.sharedDriveway, -100);
  assert.equal(atV1.secondDriveway, -100);
  const atV3 = breakdownOfSaved(saved, resolveSnowConfig('snow-v3', dversions));
  assert.equal(atV3.sharedDriveway, -150);
  assert.equal(atV3.secondDriveway, -75);
});

test('a config stored BEFORE the discounts existed still prices', () => {
  // The keys are optional, so an old stored version has neither. An undefined
  // straight into the arithmetic would make the whole total NaN.
  const ancient = { ...SNOW_CONFIG_V1 } as SnowConfig;
  delete ancient.SHARED_DRIVEWAY; delete ancient.SECOND_DRIVEWAY; delete ancient.NO_BOULEVARD_PER_LANE;
  assert.equal(sharedDrivewayRate(ancient), 100, 'falls back to the shipped default');
  assert.equal(secondDrivewayRate(ancient), 100);
  const t = priceSnow(shape(1, 1), { sharedDriveway: true, secondDriveway: true }, ancient)!.total;
  assert.ok(Number.isFinite(t), 'never NaN');
  assert.equal(t, 399);
});

test('BOTH RATES ARE AUDITED — the diff names them separately', () => {
  const changes = diffSnowConfig(SNOW_CONFIG_V1, V3);
  const byKey = Object.fromEntries(changes.map(c => [c.key, c]));
  assert.ok(byKey.SHARED_DRIVEWAY, 'shared shows in the audit trail');
  assert.ok(byKey.SECOND_DRIVEWAY, 'second shows in the audit trail');
  assert.equal(byKey.SHARED_DRIVEWAY.from, '100');
  assert.equal(byKey.SHARED_DRIVEWAY.to, '150');
  assert.equal(byKey.SECOND_DRIVEWAY.from, '100');
  assert.equal(byKey.SECOND_DRIVEWAY.to, '75');
  // Distinct human labels, or the audit history shows two rows reading alike.
  assert.notEqual(byKey.SHARED_DRIVEWAY.field, byKey.SECOND_DRIVEWAY.field);
  // Changing ONE leaves the other out of the diff entirely.
  const onlyShared = diffSnowConfig(SNOW_CONFIG_V1, { ...SNOW_CONFIG_V1, SHARED_DRIVEWAY: 150 });
  assert.deepEqual(onlyShared.map(c => c.key), ['SHARED_DRIVEWAY']);
});

test('every rate-sheet field has a label, or it cannot be audited', () => {
  for (const k of ['NO_BOULEVARD_PER_LANE', 'SHARED_DRIVEWAY', 'SECOND_DRIVEWAY'] as const) {
    assert.ok(SNOW_FIELD_LABELS[k], `${k} needs a label`);
  }
});

test('a NEGATIVE discount is rejected — it would flip into a surcharge', () => {
  assert.deepEqual(validateSnowConfig(SNOW_CONFIG_V1), []);
  const bad = validateSnowConfig({ ...SNOW_CONFIG_V1, SHARED_DRIVEWAY: -50 });
  assert.equal(bad.length, 1);
  assert.match(bad[0], /Shared driveway/);
  assert.match(validateSnowConfig({ ...SNOW_CONFIG_V1, SECOND_DRIVEWAY: -1 })[0], /Second driveway/);
  assert.match(validateSnowConfig({ ...SNOW_CONFIG_V1, NO_BOULEVARD_PER_LANE: -1 })[0], /No boulevard/);
  // Zero is a legitimate setting — the discount is switched off, not invalid.
  assert.deepEqual(validateSnowConfig({ ...SNOW_CONFIG_V1, SHARED_DRIVEWAY: 0, SECOND_DRIVEWAY: 0 }), []);
  // An ABSENT key is valid (old stored versions) and falls back when priced.
  const absent = { ...SNOW_CONFIG_V1 } as SnowConfig;
  delete absent.SHARED_DRIVEWAY;
  assert.deepEqual(validateSnowConfig(absent), []);
});

test('a discount larger than the base floors at 0, never negative', () => {
  const huge = { ...SNOW_CONFIG_V1, SHARED_DRIVEWAY: 5000 };
  assert.equal(priceSnow(shape(1, 1), { sharedDriveway: true }, huge)!.total, 0);
});

console.log('\nPREMIUM IS ONE CHARGE FOR THE VISIT, NOT PER DRIVEWAY:');

test('one driveway takes the whole premium', () => {
  const p = premiumSplit(SNOW_CONFIG_V1, 1);
  assert.equal(p.total, 200);
  assert.deepEqual(p.shares, [200]);
  assert.equal(p.even, true);
});

test('TWO DRIVEWAYS SPLIT IT — $200 total, not $400', () => {
  // The bug: premium was added once per driveway, so one visit's priority
  // response was billed twice.
  const p = premiumSplit(SNOW_CONFIG_V1, 2);
  assert.equal(p.total, 200);
  assert.deepEqual(p.shares, [100, 100]);
  assert.equal(p.shares[0] + p.shares[1], 200, 'the pair comes to ONE charge');
  assert.notEqual(p.shares[0] + p.shares[1], 400);
});

test('THE SHARES ALWAYS SUM TO EXACTLY ONE CHARGE, at any rate', () => {
  for (const PREMIUM of [0, 1, 7, 200, 201, 250, 999, 1000]) {
    for (const n of [1, 2, 3, 4]) {
      const p = premiumSplit({ ...SNOW_CONFIG_V1, PREMIUM }, n);
      assert.equal(p.shares.length, n);
      assert.equal(p.shares.reduce((a, b) => a + b, 0), PREMIUM,
        `${PREMIUM} over ${n} must sum back to ${PREMIUM}`);
      assert.ok(p.shares.every(x => Number.isInteger(x)), 'whole dollars only');
    }
  }
});

test('an ODD charge gives the remainder to the earlier driveway, not cents', () => {
  // $201 cannot halve into whole dollars. Rounding both to 101 would bill $202
  // for a $201 upgrade; 100.50 each would put cents on a quote that is whole
  // dollars everywhere else.
  const p = premiumSplit({ ...SNOW_CONFIG_V1, PREMIUM: 201 }, 2);
  assert.deepEqual(p.shares, [101, 100]);
  assert.equal(p.even, false, 'and it knows not to call that "half"');
});

test('premiumSplit follows the RATE SHEET, and a saved quote holds its own', () => {
  // Premium is a rate-sheet number like any other, so the split moves with it
  // and a reopened quote resolves against its stamped version.
  const V4: SnowConfig = { ...SNOW_CONFIG_V1, PREMIUM: 300 };
  const vs: Record<string, StoredSnowVersion> = { 'snow-v4': { version: 'snow-v4', config: V4 } };
  assert.deepEqual(premiumSplit(resolveSnowConfig('snow-v4', vs), 2).shares, [150, 150]);
  assert.deepEqual(premiumSplit(resolveSnowConfig('snow-v1', vs), 2).shares, [100, 100],
    'the old version still splits its own $200');
});

test('premiumRate guards a bad stored value rather than producing NaN', () => {
  assert.equal(premiumRate(SNOW_CONFIG_V1), 200);
  assert.equal(premiumRate({ ...SNOW_CONFIG_V1, PREMIUM: undefined as unknown as number }), 200);
  assert.equal(premiumRate({ ...SNOW_CONFIG_V1, PREMIUM: -5 }), 200, 'negative is not a premium');
  assert.equal(premiumRate({ ...SNOW_CONFIG_V1, PREMIUM: 0 }), 0, 'zero is a real setting');
});

test('THE LINE SAYS IT IS A SHARE — otherwise it reads as the whole charge', () => {
  // "$100" beside one driveway of two is indistinguishable from the full
  // premium, which is what made the doubled charge invisible.
  assert.equal(premiumShareNote(200, 100, 'shared driveway'), 'half of $200, shared driveway');
  assert.equal(premiumShareNote(200, 100, 'one visit'), 'half of $200, one visit');
  // Not a share at all → no note to add.
  assert.equal(premiumShareNote(200, 200, 'one visit'), '');
  // An uneven split is a "share", not a "half" — the kind of small lie that
  // gets noticed on an invoice.
  assert.equal(premiumShareNote(201, 101, 'shared driveway'), 'share of $201, shared driveway');
  assert.equal(premiumShareNote(201, 100, 'shared driveway'), 'share of $201, shared driveway');
});

test('splitting premium does not touch the tier, the discounts or their order', () => {
  // Premium is added on TOP of the standard total, so it cannot move a tier or
  // interact with the flat discounts. Guard against a "fix" that folds it in.
  const g = shape(2, 2);                                     // Tier 2, 699
  const std = priceSnow(g, { sharedDriveway: true, noBoulevard: true }, SNOW_CONFIG_V1)!;
  assert.equal(std.tier, 2);
  assert.equal(std.addBreakdown.sharedDriveway, -100);
  assert.equal(std.addBreakdown.noBoulevard, -100, '2 lanes × $50');
  assert.equal(std.total, 499);
  // The share rides on top; the standard total is untouched by the split.
  const share = premiumSplit(SNOW_CONFIG_V1, 2).shares[0];
  assert.equal(std.total! + share, 599);
  assert.equal(std.addBreakdown.premium, 0, 'premium is never in the breakdown here');
});

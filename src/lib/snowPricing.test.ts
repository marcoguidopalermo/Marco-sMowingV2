// Unit tests for the snow pricing engine — the agreed cases from the spec.
// No test framework (none is installed / allowed); run with the repo's existing
// TS runner:  npx tsx src/lib/snowPricing.test.ts
// Exits non-zero if any case fails.
import assert from 'node:assert/strict';
import {
  priceSnow, measureGrid, SNOW_PRICING_CONFIG, SNOW_CONFIG_V1, SNOW_PRICING_CONFIG_VERSION, SnowGrid, SnowConfig,
  resolveSnowConfig, activeSnowVersionId, snowVersionId, validateSnowConfig, diffSnowConfig, StoredSnowVersion,
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

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}\n      ${(e as Error).message.replace(/\n/g, '\n      ')}`); }
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

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

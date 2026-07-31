// ─────────────────────────────────────────────────────────────────────────
// SNOW PRICING ENGINE — SINGLE SOURCE OF TRUTH for driveway snow-clearing
// season pricing. Pure module: NO React, NO Firebase, NO side effects. The
// Snow tab (and anything else that ever needs a snow price) MUST call in here.
// Do NOT do snow price arithmetic anywhere else in the app.
//
// The estimator traces a driveway on a grid; this module turns the traced
// shape + a few flags into a tier and a season price.
// ─────────────────────────────────────────────────────────────────────────

// ── CONFIG ────────────────────────────────────────────────────────────────
// Rates + the two rules still under review. Changing any of these is a
// deliberate one-line edit; NONE of them are ever exposed as a UI control (an
// estimator must not be able to change the pricing model). When you change a
// rate, BUMP SNOW_PRICING_CONFIG_VERSION below so past saved quotes still
// explain themselves.
export const SNOW_PRICING_CONFIG = {
  TIER_1: 599,
  TIER_2: 699,
  TIER_3: 799,
  CUSTOM_FLOOR: 999,
  PREMIUM: 200,
  BUSY_ROAD: 100,
  DRAG_RATE: 50,                  // per dragged spot — under review, expect this to change
  DRAG_COUNTS_TOWARD_SIZE: true,  // under review
  DANGER_OPTIONS: [0, 50, 100, 200] as const,
};

// Stamp saved onto every quote. Bump whenever any value in SNOW_PRICING_CONFIG
// changes, so a quote saved under old rates stays explicable at renewal.
export const SNOW_PRICING_CONFIG_VERSION = 'snow-v1';

// ── TYPES ───────────────────────────────────────────────────────────────────
/** A traced grid: each cell is 0 empty, 1 open spot, 2 drag spot. */
export type SnowCell = 0 | 1 | 2;
export type SnowGrid = number[][];

export type SnowTier = 1 | 2 | 3 | 'custom';

export interface SnowInputs {
  premium?: boolean;
  busyRoad?: boolean;
  danger?: number; // one of DANGER_OPTIONS ($); other values are used as-is
}

export interface SnowMeasurement {
  cars: number;      // count of all cells that are 1 or 2 (always)
  lanes: number;     // columns with >= 1 counted cell
  depth: number;     // most counted cells in any single column
  dragCount: number; // count of cells === 2 (always, regardless of the flag)
}

export interface SnowAddBreakdown {
  drag: number;
  premium: number;
  busyRoad: number;
  danger: number;
}

export interface SnowPrice extends SnowMeasurement {
  tier: SnowTier;
  basePrice: number;            // tier base (TIER_1/2/3, or CUSTOM_FLOOR for custom)
  adds: number;                 // total of all add-ons
  addBreakdown: SnowAddBreakdown;
  isCustom: boolean;
  total: number | null;         // standard total; null when custom
  floor: number | null;         // custom floor (CUSTOM_FLOOR + adds); null when standard
  pricingConfigVersion: string;
}

// ── SHAPE MEASUREMENT ───────────────────────────────────────────────────────
const isFilled = (v: number): boolean => v === 1 || v === 2;

/**
 * Measure the traced shape.
 *  - cars: every cell that is 1 or 2 (always — independent of the drag flag).
 *  - lanes / depth: over the "counted" cells. Which cells count depends on
 *    DRAG_COUNTS_TOWARD_SIZE (true → 1 and 2 both count; false → only 1).
 *    Edge case: if that rule leaves zero counted cells but the grid is not
 *    empty, fall back to counting every filled cell.
 *  - dragCount: every cell equal to 2 (always).
 */
export function measureGrid(grid: SnowGrid): SnowMeasurement {
  const rows = grid?.length || 0;
  const cols = rows ? Math.max(...grid.map((r) => r?.length || 0)) : 0;

  const cellAt = (r: number, c: number): number => grid[r]?.[c] ?? 0;

  let cars = 0;
  let dragCount = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = cellAt(r, c);
      if (isFilled(v)) cars++;
      if (v === 2) dragCount++;
    }
  }

  // Pick the "counts toward size" predicate, with the empty-fallback.
  const strict = SNOW_PRICING_CONFIG.DRAG_COUNTS_TOWARD_SIZE
    ? (v: number) => isFilled(v)          // 1 and 2 count
    : (v: number) => v === 1;             // only 1 counts
  let counts = strict;
  if (!SNOW_PRICING_CONFIG.DRAG_COUNTS_TOWARD_SIZE && cars > 0) {
    // Would the strict rule leave nothing counted on a non-empty grid?
    let anyCounted = false;
    for (let r = 0; r < rows && !anyCounted; r++) {
      for (let c = 0; c < cols; c++) { if (counts(cellAt(r, c))) { anyCounted = true; break; } }
    }
    if (!anyCounted) counts = (v: number) => isFilled(v); // fall back to counting everything
  }

  let lanes = 0;
  let depth = 0;
  for (let c = 0; c < cols; c++) {
    let colCount = 0;
    for (let r = 0; r < rows; r++) if (counts(cellAt(r, c))) colCount++;
    if (colCount > 0) lanes++;
    if (colCount > depth) depth = colCount;
  }

  return { cars, lanes, depth, dragCount };
}

// ── TIER ────────────────────────────────────────────────────────────────────
// Tiers order as 1 < 2 < 3 < custom. We use +Infinity to mean "custom" for the
// lane side and "no cap" for the car side, so the final tier is simply the
// LOWER (min) of the two — the car count can only ever pull a tier DOWN.

/** Lane/depth tier. Returns null when nothing is traced (lanes === 0). */
function laneTier(lanes: number, depth: number): number | null {
  if (lanes === 0) return null;
  if (lanes === 1) return depth <= 3 ? 1 : 2;
  if (lanes === 2) return depth <= 1 ? 1 : depth === 2 ? 2 : 3;
  return Infinity; // lanes >= 3 → custom
}

/** Car-count tier. cars >= 7 imposes no cap (Infinity) — never pulls up. */
function carTier(cars: number): number {
  if (cars <= 2) return 1;
  if (cars <= 4) return 2;
  if (cars <= 6) return 3;
  return Infinity;
}

/**
 * Resolve the tier from a measured shape. Returns null when nothing is traced.
 * The tier is the LOWER of the lane tier and the car tier; depth never forces
 * custom (only lane count does), and the car count only ever pulls DOWN.
 */
export function computeTier(m: SnowMeasurement): SnowTier | null {
  const lt = laneTier(m.lanes, m.depth);
  if (lt === null) return null;
  const val = Math.min(lt, carTier(m.cars));
  return val === Infinity ? 'custom' : (val as 1 | 2 | 3);
}

// ── PRICE ─────────────────────────────────────────────────────────────────
const tierBase = (tier: SnowTier): number => {
  const C = SNOW_PRICING_CONFIG;
  if (tier === 1) return C.TIER_1;
  if (tier === 2) return C.TIER_2;
  if (tier === 3) return C.TIER_3;
  return C.CUSTOM_FLOOR;
};

function computeAdds(dragCount: number, inputs: SnowInputs): SnowAddBreakdown {
  const C = SNOW_PRICING_CONFIG;
  return {
    drag: dragCount * C.DRAG_RATE,
    premium: inputs.premium ? C.PREMIUM : 0,
    busyRoad: inputs.busyRoad ? C.BUSY_ROAD : 0,
    danger: Math.max(0, Number(inputs.danger) || 0),
  };
}

/**
 * Price a traced driveway. Returns null when nothing is traced (empty grid).
 *  - standard tiers: total = base + adds; floor = null.
 *  - custom (lanes >= 3, uncapped by car count): total = null; the result is a
 *    floor of CUSTOM_FLOOR + adds — a minimum, quoted manually above it.
 */
export function priceSnow(grid: SnowGrid, inputs: SnowInputs = {}): SnowPrice | null {
  const m = measureGrid(grid);
  const tier = computeTier(m);
  if (tier === null) return null; // nothing traced

  const breakdown = computeAdds(m.dragCount, inputs);
  const adds = breakdown.drag + breakdown.premium + breakdown.busyRoad + breakdown.danger;
  const basePrice = tierBase(tier);
  const isCustom = tier === 'custom';

  return {
    ...m,
    tier,
    basePrice,
    adds,
    addBreakdown: breakdown,
    isCustom,
    total: isCustom ? null : basePrice + adds,
    floor: isCustom ? basePrice + adds : null,
    pricingConfigVersion: SNOW_PRICING_CONFIG_VERSION,
  };
}

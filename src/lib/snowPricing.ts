// ─────────────────────────────────────────────────────────────────────────
// SNOW PRICING ENGINE — SINGLE SOURCE OF TRUTH for driveway snow-clearing
// season pricing. Pure module: NO React, NO Firebase, NO side effects.
//
// The NUMBERS now come from a SnowConfig (edited in the super-admin Snow rate
// sheet and stored as immutable versions). The pricing LOGIC — lane/depth/car
// tier rules — stays here in code and is not editable. Every pricing function
// takes a config; callers pass the config for the version they mean (the active
// version for a new quote, or the quote's stamped version when viewing history).
// If no config is supplied it falls back to the hard-coded v1 defaults so the
// app can always price, even if a config read failed.
// ─────────────────────────────────────────────────────────────────────────

// ── EDITABLE CONFIG (the numbers) ───────────────────────────────────────────
export interface SnowConfig {
  TIER_1: number;
  TIER_2: number;
  TIER_3: number;
  CUSTOM_FLOOR: number;
  PREMIUM: number;
  BUSY_ROAD: number;
  DRAG_RATE: number;              // per dragged spot — under active review
  // NO BOULEVARD — subtracted PER LANE. A driveway with no boulevard strip to
  // clear is less work, and the saving scales with how wide the driveway is.
  // Optional on the interface because configs stored before it existed do not
  // carry it; read through noBoulevardRate(), never directly.
  NO_BOULEVARD_PER_LANE?: number;
  // FLAT per-driveway discounts, both SEEDED at $100 and both per DRIVEWAY,
  // not per lane — the saving is one fewer trip's worth of setup, which does
  // not scale with how wide the driveway is.
  //
  // TWO RATES, NOT ONE, and deliberately so. They are the same number today
  // and cover different things: SHARED is two clients on one physical
  // driveway, SECOND is one client with two driveways on the property. Folding
  // them into a single "driveway discount" would make them the same number by
  // construction, and the next time one of them moves it would have to be
  // un-merged in code — which is the thing putting them in the rate sheet was
  // meant to stop.
  //
  // Stored as POSITIVE magnitudes; computeAdds subtracts them. Optional for
  // configs stored before they existed; read through the helpers below, never
  // directly, or an absent key makes the whole total NaN.
  SHARED_DRIVEWAY?: number;      // two clients, one physical driveway
  SECOND_DRIVEWAY?: number;      // one client, a second driveway on the property
  DRAG_COUNTS_TOWARD_SIZE: boolean; // under review
  DANGER_OPTIONS: number[];       // selectable danger amounts ($)
}

// Version 1 — the hard-coded defaults shipped in code. This is the fallback
// whenever Firestore has no config, and the config that existing quotes stamped
// 'snow-v1' resolve against. NEVER mutate this object.
export const SNOW_CONFIG_V1: SnowConfig = {
  TIER_1: 599,
  TIER_2: 699,
  TIER_3: 799,
  CUSTOM_FLOOR: 999,
  PREMIUM: 200,
  BUSY_ROAD: 100,
  DRAG_RATE: 50,
  NO_BOULEVARD_PER_LANE: 50,
  SHARED_DRIVEWAY: 100,
  SECOND_DRIVEWAY: 100,
  DRAG_COUNTS_TOWARD_SIZE: true,
  DANGER_OPTIONS: [0, 50, 100, 200],
};

// Back-compat alias — some call sites import SNOW_PRICING_CONFIG. It IS v1.
export const SNOW_PRICING_CONFIG = SNOW_CONFIG_V1;

// ── VERSION IDS ─────────────────────────────────────────────────────────────
// Version ids are strings `snow-v{N}` so the existing pricingConfigVersion
// stamp on saved quotes ('snow-v1') keeps resolving correctly.
export const SNOW_VERSION_PREFIX = 'snow-v';
export const SNOW_PRICING_CONFIG_VERSION = 'snow-v1';
export const snowVersionId = (n: number): string => `${SNOW_VERSION_PREFIX}${n}`;
export const snowVersionNum = (id: string): number => {
  const n = parseInt(String(id || '').replace(SNOW_VERSION_PREFIX, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

// A minimal shape of a stored version: { version, config }. resolveSnowConfig
// takes whatever map the app has and returns a usable config, always.
export interface StoredSnowVersion { version: string; config: SnowConfig }

// Resolve the config for a version id from a map of stored versions. v1 (and
// any missing/unknown version) falls back to the hard-coded defaults — so the
// app never fails to price, and old 'snow-v1' quotes stay correct even though
// v1 is never written to Firestore.
export function resolveSnowConfig(
  versionId: string | undefined,
  versions: Record<string, StoredSnowVersion> | undefined | null,
): SnowConfig {
  const v = versionId && versions ? versions[versionId] : undefined;
  return (v && v.config) ? v.config : SNOW_CONFIG_V1;
}

// The active (latest) version id given the stored map. Empty map → v1 (the
// implicit hard-coded baseline; v1 is never a stored doc).
export function activeSnowVersionId(versions: Record<string, StoredSnowVersion> | undefined | null): string {
  let max = 1;
  for (const id of Object.keys(versions || {})) { const n = snowVersionNum(id); if (n > max) max = n; }
  return snowVersionId(max);
}

// ── TYPES ───────────────────────────────────────────────────────────────────
export type SnowCell = 0 | 1 | 2;
export type SnowGrid = number[][];
export type SnowTier = 1 | 2 | 3 | 'custom';

export interface SnowInputs {
  premium?: boolean; busyRoad?: boolean; danger?: number;
  /** No boulevard to clear — subtracts NO_BOULEVARD_PER_LANE for every lane. */
  noBoulevard?: boolean;
  // SHARED DRIVEWAY (two clients, one driveway). The quote passes this for
  // every shared driveway, because a quote shows the client the price they
  // would pay. The discount stays CONDITIONAL on both staying under contract —
  // that condition is carried by the contract wording and the saved-list flag,
  // not by withholding it here. See lib/snowDriveways.
  sharedDriveway?: boolean;
  // SECOND DRIVEWAY on the same property (one client). Unconditional: there is
  // one payer and one trip, so there is nothing for it to depend on.
  secondDriveway?: boolean;
}

/**
 * The per-lane no-boulevard saving for a config. Read through this rather than
 * the field: a rate-sheet version stored before the discount existed has no
 * such key, and an undefined here would make the whole total NaN.
 */
export const noBoulevardRate = (config: SnowConfig): number => {
  const v = Number(config.NO_BOULEVARD_PER_LANE);
  return Number.isFinite(v) && v >= 0 ? v : (SNOW_CONFIG_V1.NO_BOULEVARD_PER_LANE || 0);
};
/**
 * PREMIUM IS A SERVICE LEVEL, NOT A PRODUCT — priority response on the visit.
 * One trip, one upgrade. So config.PREMIUM is the premium for ONE CLEARING,
 * never a per-driveway charge, and a quote covering two driveways charges it
 * ONCE.
 * @param {SnowConfig} config The config for the version being priced.
 * @return {number} The premium for one clearing.
 */
export const premiumRate = (config: SnowConfig): number => {
  const v = Number(config.PREMIUM);
  return Number.isFinite(v) && v >= 0 ? v : SNOW_CONFIG_V1.PREMIUM;
};

export interface PremiumSplit {
  /** The ONE premium charge for the visit. shares always sums to exactly this. */
  total: number;
  /** Per-driveway share, in driveway order. */
  shares: number[];
  /** True when every share is identical — lets callers say "half" honestly. */
  even: boolean;
}

/**
 * Split the single premium charge across the driveways it covers.
 *
 * WHY THIS EXISTS: premium was being added once per driveway, so a two-driveway
 * quote charged $400 for one visit's priority response. The fix is not a
 * per-mode subtraction somewhere in the view — it is that there is one charge
 * and the driveways divide it, which is what this returns.
 *
 * Both two-driveway shapes split it in two, for different reasons that arrive
 * at the same arithmetic:
 *   MULTI  — one client, one property, one trip. $200 total, not $400.
 *   SHARED — one physical driveway cleared once to a premium standard, billed
 *            to two clients. $200 for the driveway, $100 each.
 *
 * THE SHARES SUM TO THE TOTAL EXACTLY. An odd total cannot halve into whole
 * dollars, so the remainder goes to the earlier driveways ($201 → 101 + 100)
 * rather than letting both sides round to 101 and bill $202 for a $201 upgrade,
 * or to 100.50 and put cents on a quote that is whole dollars everywhere else.
 * @param {SnowConfig} config The config for the version being priced.
 * @param {number} driveways How many driveways the one premium covers.
 * @return {PremiumSplit} The total and each driveway's share.
 */
export function premiumSplit(config: SnowConfig, driveways = 1): PremiumSplit {
  const total = premiumRate(config);
  const n = Math.max(1, Math.floor(Number(driveways) || 1));
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  const shares = Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
  return { total, shares, even: remainder === 0 };
}

/**
 * How a driveway's premium share reads on a price line, so nobody takes it for
 * a charge of its own. "$100" beside one driveway of two is indistinguishable
 * from the full premium unless the line says what it is a share OF.
 * @param {number} total The single premium charge for the visit.
 * @param {number} share This driveway's part of it.
 * @param {string} what Why it is split — "shared driveway" / "one visit".
 * @return {string} A parenthetical note, or '' when nothing is being split.
 */
export function premiumShareNote(total: number, share: number, what: string): string {
  if (!(share < total)) return '';               // not a share — the whole charge
  const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  // "half" only when it is actually half; an odd total makes one side a dollar
  // heavier and calling that half is the kind of small lie that gets noticed
  // on an invoice.
  const part = share * 2 === total ? 'half' : 'share';
  return `${part} of ${usd(total)}, ${what}`;
}

export const sharedDrivewayRate = (config: SnowConfig): number => {
  const v = Number(config.SHARED_DRIVEWAY);
  return Number.isFinite(v) && v >= 0 ? v : (SNOW_CONFIG_V1.SHARED_DRIVEWAY || 0);
};
export const secondDrivewayRate = (config: SnowConfig): number => {
  const v = Number(config.SECOND_DRIVEWAY);
  return Number.isFinite(v) && v >= 0 ? v : (SNOW_CONFIG_V1.SECOND_DRIVEWAY || 0);
};

export interface SnowMeasurement { cars: number; lanes: number; depth: number; dragCount: number }

export interface SnowAddBreakdown {
  drag: number; premium: number; busyRoad: number; danger: number;
  /** NEGATIVE (or 0). Kept in the same breakdown so the quote shows one list. */
  noBoulevard: number;
  sharedDriveway: number;
  secondDriveway: number;
  /** Lanes the discount was computed over — for the "2 lanes × $50" line. */
  noBoulevardLanes: number;
}

export interface SnowPrice extends SnowMeasurement {
  tier: SnowTier;
  basePrice: number;
  adds: number;
  addBreakdown: SnowAddBreakdown;
  isCustom: boolean;
  total: number | null;
  floor: number | null;
  pricingConfigVersion: string;
}

// ── SHAPE MEASUREMENT ───────────────────────────────────────────────────────
const isFilled = (v: number): boolean => v === 1 || v === 2;

/**
 * Measure the traced shape. cars = every 1|2 (always). dragCount = every 2
 * (always). lanes/depth are over the "counted" cells, where DRAG cells count
 * only if config.DRAG_COUNTS_TOWARD_SIZE; with the empty-fallback so a non-empty
 * grid always measures to something.
 */
export function measureGrid(grid: SnowGrid, config: SnowConfig = SNOW_CONFIG_V1): SnowMeasurement {
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

  const strict = config.DRAG_COUNTS_TOWARD_SIZE
    ? (v: number) => isFilled(v)
    : (v: number) => v === 1;
  let counts = strict;
  if (!config.DRAG_COUNTS_TOWARD_SIZE && cars > 0) {
    let anyCounted = false;
    for (let r = 0; r < rows && !anyCounted; r++) {
      for (let c = 0; c < cols; c++) { if (counts(cellAt(r, c))) { anyCounted = true; break; } }
    }
    if (!anyCounted) counts = (v: number) => isFilled(v);
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

// ── TIER (rules — NOT editable) ─────────────────────────────────────────────
function laneTier(lanes: number, depth: number): number | null {
  if (lanes === 0) return null;
  if (lanes === 1) return depth <= 3 ? 1 : 2;
  if (lanes === 2) return depth <= 1 ? 1 : depth === 2 ? 2 : 3;
  return Infinity; // lanes >= 3 → custom
}
function carTier(cars: number): number {
  if (cars <= 2) return 1;
  if (cars <= 4) return 2;
  if (cars <= 6) return 3;
  return Infinity;
}
export function computeTier(m: SnowMeasurement): SnowTier | null {
  const lt = laneTier(m.lanes, m.depth);
  if (lt === null) return null;
  const val = Math.min(lt, carTier(m.cars));
  return val === Infinity ? 'custom' : (val as 1 | 2 | 3);
}

// ── PRICE ───────────────────────────────────────────────────────────────────
const tierBase = (tier: SnowTier, config: SnowConfig): number => {
  if (tier === 1) return config.TIER_1;
  if (tier === 2) return config.TIER_2;
  if (tier === 3) return config.TIER_3;
  return config.CUSTOM_FLOOR;
};

function computeAdds(
  m: SnowMeasurement, inputs: SnowInputs, config: SnowConfig,
): SnowAddBreakdown {
  const lanes = Math.max(0, Number(m.lanes) || 0);
  // Per LANE, so a double-lane driveway saves twice. Negative, because it sits
  // in the same breakdown list as the surcharges and the quote renders that
  // list in order — a discount hidden in a separate structure is a discount
  // that eventually stops being shown.
  const noBoulevard = inputs.noBoulevard ? -(lanes * noBoulevardRate(config)) : 0;
  // Flat, per driveway, and NOT scaled by lanes — unlike no-boulevard.
  const sharedDriveway = inputs.sharedDriveway ? -sharedDrivewayRate(config) : 0;
  const secondDriveway = inputs.secondDriveway ? -secondDrivewayRate(config) : 0;
  return {
    sharedDriveway,
    secondDriveway,
    drag: m.dragCount * config.DRAG_RATE,
    premium: inputs.premium ? config.PREMIUM : 0,
    busyRoad: inputs.busyRoad ? config.BUSY_ROAD : 0,
    danger: Math.max(0, Number(inputs.danger) || 0),
    noBoulevard,
    noBoulevardLanes: inputs.noBoulevard ? lanes : 0,
  };
}

/**
 * Price a traced driveway against a given config + version stamp. Returns null
 * when nothing is traced. Defaults to the v1 hard-coded config so the app can
 * always price.
 */
export function priceSnow(
  grid: SnowGrid,
  inputs: SnowInputs = {},
  config: SnowConfig = SNOW_CONFIG_V1,
  versionId: string = SNOW_PRICING_CONFIG_VERSION,
): SnowPrice | null {
  const m = measureGrid(grid, config);
  const tier = computeTier(m);
  if (tier === null) return null;

  // ORDER OF OPERATIONS, and it matters because the discount is per-lane:
  //   1. measure the traced shape        → cars, lanes, depth, dragCount
  //   2. tier from the measurement       → basePrice
  //   3. surcharges, each independent    → drag, premium, busy road, danger
  //   4. no-boulevard discount           → −(lanes × rate)   [per LANE]
  //   5. driveway discounts              → −shared, −second        [FLAT]
  //   6. total = basePrice + Σ(3) + (4) + (5), floored at 0
  //
  // Discounts come after every surcharge and are applied to the TOTAL, so the
  // amount taken off never depends on how large the surcharges happen to be.
  // The two driveway discounts are FLAT per driveway; no-boulevard is per lane.
  // All three amounts come from the CONFIG, so they move with the rate sheet
  // and a quote reprices at whatever version it is resolved against.
  // Tier selection is untouched by any of them — a driveway never drops a tier
  // for being shared, second, or boulevard-free.
  //
  // The discount is applied to the TOTAL, not to the tier base and not as a
  // percentage — so it is unaffected by how large the surcharges happen to be,
  // and two identical driveways differing only in boulevard always differ by
  // exactly lanes × rate. Tier selection is untouched: a driveway does not drop
  // a tier because it has no boulevard.
  const breakdown = computeAdds(m, inputs, config);
  const adds = breakdown.drag + breakdown.premium + breakdown.busyRoad
    + breakdown.danger + breakdown.noBoulevard
    + breakdown.sharedDriveway + breakdown.secondDriveway;
  const basePrice = tierBase(tier, config);
  const isCustom = tier === 'custom';
  // Floored at 0: a discount can never produce a negative quote, however many
  // lanes are traced.
  const gross = Math.max(0, basePrice + adds);

  return {
    ...m,
    tier,
    basePrice,
    adds,
    addBreakdown: breakdown,
    isCustom,
    total: isCustom ? null : gross,
    floor: isCustom ? gross : null,
    pricingConfigVersion: versionId,
  };
}

// ── ACTIVE MODIFIERS ───────────────────────────────────────────────────────
// Everything applied to a quote, in one list, for display.
//
// DERIVED FROM THE SAME BREAKDOWN THE TOTAL IS. Not a parallel list of "which
// toggles are on" — that would be a second description of the same fact, and
// the two would eventually disagree about which one the price actually used.
// If it is not in the breakdown it did not affect the price, and if it did
// affect the price it appears here.
export interface ActiveModifier {
  key: keyof SnowAddBreakdown | 'drag';
  label: string;
  amount: number;          // signed, in dollars
}

export function activeModifiers(
  b: SnowAddBreakdown, m: Pick<SnowMeasurement, 'dragCount'>, config: SnowConfig,
): ActiveModifier[] {
  const out: ActiveModifier[] = [];
  if (b.drag) out.push({ key: 'drag', label: `Drag × ${m.dragCount}`, amount: b.drag });
  if (b.premium) out.push({ key: 'premium', label: 'Premium', amount: b.premium });
  if (b.busyRoad) out.push({ key: 'busyRoad', label: 'Busy road', amount: b.busyRoad });
  if (b.danger) out.push({ key: 'danger', label: 'Danger', amount: b.danger });
  if (b.noBoulevard) {
    out.push({
      key: 'noBoulevard',
      label: `No boulevard (${b.noBoulevardLanes} lane${b.noBoulevardLanes === 1 ? '' : 's'})`,
      amount: b.noBoulevard,
    });
  }
  // BOTH DRIVEWAY DISCOUNTS APPEAR HERE, with the amount taken from the
  // breakdown so they follow the rate sheet. A reduction that is not on the
  // modifier list is a reduction applied silently, which is the one thing this
  // list exists to prevent — and it gets worse, not better, once the amount is
  // editable and nobody can assume they know what it was.
  if (b.sharedDriveway) {
    out.push({
      key: 'sharedDriveway',
      label: 'Shared driveway (while both properties are under contract)',
      amount: b.sharedDriveway,
    });
  }
  if (b.secondDriveway) {
    out.push({
      key: 'secondDriveway',
      label: 'Second driveway on the property',
      amount: b.secondDriveway,
    });
  }
  void config;
  return out;
}

/**
 * The breakdown for a SAVED quote, rebuilt through the SAME computeAdds the
 * live price uses — so a reopened quote and the saved-list row cannot describe
 * a different set of modifiers than the estimator saw. Resolved against the
 * quote's OWN config version, never the current one.
 */
export function breakdownOfSaved(
  q: {
    dragCount?: number; lanes?: number;
    premium?: boolean; busyRoad?: boolean; danger?: number; noBoulevard?: boolean;
    sharedDriveway?: boolean; secondDriveway?: boolean;
  },
  config: SnowConfig,
): SnowAddBreakdown {
  return computeAdds(
    { cars: 0, lanes: Number(q.lanes) || 0, depth: 0, dragCount: Number(q.dragCount) || 0 },
    {
      premium: q.premium, busyRoad: q.busyRoad, danger: q.danger,
      noBoulevard: q.noBoulevard,
      sharedDriveway: q.sharedDriveway, secondDriveway: q.secondDriveway,
    },
    config,
  );
}

// ── CONFIG VALIDATION + DIFF (for the rate sheet) ───────────────────────────
// Human labels for audit + preview display.
export const SNOW_FIELD_LABELS: Record<keyof SnowConfig, string> = {
  TIER_1: 'Tier 1', TIER_2: 'Tier 2', TIER_3: 'Tier 3', CUSTOM_FLOOR: 'Custom floor',
  PREMIUM: 'Premium', BUSY_ROAD: 'Busy road', DRAG_RATE: 'Drag rate',
  DRAG_COUNTS_TOWARD_SIZE: 'Drag counts toward size', DANGER_OPTIONS: 'Danger options',
  NO_BOULEVARD_PER_LANE: 'No boulevard (per lane)',
  SHARED_DRIVEWAY: 'Shared driveway (flat)',
  SECOND_DRIVEWAY: 'Second driveway (flat)',
};

const fmtVal = (v: unknown): string =>
  typeof v === 'boolean' ? (v ? 'Yes' : 'No')
    : Array.isArray(v) ? `[${v.join(', ')}]`
      : String(v);

export interface RateAuditChange { field: string; key: string; from: string; to: string }

/** Field-level diff of two configs → audit changes (only changed fields). */
export function diffSnowConfig(oldC: SnowConfig, newC: SnowConfig): RateAuditChange[] {
  const out: RateAuditChange[] = [];
  (Object.keys(SNOW_FIELD_LABELS) as (keyof SnowConfig)[]).forEach((key) => {
    const a = oldC[key]; const b = newC[key];
    const same = Array.isArray(a) && Array.isArray(b) ? JSON.stringify(a) === JSON.stringify(b) : a === b;
    if (!same) out.push({ field: SNOW_FIELD_LABELS[key], key, from: fmtVal(a), to: fmtVal(b) });
  });
  return out;
}

/** Validate an edited config. Returns a list of problems ([] = valid). */
export function validateSnowConfig(c: SnowConfig): string[] {
  const errs: string[] = [];
  const positive: (keyof SnowConfig)[] = ['TIER_1', 'TIER_2', 'TIER_3', 'CUSTOM_FLOOR'];
  for (const k of positive) {
    if (!(Number(c[k]) > 0)) errs.push(`${SNOW_FIELD_LABELS[k]} must be a positive number.`);
  }
  const nonNeg: (keyof SnowConfig)[] = ['PREMIUM', 'BUSY_ROAD', 'DRAG_RATE'];
  for (const k of nonNeg) {
    if (!(Number(c[k]) >= 0)) errs.push(`${SNOW_FIELD_LABELS[k]} cannot be negative.`);
  }
  // THE DISCOUNTS ARE STORED AS POSITIVE MAGNITUDES and subtracted by
  // computeAdds. A negative here would flip a discount into a surcharge — the
  // sheet says "−$100 off" while the total goes UP — so it is rejected rather
  // than quietly negated. Optional on the interface (older stored versions
  // predate them), so an absent key is valid and falls back via the rate
  // helpers; only a present-and-bad value is an error.
  const discounts: (keyof SnowConfig)[] = ['NO_BOULEVARD_PER_LANE', 'SHARED_DRIVEWAY', 'SECOND_DRIVEWAY'];
  for (const k of discounts) {
    if (c[k] === undefined || c[k] === null) continue;
    if (!(Number(c[k]) >= 0)) {
      errs.push(`${SNOW_FIELD_LABELS[k]} cannot be negative — enter the amount to take off.`);
    }
  }
  const opts = c.DANGER_OPTIONS || [];
  if (!opts.length) errs.push('Danger options cannot be empty.');
  if (opts.some((n) => !(Number(n) >= 0))) errs.push('Danger options must all be zero or positive.');
  for (let i = 1; i < opts.length; i++) {
    if (!(opts[i] > opts[i - 1])) { errs.push('Danger options must be strictly ascending (no duplicates).'); break; }
  }
  return errs;
}

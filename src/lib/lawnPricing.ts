// ─────────────────────────────────────────────────────────────────────────
// LAWN PRICING ENGINE — SINGLE SOURCE OF TRUTH for LawnMaster. Pure module:
// NO React, NO Firebase, NO side effects. Config-driven from the start (same
// shape as snowPricing.ts after the rate-sheet work) so the lawn rate sheet
// drops straight onto the versioned-config infrastructure: LAWN_CONFIG_V1 is
// version 1 and the fallback, and every function takes a config.
//
// LawnMaster quotes two INDEPENDENT things:
//   • Mowing — recurring, weekly or biweekly, priced by lawn square footage
//   • Packages — Bronze / Silver / Gold + Dethatching, priced by the same tier
// A client can take mowing only, a package only, or both.
// ─────────────────────────────────────────────────────────────────────────

// ── EDITABLE CONFIG (the numbers). No UI control may change these — the rate
// sheet is a separate super-admin build. ──────────────────────────────────
export interface LawnTier { maxSqFt: number | null; weekly: number }
export interface LawnTravelZone { key: string; label: string; weekly: number }
export interface LawnPackageDef { key: string; label: string; visits: number }
export type LawnPackagePrices = Record<string, number>;
export interface LawnConfig {
  BIWEEKLY_RATIO: number;
  TIERS: LawnTier[];
  MOWING_EXTRAS: { PUSH_MOW_ONLY: number; VERY_HILLY: number; CLUTTER: number };
  TRAVEL_ZONES: LawnTravelZone[];
  WEEKLY_CUTS: number;
  BIWEEKLY_CUTS: number;
  MONTHS: number;
  ZONE_MIN_CLIENTS: number;
  ZONE_BREAKEVEN_CLIENTS: number;
  PACKAGES: LawnPackageDef[];
  PACKAGE_PRICES: LawnPackagePrices[];      // per tier index: key -> price (0 = not yet priced)
  PACKAGE_EXTRAS: { VERY_HILLY: number; CLUTTER: number };
  PACKAGE_TRAVEL_PER_VISIT: number[];
}

export const LAWN_CONFIG_V1: LawnConfig = {
  BIWEEKLY_RATIO: 0.75,
  TIERS: [
    { maxSqFt: 1500, weekly: 960 },
    { maxSqFt: 4000, weekly: 1200 },
    { maxSqFt: 7000, weekly: 1440 },
    { maxSqFt: 9500, weekly: 1680 },
    { maxSqFt: 13000, weekly: 1920 },
    { maxSqFt: 17500, weekly: 2160 },
    { maxSqFt: 22500, weekly: 2400 },
    { maxSqFt: null, weekly: 3000 },
  ],
  MOWING_EXTRAS: { PUSH_MOW_ONLY: 200, VERY_HILLY: 200, CLUTTER: 200 },
  TRAVEL_ZONES: [
    { key: 'in_town', label: 'In town', weekly: 0 },
    { key: 'km5', label: 'Within 5 km', weekly: 200 },
    { key: 'km10', label: 'Within 10 km', weekly: 400 },
    { key: 'km15', label: 'Within 15 km', weekly: 800 },
  ],
  WEEKLY_CUTS: 20,
  BIWEEKLY_CUTS: 12,
  MONTHS: 6,
  ZONE_MIN_CLIENTS: 3,
  ZONE_BREAKEVEN_CLIENTS: 5,
  PACKAGES: [
    { key: 'bronze', label: 'Bronze', visits: 2 },
    { key: 'silver', label: 'Silver', visits: 3 },
    { key: 'gold', label: 'Gold', visits: 4 },
    { key: 'dethatch', label: 'Dethatching', visits: 1 },
  ],
  PACKAGE_PRICES: [
    { bronze: 0, silver: 0, gold: 0, dethatch: 0 },
    { bronze: 249, silver: 349, gold: 499, dethatch: 0 },
    { bronze: 0, silver: 0, gold: 0, dethatch: 0 },
    { bronze: 0, silver: 0, gold: 0, dethatch: 0 },
    { bronze: 0, silver: 0, gold: 0, dethatch: 0 },
    { bronze: 0, silver: 0, gold: 0, dethatch: 0 },
    { bronze: 0, silver: 0, gold: 0, dethatch: 0 },
    { bronze: 0, silver: 0, gold: 0, dethatch: 0 },
  ],
  PACKAGE_EXTRAS: { VERY_HILLY: 50, CLUTTER: 50 },
  PACKAGE_TRAVEL_PER_VISIT: [0, 25, 50, 75, 100],
};

// ── VERSION IDS (ready for the lawn rate sheet) ─────────────────────────────
export const LAWN_VERSION_PREFIX = 'lawn-v';
export const LAWN_CONFIG_VERSION = 'lawn-v1';
export const lawnVersionId = (n: number): string => `${LAWN_VERSION_PREFIX}${n}`;
export const lawnVersionNum = (id: string): number => {
  const n = parseInt(String(id || '').replace(LAWN_VERSION_PREFIX, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};
export interface StoredLawnVersion { version: string; config: LawnConfig }
export function resolveLawnConfig(
  versionId: string | undefined,
  versions: Record<string, StoredLawnVersion> | undefined | null,
): LawnConfig {
  const v = versionId && versions ? versions[versionId] : undefined;
  return (v && v.config) ? v.config : LAWN_CONFIG_V1;
}
export function activeLawnVersionId(versions: Record<string, StoredLawnVersion> | undefined | null): string {
  let max = 1;
  for (const id of Object.keys(versions || {})) { const n = lawnVersionNum(id); if (n > max) max = n; }
  return lawnVersionId(max);
}

// ── TIERS ───────────────────────────────────────────────────────────────────
const fmt = (n: number): string => n.toLocaleString('en-US');

/** Resolve a sq ft value to a tier index. `sqft <= maxSqFt` picks the tier;
 *  the last tier (maxSqFt null) catches everything above. null when no size. */
export function resolveTierIndex(sqft: number, config: LawnConfig = LAWN_CONFIG_V1): number | null {
  if (!(Number(sqft) > 0)) return null;
  const tiers = config.TIERS;
  for (let i = 0; i < tiers.length; i++) {
    if (tiers[i].maxSqFt === null || sqft <= (tiers[i].maxSqFt as number)) return i;
  }
  return tiers.length - 1;
}

/** Human range label for a tier index, e.g. "1,501–4,000 sq ft". */
export function tierLabel(index: number, config: LawnConfig = LAWN_CONFIG_V1): string {
  const tiers = config.TIERS;
  const upper = tiers[index].maxSqFt;
  const lower = index === 0 ? 0 : (tiers[index - 1].maxSqFt as number) + 1;
  if (upper === null) return `${fmt(lower)}+ sq ft`;
  if (index === 0) return `Up to ${fmt(upper)} sq ft`;
  return `${fmt(lower)}–${fmt(upper)} sq ft`;
}

// ── MOWING ──────────────────────────────────────────────────────────────────
export interface MowingFlags { pushMow?: boolean; veryHilly?: boolean; clutter?: boolean; travelZone?: string }
export interface MowingFreq { annual: number; monthly: number; perCut: number }
export interface MowingPrice {
  tierIndex: number;
  tierLabel: string;
  weeklyBase: number;
  extras: { pushMow: number; veryHilly: number; clutter: number };
  travel: { key: string; label: string; weekly: number };
  weeklyTotal: number;    // annual weekly-basis total
  biweeklyTotal: number;  // = weeklyTotal * BIWEEKLY_RATIO
  weekly: MowingFreq;
  biweekly: MowingFreq;
}

/**
 * Price mowing for a resolved tier. The biweekly ratio applies to the WHOLE
 * weekly total (tier + extras + travel) — one ratio, no exceptions.
 */
export function priceMowing(tierIndex: number, flags: MowingFlags, config: LawnConfig = LAWN_CONFIG_V1): MowingPrice {
  const weeklyBase = config.TIERS[tierIndex].weekly;
  const extras = {
    pushMow: flags.pushMow ? config.MOWING_EXTRAS.PUSH_MOW_ONLY : 0,
    veryHilly: flags.veryHilly ? config.MOWING_EXTRAS.VERY_HILLY : 0,
    clutter: flags.clutter ? config.MOWING_EXTRAS.CLUTTER : 0,
  };
  const zone = config.TRAVEL_ZONES.find(z => z.key === flags.travelZone) || config.TRAVEL_ZONES[0];
  const weeklyTotal = weeklyBase + extras.pushMow + extras.veryHilly + extras.clutter + zone.weekly;
  const biweeklyTotal = weeklyTotal * config.BIWEEKLY_RATIO;
  const freq = (annual: number, cuts: number): MowingFreq => ({
    annual, monthly: annual / config.MONTHS, perCut: annual / cuts,
  });
  return {
    tierIndex, tierLabel: tierLabel(tierIndex, config), weeklyBase, extras,
    travel: { key: zone.key, label: zone.label, weekly: zone.weekly },
    weeklyTotal, biweeklyTotal,
    weekly: freq(weeklyTotal, config.WEEKLY_CUTS),
    biweekly: freq(biweeklyTotal, config.BIWEEKLY_CUTS),
  };
}

// ── PACKAGES ────────────────────────────────────────────────────────────────
export interface PackageFlags { veryHilly?: boolean; clutter?: boolean }
export interface PackagePrice {
  key: string; label: string; visits: number;
  priced: boolean;      // false → "Not yet priced" (base is 0)
  base: number;
  extras: number;       // package extras (very hilly / clutter) — NOT push mow
  travel: number;       // travelPerVisit * visits
  total: number;
}

/**
 * Price every package for a tier. Packages are INDEPENDENT of mow frequency (no
 * 0.75 ratio). Push mow does NOT apply. Very hilly + clutter use PACKAGE_EXTRAS
 * (the mowing amounts were sized for 20 visits; packages are 2–4). Travel is a
 * per-visit amount × the package's visit count. A base of 0 → "Not yet priced".
 */
export function pricePackages(
  tierIndex: number,
  flags: PackageFlags,
  travelPerVisit: number,
  config: LawnConfig = LAWN_CONFIG_V1,
): PackagePrice[] {
  const prices = config.PACKAGE_PRICES[tierIndex] || {};
  const extraFlat = (flags.veryHilly ? config.PACKAGE_EXTRAS.VERY_HILLY : 0) + (flags.clutter ? config.PACKAGE_EXTRAS.CLUTTER : 0);
  const tpv = Math.max(0, Number(travelPerVisit) || 0);
  return config.PACKAGES.map((p) => {
    const base = Number(prices[p.key]) || 0;
    if (base <= 0) return { key: p.key, label: p.label, visits: p.visits, priced: false, base: 0, extras: 0, travel: 0, total: 0 };
    const travel = tpv * p.visits;
    return { key: p.key, label: p.label, visits: p.visits, priced: true, base, extras: extraFlat, travel, total: base + extraFlat + travel };
  });
}

// ── COMBINED ────────────────────────────────────────────────────────────────
export interface LawnPrice {
  sqft: number;
  tierIndex: number;
  mowing: MowingPrice;
  packages: PackagePrice[];
}

/**
 * Price a lawn from its sq ft. Returns null when there's no size (0 / blank) so
 * the UI shows an empty state rather than crashing.
 */
export function priceLawn(
  sqft: number,
  flags: MowingFlags & PackageFlags,
  travelPerVisit: number,
  config: LawnConfig = LAWN_CONFIG_V1,
): LawnPrice | null {
  const tierIndex = resolveTierIndex(sqft, config);
  if (tierIndex === null) return null;
  return {
    sqft,
    tierIndex,
    mowing: priceMowing(tierIndex, flags, config),
    packages: pricePackages(tierIndex, flags, travelPerVisit, config),
  };
}

// ── CONFIG VALIDATION + DIFF (for the lawn rate sheet) ──────────────────────
// Mirrors validateSnowConfig / diffSnowConfig in snowPricing.ts. The lawn config
// is nested (a tier×package grid, arrays of zones/travel), so the diff flattens
// it to labelled scalar entries first, then compares by key.
export interface RateAuditChange { field: string; key: string; from: string; to: string }

interface FlatEntry { key: string; label: string; value: string }
function flattenLawn(c: LawnConfig): FlatEntry[] {
  const out: FlatEntry[] = [];
  const push = (key: string, label: string, value: unknown) => out.push({ key, label, value: String(value) });
  push('BIWEEKLY_RATIO', 'Biweekly ratio', c.BIWEEKLY_RATIO);
  c.TIERS.forEach((t, i) => {
    const n = i + 1;
    push(`tier${i}.max`, `Tier ${n} · sq ft bound`, t.maxSqFt === null ? 'open' : t.maxSqFt);
    push(`tier${i}.weekly`, `Tier ${n} · Weekly`, t.weekly);
    const pp = c.PACKAGE_PRICES[i] || {};
    c.PACKAGES.forEach(p => push(`tier${i}.${p.key}`, `Tier ${n} · ${p.label}`, Number(pp[p.key]) || 0));
  });
  push('extras.push', 'Mowing · Push mow only', c.MOWING_EXTRAS.PUSH_MOW_ONLY);
  push('extras.hilly', 'Mowing · Very hilly', c.MOWING_EXTRAS.VERY_HILLY);
  push('extras.clutter', 'Mowing · Clutter', c.MOWING_EXTRAS.CLUTTER);
  c.TRAVEL_ZONES.forEach((z, i) => {
    push(`zone${i}.label`, `Travel zone ${i + 1} · Label`, z.label);
    push(`zone${i}.weekly`, `Travel zone ${i + 1} · Weekly`, z.weekly);
  });
  push('pkgExtra.hilly', 'Package · Very hilly', c.PACKAGE_EXTRAS.VERY_HILLY);
  push('pkgExtra.clutter', 'Package · Clutter', c.PACKAGE_EXTRAS.CLUTTER);
  c.PACKAGE_TRAVEL_PER_VISIT.forEach((v, i) => push(`pkgTravel${i}`, `Package travel · slot ${i + 1}`, v));
  c.PACKAGES.forEach(p => push(`visits.${p.key}`, `${p.label} · visits`, p.visits));
  push('season.weeklyCuts', 'Season · Weekly cuts', c.WEEKLY_CUTS);
  push('season.biweeklyCuts', 'Season · Biweekly cuts', c.BIWEEKLY_CUTS);
  push('season.months', 'Season · Months', c.MONTHS);
  push('zone.min', 'Zone · Min clients', c.ZONE_MIN_CLIENTS);
  push('zone.break', 'Zone · Break-even clients', c.ZONE_BREAKEVEN_CLIENTS);
  return out;
}

/** Field-level diff of two lawn configs → audit changes (added/removed/changed). */
export function diffLawnConfig(oldC: LawnConfig, newC: LawnConfig): RateAuditChange[] {
  const oldFlat = flattenLawn(oldC);
  const newFlat = flattenLawn(newC);
  const oldMap = new Map(oldFlat.map(e => [e.key, e]));
  const newMap = new Map(newFlat.map(e => [e.key, e]));
  const out: RateAuditChange[] = [];
  for (const e of newFlat) {
    const old = oldMap.get(e.key);
    if (!old) out.push({ field: e.label, key: e.key, from: '—', to: e.value });        // added
    else if (old.value !== e.value) out.push({ field: e.label, key: e.key, from: old.value, to: e.value }); // changed
  }
  for (const e of oldFlat) {
    if (!newMap.has(e.key)) out.push({ field: e.label, key: e.key, from: e.value, to: '—' }); // removed
  }
  return out;
}

/** Validate an edited lawn config. Returns a list of problems ([] = valid). */
export function validateLawnConfig(c: LawnConfig): string[] {
  const errs: string[] = [];
  const tiers = c.TIERS || [];
  if (tiers.length < 1) errs.push('At least one mowing tier is required.');
  tiers.forEach((t, i) => {
    const last = i === tiers.length - 1;
    if (last) {
      if (t.maxSqFt !== null) errs.push('The last tier must be the open-ended tier (no upper bound).');
    } else if (!(Number(t.maxSqFt) > 0)) {
      errs.push(`Tier ${i + 1} needs a positive sq ft upper bound.`);
    }
    if (!(Number(t.weekly) > 0)) errs.push(`Tier ${i + 1} weekly price must be greater than 0.`);
  });
  // Strictly ascending sq ft bounds (no gaps or overlaps).
  for (let i = 1; i < tiers.length; i++) {
    const prev = tiers[i - 1].maxSqFt; const cur = tiers[i].maxSqFt;
    if (prev !== null && cur !== null && !(cur > prev)) { errs.push('Sq ft bounds must be strictly ascending (no gaps or overlaps).'); break; }
  }
  // Package prices >= 0 (zero allowed).
  tiers.forEach((_, i) => {
    const pp = c.PACKAGE_PRICES[i] || {};
    for (const p of c.PACKAGES) if (Number(pp[p.key]) < 0) errs.push(`Tier ${i + 1} ${p.label} price cannot be negative.`);
  });
  // Extras + travel amounts >= 0.
  const nn = (v: unknown) => Number(v) >= 0;
  if (!nn(c.MOWING_EXTRAS.PUSH_MOW_ONLY) || !nn(c.MOWING_EXTRAS.VERY_HILLY) || !nn(c.MOWING_EXTRAS.CLUTTER)) errs.push('Mowing extras cannot be negative.');
  if (c.TRAVEL_ZONES.some(z => !nn(z.weekly))) errs.push('Travel zone prices cannot be negative.');
  if (!nn(c.PACKAGE_EXTRAS.VERY_HILLY) || !nn(c.PACKAGE_EXTRAS.CLUTTER)) errs.push('Package extras cannot be negative.');
  if (c.PACKAGE_TRAVEL_PER_VISIT.some(v => !nn(v))) errs.push('Package travel amounts cannot be negative.');
  // Ratio strictly between 0 and 1.
  if (!(Number(c.BIWEEKLY_RATIO) > 0 && Number(c.BIWEEKLY_RATIO) < 1)) errs.push('Biweekly ratio must be between 0 and 1.');
  // Cut counts + months > 0.
  if (!(Number(c.WEEKLY_CUTS) > 0)) errs.push('Weekly cuts must be greater than 0.');
  if (!(Number(c.BIWEEKLY_CUTS) > 0)) errs.push('Biweekly cuts must be greater than 0.');
  if (!(Number(c.MONTHS) > 0)) errs.push('Months must be greater than 0.');
  // Package visit counts > 0.
  if (c.PACKAGES.some(p => !(Number(p.visits) > 0))) errs.push('Package visit counts must be greater than 0.');
  return [...new Set(errs)];
}

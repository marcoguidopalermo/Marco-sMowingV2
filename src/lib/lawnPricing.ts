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
// Travel is PER VISIT (the only exception to the 0.75 ratio) — the season figure
// derives from the cut count, so a biweekly client isn't overcharged for drives
// they don't get.
export interface LawnTravelZone { key: string; label: string; perVisit: number }
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
  // ── Mid-season proration + overgrown catch-up + BH (MOWING ONLY) ──────────
  SEASON_START: string;            // 'YYYY-MM-DD' — resettable each year
  WEEKS_IN_SEASON: number;         // end derives as start + this many weeks
  DISCOUNT_PER_WEEK: number;       // percent, per elapsed week
  MOWING_ALLOCATION_RATE: number;  // $/hr, for billable hours
  OVERGROWN: LawnOvergrown[];      // catch-up ladder — first-visit BH multiplier per option
}
export interface LawnOvergrown { key: string; label: string; multiplier: number }

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
    { key: 'in_town', label: 'In town', perVisit: 0 },
    { key: 'km5', label: 'Within 5 km', perVisit: 10 },
    { key: 'km10', label: 'Within 10 km', perVisit: 20 },
    { key: 'km15', label: 'Within 15 km', perVisit: 40 },
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
  SEASON_START: '2026-05-25',
  WEEKS_IN_SEASON: 20,
  DISCOUNT_PER_WEEK: 5,
  MOWING_ALLOCATION_RATE: 100,
  OVERGROWN: [
    { key: 'normal', label: 'Normal', multiplier: 1 },
    { key: 'double', label: 'Double cut', multiplier: 2 },
    { key: 'triple', label: 'Triple cut', multiplier: 3 },
    { key: 'quad', label: '4× cut', multiplier: 4 },
    { key: 'quint', label: '5× cut', multiplier: 5 },
  ],
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
  travel: { key: string; label: string; perVisit: number; weeklySeason: number; biweeklySeason: number };
  weeklyTotal: number;
  biweeklyTotal: number;
  weekly: MowingFreq;
  biweekly: MowingFreq;
}

/**
 * Price mowing for a resolved tier. The 0.75 ratio applies to the base tier and
 * the season-based extras (push mow / hilly / clutter). TRAVEL is the exception:
 * it is a per-visit amount × the frequency's cut count, so a biweekly client
 * (12 drives) isn't charged 75% of a 20-visit travel cost.
 */
export function priceMowing(tierIndex: number, flags: MowingFlags, config: LawnConfig = LAWN_CONFIG_V1): MowingPrice {
  const weeklyBase = config.TIERS[tierIndex].weekly;
  const extras = {
    pushMow: flags.pushMow ? config.MOWING_EXTRAS.PUSH_MOW_ONLY : 0,
    veryHilly: flags.veryHilly ? config.MOWING_EXTRAS.VERY_HILLY : 0,
    clutter: flags.clutter ? config.MOWING_EXTRAS.CLUTTER : 0,
  };
  const ratioed = weeklyBase + extras.pushMow + extras.veryHilly + extras.clutter; // 0.75 applies to this
  const zone = config.TRAVEL_ZONES.find(z => z.key === flags.travelZone) || config.TRAVEL_ZONES[0];
  const weeklySeason = zone.perVisit * config.WEEKLY_CUTS;
  const biweeklySeason = zone.perVisit * config.BIWEEKLY_CUTS;
  const weeklyTotal = ratioed + weeklySeason;
  const biweeklyTotal = ratioed * config.BIWEEKLY_RATIO + biweeklySeason;
  const freq = (annual: number, cuts: number): MowingFreq => ({
    annual, monthly: annual / config.MONTHS, perCut: annual / cuts,
  });
  return {
    tierIndex, tierLabel: tierLabel(tierIndex, config), weeklyBase, extras,
    travel: { key: zone.key, label: zone.label, perVisit: zone.perVisit, weeklySeason, biweeklySeason },
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

// ── MID-SEASON PRORATION + OVERGROWN CATCH-UP + BH (MOWING ONLY) ─────────────
// Proration is BY WEEK, never by month. Packages are never prorated.
const DAY_MS = 86_400_000;
function ymdToDayNum(ymd: string): number {
  const [y, m, d] = String(ymd).split('-').map(Number);
  if (!y || !m || !d) return NaN;
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}
function dayNumToYmd(n: number): string {
  const dt = new Date(n * DAY_MS);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
/** True only for a real calendar date in YYYY-MM-DD form. */
export function isValidYmd(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return false;
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
/** The LAST cutting week's Monday = SEASON_START + (WEEKS_IN_SEASON − 1) weeks.
 *  (Not a season-end instant — the 20th cutting week begins here.) */
export function seasonEndDate(config: LawnConfig = LAWN_CONFIG_V1): string {
  return dayNumToYmd(ymdToDayNum(config.SEASON_START) + (config.WEEKS_IN_SEASON - 1) * 7);
}
/** The season week the signup falls IN (1-indexed). 0 = before the season
 *  starts (full season, no discount). Clamped to WEEKS_IN_SEASON. */
export function signupSeasonWeek(startDate: string, config: LawnConfig = LAWN_CONFIG_V1): number {
  const diff = ymdToDayNum(startDate) - ymdToDayNum(config.SEASON_START);
  if (!Number.isFinite(diff) || diff < 0) return 0;
  return Math.max(1, Math.min(config.WEEKS_IN_SEASON, Math.floor(diff / 7) + 1));
}
/** Overgrown discount reduction, always derived: (multiplier − 1) × DISCOUNT_PER_WEEK. */
export function overgrownReductionPct(multiplier: number, config: LawnConfig = LAWN_CONFIG_V1): number {
  return (multiplier - 1) * config.DISCOUNT_PER_WEEK;
}
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Month-ends from the signup month THROUGH October (inclusive). */
export function availableMonthEnds(startDate: string): number {
  const month = Number(String(startDate).slice(5, 7)) || 1;
  return Math.max(0, 11 - month);
}
function monthEndYmd(year: number, month1to12: number): string {
  const dt = new Date(Date.UTC(year, month1to12, 0)); // day 0 of next month = last day of this
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
/** The last `count` month-ends through October (month 10) of `year`. */
export function billingDates(year: number, count: number): string[] {
  const out: string[] = [];
  for (let m = 10 - count + 1; m <= 10; m++) if (m >= 1) out.push(monthEndYmd(year, m));
  return out;
}

export type FirstCut = 'this' | 'next';
export interface SeasonDiscount {
  signupWeek: number;              // week the signup falls in (1-indexed; 0 = before season)
  firstCut: FirstCut;
  firstServiceWeek: number;        // first week actually serviced
  weeksServiced: number;           // WEEKS − firstServiceWeek + 1
  seasonDiscountPct: number;       // (WEEKS − weeksServiced) / WEEKS × 100 — never negative
  overgrownKey: string;
  overgrownLabel: string;
  overgrownMultiplier: number;
  catchUpPct: number;              // (mult − 1) × DISCOUNT_PER_WEEK — billed separately
}
export interface SeasonFreqPlan {
  fullPrice: number;               // full seasonal price (the renewal anchor)
  cuts: number;
  proratedTotal: number;           // fullPrice × (1 − seasonDiscount) — never a surcharge
  monthly: number;                 // fullPrice / MONTHS — STANDARD recurring amount
  instalments: number;             // count, chosen so the deposit fits one payment
  deposit: number;                 // proratedTotal − instalments × monthly ∈ [0, monthly]
  catchUpCharge: number;           // one-time, billed separately from the season
  firstInvoice: number;            // deposit + catchUpCharge
  cutsLeft: number;
  internalPPC: number;             // proratedTotal / cutsLeft — internal only
  bhPerVisit: number;              // full price / full cuts / rate
  firstVisitBH: number;            // bhPerVisit × overgrown multiplier
  billingDates: string[];          // the instalment month-ends (last N through Oct 31)
}
export interface SeasonPlan {
  startDate: string;
  seasonEnd: string;
  discount: SeasonDiscount;
  weekly: SeasonFreqPlan;
  biweekly: SeasonFreqPlan;
}

/**
 * Mid-season plan for a mowing quote. The discount reflects the weeks the client
 * is actually SERVICED, which depends on the signup week AND whether they can be
 * fitted into this week's route or the next. Returns NULL when no cutting weeks
 * remain (a "next week" signup in the last week, or a signup past the season) —
 * there is no price to quote. The overgrown catch-up is a separate one-time
 * charge; instalments are chosen so the deposit fits one payment; BH uses full
 * price + full cut count. Packages are never involved.
 */
export function computeSeasonPlan(
  mowing: MowingPrice, startDate: string, overgrownKey: string,
  firstCut: FirstCut = 'next', config: LawnConfig = LAWN_CONFIG_V1,
): SeasonPlan | null {
  const WEEKS = config.WEEKS_IN_SEASON;
  const diff = ymdToDayNum(startDate) - ymdToDayNum(config.SEASON_START);
  const beforeSeason = !Number.isFinite(diff) || diff < 0;
  // Raw week is unclamped upward so a signup past the last cutting week resolves
  // to 0 weeks serviced (and is blocked below).
  const rawWeek = beforeSeason ? 0 : Math.floor(diff / 7) + 1;
  const signupWeek = beforeSeason ? 0 : Math.min(WEEKS, rawWeek);
  const firstServiceWeek = signupWeek === 0 ? 1 : (firstCut === 'this' ? rawWeek : rawWeek + 1);
  const weeksServiced = Math.max(0, WEEKS - firstServiceWeek + 1);
  if (weeksServiced <= 0) return null; // no cuts remaining this season

  const seasonDiscountPct = round2((WEEKS - weeksServiced) / WEEKS * 100);
  const og = config.OVERGROWN.find(o => o.key === overgrownKey) || config.OVERGROWN[0];
  const catchUpPct = overgrownReductionPct(og.multiplier, config);
  const avail = availableMonthEnds(startDate);
  const year = Number(String(startDate).slice(0, 4)) || Number(String(config.SEASON_START).slice(0, 4));

  const freq = (fullPrice: number, cuts: number): SeasonFreqPlan => {
    const proratedTotal = round2(fullPrice * (1 - seasonDiscountPct / 100));
    const monthly = config.MONTHS > 0 ? round2(fullPrice / config.MONTHS) : 0;
    const maxByPrice = monthly > 0 ? Math.floor(proratedTotal / monthly) : 0;
    const instalments = Math.max(0, Math.min(avail, maxByPrice));
    const deposit = round2(proratedTotal - instalments * monthly);
    const catchUpCharge = round2((catchUpPct / 100) * fullPrice);
    const cutsLeft = WEEKS > 0 ? Math.round(cuts * weeksServiced / WEEKS) : 0;
    const bhPerVisit = cuts > 0 ? fullPrice / cuts / config.MOWING_ALLOCATION_RATE : 0;
    return {
      fullPrice, cuts, proratedTotal, monthly, instalments, deposit, catchUpCharge,
      firstInvoice: round2(deposit + catchUpCharge),
      cutsLeft, internalPPC: cutsLeft > 0 ? round2(proratedTotal / cutsLeft) : 0,
      bhPerVisit, firstVisitBH: bhPerVisit * og.multiplier,
      billingDates: billingDates(year, instalments),
    };
  };
  return {
    startDate, seasonEnd: seasonEndDate(config),
    discount: {
      signupWeek, firstCut, firstServiceWeek, weeksServiced, seasonDiscountPct,
      overgrownKey: og.key, overgrownLabel: og.label, overgrownMultiplier: og.multiplier, catchUpPct,
    },
    weekly: freq(mowing.weeklyTotal, config.WEEKLY_CUTS),
    biweekly: freq(mowing.biweeklyTotal, config.BIWEEKLY_CUTS),
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
    push(`zone${i}.perVisit`, `Travel zone ${i + 1} · Per visit`, z.perVisit);
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
  push('season.start', 'Season start', c.SEASON_START);
  push('season.weeks', 'Weeks in season', c.WEEKS_IN_SEASON);
  push('season.discPerWeek', 'Discount per week (%)', c.DISCOUNT_PER_WEEK);
  push('season.allocRate', 'Mowing allocation rate ($/hr)', c.MOWING_ALLOCATION_RATE);
  c.OVERGROWN.forEach(o => push(`overgrown.${o.key}`, `Overgrown · ${o.label} ×`, o.multiplier));
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
  if (c.TRAVEL_ZONES.some(z => !nn(z.perVisit))) errs.push('Travel zone per-visit prices cannot be negative.');
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
  // Season / proration.
  if (!isValidYmd(c.SEASON_START)) errs.push('Season start must be a real date (YYYY-MM-DD).');
  if (!(Number(c.WEEKS_IN_SEASON) > 0)) errs.push('Weeks in season must be greater than 0.');
  if (!nn(c.DISCOUNT_PER_WEEK)) errs.push('Discount per week cannot be negative.');
  if (!(Number(c.MOWING_ALLOCATION_RATE) > 0)) errs.push('Mowing allocation rate must be greater than 0.');
  // Overgrown multipliers strictly ascending, all > 0.
  const mults = (c.OVERGROWN || []).map(o => Number(o.multiplier));
  if (!mults.length) errs.push('At least one overgrown option is required.');
  if (mults.some(m => !(m > 0))) errs.push('Overgrown multipliers must be greater than 0.');
  for (let i = 1; i < mults.length; i++) if (!(mults[i] > mults[i - 1])) { errs.push('Overgrown multipliers must ascend.'); break; }
  return [...new Set(errs)];
}

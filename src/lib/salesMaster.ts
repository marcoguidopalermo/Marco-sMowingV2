// SalesMaster v1 — pure pricing math + the seeded rates sheet. No I/O, no
// contact with PerformanceMaster's live BH/pay data. The BH identity mirrors
// PerformanceMaster's formula (BH = (quote − materials) ÷ serviceRate) for
// consistency only — this is a pre-job estimator.
import { SalesRates, SalesService, SalesMaterial, SalesQuote } from '../types';

// ── SEED (the coded default when settings.salesMaster is absent). Admins add
// the rest in-app. Real numbers only — no placeholder costs.
export const DEFAULT_SALES_RATES: SalesRates = {
  labourCostPerHrDefault: 25,
  overheadPerBH: 30,
  overheadNote: 'placeholder — pending QBO-derived calculation',
  services: [
    { id: 'svc-stump', name: 'Stump Grinding', chargeRatePerHr: 150, active: true },
    { id: 'svc-mowing', name: 'Mowing', chargeRatePerHr: 100, active: true },
    { id: 'svc-sod', name: 'Sod', chargeRatePerHr: 120, labourCostPerHr: 30, active: true },
    { id: 'svc-arborist', name: 'Arborist Work', chargeRatePerHr: 120, active: true },
    { id: 'svc-beds', name: 'Garden Beds', chargeRatePerHr: 100, active: true },
    { id: 'svc-cleanups', name: 'Cleanups', chargeRatePerHr: 100, active: true },
  ],
  materials: [
    { id: 'mat-sod', name: 'Sod', unit: 'sqft', costPerUnit: 0.43, chargePerUnit: 0.50, active: true },
    { id: 'mat-soil', name: 'Soil', unit: 'yard', costPerUnit: 35, chargePerUnit: 50, active: true, coverageSqft: 100, coverageDepthInches: 3 },
    { id: 'mat-disposal', name: 'Disposal', unit: 'load', costPerUnit: 50, chargePerUnit: 100, active: true },
  ],
};

export function ratesOrDefault(rates?: SalesRates | null): SalesRates {
  if (!rates || !Array.isArray(rates.services) || !Array.isArray(rates.materials)) return DEFAULT_SALES_RATES;
  return {
    labourCostPerHrDefault: Number(rates.labourCostPerHrDefault) || DEFAULT_SALES_RATES.labourCostPerHrDefault,
    overheadPerBH: rates.overheadPerBH != null ? Number(rates.overheadPerBH) || 0 : DEFAULT_SALES_RATES.overheadPerBH,
    overheadNote: rates.overheadNote,
    services: rates.services,
    materials: rates.materials,
  };
}

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export interface MaterialLine {
  materialId: string; qty: number;
  // Coverage-calc provenance (optional).
  coverageNote?: string; area?: number; depthInches?: number;
}
export interface MaterialLineDetail {
  materialId: string; name: string; unit: string; qty: number;
  chargePerUnit: number; lineCharge: number;
  costPerUnit: number; lineCost: number;   // cost fields — admin display only
  coverageNote?: string; area?: number; depthInches?: number;
}

// Coverage rule: "one <unit> covers coverageSqft at coverageDepthInches"."
// qty scales linearly with depth: qty = (area × depth) ÷ (coverageSqft ×
// coverageDepthInches). null when the material has no coverage rule / bad input.
export function coverageQty(m: Pick<SalesMaterial, 'coverageSqft' | 'coverageDepthInches'>, area: number, depthInches: number): number | null {
  const cSqft = Number(m.coverageSqft) || 0;
  const cDepth = Number(m.coverageDepthInches) || 0;
  const a = Number(area) || 0;
  const d = Number(depthInches) || 0;
  if (!(cSqft > 0) || !(cDepth > 0) || !(a > 0) || !(d > 0)) return null;
  return (a * d) / (cSqft * cDepth);
}
// Round UP to the next 0.5 increment (you order 10 yd, not 9.83).
export function roundUpHalf(n: number): number {
  return Math.ceil((Number(n) || 0) / 0.5) * 0.5;
}
export function hasCoverage(m: Pick<SalesMaterial, 'coverageSqft' | 'coverageDepthInches'> | undefined): boolean {
  return !!m && (Number(m.coverageSqft) || 0) > 0 && (Number(m.coverageDepthInches) || 0) > 0;
}
// Inline working, e.g. `1000 sqft @ 3" → 10 yd`.
export function coverageWorking(unit: string, area: number, depthInches: number, qty: number): string {
  const abbr: Record<string, string> = { yard: 'yd', sqft: 'sqft', load: 'load', each: 'each', tonne: 't' };
  return `${area} sqft @ ${depthInches}" → ${qty} ${abbr[unit] || unit}`;
}

export interface QuoteBreakdown {
  materialsCharged: number;
  materialsCost: number;                    // admin only
  labourCharge: number;
  quoteTotal: number;
  bh: number;
  serviceRate: number;
  lines: MaterialLineDetail[];
}

// Base quote from service + material lines + budgeted BH.
export function computeQuote(
  service: SalesService | undefined,
  lines: MaterialLine[],
  bh: number,
  rates: SalesRates,
): QuoteBreakdown {
  const serviceRate = Number(service?.chargeRatePerHr) || 0;
  const matById = new Map(rates.materials.map(m => [m.id, m]));
  const details: MaterialLineDetail[] = [];
  let materialsCharged = 0;
  let materialsCost = 0;
  for (const ln of lines) {
    const m = matById.get(ln.materialId);
    if (!m) continue;
    const qty = Number(ln.qty) || 0;
    const lineCharge = round2(qty * (Number(m.chargePerUnit) || 0));
    const lineCost = round2(qty * (Number(m.costPerUnit) || 0));
    materialsCharged += lineCharge;
    materialsCost += lineCost;
    details.push({ materialId: m.id, name: m.name, unit: m.unit, qty, chargePerUnit: m.chargePerUnit, lineCharge, costPerUnit: m.costPerUnit, lineCost, coverageNote: ln.coverageNote, area: ln.area, depthInches: ln.depthInches });
  }
  materialsCharged = round2(materialsCharged);
  materialsCost = round2(materialsCost);
  const bhNum = Number(bh) || 0;
  const labourCharge = round2(bhNum * serviceRate);
  const quoteTotal = round2(materialsCharged + labourCharge);
  return { materialsCharged, materialsCost, labourCharge, quoteTotal, bh: bhNum, serviceRate, lines: details };
}

// Two-way manipulation. Materials are held constant; every added dollar flows
// to BH (and vice-versa). serviceRate must be > 0.
export function bhFromPrice(newPrice: number, materialsCharged: number, serviceRate: number): number {
  if (!(serviceRate > 0)) return 0;
  // Full precision — round only for DISPLAY. Rounding here would break the
  // identity (a rounded 28.33 BH re-derives a $4,399.60 quote, not $4,400).
  return ((Number(newPrice) || 0) - (Number(materialsCharged) || 0)) / serviceRate;
}
export function priceFromBH(bh: number, materialsCharged: number, serviceRate: number): number {
  return round2((Number(bh) || 0) * (Number(serviceRate) || 0) + (Number(materialsCharged) || 0));
}

// PRICE-FIRST QUOTING. The identity is the same one bhFromPrice already
// implements; this exposes its WORKING so the resulting BH can be checked at
// a glance rather than taken on trust:
//
//   $4,500 − $600 materials = $3,900 ÷ $120/hr = 32.5 BH
//
// PRECISION. `exact` is full precision and is what the quote carries —
// rounding it here would break the identity (a stored 32.19 BH re-derives
// $4,500.60, not the $4,500 that was typed). `display` is that figure at 2
// decimals, matching the BH precision used elsewhere. When the two differ,
// `roundedPrice` says what the total WOULD become if the displayed figure
// were adopted, so snapping is an explicit choice with a visible cost rather
// than a silent drift.
export interface PriceFirstWorking {
  targetPrice: number;
  materialsCharged: number;
  labourBudget: number;    // price − materials
  serviceRate: number;
  exact: number;           // BH, full precision
  display: number;         // BH at 2 dp
  rounds: boolean;         // display !== exact
  roundedPrice: number;    // the total implied by the 2 dp figure
  valid: boolean;          // a rate > 0 and a price that covers materials
  shortfall: boolean;      // the price doesn't even cover the materials
  working: string;
}

export function priceFirstWorking(
  targetPrice: number,
  materialsCharged: number,
  serviceRate: number,
): PriceFirstWorking {
  const price = Number(targetPrice) || 0;
  const mats = round2(Number(materialsCharged) || 0);
  const rate = Number(serviceRate) || 0;
  const labourBudget = round2(price - mats);
  const exact = rate > 0 ? (price - mats) / rate : 0;
  const display = round2(exact);
  const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return {
    targetPrice: price,
    materialsCharged: mats,
    labourBudget,
    serviceRate: rate,
    exact,
    display,
    rounds: display !== exact,
    roundedPrice: priceFromBH(display, mats, rate),
    valid: rate > 0 && price >= mats,
    shortfall: price < mats,
    working: rate > 0
      ? `${money(price)} − ${money(mats)} materials = ${money(labourBudget)} ÷ $${rate}/hr = ${display} BH`
      : 'pick a service — its hourly rate is what converts price into BH',
  };
}

// The internal labour cost/hr for a service (its override, else global default).
export function labourCostFor(service: SalesService | undefined, rates: SalesRates): number {
  const override = service?.labourCostPerHr;
  return (override != null && Number.isFinite(Number(override))) ? Number(override) : (Number(rates.labourCostPerHrDefault) || 0);
}

export interface ProfitPanel {
  materialsCost: number;
  labourCostBudget: number;   // BH × cost
  labourCost80: number;       // (BH ÷ 0.8) × cost
  totalCostBudget: number;
  totalCost80: number;
  gpBudget: number; marginBudget: number;   // at 100% (budget)
  gp80: number; margin80: number;            // at 80% efficiency
}

// Admin-only profit band. `quoteTotal` is the client price; costs never leave
// this computation on the manager side (the component gates it on isAdmin).
export function computeProfit(q: QuoteBreakdown, service: SalesService | undefined, rates: SalesRates): ProfitPanel {
  const cost = labourCostFor(service, rates);
  const labourCostBudget = round2(q.bh * cost);
  const labourCost80 = round2((q.bh / 0.8) * cost);
  const totalCostBudget = round2(q.materialsCost + labourCostBudget);
  const totalCost80 = round2(q.materialsCost + labourCost80);
  const gpBudget = round2(q.quoteTotal - totalCostBudget);
  const gp80 = round2(q.quoteTotal - totalCost80);
  const marginBudget = q.quoteTotal > 0 ? round2((gpBudget / q.quoteTotal) * 100) : 0;
  const margin80 = q.quoteTotal > 0 ? round2((gp80 / q.quoteTotal) * 100) : 0;
  return { materialsCost: q.materialsCost, labourCostBudget, labourCost80, totalCostBudget, totalCost80, gpBudget, marginBudget, gp80, margin80 };
}

// Three-scenario profit table (100% / 80% / 60% efficiency). Actual hours =
// BH ÷ eff; labour cost scales with actual hours; material cost is constant;
// overhead is per BUDGETED BH (BH × overheadPerBH — constant across columns).
export const PROFIT_EFFS = [1.0, 0.8, 0.6] as const;
export interface ProfitCol {
  eff: number;
  actualHours: number;
  labourCost: number;
  materialCost: number;
  gp: number; margin: number;
  overhead: number;             // actual hours × overheadPerBH (per column)
  net: number; netMargin: number;
}
export interface ProfitTable {
  overheadPerBH: number;
  hasOverhead: boolean;         // false when overheadPerBH is 0/unset → hide net rows
  cols: ProfitCol[];
}
export function computeProfitTable(q: QuoteBreakdown, service: SalesService | undefined, rates: SalesRates): ProfitTable {
  const cost = labourCostFor(service, rates);
  const overheadPerBH = Number(rates.overheadPerBH) || 0;
  const cols: ProfitCol[] = PROFIT_EFFS.map(eff => {
    const hoursPrecise = q.bh / eff;
    const labourCost = round2(hoursPrecise * cost);
    const materialCost = q.materialsCost;
    const gp = round2(q.quoteTotal - (materialCost + labourCost));
    const margin = q.quoteTotal > 0 ? round2((gp / q.quoteTotal) * 100) : 0;
    // Overhead burns per ACTUAL shop-hour — a slower job consumes more shop
    // time, so it scales with actual hours (BH ÷ eff), not budgeted BH.
    const overhead = round2(hoursPrecise * overheadPerBH);
    const net = round2(gp - overhead);
    const netMargin = q.quoteTotal > 0 ? round2((net / q.quoteTotal) * 100) : 0;
    return { eff, actualHours: round2(hoursPrecise), labourCost, materialCost, gp, margin, overhead, net, netMargin };
  });
  return { overheadPerBH, hasOverhead: overheadPerBH > 0, cols };
}

export const money = (n: number): string => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Snapshot the current calculator state into a saveable quote. CHARGE-SIDE
// ONLY — no cost fields (managers never see cost; GP stays live/admin-only).
// Rates are captured here so a later rate change never rewrites this quote.
export function buildQuoteSnapshot(id: string, name: string, service: SalesService | undefined, q: QuoteBreakdown, rates: SalesRates): SalesQuote {
  return {
    id, name,
    serviceId: service?.id || '',
    serviceName: service?.name || '',
    serviceChargeRate: q.serviceRate,
    lines: q.lines.map(l => ({ materialId: l.materialId, name: l.name, unit: l.unit, qty: l.qty, chargePerUnit: l.chargePerUnit, coverageNote: l.coverageNote, area: l.area, depthInches: l.depthInches })),
    bh: q.bh,
    materialsCharged: q.materialsCharged,
    labourCharge: q.labourCharge,
    quoteTotal: q.quoteTotal,
    overheadPerBH: Number(rates.overheadPerBH) || 0,
  };
}


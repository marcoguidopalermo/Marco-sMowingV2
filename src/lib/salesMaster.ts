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
    { id: 'mat-soil', name: 'Soil', unit: 'yard', costPerUnit: 35, chargePerUnit: 50, active: true },
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

export interface MaterialLine { materialId: string; qty: number; }
export interface MaterialLineDetail {
  materialId: string; name: string; unit: string; qty: number;
  chargePerUnit: number; lineCharge: number;
  costPerUnit: number; lineCost: number;   // cost fields — admin display only
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
    details.push({ materialId: m.id, name: m.name, unit: m.unit, qty, chargePerUnit: m.chargePerUnit, lineCharge, costPerUnit: m.costPerUnit, lineCost });
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
  net: number; netMargin: number;
}
export interface ProfitTable {
  overheadPerBH: number;
  overhead: number;             // BH × overheadPerBH (constant)
  hasOverhead: boolean;         // false when overheadPerBH is 0/unset → hide net rows
  cols: ProfitCol[];
}
export function computeProfitTable(q: QuoteBreakdown, service: SalesService | undefined, rates: SalesRates): ProfitTable {
  const cost = labourCostFor(service, rates);
  const overheadPerBH = Number(rates.overheadPerBH) || 0;
  const overhead = round2(q.bh * overheadPerBH);
  const cols: ProfitCol[] = PROFIT_EFFS.map(eff => {
    const hoursPrecise = q.bh / eff;
    const labourCost = round2(hoursPrecise * cost);
    const materialCost = q.materialsCost;
    const gp = round2(q.quoteTotal - (materialCost + labourCost));
    const margin = q.quoteTotal > 0 ? round2((gp / q.quoteTotal) * 100) : 0;
    const net = round2(gp - overhead);
    const netMargin = q.quoteTotal > 0 ? round2((net / q.quoteTotal) * 100) : 0;
    return { eff, actualHours: round2(hoursPrecise), labourCost, materialCost, gp, margin, net, netMargin };
  });
  return { overheadPerBH, overhead, hasOverhead: overheadPerBH > 0, cols };
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
    lines: q.lines.map(l => ({ materialId: l.materialId, name: l.name, unit: l.unit, qty: l.qty, chargePerUnit: l.chargePerUnit })),
    bh: q.bh,
    materialsCharged: q.materialsCharged,
    labourCharge: q.labourCharge,
    quoteTotal: q.quoteTotal,
    overheadPerBH: Number(rates.overheadPerBH) || 0,
  };
}


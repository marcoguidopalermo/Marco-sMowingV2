// ContractingMaster (Palermo's) — pure billing math + constants. NO I/O, and
// ZERO contact with performance/BH/bonus/pay. Its own tenant.
import {
  ContractingRateCard, ContractingBillingRole, ContractingReceipt, ContractingLabourLine,
  ContractingReportSnapshot, ContractingProject, ContractingPhase, ContractingInvoice, ContractingTimeEntry,
  ContractingProperty, ContractingProgressReport, Employee,
} from '../types';

export const HST_PCT = 0.13;

export const DEFAULT_CONTRACTING_RATES: ContractingRateCard = {
  gc_pm: 150,
  skilled_carpenter: 120,
  general_labour: 80,
};
export function ratesOrDefault(r?: ContractingRateCard | null): ContractingRateCard {
  if (!r) return DEFAULT_CONTRACTING_RATES;
  return {
    gc_pm: Number(r.gc_pm) || DEFAULT_CONTRACTING_RATES.gc_pm,
    skilled_carpenter: Number(r.skilled_carpenter) || DEFAULT_CONTRACTING_RATES.skilled_carpenter,
    general_labour: Number(r.general_labour) || DEFAULT_CONTRACTING_RATES.general_labour,
  };
}
export const ROLE_LABEL: Record<ContractingBillingRole, string> = {
  gc_pm: 'GC / PM',
  skilled_carpenter: 'Skilled Carpenter',
  general_labour: 'General Labour',
};
export function rateFor(role: ContractingBillingRole | undefined, rates: ContractingRateCard): number {
  if (role === 'gc_pm') return rates.gc_pm;
  if (role === 'skilled_carpenter') return rates.skilled_carpenter;
  if (role === 'general_labour') return rates.general_labour;
  return 0;
}
// The effective hourly rate for a contractor: a custom override wins, else the
// billing-role rate card.
export function contractorRate(emp: Pick<Employee, 'contractingBillingRole' | 'contractingHourlyOverride'> | undefined, rates: ContractingRateCard): number {
  if (emp?.contractingHourlyOverride != null && emp.contractingHourlyOverride > 0) return emp.contractingHourlyOverride;
  return rateFor(emp?.contractingBillingRole, rates);
}
// Map contractorId → effective rate, for report math that must honor overrides.
export function rateMapFor(employees: Employee[], rates: ContractingRateCard): Record<string, number> {
  const m: Record<string, number> = {};
  for (const e of employees) {
    if (e.systemRole === 'contractor' && e.contractingHourlyOverride != null && e.contractingHourlyOverride > 0) m[e.id] = e.contractingHourlyOverride;
  }
  return m;
}

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
export const money = (n: number): string => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Billable hours for one SITE VISIT (a clock session): round to the nearest
// 15-minute increment, with a 1-hour minimum per visit.
export function roundVisitHours(rawHours: number): number {
  const raw = Number(rawHours) || 0;
  if (raw <= 0) return 0;
  const quarter = Math.round(raw * 4) / 4;   // nearest 15 min
  return Math.max(1, quarter);
}

// Billed value of a receipt: cost × (1 + markup%). cost + markup are INTERNAL.
export function receiptBilled(cost: number, markupPct: number): number {
  return round2((Number(cost) || 0) * (1 + (Number(markupPct) || 0) / 100));
}

export interface LabourInput { contractorId: string; name: string; billingRole: ContractingBillingRole; hours: number; }

// The live billing preview / snapshot for a progress report. Aggregates labour
// per person, sums materials at their billed (marked-up) value, applies HST.
// materialLines are CLIENT-SAFE (no cost/markup fields).
export function computeReportTotals(labour: LabourInput[], receipts: ContractingReceipt[], rates: ContractingRateCard, rateByContractor?: Record<string, number>): ContractingReportSnapshot {
  // Aggregate labour per (contractorId + role) so multiple sessions combine.
  const byPerson = new Map<string, ContractingLabourLine>();
  for (const l of labour) {
    const key = `${l.contractorId}|${l.billingRole}`;
    const rate = rateByContractor?.[l.contractorId] ?? rateFor(l.billingRole, rates);
    const prev = byPerson.get(key);
    const hours = round2((prev?.hours || 0) + (Number(l.hours) || 0));
    byPerson.set(key, { contractorId: l.contractorId, name: l.name, billingRole: l.billingRole, hours, rate, amount: round2(hours * rate) });
  }
  const labourLines = [...byPerson.values()].sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));
  const labourSubtotal = round2(labourLines.reduce((s, l) => s + l.amount, 0));
  const materialLines = (receipts || []).map(r => ({ description: r.description, billed: round2(r.billed) }));
  const materialsSubtotal = round2(materialLines.reduce((s, m) => s + m.billed, 0));
  const subtotalPreHst = round2(labourSubtotal + materialsSubtotal);
  const hst = round2(subtotalPreHst * HST_PCT);
  const total = round2(subtotalPreHst + hst);
  return { labourLines, labourSubtotal, materialLines, materialsSubtotal, subtotalPreHst, hst, total };
}

// Derive the labour inputs attached to an OPEN report: manual lines on the
// report PLUS clock sessions (contractingTimeEntries) that started at/after
// the report's startAt on the same phase. Each clock session is rounded.
export function labourForReport(
  report: { id: string; phaseId: string; startAt: number; endAt?: number; manualTime?: ContractingTimeEntry[] },
  timeEntries: ContractingTimeEntry[],
  nowMs: number,
): LabourInput[] {
  const out: LabourInput[] = [];
  for (const mt of report.manualTime || []) {
    out.push({ contractorId: mt.contractorId, name: mt.contractorName, billingRole: mt.billingRole, hours: Number(mt.hours) || 0 });
  }
  const end = report.endAt || nowMs;
  for (const te of timeEntries) {
    if (te.manual) continue;                              // manual lines handled above / on report
    if (te.phaseId !== report.phaseId) continue;
    if (te.status === 'invoiced') continue;
    if (te.clockIn < report.startAt || te.clockIn >= end) continue; // attaches by start instant
    const outMs = te.clockOut || nowMs;
    const rawHours = Math.max(0, (outMs - te.clockIn) / 3_600_000);
    out.push({ contractorId: te.contractorId, name: te.contractorName, billingRole: te.billingRole, hours: roundVisitHours(rawHours) });
  }
  return out;
}

// ── Billables per project/phase, derived from entered invoices (pre-HST) ────
export interface PhaseBillables {
  invoicedPreHst: number; paidPreHst: number; outstandingPreHst: number;
  invoicedWithHst: number; paidWithHst: number; outstandingWithHst: number;
}
export function phaseBillables(projectId: string, phaseId: string | undefined, invoices: ContractingInvoice[]): PhaseBillables {
  let invoicedPreHst = 0, paidPreHst = 0, invoicedWithHst = 0, paidWithHst = 0;
  for (const inv of invoices) {
    if (inv.projectId !== projectId) continue;
    if (phaseId && inv.phaseId && inv.phaseId !== phaseId) continue;
    if (phaseId && !inv.phaseId) continue;
    invoicedPreHst += Number(inv.amountPreHst) || 0;
    invoicedWithHst += Number(inv.total) || 0;
    if (inv.paid) { paidPreHst += Number(inv.amountPreHst) || 0; paidWithHst += Number(inv.total) || 0; }
  }
  return {
    invoicedPreHst: round2(invoicedPreHst), paidPreHst: round2(paidPreHst),
    outstandingPreHst: round2(invoicedPreHst - paidPreHst),
    invoicedWithHst: round2(invoicedWithHst), paidWithHst: round2(paidWithHst),
    outstandingWithHst: round2(invoicedWithHst - paidWithHst),
  };
}

// A fixed phase is READY TO BILL when every REQUIRED checklist item is done.
export function phaseReadyToBill(phase: ContractingPhase): boolean {
  const required = phase.checklist.filter(c => c.required);
  return required.length > 0 && required.every(c => c.done);
}

// A phase has invoiced billing if any invoice references it OR any progress
// report on it has been invoiced. Guards fixed↔T&M switches and removal.
export function phaseHasInvoicedBilling(projectId: string, phaseId: string, invoices: ContractingInvoice[], reports: ContractingProgressReport[]): boolean {
  if (invoices.some(i => i.projectId === projectId && i.phaseId === phaseId)) return true;
  if (reports.some(r => r.projectId === projectId && r.phaseId === phaseId && r.status === 'invoiced')) return true;
  return false;
}
// A phase can be safely REMOVED only when nothing is attached: no invoices,
// no reports (open or closed), no time entries.
export function phaseIsRemovable(projectId: string, phaseId: string, invoices: ContractingInvoice[], reports: ContractingProgressReport[], timeEntries: ContractingTimeEntry[]): boolean {
  if (invoices.some(i => i.projectId === projectId && i.phaseId === phaseId)) return false;
  if (reports.some(r => r.projectId === projectId && r.phaseId === phaseId)) return false;
  if (timeEntries.some(t => t.projectId === projectId && t.phaseId === phaseId)) return false;
  return true;
}

// Next sequential invoice number "PROG-00N" continuing from entered history.
export function nextProgNumber(invoices: ContractingInvoice[]): string {
  let max = 0;
  for (const inv of invoices) {
    const m = /PROG-0*(\d+)/i.exec(inv.number || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `PROG-${String(max + 1).padStart(3, '0')}`;
}

export const withHst = (preHst: number) => ({ preHst: round2(preHst), hst: round2(preHst * HST_PCT), total: round2(preHst * (1 + HST_PCT)) });

// The DEFAULT rental properties list (internal organization only). Corp badge
// on SJ. Once edited in-app they persist to settings.contractingProperties.
export const CONTRACTING_PROPERTIES: { name: string; corp?: boolean }[] = [
  { name: '718 James' }, { name: '376 Hill S' }, { name: '375 Hill S' },
  { name: '1391 Balmoral' }, { name: '333 Ambrose' }, { name: '287 Windemere' },
  { name: '252 Saint James', corp: true },
];
// The default list as full ContractingProperty records (stable ids), used to
// seed settings.contractingProperties on first edit.
export function defaultProperties(): ContractingProperty[] {
  return CONTRACTING_PROPERTIES.map((p, i) => ({ id: `cprop-default-${i}`, name: p.name, corp: p.corp, active: true }));
}
// Resolve the live property list: settings override, else the default seed.
export function propertiesOrDefault(list?: ContractingProperty[] | null): ContractingProperty[] {
  return (list && list.length) ? list : defaultProperties();
}

// Palermo's brand tokens — visibly NOT Marco's green.
export const PALERMO = {
  slate: '#2E4053',
  gold: '#B7950B',
};

// Days elapsed in an open report (for the "Day N of 14" cadence nudge).
export function reportDayN(startAt: number, nowMs: number): number {
  return Math.max(1, Math.floor((nowMs - startAt) / 86_400_000) + 1);
}

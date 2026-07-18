// ContractingMaster (Palermo's) — pure billing math + constants. NO I/O, and
// ZERO contact with performance/BH/bonus/pay. Its own tenant.
import {
  ContractingRateCard, ContractingBillingRole, ContractingReceipt, ContractingLabourLine,
  ContractingReportSnapshot, ContractingProject, ContractingPhase, ContractingInvoice, ContractingTimeEntry,
  ContractingProperty, ContractingProgressReport, ContractingSupplier, Employee,
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

export interface LabourInput { contractorId: string; name: string; billingRole: ContractingBillingRole; hours: number; rate?: number; }

// The live billing preview / snapshot for a progress report. Aggregates labour
// per person, sums materials at their billed (marked-up) value, applies HST.
// materialLines are CLIENT-SAFE (no cost/markup fields).
export function computeReportTotals(labour: LabourInput[], receipts: ContractingReceipt[], rates: ContractingRateCard, rateByContractor?: Record<string, number>): ContractingReportSnapshot {
  // Aggregate labour per (contractorId + role + rate) so multiple sessions at
  // the same rate combine; a per-line rate override splits into its own line.
  const byPerson = new Map<string, ContractingLabourLine>();
  for (const l of labour) {
    const rate = (l.rate != null && l.rate > 0) ? l.rate : (rateByContractor?.[l.contractorId] ?? rateFor(l.billingRole, rates));
    const key = `${l.contractorId}|${l.billingRole}|${rate}`;
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
// report PLUS clock sessions on the same phase, captured either by explicit
// attach (te.reportId === report.id) or by falling within the period window.
// An entry attached to ANOTHER report is never counted (one-report-ever).
export function labourForReport(
  report: { id: string; phaseId: string; startAt: number; endAt?: number; manualTime?: ContractingTimeEntry[] },
  timeEntries: ContractingTimeEntry[],
  nowMs: number,
): LabourInput[] {
  const out: LabourInput[] = [];
  for (const mt of report.manualTime || []) {
    out.push({ contractorId: mt.contractorId, name: mt.contractorName, billingRole: mt.billingRole, hours: Number(mt.hours) || 0, rate: mt.rateOverride });
  }
  const end = report.endAt || nowMs;
  for (const te of timeEntries) {
    if (te.manual) continue;                              // manual lines handled above / on report
    if (te.phaseId !== report.phaseId) continue;
    if (te.status === 'invoiced') continue;
    const attached = te.reportId === report.id;
    if (te.reportId && !attached) continue;               // belongs to another report
    if (!attached) {
      if (te.detached) continue;                          // manually removed from its window report
      if (te.clockIn < report.startAt || te.clockIn >= end) continue; // window
    }
    const outMs = te.clockOut || nowMs;
    const rawHours = Math.max(0, (outMs - te.clockIn) / 3_600_000);
    out.push({ contractorId: te.contractorId, name: te.contractorName, billingRole: te.billingRole, hours: roundVisitHours(rawHours) });
  }
  return out;
}

// UNBILLED labour for a project: completed clock sessions that are NOT
// invoiced, NOT attached to any report, and NOT auto-captured by their phase's
// currently-open report (clocked in a gap, or on a phase with no open report).
// These are the entries a manager can pull into the open report.
export interface UnbilledEntry { entry: ContractingTimeEntry; hours: number; amount: number; }
export function unbilledLabour(projectId: string, timeEntries: ContractingTimeEntry[], reports: ContractingProgressReport[], rates: ContractingRateCard, nowMs: number, rateByContractor?: Record<string, number>): UnbilledEntry[] {
  const out: UnbilledEntry[] = [];
  for (const te of timeEntries) {
    if (te.projectId !== projectId) continue;
    if (te.manual) continue;
    if (te.status === 'invoiced') continue;
    if (te.reportId) continue;                            // already attached to a report
    if (!te.clockOut) continue;                           // still clocked in
    const open = reports.find(r => r.projectId === te.projectId && r.phaseId === te.phaseId && r.status === 'open');
    const autoCaptured = !!open && te.clockIn >= open.startAt && te.clockIn < nowMs;
    if (autoCaptured && !te.detached) continue;           // flowing into the open report (unless detached)
    const hours = roundVisitHours(Math.max(0, (te.clockOut - te.clockIn) / 3_600_000));
    const rate = rateByContractor?.[te.contractorId] ?? rateFor(te.billingRole, rates);
    out.push({ entry: te, hours, amount: round2(hours * rate) });
  }
  return out.sort((a, b) => a.entry.clockIn - b.entry.clockIn);
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

// Project-level billables rollup across ALL phases. Invoiced/collected/
// outstanding come straight from the project's invoices; remaining-expected is
// the sum of unbilled FIXED completion balances (open T&M accrues separately).
export interface ProjectBillables {
  invoicedPreHst: number; invoicedWithHst: number;
  collectedPreHst: number; collectedWithHst: number;
  outstandingPreHst: number; outstandingWithHst: number;
  remainingFixedPreHst: number; remainingFixedWithHst: number;
  hasOpenTm: boolean;
}
export function projectBillables(project: ContractingProject, invoices: ContractingInvoice[], reports: ContractingProgressReport[]): ProjectBillables {
  let invPre = 0, invFull = 0, colPre = 0, colFull = 0;
  for (const inv of invoices) {
    if (inv.projectId !== project.id) continue;
    invPre += Number(inv.amountPreHst) || 0; invFull += Number(inv.total) || 0;
    if (inv.paid) { colPre += Number(inv.amountPreHst) || 0; colFull += Number(inv.total) || 0; }
  }
  let remFixed = 0;
  for (const ph of project.phases) {
    if (ph.type !== 'fixed' || ph.fixedPrice == null) continue;
    const billedPre = phaseBillables(project.id, ph.id, invoices).invoicedPreHst;
    remFixed += Math.max(0, round2(ph.fixedPrice - billedPre));
  }
  const hasOpenTm = reports.some(r => r.projectId === project.id && r.status === 'open' && project.phases.find(ph => ph.id === r.phaseId)?.type === 'tm');
  return {
    invoicedPreHst: round2(invPre), invoicedWithHst: round2(invFull),
    collectedPreHst: round2(colPre), collectedWithHst: round2(colFull),
    outstandingPreHst: round2(invPre - colPre), outstandingWithHst: round2(invFull - colFull),
    remainingFixedPreHst: round2(remFixed), remainingFixedWithHst: round2(remFixed * (1 + HST_PCT)),
    hasOpenTm,
  };
}

// Plan for merging phase `sourceId` INTO `targetId` (target survives, keeps its
// id → its invoices/reports/time never move). Returns the ids to re-point and
// the merged project (caller stamps updatedAt + persists + audits). Pure — no
// I/O, no Date.now. Generalizable: same billing type only, and at most ONE open
// report across the two (preserving one-open-report-per-phase).
export interface PhaseMergePlan { error?: string; mergedProject?: ContractingProject; invoiceIds: string[]; reportIds: string[]; timeEntryIds: string[]; deleteReportIds: string[]; keptReport?: ContractingProgressReport; sourceName?: string; targetName?: string; }
export function planPhaseMerge(project: ContractingProject, sourceId: string, targetId: string, mergedName: string | undefined, invoices: ContractingInvoice[], reports: ContractingProgressReport[], timeEntries: ContractingTimeEntry[]): PhaseMergePlan {
  const empty = { invoiceIds: [], reportIds: [], timeEntryIds: [], deleteReportIds: [] };
  if (sourceId === targetId) return { ...empty, error: 'Pick two different phases.' };
  const source = project.phases.find(p => p.id === sourceId);
  const target = project.phases.find(p => p.id === targetId);
  if (!source || !target) return { ...empty, error: 'Phase not found.' };
  if (source.type !== target.type) return { ...empty, error: 'Phases must share a billing type (both Fixed or both T&M).' };
  // The merged phase can hold at most ONE open report. Keep ONE survivor —
  // prefer the TARGET's open report (correct number/period), else the first
  // source one (re-pointed) — and FOLD the other open reports' receipts +
  // manual-time lines into it so no billing is orphaned; delete the folded-in
  // reports.
  const openReports = reports.filter(r => r.projectId === project.id && r.status === 'open' && (r.phaseId === sourceId || r.phaseId === targetId));
  let deleteReportIds: string[] = [];
  let keptReport: ContractingProgressReport | undefined;
  if (openReports.length > 0) {
    const survivor = openReports.find(r => r.phaseId === targetId) || openReports[0];
    const folded = openReports.filter(r => r.id !== survivor.id);
    if (folded.length) {
      keptReport = {
        ...survivor, phaseId: targetId,
        receipts: [...(survivor.receipts || []), ...folded.flatMap(r => r.receipts || [])],
        manualTime: [...(survivor.manualTime || []), ...folded.flatMap(r => r.manualTime || [])],
      };
      deleteReportIds = folded.map(r => r.id);
    } else if (survivor.phaseId === sourceId) {
      keptReport = { ...survivor, phaseId: targetId };   // single source open report → re-point in full
    }
  }
  const delSet = new Set(deleteReportIds);
  const join = (a?: string, b?: string) => [a, b].map(x => (x || '').trim()).filter(Boolean).join(' · ') || undefined;
  const starts = [target.tmStartAt, source.tmStartAt].filter((x): x is number => typeof x === 'number');
  const merged: ContractingPhase = {
    ...target,
    name: (mergedName && mergedName.trim()) || target.name,
    checklist: [...target.checklist, ...source.checklist],
    description: join(target.description, source.description),
    note: join(target.note, source.note),
    fixedPrice: target.type === 'fixed' ? round2((target.fixedPrice || 0) + (source.fixedPrice || 0)) : undefined,
    tmStartAt: target.type === 'tm' ? (starts.length ? Math.min(...starts) : undefined) : undefined,
    priceAudit: [...(target.priceAudit || []), ...(source.priceAudit || [])],
  };
  const mergedProject: ContractingProject = { ...project, phases: project.phases.filter(p => p.id !== sourceId).map(p => (p.id === targetId ? merged : p)) };
  return {
    mergedProject,
    invoiceIds: invoices.filter(i => i.projectId === project.id && i.phaseId === sourceId).map(i => i.id),
    // Re-point source reports EXCEPT the folded-away ones and the survivor
    // (the survivor is written in full via keptReport when it came from source).
    reportIds: reports.filter(r => r.projectId === project.id && r.phaseId === sourceId && !delSet.has(r.id) && r.id !== keptReport?.id).map(r => r.id),
    timeEntryIds: timeEntries.filter(t => t.projectId === project.id && t.phaseId === sourceId).map(t => t.id),
    deleteReportIds,
    keptReport,
    sourceName: source.name, targetName: target.name,
  };
}

// Blended project completion — a SIMPLE AVERAGE of the phases' manual
// completionPct (phases with no % count as 0). Informational only.
export function projectCompletionPct(project: ContractingProject): number {
  if (!project.phases.length) return 0;
  const sum = project.phases.reduce((s, ph) => s + (Number(ph.completionPct) || 0), 0);
  return Math.round(sum / project.phases.length);
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

// A project can be DELETED only when nothing is attached: no invoices, no
// reports, no time entries. (Work orders have no project link in the model —
// promote-to-project copies, never references — so there's nothing to check.)
// Anything attached → archive instead.
export function projectIsRemovable(projectId: string, invoices: ContractingInvoice[], reports: ContractingProgressReport[], timeEntries: ContractingTimeEntry[]): boolean {
  if (invoices.some(i => i.projectId === projectId)) return false;
  if (reports.some(r => r.projectId === projectId)) return false;
  if (timeEntries.some(t => t.projectId === projectId)) return false;
  return true;
}

// Invoice lifecycle stage. MINTED (awaitingSend, not yet sent) → SENT → PAID.
// Legacy/seeded invoices (no awaitingSend flag) default to SENT — they were
// issued.
export type ContractingInvoiceStage = 'minted' | 'sent' | 'paid';
export function invoiceStage(inv: ContractingInvoice): ContractingInvoiceStage {
  if (inv.paid) return 'paid';
  if (inv.sentAt) return 'sent';
  if (inv.awaitingSend) return 'minted';
  return 'sent';   // legacy / historical / seeded → treated as sent
}
export const NET_TERMS_MS = 14 * 86_400_000;
// Effective Net-14 due date: reckons from the SENT date when present; before
// sending, the stored due (period-end + 14 at mint, or the seeded value) stands.
export function invoiceDueAt(inv: ContractingInvoice): number | undefined {
  if (inv.sentAt) return inv.sentAt + NET_TERMS_MS;
  if (inv.dueAt) return inv.dueAt;
  if (inv.periodEnd) return inv.periodEnd + NET_TERMS_MS;
  return inv.issuedAt ? inv.issuedAt + NET_TERMS_MS : undefined;
}
export function invoiceIsLate(inv: ContractingInvoice, nowMs: number): boolean {
  if (inv.paid) return false;
  const due = invoiceDueAt(inv);
  return !!due && due < nowMs;
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

// Shopping suppliers — editable; default seed covers the common stores.
export const DEFAULT_SUPPLIERS = ['Home Depot', 'Rona', 'Everlast'];
export function defaultSuppliers(): ContractingSupplier[] {
  return DEFAULT_SUPPLIERS.map((n, i) => ({ id: `csup-default-${i}`, name: n, active: true }));
}
export function suppliersOrDefault(list?: ContractingSupplier[] | null): ContractingSupplier[] {
  return (list && list.length) ? list : defaultSuppliers();
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

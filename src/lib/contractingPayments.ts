// PAYMENTS AND ALLOCATIONS — the money that actually arrived, and which
// invoices it settled.
//
// Before this, "paid" was a boolean on the invoice plus a paidAt/paidBy, where
// paidBy was whoever clicked the button rather than who paid. There was no
// amount, no method, no cheque number, and no way at all to represent the
// ordinary case: one $150,000 cheque settling parts of three phases.
//
// FOUR DECISIONS, signed off, that everything here follows:
//
//  1. ALLOCATIONS ARE WITH-HST. That is the money that actually moved. If
//     allocations were pre-HST a cheque would not equal the sum of its parts,
//     and reconciling against a bank line would need mental arithmetic every
//     time. Pre-HST is derived pro-rata where a phase rollup needs it.
//  2. UNDER-ALLOCATION WARNS and shows as "unapplied" — visible on the payment
//     and on the statement, never silently absorbed. OVER-ALLOCATION IS
//     REFUSED: that is arithmetic, not judgement.
//  3. INVOICE STATE IS DERIVED from allocations, with a ±$0.01 tolerance so a
//     cent of HST rounding never leaves an invoice showing as "partial".
//     Partially paid is a real state, not a gap between paid and unpaid.
//  4. VOIDING AN INVOICE RELEASES its allocations to unapplied rather than
//     deleting them. Money that arrived does not vanish because a document was
//     voided — it becomes money looking for a home, which is the truth.
import type {
  ContractingCredit, ContractingInvoice, ContractingPayment,
  ContractingPaymentAllocation, ContractingPhase, ContractingProject,
} from '../types';

export const HST_PCT = 0.13;
/** Below this, a difference is HST rounding, not a balance. */
export const MONEY_EPSILON = 0.01;

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
const money = (n: number): string =>
  `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ── PAYMENT ARITHMETIC ─────────────────────────────────────────────────────

export const liveAllocations = (
  p: Pick<ContractingPayment, 'allocations'> | undefined | null,
): ContractingPaymentAllocation[] => (p?.allocations || []).filter(Boolean);

export function allocatedTotal(
  p: Pick<ContractingPayment, 'allocations'> | undefined | null,
): number {
  return round2(liveAllocations(p).reduce((s, a) => s + num(a.amount), 0));
}

/**
 * Money on the payment not yet pointed at anything. Positive = unapplied
 * (warn), negative = over-allocated (refuse).
 */
export function unappliedAmount(
  p: Pick<ContractingPayment, 'amount' | 'allocations'> | undefined | null,
): number {
  return round2(num(p?.amount) - allocatedTotal(p));
}

export interface PaymentValidation {
  ok: boolean;
  /** Blocking. The payment must not be saved while any of these stand. */
  errors: string[];
  /** Non-blocking. Saved, shown, and carried onto the statement. */
  warnings: string[];
  unapplied: number;
}

/**
 * `invoices` is used only to reject allocations pointing at an invoice that is
 * not on this project — a typo that would otherwise credit another job.
 */
export function validatePayment(
  payment: Pick<ContractingPayment, 'amount' | 'allocations' | 'projectId'>,
  invoices: ContractingInvoice[] = [],
): PaymentValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const amount = num(payment.amount);
  const allocs = liveAllocations(payment);
  const unapplied = unappliedAmount(payment);

  if (amount <= 0) errors.push('A payment must be more than $0.');
  for (const a of allocs) {
    if (num(a.amount) <= 0) {
      errors.push('Every allocation must be more than $0. Remove the empty line instead.');
      break;
    }
  }
  for (const a of allocs) {
    if (!a.invoiceId && !a.phaseId && !a.creditId) {
      errors.push('Every allocation must name an invoice, a phase, or a credit.');
      break;
    }
  }
  const byId = new Map(invoices.map(i => [i.id, i]));
  for (const a of allocs) {
    if (!a.invoiceId) continue;
    const inv = byId.get(a.invoiceId);
    if (!inv) { errors.push('An allocation points at an invoice that no longer exists.'); break; }
    if (inv.projectId !== payment.projectId) {
      errors.push('An allocation points at an invoice on a different project.');
      break;
    }
  }
  // DECISION 2. Over-allocation is arithmetic and is refused.
  if (unapplied < -MONEY_EPSILON) {
    errors.push(
      `Allocations total $${allocatedTotal(payment).toLocaleString('en-US', { minimumFractionDigits: 2 })}, `
      + `which is more than the $${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} received.`,
    );
  } else if (unapplied > MONEY_EPSILON) {
    warnings.push(
      `$${unapplied.toLocaleString('en-US', { minimumFractionDigits: 2 })} of this payment is not applied to anything yet. `
      + 'It stays on the account as unapplied and shows on the statement.',
    );
  }
  return { ok: errors.length === 0, errors, warnings, unapplied };
}

// ── WHAT AN INVOICE HAS RECEIVED ───────────────────────────────────────────

export type InvoicePaymentState = 'unpaid' | 'partial' | 'paid' | 'overpaid';

export interface InvoiceSettlement {
  invoiceId: string;
  total: number;        // with HST
  allocated: number;    // with HST
  balance: number;      // total − allocated
  state: InvoicePaymentState;
  /** Payment ids that touched it, for the drill-down. */
  paymentIds: string[];
}

const paymentCounts = (p: ContractingPayment): boolean => !p.voided;

/**
 * DECISION 4: allocations on a VOIDED invoice are ignored here — they are
 * released to unapplied (see unappliedForProject) rather than deleted.
 */
export function invoiceSettlement(
  invoice: ContractingInvoice,
  payments: ContractingPayment[],
  credits: ContractingCredit[] = [],
): InvoiceSettlement {
  const total = round2(num(invoice.total));
  let allocated = 0;
  const paymentIds: string[] = [];
  for (const p of payments) {
    if (!paymentCounts(p)) continue;
    let touched = false;
    for (const a of liveAllocations(p)) {
      if (a.invoiceId !== invoice.id) continue;
      allocated += num(a.amount);
      touched = true;
    }
    if (touched) paymentIds.push(p.id);
  }
  // Credit APPLIED to this invoice settles it just as a payment does — the
  // cash already arrived; applying it only decides which invoice it answers.
  allocated = round2(allocated + creditAppliedToInvoice(invoice.id, credits));
  const balance = round2(total - allocated);
  let state: InvoicePaymentState;
  if (invoice.voided) state = 'unpaid';                    // contributes nothing
  else if (allocated <= MONEY_EPSILON) state = 'unpaid';
  else if (balance > MONEY_EPSILON) state = 'partial';
  else if (balance < -MONEY_EPSILON) state = 'overpaid';
  else state = 'paid';
  return { invoiceId: invoice.id, total, allocated, balance, state, paymentIds };
}

export const invoiceIsSettled = (
  invoice: ContractingInvoice, payments: ContractingPayment[],
): boolean => invoiceSettlement(invoice, payments).state === 'paid';

// ── PHASE SUMMARY ──────────────────────────────────────────────────────────
// One line per phase: what was contracted, what has been invoiced, what has
// been paid against it, what is left. A fixed phase has a contract total; a
// T&M phase does not, and says so rather than showing a misleading zero.

export interface PhaseSettlement {
  phaseId: string;
  phaseName: string;
  type: ContractingPhase['type'];
  /** Fixed price, or null for T&M — null means "no ceiling", not zero. */
  contractTotal: number | null;
  invoicedPreHst: number;
  invoicedWithHst: number;
  paidWithHst: number;
  balanceWithHst: number;
  /** Fixed phases only: contract not yet invoiced. */
  uninvoicedWithHst: number | null;
  invoiceCount: number;
  complete: boolean;
}

const phaseInvoices = (
  projectId: string, phaseId: string, invoices: ContractingInvoice[],
): ContractingInvoice[] => invoices.filter(
  i => !i.voided && i.projectId === projectId && i.phaseId === phaseId,
);

export function phaseSettlement(
  project: ContractingProject,
  phase: ContractingPhase,
  invoices: ContractingInvoice[],
  payments: ContractingPayment[],
  credits: ContractingCredit[] = [],
): PhaseSettlement {
  const mine = phaseInvoices(project.id, phase.id, invoices);
  let invPre = 0; let invFull = 0; let paid = 0;
  for (const inv of mine) {
    invPre += num(inv.amountPreHst);
    invFull += num(inv.total);
    paid += invoiceSettlement(inv, payments, credits).allocated;
  }
  // Payments allocated to the PHASE rather than to one of its invoices.
  for (const p of payments) {
    if (p.voided || p.projectId !== project.id) continue;
    for (const a of liveAllocations(p)) {
      if (a.creditId) continue;                  // credit, not settlement
      if (a.invoiceId || a.phaseId !== phase.id) continue;
      paid += num(a.amount);
    }
  }
  invPre = round2(invPre); invFull = round2(invFull); paid = round2(paid);
  const contractTotal = phase.type === 'fixed' && phase.fixedPrice != null
    ? round2(num(phase.fixedPrice)) : null;
  return {
    phaseId: phase.id,
    phaseName: phase.name,
    type: phase.type,
    contractTotal,
    invoicedPreHst: invPre,
    invoicedWithHst: invFull,
    paidWithHst: paid,
    balanceWithHst: round2(invFull - paid),
    uninvoicedWithHst: contractTotal == null
      ? null : round2(Math.max(0, contractTotal - invPre) * (1 + HST_PCT)),
    invoiceCount: mine.length,
    complete: phase.status === 'complete' || phase.status === 'closed',
  };
}

// ── CREDIT ─────────────────────────────────────────────────────────────────

export function creditApplied(c: Pick<ContractingCredit, 'applications'> | undefined | null): number {
  return round2((c?.applications || []).reduce((s, a) => s + num(a.amount), 0));
}

/** What is left on a credit. A voided credit has nothing left, by definition. */
export function creditRemaining(c: ContractingCredit | undefined | null): number {
  if (!c || c.voided) return 0;
  return round2(num(c.amount) - creditApplied(c));
}

export function creditOnAccount(projectId: string, credits: ContractingCredit[]): number {
  return round2(credits
    .filter(c => c.projectId === projectId)
    .reduce((s, c) => s + creditRemaining(c), 0));
}

/**
 * Applying a credit reduces an invoice's balance and draws the credit down.
 * Refused rather than clamped when it would over-apply — the caller has to
 * choose a real number.
 */
export function planCreditApplication(
  credit: ContractingCredit,
  invoice: ContractingInvoice,
  amount: number,
  payments: ContractingPayment[],
  by: { email: string; name: string },
  nowMs: number,
): { ok: boolean; error?: string; credit?: ContractingCredit } {
  const amt = round2(num(amount));
  if (amt <= 0) return { ok: false, error: 'Enter an amount greater than $0.' };
  const left = creditRemaining(credit);
  if (amt - left > MONEY_EPSILON) {
    return { ok: false, error: `Only $${left.toFixed(2)} is left on this credit.` };
  }
  const owing = invoiceSettlement(invoice, payments).balance
    - creditAppliedToInvoice(invoice.id, [credit]);
  if (amt - owing > MONEY_EPSILON) {
    return { ok: false, error: `${invoice.number} only has $${round2(owing).toFixed(2)} outstanding.` };
  }
  return {
    ok: true,
    credit: {
      ...credit,
      applications: [...(credit.applications || []), {
        id: `ccap-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
        invoiceId: invoice.id, amount: amt, at: nowMs, by: by.email, byName: by.name,
      }],
      updatedBy: by,
      updatedAt: nowMs,
      audit: [...(credit.audit || []), {
        at: nowMs, by: by.email, byName: by.name, action: 'allocated',
        detail: `$${amt.toFixed(2)} of credit applied to ${invoice.number}`,
      }],
    },
  };
}

export function creditAppliedToInvoice(invoiceId: string, credits: ContractingCredit[]): number {
  let n = 0;
  for (const c of credits) {
    if (c.voided) continue;
    for (const a of c.applications || []) if (a.invoiceId === invoiceId) n += num(a.amount);
  }
  return round2(n);
}

export interface ProjectSettlement {
  phases: PhaseSettlement[];
  contractTotalFixed: number;
  invoicedWithHst: number;
  paidWithHst: number;
  balanceWithHst: number;
  /** Money received that is not pointed at any live invoice, phase or credit. */
  unappliedWithHst: number;
  /** Unapplied customer credit — NOT revenue, NOT settlement. */
  creditOnAccount: number;
}

export function projectSettlement(
  project: ContractingProject,
  invoices: ContractingInvoice[],
  payments: ContractingPayment[],
  credits: ContractingCredit[] = [],
): ProjectSettlement {
  const phases = (project.phases || []).map(
    ph => phaseSettlement(project, ph, invoices, payments, credits),
  );
  const mine = payments.filter(p => !p.voided && p.projectId === project.id);
  const received = round2(mine.reduce((s, p) => s + num(p.amount), 0));
  const applied = round2(phases.reduce((s, p) => s + p.paidWithHst, 0));
  // Money deliberately parked on a credit is APPLIED — it has a home. Only
  // money pointing at nothing at all is unapplied.
  const toCredit = round2(mine.reduce((s, p) => s + liveAllocations(p)
    .filter(a => !!a.creditId).reduce((t, a) => t + num(a.amount), 0), 0));
  return {
    phases,
    contractTotalFixed: round2(phases.reduce((s, p) => s + (p.contractTotal || 0), 0)),
    invoicedWithHst: round2(phases.reduce((s, p) => s + p.invoicedWithHst, 0)),
    paidWithHst: applied,
    balanceWithHst: round2(phases.reduce((s, p) => s + p.balanceWithHst, 0)),
    // Everything received minus everything that landed on a live invoice or
    // phase. Picks up both an under-allocated payment AND (decision 4) money
    // released by voiding the invoice it was pointed at.
    unappliedWithHst: round2(received - applied - toCredit),
    creditOnAccount: creditOnAccount(project.id, credits),
  };
}

// ── STATEMENT ──────────────────────────────────────────────────────────────
// Every invoice and every payment in date order with a running balance. The
// client-facing document renders from exactly this — one ordering, one set of
// numbers, no second implementation to drift.

export interface StatementRow {
  kind: 'invoice' | 'payment';
  at: number;
  ref: string;                 // invoice number, or method + reference
  description: string;
  phaseName?: string;
  charge: number;              // invoices
  credit: number;              // payments
  balance: number;             // running, after this row
  reconstructed?: boolean;     // migrated from the old paid flag
  id: string;
}

export function statementRows(
  project: ContractingProject,
  invoices: ContractingInvoice[],
  payments: ContractingPayment[],
): StatementRow[] {
  const phaseName = new Map((project.phases || []).map(p => [p.id, p.name]));
  const rows: Omit<StatementRow, 'balance'>[] = [];
  for (const inv of invoices) {
    if (inv.voided || inv.projectId !== project.id) continue;
    rows.push({
      kind: 'invoice',
      at: num(inv.issuedAt || inv.createdAt),
      ref: inv.number,
      description: inv.scopeDescription || `${inv.kind} invoice`,
      phaseName: inv.phaseId ? phaseName.get(inv.phaseId) : undefined,
      charge: round2(num(inv.total)),
      credit: 0,
      id: inv.id,
    });
  }
  for (const p of payments) {
    if (p.voided || p.projectId !== project.id) continue;
    const ref = [p.method, p.reference].filter(Boolean).join(' ');
    // ONLY THE SETTLEMENT PORTION BELONGS IN THE LEDGER. Money on a transfer
    // that landed on a CREDIT settles no invoice, so crediting the full
    // transfer here would drive the running balance below zero and contradict
    // the Balance Due it is supposed to explain — Feaver Rd's Aug 21 transfer
    // ended the statement at -$9,000.00 against a balance due of $0.00. The
    // credit is reported beneath the balance instead, which is where money
    // that has not been billed for belongs.
    const toCredit = round2(liveAllocations(p)
      .filter(a => !!a.creditId)
      .reduce((t, a) => t + num(a.amount), 0));
    const settling = round2(num(p.amount) - toCredit);
    if (settling <= MONEY_EPSILON && toCredit > MONEY_EPSILON) continue;
    rows.push({
      kind: 'payment',
      at: num(p.receivedAt),
      ref: ref || 'payment',
      description: (p.note || 'Payment received, thank you')
        + (toCredit > MONEY_EPSILON
          ? ` · ${money(round2(num(p.amount)))} received, ${money(toCredit)} held on account`
          : ''),
      charge: 0,
      credit: settling,
      reconstructed: !!p.reconstructed,
      id: p.id,
    });
  }
  // Date order; on the same day an invoice is raised before it is paid.
  rows.sort((a, b) => (a.at - b.at) || (a.kind === b.kind ? 0 : a.kind === 'invoice' ? -1 : 1));
  let bal = 0;
  return rows.map(r => {
    bal = round2(bal + r.charge - r.credit);
    return { ...r, balance: bal };
  });
}

// ── MIGRATION ──────────────────────────────────────────────────────────────
// The old model recorded settlement as `paid: true` plus a paidAt, with no
// amount, method or reference. Each of those becomes ONE payment for the
// invoice's full total, allocated entirely to it — totals are preserved to the
// cent and nothing is invented.
//
// They are stamped `reconstructed`, because seven paid invoices were almost
// certainly not seven separate cheques. The flag says "this is what we could
// infer, not what we were told", and marks exactly what still needs merging
// into the real cheque records.

export interface ReconstructPlan {
  payments: ContractingPayment[];
  /** Cent-for-cent proof, for the migration report. */
  beforePaidWithHst: number;
  afterPaidWithHst: number;
  invoiceCount: number;
}

export function reconstructPaymentsFromPaidFlags(
  projectId: string,
  invoices: ContractingInvoice[],
  by: { email: string; name: string },
  nowMs: number,
): ReconstructPlan {
  const payments: ContractingPayment[] = [];
  let before = 0;
  for (const inv of invoices) {
    if (inv.projectId !== projectId) continue;
    if (inv.voided) continue;              // voided contributed nothing before
    if (!inv.paid) continue;
    const amount = round2(num(inv.total));
    before += amount;
    payments.push({
      id: `cpay-recon-${inv.id}`,
      projectId,
      receivedAt: num(inv.paidAt) || num(inv.issuedAt) || nowMs,
      amount,
      method: 'other',
      reference: '',
      note: `Reconstructed from the paid flag on ${inv.number}. `
        + 'Merge into the real cheque or transfer record when known.',
      allocations: [{
        id: `cpal-recon-${inv.id}`,
        invoiceId: inv.id,
        phaseId: inv.phaseId,
        amount,
      }],
      reconstructed: true,
      createdBy: by,
      createdAt: nowMs,
      audit: [{
        at: nowMs, by: by.email, byName: by.name,
        action: 'created',
        detail: `Reconstructed from ${inv.number} (paid flag, marked by ${inv.paidBy || 'unknown'})`,
      }],
    });
  }
  const after = round2(payments.reduce((s, p) => s + p.amount, 0));
  return {
    payments,
    beforePaidWithHst: round2(before),
    afterPaidWithHst: after,
    invoiceCount: payments.length,
  };
}

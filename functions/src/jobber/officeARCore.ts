/* eslint-disable max-len, require-jsdoc, valid-jsdoc, no-multi-spaces */
// OfficeMaster A/R — pure summary of what Jobber returned. No I/O; tested.
//
// Built around Jobber quirks found 2026-10-20 (memory: jobber-sales-api-quirks):
// - invoice status filters OVERLAP (awaiting_payment also returns every
//   past_due invoice; sent_not_due returns invoices whose status reads
//   awaiting_payment). Everything is de-duplicated by invoice id, and
//   classified here by due date and balance — never by which filter
//   returned it.
// - money is summed in whole cents so totals don't drift.

export interface RawPayment { entryDate: string; amount: number; adjustmentType: string }
export interface RawInvoice {
  id: string;
  invoiceNumber: string;
  invoiceStatus: string;
  issuedDate?: string | null;
  receivedDate?: string | null;   // when it was marked paid
  dueDate?: string | null;
  jobberWebUri?: string;
  amounts: { total: number; invoiceBalance: number };
  client?: { id: string; name: string } | null;
  paymentRecords?: { nodes: RawPayment[] } | null;
}
export interface RawClient { id: string; name: string; balance: number; jobberWebUri?: string }

export type AgeKey = "notDue" | "d1_30" | "d31_60" | "d61_90" | "d90plus";
export const AGE_KEYS: AgeKey[] = ["notDue", "d1_30", "d31_60", "d61_90", "d90plus"];

export interface ChaseRow {
  age?: AgeKey;
  invoiceId: string; invoiceNumber: string; client: string; clientId: string;
  balance: number; total: number; dueDate: string | null; daysOverdue: number;
  lastPayment: { date: string; amount: number } | null; url: string;
}
export interface MismatchRow { kind: "paid_with_balance" | "zero_balance_open"; invoiceNumber: string; client: string; status: string; balance: number; total: number; issued: string | null; paid: string | null; url: string }
export interface ClientRow { client: string; clientId: string; balance: number; url: string }

export interface ARSummary {
  owed: number;                       // dollars, 2dp
  invoiceCount: number;
  aging: Record<AgeKey, { count: number; amount: number }>;
  chase: ChaseRow[];                  // every past-due invoice, oldest first
  invoices: ChaseRow[];               // EVERY open invoice with a balance (the filterable list), with its age bucket

  mismatches: MismatchRow[];          // paid-with-balance newest first, then $0-but-open
  // Marked paid in Jobber with the payment not (fully) recorded there — the
  // invoice keeps a balance but Jobber no longer counts it in the client's
  // balance, so it is NOT money owed. Found by the nightly full read.
  paidUnrecorded: { count: number; amount: number; last12Months: { count: number; amount: number } };
  noInvoiceClients: ClientRow[];      // owing, but no open invoice
  credits: { clients: number; amount: number };
  badDebt: { count: number; amount: number };
  reconciliation: {
    openInvoices: number;             // = owed
    owedWithoutInvoice: number;
    clientBalancesOwed: number;       // sum of positive client balances
    difference: number;               // clientBalancesOwed − (openInvoices + owedWithoutInvoice)
    clientsWithOpenInvoices: number;
    clientsNotMatching: number;       // their balance ≠ their open invoices
  };
  duplicatesRemoved: number;          // rows the overlapping filters returned twice
}

const c = (n: number) => Math.round((Number(n) || 0) * 100);
const d = (cents: number) => Math.round(cents) / 100;
const OPEN = new Set(["awaiting_payment", "past_due", "sent_not_due"]);

/** YYYY-MM-DD of an instant in Toronto. */
export function torontoYmd(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit"}).format(new Date(ms));
}
const ymdDays = (ymd: string) => {
  const [y, m, dd] = ymd.split("-").map(Number); return Date.UTC(y, m - 1, dd) / 86_400_000;
};
/** Whole days past due in Toronto (0 = due today or later). */
export function daysPastDue(dueIso: string | null | undefined, nowMs: number): number {
  if (!dueIso) return 0;
  const due = torontoYmd(Date.parse(dueIso));
  return Math.max(0, ymdDays(torontoYmd(nowMs)) - ymdDays(due));
}
export function ageKey(days: number): AgeKey {
  return days <= 0 ? "notDue" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90plus";
}

export function summarizeAR(input: {
  open: RawInvoice[];            // rows from the open + bad-debt status queries (overlaps allowed)
  paidWithBalance: RawInvoice[]; // rows whose status is paid and balance may be > 0
  clients: RawClient[];          // every client with a non-zero balance
  nowMs: number;
}): ARSummary {
  const byId = new Map<string, RawInvoice>();
  for (const r of input.open) byId.set(r.id, r);
  const unique = [...byId.values()];
  const owedRows = unique.filter((r) => OPEN.has(r.invoiceStatus) && c(r.amounts.invoiceBalance) > 0);

  const aging = Object.fromEntries(AGE_KEYS.map((k) => [k, {count: 0, amount: 0}])) as ARSummary["aging"];
  const agingCents: Record<AgeKey, number> = {notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0};
  const chase: ChaseRow[] = [];
  const invoices: ChaseRow[] = [];
  const invoiceCentsByClient = new Map<string, number>();
  let owedCents = 0;
  for (const r of owedRows) {
    const bal = c(r.amounts.invoiceBalance);
    owedCents += bal;
    const days = daysPastDue(r.dueDate, input.nowMs);
    const k = ageKey(days);
    aging[k].count++; agingCents[k] += bal;
    const cid = r.client?.id || "?";
    invoiceCentsByClient.set(cid, (invoiceCentsByClient.get(cid) || 0) + bal);
    const pays = (r.paymentRecords?.nodes || []).filter((p) => p.adjustmentType === "PAYMENT" || p.adjustmentType === "DEPOSIT");
    const last = pays.sort((a, b) => b.entryDate.localeCompare(a.entryDate))[0];
    const rowOut: ChaseRow = {
      age: k, invoiceId: r.id, invoiceNumber: r.invoiceNumber, client: r.client?.name || "—", clientId: cid,
      balance: d(bal), total: d(c(r.amounts.total)), dueDate: r.dueDate ? torontoYmd(Date.parse(r.dueDate)) : null,
      daysOverdue: days, lastPayment: last ? {date: torontoYmd(Date.parse(last.entryDate)), amount: d(c(last.amount))} : null,
      url: r.jobberWebUri || "",
    };
    invoices.push(rowOut);
    if (days > 0) chase.push(rowOut);
  }
  for (const k of AGE_KEYS) aging[k].amount = d(agingCents[k]);
  chase.sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance);
  invoices.sort((a, b) => b.daysOverdue - a.daysOverdue || (a.dueDate || "").localeCompare(b.dueDate || "") || b.balance - a.balance);

  const mismatches: MismatchRow[] = [];
  const seenPaid = new Set<string>();
  const yearAgo = torontoYmd(input.nowMs - 365 * 86_400_000);
  const ymdOf = (iso?: string | null) => (iso ? torontoYmd(Date.parse(iso)) : null);
  let puCents = 0; let puRecentCents = 0; let puRecent = 0;
  const row = (kind: MismatchRow["kind"], r: RawInvoice): MismatchRow => ({
    kind, invoiceNumber: r.invoiceNumber, client: r.client?.name || "—", status: r.invoiceStatus,
    balance: d(c(r.amounts.invoiceBalance)), total: d(c(r.amounts.total)), issued: ymdOf(r.issuedDate), paid: ymdOf(r.receivedDate), url: r.jobberWebUri || "",
  });
  for (const r of input.paidWithBalance) {
    if (r.invoiceStatus !== "paid" || c(r.amounts.invoiceBalance) <= 0 || seenPaid.has(r.id)) continue;
    seenPaid.add(r.id);
    const m = row("paid_with_balance", r);
    puCents += c(r.amounts.invoiceBalance);
    if ((m.paid || m.issued || "") >= yearAgo) {
      puRecent++; puRecentCents += c(r.amounts.invoiceBalance);
    }
    mismatches.push(m);
  }
  mismatches.sort((a, b) => (b.paid || b.issued || "").localeCompare(a.paid || a.issued || ""));
  for (const r of unique) {
    if (OPEN.has(r.invoiceStatus) && c(r.amounts.invoiceBalance) <= 0) mismatches.push(row("zero_balance_open", r));
  }

  let clientOwedCents = 0; let noInvCents = 0; let creditCents = 0; let creditClients = 0; let notMatching = 0;
  const noInvoiceClients: ClientRow[] = [];
  const clientById = new Map(input.clients.map((x) => [x.id, x]));
  for (const cl of input.clients) {
    const bal = c(cl.balance);
    if (bal < 0) {
      creditCents += bal; creditClients++; continue;
    }
    if (bal === 0) continue;
    clientOwedCents += bal;
    if (!invoiceCentsByClient.has(cl.id)) {
      noInvCents += bal;
      noInvoiceClients.push({client: cl.name || "—", clientId: cl.id, balance: d(bal), url: cl.jobberWebUri || ""});
    }
  }
  for (const [cid, inv] of invoiceCentsByClient) {
    const cl = clientById.get(cid);
    if (!cl || Math.abs(c(cl.balance) - inv) >= 1) notMatching++;
  }
  noInvoiceClients.sort((a, b) => b.balance - a.balance);
  const bad = unique.filter((r) => r.invoiceStatus === "bad_debt");

  return {
    owed: d(owedCents),
    invoiceCount: owedRows.length,
    aging, chase, invoices, mismatches, noInvoiceClients,
    paidUnrecorded: {count: seenPaid.size, amount: d(puCents), last12Months: {count: puRecent, amount: d(puRecentCents)}},
    credits: {clients: creditClients, amount: d(creditCents)},
    badDebt: {count: bad.length, amount: d(bad.reduce((s, r) => s + c(r.amounts.invoiceBalance), 0))},
    reconciliation: {
      openInvoices: d(owedCents), owedWithoutInvoice: d(noInvCents), clientBalancesOwed: d(clientOwedCents),
      difference: d(clientOwedCents - owedCents - noInvCents),
      clientsWithOpenInvoices: invoiceCentsByClient.size, clientsNotMatching: notMatching,
    },
    duplicatesRemoved: input.open.length - unique.length,
  };
}

/* eslint-disable max-len, no-multi-spaces */
// OfficeMaster A/R summary — made-up invoices shaped like Jobber's answers,
// including the overlapping status filters found on 2026-10-20.
//   npx vitest run functions/src/jobber/officeARCore
import {test} from "vitest";
import assert from "node:assert/strict";
import {summarizeAR, daysPastDue, torontoYmd, RawInvoice, RawClient} from "./officeARCore";

const NOW = Date.parse("2026-10-20T16:00:00Z"); // Oct 20, noon Toronto
const inv = (id: string, status: string, balance: number, due: string | null, client = "c1", pays: {date: string; amt: number; type?: string}[] = []): RawInvoice => ({
  id, invoiceNumber: id.toUpperCase(), invoiceStatus: status, dueDate: due, issuedDate: "2026-09-01T12:00:00Z",
  jobberWebUri: `https://secure.getjobber.com/invoices/${id}`, amounts: {total: balance + 100, invoiceBalance: balance},
  client: {id: client, name: `Client ${client}`},
  paymentRecords: {nodes: pays.map((p) => ({entryDate: p.date, amount: p.amt, adjustmentType: p.type || "PAYMENT"}))},
});
// Jobber's answers per status filter: awaiting_payment ALSO returns the past_due
// ones, and sent_not_due returns invoices whose status reads awaiting_payment.
const notDue = inv("i1", "awaiting_payment", 500, "2026-10-25T04:00:00Z", "c1");
const due10 = inv("i2", "past_due", 1000.10, "2026-10-10T04:00:00Z", "c2", [{date: "2026-09-15T15:00:00Z", amt: 200}, {date: "2026-10-01T15:00:00Z", amt: 300}]);
const due45 = inv("i3", "past_due", 2000, "2026-09-05T04:00:00Z", "c2");
const due95 = inv("i4", "past_due", 75.5, "2026-07-17T04:00:00Z", "c3");
const zeroOpen = inv("i5", "awaiting_payment", 0, "2026-10-30T04:00:00Z", "c4");
const bad = inv("i6", "bad_debt", 0, "2026-01-01T05:00:00Z", "c5");
const OPEN_ROWS = [
  notDue, due10, due45, due95, zeroOpen, // awaiting_payment filter
  due10, due45, due95,                   // past_due filter (same invoices again)
  notDue, zeroOpen,                      // sent_not_due filter
  bad,
];
const PAID = [inv("p1", "paid", 12.34, null, "c6"), inv("p2", "paid", 0, null, "c6")];
const CLIENTS: RawClient[] = [
  {id: "c1", name: "Client c1", balance: 500},
  {id: "c2", name: "Client c2", balance: 3000.10},
  {id: "c3", name: "Client c3", balance: 75.5},
  {id: "c7", name: "Client c7", balance: 640},     // owes, no open invoice
  {id: "c8", name: "Client c8", balance: -40},     // credit
];
const S = summarizeAR({open: OPEN_ROWS, paidWithBalance: PAID, clients: CLIENTS, nowMs: NOW});

test("overlapping status filters are de-duplicated by invoice id", () => {
  assert.equal(S.duplicatesRemoved, 5);
  assert.equal(S.invoiceCount, 4);              // i1..i4 (i5 has no balance, i6 is bad debt)
  assert.equal(S.owed, 3575.60);
});
test("ageing by Toronto due date: not due · 1–30 · 31–60 · 61–90 · 90+", () => {
  assert.deepEqual(S.aging, {
    notDue: {count: 1, amount: 500}, d1_30: {count: 1, amount: 1000.10}, d31_60: {count: 1, amount: 2000},
    d61_90: {count: 0, amount: 0}, d90plus: {count: 1, amount: 75.5},
  });
  // A due date of midnight Toronto (04:00Z) is that day in Toronto, not the day before.
  assert.equal(torontoYmd(Date.parse("2026-10-10T04:00:00Z")), "2026-10-10");
  assert.equal(daysPastDue("2026-10-20T04:00:00Z", NOW), 0);
  assert.equal(daysPastDue("2026-10-19T04:00:00Z", NOW), 1);
});
test("chase list: every past-due invoice, oldest first, with the last payment", () => {
  assert.deepEqual(S.chase.map((r) => [r.invoiceNumber, r.daysOverdue]), [["I4", 95], ["I3", 45], ["I2", 10]]);
  assert.deepEqual(S.chase[2].lastPayment, {date: "2026-10-01", amount: 300});
  assert.equal(S.chase[0].lastPayment, null);
  assert.equal(S.chase[0].url, "https://secure.getjobber.com/invoices/i4");
});
test("mismatches: paid with a balance (not owed, counted apart); $0 balance still awaiting payment", () => {
  assert.deepEqual(S.mismatches.map((m) => [m.kind, m.invoiceNumber, m.balance]).sort(), [["paid_with_balance", "P1", 12.34], ["zero_balance_open", "I5", 0]]);
  assert.deepEqual(S.paidUnrecorded, {count: 1, amount: 12.34, last12Months: {count: 1, amount: 12.34}});
  assert.equal(S.owed, 3575.60); // never added to what is owed
  const old = summarizeAR({open: [], clients: [], nowMs: NOW, paidWithBalance: [{...inv("p9", "paid", 500, null), issuedDate: "2023-01-02T12:00:00Z", receivedDate: "2023-02-14T12:00:00Z"}, {...inv("p8", "paid", 40, null), receivedDate: "2026-09-01T12:00:00Z"}]});
  assert.deepEqual(old.paidUnrecorded.last12Months, {count: 1, amount: 40});
  assert.deepEqual(old.mismatches.map((m) => [m.invoiceNumber, m.paid]), [["P8", "2026-09-01"], ["P9", "2023-02-14"]]); // newest first
});
test("clients owing with no open invoice, credits, bad debt", () => {
  assert.deepEqual(S.noInvoiceClients.map((c) => [c.client, c.balance]), [["Client c7", 640]]);
  assert.deepEqual(S.credits, {clients: 1, amount: -40});
  assert.deepEqual(S.badDebt, {count: 1, amount: 0});
});
test("reconciliation: invoices + owed-without-invoice = client balances", () => {
  assert.deepEqual(S.reconciliation, {
    openInvoices: 3575.60, owedWithoutInvoice: 640, clientBalancesOwed: 4215.60, difference: 0,
    clientsWithOpenInvoices: 3, clientsNotMatching: 0,
  });
  const off = summarizeAR({open: OPEN_ROWS, paidWithBalance: [], clients: CLIENTS.map((c) => c.id === "c2" ? {...c, balance: 2900.10} : c), nowMs: NOW});
  assert.equal(off.reconciliation.clientsNotMatching, 1);
  assert.equal(off.reconciliation.difference, -100);
});
test("cents, not floats: 0.1 + 0.2 sums exactly", () => {
  const a = summarizeAR({open: [inv("x", "past_due", 0.1, "2026-10-01T04:00:00Z"), inv("y", "past_due", 0.2, "2026-10-01T04:00:00Z")], paidWithBalance: [], clients: [], nowMs: NOW});
  assert.equal(a.owed, 0.3);
});

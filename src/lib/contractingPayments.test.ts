// Payments, allocations, and the four decisions they encode.
//   npm test -- contractingPayments
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  allocatedTotal, unappliedAmount, validatePayment, invoiceSettlement,
  phaseSettlement, projectSettlement, statementRows,
  reconstructPaymentsFromPaidFlags, MONEY_EPSILON,
  creditRemaining, planCreditApplication,
} from './contractingPayments';

const inv = (o: any) => ({
  id: 'i1', number: 'INV-1', projectId: 'p1', kind: 'tm',
  amountPreHst: 1000, hst: 130, total: 1130, issuedAt: 1_000, ...o,
} as any);
const pay = (o: any) => ({
  id: 'pay1', projectId: 'p1', receivedAt: 2_000, amount: 1130,
  method: 'cheque', allocations: [], ...o,
} as any);
const alloc = (o: any) => ({ id: 'a1', amount: 1130, ...o });

const PROJECT = {
  id: 'p1', name: 'Feaver Rd', status: 'in_progress',
  phases: [
    { id: 'ph1', name: 'Phase 1', type: 'fixed', fixedPrice: 90805, status: 'closed', checklist: [] },
    { id: 'ph3', name: 'Phase 3/4', type: 'tm', status: 'in_progress', checklist: [] },
  ],
} as any;

console.log('\nDecision 1 — allocations are WITH HST, so a cheque equals its parts');
test('allocations sum to the payment, in the same units as the payment', () => {
  const p = pay({ amount: 150000, allocations: [
    alloc({ id: 'a', phaseId: 'ph1', amount: 50000 }),
    alloc({ id: 'b', phaseId: 'ph2', amount: 75000 }),
    alloc({ id: 'c', phaseId: 'ph3', amount: 25000 }),
  ] });
  assert.equal(allocatedTotal(p), 150000);
  assert.equal(unappliedAmount(p), 0);
  assert.equal(validatePayment(p).ok, true);
});

console.log('\nDecision 2 — under-allocation WARNS, over-allocation is REFUSED');
test('an unallocated remainder warns and is reported, never absorbed', () => {
  const p = pay({ amount: 150000, allocations: [alloc({ phaseId: 'ph1', amount: 100000 })] });
  const v = validatePayment(p);
  assert.equal(v.ok, true, 'it still saves — the money did arrive');
  assert.equal(v.unapplied, 50000);
  assert.equal(v.errors.length, 0);
  assert.match(v.warnings[0], /50,000\.00 of this payment is not applied/);
});
test('over-allocation is an ERROR — you cannot spend a cheque twice', () => {
  const p = pay({ amount: 1000, allocations: [
    alloc({ id: 'a', phaseId: 'ph1', amount: 600 }),
    alloc({ id: 'b', phaseId: 'ph3', amount: 600 }),
  ] });
  const v = validatePayment(p);
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /more than the \$1,000\.00 received/);
});
test('an allocation on another project is refused, not silently credited', () => {
  const p = pay({ allocations: [alloc({ invoiceId: 'i9' })] });
  const v = validatePayment(p, [inv({ id: 'i9', projectId: 'OTHER' })]);
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /different project/);
});
test('an allocation naming nothing, or worth nothing, is refused', () => {
  assert.equal(validatePayment(pay({ allocations: [alloc({})] })).ok, false);
  assert.equal(validatePayment(pay({ allocations: [alloc({ phaseId: 'ph1', amount: 0 })] })).ok, false);
});

console.log('\nDecision 3 — derived invoice state, ±$0.01');
test('unpaid, partial, paid and overpaid are all real states', () => {
  const i = inv({ total: 1130 });
  const at = (amt: number) => [pay({ allocations: [alloc({ invoiceId: 'i1', amount: amt })] })];
  assert.equal(invoiceSettlement(i, []).state, 'unpaid');
  assert.equal(invoiceSettlement(i, at(500)).state, 'partial');
  assert.equal(invoiceSettlement(i, at(1130)).state, 'paid');
  assert.equal(invoiceSettlement(i, at(1200)).state, 'overpaid');
});
test('a cent of HST rounding does not leave an invoice reading "partial"', () => {
  const i = inv({ total: 46109.65 });
  const s = invoiceSettlement(i, [pay({ allocations: [alloc({ invoiceId: 'i1', amount: 46109.64 })] })]);
  assert.equal(s.state, 'paid', `1c short must still read paid (eps ${MONEY_EPSILON})`);
});
test('partial reports the real balance, and which payments touched it', () => {
  const s = invoiceSettlement(inv({ total: 1130 }), [
    pay({ id: 'x', allocations: [alloc({ invoiceId: 'i1', amount: 400 })] }),
    pay({ id: 'y', allocations: [alloc({ invoiceId: 'i1', amount: 300 })] }),
  ]);
  assert.equal(s.allocated, 700);
  assert.equal(s.balance, 430);
  assert.deepEqual(s.paymentIds, ['x', 'y']);
});
test('a VOIDED payment contributes nothing', () => {
  const s = invoiceSettlement(inv({}), [pay({ voided: true, allocations: [alloc({ invoiceId: 'i1' })] })]);
  assert.equal(s.allocated, 0);
  assert.equal(s.state, 'unpaid');
});

console.log('\nDecision 4 — voiding an invoice RELEASES money, never deletes it');
test('THE RULE: money allocated to a voided invoice becomes unapplied', () => {
  const invoices = [inv({ id: 'i1', total: 1130, voided: true, voidReason: 'duplicate' })];
  const payments = [pay({ amount: 1130, allocations: [alloc({ invoiceId: 'i1', amount: 1130 })] })];
  const st = projectSettlement(PROJECT, invoices, payments);
  assert.equal(st.invoicedWithHst, 0, 'the voided invoice charges nothing');
  assert.equal(st.paidWithHst, 0, 'and nothing is credited against it');
  assert.equal(st.unappliedWithHst, 1130, 'but the money is still on the account');
});

console.log('\nPhase summary — one line per phase');
test('a fixed phase shows contract, invoiced, paid, balance and what is unbilled', () => {
  const invoices = [
    inv({ id: 'r', phaseId: 'ph1', amountPreHst: 50000, total: 56500 }),
    inv({ id: 'c', phaseId: 'ph1', amountPreHst: 40805, total: 46109.65 }),
  ];
  const payments = [pay({ amount: 56500, allocations: [alloc({ invoiceId: 'r', amount: 56500 })] })];
  const s = phaseSettlement(PROJECT, PROJECT.phases[0], invoices, payments);
  assert.equal(s.contractTotal, 90805);
  assert.equal(s.invoicedPreHst, 90805);
  assert.equal(s.invoicedWithHst, 102609.65);
  assert.equal(s.paidWithHst, 56500);
  assert.equal(s.balanceWithHst, 46109.65);
  assert.equal(s.uninvoicedWithHst, 0, 'fully invoiced against its contract');
  assert.equal(s.complete, true);
});
test('a T&M phase has NO contract total — null, never a misleading zero', () => {
  const s = phaseSettlement(PROJECT, PROJECT.phases[1], [], []);
  assert.equal(s.contractTotal, null);
  assert.equal(s.uninvoicedWithHst, null);
});
test('a payment allocated to the PHASE counts, not only invoice allocations', () => {
  const s = phaseSettlement(PROJECT, PROJECT.phases[0], [], [
    pay({ amount: 5000, allocations: [alloc({ phaseId: 'ph1', amount: 5000 })] }),
  ]);
  assert.equal(s.paidWithHst, 5000);
});

console.log('\nStatement — one ordering, one set of numbers');
test('rows are date-ordered with a running balance, invoice before payment', () => {
  const invoices = [inv({ id: 'i1', number: 'INV-1', phaseId: 'ph1', issuedAt: 100, total: 1000 })];
  const payments = [pay({ id: 'p', receivedAt: 100, amount: 400, method: 'cheque', reference: '123' })];
  const rows = statementRows(PROJECT, invoices, payments);
  assert.deepEqual(rows.map(r => r.kind), ['invoice', 'payment']);
  assert.deepEqual(rows.map(r => r.balance), [1000, 600]);
  assert.equal(rows[1].ref, 'cheque 123');
});
test('voided invoices and voided payments never appear', () => {
  const rows = statementRows(PROJECT,
    [inv({ voided: true })],
    [pay({ voided: true })]);
  assert.equal(rows.length, 0);
});
test('a reconstructed payment is flagged on the statement row', () => {
  const rows = statementRows(PROJECT, [], [pay({ reconstructed: true })]);
  assert.equal(rows[0].reconstructed, true);
});

console.log('\nMigration — totals preserved to the cent, nothing invented');
test('every paid invoice becomes one fully-allocated, reconstructed payment', () => {
  const invoices = [
    inv({ id: 'a', number: 'INV-1001', phaseId: 'ph1', total: 56500, paid: true, paidAt: 500, paidBy: 'Tony Palermo' }),
    inv({ id: 'b', number: 'INV-1003', phaseId: 'ph3', total: 21922, paid: true, paidAt: 600 }),
    inv({ id: 'c', number: 'PROG-003', phaseId: 'ph3', total: 12364.69 }),          // outstanding
    inv({ id: 'd', number: 'PROG-003', phaseId: 'ph3', total: 50252, voided: true, paid: true }), // void
  ];
  const plan = reconstructPaymentsFromPaidFlags('p1', invoices, { email: 'm@x.test', name: 'Marco' }, 9_000);
  assert.equal(plan.invoiceCount, 2, 'the outstanding and the voided are not payments');
  assert.equal(plan.beforePaidWithHst, 78422);
  assert.equal(plan.afterPaidWithHst, 78422, 'cent for cent');
  const p = plan.payments[0];
  assert.equal(p.amount, 56500);
  assert.equal(p.receivedAt, 500, 'dated when it was marked paid, not today');
  assert.equal(p.reconstructed, true);
  assert.equal(p.allocations[0].invoiceId, 'a');
  assert.equal(p.allocations[0].phaseId, 'ph1');
  assert.equal(unappliedAmount(p), 0, 'fully allocated by construction');
  assert.match(p.note!, /Merge into the real cheque/);
  assert.match(p.audit![0].detail, /Tony Palermo/, 'who marked it paid is preserved');
});
test('after migrating, every migrated invoice derives as paid', () => {
  const invoices = [inv({ id: 'a', total: 56500, paid: true, paidAt: 1 })];
  const plan = reconstructPaymentsFromPaidFlags('p1', invoices, { email: 'm@x.test', name: 'M' }, 9_000);
  assert.equal(invoiceSettlement(invoices[0], plan.payments).state, 'paid');
});

console.log('\nCustomer credit — not revenue, not a payment against any invoice');
const CRED = (o: any) => ({
  id: 'c1', projectId: 'p1', receivedAt: 3_000, amount: 9000,
  source: 'overpayment', applications: [], ...o,
} as any);

test('a credit allocation lets the payment balance without settling anything', () => {
  // Feaver Rd's Aug 21 transfer: $177,536.34 against $168,536.34 of invoices.
  const p = pay({ amount: 177536.34, allocations: [
    alloc({ id: 'a', invoiceId: 'i1', amount: 168536.34 }),
    alloc({ id: 'b', creditId: 'c1', amount: 9000 }),
  ] });
  const v = validatePayment(p, [inv({ id: 'i1', total: 168536.34 })]);
  assert.equal(v.ok, true);
  assert.equal(v.unapplied, 0, 'money parked on a credit is applied — it has a home');
  assert.equal(v.warnings.length, 0);
});
test('credit money is NOT counted as paying its phase', () => {
  const s = phaseSettlement(PROJECT, PROJECT.phases[0], [], [
    pay({ amount: 9000, allocations: [alloc({ creditId: 'c1', phaseId: 'ph1', amount: 9000 })] }),
  ]);
  assert.equal(s.paidWithHst, 0);
});
test('credit shows on the project as credit, never as unapplied', () => {
  const payments = [pay({ amount: 9000, allocations: [alloc({ creditId: 'c1', amount: 9000 })] })];
  const st = projectSettlement(PROJECT, [], payments, [CRED({})]);
  assert.equal(st.creditOnAccount, 9000);
  assert.equal(st.unappliedWithHst, 0, 'it is not homeless money — it is on a credit');
  assert.equal(st.paidWithHst, 0, 'and it is not revenue');
});
test('THE LEDGER RULE: the credit portion stays out of the activity list', () => {
  // Crediting the whole transfer drove the running balance to -$9,000.00
  // against a Balance Due of $0.00 — the statement contradicting itself.
  const invoices = [inv({ id: 'i1', number: 'INV-1', issuedAt: 10, total: 168536.34 })];
  const payments = [pay({ receivedAt: 20, amount: 177536.34, allocations: [
    alloc({ id: 'a', invoiceId: 'i1', amount: 168536.34 }),
    alloc({ id: 'b', creditId: 'c1', amount: 9000 }),
  ] })];
  const rows = statementRows(PROJECT, invoices, payments);
  assert.equal(rows[1].credit, 168536.34, 'only the settling portion');
  assert.equal(rows[rows.length - 1].balance, 0, 'the ledger closes at zero');
  assert.match(rows[1].description, /\$177,536\.34 received, \$9,000\.00 held on account/);
});
test('a payment that is ENTIRELY credit does not appear in the ledger at all', () => {
  const rows = statementRows(PROJECT, [], [pay({ amount: 9000, allocations: [alloc({ creditId: 'c1', amount: 9000 })] })]);
  assert.equal(rows.length, 0);
});

console.log('\nApplying a credit draws it down and settles an invoice');
test('applying reduces the invoice balance and the credit together', () => {
  const future = inv({ id: 'fut', number: 'PROG-004', total: 5000 });
  const plan = planCreditApplication(CRED({}), future, 5000, [], { email: 'm@x.test', name: 'M' }, 7_000);
  assert.equal(plan.ok, true);
  assert.equal(creditRemaining(plan.credit!), 4000);
  assert.equal(invoiceSettlement(future, [], [plan.credit!]).state, 'paid');
});
test('over-applying is REFUSED, never clamped', () => {
  const small = inv({ id: 's', number: 'X', total: 500 });
  assert.match(planCreditApplication(CRED({}), small, 800, [], { email: 'm@x.test', name: 'M' }, 1).error!,
    /only has \$500\.00 outstanding/);
  assert.match(planCreditApplication(CRED({ amount: 100 }), inv({ total: 9999 }), 500, [], { email: 'm@x.test', name: 'M' }, 1).error!,
    /Only \$100\.00 is left/);
  assert.equal(planCreditApplication(CRED({}), small, 0, [], { email: 'm@x.test', name: 'M' }, 1).ok, false);
});
test('a voided credit has nothing left on it', () => {
  assert.equal(creditRemaining(CRED({ voided: true })), 0);
});

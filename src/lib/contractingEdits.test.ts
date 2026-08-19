// Tests for the two ContractingMaster overrides.
//   npm test -- contractingEdits
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  dateOutsidePeriod, describeDateChange, describeNumberChange,
  duplicateInvoiceNumber, invoiceNumberIsUsable, normalizeInvoiceNumber,
  reportMintNumber,
} from './contractingEdits';
import type { ContractingInvoice } from '../types';

const inv = (o: Partial<ContractingInvoice> & { id: string; number: string }): ContractingInvoice => ({
  projectId: 'p1', kind: 'tm', amountPreHst: 0, hst: 0, total: 0, ...o,
} as ContractingInvoice);

const INVOICES = [
  inv({ id: 'i1', number: 'PROG-001' }),
  inv({ id: 'i2', number: 'PROG-002' }),
  inv({ id: 'i3', number: 'PROG-003', voided: true, voidReason: 'wrong client' }),
];

console.log('\nInvoice numbers are compared in one shape');
test('normalisation trims and upper-cases', () => {
  assert.equal(normalizeInvoiceNumber('  prog-004 '), 'PROG-004');
  for (const v of [undefined, null, 42 as any, {} as any]) {
    assert.equal(normalizeInvoiceNumber(v), '');
  }
});
test('a blank number is not usable', () => {
  for (const v of ['', '   ', null, undefined]) assert.equal(invoiceNumberIsUsable(v), false);
  assert.equal(invoiceNumberIsUsable('PROG-009'), true);
});

console.log('\nDuplicate detection');
test('an existing live number is found', () => {
  assert.equal(duplicateInvoiceNumber('PROG-002', INVOICES)?.id, 'i2');
});
test('matching ignores case and surrounding space', () => {
  assert.equal(duplicateInvoiceNumber('  prog-002 ', INVOICES)?.id, 'i2');
});
test('a free number returns null', () => {
  assert.equal(duplicateInvoiceNumber('PROG-099', INVOICES), null);
});
test('a VOIDED invoice still holds its number', () => {
  // Voids are kept as accounted stubs precisely so numbering stays sequential.
  // Reusing one would put two records in the books under one reference.
  assert.equal(duplicateInvoiceNumber('PROG-003', INVOICES)?.id, 'i3');
});
test('an invoice does not clash with itself when re-saved', () => {
  assert.equal(duplicateInvoiceNumber('PROG-002', INVOICES, 'i2'), null);
  assert.equal(duplicateInvoiceNumber('PROG-001', INVOICES, 'i2')?.id, 'i1');
});
test('a blank candidate never reports a duplicate', () => {
  assert.equal(duplicateInvoiceNumber('', INVOICES), null);
  assert.equal(duplicateInvoiceNumber('   ', INVOICES), null);
});
test('an empty invoice list is handled', () => {
  assert.equal(duplicateInvoiceNumber('PROG-001', []), null);
  assert.equal(duplicateInvoiceNumber('PROG-001', undefined as any), null);
});

console.log('\nThe sequence stays the default');
test('with no override, a report mints with the sequential number', () => {
  assert.equal(reportMintNumber({}, 'PROG-004'), 'PROG-004');
  assert.equal(reportMintNumber({ numberOverride: '' }, 'PROG-004'), 'PROG-004');
  assert.equal(reportMintNumber({ numberOverride: '   ' }, 'PROG-004'), 'PROG-004');
});
test('an override wins, normalised', () => {
  assert.equal(reportMintNumber({ numberOverride: ' prog-777 ' }, 'PROG-004'), 'PROG-777');
});
test('an override need not look like PROG at all — real paper has odd numbers', () => {
  assert.equal(reportMintNumber({ numberOverride: '2026-A-14' }, 'PROG-004'), '2026-A-14');
});

console.log('\nOut-of-period dates warn');
const START = Date.parse('2026-08-10T13:00:00Z');   // period opened Aug 10
const END = Date.parse('2026-08-20T21:00:00Z');     // and closed Aug 20
const at = (d: string) => Date.parse(`${d}T15:00:00Z`);

test('a date inside the period is fine', () => {
  assert.equal(dateOutsidePeriod({ dateMs: at('2026-08-15'), startAt: START, endAt: END }).outside, false);
});
test('the first and last day of the period are INSIDE it', () => {
  // Compared by calendar day: a period that opened at 09:00 still owns that
  // whole day's work.
  assert.equal(dateOutsidePeriod({ dateMs: at('2026-08-10'), startAt: START, endAt: END }).outside, false);
  assert.equal(dateOutsidePeriod({ dateMs: at('2026-08-20'), startAt: START, endAt: END }).outside, false);
});
test('a date before the period opened warns, naming the boundary', () => {
  const c = dateOutsidePeriod({ dateMs: at('2026-08-09'), startAt: START, endAt: END });
  assert.equal(c.outside, true);
  assert.equal(c.side, 'before');
  assert.match(c.message!, /2026-08-10/);
});
test('a date after the period ended warns', () => {
  const c = dateOutsidePeriod({ dateMs: at('2026-08-21'), startAt: START, endAt: END });
  assert.equal(c.outside, true);
  assert.equal(c.side, 'after');
  assert.match(c.message!, /2026-08-20/);
});
test('an OPEN report has no end, so a later date is not outside', () => {
  const c = dateOutsidePeriod({ dateMs: at('2026-12-31'), startAt: START });
  assert.equal(c.outside, false);
});
test('an open report still warns about a date before it opened', () => {
  assert.equal(dateOutsidePeriod({ dateMs: at('2026-08-01'), startAt: START }).outside, true);
});
test('an unparseable date does not warn — validation handles it', () => {
  assert.equal(dateOutsidePeriod({ dateMs: NaN, startAt: START, endAt: END }).outside, false);
});

console.log('\nAudit text always carries old → new');
test('a number change reads from → to', () => {
  const d = describeNumberChange('PROG-002', ' prog-014 ', 'invoice PROG-002 (sent)');
  assert.match(d, /PROG-002 → PROG-014/);
  assert.match(d, /invoice PROG-002 \(sent\)/);
});
test('a first-time number records the absence honestly', () => {
  assert.match(describeNumberChange('', 'PROG-014', 'report #3'), /\(none\) → PROG-014/);
});
test('a date change names the person, both dates and the report', () => {
  const d = describeDateChange('Tony Palermo', at('2026-08-11'), at('2026-08-12'), 4);
  assert.match(d, /Tony Palermo/);
  assert.match(d, /2026-08-11 → 2026-08-12/);
  assert.match(d, /report #4/);
});

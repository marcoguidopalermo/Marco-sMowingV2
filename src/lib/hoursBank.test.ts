// Hours bank — the ledger's arithmetic and its append-only rules.
//   npx tsx src/lib/hoursBank.test.ts
import assert from 'node:assert/strict';
import type { HoursBankEntry } from '../types';
import {
  balanceOf, ledgerRows, ledgerRowsNewestFirst, entriesFor, summaries, outstanding,
  companyTotal, bankedEntry, payoutEntry, reversalEntry, reversedIds, canReverse,
  validateHours, overdrawnBy, roundHours, signedHours, entryLine,
} from './hoursBank';

let pass = 0, fail = 0;
const test = (n: string, fn: () => void) => {
  try { fn(); pass++; console.log(`  ✓ ${n}`); }
  catch (e) { fail++; console.error(`  ✗ ${n}\n      ${(e as Error).message}`); }
};

const RECORDER = { email: 'marco@x.com', name: 'Marco' };
const stamp = (
  e: Omit<HoursBankEntry, 'recordedAt' | 'recordedBy'>, at: number,
): HoursBankEntry => ({ ...e, recordedAt: at, recordedBy: RECORDER });

const AUG = (d: number) => Date.parse(`2026-08-${String(d).padStart(2, '0')}T12:00:00Z`);
const PAT = { id: 'e1', name: 'Pat Lindgren' };
const SAM = { id: 'e2', name: 'Sam Okafor' };
const WEEK = { start: '2026-08-04', end: '2026-08-17' };

console.log('\nSign convention');
test('banked is stored POSITIVE and paid out NEGATIVE — one signed number', () => {
  assert.equal(bankedEntry({ employee: PAT, hours: 8, period: WEEK }).hours, 8);
  assert.equal(payoutEntry({ employee: PAT, hours: 20, paidOn: '2026-08-14' }).hours, -20);
});
test('a magnitude typed with the wrong sign is corrected, not stored as typed', () => {
  assert.equal(bankedEntry({ employee: PAT, hours: -8, period: WEEK }).hours, 8);
  assert.equal(payoutEntry({ employee: PAT, hours: -20, paidOn: '2026-08-14' }).hours, -20);
});
test('hours are recorded to a tenth', () => {
  assert.equal(roundHours(8.06), 8.1);
  assert.equal(bankedEntry({ employee: PAT, hours: 7.749, period: WEEK }).hours, 7.7);
});
test('a banked entry records the PERIOD; a payout records the DATE PAID', () => {
  const b = bankedEntry({ employee: PAT, hours: 8, period: WEEK });
  assert.equal(b.periodStart, '2026-08-04');
  assert.equal(b.periodEnd, '2026-08-17');
  assert.equal(b.paidOn, undefined);
  const p = payoutEntry({ employee: PAT, hours: 20, paidOn: '2026-08-14' });
  assert.equal(p.paidOn, '2026-08-14');
  assert.equal(p.periodStart, undefined);
});

console.log('\nBalance and running balance');
const ledger = [
  stamp(bankedEntry({ employee: PAT, hours: 8, period: WEEK }), AUG(12)),
  stamp(bankedEntry({ employee: PAT, hours: 6.5, period: { start: '2026-08-18', end: '2026-08-31' } }), AUG(19)),
  stamp(payoutEntry({ employee: PAT, hours: 10, paidOn: '2026-08-20' }), AUG(20)),
];
test('the balance is the sum of the signed entries', () => {
  assert.equal(balanceOf(ledger), 4.5);
});
test('every row carries the balance AS AT that row', () => {
  assert.deepEqual(ledgerRows(ledger).map(r => r.balance), [8, 14.5, 4.5]);
});
test('the ledger reads newest first, and its top row is the current balance', () => {
  const rows = ledgerRowsNewestFirst(ledger);
  assert.equal(rows[0].balance, 4.5);
  assert.equal(rows[0].entry.type, 'paid_out');
  assert.equal(rows[rows.length - 1].balance, 8);
});
test('an empty ledger is a zero balance, not an error', () => {
  assert.equal(balanceOf([]), 0);
  assert.deepEqual(ledgerRows([]), []);
});
test('running balances do not drift on repeated tenths', () => {
  const tenths = Array.from({ length: 10 }, (_, i) =>
    stamp(bankedEntry({ employee: PAT, hours: 0.1, period: WEEK }), AUG(1) + i));
  assert.equal(balanceOf(tenths), 1);
  assert.equal(ledgerRows(tenths)[9].balance, 1);
});
test('entries written in the same millisecond still order the same way everywhere', () => {
  const a = stamp({ ...bankedEntry({ employee: PAT, hours: 1, period: WEEK }), id: 'hb-a' }, AUG(5));
  const b = stamp({ ...bankedEntry({ employee: PAT, hours: 2, period: WEEK }), id: 'hb-b' }, AUG(5));
  assert.deepEqual(ledgerRows([b, a]).map(r => r.entry.id), ['hb-a', 'hb-b']);
});

console.log('\nOne ledger per employee');
const all: Record<string, HoursBankEntry> = {};
for (const e of ledger) all[e.id] = e;
const samBanked = stamp(bankedEntry({ employee: SAM, hours: 12, period: WEEK }), AUG(12));
all[samBanked.id] = samBanked;
test('an employee sees only their own entries', () => {
  assert.equal(entriesFor(all, 'e1').length, 3);
  assert.equal(entriesFor(all, 'e2').length, 1);
  assert.equal(balanceOf(entriesFor(all, 'e2')), 12);
});
test('the roll-up is biggest balance first, with a company total', () => {
  const rows = summaries(all, [{ id: 'e1', name: 'Pat Lindgren' } as any, { id: 'e2', name: 'Sam Okafor' } as any]);
  assert.deepEqual(rows.map(r => [r.employeeName, r.balance]), [['Sam Okafor', 12], ['Pat Lindgren', 4.5]]);
  assert.equal(companyTotal(rows), 16.5);
});
test('a settled ledger drops off the outstanding list but keeps its history', () => {
  const settled = { ...all };
  const zeroing = stamp(payoutEntry({ employee: SAM, hours: 12, paidOn: '2026-08-25' }), AUG(25));
  settled[zeroing.id] = zeroing;
  const rows = summaries(settled);
  assert.equal(rows.find(r => r.employeeId === 'e2')?.balance, 0);
  assert.equal(outstanding(rows).some(r => r.employeeId === 'e2'), false);
  assert.equal(entriesFor(settled, 'e2').length, 2);
});
test('the name follows the roster, but a removed employee keeps the recorded one', () => {
  const rows = summaries(all, [{ id: 'e1', name: 'Pat L. Lindgren' } as any]);
  assert.equal(rows.find(r => r.employeeId === 'e1')?.employeeName, 'Pat L. Lindgren');
  assert.equal(rows.find(r => r.employeeId === 'e2')?.employeeName, 'Sam Okafor');
});

console.log('\nAppend-only: corrections are reversals');
test('a reversal exactly negates its target, so the pair nets to nothing', () => {
  const target = ledger[0];                       // banked +8
  const rev = stamp(reversalEntry(target, 'wrong week'), AUG(13));
  assert.equal(rev.hours, -8);
  assert.equal(rev.reversesId, target.id);
  assert.equal(rev.reversalReason, 'wrong week');
  assert.equal(balanceOf([target, rev]), 0);
});
test('reversing a PAYOUT puts the hours back', () => {
  const payout = ledger[2];                       // paid out −10
  const rev = stamp(reversalEntry(payout, 'cheque cancelled'), AUG(21));
  assert.equal(rev.hours, 10);
  assert.equal(balanceOf([...ledger, rev]), 14.5);
});
test('BOTH halves stay in the history — nothing is removed', () => {
  const target = ledger[0];
  const rev = stamp(reversalEntry(target, 'wrong week'), AUG(13));
  const rows = ledgerRows([...ledger, rev]);
  assert.equal(rows.length, 4);
  assert.ok(rows.some(r => r.entry.id === target.id));
});
test('a reversal carries the reversed entry’s period forward, so it still reads as that week', () => {
  const rev = reversalEntry(ledger[0], 'wrong week');
  assert.equal(rev.periodStart, '2026-08-04');
});
test('an entry can only be reversed ONCE, and a reversal cannot be reversed', () => {
  const target = ledger[0];
  const rev = stamp(reversalEntry(target, 'wrong week'), AUG(13));
  const already = reversedIds([...ledger, rev]);
  assert.equal(canReverse(target, already), false);
  assert.equal(canReverse(rev, already), false);
  assert.equal(canReverse(ledger[1], already), true);
});

console.log('\nValidation');
test('hours must be a positive number', () => {
  assert.ok(validateHours(''));
  assert.ok(validateHours('abc'));
  assert.ok(validateHours(0));
  assert.ok(validateHours(-4));
  assert.equal(validateHours(8), null);
  assert.equal(validateHours('7.5'), null);
});
test('an implausible entry is refused before it reaches the ledger', () => {
  assert.ok(validateHours(5000));
});
test('a payout larger than the balance is FLAGGED, not blocked — the record is the record', () => {
  assert.equal(overdrawnBy(4.5, 10), 5.5);
  assert.equal(overdrawnBy(20, 10), 0);
  const over = payoutEntry({ employee: PAT, hours: 10, paidOn: '2026-08-21' });
  assert.equal(balanceOf([...ledger, stamp(over, AUG(21))]), -5.5);
});

console.log('\nHow a row reads');
test('signed hours show the direction', () => {
  assert.equal(signedHours(8), '+8.0 hrs');
  assert.equal(signedHours(-20), '−20.0 hrs');
  assert.equal(signedHours(1), '+1.0 hr');
});
test('a banked line reads as the brief asks', () => {
  assert.equal(entryLine(ledger[0]), 'Banked 8.0 hrs — week of Aug 4 — recorded Aug 12 by Marco');
});
test('a payout line names the date it went out', () => {
  assert.equal(entryLine(ledger[2]), 'Paid out 10.0 hrs — Aug 20 — recorded Aug 20 by Marco');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

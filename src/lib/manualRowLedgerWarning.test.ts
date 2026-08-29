// The duplicate-entry warning on hand-keyed crew-day rows.
//   npm test -- manualRowLedgerWarning
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { clientKey, ledgersMatchingManualRow, manualRowLedgerWarning } from './manualRowLedgerWarning';

const led = (o: any) => ({
  jobberVisitId: 'v1', jobberJobId: 'j1', jobberJobNumber: '4007',
  title: 'Kyla Francis - Weekly [1.5]', totalBH: 1.5, isLawnJob: true,
  manualOverride: false, completionHistory: [], status: 'in_progress',
  firstSeenAt: 1, ...o,
} as any);

console.log('\nThe case this exists for');
test('THE KYLA CASE: a hand-typed name matches its Jobber ledger', () => {
  const w = manualRowLedgerWarning('Kyla Francis', [led({})]);
  assert.ok(w);
  assert.match(w!, /already has a ledger: "Kyla Francis - Weekly \[1\.5\]"/);
  assert.match(w!, /credited twice/);
});
test('the client segment is what matches, not the whole title', () => {
  assert.equal(clientKey('Kyla Francis - Weekly [1.5]'), 'kyla francis');
  assert.equal(clientKey('Kyla Francis'), 'kyla francis');
});
test('case, spacing, BH tags and **NOTE** markers do not defeat it', () => {
  for (const d of ['kyla  francis', 'KYLA FRANCIS', 'Kyla Francis [1.5]', '**Kyla Francis**']) {
    assert.equal(ledgersMatchingManualRow(d, [led({})]).length, 1, d);
  }
});

console.log('\nWhat must NOT warn');
test('a different client does not warn', () => {
  assert.equal(manualRowLedgerWarning('Don Shanks', [led({})]), null);
});
test('a ledger somebody has already answered for does not warn', () => {
  for (const k of [{ resolvedKind: 'voided' }, { voidedRemainder: { bh: 1 } }, { dismissedCarryForward: true }]) {
    assert.equal(manualRowLedgerWarning('Kyla Francis', [led(k)]), null, JSON.stringify(k));
  }
});
test('a description too short to be a name never matches', () => {
  // "city hall - hourly" heads on "city hall"; "sod" alone must not match.
  for (const d of ['sod', 'hrs', '', '   ', '12']) {
    assert.equal(manualRowLedgerWarning(d, [led({ title: d })]), null, d);
  }
});
test('no ledgers, or junk ledgers, is not a warning', () => {
  assert.equal(manualRowLedgerWarning('Kyla Francis', []), null);
  assert.equal(manualRowLedgerWarning('Kyla Francis', null), null);
  assert.equal(manualRowLedgerWarning('Kyla Francis', [null as any, { title: 'x' } as any]), null);
});

console.log('\nIt reports, it does not decide');
test('several ledgers for one client are all reported', () => {
  const w = manualRowLedgerWarning('Joan Cole', [
    led({ jobberVisitId: 'a', title: 'Joan Cole - Biweekly' }),
    led({ jobberVisitId: 'b', title: 'Joan Cole - Biweekly' }),
  ]);
  assert.match(w!, /and 1 more/);
});
test('the match carries the ledger identity, never a credit instruction', () => {
  const m = ledgersMatchingManualRow('Kyla Francis', [led({})]);
  assert.deepEqual(Object.keys(m[0]).sort(), ['jobberVisitId', 'status', 'title', 'totalBH']);
});

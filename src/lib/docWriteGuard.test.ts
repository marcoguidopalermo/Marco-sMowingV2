// Tests for the whole-document write guard.
//   npm test -- docWriteGuard
//
// The case that matters most is the last one: the exact shape of the
// 2026-08-18 incident must be refused.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { checkDocWrite, SEED_EMPLOYEE_IDS } from './docWriteGuard';

const SUPER = 'marcoguidopalermo@gmail.com';
const server = { bytes: 477_000, employeeCount: 38, allowlistCount: 36 };
const realEmployees = Array.from({ length: 38 }, (_, i) => ({ id: `e-real-${i}` }));
const realAllowlist = Array.from({ length: 36 }, (_, i) => `p${i}@x.test`);
const good = { bytes: 470_000, employees: realEmployees, allowlist: realAllowlist };
const chk = (p: Partial<typeof good> = {}, s: typeof server | null = server) =>
  checkDocWrite({ ...good, ...p }, s, SUPER);

console.log('\nNormal writes pass');
test('an ordinary save passes', () => {
  assert.equal(chk().ok, true);
});
test('a modest shrink passes — Push Month removes about half the document', () => {
  assert.equal(chk({ bytes: 230_000 }).ok, true);
  assert.equal(chk({ bytes: 100_000 }).ok, true);   // 79% — just inside
});
test('a small database is never frozen by its own size', () => {
  // Below the meaningful threshold the ratio means nothing.
  assert.equal(checkDocWrite(
    { bytes: 200, employees: [{ id: 'a' }], allowlist: ['a@x.test'] },
    { bytes: 40_000, employeeCount: 1, allowlistCount: 1 }, SUPER,
  ).ok, true);
});
test('with no observed server state the write is allowed', () => {
  assert.equal(chk({}, null).ok, true);
});
test('an admin removing one person from the access list still passes', () => {
  assert.equal(chk({ allowlist: realAllowlist.slice(0, 35) }).ok, true);
});
test('a real company with six employees is not mistaken for the seed', () => {
  // Six people, but not e1..e6 — matched by ID, never by count.
  assert.equal(checkDocWrite(
    { bytes: 400_000, employees: [1, 2, 3, 4, 5, 6].map(i => ({ id: `emp-${i}` })), allowlist: realAllowlist },
    { bytes: 420_000, employeeCount: 6, allowlistCount: 36 }, SUPER,
  ).ok, true);
});

console.log('\nCatastrophes are refused');
test('a payload discarding more than 80% is refused', () => {
  const v = chk({ bytes: 2_900 });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'catastrophic-shrink');
  assert.match(v.detail!, /discards 9\d%/);
});
test('the demo roster reaching a populated database is refused', () => {
  const v = chk({ employees: SEED_EMPLOYEE_IDS.map(id => ({ id })) });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'seed-employees');
});
test('emptying the access list is refused', () => {
  const v = chk({ allowlist: [] });
  assert.equal(v.ok, false);
  assert.ok(v.reason === 'allowlist-emptied' || v.reason === 'allowlist-collapsed-to-super-admin');
});
test('collapsing the access list to the super admin alone is refused', () => {
  // THE ACTUAL 2026-08-18 SHAPE: 36 -> 1. An empty-list check alone misses it.
  const v = chk({ allowlist: [SUPER] });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'allowlist-collapsed-to-super-admin');
});

test('THE INCIDENT: yesterday’s exact write is refused', () => {
  // 477 KB / 38 employees / 36 addresses  ->  2.9 KB / seed roster / [super].
  const v = checkDocWrite(
    {
      bytes: 2_900,
      employees: [...SEED_EMPLOYEE_IDS.map(id => ({ id })), { id: 'test-user' }],
      allowlist: [SUPER],
    },
    server, SUPER,
  );
  assert.equal(v.ok, false, 'the write that destroyed production must be refused');
  // Shrink is checked first, so that is the reason reported.
  assert.equal(v.reason, 'catastrophic-shrink');
});

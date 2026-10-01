// Tests for the whole-document write guard.
//   npm test -- docWriteGuard
//
// The cases that matter most are the incidents: the exact shapes of the
// 2026-08-18 and 2026-10-01 writes must be refused.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ABSOLUTE_MIN_BYTES, checkDocWrite, SEED_EMPLOYEE_IDS } from './docWriteGuard';

const SUPER = 'marcoguidopalermo@gmail.com';
const server = { bytes: 477_000, employeeCount: 38, allowlistCount: 36 };
const realEmployees = Array.from({ length: 38 }, (_, i) => ({ id: `e-real-${i}` }));
const realAllowlist = Array.from({ length: 36 }, (_, i) => `p${i}@x.test`);
const admins = ['anthonypalermo23@hotmail.com', SUPER, 'office@x.test', 'sales@x.test'];
const good = { bytes: 470_000, employees: realEmployees, allowlist: realAllowlist, adminEmails: admins };
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
test('an admin removing one person from the access list still passes', () => {
  assert.equal(chk({ allowlist: realAllowlist.slice(0, 35) }).ok, true);
});
test('a real company with six employees is not mistaken for the seed', () => {
  // Six people, but not e1..e6 — matched by ID, never by count.
  assert.equal(checkDocWrite(
    { bytes: 400_000, employees: [1, 2, 3, 4, 5, 6].map(i => ({ id: `emp-${i}` })), allowlist: realAllowlist, adminEmails: admins },
    { bytes: 420_000, employeeCount: 6, allowlistCount: 36 }, SUPER,
  ).ok, true);
});

console.log('\nNo server copy is a refusal, never a pass');
test('a session that has not received the document cannot write', () => {
  const v = chk({}, null);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'no-server-snapshot');
});

console.log('\nAbsolute checks run with or without a server copy');
for (const s of [server, null]) {
  const label = s ? 'with a server copy' : 'with no server copy';
  test(`an empty access list is refused (${label})`, () => {
    assert.equal(chk({ allowlist: [] }, s).reason, 'allowlist-emptied');
  });
  test(`an empty admin list is refused (${label})`, () => {
    assert.equal(chk({ adminEmails: [] }, s).reason, 'admin-list-emptied');
  });
  test(`the demo roster is refused (${label})`, () => {
    assert.equal(chk({ employees: SEED_EMPLOYEE_IDS.map(id => ({ id })) }, s).reason, 'seed-employees');
  });
  test(`a document of a few KB is refused (${label})`, () => {
    assert.equal(chk({ bytes: ABSOLUTE_MIN_BYTES - 1 }, s).reason, 'document-too-small');
  });
}

console.log('\nRelative checks');
test('a payload discarding more than 80% is refused', () => {
  const v = chk({ bytes: 60_000 });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'catastrophic-shrink');
  assert.match(v.detail!, /discards 8\d%/);
});
test('collapsing the access list to the super admin alone is refused', () => {
  // THE 2026-08-18 SHAPE: 36 -> 1. An empty-list check alone misses it.
  const v = chk({ allowlist: [SUPER] });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'allowlist-collapsed-to-super-admin');
});

console.log('\nThe incidents');
test('2026-08-18: seed roster, one-entry allowlist, 2.9 KB — refused', () => {
  const v = checkDocWrite(
    {
      bytes: 2_900,
      employees: [...SEED_EMPLOYEE_IDS.map(id => ({ id })), { id: 'test-user' }],
      allowlist: [SUPER],
      adminEmails: [],
    },
    server, SUPER,
  );
  assert.equal(v.ok, false, 'the write that destroyed production must be refused');
});
test('2026-10-01: seed roster, EMPTY allowlist, no server copy ever seen — refused', () => {
  // A crew phone that never received the document; the bulletin mark-read
  // save sent the in-memory defaults. The old guard allowed it because the
  // server state was null.
  const v = checkDocWrite(
    {
      bytes: 3_800,
      employees: [{ id: 'test-user' }, ...SEED_EMPLOYEE_IDS.map(id => ({ id }))],
      allowlist: [],
      adminEmails: [],
    },
    null, SUPER,
  );
  assert.equal(v.ok, false, 'the write that wiped production must be refused');
  assert.equal(v.reason, 'allowlist-emptied');
});

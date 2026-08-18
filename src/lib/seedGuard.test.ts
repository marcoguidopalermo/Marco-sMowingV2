// Tests for the first-install seed guard.
//   npm test -- seedGuard
//
// The incident: this branch wrote demo defaults over a live production
// document. These cases are almost entirely about what must NOT write.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { maySeedDatabase, seedRefusalReason } from './seedGuard';

// A genuinely fresh database, opened by the owner.
const fresh = {
  fromCache: false, hasPendingWrites: false, docEverExisted: false,
  knownAllowlistSize: 0, isSuperAdmin: true,
};
const g = (o: Partial<typeof fresh> = {}) => ({ ...fresh, ...o });

test('a genuinely new database opened by the owner MAY be seeded', () => {
  assert.equal(maySeedDatabase(fresh), true);
  assert.equal(seedRefusalReason(fresh), null);
});

test('THE INCIDENT: a session that has seen the document never seeds', () => {
  // A database does not un-install itself. This alone would have prevented it.
  assert.equal(seedRefusalReason(g({ docEverExisted: true })), 'document-has-existed');
  assert.equal(maySeedDatabase(g({ docEverExisted: true })), false);
});

test('a known access list blocks the seed — the field whose loss locks people out', () => {
  assert.equal(seedRefusalReason(g({ knownAllowlistSize: 36 })), 'allowlist-known');
  assert.equal(seedRefusalReason(g({ knownAllowlistSize: 1 })), 'allowlist-known');
});

test('an unsettled snapshot is not evidence of absence', () => {
  assert.equal(seedRefusalReason(g({ fromCache: true })), 'unsettled-snapshot');
  assert.equal(seedRefusalReason(g({ hasPendingWrites: true })), 'unsettled-snapshot');
});

test('only the owner can bootstrap a database', () => {
  assert.equal(seedRefusalReason(g({ isSuperAdmin: false })), 'not-super-admin');
});

test('EVERY condition is required — drop any one and the seed is refused', () => {
  const breaks = [
    { fromCache: true }, { hasPendingWrites: true }, { docEverExisted: true },
    { knownAllowlistSize: 1 }, { isSuperAdmin: false },
  ];
  for (const b of breaks) {
    assert.equal(maySeedDatabase(g(b)), false, `should refuse with ${JSON.stringify(b)}`);
  }
});

test('the exact shape of the 2026-08-18 incident is refused', () => {
  // A live database, a session that had it, a full allowlist, a non-owner.
  assert.equal(maySeedDatabase({
    fromCache: false, hasPendingWrites: false,
    docEverExisted: true, knownAllowlistSize: 36, isSuperAdmin: false,
  }), false);
  // Even if the owner themselves were the one whose client did it.
  assert.equal(maySeedDatabase({
    fromCache: false, hasPendingWrites: false,
    docEverExisted: true, knownAllowlistSize: 36, isSuperAdmin: true,
  }), false);
});

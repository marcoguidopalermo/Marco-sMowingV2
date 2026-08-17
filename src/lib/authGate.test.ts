// Tests for the client-side auth gate decision.
//   npm test -- authGate
//
// The bug being guarded against: sales@marcosmowing.com was on the access list
// and still got "not authorized" at sign-in, intermittently, then resolved with
// no fix applied. A gate that can lock out a legitimate employee and leave no
// evidence is the thing under test — so these cases are mostly about what must
// NOT reject.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { decideAuthGate, listFingerprint, normalizeGateEmail } from './authGate';

const SUPER = 'marcoguidopalermo@gmail.com';
const LIST = ['marcoguidopalermo@gmail.com', 'office@marcosmowing.com', 'sales@marcosmowing.com'];

const decide = (o: Partial<Parameters<typeof decideAuthGate>[0]> = {}) => decideAuthGate({
  email: 'sales@marcosmowing.com',
  authorizedEmails: LIST,
  fromCache: false,
  hasPendingWrites: false,
  sessionAlreadyAuthorized: false,
  superAdminEmail: SUPER,
  ...o,
});

console.log('\nThe happy path');
test('an email on a server-confirmed list passes', () => {
  const g = decide();
  assert.equal(g.decision, 'pass');
  assert.equal(g.emailOnList, true);
  assert.equal(g.settled, true);
});
test('the super admin passes even with an empty or missing list', () => {
  assert.equal(decide({ email: SUPER, authorizedEmails: [] }).decision, 'pass');
  assert.equal(decide({ email: SUPER, authorizedEmails: undefined }).decision, 'pass');
  assert.equal(decide({ email: SUPER, authorizedEmails: null }).decision, 'pass');
});
test('comparison is case- and whitespace-insensitive on BOTH sides', () => {
  assert.equal(decide({ email: '  SALES@Marcosmowing.COM ' }).decision, 'pass');
  assert.equal(decide({ authorizedEmails: ['  Sales@MarcosMowing.com  '] }).decision, 'pass');
});

console.log('\nWhat must NEVER reject');
test('an UNSETTLED snapshot cannot reject, even if the email is absent', () => {
  // A cached snapshot is not evidence about the server's list. This is the
  // hardening: the old gate rejected on any snapshot whose list was non-empty.
  const cached = decide({ email: 'nobody@example.test', fromCache: true });
  assert.equal(cached.decision, 'hold');
  const pending = decide({ email: 'nobody@example.test', hasPendingWrites: true });
  assert.equal(pending.decision, 'hold');
});
test('a missing, empty or non-array list holds — never "deny everyone"', () => {
  for (const bad of [undefined, null, [], {}, 'sales@marcosmowing.com', 0]) {
    const g = decide({ email: 'nobody@example.test', authorizedEmails: bad });
    assert.equal(g.decision, 'hold', `authorizedEmails=${JSON.stringify(bad)} must hold`);
  }
});
test('a list of only blanks holds — it carries no information', () => {
  const g = decide({ email: 'nobody@example.test', authorizedEmails: ['', '   ', null] });
  assert.equal(g.decision, 'hold');
  assert.equal(g.listKnown, false);
  assert.equal(g.listLength, 0);
});
test('a session that already passed is never ejected by a later snapshot', () => {
  // Covers the real root cause: a client with stale in-memory state performs a
  // full-document save and momentarily writes an older authorizedEmails. A live
  // session must not be kicked by that echo.
  const g = decide({
    email: 'sales@marcosmowing.com',
    authorizedEmails: ['office@marcosmowing.com'],   // stale list, missing them
    sessionAlreadyAuthorized: true,
  });
  assert.equal(g.decision, 'lenient-pass');
});
test('an empty credential email holds rather than rejecting', () => {
  // A Google credential without an email must not produce "your email
  // (unknown) is not authorized" — we cannot conclude anything about them.
  for (const e of [undefined, null, '', '   ']) {
    assert.equal(decide({ email: e }).decision, 'hold', `email=${JSON.stringify(e)}`);
  }
});

console.log('\nWhat SHOULD reject');
test('a server-confirmed list that genuinely lacks the email rejects', () => {
  const g = decide({ email: 'stranger@example.test' });
  assert.equal(g.decision, 'reject');
  assert.equal(g.listKnown, true);
  assert.equal(g.settled, true);
  assert.equal(g.emailOnList, false);
});
test('rejection requires ALL FOUR conditions — drop any one and it holds', () => {
  const base = { email: 'stranger@example.test' } as const;
  assert.equal(decide(base).decision, 'reject');                                  // all four
  assert.equal(decide({ ...base, fromCache: true }).decision, 'hold');            // not settled
  assert.equal(decide({ ...base, hasPendingWrites: true }).decision, 'hold');     // not settled
  assert.equal(decide({ ...base, authorizedEmails: [] }).decision, 'hold');       // list unknown
  assert.equal(decide({ ...base, sessionAlreadyAuthorized: true }).decision, 'lenient-pass');
});

console.log('\nThe diagnostic facts');
test('the facts say what the gate SAW, not just what it decided', () => {
  const g = decide({ email: 'stranger@example.test' });
  // Every one of these was missing when this bug was investigated, and each
  // would have shortened it.
  assert.equal(g.emailCompared, 'stranger@example.test');
  assert.equal(g.listFieldPresent, true);
  assert.equal(g.listLength, 3);
  assert.equal(g.listKnown, true);
  assert.equal(g.emailOnList, false);
  assert.equal(g.fromCache, false);
  assert.equal(g.hasPendingWrites, false);
  assert.equal(g.settled, true);
  assert.equal(g.sessionAlreadyAuthorized, false);
  assert.ok(g.listFingerprint);
});
test('a missing email is reported as such, not as an empty string', () => {
  assert.equal(decide({ email: null }).emailCompared, '(none on credential)');
});
test('the fingerprint distinguishes DIFFERENT lists of the same length', () => {
  // The point of a fingerprint over a count: a stale write can swap one address
  // for another and keep the length identical.
  const a = listFingerprint(['a@x.test', 'b@x.test', 'c@x.test']);
  const b = listFingerprint(['a@x.test', 'b@x.test', 'd@x.test']);
  assert.notEqual(a, b);
  assert.equal(a.split(':')[0], '3');
  assert.equal(b.split(':')[0], '3');
});
test('the fingerprint is stable for the same list, and marks empty', () => {
  assert.equal(listFingerprint(['a@x.test']), listFingerprint(['a@x.test']));
  assert.equal(listFingerprint([]), 'empty');
});
test('the fingerprint does not leak the addresses it summarises', () => {
  const fp = listFingerprint(LIST);
  for (const e of LIST) assert.ok(!fp.includes(e), 'fingerprint must not contain an address');
  assert.ok(fp.length < 20);
});

console.log('\nEmail normalisation');
test('normalizeGateEmail trims, lowercases, and tolerates non-strings', () => {
  assert.equal(normalizeGateEmail('  A@B.COM '), 'a@b.com');
  for (const v of [undefined, null, 42, {}, []]) assert.equal(normalizeGateEmail(v), '');
});

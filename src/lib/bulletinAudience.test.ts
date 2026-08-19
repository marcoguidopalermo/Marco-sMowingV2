// Tests for bulletin targeting.
//   npm test -- bulletinAudience
//
// The promise being kept: "named recipients see it; nobody else sees it at
// all." That includes admins, who are not given a blanket pass.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  canSeeBulletin, describeAudience, isForEveryone, namedRecipients,
  pickableRecipients,
} from './bulletinAudience';
import type { BulletinPost, Employee } from '../types';

const emp = (o: Partial<Employee> & { id: string; name: string }): Employee => ({
  status: 'Active', hasLicense: false, hasClassA: false, hasHeavyMachinery: false,
  awayDates: [], linkedUserEmail: `${o.id}@x.test`, ...o,
} as Employee);

const CODY = emp({ id: 'e-cody', name: 'Cody Hubert' });
const DIEGO = emp({ id: 'e-diego', name: 'Diego Galvez' });
const ROSTER = [CODY, DIEGO, emp({ id: 'e-ana', name: 'Ana' })];

const b = (o: Partial<BulletinPost> = {}): BulletinPost => ({
  id: 'b1', title: 'T', content: 'C', date: '2026-08-19', author: 'marco@x.test', ...o,
} as BulletinPost);

const sees = (post: BulletinPost, employeeId: string | null, role: string, isAdmin = false) =>
  canSeeBulletin(post, { role: role as any, employeeId }, isAdmin);

console.log('\nEveryone, as before');
test('a bulletin with no targeting goes to everyone', () => {
  const post = b();
  assert.equal(isForEveryone(post), true);
  assert.equal(sees(post, 'e-ana', 'worker'), true);
  assert.equal(sees(post, null, 'mechanic'), true);
});
test('the legacy admin-only flag still applies to an untargeted post', () => {
  const post = b({ isAdminOnly: true });
  assert.equal(sees(post, 'e-ana', 'worker'), false);
  assert.equal(sees(post, 'e-ana', 'worker', true), true);
});

console.log('\nNamed people');
test('a named recipient sees it', () => {
  const post = b({ recipientIds: ['e-cody', 'e-diego'] });
  assert.equal(sees(post, 'e-cody', 'mechanic'), true);
  assert.equal(sees(post, 'e-diego', 'manager'), true);
});
test('NOBODY ELSE sees it — including an admin', () => {
  const post = b({ recipientIds: ['e-cody'] });
  assert.equal(sees(post, 'e-ana', 'worker'), false);
  assert.equal(sees(post, 'e-ana', 'admin', true), false,
    'an admin pass would make "nobody else" untrue');
});
test('a viewer with no employee record sees nothing targeted', () => {
  assert.equal(sees(b({ recipientIds: ['e-cody'] }), null, 'admin', true), false);
});
test('it is not for everyone once anyone is named', () => {
  assert.equal(isForEveryone(b({ recipientIds: ['e-cody'] })), false);
});

console.log('\nRoles and people combine by UNION');
test('a role group PLUS two named people reaches both', () => {
  const post = b({ audience: ['manager'], recipientIds: ['e-cody'] });
  assert.equal(sees(post, 'e-diego', 'manager'), true, 'by role');
  assert.equal(sees(post, 'e-cody', 'mechanic'), true, 'by name');
  assert.equal(sees(post, 'e-ana', 'worker'), false, 'neither');
});
test('a role-only bulletin behaves exactly as it always did', () => {
  const post = b({ audience: ['worker'] });
  assert.equal(sees(post, 'e-ana', 'worker'), true);
  assert.equal(sees(post, 'e-cody', 'mechanic'), false);
});

console.log('\nThe audience line on the bulletin');
test('named people are listed by name', () => {
  assert.equal(describeAudience(b({ recipientIds: ['e-cody', 'e-diego'] }), ROSTER),
    'Cody Hubert · Diego Galvez');
});
test('roles are listed with readable labels', () => {
  assert.equal(describeAudience(b({ audience: ['manager', 'worker'] }), ROSTER),
    'Managers · Workers');
});
test('a mixed audience lists roles then people', () => {
  assert.equal(describeAudience(b({ audience: ['manager'], recipientIds: ['e-cody'] }), ROSTER),
    'Managers · Cody Hubert');
});
test('everyone produces an empty line — nothing to say', () => {
  assert.equal(describeAudience(b(), ROSTER), '');
});
test('names resolve at READ time, so a rename shows the new name', () => {
  const renamed = [emp({ id: 'e-cody', name: 'Cody H. Hubert' })];
  assert.equal(describeAudience(b({ recipientIds: ['e-cody'] }), renamed), 'Cody H. Hubert');
});
test('a departed recipient is reported, not dropped — somebody was told', () => {
  assert.equal(describeAudience(b({ recipientIds: ['e-cody', 'e-gone'] }), ROSTER),
    'Cody Hubert · 1 former employee');
  assert.equal(describeAudience(b({ recipientIds: ['e-x', 'e-y'] }), ROSTER),
    '2 former employees');
});

console.log('\nResolving recipients for sending');
test('named employees resolve to their records', () => {
  assert.deepEqual(namedRecipients(b({ recipientIds: ['e-cody', 'e-diego'] }), ROSTER).map(e => e.id),
    ['e-cody', 'e-diego']);
});
test('an unknown id resolves to nothing rather than throwing', () => {
  assert.deepEqual(namedRecipients(b({ recipientIds: ['e-gone'] }), ROSTER), []);
});
test('a test account is never a recipient', () => {
  const withTest = [...ROSTER, emp({ id: 'e-test', name: 'Test User', isTestUser: true })];
  assert.deepEqual(namedRecipients(b({ recipientIds: ['e-test'] }), withTest), []);
});
test('no named list resolves to nothing', () => {
  assert.deepEqual(namedRecipients(b(), ROSTER), []);
});

console.log('\nWho the picker offers');
test('inactive, test and address-less people are not offerable', () => {
  const list = [
    CODY,
    emp({ id: 'e-off', name: 'Gone', status: 'Inactive' }),
    emp({ id: 'e-t', name: 'Test', isTestUser: true }),
    emp({ id: 'e-noaddr', name: 'No Address', linkedUserEmail: '', email: '' }),
  ];
  assert.deepEqual(pickableRecipients(list).map(e => e.id), ['e-cody']);
});
test('the picker is sorted by name', () => {
  assert.deepEqual(pickableRecipients(ROSTER).map(e => e.name),
    ['Ana', 'Cody Hubert', 'Diego Galvez']);
});
test('an empty roster is handled', () => {
  assert.deepEqual(pickableRecipients(undefined), []);
});

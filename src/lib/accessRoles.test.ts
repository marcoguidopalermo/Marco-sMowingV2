// Client-side role resolution and the roster-save role guard.
//   npm test -- accessRoles
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { effectiveRoleFromAccess, parseAccessRoles, preserveServerRoles } from './accessRoles';
import type { Employee } from '../types';

const ACCESS = { admins: ['dave@x.test', 'marcoguidopalermo@gmail.com'], managers: ['jonah@x.test'] };

console.log('\nEffective role');
test('admin/manager only from access/roles; forged roster roles are workers', () => {
  assert.equal(effectiveRoleFromAccess('worker', 'Dave@X.test', ACCESS), 'admin');
  assert.equal(effectiveRoleFromAccess('worker', 'jonah@x.test', ACCESS), 'manager');
  assert.equal(effectiveRoleFromAccess('admin', 'crew@x.test', ACCESS), 'worker');
  assert.equal(effectiveRoleFromAccess('manager', 'crew@x.test', ACCESS), 'worker');
  assert.equal(effectiveRoleFromAccess('mechanic', 'cody@x.test', ACCESS), 'mechanic');
  assert.equal(effectiveRoleFromAccess(undefined, null, ACCESS), 'worker');
});
test('before access/roles loads, the roster role is used (UI only)', () => {
  assert.equal(effectiveRoleFromAccess('admin', 'dave@x.test', null), 'admin');
});

console.log('\nRoster saves cannot change roles');
const server = [
  { id: 'e1', name: 'Dave', systemRole: 'admin' },
  { id: 'e2', name: 'Jonah', systemRole: 'manager' },
  { id: 'e3', name: 'Crew', systemRole: 'worker' },
] as unknown as Employee[];
test('THE STALE-COPY CASE: an edit carrying an old role keeps the server role', () => {
  // Dave was demoted on the server; a stale copy still says admin and edits his phone.
  const srv = server.map(e => (e.id === 'e1' ? { ...e, systemRole: 'manager' } : e)) as Employee[];
  const next = server.map(e => (e.id === 'e1' ? { ...e, phone: '555' } : e)) as Employee[];
  const out = preserveServerRoles(next, srv);
  assert.equal(out.find(e => e.id === 'e1')!.systemRole, 'manager');
  assert.equal((out.find(e => e.id === 'e1') as unknown as { phone: string }).phone, '555');
});
test('a crew member can\'t promote themselves through a roster save', () => {
  const next = server.map(e => (e.id === 'e3' ? { ...e, systemRole: 'admin' } : e)) as Employee[];
  assert.equal(preserveServerRoles(next, server).find(e => e.id === 'e3')!.systemRole, 'worker');
});
test('new employees: non-privileged roles kept, admin/manager become worker', () => {
  const next = [...server, { id: 'n1', systemRole: 'mechanic' }, { id: 'n2', systemRole: 'admin' }, { id: 'n3', systemRole: 'manager' }] as unknown as Employee[];
  const out = preserveServerRoles(next, server);
  assert.equal(out.find(e => e.id === 'n1')!.systemRole, 'mechanic');
  assert.equal(out.find(e => e.id === 'n2')!.systemRole, 'worker');
  assert.equal(out.find(e => e.id === 'n3')!.systemRole, 'worker');
});
test('unchanged employees are returned as the same objects', () => {
  const out = preserveServerRoles(server, server);
  out.forEach((e, i) => assert.equal(e, server[i]));
});
test('parseAccessRoles normalizes and tolerates junk', () => {
  assert.deepEqual(parseAccessRoles({ admins: [' A@X.test '], managers: null }), { admins: ['a@x.test'], managers: [] });
  assert.equal(parseAccessRoles(undefined), null);
});

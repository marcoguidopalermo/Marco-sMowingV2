// A role change followed by a plain Save must never write `undefined`.
//   npm test -- rosterSaveFlow
//
// 2026-10-14: changing Jonah's role with the dropdown and then pressing Save
// in Manage Resources (no other edits) failed with "Unsupported field value:
// undefined". These tests run the same steps the app does — on a roster
// shaped like the live one, where 18 of 38 records have NO systemRole field,
// some emails are null, and records carry awayDates/trainingHistory arrays.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { applyRoleChange, planRosterSave, preserveServerRoles } from './accessRoles';
import { stripUndefined } from './rosterWrite';
import type { Employee } from '../types';

// Live-shaped (field sets and value kinds copied from production; people made up).
const LIVE_SHAPED = [
  { id: 'e-marco', name: 'Marco', status: 'Active', systemRole: 'admin', email: 'marcoguidopalermo@gmail.com', linkedUserEmail: 'marcoguidopalermo@gmail.com', hasLicense: true, hasClassA: true, hasHeavyMachinery: true, awayDates: [], color: 'blue' },
  { id: 'e-jonah', name: 'Jonah', status: 'Active', systemRole: 'manager', email: 'jonah@x.test', linkedUserEmail: 'jonah@x.test', hasLicense: true, hasClassA: false, hasHeavyMachinery: false, awayDates: [{ start: '2026-07-01', end: '2026-07-03' }], color: 'green', jobberUserId: 'Z2lk', primaryCrew: 'lawn', managedDivision: 'lawn' },
  // No systemRole field at all (18 of 38 live records look like this):
  { id: 'e-thomas', name: 'Thomas', status: 'Active', email: 'thomas@x.test', linkedUserEmail: 'thomas@x.test', hasLicense: false, hasClassA: false, hasHeavyMachinery: false, awayDates: [], color: 'red', primaryCrew: 'lawn' },
  { id: 'e-justin', name: 'Justin', status: 'Active', email: 'justin@x.test', linkedUserEmail: 'justin@x.test', hasLicense: true, hasClassA: false, hasHeavyMachinery: false, awayDates: [], color: 'teal', jobberUserId: 'Z2lj' },
  // Null email / linkedUserEmail (3 live values are null):
  { id: 'e-garon', name: 'Garon', status: 'Active', email: null, linkedUserEmail: null, hasLicense: false, hasClassA: false, hasHeavyMachinery: false, awayDates: [], color: 'amber' },
  { id: 'e-cody', name: 'Cody', status: 'Active', systemRole: 'mechanic', email: 'cody@x.test', linkedUserEmail: 'cody@x.test', hasLicense: true, hasClassA: true, hasHeavyMachinery: true, awayDates: [], color: 'slate', hoursPer1000: 12, payMode: 'chunk', timeMasterEnabled: true },
  { id: 'e-trainee', name: 'Trainee', status: 'Active', email: 'trainee@x.test', linkedUserEmail: 'trainee@x.test', hasLicense: false, hasClassA: false, hasHeavyMachinery: false, awayDates: [], color: 'pink', training: true, trainingHistory: [{ action: 'start', startDate: '2026-06-01', endDate: '2026-06-30', at: 1780000000000, by: 'office@x.test', byName: 'Dave' }] },
  { id: 'e-test', name: 'Test User', status: 'Active', systemRole: 'mechanic', isTestUser: true, email: 'test@x.test', linkedUserEmail: 'test@x.test', hasLicense: false, hasClassA: false, hasHeavyMachinery: false, awayDates: [], color: 'gray', timeMasterEnabled: true },
] as unknown as Employee[];

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const norm = (s: string) => s.trim().toLowerCase();
// App.tsx Manage Resources Save: normalizedEmployees.
const normalizeForSave = (list: Employee[]) => list.map(e => ({ ...e,
  linkedUserEmail: e.linkedUserEmail ? norm(e.linkedUserEmail) : e.linkedUserEmail,
  email: e.email ? norm(e.email) : e.email }));
// App.tsx modal-clobber effect (runs whenever appData.employees changes while the modal is open).
const clobber = (local: Employee[], fresh: Employee[]) => local.map(l => {
  const f = fresh.find(x => x.id === l.id); return f ? { ...l, awayDates: clone(f.awayDates || []) } : l;
});
function undefinedPaths(v: unknown, path = ''): string[] {
  if (v === undefined) return [path || '(root)'];
  if (Array.isArray(v)) return v.flatMap((x, i) => undefinedPaths(x, `${path}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => undefinedPaths(x, path ? `${path}.${k}` : k));
  return [];
}

/** The app, step by step: open the modal, change one role with the dropdown, press Save. */
function roleChangeThenSave(employeeId: string, role: 'worker' | 'manager', opts: { snapshotArrivesBeforeSave: boolean }) {
  let server = clone(LIVE_SHAPED);                 // Firestore
  let appEmployees = clone(server);                // appData.employees / serverEmployeesRef
  let local = clone(appEmployees);                 // modal opens: JSON clone (App.tsx openManageTab)
  // setUserRole (server): roster role for that employee.
  server = server.map(e => (e.id === employeeId ? { ...e, systemRole: role } : e));
  // App: changeUserRole success → own copies updated immediately.
  appEmployees = applyRoleChange(appEmployees, employeeId, role);
  // Modal handler: local copy updated.
  local = local.map(x => (x.id === employeeId ? { ...x, systemRole: role } : x));
  if (opts.snapshotArrivesBeforeSave) {
    appEmployees = clone(server);
    local = clobber(local, appEmployees);
  }
  // Save, no other edits.
  return planRosterSave({ next: normalizeForSave(local), baseline: appEmployees, server: appEmployees });
}

console.log('\n1. preserveServerRoles: a record with no role field on the server');
test('drops the field instead of writing systemRole: undefined', () => {
  const server = clone(LIVE_SHAPED);
  const local = server.map(e => (e.id === 'e-thomas' ? { ...e, systemRole: 'worker' } : e)) as Employee[];
  const out = preserveServerRoles(local, server).find(e => e.id === 'e-thomas')!;
  assert.equal('systemRole' in out, false);
  assert.deepEqual(undefinedPaths(out), []);
});

console.log('\n2. stripUndefined: nothing undefined is ever written');
test('drops undefined keys and array elements, deep; keeps null; reports paths', () => {
  const { value, paths } = stripUndefined([{ a: 1, b: undefined, c: null, d: [1, undefined, { e: undefined, f: 2 }] }, undefined]);
  assert.deepEqual(value, [{ a: 1, c: null, d: [1, { f: 2 }] }]);
  assert.deepEqual(paths, ['[0].b', '[0].d[1]', '[0].d[2].e', '[1]']);
});
test('leaves a clean roster untouched', () => {
  const { value, paths } = stripUndefined(LIVE_SHAPED);
  assert.deepEqual(paths, []);
  assert.deepEqual(value, LIVE_SHAPED);
});

console.log('\n3. THE REPORTED CASE: role change via the dropdown, then Save with no other edits');
for (const [id, role] of [['e-jonah', 'worker'], ['e-jonah', 'manager'], ['e-thomas', 'manager'], ['e-justin', 'worker']] as const) {
  for (const snapshotArrivesBeforeSave of [true, false]) {
    test(`${id} → ${role}, then Save (${snapshotArrivesBeforeSave ? 'after' : 'before'} the snapshot lands): no undefined, no other record touched`, () => {
      const { plan, employees, strippedPaths } = roleChangeThenSave(id, role, { snapshotArrivesBeforeSave });
      assert.equal(plan.refused, undefined);
      assert.deepEqual(undefinedPaths(employees), []);       // what reaches updateDoc
      assert.deepEqual(strippedPaths, []);                   // nothing even needed stripping
      assert.ok(plan.upserted.every(u => u === id), `unexpected upserts: ${plan.upserted}`);
      assert.equal(employees.find(e => e.id === id)!.systemRole, role);   // the save doesn't undo the role
    });
  }
}
test('even if the app\'s copy carries a role for a record the server has none for, the write has no undefined', () => {
  const server = clone(LIVE_SHAPED);
  const local = normalizeForSave(server.map(e => (e.id === 'e-thomas' ? { ...e, systemRole: 'worker', phone: '1' } as Employee : e)));
  const { employees, strippedPaths } = planRosterSave({ next: local, baseline: server, server });
  assert.deepEqual(undefinedPaths(employees), []);
  assert.deepEqual(strippedPaths, []);
  assert.equal('systemRole' in employees.find(e => e.id === 'e-thomas')!, false);
});

console.log('\n4. After a role change, an automatic save carries the NEW role');
test('applyRoleChange updates only that employee, immutably', () => {
  const before = clone(LIVE_SHAPED);
  const after = applyRoleChange(before, 'e-jonah', 'worker');
  assert.equal(after.find(e => e.id === 'e-jonah')!.systemRole, 'worker');
  assert.equal(before.find(e => e.id === 'e-jonah')!.systemRole, 'manager');
  after.filter(e => e.id !== 'e-jonah').forEach(e => assert.equal(e, before.find(b => b.id === e.id)));
});

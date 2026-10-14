/* eslint-disable max-len */
// Who is an admin or manager.
//   npm test -- accessRolesCore
import {test} from "vitest";
import assert from "node:assert/strict";
import {
  driftReport, effectiveRole, planRoleChange, RosterEmployee, SUPER_ADMIN_EMAIL,
} from "./accessRolesCore";

const ACCESS = {
  admins: ["dave@x.test", SUPER_ADMIN_EMAIL],
  managers: ["jonah@x.test"],
};
const ROSTER: RosterEmployee[] = [
  {id: "e-marco", name: "Marco", systemRole: "admin", linkedUserEmail: SUPER_ADMIN_EMAIL},
  {id: "e-dave", name: "Dave", systemRole: "admin", linkedUserEmail: "Dave@X.test "},
  {id: "e-jonah", name: "Jonah", systemRole: "manager", linkedUserEmail: "jonah@x.test"},
  {id: "e-kris", name: "Kris", systemRole: "contractor", email: "kris@x.test"},
  {id: "e-nomail", name: "No Mail", systemRole: "worker"},
];

console.log("\nEffective role");
test("admin/manager only from access/roles; a forged roster role is a worker", () => {
  assert.equal(effectiveRole("worker", "dave@x.test", ACCESS), "admin");
  assert.equal(effectiveRole("worker", "JONAH@x.test", ACCESS), "manager");
  assert.equal(effectiveRole("admin", "crew@x.test", ACCESS), "worker");
  assert.equal(effectiveRole("manager", "crew@x.test", ACCESS), "worker");
  assert.equal(effectiveRole("contractor", "kris@x.test", ACCESS), "contractor");
  assert.equal(effectiveRole(undefined, "", ACCESS), "worker");
});

console.log("\nsetUserRole planning");
const plan = (employeeId: string, newRole: string, callerEmail = "dave@x.test") =>
  planRoleChange({access: ACCESS, employees: ROSTER, employeeId, newRole, callerEmail});

test("only an admin (or the super admin) may change roles", () => {
  const p = plan("e-kris", "worker", "jonah@x.test");
  assert.equal(p.ok, false);
  assert.equal(!p.ok && p.code, "permission-denied");
  assert.equal(plan("e-kris", "worker", SUPER_ADMIN_EMAIL).ok, true);
});

test("manager → worker → manager round trip", () => {
  const down = plan("e-jonah", "worker");
  assert.ok(down.ok);
  if (!down.ok) return;
  assert.equal(down.from, "manager");
  assert.deepEqual(down.nextAccess.managers, []);
  assert.equal(down.nextEmployees.find((e) => e.id === "e-jonah")?.systemRole, "worker");
  const up = planRoleChange({access: down.nextAccess, employees: down.nextEmployees,
    employeeId: "e-jonah", newRole: "manager", callerEmail: "dave@x.test"});
  assert.ok(up.ok);
  if (!up.ok) return;
  assert.equal(up.from, "worker");
  assert.deepEqual(up.nextAccess.managers, ["jonah@x.test"]);
  assert.equal(up.nextEmployees.find((e) => e.id === "e-jonah")?.systemRole, "manager");
});

test("demoting an admin removes them from access/roles AND the old mirror", () => {
  const p = plan("e-dave", "manager", SUPER_ADMIN_EMAIL);
  assert.ok(p.ok);
  if (!p.ok) return;
  assert.deepEqual(p.nextAccess.admins, [SUPER_ADMIN_EMAIL]);
  assert.deepEqual(p.nextAdminEmails, [SUPER_ADMIN_EMAIL]);
  assert.deepEqual(p.nextAccess.managers, ["dave@x.test", "jonah@x.test"]);
});

test("promotion adds to access/roles and the mirror", () => {
  const p = plan("e-kris", "admin");
  assert.ok(p.ok);
  if (!p.ok) return;
  assert.ok(p.nextAccess.admins.includes("kris@x.test"));
  assert.ok(p.nextAdminEmails.includes("kris@x.test"));
});

test("the super admin can't be demoted; nobody can remove the last admin", () => {
  const p1 = plan("e-marco", "worker");
  assert.equal(!p1.ok && p1.code, "failed-precondition");
  const solo = planRoleChange({access: {admins: ["dave@x.test"], managers: []},
    employees: ROSTER, employeeId: "e-dave", newRole: "worker", callerEmail: "dave@x.test"});
  assert.equal(!solo.ok && solo.message, "That would leave no admins.");
});

test("admin/manager need a sign-in email; unknown role and employee refused", () => {
  assert.equal(((p) => !p.ok && p.code)(plan("e-nomail", "manager")), "failed-precondition");
  assert.equal(plan("e-nomail", "foreman").ok, true);
  assert.equal(((p) => !p.ok && p.code)(plan("e-kris", "overlord")), "invalid-argument");
  assert.equal(((p) => !p.ok && p.code)(plan("e-ghost", "worker")), "not-found");
});

test("planning never mutates its input", () => {
  const before = JSON.stringify({ACCESS, ROSTER});
  plan("e-jonah", "worker");
  plan("e-dave", "manager", SUPER_ADMIN_EMAIL);
  assert.equal(JSON.stringify({ACCESS, ROSTER}), before);
});

console.log("\nDrift check");
test("consistent state → in sync", () => {
  const r = driftReport({access: ACCESS, adminEmails: ["dave@x.test", SUPER_ADMIN_EMAIL], employees: ROSTER});
  assert.deepEqual(r.issues, []);
  assert.equal(r.inSync, true);
});
test("each kind of disagreement is reported", () => {
  const forged = ROSTER.map((e) => e.id === "e-kris" ? {...e, systemRole: "admin"} : e);
  const r = driftReport({access: ACCESS, adminEmails: ["dave@x.test", SUPER_ADMIN_EMAIL, "kris@x.test"], employees: forged});
  assert.equal(r.inSync, false);
  assert.ok(r.issues.some((i) => /Kris is "admin" on the roster but not in access\/roles/.test(i)));
  assert.ok(r.issues.some((i) => /kris@x.test is in appData.adminEmails but not an admin/.test(i)));
  assert.equal(driftReport({access: null, adminEmails: [], employees: []}).inSync, false);
});

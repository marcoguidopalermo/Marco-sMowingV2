// WHO IS AN ADMIN OR MANAGER — pure logic, no Firebase. Used by setUserRole,
// the drift check and the notification audience resolver; tested in
// accessRolesCore.test.ts.
//
// access/roles is the single source of truth (server-written only). The
// roster's employees[].systemRole is a mirror for the two privileged roles:
// a roster saying "admin" or "manager" for someone NOT in access/roles is
// stale or forged, and counts as a worker.

export const SUPER_ADMIN_EMAIL = "marcoguidopalermo@gmail.com";

export const ROLES = [
  "admin", "manager", "foreman", "worker", "mechanic",
  "contractor", "property_manager", "marketing",
] as const;
export type Role = typeof ROLES[number];
const PRIVILEGED: ReadonlySet<string> = new Set(["admin", "manager"]);

export interface AccessRoles {
  admins: string[];
  managers: string[];
}

export interface RosterEmployee {
  id?: string;
  name?: string;
  systemRole?: string;
  linkedUserEmail?: string;
  email?: string;
  [k: string]: unknown;
}

export const normEmail = (v: unknown): string =>
  typeof v === "string" ? v.trim().toLowerCase() : "";

/**
 * The address a role is keyed by: the linked sign-in, else the email.
 * @param {RosterEmployee} e A roster entry.
 * @return {string} Normalized address, or "".
 */
export const employeeEmail = (e: RosterEmployee): string =>
  normEmail(e.linkedUserEmail || e.email);

const sortedUnique = (xs: string[]): string[] =>
  [...new Set(xs.map(normEmail).filter(Boolean))].sort();

/**
 * The role that counts. Admin/manager come ONLY from access/roles; any other
 * role comes from the roster. A privileged roster role without a matching
 * access/roles entry is downgraded to worker.
 * @param {string|undefined} rosterRole The roster's systemRole.
 * @param {string} email The person's sign-in address.
 * @param {AccessRoles} access The access/roles document.
 * @return {string} The effective role.
 */
export function effectiveRole(
  rosterRole: string | undefined, email: string, access: AccessRoles,
): string {
  const e = normEmail(email);
  if (e && access.admins.map(normEmail).includes(e)) return "admin";
  if (e && access.managers.map(normEmail).includes(e)) return "manager";
  const r = rosterRole || "worker";
  return PRIVILEGED.has(r) ? "worker" : r;
}

export interface RoleChangeInput {
  access: AccessRoles;
  employees: RosterEmployee[];
  employeeId: string;
  newRole: string;
  callerEmail: string;
}

export type RoleChangePlan =
  | {ok: false; code: "invalid-argument" | "not-found" |
      "failed-precondition" | "permission-denied"; message: string}
  | {
      ok: true;
      noop: boolean;
      from: string;
      to: Role;
      targetEmail: string;
      targetName: string;
      nextAccess: AccessRoles;
      nextEmployees: RosterEmployee[];
      nextAdminEmails: string[];
    };

/**
 * Plan a role change. Pure: the caller writes the result in one transaction.
 * @param {RoleChangeInput} input Current state and the requested change.
 * @return {RoleChangePlan} What to write, or why not.
 */
export function planRoleChange(input: RoleChangeInput): RoleChangePlan {
  const {access, employees, employeeId, newRole} = input;
  const caller = normEmail(input.callerEmail);
  const admins = sortedUnique(access.admins);
  const managers = sortedUnique(access.managers);

  if (!(caller === SUPER_ADMIN_EMAIL || admins.includes(caller))) {
    return {ok: false, code: "permission-denied",
      message: "Only an admin can change roles."};
  }
  if (!(ROLES as readonly string[]).includes(newRole)) {
    return {ok: false, code: "invalid-argument",
      message: `Unknown role: ${newRole}`};
  }
  const idx = employees.findIndex((e) => e && e.id === employeeId);
  if (idx < 0) {
    return {ok: false, code: "not-found", message: "Employee not found."};
  }
  const target = employees[idx];
  const email = employeeEmail(target);
  const to = newRole as Role;
  if (PRIVILEGED.has(to) && !email) {
    return {ok: false, code: "failed-precondition",
      message: "Link a sign-in email to this employee before making them " +
        `${to === "admin" ? "an admin" : "a manager"}.`};
  }
  if (email === SUPER_ADMIN_EMAIL && to !== "admin") {
    return {ok: false, code: "failed-precondition",
      message: "The super admin is always an admin."};
  }

  const from = email ?
    effectiveRole(target.systemRole, email, {admins, managers}) :
    (target.systemRole || "worker");
  let nextAdmins = admins.filter((a) => a !== email);
  let nextManagers = managers.filter((m) => m !== email);
  if (to === "admin") nextAdmins = sortedUnique([...nextAdmins, email]);
  if (to === "manager") nextManagers = sortedUnique([...nextManagers, email]);
  if (nextAdmins.length === 0) {
    return {ok: false, code: "failed-precondition",
      message: "That would leave no admins."};
  }
  if (!nextAdmins.includes(SUPER_ADMIN_EMAIL) &&
      admins.includes(SUPER_ADMIN_EMAIL)) {
    return {ok: false, code: "failed-precondition",
      message: "The super admin is always an admin."};
  }

  const nextEmployees = employees.map((e, i) =>
    i === idx ? {...e, systemRole: to} : e);
  const noop = from === to && (target.systemRole || "worker") === to &&
    JSON.stringify(nextAdmins) === JSON.stringify(admins) &&
    JSON.stringify(nextManagers) === JSON.stringify(managers);
  return {
    ok: true, noop, from, to,
    targetEmail: email,
    targetName: String(target.name || email || employeeId),
    nextAccess: {admins: nextAdmins, managers: nextManagers},
    nextEmployees,
    // The old mirror is kept equal to access/roles.admins during the
    // dual-read window, so a demoted admin can't stay in through it.
    nextAdminEmails: nextAdmins,
  };
}

export interface DriftReport {
  inSync: boolean;
  issues: string[];
}

/**
 * Compare access/roles with the old mirror and the roster's roles.
 * @param {object} state access/roles, appData.adminEmails, the roster.
 * @return {DriftReport} Every disagreement, plainly worded.
 */
export function driftReport(state: {
  access: AccessRoles | null;
  adminEmails: string[] | null;
  employees: RosterEmployee[];
}): DriftReport {
  const issues: string[] = [];
  if (!state.access) {
    return {inSync: false, issues: ["access/roles is missing."]};
  }
  const admins = sortedUnique(state.access.admins);
  const managers = sortedUnique(state.access.managers);
  if (admins.length === 0) issues.push("access/roles has no admins.");
  if (!admins.includes(SUPER_ADMIN_EMAIL)) {
    issues.push("The super admin is not in access/roles.admins.");
  }
  const legacy = state.adminEmails == null ? null :
    sortedUnique(state.adminEmails);
  if (legacy == null) {
    issues.push("appData.adminEmails is missing.");
  } else {
    for (const a of admins) {
      if (!legacy.includes(a)) {
        issues.push(`${a} is an admin in access/roles but not in ` +
          "appData.adminEmails.");
      }
    }
    for (const a of legacy) {
      if (!admins.includes(a)) {
        issues.push(`${a} is in appData.adminEmails but not an admin in ` +
          "access/roles.");
      }
    }
  }
  const rosterBy = new Map<string, RosterEmployee>();
  for (const e of state.employees) {
    const em = employeeEmail(e);
    if (em) rosterBy.set(em, e);
  }
  for (const e of state.employees) {
    const em = employeeEmail(e);
    const r = e.systemRole || "worker";
    const name = String(e.name || em || e.id);
    if (r === "admin" && !admins.includes(em)) {
      issues.push(`${name} is "admin" on the roster but not in access/roles.`);
    }
    if (r === "manager" && !managers.includes(em)) {
      issues.push(`${name} is "manager" on the roster but not in ` +
        "access/roles.");
    }
  }
  for (const a of admins) {
    const e = rosterBy.get(a);
    if (a === SUPER_ADMIN_EMAIL && !e) continue;
    if (!e) {
      issues.push(`${a} is an admin in access/roles but not on the roster.`);
    } else if ((e.systemRole || "worker") !== "admin") {
      issues.push(`${String(e.name || a)} is an admin in access/roles but ` +
        `"${e.systemRole || "worker"}" on the roster.`);
    }
  }
  for (const m of managers) {
    const e = rosterBy.get(m);
    if (!e) {
      issues.push(`${m} is a manager in access/roles but not on the ` +
        "roster.");
    } else if ((e.systemRole || "worker") !== "manager") {
      issues.push(`${String(e.name || m)} is a manager in access/roles but ` +
        `"${e.systemRole || "worker"}" on the roster.`);
    }
  }
  for (const a of admins) {
    if (managers.includes(a)) issues.push(`${a} is both admin and manager.`);
  }
  return {inSync: issues.length === 0, issues};
}

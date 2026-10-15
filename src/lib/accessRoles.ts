// WHO IS AN ADMIN OR MANAGER — client side (roles rollout step 3).
//
// access/roles (root collection, server-written only) is the source of truth.
// The roster's systemRole mirrors it for admin/manager; a roster saying
// "admin" or "manager" for someone not in access/roles is stale or forged and
// counts as a worker. Same rule as functions/src/accessRolesCore.ts.
//
// Role CHANGES go through the setUserRole function only. A roster save can't
// change anyone's role: preserveServerRoles() puts the server's role back on
// every existing employee before the save is planned.
import type { Employee, UserRole } from '../types';
import { computeRosterUpdate, stripUndefined } from './rosterWrite';

export interface AccessRoles { admins: string[]; managers: string[] }

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const PRIVILEGED = new Set<string>(['admin', 'manager']);

/**
 * The role that counts. While access/roles hasn't loaded yet (null) the
 * roster role is used — UI only; the database rules never trust it.
 */
export function effectiveRoleFromAccess(
  rosterRole: UserRole | undefined, email: string | null | undefined, access: AccessRoles | null,
): UserRole {
  const r = (rosterRole || 'worker') as UserRole;
  if (!access) return r;
  const e = norm(email);
  if (e && access.admins.map(norm).includes(e)) return 'admin';
  if (e && access.managers.map(norm).includes(e)) return 'manager';
  return PRIVILEGED.has(r) ? 'worker' : r;
}

/**
 * Roles are not changed by roster saves. Existing employees keep the role the
 * server has; a NEW employee may be created with any non-privileged role, but
 * not admin/manager (set those with the role dropdown once saved).
 */
export function preserveServerRoles(next: Employee[], server: Employee[]): Employee[] {
  const byId = new Map(server.map(e => [e.id, e]));
  return next.map(e => {
    const s = byId.get(e.id);
    if (s) {
      if ((e.systemRole || undefined) === (s.systemRole || undefined)) return e;
      // 18 of 38 live records have NO systemRole field. Copying that absence
      // as `systemRole: undefined` made Firestore reject the whole save
      // (2026-10-14) — drop the field instead, so the record matches the server.
      if (s.systemRole === undefined) {
        const { systemRole: _ignored, ...rest } = e;
        void _ignored;
        return rest as Employee;
      }
      return { ...e, systemRole: s.systemRole };
    }
    if (e.systemRole && PRIVILEGED.has(e.systemRole)) return { ...e, systemRole: 'worker' };
    return e;
  });
}

export function parseAccessRoles(data: unknown): AccessRoles | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { admins?: unknown; managers?: unknown };
  const list = (v: unknown) => (Array.isArray(v) ? v.map(norm).filter(Boolean) : []);
  return { admins: list(d.admins), managers: list(d.managers) };
}

/**
 * After setUserRole succeeds, the app's own copies (serverEmployeesRef and
 * appData.employees) take the new role at once — so an automatic save in the
 * ~second before the snapshot arrives can't write the old role back.
 */
export function applyRoleChange<T extends { id: string; systemRole?: UserRole }>(list: T[], employeeId: string, role: UserRole): T[] {
  return list.map(e => (e.id === employeeId && e.systemRole !== role ? { ...e, systemRole: role } : e));
}

/**
 * Everything saveEmployees does before it writes, as one pure step (so the
 * tests run the same code the app does): keep the server's roles, plan the
 * per-record update, and strip any undefined value — returning the paths
 * stripped so the caller can report them.
 */
export function planRosterSave(input: { next: Employee[]; baseline: Employee[]; server: Employee[] }) {
  const plan = computeRosterUpdate<Employee>({
    serverList: input.server,
    baseline: input.baseline,
    next: preserveServerRoles(input.next, input.server),
  });
  const { value: employees, paths: strippedPaths } = stripUndefined(plan.finalList);
  return { plan, employees, strippedPaths };
}

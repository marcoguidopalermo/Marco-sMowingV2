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

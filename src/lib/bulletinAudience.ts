// WHO A BULLETIN IS FOR.
//
// The board started with everyone-or-a-role-group. Named people are added here
// as a UNION rather than a mode: a bulletin can go to Lawn AND to Cody, and
// nothing has to decide which kind of bulletin it is.
//
// Union was the simpler of the two options offered and the more useful one. An
// either/or picker needs a mode, a rule for what happens to the other list when
// you switch, and a way to be in an invalid state; a union needs none of that —
// empty means everyone, and every non-empty combination means exactly what it
// looks like.
import { BulletinAudienceRole, BulletinPost, Employee, UserRole } from '../types';

/** True when the bulletin names nobody and no role — the historical default. */
export const isForEveryone = (b: Pick<BulletinPost, 'audience' | 'recipientIds'>): boolean =>
  (b.audience || []).length === 0 && (b.recipientIds || []).length === 0;

/**
 * Can this viewer see this bulletin?
 *
 * Admins are NOT given a blanket pass. A bulletin addressed to two people is
 * addressed to two people, and quietly showing it to every admin would make
 * "nobody else sees it at all" untrue. (Admins do still see *scheduled* ones
 * before they land — that is a different question, about editing something not
 * yet sent, and lives in lib/scheduledBulletins.)
 */
export function canSeeBulletin(
  b: Pick<BulletinPost, 'audience' | 'recipientIds' | 'isAdminOnly'>,
  viewer: { role: UserRole | null | undefined; employeeId: string | null | undefined },
  isAdmin: boolean,
): boolean {
  const roles = b.audience || [];
  const named = b.recipientIds || [];
  // Legacy posts: no targeting at all, so the admin-only flag is the only rule.
  if (roles.length === 0 && named.length === 0) return isAdmin ? true : !b.isAdminOnly;
  if (named.length > 0 && b.recipientIds && viewer.employeeId
    && named.includes(viewer.employeeId)) return true;
  return roles.includes(viewer.role as BulletinAudienceRole);
}

/**
 * "To: Cody, Diego" / "To: Managers · Workers" / "" for everyone.
 *
 * Shown on the bulletin itself because otherwise a targeted post is
 * indistinguishable from a general one — including to its author a week later,
 * who is exactly the person most likely to need to know who got told.
 *
 * Names resolve at READ time from the current roster, so a rename shows the
 * new name. An id with no employee record is reported as "1 former employee"
 * rather than dropped: somebody was told, and the record should say so.
 */
export function describeAudience(
  b: Pick<BulletinPost, 'audience' | 'recipientIds'>,
  employees: Employee[] | undefined,
): string {
  const parts: string[] = [];
  for (const r of b.audience || []) parts.push(ROLE_LABELS[r] || r);
  const named = b.recipientIds || [];
  if (named.length > 0) {
    const byId = new Map((employees || []).map(e => [e.id, e]));
    let missing = 0;
    for (const id of named) {
      const e = byId.get(id);
      if (e) parts.push(e.name);
      else missing += 1;
    }
    if (missing > 0) parts.push(`${missing} former employee${missing === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admins', manager: 'Managers', foreman: 'Foremen',
  mechanic: 'Mechanics', worker: 'Workers',
};

/**
 * The employees a bulletin's named list resolves to, for sending. Inactive and
 * test accounts are dropped — an address that cannot receive is not a recipient.
 */
export function namedRecipients(
  b: Pick<BulletinPost, 'recipientIds'>,
  employees: Employee[] | undefined,
): Employee[] {
  const named = new Set(b.recipientIds || []);
  if (named.size === 0) return [];
  return (employees || []).filter(e => named.has(e.id) && !e.isTestUser);
}

/** Employees offerable in the picker: active, real, and reachable by an address. */
export function pickableRecipients(employees: Employee[] | undefined): Employee[] {
  return (employees || [])
    .filter(e => !e.isTestUser)
    .filter(e => !/inactive|archive|terminat/i.test(String(e.status || '')))
    .filter(e => (e.linkedUserEmail || e.email || '').trim().length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// A LAST-RESORT NET UNDER EVERY WHOLE-DOCUMENT WRITE.
//
// syncToCloud writes the entire appData document from in-memory state, and
// there are ~96 call sites, ~80 of which spread `...appData`. Any one of them
// holding stale or default state writes that over production. That family has
// now caused four incidents in a week, ending on 2026-08-18 when a client
// replaced 477 KB — 38 employees, 16 days of performance, a 36-address access
// list — with the demo seed and a one-entry allowlist, locking 35 people out.
//
// Moving fields to targeted writes one at a time is the real fix, but it takes
// weeks. This is the interim: one check, in front of every call site at once,
// that refuses writes with the SHAPE of a catastrophe. It cannot tell a good
// write from a subtly wrong one — it is not trying to. It is trying to stop the
// document being replaced wholesale, which is the failure that actually happens.
//
// Biased toward allowing: a refused legitimate write costs one retry and a
// toast; an allowed catastrophic one costs the company its data.
import type { AppData, Employee } from '../types';

// Below this the document is too small for a shrink ratio to mean anything —
// a genuinely small database must not be frozen by its own emptiness.
const MIN_MEANINGFUL_BYTES = 50_000;
// Refuse a write that discards more than this share of the document. Set well
// clear of the largest legitimate shrink: pushing a whole month of performance
// removes roughly half the document, so 80% leaves ample headroom.
const MAX_SHRINK = 0.8;

export interface DocWriteServerState {
  bytes: number;
  employeeCount: number;
  allowlistCount: number;
}
export interface DocWritePayload {
  bytes: number;
  employees: Pick<Employee, 'id'>[];
  allowlist: string[];
}
export type DocWriteRefusal =
  | 'catastrophic-shrink'
  | 'seed-employees'
  | 'allowlist-emptied'
  | 'allowlist-collapsed-to-super-admin';

export interface DocWriteVerdict {
  ok: boolean;
  reason?: DocWriteRefusal;
  detail?: string;
}

// The demo roster the app seeds a NEW database with. Its presence in a payload
// aimed at a populated database means in-memory defaults are being written.
export const SEED_EMPLOYEE_IDS = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'];

export function checkDocWrite(
  payload: DocWritePayload,
  server: DocWriteServerState | null,
  superAdminEmail: string,
): DocWriteVerdict {
  // Nothing to compare against yet (first write of a session, or the server
  // state was never observed). Allow — refusing here would block a genuine
  // first install, and the seed guard already covers that path.
  if (!server) return { ok: true };

  if (server.bytes >= MIN_MEANINGFUL_BYTES
      && payload.bytes < server.bytes * (1 - MAX_SHRINK)) {
    return {
      ok: false,
      reason: 'catastrophic-shrink',
      detail: `payload ${Math.round(payload.bytes / 1024)} KB vs server `
        + `${Math.round(server.bytes / 1024)} KB — discards `
        + `${Math.round((1 - payload.bytes / server.bytes) * 100)}%`,
    };
  }

  // The seed roster reaching a database that already has more people than the
  // seed contains. Checked by ID, not count: a real company could legitimately
  // have six employees, but not six employees called e1..e6.
  const ids = new Set(payload.employees.map(e => e?.id).filter(Boolean));
  const seedPresent = SEED_EMPLOYEE_IDS.every(id => ids.has(id));
  if (seedPresent && server.employeeCount > SEED_EMPLOYEE_IDS.length) {
    return {
      ok: false,
      reason: 'seed-employees',
      detail: `payload carries the demo roster (${SEED_EMPLOYEE_IDS.join(', ')}) `
        + `while the server holds ${server.employeeCount} employees`,
    };
  }

  const allow = payload.allowlist.map(e => (e || '').trim().toLowerCase()).filter(Boolean);
  if (allow.length === 0 && server.allowlistCount > 0) {
    return {
      ok: false,
      reason: 'allowlist-emptied',
      detail: `payload would clear an access list of ${server.allowlistCount}`,
    };
  }
  // The 2026-08-18 shape: 36 addresses down to the single seeded super admin.
  // Not caught by the empty check, and the one that locked everyone out.
  const superAdmin = (superAdminEmail || '').trim().toLowerCase();
  if (server.allowlistCount > 1 && allow.length <= 1
      && (allow.length === 0 || allow[0] === superAdmin)) {
    return {
      ok: false,
      reason: 'allowlist-collapsed-to-super-admin',
      detail: `payload would cut the access list from ${server.allowlistCount} `
        + 'to the seeded super admin alone',
    };
  }

  return { ok: true };
}

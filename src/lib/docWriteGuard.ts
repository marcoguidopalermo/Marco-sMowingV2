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
// Biased toward allowing a write that looks like an ordinary save: a refused
// legitimate write costs one retry and a toast; an allowed catastrophic one
// costs the company its data.
//
// 2026-10-01: a crew member's phone opened the app without ever receiving the
// document, ran on the built-in demo data, and an automatic "mark bulletin
// read" save replaced the production document with it — 38 employees to 7, a
// 36-address access list to ZERO. This guard let it through because it
// treated "no server copy observed yet" as a reason to ALLOW. It is now a
// reason to REFUSE, and the checks that need no comparison to be wrong (an
// empty access list, an empty admin list, the demo roster, a document of a
// few KB) run whether or not a server copy has been seen.
import type { AppData, Employee } from '../types';

// Below this the document is too small for a shrink ratio to mean anything —
// a genuinely small database must not be frozen by its own emptiness.
const MIN_MEANINGFUL_BYTES = 50_000;
// The production document is hundreds of KB. A whole-document write this
// small is the demo seed or an empty shell, whatever the server holds.
export const ABSOLUTE_MIN_BYTES = 20_000;
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
  adminEmails: string[];
}
export type DocWriteRefusal =
  | 'no-server-snapshot'
  | 'document-too-small'
  | 'admin-list-emptied'
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
  // ── ABSOLUTE — wrong whatever the server holds, so no comparison needed.
  const allow = payload.allowlist.map(e => (e || '').trim().toLowerCase()).filter(Boolean);
  if (allow.length === 0) {
    return { ok: false, reason: 'allowlist-emptied', detail: 'payload has an empty access list — it would lock everyone out' };
  }
  const admins = (payload.adminEmails || []).map(e => (e || '').trim()).filter(Boolean);
  if (admins.length === 0) {
    return { ok: false, reason: 'admin-list-emptied', detail: 'payload has an empty admin list' };
  }
  // The demo roster, checked by ID: a real company could have six employees,
  // but not six employees called e1..e6.
  const ids = new Set(payload.employees.map(e => e?.id).filter(Boolean));
  if (SEED_EMPLOYEE_IDS.every(id => ids.has(id))) {
    return {
      ok: false,
      reason: 'seed-employees',
      detail: `payload carries the demo roster (${SEED_EMPLOYEE_IDS.join(', ')})`,
    };
  }
  if (payload.bytes < ABSOLUTE_MIN_BYTES) {
    return {
      ok: false,
      reason: 'document-too-small',
      detail: `payload is ${Math.round(payload.bytes / 1024)} KB — a whole-document write that small is a shell, not the database`,
    };
  }

  // ── NO SERVER COPY — refuse. A session that has never received the
  // document has nothing real to save; whatever it holds is defaults.
  if (!server) {
    return {
      ok: false,
      reason: 'no-server-snapshot',
      detail: 'this session has not received the document from the server yet',
    };
  }

  // ── RELATIVE — against what the server last reported.
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
  // The 2026-08-18 shape: 36 addresses down to the single seeded super admin.
  const superAdmin = (superAdminEmail || '').trim().toLowerCase();
  if (server.allowlistCount > 1 && allow.length <= 1 && allow[0] === superAdmin) {
    return {
      ok: false,
      reason: 'allowlist-collapsed-to-super-admin',
      detail: `payload would cut the access list from ${server.allowlistCount} `
        + 'to the seeded super admin alone',
    };
  }

  return { ok: true };
}

// MAY THIS CLIENT SEED A FRESH DATABASE?
//
// Extracted from App.tsx's "no remote data found" branch so the decision that
// destroyed production can be tested. On 2026-08-18 that branch wrote the
// app's in-memory demo defaults over a live appData/main: 477 KB, 38
// employees, 16 days of performance, 17 days of schedule and a 36-address
// access list replaced by seed data and a one-entry allowlist, locking 35
// people out. Recovered from point-in-time recovery.
//
// Seeding is a FIRST-INSTALL action, so it is gated on every condition that
// distinguishes a new database from a transient read of an existing one. Any
// single one of these would have prevented the incident.
export interface SeedGuardInput {
  /** snapshot.metadata.fromCache */
  fromCache: boolean;
  /** snapshot.metadata.hasPendingWrites */
  hasPendingWrites: boolean;
  /** Has this session ever received the document? */
  docEverExisted: boolean;
  /** Size of the newest access list this session has seen from the server. */
  knownAllowlistSize: number;
  isSuperAdmin: boolean;
}

export type SeedRefusal =
  | 'unsettled-snapshot'
  | 'document-has-existed'
  | 'allowlist-known'
  | 'not-super-admin';

// null = may seed. Otherwise the reason it was refused.
export function seedRefusalReason(i: SeedGuardInput): SeedRefusal | null {
  // A cached or pending-write snapshot is not evidence the document is absent.
  if (i.fromCache || i.hasPendingWrites) return 'unsettled-snapshot';
  // A database does not un-install itself.
  if (i.docEverExisted) return 'document-has-existed';
  // We have seen real access data here; the seed must never replace it.
  if (i.knownAllowlistSize > 0) return 'allowlist-known';
  // Bootstrapping a new database is an owner action.
  if (!i.isSuperAdmin) return 'not-super-admin';
  return null;
}

export const maySeedDatabase = (i: SeedGuardInput): boolean =>
  seedRefusalReason(i) === null;

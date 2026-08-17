// THE CLIENT-SIDE AUTH GATE DECISION — extracted as a pure function so the
// thing that can lock somebody out of the app is testable.
//
// This is a convenience / early-rejection layer. The REAL security boundary is
// server-side Firestore rules; a client that skipped this check still cannot
// read anything. So the gate is deliberately biased toward NOT rejecting: a
// wrong "pass" here costs nothing (the server refuses), while a wrong "reject"
// locks out a legitimate employee at 6am and tells them they aren't authorized.
//
// The failure this shape exists to prevent, seen in production: a rejection
// produced by evidence that did not support it, on a snapshot that had not been
// confirmed by the server, which then "resolved on its own" and left nothing
// behind to diagnose.

export type AuthGateDecision =
  // Definitely allowed — on the list, or the super admin.
  | 'pass'
  // Server-confirmed list, definitively not on it. The only rejecting outcome.
  | 'reject'
  // Not enough evidence to decide: no list yet, or an unsettled snapshot.
  // Caller must keep waiting and show a loading state. NEVER reject on this.
  | 'hold'
  // Not on the list, but this session already passed the gate once. Kept in to
  // avoid ejecting a live session on a transient or stale snapshot; real
  // revocation still takes effect server-side on the next read.
  | 'lenient-pass';

export interface AuthGateInput {
  /** Email on the signed-in credential. May be empty/undefined. */
  email: string | null | undefined;
  /** authorizedEmails exactly as it arrived on the snapshot — any shape. */
  authorizedEmails: unknown;
  /** snapshot.metadata.fromCache */
  fromCache: boolean;
  /** snapshot.metadata.hasPendingWrites */
  hasPendingWrites: boolean;
  /** Has this session already passed the gate once? */
  sessionAlreadyAuthorized: boolean;
  superAdminEmail: string;
}

export interface AuthGateFacts {
  decision: AuthGateDecision;
  emailCompared: string;
  isSuperAdmin: boolean;
  listFieldPresent: boolean;
  listLength: number;
  listKnown: boolean;
  listFingerprint: string;
  emailOnList: boolean;
  fromCache: boolean;
  hasPendingWrites: boolean;
  settled: boolean;
  sessionAlreadyAuthorized: boolean;
}

export const normalizeGateEmail = (v: unknown): string =>
  (typeof v === 'string' ? v.trim().toLowerCase() : '');

// A short, stable fingerprint of the list. Length alone is not enough: a stale
// full-document write can swap one address for another and keep the count
// identical, and that is precisely the case worth spotting across two clients.
// Not a security hash — just an identity marker safe to put in a log, so 36
// real addresses don't get printed into a console.
export function listFingerprint(allowed: string[]): string {
  if (allowed.length === 0) return 'empty';
  const h = allowed.join(',').split('')
    .reduce((acc, ch) => ((acc << 5) - acc + ch.charCodeAt(0)) | 0, 0);
  return `${allowed.length}:${h.toString(36).slice(-6)}`;
}

export function decideAuthGate(input: AuthGateInput): AuthGateFacts {
  const emailCompared = normalizeGateEmail(input.email);
  const isSuperAdmin = !!emailCompared
    && emailCompared === normalizeGateEmail(input.superAdminEmail);

  const listFieldPresent = Array.isArray(input.authorizedEmails);
  const allowed = (listFieldPresent ? input.authorizedEmails as unknown[] : [])
    .map(normalizeGateEmail)
    .filter(Boolean);
  // An EMPTY list is indeterminate, never "deny everyone". A missing or
  // mid-write field must not be read as a statement that nobody has access.
  const listKnown = allowed.length > 0;
  const emailOnList = !!emailCompared && allowed.includes(emailCompared);

  // A snapshot from the local cache, or one still carrying this client's own
  // unacknowledged writes, is not evidence about the SERVER's list.
  const settled = !input.fromCache && !input.hasPendingWrites;

  let decision: AuthGateDecision;
  if (isSuperAdmin || emailOnList) {
    decision = 'pass';
  } else if (input.sessionAlreadyAuthorized) {
    decision = 'lenient-pass';
  } else if (!emailCompared) {
    // NO EMAIL ON THE CREDENTIAL — hold, never reject. Without an address
    // there is nothing to check against the list, so a rejection here would
    // assert something the gate cannot know, and would tell the user their
    // email "isn't on the list" while naming no email. A Google credential
    // can arrive without one; the server rules are the real gate either way.
    decision = 'hold';
  } else if (!settled || !listKnown) {
    decision = 'hold';
  } else {
    decision = 'reject';
  }

  return {
    decision,
    emailCompared: emailCompared || '(none on credential)',
    isSuperAdmin,
    listFieldPresent,
    listLength: allowed.length,
    listKnown,
    listFingerprint: listFingerprint(allowed),
    emailOnList,
    fromCache: input.fromCache,
    hasPendingWrites: input.hasPendingWrites,
    settled,
    sessionAlreadyAuthorized: input.sessionAlreadyAuthorized,
  };
}

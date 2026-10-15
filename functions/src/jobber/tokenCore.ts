// JOBBER ACCESS TOKEN — the one place a refresh happens (incident
// 2026-10-14: a rejected refresh token stopped every Jobber sync for 3h).
//
// Jobber rotates refresh tokens: each refresh returns a NEW refresh token and
// the old one is dead. Two functions refreshing at once means the second
// sends a spent token and Jobber disconnects us. So:
//   - every caller gets its token here (no function refreshes on its own);
//   - a refresh happens only under a lease (one holder at a time); everyone
//     else waits and re-reads the token the holder saved;
//   - a 401 passes the token that failed (`rejectedToken`), so a caller whose
//     token was already replaced just picks up the new one — no refresh.
//
// Pure: Firestore, fetch, time and logging are injected (TokenDeps), so the
// concurrency rules are tested without either service (tokenCore.test.ts).

export const REFRESH_BUFFER_MS = 5 * 60 * 1000;
export const LEASE_MS = 30 * 1000;
export const POLL_MS = 1000;
/** Give up waiting on somebody else's refresh after this long. */
export const WAIT_LIMIT_MS = 75 * 1000;

export const DISCONNECTED_LOG =
  "Jobber disconnected - an admin must reconnect in CrewMaster";

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number | null;
}

export type RefreshResult =
  | {ok: true; accessToken: string; refreshToken: string; expiresInSec?: number}
  | {ok: false; rejected: boolean; status: number; message: string};

export interface TokenDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Current tokens, or null when Jobber has never been connected. */
  readTokens(): Promise<StoredTokens | null>;
  /** Take the lease if it's free or expired. True when we hold it. */
  tryAcquireLease(holder: string, leaseUntil: number): Promise<boolean>;
  /** Release the lease only if we still hold it. */
  releaseLease(holder: string): Promise<void>;
  /** POST grant_type=refresh_token. `rejected` = Jobber refused the token. */
  postRefresh(refreshToken: string): Promise<RefreshResult>;
  /** Targeted write of the new token pair. */
  saveTokens(t: StoredTokens, refreshedAt: number): Promise<void>;
  /** Record that the connection is gone (status for the app; no tokens). */
  markDisconnected(reason: string): Promise<void>;
  log: {
    info(msg: string, meta?: object): void;
    warn(msg: string, meta?: object): void;
    error(msg: string, meta?: object): void;
  };
}

/** Jobber has never been connected (no tokens stored). */
export class JobberNotConnectedError extends Error {}
/** Jobber refused our refresh token: an admin must reconnect. */
export class JobberDisconnectedError extends Error {}

const isFresh = (t: StoredTokens, now: number): boolean =>
  typeof t.accessTokenExpiresAt === "number" &&
  t.accessTokenExpiresAt > now + REFRESH_BUFFER_MS;

/**
 * A usable access token.
 * @param {TokenDeps} deps Storage, HTTP, clock and log.
 * @param {object} opts holder: unique per call; rejectedToken: the token a
 *   401 just refused, if any.
 * @return {Promise<string>} The access token.
 */
export async function getAccessToken(
  deps: TokenDeps,
  opts: {holder: string; rejectedToken?: string; service?: string},
): Promise<string> {
  const started = deps.now();
  for (;;) {
    const t = await deps.readTokens();
    if (!t) throw new JobberNotConnectedError("Jobber is not connected.");
    const now = deps.now();
    // A token other than the one that just failed, and not expired: use it.
    if (opts.rejectedToken !== undefined) {
      if (t.accessToken !== opts.rejectedToken &&
          (t.accessTokenExpiresAt ?? 0) > now) {
        return t.accessToken;
      }
    } else if (isFresh(t, now)) {
      return t.accessToken;
    }

    if (!(await deps.tryAcquireLease(opts.holder, now + LEASE_MS))) {
      // Someone else is refreshing. Wait for the token they save.
      if (deps.now() - started > WAIT_LIMIT_MS) {
        throw new Error("Timed out waiting for another Jobber token refresh.");
      }
      await deps.sleep(POLL_MS);
      continue;
    }

    try {
      // Double-check under the lease: the previous holder may have just
      // refreshed between our read and our acquire.
      const cur = await deps.readTokens();
      if (!cur) throw new JobberNotConnectedError("Jobber is not connected.");
      const n2 = deps.now();
      if (opts.rejectedToken !== undefined ?
        cur.accessToken !== opts.rejectedToken &&
          (cur.accessTokenExpiresAt ?? 0) > n2 :
        isFresh(cur, n2)) {
        return cur.accessToken;
      }

      const res = await deps.postRefresh(cur.refreshToken);
      if (res.ok) {
        const refreshedAt = deps.now();
        const next: StoredTokens = {
          accessToken: res.accessToken,
          refreshToken: res.refreshToken,
          accessTokenExpiresAt:
            refreshedAt + (res.expiresInSec && res.expiresInSec > 0 ?
              res.expiresInSec : 3600) * 1000,
        };
        // Losing a rotated refresh token is itself a disconnect: retry.
        let lastErr: unknown;
        for (let i = 0; i < 3; i++) {
          try {
            await deps.saveTokens(next, refreshedAt);
            deps.log.info("Jobber token refreshed", {service: opts.service});
            return next.accessToken;
          } catch (e) {
            lastErr = e;
            await deps.sleep(500 * (i + 1));
          }
        }
        deps.log.error("Jobber token refreshed but NOT saved", {
          service: opts.service,
          error: lastErr instanceof Error ? lastErr.message : String(lastErr),
        });
        throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
      }

      if (!res.rejected) {
        // Network / 5xx: transient. Don't call it a disconnect.
        throw new Error(`Jobber token refresh failed (${res.status}): ` +
          res.message);
      }
      // Refused. If an admin reconnected while we were working, the stored
      // refresh token has changed — use the new connection.
      const after = await deps.readTokens();
      if (after && after.refreshToken !== cur.refreshToken) {
        return after.accessToken;
      }
      deps.log.error(DISCONNECTED_LOG, {
        event: "jobber_refresh_rejected",
        service: opts.service,
        status: res.status,
      });
      await deps.markDisconnected(res.message).catch(() => undefined);
      throw new JobberDisconnectedError(
        "Jobber disconnected — an admin must reconnect in CrewMaster.");
    } finally {
      await deps.releaseLease(opts.holder).catch(() => undefined);
    }
  }
}

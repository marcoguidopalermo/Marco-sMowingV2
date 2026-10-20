// Firestore + Jobber wiring for tokenCore.getAccessToken — the only path to
// a Jobber access token. Rules: tokenCore.ts. Incident: docs/incidents/
// 2026-10-14-jobber-token.md.
//
// WHERE THE TOKENS LIVE (release 2, 2026-10-20):
//   jobberAuthSecrets/main   root, rules `if false` — the ONLY token store.
//   artifacts/.../jobberAuth/main   readable by every signed-in user, so it
//     holds NO tokens: only the connection status the app shows (connected
//     / disconnected, when, by whom). Release 1 dual-wrote tokens here for
//     rollback; release 2 stopped that and stripped them.
//   jobberTokenLock/main     root, rules `if false` — the refresh lease.
// Every write is targeted (update / set-merge of named fields), never a
// whole-document replace of the old doc.
import {HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {randomBytes} from "node:crypto";
import {
  getAccessToken, JobberDisconnectedError, JobberNotConnectedError,
  RefreshResult, StoredTokens, TokenDeps,
} from "./tokenCore.js";
import {
  JOBBER_AUTH_DOC, JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET,
} from "./oauth.js";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const JOBBER_SECRETS_DOC = "jobberAuthSecrets/main";
export const JOBBER_LOCK_DOC = "jobberTokenLock/main";
const JOBBER_TOKEN_URL = "https://api.getjobber.com/api/oauth/token";

const asTokens = (d: admin.firestore.DocumentData | undefined):
  StoredTokens | null => {
  if (!d || typeof d.accessToken !== "string" ||
      typeof d.refreshToken !== "string") return null;
  return {
    accessToken: d.accessToken,
    refreshToken: d.refreshToken,
    accessTokenExpiresAt: typeof d.accessTokenExpiresAt === "number" ?
      d.accessTokenExpiresAt : null,
  };
};

/**
 * The live Firestore/fetch implementation of TokenDeps.
 * @param {string} service The calling function (for logs).
 * @return {TokenDeps} Dependencies for getAccessToken.
 */
export function firestoreDeps(service: string): TokenDeps {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    readTokens: async () => {
      // Secrets doc only. Release 1 also read the old doc (newer pair wins)
      // for the deploy window; every running version now writes the secrets
      // doc, so it always holds the newest pair.
      const s = await db.doc(JOBBER_SECRETS_DOC).get();
      return asTokens(s.data());
    },
    tryAcquireLease: (holder, leaseUntil) =>
      db.runTransaction(async (tx) => {
        const ref = db.doc(JOBBER_LOCK_DOC);
        const cur = await tx.get(ref);
        const until = cur.exists ? Number(cur.get("leaseUntil")) || 0 : 0;
        if (cur.exists && until > Date.now() && cur.get("holder") !== holder) {
          return false;
        }
        tx.set(ref, {holder, service, acquiredAt: Date.now(), leaseUntil});
        return true;
      }),
    releaseLease: async (holder) => {
      await db.runTransaction(async (tx) => {
        const ref = db.doc(JOBBER_LOCK_DOC);
        const cur = await tx.get(ref);
        if (cur.exists && cur.get("holder") === holder) tx.delete(ref);
      });
    },
    postRefresh: async (refreshToken): Promise<RefreshResult> => {
      const body = new URLSearchParams();
      body.set("client_id", JOBBER_CLIENT_ID.value());
      body.set("client_secret", JOBBER_CLIENT_SECRET.value());
      body.set("grant_type", "refresh_token");
      body.set("refresh_token", refreshToken);
      let resp: Response;
      try {
        resp = await fetch(JOBBER_TOKEN_URL, {
          method: "POST",
          headers: {"Content-Type": "application/x-www-form-urlencoded"},
          body: body.toString(),
        });
      } catch (e) {
        return {ok: false, rejected: false, status: 0,
          message: e instanceof Error ? e.message : String(e)};
      }
      if (!resp.ok) {
        const text = (await resp.text().catch(() => "")).slice(0, 200);
        // 400/401 = the refresh token itself was refused (Jobber answers
        // 401 "The provided refresh token is not valid."). Anything else
        // is treated as transient.
        return {ok: false, rejected: resp.status === 400 || resp.status === 401,
          status: resp.status, message: text};
      }
      const j = await resp.json() as
        {access_token: string; refresh_token: string; expires_in?: number};
      return {ok: true, accessToken: j.access_token,
        refreshToken: j.refresh_token, expiresInSec: j.expires_in};
    },
    saveTokens: async (t, refreshedAt) => {
      const fields = {
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        accessTokenExpiresAt: t.accessTokenExpiresAt,
        lastRefreshedAt: refreshedAt,
        lastRefreshedBy: service,
      };
      await db.doc(JOBBER_SECRETS_DOC).set(fields, {merge: true});
    },
    markDisconnected: async (reason) => {
      // Status only, on the doc the app reads. Merge, so it never fails on
      // a missing doc and never touches other fields.
      await db.doc(JOBBER_AUTH_DOC).set({
        status: "disconnected",
        disconnectedAt: Date.now(),
        disconnectedReason: reason.slice(0, 200),
      }, {merge: true});
    },
    log: {
      info: (m, meta) => logger.info(m, meta),
      warn: (m, meta) => logger.warn(m, meta),
      error: (m, meta) => logger.error(m, meta),
    },
  };
}

/**
 * The only way to get a Jobber access token. Refreshes under a lease when
 * needed. Pass the token a 401 just refused as `rejectedToken`.
 * @param {object} opts service: caller name for logs; rejectedToken.
 * @return {Promise<string>} A usable access token.
 */
export async function getJobberAccessToken(
  opts: {service?: string; rejectedToken?: string} = {},
): Promise<string> {
  const service = opts.service || process.env.K_SERVICE || "unknown";
  try {
    return await getAccessToken(firestoreDeps(service), {
      holder: `${service}-${randomBytes(6).toString("hex")}`,
      rejectedToken: opts.rejectedToken,
      service,
    });
  } catch (e) {
    if (e instanceof JobberNotConnectedError) {
      throw new HttpsError("failed-precondition",
        "Jobber is not connected. Connect from App Settings first.");
    }
    if (e instanceof JobberDisconnectedError) {
      throw new HttpsError("failed-precondition",
        "Jobber disconnected — an admin must reconnect in CrewMaster.");
    }
    throw e;
  }
}

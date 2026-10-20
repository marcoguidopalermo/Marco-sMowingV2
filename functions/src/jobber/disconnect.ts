// Disconnect Jobber (Manage Resources). Admins only (access/roles), or the
// super admin. Server-side so the token documents stay unwritable from the app.
//
// TELLS JOBBER FIRST. Deleting only our stored tokens leaves the app's
// approval in place on Jobber's side, and the next Connect re-issues the
// SAME grant — so a scope change in the Developer Center never reaches the
// token (2026-10-20: reconnected, still the old five scopes). Jobber's
// `appDisconnect` mutation removes the approval; the next Connect is then a
// fresh authorization with the app's current scopes.
//
// Order and failure handling:
//   1. appDisconnect with the current token (refreshed under the lease if it
//      is about to expire — the normal token path).
//   2. Only if Jobber accepted it — or the connection is already dead on
//      Jobber's side, so there is nothing to tell — clear our stored tokens.
//   3. Anything else (network, Jobber 5xx, throttling): change NOTHING and
//      ask the admin to try again, so we never strand Jobber's approval.
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {
  JOBBER_AUTH_DOC, JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET,
} from "./oauth.js";
import {
  getJobberAccessToken, JOBBER_LOCK_DOC, JOBBER_SECRETS_DOC,
} from "./token.js";
import {makeJobberClient} from "./client.js";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const APP_DISCONNECT = `mutation AppDisconnect {
  appDisconnect { app { name } userErrors { message } }
}`;

/**
 * Jobber has already dropped us: not connected, or the token was refused.
 * @param {unknown} e The error thrown while reaching Jobber.
 * @return {boolean} True when there is nothing left to tell Jobber.
 */
const alreadyGone = (e: unknown): boolean =>
  e instanceof HttpsError && e.code === "failed-precondition";

export const jobberDisconnect = onCall(
  {region: "us-central1", secrets: [JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET]},
  async (request) => {
    const email = (request.auth?.token?.email || "").trim().toLowerCase();
    if (!email) throw new HttpsError("unauthenticated", "Sign in required.");
    const roles = await db.doc("access/roles").get();
    const admins = ((roles.get("admins") as string[]) || [])
      .map((a) => a.trim().toLowerCase());
    if (email !== "marcoguidopalermo@gmail.com" && !admins.includes(email)) {
      throw new HttpsError("permission-denied", "Admins only.");
    }

    // 1. Tell Jobber.
    let jobber: "disconnected" | "already_disconnected";
    try {
      const token = await getJobberAccessToken({service: "jobberDisconnect"});
      const data = await makeJobberClient(token).fetch(APP_DISCONNECT, {}) as
        {appDisconnect?: {userErrors?: {message: string}[]}};
      const errs = data?.appDisconnect?.userErrors || [];
      if (errs.length) {
        const msg = errs.map((x) => x.message).join("; ");
        throw new Error(`appDisconnect: ${msg}`);
      }
      jobber = "disconnected";
    } catch (e) {
      if (alreadyGone(e)) {
        jobber = "already_disconnected";
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error("Jobber appDisconnect failed — nothing changed",
          {by: email, error: msg});
        throw new HttpsError("unavailable",
          "Couldn't reach Jobber to disconnect — nothing was changed. " +
          "Try again in a minute.");
      }
    }

    // 2. Clear our side.
    const batch = db.batch();
    batch.delete(db.doc(JOBBER_SECRETS_DOC));
    batch.delete(db.doc(JOBBER_AUTH_DOC));
    batch.delete(db.doc(JOBBER_LOCK_DOC));
    await batch.commit();
    logger.info("Jobber disconnected by an admin", {by: email, jobber});
    return {ok: true, jobber};
  },
);

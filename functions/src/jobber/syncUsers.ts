import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {
  JOBBER_AUTH_DOC,
  JOBBER_CLIENT_ID,
  JOBBER_CLIENT_SECRET,
  refreshJobberAccessToken,
} from "./oauth.js";
import {makeJobberClient} from "./client.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const REGION = "us-central1";
const APP_ID = "crewmaster";
const JOBBER_USERS_DOC =
  `artifacts/${APP_ID}/private/data/jobberUsers/main`;
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

// Preferred query — includes isArchived so we can filter inactive Jobber
// users out of the frontend dropdown. isArchived is an educated guess based
// on Jobber's schema patterns (Client uses it); if this tenant's schema
// version doesn't expose it on User, the GraphQL error is caught below
// and we fall back to USERS_QUERY_LEGACY.
const USERS_QUERY = `query {
  users(first: 100) {
    nodes {
      id
      name { full }
      isAccountOwner
      isArchived
    }
  }
}`;

const USERS_QUERY_LEGACY = `query {
  users(first: 100) {
    nodes {
      id
      name { full }
      isAccountOwner
    }
  }
}`;

interface JobberAuthDoc {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number | null;
}

interface JobberUserNode {
  id: string;
  name: {full: string};
  isAccountOwner: boolean;
  isArchived?: boolean;
}

interface StoredJobberUser {
  id: string;
  name: string;
  isAccountOwner: boolean;
  isArchived?: boolean;
}

export const jobberSyncUsers = onCall(
  {
    region: REGION,
    secrets: [JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    // TODO: server-side admin/super-admin verification — currently trusts
    // the client-side canManageJobberIntegration gate.

    const authSnap = await db.doc(JOBBER_AUTH_DOC).get();
    if (!authSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "Jobber is not connected. Connect from App Settings first.",
      );
    }
    const auth = authSnap.data() as JobberAuthDoc;

    let accessToken = auth.accessToken;
    const expiresAt = auth.accessTokenExpiresAt;
    // Refresh whenever expiry is unknown (null/missing) or within buffer.
    // Older auth docs stored before the expires_in default fix can have null.
    const needsRefresh =
      typeof expiresAt !== "number" ||
      expiresAt < Date.now() + TOKEN_REFRESH_BUFFER_MS;
    if (needsRefresh) {
      try {
        const refreshed = await refreshJobberAccessToken();
        if (!refreshed) {
          throw new HttpsError(
            "failed-precondition",
            "Could not refresh Jobber token — reconnect from App Settings.",
          );
        }
        accessToken = refreshed.access_token;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error("Jobber token refresh failed", {error: msg});
        throw new HttpsError(
          "internal",
          `Token refresh failed: ${msg}`,
        );
      }
    }

    const client = makeJobberClient(accessToken);
    let data: {users?: {nodes?: JobberUserNode[]}};
    try {
      data = (await client.fetch(USERS_QUERY, {})) as {
        users?: {nodes?: JobberUserNode[]};
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Schema-error fallback: if Jobber rejects isArchived (field not
      // present on this tenant's User type), retry without it so the sync
      // still succeeds with the legacy shape.
      if (/isArchived/i.test(msg)) {
        logger.warn(
          "Jobber USERS_QUERY rejected isArchived — " +
            "falling back to legacy query without it",
          {error: msg},
        );
        try {
          data = (await client.fetch(USERS_QUERY_LEGACY, {})) as {
            users?: {nodes?: JobberUserNode[]};
          };
        } catch (e2) {
          const msg2 = e2 instanceof Error ? e2.message : String(e2);
          logger.error("Jobber users legacy sync failed", {error: msg2});
          throw new HttpsError("internal", msg2);
        }
      } else {
        logger.error("Jobber users sync failed", {error: msg});
        throw new HttpsError("internal", msg);
      }
    }

    const nodes = data.users?.nodes ?? [];
    const users: StoredJobberUser[] = nodes.map((u) => {
      const base: StoredJobberUser = {
        id: u.id,
        name: u.name?.full ?? "",
        isAccountOwner: Boolean(u.isAccountOwner),
      };
      if (typeof u.isArchived === "boolean") {
        base.isArchived = u.isArchived;
      }
      return base;
    });

    const lastSyncedAt = Date.now();
    await db.doc(JOBBER_USERS_DOC).set({
      users,
      lastSyncedAt,
    });

    logger.info("Jobber users synced", {
      count: users.length,
      userId: request.auth.uid,
    });
    return {count: users.length, lastSyncedAt};
  },
);

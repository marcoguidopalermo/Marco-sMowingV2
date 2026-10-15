import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {
  JOBBER_CLIENT_ID,
  JOBBER_CLIENT_SECRET,
} from "./oauth.js";
import {getJobberAccessToken} from "./token.js";
import {makeJobberClient} from "./client.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const REGION = "us-central1";
const APP_ID = "crewmaster";
const JOBBER_USERS_DOC =
  `artifacts/${APP_ID}/private/data/jobberUsers/main`;

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

    // One shared path for tokens (lease-guarded refresh; incident 2026-10-14).
    const accessToken =
      await getJobberAccessToken({service: "jobberSyncUsers"});

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

import {onCall, HttpsError} from "firebase-functions/v2/https";
import {beforeUserCreated} from "firebase-functions/v2/identity";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const REGION = "us-central1";
const APP_ID = "crewmaster";
const APP_DATA_DOC = `artifacts/${APP_ID}/public/data/appData/main`;
const SUPER_ADMIN_EMAIL = "marcoguidopalermo@gmail.com";

const normalizeEmail = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
};

// Callable gate for the email/password sign-up flow.
// Signed-out clients cannot read the authorizedEmails allowlist because the
// Firestore rules block their reads, so this runs the check server-side.
// It returns ONLY a boolean for the single email asked — the allowlist
// itself and every other email on it are never returned to the caller.
// Deliberately NO minInstances. This fires a handful of times a year, when
// someone signs up. A cold start here costs one person a few seconds; paying
// ~$8/month to keep an instance warm for that is not worth it.
/**
 * True when the address is on the allowlist (or is the super admin).
 * @param {string} email A normalized email address.
 * @return {Promise<boolean>} Whether it may have an account.
 */
async function isOnAllowlist(email: string): Promise<boolean> {
  if (email === SUPER_ADMIN_EMAIL) return true;
  const snap = await db.doc(APP_DATA_DOC).get();
  const raw: unknown = snap.get("authorizedEmails");
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  return list.map((entry) => normalizeEmail(entry)).includes(email);
}

export const checkEmailAuthorized = onCall(
  {region: REGION},
  async (request): Promise<{authorized: boolean}> => {
    const email = normalizeEmail(request.data?.email);
    if (!email) {
      throw new HttpsError(
        "invalid-argument",
        "An email address is required.",
      );
    }

    // Super admin is always authorized, even if absent from the list.
    const authorized = await isOnAllowlist(email);
    logger.info("checkEmailAuthorized", {authorized});
    return {authorized};
  },
);

// SIGN-UP BLOCKING FUNCTION (Identity Platform). Runs before Firebase creates
// ANY new account — Google or email/password, from the app or straight
// against the Auth API with the public key — and refuses it unless the
// address is on the allowlist. checkEmailAuthorized above only guards the
// app's own email form; anyone could skip it.
//
// Only account CREATION is gated. Existing accounts sign in without this
// function running, so a failure here can't lock anyone out of an account
// they already have — at worst a new hire can't register until it's fixed
// (detach it in Authentication -> Settings -> Blocking functions).
//
// Fails closed: no email (anonymous, phone) or an allowlist read error means
// no account.
export const blockUnlistedSignUp = beforeUserCreated(
  {region: REGION},
  async (event) => {
    const email = normalizeEmail(event.data?.email);
    if (!email) {
      logger.warn("Sign-up refused: no email", {
        provider: event.additionalUserInfo?.providerId ?? null,
      });
      throw new HttpsError(
        "permission-denied",
        "CrewMaster accounts need an email address on the access list.",
      );
    }
    let allowed: boolean;
    try {
      allowed = await isOnAllowlist(email);
    } catch (e) {
      logger.error("Sign-up refused: allowlist unreadable", {
        error: e instanceof Error ? e.message : String(e),
      });
      throw new HttpsError(
        "unavailable",
        "Sign-up is temporarily unavailable. Try again shortly.",
      );
    }
    if (!allowed) {
      logger.warn("Sign-up refused: not on the access list", {
        domain: email.split("@")[1] ?? "",
        provider: event.additionalUserInfo?.providerId ?? null,
      });
      throw new HttpsError(
        "permission-denied",
        "This email isn't on the CrewMaster access list. " +
          "Ask an admin to add it, then sign up again.",
      );
    }
    logger.info("Sign-up allowed", {
      provider: event.additionalUserInfo?.providerId ?? null,
    });
    // No changes to the new user record.
  },
);

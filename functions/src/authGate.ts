import {onCall, HttpsError} from "firebase-functions/v2/https";
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
    if (email === SUPER_ADMIN_EMAIL) {
      return {authorized: true};
    }

    const snap = await db.doc(APP_DATA_DOC).get();
    const raw: unknown = snap.get("authorizedEmails");
    const list: unknown[] = Array.isArray(raw) ? raw : [];
    const allowed = list.map((entry) => normalizeEmail(entry));

    const authorized = allowed.includes(email);
    logger.info("checkEmailAuthorized", {authorized});
    return {authorized};
  },
);

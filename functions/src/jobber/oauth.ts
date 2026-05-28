import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {randomBytes} from "node:crypto";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const JOBBER_CLIENT_ID = defineSecret("JOBBER_CLIENT_ID");
export const JOBBER_CLIENT_SECRET = defineSecret("JOBBER_CLIENT_SECRET");

const REGION = "us-central1";
const REDIRECT_URI =
  "https://us-central1-crewmaster-73f31.cloudfunctions.net/jobberOAuthCallback";
const JOBBER_AUTHORIZE_URL = "https://api.getjobber.com/api/oauth/authorize";
const JOBBER_TOKEN_URL = "https://api.getjobber.com/api/oauth/token";

const APP_ID = "crewmaster";
const OAUTH_STATE_COLLECTION =
  `artifacts/${APP_ID}/private/data/oauthState`;
export const JOBBER_AUTH_DOC =
  `artifacts/${APP_ID}/private/data/jobberAuth/main`;
const STATE_TTL_MS = 5 * 60 * 1000;

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
}

interface StateDoc {
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export const jobberOAuthStart = onCall(
  {region: REGION, secrets: [JOBBER_CLIENT_ID]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    // TODO: server-side role check. Today this trusts the client-side
    // permission gate (canManageJobberIntegration). Before production,
    // read the caller's Employee doc and verify isSuperAdmin or admin.
    const userId = request.auth.uid;
    const state = randomBytes(32).toString("hex");
    const now = Date.now();
    await db.collection(OAUTH_STATE_COLLECTION).doc(state).set({
      userId,
      createdAt: now,
      expiresAt: now + STATE_TTL_MS,
    });
    const url = new URL(JOBBER_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", JOBBER_CLIENT_ID.value());
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("state", state);
    // Scopes are configured per-app at the Jobber Developer Center and
    // are not passed in the authorization URL — matches Jobber's docs.
    return {url: url.toString()};
  },
);

export const jobberOAuthCallback = onRequest(
  {region: REGION, secrets: [JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET]},
  async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const oauthError =
      typeof req.query.error === "string" ? req.query.error : "";

    if (oauthError) {
      res.status(400).send(
        renderError(`Jobber returned an error: ${escapeHtml(oauthError)}`),
      );
      return;
    }
    if (!code || !state) {
      res.status(400).send(renderError("Missing code or state parameter."));
      return;
    }

    const stateRef = db.collection(OAUTH_STATE_COLLECTION).doc(state);
    const stateSnap = await stateRef.get();
    if (!stateSnap.exists) {
      res.status(400).send(renderError(
        "Invalid or unknown OAuth state. Please retry the connect flow.",
      ));
      return;
    }
    const stateData = stateSnap.data() as StateDoc;
    if (Date.now() > stateData.expiresAt) {
      await stateRef.delete().catch(() => undefined);
      res.status(400).send(renderError(
        "OAuth state expired. Please retry the connect flow.",
      ));
      return;
    }
    await stateRef.delete();

    let tokens: TokenResponse;
    try {
      tokens = await exchangeCodeForToken(code);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("Jobber token exchange failed", {error: msg});
      res.status(500).send(
        renderError(`Token exchange failed: ${escapeHtml(msg)}`),
      );
      return;
    }

    const accessTokenExpiresAt = computeExpiresAt(tokens.expires_in);

    await db.doc(JOBBER_AUTH_DOC).set({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresAt,
      connectedAt: Date.now(),
      connectedBy: stateData.userId,
      accountName: "",
    });

    logger.info("Jobber connected", {userId: stateData.userId});
    res.status(200).send(renderSuccess());
  },
);

/**
 * Exchanges an authorization code for Jobber access + refresh tokens.
 * @param {string} code The auth code returned by Jobber on the redirect.
 * @return {Promise<TokenResponse>} The parsed token payload.
 */
async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams();
  body.set("client_id", JOBBER_CLIENT_ID.value());
  body.set("client_secret", JOBBER_CLIENT_SECRET.value());
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", REDIRECT_URI);
  const resp = await fetch(JOBBER_TOKEN_URL, {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Jobber token endpoint ${resp.status}: ${text.slice(0, 200)}`,
    );
  }
  return (await resp.json()) as TokenResponse;
}

/**
 * Refreshes the stored Jobber access token using the saved refresh token.
 * Persists the new tokens back to Firestore. Returns null if no auth doc
 * exists yet.
 * @return {Promise<TokenResponse | null>} New tokens, or null if none stored.
 */
export async function refreshJobberAccessToken():
  Promise<TokenResponse | null> {
  const snap = await db.doc(JOBBER_AUTH_DOC).get();
  if (!snap.exists) return null;
  const current = snap.data() as {refreshToken?: string};
  if (!current.refreshToken) return null;
  const body = new URLSearchParams();
  body.set("client_id", JOBBER_CLIENT_ID.value());
  body.set("client_secret", JOBBER_CLIENT_SECRET.value());
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", current.refreshToken);
  const resp = await fetch(JOBBER_TOKEN_URL, {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Jobber refresh ${resp.status}: ${text.slice(0, 200)}`);
  }
  const tokens = (await resp.json()) as TokenResponse;
  const accessTokenExpiresAt = computeExpiresAt(tokens.expires_in);
  await db.doc(JOBBER_AUTH_DOC).update({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt,
  });
  return tokens;
}

/**
 * Computes the UTC ms timestamp at which the access token expires.
 * Defaults to one hour from now when Jobber omits `expires_in` from a
 * token response (their documented default lifetime is 60 minutes).
 * @param {number | undefined} expiresInSeconds Value from Jobber, if any.
 * @return {number} Absolute ms timestamp when the token expires.
 */
function computeExpiresAt(expiresInSeconds: number | undefined): number {
  const sec = typeof expiresInSeconds === "number" && expiresInSeconds > 0 ?
    expiresInSeconds :
    3600;
  return Date.now() + sec * 1000;
}

/**
 * HTML-escapes user-supplied strings before embedding in the callback page.
 * @param {string} s The raw string to escape.
 * @return {string} The HTML-safe string.
 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
    case "&": return "&amp;";
    case "<": return "&lt;";
    case ">": return "&gt;";
    case "\"": return "&quot;";
    case "'": return "&#39;";
    default: return c;
    }
  });
}

/**
 * Renders the minimal "Jobber connected" success page returned to the
 * user's browser after a successful OAuth callback.
 * @return {string} A self-contained HTML document.
 */
function renderSuccess(): string {
  return [
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\">",
    "<title>Jobber connected</title></head>",
    "<body style=\"font-family:system-ui,sans-serif;max-width:520px;",
    "margin:80px auto;padding:24px;color:#0f172a;background:#f8fafc;",
    "border:1px solid #e2e8f0;border-radius:16px;text-align:center\">",
    "<h1 style=\"color:#65a30d;margin:0 0 12px;font-size:28px\">",
    "Jobber connected</h1>",
    "<p style=\"color:#475569;font-size:15px;line-height:1.5\">",
    "CrewMaster is now linked to your Jobber account. ",
    "You can close this window and return to the app.</p>",
    "</body></html>",
  ].join("");
}

/**
 * Renders the minimal failure page shown when the OAuth callback errors.
 * @param {string} msg Pre-escaped user-facing error description.
 * @return {string} A self-contained HTML document.
 */
function renderError(msg: string): string {
  return [
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\">",
    "<title>Connection failed</title></head>",
    "<body style=\"font-family:system-ui,sans-serif;max-width:520px;",
    "margin:80px auto;padding:24px;color:#0f172a;background:#fef2f2;",
    "border:1px solid #fecaca;border-radius:16px;text-align:center\">",
    "<h1 style=\"color:#b91c1c;margin:0 0 12px;font-size:24px\">",
    "Connection failed</h1>",
    `<p style="color:#475569;font-size:15px;line-height:1.5">${msg}</p>`,
    "<p style=\"color:#94a3b8;font-size:13px;margin-top:24px\">",
    "Close this window and try again from the app.</p>",
    "</body></html>",
  ].join("");
}

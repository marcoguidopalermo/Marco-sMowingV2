import * as logger from "firebase-functions/logger";
import {refreshJobberAccessToken} from "./oauth.js";

const JOBBER_GRAPHQL_URL = "https://api.getjobber.com/api/graphql";
const JOBBER_API_VERSION = "2025-04-16";
const MAX_THROTTLE_RETRIES = 3;
const MAX_THROTTLE_SLEEP_MS = 30_000;

export interface ThrottleStatus {
  maximumAvailable?: number;
  currentlyAvailable?: number;
  restoreRate?: number;
  requestedQueryCost?: number;
  actualQueryCost?: number | null;
}

interface JobberResponse {
  data?: unknown;
  errors?: Array<{message: string; extensions?: Record<string, unknown>}>;
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      actualQueryCost?: number;
      throttleStatus?: ThrottleStatus;
    };
  };
}

export interface JobberClient {
  fetch(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<unknown>;
  getLastThrottleStatus(): ThrottleStatus | undefined;
}

/**
 * Sleep helper used between paginated calls and throttle backoffs.
 * @param {number} ms How long to wait, in milliseconds.
 * @return {Promise<void>} Resolves when the timer fires.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks whether a GraphQL response represents Jobber's throttle error.
 * @param {JobberResponse} json The parsed body.
 * @return {boolean} True if any error message contains "throttle".
 */
function isThrottled(json: JobberResponse): boolean {
  if (!json.errors || json.errors.length === 0) return false;
  return json.errors.some((e) => /throttle/i.test(e.message));
}

/**
 * Computes the milliseconds to sleep before retrying a throttled request.
 * Uses (requestedQueryCost - currentlyAvailable) / restoreRate + 500ms.
 * @param {ThrottleStatus | undefined} status The reported throttle state.
 * @return {number} Sleep duration in ms (capped to MAX_THROTTLE_SLEEP_MS).
 */
function computeThrottleSleepMs(status: ThrottleStatus | undefined): number {
  const needed = Math.max(
    0,
    (status?.requestedQueryCost ?? 100) - (status?.currentlyAvailable ?? 0),
  );
  const rate = status?.restoreRate && status.restoreRate > 0 ?
    status.restoreRate :
    50;
  const sleepMs = Math.ceil((needed / rate) * 1000) + 500;
  return Math.min(sleepMs, MAX_THROTTLE_SLEEP_MS);
}

/**
 * Creates a Jobber GraphQL client with two layers of retry:
 * - One-shot 401 retry (refresh access token, retry once).
 * - Throttle retry: parse extensions.cost.throttleStatus, sleep the
 *   time required to refill the budget, retry up to 3 times.
 * The most recent throttleStatus is exposed via getLastThrottleStatus()
 * so callers can do pre-flight budget checks.
 * @param {string} initialToken The starting bearer access token.
 * @return {JobberClient} A fetch helper plus a throttle accessor.
 */
export function makeJobberClient(initialToken: string): JobberClient {
  let token = initialToken;
  let alreadyRefreshed = false;
  let lastThrottleStatus: ThrottleStatus | undefined;

  const post = (
    query: string,
    variables: Record<string, unknown>,
  ): Promise<Response> => fetch(JOBBER_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-JOBBER-GRAPHQL-VERSION": JOBBER_API_VERSION,
    },
    body: JSON.stringify({query, variables}),
  });

  const tryOnce = async (
    query: string,
    variables: Record<string, unknown>,
  ): Promise<JobberResponse> => {
    let resp = await post(query, variables);
    if (resp.status === 401 && !alreadyRefreshed) {
      alreadyRefreshed = true;
      logger.info("Jobber 401 — refreshing access token and retrying");
      const refreshed = await refreshJobberAccessToken();
      if (!refreshed) {
        throw new Error("Jobber HTTP 401 and refresh returned no tokens");
      }
      token = refreshed.access_token;
      resp = await post(query, variables);
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(
        `Jobber HTTP ${resp.status}: ${text.slice(0, 200)}`,
      );
    }
    return (await resp.json()) as JobberResponse;
  };

  return {
    async fetch(query, variables) {
      for (let attempt = 0; attempt <= MAX_THROTTLE_RETRIES; attempt++) {
        const json = await tryOnce(query, variables);
        lastThrottleStatus = json.extensions?.cost?.throttleStatus;
        if (isThrottled(json) && attempt < MAX_THROTTLE_RETRIES) {
          const ms = computeThrottleSleepMs(lastThrottleStatus);
          logger.warn("Jobber throttled — sleeping before retry", {
            attempt,
            sleepMs: ms,
            currentlyAvailable: lastThrottleStatus?.currentlyAvailable,
            requestedQueryCost: lastThrottleStatus?.requestedQueryCost,
          });
          await sleep(ms);
          continue;
        }
        if (json.errors && json.errors.length > 0) {
          const msg = json.errors.map((e) => e.message).join("; ");
          throw new Error(`Jobber GraphQL: ${msg}`);
        }
        return json.data;
      }
      throw new Error(
        "Jobber GraphQL: Throttled — gave up after " +
          `${MAX_THROTTLE_RETRIES} retries`,
      );
    },
    getLastThrottleStatus() {
      return lastThrottleStatus;
    },
  };
}

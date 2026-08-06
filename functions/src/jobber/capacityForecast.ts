// CAPACITY FORECAST — forward, READ-ONLY snapshot of SCHEDULED, UNCOMPLETED
// Jobber visits.
//
// What this is: a picture of REMAINING COMMITTED WORK. It answers "how far
// out are we booked?" It is NOT history and NOT pay.
//
// What it touches: nothing. It writes exactly one document
// (capacityForecast/current) and reads nothing but Jobber. It never writes
// performance logs, multi-day ledgers, BH splits, approvals or pay. The
// performance sync is untouched by this file.
//
// The [BH] tag is read through the SAME parser the performance sync uses
// (./bhParser) — there is no second parsing implementation.
//
// Crew ATTRIBUTION and week BUCKETING deliberately happen on the CLIENT
// (src/lib/capacity.ts): the client already holds schedules, employees and
// the multi-day ledgers live, so the forecast recomputes instantly when a
// capacity setting changes rather than waiting for a re-sync. This function's
// only job is to put raw forward visits somewhere the client can read them.

import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {
  JOBBER_AUTH_DOC,
  JOBBER_CLIENT_ID,
  JOBBER_CLIENT_SECRET,
  refreshJobberAccessToken,
} from "./oauth.js";
import {makeJobberClient, JobberClient, sleep} from "./client.js";
import {parseBh, stripBhTag} from "./bhParser.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const REGION = "us-central1";
const APP_ID = "crewmaster";
const FORECAST_DOC =
  `artifacts/${APP_ID}/public/data/capacityForecast/current`;
const TIMEZONE = "America/Toronto";
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const PAGE_DELAY_MS = 250;

// How far FORWARD we pull. Wider than the widest view (a month toggle) on
// purpose: the "booked out to" headline is computed over the whole horizon,
// so a salesman sees the true end of the committed pipeline, not the end of
// the visible grid.
const HORIZON_DAYS = 120;
// How far BACK we look. Only to catch IN-FLIGHT multi-day work: a visit that
// started last week, isn't complete, and still runs into this week is
// remaining committed work. Past-ending visits are dropped below.
const LOOKBACK_DAYS = 21;
// Page size is 25, matching the performance sync's proven query cost.
// Jobber prices a query by its whole nested shape against a 10,000-point
// ceiling, and `first: 50` with job+client+assignedUsers nested under it
// exceeds that ceiling outright — it comes back "Throttled" even with the
// budget completely full, and no amount of waiting fixes it. 80 pages × 25
// = 2,000 visits; beyond that the snapshot is marked truncated rather than
// silently short.
const MAX_PAGES = 80;
// Firestore caps a document at 1 MiB. Each entry is small (~250 B), but the
// cap is enforced explicitly so a runaway pull can never fail the write.
const MAX_ENTRIES = 2500;

// Forward visits query. SEPARATE from the sync's VISITS_QUERY (which stays
// exactly as it is) because this one needs two extra things the sync doesn't:
// `endAt` (multi-day span) and the client name (drill-down readability).
//
// `assignedUsers(first: 10)` is a COST control. Jobber prices a query by the
// maximum objects it could return, so an unbounded nested connection is
// charged at its default page size — 25 visits × 25 possible assignees. That
// cost matters here because this query paginates a 120-day window against the
// same 10,000-point budget the performance sync draws from.
// THE BOUND, stated plainly: a visit with more than 10 assignees has its
// trailing assignees unseen, and if those trailing people were the only ones
// from a second crew, that crew wouldn't be credited with its share. Ten is
// well past any real crew (2–5) or pair of crews on one visit, so this is a
// theoretical edge rather than a live one — but it is a real bound, not a
// display-only truncation.
const FORWARD_VISITS_QUERY = `query ForwardVisits(
  $after: ISO8601DateTime!,
  $before: ISO8601DateTime!,
  $cursor: String
) {
  visits(
    first: 25,
    after: $cursor,
    filter: { startAt: { after: $after, before: $before } }
  ) {
    nodes {
      id
      title
      startAt
      endAt
      completedAt
      isComplete
      job { id jobNumber title client { name } }
      assignedUsers(first: 10) { nodes { id name { full } } }
    }
    pageInfo { endCursor hasNextPage }
  }
}`;

// Fallback shape — identical to the performance sync's known-good query. Used
// only if the richer query above is rejected by the API (schema drift on
// `endAt` / `client`). Degrades to start-date-only bucketing and no client
// name rather than producing no forecast at all.
const FORWARD_VISITS_QUERY_MINIMAL = `query ForwardVisitsMinimal(
  $after: ISO8601DateTime!,
  $before: ISO8601DateTime!,
  $cursor: String
) {
  visits(
    first: 25,
    after: $cursor,
    filter: { startAt: { after: $after, before: $before } }
  ) {
    nodes {
      id
      title
      startAt
      completedAt
      isComplete
      job { id jobNumber title }
      assignedUsers { nodes { id name { full } } }
    }
    pageInfo { endCursor hasNextPage }
  }
}`;

// The minimal-query fallback exists for ONE reason: the API no longer
// accepts a field the rich query asks for (`endAt` / `client`). Anything
// else — throttling, HTTP failures, network trouble — must propagate, so a
// transient blip can't silently and permanently downgrade the forecast to
// start-date-only bucketing. GraphQL validation errors name the offending
// field; that's what this matches.
const SCHEMA_ERROR = new RegExp([
  "Cannot query field",
  "doesn't exist on type",
  "does not exist on type",
  "Unknown argument",
  "Field '[^']+' doesn't exist",
  "undefinedField",
  "argumentLiteralsIncompatible",
  "Validation failed",
].join("|"), "i");

interface JobberAuthDoc {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number | null;
}

interface ForwardVisitNode {
  id: string;
  title: string | null;
  startAt: string;
  endAt?: string | null;
  completedAt: string | null;
  isComplete: boolean;
  job: {
    id: string;
    jobNumber: string | null;
    title: string | null;
    client?: {name: string | null} | null;
  } | null;
  assignedUsers: {nodes: Array<{id: string; name: {full: string}}>};
}

interface PageInfo {
  endCursor: string | null;
  hasNextPage: boolean;
}

// One forward-scheduled visit, as stored in the snapshot. Deliberately flat
// and small — the client does the rest.
export interface ForecastVisit {
  visitId: string;
  jobId: string | null;
  jobNumber: string | null;
  // Title with the [BH] / [hourly] tag stripped — the label the UI shows.
  desc: string;
  client: string | null;
  // First and last scheduled DAY (YYYY-MM-DD, Toronto). endDate === startDate
  // for an ordinary single-day visit.
  startDate: string;
  endDate: string;
  // Parsed tag total for the WHOLE visit. 0 when hourly or untagged — the
  // client subtracts already-credited BH from the multi-day ledger to get
  // what's actually remaining.
  bh: number;
  // [hourly] (T&M) — BH is entered by a manager after the fact, so there is
  // no forward number to book. Counted separately in the UI, never as 0 load.
  isHourly: boolean;
  // Scheduled, but the title carries no [BH] tag at all — unknown load.
  // Surfaced as a count so an empty-looking week isn't mistaken for open.
  untagged: boolean;
  // Jobber assignee ids — the client maps these to crews using the schedule.
  assigneeIds: string[];
  assigneeNames: string[];
}

export interface CapacityForecastDoc {
  generatedAt: number;
  generatedBy: "manual" | "scheduled";
  // Toronto YYYY-MM-DD boundaries of what was pulled.
  windowStart: string;
  windowEnd: string;
  // The day the horizon is anchored on — "today" in Toronto at pull time.
  today: string;
  visits: ForecastVisit[];
  // Counts for the UI's honesty line + debugging.
  stats: {
    fetched: number;
    kept: number;
    completeSkipped: number;
    endedBeforeToday: number;
    untagged: number;
    hourly: number;
  };
  truncated: boolean;
  // Set when the rich query fell back to the minimal one — multi-day spans
  // and client names are unavailable in that mode, and the UI says so.
  degraded: boolean;
  warnings: string[];
}

/**
 * Returns the UTC offset in minutes for America/Toronto on a given date.
 * @param {Date} probe A date roughly in the period of interest.
 * @return {number} Offset in minutes (negative for west of UTC).
 */
function torontoOffsetMinutes(probe: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    timeZoneName: "shortOffset",
  });
  const parts = fmt.formatToParts(probe);
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value || "";
  const m = tzPart.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!m) return 0;
  const hours = parseInt(m[1], 10);
  const mins = m[2] ? parseInt(m[2], 10) : 0;
  return hours * 60 + (hours < 0 ? -mins : mins);
}

/**
 * Formats a Date as YYYY-MM-DD in Toronto.
 * @param {Date} d The instant to format.
 * @return {string} Toronto calendar date.
 */
function ymdInToronto(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Shifts a YYYY-MM-DD by whole days, DST-safe (noon anchor).
 * @param {string} dateStr Base date.
 * @param {number} offsetDays Days to add (may be negative).
 * @return {string} Shifted YYYY-MM-DD.
 */
function shiftYmd(dateStr: string, offsetDays: number): string {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  probe.setUTCDate(probe.getUTCDate() + offsetDays);
  return ymdInToronto(probe);
}

/**
 * ISO instant for Toronto midnight at the start of a calendar date.
 * @param {string} dateStr YYYY-MM-DD.
 * @return {string} ISO8601 UTC instant.
 */
function torontoMidnightIso(dateStr: string): string {
  const guess = new Date(`${dateStr}T00:00:00Z`);
  const offset = torontoOffsetMinutes(guess);
  return new Date(guess.getTime() - offset * 60 * 1000).toISOString();
}

/**
 * Current Jobber access token, refreshing when needed.
 * @return {Promise<string>} A usable bearer token.
 */
async function getValidAccessToken(): Promise<string> {
  const snap = await db.doc(JOBBER_AUTH_DOC).get();
  if (!snap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "Jobber is not connected. Connect from App Settings first.",
    );
  }
  const auth = snap.data() as JobberAuthDoc;
  const expiresAt = auth.accessTokenExpiresAt;
  const needsRefresh =
    typeof expiresAt !== "number" ||
    expiresAt < Date.now() + TOKEN_REFRESH_BUFFER_MS;
  if (!needsRefresh) return auth.accessToken;
  const refreshed = await refreshJobberAccessToken();
  if (!refreshed) {
    throw new HttpsError(
      "failed-precondition",
      "Could not refresh Jobber token — reconnect from App Settings.",
    );
  }
  return refreshed.access_token;
}

/**
 * Paginates forward visits, preferring the rich query and falling back to
 * the sync's known-good shape if the API rejects it.
 * @param {JobberClient} client GraphQL client with retry behavior.
 * @param {string} after ISO start boundary (inclusive).
 * @param {string} before ISO end boundary (exclusive).
 * @return {Promise<object>} Visits plus degraded / truncated flags.
 */
async function fetchForwardVisits(
  client: JobberClient,
  after: string,
  before: string,
): Promise<{
  visits: ForwardVisitNode[];
  degraded: boolean;
  truncated: boolean;
  warnings: string[];
}> {
  const warnings: string[] = [];
  let degraded = false;
  let query = FORWARD_VISITS_QUERY;
  const out: ForwardVisitNode[] = [];
  let cursor: string | null = null;
  let truncated = false;

  for (let i = 0; i < MAX_PAGES; i++) {
    if (i > 0) await sleep(PAGE_DELAY_MS);
    let data: {visits: {nodes: ForwardVisitNode[]; pageInfo: PageInfo}};
    try {
      const vars = {after, before, cursor};
      data = (await client.fetch(query, vars)) as typeof data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Only the RICH query is allowed to fall back, and only for a schema
      // error. Throttles and transport failures propagate — the next
      // scheduled pass retries with the full shape.
      if (degraded || query === FORWARD_VISITS_QUERY_MINIMAL) throw e;
      if (!SCHEMA_ERROR.test(msg)) throw e;
      degraded = true;
      query = FORWARD_VISITS_QUERY_MINIMAL;
      cursor = null;
      out.length = 0;
      truncated = false;
      warnings.push(
        `forward_query_degraded — endAt/client unavailable (${msg}); ` +
        "multi-day spans collapse to their start day",
      );
      logger.warn("Capacity forecast fell back to minimal query", {msg});
      i = -1; // restart pagination from scratch on the next loop turn
      continue;
    }
    out.push(...data.visits.nodes);
    if (!data.visits.pageInfo.hasNextPage) {
      return {visits: out, degraded, truncated: false, warnings};
    }
    cursor = data.visits.pageInfo.endCursor;
    truncated = true; // stays true only if the loop exits by exhausting pages
  }
  if (truncated) {
    warnings.push(
      `page_cap_reached — stopped after ${MAX_PAGES} pages ` +
      `(${out.length} visits); later weeks may be understated`,
    );
  }
  return {visits: out, degraded, truncated, warnings};
}

/**
 * Pulls forward scheduled work from Jobber and writes the snapshot doc.
 * @param {"manual" | "scheduled"} triggeredBy Trigger source, for the doc.
 * @return {Promise<CapacityForecastDoc>} The snapshot that was written.
 */
export async function runCapacityForecast(
  triggeredBy: "manual" | "scheduled",
): Promise<CapacityForecastDoc> {
  const token = await getValidAccessToken();
  const client = makeJobberClient(token);

  const today = ymdInToronto(new Date());
  const windowStart = shiftYmd(today, -LOOKBACK_DAYS);
  const windowEnd = shiftYmd(today, HORIZON_DAYS);
  const after = torontoMidnightIso(windowStart);
  const before = torontoMidnightIso(windowEnd);

  const {visits: raw, degraded, truncated, warnings} =
    await fetchForwardVisits(client, after, before);
  // Logged BEFORE any processing so a run that dies later is still
  // diagnosable. Without this, a stall between "last page fetched" and
  // "document written" is silent — and silence reads exactly like success.
  logger.info("Capacity forecast fetched", {
    visits: raw.length,
    windowStart,
    windowEnd,
    degraded,
    truncated,
  });

  const stats = {
    fetched: raw.length,
    kept: 0,
    completeSkipped: 0,
    endedBeforeToday: 0,
    untagged: 0,
    hourly: 0,
  };

  const entries: ForecastVisit[] = [];
  for (const v of raw) {
    // COMPLETED / CREDITED work is history, not remaining commitment.
    if (v.isComplete === true || v.completedAt) {
      stats.completeSkipped++;
      continue;
    }
    const startDate = v.startAt ? ymdInToronto(new Date(v.startAt)) : "";
    if (!startDate) continue;
    const rawEnd = v.endAt ? ymdInToronto(new Date(v.endAt)) : "";
    // A visit whose end precedes its start is bad data — collapse to a day.
    const endDate = rawEnd && rawEnd > startDate ? rawEnd : startDate;
    // Dropped: incomplete work that finished its scheduled span before
    // today. It is no longer forward-committed capacity; it is a stale visit
    // for the performance sync / manager to resolve, not a booking.
    if (endDate < today) {
      stats.endedBeforeToday++;
      continue;
    }

    const visitTitle = v.title || "";
    const jobTitle = v.job?.title || "";
    // Same precedence the sync uses: the VISIT title wins when it carries a
    // tag, otherwise the JOB title.
    const visitParsed = parseBh(visitTitle);
    const jobParsed = parseBh(jobTitle);
    const parsed = visitParsed || jobParsed;
    const usedVisitTitle = !!visitParsed;
    const sourceTitle = usedVisitTitle ? visitTitle :
      (jobParsed ? jobTitle : (visitTitle || jobTitle));
    const desc = stripBhTag(sourceTitle) ||
      `Job ${v.job?.jobNumber || v.id}`;

    const isHourly = !!parsed?.isHourly;
    const untagged = !parsed;
    if (isHourly) stats.hourly++;
    if (untagged) stats.untagged++;

    const assignees = v.assignedUsers?.nodes || [];
    entries.push({
      visitId: v.id,
      jobId: v.job?.id || null,
      jobNumber: v.job?.jobNumber || null,
      desc: desc.slice(0, 120),
      client: v.job?.client?.name || null,
      startDate,
      endDate,
      bh: isHourly ? 0 : (parsed?.bh ?? 0),
      isHourly,
      untagged,
      assigneeIds: assignees.map((a) => a.id),
      assigneeNames: assignees.map((a) => a.name?.full || "").slice(0, 6),
    });
    if (entries.length >= MAX_ENTRIES) {
      warnings.push(
        `entry_cap_reached — kept the first ${MAX_ENTRIES} forward visits`,
      );
      break;
    }
  }
  stats.kept = entries.length;

  // Chronological so the client can bucket without re-sorting.
  entries.sort((a, b) => (a.startDate < b.startDate ? -1 :
    a.startDate > b.startDate ? 1 : 0));

  const snapshot: CapacityForecastDoc = {
    generatedAt: Date.now(),
    generatedBy: triggeredBy,
    windowStart,
    windowEnd,
    today,
    visits: entries,
    stats,
    truncated: truncated || entries.length >= MAX_ENTRIES,
    degraded,
    warnings,
  };

  logger.info("Capacity forecast writing", {entries: entries.length});
  await db.doc(FORECAST_DOC).set(snapshot);
  logger.info("Capacity forecast written", {
    kept: stats.kept,
    fetched: stats.fetched,
    degraded,
    truncated: snapshot.truncated,
  });
  return snapshot;
}

export const jobberSyncCapacity = onCall(
  {
    region: REGION,
    secrets: [JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET],
    timeoutSeconds: 300,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    return await runCapacityForecast("manual");
  },
);

// Forward bookings move on office hours, not minutes. Twice an hour during
// the working day is plenty, and the :07/:37 offset keeps it clear of the
// performance sync's :00/:15/:30/:45 slots so the two never contend for the
// Jobber API budget.
export const jobberSyncCapacityScheduled = onSchedule(
  {
    region: REGION,
    schedule: "7,37 6-20 * * *",
    timeZone: TIMEZONE,
    secrets: [JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET],
    timeoutSeconds: 300,
  },
  async () => {
    try {
      await runCapacityForecast("scheduled");
    } catch (e) {
      // Never let the forecast's failure surface as a function crash loop —
      // it is a read-only convenience view. Log and move on.
      logger.error("Scheduled capacity forecast failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
);

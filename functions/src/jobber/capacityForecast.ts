// CAPACITY FORECAST — forward, READ-ONLY snapshot of SCHEDULED, UNCOMPLETED
// Jobber visits.
//
// What this is: a picture of REMAINING COMMITTED WORK. It answers "how far
// out are we booked?" It is NOT history and NOT pay.
//
// What it touches: nothing that matters. It writes ONE snapshot document per
// scope (capacityForecast/projects, capacityForecast/lawn) and otherwise only
// reads — Jobber, and the schedule (to decide which scope a visit files
// under). It never writes performance logs, multi-day ledgers, BH splits,
// approvals or pay. The performance sync is untouched by this file.
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
const APP_DATA_DOC = `artifacts/${APP_ID}/public/data/appData/main`;
// SCOPED snapshots — one document per scope. Lawn runs 250+ visits a week and
// changes slowly; projects are few and change constantly. Splitting them lets
// a projects refresh leave the big lawn document alone, and lets lawn use a
// much shorter horizon (its page count, not projects', is what blew the old
// single pull past its ceiling).
export type ForecastScope = "projects" | "lawn";
export const FORECAST_SCOPES: ForecastScope[] = ["projects", "lawn"];
const forecastDoc = (scope: ForecastScope): string =>
  `artifacts/${APP_ID}/public/data/capacityForecast/${scope}`;
// The pre-split single document. Deleted once on the first scoped run so a
// stale snapshot can't sit there looking live. It is a regenerable cache.
const LEGACY_FORECAST_DOC =
  `artifacts/${APP_ID}/public/data/capacityForecast/current`;
const TIMEZONE = "America/Toronto";
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
// Paced so the shared Jobber budget can refill between pages rather than
// being pinned at the floor. Measured on the live account: a page of this
// query costs enough that a 250ms gap drains 10,000 points to under 1,000
// within ~30 seconds of paging.
const PAGE_DELAY_MS = 600;
// HARD FLOOR on the shared Jobber API budget. The capacity forecast is a
// convenience view; the PERFORMANCE SYNC that runs on the same account every
// 15 minutes is pay. If a long pull would draw the budget below this, the
// pull stops early and says so — the forecast yields to the sync, never the
// other way round. This is the guardrail that keeps a read-only view from
// ever costing someone their numbers.
const BUDGET_FLOOR = 3000;

// How far FORWARD we pull, per scope.
// PROJECTS: wide, because "booked out to" is computed over the whole horizon
// and project work is genuinely booked months ahead.
// LAWN: short. Lawn is recurring, every week is full, and nobody sells
// against a lawn week four months out — so paying for 120 days of the
// densest visit stream in the business buys nothing. This is the single
// biggest reduction in pages fetched.
const SCOPE_HORIZON_DAYS: Record<ForecastScope, number> = {
  projects: 84,
  lawn: 42,
};
// How far BACK we look. Only to catch IN-FLIGHT multi-day work: a visit that
// started last week, isn't complete, and still runs into this week is
// remaining committed work. Past-ending visits are dropped below.
const LOOKBACK_DAYS = 21;
// Page size is 25, matching the performance sync's proven query cost.
// Jobber prices a query by its whole nested shape against a 10,000-point
// ceiling, and `first: 50` with job+client+assignedUsers nested under it
// exceeds that ceiling outright — it comes back "Throttled" even with the
// budget completely full, and no amount of waiting fixes it.
//
// The ceiling below is a RUNAWAY GUARD, not a working limit. At 80 pages
// (2,000 visits) it was neither: the live pull hit it every run and the UI
// showed a permanent "later weeks may be understated" warning — a forecast
// that silently understates is worse than none. 400 pages × 25 = 10,000
// visits, comfortably past the real volume, and the timeout was raised to
// match. If this is ever hit again the snapshot still says so.
const MAX_PAGES = 400;
// Firestore caps a document at 1 MiB. Each entry is ~300 B, so 10,000 would
// not fit — the per-scope split is what keeps each document small. Both caps
// below exist so a big pull DEGRADES (flagged truncation) instead of failing
// the write outright, which would leave the last good snapshot in place with
// no indication anything went wrong.
const MAX_ENTRIES = 3000;
// Byte budget for the entries array, well under the 1 MiB document limit.
// Entry count alone is a poor proxy — a run of long titles and client names
// can be twice the size of a run of short ones.
const MAX_ENTRY_BYTES = 800_000;

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
  scope: ForecastScope;
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
  // THE DATE THIS SNAPSHOT ACTUALLY COVERS THROUGH. When a pull stops early
  // (page cap or budget floor) the weeks past this point were never fetched
  // — they are UNKNOWN, not empty. Without this the UI would paint them 0 BH
  // and colour them "underbooked — sell into it", which is the single most
  // dangerous thing this tool could say: it would send a salesman to fill a
  // week nobody ever looked at.
  coveredThrough: string;
  // The pull yielded to protect the performance sync's API budget.
  stoppedForBudget: boolean;
  // Set when the rich query fell back to the minimal one — multi-day spans
  // and client names are unavailable in that mode, and the UI says so.
  degraded: boolean;
  warnings: string[];
}

/**
 * Splits Jobber assignee ids into lawn and non-lawn by what crews those
 * people have actually been scheduled on.
 *
 * This is a COARSE pre-filter — it only decides which document a visit is
 * stored in. Exact crew attribution still happens client-side off the same
 * schedule, so a visit filed under the "wrong" scope is still counted
 * against the right crew: the client merges both documents before building
 * the model. That is deliberate — it means a misclassification costs
 * nothing, so this can stay simple.
 * @return {Promise<object>} Lawn and projects assignee id sets.
 */
async function loadScopeAssignees(): Promise<{
  lawn: Set<string>;
  projects: Set<string>;
}> {
  const lawn = new Set<string>();
  const projects = new Set<string>();
  try {
    const snap = await db.doc(APP_DATA_DOC).get();
    const data = (snap.data() || {}) as {
      schedules?: Record<string, Array<{
        division?: string;
        jobberAssigneeIds?: string[];
      }>>;
    };
    for (const crews of Object.values(data.schedules || {})) {
      for (const crew of crews || []) {
        const isLawn = /lawn/i.test(crew.division || "");
        for (const id of crew.jobberAssigneeIds || []) {
          (isLawn ? lawn : projects).add(id);
        }
      }
    }
  } catch (e) {
    logger.warn("Could not load schedules for scope split", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return {lawn, projects};
}

/**
 * Decides a visit's scope from its assignees.
 * A visit counts as LAWN only when it has at least one lawn assignee and no
 * projects assignee. Everything else — including work we can't attribute at
 * all — files under projects, which is also where the client's "Unassigned"
 * row is surfaced, so unattributable work stays visible rather than being
 * quietly parked in the document nobody refreshes.
 * @param {string[]} assigneeIds The visit's Jobber assignee ids.
 * @param {Set<string>} lawnSet Lawn assignee ids.
 * @param {Set<string>} projectsSet Projects assignee ids.
 * @return {ForecastScope} Which document this visit belongs in.
 */
function scopeOfVisit(
  assigneeIds: string[],
  lawnSet: Set<string>,
  projectsSet: Set<string>,
): ForecastScope {
  let lawnHits = 0;
  let projectHits = 0;
  for (const id of assigneeIds) {
    if (lawnSet.has(id)) lawnHits++;
    if (projectsSet.has(id)) projectHits++;
  }
  return lawnHits > 0 && projectHits === 0 ? "lawn" : "projects";
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
  stoppedForBudget: boolean;
  pages: number;
}> {
  const warnings: string[] = [];
  let degraded = false;
  let query = FORWARD_VISITS_QUERY;
  const out: ForwardVisitNode[] = [];
  let cursor: string | null = null;
  let truncated = false;
  let stoppedForBudget = false;
  let pages = 0;

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
    pages++;
    if (!data.visits.pageInfo.hasNextPage) {
      return {
        visits: out, degraded, truncated: false, warnings,
        stoppedForBudget: false, pages,
      };
    }
    // Yield to the performance sync. Better a forecast that admits it only
    // covers the next N weeks than a sync that can't compute pay.
    const available = client.getLastThrottleStatus()?.currentlyAvailable;
    if (typeof available === "number" && available < BUDGET_FLOOR) {
      stoppedForBudget = true;
      truncated = true;
      warnings.push(
        `budget_floor — stopped after ${pages} pages (${out.length} ` +
        `visits) with ${available} Jobber points left, to leave headroom ` +
        "for the performance sync; later weeks are NOT covered",
      );
      logger.warn("Capacity pull stopped to protect the sync's API budget", {
        pages, visits: out.length, available,
      });
      break;
    }
    cursor = data.visits.pageInfo.endCursor;
    truncated = true; // stays true only if the loop exits by exhausting pages
  }
  if (truncated && !stoppedForBudget) {
    warnings.push(
      `page_cap_reached — stopped after ${MAX_PAGES} pages ` +
      `(${out.length} visits); later weeks are NOT covered`,
    );
  }
  return {visits: out, degraded, truncated, warnings, stoppedForBudget, pages};
}

/**
 * Pulls forward scheduled work for ONE scope and writes that scope's
 * snapshot document. The other scope's document is left untouched.
 * @param {ForecastScope} scope Which half of the business to refresh.
 * @param {"manual" | "scheduled"} triggeredBy Trigger source, for the doc.
 * @return {Promise<CapacityForecastDoc>} The snapshot that was written.
 */
export async function runCapacityForecast(
  scope: ForecastScope,
  triggeredBy: "manual" | "scheduled",
): Promise<CapacityForecastDoc> {
  const token = await getValidAccessToken();
  const client = makeJobberClient(token);
  const {lawn: lawnSet, projects: projectsSet} = await loadScopeAssignees();
  // If the schedule yields no lawn assignees, the scope split can't split:
  // EVERY visit files under projects and the lawn document stays empty. No
  // work is lost (the client merges both documents), but the projects pull
  // then carries the whole business and can hit its own ceiling — so say so
  // loudly rather than let it look like lawn simply has nothing booked.
  if (lawnSet.size === 0) {
    logger.warn("Scope split found no lawn assignees — everything files " +
      "under projects; check crews carry jobberAssigneeIds", {
      projectsAssignees: projectsSet.size,
    });
  }

  const today = ymdInToronto(new Date());
  const windowStart = shiftYmd(today, -LOOKBACK_DAYS);
  const windowEnd = shiftYmd(today, SCOPE_HORIZON_DAYS[scope]);
  const after = torontoMidnightIso(windowStart);
  const before = torontoMidnightIso(windowEnd);

  const {visits: raw, degraded, truncated, warnings, stoppedForBudget, pages} =
    await fetchForwardVisits(client, after, before);
  // Logged BEFORE any processing so a run that dies later is still
  // diagnosable. Without this, a stall between "last page fetched" and
  // "document written" is silent — and silence reads exactly like success.
  logger.info("Capacity forecast fetched", {
    scope,
    pages,
    stoppedForBudget,
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
    otherScope: 0,
  };

  const entries: ForecastVisit[] = [];
  let entryBytes = 0;
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
    const assigneeIds = assignees.map((a) => a.id);
    // Belongs to the other half of the business — its own run owns it.
    if (scopeOfVisit(assigneeIds, lawnSet, projectsSet) !== scope) {
      stats.otherScope++;
      continue;
    }
    const entry: ForecastVisit = {
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
      assigneeIds,
      assigneeNames: assignees.map((a) => a.name?.full || "").slice(0, 4),
    };
    entries.push(entry);
    entryBytes += JSON.stringify(entry).length;
    if (entries.length >= MAX_ENTRIES || entryBytes >= MAX_ENTRY_BYTES) {
      warnings.push(
        `entry_cap_reached — kept the first ${entries.length} forward ` +
        `visits (${Math.round(entryBytes / 1024)} KB); later weeks of this ` +
        "scope are understated",
      );
      break;
    }
  }
  stats.kept = entries.length;

  // Chronological so the client can bucket without re-sorting.
  entries.sort((a, b) => (a.startDate < b.startDate ? -1 :
    a.startDate > b.startDate ? 1 : 0));

  // A complete pull covers the whole window. A stopped one covers only as
  // far as the last visit it actually saw — Jobber returns visits in start
  // order, so the furthest startAt fetched is the honest coverage boundary.
  const furthestFetched = raw.reduce((max, v) => {
    const d = v.startAt ? ymdInToronto(new Date(v.startAt)) : "";
    return d > max ? d : max;
  }, "");
  const coveredThrough = (truncated || entries.length >= MAX_ENTRIES) ?
    (furthestFetched || today) : windowEnd;

  const snapshot: CapacityForecastDoc = {
    scope,
    coveredThrough,
    stoppedForBudget,
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

  logger.info("Capacity forecast writing", {scope, entries: entries.length});
  await db.doc(forecastDoc(scope)).set(snapshot);
  logger.info("Capacity forecast written", {
    scope,
    coveredThrough,
    kept: stats.kept,
    fetched: stats.fetched,
    otherScope: stats.otherScope,
    degraded,
    truncated: snapshot.truncated,
  });
  // One-time cleanup of the pre-split document so a stale snapshot can't sit
  // in Firestore looking live. Regenerable cache, no data loss; failure here
  // is irrelevant to the run.
  try {
    await db.doc(LEGACY_FORECAST_DOC).delete();
  } catch {
    // ignore
  }
  return snapshot;
}

export const jobberSyncCapacity = onCall(
  {
    region: REGION,
    secrets: [JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET],
    timeoutSeconds: 540,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    // Defaults to PROJECTS — the half that actually moves between refreshes.
    const raw = (request.data ?? {}) as {scope?: string};
    const scope: ForecastScope = raw.scope === "lawn" ? "lawn" : "projects";
    return await runCapacityForecast(scope, "manual");
  },
);

// PROJECTS: twice an hour through the working day. Project bookings change
// constantly and the document is small. The :07/:37 offset keeps this clear
// of the performance sync's :00/:15/:30/:45 slots so the two never contend
// for the Jobber API budget.
export const jobberSyncCapacityScheduled = onSchedule(
  {
    region: REGION,
    schedule: "7,37 6-20 * * *",
    timeZone: TIMEZONE,
    secrets: [JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET],
    timeoutSeconds: 540,
  },
  async () => {
    try {
      await runCapacityForecast("projects", "scheduled");
    } catch (e) {
      // Never let the forecast's failure surface as a function crash loop —
      // it is a read-only convenience view. Log and move on.
      logger.error("Scheduled capacity forecast failed", {
        scope: "projects",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
);

// LAWN: three times a day, not twice an hour. It is the densest visit stream
// in the business and the slowest-moving picture — a recurring route booked
// weeks out doesn't change between lunch and mid-afternoon. Early morning
// (after overnight scheduling), midday, and end of day.
export const jobberSyncCapacityLawnScheduled = onSchedule(
  {
    region: REGION,
    schedule: "22 6,12,18 * * *",
    timeZone: TIMEZONE,
    secrets: [JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET],
    timeoutSeconds: 540,
  },
  async () => {
    try {
      await runCapacityForecast("lawn", "scheduled");
    } catch (e) {
      logger.error("Scheduled capacity forecast failed", {
        scope: "lawn",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
);

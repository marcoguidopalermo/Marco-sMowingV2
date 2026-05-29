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

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const REGION = "us-central1";
const APP_ID = "crewmaster";
const APP_DATA_DOC = `artifacts/${APP_ID}/public/data/appData/main`;
const SYNC_LOG_COLLECTION = `artifacts/${APP_ID}/private/data/syncLog`;
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const MIN_TIMESHEET_SECONDS = 60;
const TIMEZONE = "America/Toronto";
const PAGE_DELAY_MS = 250;
const MIN_BUDGET_FOR_SYNC = 1000;

const VISITS_QUERY = `query VisitsOnDate(
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

const TIMESHEETS_QUERY = `query TimesheetsOnDate(
  $after: ISO8601DateTime!,
  $before: ISO8601DateTime!,
  $cursor: String
) {
  timeSheetEntries(
    first: 50,
    after: $cursor,
    filter: { startAt: { after: $after, before: $before } }
  ) {
    nodes {
      id
      ticking
      finalDuration
      startAt
      endAt
      user { id name { full } }
    }
    pageInfo { endCursor hasNextPage }
  }
}`;

interface JobberAuthDoc {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number | null;
}

interface VisitNode {
  id: string;
  title: string | null;
  startAt: string;
  completedAt: string | null;
  isComplete: boolean;
  job: {id: string; jobNumber: string | null; title: string | null} | null;
  assignedUsers: {nodes: Array<{id: string; name: {full: string}}>};
}

interface TimesheetNode {
  id: string;
  // Live-timer flag from Jobber. True while a worker is clocked in
  // (open shift); false once they've clocked out. finalDuration
  // resolves to 0 while ticking is true, so this is the canonical
  // signal — finalDuration alone can't distinguish open from a
  // <1s closed entry.
  ticking: boolean;
  finalDuration: number | null;
  startAt: string;
  endAt: string | null;
  user: {id: string; name: {full: string}};
}

interface PageInfo {
  endCursor: string | null;
  hasNextPage: boolean;
}

interface PerformanceJobRow {
  desc: string;
  bh: number | string;
  routeId?: string;
  source?: "manual" | "jobber";
  jobberVisitId?: string;
  jobberJobId?: string;
  jobberJobNumber?: string;
  manuallyEditedAt?: string;
  hasJobberConflict?: boolean;
  jobberSuggestedValue?: number;
  removedFromJobber?: boolean;
  awaitingCompletionReview?: boolean;
  awaitingHourlyBH?: boolean;
  isIncompleteVisit?: boolean;
  totalBH?: number;
  jobberTagType?: "bh" | "hourly";
  manuallyShifted?: boolean;
  shiftedFromDate?: string;
  shiftHistory?: Array<{
    fromDate: string;
    toDate: string;
    fromCrewId: string;
    toCrewId: string;
    userEmail: string;
    userName: string;
    timestamp: number;
  }>;
  movedToDate?: string;
  ghostFromVisitId?: string;
  awaitingBhTag?: boolean;
}

interface CompletionEntry {
  targetDate: string;
  percentComplete: number;
  creditedBH: number;
  crewId: string;
  // Stable cross-day crew identity ("<division-lower>-<crewNumber>") —
  // see types.ts for the rationale. Optional for legacy entries.
  crewKey?: string;
  markedAt: number;
  markedBy: string;
  markedByName: string;
  isRetroactive: boolean;
  reasonNote?: string;
}

interface MultiDayJob {
  // The multiDayJobs map is keyed by jobberVisitId — each Jobber visit has
  // its own independent completion ledger. jobberJobId is metadata only.
  jobberVisitId: string;
  jobberJobId: string;
  jobberJobNumber: number | string;
  title: string;
  totalBH: number;
  // Informational only — no longer drives branching in sync/attribution.
  isLawnJob: boolean;
  manualOverride: boolean;
  completionHistory: CompletionEntry[];
  status: "in_progress" | "complete";
  firstSeenAt: number;
  // Manager-driven "stop tracking" flag set from PerformanceBoard.
  // When true, the cloud sync skips ALL multi-day processing for
  // this visit: no auto-credit, no carryForwardCandidates emission,
  // no completionHistory writes, no metadata refresh. Existing
  // history stays intact.
  dismissedCarryForward?: boolean;
  dismissedCarryForwardAt?: number;
  dismissedCarryForwardBy?: { email: string; name: string };
}

interface PerformanceLog {
  division: string;
  crewNumber: number;
  isAdHoc: boolean;
  jobs: PerformanceJobRow[];
  employeeAH: Record<string, unknown>;
  deductions: Record<string, unknown>;
  approvalStatus?: "pending" | "approved";
  approvedAt?: string;
  approvedBy?: string;
  approvedByName?: string;
  lastJobberSyncAt?: number;
  removedEmployees?: string[];
  // Per-crew-day snapshot of the applied size + allowance pct.
  // Sync re-stamps for the current targetDate every run; once a
  // date is in the past, the stamp freezes (no more runs target
  // that day), so changes to appData.settings.crewSizeAllowance
  // don't rewrite history.
  crewSizeAllowance?: { size: number; pct: number };
}

interface CrewSizeAllowanceRow {
  minSize: number;
  pct: number;
}

interface AppSettingsDoc {
  endOfDayReminder?: string;
  crewSizeAllowance?: CrewSizeAllowanceRow[];
}

interface CrewSchedule {
  id: string;
  division: string;
  crewNumber: number;
  employees: string[];
  jobberAssigneeIds?: string[];
}

interface EmployeeDoc {
  id: string;
  jobberUserId?: string;
}

// Multi-crew visit BH split. Single-crew visits have no entry here.
interface VisitBHSplit {
  visitId: string;
  totalBH: number;
  splits: Array<{ crewId: string; bh: number }>;
  splitMethod: "auto" | "manual";
  lastUpdatedAt: number;
}

interface AppDataShape {
  schedules?: Record<string, CrewSchedule[]>;
  employees?: EmployeeDoc[];
  performance?: Record<string, Record<string, PerformanceLog>>;
  multiDayJobs?: Record<string, MultiDayJob>;
  visitBHSplits?: Record<string, VisitBHSplit>;
  dailyAbsences?: Record<string, string[]>;
  settings?: AppSettingsDoc;
  // Schema sentinel. < 2 (or missing) triggers a one-time wipe of
  // multiDayJobs so legacy jobId-keyed entries don't cohabit with new
  // visit-keyed ones.
  __multiDayKeyVersion?: number;
}

// Default crew-size allowance table — mirrors src/constants.ts so a
// sync run against a brand-new tenant with no settings doc still
// stamps sensible values. Keep in lockstep with the frontend default.
const DEFAULT_CREW_SIZE_ALLOWANCE: CrewSizeAllowanceRow[] = [
  {minSize: 1, pct: 0},
  {minSize: 3, pct: 10},
  {minSize: 4, pct: 15},
  {minSize: 5, pct: 20},
];

/**
 * Looks up the allowance percentage for a given scheduled size.
 * Walks the table ascending and keeps the highest matching pct.
 * @param {number} size Scheduled headcount on the crew that day.
 * @param {CrewSizeAllowanceRow[] | undefined} table Custom table
 *     from appData.settings.crewSizeAllowance, or undefined to fall
 *     back to DEFAULT_CREW_SIZE_ALLOWANCE.
 * @return {number} The applied pct (0 if no row matches).
 */
function pctForCrewSize(
  size: number,
  table: CrewSizeAllowanceRow[] | undefined,
): number {
  const rows = (table && table.length > 0 ? table : DEFAULT_CREW_SIZE_ALLOWANCE)
    .slice()
    .sort((a, b) => a.minSize - b.minSize);
  let pct = 0;
  for (const row of rows) {
    if (size >= row.minSize) pct = row.pct;
    else break;
  }
  return pct;
}

interface SyncResultSummary {
  targetDate: string;
  triggeredBy: "manual" | "scheduled";
  triggeredByUserId: string | null;
  triggeredAt: number;
  visitsProcessed: number;
  visitsParsed: number;
  visitsUnmatched: number;
  visitsIncomplete: number;
  visitsRemovedDeleted: number;
  visitsAwaitingReview: number;
  visitsAutoCredited: number;
  visitsHourly: number;
  multiDayJobsCreated: number;
  bhFormatExplicit: number;
  bhFormatImplicit: number;
  parseErrors: number;
  visitTitleVsJobTitle: number;
  visitsFilteredByDate: number;
  multiDayAutoCredited: number;
  carryForwardCandidates: Array<{
    jobberVisitId: string;
    jobberJobId: string;
    jobTitle: string;
    priorDate: string;
    priorCrewId: string;
    priorCumulativePct: number;
    remainingBH: number;
    totalBH: number;
  }>;
  queryRangeUtc?: {after: string; before: string};
  entriesCreated: number;
  entriesUpdated: number;
  entriesSkippedApproved: number;
  crewsAffected: number;
  errors: string[];
  warnings: string[];
}

// Accepts both [3BH] (explicit suffix, original convention) and [3]
// (implicit — bare number, used informally by office staff). Whitespace
// inside the brackets around the optional BH suffix is tolerated.
// Capture group 2 ("BH") is used to distinguish the two formats for
// audit reporting.
// The value pattern is \d*\.?\d+ — the integer part is OPTIONAL so
// fractional-under-1 tags parse in both forms: [0.5] AND bare [.5].
// (The old \d+\.?\d* required a leading digit, so crews typing [.5] /
// [.9] fell through to "Awaiting BH tag".) Requires at least one digit
// overall, so [] / [.] / [bh] still don't match.
const BH_REGEX = /\[(\d*\.?\d+)\s*(BH)?\s*\]/i;
// [hourly] takes precedence over [XBH] / [N]. T&M jobs where the
// manager calculates BH manually (workers × hours).
const HOURLY_REGEX = /\[\s*hourly\s*\]/i;

/**
 * Returns the UTC offset in minutes for America/Toronto on a given date.
 * Handles EST/EDT transitions automatically.
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
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  return hours * 60 + (hours < 0 ? -minutes : minutes);
}

/**
 * Computes UTC ISO strings for the start and end of a Toronto calendar day.
 * @param {string} dateStr A YYYY-MM-DD date string.
 * @return {object} Object with `after` and `before` ISO strings.
 */
function torontoBoundariesIso(
  dateStr: string,
): {after: string; before: string} {
  const utcMidnight = Date.parse(`${dateStr}T00:00:00Z`);
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const offsetMin = torontoOffsetMinutes(probe);
  const afterMs = utcMidnight - offsetMin * 60_000;
  const beforeMs = afterMs + 24 * 60 * 60 * 1000;
  return {
    after: new Date(afterMs).toISOString(),
    before: new Date(beforeMs).toISOString(),
  };
}

/**
 * Returns YYYY-MM-DD (Toronto) shifted by `offsetDays` from `dateStr`.
 * @param {string} dateStr Anchor YYYY-MM-DD.
 * @param {number} offsetDays Negative or positive day delta.
 * @return {string} Shifted YYYY-MM-DD.
 */
function shiftYmd(dateStr: string, offsetDays: number): string {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  probe.setUTCDate(probe.getUTCDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(probe);
}

/**
 * Returns a UTC window spanning [targetDate-7, targetDate+1] in Toronto.
 * Catches visits whose startAt was up to a week ago but completedAt is in
 * the current sync's attribution range (rain-day catch-up, late
 * completions). Trade-off: ~9× the page count vs a 1-day window — usually
 * still well under throttle limits for a single crew-day sync.
 * @param {string} targetDate Anchor YYYY-MM-DD.
 * @return {object} `after` (Toronto midnight of -7 day) and `before`
 *                  (Toronto midnight after next day), both UTC ISO.
 */
function torontoWindow7DayBackIso(
  targetDate: string,
): {after: string; before: string} {
  const prev = torontoBoundariesIso(shiftYmd(targetDate, -7));
  const next = torontoBoundariesIso(shiftYmd(targetDate, 1));
  return {after: prev.after, before: next.before};
}

/**
 * Returns today's date in Toronto as a YYYY-MM-DD string.
 * @return {string} Today in YYYY-MM-DD form, Toronto timezone.
 */
function formatTodayInToronto(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Returns yesterday's date in Toronto as a YYYY-MM-DD string.
 * @return {string} Yesterday in YYYY-MM-DD form, Toronto timezone.
 */
function formatYesterdayInToronto(): string {
  const todayStr = formatTodayInToronto();
  const d = new Date(`${todayStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Acquires a valid access token, refreshing proactively if missing-expiry
 * or expiring within 60s. Throws HttpsError if Jobber isn't connected
 * or refresh fails.
 * @return {Promise<string>} A usable Bearer access token.
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
  // Refresh whenever expiry is unknown (null/missing) or within the buffer.
  // Older auth docs stored before the expires_in default fix can have null.
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
 * Paginates the visits-on-date GraphQL query, returning all visits.
 * @param {JobberClient} client GraphQL client with retry behavior.
 * @param {string} after ISO start boundary (inclusive).
 * @param {string} before ISO end boundary (exclusive).
 * @return {Promise<VisitNode[]>} All visits in the window.
 */
async function fetchAllVisits(
  client: JobberClient,
  after: string,
  before: string,
): Promise<VisitNode[]> {
  const out: VisitNode[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 40; i++) {
    if (i > 0) await sleep(PAGE_DELAY_MS);
    const data = (await client.fetch(VISITS_QUERY, {
      after,
      before,
      cursor,
    })) as {visits: {nodes: VisitNode[]; pageInfo: PageInfo}};
    out.push(...data.visits.nodes);
    if (!data.visits.pageInfo.hasNextPage) break;
    cursor = data.visits.pageInfo.endCursor;
  }
  return out;
}

/**
 * Paginates the timesheet-entries GraphQL query, returning all entries.
 * @param {JobberClient} client GraphQL client with retry behavior.
 * @param {string} after ISO start boundary (inclusive).
 * @param {string} before ISO end boundary (exclusive).
 * @return {Promise<TimesheetNode[]>} All entries in the window.
 */
async function fetchAllTimesheets(
  client: JobberClient,
  after: string,
  before: string,
): Promise<TimesheetNode[]> {
  const out: TimesheetNode[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 40; i++) {
    if (i > 0) await sleep(PAGE_DELAY_MS);
    const data = (await client.fetch(TIMESHEETS_QUERY, {
      after,
      before,
      cursor,
    })) as {timeSheetEntries: {nodes: TimesheetNode[]; pageInfo: PageInfo}};
    out.push(...data.timeSheetEntries.nodes);
    if (!data.timeSheetEntries.pageInfo.hasNextPage) break;
    cursor = data.timeSheetEntries.pageInfo.endCursor;
  }
  return out;
}

interface ParsedBh {
  bh: number;
  format: "explicit" | "implicit" | "hourly";
  isHourly: boolean;
}

/**
 * Parses a job/visit title for either a BH tag or the [hourly] marker.
 * [hourly] takes precedence — if both are present, the row is treated
 * as hourly (manager-entered BH) and the BH tag is ignored (caller
 * may log a warning).
 * @param {string | null | undefined} title The text to scan.
 * @return {ParsedBh | null} Parsed tag, or null if no recognized tag.
 */
function parseBh(title: string | null | undefined): ParsedBh | null {
  if (!title) return null;
  if (HOURLY_REGEX.test(title)) {
    return {bh: 0, format: "hourly", isHourly: true};
  }
  const m = BH_REGEX.exec(title);
  if (!m) return null;
  // parseFloat (not parseInt) so [.5] / [0.5] keep their decimal.
  const n = parseFloat(m[1]);
  // A valid BH tag must be a positive number. Reject 0 / negative /
  // non-finite — those fall through to "Awaiting BH tag" rather than
  // crediting 0 BH. (Negatives also can't reach the regex, but guard
  // anyway.)
  if (!Number.isFinite(n) || n <= 0) return null;
  return {bh: n, format: m[2] ? "explicit" : "implicit", isHourly: false};
}

/**
 * Strips any recognized job tag ([hourly], [XBH], [N]) from a title.
 * @param {string} title The raw title.
 * @return {string} Title without tag markers.
 */
function stripBhTag(title: string): string {
  return title
    .replace(HOURLY_REGEX, "")
    .replace(BH_REGEX, "")
    .trim()
    .replace(/\s{2,}/g, " ");
}

/**
 * Stable cross-day crew identity for matching CompletionEntry rows.
 * crew.id is regenerated per-day, so we derive a key from division and
 * crewNumber instead. Must match the frontend's stableCrewKey output.
 * @param {object} crew The crew identity.
 * @param {string} crew.division Division name.
 * @param {number} crew.crewNumber Crew number.
 * @return {string} The stable key.
 */
function stableCrewKey(
  crew: {division: string; crewNumber: number},
): string {
  return `${(crew.division || "").trim().toLowerCase()}-${crew.crewNumber}`;
}

/**
 * Core sync routine shared by callable and scheduled triggers.
 * @param {object} args Input.
 * @param {string} args.targetDate YYYY-MM-DD to sync.
 * @param {"manual" | "scheduled"} args.triggeredBy Trigger source.
 * @param {string | null} args.triggeredByUserId Caller uid for manual.
 * @return {Promise<SyncResultSummary>} Aggregate sync stats.
 */
async function runPerformanceSync(args: {
  targetDate: string;
  triggeredBy: "manual" | "scheduled";
  triggeredByUserId: string | null;
}): Promise<SyncResultSummary> {
  const {targetDate, triggeredBy, triggeredByUserId} = args;
  const summary: SyncResultSummary = {
    targetDate,
    triggeredBy,
    triggeredByUserId,
    triggeredAt: Date.now(),
    visitsProcessed: 0,
    visitsParsed: 0,
    visitsUnmatched: 0,
    visitsIncomplete: 0,
    visitsRemovedDeleted: 0,
    visitsAwaitingReview: 0,
    visitsAutoCredited: 0,
    visitsHourly: 0,
    multiDayJobsCreated: 0,
    bhFormatExplicit: 0,
    bhFormatImplicit: 0,
    parseErrors: 0,
    visitTitleVsJobTitle: 0,
    visitsFilteredByDate: 0,
    multiDayAutoCredited: 0,
    carryForwardCandidates: [],
    entriesCreated: 0,
    entriesUpdated: 0,
    entriesSkippedApproved: 0,
    crewsAffected: 0,
    errors: [],
    warnings: [],
  };

  try {
    const initialToken = await getValidAccessToken();
    const client = makeJobberClient(initialToken);
    // 7-day-back window: a visit may have been incomplete on a prior day,
    // marked complete days later. We need to catch its current state and
    // auto-move its old incomplete row to the new completedAt day.
    // Timesheets are still queried with the 1-day window (no auto-move
    // semantics — they're just summed for AH on targetDate).
    const {after, before} = torontoWindow7DayBackIso(targetDate);
    summary.queryRangeUtc = {after, before};

    // Pre-flight: tiny query to surface current throttle budget so a sync
    // doesn't half-run and clobber state when the bucket is already low.
    await client.fetch("query Preflight { account { id } }", {});
    const budget = client.getLastThrottleStatus();
    const available = budget?.currentlyAvailable ?? Number.POSITIVE_INFINITY;
    if (available < MIN_BUDGET_FOR_SYNC) {
      const max = budget?.maximumAvailable ?? "?";
      throw new HttpsError(
        "resource-exhausted",
        "Jobber API throttled — try again in 30 seconds. " +
          `(Budget: ${Math.round(available)}/${max} points)`,
      );
    }

    // Run visits and timesheets sequentially (not in parallel) so each
    // request shows up at the rate limiter spaced apart rather than as
    // a burst that drains the bucket below the threshold for the next.
    const jobberResponseVisits = await fetchAllVisits(client, after, before);
    await sleep(PAGE_DELAY_MS);
    // Timesheets only cover the target date — they sum to AH for targetDate
    // and don't participate in any cross-day auto-move semantics.
    const tsRange = torontoBoundariesIso(targetDate);
    const timesheets = await fetchAllTimesheets(
      client,
      tsRange.after,
      tsRange.before,
    );

    // Post-fetch attribution filter. Unified model — no lawn-special path:
    //   - Complete visit: attribute by completedAt's Toronto date.
    //   - Incomplete visit (lawn or otherwise): attribute by startAt's
    //       Toronto date. Manager can optionally credit partial % via the
    //       row's kebab menu; auto-move-on-completion later relocates the
    //       row to completedAt's date.
    //   - Anything else (unparseable dates): drop with a warning.
    // Then also drop visits whose ID appears on an adjacent day's
    // performance entry with manuallyShifted=true — manager has already
    // moved them, and re-attributing would clobber the destination.
    const torontoDayFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    // Need appData early to know lawn-job overrides + adjacent shifted IDs.
    const appDataRefEarly = db.doc(APP_DATA_DOC);
    const appSnapEarly = await appDataRefEarly.get();
    if (!appSnapEarly.exists) {
      throw new HttpsError("failed-precondition", "AppData document missing.");
    }
    const appDataEarly = appSnapEarly.data() as AppDataShape;
    const performanceEarly = appDataEarly.performance || {};
    // Build shifted-visitId set from adjacent days. Rows the manager has
    // explicitly moved are anchored where they are; this sync must not
    // re-add a row for the same visitId on targetDate.
    const shiftedVisitIds = new Set<string>();
    const adjacentDates = [
      shiftYmd(targetDate, -1),
      shiftYmd(targetDate, 1),
      targetDate,
    ];
    for (const d of adjacentDates) {
      const dayMap = performanceEarly[d];
      if (!dayMap) continue;
      for (const log of Object.values(dayMap)) {
        for (const row of (log.jobs || [])) {
          if (
            row.source === "jobber" &&
            row.jobberVisitId &&
            row.manuallyShifted === true
          ) {
            // Only honor the marker on dates OTHER than targetDate, since
            // a row sitting on targetDate with manuallyShifted=true means
            // it was shifted INTO targetDate (and should be left alone by
            // the merge loop below, which checks existingByVisit).
            if (d !== targetDate) shiftedVisitIds.add(row.jobberVisitId);
          }
        }
      }
    }

    // Jobber-users early load — still needed for assignee→crew mapping
    // even though the lawn-vs-non-lawn split is gone.
    const JOBBER_USERS_DOC_EARLY =
      `artifacts/${APP_ID}/private/data/jobberUsers/main`;
    const jobberUsersByIdEarly = new Map<string, {id: string; name: string}>();
    try {
      const jsnap = await db.doc(JOBBER_USERS_DOC_EARLY).get();
      const jdata = jsnap.data() as {
        users?: Array<{id: string; name: string}>;
      } | undefined;
      for (const u of jdata?.users || []) {
        jobberUsersByIdEarly.set(u.id, u);
      }
    } catch {
      // Non-fatal.
    }
    const rawVisits: VisitNode[] = [];
    for (const v of jobberResponseVisits) {
      if (shiftedVisitIds.has(v.id)) {
        summary.visitsFilteredByDate++;
        summary.warnings.push(
          `visit_skipped_manually_shifted visit=${v.id}`,
        );
        continue;
      }
      const isComplete = v.isComplete === true || !!v.completedAt;
      let startDate: string | null = null;
      let completedDate: string | null = null;
      try {
        if (v.startAt) {
          startDate = torontoDayFormatter.format(new Date(v.startAt));
        }
      } catch {
        // leave null
      }
      try {
        if (v.completedAt) {
          completedDate = torontoDayFormatter.format(new Date(v.completedAt));
        }
      } catch {
        // leave null
      }

      // Unified incomplete handling: every incomplete visit (lawn or
      // otherwise) gets a row on startAt's date. Manager can optionally
      // mark partial % from the kebab; auto-move-on-completion (below)
      // cleans up the stale row when Jobber later flags the visit complete.

      // Decide attribution date.
      let attributionDate: string | null;
      if (isComplete && completedDate) {
        attributionDate = completedDate;
      } else {
        attributionDate = startDate;
      }
      if (!attributionDate) {
        summary.visitsFilteredByDate++;
        summary.warnings.push(
          `visit_filtered_unparseable visit=${v.id} ` +
          `startAt=${v.startAt} completedAt=${v.completedAt}`,
        );
        continue;
      }
      if (attributionDate !== targetDate) {
        summary.visitsFilteredByDate++;
        continue;
      }
      if (
        isComplete && completedDate && startDate &&
        completedDate !== startDate
      ) {
        summary.warnings.push(
          `attributed_by_completedAt visit=${v.id} ` +
          `startAt=${startDate} completedAt=${completedDate}`,
        );
      }
      rawVisits.push(v);
    }

    summary.visitsProcessed = rawVisits.length;

    // Process ALL visits — both complete and incomplete. Incomplete
    // visits become "ghost rows" on PerformanceMaster: visible (so the
    // manager knows there's pending work) but contributing 0 BH. When
    // Jobber later flags the visit complete, the next sync upgrades the
    // ghost row to a normal credited row.
    const visits = rawVisits;
    const isCompleteVisit = (v: VisitNode): boolean =>
      v.isComplete === true || !!v.completedAt;
    for (const v of rawVisits) {
      if (!isCompleteVisit(v)) {
        summary.visitsIncomplete++;
      }
    }

    // Auto-move detection: for each completed visit, scan the last 7 days
    // of performance entries (excluding targetDate) for a stale row with
    // this same visitId. If found on a non-approved source day, remove
    // the stale row. If the source day is approved (locked), convert the
    // stale row into a ghost with movedToDate=targetDate. The replacement
    // credited row is created on targetDate by the normal per-crew loop.
    // Multi-day jobs that already have completionHistory entries use the
    // Phase 3.5 auto-credit-on-completion path instead and are skipped
    // here so we don't unwind manager-entered partials.
    const cleanupPerformanceByDate: Record<
      string,
      Record<string, PerformanceLog>
    > = {};
    interface AutoMoveEvent {
      visitId: string;
      jobId: string | null;
      jobTitle: string;
      sourceDate: string;
      sourceCrewId: string;
      sourceCrewLabel: string;
      destDate: string;
      ghosted: boolean;
    }
    const autoMoveEvents: AutoMoveEvent[] = [];
    const scanDates: string[] = [];
    for (let i = 7; i >= 1; i--) scanDates.push(shiftYmd(targetDate, -i));

    for (const v of rawVisits) {
      if (!isCompleteVisit(v)) continue;
      const visitJobId = v.job?.id;
      // Per-visit ledger lookup — Visit 1's history no longer blocks
      // Visit 2's auto-move when both share a parent job.
      const earlyMdj = (appDataEarly.multiDayJobs || {})[v.id];
      if (earlyMdj && earlyMdj.completionHistory.length > 0) continue;

      for (const sourceDate of scanDates) {
        if (sourceDate === targetDate) continue;
        const dayMap = performanceEarly[sourceDate];
        if (!dayMap) continue;
        let consumed = false;
        for (const [sourceCrewId, sourceLog] of Object.entries(dayMap)) {
          if (consumed) break;
          const jobs = sourceLog.jobs || [];
          const jobIdxFound = jobs.findIndex(
            (r) => r.source === "jobber" && r.jobberVisitId === v.id,
          );
          if (jobIdxFound === -1) continue;
          const sourceRow = jobs[jobIdxFound];
          if (sourceRow.movedToDate) {
            consumed = true;
            break;
          }
          consumed = true;
          if (!cleanupPerformanceByDate[sourceDate]) {
            cleanupPerformanceByDate[sourceDate] = {...dayMap};
          }
          const cleanupDayMap = cleanupPerformanceByDate[sourceDate];
          const existingLog = cleanupDayMap[sourceCrewId] || sourceLog;
          const newJobs = [...(existingLog.jobs || [])];
          const wasApproved = existingLog.approvalStatus === "approved";
          const crewLabel =
            `${existingLog.division} #${existingLog.crewNumber}`;
          if (wasApproved) {
            newJobs[jobIdxFound] = {
              ...sourceRow,
              movedToDate: targetDate,
              ghostFromVisitId: v.id,
              bh: 0,
            };
          } else {
            newJobs.splice(jobIdxFound, 1);
          }
          cleanupDayMap[sourceCrewId] = {
            ...existingLog,
            jobs: newJobs,
          };
          autoMoveEvents.push({
            visitId: v.id,
            jobId: visitJobId || null,
            jobTitle: v.title || v.job?.title || "",
            sourceDate,
            sourceCrewId,
            sourceCrewLabel: crewLabel,
            destDate: targetDate,
            ghosted: wasApproved,
          });
          summary.warnings.push(
            `visit_auto_moved_on_completion visit=${v.id} ` +
            `from=${sourceDate} to=${targetDate} ` +
            `ghosted=${wasApproved}`,
          );
        }
        if (consumed) break;
      }
    }

    // Reuse the early appData snapshot loaded for shifted/lawn-tag checks.
    const appDataRef = appDataRefEarly;
    const appData = appDataEarly;
    const schedules = appData.schedules || {};
    // Stable crew identity resolver for CompletionEntry rows. New entries
    // (written after the crewKey rollout) already carry crewKey. Legacy
    // entries have only crewId — we resolve them by looking up the crew
    // on that entry's targetDate, falling back to a synthetic crewid:
    // prefix if the schedule no longer contains a matching row (rare).
    const resolveEntryCrewKey = (e: CompletionEntry): string => {
      if (e.crewKey) return e.crewKey;
      const c = schedules[e.targetDate]?.find((cr) => cr.id === e.crewId);
      if (c) return stableCrewKey(c);
      return `crewid:${e.crewId}`;
    };
    const employees = appData.employees || [];
    const performance = appData.performance || {};
    const daySchedule = schedules[targetDate] || [];

    // One-time migration: the multi-day ledger used to be keyed by parent
    // jobberJobId, which caused recurring/multi-visit jobs to share a
    // single history (Visit 2 inherited Visit 1's "100% complete"). We've
    // re-keyed it by jobberVisitId. Any pre-existing entries are legacy
    // jobId-keyed and would orphan under the new lookups, so we wipe them
    // here on the first sync that observes a stale schema version. This
    // is test data only — the spec explicitly authorizes the nuke.
    const currentKeyVersion = appDataEarly.__multiDayKeyVersion || 0;
    const needsMultiDayMigration = currentKeyVersion < 2;
    const multiDayJobs: Record<string, MultiDayJob> = needsMultiDayMigration ?
      {} :
      {...(appData.multiDayJobs || {})};
    if (needsMultiDayMigration) {
      const legacyCount = Object.keys(appData.multiDayJobs || {}).length;
      summary.warnings.push(
        `multiday_key_migration_v2 cleared=${legacyCount} ` +
        "legacy jobId-keyed entries; rebuilding under visit-keyed ledger",
      );
    }

    // The early jobberUsers map is no longer needed in this scope —
    // lawn-vs-non-lawn assignee detection has been removed.
    void jobberUsersByIdEarly;

    // Build jobberAssigneeId → crewId map (first crew wins on ambiguity).
    const assigneeToCrewId = new Map<string, string>();
    const crewById = new Map<string, CrewSchedule>();
    for (const crew of daySchedule) {
      crewById.set(crew.id, crew);
      for (const aid of crew.jobberAssigneeIds || []) {
        if (!assigneeToCrewId.has(aid)) assigneeToCrewId.set(aid, crew.id);
      }
    }

    // Build jobberUserId → employee map.
    const empByJobberUserId = new Map<string, EmployeeDoc>();
    for (const emp of employees) {
      if (emp.jobberUserId) empByJobberUserId.set(emp.jobberUserId, emp);
    }

    // Bucket visits per crew. Both complete and incomplete visits are
    // bucketed — incomplete ones become ghost rows on PerformanceMaster.
    interface MatchedVisit {
      visit: VisitNode;
      bh: number;
      isHourly: boolean;
      isComplete: boolean;
      desc: string;
      parsed: ParsedBh | null;
      awaitingBhTag?: boolean;
    }
    const visitsByCrew = new Map<string, MatchedVisit[]>();
    // visitId → ordered list of crewIds the visit was matched to on this
    // date. Used to compute per-visit BH splits when size > 1.
    const visitCrewMap = new Map<string, string[]>();
    for (const visit of visits) {
      const complete = isCompleteVisit(visit);
      const visitTitle = visit.title || "";
      const jobTitle = visit.job?.title || "";
      // Visit title takes precedence over parent job title. Manager edits
      // the visit title to set per-occurrence BH (e.g., spring cleanup vs
      // routine mow have different [XBH]).
      const visitParsed = parseBh(visitTitle);
      const jobParsed = parseBh(jobTitle);
      let parsed = visitParsed || jobParsed;
      const usedVisitTitle = !!visitParsed;
      // Audit: when both titles have tags, track divergence so we can
      // spot drift between visit and job titles.
      if (visitParsed && jobParsed) {
        const diffBH = visitParsed.bh !== jobParsed.bh;
        const diffHourly = visitParsed.isHourly !== jobParsed.isHourly;
        if (diffBH || diffHourly) {
          summary.visitTitleVsJobTitle++;
          const vh = visitParsed.isHourly ? "(hourly)" : "";
          const jh = jobParsed.isHourly ? "(hourly)" : "";
          summary.warnings.push(
            `visit_title_differs visit=${visit.id} ` +
            `visit=${visitParsed.bh}${vh} job=${jobParsed.bh}${jh}`,
          );
        }
      }
      // Bug 2 fix: completed visit with no BH tag in title — instead of
      // dropping outright, try to recover. Look for an existing row for
      // this visitId on targetDate or the last 7 days that has totalBH
      // set, and reuse that value. If nothing is found, let the row
      // through with bh=0 and awaitingBhTag=true so the manager can
      // supply a BH manually from the UI.
      let awaitingBhTagFlag = false;
      if (complete && !parsed) {
        let reusedBh: number | null = null;
        const reuseScanDates: string[] = [targetDate];
        for (let i = 7; i >= 1; i--) {
          reuseScanDates.push(shiftYmd(targetDate, -i));
        }
        for (const d of reuseScanDates) {
          const dayMap = performanceEarly[d];
          if (!dayMap) continue;
          for (const log of Object.values(dayMap)) {
            for (const r of (log.jobs || [])) {
              if (
                r.source === "jobber" &&
                r.jobberVisitId === visit.id &&
                typeof r.totalBH === "number" &&
                r.totalBH > 0
              ) {
                reusedBh = r.totalBH;
                break;
              }
            }
            if (reusedBh !== null) break;
          }
          if (reusedBh !== null) break;
        }
        const jobNum = visit.job?.jobNumber || "?";
        const titleSnippet = (visitTitle || jobTitle).slice(0, 60);
        if (reusedBh !== null) {
          parsed = {bh: reusedBh, format: "implicit", isHourly: false};
          summary.warnings.push(
            `bh_reused_from_existing visit=${visit.id} bh=${reusedBh}`,
          );
        } else {
          // No fallback. Let the visit through with bh=0 and the flag
          // so the UI can prompt the manager. Synthesize a parsed object
          // so downstream code (which assumes complete + parsed) works.
          awaitingBhTagFlag = true;
          parsed = {bh: 0, format: "implicit", isHourly: false};
          summary.warnings.push(
            `bh_missing_on_complete visit=${visit.id} job=${jobNum} ` +
            `title=${titleSnippet}`,
          );
        }
      }
      // Warn if both [hourly] and an explicit BH tag are present in the
      // SAME title that won. (Cross-title divergence is logged above.)
      if (parsed?.isHourly) {
        const winnerTitle = usedVisitTitle ? visitTitle : jobTitle;
        if (BH_REGEX.test(winnerTitle)) {
          summary.warnings.push(
            `hourly_and_bh visit=${visit.id} — [hourly] wins`,
          );
        }
      }
      // Display label comes from whichever title won the parse. If neither
      // had a tag, fall back to visit title then job title for readability.
      const sourceTitle = usedVisitTitle ? visitTitle :
        (jobParsed ? jobTitle : (visitTitle || jobTitle));
      const desc = stripBhTag(sourceTitle) ||
        `Job ${visit.job?.jobNumber || visit.id}`;
      const matchedCrewIds = new Set<string>();
      for (const assignee of visit.assignedUsers?.nodes || []) {
        const cid = assigneeToCrewId.get(assignee.id);
        if (cid) matchedCrewIds.add(cid);
      }
      if (matchedCrewIds.size === 0) {
        if (complete) {
          summary.visitsUnmatched++;
          const jobNum = visit.job?.jobNumber || "?";
          summary.warnings.push(
            `unmatched_visit visit=${visit.id} job=${jobNum}`,
          );
        }
        continue;
      }
      if (matchedCrewIds.size > 1) {
        const crewList = [...matchedCrewIds].join(",");
        summary.warnings.push(
          `multi_match visit=${visit.id} crews=${crewList}`,
        );
      }
      if (complete) {
        summary.visitsParsed++;
        if (parsed?.isHourly) {
          summary.visitsHourly++;
        } else if (parsed?.format === "explicit") {
          summary.bhFormatExplicit++;
        } else if (parsed?.format === "implicit") {
          summary.bhFormatImplicit++;
        }
      }
      // Multi-crew unification: push the visit into EVERY matched crew's
      // bucket, not just the first. Each crew's per-crew loop will look
      // up its share from visitBHSplits and emit a row with that share.
      const crewIdList = [...matchedCrewIds];
      visitCrewMap.set(visit.id, crewIdList);
      for (const crewId of crewIdList) {
        const arr = visitsByCrew.get(crewId) || [];
        arr.push({
          visit,
          bh: parsed?.bh ?? 0,
          isHourly: parsed?.isHourly ?? false,
          isComplete: complete,
          desc,
          parsed,
          awaitingBhTag: awaitingBhTagFlag,
        });
        visitsByCrew.set(crewId, arr);
      }
    }

    // === MULTI-CREW BH SPLIT ===
    // For every visit whose assignees mapped to 2+ crews, compute (or
    // preserve, if manual) the per-crew BH share. Single-crew visits get
    // their existing entry deleted so they fall back to the simple path.
    const visitBHSplits: Record<string, VisitBHSplit> = {
      ...(appData.visitBHSplits || {}),
    };
    const dailyAbsencesMap = appData.dailyAbsences || {};
    const absentTodaySet = new Set(dailyAbsencesMap[targetDate] || []);
    const headcountFor = (crewId: string): number => {
      const c = daySchedule.find((x) => x.id === crewId);
      if (!c) return 0;
      return (c.employees || []).filter(
        (empId) => !absentTodaySet.has(empId),
      ).length;
    };
    const round1 = (n: number): number => Math.round(n * 10) / 10;
    const buildHeadcountSplit = (
      crewIds: string[],
      totalBH: number,
    ): Array<{ crewId: string; bh: number }> => {
      const heads = crewIds.map((c) => headcountFor(c));
      const totalHead = heads.reduce((a, b) => a + b, 0);
      let result: Array<{ crewId: string; bh: number }>;
      if (totalHead === 0) {
        const per = round1(totalBH / crewIds.length);
        result = crewIds.map((c) => ({crewId: c, bh: per}));
      } else {
        result = crewIds.map((c, i) => ({
          crewId: c,
          bh: round1(totalBH * (heads[i] / totalHead)),
        }));
      }
      // Fix any rounding drift so the sum lands exactly on totalBH.
      const sum = result.reduce((a, s) => a + s.bh, 0);
      const drift = round1(totalBH - sum);
      if (Math.abs(drift) >= 0.05) {
        let maxIdx = 0;
        for (let i = 1; i < result.length; i++) {
          if (result[i].bh > result[maxIdx].bh) maxIdx = i;
        }
        result[maxIdx] = {
          ...result[maxIdx],
          bh: round1(result[maxIdx].bh + drift),
        };
      }
      return result;
    };
    for (const [visitId, crewIds] of visitCrewMap) {
      // Need the visit's parsed total BH — find via visitsByCrew.
      const sample = (visitsByCrew.get(crewIds[0]) || [])
        .find((mv) => mv.visit.id === visitId);
      const visitTotalBH = sample?.parsed?.bh ?? 0;
      if (crewIds.length < 2) {
        // Single-crew visit — no split tracked. Drop any stale entry.
        if (visitBHSplits[visitId]) delete visitBHSplits[visitId];
        continue;
      }
      // Hourly / awaiting-bh visits aren't split either — no defined BH.
      if (!visitTotalBH || visitTotalBH <= 0) {
        if (visitBHSplits[visitId]) delete visitBHSplits[visitId];
        continue;
      }
      const existing = visitBHSplits[visitId];
      if (existing && existing.splitMethod === "manual") {
        // Preserve manager's manual values. Add new crews at 0; redistribute
        // removed crews' shares proportionally back into the remaining ones.
        const incomingSet = new Set(crewIds);
        const keeping = existing.splits.filter(
          (s) => incomingSet.has(s.crewId),
        );
        const removed = existing.splits.filter(
          (s) => !incomingSet.has(s.crewId),
        );
        const removedTotal = removed.reduce((a, s) => a + s.bh, 0);
        const updated: Array<{ crewId: string; bh: number }> = [...keeping];
        if (removedTotal > 0 && updated.length > 0) {
          const baseTotal = updated.reduce((a, s) => a + s.bh, 0);
          if (baseTotal > 0) {
            for (let i = 0; i < updated.length; i++) {
              updated[i] = {
                ...updated[i],
                bh: round1(
                  updated[i].bh + removedTotal * (updated[i].bh / baseTotal),
                ),
              };
            }
          } else {
            const per = round1(removedTotal / updated.length);
            for (let i = 0; i < updated.length; i++) {
              updated[i] = {...updated[i], bh: per};
            }
          }
        }
        const existingIds = new Set(updated.map((s) => s.crewId));
        for (const c of crewIds) {
          if (!existingIds.has(c)) updated.push({crewId: c, bh: 0});
        }
        // Repair any drift introduced by redistribution.
        const sum = updated.reduce((a, s) => a + s.bh, 0);
        const drift = round1(visitTotalBH - sum);
        if (Math.abs(drift) >= 0.05 && updated.length > 0) {
          // Bias to the largest non-zero share; if all 0, bias to the first.
          let maxIdx = 0;
          for (let i = 1; i < updated.length; i++) {
            if (updated[i].bh > updated[maxIdx].bh) maxIdx = i;
          }
          updated[maxIdx] = {
            ...updated[maxIdx],
            bh: round1(updated[maxIdx].bh + drift),
          };
        }
        visitBHSplits[visitId] = {
          ...existing,
          totalBH: visitTotalBH,
          splits: updated,
          lastUpdatedAt: Date.now(),
        };
      } else {
        // Auto: always recompute against current headcount.
        visitBHSplits[visitId] = {
          visitId,
          totalBH: visitTotalBH,
          splits: buildHeadcountSplit(crewIds, visitTotalBH),
          splitMethod: "auto",
          lastUpdatedAt: Date.now(),
        };
      }
    }
    // Lookup helper used inside the per-crew loop. Returns the crew's
    // share of THIS visit's BH, falling back to the full visit total
    // when the visit is single-crew (no split record).
    const shareForCrew = (
      visitId: string,
      crewId: string,
      fallback: number,
    ): number => {
      const split = visitBHSplits[visitId];
      if (!split) return fallback;
      const slot = split.splits.find((s) => s.crewId === crewId);
      return slot ? slot.bh : 0;
    };

    // Compute timesheet totals per Jobber user. Closed shifts use
    // Jobber's finalDuration. Open shifts are flagged by
    // ticking: true with finalDuration: 0; for those we compute
    // running elapsed time from startAt to now so AH no longer
    // waits for clock-out before showing up. When the worker
    // clocks out, ticking flips to false and finalDuration stamps
    // the true total — the next sync overwrites the running value.
    const nowMs = Date.now();
    const openCount = timesheets.filter((t) => t.ticking === true).length;
    logger.info("timesheet_breakdown", {
      total: timesheets.length,
      open: openCount,
      closed: timesheets.length - openCount,
      date: targetDate,
    });
    const secondsByJobberUser = new Map<string, number>();
    for (const ts of timesheets) {
      let sec: number;
      if (ts.ticking === true) {
        const startMs = new Date(ts.startAt).getTime();
        sec = Number.isFinite(startMs) ?
          Math.max(0, (nowMs - startMs) / 1000) :
          0;
      } else {
        sec = typeof ts.finalDuration === "number" ?
          ts.finalDuration :
          0;
      }
      if (sec < MIN_TIMESHEET_SECONDS) continue;
      const prev = secondsByJobberUser.get(ts.user.id) || 0;
      secondsByJobberUser.set(ts.user.id, prev + sec);
    }
    logger.info("ah_attribution", {
      usersWithSeconds: secondsByJobberUser.size,
    });

    // Visit ID set used to reconcile existing rows against this sync.
    // Anything in this set is "still known to Jobber" (whether complete
    // or not); anything outside it is truly removed.
    const allJobberVisitIds = new Set(rawVisits.map((v) => v.id));

    // Track which Jobber users we matched so we can flag orphaned timesheets.
    const matchedJobberUsers = new Set<string>();

    // Build the new performance map for this date.
    const newPerformanceDay: Record<string, PerformanceLog> = {
      ...(performance[targetDate] || {}),
    };
    const crewsTouched = new Set<string>();

    interface AutoCreditEvent {
      targetDate: string;
      crewId: string;
      crewLabel: string;
      jobberVisitId: string;
      jobberJobId: string;
      jobTitle: string;
      priorPct: number;
      remainingPct: number;
      remainingBH: number;
    }
    const autoCreditEvents: AutoCreditEvent[] = [];

    // Iterate every crew on schedule (visits may be zero but workers exist).
    for (const crew of daySchedule) {
      const matched = visitsByCrew.get(crew.id) || [];
      const existing = newPerformanceDay[crew.id];

      if (existing && existing.approvalStatus === "approved") {
        if (matched.length > 0) {
          summary.entriesSkippedApproved++;
          const label =
            `${crew.division} #${crew.crewNumber}`;
          summary.warnings.push(
            `skipped_approved crew=${crew.id} (${label})`,
          );
          // Flag any visits that would have been auto-credited but
          // couldn't be because today's crew is already approved. Lookup
          // is per-visit; lawn flag no longer changes the warning gate.
          for (const mv of matched) {
            if (mv.isComplete && !mv.isHourly) {
              const mdj = multiDayJobs[mv.visit.id];
              if (mdj) {
                summary.warnings.push(
                  "auto_credit_blocked_approved " +
                  `visit=${mv.visit.id} crew=${crew.id} — ` +
                  "unapprove and re-sync",
                );
              }
            }
          }
        }
        continue;
      }

      const isNew = !existing;
      const base: PerformanceLog = existing ? {...existing} : {
        division: crew.division,
        crewNumber: crew.crewNumber,
        isAdHoc: false,
        jobs: [],
        employeeAH: {},
        deductions: {},
        approvalStatus: "pending",
      };
      base.jobs = (base.jobs || []).map((j) => ({...j}));
      base.employeeAH = {...(base.employeeAH || {})};

      // Map existing Jobber-sourced rows by visit id for fast lookup.
      const existingByVisit = new Map<string, number>();
      base.jobs.forEach((row, idx) => {
        if (row.source === "jobber" && row.jobberVisitId) {
          existingByVisit.set(row.jobberVisitId, idx);
        }
      });

      // Merge incoming visits: update existing rows, append new ones.
      for (const {
        visit, bh, isHourly, isComplete, desc, parsed, awaitingBhTag,
      } of matched) {
        const jobId = visit.job?.id;
        const jobNum = visit.job?.jobNumber;
        const idx = existingByVisit.get(visit.id);

        // === INCOMPLETE VISIT: not yet marked complete in Jobber ===
        // No more lawn-ghost branch. Lawn and non-lawn incomplete visits
        // take the same path: if the title parses a [BH] tag, we create
        // (or reuse) a per-visit ledger so the manager can optionally
        // mark partial % via the kebab. Without a parsed BH, the row is
        // a plain "Not Complete" placeholder contributing 0 BH.
        if (!isComplete) {
          // Hourly incomplete visits get a day-by-day hours model — no
          // ledger, no partial-review gate. Manager enters hours per day.
          const isHourlyIncomplete = !!parsed?.isHourly;

          let mdJobForIncomplete: MultiDayJob | undefined =
            multiDayJobs[visit.id];
          let partialCreditedBH = 0;
          let partialAwaitingReview = false;
          const eligibleForLedger = jobId && parsed && !isHourlyIncomplete;
          if (eligibleForLedger) {
            if (!mdJobForIncomplete) {
              mdJobForIncomplete = {
                jobberVisitId: visit.id,
                jobberJobId: jobId,
                jobberJobNumber: jobNum || "",
                title: desc,
                totalBH: parsed.bh,
                isLawnJob: false,
                manualOverride: false,
                completionHistory: [],
                status: "in_progress",
                firstSeenAt: Date.now(),
              };
              multiDayJobs[visit.id] = mdJobForIncomplete;
              summary.multiDayJobsCreated++;
            } else {
              mdJobForIncomplete.title = desc;
              if (jobNum) mdJobForIncomplete.jobberJobNumber = jobNum;
            }
            const currentCrewKeyIncomplete = stableCrewKey(crew);
            const histEntry = mdJobForIncomplete.completionHistory.find(
              (h) => h.targetDate === targetDate &&
                resolveEntryCrewKey(h) === currentCrewKeyIncomplete,
            );
            if (histEntry) {
              partialCreditedBH = histEntry.creditedBH;
              partialAwaitingReview = false;
            } else {
              partialCreditedBH = 0;
              partialAwaitingReview = true;
            }
          }

          // For multi-crew visits, the row's totalBH and credit basis are
          // the crew's share, not the visit total. Single-crew visits fall
          // back to the parsed visit BH unchanged.
          const myShare = parsed ?
            shareForCrew(visit.id, crew.id, parsed.bh) :
            0;
          if (idx === undefined) {
            const newRow: PerformanceJobRow = {
              desc,
              bh: partialCreditedBH,
              source: "jobber",
              jobberVisitId: visit.id,
              isIncompleteVisit: true,
            };
            if (jobNum) newRow.jobberJobNumber = jobNum;
            if (jobId) newRow.jobberJobId = jobId;
            if (parsed) newRow.totalBH = myShare;
            if (isHourlyIncomplete) {
              newRow.jobberTagType = "hourly";
            } else if (parsed && partialAwaitingReview) {
              newRow.awaitingCompletionReview = true;
            }
            base.jobs.push(newRow);
          } else {
            const row = base.jobs[idx];
            row.isIncompleteVisit = true;
            delete row.removedFromJobber;
            delete row.awaitingHourlyBH;
            if (jobNum) row.jobberJobNumber = jobNum;
            if (jobId) row.jobberJobId = jobId;
            row.desc = desc;
            if (parsed) row.totalBH = myShare;
            if (isHourlyIncomplete) {
              // Hourly incomplete: keep the manager-entered hours (row.bh)
              // intact across syncs, just keep the tag + clear stale flags.
              row.jobberTagType = "hourly";
              delete row.awaitingCompletionReview;
            } else if (eligibleForLedger) {
              row.bh = partialCreditedBH;
              if (partialAwaitingReview) {
                row.awaitingCompletionReview = true;
              } else {
                delete row.awaitingCompletionReview;
              }
            } else {
              // No parsed BH and no jobId — plain "Not Complete" placeholder.
              delete row.awaitingCompletionReview;
              row.bh = 0;
            }
          }
          continue;
        }

        // === HOURLY: manager enters BH manually ===
        if (isHourly) {
          const existingRow = idx !== undefined ? base.jobs[idx] : undefined;
          const prevTag = existingRow?.jobberTagType;
          const transitionedToHourly = prevTag === "bh";
          if (transitionedToHourly) {
            summary.warnings.push(
              `title_type_changed visit=${visit.id} from=bh to=hourly`,
            );
            // Multi-day and hourly are mutually exclusive. If the visit
            // had a per-visit ledger, scrub the completionHistory entries
            // matching this visit's date+crew so no stale credit lingers.
            const mdj = multiDayJobs[visit.id];
            if (mdj) {
              const before = mdj.completionHistory.length;
              const currentCrewKeyTypeCollision = stableCrewKey(crew);
              mdj.completionHistory = mdj.completionHistory.filter(
                (h) => !(h.targetDate === targetDate &&
                  resolveEntryCrewKey(h) === currentCrewKeyTypeCollision),
              );
              if (mdj.completionHistory.length !== before) {
                summary.warnings.push(
                  `type_collision_resolved visit=${visit.id} ` +
                  "from=multiday to=hourly — completionHistory cleared",
                );
              }
            }
          }
          if (idx === undefined) {
            const newRow: PerformanceJobRow = {
              desc,
              bh: 0,
              source: "jobber",
              jobberVisitId: visit.id,
              awaitingHourlyBH: true,
              jobberTagType: "hourly",
            };
            if (jobNum) newRow.jobberJobNumber = jobNum;
            if (jobId) newRow.jobberJobId = jobId;
            base.jobs.push(newRow);
          } else {
            const row = base.jobs[idx];
            delete row.removedFromJobber;
            delete row.isIncompleteVisit;
            delete row.awaitingCompletionReview;
            delete row.totalBH;
            if (jobNum) row.jobberJobNumber = jobNum;
            if (jobId) row.jobberJobId = jobId;
            row.desc = desc;
            row.jobberTagType = "hourly";
            if (transitionedToHourly) {
              // Title changed from BH-tag to [hourly] — reset for re-entry.
              row.bh = 0;
              row.awaitingHourlyBH = true;
              delete row.manuallyEditedAt;
            } else {
              // Already hourly. Preserve manager-entered BH if > 0.
              const enteredBH = Number(row.bh);
              if (Number.isFinite(enteredBH) && enteredBH > 0) {
                delete row.awaitingHourlyBH;
              } else {
                row.bh = 0;
                row.awaitingHourlyBH = true;
              }
            }
          }
          continue;
        }

        // === AWAITING BH TAG ===
        // Visit is complete in Jobber but has no parseable BH and no
        // recoverable totalBH from prior rows. Skip the multi-day
        // auto-credit path (would lock the job at 0 BH), and surface a
        // 0-BH row with awaitingBhTag set so the manager can fill the
        // value manually from the UI.
        if (awaitingBhTag) {
          if (idx === undefined) {
            const newRow: PerformanceJobRow = {
              desc,
              bh: 0,
              source: "jobber",
              jobberVisitId: visit.id,
              jobberTagType: "bh",
              awaitingBhTag: true,
            };
            if (jobNum) newRow.jobberJobNumber = jobNum;
            if (jobId) newRow.jobberJobId = jobId;
            base.jobs.push(newRow);
          } else {
            const row = base.jobs[idx];
            delete row.removedFromJobber;
            delete row.isIncompleteVisit;
            delete row.awaitingHourlyBH;
            delete row.awaitingCompletionReview;
            row.jobberTagType = "bh";
            row.awaitingBhTag = true;
            if (jobNum) row.jobberJobNumber = jobNum;
            if (jobId) row.jobberJobId = jobId;
            row.desc = desc;
            row.bh = 0;
          }
          continue;
        }

        // === COMPLETED BH VISIT ===
        // Per-visit ledger lookup. Lawn-vs-non-lawn no longer branches:
        // every completed BH visit takes the same path — open or create
        // multiDayJobs[visit.id], then auto-credit on completion.
        let mdJob: MultiDayJob | undefined = multiDayJobs[visit.id];

        // Diagnostic: log auto-credit eligibility for every completed
        // BH visit. Useful for tracing auto-credit behavior on real data.
        {
          const sortedHistDiag = mdJob ?
            [...mdJob.completionHistory].sort(
              (a, b) => a.targetDate.localeCompare(b.targetDate),
            ) :
            [];
          const priorPctDiag = sortedHistDiag.length > 0 ?
            sortedHistDiag[sortedHistDiag.length - 1].percentComplete :
            0;
          const currentCrewKeyDiag = stableCrewKey(crew);
          const alreadyTodayDiag = !!(mdJob && mdJob.completionHistory.find(
            (h) => h.targetDate === targetDate &&
              resolveEntryCrewKey(h) === currentCrewKeyDiag,
          ));
          const histLen = mdJob ? mdJob.completionHistory.length : 0;
          const manualOv = mdJob ? !!mdJob.manualOverride : false;
          summary.warnings.push(
            `autocredit_eval visit=${visit.id} jobId=${jobId || "?"} ` +
            `manualOverride=${manualOv} priorPct=${priorPctDiag} ` +
            `historyLen=${histLen} alreadyHasEntryToday=${alreadyTodayDiag} ` +
            `mdJobExists=${!!mdJob}`,
          );
        }

        let creditedBH = bh;
        let awaitingReview = false;
        // Crew's share of the visit's BH (= visit total for single-crew).
        const myCrewShare = shareForCrew(visit.id, crew.id, bh);
        // Dismissed multi-day visits are treated as one-shot Jobber
        // visits from here on. Skip ALL multi-day processing (no
        // metadata refresh, no auto-credit, no history writes) so a
        // manager's "Delete" stays sticky even when Jobber later flags
        // the visit complete. Existing completionHistory stays intact.
        if (jobId && mdJob && mdJob.dismissedCarryForward) {
          // Fall through with creditedBH = bh (one-shot visit credit).
        } else if (jobId) {
          if (!mdJob) {
            mdJob = {
              jobberVisitId: visit.id,
              jobberJobId: jobId,
              jobberJobNumber: jobNum || "",
              title: desc,
              totalBH: bh,
              isLawnJob: false,
              manualOverride: false,
              completionHistory: [],
              status: "in_progress",
              firstSeenAt: Date.now(),
            };
            multiDayJobs[visit.id] = mdJob;
            summary.multiDayJobsCreated++;
          } else {
            // Refresh cached title from current Jobber state every sync,
            // so a Jobber-side rename doesn't leave a stale display label.
            mdJob.title = desc;
            if (jobNum) mdJob.jobberJobNumber = jobNum;
            mdJob.totalBH = bh;
          }
          const currentCrewKeyAuto = stableCrewKey(crew);
          const histEntry = mdJob.completionHistory.find(
            (h) => h.targetDate === targetDate &&
              resolveEntryCrewKey(h) === currentCrewKeyAuto,
          );
          // Bug 1 fix: a stale partial entry (e.g., manager opened
          // "Mark Partial %" and saved 0%) used to short-circuit the
          // auto-credit-on-completion path, leaving the row at 0 BH
          // even after Jobber said complete. We now check whether the
          // job's cumulative % is < 100 — if so, overwrite today's
          // entry to 100% with the remaining BH.
          if (histEntry && histEntry.percentComplete >= 100) {
            creditedBH = histEntry.creditedBH;
            awaitingReview = false;
            summary.visitsAutoCredited++;
          } else {
            // Per-crew progress: priorPct is the latest entry FOR THIS
            // CREW before targetDate. Other crews on a multi-crew visit
            // progress independently and must not pollute this calc.
            // Per-crew progress using the STABLE crew identity, not the
            // per-day crew.id (which is regenerated on every crew row).
            // This is the structural fix for Bug 1: a Day 1 partial entry
            // by the same logical crew now matches Day 2's sync and feeds
            // the priorPct calc correctly, so remainingBH is the residual
            // (e.g. 35%) instead of the full 100%.
            const sortedMyHist = mdJob.completionHistory
              .filter((h) =>
                resolveEntryCrewKey(h) === currentCrewKeyAuto &&
                h.targetDate < targetDate)
              .sort((a, b) => a.targetDate.localeCompare(b.targetDate));
            const priorPct = sortedMyHist.length > 0 ?
              sortedMyHist[sortedMyHist.length - 1].percentComplete :
              0;
            if (priorPct < 100) {
              const remainingPct = 100 - priorPct;
              // Credit basis is THIS crew's share, not visit total.
              const remainingBH = Math.round(
                (remainingPct / 100) * myCrewShare * 10,
              ) / 10;
              const overwroteStale = !!histEntry;
              const stalePct = histEntry ? histEntry.percentComplete : 0;
              const noteSuffix = overwroteStale ?
                ` (overwrote stale ${stalePct}% entry)` :
                "";
              const autoEntry: CompletionEntry = {
                targetDate,
                percentComplete: 100,
                creditedBH: remainingBH,
                crewId: crew.id,
                crewKey: currentCrewKeyAuto,
                markedAt: Date.now(),
                markedBy: "system:auto-credit",
                markedByName: "Auto-credit on Jobber completion",
                isRetroactive: false,
                reasonNote:
                  `Auto-credited remaining ${remainingPct}% ` +
                  `on Jobber completion${noteSuffix}`,
              };
              if (histEntry) {
                // Overwrite in place to preserve list order.
                const idxHist = mdJob.completionHistory.indexOf(histEntry);
                mdJob.completionHistory[idxHist] = autoEntry;
              } else {
                mdJob.completionHistory.push(autoEntry);
              }
              mdJob.status = "complete";
              creditedBH = remainingBH;
              awaitingReview = false;
              summary.multiDayAutoCredited++;
              summary.visitsAutoCredited++;
              summary.warnings.push(
                `multiday_auto_credited visit=${visit.id} ` +
                `job=${jobNum || "?"} priorPct=${priorPct} ` +
                `remainingPct=${remainingPct} creditedBH=${remainingBH} ` +
                `crew=${crew.id}` +
                (overwroteStale ? " (overwrote stale partial)" : ""),
              );
              autoCreditEvents.push({
                targetDate,
                crewId: crew.id,
                crewLabel: `${crew.division} #${crew.crewNumber}`,
                jobberVisitId: visit.id,
                jobberJobId: jobId,
                jobTitle: mdJob.title,
                priorPct,
                remainingPct,
                remainingBH,
              });
            } else {
              mdJob.status = "complete";
              creditedBH = 0;
              awaitingReview = false;
              summary.visitsAutoCredited++;
            }
          }
        } else {
          summary.visitsAutoCredited++;
        }

        if (idx === undefined) {
          const newRow: PerformanceJobRow = {
            desc,
            bh: creditedBH,
            source: "jobber",
            jobberVisitId: visit.id,
            jobberTagType: "bh",
            // For a multi-crew visit, row.totalBH = THIS crew's share.
            // Single-crew rows: shareForCrew falls back to the visit total.
            totalBH: myCrewShare,
          };
          if (jobNum) newRow.jobberJobNumber = jobNum;
          if (jobId) newRow.jobberJobId = jobId;
          if (awaitingReview) newRow.awaitingCompletionReview = true;
          base.jobs.push(newRow);
        } else {
          const row = base.jobs[idx];
          const prevTag = row.jobberTagType;
          const transitionedFromHourly = prevTag === "hourly";
          if (transitionedFromHourly) {
            summary.warnings.push(
              `title_type_changed visit=${visit.id} from=hourly to=bh`,
            );
          }
          delete row.removedFromJobber;
          delete row.isIncompleteVisit;
          delete row.awaitingHourlyBH;
          delete row.awaitingBhTag;
          row.jobberTagType = "bh";
          if (jobNum) row.jobberJobNumber = jobNum;
          if (jobId) row.jobberJobId = jobId;
          row.totalBH = myCrewShare;
          if (awaitingReview) {
            row.awaitingCompletionReview = true;
          } else {
            delete row.awaitingCompletionReview;
          }
          // On hourly→bh transition, ignore manuallyEditedAt because the
          // previous "manual" entry was an hourly BH, not a BH override.
          if (
            !transitionedFromHourly &&
            row.manuallyEditedAt &&
            Number(row.bh) !== creditedBH
          ) {
            row.hasJobberConflict = true;
            row.jobberSuggestedValue = creditedBH;
          } else {
            row.bh = creditedBH;
            row.desc = desc;
            row.hasJobberConflict = false;
            delete row.jobberSuggestedValue;
            if (transitionedFromHourly) delete row.manuallyEditedAt;
          }
        }
      }

      // Reconcile pre-existing Jobber-sourced rows against this sync.
      //   - Visit in allJobberVisitIds → merge loop above handled it
      //     (lawn/multi-day/hourly/ghost branch).
      //   - Visit not in allJobberVisitIds → truly removed; flag the row
      //     so the manager can decide whether to keep or delete manually.
      // Manual rows (source !== "jobber") are never touched.
      for (const row of base.jobs) {
        if (row.source !== "jobber" || !row.jobberVisitId) continue;
        if (allJobberVisitIds.has(row.jobberVisitId)) continue;
        row.removedFromJobber = true;
        summary.visitsRemovedDeleted++;
      }

      // Worker AH sync: only WRITE when we found actual timesheet data
      // for that worker. Workers with no jobberUserId, or linked workers
      // with no clock-out in this sync, keep whatever AH was manually
      // entered. The frontend's missing-AH approval gate still blocks
      // approval on empty values, so visibility of "missing clock-out"
      // is preserved without us nuking manual entries.
      for (const empId of crew.employees || []) {
        const emp = employees.find((e) => e.id === empId);
        if (!emp || !emp.jobberUserId) continue;
        matchedJobberUsers.add(emp.jobberUserId);
        const sec = secondsByJobberUser.get(emp.jobberUserId) ?? null;
        if (sec != null && sec >= MIN_TIMESHEET_SECONDS) {
          base.employeeAH[empId] = Math.round((sec / 3600) * 10) / 10;
        }
        // else: linked worker but no timesheet for this date — leave
        //       base.employeeAH[empId] untouched (could be manual entry).
      }

      // Stamp the crew-size allowance snapshot for this crew-day.
      // size = scheduled roster minus the manager-curated removed
      // set; drop-in helpers (employeeAH keys not in crew.employees)
      // are deliberately NOT counted toward the bracket. Re-stamping
      // every sync for targetDate is fine because the scheduled
      // function only ever runs against "today" — once the date
      // turns over the value freezes.
      const removedSet = new Set(base.removedEmployees || []);
      const scheduledSize = (crew.employees || []).filter(
        (id) => !removedSet.has(id),
      ).length;
      const pct = pctForCrewSize(
        scheduledSize,
        appData.settings?.crewSizeAllowance,
      );
      base.crewSizeAllowance = {size: scheduledSize, pct};

      base.lastJobberSyncAt = summary.triggeredAt;
      newPerformanceDay[crew.id] = base;
      crewsTouched.add(crew.id);
      if (isNew) summary.entriesCreated++;
      else summary.entriesUpdated++;
    }

    summary.crewsAffected = crewsTouched.size;

    // Orphaned timesheets — users with hours but not on any crew today.
    for (const [jobberUserId, sec] of secondsByJobberUser) {
      if (matchedJobberUsers.has(jobberUserId)) continue;
      const linkedEmp = empByJobberUserId.get(jobberUserId);
      const label = linkedEmp ?
        `emp=${linkedEmp.id}` :
        `jobberUser=${jobberUserId}`;
      summary.warnings.push(
        `orphaned_timesheet ${label} seconds=${sec}`,
      );
    }

    // Carry-forward detection: multi-day jobs in progress on prior
    // days that don't have an entry on targetDate. Surfaces to the
    // frontend banner so manager can continue or skip.
    for (const [mdId, mdj] of Object.entries(multiDayJobs)) {
      if (mdj.status === "complete") continue;
      // Manager dismissed this visit's carry-forward tracking — never
      // emit candidates for it again.
      if (mdj.dismissedCarryForward) continue;
      if (mdj.completionHistory.length === 0) continue;
      const hasToday = mdj.completionHistory.some(
        (h) => h.targetDate === targetDate,
      );
      if (hasToday) continue;
      const sortedHist = [...mdj.completionHistory]
        .sort((a, b) => a.targetDate.localeCompare(b.targetDate));
      const latest = sortedHist[sortedHist.length - 1];
      if (latest.targetDate >= targetDate) continue;
      if (latest.percentComplete >= 100) continue;
      const remainingBH = Math.round(
        ((100 - latest.percentComplete) / 100) * mdj.totalBH * 10,
      ) / 10;
      summary.carryForwardCandidates.push({
        // Keyed by visit — a multi-day visit spanning Mon–Wed reuses the
        // same id on each carry-forward continuation (no fresh visit id).
        jobberVisitId: mdId,
        jobberJobId: mdj.jobberJobId,
        jobTitle: mdj.title,
        priorDate: latest.targetDate,
        priorCrewId: latest.crewId,
        priorCumulativePct: latest.percentComplete,
        remainingBH,
        totalBH: mdj.totalBH,
      });
    }

    // Write performance for this date + the full multiDayJobs map.
    // Auto-move cleanups touch prior days' performance maps via dot-path
    // updates so the source-day rows get ghosted or removed in the same
    // round-trip. Other top-level fields are untouched.
    const writeUpdates: Record<string, unknown> = {
      [`performance.${targetDate}`]: newPerformanceDay,
      multiDayJobs,
      visitBHSplits,
    };
    // Stamp the schema version so the migration runs exactly once.
    if (needsMultiDayMigration) {
      writeUpdates["__multiDayKeyVersion"] = 2;
    }
    for (const [d, dayMap] of Object.entries(cleanupPerformanceByDate)) {
      writeUpdates[`performance.${d}`] = dayMap;
    }
    await appDataRef.update(writeUpdates);

    // Write audit entries for auto-credit events. Fire-and-forget; an
    // audit failure must not block the sync result.
    if (autoCreditEvents.length > 0) {
      const auditCol = db.collection(
        `artifacts/${APP_ID}/private/data/performanceActivityLog`,
      );
      await Promise.all(autoCreditEvents.map(async (e) => {
        try {
          await auditCol.add({
            type: "multiday_auto_credited_on_completion",
            timestamp: Date.now(),
            userId: "system:auto-credit",
            userName: "Auto-credit on Jobber completion",
            userRole: "admin",
            targetDate: e.targetDate,
            crewId: e.crewId,
            crewLabel: e.crewLabel,
            jobberJobId: e.jobberJobId,
            sourceJobberVisitId: e.jobberVisitId,
            jobTitle: e.jobTitle,
            valueBefore: e.priorPct,
            valueAfter: 100,
            valueLabel: "%",
            reasonNote:
              `Auto-credited ${e.remainingPct}% ` +
              `(${e.remainingBH} BH) on Jobber completion`,
          });
        } catch (err) {
          logger.warn("auto-credit audit write failed", {
            error: err instanceof Error ? err.message : String(err),
            event: e,
          });
        }
      }));
    }

    if (autoMoveEvents.length > 0) {
      const auditCol = db.collection(
        `artifacts/${APP_ID}/private/data/performanceActivityLog`,
      );
      await Promise.all(autoMoveEvents.map(async (e) => {
        try {
          await auditCol.add({
            type: "visit_auto_moved_on_completion",
            timestamp: Date.now(),
            userId: "system:auto-move",
            userName: "Auto-move on Jobber completion",
            userRole: "admin",
            targetDate: e.destDate,
            crewId: e.sourceCrewId,
            crewLabel: e.sourceCrewLabel,
            jobberJobId: e.jobId || undefined,
            jobTitle: e.jobTitle,
            sourceJobberVisitId: e.visitId,
            reason: e.ghosted ? "ghosted_locked_day" : "moved",
            reasonNote:
              e.ghosted ?
                `Source ${e.sourceDate} approved — left ghost row, ` +
                `credit on ${e.destDate}` :
                `Moved from ${e.sourceDate} to ${e.destDate} ` +
                "on Jobber completion",
          });
        } catch (err) {
          logger.warn("auto-move audit write failed", {
            error: err instanceof Error ? err.message : String(err),
            event: e,
          });
        }
      }));
    }

    logger.info("Jobber performance sync complete", {
      targetDate,
      visits: summary.visitsProcessed,
      crews: summary.crewsAffected,
      triggeredBy,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("Jobber performance sync failed", {error: msg, targetDate});
    summary.errors.push(msg);
  }

  try {
    await db.collection(SYNC_LOG_COLLECTION).add(summary);
  } catch (e) {
    logger.error("Failed to write syncLog entry", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  if (summary.errors.length > 0) {
    throw new HttpsError("internal", summary.errors[0]);
  }

  return summary;
}

export const jobberSyncPerformance = onCall(
  {
    region: REGION,
    secrets: [JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET],
    timeoutSeconds: 540,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    // TODO: server-side admin/manager verification — currently trusts the
    // client-side canTriggerJobberSync gate.

    const raw = (request.data ?? {}) as {targetDate?: string};
    const rawDate = typeof raw.targetDate === "string" ? raw.targetDate : "";
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(rawDate);
    const targetDate = dateOk ? rawDate : formatYesterdayInToronto();

    const result = await runPerformanceSync({
      targetDate,
      triggeredBy: "manual",
      triggeredByUserId: request.auth.uid,
    });
    return result;
  },
);

export const jobberSyncPerformanceScheduled = onSchedule(
  {
    region: REGION,
    schedule: "0,15,30,45 6-23 * * *",
    timeZone: TIMEZONE,
    secrets: [JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET],
    timeoutSeconds: 540,
  },
  async () => {
    const today = formatTodayInToronto();
    await runPerformanceSync({
      targetDate: today,
      triggeredBy: "scheduled",
      triggeredByUserId: null,
    });
  },
);

// JOB TIMING — per-visit labour hours from Jobber visit timers, stored one
// record per visit in the ROOT collection `jobTimings` (not appData/main: this
// grows with every timed visit).
//
// Three writers, one set of rules (jobTimingCore):
//   1. The performance sync, every cycle, for the day it just synced. It
//      already fetched that day's timesheets; asking each entry for its
//      target visit id costs ~150 requested / ~20 actual points per page.
//      Runs AFTER the performance write, behind a budget floor, and never
//      fails the sync.
//   2. The NIGHTLY pass, which re-reads every timer since the season started.
//      The regular sync only sees the day it syncs, so an entry edited in
//      Jobber a week later would otherwise never be picked up.
//   3. The one-time BACKFILL — the nightly pass run by hand.
//
// A separate measurement for repricing. Nothing here feeds pay, bonus or
// crew-day BH/AH/efficiency.

import {HttpsError} from "firebase-functions/v2/https";
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
import {parseBh} from "./bhParser.js";
import {torontoBoundariesIso, torontoYmd} from "./torontoDay.js";
import {
  buildRecord,
  computeLabour,
  DayCrew,
  groupByVisitDay,
  JobTimingRecord,
  pickCrews,
  VisitDayTiming,
  VisitDetails,
  VisitTimerEntry,
} from "./jobTimingCore.js";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const APP_ID = "crewmaster";
const APP_DATA_DOC = `artifacts/${APP_ID}/public/data/appData/main`;
const SCHEDULE_MONTHS = `artifacts/${APP_ID}/public/data/scheduleMonths`;
export const JOB_TIMING_COLLECTION = "jobTimings";
const JOB_TIMING_RUNS = "jobTimingRuns";
const TIMEZONE = "America/Toronto";
// The season starts in spring; the nightly pass re-reads from here.
const SEASON_START_MMDD = "04-01";
const DETAIL_BATCH = 20;
const PAGE_DELAY_MS = 250;
// The per-cycle step only fetches visit details when at least this much of
// the Jobber budget is left after the performance sync — it gives way.
const CYCLE_BUDGET_FLOOR = 3000;
// The nightly pass keeps this much in the bucket at all times, pausing to
// let it refill, so a manual sync at night still has room.
const NIGHTLY_BUDGET_FLOOR = 5000;

const docId = (visitId: string): string => encodeURIComponent(visitId);

// Appended to the performance sync's timesheet query. Only the visit id —
// the details come from one small aliased query for visits not yet stored.
export const TIMER_TARGET_FIELDS =
  "targetItem { __typename ... on Visit { id } }";

export interface TimesheetWithTarget {
  id: string;
  ticking: boolean;
  finalDuration: number | null;
  startAt: string;
  endAt: string | null;
  user: {id: string; name: {full: string}};
  targetItem?: {__typename: string; id?: string} | null;
}

interface ScheduleCrew {
  id: string;
  division: string;
  crewNumber: number;
  employees?: string[];
  jobberAssigneeIds?: string[];
}
interface Emp {
  id: string;
  name?: string;
  jobberUserId?: string;
  isTestUser?: boolean;
}
interface ScheduleContext {
  schedules: Record<string, ScheduleCrew[]>;
  employees: Emp[];
  absences: Record<string, string[]>;
}

type StoredRecord = JobTimingRecord & {
  details: VisitDetails;
  updatedAt: number;
  updatedBy: "sync" | "nightly" | "backfill";
};

const VISIT_DETAIL_FIELDS = `id title startAt isComplete
  job { id jobNumber title jobType }
  client { id name tags(first: 10) { nodes { label } } }
  property { id address { street city } }
  assignedUsers(first: 10) { nodes { id } }
  lineItems(first: 5) { nodes { name } }`;

const SEASON_TIMESHEETS_QUERY = `query SeasonTimers(
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
      id ticking finalDuration startAt endAt
      user { id name { full } }
      ${TIMER_TARGET_FIELDS}
    }
    pageInfo { endCursor hasNextPage }
  }
}`;

/**
 * Stable crew identity — same format as the performance sync's
 * stableCrewKey and the frontend's.
 * @param {ScheduleCrew} c Crew.
 * @return {string} "<division-lower>-<crewNumber>".
 */
function crewKey(c: ScheduleCrew): string {
  return `${(c.division || "").trim().toLowerCase()}-${c.crewNumber}`;
}

/**
 * Crews on the schedule for one day, with their present members.
 * @param {ScheduleContext} ctx Schedules / employees / absences.
 * @param {string} date YYYY-MM-DD.
 * @return {Array} Day crews with assignee ids.
 */
function dayCrewsFor(
  ctx: ScheduleContext,
  date: string,
): Array<DayCrew & {assigneeIds: string[]}> {
  const empById = new Map(ctx.employees.map((e) => [e.id, e]));
  const absent = new Set(ctx.absences[date] || []);
  return (ctx.schedules[date] || []).map((c) => ({
    key: crewKey(c),
    label: `${c.division} #${c.crewNumber}`,
    division: c.division,
    assigneeIds: c.jobberAssigneeIds || [],
    members: (c.employees || [])
      .filter((id) => !absent.has(id) && !empById.get(id)?.isTestUser)
      .map((id) => ({
        empId: id,
        jobberUserId: empById.get(id)?.jobberUserId || null,
        name: empById.get(id)?.name || id,
      })),
  }));
}

/**
 * Schedules, roster and absences, reaching into the archived month sheets
 * for any month no longer on the appData doc.
 * @param {string[]} dates Dates that need a schedule.
 * @param {object} [live] appData fields already in memory (sync path).
 * @return {Promise<ScheduleContext>} Context.
 */
async function loadScheduleContext(
  dates: string[],
  live?: {
    schedules?: Record<string, ScheduleCrew[]>;
    employees?: Emp[];
    dailyAbsences?: Record<string, string[]>;
  },
): Promise<ScheduleContext> {
  let base = live;
  if (!base) {
    const snap = await db.doc(APP_DATA_DOC).get();
    base = (snap.data() || {}) as typeof live;
  }
  const schedules: Record<string, ScheduleCrew[]> = {
    ...(base?.schedules || {}),
  };
  const missingMonths = new Set(
    dates.filter((d) => !schedules[d]).map((d) => d.slice(0, 7)),
  );
  for (const ym of missingMonths) {
    const s = await db.doc(`${SCHEDULE_MONTHS}/${ym}`).get();
    const days = (s.data()?.days || {}) as Record<string, ScheduleCrew[]>;
    for (const [d, crews] of Object.entries(days)) {
      if (!schedules[d]) schedules[d] = crews;
    }
  }
  return {
    schedules,
    employees: base?.employees || [],
    absences: base?.dailyAbsences || {},
  };
}

/**
 * Current Jobber access token, refreshing when needed.
 * @return {Promise<string>} A usable bearer token.
 */
async function getValidAccessToken(): Promise<string> {
  const snap = await db.doc(JOBBER_AUTH_DOC).get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "Jobber is not connected.");
  }
  const auth = snap.data() as {
    accessToken: string; accessTokenExpiresAt: number | null;
  };
  const exp = auth.accessTokenExpiresAt;
  if (typeof exp === "number" && exp > Date.now() + 60_000) {
    return auth.accessToken;
  }
  const refreshed = await refreshJobberAccessToken();
  if (!refreshed) {
    throw new HttpsError("failed-precondition", "Jobber token refresh failed.");
  }
  return refreshed.access_token;
}

/**
 * Waits for the Jobber bucket to refill above a floor.
 * @param {JobberClient} client Client (last throttle status).
 * @param {number} floor Points to keep in reserve.
 * @return {Promise<void>} Resolves once there is room.
 */
async function yieldBudget(client: JobberClient, floor: number) {
  const t = client.getLastThrottleStatus();
  const avail = t?.currentlyAvailable;
  if (typeof avail !== "number" || avail >= floor) return;
  const rate = t?.restoreRate && t.restoreRate > 0 ? t.restoreRate : 500;
  const ms = Math.ceil(((floor + 2000 - avail) / rate) * 1000);
  await sleep(Math.min(ms, 30_000));
}

/**
 * Visit details in aliased batches. A batch that errors (e.g. one visit
 * deleted in Jobber) is retried one visit at a time so a single bad id
 * can't cost the other nineteen.
 * @param {JobberClient} client Jobber client.
 * @param {string[]} ids Visit ids.
 * @param {number} floor Budget floor to respect between requests.
 * @return {Promise<Map<string, VisitDetails>>} Found visits.
 */
async function fetchVisitDetails(
  client: JobberClient,
  ids: string[],
  floor: number,
): Promise<Map<string, VisitDetails>> {
  const out = new Map<string, VisitDetails>();
  const run = async (chunk: string[]) => {
    const q = "query VisitTimingDetails {" + chunk.map((id, i) =>
      `v${i}: visit(id: ${JSON.stringify(id)}) { ${VISIT_DETAIL_FIELDS} }`,
    ).join("\n") + "}";
    const data = (await client.fetch(q, {})) as
      Record<string, VisitDetails | null>;
    chunk.forEach((id, i) => {
      const v = data?.[`v${i}`];
      if (v) out.set(id, v);
    });
  };
  for (let i = 0; i < ids.length; i += DETAIL_BATCH) {
    const chunk = ids.slice(i, i + DETAIL_BATCH);
    await yieldBudget(client, floor);
    try {
      await run(chunk);
    } catch {
      for (const id of chunk) {
        try {
          await yieldBudget(client, floor);
          await run([id]);
        } catch (e) {
          logger.warn("job_timing_visit_detail_failed", {
            visitId: id, error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
    await sleep(PAGE_DELAY_MS);
  }
  return out;
}

/**
 * Visit-targeted entries only, flattened with their visit id. Plain day
 * clock-ins (no target) and job/assessment targets are ignored here.
 * @param {TimesheetWithTarget[]} ts Timesheet nodes.
 * @return {Array} Entries with visitId.
 */
function visitEntries(
  ts: TimesheetWithTarget[],
): Array<VisitTimerEntry & {visitId: string}> {
  const out: Array<VisitTimerEntry & {visitId: string}> = [];
  for (const t of ts) {
    if (t.targetItem?.__typename !== "Visit" || !t.targetItem.id) continue;
    out.push({
      visitId: t.targetItem.id,
      entryId: t.id,
      userId: t.user.id,
      userName: t.user.name?.full || t.user.id,
      startAt: t.startAt,
      endAt: t.endAt,
      ticking: t.ticking === true,
      finalDuration: t.finalDuration,
    });
  }
  return out;
}

/**
 * One visit-day's timing: crew picked from THAT day's schedule, then the
 * labour rules.
 * @param {ScheduleContext} ctx Schedule context.
 * @param {string} date Day the timers started.
 * @param {VisitTimerEntry[]} entries That day's entries.
 * @param {string[]} assigneeIds Visit assignees.
 * @return {VisitDayTiming | null} Timing or null if nothing measurable.
 */
function timeVisitDay(
  ctx: ScheduleContext,
  date: string,
  entries: VisitTimerEntry[],
  assigneeIds: string[],
): VisitDayTiming | null {
  const {crews, source} = pickCrews(
    dayCrewsFor(ctx, date), assigneeIds, entries.map((e) => e.userId),
  );
  const t = computeLabour(entries, crews);
  return t ? {...t, date, crewSource: source} : null;
}

const parseVisitBh = (v: VisitDetails) =>
  parseBh(v.title) || parseBh(v.job?.title);

/**
 * Stable comparison of a record, ignoring bookkeeping fields, so unchanged
 * visits aren't rewritten every night.
 * @param {object | undefined} r Record.
 * @return {string} Comparable form.
 */
function sig(r: Partial<StoredRecord> | undefined): string {
  if (!r) return "";
  const {updatedAt: _a, updatedBy: _b, ...rest} = r;
  void _a; void _b;
  return JSON.stringify(rest, Object.keys(flatKeys(rest)).sort());
}
/**
 * Every key at any depth (for a key-sorted JSON.stringify).
 * @param {unknown} o Value.
 * @param {object} acc Accumulator.
 * @return {object} Keys as an object.
 */
function flatKeys(o: unknown, acc: Record<string, true> = {}) {
  if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      acc[k] = true;
      flatKeys(v, acc);
    }
  }
  return acc;
}

/**
 * Firestore rejects `undefined`; the records only ever hold plain JSON.
 * @param {T} v Value.
 * @return {T} JSON-clean copy.
 */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ─────────────────────────────────────────────────────────────────────────
// 1. PER-CYCLE — called by the performance sync for the day it synced.
// ─────────────────────────────────────────────────────────────────────────

export interface CycleTimingResult {
  timedVisits: number;
  written: number;
  removedDays: number;
  skippedRunning: number;
  deferredNoBudget: number;
  detailFetches: number;
}

/**
 * Updates the job-timing records for one day from timesheets the
 * performance sync already fetched.
 * @param {object} args Inputs from the sync.
 * @return {Promise<CycleTimingResult>} What changed.
 */
export async function runJobTimingForDay(args: {
  client: JobberClient;
  targetDate: string;
  timesheets: TimesheetWithTarget[];
  knownVisits: Array<{
    id: string; title: string | null;
    job: {id: string; title: string | null} | null;
    assignedUsers?: {nodes: Array<{id: string}>};
  }>;
  live: {
    schedules?: Record<string, ScheduleCrew[]>;
    employees?: Emp[];
    dailyAbsences?: Record<string, string[]>;
  };
}): Promise<CycleTimingResult> {
  const {client, targetDate} = args;
  const res: CycleTimingResult = {
    timedVisits: 0, written: 0, removedDays: 0, skippedRunning: 0,
    deferredNoBudget: 0, detailFetches: 0,
  };
  const col = db.collection(JOB_TIMING_COLLECTION);
  const groups = groupByVisitDay(visitEntries(args.timesheets));
  res.timedVisits = groups.size;

  // Existing records: those timed today, plus any record that CLAIMS today
  // — an entry deleted or re-pointed in Jobber must drop off its old visit.
  const byId = new Map<string, StoredRecord>();
  const ids = [...groups.keys()];
  for (let i = 0; i < ids.length; i += 300) {
    const refs = ids.slice(i, i + 300).map((id) => col.doc(docId(id)));
    if (refs.length === 0) continue;
    for (const s of await db.getAll(...refs)) {
      if (s.exists) {
        const r = s.data() as StoredRecord;
        byId.set(r.visitId, r);
      }
    }
  }
  const claiming = await col.where("dayList", "array-contains", targetDate)
    .get();
  for (const s of claiming.docs) {
    const r = s.data() as StoredRecord;
    if (!byId.has(r.visitId)) byId.set(r.visitId, r);
  }

  // Details only for visits never stored. Title / assignees are refreshed
  // from the visits the sync already has in hand.
  const need = ids.filter((id) => !byId.has(id));
  const fetched = new Map<string, VisitDetails>();
  if (need.length > 0) {
    const avail = client.getLastThrottleStatus()?.currentlyAvailable;
    if (typeof avail === "number" && avail < CYCLE_BUDGET_FLOOR) {
      res.deferredNoBudget = need.length;
    } else {
      const got = await fetchVisitDetails(client, need, CYCLE_BUDGET_FLOOR);
      res.detailFetches = need.length;
      for (const [k, v] of got) fetched.set(k, v);
    }
  }
  const known = new Map(args.knownVisits.map((v) => [v.id, v]));
  const ctx = await loadScheduleContext([targetDate], args.live);

  const batch = db.batch();
  let ops = 0;
  const allIds = new Set([...ids, ...byId.keys()]);
  for (const visitId of allIds) {
    const prev = byId.get(visitId);
    let details = prev?.details || fetched.get(visitId);
    if (!details) continue; // deferred — next cycle or tonight
    const k = known.get(visitId);
    if (k) {
      details = {
        ...details,
        title: k.title,
        job: details.job ? {...details.job, title: k.job?.title ?? null} :
          details.job,
        assignedUsers: k.assignedUsers || details.assignedUsers,
      };
    }
    const g = groups.get(visitId);
    if (g?.ticking.has(targetDate)) {
      res.skippedRunning++;
      continue; // running timer: leave today alone until it stops
    }
    const days: Record<string, VisitDayTiming> = {...(prev?.days || {})};
    const hadToday = !!days[targetDate];
    delete days[targetDate];
    const todays = g?.days.get(targetDate);
    if (todays) {
      const t = timeVisitDay(
        ctx, targetDate, todays,
        (details.assignedUsers?.nodes || []).map((n) => n.id),
      );
      if (t) days[targetDate] = t;
    }
    if (hadToday && !days[targetDate]) res.removedDays++;
    const rec = buildRecord(details, days, parseVisitBh(details));
    const ref = col.doc(docId(visitId));
    if (!rec) {
      if (prev) {
        batch.delete(ref);
        ops++;
      }
      continue;
    }
    const next: StoredRecord = clean({
      ...rec, details, updatedAt: Date.now(), updatedBy: "sync",
    });
    if (sig(next) === sig(prev)) continue;
    batch.set(ref, next);
    ops++;
    res.written++;
  }
  if (ops > 0) await batch.commit();
  return res;
}

// ─────────────────────────────────────────────────────────────────────────
// 2/3. NIGHTLY PASS + BACKFILL — re-read every timer since the season began.
// ─────────────────────────────────────────────────────────────────────────

export interface SeasonTimingResult {
  since: string;
  entries: number;
  visitEntries: number;
  timedVisits: number;
  written: number;
  unchanged: number;
  deleted: number;
  noDetails: number;
  pages: number;
  byCrew: Record<string, number>;
  byQuality: Record<string, number>;
  ms: number;
}

/**
 * Re-reads every visit timer since the season started and rebuilds the
 * records. Idempotent: unchanged records are not rewritten.
 * @param {"nightly" | "backfill"} mode Who ran it (stored on records).
 * @param {string} [sinceOverride] YYYY-MM-DD start (default: season start).
 * @return {Promise<SeasonTimingResult>} Summary.
 */
export async function runJobTimingSeason(
  mode: "nightly" | "backfill",
  sinceOverride?: string,
): Promise<SeasonTimingResult> {
  const t0 = Date.now();
  const today = torontoYmd(new Date());
  const since = sinceOverride || `${today.slice(0, 4)}-${SEASON_START_MMDD}`;
  const client = makeJobberClient(await getValidAccessToken());

  // All timers since the season start, paged, yielding to the budget floor.
  const after = torontoBoundariesIso(since).after;
  const before = torontoBoundariesIso(today).before;
  const all: TimesheetWithTarget[] = [];
  let cursor: string | null = null;
  let pages = 0;
  for (let i = 0; i < 2000; i++) {
    await yieldBudget(client, NIGHTLY_BUDGET_FLOOR);
    const data = (await client.fetch(SEASON_TIMESHEETS_QUERY, {
      after, before, cursor,
    })) as {
      timeSheetEntries: {
        nodes: TimesheetWithTarget[];
        pageInfo: {endCursor: string | null; hasNextPage: boolean};
      };
    };
    pages++;
    all.push(...data.timeSheetEntries.nodes);
    if (!data.timeSheetEntries.pageInfo.hasNextPage) break;
    cursor = data.timeSheetEntries.pageInfo.endCursor;
    await sleep(PAGE_DELAY_MS);
  }
  const ve = visitEntries(all);
  const groups = groupByVisitDay(ve);
  const ids = [...groups.keys()];
  const details = await fetchVisitDetails(client, ids, NIGHTLY_BUDGET_FLOOR);

  const dates = [...new Set(
    [...groups.values()].flatMap((g) => [...g.days.keys()]),
  )];
  const ctx = await loadScheduleContext(dates);

  const col = db.collection(JOB_TIMING_COLLECTION);
  const existing = new Map<string, StoredRecord>();
  for (const s of (await col.get()).docs) {
    const r = s.data() as StoredRecord;
    existing.set(r.visitId, r);
  }

  const res: SeasonTimingResult = {
    since, entries: all.length, visitEntries: ve.length,
    timedVisits: ids.length, written: 0, unchanged: 0, deleted: 0,
    noDetails: 0, pages, byCrew: {}, byQuality: {}, ms: 0,
  };
  let batch = db.batch();
  let ops = 0;
  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  const timedIds = new Set<string>();
  for (const visitId of ids) {
    const g = groups.get(visitId);
    if (!g) continue;
    const prev = existing.get(visitId);
    const d = details.get(visitId) || prev?.details;
    if (!d) {
      res.noDetails++;
      continue;
    }
    const assignees = (d.assignedUsers?.nodes || []).map((n) => n.id);
    const days: Record<string, VisitDayTiming> = {};
    for (const [date, entries] of g.days) {
      if (g.ticking.has(date)) {
        // Still running: keep whatever was stored for that day.
        if (prev?.days?.[date]) days[date] = prev.days[date];
        continue;
      }
      const t = timeVisitDay(ctx, date, entries, assignees);
      if (t) days[date] = t;
    }
    const rec = buildRecord(d, days, parseVisitBh(d));
    const ref = col.doc(docId(visitId));
    if (!rec) {
      if (prev) {
        batch.delete(ref);
        ops++;
        res.deleted++;
      }
      continue;
    }
    timedIds.add(visitId);
    res.byCrew[rec.crewLabel || "no crew"] =
      (res.byCrew[rec.crewLabel || "no crew"] || 0) + 1;
    res.byQuality[rec.quality] = (res.byQuality[rec.quality] || 0) + 1;
    const next: StoredRecord = clean({
      ...rec, details: d, updatedAt: Date.now(), updatedBy: mode,
    });
    if (sig(next) === sig(prev)) {
      res.unchanged++;
      continue;
    }
    batch.set(ref, next);
    ops++;
    res.written++;
    if (ops >= 400) await flush();
  }
  // Records from this season whose timers are gone from Jobber altogether.
  for (const [visitId, r] of existing) {
    if (groups.has(visitId)) continue;
    if ((r.lastDate || r.date || "") < since) continue;
    batch.delete(col.doc(docId(visitId)));
    ops++;
    res.deleted++;
    if (ops >= 400) await flush();
  }
  await flush();
  try {
    await writeCoverage(timedIds, since);
  } catch (e) {
    logger.warn("job_timing_coverage_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  res.ms = Date.now() - t0;
  await db.collection(JOB_TIMING_RUNS).add({
    ...res, mode, finishedAt: Date.now(),
  });
  logger.info("job_timing_season", res);
  return res;
}

/**
 * COVERAGE BY CREW — of each crew's completed Jobber visits (the rows the
 * performance sync credited), how many were timed. Written per crew-day so
 * the admin view can filter by date. Reads the performance rows; writes
 * only jobTimingMeta/coverage.
 * @param {Set<string>} timedIds Visits with a timer on them this season.
 * @param {string} since Season start (YYYY-MM-DD).
 * @return {Promise<void>} Resolves once written.
 */
async function writeCoverage(timedIds: Set<string>, since: string) {
  type Row = {
    source?: string; jobberVisitId?: string; isIncompleteVisit?: boolean;
    removedFromJobber?: boolean; movedToDate?: string;
    ghostFromVisitId?: string;
  };
  type Log = {division?: string; crewNumber?: number; jobs?: Row[]};
  const perf: Record<string, Record<string, Log>> = {};
  const main = (await db.doc(APP_DATA_DOC).get()).data() || {};
  const months = await db
    .collection(`artifacts/${APP_ID}/public/data/performanceMonths`).get();
  for (const m of months.docs) {
    if (m.id < since.slice(0, 7)) continue;
    Object.assign(perf, (m.data().days || {}) as typeof perf);
  }
  Object.assign(perf, (main.performance || {}) as typeof perf);
  const byCrew: Record<string, {
    label: string; division: string; days: Record<string, [number, number]>;
  }> = {};
  for (const [date, dayMap] of Object.entries(perf)) {
    if (date < since) continue;
    for (const log of Object.values(dayMap || {})) {
      if (!log?.division || log.crewNumber == null) continue;
      const key = crewKey(log as ScheduleCrew);
      const seen = new Set<string>();
      for (const r of log.jobs || []) {
        if (r.source !== "jobber" || !r.jobberVisitId) continue;
        if (r.isIncompleteVisit || r.removedFromJobber) continue;
        if (r.movedToDate || r.ghostFromVisitId) continue;
        seen.add(r.jobberVisitId);
      }
      if (seen.size === 0) continue;
      const c = byCrew[key] || (byCrew[key] = {
        label: `${log.division} #${log.crewNumber}`,
        division: log.division, days: {},
      });
      const timed = [...seen].filter((id) => timedIds.has(id)).length;
      const prev = c.days[date] || [0, 0];
      c.days[date] = [prev[0] + seen.size, prev[1] + timed];
    }
  }
  await db.doc("jobTimingMeta/coverage").set({
    since, computedAt: Date.now(), byCrew,
  });
}

// 02:40 Toronto — well clear of the performance sync (06:00–23:45) and the
// capacity forecasts (06:18 / 06:33), so it never competes for the budget
// with them.
export const jobberJobTimingNightly = onSchedule(
  {
    region: "us-central1",
    schedule: "40 2 * * *",
    timeZone: TIMEZONE,
    secrets: [JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET],
    timeoutSeconds: 1800,
    memory: "512MiB",
  },
  async () => {
    await runJobTimingSeason("nightly");
  },
);

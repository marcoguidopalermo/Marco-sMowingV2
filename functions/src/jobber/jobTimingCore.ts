// JOB TIMING — pure math. Turns Jobber visit timers into labour hours for
// ONE visit on ONE day, without double-counting.
//
// No Firestore, no Jobber client: everything in here is data in → data out,
// so the rules can be tested against real shapes (see jobTimingCore.test.ts).
//
// This is a SEPARATE MEASUREMENT for repricing. Nothing here feeds pay, bonus
// or crew-day BH/AH/efficiency — those keep reading employeeAH and the
// performance rows exactly as before.

import {torontoYmd} from "./torontoDay.js";

// Same noise floor the performance sync uses for timesheets: a timer started
// and stopped inside a minute is an accidental tap, not work.
export const MIN_TIMER_SECONDS = 60;

export interface VisitTimerEntry {
  entryId: string;
  userId: string; // Jobber user id of whoever ran the timer
  userName: string;
  startAt: string;
  endAt: string | null;
  ticking: boolean;
  finalDuration: number | null;
}

export interface DayCrew {
  id: string; // that day's schedule crew id (what visitBHSplits is keyed by)
  key: string; // stable "<division-lower>-<crewNumber>"
  label: string; // "Lawn Division #3"
  division: string;
  // Present crew members that day (absent + test users already removed).
  members: Array<{empId: string; jobberUserId: string | null; name: string}>;
}

export type TimingQuality = "full" | "estimate";

export interface PersonTime {
  userId: string;
  name: string;
  hours: number;
  start: string;
  end: string;
  onCrew: boolean;
}

export interface VisitDayTiming {
  date: string;
  crewKeys: string[];
  crewLabel: string;
  division: string;
  crewSize: number; // scheduled present crew members
  headcount: number; // crewSize + anyone off-crew who timed it
  labourHours: number;
  method: string; // "all timed" | "1 × 2" | "span × 3" (+ " + 1 extra")
  quality: TimingQuality;
  spanHours: number;
  people: PersonTime[];
  entryIds: string[];
  crewSource: "assignee" | "timer" | "none";
  // Visits assigned to 2+ crews: the BH is split between crews (the
  // performance sync's split) and each crew that timed it is measured on its
  // own. Crews that didn't time it are left out, not estimated.
  multiCrew?: MultiCrewDay;
}

export interface MultiCrewDay {
  assigned: number;
  timed: number;
  splitSource: "sync" | "headcount";
  bhShare: number; // Σ BH shares of the crews that timed it
  offCrewHours: number; // timers not on any assigned crew — not counted
  crews: Array<{
    key: string; label: string; shareBh: number; timed: boolean;
    labourHours: number | null; method: string | null;
    quality: TimingQuality | null; crewSize: number;
  }>;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const HOUR_MS = 3_600_000;

/**
 * Closed, real (≥ noise floor) interval for an entry, or null. Ticking
 * entries return null — the caller skips the whole visit-day while any
 * timer on it is still running.
 * @param {VisitTimerEntry} e The entry.
 * @return {object | null} Start/end in ms.
 */
export function closedInterval(
  e: VisitTimerEntry,
): {startMs: number; endMs: number} | null {
  if (e.ticking || !e.endAt) return null;
  const startMs = Date.parse(e.startAt);
  let endMs = Date.parse(e.endAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  // Jobber's finalDuration is authoritative for the length when present
  // (it excludes nothing today, but it is what Jobber shows the crew).
  if (typeof e.finalDuration === "number" && e.finalDuration > 0) {
    endMs = startMs + e.finalDuration * 1000;
  }
  if (endMs - startMs < MIN_TIMER_SECONDS * 1000) return null;
  return {startMs, endMs};
}

/**
 * Union of intervals, in ms. The same person timing twice (or a duplicate
 * entry) is ONE person's time: overlaps count once, gaps don't count.
 * @param {Array} ivs Intervals.
 * @return {number} Covered milliseconds.
 */
export function unionMs(
  ivs: Array<{startMs: number; endMs: number}>,
): number {
  const sorted = [...ivs].sort((a, b) => a.startMs - b.startMs);
  let total = 0;
  let curS = -1;
  let curE = -1;
  for (const iv of sorted) {
    if (iv.startMs > curE) {
      if (curE > curS) total += curE - curS;
      curS = iv.startMs;
      curE = iv.endMs;
    } else if (iv.endMs > curE) {
      curE = iv.endMs;
    }
  }
  if (curE > curS) total += curE - curS;
  return total;
}

/**
 * Picks the crew(s) that did the visit on the day the timer started.
 *
 * The visit's Jobber assignee maps to a crew on THAT day's schedule. When the
 * timers were run by members of a DIFFERENT crew (job moved without updating
 * the Jobber assignee), the crew whose members actually timed it wins — the
 * crew that worked it, not the one it was booked to.
 * @param {DayCrew[]} dayCrews Crews on the schedule that day, with their
 *   Jobber assignee ids.
 * @param {string[]} assigneeIds Visit assignee Jobber user ids.
 * @param {string[]} timerUserIds Jobber user ids who timed it that day.
 * @return {object} Chosen crews and how they were chosen.
 */
export function pickCrews(
  dayCrews: Array<DayCrew & {assigneeIds: string[]}>,
  assigneeIds: string[],
  timerUserIds: string[],
): {crews: DayCrew[]; source: "assignee" | "timer" | "none"} {
  const assigneeSet = new Set(assigneeIds);
  const timerSet = new Set(timerUserIds);
  const byAssignee = dayCrews.filter((c) =>
    c.assigneeIds.some((a) => assigneeSet.has(a)));
  const byTimer = dayCrews.filter((c) =>
    c.members.some((m) => m.jobberUserId && timerSet.has(m.jobberUserId)));
  const both = byAssignee.filter((c) => byTimer.includes(c));
  if (both.length > 0) return {crews: both, source: "assignee"};
  if (byTimer.length > 0) return {crews: byTimer, source: "timer"};
  if (byAssignee.length > 0) return {crews: byAssignee, source: "assignee"};
  return {crews: [], source: "none"};
}

/**
 * Labour hours for one visit on one day.
 *
 *   EVERY crew member timed it  → sum of their time. Exact.
 *   ONE crew member timed it    → their time × crew size.
 *   SOME (2+) but not all       → earliest start → latest finish × crew size.
 *   Same person timing twice    → merged into one person's time first.
 *   Someone OFF the crew timed  → their time is real labour, added on top,
 *                                  and they join the headcount. If ONLY
 *                                  off-crew people timed it, they stand in
 *                                  for the crew under the same rules.
 *   No crew on the schedule     → sum of whoever timed it (a floor, flagged
 *                                  as an estimate).
 * @param {VisitTimerEntry[]} entries Closed entries for this visit-day.
 * @param {DayCrew[]} crews The crew(s) that did it.
 * @return {object | null} Timing, or null if nothing measurable.
 */
export function computeLabour(
  entries: VisitTimerEntry[],
  crews: DayCrew[],
): Omit<VisitDayTiming, "date" | "crewSource"> | null {
  const byUser = new Map<string, {
    name: string; ivs: Array<{startMs: number; endMs: number}>;
  }>();
  const entryIds: string[] = [];
  for (const e of entries) {
    const iv = closedInterval(e);
    if (!iv) continue;
    entryIds.push(e.entryId);
    const cur = byUser.get(e.userId) || {name: e.userName, ivs: []};
    cur.ivs.push(iv);
    byUser.set(e.userId, cur);
  }
  if (byUser.size === 0) return null;

  const members = crews.flatMap((c) => c.members);
  const crewJobberIds = new Set(
    members.map((m) => m.jobberUserId).filter((x): x is string => !!x),
  );
  const crewSize = members.length;

  const people: PersonTime[] = [...byUser.entries()].map(([userId, p]) => ({
    userId,
    name: p.name,
    hours: unionMs(p.ivs) / HOUR_MS,
    start: new Date(Math.min(...p.ivs.map((i) => i.startMs))).toISOString(),
    end: new Date(Math.max(...p.ivs.map((i) => i.endMs))).toISOString(),
    onCrew: crewJobberIds.has(userId),
  }));
  const spanOf = (ps: PersonTime[]): number => {
    if (ps.length === 0) return 0;
    const s = Math.min(...ps.map((p) => Date.parse(p.start)));
    const e = Math.max(...ps.map((p) => Date.parse(p.end)));
    return (e - s) / HOUR_MS;
  };
  const sum = (ps: PersonTime[]): number =>
    ps.reduce((a, p) => a + p.hours, 0);
  const onCrew = people.filter((p) => p.onCrew);
  const offCrew = people.filter((p) => !p.onCrew);

  let labour: number;
  let method: string;
  let quality: TimingQuality;
  let headcount: number;

  if (crewSize === 0) {
    labour = sum(people);
    headcount = people.length;
    method = `${people.length} timed, no crew`;
    quality = "estimate";
  } else if (onCrew.length === crewSize) {
    labour = sum(people);
    headcount = crewSize + offCrew.length;
    method = "all timed";
    quality = "full";
  } else if (onCrew.length === 0) {
    // Only off-crew people ran the timer: they stand in for the crew they
    // worked alongside, and they're counted in the headcount.
    headcount = crewSize + offCrew.length;
    if (offCrew.length === 1) {
      labour = offCrew[0].hours * headcount;
      method = `1 × ${headcount}`;
    } else {
      labour = spanOf(offCrew) * headcount;
      method = `span × ${headcount}`;
    }
    quality = "estimate";
  } else {
    // Some of the crew timed it. Estimate the crew from those who did, then
    // add off-crew timers as the real labour they are.
    if (onCrew.length === 1) {
      labour = onCrew[0].hours * crewSize;
      method = `1 × ${crewSize}`;
    } else {
      labour = spanOf(onCrew) * crewSize;
      method = `span × ${crewSize}`;
    }
    if (offCrew.length > 0) {
      labour += sum(offCrew);
      method += ` + ${offCrew.length} extra`;
    }
    headcount = crewSize + offCrew.length;
    quality = "estimate";
  }

  return {
    crewKeys: crews.map((c) => c.key),
    crewLabel: crews.map((c) => c.label).join(" + "),
    division: crews[0]?.division || "",
    crewSize,
    headcount,
    labourHours: round2(labour),
    method,
    quality,
    spanHours: round2(spanOf(people)),
    people: people
      .map((p) => ({...p, hours: round2(p.hours)}))
      .sort((a, b) => a.start.localeCompare(b.start)),
    entryIds: entryIds.sort(),
  };
}

/**
 * A visit assigned to several crews on one day. Each crew's BH share (from
 * `shares`, the performance sync's split) is compared against THAT crew's own
 * labour — its members' timers under the usual all-timed / 1 × N / span × N
 * rules. Crews that didn't time it are left out entirely. Timers by people on
 * none of the assigned crews can't be placed against a share, so they're
 * reported but not counted.
 * @param {VisitTimerEntry[]} entries The day's entries.
 * @param {DayCrew[]} crews The assigned crews (2+).
 * @param {Map<string, number>} shares crew id → BH share.
 * @param {"sync" | "headcount"} splitSource Where the shares came from.
 * @return {object | null} Day timing, or null if nothing measurable.
 */
export function computeMultiCrewDay(
  entries: VisitTimerEntry[],
  crews: DayCrew[],
  shares: Map<string, number>,
  splitSource: "sync" | "headcount",
): Omit<VisitDayTiming, "date" | "crewSource"> | null {
  const crewOf = new Map<string, DayCrew>();
  for (const c of crews) {
    for (const m of c.members) {
      if (m.jobberUserId && !crewOf.has(m.jobberUserId)) {
        crewOf.set(m.jobberUserId, c);
      }
    }
  }
  const perCrew = crews.map((c) => {
    const mine = entries.filter((e) => crewOf.get(e.userId) === c);
    const t = mine.length ? computeLabour(mine, [c]) : null;
    return {c, t};
  });
  const off = entries.filter((e) => !crewOf.has(e.userId));
  const offT = off.length ? computeLabour(off, []) : null;
  const timed = perCrew.filter((x) => x.t);
  if (timed.length === 0 && !offT) return null;
  const people = [
    ...timed.flatMap((x) => x.t?.people || []),
    ...(offT?.people || []).map((p) => ({...p, onCrew: false})),
  ].sort((a, b) => a.start.localeCompare(b.start));
  const labour = timed.reduce((a, x) => a + (x.t?.labourHours || 0), 0);
  const bhShare = timed.reduce((a, x) => a + (shares.get(x.c.id) || 0), 0);
  const methods = [...new Set(timed.map((x) => x.t?.method))];
  return {
    crewKeys: timed.map((x) => x.c.key),
    crewLabel: timed.map((x) => x.c.label).join(" + "),
    division: (timed[0] || perCrew[0]).c.division,
    crewSize: timed.reduce((a, x) => a + (x.t?.crewSize || 0), 0),
    headcount: timed.reduce((a, x) => a + (x.t?.headcount || 0), 0),
    labourHours: round2(labour),
    method: `${timed.length} of ${crews.length} crews timed` +
      (methods.length ? ` (${methods.join(", ")})` : ""),
    quality: timed.length > 0 && timed.every((x) => x.t?.quality === "full") ?
      "full" : "estimate",
    spanHours: round2(Math.max(0, ...timed.map((x) => x.t?.spanHours || 0))),
    people,
    entryIds: entries.map((e) => e.entryId).sort(),
    multiCrew: {
      assigned: crews.length,
      timed: timed.length,
      splitSource,
      bhShare: round2(bhShare),
      offCrewHours: round2(offT ? offT.labourHours : 0),
      crews: perCrew.map((x) => ({
        key: x.c.key,
        label: x.c.label,
        shareBh: shares.get(x.c.id) || 0,
        timed: !!x.t,
        labourHours: x.t ? x.t.labourHours : null,
        method: x.t ? x.t.method : null,
        quality: x.t ? x.t.quality : null,
        crewSize: x.c.members.length,
      })),
    },
  };
}

/**
 * Groups visit-targeted entries by visit, then by the Toronto day the timer
 * STARTED on. Days with a running timer are reported separately so the
 * caller can leave them alone until the timer stops.
 * @param {Array} entries Entries with their target visit id.
 * @return {Map} visitId → { days: date → entries, ticking: dates }.
 */
export function groupByVisitDay(
  entries: Array<VisitTimerEntry & {visitId: string}>,
): Map<string, {days: Map<string, VisitTimerEntry[]>; ticking: Set<string>}> {
  const out = new Map<
    string, {days: Map<string, VisitTimerEntry[]>; ticking: Set<string>}
  >();
  for (const e of entries) {
    const startMs = Date.parse(e.startAt);
    if (!Number.isFinite(startMs)) continue;
    const date = torontoYmd(new Date(startMs));
    const v = out.get(e.visitId) || {days: new Map(), ticking: new Set()};
    if (e.ticking || !e.endAt) v.ticking.add(date);
    const list = v.days.get(date) || [];
    list.push(e);
    v.days.set(date, list);
    out.set(e.visitId, v);
  }
  return out;
}

export interface VisitDetails {
  id: string;
  title: string | null;
  startAt: string | null;
  isComplete: boolean;
  job: {
    id: string; jobNumber: number | string | null; title: string | null;
    jobType: string | null;
  } | null;
  client: {
    id: string; name: string | null;
    tags?: {nodes: Array<{label: string}>};
  } | null;
  property: {
    id: string; address?: {street?: string | null; city?: string | null} | null;
  } | null;
  assignedUsers?: {nodes: Array<{id: string}>};
  lineItems?: {nodes: Array<{name: string | null}>};
}

export interface JobTimingRecord {
  visitId: string;
  jobId: string | null;
  jobNumber: string | null;
  title: string;
  // BH compared against labour: the visit's BH, or for a multi-crew visit
  // the shares of the crews that timed it.
  bh: number | null;
  visitBh: number | null; // the visit's whole BH (title, same parser)
  multiCrew: {assigned: number; timed: number} | null;
  hourly: boolean; // [hourly] visits carry no BH to compare against
  recurring: boolean;
  lineItems: string[];
  propertyId: string;
  propertyLabel: string;
  clientId: string | null;
  clientName: string;
  lush: boolean;
  assigneeIds: string[];
  date: string; // first day it was timed
  lastDate: string;
  month: string;
  dayList: string[];
  division: string;
  crewKey: string;
  crewLabel: string;
  crewSize: number;
  headcount: number;
  labourHours: number;
  method: string;
  quality: TimingQuality;
  efficiency: number | null; // BH ÷ labour hours
  timedPeople: number;
  days: Record<string, VisitDayTiming>;
}

/**
 * Folds the per-day timings and the visit's details into the one stored
 * record for the visit. A visit timed across several days sums its days;
 * it is only "full" if every day was fully timed.
 * @param {VisitDetails} v Visit details from Jobber.
 * @param {object} days date → day timing.
 * @param {object | null} parsed BH parse of the visit (or job) title.
 * @return {JobTimingRecord | null} The record, or null if no days remain.
 */
export function buildRecord(
  v: VisitDetails,
  days: Record<string, VisitDayTiming>,
  parsed: {bh: number; isHourly: boolean} | null,
): JobTimingRecord | null {
  const dayList = Object.keys(days).sort();
  if (dayList.length === 0) return null;
  const ds = dayList.map((d) => days[d]);
  const first = ds[0];
  const labour = round2(ds.reduce((a, d) => a + d.labourHours, 0));
  const methods = [...new Set(ds.map((d) => d.method))];
  const quality: TimingQuality =
    ds.every((d) => d.quality === "full") ? "full" : "estimate";
  const visitBh = parsed && !parsed.isHourly ? parsed.bh : null;
  // Multi-crew: compare only the BH shares of the crews that timed it. A
  // visit timed as one crew on any day keeps the whole BH, as before. Over
  // several multi-crew days a crew counts once, at its largest share.
  const multi = ds.filter((d) => d.multiCrew);
  let bh = visitBh;
  if (visitBh != null && multi.length > 0 && multi.length === ds.length) {
    const byCrew = new Map<string, number>();
    for (const d of multi) {
      for (const c of d.multiCrew?.crews || []) {
        if (!c.timed) continue;
        byCrew.set(c.key, Math.max(byCrew.get(c.key) || 0, c.shareBh));
      }
    }
    const share = [...byCrew.values()].reduce((a, b) => a + b, 0);
    bh = share > 0 ? round2(Math.min(visitBh, share)) : null;
  }
  const street = v.property?.address?.street || "";
  const clientName = v.client?.name || "";
  const tags = (v.client?.tags?.nodes || [])
    .map((t) => (t.label || "").toLowerCase());
  const people = new Set(ds.flatMap((d) => d.people.map((p) => p.userId)));
  return {
    visitId: v.id,
    jobId: v.job?.id || null,
    jobNumber: v.job?.jobNumber != null ? String(v.job.jobNumber) : null,
    title: v.title || v.job?.title || "",
    bh,
    visitBh,
    multiCrew: multi.length > 0 ? {
      assigned: Math.max(...multi.map((d) => d.multiCrew?.assigned || 0)),
      timed: Math.max(...multi.map((d) => d.multiCrew?.timed || 0)),
    } : null,
    hourly: !!parsed?.isHourly,
    recurring: v.job?.jobType === "RECURRING",
    lineItems: (v.lineItems?.nodes || [])
      .map((n) => n.name || "").filter(Boolean),
    propertyId: v.property?.id || (v.client?.id ? `client:${v.client.id}` :
      `visit:${v.id}`),
    propertyLabel: [clientName, street].filter(Boolean).join(" — ") ||
      (v.title || ""),
    clientId: v.client?.id || null,
    clientName,
    lush: tags.includes("lush"),
    assigneeIds: (v.assignedUsers?.nodes || []).map((n) => n.id),
    date: dayList[0],
    lastDate: dayList[dayList.length - 1],
    month: dayList[0].slice(0, 7),
    dayList,
    division: first.division,
    crewKey: first.crewKeys.join("+"),
    crewLabel: first.crewLabel,
    crewSize: Math.max(...ds.map((d) => d.crewSize)),
    headcount: Math.max(...ds.map((d) => d.headcount)),
    labourHours: labour,
    method: methods.length === 1 ? methods[0] :
      `${dayList.length} days: ${methods.join(", ")}`,
    quality,
    efficiency: bh != null && labour > 0 ? round2(bh / labour) : null,
    timedPeople: people.size,
    days,
  };
}

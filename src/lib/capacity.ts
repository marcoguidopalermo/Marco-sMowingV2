// CAPACITY — the model behind two purpose-built tools.
//
// WHY TWO. They answer different questions from different data, and the
// previous single screen served neither well:
//
//   BOOKING (sales, division-level)     "should we be selling more?"
//   SCHEDULE BALANCE (ops, crew-level)  "is any crew overbooked?"
//
// WHAT CHANGED AND WHY. Jobber "assignees" turned out to be route/crew SLOTS,
// not people: each crew-day carries exactly one id, ids migrate between crews
// over time, and 30 of 311 crew-days carry none at all. A model deriving
// capacity from person-rosters through that mapping was solving the wrong
// problem, and its gaps surfaced as ghost crews and odd headcounts. So:
//
//   * BOOKING uses a DECLARED per-division number and needs no crew mapping.
//     Division attribution still consults the mapping, but only to answer
//     "which division" — far more forgiving than "which crew", since an id
//     that moves between crews inside one division still resolves correctly.
//   * SCHEDULE BALANCE is deliberately crew-level, confined to the current
//     and next week where the schedule is actually built, and it REPORTS the
//     mapping's gaps rather than silently absorbing them.
//
// This file reads performance data (the multi-day ledger's credited BH) and
// writes NOTHING. No efficiency, pay, bonus or approval math is touched.
import type {
  AppData, Crew, Employee, MultiDayJob, CapacityForecast, CapacityForecastVisit,
  CapacitySettings, CapacityThresholds, HeadcountCeiling, AssigneeMapping,
  JobberUser,
} from '../types';
import { remainingBHOf, creditedBHOf } from './multiDayResolution';
import { addDaysToronto } from './dateUtils';
import { getResourceAvailability } from './availability';
import {
  DEFAULT_CAPACITY_THRESHOLDS, DEFAULT_CAPACITY_SETTINGS, DEFAULT_HEADCOUNT_CEILINGS,
} from '../constants';

const round1 = (n: number): number => Math.round(n * 10) / 10;

// ── Week arithmetic (Monday-start, matching the schedule board) ─────────────
const dowOf = (ymd: string): number => new Date(`${ymd}T12:00:00`).getDay();

export const mondayOf = (ymd: string): string => {
  const d = dowOf(ymd);
  return addDaysToronto(ymd, -(d === 0 ? 6 : d - 1));
};

export interface CapacityWeek {
  start: string;   // Monday, YYYY-MM-DD
  end: string;     // Sunday, YYYY-MM-DD
  friday: string;  // last ordinary working day — what "booked out to" quotes
  label: string;   // "Aug 11"
  // FULL week range, weekends included — "Aug 11 – Aug 17". Weekend work is
  // real here, so a column headed with only its Monday misrepresents it.
  rangeLabel: string;
  days: string[];  // the seven dates, Monday first
}

const shortDate = (ymd: string): string =>
  new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export const longDate = (ymd: string): string =>
  new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export const dayLabel = (ymd: string): string =>
  new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });

export function buildWeeks(anchorYmd: string, count: number): CapacityWeek[] {
  const out: CapacityWeek[] = [];
  let start = mondayOf(anchorYmd);
  for (let i = 0; i < count; i++) {
    const end = addDaysToronto(start, 6);
    const days: string[] = [];
    for (let d = 0; d < 7; d++) days.push(addDaysToronto(start, d));
    out.push({
      start,
      end,
      friday: addDaysToronto(start, 4),
      label: shortDate(start),
      rangeLabel: `${shortDate(start)} – ${shortDate(end)}`,
      days,
    });
    start = addDaysToronto(start, 7);
  }
  return out;
}

// ── Settings ───────────────────────────────────────────────────────────────
export function thresholdsOrDefault(s: CapacitySettings | undefined): CapacityThresholds {
  const t = s?.thresholds;
  const n = (v: unknown, fallback: number) =>
    (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);
  return {
    underPct: n(t?.underPct, DEFAULT_CAPACITY_THRESHOLDS.underPct),
    lightPct: n(t?.lightPct, DEFAULT_CAPACITY_THRESHOLDS.lightPct),
    healthyPct: n(t?.healthyPct, DEFAULT_CAPACITY_THRESHOLDS.healthyPct),
  };
}

// Reads settings in the CURRENT shape only. Anything left by the retired
// per-person model is ignored, and is dropped from Firestore the next time an
// admin saves, since the editor writes this shape wholesale.
export function capacityOrDefault(c: CapacitySettings | undefined): CapacitySettings {
  const ceilings = (c?.headcountCeilings && c.headcountCeilings.length > 0)
    ? [...c.headcountCeilings].sort((a, b) => a.headcount - b.headcount)
    : DEFAULT_HEADCOUNT_CEILINGS;
  return {
    declared: { ...DEFAULT_CAPACITY_SETTINGS.declared, ...(c?.declared || {}) },
    headcountCeilings: ceilings,
    thresholds: thresholdsOrDefault(c),
  };
}

export interface DeclaredBasis {
  bh: number | null;          // the weekly capacity, or null when unset
  crews: number | null;
  peoplePerCrew: number | null;
  bhPerPerson: number | null;
  placeholder: boolean;
  // The reasoning, rendered under the division so it's obvious what to change:
  // "capacity based on 3 employees at 35 BH/employee = 105 BH/week".
  basis: string;
}

// READS SETTINGS AND NOTHING ELSE. There is deliberately no `schedules`
// parameter here: capacity is what management declared, and no part of it is
// derived from who happens to be rostered. (The schedule is consulted
// elsewhere in this file ONLY to decide which DIVISION a visit belongs to —
// attribution, never capacity.)
export const declaredFor = (
  s: CapacitySettings | undefined,
  division: string,
): DeclaredBasis => {
  const d = s?.declared?.[division];
  const num = (v: unknown): number | null =>
    (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  const people = num(d?.peoplePerCrew);
  const perPerson = num(d?.bhPerPerson);
  // Crews is optional — a single-crew division needn't say so.
  const crewsRaw = num(d?.crews);
  const crews = crewsRaw ?? (people !== null && perPerson !== null ? 1 : null);
  const complete = people !== null && perPerson !== null;
  const bh = complete ? Math.round((crews || 1) * people * perPerson * 10) / 10 : null;
  const basis = !complete
    ? 'capacity not set'
    : (crews && crews > 1
      ? `capacity based on ${crews} crews × ${people} employees at ${perPerson} BH/employee = ${bh} BH/week`
      : `capacity based on ${people} employees at ${perPerson} BH/employee = ${bh} BH/week`);
  return { bh, crews, peoplePerCrew: people, bhPerPerson: perPerson, placeholder: !!d?.placeholder, basis };
};

// Floor semantics: the highest ceiling row whose headcount is <= the crew's.
// A crew larger than every row takes the largest row — the top entry is
// "N or more", not "exactly N".
export function ceilingFor(
  ceilings: HeadcountCeiling[] | undefined,
  headcount: number,
): { bh: number | null; row: HeadcountCeiling | null } {
  const rows = [...(ceilings && ceilings.length ? ceilings : DEFAULT_HEADCOUNT_CEILINGS)]
    .sort((a, b) => a.headcount - b.headcount);
  let hit: HeadcountCeiling | null = null;
  for (const r of rows) if (headcount >= r.headcount) hit = r;
  return { bh: hit ? hit.weeklyBH : null, row: hit };
}

export type CapacityBand = 'under' | 'light' | 'healthy' | 'over';

// The two reds are OPPOSITE signals: 'under' = we can sell into this week,
// 'over' = we cannot deliver this week. They are never drawn the same way.
export const BAND_META: Record<CapacityBand, {
  label: string; meaning: string; action: string;
}> = {
  under: { label: 'OPEN', meaning: 'Underbooked', action: 'sell into it' },
  light: { label: 'LIGHT', meaning: 'Light', action: 'room to add work' },
  healthy: { label: 'HEALTHY', meaning: 'Healthy', action: 'on plan' },
  over: { label: 'OVER', meaning: 'Overbooked', action: "can't deliver" },
};

export function bandFor(pct: number, t: CapacityThresholds): CapacityBand {
  if (pct < t.underPct) return 'under';
  if (pct < t.lightPct) return 'light';
  if (pct <= t.healthyPct) return 'healthy';
  return 'over';
}

// ── Forward work, prepared once and shared by both tools ───────────────────
export interface ForwardSlice {
  visitId: string;
  desc: string;
  client: string | null;
  jobNumber: string | null;
  date: string;          // the DAY this slice falls on
  bh: number;            // remaining BH apportioned to this day
  startDate: string;
  endDate: string;
  multiDay: boolean;
  isHourly: boolean;
  untagged: boolean;
  assigneeIds: string[];
  assigneeNames: string[];
  totalRemaining: number;
  creditedBH: number;
  // Scheduled duration from Jobber (same-day visits only) and how many days
  // this visit spans — together these let a consumer estimate an [hourly]
  // visit's load and divide it across the days it occupies.
  durationHours?: number;
  spanDays: number;
  // Set when this slice's BH is an ESTIMATE rather than a tagged figure.
  estimated?: boolean;
  estimateBasis?: EstimateBasis;
}

// ── ESTIMATING WORK THAT CARRIES NO [BH] TAG ───────────────────────────────
// An [hourly] visit occupies crew time whether or not anyone tagged it. Left
// at zero it makes a full week read as open, which is the more dangerous
// error — so it is ESTIMATED and then flagged everywhere it appears. The
// estimate never masquerades as a measured number.
//
// UNTAGGED visits are treated differently on purpose. A missing tag is a
// fixable data-entry gap, not a category of work: where Jobber gives a real
// duration we use it, but there is NO default fallback, because inventing a
// number would paper over the very thing that should be corrected in Jobber.
export type EstimateBasis = 'duration' | 'default' | null;

export interface SliceLoad {
  bh: number;              // BH counted for this slice
  estimated: boolean;
  basis: EstimateBasis;
}

export function loadForSlice(
  slice: ForwardSlice,
  division: string,
  settings: CapacitySettings | undefined,
): SliceLoad {
  if (!slice.isHourly && !slice.untagged) {
    return { bh: slice.bh, estimated: false, basis: null };
  }
  const days = Math.max(1, slice.spanDays);
  // Real scheduled time beats any default.
  if (typeof slice.durationHours === 'number' && slice.durationHours > 0) {
    return { bh: round1(slice.durationHours / days), estimated: true, basis: 'duration' };
  }
  if (slice.untagged) {
    // No guess for a missing tag — see the note above.
    return { bh: 0, estimated: false, basis: null };
  }
  const fallback = settings?.declared?.[division]?.hourlyDefaultBH;
  if (typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0) {
    return { bh: round1(fallback / days), estimated: true, basis: 'default' };
  }
  return { bh: 0, estimated: false, basis: null };
}

// Merges the scope snapshots (newest wins per visit), then expands each visit
// into per-DAY slices carrying its REMAINING BH — total less anything already
// credited on the multi-day ledger, clipped to today forward.
export function forwardSlices(
  snapshots: CapacityForecast[],
  multiDayJobs: Record<string, MultiDayJob> | undefined,
  today: string,
): ForwardSlice[] {
  const seen = new Map<string, CapacityForecastVisit>();
  for (const snap of [...snapshots].sort((a, b) => a.generatedAt - b.generatedAt)) {
    for (const v of snap.visits || []) seen.set(v.visitId, v);
  }
  const out: ForwardSlice[] = [];
  for (const v of seen.values()) {
    const ledger = multiDayJobs?.[v.visitId];
    if (ledger && ledger.status === 'complete') continue;
    const credited = ledger ? creditedBHOf(ledger) : 0;
    const remaining = ledger ? remainingBHOf(ledger) : (Number(v.bh) || 0);
    const spanStart = v.startDate < today ? today : v.startDate;
    const spanEnd = v.endDate >= spanStart ? v.endDate : spanStart;
    const days: string[] = [];
    for (let d = spanStart; d <= spanEnd && days.length < 60; d = addDaysToronto(d, 1)) days.push(d);
    if (days.length === 0) continue;
    const perDay = remaining / days.length;
    for (const date of days) {
      out.push({
        spanDays: days.length,
        ...(typeof v.durationHours === 'number' ? { durationHours: v.durationHours } : {}),
        visitId: v.visitId,
        desc: v.desc,
        client: v.client,
        jobNumber: v.jobNumber,
        date,
        bh: perDay,
        startDate: v.startDate,
        endDate: v.endDate,
        multiDay: v.endDate > v.startDate,
        isHourly: v.isHourly,
        untagged: v.untagged,
        assigneeIds: v.assigneeIds || [],
        assigneeNames: v.assigneeNames || [],
        totalRemaining: round1(remaining),
        creditedBH: credited,
      });
    }
  }
  return out;
}

// How far each scope's pull actually reached. A week past it was NEVER
// FETCHED — unknown, not empty — and must not render as an open week.
export function coverageByScope(
  snapshots: CapacityForecast[],
): { projects: string | null; lawn: string | null } {
  const pick = (scope: 'projects' | 'lawn'): string | null => {
    const s = snapshots.find(x => (x.scope || 'projects') === scope);
    if (!s) return null;
    return s.coveredThrough || s.windowEnd || '';
  };
  return { projects: pick('projects'), lawn: pick('lawn') };
}

// ── Assignee → DIVISION (Tool 1) ───────────────────────────────────────────
// Only the DIVISION, never the crew. An id that moves between crews inside a
// division still resolves; the same-day multi-crew ambiguity that makes
// crew-level attribution fragile doesn't arise at this level. Resolution is
// by MODE — the division an id has been rostered under on the most crew-days
// — so one odd day can't reassign a route.
// PRECEDENCE: an explicit mapping always wins. The schedule-derived mode is
// the fallback for anything nobody has mapped yet, so the feature degrades to
// exactly the previous behaviour rather than requiring a full mapping before
// it works at all.
export function assigneeDivisionIndex(
  schedules: Record<string, Crew[]>,
  settings?: CapacitySettings,
): Map<string, string> {
  const derived = scheduleDivisionIndex(schedules);
  const out = new Map(derived);
  for (const [aid, m] of Object.entries(settings?.assigneeMap || {})) {
    if (m?.division) out.set(aid, m.division);
  }
  return out;
}

// The schedule-derived half, kept separate so the editor can show BOTH what
// the schedule implies and what has been explicitly stated — and flag where
// the two disagree.
export function scheduleDivisionIndex(
  schedules: Record<string, Crew[]>,
): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  const lastSeen = new Map<string, string>();
  for (const date of Object.keys(schedules || {}).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()) {
    for (const crew of schedules[date] || []) {
      if (!crew?.division) continue;
      for (const aid of crew.jobberAssigneeIds || []) {
        const m = counts.get(aid) || new Map<string, number>();
        m.set(crew.division, (m.get(crew.division) || 0) + 1);
        counts.set(aid, m);
        lastSeen.set(aid, crew.division);
      }
    }
  }
  const out = new Map<string, string>();
  for (const [aid, m] of counts) {
    let best: string | null = null;
    let bestN = 0;
    for (const [div, n] of m) {
      if (n > bestN) { best = div; bestN = n; }
      // Ties break toward the division the id was most recently seen in.
      else if (n === bestN && lastSeen.get(aid) === div) best = div;
    }
    if (best) out.set(aid, best);
  }
  return out;
}

export const UNATTRIBUTED = 'Unattributed';

// ── ASSIGNEE INVENTORY (the mapping editor's data) ─────────────────────────
// Everything needed to see and fix attribution in one place: who the slots
// are, how much forward work each carries, where it currently lands and why.
export interface AssigneeInfo {
  id: string;
  label: string;
  archived: boolean;
  forwardBH: number;
  visits: number;
  mapped: AssigneeMapping | null;
  scheduleDivision: string | null;      // what the schedule implies
  scheduleCrews: string[];              // crews it has appeared on
  resolvedDivision: string | null;      // what attribution actually uses
  source: 'mapped' | 'schedule' | 'none';
  // Mapped to one division but rostered on another's crew — worth seeing,
  // because one of the two is wrong.
  conflict: boolean;
}

export interface AssigneeDiagnostics {
  assignees: AssigneeInfo[];
  unmapped: AssigneeInfo[];         // no explicit mapping AND no schedule match
  unmappedBH: number;
  conflicts: AssigneeInfo[];
  // Crew-days carrying no jobberAssigneeIds at all — work scheduled to them
  // can never be matched.
  unmappedCrewDays: { date: string; crew: string }[];
  mappedCount: number;
  totalForwardBH: number;
}

export interface AssigneeInventoryInput {
  snapshots: CapacityForecast[];
  schedules: Record<string, Crew[]>;
  jobberUsers: JobberUser[];
  settings: CapacitySettings | undefined;
  multiDayJobs: Record<string, MultiDayJob> | undefined;
  today: string;
  // How far back to scan the schedule for slots and gaps.
  lookbackDays?: number;
}

export function assigneeInventory(input: AssigneeInventoryInput): AssigneeDiagnostics {
  const { snapshots, schedules, jobberUsers, settings, multiDayJobs, today } = input;
  const from = addDaysToronto(today, -(input.lookbackDays ?? 28));
  const nameById = new Map<string, JobberUser>();
  for (const u of jobberUsers || []) nameById.set(u.id, u);

  // Forward BH + a fallback label from the snapshots themselves.
  const bhById = new Map<string, number>();
  const visitsById = new Map<string, Set<string>>();
  const snapLabel = new Map<string, string>();
  let totalForwardBH = 0;
  for (const slice of forwardSlices(snapshots, multiDayJobs, today)) {
    const ids = slice.assigneeIds || [];
    const share = ids.length > 0 ? slice.bh / ids.length : 0;
    totalForwardBH += slice.bh;
    ids.forEach((id, i) => {
      bhById.set(id, (bhById.get(id) || 0) + share);
      const set = visitsById.get(id) || new Set<string>();
      set.add(slice.visitId);
      visitsById.set(id, set);
      const nm = slice.assigneeNames?.[i];
      if (nm && !snapLabel.has(id)) snapLabel.set(id, nm);
    });
  }

  // Schedule presence: which crews each slot has been on recently, and which
  // crew-days carry no slot at all.
  const crewsById = new Map<string, Set<string>>();
  const unmappedCrewDays: { date: string; crew: string }[] = [];
  for (const date of Object.keys(schedules || {}).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= from).sort()) {
    for (const crew of schedules[date] || []) {
      if (!crew?.division || !crew.crewNumber) continue;
      const label = `${crew.division} #${crew.crewNumber}`;
      const ids = crew.jobberAssigneeIds || [];
      if (ids.length === 0) { unmappedCrewDays.push({ date, crew: label }); continue; }
      for (const id of ids) {
        const set = crewsById.get(id) || new Set<string>();
        set.add(label);
        crewsById.set(id, set);
      }
    }
  }

  const scheduleIdx = scheduleDivisionIndex(schedules || {});
  const map = settings?.assigneeMap || {};
  const ids = new Set<string>([
    ...bhById.keys(), ...crewsById.keys(), ...Object.keys(map),
  ]);

  const assignees: AssigneeInfo[] = [...ids].map(id => {
    const mapped = map[id] || null;
    const scheduleDivision = scheduleIdx.get(id) || null;
    const resolvedDivision = mapped?.division || scheduleDivision || null;
    const user = nameById.get(id);
    return {
      id,
      label: user?.name || mapped?.label || snapLabel.get(id) || id.slice(0, 12),
      archived: !!user?.isArchived,
      forwardBH: Math.round((bhById.get(id) || 0) * 10) / 10,
      visits: visitsById.get(id)?.size || 0,
      mapped,
      scheduleDivision,
      scheduleCrews: [...(crewsById.get(id) || [])].sort(),
      resolvedDivision,
      source: (mapped ? 'mapped' : (scheduleDivision ? 'schedule' : 'none')) as AssigneeInfo['source'],
      conflict: !!mapped && !!scheduleDivision && mapped.division !== scheduleDivision,
    };
  }).sort((a, b) => b.forwardBH - a.forwardBH || a.label.localeCompare(b.label));

  const unmapped = assignees.filter(a => a.source === 'none');
  return {
    assignees,
    unmapped,
    unmappedBH: Math.round(unmapped.reduce((s2, a) => s2 + a.forwardBH, 0) * 10) / 10,
    conflicts: assignees.filter(a => a.conflict),
    unmappedCrewDays,
    mappedCount: assignees.filter(a => a.source === 'mapped').length,
    totalForwardBH: Math.round(totalForwardBH * 10) / 10,
  };
}

// ── TOOL 1: BOOKING ────────────────────────────────────────────────────────
export interface BookingCell {
  weekStart: string;
  // CONFIRMED BH — from [BH] tags, less anything already credited.
  bh: number;
  // ESTIMATED BH — hourly work with no tag, from its scheduled duration or
  // the division's default. Kept SEPARATE so the cell can show the split and
  // never present an estimate as a measured figure.
  estBH: number;
  estCount: number;
  // How the estimates in this cell were arrived at.
  estFromDuration: number;
  estFromDefault: number;
  // What the percentage is actually computed from: bh + estBH.
  totalBH: number;
  capacity: number | null;
  pct: number | null;
  band: CapacityBand | null;
  uncovered: boolean;
  jobs: ForwardSlice[];
  hourlyCount: number;
  untaggedCount: number;
}

export interface BookingRow {
  division: string;
  declared: number | null;
  declaredBasis: string;
  declaredPlaceholder: boolean;
  cells: BookingCell[];
  bookedOutWeek: string | null;
  bookedOutTo: string | null;
  totalBH: number;
}

export interface BookingModel {
  weeks: CapacityWeek[];
  rows: BookingRow[];
  unattributed: BookingRow | null;
  thresholds: CapacityThresholds;
  generatedAt: number | null;
}

export interface BookingInput {
  snapshots: CapacityForecast[];
  schedules: Record<string, Crew[]>;
  multiDayJobs: Record<string, MultiDayJob> | undefined;
  settings: CapacitySettings | undefined;
  today: string;
  weeks?: number;
}

export function buildBookingModel(input: BookingInput): BookingModel {
  const { snapshots, schedules, multiDayJobs, settings, today } = input;
  const thresholds = thresholdsOrDefault(settings);
  const weeks = buildWeeks(today, input.weeks ?? 4);
  const weekIndex = new Map<string, number>();
  weeks.forEach((w, i) => weekIndex.set(w.start, i));
  const divisionOf = assigneeDivisionIndex(schedules || {}, settings);
  const coverage = coverageByScope(snapshots);

  const blank = (division: string): BookingCell[] => weeks.map(w => {
    // Lawn and projects pull different horizons, so coverage is per scope.
    const cov = /lawn/i.test(division) ? coverage.lawn : coverage.projects;
    return {
      weekStart: w.start,
      bh: 0,
      estBH: 0,
      estCount: 0,
      estFromDuration: 0,
      estFromDefault: 0,
      totalBH: 0,
      capacity: null,
      pct: null,
      band: null,
      uncovered: cov === null ? true : (cov ? w.start > cov : false),
      jobs: [],
      hourlyCount: 0,
      untaggedCount: 0,
    };
  });

  const acc = new Map<string, BookingCell[]>();
  const rowFor = (division: string): BookingCell[] => {
    let c = acc.get(division);
    if (!c) { c = blank(division); acc.set(division, c); }
    return c;
  };
  // Every division management has a declared entry for gets a row, even at
  // zero — an empty division is exactly what a sales view needs to show.
  for (const division of Object.keys(settings?.declared || {})) rowFor(division);

  for (const slice of forwardSlices(snapshots, multiDayJobs, today)) {
    const wi = weekIndex.get(mondayOf(slice.date));
    if (wi === undefined) continue;
    // A visit's division: the divisions its assignees resolve to. Multiple
    // (rare — a shared route slot) splits evenly; none → Unattributed.
    const divisions = [...new Set(
      slice.assigneeIds.map(a => divisionOf.get(a)).filter((d): d is string => !!d),
    )];
    const targets = divisions.length > 0 ? divisions : [UNATTRIBUTED];
    const share = slice.bh / targets.length;
    for (const division of targets) {
      const cells = rowFor(division);
      const cell = cells[wi];
      // Hourly work carries no tag, so its load is ESTIMATED here — counted
      // toward the week, tracked apart from measured BH.
      const load = loadForSlice(slice, division, settings);
      const amount = load.estimated ? load.bh / targets.length : share;
      if (load.estimated) {
        cell.estBH = round1(cell.estBH + amount);
        cell.estCount++;
        if (load.basis === 'duration') cell.estFromDuration = round1(cell.estFromDuration + amount);
        else cell.estFromDefault = round1(cell.estFromDefault + amount);
      } else {
        cell.bh = round1(cell.bh + amount);
      }
      cell.totalBH = round1(cell.bh + cell.estBH);
      if (slice.isHourly) cell.hourlyCount++;
      if (slice.untagged) cell.untaggedCount++;
      cell.jobs.push({ ...slice, bh: round1(amount), estimated: load.estimated, estimateBasis: load.basis } as ForwardSlice & { estimated: boolean; estimateBasis: EstimateBasis });
    }
  }

  const buildRow = (division: string, cells: BookingCell[]): BookingRow => {
    const dec = declaredFor(settings, division);
    for (const cell of cells) {
      cell.capacity = division === UNATTRIBUTED ? null : dec.bh;
      cell.totalBH = round1(cell.bh + cell.estBH);
      // The percentage INCLUDES the estimate — an hourly job occupying next
      // Thursday means next Thursday is occupied. The cell says so.
      cell.pct = cell.uncovered || !cell.capacity ? null :
        Math.round((cell.totalBH / cell.capacity) * 100);
      cell.band = cell.pct === null ? null : bandFor(cell.pct, thresholds);
      cell.jobs.sort((a, b) => b.bh - a.bh);
    }
    // BOOKED OUT TO — the last week carrying meaningful load. Never quoted
    // from a week the pull didn't reach.
    let bookedOutWeek: string | null = null;
    let bookedOutTo: string | null = null;
    for (let i = cells.length - 1; i >= 0; i--) {
      const c = cells[i];
      if (c.uncovered) continue;
      const meaningful = c.capacity && c.pct !== null
        ? c.pct >= thresholds.underPct
        : c.totalBH > 0;
      if (meaningful) { bookedOutWeek = c.weekStart; bookedOutTo = weeks[i].friday; break; }
    }
    return {
      division,
      declared: division === UNATTRIBUTED ? null : dec.bh,
      declaredBasis: division === UNATTRIBUTED
        ? 'work whose Jobber assignee maps to no division'
        : dec.basis,
      declaredPlaceholder: dec.placeholder,
      cells,
      bookedOutWeek,
      bookedOutTo,
      totalBH: round1(cells.reduce((s, c) => s + c.totalBH, 0)),
    };
  };

  const rows = [...acc.entries()]
    .filter(([d]) => d !== UNATTRIBUTED)
    .map(([d, c]) => buildRow(d, c))
    .sort((a, b) => a.division.localeCompare(b.division));
  const unattributedCells = acc.get(UNATTRIBUTED);
  const unattributed = unattributedCells ? buildRow(UNATTRIBUTED, unattributedCells) : null;

  return {
    weeks,
    rows,
    unattributed,
    thresholds,
    generatedAt: snapshots.length ? Math.max(...snapshots.map(s => s.generatedAt)) : null,
  };
}

// ── TOOL 2: SCHEDULE BALANCE ───────────────────────────────────────────────
export interface BalanceDay {
  date: string;
  bh: number;
  rostered: number;      // people on this crew that day, available
  isScheduled: boolean;  // the crew appears on the schedule at all
  jobs: ForwardSlice[];
}

export interface BalanceCrewWeek {
  weekStart: string;
  days: BalanceDay[];
  totalBH: number;
  // Representative available headcount for the week — the median of the days
  // the crew is actually rostered, so one short day doesn't set the ceiling.
  headcount: number | null;
  ceiling: number | null;
  ceilingPlaceholder: boolean;
  over: boolean;
  overBy: number;
  scheduled: boolean;    // rostered on any day this week
}

export interface BalanceCrewRow {
  key: string;
  division: string;
  crewNumber: number;
  label: string;
  weeks: BalanceCrewWeek[];
}

export interface ScheduleIssue {
  kind: 'unmapped_crew_day' | 'unassigned_work' | 'duplicate_assignee';
  date?: string;
  crew?: string;
  detail: string;
  bh?: number;
}

export interface BalanceModel {
  weeks: CapacityWeek[];
  crews: BalanceCrewRow[];
  issues: ScheduleIssue[];
  unassignedBH: number;
}

export interface BalanceInput {
  snapshots: CapacityForecast[];
  appData: AppData;
  multiDayJobs: Record<string, MultiDayJob> | undefined;
  settings: CapacitySettings | undefined;
  today: string;
}

const crewKeyOf = (division: string, crewNumber: number) => `${division}#${crewNumber}`;

export function buildBalanceModel(input: BalanceInput): BalanceModel {
  const { snapshots, appData, multiDayJobs, settings, today } = input;
  const schedules = appData.schedules || {};
  const employees: Employee[] = appData.employees || [];
  const testIds = new Set(employees.filter(e => e.isTestUser).map(e => e.id));
  const ceilings = capacityOrDefault(settings).headcountCeilings;
  // CURRENT + NEXT week only — the window where the schedule is actually
  // built. Beyond it this tool has nothing honest to say.
  const weeks = buildWeeks(today, 2);
  const windowDays = new Set(weeks.flatMap(w => w.days));

  // date → assigneeId → crew keys. Also where the same-day duplicate that
  // would silently split a visit's BH gets spotted.
  const byDate = new Map<string, Map<string, string[]>>();
  const crewIdentity = new Map<string, { division: string; crewNumber: number }>();
  const issues: ScheduleIssue[] = [];

  for (const date of [...windowDays].sort()) {
    const crews = schedules[date] || [];
    const map = new Map<string, string[]>();
    for (const crew of crews) {
      if (!crew?.division || !crew.crewNumber) continue;
      const key = crewKeyOf(crew.division, crew.crewNumber);
      crewIdentity.set(key, { division: crew.division, crewNumber: crew.crewNumber });
      const ids = crew.jobberAssigneeIds || [];
      if (ids.length === 0) {
        issues.push({
          kind: 'unmapped_crew_day',
          date,
          crew: `${crew.division} #${crew.crewNumber}`,
          detail: 'No Jobber assignee on this crew-day — work scheduled to it cannot be matched.',
        });
      }
      for (const aid of ids) {
        const arr = map.get(aid) || [];
        if (!arr.includes(key)) arr.push(key);
        map.set(aid, arr);
      }
    }
    for (const [, keys] of map) {
      if (keys.length > 1) {
        issues.push({
          kind: 'duplicate_assignee',
          date,
          detail: `One Jobber assignee is on ${keys.length} crews the same day (${keys.join(', ')}) — its BH is split between them.`,
        });
      }
    }
    byDate.set(date, map);
  }

  // Per crew-day BH, from the forward slices.
  const cellBH = new Map<string, Map<string, number>>();     // crewKey → date → bh
  const cellJobs = new Map<string, Map<string, ForwardSlice[]>>();
  let unassignedBH = 0;
  const unassignedByName = new Map<string, number>();

  for (const slice of forwardSlices(snapshots, multiDayJobs, today)) {
    if (!windowDays.has(slice.date)) continue;
    const map = byDate.get(slice.date);
    const keys: string[] = [];
    for (const aid of slice.assigneeIds) {
      for (const k of map?.get(aid) || []) if (!keys.includes(k)) keys.push(k);
    }
    if (keys.length === 0) {
      unassignedBH += slice.bh;
      const who = slice.assigneeNames[0] || '(no assignee)';
      unassignedByName.set(who, (unassignedByName.get(who) || 0) + slice.bh);
      continue;
    }
    for (const key of keys) {
      const division = crewIdentity.get(key)?.division || '';
      // Hourly work occupies this crew's day whether or not it carries a tag.
      const load = loadForSlice(slice, division, settings);
      const share = load.bh / keys.length;
      if (!cellBH.has(key)) { cellBH.set(key, new Map()); cellJobs.set(key, new Map()); }
      const byD = cellBH.get(key)!;
      byD.set(slice.date, (byD.get(slice.date) || 0) + share);
      const jd = cellJobs.get(key)!;
      jd.set(slice.date, [...(jd.get(slice.date) || []),
        { ...slice, bh: round1(share), estimated: load.estimated, estimateBasis: load.basis }]);
    }
  }

  for (const [who, bh] of unassignedByName) {
    issues.push({
      kind: 'unassigned_work',
      detail: `${round1(bh)} BH scheduled to "${who}" matches no crew in this window.`,
      bh: round1(bh),
    });
  }

  // Available headcount for a crew on a date — rostered, less approved time
  // off, read through the app's single availability source. null = the crew
  // isn't on the schedule that day at all, which is stated rather than
  // projected.
  const availableOn = (division: string, crewNumber: number, date: string): number | null => {
    const crews = (schedules[date] || []).filter(c =>
      c?.division === division && c.crewNumber === crewNumber);
    if (crews.length === 0) return null;
    const roster = new Set<string>();
    for (const c of crews) for (const id of c.employees || []) if (!testIds.has(id)) roster.add(id);
    let n = 0;
    for (const empId of roster) {
      const st = getResourceAvailability(empId, 'employee', date, appData);
      if (st.status !== 'absent' && st.status !== 'booked_off') n++;
    }
    return n;
  };

  const median = (a: number[]): number => {
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  };

  const crews: BalanceCrewRow[] = [...crewIdentity.entries()]
    .map(([key, id]) => {
      const weekRows: BalanceCrewWeek[] = weeks.map(w => {
        const days: BalanceDay[] = w.days.map(date => {
          const rostered = availableOn(id.division, id.crewNumber, date);
          return {
            date,
            bh: round1(cellBH.get(key)?.get(date) || 0),
            rostered: rostered ?? 0,
            isScheduled: rostered !== null,
            jobs: cellJobs.get(key)?.get(date) || [],
          };
        });
        const scheduledDays = days.filter(d => d.isScheduled && d.rostered > 0);
        const headcount = scheduledDays.length > 0 ? median(scheduledDays.map(d => d.rostered)) : null;
        const cap = headcount ? ceilingFor(ceilings, headcount) : { bh: null, row: null };
        const totalBH = round1(days.reduce((s, d) => s + d.bh, 0));
        return {
          weekStart: w.start,
          days,
          totalBH,
          headcount,
          ceiling: cap.bh,
          ceilingPlaceholder: !!cap.row?.placeholder,
          over: cap.bh !== null && totalBH > cap.bh,
          overBy: cap.bh !== null && totalBH > cap.bh ? round1(totalBH - cap.bh) : 0,
          scheduled: scheduledDays.length > 0,
        };
      });
      return {
        key,
        division: id.division,
        crewNumber: id.crewNumber,
        label: `${id.division} #${id.crewNumber}`,
        weeks: weekRows,
      };
    })
    .sort((a, b) => a.division.localeCompare(b.division) || a.crewNumber - b.crewNumber);

  return { weeks, crews, issues, unassignedBH: round1(unassignedBH) };
}

// Convenience for drill-downs: unique visits in a set of slices.
export function mergeSlices(jobs: ForwardSlice[]): ForwardSlice[] {
  const map = new Map<string, ForwardSlice>();
  for (const j of jobs) {
    const prev = map.get(j.visitId);
    if (prev) { prev.bh = round1(prev.bh + j.bh); continue; }
    map.set(j.visitId, { ...j });
  }
  return Array.from(map.values()).sort((a, b) => b.bh - a.bh);
}

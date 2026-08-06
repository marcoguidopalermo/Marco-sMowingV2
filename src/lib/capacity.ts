// CAPACITY CALENDAR — the model behind the forward view.
//
// Pure functions. Input: the Jobber forecast snapshot (scheduled, uncompleted
// visits), the schedule (for crew attribution), the multi-day ledgers (for
// what's already credited) and the admin capacity settings. Output: weeks ×
// crews of REMAINING committed BH, with a colour band where a capacity is set.
//
// This file reads performance data (the multi-day ledger's credited BH) and
// writes NOTHING. No efficiency, pay, bonus or approval math is touched.
import type {
  AppData, Crew, Employee, MultiDayJob, CapacityForecast, CapacityForecastVisit,
  CapacityRule, CapacitySettings, CapacityThresholds,
} from '../types';
import { remainingBHOf, creditedBHOf } from './multiDayResolution';
import { getResourceAvailability } from './availability';
import { addDaysToronto } from './dateUtils';
import { DEFAULT_CAPACITY_THRESHOLDS, DEFAULT_CAPACITY_SETTINGS } from '../constants';

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
  // real here (jobs land on Saturdays and Sundays and are counted in the
  // week's BH), so a column headed with only its Monday misrepresents what
  // the number covers.
  rangeLabel: string;
}

const shortDate = (ymd: string): string =>
  new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export const longDate = (ymd: string): string =>
  new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export function buildWeeks(anchorYmd: string, count: number): CapacityWeek[] {
  const out: CapacityWeek[] = [];
  let start = mondayOf(anchorYmd);
  for (let i = 0; i < count; i++) {
    const end = addDaysToronto(start, 6);
    out.push({
      start,
      end,
      friday: addDaysToronto(start, 4),
      label: shortDate(start),
      rangeLabel: `${shortDate(start)} – ${shortDate(end)}`,
    });
    start = addDaysToronto(start, 7);
  }
  return out;
}

// ── Settings resolution ────────────────────────────────────────────────────
export const capacityCrewKey = (division: string, crewNumber: number): string =>
  `${division}#${crewNumber}`;

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

// Settings as the app should read them: the seeded placeholders fill in for
// anything an admin hasn't touched. An explicitly saved division entry —
// even one holding nulls — REPLACES its seed, so clearing a value sticks.
export function capacityOrDefault(c: CapacitySettings | undefined): CapacitySettings {
  return {
    divisions: { ...DEFAULT_CAPACITY_SETTINGS.divisions, ...(c?.divisions || {}) },
    crews: c?.crews || {},
    thresholds: thresholdsOrDefault(c),
  };
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

// ── SCHEDULE-DERIVED CAPACITY ───────────────────────────────────────────────
// A flat "150 BH/week" assumes a crew exists at full strength every week. It
// doesn't: composition changes, crews get added mid-season, people book off.
// So capacity is DERIVED, per crew per week:
//
//     capacity = (people scheduled that week, less approved time off)
//                × BH-per-person-per-week
//
// with a projection from the crew's standard size for weeks the schedule
// hasn't reached yet. Every row states which of those it used — a derived
// number nobody can trace is no better than a made-up one.

export type CapacityBasis =
  | 'scheduled'   // real roster for that week — ALWAYS wins when it exists
  | 'projected'   // beyond the built schedule — standard size, a FALLBACK
  | 'none';       // no BH-per-person set — no bar, no percentage

// Working days in a week. Time off is prorated against this: a person off 2
// of 5 removes 40% of their weekly contribution. Weekend work still COUNTS
// toward booked BH — this denominator is only how a person's availability is
// scaled, and crews are rostered Monday–Friday.
const WORKING_DAYS = 5;

export type StandardSizeSource = 'set' | 'inferred' | 'none';

export interface WeekCapacity {
  bh: number | null;
  // What this crew could deliver at its standard size — the reference that
  // separates "thin because nobody's scheduled" from "thin because nothing's
  // sold". Null when no per-person rate is set.
  fullStrengthBH: number | null;
  basis: CapacityBasis;
  headcount: number;         // distinct people on the crew that week
  effectivePeople: number;   // headcount after time-off proration
  standardSize: number | null;
  // Whether the standard size was CONFIGURED or inferred from past days —
  // shown on the row so nobody mistakes an inference for a decision.
  standardSizeSource: StandardSizeSource;
  standardSizeDays: number;   // past scheduled days the inference used
  perPersonBH: number | null;
  // "Sam off 2 of 5 days" — the specific reason capacity is down.
  offNotes: string[];
  // The full human-readable basis, e.g.
  // "scheduled: 3.6 people (1 booked off) × 35 = 126".
  label: string;
}

const NO_CAPACITY: WeekCapacity = {
  bh: null, fullStrengthBH: null, basis: 'none', headcount: 0,
  effectivePeople: 0, standardSize: null, standardSizeSource: 'none',
  standardSizeDays: 0, perPersonBH: null,
  offNotes: [], label: 'no BH-per-person set',
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

// Crew value overrides division default, field by field — a crew can override
// the per-person rate without also having to restate its standard size.
function rulesFor(
  settings: CapacitySettings | undefined,
  division: string,
  crewNumber: number,
): { perPersonBH: number | null; standardSize: number | null; placeholder: boolean } {
  const crew = settings?.crews?.[capacityCrewKey(division, crewNumber)];
  const div = settings?.divisions?.[division];
  const pick = (a: number | null | undefined, b: number | null | undefined): number | null => {
    if (typeof a === 'number' && Number.isFinite(a) && a > 0) return a;
    if (typeof b === 'number' && Number.isFinite(b) && b > 0) return b;
    return null;
  };
  return {
    perPersonBH: pick(crew?.perPersonBH, div?.perPersonBH),
    standardSize: pick(crew?.standardSize, div?.standardSize),
    placeholder: !!(crew?.placeholder ?? div?.placeholder),
  };
}

export interface CapacityContext {
  appData: AppData;
  settings: CapacitySettings | undefined;
  // crew key → a REPRESENTATIVE size from past scheduled days, used as the
  // standard size only when an admin hasn't configured one.
  typicalSize: Map<string, InferredSize>;
  testUserIds: Set<string>;
}

// Capacity for ONE crew in ONE week.
export function weekCapacityFor(
  ctx: CapacityContext,
  division: string,
  crewNumber: number,
  week: CapacityWeek,
): WeekCapacity {
  const key = capacityCrewKey(division, crewNumber);
  const rule = rulesFor(ctx.settings, division, crewNumber);
  // An explicitly CONFIGURED standard size always beats the inference. The
  // inference is only for divisions nobody has set up yet.
  const inferred = ctx.typicalSize.get(key) ?? null;
  const standardSize = rule.standardSize ?? (inferred?.size ?? null);
  const standardSizeSource: StandardSizeSource =
    rule.standardSize !== null ? 'set' : (inferred ? 'inferred' : 'none');
  const standardSizeDays = rule.standardSize !== null ? 0 : (inferred?.days ?? 0);
  const base = { standardSize, standardSizeSource, standardSizeDays };

  if (rule.perPersonBH === null) return { ...NO_CAPACITY, ...base };
  const per = rule.perPersonBH;

  // Days of this week that actually have this crew on the schedule.
  const days: string[] = [];
  for (let i = 0; i < 7; i++) days.push(addDaysToronto(week.start, i));
  const people = new Set<string>();
  let anyScheduled = false;
  for (const date of days) {
    for (const crew of ctx.appData.schedules?.[date] || []) {
      if (crew.division !== division || crew.crewNumber !== crewNumber) continue;
      anyScheduled = true;
      for (const empId of crew.employees || []) {
        if (!ctx.testUserIds.has(empId)) people.add(empId);
      }
    }
  }

  // THE SCHEDULE WINS. If this crew has assignments this week, they are the
  // basis — full stop. A configured standard size does not override real
  // people; it only fills the gap where the schedule hasn't reached.
  if (!anyScheduled) {
    if (!standardSize) {
      return {
        ...NO_CAPACITY, ...base, perPersonBH: per,
        label: 'no schedule and no standard crew size — capacity unknown',
      };
    }
    const bh = round1(standardSize * per);
    const src = standardSizeSource === 'set' ? 'set' :
      `inferred, median of ${standardSizeDays} past scheduled day${standardSizeDays === 1 ? '' : 's'}`;
    return {
      bh, fullStrengthBH: bh, basis: 'projected', headcount: standardSize,
      effectivePeople: standardSize, ...base, perPersonBH: per,
      offNotes: [],
      label: `projected: ${standardSize} people (${src}) × ${per} = ${bh} (beyond schedule)`,
    };
  }

  // Real roster. Each person contributes the fraction of the working week
  // they're actually available — approved time off, day-of absences and
  // indefinite Away all count, read through the app's single availability
  // source so this means exactly what it means everywhere else.
  const workingDays = days.slice(0, WORKING_DAYS);
  let effective = 0;
  const offNotes: string[] = [];
  for (const empId of people) {
    let availableDays = 0;
    for (const date of workingDays) {
      const st = getResourceAvailability(empId, 'employee', date, ctx.appData);
      if (st.status !== 'absent' && st.status !== 'booked_off') availableDays++;
    }
    const fraction = availableDays / WORKING_DAYS;
    effective += fraction;
    if (fraction < 1) {
      const name = ctx.appData.employees?.find(e => e.id === empId)?.name || 'Someone';
      const daysOff = WORKING_DAYS - availableDays;
      offNotes.push(`${name} off ${daysOff} of ${WORKING_DAYS}`);
    }
  }
  const headcount = people.size;
  effective = round1(effective);
  const bh = round1(effective * per);
  const fullSize = standardSize ?? headcount;
  const fullStrengthBH = round1(fullSize * per);
  const offSummary = offNotes.length > 0 ?
    ` (${offNotes.length} booked off: ${offNotes.slice(0, 2).join(', ')}` +
    `${offNotes.length > 2 ? `, +${offNotes.length - 2} more` : ''})` : '';
  return {
    bh, fullStrengthBH, basis: 'scheduled', headcount, effectivePeople: effective,
    ...base, perPersonBH: per, offNotes,
    label: `scheduled: ${effective} people${offSummary} × ${per} = ${bh}`,
  };
}

// ── Crew attribution index ─────────────────────────────────────────────────
// Forward visits carry Jobber assignee ids. The schedule is what maps a
// person to a crew, so we index it by date. For a day the office hasn't
// built yet we fall back to that person's nearest scheduled crew — the
// honest approximation, and it's flagged in the UI as scheduled-work-only.
export interface CrewRef { division: string; crewNumber: number; key: string; size: number }

export interface InferredSize {
  size: number;      // representative crew size
  days: number;      // how many past scheduled days it was drawn from
}

interface AssigneeIndex {
  dates: string[];                                  // ascending
  byDate: Map<string, Map<string, CrewRef[]>>;      // date → assignee → crews
  crewSizes: Map<string, InferredSize>;             // crew key → inferred size
  activeCrews: Map<string, CrewRef>;                // crew key → identity
}

const ACTIVE_LOOKBACK_DAYS = 28;
// Window the size inference is drawn from. Four weeks of PAST scheduled days
// — long enough to be representative, short enough to track a crew that has
// genuinely changed shape this season.
const INFER_LOOKBACK_DAYS = 28;

function buildAssigneeIndex(
  schedules: Record<string, Crew[]>,
  employees: Employee[],
  today: string,
): AssigneeIndex {
  const testIds = new Set(employees.filter(e => e.isTestUser).map(e => e.id));
  const byDate = new Map<string, Map<string, CrewRef[]>>();
  const activeCrews = new Map<string, CrewRef>();
  const activeFrom = addDaysToronto(today, -ACTIVE_LOOKBACK_DAYS);
  const inferFrom = addDaysToronto(today, -INFER_LOOKBACK_DAYS);
  const dates = Object.keys(schedules || {}).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  // Sizes are collected from PAST scheduled days only and reduced to a
  // MEDIAN below. The previous "latest non-zero wins" walked into the
  // FUTURE, so a day roughed in with two people next Tuesday outranked
  // weeks of correct four-person history. Measured on real schedule data,
  // that disagreed with the representative size on 3 of 4 Small Projects
  // crews — which is exactly the reported symptom.
  const pastSizes = new Map<string, number[]>();
  for (const date of dates) {
    const crews = schedules[date] || [];
    const map = new Map<string, CrewRef[]>();
    for (const crew of crews) {
      if (!crew || !crew.division || !crew.crewNumber) continue;
      const key = capacityCrewKey(crew.division, crew.crewNumber);
      const size = (crew.employees || []).filter(id => !testIds.has(id)).length;
      const ref: CrewRef = { division: crew.division, crewNumber: crew.crewNumber, key, size };
      // STRICTLY past (a day still in progress is only half-assigned), and
      // within the inference window.
      if (size > 0 && date < today && date >= inferFrom) {
        const arr = pastSizes.get(key) || [];
        arr.push(size);
        pastSizes.set(key, arr);
      }
      if (date >= activeFrom) activeCrews.set(key, ref);
      for (const aid of crew.jobberAssigneeIds || []) {
        const arr = map.get(aid) || [];
        if (!arr.some(r => r.key === key)) arr.push(ref);
        map.set(aid, arr);
      }
    }
    if (map.size > 0) byDate.set(date, map);
  }
  // MEDIAN, not mean and not latest: one rain day, one split crew or one
  // half-built day moves a mean and dominates a "latest", but barely moves a
  // median. (Mode agreed with the median on 10 of 11 real crews; median wins
  // ties more predictably, so median it is.)
  const crewSizes = new Map<string, InferredSize>();
  for (const [key, arr] of pastSizes) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1 ? sorted[mid] :
      (sorted[mid - 1] + sorted[mid]) / 2;
    crewSizes.set(key, { size: Math.round(median), days: sorted.length });
  }
  const indexed = dates.filter(d => byDate.has(d));
  return { dates: indexed, byDate, crewSizes, activeCrews };
}

// Nearest index date at or before `date`; falls back to the nearest after.
function nearestDate(idx: AssigneeIndex, date: string): string | null {
  const { dates } = idx;
  if (dates.length === 0) return null;
  let lo = 0, hi = dates.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= date) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (best >= 0) return dates[best];
  return dates[0];
}

// All crews a visit's assignees map to on a given day. Exact-day schedule
// wins; otherwise the nearest scheduled day for those same people.
function crewsForAssignees(
  idx: AssigneeIndex,
  assigneeIds: string[],
  date: string,
): { crews: CrewRef[]; exact: boolean } {
  const collect = (d: string | null): CrewRef[] => {
    if (!d) return [];
    const map = idx.byDate.get(d);
    if (!map) return [];
    const out: CrewRef[] = [];
    for (const aid of assigneeIds) {
      for (const ref of map.get(aid) || []) {
        if (!out.some(r => r.key === ref.key)) out.push(ref);
      }
    }
    return out;
  };
  const exactHit = collect(idx.byDate.has(date) ? date : null);
  if (exactHit.length > 0) return { crews: exactHit, exact: true };
  return { crews: collect(nearestDate(idx, date)), exact: false };
}

// ── The model ──────────────────────────────────────────────────────────────
export interface CapacityJobSlice {
  visitId: string;
  desc: string;
  client: string | null;
  jobNumber: string | null;
  startDate: string;
  endDate: string;
  multiDay: boolean;
  // BH landing in THIS week for THIS crew.
  bh: number;
  // Remaining BH for the whole visit (all weeks, all crews).
  totalRemaining: number;
  // Ledger BH already credited — the part that is DONE and excluded.
  creditedBH: number;
  isHourly: boolean;
  untagged: boolean;
  assigneeNames: string[];
  // The crew came from a day the office hasn't scheduled yet, so the person
  // was matched to their nearest scheduled crew.
  inferredCrew: boolean;
}

export interface CapacityCell {
  weekStart: string;
  // How this week's capacity was arrived at — shown on the row so the
  // percentage is always traceable to people × rate.
  capacityBasis: CapacityBasis;
  capacityLabel: string;
  // Standard-size reference. Where it differs from `capacity`, the week is
  // thin because of WHO IS SCHEDULED, not because nothing is sold.
  fullStrength: number | null;
  headcount: number;
  effectivePeople: number;
  // TRUE when this week lies past what the pull actually fetched. Such a
  // week has no number — not a zero. It is rendered as "not pulled" and is
  // excluded from "booked out to", because a week nobody looked at must
  // never read as an open week somebody can sell into.
  uncovered: boolean;
  bh: number;
  capacity: number | null;
  pct: number | null;
  band: CapacityBand | null;
  jobs: CapacityJobSlice[];
  hourlyCount: number;
  untaggedCount: number;
}

export interface CapacityRow {
  key: string;
  kind: 'crew' | 'division' | 'unassigned';
  division: string;
  crewNumber: number | null;
  label: string;
  crewSize: number | null;
  // Average capacity across the horizon — the baseline an individual week
  // should be read against.
  capacity: number | null;
  capacityDetail: WeekCapacity | null;
  // Division rows only: some of the division's crews have no capacity set,
  // so the division bar covers less than the whole division.
  capacityPartial: boolean;
  cells: CapacityCell[];
  bookedOutWeek: string | null;
  bookedOutTo: string | null;
  crews?: CapacityRow[];
}

export interface CapacityModel {
  weeks: CapacityWeek[];
  divisions: CapacityRow[];
  // Scheduled work whose assignees don't map to any crew — never silently
  // dropped, always shown as its own row.
  unassigned: CapacityRow | null;
  thresholds: CapacityThresholds;
  totals: { forwardBH: number; hourly: number; untagged: number; visits: number };
  generatedAt: number | null;
}


// How many weeks the model spans. Wide enough that "booked out to" reflects
// the true end of the pipeline, not the edge of the visible grid.
export const HORIZON_WEEKS = 18;

export interface CapacityModelInput {
  // Needed for time-off lookups, which go through the app's single
  // availability source so "booked off" means the same thing here as on the
  // schedule board.
  appData: AppData;
  // One snapshot per SCOPE (projects, lawn). They are merged here rather
  // than server-side so a stale lawn pull still renders alongside a fresh
  // projects one — and so a visit that lands in the "wrong" scope document
  // (the server's scope split is a coarse pre-filter) is still attributed
  // correctly by crew. Deduped by visitId.
  forecasts?: Array<CapacityForecast | null | undefined>;
  // Single-snapshot form, kept for the legacy one-document layout.
  forecast?: CapacityForecast | null | undefined;
  schedules: Record<string, Crew[]>;
  employees: Employee[];
  multiDayJobs: Record<string, MultiDayJob> | undefined;
  settings: CapacitySettings | undefined;
  today: string;
}

export function buildCapacityModel(input: CapacityModelInput): CapacityModel {
  const { schedules, employees, multiDayJobs, settings, today } = input;
  const snapshots = (input.forecasts || [input.forecast]).filter(Boolean) as CapacityForecast[];
  // Merge the scope snapshots, newest-wins per visit. A visit can legitimately
  // appear in both documents (it straddles the scope split, or a scope was
  // re-pulled while the other was mid-flight); it must be counted ONCE.
  const seen = new Map<string, CapacityForecastVisit>();
  for (const snap of [...snapshots].sort((a, b) => a.generatedAt - b.generatedAt)) {
    for (const v of snap.visits || []) seen.set(v.visitId, v);
  }
  const forecast: CapacityForecast | null = snapshots.length === 0 ? null : {
    ...snapshots.reduce((a, b) => (a.generatedAt >= b.generatedAt ? a : b)),
    visits: Array.from(seen.values()),
  };
  const thresholds = thresholdsOrDefault(settings);
  const weeks = buildWeeks(today, HORIZON_WEEKS);
  const weekIndex = new Map<string, number>();
  weeks.forEach((w, i) => weekIndex.set(w.start, i));
  const idx = buildAssigneeIndex(schedules || {}, employees || [], today);

  // crew key → per-week accumulator
  const acc = new Map<string, { ref: CrewRef; cells: CapacityCell[] }>();
  // Coverage is per SCOPE: lawn and projects pull different horizons, so a
  // week can be known for one and unknown for the other. A crew row uses its
  // own division's scope.
  // NULL means "no snapshot for this scope at all" — every week is unknown.
  // That case is not hypothetical: the two scopes pull on different
  // schedules, so one can legitimately have never run. Treating a missing
  // snapshot as "covered" would paint that whole division's weeks 0 BH and
  // colour them OPEN — a division nobody has pulled would look like the
  // emptiest, most sellable one on the board.
  const coverageOf = (division: string): string | null => {
    const scope = /lawn/i.test(division) ? 'lawn' : 'projects';
    const snap = snapshots.find(s2 => (s2.scope || 'projects') === scope);
    if (!snap) return null;
    // A snapshot with neither field is a legacy/complete pull — fully covered.
    return snap.coveredThrough || snap.windowEnd || '';
  };
  const blankCells = (coverThrough: string | null): CapacityCell[] => weeks.map(w => ({
    weekStart: w.start,
    uncovered: coverThrough === null ? true :
      (coverThrough ? w.start > coverThrough : false),
    bh: 0, capacity: null, pct: null, band: null,
    fullStrength: null, capacityBasis: 'none' as CapacityBasis, capacityLabel: '',
    headcount: 0, effectivePeople: 0,
    jobs: [], hourlyCount: 0, untaggedCount: 0,
  }));
  const rowFor = (ref: CrewRef) => {
    let row = acc.get(ref.key);
    if (!row) {
      row = { ref, cells: blankCells(coverageOf(ref.division)) };
      acc.set(ref.key, row);
    }
    return row;
  };

  // Every crew scheduled recently gets a row even with zero forward work —
  // an EMPTY crew is exactly the thing sales needs to see.
  for (const ref of idx.activeCrews.values()) rowFor(ref);

  const UNASSIGNED_KEY = '__unassigned__';
  let unassignedCells: CapacityCell[] | null = null;
  const totals = { forwardBH: 0, hourly: 0, untagged: 0, visits: 0 };

  for (const v of forecast?.visits || []) {
    // REMAINING BH. When a multi-day ledger exists, credited BH is already
    // paid work and is excluded — remaining = total − credited (clamped at 0
    // and never recomputed by us). Otherwise the parsed tag stands.
    const ledger = multiDayJobs?.[v.visitId];
    if (ledger && ledger.status === 'complete') continue;
    const credited = ledger ? creditedBHOf(ledger) : 0;
    const remaining = ledger ? remainingBHOf(ledger) : (Number(v.bh) || 0);

    // The scheduled span, clipped to today forward: a multi-day job that
    // started last week only has its REMAINING days ahead of it.
    const spanStart = v.startDate < today ? today : v.startDate;
    const spanEnd = v.endDate >= spanStart ? v.endDate : spanStart;
    const days: string[] = [];
    for (let d = spanStart; d <= spanEnd && days.length < 60; d = addDaysToronto(d, 1)) {
      days.push(d);
    }
    if (days.length === 0) continue;
    const perDay = remaining / days.length;

    totals.visits++;
    totals.forwardBH += remaining;
    if (v.isHourly) totals.hourly++;
    if (v.untagged) totals.untagged++;

    // Per-DAY attribution, so a job spanning a crew change lands correctly.
    // The per-day slice is split evenly across every crew the assignees map
    // to that day (the forward headcount split the sync uses isn't knowable
    // in advance).
    const perCrewWeekBH = new Map<string, Map<number, number>>();
    const inferredByCrew = new Map<string, boolean>();
    for (const day of days) {
      const wi = weekIndex.get(mondayOf(day));
      if (wi === undefined) continue;   // outside the horizon
      const { crews, exact } = crewsForAssignees(idx, v.assigneeIds || [], day);
      const targets = crews.length > 0 ? crews.map(c => c.key) : [UNASSIGNED_KEY];
      const share = perDay / targets.length;
      for (const key of targets) {
        if (!perCrewWeekBH.has(key)) perCrewWeekBH.set(key, new Map());
        const byWeek = perCrewWeekBH.get(key)!;
        byWeek.set(wi, (byWeek.get(wi) || 0) + share);
        if (crews.length > 0 && !exact) inferredByCrew.set(key, true);
        const found = crews.find(c => c.key === key);
        if (found) rowFor(found);
      }
    }

    for (const [key, byWeek] of perCrewWeekBH) {
      let cells: CapacityCell[];
      if (key === UNASSIGNED_KEY) {
        if (!unassignedCells) unassignedCells = blankCells(coverageOf('projects'));
        cells = unassignedCells;
      } else {
        cells = acc.get(key)!.cells;
      }
      for (const [wi, bh] of byWeek) {
        const cell = cells[wi];
        cell.bh = round1(cell.bh + bh);
        if (v.isHourly) cell.hourlyCount++;
        if (v.untagged) cell.untaggedCount++;
        cell.jobs.push({
          visitId: v.visitId,
          desc: v.desc,
          client: v.client,
          jobNumber: v.jobNumber,
          startDate: v.startDate,
          endDate: v.endDate,
          multiDay: v.endDate > v.startDate,
          bh: round1(bh),
          totalRemaining: round1(remaining),
          creditedBH: credited,
          isHourly: v.isHourly,
          untagged: v.untagged,
          assigneeNames: v.assigneeNames || [],
          inferredCrew: !!inferredByCrew.get(key),
        });
      }
    }
  }

  // ── Resolve capacity + bands, then roll crews up into divisions ──────────
  const bookedOut = (cells: CapacityCell[]): { week: string | null; to: string | null } => {
    for (let i = cells.length - 1; i >= 0; i--) {
      const c = cells[i];
      // Never quote a booked-out date from a week we didn't fetch.
      if (c.uncovered) continue;
      // "Meaningful load" = at or above the underbooked threshold when a
      // capacity is known; any scheduled BH at all when it isn't.
      const meaningful = c.capacity !== null && c.pct !== null
        ? c.pct >= thresholds.underPct
        : c.bh > 0;
      if (meaningful) return { week: cells[i].weekStart, to: weeks[i].friday };
    }
    return { week: null, to: null };
  };

  // Capacity is now derived PER WEEK, not once per crew — that is the whole
  // point of v1.2: the same crew can be 4 people one week and 3 the next.
  const ctx: CapacityContext = {
    appData: input.appData,
    settings,
    typicalSize: idx.crewSizes,
    testUserIds: new Set((employees || []).filter(e => e.isTestUser).map(e => e.id)),
  };
  const crewRows: CapacityRow[] = [];
  for (const { ref, cells } of acc.values()) {
    const size = idx.crewSizes.get(ref.key)?.size ?? (ref.size || null);
    let lastDetail: WeekCapacity | null = null;
    cells.forEach((cell, i) => {
      const cap = weekCapacityFor(ctx, ref.division, ref.crewNumber, weeks[i]);
      lastDetail = cap;
      cell.capacity = cap.bh;
      cell.fullStrength = cap.fullStrengthBH;
      cell.capacityBasis = cap.basis;
      cell.capacityLabel = cap.label;
      cell.headcount = cap.headcount;
      cell.effectivePeople = cap.effectivePeople;
      // An uncovered week gets NO percentage and NO band. Leaving it at 0%
      // would paint it "underbooked — sell into it".
      cell.pct = cell.uncovered || !cap.bh || cap.bh <= 0 ? null :
        Math.round((cell.bh / cap.bh) * 100);
      cell.band = cell.pct === null ? null : bandFor(cell.pct, thresholds);
      cell.jobs.sort((a, b) => b.bh - a.bh);
    });
    const withCap = cells.filter(c => c.capacity !== null);
    const avgCapacity = withCap.length > 0 ?
      round1(withCap.reduce((sum, c) => sum + (c.capacity || 0), 0) / withCap.length) : null;
    const bo = bookedOut(cells);
    crewRows.push({
      key: ref.key,
      kind: 'crew',
      division: ref.division,
      crewNumber: ref.crewNumber,
      label: `Crew #${ref.crewNumber}`,
      crewSize: size,
      capacity: avgCapacity,
      capacityDetail: lastDetail,
      capacityPartial: false,
      cells,
      bookedOutWeek: bo.week,
      bookedOutTo: bo.to,
    });
  }

  const divisionNames = Array.from(new Set(crewRows.map(r => r.division))).sort();
  const divisions: CapacityRow[] = divisionNames.map(division => {
    const crews = crewRows
      .filter(r => r.division === division)
      .sort((a, b) => (a.crewNumber || 0) - (b.crewNumber || 0));
    const withCap = crews.filter(c => c.capacity !== null);
    const cells: CapacityCell[] = weeks.map((w, i) => {
      const bh = round1(crews.reduce((s, c) => s + c.cells[i].bh, 0));
      const uncovered = crews.length > 0 && crews.every(c => c.cells[i].uncovered);
      // The division's capacity for a week is the sum of its crews' capacity
      // FOR THAT WEEK — so a week where two crews are short reads short,
      // instead of being measured against a season-long average.
      const weekCaps = crews.map(c => c.cells[i].capacity).filter((v): v is number => v !== null);
      const capacity = weekCaps.length > 0 ? round1(weekCaps.reduce((a, b) => a + b, 0)) : null;
      const fullCaps = crews.map(c => c.cells[i].fullStrength).filter((v): v is number => v !== null);
      const fullStrength = fullCaps.length > 0 ? round1(fullCaps.reduce((a, b) => a + b, 0)) : null;
      const anyProjected = crews.some(c => c.cells[i].capacityBasis === 'projected');
      const pct = !uncovered && capacity && capacity > 0 ?
        Math.round((bh / capacity) * 100) : null;
      return {
        weekStart: w.start,
        uncovered,
        bh,
        capacity,
        fullStrength,
        capacityBasis: (capacity === null ? 'none' : anyProjected ? 'projected' : 'scheduled') as CapacityBasis,
        capacityLabel: capacity === null ? 'no capacity set' :
          `${weekCaps.length} crew${weekCaps.length === 1 ? '' : 's'} → ${capacity} BH` +
          (anyProjected ? ' (some projected beyond the schedule)' : ''),
        headcount: crews.reduce((s2, c) => s2 + c.cells[i].headcount, 0),
        effectivePeople: round1(crews.reduce((s2, c) => s2 + c.cells[i].effectivePeople, 0)),
        pct,
        band: pct === null ? null : bandFor(pct, thresholds),
        jobs: crews.flatMap(c => c.cells[i].jobs).sort((a, b) => b.bh - a.bh),
        hourlyCount: crews.reduce((s2, c) => s2 + c.cells[i].hourlyCount, 0),
        untaggedCount: crews.reduce((s2, c) => s2 + c.cells[i].untaggedCount, 0),
      };
    });
    const avgCapacity = (() => {
      const vals = cells.map(c => c.capacity).filter((v): v is number => v !== null);
      return vals.length > 0 ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    })();
    const bo = bookedOut(cells);
    return {
      key: division,
      kind: 'division',
      division,
      crewNumber: null,
      label: division,
      crewSize: crews.reduce((s, c) => s + (c.crewSize || 0), 0) || null,
      capacity: avgCapacity,
      capacityDetail: null,
      capacityPartial: withCap.length > 0 && withCap.length < crews.length,
      cells,
      bookedOutWeek: bo.week,
      bookedOutTo: bo.to,
      crews,
    };
  });

  let unassigned: CapacityRow | null = null;
  if (unassignedCells) {
    for (const cell of unassignedCells as CapacityCell[]) cell.jobs.sort((a, b) => b.bh - a.bh);
    const bo = bookedOut(unassignedCells);
    unassigned = {
      key: UNASSIGNED_KEY,
      kind: 'unassigned',
      division: 'Unassigned',
      crewNumber: null,
      label: 'Unassigned',
      crewSize: null,
      capacity: null,
      capacityDetail: null,
      capacityPartial: false,
      cells: unassignedCells,
      bookedOutWeek: bo.week,
      bookedOutTo: bo.to,
    };
  }

  return {
    weeks,
    divisions,
    unassigned,
    thresholds,
    totals: { ...totals, forwardBH: round1(totals.forwardBH) },
    generatedAt: forecast?.generatedAt ?? null,
  };
}

// Convenience for the drill-down: unique jobs in a cell (a multi-day job can
// contribute more than one slice to the same week through different crews).
export function mergeSlices(jobs: CapacityJobSlice[]): CapacityJobSlice[] {
  const map = new Map<string, CapacityJobSlice>();
  for (const j of jobs) {
    const prev = map.get(j.visitId);
    if (prev) { prev.bh = round1(prev.bh + j.bh); continue; }
    map.set(j.visitId, { ...j });
  }
  return Array.from(map.values()).sort((a, b) => b.bh - a.bh);
}

export type { CapacityForecastVisit };

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
  Crew, Employee, MultiDayJob, CapacityForecast, CapacityForecastVisit,
  CapacityRule, CapacitySettings, CapacityThresholds,
} from '../types';
import { remainingBHOf, creditedBHOf } from './multiDayResolution';
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

export interface ResolvedCapacity {
  bh: number | null;
  source: 'crew' | 'division' | null;
  // The capacity came from a BH/person rate × this crew size.
  perPersonBH: number | null;
  crewSize: number | null;
  placeholder: boolean;
}

const ruleValue = (rule: CapacityRule | undefined, crewSize: number | null): number | null => {
  if (!rule) return null;
  const abs = rule.weeklyBH;
  if (typeof abs === 'number' && Number.isFinite(abs) && abs > 0) return abs;
  const per = rule.perPersonBH;
  if (typeof per === 'number' && Number.isFinite(per) && per > 0 && crewSize && crewSize > 0) {
    return Math.round(per * crewSize * 10) / 10;
  }
  return null;
};

// A crew value overrides its division default when it resolves to a number.
// Nothing is inferred: if neither resolves, capacity is null and the UI shows
// raw BH with no bar and no percentage.
export function resolveCapacity(
  settings: CapacitySettings | undefined,
  division: string,
  crewNumber: number,
  crewSize: number | null,
): ResolvedCapacity {
  const crewRule = settings?.crews?.[capacityCrewKey(division, crewNumber)];
  const divRule = settings?.divisions?.[division];
  const crewBH = ruleValue(crewRule, crewSize);
  if (crewBH !== null) {
    return {
      bh: crewBH,
      source: 'crew',
      perPersonBH: crewRule?.weeklyBH ? null : (crewRule?.perPersonBH ?? null),
      crewSize,
      placeholder: !!crewRule?.placeholder,
    };
  }
  const divBH = ruleValue(divRule, crewSize);
  if (divBH !== null) {
    return {
      bh: divBH,
      source: 'division',
      perPersonBH: divRule?.weeklyBH ? null : (divRule?.perPersonBH ?? null),
      crewSize,
      placeholder: !!divRule?.placeholder,
    };
  }
  return { bh: null, source: null, perPersonBH: null, crewSize, placeholder: false };
}

// ── Crew attribution index ─────────────────────────────────────────────────
// Forward visits carry Jobber assignee ids. The schedule is what maps a
// person to a crew, so we index it by date. For a day the office hasn't
// built yet we fall back to that person's nearest scheduled crew — the
// honest approximation, and it's flagged in the UI as scheduled-work-only.
export interface CrewRef { division: string; crewNumber: number; key: string; size: number }

interface AssigneeIndex {
  dates: string[];                                  // ascending
  byDate: Map<string, Map<string, CrewRef[]>>;      // date → assignee → crews
  crewSizes: Map<string, number>;                   // crew key → latest size
  activeCrews: Map<string, CrewRef>;                // crew key → identity
}

const ACTIVE_LOOKBACK_DAYS = 28;

function buildAssigneeIndex(
  schedules: Record<string, Crew[]>,
  employees: Employee[],
  today: string,
): AssigneeIndex {
  const testIds = new Set(employees.filter(e => e.isTestUser).map(e => e.id));
  const byDate = new Map<string, Map<string, CrewRef[]>>();
  const crewSizes = new Map<string, number>();
  const activeCrews = new Map<string, CrewRef>();
  const activeFrom = addDaysToronto(today, -ACTIVE_LOOKBACK_DAYS);
  const dates = Object.keys(schedules || {}).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  // Latest-wins for crew size, so walk ascending.
  for (const date of dates) {
    const crews = schedules[date] || [];
    const map = new Map<string, CrewRef[]>();
    for (const crew of crews) {
      if (!crew || !crew.division || !crew.crewNumber) continue;
      const key = capacityCrewKey(crew.division, crew.crewNumber);
      const size = (crew.employees || []).filter(id => !testIds.has(id)).length;
      const ref: CrewRef = { division: crew.division, crewNumber: crew.crewNumber, key, size };
      if (size > 0) crewSizes.set(key, size);
      if (date >= activeFrom) activeCrews.set(key, ref);
      for (const aid of crew.jobberAssigneeIds || []) {
        const arr = map.get(aid) || [];
        if (!arr.some(r => r.key === key)) arr.push(ref);
        map.set(aid, arr);
      }
    }
    if (map.size > 0) byDate.set(date, map);
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
  capacity: number | null;
  capacityDetail: ResolvedCapacity | null;
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

const round1 = (n: number): number => Math.round(n * 10) / 10;

// How many weeks the model spans. Wide enough that "booked out to" reflects
// the true end of the pipeline, not the edge of the visible grid.
export const HORIZON_WEEKS = 18;

export interface CapacityModelInput {
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
  const blankCells = (): CapacityCell[] => weeks.map(w => ({
    weekStart: w.start, bh: 0, capacity: null, pct: null, band: null,
    jobs: [], hourlyCount: 0, untaggedCount: 0,
  }));
  const rowFor = (ref: CrewRef) => {
    let row = acc.get(ref.key);
    if (!row) { row = { ref, cells: blankCells() }; acc.set(ref.key, row); }
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
        if (!unassignedCells) unassignedCells = blankCells();
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
      // "Meaningful load" = at or above the underbooked threshold when a
      // capacity is known; any scheduled BH at all when it isn't.
      const meaningful = c.capacity !== null && c.pct !== null
        ? c.pct >= thresholds.underPct
        : c.bh > 0;
      if (meaningful) return { week: cells[i].weekStart, to: weeks[i].friday };
    }
    return { week: null, to: null };
  };

  const crewRows: CapacityRow[] = [];
  for (const { ref, cells } of acc.values()) {
    const size = idx.crewSizes.get(ref.key) ?? (ref.size || null);
    const cap = resolveCapacity(settings, ref.division, ref.crewNumber, size);
    for (const cell of cells) {
      cell.capacity = cap.bh;
      cell.pct = cap.bh && cap.bh > 0 ? Math.round((cell.bh / cap.bh) * 100) : null;
      cell.band = cell.pct === null ? null : bandFor(cell.pct, thresholds);
      cell.jobs.sort((a, b) => b.bh - a.bh);
    }
    const bo = bookedOut(cells);
    crewRows.push({
      key: ref.key,
      kind: 'crew',
      division: ref.division,
      crewNumber: ref.crewNumber,
      label: `Crew #${ref.crewNumber}`,
      crewSize: size,
      capacity: cap.bh,
      capacityDetail: cap,
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
    const capacity = withCap.length > 0
      ? round1(withCap.reduce((s, c) => s + (c.capacity || 0), 0))
      : null;
    const cells: CapacityCell[] = weeks.map((w, i) => {
      const bh = round1(crews.reduce((s, c) => s + c.cells[i].bh, 0));
      const pct = capacity && capacity > 0 ? Math.round((bh / capacity) * 100) : null;
      return {
        weekStart: w.start,
        bh,
        capacity,
        pct,
        band: pct === null ? null : bandFor(pct, thresholds),
        jobs: crews.flatMap(c => c.cells[i].jobs).sort((a, b) => b.bh - a.bh),
        hourlyCount: crews.reduce((s, c) => s + c.cells[i].hourlyCount, 0),
        untaggedCount: crews.reduce((s, c) => s + c.cells[i].untaggedCount, 0),
      };
    });
    const bo = bookedOut(cells);
    return {
      key: division,
      kind: 'division',
      division,
      crewNumber: null,
      label: division,
      crewSize: crews.reduce((s, c) => s + (c.crewSize || 0), 0) || null,
      capacity,
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

// Tests for the capacity-calendar model.
//   npx tsx src/lib/capacity.test.ts
import assert from 'node:assert/strict';
import {
  buildWeeks, mondayOf, bandFor, resolveCapacity, thresholdsOrDefault,
  buildCapacityModel, capacityCrewKey, mergeSlices,
} from './capacity';
import type { CapacityForecast, CapacityForecastVisit, Crew, Employee, MultiDayJob } from '../types';

let pass = 0, fail = 0;
const test = (n: string, fn: () => void) => {
  try { fn(); pass++; console.log(`  ✓ ${n}`); }
  catch (e) { fail++; console.error(`  ✗ ${n}\n      ${(e as Error).message}`); }
};

// Anchor: Thursday 2026-08-06. Its week starts Monday 2026-08-03.
const TODAY = '2026-08-06';

const visit = (o: Partial<CapacityForecastVisit>): CapacityForecastVisit => ({
  visitId: 'v', jobId: 'j', jobNumber: '100', desc: 'Job', client: 'Client',
  startDate: TODAY, endDate: TODAY, bh: 10, isHourly: false, untagged: false,
  assigneeIds: ['a1'], assigneeNames: ['Worker One'], ...o,
});
const forecast = (visits: CapacityForecastVisit[]): CapacityForecast => ({
  generatedAt: 1, generatedBy: 'scheduled', windowStart: '2026-07-16',
  windowEnd: '2026-12-04', today: TODAY, visits,
  stats: { fetched: visits.length, kept: visits.length, completeSkipped: 0, endedBeforeToday: 0, untagged: 0, hourly: 0 },
  truncated: false, degraded: false, warnings: [],
});
const crew = (division: string, crewNumber: number, assignees: string[], employees: string[]): Crew => ({
  id: `c-${division}-${crewNumber}`, division, crewNumber, employees,
  fleet: [], inventory: [], jobberAssigneeIds: assignees,
});
const EMPLOYEES: Employee[] = [
  { id: 'e1', name: 'Worker One', status: 'Active', hasLicense: false, hasClassA: false, hasHeavyMachinery: false, awayDates: [] },
  { id: 'e2', name: 'Worker Two', status: 'Active', hasLicense: false, hasClassA: false, hasHeavyMachinery: false, awayDates: [] },
];
// A schedule covering today with one Large Projects crew of 2.
const SCHEDULES: Record<string, Crew[]> = {
  [TODAY]: [crew('Large Projects', 1, ['a1'], ['e1', 'e2'])],
};

const model = (visits: CapacityForecastVisit[], extra: Partial<Parameters<typeof buildCapacityModel>[0]> = {}) =>
  buildCapacityModel({
    forecast: forecast(visits),
    schedules: SCHEDULES,
    employees: EMPLOYEES,
    multiDayJobs: {},
    settings: { divisions: { 'Large Projects': { weeklyBH: 100 } } },
    today: TODAY,
    ...extra,
  });

const cellOf = (m: ReturnType<typeof model>, weekStart: string) => {
  const div = m.divisions.find(d => d.division === 'Large Projects')!;
  const i = m.weeks.findIndex(w => w.start === weekStart);
  return div.cells[i];
};

console.log('\nWeek arithmetic');
test('mondayOf snaps to Monday (and Sunday goes back 6)', () => {
  assert.equal(mondayOf('2026-08-06'), '2026-08-03');   // Thursday
  assert.equal(mondayOf('2026-08-03'), '2026-08-03');   // Monday itself
  assert.equal(mondayOf('2026-08-09'), '2026-08-03');   // Sunday
});
test('buildWeeks walks Mondays with Friday quote-dates', () => {
  const w = buildWeeks(TODAY, 3);
  assert.deepEqual(w.map(x => x.start), ['2026-08-03', '2026-08-10', '2026-08-17']);
  assert.equal(w[0].friday, '2026-08-07');
  assert.equal(w[0].end, '2026-08-09');
});

console.log('\nThresholds + bands');
test('seeded bands: <70 under, <90 light, <=110 healthy, >110 over', () => {
  const t = thresholdsOrDefault(undefined);
  assert.equal(bandFor(0, t), 'under');
  assert.equal(bandFor(69, t), 'under');
  assert.equal(bandFor(70, t), 'light');
  assert.equal(bandFor(89, t), 'light');
  assert.equal(bandFor(90, t), 'healthy');
  assert.equal(bandFor(110, t), 'healthy');
  assert.equal(bandFor(111, t), 'over');
});
test('admin threshold overrides are honoured', () => {
  const t = thresholdsOrDefault({ thresholds: { underPct: 50, lightPct: 80, healthyPct: 120 } });
  assert.equal(bandFor(60, t), 'light');
  assert.equal(bandFor(119, t), 'healthy');
  assert.equal(bandFor(121, t), 'over');
});

console.log('\nCapacity resolution');
test('crew value overrides the division default', () => {
  const s = {
    divisions: { 'Lawn Division': { weeklyBH: 100 } },
    crews: { [capacityCrewKey('Lawn Division', 2)]: { weeklyBH: 60 } },
  };
  assert.equal(resolveCapacity(s, 'Lawn Division', 1, 2).bh, 100);
  assert.equal(resolveCapacity(s, 'Lawn Division', 2, 2).bh, 60);
  assert.equal(resolveCapacity(s, 'Lawn Division', 2, 2).source, 'crew');
});
test('per-person rate multiplies by crew size', () => {
  const s = { divisions: { 'Lawn Division': { perPersonBH: 35, placeholder: true } } };
  const r = resolveCapacity(s, 'Lawn Division', 1, 3);
  assert.equal(r.bh, 105);
  assert.equal(r.placeholder, true);
});
test('no capacity set → null (no bar, no percentage)', () => {
  assert.equal(resolveCapacity({ divisions: { 'Large Projects': { weeklyBH: null } } }, 'Large Projects', 1, 4).bh, null);
  assert.equal(resolveCapacity(undefined, 'Large Projects', 1, 4).bh, null);
});
test('per-person with unknown crew size yields no capacity, not zero', () => {
  assert.equal(resolveCapacity({ divisions: { 'Lawn Division': { perPersonBH: 35 } } }, 'Lawn Division', 1, null).bh, null);
});

console.log('\nForward load');
test('single-day visit lands entirely in its own week', () => {
  const m = model([visit({ visitId: 'v1', bh: 40 })]);
  assert.equal(cellOf(m, '2026-08-03').bh, 40);
  assert.equal(cellOf(m, '2026-08-10').bh, 0);
  assert.equal(cellOf(m, '2026-08-03').pct, 40);
  assert.equal(cellOf(m, '2026-08-03').band, 'under');
});
test('multi-day visit spreads across the weeks it spans, not the start date', () => {
  // Thu Aug 6 → Wed Aug 12: 4 days in week Aug 3, 3 days in week Aug 10.
  const m = model([visit({ visitId: 'v2', startDate: '2026-08-06', endDate: '2026-08-12', bh: 70 })]);
  assert.equal(cellOf(m, '2026-08-03').bh, 40);
  assert.equal(cellOf(m, '2026-08-10').bh, 30);
});
test('already-credited BH is excluded — only the remainder is booked', () => {
  const ledger: MultiDayJob = {
    jobberVisitId: 'v3', jobberJobId: 'j', jobberJobNumber: 1, title: 'Big job',
    totalBH: 100, isLawnJob: false, manualOverride: false, status: 'in_progress',
    firstSeenAt: 1,
    completionHistory: [
      { targetDate: '2026-08-04', percentComplete: 60, creditedBH: 60, crewId: 'c', markedAt: 1, markedBy: 'x', markedByName: 'X', isRetroactive: false },
    ],
  };
  const m = model(
    [visit({ visitId: 'v3', startDate: '2026-08-06', endDate: '2026-08-07', bh: 100 })],
    { multiDayJobs: { v3: ledger } },
  );
  // 100 total − 60 credited = 40 remaining, both days inside week Aug 3.
  assert.equal(cellOf(m, '2026-08-03').bh, 40);
  assert.equal(cellOf(m, '2026-08-03').jobs[0].creditedBH, 60);
});
test('a fully credited (complete) ledger contributes nothing', () => {
  const ledger: MultiDayJob = {
    jobberVisitId: 'v4', jobberJobId: 'j', jobberJobNumber: 1, title: 'Done',
    totalBH: 50, isLawnJob: false, manualOverride: false, status: 'complete',
    firstSeenAt: 1, completionHistory: [],
  };
  const m = model([visit({ visitId: 'v4', bh: 50 })], { multiDayJobs: { v4: ledger } });
  assert.equal(cellOf(m, '2026-08-03').bh, 0);
});
test('an in-flight multi-day job started before today books only its remaining days', () => {
  // Started Mon Aug 3, runs to Fri Aug 7 → only Aug 6 + Aug 7 are ahead.
  const m = model([visit({ visitId: 'v5', startDate: '2026-08-03', endDate: '2026-08-07', bh: 20 })]);
  assert.equal(cellOf(m, '2026-08-03').bh, 20);
  assert.equal(cellOf(m, '2026-08-03').jobs[0].totalRemaining, 20);
});
test('hourly + untagged visits carry 0 BH but are counted, not hidden', () => {
  const m = model([
    visit({ visitId: 'v6', bh: 0, isHourly: true }),
    visit({ visitId: 'v7', bh: 0, untagged: true }),
  ]);
  const c = cellOf(m, '2026-08-03');
  assert.equal(c.bh, 0);
  assert.equal(c.hourlyCount, 1);
  assert.equal(c.untaggedCount, 1);
});
test('unmatched assignees land in an Unassigned row, never dropped', () => {
  const m = model([visit({ visitId: 'v8', assigneeIds: ['ghost'], bh: 25 })]);
  assert.ok(m.unassigned, 'expected an unassigned row');
  const i = m.weeks.findIndex(w => w.start === '2026-08-03');
  assert.equal(m.unassigned!.cells[i].bh, 25);
});
test('a scheduled crew with no forward work still shows as an empty row', () => {
  const m = model([]);
  const div = m.divisions.find(d => d.division === 'Large Projects')!;
  assert.equal(div.crews!.length, 1);
  assert.equal(div.crews![0].cells[0].bh, 0);
  assert.equal(div.crews![0].cells[0].band, 'under');
});

console.log('\nBooked out to');
test('quotes the Friday of the last week at or above the underbooked line', () => {
  const m = model([
    visit({ visitId: 'v9', startDate: '2026-08-06', endDate: '2026-08-06', bh: 90 }),
    visit({ visitId: 'v10', startDate: '2026-08-12', endDate: '2026-08-12', bh: 80 }),
    visit({ visitId: 'v11', startDate: '2026-08-19', endDate: '2026-08-19', bh: 10 }),  // 10% — thin
  ]);
  const div = m.divisions.find(d => d.division === 'Large Projects')!;
  assert.equal(div.bookedOutWeek, '2026-08-10');
  assert.equal(div.bookedOutTo, '2026-08-14');
});
test('with no capacity set, any scheduled BH counts as booked', () => {
  const m = model(
    [visit({ visitId: 'v12', startDate: '2026-08-19', endDate: '2026-08-19', bh: 3 })],
    { settings: {} },
  );
  const div = m.divisions.find(d => d.division === 'Large Projects')!;
  assert.equal(div.cells[0].capacity, null);
  assert.equal(div.cells[0].pct, null);
  assert.equal(div.bookedOutWeek, '2026-08-17');
});
test('nothing booked → no booked-out date at all', () => {
  const m = model([]);
  assert.equal(m.divisions[0].bookedOutTo, null);
});

console.log('\nDivision rollup');
test('division capacity sums its crews and flags partial coverage', () => {
  const schedules: Record<string, Crew[]> = {
    [TODAY]: [
      crew('Lawn Division', 1, ['a1'], ['e1', 'e2']),
      crew('Lawn Division', 2, ['a2'], ['e1']),
    ],
  };
  const m = buildCapacityModel({
    forecast: forecast([]), schedules, employees: EMPLOYEES, multiDayJobs: {},
    settings: { crews: { [capacityCrewKey('Lawn Division', 1)]: { weeklyBH: 70 } } },
    today: TODAY,
  });
  const div = m.divisions.find(d => d.division === 'Lawn Division')!;
  assert.equal(div.capacity, 70);
  assert.equal(div.capacityPartial, true);
});
test('multi-crew visits split evenly and the drill-down merges the slices', () => {
  const schedules: Record<string, Crew[]> = {
    [TODAY]: [
      crew('Lawn Division', 1, ['a1'], ['e1']),
      crew('Lawn Division', 2, ['a2'], ['e2']),
    ],
  };
  const m = buildCapacityModel({
    forecast: forecast([visit({ visitId: 'v13', assigneeIds: ['a1', 'a2'], bh: 30 })]),
    schedules, employees: EMPLOYEES, multiDayJobs: {},
    settings: { divisions: { 'Lawn Division': { weeklyBH: 50 } } }, today: TODAY,
  });
  const div = m.divisions.find(d => d.division === 'Lawn Division')!;
  assert.equal(div.crews![0].cells[0].bh, 15);
  assert.equal(div.crews![1].cells[0].bh, 15);
  assert.equal(div.cells[0].bh, 30);
  assert.equal(mergeSlices(div.cells[0].jobs).length, 1);
  assert.equal(mergeSlices(div.cells[0].jobs)[0].bh, 30);
});

console.log('\nWeek range labels');
test('weeks are labelled with their FULL range, weekends included', () => {
  const w = buildWeeks(TODAY, 2);
  assert.equal(w[0].rangeLabel, 'Aug 3 – Aug 9');
  assert.equal(w[1].rangeLabel, 'Aug 10 – Aug 16');
  // The range must cover Saturday and Sunday — weekend work is counted in
  // the week's BH, so the label has to say so.
  assert.equal(w[0].end, '2026-08-09');
});

console.log('\nScope snapshots');
test('projects + lawn snapshots merge into one model', () => {
  const projects = forecast([visit({ visitId: 'p1', bh: 20 })]);
  const lawn = { ...forecast([visit({ visitId: 'l1', bh: 15 })]), generatedAt: 2, scope: 'lawn' as const };
  const m = buildCapacityModel({
    forecasts: [projects, lawn], schedules: SCHEDULES, employees: EMPLOYEES,
    multiDayJobs: {}, settings: { divisions: { 'Large Projects': { weeklyBH: 100 } } }, today: TODAY,
  });
  assert.equal(cellOf(m, '2026-08-03').bh, 35);
  assert.equal(m.totals.visits, 2);
});
test('a visit present in BOTH scope documents is counted once', () => {
  const a = forecast([visit({ visitId: 'dup', bh: 20 })]);
  const b = { ...forecast([visit({ visitId: 'dup', bh: 20 })]), generatedAt: 99 };
  const m = buildCapacityModel({
    forecasts: [a, b], schedules: SCHEDULES, employees: EMPLOYEES,
    multiDayJobs: {}, settings: { divisions: { 'Large Projects': { weeklyBH: 100 } } }, today: TODAY,
  });
  assert.equal(cellOf(m, '2026-08-03').bh, 20);
  assert.equal(m.totals.visits, 1);
});
test('one scope alone still renders (the other simply absent)', () => {
  const m = buildCapacityModel({
    forecasts: [null, forecast([visit({ visitId: 'l1', bh: 12 })])],
    schedules: SCHEDULES, employees: EMPLOYEES, multiDayJobs: {},
    settings: { divisions: { 'Large Projects': { weeklyBH: 100 } } }, today: TODAY,
  });
  assert.equal(cellOf(m, '2026-08-03').bh, 12);
});
test('newer snapshot wins for a visit whose BH changed between pulls', () => {
  const older = { ...forecast([visit({ visitId: 'v', bh: 10 })]), generatedAt: 1 };
  const newer = { ...forecast([visit({ visitId: 'v', bh: 40 })]), generatedAt: 500 };
  const m = buildCapacityModel({
    forecasts: [older, newer], schedules: SCHEDULES, employees: EMPLOYEES,
    multiDayJobs: {}, settings: { divisions: { 'Large Projects': { weeklyBH: 100 } } }, today: TODAY,
  });
  assert.equal(cellOf(m, '2026-08-03').bh, 40);
});

console.log('\nCoverage — weeks the pull never reached');
const covered = (through: string) => ({
  ...forecast([visit({ visitId: 'c1', bh: 50 })]), coveredThrough: through, truncated: true,
});
test('a week past coverage is UNCOVERED, not an empty open week', () => {
  const m = buildCapacityModel({
    forecasts: [covered('2026-08-16')], schedules: SCHEDULES, employees: EMPLOYEES,
    multiDayJobs: {}, settings: { divisions: { 'Large Projects': { weeklyBH: 100 } } }, today: TODAY,
  });
  const div = m.divisions.find(d => d.division === 'Large Projects')!;
  const wk3 = m.weeks.findIndex(w => w.start === '2026-08-17');
  assert.equal(div.cells[0].uncovered, false);
  assert.equal(div.cells[wk3].uncovered, true);
  // The dangerous case: an uncovered week must carry NO percentage and NO
  // band, or it renders as "underbooked — sell into it".
  assert.equal(div.cells[wk3].pct, null);
  assert.equal(div.cells[wk3].band, null);
});
test('booked-out never quotes a date from an uncovered week', () => {
  const m = buildCapacityModel({
    forecasts: [covered('2026-08-16')], schedules: SCHEDULES, employees: EMPLOYEES,
    multiDayJobs: {}, settings: { divisions: { 'Large Projects': { weeklyBH: 100 } } }, today: TODAY,
  });
  const div = m.divisions.find(d => d.division === 'Large Projects')!;
  assert.ok(div.bookedOutWeek === null || div.bookedOutWeek <= '2026-08-16');
});
test('a complete pull marks nothing uncovered', () => {
  const full = { ...forecast([visit({ visitId: 'f1', bh: 50 })]), coveredThrough: '2026-12-01' };
  const m = buildCapacityModel({
    forecasts: [full], schedules: SCHEDULES, employees: EMPLOYEES,
    multiDayJobs: {}, settings: { divisions: { 'Large Projects': { weeklyBH: 100 } } }, today: TODAY,
  });
  const div = m.divisions.find(d => d.division === 'Large Projects')!;
  assert.equal(div.cells.some(c => c.uncovered), false);
});

test('a scope that has NEVER been pulled is uncovered, not empty-and-open', () => {
  // Only a projects snapshot exists. The lawn crews' weeks must read
  // "not pulled", never "0 BH — sell into it".
  const schedules: Record<string, Crew[]> = {
    [TODAY]: [crew('Lawn Division', 1, ['a2'], ['e1', 'e2']), crew('Large Projects', 1, ['a1'], ['e1'])],
  };
  const projectsSnap = { ...forecast([visit({ visitId: 'p1', bh: 30 })]), scope: 'projects' as const, coveredThrough: '2026-12-01' };
  const m = buildCapacityModel({
    forecasts: [projectsSnap], schedules, employees: EMPLOYEES, multiDayJobs: {},
    settings: { divisions: { 'Lawn Division': { weeklyBH: 80 }, 'Large Projects': { weeklyBH: 100 } } },
    today: TODAY,
  });
  const lawn = m.divisions.find(d => d.division === 'Lawn Division')!;
  const proj = m.divisions.find(d => d.division === 'Large Projects')!;
  assert.equal(lawn.cells[0].uncovered, true, 'lawn must be uncovered');
  assert.equal(lawn.cells[0].pct, null);
  assert.equal(lawn.cells[0].band, null);
  assert.equal(lawn.bookedOutTo, null);
  // The scope that WAS pulled is unaffected.
  assert.equal(proj.cells[0].uncovered, false);
  assert.equal(proj.cells[0].bh, 30);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

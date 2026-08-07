// Tests for the two capacity tools.
//   npx tsx src/lib/capacity.test.ts
import assert from 'node:assert/strict';
import {
  buildWeeks, mondayOf, bandFor, thresholdsOrDefault, ceilingFor, declaredFor,
  assigneeDivisionIndex, buildBookingModel, buildBalanceModel, mergeSlices,
  forwardSlices, loadForSlice, assigneeInventory, scheduleDivisionIndex,
} from './capacity';
import type { AppData, CapacityForecast, CapacityForecastVisit, Crew, Employee, MultiDayJob } from '../types';

let pass = 0, fail = 0;
const test = (n: string, fn: () => void) => {
  try { fn(); pass++; console.log(`  ✓ ${n}`); }
  catch (e) { fail++; console.error(`  ✗ ${n}\n      ${(e as Error).message}`); }
};

// Anchor: Thursday 2026-08-06. Its week starts Monday 2026-08-03.
const TODAY = '2026-08-06';
const MON_FRI = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'];
// Jobber assignee ids behave as ROUTE SLOTS — one per crew-day.
const LAWN_SLOT = 'slot-lawn-1';
const PROJ_SLOT = 'slot-proj-1';

const visit = (o: Partial<CapacityForecastVisit>): CapacityForecastVisit => ({
  visitId: 'v', jobId: 'j', jobNumber: '100', desc: 'Job', client: 'Client',
  startDate: TODAY, endDate: TODAY, bh: 10, isHourly: false, untagged: false,
  assigneeIds: [PROJ_SLOT], assigneeNames: ['#1 (SOUTH)'], ...o,
});
const forecast = (visits: CapacityForecastVisit[], o: Partial<CapacityForecast> = {}): CapacityForecast => ({
  generatedAt: 1, generatedBy: 'scheduled', windowStart: '2026-07-16',
  windowEnd: '2026-12-04', today: TODAY, visits,
  stats: { fetched: visits.length, kept: visits.length, completeSkipped: 0, endedBeforeToday: 0, untagged: 0, hourly: 0 },
  truncated: false, degraded: false, warnings: [], ...o,
});
const crew = (division: string, crewNumber: number, slots: string[], employees: string[]): Crew => ({
  id: `c-${division}-${crewNumber}`, division, crewNumber, employees,
  fleet: [], inventory: [], jobberAssigneeIds: slots,
});
const EMPLOYEES: Employee[] = ['e1', 'e2', 'e3'].map((id, i) => ({
  id, name: `Worker ${i + 1}`, status: 'Active', hasLicense: false,
  hasClassA: false, hasHeavyMachinery: false, awayDates: [],
}));
const fullWeek = (crews: Crew[]): Record<string, Crew[]> =>
  Object.fromEntries(MON_FRI.map(d => [d, crews]));
const SCHEDULES = fullWeek([
  crew('Large Projects', 1, [PROJ_SLOT], ['e1', 'e2']),
  crew('Lawn Division', 1, [LAWN_SLOT], ['e3']),
]);
const appDataOf = (schedules: Record<string, Crew[]>, employees = EMPLOYEES, dailyAbsences: Record<string, any> = {}): AppData =>
  ({ schedules, employees, dailyAbsences, fleet: [] } as unknown as AppData);

const DECLARED = {
  // Declared as its PARTS: 1 crew x 4 people x 25 BH = 100; lawn 2 x 4 x 25 = 200.
  declared: {
    'Large Projects': { peoplePerCrew: 4, bhPerPerson: 25 },
    'Lawn Division': { crews: 2, peoplePerCrew: 4, bhPerPerson: 25 },
  },
  headcountCeilings: [
    { headcount: 1, weeklyBH: 40 },
    { headcount: 2, weeklyBH: 70 },
    { headcount: 3, weeklyBH: 90 },
  ],
};

const booking = (visits: CapacityForecastVisit[], extra: any = {}) => buildBookingModel({
  snapshots: [forecast(visits)], schedules: SCHEDULES, multiDayJobs: {},
  settings: DECLARED, today: TODAY, ...extra,
});
const cellOf = (m: ReturnType<typeof booking>, division: string, weekStart: string) => {
  const row = m.rows.find(r => r.division === division)!;
  return row.cells[m.weeks.findIndex(w => w.start === weekStart)];
};

console.log('\nWeek arithmetic');
test('weeks start Monday and carry a full range label', () => {
  assert.equal(mondayOf(TODAY), '2026-08-03');
  const w = buildWeeks(TODAY, 2);
  assert.equal(w[0].rangeLabel, 'Aug 3 – Aug 9');
  assert.equal(w[0].days.length, 7);
  assert.equal(w[0].friday, '2026-08-07');
});

console.log('\nThresholds and ceilings');
test('bands: <70 under, <90 light, <=110 healthy, >110 over', () => {
  const t = thresholdsOrDefault(undefined);
  assert.equal(bandFor(69, t), 'under');
  assert.equal(bandFor(70, t), 'light');
  assert.equal(bandFor(90, t), 'healthy');
  assert.equal(bandFor(110, t), 'healthy');
  assert.equal(bandFor(111, t), 'over');
});
test('ceilings are non-linear and read with FLOOR semantics', () => {
  const c = DECLARED.headcountCeilings;
  assert.equal(ceilingFor(c, 1).bh, 40);
  assert.equal(ceilingFor(c, 2).bh, 70);
  assert.equal(ceilingFor(c, 3).bh, 90);
  // A solo crew delivers MORE than half a pair — the point of the table.
  assert.ok(40 > 70 / 2);
});
test('a crew bigger than every row takes the top row ("N or more")', () => {
  assert.equal(ceilingFor(DECLARED.headcountCeilings, 9).bh, 90);
});
test('declared capacity is null until management sets it, and says "not set"', () => {
  const unset = declaredFor({ declared: { 'Small Projects': { peoplePerCrew: null, bhPerPerson: null } } }, 'Small Projects');
  assert.equal(unset.bh, null);
  assert.match(unset.basis, /not set/);
  assert.equal(declaredFor(undefined, 'Small Projects').bh, null);
});
test('capacity is people x BH/person, with crews defaulting to 1', () => {
  const d = declaredFor(DECLARED, 'Large Projects');
  assert.equal(d.bh, 100);
  assert.equal(d.crews, 1);
  assert.equal(d.basis, 'capacity based on 4 employees at 25 BH/employee = 100 BH/week');
});
test('a multi-crew division multiplies by its crew count and says so', () => {
  const d = declaredFor(DECLARED, 'Lawn Division');
  assert.equal(d.bh, 200);
  assert.equal(d.basis, 'capacity based on 2 crews × 4 employees at 25 BH/employee = 200 BH/week');
});
test("the spec's example renders exactly", () => {
  const d = declaredFor({ declared: { X: { peoplePerCrew: 3, bhPerPerson: 35 } } }, 'X');
  assert.equal(d.bh, 105);
  assert.equal(d.basis, 'capacity based on 3 employees at 35 BH/employee = 105 BH/week');
});
test('a partial entry is NOT capacity — people alone yields nothing', () => {
  assert.equal(declaredFor({ declared: { X: { peoplePerCrew: 3 } } }, 'X').bh, null);
  assert.equal(declaredFor({ declared: { X: { bhPerPerson: 35 } } }, 'X').bh, null);
});
test('CAPACITY IS NEVER READ FROM THE SCHEDULE — rostering more people changes nothing', () => {
  const settings = { declared: { 'Large Projects': { peoplePerCrew: 4, bhPerPerson: 25 } } };
  const lean = fullWeek([crew('Large Projects', 1, [PROJ_SLOT], ['e1'])]);          // 1 person
  const heavy = fullWeek([crew('Large Projects', 1, [PROJ_SLOT], ['e1', 'e2', 'e3'])]); // 3 people
  const capOf = (schedules: Record<string, Crew[]>) => buildBookingModel({
    snapshots: [forecast([visit({ visitId: 'z', bh: 10 })])], schedules,
    multiDayJobs: {}, settings, today: TODAY,
  }).rows.find(r => r.division === 'Large Projects')!.cells[0].capacity;
  assert.equal(capOf(lean), 100);
  assert.equal(capOf(heavy), 100, 'the roster must not move declared capacity');
});

console.log('\nHourly work is estimated, not ignored');
const HOURLY_SETTINGS = {
  declared: {
    'Large Projects': { peoplePerCrew: 4, bhPerPerson: 25, hourlyDefaultBH: 4 },
  },
};
const sliceOf = (v: Partial<CapacityForecastVisit>) =>
  forwardSlices([forecast([visit(v)])], {}, TODAY)[0];

test('an hourly visit with a Jobber duration uses that duration', () => {
  const s2 = sliceOf({ visitId: 'h1', bh: 0, isHourly: true, durationHours: 6 });
  const load = loadForSlice(s2, 'Large Projects', HOURLY_SETTINGS);
  assert.equal(load.bh, 6);
  assert.equal(load.estimated, true);
  assert.equal(load.basis, 'duration');
});
test('without a duration it falls back to the division default', () => {
  const s2 = sliceOf({ visitId: 'h2', bh: 0, isHourly: true });
  const load = loadForSlice(s2, 'Large Projects', HOURLY_SETTINGS);
  assert.equal(load.bh, 4);
  assert.equal(load.basis, 'default');
});
test('a tagged visit is never estimated', () => {
  const s2 = sliceOf({ visitId: 'h3', bh: 12 });
  const load = loadForSlice(s2, 'Large Projects', HOURLY_SETTINGS);
  assert.equal(load.bh, 12);
  assert.equal(load.estimated, false);
  assert.equal(load.basis, null);
});
test('UNTAGGED uses a real duration but gets NO default guess', () => {
  const withDur = loadForSlice(sliceOf({ visitId: 'u1', bh: 0, untagged: true, durationHours: 3 }), 'Large Projects', HOURLY_SETTINGS);
  assert.equal(withDur.bh, 3);
  assert.equal(withDur.basis, 'duration');
  const without = loadForSlice(sliceOf({ visitId: 'u2', bh: 0, untagged: true }), 'Large Projects', HOURLY_SETTINGS);
  assert.equal(without.bh, 0, 'a missing tag is a data gap, not a category of work');
  assert.equal(without.estimated, false);
});
test('no default set → hourly contributes nothing rather than a made-up number', () => {
  const load = loadForSlice(sliceOf({ visitId: 'h4', bh: 0, isHourly: true }), 'Large Projects', { declared: {} });
  assert.equal(load.bh, 0);
  assert.equal(load.estimated, false);
});
test('the week keeps booked and estimated SEPARATE, and the % includes both', () => {
  const m = buildBookingModel({
    snapshots: [forecast([
      visit({ visitId: 'p1', bh: 42 }),
      visit({ visitId: 'p2', bh: 0, isHourly: true, durationHours: 6 }),
      visit({ visitId: 'p3', bh: 0, isHourly: true, durationHours: 6 }),
    ])],
    schedules: SCHEDULES, multiDayJobs: {}, settings: HOURLY_SETTINGS, today: TODAY,
  });
  const c = m.rows.find(r => r.division === 'Large Projects')!.cells[0];
  assert.equal(c.bh, 42, 'measured BH stays measured');
  assert.equal(c.estBH, 12, 'two 6-hour hourly visits');
  assert.equal(c.totalBH, 54);
  assert.equal(c.estCount, 2);
  assert.equal(c.estFromDuration, 12);
  assert.equal(c.pct, 54, '54 of 100 declared — the estimate is included');
});
test('booked-out-to counts a week that is only hourly work', () => {
  const m = buildBookingModel({
    snapshots: [forecast([
      visit({ visitId: 'h5', bh: 0, isHourly: true, durationHours: 8, startDate: '2026-08-13', endDate: '2026-08-13' }),
    ])],
    schedules: SCHEDULES, multiDayJobs: {},
    settings: { declared: { 'Large Projects': { hourlyDefaultBH: 4 } } }, today: TODAY,
  });
  const row = m.rows.find(r => r.division === 'Large Projects')!;
  // No declared capacity here, so "meaningful" is any load — including the
  // estimate. An hourly job next Thursday means next Thursday is booked.
  assert.equal(row.bookedOutWeek, '2026-08-10');
});

console.log('\nAssignee → division (Tool 1 needs no crew mapping)');
test('a route slot resolves to its division', () => {
  const idx = assigneeDivisionIndex(SCHEDULES);
  assert.equal(idx.get(PROJ_SLOT), 'Large Projects');
  assert.equal(idx.get(LAWN_SLOT), 'Lawn Division');
});
test('a slot that MOVES between crews inside one division still resolves', () => {
  // The exact failure the crew-level model tripped on: same slot, two crews.
  const sched: Record<string, Crew[]> = {
    '2026-08-03': [crew('Large Projects', 1, [PROJ_SLOT], ['e1'])],
    '2026-08-04': [crew('Large Projects', 2, [PROJ_SLOT], ['e2'])],
  };
  assert.equal(assigneeDivisionIndex(sched).get(PROJ_SLOT), 'Large Projects');
});
test('division is decided by MODE, so one odd day cannot reassign a route', () => {
  const sched: Record<string, Crew[]> = { ...fullWeek([crew('Lawn Division', 1, [LAWN_SLOT], ['e3'])]) };
  sched['2026-08-08'] = [crew('Large Projects', 3, [LAWN_SLOT], ['e1'])];  // one stray day
  assert.equal(assigneeDivisionIndex(sched).get(LAWN_SLOT), 'Lawn Division');
});

console.log('\nExplicit assignee mapping');
const SLOT_A = 'slot-a';
const SLOT_B = 'slot-b';

test('two slots mapped to Small Projects BOTH attribute there', () => {
  const settings = {
    declared: { 'Small Projects': { peoplePerCrew: 2, bhPerPerson: 30 } },
    assigneeMap: {
      [SLOT_A]: { division: 'Small Projects' },
      [SLOT_B]: { division: 'Small Projects' },
    },
  };
  const m = buildBookingModel({
    snapshots: [forecast([
      visit({ visitId: 'a', assigneeIds: [SLOT_A], bh: 20 }),
      visit({ visitId: 'b', assigneeIds: [SLOT_B], bh: 15 }),
    ])],
    schedules: SCHEDULES, multiDayJobs: {}, settings, today: TODAY,
  });
  const row = m.rows.find(r => r.division === 'Small Projects')!;
  assert.equal(row.cells[0].bh, 35, 'a division holds as many slots as it needs');
  assert.equal(m.unattributed, null, 'and nothing is left over');
});
test('an explicit mapping OVERRIDES what the schedule says', () => {
  // PROJ_SLOT is rostered on Large Projects, but mapped to Small.
  const settings = { assigneeMap: { [PROJ_SLOT]: { division: 'Small Projects' } } };
  assert.equal(scheduleDivisionIndex(SCHEDULES).get(PROJ_SLOT), 'Large Projects');
  const m = buildBookingModel({
    snapshots: [forecast([visit({ visitId: 'c', bh: 10 })])],
    schedules: SCHEDULES, multiDayJobs: {}, settings, today: TODAY,
  });
  assert.equal(m.rows.find(r => r.division === 'Small Projects')!.cells[0].bh, 10);
  assert.equal(m.rows.find(r => r.division === 'Large Projects')?.cells[0].bh ?? 0, 0);
});
test('an UNMAPPED slot still falls back to schedule matching', () => {
  const settings = { assigneeMap: { [SLOT_A]: { division: 'Small Projects' } } };
  const m = buildBookingModel({
    snapshots: [forecast([visit({ visitId: 'd', bh: 10 })])],  // PROJ_SLOT, unmapped
    schedules: SCHEDULES, multiDayJobs: {}, settings, today: TODAY,
  });
  assert.equal(m.rows.find(r => r.division === 'Large Projects')!.cells[0].bh, 10);
});
test('mapping a previously-unattributed slot SHRINKS Unattributed', () => {
  const snap = [forecast([visit({ visitId: 'e', assigneeIds: ['ghost'], bh: 25 })])];
  const before = buildBookingModel({
    snapshots: snap, schedules: SCHEDULES, multiDayJobs: {}, settings: DECLARED, today: TODAY,
  });
  assert.equal(before.unattributed!.cells[0].bh, 25);
  const after = buildBookingModel({
    snapshots: snap, schedules: SCHEDULES, multiDayJobs: {},
    settings: { ...DECLARED, assigneeMap: { ghost: { division: 'Large Projects' } } }, today: TODAY,
  });
  assert.equal(after.unattributed, null, 'Unattributed is gone');
  assert.equal(after.rows.find(r => r.division === 'Large Projects')!.cells[0].bh, 25);
});

test('BOOKING resolves a week with NO schedule built, from mappings alone', () => {
  // The whole point of the mapping: a week four out, no roster anywhere.
  const settings = {
    declared: { 'Small Projects': { peoplePerCrew: 2, bhPerPerson: 30 } },
    assigneeMap: { [SLOT_A]: { division: 'Small Projects' } },
  };
  const far = '2026-09-01';   // Tuesday, four weeks out, nothing scheduled
  const m = buildBookingModel({
    snapshots: [forecast([visit({ visitId: 'far', assigneeIds: [SLOT_A], bh: 44, startDate: far, endDate: far })])],
    schedules: {},   // NO schedule at all
    multiDayJobs: {}, settings, today: TODAY, weeks: 6,
  });
  const row = m.rows.find(r => r.division === 'Small Projects')!;
  const wi = m.weeks.findIndex(w => w.start === '2026-08-31');
  assert.equal(row.cells[wi].bh, 44, 'attributed with no schedule in sight');
  assert.equal(m.unattributed, null);
});

console.log('\nDerivation — where a division\'s number came from');
test('each division names the assignees its BH came from', () => {
  const settings = {
    declared: { 'Small Projects': { peoplePerCrew: 2, bhPerPerson: 30 } },
    assigneeMap: {
      [SLOT_A]: { division: 'Small Projects', label: '#1 (SOUTH)' },
      [SLOT_B]: { division: 'Small Projects', label: '#2 (NORTH)' },
    },
  };
  const m = buildBookingModel({
    snapshots: [forecast([
      visit({ visitId: 'x', assigneeIds: [SLOT_A], assigneeNames: ['#1 (SOUTH)'], bh: 20 }),
      visit({ visitId: 'y', assigneeIds: [SLOT_B], assigneeNames: ['#2 (NORTH)'], bh: 15 }),
    ])],
    schedules: SCHEDULES, multiDayJobs: {}, settings, today: TODAY,
  });
  const row = m.rows.find(r => r.division === 'Small Projects')!;
  assert.deepEqual(row.sources.map(s2 => s2.label).sort(), ['#1 (SOUTH)', '#2 (NORTH)']);
  assert.equal(row.sources.every(s2 => s2.viaMapping), true);
  assert.equal(row.scheduleMatchedJobs, 0);
});
test('work matched via the SCHEDULE is counted and flagged separately', () => {
  const m = buildBookingModel({
    snapshots: [forecast([visit({ visitId: 'z', bh: 30 })])],  // PROJ_SLOT, unmapped
    schedules: SCHEDULES, multiDayJobs: {}, settings: DECLARED, today: TODAY,
  });
  const row = m.rows.find(r => r.division === 'Large Projects')!;
  assert.equal(row.sources[0].viaMapping, false);
  assert.equal(row.scheduleMatchedJobs, 1, 'one job resting on the schedule');
});

console.log('\nRECONCILIATION — the raw lookup vs what Booking shows');
test("a division's Booking total equals the raw BH of its source assignees", () => {
  const settings = {
    declared: { 'Small Projects': { peoplePerCrew: 2, bhPerPerson: 30 } },
    assigneeMap: {
      [SLOT_A]: { division: 'Small Projects' },
      [SLOT_B]: { division: 'Small Projects' },
    },
  };
  const visits = [
    visit({ visitId: 'r1', assigneeIds: [SLOT_A], bh: 20 }),
    visit({ visitId: 'r2', assigneeIds: [SLOT_B], bh: 15 }),
    visit({ visitId: 'r3', assigneeIds: [SLOT_A], bh: 7, startDate: '2026-08-11', endDate: '2026-08-11' }),
  ];
  const m = buildBookingModel({
    snapshots: [forecast(visits)], schedules: SCHEDULES, multiDayJobs: {}, settings, today: TODAY,
  });
  const row = m.rows.find(r => r.division === 'Small Projects')!;
  // What the LOOKUP would show for those two assignees over the same window:
  // the raw per-day slices, unfiltered by any model.
  const raw = forwardSlices([forecast(visits)], {}, TODAY)
    .filter(s2 => s2.assigneeIds.some(a => [SLOT_A, SLOT_B].includes(a)))
    .filter(s2 => s2.date >= m.weeks[0].start && s2.date <= m.weeks[3].end)
    .reduce((sum, s2) => sum + s2.bh, 0);
  assert.equal(Math.round(raw * 10) / 10, 42);
  assert.equal(row.totalBH, 42, 'Booking and the raw lookup agree exactly');
  assert.equal(row.sources.reduce((sum, s2) => sum + s2.bh, 0), 42, 'and so do the per-source figures');
});

console.log('\nMapping diagnostics');
const inv = (settings: any = {}, visits = [visit({ visitId: 'i1', assigneeIds: ['ghost'], assigneeNames: ['#9 (NORTH)'], bh: 18 })]) =>
  assigneeInventory({
    snapshots: [forecast(visits)], schedules: SCHEDULES,
    jobberUsers: [{ id: PROJ_SLOT, name: '#1 (SOUTH)', isAccountOwner: false }],
    settings, multiDayJobs: {}, today: TODAY,
  });

test('every slot is listed with its forward BH and where it lands', () => {
  const d = inv();
  const proj = d.assignees.find(a => a.id === PROJ_SLOT)!;
  assert.equal(proj.label, '#1 (SOUTH)', 'the Jobber user list supplies the name');
  assert.equal(proj.resolvedDivision, 'Large Projects');
  assert.equal(proj.source, 'schedule');
  assert.deepEqual(proj.scheduleCrews, ['Large Projects #1']);
});
test('an unmapped slot is reported with the BH it is costing', () => {
  const d = inv();
  const ghost = d.unmapped.find(a => a.id === 'ghost')!;
  assert.ok(ghost, 'the ghost slot is flagged as unmapped');
  assert.equal(ghost.label, '#9 (NORTH)', 'name falls back to the snapshot');
  assert.equal(ghost.forwardBH, 18);
  assert.equal(d.unmappedBH, 18);
});
test('a slot mapped to one division but rostered on another is a CONFLICT', () => {
  const d = inv({ assigneeMap: { [PROJ_SLOT]: { division: 'Lawn Division' } } });
  const c = d.conflicts.find(a => a.id === PROJ_SLOT)!;
  assert.ok(c, 'the disagreement is surfaced');
  assert.equal(c.mapped!.division, 'Lawn Division');
  assert.equal(c.scheduleDivision, 'Large Projects');
  assert.equal(c.resolvedDivision, 'Lawn Division', 'the explicit mapping still wins');
});
test('crew-days carrying no Jobber slot are listed', () => {
  const sched = { ...SCHEDULES, '2026-08-05': [crew('Small Projects', 3, [], ['e1'])] };
  const d = assigneeInventory({
    snapshots: [forecast([])], schedules: sched, jobberUsers: [],
    settings: {}, multiDayJobs: {}, today: TODAY,
  });
  assert.equal(d.unmappedCrewDays.length, 1);
  assert.equal(d.unmappedCrewDays[0].crew, 'Small Projects #3');
});

console.log('\nTOOL 1 — Booking');
test('booked BH lands on its division and is measured against the declared number', () => {
  const m = booking([visit({ visitId: 'v1', bh: 70 })]);
  const c = cellOf(m, 'Large Projects', '2026-08-03');
  assert.equal(c.bh, 70);
  assert.equal(c.capacity, 100);
  assert.equal(c.pct, 70);
  assert.equal(c.band, 'light');
});
test('no declared number → raw BH, no percentage, no band', () => {
  const m = buildBookingModel({
    snapshots: [forecast([visit({ visitId: 'v2', bh: 70 })])], schedules: SCHEDULES,
    multiDayJobs: {}, settings: { declared: { 'Large Projects': { peoplePerCrew: null, bhPerPerson: null } } }, today: TODAY,
  });
  const c = cellOf(m, 'Large Projects', '2026-08-03');
  assert.equal(c.bh, 70);
  assert.equal(c.capacity, null);
  assert.equal(c.pct, null);
  assert.equal(c.band, null);
});
test('work whose assignee maps nowhere lands in ONE visible Unattributed row', () => {
  const m = booking([visit({ visitId: 'v3', assigneeIds: ['ghost'], bh: 25 })]);
  assert.ok(m.unattributed, 'expected an Unattributed row');
  assert.equal(m.unattributed!.cells[0].bh, 25);
  assert.equal(m.unattributed!.declared, null);
});
test('multi-day work spreads across the weeks it spans', () => {
  // Thu Aug 6 → Wed Aug 12: 4 days this week, 3 next.
  const m = booking([visit({ visitId: 'v4', startDate: '2026-08-06', endDate: '2026-08-12', bh: 70 })]);
  assert.equal(cellOf(m, 'Large Projects', '2026-08-03').bh, 40);
  assert.equal(cellOf(m, 'Large Projects', '2026-08-10').bh, 30);
});
test('already-credited BH is excluded — only the remainder is booked', () => {
  const ledger: MultiDayJob = {
    jobberVisitId: 'v5', jobberJobId: 'j', jobberJobNumber: 1, title: 'Big',
    totalBH: 100, isLawnJob: false, manualOverride: false, status: 'in_progress',
    firstSeenAt: 1,
    completionHistory: [{ targetDate: '2026-08-04', percentComplete: 60, creditedBH: 60, crewId: 'c', markedAt: 1, markedBy: 'x', markedByName: 'X', isRetroactive: false }],
  };
  const m = booking([visit({ visitId: 'v5', bh: 100 })], { multiDayJobs: { v5: ledger } });
  assert.equal(cellOf(m, 'Large Projects', '2026-08-03').bh, 40);
});
test('BOOKED OUT TO quotes the Friday of the last meaningfully-loaded week', () => {
  const m = booking([
    visit({ visitId: 'a', startDate: '2026-08-06', endDate: '2026-08-06', bh: 90 }),
    visit({ visitId: 'b', startDate: '2026-08-12', endDate: '2026-08-12', bh: 80 }),
    visit({ visitId: 'c', startDate: '2026-08-19', endDate: '2026-08-19', bh: 5 }),  // thin
  ]);
  const row = m.rows.find(r => r.division === 'Large Projects')!;
  assert.equal(row.bookedOutWeek, '2026-08-10');
  assert.equal(row.bookedOutTo, '2026-08-14');
});
test('a week the pull never reached is UNCOVERED — never an open week', () => {
  const m = buildBookingModel({
    snapshots: [forecast([visit({ visitId: 'v6', bh: 50 })], { coveredThrough: '2026-08-16', truncated: true })],
    schedules: SCHEDULES, multiDayJobs: {}, settings: DECLARED, today: TODAY,
  });
  const row = m.rows.find(r => r.division === 'Large Projects')!;
  assert.equal(row.cells[0].uncovered, false);
  assert.equal(row.cells[2].uncovered, true);
  assert.equal(row.cells[2].pct, null);
  assert.equal(row.cells[2].band, null);
});
test('a division whose scope was never pulled reads uncovered, not empty', () => {
  const m = buildBookingModel({
    snapshots: [forecast([], { scope: 'projects', coveredThrough: '2026-12-01' })],
    schedules: SCHEDULES, multiDayJobs: {}, settings: DECLARED, today: TODAY,
  });
  const lawn = m.rows.find(r => r.division === 'Lawn Division')!;
  assert.equal(lawn.cells[0].uncovered, true);
});

console.log('\nTOOL 2 — Schedule balance');
const balance = (visits: CapacityForecastVisit[], schedules = SCHEDULES, employees = EMPLOYEES, absences = {}) =>
  buildBalanceModel({
    snapshots: [forecast(visits)], appData: appDataOf(schedules, employees, absences),
    multiDayJobs: {}, settings: DECLARED, today: TODAY,
  });

test('covers the current and next week only', () => {
  const m = balance([]);
  assert.equal(m.weeks.length, 2);
  assert.equal(m.weeks[0].start, '2026-08-03');
  assert.equal(m.weeks[1].start, '2026-08-10');
});
test('WEEK TOTAL is what trips the ceiling, not a daily figure', () => {
  // 80 BH on one day for a 2-person crew: ceiling 70 → over by 10 on the
  // WEEK, with no daily derivation applied anywhere.
  const m = balance([visit({ visitId: 'v7', bh: 80 })]);
  const c = m.crews.find(x => x.key === 'Large Projects#1')!;
  assert.equal(c.weeks[0].totalBH, 80);
  assert.equal(c.weeks[0].headcount, 2);
  assert.equal(c.weeks[0].ceiling, 70);
  assert.equal(c.weeks[0].over, true);
  assert.equal(c.weeks[0].overBy, 10);
});
test('under the ceiling is normal — no over flag', () => {
  const m = balance([visit({ visitId: 'v8', bh: 50 })]);
  const c = m.crews.find(x => x.key === 'Large Projects#1')!;
  assert.equal(c.weeks[0].over, false);
  assert.equal(c.weeks[0].overBy, 0);
});
test('approved time off lowers headcount, which can lower the ceiling', () => {
  const employees = EMPLOYEES.map(e => e.id === 'e2'
    ? { ...e, awayDates: [{ start: '2026-08-03', end: '2026-08-07' }] } : e);
  const m = balance([visit({ visitId: 'v9', bh: 50 })], SCHEDULES, employees);
  const c = m.crews.find(x => x.key === 'Large Projects#1')!;
  assert.equal(c.weeks[0].headcount, 1, 'one of the two is off all week');
  assert.equal(c.weeks[0].ceiling, 40);
  assert.equal(c.weeks[0].over, true, '50 booked against a 40 ceiling');
});
test('an unrostered week says "not scheduled" rather than projecting', () => {
  const m = balance([]);
  const c = m.crews.find(x => x.key === 'Large Projects#1')!;
  assert.equal(c.weeks[1].scheduled, false);
  assert.equal(c.weeks[1].headcount, null);
  assert.equal(c.weeks[1].ceiling, null);
  assert.equal(c.weeks[1].over, false);
});
test('daily cells carry the day BH for context', () => {
  const m = balance([visit({ visitId: 'v10', bh: 30, startDate: '2026-08-06', endDate: '2026-08-06' })]);
  const c = m.crews.find(x => x.key === 'Large Projects#1')!;
  const day = c.weeks[0].days.find(d => d.date === '2026-08-06')!;
  assert.equal(day.bh, 30);
  assert.equal(day.rostered, 2);
  assert.equal(day.isScheduled, true);
});

console.log('\nScheduling errors surfaced');
test('an unmapped crew-day is reported', () => {
  const sched = fullWeek([crew('Small Projects', 9, [], ['e1'])]);   // no slots
  const m = balance([], sched);
  const issues = m.issues.filter(i => i.kind === 'unmapped_crew_day');
  assert.ok(issues.length >= 1);
  assert.match(issues[0].detail, /No Jobber assignee/);
});
test('work matching no crew is reported with its assignee and BH', () => {
  const m = balance([visit({ visitId: 'v11', assigneeIds: ['ghost'], assigneeNames: ['#9 (NORTH)'], bh: 20 })]);
  const iss = m.issues.find(i => i.kind === 'unassigned_work')!;
  assert.ok(iss, 'expected an unassigned_work issue');
  assert.match(iss.detail, /#9 \(NORTH\)/);
  assert.equal(m.unassignedBH, 20);
});
test('one assignee on two crews the SAME day is reported', () => {
  const sched = fullWeek([
    crew('Large Projects', 1, [PROJ_SLOT], ['e1']),
    crew('Large Projects', 2, [PROJ_SLOT], ['e2']),   // same slot, same day
  ]);
  const m = balance([], sched);
  const iss = m.issues.filter(i => i.kind === 'duplicate_assignee');
  assert.ok(iss.length >= 1);
  assert.match(iss[0].detail, /2 crews the same day/);
});

console.log('\nShared plumbing');
test('forward slices exclude a completed ledger entirely', () => {
  const ledger: MultiDayJob = {
    jobberVisitId: 'done', jobberJobId: 'j', jobberJobNumber: 1, title: 'Done',
    totalBH: 50, isLawnJob: false, manualOverride: false, status: 'complete',
    firstSeenAt: 1, completionHistory: [],
  };
  const slices = forwardSlices([forecast([visit({ visitId: 'done', bh: 50 })])], { done: ledger }, TODAY);
  assert.equal(slices.length, 0);
});
test('mergeSlices sums a visit that contributed more than once', () => {
  const slices = forwardSlices([forecast([visit({ visitId: 'm1', startDate: '2026-08-06', endDate: '2026-08-07', bh: 20 })])], {}, TODAY);
  assert.equal(slices.length, 2);
  assert.equal(mergeSlices(slices).length, 1);
  assert.equal(mergeSlices(slices)[0].bh, 20);
});
test('the two scope snapshots merge, newest winning per visit', () => {
  const older = forecast([visit({ visitId: 'x', bh: 10 })], { generatedAt: 1 });
  const newer = forecast([visit({ visitId: 'x', bh: 40 })], { generatedAt: 99 });
  const m = buildBookingModel({
    snapshots: [older, newer], schedules: SCHEDULES, multiDayJobs: {},
    settings: DECLARED, today: TODAY,
  });
  assert.equal(cellOf(m, 'Large Projects', '2026-08-03').bh, 40);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

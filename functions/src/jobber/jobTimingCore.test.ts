// Job timing labour rules.
//   npm test -- jobTimingCore
import {test} from "vitest";
import assert from "node:assert/strict";
import {
  buildRecord,
  computeLabour,
  computeMultiCrewDay,
  DayCrew,
  groupByVisitDay,
  pickCrews,
  unionMs,
  VisitTimerEntry,
} from "./jobTimingCore";
import {headcountSplit} from "./bhSplit";

let n = 0;
const entry = (
  userId: string, start: string, end: string | null,
): VisitTimerEntry => ({
  entryId: `e${++n}`,
  userId,
  userName: userId.toUpperCase(),
  startAt: `2026-07-15T${start}:00Z`,
  endAt: end ? `2026-07-15T${end}:00Z` : null,
  ticking: end === null,
  finalDuration: null,
});
const crew = (key: string, ...jobberIds: Array<string | null>): DayCrew => ({
  id: `id-${key}`,
  key,
  label: key,
  division: "Lawn Division",
  members: jobberIds.map((j, i) => ({
    empId: `${key}-${i}`, jobberUserId: j, name: j || `callin${i}`,
  })),
});

test("every crew member timed it → exact sum, no multiplying", () => {
  const t = computeLabour(
    [entry("a", "13:00", "14:00"), entry("b", "13:10", "13:40")],
    [crew("lawn-1", "a", "b")],
  );
  assert.equal(t?.labourHours, 1.5);
  assert.equal(t?.method, "all timed");
  assert.equal(t?.quality, "full");
});

test("solo crew timing it is fully measured, not 1 × 1", () => {
  const t = computeLabour([entry("a", "13:00", "13:45")], [crew("c", "a")]);
  assert.equal(t?.labourHours, 0.75);
  assert.equal(t?.method, "all timed");
});

test("one person timed it → their time × crew size", () => {
  const t = computeLabour([entry("a", "13:00", "13:45")],
    [crew("c", "a", "b")]);
  assert.equal(t?.labourHours, 1.5);
  assert.equal(t?.method, "1 × 2");
  assert.equal(t?.quality, "estimate");
});

test("some but not all → span × crew size", () => {
  const t = computeLabour(
    [entry("a", "13:00", "13:30"), entry("b", "13:15", "14:00")],
    [crew("c", "a", "b", "x")],
  );
  assert.equal(t?.labourHours, 3); // 13:00→14:00 × 3
  assert.equal(t?.method, "span × 3");
});

test("same person timing twice is combined into one person", () => {
  const t = computeLabour(
    [entry("a", "13:00", "13:30"), entry("a", "13:20", "14:00")],
    [crew("c", "a", "b")],
  );
  // one person: 13:00→14:00 = 1h (overlap counted once), × 2
  assert.equal(t?.people.length, 1);
  assert.equal(t?.labourHours, 2);
  assert.equal(t?.method, "1 × 2");
});

test("off-crew timer is real labour and joins the headcount", () => {
  const t = computeLabour(
    [entry("a", "13:00", "14:00"), entry("b", "13:00", "14:00"),
      entry("mgr", "13:30", "14:00")],
    [crew("c", "a", "b")],
  );
  assert.equal(t?.labourHours, 2.5);
  assert.equal(t?.method, "all timed");
  assert.equal(t?.headcount, 3);
  const u = computeLabour(
    [entry("a", "13:00", "14:00"), entry("mgr", "13:30", "14:00")],
    [crew("c", "a", "b")],
  );
  assert.equal(u?.labourHours, 2.5); // 1h × 2 + 0.5h
  assert.equal(u?.method, "1 × 2 + 1 extra");
  assert.equal(u?.headcount, 3);
});

test("only an off-crew person timed it → they stand in, crew + them", () => {
  const t = computeLabour([entry("mgr", "13:00", "14:00")],
    [crew("c", "a", "b")]);
  assert.equal(t?.labourHours, 3);
  assert.equal(t?.method, "1 × 3");
});

test("a call-in member with no Jobber login keeps it from 'all timed'", () => {
  const t = computeLabour([entry("a", "13:00", "14:00")],
    [crew("c", "a", null)]);
  assert.equal(t?.method, "1 × 2");
  assert.equal(t?.labourHours, 2);
});

test("no crew on the schedule → sum of timers, flagged estimate", () => {
  const t = computeLabour([entry("a", "13:00", "14:00")], []);
  assert.equal(t?.labourHours, 1);
  assert.equal(t?.quality, "estimate");
  assert.equal(t?.method, "1 timed, no crew");
});

test("accidental taps under a minute and running timers don't count", () => {
  assert.equal(computeLabour([entry("a", "13:00", "13:00")],
    [crew("c", "a")]), null);
  assert.equal(computeLabour([entry("a", "13:00", null)],
    [crew("c", "a")]), null);
});

test("union merges overlaps and keeps gaps out", () => {
  const H = 3_600_000;
  assert.equal(unionMs([
    {startMs: 0, endMs: H}, {startMs: H / 2, endMs: 2 * H},
    {startMs: 3 * H, endMs: 4 * H},
  ]), 3 * H);
});

test("crew: assignee crew, unless the timers were another crew's", () => {
  const a = {...crew("lawn-1", "u1"), assigneeIds: ["acct1"]};
  const b = {...crew("lawn-2", "u2"), assigneeIds: ["acct2"]};
  assert.equal(pickCrews([a, b], ["acct1"], ["u1"]).crews[0].key, "lawn-1");
  const moved = pickCrews([a, b], ["acct1"], ["u2"]);
  assert.equal(moved.crews[0].key, "lawn-2");
  assert.equal(moved.source, "timer");
  assert.equal(pickCrews([a, b], ["acct1"], ["mgr"]).crews[0].key,
    "lawn-1");
});

test("visit-days group by the Toronto day the timer started", () => {
  const g = groupByVisitDay([
    // 23:30 Toronto on the 14th (03:30Z on the 15th)
    {...entry("a", "03:30", "03:50"), visitId: "v"},
    {...entry("a", "14:00", "15:00"), visitId: "v"},
  ]);
  assert.deepEqual([...g.get("v")!.days.keys()].sort(),
    ["2026-07-14", "2026-07-15"]);
});

test("record: BH from the title, efficiency = BH ÷ labour", () => {
  const day = computeLabour([entry("a", "13:00", "14:00")],
    [crew("c", "a", "b")])!;
  const rec = buildRecord(
    {
      id: "v", title: "Heather Boyer - Weekly [.8]", startAt: null,
      isComplete: true, job: null,
      client: {id: "c1", name: "Heather Boyer",
        tags: {nodes: [{label: "Lush"}]}},
      property: {id: "p1", address: {street: "185 Seminole Crescent"}},
    },
    {"2026-07-15": {...day, date: "2026-07-15", crewSource: "assignee"}},
    {bh: 0.8, isHourly: false},
  )!;
  assert.equal(rec.labourHours, 2);
  assert.equal(rec.efficiency, 0.4);
  assert.equal(rec.lush, true);
  assert.equal(rec.propertyLabel, "Heather Boyer — 185 Seminole Crescent");
});

test("multi-crew: each crew's share vs that crew's own labour", () => {
  // Trailer park: 33 BH split 11/11/11 across three crews. Crew 1 (2 people)
  // timed with both; crew 2 had one of two time it; crew 3 never timed.
  const c1 = crew("lawn-1", "a", "b");
  const c2 = crew("lawn-2", "c", "d");
  const c3 = crew("lawn-3", "e");
  const shares = new Map([[c1.id, 11], [c2.id, 11], [c3.id, 11]]);
  const t = computeMultiCrewDay(
    [entry("a", "13:00", "16:00"), entry("b", "13:00", "16:00"),
      entry("c", "13:00", "15:00")],
    [c1, c2, c3], shares, "sync",
  )!;
  assert.equal(t.labourHours, 10); // 3 + 3 (all timed) + 2 × 2 (1 × 2)
  assert.equal(t.multiCrew?.bhShare, 22); // crew 3 left out, not estimated
  assert.equal(t.multiCrew?.timed, 2);
  assert.equal(t.multiCrew?.assigned, 3);
  assert.equal(t.method, "2 of 3 crews timed (all timed, 1 × 2)");
  const rec = buildRecord(
    {id: "v", title: "Trailer Park Mowing [33]", startAt: null,
      isComplete: true, job: null, client: null, property: null},
    {"2026-07-15": {...t, date: "2026-07-15", crewSource: "assignee"}},
    {bh: 33, isHourly: false},
  )!;
  assert.equal(rec.visitBh, 33);
  assert.equal(rec.bh, 22);
  assert.equal(rec.efficiency, 2.2); // 22 ÷ 10, not 33 ÷ 10
  assert.deepEqual(rec.multiCrew, {assigned: 3, timed: 2});
});

test("multi-crew: a timer on none of the assigned crews isn't counted", () => {
  const c1 = crew("lawn-1", "a");
  const c2 = crew("lawn-2", "b");
  const t = computeMultiCrewDay(
    [entry("a", "13:00", "14:00"), entry("mgr", "13:00", "14:00")],
    [c1, c2], new Map([[c1.id, 2], [c2.id, 2]]), "headcount",
  )!;
  assert.equal(t.labourHours, 1);
  assert.equal(t.multiCrew?.bhShare, 2);
  assert.equal(t.multiCrew?.offCrewHours, 1);
});

test("headcount split: by headcount, drift on the largest share", () => {
  assert.deepEqual(headcountSplit(["x", "y", "z"], [2, 2, 1], 33), [
    {crewId: "x", bh: 13.2}, {crewId: "y", bh: 13.2}, {crewId: "z", bh: 6.6},
  ]);
  assert.deepEqual(headcountSplit(["x", "y", "z"], [0, 0, 0], 10), [
    {crewId: "x", bh: 3.34}, {crewId: "y", bh: 3.33}, {crewId: "z", bh: 3.33},
  ]);
});

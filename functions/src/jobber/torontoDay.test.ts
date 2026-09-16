// Toronto day windows across DST.
//   npm test -- torontoDay
//
// The sync's day window read the UTC offset at noon and applied it to
// midnight. On the fall-back Sunday a clock-in between midnight and 1am
// belonged to no day; on the spring-forward Sunday a clock-in between 11pm
// and midnight the night before belonged to two. Both nights are in snow
// season, and both are nights crews can be plowing.
import {test} from "vitest";
import assert from "node:assert/strict";
import {
  creditPunchesToDay,
  shiftYmd,
  torontoBoundariesIso,
  torontoWindow7DayBackIso,
  torontoYmd,
  TimeEntryDoc,
} from "./torontoDay";

const HOUR = 3_600_000;
const MIN = 60_000;
const localHm = (ms: number) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit",
  hourCycle: "h23",
}).format(new Date(ms));

// Every Toronto day from start to end inclusive.
const daysBetween = (start: string, end: string): string[] => {
  const out: string[] = [];
  for (let d = start; d <= end; d = shiftYmd(d, 1)) out.push(d);
  return out;
};

test("every day starts at local 00:00 of its own date, 2026-2028", () => {
  for (const d of daysBetween("2026-01-01", "2028-12-31")) {
    const after = Date.parse(torontoBoundariesIso(d).after);
    assert.equal(torontoYmd(new Date(after)), d, d);
    assert.equal(localHm(after), "00:00", d);
  }
});

test("consecutive days tile: no gap, no overlap, 23h/25h on changeovers",
  () => {
    const lengths = new Map<string, number>();
    for (const d of daysBetween("2026-01-01", "2028-12-31")) {
      const today = torontoBoundariesIso(d);
      const next = torontoBoundariesIso(shiftYmd(d, 1));
      assert.equal(today.before, next.after, `${d} -> next day`);
      lengths.set(d,
        (Date.parse(today.before) - Date.parse(today.after)) / HOUR);
    }
    assert.equal(lengths.get("2026-11-01"), 25);
    assert.equal(lengths.get("2027-03-14"), 23);
    assert.equal(lengths.get("2026-12-10"), 24);
    const odd = [...lengths].filter(([, h]) => h !== 24).map(([d]) => d);
    assert.deepEqual(odd, [
      "2026-03-08", "2026-11-01", "2027-03-14", "2027-11-07",
      "2028-03-12", "2028-11-05",
    ]);
  });

test("the 7-day visit window is built from the same tiled midnights", () => {
  const w = torontoWindow7DayBackIso("2027-03-14");
  assert.equal(w.after, torontoBoundariesIso("2027-03-07").after);
  assert.equal(w.before, torontoBoundariesIso("2027-03-15").before);
  assert.equal(localHm(Date.parse(w.after)), "00:00");
  assert.equal(localHm(Date.parse(w.before)), "00:00");
});

// ── THE ACTUAL PLOW NIGHTS ─────────────────────────────────────────────────
// Every clock-in minute from 23:00 to 02:00 local. Syncing the day before,
// the day of and the day after, each punch must be credited to exactly one
// day — the Toronto date it started on — and its hours counted once.
const NIGHTS = [
  {
    name: "fall back, Sat Oct 31 -> Sun Nov 1 2026",
    // 23:00 EDT Oct 31 = 03:00Z; 02:00 EST Nov 1 = 07:00Z (4 real hours:
    // the 01:00-02:00 hour happens twice).
    fromUtc: "2026-11-01T03:00:00.000Z", toUtc: "2026-11-01T07:00:00.000Z",
    days: ["2026-10-31", "2026-11-01", "2026-11-02"],
  },
  {
    name: "spring forward, Sat Mar 13 -> Sun Mar 14 2027",
    // 23:00 EST Mar 13 = 04:00Z; 02:00 EST jumps to 03:00 EDT = 07:00Z
    // (2 real hours: 02:00-03:00 does not exist).
    fromUtc: "2027-03-14T04:00:00.000Z", toUtc: "2027-03-14T07:00:00.000Z",
    days: ["2027-03-13", "2027-03-14", "2027-03-15"],
  },
];

for (const night of NIGHTS) {
  test(`punches, ${night.name}: every minute 23:00-02:00 credited once, ` +
    "to the day it started", () => {
    const start = Date.parse(night.fromUtc);
    const end = Date.parse(night.toUtc);
    let checked = 0;
    for (let t = start; t < end; t += MIN) {
      const clockIn = new Date(t).toISOString();
      // A 3-hour shift from that minute.
      const punch: TimeEntryDoc = {
        userEmail: "plow@x.test",
        clockIn,
        clockOut: new Date(t + 3 * HOUR).toISOString(),
      };
      const credited = night.days.filter((d) =>
        creditPunchesToDay([punch], d, end + 10 * HOUR, 60)
          .secondsByEmail.has("plow@x.test"));
      assert.deepEqual(credited, [torontoYmd(new Date(t))],
        `${clockIn} (${localHm(t)} local)`);
      const secs = night.days.reduce((s, d) => s +
        (creditPunchesToDay([punch], d, end + 10 * HOUR, 60)
          .secondsByEmail.get("plow@x.test") || 0), 0);
      assert.equal(secs, 3 * 3600, `${clockIn} hours counted once`);
      checked++;
    }
    assert.equal(checked, (end - start) / MIN);
  });
}

test("fall back: a 00:30 clock-in on Nov 1 is Sunday's (was credited to " +
  "no day)", () => {
  const punch = {userEmail: "p@x.test", clockIn: "2026-11-01T04:30:00.000Z",
    clockOut: "2026-11-01T09:30:00.000Z"}; // 00:30 EDT -> 04:30 EST
  const sun = creditPunchesToDay([punch], "2026-11-01", 0, 60);
  const sat = creditPunchesToDay([punch], "2026-10-31", 0, 60);
  assert.equal(sun.secondsByEmail.get("p@x.test"), 5 * 3600);
  assert.equal(sat.secondsByEmail.has("p@x.test"), false);
  assert.deepEqual(sun.intervalsByEmail.get("p@x.test"),
    [{startAt: punch.clockIn, endAt: punch.clockOut}]);
});

test("spring forward: an 11:30pm Sat Mar 13 plow shift is Saturday's only " +
  "(was Saturday's AND Sunday's)", () => {
  const punch = {userEmail: "p@x.test", clockIn: "2027-03-14T04:30:00.000Z",
    clockOut: "2027-03-14T08:30:00.000Z"}; // 23:30 EST -> 04:30 EDT, 4h
  assert.equal(creditPunchesToDay([punch], "2027-03-13", 0, 60)
    .secondsByEmail.get("p@x.test"), 4 * 3600);
  assert.equal(creditPunchesToDay([punch], "2027-03-14", 0, 60)
    .secondsByEmail.has("p@x.test"), false);
});

// ── JOBBER TIMESHEETS ──────────────────────────────────────────────────────
// The sync sums EVERY timesheet Jobber returns for [after, before), so the
// window alone decides the day. Modelled as Jobber filtering by start time:
// across the same two nights, each timesheet must come back for one day.
for (const night of NIGHTS) {
  test(`timesheets, ${night.name}: each start minute fetched for one day`,
    () => {
      const windows = night.days.map((d) => {
        const b = torontoBoundariesIso(d);
        return {d, a: Date.parse(b.after), z: Date.parse(b.before)};
      });
      for (let t = Date.parse(night.fromUtc); t < Date.parse(night.toUtc);
        t += MIN) {
        const hits = windows.filter((w) => t >= w.a && t < w.z)
          .map((w) => w.d);
        assert.deepEqual(hits, [torontoYmd(new Date(t))],
          `${new Date(t).toISOString()} (${localHm(t)} local)`);
      }
    });
}

test("ordinary winter evening: 7pm and a 10pm-6am shift stay on the night",
  () => {
    const at7 = {userEmail: "p@x.test", clockIn: "2026-12-11T00:00:00.000Z",
      clockOut: "2026-12-11T08:00:00.000Z"}; // Dec 10 19:00 EST
    const plow = {userEmail: "q@x.test", clockIn: "2026-12-11T03:00:00.000Z",
      clockOut: "2026-12-11T11:00:00.000Z"}; // Dec 10 22:00 -> 06:00 EST
    const dec10 = creditPunchesToDay([at7, plow], "2026-12-10", 0, 60);
    const dec11 = creditPunchesToDay([at7, plow], "2026-12-11", 0, 60);
    assert.equal(dec10.secondsByEmail.get("p@x.test"), 8 * 3600);
    assert.equal(dec10.secondsByEmail.get("q@x.test"), 8 * 3600);
    assert.equal(dec11.secondsByEmail.size, 0);
  });

test("open shift runs to now and keeps endAt null; noise is dropped", () => {
  const open = {userEmail: "o@x.test", clockIn: "2026-12-11T03:00:00.000Z"};
  const blip = {userEmail: "b@x.test", clockIn: "2026-12-11T03:00:00.000Z",
    clockOut: "2026-12-11T03:00:30.000Z"};
  const now = Date.parse("2026-12-11T05:00:00.000Z");
  const r = creditPunchesToDay([open, blip], "2026-12-10", now, 60);
  assert.equal(r.secondsByEmail.get("o@x.test"), 2 * 3600);
  assert.deepEqual(r.intervalsByEmail.get("o@x.test"),
    [{startAt: open.clockIn, endAt: null}]);
  assert.equal(r.secondsByEmail.has("b@x.test"), false);
});

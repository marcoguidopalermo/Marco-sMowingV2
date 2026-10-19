/* eslint-disable max-len */
// Fleet document expiry alerts.
//   npm test -- fleetExpiryCore
import {test} from "vitest";
import assert from "node:assert/strict";
import {fleetExpiryAlertsDue, fleetExpiryDates, legacyMarkerCovers} from "./fleetExpiryCore";

const DAY = 86_400_000;
const ymdToMs = (s: string) => {
  const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d);
};
const on = (today: string) => (ymd: string) => Math.round((ymdToMs(ymd) - ymdToMs(today)) / DAY);

// The six trucks with a registration date, as stored in production on
// 2026-10-19 (field written by the fleet form: `regExpiry`).
const TRUCKS = [
  {id: "f-t4", name: "#4 2013 F-250", regExpiry: "2026-11-30"},
  {id: "f-t5", name: "#5 2015 F-150 (RED)", regExpiry: "2026-11-30"},
  {id: "f-t7", name: "#7 2016 F-350 (DIESEL)", regExpiry: "2027-04-30"},
  {id: "f-t9", name: "#9 2022 F-250", regExpiry: "2026-11-30"},
  {id: "f-t10", name: "#10 2024 F-550", regExpiry: "2026-11-30"},
  {id: "f-t13", name: "#13 2017 F-150", regExpiry: "2026-11-30"},
];
const dueOn = (today: string) => TRUCKS.flatMap((u) => fleetExpiryAlertsDue(u, on(today)).map((a) => ({unit: u.name, ...a})));

console.log("\nTHE BUG: registration dates are stored as regExpiry");
test("regExpiry is read (the old scan only read registrationExpiry)", () => {
  assert.deepEqual(fleetExpiryDates({regExpiry: "2026-11-30"}), [{field: "regExpiry", label: "Registration", ymd: "2026-11-30"}]);
  assert.equal(fleetExpiryDates({commercialSafetyExpire: "2027-01-15"})[0].label, "Commercial safety");
  assert.equal(fleetExpiryDates({registrationExpiry: "2026-11-30"})[0].label, "Registration"); // legacy name still read
});
test("the same date under both registration fields alerts once", () => {
  assert.equal(fleetExpiryDates({regExpiry: "2026-11-30", registrationExpiry: "2026-11-30"}).length, 1);
});

console.log("\nThe five trucks expiring 2026-11-30");
test("Oct 30 (31 days out): nothing yet", () => {
  assert.deepEqual(dueOn("2026-10-30"), []);
});
test("Oct 31 (30 days out): a 30-day alert for each of the five, none for #7", () => {
  const due = dueOn("2026-10-31");
  assert.equal(due.length, 5);
  assert.ok(due.every((a) => a.kind === "30d" && a.days === 30 && a.label === "Registration"));
  assert.ok(!due.some((a) => a.unit.startsWith("#7")));
});
test("Nov 30: the at-expiry alert for each of the five", () => {
  const due = dueOn("2026-11-30");
  assert.equal(due.length, 5);
  assert.ok(due.every((a) => a.kind === "exp"));
});
test("today (Oct 19, 42 days out): nothing", () => {
  assert.deepEqual(dueOn("2026-10-19"), []);
});

console.log("\nMarkers");
test("the marker includes the date, so next year's renewal alerts again", () => {
  const a = fleetExpiryAlertsDue(TRUCKS[0], on("2026-10-31"))[0];
  assert.equal(a.marker, "fleetdoc-f-t4-regExpiry-2026-11-30-30d");
  assert.equal(a.legacyMarker, "fleetdoc-f-t4-regExpiry-30d");
  const next = fleetExpiryAlertsDue({...TRUCKS[0], regExpiry: "2027-11-30"}, on("2027-10-31"))[0];
  assert.notEqual(next.marker, a.marker);
});
test("an old date-less marker counts only for the same window", () => {
  const a = fleetExpiryAlertsDue({id: "u", safetyExpiry: "2026-11-10"}, on("2026-10-20"))[0];
  assert.equal(legacyMarkerCovers(a, ymdToMs("2026-10-15"), ymdToMs), true); // sent in this window
  assert.equal(legacyMarkerCovers(a, ymdToMs("2025-10-15"), ymdToMs), false); // last year's renewal
  assert.equal(legacyMarkerCovers(a, null, ymdToMs), false);
});

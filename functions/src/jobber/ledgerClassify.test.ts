// Which visits are recurring cuts.
//   npm test -- ledgerClassify
import {test} from "vitest";
import assert from "node:assert/strict";
import {isRecurringVisitTitle} from "./ledgerClassify";

console.log("\nRecurring maintenance reads as single-day work");
test("the ordinary recurring titles", () => {
  for (const t of [
    "Kyla Francis - Weekly [1.5]",
    "Joan Cole - Biweekly",
    "DaVinci Centre - Bi-Weekly [2.5]",
    "Some Client - Monthly [3]",
    "Client - Semi-Monthly",
    "*SKIP JUNE 03 RD CUT* DaVinci Centre - Biweekly",
  ]) assert.equal(isRecurringVisitTitle(t), true, t);
});

console.log("\nProject work does not");
test("multi-day project titles are NOT recurring", () => {
  for (const t of [
    "Craig Baumann - Sod Installation + Moving rocks [44]",
    "Tson Douangmala - Lawn Grading + Sod  [51]",
    "JJJ Contracting - Parking lot sweeping [8.3]",
    "Missy James - Sod (front yard only) + stump grinding",
    "Flower Bed Removal & Installation",
  ]) assert.equal(isRecurringVisitTitle(t), false, t);
});
test("a lawn-crew job is judged on the JOB, not the crew", () => {
  // A lawn crew doing a sod install is still multi-day work.
  assert.equal(isRecurringVisitTitle("Lawn Grading + Sod"), false);
});
test("nothing, or junk, is not recurring", () => {
  for (const t of [null, undefined, "", "   ", 42 as unknown as string]) {
    assert.equal(isRecurringVisitTitle(t), false);
  }
});
test("the word must stand alone, not match inside another word", () => {
  assert.equal(isRecurringVisitTitle("Triweeklyish planting"), false);
});

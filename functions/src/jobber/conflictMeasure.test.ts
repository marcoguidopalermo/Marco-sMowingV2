// The corrected withheld-BH measure.
//   npm test -- conflictMeasure
//
// Written after 2026-08-25, when the conflict log reported 51.1 BH
// "withheld" on a rain day. 36.9 of it was quoted BH for 47 visits
// nobody had completed — still open in Jobber the next day. The
// genuinely outstanding figure was 12.1 BH: one multi-day job that
// finished an hour after its crew-day was locked. The bad number
// nearly drove two decisions: unapproving days that needed nothing,
// and sizing a bonus adjustment against hours that never existed.
import {test} from "vitest";
import assert from "node:assert/strict";
import {conflictReportableBH, ledgerOutstandingBH} from "./conflictMeasure";

const c = (
  isComplete: boolean, storedBH: number, jobberShareBH: number,
) => conflictReportableBH({isComplete, storedBH, jobberShareBH});

console.log("\nQuoted BH on work nobody did is not withheld BH");
test("THE BUG: an incomplete visit is never reportable", () => {
  // The rain-day shape: row at 0, title says [.8], visit never done.
  assert.equal(c(false, 0, 0.8), 0);
  // Not even a large one. 47 of these summed to 36.9 phantom BH.
  assert.equal(c(false, 0, 29.2), 0);
});
test("a whole rain day of uncompleted visits reports nothing", () => {
  const day = Array.from({length: 47}, (_, i) => [0.5 + (i % 5) / 10]);
  const total = day.reduce((s, [q]) => s + c(false, 0, q), 0);
  assert.equal(total, 0);
});

console.log("\nCompleted work with hours outstanding IS reportable");
test("the real case: BH landing after the day was locked", () => {
  // Ken Kopechanski garden bed re-grade: completed 16:39, locked 15:39.
  assert.equal(c(true, 2.1, 14.2), 12.1);
});
test("a completed visit already fully credited reports nothing", () => {
  assert.equal(c(true, 7.1, 7.1), 0);
});
test("a DOWNWARD revision on completed work is still reported", () => {
  // Jobber scope shrank after approval. The admin must still see it:
  // the stored day is now OVER-credited, the pay-affecting direction.
  assert.equal(c(true, 14.2, 7.1), -7.1);
});
test("sub-rounding noise is not a conflict", () => {
  assert.equal(c(true, 7.1, 7.1000000001), 0);
});
test("garbage numbers degrade to no report, not a false one", () => {
  assert.equal(c(true, 0, 0), 0);
  assert.equal(c(true, NaN, NaN), 0);
});

console.log("\nMulti-day ledger: outstanding = total - credited");
test("nothing credited yet — the whole scope is outstanding", () => {
  assert.equal(ledgerOutstandingBH(14.2, []), 14.2);
});
test("partially credited", () => {
  assert.equal(ledgerOutstandingBH(14.2, [{creditedBH: 7.1}]), 7.1);
});
test("fully credited reports zero — this killed 49 phantom warnings", () => {
  // On 2026-08-24 every one of the 49 "blocked credits" was this case.
  const hist = [{creditedBH: 7.1}, {creditedBH: 7.1}];
  assert.equal(ledgerOutstandingBH(14.2, hist), 0);
});
test("over-credited clamps at zero, never negative", () => {
  assert.equal(ledgerOutstandingBH(10, [{creditedBH: 12}]), 0);
});
test("missing history and junk entries are tolerated", () => {
  assert.equal(ledgerOutstandingBH(5, null), 5);
  assert.equal(ledgerOutstandingBH(5, [{}, {creditedBH: undefined}]), 5);
});

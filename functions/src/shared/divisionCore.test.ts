/* eslint-disable max-len, no-multi-spaces */
import {test} from "vitest";
import assert from "node:assert/strict";
import {attributeInvoice, jobDivisionIndex, bhByMonth, assigneeDivisionIndex} from "./divisionCore";

const perf = {
  "2026-07-02": {c1: {division: "Lawn Division", jobs: [{jobberJobId: "J1", bh: 4}, {jobberJobId: "J2", bh: 2}]}},
  "2026-07-03": {c2: {division: "Small Projects", jobs: [{jobberJobId: "J2", bh: 6}]}},          // J2: multi-crew, split 2 / 6
  "2026-08-01": {c3: {division: "Large Projects", jobs: [{jobberJobId: "J3", bh: 0}]}},
};
const sch = {
  "2026-06-01": [{division: "Lawn Division", jobberAssigneeIds: ["A"]}, {division: "Small Projects", jobberAssigneeIds: ["B"]}],
  "2026-06-02": [{division: "Lawn Division", jobberAssigneeIds: ["A", "B"]}],
  "2026-06-03": [{division: "Small Projects", jobberAssigneeIds: ["B"]}],
};
const jobIdx = jobDivisionIndex(perf);
const aIdx = assigneeDivisionIndex(sch);
test("method 1: crew-days, weighted by credited BH (multi-crew split reused)", () => {
  assert.deepEqual(attributeInvoice(["J1"], [], jobIdx, aIdx), {m: 1, w: {"Lawn Division": 1}});
  const a = attributeInvoice(["J2"], [["A"]], jobIdx, aIdx);
  assert.equal(a.m, 1);
  assert.equal(Math.round(a.w["Small Projects"] * 100), 75);
  assert.equal(attributeInvoice(["J3"], [], jobIdx, aIdx).w["Large Projects"], 1);   // zero-BH row still counts
});
test("method 2 when no crew-day matches: assignees via the capacity mapping (mode, explicit map wins)", () => {
  assert.deepEqual(attributeInvoice(["JX"], [["A"]], jobIdx, aIdx), {m: 2, w: {"Lawn Division": 1}});
  assert.deepEqual(attributeInvoice([], [["B"]], jobIdx, aIdx), {m: 2, w: {"Small Projects": 1}});
  assert.equal(assigneeDivisionIndex(sch, {B: {division: "Large Projects"}}).get("B"), "Large Projects");
  assert.deepEqual(attributeInvoice([], [["A", "B"]], jobIdx, aIdx).w, {"Lawn Division": 0.5, "Small Projects": 0.5});
});
test("method 3: nothing matches → unattributed, kept", () => {
  assert.deepEqual(attributeInvoice([], [["Z"]], jobIdx, aIdx), {m: 3, w: {}});
});
test("BH by month and division", () => {
  assert.deepEqual(bhByMonth(perf), {"2026-07": {"Lawn Division": 6, "Small Projects": 6}, "2026-08": {"Large Projects": 0}});
});

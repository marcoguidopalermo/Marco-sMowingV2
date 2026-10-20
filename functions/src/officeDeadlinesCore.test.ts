/* eslint-disable max-len */
import {test} from "vitest";
import assert from "node:assert/strict";
import {deadlineAlertsDue} from "./officeDeadlinesCore";

const item = (dueDate: string | null, extra: object = {}) => ({id: "od-1", title: "CVOR renewal", dueDate, status: "open", ...extra});
test("31 days out: nothing; 30: the 30-day alert; 8: still 30-day window", () => {
  assert.deepEqual(deadlineAlertsDue(item("2026-11-30"), "2026-10-30"), []);
  assert.equal(deadlineAlertsDue(item("2026-11-30"), "2026-10-31")[0].kind, "30d");
  assert.equal(deadlineAlertsDue(item("2026-11-30"), "2026-11-22")[0].kind, "30d");
});
test("7 days out and later: the 7-day alert; marker carries the date", () => {
  const a = deadlineAlertsDue(item("2026-11-30"), "2026-11-23")[0];
  assert.equal(a.kind, "7d");
  assert.equal(a.marker, "office-od-1-2026-11-30-7d");
  assert.equal(a.title, "CVOR renewal — due in 7 days");
  assert.equal(deadlineAlertsDue(item("2026-11-30"), "2026-11-30")[0].title, "CVOR renewal — due today");
});
test("created 5 days before: only the 7-day alert (no backlog)", () => {
  const a = deadlineAlertsDue(item("2026-11-30"), "2026-11-25");
  assert.equal(a.length, 1);
  assert.equal(a[0].kind, "7d");
});
test("no date, done, deleted, or past due: nothing", () => {
  assert.deepEqual(deadlineAlertsDue(item(null), "2026-11-25"), []);
  assert.deepEqual(deadlineAlertsDue(item("2026-11-30", {status: "done"}), "2026-11-25"), []);
  assert.deepEqual(deadlineAlertsDue(item("2026-11-30", {deletedAt: 1}), "2026-11-25"), []);
  assert.deepEqual(deadlineAlertsDue(item("2026-11-30"), "2026-12-01"), []);
});
test("the push never carries notes or amounts", () => {
  const a = deadlineAlertsDue(item("2026-11-30", {notes: "Premium $14,000", reference: "POL-1"}), "2026-11-25")[0];
  assert.ok(!/\$|14,000|POL-1|Premium/.test(a.title + a.body));
});

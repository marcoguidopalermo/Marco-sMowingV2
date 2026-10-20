/* eslint-disable max-len */
import {test} from "vitest";
import assert from "node:assert/strict";
import {categorizeLines, categoryForName, totalsByCategory, CATALOG_DEFAULTS, CATEGORIES} from "./serviceCategories";

const line = (name: string, amount: number, linked: string | null = null) => ({name, amount, linked});
test("decisions: packages → Lawn care; seasonal / essential / premium maintenance → Lawn mowing", () => {
  for (const n of ["Gold Lawn Care Package", "silver lawn care package", "Bronze Lawn Care Package"]) assert.equal(categoryForName(n, null).split[0].category, "Lawn care", n);
  for (const n of ["Seasonal Lawn Maintenance", "seasonal maintenance", "Essential Biweekly Lawn Maintenance", "Premium Weekly Lawn Maintenance"]) assert.equal(categoryForName(n, null).split[0].category, "Lawn mowing", n);
});
test("sweeping is its own line, not Snow; snow terms are Snow", () => {
  assert.equal(categoryForName("Parking lot sweeping + line painting", null).split[0].category, "Sweeping");
  assert.equal(categoryForName("Terra Vista - Sanding Roadways", null).split[0].category, "Snow");
  assert.equal(categoryForName("Plow + Shovel", null).split[0].category, "Snow");
});
test("landscaping project splits 50/50 Hardscape & gravel / Garden beds", () => {
  const out = categorizeLines([line("Landscaping Project", 30000)]);
  assert.deepEqual(out[0].split, [{category: "Hardscape & gravel", amount: 15000}, {category: "Garden beds & landscaping", amount: 15000}]);
  assert.equal(out[0].flag, "landscaping-project");
});
test("trimming stays in Other and is flagged (freehand or catalog)", () => {
  assert.equal(categorizeLines([line("Extra trimming in backyard", 300)])[0].flag, "trimming");
  const c = categorizeLines([line("hedges", 400, "Trimming")])[0];
  assert.deepEqual([c.split[0].category, c.flag], ["Other", "trimming"]);
});
test("catalog item wins over the line's typed text", () => {
  assert.equal(categorizeLines([line("Mowing (Weekly)", 50, "Mowing (Biweekly)")])[0].split[0].category, "Lawn mowing");
  assert.equal(categorizeLines([line("random words", 50, "Sod Installation")])[0].split[0].category, "Sod");
});
test("asset sales are excluded (no category)", () => {
  const out = categorizeLines([line("L6060 Kubota Tractor plus Blower, Loader Arm & Bucket", 20000), line("Sale of 2007 F-150", 1000)]);
  assert.deepEqual(out.map((x) => x.kind), ["asset", "asset"]);
  assert.deepEqual(totalsByCategory(out), {});
});
test("discounts: own words → that service; one service → it; several → the largest; none → Other (untied)", () => {
  const own = categorizeLines([line("Mowing (Weekly)", 1000, "Mowing (Weekly)"), line("[$50 OFF] - Spring Lawn Care Program Discount", -50, "[$50 OFF] - Spring Lawn Care Program Discount"), line("Gold Lawn Care Package", 300)]);
  assert.deepEqual([own[1].split[0].category, own[1].tie], ["Lawn care", "own words"]);
  const single = categorizeLines([line("Spring Cleanup", 400, "Spring Cleanup"), line("Pre-payment discount", -40)]);
  assert.deepEqual([single[1].split[0].category, single[1].tie], ["Cleanups", "invoice"]);
  const many = categorizeLines([line("Sod Installation", 3000, "Sod Installation"), line("Hedge trimming", 500, "Hedge trimming"), line("15% off", -300)]);
  assert.deepEqual([many[2].split[0].category, many[2].tie], ["Sod", "largest service"]);
  assert.deepEqual(totalsByCategory(many), {"Sod": 2700, "Hedges & shrubs": 500});
  const none = categorizeLines([line("Discount", -25)]);
  assert.deepEqual([none[0].split[0].category, none[0].tie], ["Other", "untied"]);
});
test("unmapped names go to Other and are flagged; overrides win", () => {
  const u = categorizeLines([line("lawn ripped", 2200)])[0];
  assert.deepEqual([u.split[0].category, u.flag], ["Other", "unmapped"]);
  assert.equal(categorizeLines([line("lawn ripped", 2200)], {names: {"lawn ripped": "Sod"}})[0].split[0].category, "Sod");
  assert.equal(categorizeLines([line("x", 10, "Trimming")], {catalog: {"Trimming": "Hedges & shrubs"}})[0].split[0].category, "Hedges & shrubs");
});
test("every catalog default is a real category; the 70 non-discount catalog items are covered", () => {
  for (const c of Object.values(CATALOG_DEFAULTS)) assert.ok((CATEGORIES as readonly string[]).includes(c), c);
  assert.ok(new Set(Object.keys(CATALOG_DEFAULTS).map((k) => k.trim())).size >= 70);
});

// THE INVARIANT: archiving a day must never change a monthly total.
//   npm test -- performanceOverlay
//
// Written after 2026-08-26, when the rolling archive reached the first half of
// an OPEN month and every live monthly total silently halved. buildMtd was
// never wrong — it faithfully totalled the days it was handed. What was wrong
// was WHICH DAYS it was handed. So these tests exercise the assembly, not the
// arithmetic: split a month the way the archiver splits it, reassemble it the
// way the app does, and assert the totals are untouched.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mergePerformance, monthsNeedingSheet, type PerfMap } from './performanceOverlay';
import { buildMtd } from './mtd';
import { monthSettlementStatus } from './performanceMonths';

const TODAY = '2026-08-26';
const EMPS = [
  { id: 'e1', name: 'Joel', systemRole: 'worker' },
  { id: 'e2', name: 'Garon', systemRole: 'worker' },
] as any[];

const crewDay = (bh: number) => ({
  division: 'Lawn Division', crewNumber: 1, isAdHoc: false,
  jobs: [{ bh }], employeeAH: { e1: 8, e2: 8 },
  deductions: {}, approvalStatus: 'approved',
}) as any;

// A whole month of identical approved crew-days, 08-01 .. 08-25.
const WHOLE: PerfMap = {};
for (let d = 1; d <= 25; d++) WHOLE[`2026-08-${String(d).padStart(2, '0')}`] = { c1: crewDay(12) };

// The archiver's split: days older than the window move to the sheet.
const splitAt = (lastArchived: string) => {
  const sheet: PerfMap = {}; const doc: PerfMap = {};
  for (const [date, day] of Object.entries(WHOLE)) (date <= lastArchived ? sheet : doc)[date] = day;
  return { sheet, doc };
};

const totals = (perf: PerfMap) => {
  const m = buildMtd(TODAY, perf, {}, EMPS, null);
  const by: Record<string, number> = {};
  for (const p of m.perEmployee) by[p.empId] = Number(p.bh.toFixed(4));
  return { companyBH: Number(m.companyBH.toFixed(4)), perEmployee: by };
};

console.log('\nArchiving must be invisible to every monthly total');
test('company and per-employee BH are identical before and after an archive', () => {
  const expected = totals(WHOLE);
  // Every plausible archive boundary, including none and nearly-all.
  for (let d = 1; d <= 25; d++) {
    const { sheet, doc } = splitAt(`2026-08-${String(d).padStart(2, '0')}`);
    const assembled = mergePerformance(doc, sheet);
    assert.deepEqual(totals(assembled), expected,
      `totals changed when 08-01..08-${d} were archived`);
  }
});

test('THE BUG: reading the doc alone after an archive loses the archived days', () => {
  // This is what the app actually did. Kept as a test so the failure mode
  // stays legible: it is not a rounding drift, it is half the month.
  const { doc } = splitAt('2026-08-12');
  const full = totals(WHOLE);
  const docOnly = totals(doc);
  assert.ok(docOnly.companyBH < full.companyBH * 0.6,
    'expected the doc-only read to lose roughly half the month');
  assert.equal(full.companyBH, 300);
  assert.equal(docOnly.companyBH, 156);
});

console.log('\nThe load decision — which sheets must be overlaid');
test('the OPEN month is required as soon as any of its days is archived', () => {
  // The case that was missed for the entire life of the rolling archive.
  const need = monthsNeedingSheet({
    today: TODAY,
    archivedDays: { '2026-08-12': 1, '2026-08-11': 1 },
    pushedMonths: [],
  });
  assert.deepEqual(need, ['2026-08']);
});
test('an open month with nothing archived needs no sheet', () => {
  assert.deepEqual(monthsNeedingSheet({ today: '2026-08-03', archivedDays: {} }), []);
});
test('a pushed month is required when viewed', () => {
  const need = monthsNeedingSheet({
    today: TODAY, viewedDate: '2026-07-14', pushedMonths: ['2026-07'], archivedDays: {},
  });
  assert.deepEqual(need, ['2026-07']);
});
test('a PAST month that was archived but never pushed is required when viewed', () => {
  // The rolling archive drains days regardless of push, so "pushed" alone was
  // never the right condition for needing a sheet.
  const need = monthsNeedingSheet({
    today: TODAY, viewedDate: '2026-06-14', pushedMonths: [], archivedDays: { '2026-06-14': 1 },
  });
  assert.deepEqual(need, ['2026-06']);
});
test('the open month and a viewed past month are both required', () => {
  const need = monthsNeedingSheet({
    today: TODAY, viewedDate: '2026-07-14', pushedMonths: ['2026-07'],
    archivedDays: { '2026-08-12': 1 },
  });
  assert.deepEqual(need, ['2026-07', '2026-08']);
});

console.log('\nMerge semantics');
test('the doc wins on collision — an unlocked, edited day is the newer copy', () => {
  const merged = mergePerformance({ d: { c1: crewDay(99) } } as any, { d: { c1: crewDay(1) } } as any);
  assert.equal((merged as any).d.c1.jobs[0].bh, 99);
});
test('the merge is a union, not a replacement', () => {
  const merged = mergePerformance({ b: { c1: crewDay(2) } } as any, { a: { c1: crewDay(1) } } as any);
  assert.deepEqual(Object.keys(merged).sort(), ['a', 'b']);
});

console.log('\nThe push guard must see the whole month too');
test('an unsettled crew-day on the SHEET still blocks the push', () => {
  // pushMonth is terminal. Its settlement guard used to read the doc alone, so
  // for a month the rolling archive had already drained it certified "settled"
  // having looked only at the residual tail. Here the one pending crew-day is
  // on the archived side — exactly the day the doc-only read cannot see.
  const sheet: PerfMap = {
    '2026-08-04': { c1: crewDay(12) },
    '2026-08-05': { c1: { ...crewDay(12), approvalStatus: 'pending' } as any },
  };
  const doc: PerfMap = { '2026-08-20': { c1: crewDay(12) } };

  assert.equal(monthSettlementStatus(doc, '2026-08').settled, true,
    'the doc-only view sees nothing wrong — this is the hole');
  const full = monthSettlementStatus(mergePerformance(doc, sheet), '2026-08');
  assert.equal(full.settled, false);
  assert.equal(full.blocking.length, 1);
  assert.equal(full.blocking[0].date, '2026-08-05');
});
test('settlement counts every crew-day in the month, archived or not', () => {
  const { sheet, doc } = splitAt('2026-08-12');
  const full = monthSettlementStatus(mergePerformance(doc, sheet), '2026-08');
  assert.equal(full.dayCount, monthSettlementStatus(WHOLE, '2026-08').dayCount);
  assert.ok(monthSettlementStatus(doc, '2026-08').dayCount < full.dayCount);
});

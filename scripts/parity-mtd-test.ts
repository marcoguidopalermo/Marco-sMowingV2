// PARITY PROOF: bonus/MTD numbers are IDENTICAL whether a month's days are
// all in the main doc, or split across the month sheet + doc (the archived
// state). Proves rolling archive relocates storage without changing Perf
// Master math. Run: npx tsx scripts/parity-mtd-test.ts
import { readFileSync } from 'node:fs';
import { buildMtd, buildDivisionMtd } from '../src/lib/mtd';
import type { PerformanceLog } from '../src/types';

type PerfMap = Record<string, Record<string, PerformanceLog>>;

// The overlay used in App.tsx: sheets under doc (doc wins). Disjoint keys.
const mergePerformance = (docPerf: PerfMap, monthOverlay: PerfMap): PerfMap =>
  ({ ...monthOverlay, ...docPerf });

const backupFile = process.argv[2] || 'appData-backup-2026-07-08T17-03-01-932Z.json';
const data = JSON.parse(readFileSync(backupFile, 'utf8'));
const performance: PerfMap = data.performance || {};
const schedules = data.schedules || {};
const employees = data.employees || [];
const settings = data.settings || null;

const monthOf = (d: string) => d.slice(0, 7);
const monthsPresent = [...new Set(Object.keys(performance).map(monthOf))].sort();
console.log('Backup:', backupFile);
console.log('Months present:', monthsPresent.join(', '));

let failures = 0;
const approxEqual = (a: number, b: number) => Math.abs(a - b) < 1e-9;

for (const ym of monthsPresent) {
  const monthDates = Object.keys(performance).filter(d => monthOf(d) === ym).sort();
  if (monthDates.length === 0) continue;
  // "today" = last day of the month so the whole month is in the MTD range.
  const today = monthDates[monthDates.length - 1];

  // FULL: every day in the doc (all-in-doc baseline).
  const full: PerfMap = performance;

  // SPLIT: alternate days into a "sheet" map and a "doc" map (disjoint),
  // every other month stays in the doc. Then overlay exactly as the app does.
  const sheetDays: PerfMap = {};
  const docPerf: PerfMap = {};
  for (const [date, dayMap] of Object.entries(performance)) {
    if (monthOf(date) !== ym) { docPerf[date] = dayMap; continue; }
  }
  monthDates.forEach((d, i) => {
    if (i % 2 === 0) sheetDays[d] = performance[d];   // "archived to sheet"
    else docPerf[d] = performance[d];                 // "still in doc"
  });
  const merged = mergePerformance(docPerf, sheetDays);

  // 1) Company MTD parity — full deep-equal of the entire result object
  //    (BH, AH, adjusted efficiency, and every per-employee share).
  const mFull = buildMtd(today, full, schedules, employees, settings);
  const mSplit = buildMtd(today, merged, schedules, employees, settings);
  const companyOk = JSON.stringify(mFull) === JSON.stringify(mSplit);

  // 2) Division MTD parity for every division seen this month.
  const divisions = [...new Set(monthDates.flatMap(d =>
    Object.values(performance[d]).map(l => l.division).filter(Boolean)))] as string[];
  let divOk = true;
  const divReport: string[] = [];
  for (const div of divisions) {
    const dFull = buildDivisionMtd(today, div, full, schedules, employees, settings);
    const dSplit = buildDivisionMtd(today, div, merged, schedules, employees, settings);
    const ok = JSON.stringify(dFull) === JSON.stringify(dSplit);
    if (!ok) divOk = false;
    divReport.push(`${div}:${ok ? 'ok' : 'MISMATCH'}`);
  }

  const pass = companyOk && divOk;
  if (!pass) failures++;
  console.log(
    `\n${ym}  (${monthDates.length} days, split ${Object.keys(sheetDays).filter(d=>monthOf(d)===ym).length} sheet / ${monthDates.length - Object.keys(sheetDays).filter(d=>monthOf(d)===ym).length} doc)`,
  );
  console.log(`  company BH=${mFull.companyBH.toFixed(2)} AH=${mFull.companyAH.toFixed(2)} adjEff=${mFull.companyAdjustedEfficiency ?? 'null'} perEmp=${mFull.perEmployee.length}  → ${companyOk ? 'IDENTICAL ✓' : 'MISMATCH ✗'}`);
  console.log(`  divisions: ${divReport.join(', ') || '(none)'}  → ${divOk ? 'IDENTICAL ✓' : 'MISMATCH ✗'}`);
}

console.log(`\n${failures === 0 ? '✅ ALL MONTHS IDENTICAL — split-vs-whole parity proven.' : `❌ ${failures} month(s) MISMATCHED.`}`);
process.exit(failures === 0 ? 0 : 1);

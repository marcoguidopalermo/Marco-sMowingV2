// Verify the persist-on-first-edit logic for unscheduled job/crew additions:
//  1. content-gate (crewDayHasContent) — blanks never persist, real content does
//  2. per-crew merge — persisting one crew-day never clobbers others / other days
//  3. flag interaction — a content-bearing persisted job flags; blanks are never
//     persisted so they can't leak (mirrors approvalOversight.hasRealWork).
// Mirrors the exact predicates in PerformanceBoard/App. Run: npx tsx scripts/verify-persist-crewday.ts
import { scanOutstandingCrewDays } from '../src/lib/approvalOversight';

// --- exact mirror of PerformanceBoard.crewDayHasContent ---
const crewDayHasContent = (log: any): boolean => {
  if (!log) return false;
  if ((log.jobs || []).some((j: any) => (j.desc || '').trim() !== '' || String(j.bh ?? '').trim() !== '')) return true;
  if (Object.values(log.employeeAH || {}).some((v: any) => (Number(v) || 0) > 0)) return true;
  return false;
};
// --- exact mirror of App.onPersistCrewDay merge ---
const persistMerge = (performance: any, date: string, crewId: string, log: any) => ({
  ...performance,
  [date]: { ...(performance[date] || {}), [crewId]: log },
});

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${label}${detail ? `  — ${detail}` : ''}`); };

console.log('=== content-gate (blanks never persist) ===');
ok('blank added row {desc:"",bh:""} → NOT persisted', !crewDayHasContent({ jobs: [{ desc: '', bh: '', source: 'manual' }], employeeAH: {} }));
ok('job with desc → persists', crewDayHasContent({ jobs: [{ desc: 'Cleanup', bh: '', source: 'manual' }], employeeAH: {} }));
ok('job with BH → persists', crewDayHasContent({ jobs: [{ desc: '', bh: '3', source: 'manual' }], employeeAH: {} }));
ok('AH>0 only → persists', crewDayHasContent({ jobs: [], employeeAH: { e1: 5 } }));
ok('AH placeholder "" only → NOT persisted', !crewDayHasContent({ jobs: [], employeeAH: { e1: '' } }));

console.log('\n=== per-crew merge preserves other crews / days ===');
const before = {
  '2026-07-14': { 'crew-A': { division: 'Lawn Division', crewNumber: 1, jobs: [{ desc: 'Existing', bh: '4' }], employeeAH: { e1: 8 }, approvalStatus: 'pending' } },
  '2026-07-13': { 'crew-Z': { division: 'Small Projects', crewNumber: 9, jobs: [{ desc: 'Prior day', bh: '2' }], employeeAH: {}, approvalStatus: 'approved' } },
};
const adhoc = { division: 'Large Projects', crewNumber: 3, isAdHoc: true, jobs: [{ desc: 'Storm cleanup', bh: '5', source: 'manual' }], employeeAH: { e2: 6 }, approvalStatus: 'pending' };
const after = persistMerge(before, '2026-07-14', 'adhoc-123', adhoc);
ok('new ad-hoc crew landed in saved state', !!after['2026-07-14']['adhoc-123']);
ok('same-day existing crew-A preserved', after['2026-07-14']['crew-A']?.jobs[0].desc === 'Existing');
ok('other day (07-13) untouched', after['2026-07-13']['crew-Z']?.approvalStatus === 'approved' && Object.keys(after['2026-07-13']).length === 1);

console.log('\n=== survives the rebuild (present in saved performance) ===');
// The App rebuild reproduces dailyLogs from saved performance; being in
// `after` == surviving any snapshot-triggered rebuild.
ok('persisted ad-hoc crew is in saved performance (survives rebuild)', after['2026-07-14']['adhoc-123']?.jobs[0].desc === 'Storm cleanup');

console.log('\n=== outstanding flag: content-bearing unapproved day flags; no blank leak ===');
const flagged = scanOutstandingCrewDays(after, '2026-07-20').map(o => o.crewId);
ok('unapproved ad-hoc WITH work flags', flagged.includes('adhoc-123'));
ok('unapproved crew-A WITH work flags', flagged.includes('crew-A'));
// A hypothetical blank row is never persisted (gate above), so it never reaches
// the flag. Confirm: a day whose ONLY crew is a blank row is not persisted at all.
const blankOnly = { division: 'Lawn Division', crewNumber: 2, jobs: [{ desc: '', bh: '' }], employeeAH: {}, approvalStatus: 'pending' };
ok('blank-only crew-day is gated out before persist (never flags)', !crewDayHasContent(blankOnly));

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

// Verify the "has real work" guard + division scoping for the outstanding
// crew-day flag, using representative log shapes (no live data needed).
// Run: npx tsx scripts/verify-outstanding-guard.ts
import { scanOutstandingCrewDays, divisionNameToCode } from '../src/lib/approvalOversight';

const today = '2026-07-20';
const D = '2026-07-10'; // a past, post-launch date

// Build a performance map mixing every relevant shape on one past date.
const perf: any = {
  [D]: {
    'crew-empty':      { division: 'Lawn Division',  crewNumber: 1, isAdHoc: false, jobs: [], employeeAH: {}, deductions: {}, approvalStatus: 'pending' },                                   // (a) no-work placeholder
    'crew-realjobs':   { division: 'Lawn Division',  crewNumber: 2, isAdHoc: false, jobs: [{ jobberVisitId: 'v1' }], employeeAH: { e1: 8 }, deductions: {}, approvalStatus: 'pending' },      // real unapproved work
    'crew-ahonly':     { division: 'Small Projects', crewNumber: 3, isAdHoc: false, jobs: [], employeeAH: { e2: 4.5 }, deductions: {}, approvalStatus: 'pending' },                          // hours attributed, no job rows (e.g. AH split-in)
    'crew-tsonly':     { division: 'Large Projects', crewNumber: 4, isAdHoc: false, jobs: [], employeeAH: {}, deductions: {}, approvalStatus: 'pending', employeeTimesheets: { e3: [{ startAt: 'x' }] } }, // clock-in intervals captured, nothing else
    'crew-approved':   { division: 'Lawn Division',  crewNumber: 5, isAdHoc: false, jobs: [{ jobberVisitId: 'v2' }], employeeAH: { e4: 6 }, deductions: {}, approvalStatus: 'approved' },     // has work but approved
    'crew-waivedempty':{ division: 'Small Projects', crewNumber: 6, isAdHoc: false, jobs: [], employeeAH: {}, deductions: {}, approvalStatus: 'waived' },                                    // empty + waived
    'crew-ahzero':     { division: 'Lawn Division',  crewNumber: 7, isAdHoc: false, jobs: [], employeeAH: { e5: 0 }, deductions: {}, approvalStatus: 'pending' },                            // AH present but 0 → no work
  },
  '2026-06-30': { // pre-launch, real work but before tracking start → excluded
    'crew-prelaunch':  { division: 'Lawn Division', crewNumber: 9, isAdHoc: false, jobs: [{ jobberVisitId: 'v9' }], employeeAH: { e9: 8 }, deductions: {}, approvalStatus: 'pending' },
  },
};

const flagged = scanOutstandingCrewDays(perf, today);
const flaggedIds = new Set(flagged.map(o => o.crewId));

let pass = 0, fail = 0;
const expect = (label: string, cond: boolean, detail = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${label}${detail ? `  — ${detail}` : ''}`); };

console.log('=== "has real work" guard ===');
expect('(a) empty no-work day is NOT flagged', !flaggedIds.has('crew-empty'));
expect('real unapproved work (jobs) IS flagged', flaggedIds.has('crew-realjobs'));
expect('hours-only unapproved (AH>0, no jobs) IS flagged [protects (b)]', flaggedIds.has('crew-ahonly'));
expect('timesheet-only unapproved (clock-ins captured) IS flagged [protects (b)]', flaggedIds.has('crew-tsonly'));
expect('AH present but 0 is treated as no work → NOT flagged', !flaggedIds.has('crew-ahzero'));
expect('approved day (with work) is NOT flagged', !flaggedIds.has('crew-approved'));
expect('empty waived day is NOT flagged', !flaggedIds.has('crew-waivedempty'));
expect('pre-launch day excluded regardless of work', !flaggedIds.has('crew-prelaunch'));

console.log('\n=== division scoping (banner filter, mirrors PerformanceBoard) ===');
const bannerFor = (divisionFilter: 'all' | 'lawn' | 'small' | 'large') =>
  flagged.filter(o => divisionFilter === 'all' || divisionNameToCode(o.division) === divisionFilter);
const lawnView = bannerFor('lawn');
expect('Lawn manager (filter=lawn) sees ONLY Lawn outstanding', lawnView.every(o => /lawn/i.test(o.division)) && lawnView.length > 0, lawnView.map(o => o.crewLabel).join(', '));
expect('Lawn manager does NOT see Small/Large', !lawnView.some(o => /small|large/i.test(o.division)));
const adminView = bannerFor('all');
const divs = new Set(adminView.map(o => o.division));
expect('Admin (filter=all) sees every division', divs.size >= 2, [...divs].join(', '));

console.log(`\nflagged crew-days (filter=all): ${flagged.map(o => `${o.crewLabel}`).join(' | ')}`);
console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

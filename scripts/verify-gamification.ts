// Verify 🔥 flame + 🔆 monthly streak rules against the real lib (single-source
// approved math). Run: npx tsx scripts/verify-gamification.ts
import { crewDayHasFlame, computeMonthlyStreaks, crewKeyOf } from '../src/lib/crewGamification';

// Helper to build a crew-day log. bh = total booked BH (one job); ahList = AH per emp.
const day = (opts: { bh: number; ah: number[]; approved?: boolean; waived?: boolean; div?: string; crew?: number }) => ({
  division: opts.div ?? 'Lawn Division',
  crewNumber: opts.crew ?? 3,
  isAdHoc: false,
  jobs: [{ desc: 'job', bh: opts.bh, source: 'manual' }],
  employeeAH: Object.fromEntries(opts.ah.map((h, i) => [`e${i}`, h])),
  deductions: {},
  approvalStatus: opts.waived ? 'waived' : opts.approved ? 'approved' : 'pending',
} as any);

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${label}${detail ? `  — ${detail}` : ''}`); };

console.log('=== 🔥 FLAME (approved AND ≥100%) ===');
ok('approved 12BH / 10AH (120%) → flame', crewDayHasFlame(day({ bh: 12, ah: [10], approved: true })));
ok('approved 10BH / 10AH (100%) → flame', crewDayHasFlame(day({ bh: 10, ah: [10], approved: true })));
ok('approved 9BH / 10AH (90%) → NO flame', !crewDayHasFlame(day({ bh: 9, ah: [10], approved: true })));
ok('PENDING 12BH / 10AH (120%) → NO flame (approved-only)', !crewDayHasFlame(day({ bh: 12, ah: [10], approved: false })));
ok('waived 12BH / 10AH → NO flame', !crewDayHasFlame(day({ bh: 12, ah: [10], waived: true })));
ok('approved 12BH / 0AH (no actual hrs) → NO flame', !crewDayHasFlame(day({ bh: 12, ah: [0], approved: true })));

console.log('\n=== 🔆 MONTHLY STREAK ===');
const KEY = crewKeyOf({ division: 'Lawn Division', crewNumber: 3 });
const today = '2026-07-15';
// Build a month with a mix. (all this crew unless noted)
const perf: any = {
  // previous month — must be ignored (monthly reset)
  '2026-06-30': { c: day({ bh: 20, ah: [10], approved: true }) }, // 200% but June → ignored
  // July, oldest → newest
  '2026-07-02': { c: day({ bh: 8, ah: [10], approved: true }) },   // 80% qualifying → extends
  '2026-07-03': { c: day({ bh: 3, ah: [3], approved: true }) },    // <5 BH → SKIP (pass-through)
  '2026-07-04': { c: day({ bh: 10, ah: [10], approved: true }) },  // 100% qualifying → extends
  '2026-07-05': { c: day({ bh: 12, ah: [10], approved: false }) }, // pending → SKIP (pass-through)
  '2026-07-06': { c: day({ bh: 9, ah: [10], approved: true }) },   // 90% qualifying → extends
  // 07-07 no log at all → day off → SKIP
  '2026-07-08': { c: day({ bh: 20, ah: [10], approved: true }) },  // 200% qualifying → extends
  '2026-07-16': { c: day({ bh: 20, ah: [10], approved: true }) },  // FUTURE (after today) → ignored
};
const streaks = computeMonthlyStreaks(perf, today, null);
ok('streak counts approved ≥5BH ≥80% days, skipping sub-5BH/pending/day-off', streaks[KEY] === 4, `got ${streaks[KEY]} (expect 4: 07-02,04,06,08)`);
ok('previous-month 200% day excluded (monthly reset)', streaks[KEY] === 4);

// Now insert a BREAK: a qualifying (≥5BH approved) day BELOW 80% ends the run.
const perf2: any = {
  '2026-07-10': { c: day({ bh: 10, ah: [10], approved: true }) }, // 100% extends
  '2026-07-11': { c: day({ bh: 6, ah: [10], approved: true }) },  // 60% qualifying → BREAKS
  '2026-07-12': { c: day({ bh: 10, ah: [10], approved: true }) }, // 100% extends
  '2026-07-13': { c: day({ bh: 10, ah: [10], approved: true }) }, // 100% extends
};
const s2 = computeMonthlyStreaks(perf2, today, null)[KEY];
ok('a ≥5BH approved day <80% BREAKS the run (only days after it count)', s2 === 2, `got ${s2} (expect 2: 07-12,07-13; 07-11@60% broke it)`);

// A tiny job (<5 BH) between good days does NOT break the streak.
const perf3: any = {
  '2026-07-10': { c: day({ bh: 10, ah: [10], approved: true }) }, // extends
  '2026-07-11': { c: day({ bh: 2, ah: [10], approved: true }) },  // 20% but <5BH → SKIP
  '2026-07-12': { c: day({ bh: 10, ah: [10], approved: true }) }, // extends
};
const s3 = computeMonthlyStreaks(perf3, today, null)[KEY];
ok('a sub-5BH low day is skipped, not a break (day-off/tiny-job safe)', s3 === 2, `got ${s3} (expect 2)`);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

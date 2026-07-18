// Verify the bi-weekly pay-period anchor + pay-date math.
// Run: npx tsx scripts/verify-payperiods.ts
import { DEFAULT_PAY_PERIOD, currentPayPeriod, previousPayPeriod, stepPeriod, periodRangeLabel, payDateLabel } from '../src/lib/payPeriods';

let pass = 0, fail = 0;
const ok = (l: string, c: boolean, got: any = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${l}${got !== '' ? ` = ${got}` : ''}`); };
const cfg = DEFAULT_PAY_PERIOD;
const now = new Date(2026, 6, 18, 12).getTime();   // Jul 18 2026 (within current period)

const cur = currentPayPeriod(cfg, now);
const pay = previousPayPeriod(cfg, now);
console.log('=== anchor: current period Jul 6 – Jul 19, 2026 ===');
ok('current period = Jul 6 – Jul 19', periodRangeLabel(cur) === 'Jul 6 – Jul 19', periodRangeLabel(cur));
ok('current pays Jul 24 (end Sun + 5d Fri)', payDateLabel(cur) === 'Jul 24', payDateLabel(cur));
ok('payroll (previous) = Jun 22 – Jul 5', periodRangeLabel(pay) === 'Jun 22 – Jul 5', periodRangeLabel(pay));
ok('payroll pays Jul 10', payDateLabel(pay) === 'Jul 10', payDateLabel(pay));
ok('payroll start = 2026-06-22', pay.start === '2026-06-22', pay.start);
ok('current end = 2026-07-19', cur.end === '2026-07-19', cur.end);

const next = stepPeriod(cur, cfg, 1);
const prev = stepPeriod(pay, cfg, -1);
ok('next period = Jul 20 – Aug 2', periodRangeLabel(next) === 'Jul 20 – Aug 2', periodRangeLabel(next));
ok('prev-of-payroll = Jun 8 – Jun 21', periodRangeLabel(prev) === 'Jun 8 – Jun 21', periodRangeLabel(prev));

// A date INSIDE the payroll period resolves to it.
ok('Jun 30 falls in the payroll period', periodRangeLabel(currentPayPeriod(cfg, new Date(2026, 5, 30, 12).getTime())) === 'Jun 22 – Jul 5', periodRangeLabel(currentPayPeriod(cfg, new Date(2026, 5, 30, 12).getTime())));

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

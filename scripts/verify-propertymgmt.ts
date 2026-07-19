// Verify property-management logic: derived rent (3 shapes), countdown states,
// M2M notice flow. Run: npx tsx scripts/verify-propertymgmt.ts
import { tenancyMonthlyTotal, tenancyCountdown, computeNoticeEnd, noticeDaysOrDefault, msToYmd, addDaysYmd } from '../src/lib/propertyMgmt';

let pass = 0, fail = 0;
const ok = (l: string, c: boolean, got: any = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${l}${got !== '' ? ` = ${got}` : ''}`); };
const DAY = 86_400_000;
const now = new Date(2026, 6, 18, 12).getTime();     // Jul 18 2026
const ymdIn = (days: number) => msToYmd(now + days * DAY);

console.log('=== derived monthly rent — all three shapes ===');
ok('one payer $1,800 + contact-only = $1,800', tenancyMonthlyTotal({ tenants: [{ name: 'A', rentAmount: 1800 }, { name: 'B' }] } as any) === 1800);
ok('3 × $600 = $1,800', tenancyMonthlyTotal({ tenants: [{ name: 'A', rentAmount: 600 }, { name: 'B', rentAmount: 600 }, { name: 'C', rentAmount: 600 }] } as any) === 1800);
ok('600 + 700 + 500 = $1,800', tenancyMonthlyTotal({ tenants: [{ name: 'A', rentAmount: 600 }, { name: 'B', rentAmount: 700 }, { name: 'C', rentAmount: 500 }] } as any) === 1800);

console.log('\n=== fixed-term countdown: neutral / amber / red ===');
const fixed = (endDays: number) => tenancyCountdown({ status: 'fixed_term', leaseEnd: ymdIn(endDays), tenants: [] } as any, now);
ok('120 days out → neutral', fixed(120).level === 'neutral' && fixed(120).daysLeft === 120, `${fixed(120).level}/${fixed(120).daysLeft}`);
ok('30 days out → amber', fixed(30).level === 'amber', fixed(30).level);
ok('exactly 60 days → amber (≤60)', fixed(60).level === 'amber', fixed(60).level);
ok('61 days → neutral', fixed(61).level === 'neutral', fixed(61).level);
ok('10 days past → red, "expired"', fixed(-10).level === 'red' && /expired/.test(fixed(-10).label), fixed(-10).label);

console.log('\n=== month-to-month + 60-day notice flow ===');
const nd = noticeDaysOrDefault(null);
ok('default notice length = 60', nd === 60, nd);
const open = tenancyCountdown({ status: 'month_to_month', tenants: [] } as any, now);
ok('M2M open → no countdown ("month-to-month")', open.kind === 'm2m_open' && open.label === 'month-to-month');
const noticeYmd = ymdIn(-5);                          // notice given 5 days ago
const end = computeNoticeEnd(noticeYmd, nd);
ok('computedEnd = notice + 60 days', end === addDaysYmd(noticeYmd, 60), end);
const noticed = tenancyCountdown({ status: 'month_to_month', noticeGivenAt: noticeYmd, computedEnd: end, tenants: [] } as any, now);
ok('after notice → countdown starts, amber', noticed.kind === 'm2m_notice' && noticed.level === 'amber' && noticed.daysLeft === 55, `${noticed.level}/${noticed.daysLeft}`);
const pastEnd = tenancyCountdown({ status: 'month_to_month', noticeGivenAt: ymdIn(-70), computedEnd: ymdIn(-10), tenants: [] } as any, now);
ok('past notice end → red "end tenancy"', pastEnd.level === 'red' && /end tenancy/.test(pastEnd.label), pastEnd.label);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

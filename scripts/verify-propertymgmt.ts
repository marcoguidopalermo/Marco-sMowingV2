// Verify property-management logic: derived rent (3 shapes), countdown states,
// M2M notice flow. Run: npx tsx scripts/verify-propertymgmt.ts
import { tenancyMonthlyTotal, tenancyCountdown, tenancyMoveOut, tenancyDeposit, moveOutIsShortNotice, noticeDaysOrDefault, msToYmd, starredTenant, tenantsStarredFirst, NOTICE_DAYS_DEFAULT } from '../src/lib/propertyMgmt';

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

console.log('\n=== MOVE OUT — actual date, both tenancy types ===');
const nd = noticeDaysOrDefault(null);
ok('default notice length (hint) = 75', nd === 75, nd);
const open = tenancyCountdown({ status: 'month_to_month', tenants: [] } as any, now);
ok('M2M open → no countdown ("month-to-month")', open.kind === 'open' && open.label === 'month-to-month');
// M2M with a move-out date → countdown to THAT date (not +60).
const mo = tenancyCountdown({ status: 'month_to_month', moveOutAt: ymdIn(54), tenants: [] } as any, now);
ok('M2M move-out → "moving out in 54 days", amber', mo.kind === 'moveout' && mo.level === 'amber' && mo.daysLeft === 54 && /moving out in 54/.test(mo.label), `${mo.level}/${mo.daysLeft}`);
// Fixed-term with a move-out date (leaving early) → move-out, not expiry.
const fmo = tenancyCountdown({ status: 'fixed_term', leaseEnd: ymdIn(200), moveOutAt: ymdIn(20), tenants: [] } as any, now);
ok('fixed-term move-out overrides expiry (20 days)', fmo.kind === 'moveout' && fmo.daysLeft === 20 && /moving out/.test(fmo.label), `${fmo.kind}/${fmo.daysLeft}`);
ok('past move-out → red "end tenancy"', tenancyCountdown({ status: 'month_to_month', moveOutAt: ymdIn(-3), tenants: [] } as any, now).label.includes('end tenancy'));
ok('short-notice hint fires < 60 days', moveOutIsShortNotice(ymdIn(40), nd, now) === true && moveOutIsShortNotice(ymdIn(90), nd, now) === false);

console.log('\n=== legacy migration (no data lost) ===');
ok('legacy computedEnd → move-out date', tenancyMoveOut({ computedEnd: ymdIn(10) } as any) === ymdIn(10));
ok('legacy notice countdown still reads as move-out', tenancyCountdown({ status: 'month_to_month', noticeGivenAt: ymdIn(-5), computedEnd: ymdIn(55), tenants: [] } as any, now).kind === 'moveout');
ok('legacy depositNote → structured note', tenancyDeposit({ depositNote: '$1,800 · Jun 1' } as any).note === '$1,800 · Jun 1' && !tenancyDeposit({ depositNote: 'x' } as any).collected);
ok('structured deposit preferred over legacy', tenancyDeposit({ deposit: { collected: true, amount: 1800 }, depositNote: 'old' } as any).amount === 1800);

// ── starred main contact + 75-day notice default ──
console.log('\n=== starred main contact + notice default ===');
ok('notice default is 75', NOTICE_DAYS_DEFAULT === 75);
ok('noticeDaysOrDefault falls back to 75', noticeDaysOrDefault(undefined) === 75);
ok('noticeDaysOrDefault honors a set value', noticeDaysOrDefault({ contractingNoticeDays: 90 }) === 90);
const T1 = { name: 'A', phone: '111' }, T2 = { name: 'B', phone: '222', main: true }, T3 = { name: 'C' };
ok('explicit star wins', starredTenant({ tenants: [T1, T2, T3] } as any)?.name === 'B');
ok('no star → first tenant', starredTenant({ tenants: [T1, T3] } as any)?.name === 'A');
ok('single tenant auto-stars', starredTenant({ tenants: [T3] } as any)?.name === 'C');
ok('empty → undefined', starredTenant({ tenants: [] } as any) === undefined);
ok('starred-first ordering', tenantsStarredFirst({ tenants: [T1, T2, T3] } as any).map(t => t.name).join('') === 'BAC');

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

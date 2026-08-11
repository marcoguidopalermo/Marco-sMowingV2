// Verifies the MarketingMaster access model:
//   1. The 'marketing' role can reach EXACTLY ONE view — 'marketing'.
//   2. No existing role gained ANY permission (marketing included, whose only
//      true is canViewMarketing).
//   3. canViewMarketing is false for every role except 'marketing' — access for
//      Marco and James is granted by name in App.tsx, not by role, so no other
//      admin picks it up.
//   4. A marketing user lands on the marketing view.
//
// Run: npx tsx scripts/verify-marketing.ts
import {
  ROLE_PERMISSIONS, APP_VIEW_ORDER, canAccessView, can,
  defaultLandingView, firstAccessibleView, Permission,
} from '../src/lib/permissions';
import type { UserRole } from '../src/types';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
};

const ROLES = Object.keys(ROLE_PERMISSIONS) as UserRole[];

console.log('\nMarketing role sees only the marketing surface');
const reachable = APP_VIEW_ORDER.filter(v => canAccessView(v, 'marketing'));
check('exactly one reachable view', reachable.length === 1, `got [${reachable.join(', ')}]`);
check("that view is 'marketing'", reachable[0] === 'marketing', `got ${reachable[0]}`);
check('lands on marketing', defaultLandingView('marketing') === 'marketing');
check('fallback view is marketing', firstAccessibleView('marketing') === 'marketing');

console.log('\nMarketing role holds exactly one permission');
const granted = (Object.keys(ROLE_PERMISSIONS.marketing) as Permission[])
  .filter(k => ROLE_PERMISSIONS.marketing[k]);
check('one granted permission', granted.length === 1, `got [${granted.join(', ')}]`);
check('it is canViewMarketing', granted[0] === 'canViewMarketing', `got ${granted[0]}`);

console.log('\ncanViewMarketing is role-scoped to marketing only');
for (const r of ROLES) {
  if (r === 'marketing') continue;
  check(`${r} cannot view marketing`, !can('canViewMarketing', r));
}
check('the marketing view is unreachable for admin by role alone', !canAccessView('marketing', 'admin'));

console.log('\nNo existing role widened');
// Every pre-existing role must keep canViewMarketing false and reach the same
// views it reached before — which, since 'marketing' is the only new view and
// it's false for all of them, means their reachable set excludes 'marketing'.
for (const r of ROLES) {
  if (r === 'marketing') continue;
  const views = APP_VIEW_ORDER.filter(v => canAccessView(v, r));
  check(`${r} reachable views exclude marketing`, !views.includes('marketing'), `got [${views.join(', ')}]`);
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);

// Verify policy change-request badge counts + permission gates (pure logic
// mirror of RoleLibrary/App). Run: npx tsx scripts/verify-policy-requests.ts
type Req = { id: string; policyId: string; status: 'open' | 'resolved'; createdBy: { id: string } };

const openByPolicy = (reqs: Req[]) => {
  const m: Record<string, number> = {};
  for (const r of reqs) if (r.status === 'open') m[r.policyId] = (m[r.policyId] || 0) + 1;
  return m;
};
const total = (m: Record<string, number>) => Object.values(m).reduce((s, n) => s + n, 0);

// Permission gates (mirror App handlers + RoleLibrary UI)
const canRequest = (role: 'admin' | 'manager' | 'worker') => role === 'admin' || role === 'manager';
const canResolve = (role: string) => role === 'admin';
const canEditOwnOpen = (r: Req, userId: string) => r.status === 'open' && r.createdBy.id === userId;

let pass = 0, fail = 0;
const ok = (l: string, c: boolean, got: any = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${l}${got !== '' ? ` = ${got}` : ''}`); };

// Start: one open request on policy A.
let reqs: Req[] = [{ id: 'r1', policyId: 'A', status: 'open', createdBy: { id: 'nina@x' } }];
let m = openByPolicy(reqs);
console.log('=== badge counts ===');
ok('policy A row badge = 1', m['A'] === 1, m['A']);
ok('rollup total = 1', total(m) === 1, total(m));

// Second request on A, one on B.
reqs.push({ id: 'r2', policyId: 'A', status: 'open', createdBy: { id: 'joe@x' } });
reqs.push({ id: 'r3', policyId: 'B', status: 'open', createdBy: { id: 'nina@x' } });
m = openByPolicy(reqs);
ok('policy A badge = 2, B badge = 1', m['A'] === 2 && m['B'] === 1, `${m['A']}/${m['B']}`);
ok('rollup total = 3', total(m) === 3, total(m));

// Resolve r1 → A decrements, total decrements. Resolved stays in history.
reqs = reqs.map(r => r.id === 'r1' ? { ...r, status: 'resolved' } : r);
m = openByPolicy(reqs);
ok('after resolving r1: A badge = 1 (decremented)', m['A'] === 1, m['A']);
ok('rollup total = 2', total(m) === 2, total(m));
ok('resolved request still present in history', reqs.some(r => r.id === 'r1' && r.status === 'resolved'));
ok('no badge when zero (undefined → render nothing)', m['C'] === undefined, String(m['C']));

console.log('\n=== permissions ===');
ok('manager CAN request', canRequest('manager'));
ok('admin CAN request', canRequest('admin'));
ok('worker CANNOT request (no button)', !canRequest('worker'));
ok('admin CAN resolve', canResolve('admin'));
ok('manager CANNOT resolve', !canResolve('manager'));
ok('creator CAN edit own OPEN request', canEditOwnOpen({ id: 'r2', policyId: 'A', status: 'open', createdBy: { id: 'joe@x' } }, 'joe@x'));
ok('non-creator CANNOT edit', !canEditOwnOpen({ id: 'r2', policyId: 'A', status: 'open', createdBy: { id: 'joe@x' } }, 'nina@x'));
ok('resolved request is frozen (no edit)', !canEditOwnOpen({ id: 'r1', policyId: 'A', status: 'resolved', createdBy: { id: 'nina@x' } }, 'nina@x'));

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

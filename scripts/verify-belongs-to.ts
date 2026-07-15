// Verify belongs-to (responsibility XOR category) chip resolution + that role
// reassignment carries responsibilities (holder resolves through the role).
// Run: npx tsx scripts/verify-belongs-to.ts
import { dutyChip, responsibilityColor } from '../src/lib/roleResponsibilities';

const responsibilities: any = {
  'resp-web': { id: 'resp-web', name: 'Website & Domain', color: 'indigo', roleId: 'role-office', active: true, sop: '', tier: 'admin' },
};
const cats = { Payroll: 'emerald' };

let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${l}${d ? `  — ${d}` : ''}`); };

console.log('=== belongs-to XOR chip resolution ===');
// Responsibility linked → responsibility chip, category IGNORED even if present.
const dResp = dutyChip({ responsibilityId: 'resp-web', category: 'Payroll' } as any, responsibilities, cats);
ok('responsibility wins over category (XOR)', dResp?.kind === 'responsibility' && dResp?.label === 'Website & Domain', JSON.stringify(dResp));

// Category only → category chip.
const dCat = dutyChip({ category: 'Payroll' } as any, responsibilities, cats);
ok('category tag resolves when no responsibility', dCat?.kind === 'category' && dCat?.label === 'Payroll');

// Neither → null (no chip).
ok('no belongs-to → no chip', dutyChip({ category: '' } as any, responsibilities, cats) === null);

// Linked responsibility missing (deleted) → falls back to category, nothing vanishes.
const dGone = dutyChip({ responsibilityId: 'resp-DELETED', category: 'Payroll' } as any, responsibilities, cats);
ok('missing responsibility falls back to category', dGone?.kind === 'category' && dGone?.label === 'Payroll');

// Color: responsibility uses its stored palette key.
ok('responsibility color = stored key', responsibilityColor(responsibilities['resp-web']).key === 'indigo');

console.log('\n=== role reassignment carries responsibilities (holder via role) ===');
// A responsibility links by roleId; the holder is resolved live through the
// role's assignment — reassigning the role changes the holder with no transfer.
const roleHolder = (roles: any, roleId: string) => roles[roleId]?.assignedEmployeeId;
let roles: any = { 'role-office': { id: 'role-office', assignedEmployeeId: 'emp-dave' } };
ok('holder resolves to current role assignee (Dave)', roleHolder(roles, responsibilities['resp-web'].roleId) === 'emp-dave');
// Reassign the role — no change to the responsibility record itself.
roles = { 'role-office': { id: 'role-office', assignedEmployeeId: 'emp-nina' } };
ok('after role reassignment, SAME responsibility now resolves to Nina (no transfer)', roleHolder(roles, responsibilities['resp-web'].roleId) === 'emp-nina');

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

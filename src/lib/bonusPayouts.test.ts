// Tests for the bonus PAYOUT MARKER layer.
//   npx tsx src/lib/bonusPayouts.test.ts
//
// The load-bearing assertion in this file is that marking NEVER changes what
// anyone earned — only what is paid.
import assert from 'node:assert/strict';
import { summarisePayout, applyMark, applyAmountEdit, nextState, stateOf, reasonLabel, effectiveAmount, editOf } from './bonusPayouts';
import { computeBonus, STANDARD_BONUS_TIERS } from './bonusTiers';
import type { BonusPayoutRecord, MonthlySummary } from '../types';

let pass = 0, fail = 0;
const test = (n: string, fn: () => void) => {
  try { fn(); pass++; console.log(`  ✓ ${n}`); }
  catch (e) { fail++; console.error(`  ✗ ${n}\n      ${(e as Error).message}`); }
};

// A month with one division at 90% (→ $3/BH) and three people.
const SUMMARY = {
  ym: '2026-07',
  divisions: [{
    division: 'Lawn Division',
    adjustedEff: 90,
    bh: 100,
    perEmployee: [
      { empId: 'e1', name: 'Ann', bh: 60 },
      { empId: 'e2', name: 'Ben', bh: 30 },
      { empId: 'e3', name: 'Cal', bh: 10 },
    ],
  }],
} as unknown as MonthlySummary;

const RESULT = computeBonus(SUMMARY, STANDARD_BONUS_TIERS);
const rec = (marks: BonusPayoutRecord['marks']): BonusPayoutRecord =>
  ({ ym: '2026-07', marks, audit: [] });
const mark = (state: 'paid' | 'excluded', amount = 0) =>
  ({ empId: 'x', empName: 'x', state, amountAtMark: amount, by: 'a', byName: 'A', at: 1 } as any);

console.log('\nBaseline (the math this layer must not disturb)');
test('the fixture pays $3/BH: 180 / 90 / 30, pool 300', () => {
  assert.equal(RESULT.divisions[0].rate, 3);
  assert.equal(RESULT.divisions[0].pool, 300);
  assert.deepEqual(RESULT.perPerson.map(p => p.total), [180, 90, 30]);
});

console.log('\nExclusion');
test('an excluded share is withheld — company total drops by exactly that amount', () => {
  const s = summarisePayout(RESULT, rec({ e1: mark('excluded', 180) }));
  assert.equal(s.company.calculated, 300);
  assert.equal(s.company.excluded, 180);
  assert.equal(s.company.toPay, 120);
});
test('exclusion does NOT redistribute — every other share is unchanged', () => {
  const before = computeBonus(SUMMARY, STANDARD_BONUS_TIERS);
  const s = summarisePayout(RESULT, rec({ e1: mark('excluded', 180) }));
  const after = computeBonus(SUMMARY, STANDARD_BONUS_TIERS);
  // The calculation is re-run with the mark in place and is byte-identical.
  assert.deepEqual(after.perPerson, before.perPerson);
  assert.equal(after.perPerson.find(p => p.empId === 'e2')!.total, 90);
  assert.equal(after.perPerson.find(p => p.empId === 'e3')!.total, 30);
  // And the excluded person's own EARNED figure still reads 180.
  assert.equal(after.perPerson.find(p => p.empId === 'e1')!.total, 180);
  assert.equal(s.company.toPay, 120, 'only the payout total moves');
});
test("the division's payout total reduces by the excluded amount", () => {
  const s = summarisePayout(RESULT, rec({ e2: mark('excluded', 90) }));
  const d = s.byDivision['Lawn Division'];
  assert.equal(d.calculated, 300);
  assert.equal(d.excluded, 90);
  assert.equal(d.toPay, 210);
});
test('marking PAID does not change any total', () => {
  const s = summarisePayout(RESULT, rec({ e1: mark('paid', 180), e2: mark('paid', 90) }));
  assert.equal(s.company.calculated, 300);
  assert.equal(s.company.excluded, 0);
  assert.equal(s.company.toPay, 300);
});
test('multiple exclusions accumulate', () => {
  const s = summarisePayout(RESULT, rec({ e1: mark('excluded', 180), e3: mark('excluded', 30) }));
  assert.equal(s.company.excluded, 210);
  assert.equal(s.company.toPay, 90);
});

console.log('\nProgress readout');
test('counts paid of PAYABLE rows, and excluded separately', () => {
  const s = summarisePayout(RESULT, rec({ e1: mark('paid', 180), e2: mark('excluded', 90) }));
  assert.equal(s.progress.excluded, 1);
  assert.equal(s.progress.payable, 2, 'three people less the excluded one');
  assert.equal(s.progress.paid, 1);
  assert.equal(s.progress.totals.toPay, 210);
});
test('a $0 row is not payable, so the readout can reach completion', () => {
  const zero = { ...SUMMARY, divisions: [{ ...SUMMARY.divisions[0], adjustedEff: 50 }] } as unknown as MonthlySummary;
  const r = computeBonus(zero, STANDARD_BONUS_TIERS);
  const s = summarisePayout(r, undefined);
  assert.equal(s.company.calculated, 0);
  assert.equal(s.progress.payable, 0);
});

console.log('\nToggling');
test('tapping the active state clears it', () => {
  assert.equal(nextState('paid', 'paid'), 'unmarked');
  assert.equal(nextState('excluded', 'excluded'), 'unmarked');
  assert.equal(nextState('unmarked', 'paid'), 'paid');
  assert.equal(nextState('paid', 'excluded'), 'excluded', 'one state replaces the other');
});

console.log('\nRecord + audit');
test('applying a mark stores state, reason, amount and who/when', () => {
  const r = applyMark({
    rec: undefined, ym: '2026-07', empId: 'e1', empName: 'Ann', to: 'excluded',
    amount: 180, reason: 'left_before_month_end', by: 'admin@x', byName: 'Marco', at: 1000,
  });
  const m = r.marks.e1;
  assert.equal(m.state, 'excluded');
  assert.equal(m.reason, 'left_before_month_end');
  assert.equal(m.amountAtMark, 180);
  assert.equal(m.byName, 'Marco');
  assert.equal(m.at, 1000);
});
test('every transition is audited, including CLEARING a mark', () => {
  const r1 = applyMark({
    rec: undefined, ym: '2026-07', empId: 'e1', empName: 'Ann', to: 'paid',
    amount: 180, by: 'a@x', byName: 'A', at: 1,
  });
  const r2 = applyMark({
    rec: r1, ym: '2026-07', empId: 'e1', empName: 'Ann', to: 'unmarked',
    amount: 180, by: 'b@x', byName: 'B', at: 2,
  });
  assert.equal(r2.audit.length, 2);
  assert.deepEqual(
    r2.audit.map(a => `${a.from}->${a.to} by ${a.byName}`),
    ['unmarked->paid by A', 'paid->unmarked by B'],
  );
  assert.equal(stateOf(r2, 'e1'), 'unmarked');
  assert.equal(r2.marks.e1, undefined, 'cleared marks leave no state behind');
});
test('the audit is append-only across many changes', () => {
  let r = applyMark({ rec: undefined, ym: '2026-07', empId: 'e1', empName: 'Ann', to: 'paid', amount: 180, by: 'a', byName: 'A', at: 1 });
  r = applyMark({ rec: r, ym: '2026-07', empId: 'e2', empName: 'Ben', to: 'excluded', amount: 90, reason: 'other', reasonNote: 'on leave', by: 'a', byName: 'A', at: 2 });
  r = applyMark({ rec: r, ym: '2026-07', empId: 'e1', empName: 'Ann', to: 'excluded', amount: 180, reason: 'not_yet_eligible', by: 'a', byName: 'A', at: 3 });
  assert.equal(r.audit.length, 3);
  assert.equal(r.audit[2].from, 'paid');
  assert.equal(r.audit[2].to, 'excluded');
  assert.equal(r.marks.e2.reasonNote, 'on leave');
  assert.equal(reasonLabel('other', 'on leave'), 'Other: on leave');
});
test('a reason is only stored for exclusions', () => {
  const r = applyMark({
    rec: undefined, ym: '2026-07', empId: 'e1', empName: 'Ann', to: 'paid',
    amount: 180, reason: 'left_before_month_end', by: 'a', byName: 'A', at: 1,
  });
  assert.equal(r.marks.e1.reason, undefined);
});

console.log('\nAdjusted amounts');
const withEdit = (empId: string, amount: number, calculated: number, marks: any = {}): BonusPayoutRecord =>
  applyAmountEdit({
    rec: { ym: '2026-07', marks, audit: [] }, ym: '2026-07', empId, empName: 'X',
    amount, calculated, reason: 'Rounded up', by: 'a', byName: 'A', at: 1,
  });

test('rounding $30 up to $50 shows as a +$20 adjustment, not a new calculated figure', () => {
  const s = summarisePayout(RESULT, withEdit('e3', 50, 30));
  assert.equal(s.company.calculated, 300, 'the calculation is untouched');
  assert.equal(s.company.adjustments, 20);
  assert.equal(s.company.toPay, 320);
  // And the earned figure is still 30 on the result itself.
  assert.equal(RESULT.perPerson.find(p => p.empId === 'e3')!.total, 30);
});
test('an adjustment DOWN is a negative adjustment', () => {
  const s = summarisePayout(RESULT, withEdit('e1', 150, 180));
  assert.equal(s.company.adjustments, -30);
  assert.equal(s.company.toPay, 270);
});
test('the three totals always reconcile: calculated - excluded + adjustments = to pay', () => {
  let r = withEdit('e3', 50, 30);
  r = applyMark({ rec: r, ym: '2026-07', empId: 'e2', empName: 'Ben', to: 'excluded', amount: 90, reason: 'left_before_month_end', by: 'a', byName: 'A', at: 2 });
  const s = summarisePayout(RESULT, r);
  assert.equal(s.company.calculated, 300);
  assert.equal(s.company.excluded, 90);
  assert.equal(s.company.adjustments, 20);
  assert.equal(s.company.toPay, 230);
  assert.equal(s.company.calculated - s.company.excluded + s.company.adjustments, s.company.toPay);
});
test('an EXCLUDED row pays nothing regardless of an edit, and keeps the edit on record', () => {
  let r = withEdit('e1', 500, 180);
  r = applyMark({ rec: r, ym: '2026-07', empId: 'e1', empName: 'Ann', to: 'excluded', amount: 180, reason: 'left_before_month_end', by: 'a', byName: 'A', at: 2 });
  const s = summarisePayout(RESULT, r);
  assert.equal(s.company.excluded, 180, 'the CALCULATED share is what is withheld');
  assert.equal(s.company.adjustments, 0, 'the edit contributes no money');
  assert.equal(s.company.toPay, 120);
  assert.ok(editOf(r, 'e1'), 'the edit is still on the record');
});
test('an edited row can still be marked paid, and both survive', () => {
  let r = withEdit('e3', 50, 30);
  r = applyMark({ rec: r, ym: '2026-07', empId: 'e3', empName: 'Cal', to: 'paid', amount: 50, by: 'a', byName: 'A', at: 2 });
  assert.equal(stateOf(r, 'e3'), 'paid');
  assert.equal(editOf(r, 'e3')!.amount, 50);
  const s = summarisePayout(RESULT, r);
  assert.equal(s.progress.paid, 1);
  assert.equal(s.company.toPay, 320);
});
test('clearing a PAID mark leaves the adjustment intact (and vice versa)', () => {
  let r = withEdit('e3', 50, 30);
  r = applyMark({ rec: r, ym: '2026-07', empId: 'e3', empName: 'Cal', to: 'paid', amount: 50, by: 'a', byName: 'A', at: 2 });
  r = applyMark({ rec: r, ym: '2026-07', empId: 'e3', empName: 'Cal', to: 'unmarked', amount: 50, by: 'a', byName: 'A', at: 3 });
  assert.equal(editOf(r, 'e3')!.amount, 50, 'the adjustment survives clearing paid');
  const cleared = applyAmountEdit({ rec: r, ym: '2026-07', empId: 'e3', empName: 'Cal', amount: null, calculated: 30, by: 'a', byName: 'A', at: 4 });
  assert.equal(editOf(cleared, 'e3'), undefined);
  assert.equal(summarisePayout(RESULT, cleared).company.toPay, 300, 'back to the calculated figure');
});
test('the division payout carries the adjustment so divisions still sum to company', () => {
  const s = summarisePayout(RESULT, withEdit('e3', 50, 30));
  const d = s.byDivision['Lawn Division'];
  assert.equal(d.calculated, 300);
  assert.equal(d.adjustments, 20);
  assert.equal(d.toPay, 320);
  const sumDiv = Object.values(s.byDivision).reduce((a, v) => a + v.toPay, 0);
  assert.equal(sumDiv, s.company.toPay);
});
test('effectiveAmount reports the adjusted figure, falling back to calculated', () => {
  const r = withEdit('e3', 50, 30);
  assert.equal(effectiveAmount(r, 'e3', 30), 50);
  assert.equal(effectiveAmount(r, 'e1', 180), 180);
});
test('an amount edit is audited with both figures and its reason', () => {
  const r = withEdit('e3', 50, 30);
  const a = r.audit[r.audit.length - 1];
  assert.equal(a.kind, 'amount');
  assert.equal(a.fromAmount, 30);
  assert.equal(a.toAmount, 50);
  assert.equal(a.amountReason, 'Rounded up');
  assert.equal(a.empId, 'e3');
});
test('re-editing audits from the PREVIOUS adjusted figure, not the calculated one', () => {
  const r1 = withEdit('e3', 50, 30);
  const r2 = applyAmountEdit({ rec: r1, ym: '2026-07', empId: 'e3', empName: 'Cal', amount: 60, calculated: 30, by: 'a', byName: 'A', at: 5 });
  const a = r2.audit[r2.audit.length - 1];
  assert.equal(a.fromAmount, 50);
  assert.equal(a.toAmount, 60);
});
test('marking does not discard edits and editing does not discard marks', () => {
  let r = applyMark({ rec: undefined, ym: '2026-07', empId: 'e1', empName: 'Ann', to: 'paid', amount: 180, by: 'a', byName: 'A', at: 1 });
  r = applyAmountEdit({ rec: r, ym: '2026-07', empId: 'e1', empName: 'Ann', amount: 200, calculated: 180, by: 'a', byName: 'A', at: 2 });
  assert.equal(stateOf(r, 'e1'), 'paid');
  assert.equal(editOf(r, 'e1')!.amount, 200);
  assert.equal(r.audit.length, 2);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

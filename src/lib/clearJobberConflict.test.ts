// Resolving a conflict must REMOVE the keys, not write false.
//   npm test -- clearJobberConflict
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { clearJobberConflict } from './clearJobberConflict';

const row = (o: any = {}) => ({
  desc: 'Client - Weekly', bh: 1.5, source: 'jobber',
  jobberVisitId: 'v1', hasJobberConflict: true, jobberSuggestedValue: 2.5, ...o,
} as any);

console.log('\nThe keys are gone, not falsified');
test('THE FIX: neither key survives, so nothing is stored', () => {
  const out = clearJobberConflict(row());
  assert.equal('hasJobberConflict' in out, false, 'writing false costs 10.9 KB across the doc');
  assert.equal('jobberSuggestedValue' in out, false);
});
test('an absent key reads identically to false for every reader', () => {
  const out = clearJobberConflict(row());
  assert.equal(!!(out as any).hasJobberConflict, false);
});
test('everything else on the row is untouched', () => {
  const out = clearJobberConflict(row({ bh: 9, manuallyEditedAt: 123 }));
  assert.equal(out.bh, 9);
  assert.equal(out.desc, 'Client - Weekly');
  assert.equal(out.jobberVisitId, 'v1');
  assert.equal((out as any).manuallyEditedAt, 123);
});
test('a row that never had a conflict is returned unharmed', () => {
  const clean = { desc: 'x', bh: 1, source: 'manual' } as any;
  assert.deepEqual(clearJobberConflict(clean), clean);
});
test('it does not mutate the row it was given', () => {
  const r = row();
  clearJobberConflict(r);
  assert.equal(r.hasJobberConflict, true, 'the input is left alone');
});

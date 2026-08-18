// Tests for per-key settings deltas.
//   npm test -- settingsWrite
//
// settings is eight unrelated sub-settings under one field name. Twelve call
// sites each change one key and rewrite the other seven from memory. These
// cases are about what an edit to one key must NOT do to the others.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { computeSettingsUpdate } from './settingsWrite';

const SERVER = {
  endOfDayReminder: 'Lock trailers.',
  capacity: { headcountCeilings: [{ weeklyBH: 40, headcount: 1 }] },
  salesMaster: { services: [{ id: 's1', rate: 90 }] },
  contractingRates: { labour: 75 },
  contractingSuppliers: ['Home Depot'],
  contractingAuditLog: [{ action: 'archive', at: 1 }],
  roleMasterCategoryColors: { safety: 'indigo' },
  crewSizeAllowance: [{ size: 3, pct: 10 }],
};
const plan = (o: Partial<Parameters<typeof computeSettingsUpdate>[0]> = {}) =>
  computeSettingsUpdate({ server: SERVER, baseline: SERVER, next: SERVER, ...o });

console.log('\nOrdinary edits');
test('changing one setting writes exactly one path', () => {
  const p = plan({ next: { ...SERVER, contractingRates: { labour: 80 } } });
  assert.deepEqual(p.changed, ['contractingRates']);
  assert.deepEqual(Object.keys(p.patch), ['settings.contractingRates']);
  assert.deepEqual(p.patch['settings.contractingRates'], { labour: 80 });
});
test('a brand-new setting is added without touching the rest', () => {
  const p = plan({ next: { ...SERVER, payPeriod: { anchorStart: '2026-01-05', lengthDays: 14 } } });
  assert.deepEqual(p.changed, ['payPeriod']);
  assert.equal(Object.keys(p.patch).length, 1);
});
test('a no-op edit reports noop, so the caller can skip the write', () => {
  const p = plan();
  assert.equal(p.noop, true);
  assert.deepEqual(p.patch, {});
});
test('a deep change inside one key is detected', () => {
  const p = plan({
    next: { ...SERVER, capacity: { headcountCeilings: [{ weeklyBH: 45, headcount: 1 }] } },
  });
  assert.deepEqual(p.changed, ['capacity']);
});
test('removing one setting emits a path with undefined, for deleteField', () => {
  const { crewSizeAllowance, ...withoutOne } = SERVER;
  const p = plan({ next: withoutOne });
  assert.deepEqual(p.removed, ['crewSizeAllowance']);
  assert.ok('settings.crewSizeAllowance' in p.patch);
  assert.equal(p.patch['settings.crewSizeAllowance'], undefined);
});

console.log('\nWhat a stale map must not be able to do');
test('THE BUG: editing the rate card cannot revert the capacity calendar', () => {
  // Admin A opened Contracting when capacity had one ceiling row. Admin B has
  // since added a second. Admin A edits the rate card and saves.
  const serverMoved = {
    ...SERVER,
    capacity: { headcountCeilings: [{ weeklyBH: 40, headcount: 1 }, { weeklyBH: 70, headcount: 2 }] },
  };
  const p = plan({
    baseline: SERVER,
    next: { ...SERVER, contractingRates: { labour: 80 } },
    server: serverMoved,
  });
  assert.deepEqual(p.changed, ['contractingRates'], 'only the rate card is in this edit');
  assert.ok(!('settings.capacity' in p.patch), "the other admin's capacity is never written");
});
test('a stale map cannot revert a pay input it never touched', () => {
  // crewSizeAllowance feeds the efficiency/bonus calculation.
  const p = plan({
    baseline: SERVER,
    next: SERVER,
    server: { ...SERVER, crewSizeAllowance: [{ size: 3, pct: 15 }] },
  });
  assert.equal(p.noop, true);
  assert.deepEqual(p.patch, {});
});
test('a stale map cannot delete a setting added since it loaded', () => {
  const p = plan({
    baseline: SERVER,
    next: SERVER,
    server: { ...SERVER, contractingNoticeDays: 60 },
  });
  assert.deepEqual(p.removed, [], 'it was never in the baseline, so it is not being removed');
  assert.equal(p.noop, true);
});
test('two admins changing different settings both land', () => {
  const p = plan({
    baseline: SERVER,
    next: { ...SERVER, salesMaster: { services: [{ id: 's1', rate: 95 }] } },
    server: { ...SERVER, roleMasterCategoryColors: { safety: 'amber' } },
  });
  assert.deepEqual(Object.keys(p.patch), ['settings.salesMaster']);
});

console.log('\nRefusals');
test('an edit that wipes settings back to its coded default is refused', () => {
  // This is the exact shape of a client that fell back to
  // { endOfDayReminder: DEFAULT_EOD_REMINDER } — seven keys gone at once.
  const p = plan({ next: { endOfDayReminder: 'Lock trailers.' } });
  assert.equal(p.refused, 'mass-removal');
  assert.deepEqual(p.patch, {});
  assert.equal(p.removed.length, 7, 'the intent is still reported honestly');
});
test('removing a single setting from a full map is NOT refused', () => {
  const { capacity, ...rest } = SERVER;
  const p = plan({ next: rest });
  assert.equal(p.refused, undefined);
  assert.deepEqual(p.removed, ['capacity']);
});
test('removals already applied on the server do not count toward the refusal', () => {
  const { capacity, salesMaster, contractingRates, contractingSuppliers, ...rest } = SERVER;
  const p = plan({
    baseline: SERVER,
    next: rest,                                    // intends to drop four
    server: { ...rest, capacity, salesMaster },    // two are already gone
  });
  assert.equal(p.refused, undefined, 'only two are actually being removed');
  assert.equal(p.removed.length, 4);
});
test('a key that could address a different field refuses the WHOLE update', () => {
  // 'a.b' as a dotted path would write settings.a.b, a field this edit never
  // named. Partial application would be worse than none.
  const p = plan({ next: { ...SERVER, 'evil.path': 1 } as any });
  assert.equal(p.refused, 'unsafe-key');
  assert.deepEqual(p.unsafeKeys, ['evil.path']);
  assert.deepEqual(p.patch, {}, 'nothing is written, not even the safe keys');
});
test('a backtick key is refused too — field paths quote with backticks', () => {
  const p = plan({ next: { ...SERVER, '`x`': 1 } as any });
  assert.equal(p.refused, 'unsafe-key');
});

console.log('\nDegenerate input');
test('null/undefined maps are treated as empty rather than throwing', () => {
  assert.equal(computeSettingsUpdate({ server: null, baseline: null, next: null }).noop, true);
  const p = computeSettingsUpdate({ server: null, baseline: undefined, next: { capacity: 1 } });
  assert.deepEqual(p.patch, { 'settings.capacity': 1 });
});
test('a key explicitly set to undefined is not treated as present', () => {
  const p = plan({ next: { ...SERVER, capacity: undefined } });
  assert.deepEqual(p.removed, ['capacity']);
  assert.deepEqual(p.changed, []);
});

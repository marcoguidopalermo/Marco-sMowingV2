// Tests for per-key settings deltas.
//   npm test -- keyedMapWrite
//
// settings is eight unrelated sub-settings under one field name. Twelve call
// sites each change one key and rewrite the other seven from memory. These
// cases are about what an edit to one key must NOT do to the others.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { applyKeyedMapUpdate, computeKeyedMapUpdate } from './keyedMapWrite';

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
const plan = (o: Partial<Parameters<typeof computeKeyedMapUpdate>[0]> = {}) =>
  computeKeyedMapUpdate({ server: SERVER, baseline: SERVER, next: SERVER, ...o });

console.log('\nOrdinary edits');
test('changing one setting writes exactly one path', () => {
  const p = plan({ next: { ...SERVER, contractingRates: { labour: 80 } } });
  assert.deepEqual(p.changed, ['contractingRates']);
  assert.deepEqual(p.changed, ['contractingRates']);
});
test('a brand-new setting is added without touching the rest', () => {
  const p = plan({ next: { ...SERVER, payPeriod: { anchorStart: '2026-01-05', lengthDays: 14 } } });
  assert.deepEqual(p.changed, ['payPeriod']);
  assert.deepEqual(p.removed, []);
});
test('a no-op edit reports noop, so the caller can skip the write', () => {
  const p = plan();
  assert.equal(p.noop, true);
  assert.deepEqual(p.changed, []);
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
  assert.deepEqual(p.removedOnServer, ['crewSizeAllowance']);
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
  assert.ok(!p.changed.includes('capacity'), "the other admin's capacity is never written");
});
test('a stale map cannot revert a pay input it never touched', () => {
  // crewSizeAllowance feeds the efficiency/bonus calculation.
  const p = plan({
    baseline: SERVER,
    next: SERVER,
    server: { ...SERVER, crewSizeAllowance: [{ size: 3, pct: 15 }] },
  });
  assert.equal(p.noop, true);
  assert.deepEqual(p.changed, []);
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
  assert.deepEqual(p.changed, ['salesMaster']);
});

console.log('\nRefusals');
test('an edit that wipes settings back to its coded default is refused', () => {
  // This is the exact shape of a client that fell back to
  // { endOfDayReminder: DEFAULT_EOD_REMINDER } — seven keys gone at once.
  const p = plan({ next: { endOfDayReminder: 'Lock trailers.' } });
  assert.equal(p.refused, 'mass-removal');
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
  assert.equal(p.removedOnServer.length, 2);
});

console.log('\nDegenerate input');
test('null/undefined maps are treated as empty rather than throwing', () => {
  assert.equal(computeKeyedMapUpdate({ server: null, baseline: null, next: null }).noop, true);
  const p = computeKeyedMapUpdate({ server: null, baseline: undefined, next: { capacity: 1 } });
  assert.deepEqual(p.changed, ['capacity']);
});
test('a key explicitly set to undefined is not treated as present', () => {
  const p = plan({ next: { ...SERVER, capacity: undefined } });
  assert.deepEqual(p.removed, ['capacity']);
  assert.deepEqual(p.changed, []);
});

console.log('\nThe other two maps this serves');
const VISIT_A = 'Z2lkOi8vSm9iYmVyL1Zpc2l0LzIxODIwNTI5Mzg=';   // base64, ends in '='
const VISIT_B = 'Z2lkOi8vSm9iYmVyL1Zpc2l0LzIxOTEzMjYwNTA=';
const SPLITS = {
  [VISIT_A]: { totalBH: 2.2, splitMethod: 'auto', splits: [{ crewId: 'crew-1', bh: 1.1 }] },
  [VISIT_B]: { totalBH: 5.6, splitMethod: 'auto', splits: [{ crewId: 'crew-2', bh: 5.6 }] },
};

test('splitting one visit does not rewrite another', () => {
  const p = computeKeyedMapUpdate({
    server: SPLITS,
    baseline: SPLITS,
    next: { ...SPLITS, [VISIT_A]: { ...SPLITS[VISIT_A], splitMethod: 'manual' } },
  });
  assert.deepEqual(p.changed, [VISIT_A]);
  assert.ok(!p.changed.includes(VISIT_B));
});
test('a manual split survives a stale client saving something else', () => {
  // The manager split visit A by hand. Another client, holding the pre-split
  // map, logs a repair. BH attribution is pay, so this must not revert.
  const serverMoved = { ...SPLITS, [VISIT_A]: { ...SPLITS[VISIT_A], splitMethod: 'manual' } };
  const p = computeKeyedMapUpdate({ server: serverMoved, baseline: SPLITS, next: SPLITS });
  assert.equal(p.noop, true);
  assert.equal(
    applyKeyedMapUpdate(serverMoved, SPLITS, p)[VISIT_A],
    serverMoved[VISIT_A],
    'the manual split is untouched',
  );
});
test('base64 visit ids are returned literally, never as a path fragment', () => {
  // These end in '=' and would not survive being parsed as a dotted path —
  // which is why the caller pairs them with FieldPath instead.
  const p = computeKeyedMapUpdate({ server: {}, baseline: {}, next: SPLITS });
  assert.deepEqual(p.changed.sort(), [VISIT_A, VISIT_B].sort());
  for (const k of p.changed) assert.ok(k.includes('='), 'the key is passed through untouched');
});
test('the nightly rebuild may bulk-remove when told it is allowed to', () => {
  // syncPerformance legitimately drops entries for visits that stopped being
  // multi-crew. The refusal is for stale CLIENTS, not for that rebuild.
  const p = computeKeyedMapUpdate({
    server: SPLITS, baseline: SPLITS, next: {}, allowBulkRemoval: true,
  });
  assert.equal(p.refused, undefined);
  assert.equal(p.removedOnServer.length, 2);
});

const CHUNKS = {
  'chunk-1780585036648-k2bxi-0': { mechanicId: 'e-1', status: 'closed', paidAt: 1783381773541 },
  'chunk-1780593173660-cd60e': { mechanicId: 'e-1', status: 'closed' },
  'chunk-1782768638995-wc3tr-0': { mechanicId: 'e-1', status: 'open' },
};
test('marking one chunk paid leaves the others alone', () => {
  const p = computeKeyedMapUpdate({
    server: CHUNKS,
    baseline: CHUNKS,
    next: { ...CHUNKS, 'chunk-1780593173660-cd60e': { mechanicId: 'e-1', status: 'closed', paidAt: 9 } },
  });
  assert.deepEqual(p.changed, ['chunk-1780593173660-cd60e']);
});
test('unmarking paid drops the stamp keys, because the whole record is replaced', () => {
  // onUnmarkChunkPaid rebuilds the chunk without paidAt/paidBy/paidByName.
  // Writing the record at its own field path replaces it, so those are gone —
  // no deleteField needed at the record level.
  const id = 'chunk-1780585036648-k2bxi-0';
  const { paidAt, ...unpaid } = CHUNKS[id] as Record<string, unknown>;
  const p = computeKeyedMapUpdate({
    server: CHUNKS, baseline: CHUNKS, next: { ...CHUNKS, [id]: unpaid },
  });
  assert.deepEqual(p.changed, [id]);
  const after = applyKeyedMapUpdate(CHUNKS, { ...CHUNKS, [id]: unpaid }, p);
  assert.ok(!('paidAt' in (after[id] as object)), 'the paid stamp is gone');
});
test("a stale client cannot un-pay a chunk somebody just paid", () => {
  const id = 'chunk-1780593173660-cd60e';
  const serverMoved = { ...CHUNKS, [id]: { ...CHUNKS[id], paidAt: 999 } };
  const p = computeKeyedMapUpdate({ server: serverMoved, baseline: CHUNKS, next: CHUNKS });
  assert.equal(p.noop, true);
  assert.equal((applyKeyedMapUpdate(serverMoved, CHUNKS, p)[id] as any).paidAt, 999);
});
test('an empty key is refused rather than failing opaquely inside the SDK', () => {
  const p = computeKeyedMapUpdate({ server: CHUNKS, baseline: CHUNKS, next: { ...CHUNKS, '': {} } });
  assert.equal(p.refused, 'unusable-key');
  assert.deepEqual(p.unusableKeys, ['']);
});

console.log('\nKeeping the tracking ref in step');
test('applyKeyedMapUpdate moves only the changed keys', () => {
  const next = { ...SPLITS, [VISIT_A]: { totalBH: 3 } };
  const p = computeKeyedMapUpdate({ server: SPLITS, baseline: SPLITS, next });
  const after = applyKeyedMapUpdate(SPLITS, next, p);
  assert.deepEqual(after[VISIT_A], { totalBH: 3 });
  assert.equal(after[VISIT_B], SPLITS[VISIT_B], 'untouched by identity, not just by value');
});

// SnowMaster contract — defaults, derived values, renewal.
//   npx tsx src/lib/snowContracts.test.ts
import assert from 'node:assert/strict';
import {
  seasonFor, termFor, prepayDeadlineFor, instalmentAmount, prepayTotal,
  optionBTotal, withDerived, newContract, duplicateForNextSeason, headlinePrice,
} from './snowContracts';

let pass = 0, fail = 0;
const test = (n: string, fn: () => void) => {
  try { fn(); pass++; console.log(`  ✓ ${n}`); }
  catch (e) { fail++; console.error(`  ✗ ${n}\n      ${(e as Error).message}`); }
};

console.log('\nSeason');
test('August onward is the UPCOMING season', () => {
  assert.equal(seasonFor(new Date('2026-08-07T12:00:00')), '2026/2027');
  assert.equal(seasonFor(new Date('2026-12-31T12:00:00')), '2026/2027');
});
test('before August is still the season in progress', () => {
  assert.equal(seasonFor(new Date('2027-02-01T12:00:00')), '2026/2027');
  assert.equal(seasonFor(new Date('2026-07-31T12:00:00')), '2025/2026');
});
test('term runs Nov 1 to Apr 15 of the following year', () => {
  assert.deepEqual(termFor('2026/2027'), { start: '2026-11-01', end: '2027-04-15' });
});
test('prepay deadline is Oct 15 of the term start year', () => {
  assert.equal(prepayDeadlineFor('2026/2027'), '2026-10-15');
});

console.log('\nDerived values');
test('instalment = total / 6, to the cent', () => {
  assert.equal(instalmentAmount(12000), 2000);
  assert.equal(instalmentAmount(10000), 1666.67);
});
test('prepay total = total less 5%', () => {
  assert.equal(prepayTotal(12000), 11400);
  assert.equal(prepayTotal(9999), 9499.05);
});
test('Option B per-visit total is the sum of its lines', () => {
  assert.equal(optionBTotal([{ label: 'Plow', amount: 250 }, { label: 'Walkways', amount: 85.5 }]), 335.5);
  assert.equal(optionBTotal([]), 0);
  assert.equal(optionBTotal(undefined), 0);
});
test('withDerived recomputes all three from the inputs around them', () => {
  const c = newContract({ id: 'c1', createdBy: 'u', now: Date.parse('2026-08-07T12:00:00Z') });
  c.pricing.optionA.totalPrice = 18000;
  c.pricing.optionB.lines = [{ label: 'Plow', amount: 300 }, { label: 'Salt', amount: 120 }];
  const d = withDerived(c);
  assert.equal(d.pricing.optionA.instalmentAmount, 3000);
  assert.equal(d.pricing.optionA.prepayTotal, 17100);
  assert.equal(d.pricing.optionB.totalPerVisit, 420);
});
test('a stale derived figure cannot survive a recompute', () => {
  const c = newContract({ id: 'c2', createdBy: 'u' });
  c.pricing.optionA.totalPrice = 6000;
  c.pricing.optionA.instalmentAmount = 99999;    // as if hand-edited
  assert.equal(withDerived(c).pricing.optionA.instalmentAmount, 1000);
});

console.log('\nNew contract defaults');
const fresh = newContract({ id: 'n1', createdBy: 'marco', now: Date.parse('2026-08-07T12:00:00Z') });
test('season, term and prepay deadline are set together', () => {
  assert.equal(fresh.season, '2026/2027');
  assert.deepEqual(fresh.term, { start: '2026-11-01', end: '2027-04-15' });
  assert.equal(fresh.pricing.optionA.prepayDeadline, '2026-10-15');
});
test('the seven standard services default to EXCLUDED', () => {
  assert.equal(fresh.services.length, 7);
  assert.equal(fresh.services.every(s => s.status === 'excluded'), true,
    'a contract must never imply a service nobody agreed to');
  assert.deepEqual(fresh.services.map(s => s.key), [
    'plowing', 'shovelling', 'sanding', 'salting', 'iceManagement', 'relocation', 'haulAway',
  ]);
});
test('relocation and haul-away carry their not-included note', () => {
  for (const k of ['relocation', 'haulAway']) {
    assert.match(fresh.services.find(s => s.key === k)!.notes, /Not included/);
  }
});
test('add-ons, trigger and response match the stated defaults', () => {
  assert.equal(fresh.pricing.addOns.sandPerTon, 120);
  assert.equal(fresh.pricing.addOns.sandLoadingFee, 200);
  assert.equal(fresh.serviceTerms.triggerDepth, '2" accumulation');
  assert.equal(fresh.serviceTerms.priorityTier, 'standard');
  assert.equal(fresh.serviceTerms.clearedBefore, '6:00');
  assert.equal(fresh.serviceTerms.snowfallEndsBy, '4:00');
  assert.equal(fresh.serviceTerms.otherwiseWithinHours, '6');
});
test('both pricing options start enabled, prepay discount on at 5%', () => {
  assert.equal(fresh.pricing.optionA.enabled, true);
  assert.equal(fresh.pricing.optionB.enabled, true);
  assert.equal(fresh.pricing.optionA.prepayDiscountEnabled, true);
  assert.equal(fresh.pricing.optionA.prepayDiscountPct, 5);
  assert.equal(fresh.pricing.optionA.instalments, 6);
});
test('a new contract starts as a draft with nothing hidden', () => {
  assert.equal(fresh.status, 'draft');
  assert.deepEqual(fresh.hiddenSections, []);
  assert.equal(fresh.scope.showMap, true);
});

console.log('\nRenewal');
const signed = (() => {
  const c = newContract({ id: 'old', createdBy: 'marco', now: Date.parse('2026-08-07T12:00:00Z') });
  c.status = 'signed';
  c.signedAt = 123;
  c.signedBy = 'Marco';
  c.sentAt = 100;
  c.client = { businessName: 'Acme', siteContact: 'Pat', serviceAddress: '1 Main St', billingEmail: 'a@b.c', phone: '555' };
  c.scope.description = 'Front lot and loading dock.';
  c.scope.mapImages = ['https://storage/x.png'];
  c.scope.measuredSqft = 41200;
  c.scope.totalArea = '41,200 sq ft';
  c.services[0].status = 'included';
  c.pricing.selectedOption = 'A';
  c.pricing.optionA.totalPrice = 24000;
  c.pricing.optionB.lines = [{ label: 'Plow', amount: 300 }];
  return withDerived(c);
})();
const renewed = duplicateForNextSeason(signed, { id: 'new', createdBy: 'james', now: Date.parse('2027-08-01T12:00:00Z') });

test('rolls the season and term forward one year', () => {
  assert.equal(renewed.season, '2027/2028');
  assert.deepEqual(renewed.term, { start: '2027-11-01', end: '2028-04-15' });
  assert.equal(renewed.pricing.optionA.prepayDeadline, '2027-10-15');
});
test('carries client, scope (map and measurement), services and terms', () => {
  assert.equal(renewed.client.businessName, 'Acme');
  assert.equal(renewed.scope.description, 'Front lot and loading dock.');
  assert.deepEqual(renewed.scope.mapImages, ['https://storage/x.png']);
  assert.equal(renewed.scope.measuredSqft, 41200);
  assert.equal(renewed.services[0].status, 'included');
  assert.equal(renewed.serviceTerms.triggerDepth, '2" accumulation');
});
test('CLEARS pricing, status and the timestamps that recorded it', () => {
  assert.equal(renewed.status, 'draft');
  assert.equal(renewed.signedAt, undefined);
  assert.equal(renewed.signedBy, undefined);
  assert.equal(renewed.sentAt, undefined);
  assert.equal(renewed.pricing.selectedOption, null);
  assert.equal(renewed.pricing.optionA.totalPrice, 0);
  assert.equal(renewed.pricing.optionA.instalmentAmount, 0);
  assert.equal(renewed.pricing.optionA.prepayTotal, 0);
  assert.equal(renewed.pricing.optionB.totalPerVisit, 0);
});
test('keeps Option B line LABELS but zeroes their amounts', () => {
  assert.deepEqual(renewed.pricing.optionB.lines, [{ label: 'Plow', amount: 0 }]);
});
test('the source contract is not mutated by duplicating it', () => {
  assert.equal(signed.pricing.optionA.totalPrice, 24000);
  assert.equal(signed.status, 'signed');
});

console.log('\nList headline price');
test('follows the selected option', () => {
  assert.deepEqual(headlinePrice(signed), { amount: 24000, kind: 'seasonal' });
});
test('falls back to whichever option carries a figure', () => {
  const c = newContract({ id: 'x', createdBy: 'u' });
  c.pricing.optionB.lines = [{ label: 'Plow', amount: 275 }];
  const d = withDerived(c);
  assert.deepEqual(headlinePrice(d), { amount: 275, kind: 'perVisit' });
});
test('an unpriced contract reports no headline rather than a zero', () => {
  assert.deepEqual(headlinePrice(newContract({ id: 'y', createdBy: 'u' })), { amount: 0, kind: null });
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

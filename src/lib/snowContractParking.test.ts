// THE PARKING GUARANTEE.
//   npm test -- snowContractParking
//
// The in-app editor is unmounted and the simplified record view edits only
// five fields. Everything the editor used to own — service level, the pricing
// grid, scope, the site map and photo, term dates, insurance amount, trigger
// depth and the response-hour figures — is PARKED: still stored, still
// migrated, and never touched by a save from the simplified view.
//
// That claim is only worth anything if it is tested, because the failure is
// silent: a contract entered last season would quietly lose its pricing the
// first time someone changed its status from the list, and nobody would see it
// until they went looking for a number that was no longer there.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { newContract, migrateContract } from './snowContracts';
import { applyFields, fieldsOf } from '../components/SnowContractSimple';
import type { SnowContract } from '../types';

const NOW = Date.parse('2026-08-07T12:00:00Z');

// A contract as the old editor would have left it — every detailed field set.
function detailed(): SnowContract {
  const c = newContract({ id: 'c1', createdBy: 'marco', now: NOW, season: '2026/2027' });
  c.serviceLevel = 2;
  c.pricing.levels[1] = { seasonal: 9000, perVisit: 210 };
  c.pricing.levels[2] = { seasonal: 24000, perVisit: 300 };
  c.pricing.levels[3] = { seasonal: 31000, perVisit: 420 };
  c.pricing.selectedOption = 'A';
  c.pricing.optionAPayment = 'instalments';
  c.pricing.prepayDeadline = '2026-10-15';
  c.scope.plowArea = 'Main lot, rear dock';
  c.scope.shovelArea = 'Front apron, ramp';
  c.scope.sitePhoto = 'https://example.test/photo.jpg';
  c.scope.sitePhotoView = { zoom: 1.4, x: 0, y: -22.5, fit: false };
  c.scope.mapImages = ['https://example.test/map1.png'];
  c.scope.measuredSqft = 41200;
  c.serviceTerms.triggerDepth = '2" accumulation';
  c.serviceTerms.overnightCutoff = '2:00';
  c.serviceTerms.overnightClearBy = '8:00';
  c.serviceTerms.daytimeHours = '24';
  c.serviceTerms.nonPriorityHours = '48';
  c.insurance.cglAmount = '5,000,000';
  c.term = { start: '2026-11-01', end: '2027-04-30' };
  c.hiddenSections = ['damage'];
  c.legacyPricing = { seasonalTotal: 21000, perVisitTotal: 280 };
  return c;
}

// Everything the simplified view must leave alone, as one comparable value.
const parked = (c: SnowContract) => JSON.stringify({
  serviceLevel: c.serviceLevel,
  pricing: c.pricing,
  scope: c.scope,
  insurance: c.insurance,
  term: c.term,
  hiddenSections: c.hiddenSections,
  legacyPricing: c.legacyPricing,
  // serviceWindow is the ONE serviceTerms key the simplified view owns; the
  // rest of the block is parked with everything else.
  serviceTerms: { ...c.serviceTerms, serviceWindow: undefined },
});

test('editing the five simple fields changes nothing else on the record', () => {
  const before = detailed();
  const snapshot = parked(before);
  const after = applyFields(before, {
    businessName: 'Northbridge Plaza',
    serviceAddress: '1175 Rosslyn Road',
    crew: 'Tony, Tom, Al',
    serviceWindow: 'overnight',
    status: 'booked',
  }, 'Marco');
  assert.equal(parked(after), snapshot, 'a detailed field was modified by the simplified save');
  // And the five it DOES own actually changed.
  assert.equal(after.client.businessName, 'Northbridge Plaza');
  assert.equal(after.client.serviceAddress, '1175 Rosslyn Road');
  assert.equal(after.crew, 'Tony, Tom, Al');
  assert.equal(after.serviceTerms.serviceWindow, 'overnight');
  assert.equal(after.status, 'booked');
});

test('a round trip through the simplified view is lossless', () => {
  const before = detailed();
  const after = applyFields(before, fieldsOf(before), 'Marco');
  assert.equal(parked(after), parked(before));
  assert.equal(after.serviceTerms.serviceWindow, before.serviceTerms.serviceWindow);
});

test('the detailed fields still survive migration, so the editor could be remounted', () => {
  const before = detailed();
  const after = migrateContract(JSON.parse(JSON.stringify(before)));
  assert.equal(after.serviceLevel, 2);
  assert.equal(after.pricing.levels[2].seasonal, 24000);
  assert.equal(after.scope.plowArea, 'Main lot, rear dock');
  assert.equal(after.scope.measuredSqft, 41200);
  assert.equal(after.serviceTerms.triggerDepth, '2" accumulation');
  assert.equal(after.insurance.cglAmount, '5,000,000');
  assert.deepEqual(after.term, { start: '2026-11-01', end: '2027-04-30' });
  assert.deepEqual(after.hiddenSections, ['damage']);
});

test('status stamps still land when the status is set from the simplified view', () => {
  const c = detailed();
  const sent = applyFields(c, { ...fieldsOf(c), status: 'sent' }, 'Marco');
  assert.ok(sent.sentAt);
  assert.equal(sent.sentBy, 'Marco');
  // Straight to booked backfills approval, same rule as before.
  const booked = applyFields(c, { ...fieldsOf(c), status: 'booked' }, 'Marco');
  assert.ok(booked.bookedAt);
  assert.ok(booked.approvedAt, 'booked must imply approved');
  // An existing stamp is never overwritten by a later move.
  const already = applyFields({ ...c, sentAt: 111, sentBy: 'Jane' }, { ...fieldsOf(c), status: 'sent' }, 'Marco');
  assert.equal(already.sentAt, 111);
  assert.equal(already.sentBy, 'Jane');
});

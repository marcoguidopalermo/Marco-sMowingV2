// SnowMaster contract — defaults, derived values, migration, renewal.
//   npx tsx src/lib/snowContracts.test.ts
import assert from 'node:assert/strict';
import {
  seasonFor, termFor, prepayDeadlineFor, validUntilFrom, instalmentAmount, prepayTotal,
  calledInRate, selectedPrice, withDerived, newContract, migrateContract, needsRequote,
  duplicateForNextSeason, headlinePrice, DEFAULT_CGL,
  photoView, photoStyle, photoSlackPx, clampPhotoView,
} from './snowContracts';

let pass = 0, fail = 0;
const test = (n: string, fn: () => void) => {
  try { fn(); pass++; console.log(`  ✓ ${n}`); }
  catch (e) { fail++; console.error(`  ✗ ${n}\n      ${(e as Error).message}`); }
};

const NOW = Date.parse('2026-08-07T12:00:00Z');
const fresh = () => newContract({ id: 'c1', createdBy: 'marco', now: NOW, season: '2026/2027' });

console.log('\nSeason and dates');
test('August onward is the UPCOMING season', () => {
  assert.equal(seasonFor(new Date('2026-08-07T12:00:00')), '2026/2027');
  assert.equal(seasonFor(new Date('2026-12-31T12:00:00')), '2026/2027');
});
test('before August is still the season in progress', () => {
  assert.equal(seasonFor(new Date('2027-02-01T12:00:00')), '2026/2027');
  assert.equal(seasonFor(new Date('2026-07-31T12:00:00')), '2025/2026');
});
test('term runs Nov 1 to Apr 30 of the following year', () => {
  assert.deepEqual(termFor('2026/2027'), { start: '2026-11-01', end: '2027-04-30' });
});
test('prepay deadline is Oct 15 of the term start year', () => {
  assert.equal(prepayDeadlineFor('2026/2027'), '2026-10-15');
});
test('a quote is valid for 30 days from its date', () => {
  assert.equal(validUntilFrom('2026-08-07'), '2026-09-06');
  // Across a month end, and across a year end.
  assert.equal(validUntilFrom('2026-12-20'), '2027-01-19');
});

console.log('\nNew contract defaults');
test('no service level and no option — a contract states nothing nobody chose', () => {
  const c = fresh();
  assert.equal(c.serviceLevel, null);
  assert.equal(c.pricing.selectedOption, null);
  assert.equal(c.pricing.optionAPayment, null);
  assert.equal(c.serviceTerms.serviceWindow, null);
});
test('all three levels start unpriced, both ways', () => {
  const c = fresh();
  for (const n of [1, 2, 3] as const) {
    assert.equal(c.pricing.levels[n].seasonal, 0);
    assert.equal(c.pricing.levels[n].perVisit, 0);
  }
});
test('the header dates are set together', () => {
  const c = fresh();
  assert.equal(c.quoteDate, '2026-08-07');
  assert.equal(c.validUntil, validUntilFrom('2026-08-07'));
});
test('trigger, response windows and CGL carry the reference defaults', () => {
  const c = fresh();
  assert.equal(c.serviceTerms.triggerDepth, '2" accumulation');
  assert.equal(c.serviceTerms.overnightCutoff, '2:00');
  assert.equal(c.serviceTerms.overnightClearBy, '8:00');
  assert.equal(c.serviceTerms.daytimeHours, '24');
  assert.equal(c.serviceTerms.nonPriorityHours, '48');
  assert.equal(c.insurance.cglAmount, DEFAULT_CGL);
});

console.log('\nDerived values (shown in the editor, never printed)');
test('instalment = seasonal / 6, to the cent', () => {
  assert.equal(instalmentAmount(12000), 2000);
  assert.equal(instalmentAmount(10000), 1666.67);
});
test('paid in full = seasonal less 5%', () => {
  assert.equal(prepayTotal(12000), 11400);
  assert.equal(prepayTotal(9999), 9499.05);
});
test('called-in sanding is 50% of the LEVEL 2 per-visit rate, whatever level is selected', () => {
  const c = fresh();
  c.pricing.levels[2].perVisit = 300;
  c.pricing.levels[3].perVisit = 420;
  c.serviceLevel = 3;
  assert.equal(calledInRate(c), 150);
});
test('Level 1 has no called-in rate — no ice control at all, not even on call', () => {
  const c = fresh();
  c.pricing.levels[2].perVisit = 300;
  c.serviceLevel = 1;
  assert.equal(calledInRate(c), null);
});
test('selectedPrice follows the chosen level', () => {
  const c = fresh();
  c.pricing.levels[2] = { seasonal: 24000, perVisit: 300 };
  c.serviceLevel = 2;
  assert.deepEqual(selectedPrice(c), { seasonal: 24000, perVisit: 300 });
  c.serviceLevel = null;
  assert.equal(selectedPrice(c), null);
});
test('withDerived rounds prices to the cent', () => {
  const c = fresh();
  c.pricing.levels[1].seasonal = 1200.005;
  assert.equal(withDerived(c).pricing.levels[1].seasonal, 1200.01);
});

console.log('\nSite photo framing');
// A 4:3 photo in the 720×190 banner: the height overflows enormously, the
// width exactly covers. That asymmetry is the whole reason panning exists.
const BOX = { w: 720, h: 190 };
const NAT = { w: 1200, h: 900 };
test('a fresh contract has no stored framing, and reads as centred and filling', () => {
  const c = fresh();
  assert.equal(c.scope.sitePhotoView, undefined);
  assert.deepEqual(photoView(c), { zoom: 1, x: 0, y: 0, fit: false });
});
test('the style is cover + a position within the photo, not an element offset', () => {
  // The distinction matters: an element offset can be dragged off its frame,
  // a position within a covering image cannot. See photoStyle.
  assert.deepEqual(photoStyle({ zoom: 1, x: 0, y: 0 }), {
    objectFit: 'cover', objectPosition: '50% 50%', transform: 'scale(1)',
  });
  assert.deepEqual(photoStyle({ zoom: 1.3, x: -12.5, y: 40, fit: false }), {
    objectFit: 'cover', objectPosition: '37.5% 90%', transform: 'scale(1.3)',
  });
});
test('“show whole photo” switches to contain', () => {
  assert.equal(photoStyle({ zoom: 1, x: 0, y: 0, fit: true }).objectFit, 'contain');
});
test('a tall photo overflows the banner vertically, and that is what pans', () => {
  // Cover scale = max(720/1200, 190/900) = 0.6 → drawn 720×540 in a 190-tall
  // box: nothing hidden horizontally, 350px hidden vertically.
  assert.deepEqual(photoSlackPx(BOX, NAT), { x: 0, y: 350 });
});
test('no photo measured yet means no slack, and no NaN in the style', () => {
  assert.deepEqual(photoSlackPx({ w: 0, h: 0 }, NAT), { x: 0, y: 0 });
  assert.equal(photoStyle({ zoom: NaN, x: NaN, y: 0 }).objectPosition, '50% 50%');
});
test('the crop cannot be positioned outside the photo — ±50 is its edge', () => {
  assert.equal(clampPhotoView({ zoom: 1, x: 400, y: -999 }).x, 50);
  assert.equal(clampPhotoView({ zoom: 1, x: 400, y: -999 }).y, -50);
});
test('zoom below 1 is refused: a shrunk cover image stops covering', () => {
  assert.equal(clampPhotoView({ zoom: 0.2, x: 0, y: 0 }).zoom, 1);
  assert.equal(clampPhotoView({ zoom: 99, x: 0, y: 0 }).zoom, 4);
  assert.equal(clampPhotoView({ zoom: 1.23456, x: 0, y: 0 }).zoom, 1.23);
});
test('framing survives a renewal — same property, same photo, same crop', () => {
  const src = fresh();
  src.scope.sitePhoto = 'https://example/photo.jpg';
  src.scope.sitePhotoView = { zoom: 1.4, x: 0, y: -22.5, fit: false };
  const next = duplicateForNextSeason(src, { id: 'c2', createdBy: 'marco', now: NOW });
  assert.deepEqual(next.scope.sitePhotoView, { zoom: 1.4, x: 0, y: -22.5, fit: false });
});

console.log('\nMigration from the pre-service-level shape');
const legacy = {
  id: 'old-1', season: '2025/2026', status: 'signed',
  createdAt: Date.parse('2025-09-01T12:00:00Z'), updatedAt: Date.parse('2025-09-02T12:00:00Z'),
  createdBy: 'marco',
  client: {
    businessName: 'Northbridge', siteContact: 'Pat Lindgren',
    serviceAddress: '1175 Rosslyn Road', billingEmail: 'ap@nb.example', phone: '(807) 555-0142',
  },
  term: { start: '2025-11-01', end: '2026-04-15' },
  scope: {
    totalArea: '41,200 sq ft', lotAreas: 'Main lot, rear dock',
    walkwaysEntrances: 'Front apron, ramp', snowStorage: 'NW corner',
    markedHazards: 'Hydrants', accessNotes: 'Rear gate keyed',
    description: 'Long prose', showMap: true, mapImages: [],
  },
  services: [{ key: 'plowing', label: 'Plowing', detail: '', status: 'included', notes: '', custom: false }],
  pricing: {
    selectedOption: 'A',
    optionA: { enabled: true, totalPrice: 24000, instalmentAmount: 4000, prepayDeadline: '2025-10-15', prepayTotal: 22800 },
    optionB: { enabled: true, lines: [{ label: 'Plowing', amount: 300 }], totalPerVisit: 300 },
    addOns: { sandPerTon: 120, sandLoadingFee: 200, relocation: 'x', haulAway: 'y', afterHours: '' },
  },
  serviceTerms: { triggerDepth: '2" accumulation', priorityTier: 'priority', clearedBefore: '6:00', snowfallEndsBy: '4:00', otherwiseWithinHours: '6' },
  hiddenSections: ['addons', 'damage'],
};

test('REFUSES to guess a service level, and clears the prices with it', () => {
  const c = migrateContract(legacy);
  assert.equal(c.serviceLevel, null);
  assert.equal(c.pricing.selectedOption, null);
  assert.equal(c.pricing.levels[2].seasonal, 0);
  assert.equal(c.pricing.levels[2].perVisit, 0);
});
test('keeps the old figures in legacyPricing so a renewal can still see them', () => {
  const c = migrateContract(legacy);
  assert.deepEqual(c.legacyPricing, { seasonalTotal: 24000, perVisitTotal: 300 });
  assert.equal(needsRequote(c), true);
});
test('lot and walkway descriptions become the plow and shovel fields', () => {
  const c = migrateContract(legacy);
  assert.equal(c.scope.plowArea, 'Main lot, rear dock');
  assert.equal(c.scope.shovelArea, 'Front apron, ramp');
});
test('nothing described on the old scope table is thrown away', () => {
  const c = migrateContract(legacy);
  assert.equal(c.scope.snowStorage, 'NW corner');
  assert.equal(c.scope.markedHazards, 'Hydrants');
  assert.equal(c.scope.accessNotes, 'Rear gate keyed');
  assert.equal(c.scope.description, 'Long prose');
  assert.equal(c.scope.totalArea, '41,200 sq ft');
});
test('the phone joins the site contact rather than being dropped', () => {
  const c = migrateContract(legacy);
  assert.equal(c.client.siteContact, 'Pat Lindgren · (807) 555-0142');
});
test('a contact that already carries the number is not doubled up', () => {
  const c = migrateContract({
    ...legacy,
    client: { ...legacy.client, siteContact: 'Pat Lindgren (807) 555-0142' },
  });
  assert.equal(c.client.siteContact, 'Pat Lindgren (807) 555-0142');
});
test('priority tier maps to the overnight window, standard to daytime', () => {
  assert.equal(migrateContract(legacy).serviceTerms.serviceWindow, 'overnight');
  const std = migrateContract({ ...legacy, serviceTerms: { ...legacy.serviceTerms, priorityTier: 'standard' } });
  assert.equal(std.serviceTerms.serviceWindow, 'daytime');
});
test('hidden sections survive; the section that no longer exists is dropped', () => {
  const c = migrateContract(legacy);
  assert.deepEqual(c.hiddenSections, ['damage']);
});
test('signed status and its stamps are untouched — migration is not an edit', () => {
  const c = migrateContract(legacy);
  assert.equal(c.status, 'signed');
  assert.equal(c.createdAt, legacy.createdAt);
});
test('a CURRENT contract passes through unchanged, and gains any newer field', () => {
  const c = fresh();
  const again = migrateContract(JSON.parse(JSON.stringify(c)));
  assert.equal(again.serviceLevel, null);
  assert.equal(again.quoteDate, c.quoteDate);
  assert.equal(again.insurance.cglAmount, DEFAULT_CGL);
  assert.equal(needsRequote(again), false);
});
test('a current contract written before insurance existed gets the default', () => {
  const c: any = fresh();
  delete c.insurance;
  assert.equal(migrateContract(c).insurance.cglAmount, DEFAULT_CGL);
});

console.log('\nRenewal');
test('carries the property, the level and the terms', () => {
  const src = fresh();
  src.serviceLevel = 2;
  src.scope.plowArea = 'Main lot';
  src.serviceTerms.serviceWindow = 'overnight';
  const next = duplicateForNextSeason(src, { id: 'c2', createdBy: 'marco', now: NOW });
  assert.equal(next.season, '2027/2028');
  assert.equal(next.serviceLevel, 2);
  assert.equal(next.scope.plowArea, 'Main lot');
  assert.equal(next.serviceTerms.serviceWindow, 'overnight');
});
test('CLEARS every price, the option and the status stamps', () => {
  const src = fresh();
  src.serviceLevel = 2;
  src.pricing.levels[2] = { seasonal: 24000, perVisit: 300 };
  src.pricing.selectedOption = 'A';
  src.pricing.optionAPayment = 'instalments';
  src.status = 'signed';
  src.signedAt = NOW;
  const next = duplicateForNextSeason(src, { id: 'c2', createdBy: 'marco', now: NOW });
  assert.equal(next.pricing.levels[2].seasonal, 0);
  assert.equal(next.pricing.selectedOption, null);
  assert.equal(next.pricing.optionAPayment, null);
  assert.equal(next.status, 'draft');
  assert.equal(next.signedAt, undefined);
});
test('last season’s figures ride along for reference only', () => {
  const src = fresh();
  src.serviceLevel = 2;
  src.pricing.levels[2] = { seasonal: 24000, perVisit: 300 };
  const next = duplicateForNextSeason(src, { id: 'c2', createdBy: 'marco', now: NOW });
  assert.deepEqual(next.legacyPricing, { seasonalTotal: 24000, perVisitTotal: 300 });
});
test('the source contract is not mutated by duplicating it', () => {
  const src = fresh();
  src.pricing.levels[1].seasonal = 9000;
  duplicateForNextSeason(src, { id: 'c2', createdBy: 'marco', now: NOW });
  assert.equal(src.pricing.levels[1].seasonal, 9000);
});

console.log('\nList headline price');
test('follows the selected level AND option', () => {
  const c = fresh();
  c.pricing.levels[3] = { seasonal: 31000, perVisit: 410 };
  c.serviceLevel = 3;
  c.pricing.selectedOption = 'B';
  assert.deepEqual(headlinePrice(c), { amount: 410, kind: 'perVisit' });
  c.pricing.selectedOption = 'A';
  assert.deepEqual(headlinePrice(c), { amount: 31000, kind: 'seasonal' });
});
test('a level with no option shows whichever side is quoted, seasonal first', () => {
  const c = fresh();
  c.pricing.levels[1] = { seasonal: 0, perVisit: 250 };
  c.serviceLevel = 1;
  assert.deepEqual(headlinePrice(c), { amount: 250, kind: 'perVisit' });
});
test('no level chosen means no headline, however the levels are priced', () => {
  const c = fresh();
  c.pricing.levels[2] = { seasonal: 24000, perVisit: 300 };
  assert.deepEqual(headlinePrice(c), { amount: 0, kind: null });
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

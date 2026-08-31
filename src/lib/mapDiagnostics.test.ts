// Reading the evidence off a map that did not appear.
//   npm test -- mapDiagnostics
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mapVerdict, VERDICT_TEXT, type MapDiag } from './mapDiagnostics';

const diag = (o: Partial<MapDiag> = {}): MapDiag => ({
  containerW: 800, containerH: 600, gmChildren: 3, hasGmStyle: true,
  display: 'block', visibility: 'visible', opacity: '1',
  mapTypeId: 'hybrid', zoom: 19, center: { lat: 48.4, lng: -89.2 },
  hasBounds: true, tilesLoaded: true, idleFired: true, ...o,
});

console.log('\nEach cause is distinguishable from the others');
test('a working map reads as ok', () => {
  assert.equal(mapVerdict(diag()), 'ok');
});
test('a zero-size container is named as such', () => {
  assert.equal(mapVerdict(diag({ containerH: 0 })), 'container-zero-size');
  assert.equal(mapVerdict(diag({ containerW: 0 })), 'container-zero-size');
});
test('THE SHARP ONE: no .gm-style means the constructor did nothing', () => {
  // Rules out tiles, billing and imagery in one step — Google never built it.
  const v = mapVerdict(diag({ hasGmStyle: false, gmChildren: 0 }));
  assert.equal(v, 'constructor-did-nothing');
  assert.match(VERDICT_TEXT[v], /gm_authFailure/);
  assert.match(VERDICT_TEXT[v], /BillingNotEnabledMapError/);
});
test('DOM built but no tiles is a different fault from no DOM at all', () => {
  assert.equal(mapVerdict(diag({ tilesLoaded: false })), 'built-but-no-tiles');
  assert.match(VERDICT_TEXT['built-but-no-tiles'], /Network tab/);
});

console.log('\nThe most fundamental cause wins');
test('a hidden container outranks everything below it', () => {
  // No point reporting missing tiles for a display:none box.
  assert.equal(mapVerdict(diag({ display: 'none', tilesLoaded: false, hasGmStyle: false })), 'container-hidden');
  assert.equal(mapVerdict(diag({ visibility: 'hidden' })), 'container-hidden');
  assert.equal(mapVerdict(diag({ opacity: '0' })), 'container-hidden');
});
test('zero size outranks a missing gm-style', () => {
  assert.equal(mapVerdict(diag({ containerH: 0, hasGmStyle: false, gmChildren: 0 })), 'container-zero-size');
});
test('every verdict has text that says what to do next', () => {
  for (const v of Object.keys(VERDICT_TEXT) as (keyof typeof VERDICT_TEXT)[]) {
    assert.ok(VERDICT_TEXT[v].length > 20, v);
  }
});

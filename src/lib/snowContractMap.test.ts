// Contract site-map URL construction.
//   npm test -- snowContractMap
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { encodePath, staticMapUrl, hasMeasurementMap, areaLabel, servicedSqft } from './snowContractMap';

console.log('\nStatic map URL');
test('encodePath matches Google’s documented example', () => {
  // The canonical example from Google's polyline algorithm docs.
  const enc = encodePath([{lat:38.5,lng:-120.2},{lat:40.7,lng:-120.95},{lat:43.252,lng:-126.453}]);
  assert.equal(enc, '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
});
const m = { polygons:[{path:[{lat:48.38,lng:-89.24},{lat:48.381,lng:-89.24},{lat:48.381,lng:-89.239}]}],
            exclusions:[], totalSqft:41200, measuredAt:1 } as any;
test('a measurement with a ring produces a satellite URL with an encoded path', () => {
  const u = staticMapUrl(m)!;
  assert.match(u, /maptype=satellite/);
  assert.match(u, /path=fillcolor:0x16a34a55\|color:0x16a34aff\|weight:2\|enc:/);
  assert.match(u, /scale=2/);
});
test('exclusions draw in red so what is NOT serviced is visible', () => {
  const u = staticMapUrl({...m, exclusions:[{path:[{lat:48.3805,lng:-89.2395},{lat:48.3806,lng:-89.2395},{lat:48.3806,lng:-89.2394}]}]})!;
  assert.match(u, /color:0xdc2626ff/);
});
test('no measurement -> null, so the caller falls back', () => {
  assert.equal(staticMapUrl(undefined), null);
  assert.equal(staticMapUrl({polygons:[],exclusions:[],totalSqft:0,measuredAt:1} as any), null);
  assert.equal(hasMeasurementMap({polygons:[{path:[{lat:1,lng:1}]}],exclusions:[],totalSqft:0,measuredAt:1} as any), false);
});
test('the ring is closed so the fill renders as a polygon', () => {
  const enc = encodePath([{lat:48.38,lng:-89.24},{lat:48.381,lng:-89.24},{lat:48.381,lng:-89.239},{lat:48.38,lng:-89.24}]);
  assert.ok(staticMapUrl(m)!.includes(enc));
});
test('area label seeds Total Serviced Area', () => { assert.equal(areaLabel(41200.4), '41,200 sq ft'); });

console.log('\nSnow service areas');
const ring = (p?: string) => ({
  path:[{lat:48.38,lng:-89.24},{lat:48.381,lng:-89.24},{lat:48.381,lng:-89.239}],
  ...(p ? { purpose: p } : {}),
});
test('a ring draws in ITS purpose colour, the same hex the legend prints', () => {
  const u = staticMapUrl({ polygons:[ring('plow'), ring('shovel')], exclusions:[], totalSqft:1, measuredAt:1 } as any)!;
  assert.match(u, /color:0x2f7fd4ff/);   // plow — SNOW_AREAS
  assert.match(u, /color:0x2fa855ff/);   // shovel
  assert.match(u, /fillcolor:0x2f7fd438/); // 22% fill, as the reference draws it
});
test('a ring with NO purpose still draws as serviced — lawn measuring is untouched', () => {
  const u = staticMapUrl({ polygons:[ring()], exclusions:[], totalSqft:1, measuredAt:1 } as any)!;
  assert.match(u, /color:0x16a34aff/);
});
test('storage and hazard areas are drawn even though they are not serviced', () => {
  const u = staticMapUrl({ polygons:[ring('storage'), ring('hazard')], exclusions:[], totalSqft:0, measuredAt:1 } as any)!;
  assert.match(u, /color:0xe0a52aff/);
  assert.match(u, /color:0xcc3b34ff/);
});
test('a hazard MARKER is a point on the map, and is enough to draw one', () => {
  const m2 = { polygons:[], exclusions:[], totalSqft:0, measuredAt:1,
    markers:[{ at:{lat:48.3812,lng:-89.2391}, purpose:'hazard' }] } as any;
  assert.equal(hasMeasurementMap(m2), true);
  assert.match(staticMapUrl(m2)!, /markers=size:small\|color:0xcc3b34\|48\.381200,-89\.239100/);
});
test('serviced square footage counts plow and shovel, never storage or hazard', () => {
  // Each ring is worth 100 to this stub, so the arithmetic is legible.
  const sq = () => 100;
  const m3 = { polygons:[ring('plow'), ring('shovel'), ring('storage'), ring('hazard')],
    exclusions:[ring()], totalSqft:0, measuredAt:1 } as any;
  assert.equal(servicedSqft(sq, m3), 100);   // 100 + 100 − 100
});

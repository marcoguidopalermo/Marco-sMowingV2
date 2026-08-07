// Contract site-map URL construction.
//   npx tsx src/lib/snowContractMap.test.ts
import assert from 'node:assert/strict';
import { encodePath, staticMapUrl, hasMeasurementMap, areaLabel } from './snowContractMap';
let pass=0, fail=0;
const test=(n:string,fn:()=>void)=>{try{fn();pass++;console.log('  ✓ '+n)}catch(e){fail++;console.error('  ✗ '+n+'\n      '+(e as Error).message)}};
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
console.log('\n'+pass+' passed, '+fail+' failed\n');
if (fail>0) process.exit(1);

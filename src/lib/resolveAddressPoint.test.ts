// Resolving a typed address to a point.
//   npm test -- resolveAddressPoint
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  resolveAddressPoint, serviceAreaBias, unresolvedAddressMessage,
  SERVICE_AREA_RADIUS_M,
} from './resolveAddressPoint';

const TBAY = { lat: 48.3809, lng: -89.2477 };
const host = {} as HTMLElement;

// A stand-in for google.maps that records the request it was given.
const fakeMaps = (opts: { result?: any; status?: string; throws?: boolean } = {}) => {
  const seen: any = {};
  return {
    seen,
    maps: {
      LatLng: class { constructor(public a: number, public b: number) {} },
      places: {
        PlacesServiceStatus: { OK: 'OK' },
        PlacesService: class {
          findPlaceFromQuery(req: any, cb: any) {
            if (opts.throws) throw new Error('boom');
            Object.assign(seen, req);
            cb(opts.result, opts.status ?? 'OK');
          }
        },
      },
    },
  };
};
const pt = (lat: number, lng: number) => [{ geometry: { location: { lat: () => lat, lng: () => lng } } }];

console.log('\nTHE BUG: the query was unbiased, so it could match anywhere');
test('every lookup carries a service-area location bias', async () => {
  const f = fakeMaps({ result: pt(48.4, -89.2) });
  await resolveAddressPoint(f.maps, host, '396 ray boulevard', TBAY);
  assert.ok(f.seen.locationBias, 'an unbiased place search can land in another country');
  assert.equal(f.seen.locationBias.radius, SERVICE_AREA_RADIUS_M);
  assert.equal(f.seen.query, '396 ray boulevard');
});
test('the bias is centred on the service area', () => {
  const f = fakeMaps();
  const b: any = serviceAreaBias(f.maps, TBAY);
  assert.equal(b.center.a, TBAY.lat);
  assert.equal(b.center.b, TBAY.lng);
});
test('a resolved address comes back as a plain point', async () => {
  const f = fakeMaps({ result: pt(48.44, -89.26) });
  assert.deepEqual(await resolveAddressPoint(f.maps, host, '123 Main St', TBAY), { lat: 48.44, lng: -89.26 });
});

console.log('\nUnresolvable means NULL, never a fallback point');
test('a ZERO_RESULTS lookup resolves to null, not a default', async () => {
  const f = fakeMaps({ result: [], status: 'ZERO_RESULTS' });
  assert.equal(await resolveAddressPoint(f.maps, host, '9 Nowhere Cres', TBAY), null);
});
test('an empty or missing address never calls out at all', async () => {
  for (const a of ['', '   ', null, undefined]) {
    assert.equal(await resolveAddressPoint(fakeMaps().maps, host, a, TBAY), null);
  }
});
test('a thrown Places error resolves to null rather than rejecting', async () => {
  const f = fakeMaps({ throws: true });
  assert.equal(await resolveAddressPoint(f.maps, host, '1 Main St', TBAY), null);
});
test('Places missing entirely resolves to null', async () => {
  assert.equal(await resolveAddressPoint({}, host, '1 Main St', TBAY), null);
});
test('a malformed geometry is not treated as a location', async () => {
  const f = fakeMaps({ result: [{ geometry: { location: { lat: () => NaN, lng: () => 1 } } }] });
  assert.equal(await resolveAddressPoint(f.maps, host, '1 Main St', TBAY), null);
});

console.log('\nThe message names the address and the likely cause');
test('it says which address failed, and what to do', () => {
  const m = unresolvedAddressMessage('12 New Subdivision Way');
  assert.match(m, /Could not find “12 New Subdivision Way”/);
  assert.match(m, /new subdivision, or mistyped/);
});
test('no address at all reads differently', () => {
  assert.match(unresolvedAddressMessage('  '), /No address entered yet/);
});

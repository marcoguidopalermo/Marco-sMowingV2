// The loader must load EVERY library the app uses.
//   npm test -- googleMaps
//
// Street View worked only after satellite had been shown, and did nothing on a
// cold open. The cause was here: 'streetView' was never imported, so
// StreetViewService and StreetViewPanorama were undefined until a
// google.maps.Map was constructed and side-loaded the module. Neither panel may
// depend on the other having run first, and this is the test that says so.
import { test, beforeEach, vi } from 'vitest';
import assert from 'node:assert/strict';

const requested: string[] = [];
let failFor: string[] = [];

beforeEach(() => {
  requested.length = 0;
  failFor = [];
  (globalThis as any).window = globalThis;
  // The bootstrap dereferences `document` before it short-circuits on an
  // importLibrary that already exists, so a minimal stub is enough.
  (globalThis as any).document = {
    createElement: () => ({ setAttribute() {}, style: {} }),
    querySelector: () => null,
    head: { append() {} },
  };
  (globalThis as any).google = {
    maps: {
      importLibrary: async (name: string) => {
        requested.push(name);
        if (failFor.includes(name)) throw new Error(`${name} unavailable`);
        return {};
      },
    },
  };
});

const load = async () => {
  // Fresh module each time: the loader is single-flight by design, so the
  // bootstrap flag must not carry between cases.
  vi.resetModules();
  const mod = await import('./googleMaps');
  return mod.loadGoogleMaps();
};

console.log('\nEvery library the app uses is loaded up front');
test('THE BUG: streetView is imported, not left to a Map side-effect', () => {
  return load().then((h: any) => {
    assert.ok(requested.includes('streetView'),
      'without this, Street View only works after satellite has been shown');
    assert.equal(h.hasStreetView, true);
  });
});
test('maps, geometry and places are loaded too', () => {
  return load().then(() => {
    for (const lib of ['maps', 'geometry', 'places']) {
      assert.ok(requested.includes(lib), lib);
    }
  });
});

console.log('\nOptional libraries degrade, they do not block');
test('places failing still yields a usable handle', () => {
  failFor = ['places'];
  return load().then((h: any) => {
    assert.equal(h.hasPlaces, false);
    assert.equal(h.hasStreetView, true, 'street view is independent of places');
  });
});
test('streetView failing still yields a usable map', () => {
  failFor = ['streetView'];
  return load().then((h: any) => {
    assert.equal(h.hasStreetView, false);
    assert.equal(h.hasPlaces, true, 'the measuring tool is unaffected');
  });
});
test('the two optional libraries are reported independently', () => {
  failFor = ['places', 'streetView'];
  return load().then((h: any) => {
    assert.equal(h.hasPlaces, false);
    assert.equal(h.hasStreetView, false);
    assert.ok(h.maps, 'the core map still loaded');
  });
});

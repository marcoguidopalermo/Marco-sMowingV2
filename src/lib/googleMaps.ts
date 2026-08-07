// Google Maps JavaScript API loader + client config for SalesMaster's shared
// property-measuring tool. The key is a Maps JS API key RESTRICTED by HTTP
// referrer to our domains, so — exactly like firebaseConfig.apiKey — it is safe
// to ship in the client bundle. Prefer a build-time env var when present;
// otherwise fall back to the committed restricted key. NEVER console.log the key.
export const GOOGLE_MAPS_API_KEY: string =
  ((import.meta as any)?.env?.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ||
  'AIzaSyCHRBrkEeL-4wyvk9xs9bxZG66cD9sdfgM';

// m² → ft². google.maps.geometry.spherical.computeArea returns square metres.
export const M2_TO_SQFT = 10.7639;

// Default map view when there's nothing better to center on: the whole
// Thunder Bay service area in view. Single source — change here only.
export const DEFAULT_MAP_CENTER = { lat: 48.3809, lng: -89.2477 };
export const DEFAULT_MAP_ZOOM = 12;

// ── Auth-failure surfacing ────────────────────────────────────────────────
// Google calls window.gm_authFailure() on a key / referrer / billing rejection.
// The previous loader never registered it, so those failures were invisible and
// the tool only showed a generic "map couldn't load". We capture it, log it,
// and let a subscriber (the tool) show the code in its fallback panel.
export let lastMapsError: string | null = null;
let authFailureSub: ((code: string) => void) | null = null;
export function onMapsAuthFailure(cb: (code: string) => void): void { authFailureSub = cb; }

// ── Loader ────────────────────────────────────────────────────────────────
// Uses Google's OFFICIAL inline bootstrap (importLibrary). Libraries are loaded
// on demand and AWAITED, so `google.maps.drawing` / `geometry` / `places` are
// guaranteed present before use. This replaces the old script-tag that mixed
// `loading=async` with a legacy `callback` + `libraries=` — that combination
// fires the callback BEFORE the libraries finish loading, so the tool threw on
// `google.maps.drawing.DrawingManager` (undefined) and fell back to the error
// panel. Single-flight; the bootstrap itself no-ops on a second install.
let bootstrapped = false;
function installBootstrap(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  const w = window as any;
  w.gm_authFailure = () => {
    lastMapsError = 'AUTH_FAILURE (key / referrer / billing rejected by Google)';
    console.error('[maps] gm_authFailure —', lastMapsError);
    authFailureSub?.(lastMapsError);
  };
  /* eslint-disable */
  // Google's documented inline bootstrap loader (adapted; key + v pinned).
  (g => {
    let h: any, a: any, k: any, p = 'The Google Maps JavaScript API', c = 'google', l = 'importLibrary',
      q = '__ib__', m = document, b: any = w; b = b[c] || (b[c] = {});
    const d = b.maps || (b.maps = {}), r = new Set<string>(), e = new URLSearchParams(),
      u = () => h || (h = new Promise(async (f: any, n: any) => {
        a = m.createElement('script'); e.set('libraries', [...r] + '');
        for (k in g) e.set(k.replace(/[A-Z]/g, (t: string) => '_' + t[0].toLowerCase()), g[k]);
        e.set('callback', c + '.maps.' + q); a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
        d[q] = f; a.onerror = () => (h = n(Error(p + ' could not load.')));
        a.nonce = (m.querySelector('script[nonce]') as any)?.nonce || ''; m.head.append(a);
      }));
    d[l] ? console.warn(p + ' only loads once. Ignoring:', g)
      : (d[l] = (f: string, ...n: any[]) => r.add(f) && u().then(() => d[l](f, ...n)));
  })({ key: GOOGLE_MAPS_API_KEY, v: 'weekly' });
  /* eslint-enable */
}

export interface GoogleMapsHandle { maps: any; hasPlaces: boolean }

// Load core (maps + drawing + geometry) — all required, awaited. Places is
// OPTIONAL: address search is a nicety, so a places failure never blocks the
// tool — it degrades to manual pan/zoom. Rejects only if a CORE library fails.
export async function loadGoogleMaps(): Promise<GoogleMapsHandle> {
  if (typeof window === 'undefined') throw new Error('no-window');
  installBootstrap();
  const maps = (window as any).google.maps;
  await maps.importLibrary('maps');
  // NOTE: the 'drawing' library (DrawingManager) is RETIRED by Google and is
  // not served to newer keys/versions — importing it or using DrawingManager
  // throws "no longer available". We draw polygons manually instead (map click
  // → vertices on an editable google.maps.Polygon), which needs no library.
  await maps.importLibrary('geometry');   // computeArea — separate library, fine
  let hasPlaces = false;
  try {
    await maps.importLibrary('places');
    hasPlaces = true;
  } catch (err) {
    console.warn('[maps] places library unavailable — address search disabled, manual pan/zoom still works:', err);
  }
  return { maps, hasPlaces };
}

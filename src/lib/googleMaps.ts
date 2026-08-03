// Google Maps JavaScript API loader + client config for SalesMaster's shared
// property-measuring tool. The key is a Maps JS API key RESTRICTED by HTTP
// referrer to our domains, so — exactly like firebaseConfig.apiKey — it is safe
// to ship in the client bundle (that is what the referrer restriction is for).
// Prefer a build-time env var (VITE_GOOGLE_MAPS_API_KEY) when present; otherwise
// fall back to the committed restricted key. NEVER console.log the key.
export const GOOGLE_MAPS_API_KEY: string =
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ||
  'AIzaSyCHRBrkEeL-4wyvk9xs9bxZG66cD9sdfgM';

// m² → ft². google.maps.geometry.spherical.computeArea returns square metres.
export const M2_TO_SQFT = 10.7639;

// Single-flight loader. Resolves with the global `google` namespace once the JS
// API (geometry + places + drawing libraries) is ready. Rejects on network/key
// failure so callers can show a fallback (manual sqft entry still works).
let loadPromise: Promise<any> | null = null;

export function loadGoogleMaps(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no-window'));
  const w = window as any;
  if (w.google?.maps?.geometry && w.google?.maps?.drawing && w.google?.maps?.places) {
    return Promise.resolve(w.google);
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const cbName = '__salesMasterGmapsReady';
    w[cbName] = () => {
      if (w.google?.maps) resolve(w.google);
      else reject(new Error('maps-init-failed'));
    };
    const existing = document.getElementById('sm-gmaps-script') as HTMLScriptElement | null;
    if (existing) return; // a load is already in flight; the callback resolves us
    const s = document.createElement('script');
    s.id = 'sm-gmaps-script';
    s.async = true;
    s.defer = true;
    // libraries: geometry (computeArea), places (address search), drawing (polygons)
    s.src =
      'https://maps.googleapis.com/maps/api/js' +
      `?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}` +
      '&libraries=geometry,places,drawing' +
      '&v=weekly' +
      '&loading=async' +
      `&callback=${cbName}`;
    s.onerror = () => {
      loadPromise = null;
      s.remove();
      reject(new Error('maps-load-failed'));
    };
    document.head.appendChild(s);
  });
  return loadPromise;
}

// RESOLVING A TYPED ADDRESS TO A POINT — one implementation, two callers.
//
// PropertyMeasureTool and StreetViewPanel each had their own copy of the same
// PlacesService.findPlaceFromQuery call, and both were missing the same thing:
// a LOCATION BIAS. findPlaceFromQuery is a place search, not a geocoder. Given
// "396 ray boulevard" with no bias it will happily return a match anywhere on
// earth, and the map would centre on it.
//
// The Geocoding API — the right tool — is NOT enabled on this project (only
// Maps JavaScript and Places are), which is why the Places workaround exists at
// all. Biasing it to the operating area is what makes it behave like a
// geocoder for our purposes: a street address 40 km from Thunder Bay is the
// answer we want; the same street name in another country is not.
//
// Returns null rather than a fallback point. A caller that cannot resolve an
// address must SAY SO — silently keeping the previous view is how the map came
// to open on whichever property was measured last.

/** Thunder Bay and the surrounding service area. */
export const SERVICE_AREA_RADIUS_M = 60_000;

export interface LatLngLiteral { lat: number; lng: number }

/**
 * Bias circle for a Places query, as the JS API expects it.
 * @param {object} maps The google.maps namespace.
 * @param {LatLngLiteral} centre Centre of the service area.
 * @param {number} radius Metres.
 * @return {object} A LatLngBounds-shaped bias, or a circle literal.
 */
export function serviceAreaBias(
  maps: any, centre: LatLngLiteral, radius: number = SERVICE_AREA_RADIUS_M,
): unknown {
  // A circle literal is what findPlaceFromQuery documents for locationBias.
  // Constructing a LatLng keeps it valid across API versions.
  try {
    return { center: new maps.LatLng(centre.lat, centre.lng), radius };
  } catch {
    return { center: centre, radius };
  }
}

/**
 * Resolve a typed address to a point, biased to the service area.
 * @param {object} maps The google.maps namespace.
 * @param {HTMLElement} host Any element — PlacesService needs a node.
 * @param {string} address The address as typed.
 * @param {LatLngLiteral} centre Service-area centre for the bias.
 * @return {Promise<LatLngLiteral|null>} The point, or null when unresolvable.
 */
export function resolveAddressPoint(
  maps: any,
  host: HTMLElement,
  address: string | null | undefined,
  centre: LatLngLiteral,
): Promise<LatLngLiteral | null> {
  const q = String(address || '').trim();
  if (!q || !maps?.places?.PlacesService) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      new maps.places.PlacesService(host).findPlaceFromQuery(
        {
          query: q,
          fields: ['geometry'],
          locationBias: serviceAreaBias(maps, centre),
        },
        (results: any, status: any) => {
          const okStatus = maps.places?.PlacesServiceStatus?.OK ?? 'OK';
          const loc = status === okStatus ? results?.[0]?.geometry?.location : null;
          if (!loc) { resolve(null); return; }
          // location is a LatLng in the JS API, a literal in some mocks.
          const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
          const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
          resolve(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null);
        },
      );
    } catch { resolve(null); }
  });
}

/** What to tell the user when an address will not resolve. */
export function unresolvedAddressMessage(address: string | null | undefined): string {
  const q = String(address || '').trim();
  return q
    ? `Could not find “${q}”. It may be a new subdivision, or mistyped — `
      + 'search or pan to it on the map.'
    : 'No address entered yet — search or pan to the property.';
}

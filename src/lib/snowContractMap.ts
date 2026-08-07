// SNOWMASTER · CONTRACT SITE MAP — a Static Maps URL built from the saved
// measurement.
//
// WHY A URL RATHER THAN A STORED IMAGE: the outline REGENERATES from the
// polygon every time it renders, so re-measuring a property updates the
// printed map instead of leaving a stale picture behind. It also costs no
// Storage and needs no upload step. Manual image upload stays as the fallback
// for properties nobody has measured.
//
// REQUIRES the Maps Static API to be enabled on the Google key, and the key's
// HTTP-referrer restrictions to allow it — it is a SEPARATE SKU from the
// JavaScript Maps API the measuring tool uses. Without it the request returns
// an error image, which is why callers check `hasMeasurementMap` and fall back.
import type { PropertyMeasurement, MeasureRing, LatLngLiteral } from '../types';

const STATIC_BASE = 'https://maps.googleapis.com/maps/api/staticmap';

// Google's polyline algorithm. Encodes to 1e5 precision, which is ~1m — well
// inside the tolerance of a property outline.
function encodeSigned(v: number): string {
  let sv = v < 0 ? ~(v << 1) : (v << 1);
  let out = '';
  while (sv >= 0x20) {
    out += String.fromCharCode((0x20 | (sv & 0x1f)) + 63);
    sv >>= 5;
  }
  out += String.fromCharCode(sv + 63);
  return out;
}

export function encodePath(path: LatLngLiteral[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let out = '';
  for (const p of path) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += encodeSigned(lat - lastLat);
    out += encodeSigned(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return out;
}

export const hasMeasurementMap = (m: PropertyMeasurement | undefined | null): boolean =>
  !!m && Array.isArray(m.polygons) && m.polygons.some(r => (r.path || []).length >= 3);

// Serviced areas draw green and filled; exclusions draw red, so a printed map
// shows what is NOT serviced as plainly as what is.
const SERVICED = { color: '0x16a34aff', fill: '0x16a34a55' };
const EXCLUDED = { color: '0xdc2626ff', fill: '0xdc262644' };

function pathParam(ring: MeasureRing, style: { color: string; fill: string }): string | null {
  const path = ring.path || [];
  if (path.length < 3) return null;
  // Close the ring so the fill renders as a polygon rather than a stroke.
  const closed = [...path, path[0]];
  return `path=fillcolor:${style.fill}|color:${style.color}|weight:2|enc:${encodePath(closed)}`;
}

export interface StaticMapOptions {
  width?: number;
  height?: number;
  scale?: 1 | 2;    // 2 = retina; needed for print, where 1x looks soft
  // Passed in rather than imported, so this module stays pure and testable —
  // the Vite-only import.meta.env lookup stays in the components.
  apiKey?: string;
}

// Returns null when there is nothing to draw — the caller then shows the
// manual upload, or the placeholder.
export function staticMapUrl(
  m: PropertyMeasurement | undefined | null,
  opts: StaticMapOptions = {},
): string | null {
  if (!hasMeasurementMap(m)) return null;
  const width = Math.min(640, Math.round(opts.width || 640));
  const height = Math.min(640, Math.round(opts.height || 400));
  const scale = opts.scale || 2;
  const parts: string[] = [
    `size=${width}x${height}`,
    `scale=${scale}`,
    'maptype=satellite',
    'format=png',
  ];
  for (const ring of m!.polygons || []) {
    const p = pathParam(ring, SERVICED);
    if (p) parts.push(p);
  }
  for (const ring of m!.exclusions || []) {
    const p = pathParam(ring, EXCLUDED);
    if (p) parts.push(p);
  }
  // No explicit center/zoom: with paths present Google fits the viewport to
  // them, which is what we want — the outline should fill the frame.
  if (opts.apiKey) parts.push(`key=${opts.apiKey}`);
  const url = `${STATIC_BASE}?${parts.join('&')}`;
  // Static Maps rejects URLs over 8192 characters. A very detailed outline can
  // reach that, so fall back to serviced areas only before giving up entirely.
  if (url.length <= 8192) return url;
  const trimmed = [
    `size=${width}x${height}`, `scale=${scale}`, 'maptype=satellite', 'format=png',
    ...(m!.polygons || []).map(r => pathParam(r, SERVICED)).filter(Boolean) as string[],
    ...(opts.apiKey ? [`key=${opts.apiKey}`] : []),
  ].join('&');
  return `${STATIC_BASE}?${trimmed}`.length <= 8192 ? `${STATIC_BASE}?${trimmed}` : null;
}

// "41,200 sq ft" — what the measuring tool's number becomes in the contract's
// Total Serviced Area field. Editable afterwards, so this is only the seed.
export const areaLabel = (sqft: number): string =>
  `${Math.round(sqft).toLocaleString('en-US')} sq ft`;

// ── PRINTED PAGE GEOMETRY ──────────────────────────────────────────────────
// Letter at 96dpi, less the @page margins the document sets. This is the
// height one printed page can hold.
export const PAGE_CONTENT_PX = (11 - 0.42 * 2) * 96;   // 975.36
export const MAP_MAX_IN = 4.2;
export const MAP_MIN_IN = Math.round((MAP_MAX_IN - 2.5) * 100) / 100;   // 1.7in — the cap on reduction

// THE MEASURED FIT. Given the height of everything on page 1 EXCEPT the map
// box, return the map height that lets Property Scope finish on page 1.
// Shrinks from 4.2in and stops at the floor, so a page that genuinely cannot
// fit overflows rather than squeezing the map into a strip.
export function fitMapHeightIn(withoutMapPx: number): number {
  const available = PAGE_CONTENT_PX - withoutMapPx;
  if (available >= MAP_MAX_IN * 96) return MAP_MAX_IN;
  // FLOOR, never round: rounding up by a hundredth of an inch is ~1px, and a
  // single pixel over the page budget spills the whole section onto page 2.
  const floored = Math.floor(Math.max(MAP_MIN_IN, available / 96) * 100) / 100;
  return Math.max(MAP_MIN_IN, floored);
}

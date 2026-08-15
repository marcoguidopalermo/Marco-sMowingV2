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
import { areaSpec, ringCounts } from './snowAreas';

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
  !!m && (
    (Array.isArray(m.polygons) && m.polygons.some(r => (r.path || []).length >= 3))
    || (Array.isArray(m.markers) && m.markers.length > 0)
  );

// Serviced areas draw green and filled; exclusions draw red, so a printed map
// shows what is NOT serviced as plainly as what is. A ring that carries a snow
// PURPOSE overrides both and draws in that purpose's colour — the same hex the
// legend prints beside it, from the one definition in snowAreas.ts.
const SERVICED = { color: '0x16a34aff', fill: '0x16a34a55' };
const EXCLUDED = { color: '0xdc2626ff', fill: '0xdc262644' };

// #rrggbb → Static Maps 0xrrggbbaa. 0x38 ≈ 22% — the reference's fill alpha.
const staticColor = (hex: string, alpha: string): string =>
  `0x${hex.replace('#', '')}${alpha}`;

function styleForRing(ring: MeasureRing, fallback: { color: string; fill: string }) {
  const spec = areaSpec(ring.purpose);
  if (!spec) return fallback;
  return { color: staticColor(spec.hex, 'ff'), fill: staticColor(spec.hex, '38') };
}

function pathParam(ring: MeasureRing, fallback: { color: string; fill: string }): string | null {
  const path = ring.path || [];
  if (path.length < 3) return null;
  const style = styleForRing(ring, fallback);
  // Close the ring so the fill renders as a polygon rather than a stroke.
  const closed = [...path, path[0]];
  return `path=fillcolor:${style.fill}|color:${style.color}|weight:2|enc:${encodePath(closed)}`;
}

// A point feature — a hydrant, a bollard. Small and unlabelled: the legend
// says what the colour means, and a lettered pin on a 3.75in map is noise.
function markerParam(at: LatLngLiteral, hex: string): string {
  return `markers=size:small|color:${staticColor(hex, '')}|${at.lat.toFixed(6)},${at.lng.toFixed(6)}`;
}

// Serviced square footage: plow and shovel areas, less exclusions. Storage and
// hazard areas are drawn but never counted — see SnowAreaSpec.counts.
export const servicedSqft = (
  ringSqft: (r: MeasureRing) => number,
  m: PropertyMeasurement | undefined | null,
): number => {
  if (!m) return 0;
  const add = (m.polygons || []).filter(ringCounts).reduce((s, r) => s + ringSqft(r), 0);
  const sub = (m.exclusions || []).reduce((s, r) => s + ringSqft(r), 0);
  return Math.max(0, add - sub);
};

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
  for (const mk of m!.markers || []) {
    const spec = areaSpec(mk.purpose);
    if (spec && mk.at) parts.push(markerParam(mk.at, spec.hex));
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
// SIDE margins are NOT @page margins — they are padding on .sheet, so they
// survive a "Margins: None" setting in the print dialog and cannot be dropped.
// Top/bottom must stay on @page: they have to repeat on every page, and
// padding only applies to a fragment's first and last page.
export const PAGE_MARGIN_IN = 0.42;
export const PAGE_SIDE_IN = 0.5;
export const PAGE_CONTENT_PX = (11 - PAGE_MARGIN_IN * 2) * 96;   // 975.36 — the paper
export const PAGE_CONTENT_WIDTH_PX = (8.5 - PAGE_SIDE_IN * 2) * 96;   // 720
// The running footer is a repeating <tfoot>: it takes this much off EVERY
// page, not just the last one. Anything that budgets page space — above all
// the map fit — has to work from PAGE_BUDGET_PX, not the raw paper height.
// The print verification measures the rendered footer and fails if it has
// outgrown this reserve, so the constant cannot silently go stale.
export const FOOTER_RESERVE_PX = 18;
export const PAGE_BUDGET_PX = PAGE_CONTENT_PX - FOOTER_RESERVE_PX;   // 957.36

// ── PAGE 1 IS COMPOSED, NOT FLOWED ─────────────────────────────────────────
// The measured-fit pass that used to shrink the map until Property Scope fit
// is GONE, and with it the reason for it: the new page 1 is a fixed-height
// flex column — band, property head, photo banner, Sections 1 and 2, then the
// map row — and the SITE PHOTO is the flexible element. Whatever height the
// fixed parts do not use, the photo takes. Nothing has to be measured and
// re-measured because nothing above the fold can grow unboundedly any more:
// the six-row scope table and the free-text scope description that used to
// push the map around are both gone from the document.
//
// The column is sized to the page BUDGET, not the paper: the running <tfoot>
// takes its reserve off every page including this one.
//
// LESS FOUR PIXELS, AND THAT MATTERS. Set to the budget exactly, the column's
// last element — the map row — ended at 957px inside a table body with 957px
// to give: (PAGE_CONTENT_PX − 1) less the footer's real 17px. Zero margin, and
// in the printed artefact it lost. The map row carries break-inside:avoid, so
// losing by a fraction of a pixel does not clip it — it moves the whole row to
// page 2 and leaves a 3.75in hole on page 1, which every geometric check still
// called a pass because the staging layout put it at exactly the boundary.
// FOUR PIXELS of slack is the difference between a layout that fits and a
// layout that is betting on sub-pixel rounding.
export const PAGE1_SAFETY_PX = 4;
export const PAGE1_HEIGHT_PX = Math.floor(PAGE_BUDGET_PX) - PAGE1_SAFETY_PX;
// The reference's square map box, with the legend column filling the rest of
// the row beside it.
export const MAP_BOX_IN = 3.75;
// The banner's floor. Below this a photo is a stripe rather than a picture, so
// page 1 is allowed to run over instead — the same principle the old map floor
// served, applied to the element that now flexes.
export const PHOTO_MIN_IN = 1.5;

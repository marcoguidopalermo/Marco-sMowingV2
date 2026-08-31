// WHAT THE MAPS API ACTUALLY DID, reported as fact rather than inferred.
//
// A blank map has several possible causes that look identical from outside:
// the container had no size, the Map constructor ran but painted nothing, tiles
// were refused, or an overlay is covering a perfectly good map. Guessing
// between them costs a deploy per guess — this collects the evidence in one
// place instead.
//
// The sharpest single signal is whether Google injected its own DOM. A working
// Map builds a `.gm-style` subtree inside the container within a frame or two.
// An empty container means the constructor did nothing, which rules out every
// tile-, billing- and imagery-related explanation at a stroke.

export interface MapDiag {
  containerW: number;
  containerH: number;
  /** Google injects `.gm-style` when it actually builds the map. */
  gmChildren: number;
  hasGmStyle: boolean;
  display: string;
  visibility: string;
  opacity: string;
  mapTypeId?: string;
  zoom?: number;
  center?: { lat: number; lng: number } | null;
  hasBounds: boolean;
  tilesLoaded: boolean;
  idleFired: boolean;
}

/** Read everything worth knowing about a constructed map, without throwing. */
export function readMapDiag(
  el: HTMLElement | null,
  map: any,
  flags: { tilesLoaded: boolean; idleFired: boolean },
): MapDiag {
  const style = (el && typeof getComputedStyle === 'function')
    ? getComputedStyle(el) : ({} as CSSStyleDeclaration);
  let center: { lat: number; lng: number } | null = null;
  try {
    const c = map?.getCenter?.();
    if (c) center = { lat: c.lat(), lng: c.lng() };
  } catch { /* noop */ }
  let hasBounds = false;
  try { hasBounds = !!map?.getBounds?.(); } catch { /* noop */ }
  return {
    containerW: el?.offsetWidth ?? 0,
    containerH: el?.offsetHeight ?? 0,
    gmChildren: el?.childElementCount ?? 0,
    hasGmStyle: !!el?.querySelector?.('.gm-style'),
    display: style.display ?? '',
    visibility: style.visibility ?? '',
    opacity: style.opacity ?? '',
    mapTypeId: (() => { try { return map?.getMapTypeId?.(); } catch { return undefined; } })(),
    zoom: (() => { try { return map?.getZoom?.(); } catch { return undefined; } })(),
    center,
    hasBounds,
    tilesLoaded: flags.tilesLoaded,
    idleFired: flags.idleFired,
  };
}

export type MapVerdict =
  | 'ok'
  | 'container-zero-size'
  | 'container-hidden'
  | 'constructor-did-nothing'
  | 'built-but-no-tiles';

/**
 * One sentence naming what is wrong, from the evidence. Ordered so the most
 * fundamental cause wins — there is no point reporting missing tiles for a
 * container that is `display: none`.
 * @param {MapDiag} d The collected facts.
 * @return {MapVerdict} What the evidence says.
 */
export function mapVerdict(d: MapDiag): MapVerdict {
  if (d.display === 'none' || d.visibility === 'hidden' || d.opacity === '0') {
    return 'container-hidden';
  }
  if (d.containerW <= 0 || d.containerH <= 0) return 'container-zero-size';
  if (!d.hasGmStyle && d.gmChildren === 0) return 'constructor-did-nothing';
  if (!d.tilesLoaded) return 'built-but-no-tiles';
  return 'ok';
}

export const VERDICT_TEXT: Record<MapVerdict, string> = {
  'ok': 'Map built and tiles painted.',
  'container-hidden': 'The map container is hidden by CSS (display/visibility/opacity). '
    + 'The map cannot paint into it; nothing about Google is wrong.',
  'container-zero-size': 'The map container measured 0×0 when the map was built. '
    + 'A Google map sizes itself once at construction and never retries.',
  'constructor-did-nothing': 'google.maps.Map was constructed but injected NO DOM '
    + '(no .gm-style). The API rejected the map itself — check the console for '
    + 'gm_authFailure, BillingNotEnabledMapError, RefererNotAllowedMapError, '
    + 'ApiNotActivatedMapError or InvalidKeyMapError.',
  'built-but-no-tiles': 'The map built its DOM but tilesloaded never fired — '
    + 'imagery is being refused or blocked. Check the Network tab for failing '
    + 'requests to maps.googleapis.com, and the console for a Maps error code.',
};

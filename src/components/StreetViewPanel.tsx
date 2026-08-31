// STREET VIEW for a snow quote.
//
// For snow, the kerbside view is often more useful than the satellite one: it
// shows the approach, whether there IS a boulevard, the clearance either side,
// obstacles and the slope — which is the list of things the price actually
// turns on. Satellite shows the shape; Street View shows the job.
//
// REUSES the existing Maps setup entirely — same loader, same key, same
// referrer restrictions, same Places call the measuring tool uses to resolve an
// address. StreetViewPanorama and StreetViewService are part of the Maps
// JavaScript API, so NO ADDITIONAL GOOGLE API needs enabling: no Street View
// Static API (that is for image URLs) and no Maps Static API (that is only the
// printed contract map).
//
// Deliberately a separate panel rather than a mode inside PropertyMeasureTool:
// that component is shared with LawnMaster and the contract builder, and this
// is a snow-quoting need. A toggle there would change the tool for everybody.
import { useEffect, useRef, useState } from 'react';
import { X, AlertTriangle, Map } from 'lucide-react';
import { loadGoogleMaps, onMapsAuthFailure, lastMapsError, DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../lib/googleMaps';
import { resolveAddressPointNew, unresolvedAddressMessage } from '../lib/resolveAddressPoint';
import { waitForSize, hasSize } from '../lib/mapContainerReady';
import type { PropertyMeasurement } from '../types';

/**
 * Loose address comparison — case, punctuation and spacing ignored, so
 * "396 ray boulevard" and "396 Ray Blvd." are not treated as different
 * properties while "396 Ray" and "12 Elm" are.
 */
const sameAddress = (a: string | undefined, b: string | undefined): boolean => {
  const norm = (v: string | undefined) =>
    (v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const x = norm(a); const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
};

/** Centre of a saved outline — avoids re-resolving an address we already placed. */
function centroidOf(m: PropertyMeasurement | undefined): { lat: number; lng: number } | null {
  const pts = (m?.polygons || []).flatMap(p => p.path || []);
  if (pts.length === 0) return null;
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export default function StreetViewPanel({
  address, measurement, onClose, onSwitchToMap, focus,
}: {
  address: string;
  measurement?: PropertyMeasurement;
  onClose: () => void;
  // Switch back to the satellite map in place, at whatever this panorama is
  // standing on, so the two views are one surface.
  onSwitchToMap?: (focus: { lat: number; lng: number; zoom?: number }) => void;
  // Where the map left off, used when there is no outline and no address to
  // resolve — switching over should not throw away the view you had.
  focus?: { lat: number; lng: number; zoom?: number } | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Where this panorama is looking — the PROPERTY point, not the camera on the
  // road — so switching to satellite lands on the driveway, not the kerb.
  const hereRef = useRef<{ lat: number; lng: number; zoom?: number } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');
  const [errCode, setErrCode] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string>('');
  const panoRef = useRef<any>(null);
  const resizeObsRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    let dead = false;
    onMapsAuthFailure(code => { if (!dead) { setErrCode(code); setStatus('error'); } });

    loadGoogleMaps().then(async ({ maps, hasPlaces, hasStreetView }) => {
      if (dead || !hostRef.current) return;
      // The streetView library is what supplies StreetViewService and
      // StreetViewPanorama. Say so plainly rather than throwing on an
      // undefined constructor and rendering nothing, which is how this
      // previously "did nothing" on a cold open.
      if (!hasStreetView) {
        setStatus('error');
        setErrCode('STREETVIEW_LIBRARY_UNAVAILABLE');
        setResolved('The Street View library did not load. The satellite map is unaffected.');
        return;
      }
      // Same readiness gate the map uses: a panorama also measures its
      // container once, at construction.
      const sized = await waitForSize(hostRef.current);
      if (dead || !hostRef.current) return;
      if (!sized) console.warn('[maps] street view container had no size — relying on the resize observer');

      // 1. Where to look. A saved outline already knows — but ONLY if it was
      //    taken for this address. Correcting a typo has to move the view; a
      //    stale centroid from the wrong property would keep showing the old
      //    place and quietly make the correction pointless.
      const outlineMatches = !address.trim()
        || !measurement?.address
        || sameAddress(measurement.address, address);
      let point = outlineMatches ? centroidOf(measurement) : null;
      // Handed over from the map: that is exactly what the user was looking at.
      if (!point && focus) point = { lat: focus.lat, lng: focus.lng };

      // 2. Otherwise resolve the typed address with the SAME Places call the
      //    measuring tool uses — Places is already enabled and working, so
      //    this adds no new API dependency (a Geocoder would have).
      if (!point && address.trim() && hasPlaces) {
        // Shared with the measuring tool — one biased implementation, so the
        // two views cannot disagree about where an address is. See
        // lib/resolveAddressPoint.
        point = await resolveAddressPointNew(
          maps, hostRef.current!, address, DEFAULT_MAP_CENTER,
        );
      }
      if (dead) return;
      if (!point) {
        // No outline and no resolvable address — say so plainly rather than
        // dropping the viewer on Thunder Bay and letting it look like coverage.
        setStatus('none');
        setResolved(unresolvedAddressMessage(address));
        return;
      }

      // 3. Nearest panorama. OUTDOOR only — an indoor business panorama is
      //    useless for judging a driveway. 80 m covers a set-back house
      //    without wandering to the next street.
      try {
        const svc = new maps.StreetViewService();
        svc.getPanorama(
          { location: point, radius: 80, source: maps.StreetViewSource.OUTDOOR },
          (data: any, st: any) => {
            if (dead || !hostRef.current) return;
            if (st !== maps.StreetViewStatus.OK || !data?.location) {
              setStatus('none');
              setResolved('Google has no Street View imagery within 80 m of this property.');
              return;
            }
            hereRef.current = { lat: point!.lat, lng: point!.lng, zoom: 19 };
            const pano = new maps.StreetViewPanorama(hostRef.current, {
              pano: data.location.pano,
              // Face the property from the road.
              pov: {
                heading: maps.geometry.spherical.computeHeading(data.location.latLng, new maps.LatLng(point!.lat, point!.lng)),
                pitch: 0,
              },
              zoom: 0,
              addressControl: true,
              fullscreenControl: true,
              motionTracking: false,
              motionTrackingControl: false,
            });
            panoRef.current = pano;
            // THE THIRD DEFENCE, same as the map's. A panorama sizes itself at
            // construction too; if the box changes afterwards it repaints only
            // when told to, and the POV has to be re-applied because a resize
            // leaves it looking wherever the old geometry pointed.
            if (typeof ResizeObserver !== 'undefined' && hostRef.current) {
              let lastW = 0; let lastH = 0;
              resizeObsRef.current = new ResizeObserver(() => {
                const el = hostRef.current;
                if (!el || !hasSize(el) || !panoRef.current) return;
                if (el.offsetWidth === lastW && el.offsetHeight === lastH) return;
                lastW = el.offsetWidth; lastH = el.offsetHeight;
                try {
                  maps.event.trigger(panoRef.current, 'resize');
                  panoRef.current.setPov(panoRef.current.getPov());
                } catch (err) { console.warn('[maps] street view resize failed:', err); }
              });
              resizeObsRef.current.observe(hostRef.current);
            }
            setResolved(data.location.description || address.trim());
            setStatus('ready');
          },
        );
      } catch (err) {
        console.error('[streetview] failed', err);
        setErrCode(String(err));
        setStatus('error');
      }
    }).catch(err => {
      if (dead) return;
      console.error('[streetview] maps load failed', err);
      setErrCode(lastMapsError || String(err));
      setStatus('error');
    });

    return () => {
      dead = true;
      try { resizeObsRef.current?.disconnect(); } catch { /* noop */ }
      resizeObsRef.current = null;
      panoRef.current = null;
    };
  }, [address, measurement]);

  return (
    <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center md:p-4">
      <div className="bg-white md:rounded-2xl shadow-2xl w-full h-full md:h-auto md:max-w-3xl overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Street view</div>
            <div className="font-bold text-slate-800 truncate">{address.trim() || 'No address'}</div>
            {status === 'ready' && resolved && resolved !== address.trim() && (
              <div className="text-[11px] text-slate-400 truncate">{resolved}</div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* SWITCH IN PLACE. Hands back where this panorama is standing, so
                the map opens on the same property at working zoom. */}
            {onSwitchToMap && (
              <button
                type="button"
                onClick={() => onSwitchToMap(
                  hereRef.current || focus || { ...DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM },
                )}
                title="Satellite view of this spot"
                className="min-h-[44px] px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-black uppercase tracking-widest"
              >
                <Map className="w-4 h-4" /> Satellite
              </button>
            )}
            <button onClick={onClose} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700" aria-label="Close">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="relative flex-1 min-h-[380px] bg-slate-100">
          <div ref={hostRef} className="absolute inset-0" />
          {status === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">Loading street view…</div>
          )}
          {(status === 'none' || status === 'error') && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
              <div className="text-sm font-bold text-slate-700">
                {status === 'none' ? 'No street view here' : 'Street view could not load'}
              </div>
              <div className="text-[12px] text-slate-500 max-w-sm">{resolved || errCode}</div>
              {status === 'error' && errCode && (
                // The real Google code, not a generic message — this has failed
                // silently before for key / restriction reasons, and the code is
                // what makes that diagnosable in seconds.
                <div className="text-[11px] font-mono text-slate-400 mt-1">{errCode}</div>
              )}
              <div className="text-[11px] text-slate-400 mt-1">The satellite view still works from the Map button.</div>
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400">
          Reference only — the price comes from the traced grid.
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, Plus, Minus, Trash2, MapPin, AlertTriangle, Check, Loader2, Pencil } from 'lucide-react';
import { loadGoogleMaps, onMapsAuthFailure, lastMapsError, M2_TO_SQFT, DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../lib/googleMaps';
import { PropertyMeasurement } from '../types';

// Remember the last measured location PER USER — local only (no doc writes), so
// a repeat session opens near where the estimator was working.
const lastKey = (email: string) => `sm-measure-last:${(email || '').toLowerCase()}`;
function readLastView(email: string): { lat: number; lng: number; zoom?: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(lastKey(email)) || 'null');
    if (v && typeof v.lat === 'number' && typeof v.lng === 'number') return v;
  } catch { /* ignore */ }
  return null;
}
function writeLastView(email: string, lat: number, lng: number, zoom?: number): void {
  try { localStorage.setItem(lastKey(email), JSON.stringify({ lat, lng, zoom })); } catch { /* ignore */ }
}

// SHARED SalesMaster tool: draw polygons on satellite imagery → live sqft.
// Used by LawnMaster today; ProjectMaster / sod can mount the same component
// later (it knows nothing about pricing — it only returns a PropertyMeasurement
// whose totalSqft flows into the caller's area field). Mobile-first: big thumb
// controls, greedy gestures, works at phone width. Degrades cleanly if the map
// can't load — the caller's manual sqft entry is unaffected.

const GREEN = '#1c4634';
const ADD_COLOR = '#16a34a';   // added area (front/back yard)
const SUB_COLOR = '#dc2626';   // subtracted area (driveway/pool/beds)
const fmtSqft = (n: number) => `${Math.round(n).toLocaleString('en-US')} sq ft`;

type Mode = 'add' | 'subtract';
interface ShapeRef { id: string; poly: any; mode: Mode }
interface ShapeView { id: string; mode: Mode; sqft: number }

interface Props {
  onClose: () => void;
  onUse: (m: PropertyMeasurement) => void;
  currentUser: { email: string; name: string };
  initial?: PropertyMeasurement | null;   // saved measurement → re-render its outline
  initialAddress?: string;                 // optional client address seed
}

export default function PropertyMeasureTool({ onClose, onUse, currentUser, initial, initialAddress }: Props) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errCode, setErrCode] = useState<string | null>(null);   // real Google error, shown in the fallback
  const [placesOn, setPlacesOn] = useState(true);                // address search available?
  const [shapes, setShapes] = useState<ShapeView[]>([]);
  const [drawing, setDrawing] = useState<Mode | null>(null);
  const [address, setAddress] = useState<string | undefined>(initial?.address || initialAddress);

  const [draftCount, setDraftCount] = useState(0);   // vertices placed in the in-progress shape

  const mapDivRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const shapesRef = useRef<ShapeRef[]>([]);
  // In-progress (draft) polygon being placed by map taps. Manual drawing — no
  // DrawingManager (that library is retired by Google). `path` is the explicit
  // MVCArray of vertices we push to (getPath() is unreliable on a ring-less poly).
  const draftRef = useRef<{ poly: any; mode: Mode; path: any } | null>(null);

  const styleFor = (mode: Mode) => ({
    strokeColor: mode === 'add' ? ADD_COLOR : SUB_COLOR,
    strokeWeight: 2.5, strokeOpacity: 0.95,
    fillColor: mode === 'add' ? ADD_COLOR : SUB_COLOR,
    fillOpacity: mode === 'add' ? 0.22 : 0.38,
    editable: true, draggable: true, clickable: true,
    zIndex: mode === 'add' ? 1 : 2,
  });
  const draftStyle = (mode: Mode) => ({
    strokeColor: mode === 'add' ? ADD_COLOR : SUB_COLOR,
    strokeWeight: 2.5, strokeOpacity: 0.95,
    fillColor: mode === 'add' ? ADD_COLOR : SUB_COLOR,
    fillOpacity: 0.15, editable: false, draggable: false, clickable: false,
    zIndex: 3,
  });

  const recompute = () => {
    const g = gRef.current; if (!g) return;
    setShapes(shapesRef.current.map(s => ({
      id: s.id, mode: s.mode,
      sqft: g.maps.geometry.spherical.computeArea(s.poly.getPath()) * M2_TO_SQFT,
    })));
  };

  const addShape = (poly: any, mode: Mode) => {
    const g = gRef.current;
    poly.setOptions(styleFor(mode));
    const id = `shp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    shapesRef.current.push({ id, poly, mode });
    const path = poly.getPath();
    ['insert_at', 'set_at', 'remove_at'].forEach(ev => g.maps.event.addListener(path, ev, recompute));
    g.maps.event.addListener(poly, 'dragend', recompute);
    recompute();
  };

  // ── Manual polygon drawing (replaces the retired DrawingManager) ──────────
  // Tap the map to drop corners onto an in-progress google.maps.Polygon; tap
  // near the first corner (or the Finish button) to close it. On finish the
  // polygon becomes editable + draggable, exactly the specced UX.
  const startDraw = (mode: Mode) => {
    const g = gRef.current, map = mapRef.current; if (!g || !map) return;
    discardDraft();
    // Build a ring-less polygon, then setPath(MVCArray) to establish ONE ring
    // we push vertices onto. (A Polygon constructed with an empty `paths` has
    // ZERO rings → getPath() is undefined and the first push throws.)
    const path = new g.maps.MVCArray();
    const poly = new g.maps.Polygon({ ...draftStyle(mode), map });
    poly.setPath(path);
    draftRef.current = { poly, mode, path };
    setDraftCount(0);
    setDrawing(mode);
  };
  const addVertex = (latLng: any) => {
    const g = gRef.current, draft = draftRef.current; if (!g || !draft) return;
    const path = draft.path;
    // Tap near the FIRST corner (≥3 placed) closes the shape.
    if (path.getLength() >= 3) {
      const first = path.getAt(0);
      const map = mapRef.current;
      const mpp = 156543.03392 * Math.cos((first.lat() * Math.PI) / 180) / Math.pow(2, map.getZoom());
      const dist = g.maps.geometry.spherical.computeDistanceBetween(first, latLng);
      if (dist < 16 * mpp) { finishDraft(); return; }
    }
    path.push(latLng);
    setDraftCount(path.getLength());
  };
  const undoPoint = () => {
    const draft = draftRef.current; if (!draft) return;
    if (draft.path.getLength() > 0) draft.path.removeAt(draft.path.getLength() - 1);
    setDraftCount(draft.path.getLength());
  };
  const discardDraft = () => {
    if (draftRef.current) { draftRef.current.poly.setMap(null); draftRef.current = null; }
    setDraftCount(0);
  };
  const finishDraft = () => {
    const draft = draftRef.current; if (!draft) return;
    if (draft.path.getLength() < 3) return; // need a triangle minimum
    const { poly, mode } = draft;
    draftRef.current = null;
    setDrawing(null);
    setDraftCount(0);
    addShape(poly, mode);   // makes it editable + draggable, wires recompute
  };
  const cancelDraw = () => { discardDraft(); setDrawing(null); };

  const toggleMode = (id: string) => {
    const s = shapesRef.current.find(x => x.id === id); if (!s) return;
    s.mode = s.mode === 'add' ? 'subtract' : 'add';
    s.poly.setOptions(styleFor(s.mode));
    recompute();
  };
  const deleteShape = (id: string) => {
    const i = shapesRef.current.findIndex(x => x.id === id); if (i < 0) return;
    shapesRef.current[i].poly.setMap(null);
    shapesRef.current.splice(i, 1);
    recompute();
  };
  const clearAll = () => {
    shapesRef.current.forEach(s => s.poly.setMap(null));
    shapesRef.current = [];
    recompute();
  };

  const total = useMemo(() => {
    let add = 0, sub = 0;
    for (const s of shapes) (s.mode === 'add' ? (add += s.sqft) : (sub += s.sqft));
    return Math.max(0, add - sub);
  }, [shapes]);
  const addCount = shapes.filter(s => s.mode === 'add').length;
  const subCount = shapes.filter(s => s.mode === 'subtract').length;

  // Mount → load Maps → init. The component is only mounted while open, so each
  // open is a clean init (no stale shapes to tear down).
  useEffect(() => {
    let cancelled = false;
    // Surface a Google auth failure (bad key / referrer / billing) even if it
    // arrives AFTER the libraries loaded — flip to the error panel with a code.
    onMapsAuthFailure((code) => { if (!cancelled) { setErrCode(code); setStatus('error'); } });
    loadGoogleMaps().then(({ maps, hasPlaces }) => {
      if (cancelled || !mapDivRef.current) return;
      const g = { maps };
      gRef.current = g;
      setPlacesOn(hasPlaces);
      // Where to open: a saved outline wins (reopening the measured property);
      // otherwise the user's last measured view, else the Thunder Bay default.
      // If the quote has an address, we asynchronously recenter on it below.
      const outlineSeed = initial?.polygons?.[0]?.path?.[0] || initial?.exclusions?.[0]?.path?.[0];
      const lastView = readLastView(currentUser.email);
      const seedCenter = outlineSeed || lastView || DEFAULT_MAP_CENTER;
      const seedZoom = outlineSeed ? 20 : (lastView?.zoom || DEFAULT_MAP_ZOOM);
      const map = new g.maps.Map(mapDivRef.current, {
        center: seedCenter, zoom: seedZoom,
        mapTypeId: 'hybrid',            // satellite imagery + street labels (easier to locate the lot)
        // Force the RASTER renderer: the default vector (WebGL) map does a
        // GetViewportInfo RPC that has been returning 502/CORS on this project;
        // raster tiles avoid that path. Falls back to the string if the enum
        // isn't present in this API version.
        renderingType: (g.maps.RenderingType && g.maps.RenderingType.RASTER) || 'RASTER',
        tilt: 0, gestureHandling: 'greedy', disableDefaultUI: true,
        zoomControl: true, clickableIcons: false,
      });
      mapRef.current = map;
      // Manual drawing: every map tap drops a vertex onto the active draft
      // polygon (no DrawingManager). Ignored when not drawing.
      g.maps.event.addListener(map, 'click', (e: any) => { if (draftRef.current && e?.latLng) addVertex(e.latLng); });

      // If the quote carries an address and there's no saved outline, geocode it
      // and pan to the property — async, so the map opens instantly and jumps
      // when it resolves. We use PlacesService.findPlaceFromQuery: the Geocoding
      // API and the new Places Text Search are both blocked on this key, but
      // classic Places Find Place is allowed (same API the search box uses). Any
      // failure leaves the Thunder Bay default; drawing is unaffected.
      const addrToCenter = (!outlineSeed && hasPlaces) ? (initialAddress || initial?.address || '').trim() : '';
      if (addrToCenter && g.maps.places?.PlacesService) {
        try {
          new g.maps.places.PlacesService(map).findPlaceFromQuery(
            { query: addrToCenter, fields: ['geometry'] },
            (res: any, status: any) => {
              const loc = res?.[0]?.geometry?.location;
              if (!cancelled && status === 'OK' && loc) {
                map.setCenter(loc); map.setZoom(18); setAddress(addrToCenter);
              }
            },
          );
        } catch (e) { console.warn('[maps] address centering failed — Thunder Bay default kept:', e); }
      }
      // Address search (Places Autocomplete) — OPTIONAL. Only wired when the
      // places library actually loaded; otherwise the salesperson pans/zooms.
      if (hasPlaces && searchRef.current) {
        try {
          const ac = new g.maps.places.Autocomplete(searchRef.current, { fields: ['geometry', 'formatted_address'] });
          ac.bindTo('bounds', map);
          g.maps.event.addListener(ac, 'place_changed', () => {
            const place = ac.getPlace();
            if (!place?.geometry) return;
            if (place.geometry.viewport) map.fitBounds(place.geometry.viewport);
            else { map.setCenter(place.geometry.location); map.setZoom(20); }
            setAddress(place.formatted_address);
          });
        } catch (err) {
          console.warn('[maps] Autocomplete init failed — search disabled, map still works:', err);
          setPlacesOn(false);
        }
      }
      // Re-render a saved measurement's outline (the record of what was measured).
      if (initial) {
        const bounds = new g.maps.LatLngBounds();
        const mk = (path: { lat: number; lng: number }[], mode: Mode) => {
          if (!path?.length) return;
          const poly = new g.maps.Polygon({ paths: path, map });
          addShape(poly, mode);
          path.forEach(pt => bounds.extend(pt));
        };
        (initial.polygons || []).forEach(r => mk(r.path, 'add'));
        (initial.exclusions || []).forEach(r => mk(r.path, 'subtract'));
        if (!bounds.isEmpty()) map.fitBounds(bounds);
      }
      setStatus('ready');
    }).catch((err) => {
      if (cancelled) return;
      const code = lastMapsError || (err?.message ? String(err.message) : String(err) || 'load_failed');
      console.error('[PropertyMeasureTool] Google Maps failed to load:', err);
      setErrCode(code);
      setStatus('error');
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildMeasurement = (): PropertyMeasurement => {
    const ringOf = (poly: any) => ({ path: poly.getPath().getArray().map((pt: any) => ({ lat: pt.lat(), lng: pt.lng() })) });
    return {
      polygons: shapesRef.current.filter(s => s.mode === 'add').map(s => ringOf(s.poly)),
      exclusions: shapesRef.current.filter(s => s.mode === 'subtract').map(s => ringOf(s.poly)),
      totalSqft: Math.round(total),
      address,
      measuredAt: Date.now(),
      measuredBy: currentUser,
    };
  };

  // Remember where the estimator was working (local only) so the next session
  // opens near here. Uses the current map view.
  const rememberLocation = () => {
    const map = mapRef.current; if (!map) return;
    const c = map.getCenter?.();
    if (c) writeLastView(currentUser.email, c.lat(), c.lng(), map.getZoom?.());
  };

  return (
    <div className="fixed inset-0 z-[140] bg-black/70 flex flex-col md:items-center md:justify-center md:p-4">
      <div className="bg-white w-full h-full md:h-[90vh] md:max-w-2xl md:rounded-2xl overflow-hidden flex flex-col shadow-2xl">
        {/* Header — search + close */}
        <div className="px-3 py-2.5 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input ref={searchRef}
              placeholder={placesOn ? 'Search an address…' : 'Search unavailable — pan & zoom to the property'}
              disabled={status !== 'ready' || !placesOn}
              className="w-full border border-slate-300 rounded-lg pl-8 pr-3 py-2.5 text-sm outline-none focus:border-slate-500 disabled:bg-slate-50 disabled:text-slate-400" />
          </div>
          <button onClick={onClose} aria-label="Close" className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Map (always in the DOM so the ref exists; overlays on top) */}
        <div className="relative flex-1 min-h-0 bg-slate-100">
          <div ref={mapDivRef} className="absolute inset-0" />

          {status === 'loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-500 bg-slate-50">
              <Loader2 className="w-6 h-6 animate-spin" /> <span className="text-sm font-bold">Loading satellite map…</span>
            </div>
          )}
          {status === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 bg-slate-50">
              <AlertTriangle className="w-7 h-7 text-amber-500" />
              <div className="text-sm font-black text-slate-700">Map couldn’t load</div>
              <div className="text-[13px] text-slate-500 max-w-xs">Check the connection and try again. You can still type the square footage manually — quoting isn’t blocked.</div>
              {errCode && <div className="text-[11px] font-mono font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded px-2 py-1 max-w-xs break-words">Map error: {errCode}</div>}
              <button onClick={onClose} className="mt-2 min-h-[44px] px-4 rounded-xl text-white text-xs font-black uppercase tracking-widest" style={{ backgroundColor: GREEN }}>Back to quote</button>
            </div>
          )}

          {/* Draw controls — overlaid bottom-left of the map, thumb-reachable */}
          {status === 'ready' && (
            <div className="absolute left-2 bottom-2 right-2 flex flex-col items-start gap-2 pointer-events-none">
              {drawing ? (
                <>
                  <div className="pointer-events-auto bg-black/80 text-white text-[12px] font-bold rounded-lg px-3 py-1.5 flex items-center gap-2">
                    <Pencil className="w-3.5 h-3.5" />
                    {draftCount < 3
                      ? `Tap the map to place corners (${draftCount}) — 3+ needed`
                      : `${draftCount} corners · tap the first corner or Finish`}
                  </div>
                  <div className="pointer-events-auto flex gap-2 flex-wrap">
                    <button onClick={finishDraft} disabled={draftCount < 3}
                      className="min-h-[44px] px-3 rounded-xl text-white text-[12px] font-black uppercase tracking-widest shadow-lg inline-flex items-center gap-1.5 disabled:opacity-40"
                      style={{ backgroundColor: drawing === 'add' ? ADD_COLOR : SUB_COLOR }}>
                      <Check className="w-4 h-4" /> Finish
                    </button>
                    <button onClick={undoPoint} disabled={draftCount === 0}
                      className="min-h-[44px] px-3 rounded-xl bg-white/95 text-slate-700 border border-slate-300 text-[12px] font-black uppercase tracking-widest shadow-lg inline-flex items-center gap-1.5 disabled:opacity-40">
                      Undo point
                    </button>
                    <button onClick={cancelDraw}
                      className="min-h-[44px] px-3 rounded-xl bg-white/95 text-slate-700 border border-slate-300 text-[12px] font-black uppercase tracking-widest shadow-lg inline-flex items-center gap-1.5">
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <div className="pointer-events-auto flex gap-2 flex-wrap">
                  <button onClick={() => startDraw('add')}
                    className="min-h-[44px] px-3 rounded-xl text-white text-[12px] font-black uppercase tracking-widest shadow-lg inline-flex items-center gap-1.5"
                    style={{ backgroundColor: ADD_COLOR }}>
                    <Plus className="w-4 h-4" /> Add area
                  </button>
                  <button onClick={() => startDraw('subtract')}
                    className="min-h-[44px] px-3 rounded-xl text-white text-[12px] font-black uppercase tracking-widest shadow-lg inline-flex items-center gap-1.5"
                    style={{ backgroundColor: SUB_COLOR }}>
                    <Minus className="w-4 h-4" /> Exclude
                  </button>
                  {shapes.length > 0 && (
                    <button onClick={clearAll}
                      className="min-h-[44px] px-3 rounded-xl bg-white/95 text-slate-700 border border-slate-300 text-[12px] font-black uppercase tracking-widest shadow-lg inline-flex items-center gap-1.5">
                      <Trash2 className="w-4 h-4" /> Clear
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom panel — shapes list, total, accuracy note, Use */}
        <div className="shrink-0 border-t border-slate-200 bg-white">
          {shapes.length > 0 && (
            <div className="max-h-32 overflow-y-auto px-3 py-2 space-y-1 border-b border-slate-100">
              {shapes.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2 text-[13px]">
                  <button onClick={() => toggleMode(s.id)}
                    title="Toggle add / subtract"
                    className="w-7 h-7 shrink-0 rounded-md text-white inline-flex items-center justify-center font-black"
                    style={{ backgroundColor: s.mode === 'add' ? ADD_COLOR : SUB_COLOR }}>
                    {s.mode === 'add' ? <Plus className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                  </button>
                  <span className="font-bold text-slate-700">{s.mode === 'add' ? 'Area' : 'Exclusion'} {i + 1}</span>
                  <span className="font-mono text-slate-500 ml-auto">{s.mode === 'add' ? '+' : '−'} {fmtSqft(s.sqft)}</span>
                  <button onClick={() => deleteShape(s.id)} aria-label="Delete shape" className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-slate-400 hover:text-rose-600">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="px-3 py-3 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Measured total</div>
              <div className="text-3xl font-black font-mono leading-none" style={{ color: GREEN }}>{fmtSqft(total)}</div>
              <div className="text-[11px] text-slate-500 mt-1">
                {shapes.length === 0
                  ? 'Draw the lawn to measure it.'
                  : `${addCount} area${addCount === 1 ? '' : 's'}${subCount ? ` − ${subCount} exclusion${subCount === 1 ? '' : 's'}` : ''}`}
              </div>
              {address && <div className="text-[11px] text-slate-400 truncate flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3 shrink-0" /> {address}</div>}
            </div>
            <button onClick={() => { if (total > 0) { rememberLocation(); onUse(buildMeasurement()); onClose(); } }} disabled={total <= 0}
              className="shrink-0 min-h-[48px] px-5 rounded-xl text-white text-xs font-black uppercase tracking-widest inline-flex items-center gap-1.5 disabled:opacity-40" style={{ backgroundColor: GREEN }}>
              <Check className="w-4 h-4" /> Use this measurement
            </button>
          </div>
          <div className="px-3 pb-3 -mt-1">
            <div className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Satellite estimate — verify on site for material orders.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

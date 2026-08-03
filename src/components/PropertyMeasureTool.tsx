import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, Plus, Minus, Trash2, MapPin, AlertTriangle, Check, Loader2, Pencil } from 'lucide-react';
import { loadGoogleMaps, M2_TO_SQFT } from '../lib/googleMaps';
import { PropertyMeasurement } from '../types';

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
  const [shapes, setShapes] = useState<ShapeView[]>([]);
  const [drawing, setDrawing] = useState<Mode | null>(null);
  const [address, setAddress] = useState<string | undefined>(initial?.address || initialAddress);

  const mapDivRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const dmRef = useRef<any>(null);
  const shapesRef = useRef<ShapeRef[]>([]);
  const pendingModeRef = useRef<Mode>('add');

  const styleFor = (mode: Mode) => ({
    strokeColor: mode === 'add' ? ADD_COLOR : SUB_COLOR,
    strokeWeight: 2.5, strokeOpacity: 0.95,
    fillColor: mode === 'add' ? ADD_COLOR : SUB_COLOR,
    fillOpacity: mode === 'add' ? 0.22 : 0.38,
    editable: true, draggable: true, clickable: true,
    zIndex: mode === 'add' ? 1 : 2,
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

  const startDraw = (mode: Mode) => {
    const dm = dmRef.current; if (!dm) return;
    pendingModeRef.current = mode;
    dm.setOptions({ polygonOptions: styleFor(mode) });
    dm.setDrawingMode('polygon');
    setDrawing(mode);
  };
  const cancelDraw = () => { dmRef.current?.setDrawingMode(null); setDrawing(null); };

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
    loadGoogleMaps().then(g => {
      if (cancelled || !mapDivRef.current) return;
      gRef.current = g;
      const seedCenter = initial?.polygons?.[0]?.path?.[0] || initial?.exclusions?.[0]?.path?.[0] || { lat: 43.653, lng: -79.383 };
      const map = new g.maps.Map(mapDivRef.current, {
        center: seedCenter, zoom: initial ? 20 : 19,
        mapTypeId: 'hybrid',            // satellite imagery + street labels (easier to locate the lot)
        tilt: 0, gestureHandling: 'greedy', disableDefaultUI: true,
        zoomControl: true, clickableIcons: false,
      });
      mapRef.current = map;
      const dm = new g.maps.drawing.DrawingManager({ drawingMode: null, drawingControl: false, polygonOptions: styleFor('add') });
      dm.setMap(map);
      dmRef.current = dm;
      g.maps.event.addListener(dm, 'polygoncomplete', (poly: any) => {
        dm.setDrawingMode(null);
        setDrawing(null);
        addShape(poly, pendingModeRef.current);
      });
      // Address search (Places Autocomplete) — pan/zoom to the result.
      if (searchRef.current) {
        const ac = new g.maps.places.Autocomplete(searchRef.current, { fields: ['geometry', 'formatted_address'] });
        ac.bindTo('bounds', map);
        g.maps.event.addListener(ac, 'place_changed', () => {
          const place = ac.getPlace();
          if (!place?.geometry) return;
          if (place.geometry.viewport) map.fitBounds(place.geometry.viewport);
          else { map.setCenter(place.geometry.location); map.setZoom(20); }
          setAddress(place.formatted_address);
        });
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
    }).catch(() => { if (!cancelled) setStatus('error'); });
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

  return (
    <div className="fixed inset-0 z-[140] bg-black/70 flex flex-col md:items-center md:justify-center md:p-4">
      <div className="bg-white w-full h-full md:h-[90vh] md:max-w-2xl md:rounded-2xl overflow-hidden flex flex-col shadow-2xl">
        {/* Header — search + close */}
        <div className="px-3 py-2.5 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input ref={searchRef} placeholder="Search an address…" disabled={status !== 'ready'}
              className="w-full border border-slate-300 rounded-lg pl-8 pr-3 py-2.5 text-sm outline-none focus:border-slate-500 disabled:bg-slate-50" />
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
              <button onClick={onClose} className="mt-2 min-h-[44px] px-4 rounded-xl text-white text-xs font-black uppercase tracking-widest" style={{ backgroundColor: GREEN }}>Back to quote</button>
            </div>
          )}

          {/* Draw controls — overlaid bottom-left of the map, thumb-reachable */}
          {status === 'ready' && (
            <div className="absolute left-2 bottom-2 right-2 flex flex-col items-start gap-2 pointer-events-none">
              {drawing && (
                <div className="pointer-events-auto bg-black/75 text-white text-[12px] font-bold rounded-lg px-3 py-1.5 flex items-center gap-2">
                  <Pencil className="w-3.5 h-3.5" /> Tap corners; tap the first point to finish.
                  <button onClick={cancelDraw} className="underline ml-1">Cancel</button>
                </div>
              )}
              <div className="pointer-events-auto flex gap-2 flex-wrap">
                <button onClick={() => startDraw('add')}
                  className="min-h-[44px] px-3 rounded-xl text-white text-[12px] font-black uppercase tracking-widest shadow-lg inline-flex items-center gap-1.5"
                  style={{ backgroundColor: drawing === 'add' ? '#0f7a34' : ADD_COLOR }}>
                  <Plus className="w-4 h-4" /> Add area
                </button>
                <button onClick={() => startDraw('subtract')}
                  className="min-h-[44px] px-3 rounded-xl text-white text-[12px] font-black uppercase tracking-widest shadow-lg inline-flex items-center gap-1.5"
                  style={{ backgroundColor: drawing === 'subtract' ? '#a30f0f' : SUB_COLOR }}>
                  <Minus className="w-4 h-4" /> Exclude
                </button>
                {shapes.length > 0 && (
                  <button onClick={clearAll}
                    className="min-h-[44px] px-3 rounded-xl bg-white/95 text-slate-700 border border-slate-300 text-[12px] font-black uppercase tracking-widest shadow-lg inline-flex items-center gap-1.5">
                    <Trash2 className="w-4 h-4" /> Clear
                  </button>
                )}
              </div>
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
            <button onClick={() => { if (total > 0) { onUse(buildMeasurement()); onClose(); } }} disabled={total <= 0}
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

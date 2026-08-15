// SNOWMASTER · CONTRACT EDITOR.
//
// Two-pane on desktop with a draggable split, tabbed on mobile. The right pane
// is the SAME SnowContractDocument the print view renders — the preview is not
// an approximation of the output, it IS the output.
//
// Autosave on blur; no save button. Derived figures (instalment, prepay,
// per-visit total) recompute on every edit through withDerived, so they can
// never be stale relative to the totals they describe.
//
// THE TYPING TEST: filling in a contract end to end should feel like a normal
// web form, not like editing a compressed document. That is why the controls
// here are full height with 15px text rather than the dense 12px the printed
// document uses — the form is a data-entry surface, and the only place the
// document's own scale belongs is the preview pane.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeft, Check, ChevronDown, Loader2, Plus, Trash2, Printer, Copy, Ruler, Upload, X,
} from 'lucide-react';
import type { SnowContract, SnowContractStatus, PropertyMeasurement, SnowPhotoView } from '../types';
import SnowContractDocument from './SnowContractDocument';
import PropertyMeasureTool from './PropertyMeasureTool';
import {
  withDerived, STATUS_LABEL, DEFAULT_CGL, needsRequote, validUntilFrom,
  instalmentAmount, prepayTotal, calledInRate, selectedPrice,
  photoView, photoStyle, photoSlackPx, clampPhotoView, DEFAULT_PHOTO_VIEW,
} from '../lib/snowContracts';
import { areaLabel } from '../lib/snowContractMap';
import { SECTIONS, SERVICE_LEVELS } from '../lib/snowContractText';

interface Props {
  contract: SnowContract;
  onChange: (next: SnowContract) => void;      // autosave on blur
  onBack: () => void;
  onPrint: () => void;
  onDuplicate: () => void;
  onUploadMap: (file: File) => Promise<string | null>;
  canEdit: boolean;
  saving: 'idle' | 'saving' | 'saved';
  currentUser: { email: string; name: string };
}

// 44px is the thumb-sized minimum; 15px text is what stops this reading as a
// spreadsheet. Both apply on every breakpoint — a phone gets the same control,
// full width, not a shrunken one.
const inputCls = 'w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2.5 '
  + 'text-[15px] leading-snug text-slate-900 outline-none transition '
  + 'focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 '
  + 'disabled:bg-slate-50 disabled:text-slate-500';
const areaCls = `${inputCls} min-h-[92px] resize-y`;

const L = ({ children }: { children: ReactNode }) => (
  <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-500">{children}</span>
);

// Label ABOVE the control, always — a label beside a field is the first thing
// that breaks when the pane narrows.
const Field = ({ label, span, children }: { label: string; span?: boolean; children: ReactNode }) => (
  <label className={`block${span ? ' sm:col-span-2' : ''}`}><L>{label}</L>{children}</label>
);

const SPLIT_KEY = 'snowContractSplitPct';
const PAPER_W = 8.5 * 96;

// ── THE PHOTO FRAME ────────────────────────────────────────────────────────
// A site photo is almost never banner-shaped, so cover-and-centre crops
// wherever the camera happened to be pointing — and a badly framed photo on
// page 1 is worse than no photo. This is the reference's drag-and-zoom in
// intent; the arithmetic is object-position rather than a translate, because a
// translate can be dragged past the photo's own edge and leave the banner
// empty. See photoStyle in snowContracts.ts.
//
// The printed banner FLEXES (it absorbs page 1's leftover height), so this box
// matches its width-to-height ratio closely rather than exactly. Cover framing
// is forgiving of that: the crop is expressed as a position within the photo,
// not as a pixel offset, so it means the same thing in a banner of any size.
const FRAME_RATIO = 720 / 190;

function PhotoFrame({
  src, view, disabled, onChange,
}: {
  src: string;
  view: SnowPhotoView;
  disabled: boolean;
  onChange: (v: SnowPhotoView) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // Live during a drag; committed on release. Dragging writes one save, not
  // one per pointer event.
  const [live, setLive] = useState<SnowPhotoView | null>(null);
  const drag = useRef<{ x: number; y: number; from: SnowPhotoView } | null>(null);
  const v = live || view;

  const boxOf = () => {
    const r = boxRef.current?.getBoundingClientRect();
    return { w: r?.width || 0, h: r?.height || 0 };
  };
  const natOf = () => ({
    w: imgRef.current?.naturalWidth || 0,
    h: imgRef.current?.naturalHeight || 0,
  });
  const commit = (next: SnowPhotoView) => {
    setLive(null);
    onChange(clampPhotoView(next));
  };

  const onDown = (e: React.PointerEvent) => {
    if (disabled) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, from: v };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const box = boxOf();
    const slack = photoSlackPx(box, natOf());
    if (!box.w || !box.h) return;
    // Screen pixels → crop movement. The photo follows the pointer, so the
    // crop moves the other way; a drag of the full overflow moves the crop
    // its whole range. An axis with no overflow does not move at all.
    const z = d.from.zoom || 1;
    setLive(clampPhotoView({
      ...d.from,
      x: slack.x ? d.from.x - ((e.clientX - d.x) / z / slack.x) * 100 : d.from.x,
      y: slack.y ? d.from.y - ((e.clientY - d.y) / z / slack.y) * 100 : d.from.y,
    }));
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (live) commit(live);
  };

  const btn = 'min-h-[36px] rounded-lg border border-slate-300 bg-white px-2.5 text-[11px] '
    + 'font-black uppercase tracking-widest text-slate-600 hover:border-sky-500 hover:text-sky-700 '
    + 'disabled:opacity-40';

  return (
    <div className="space-y-2">
      <div
        ref={boxRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ aspectRatio: String(FRAME_RATIO) }}
        className={`relative w-full overflow-hidden rounded-lg border border-slate-300 bg-slate-100 ${
          disabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
      >
        <img
          ref={imgRef}
          src={src}
          alt="Site photo framing"
          draggable={false}
          onLoad={() => setLive(null)}
          className="h-full w-full select-none"
          style={{ ...photoStyle(v), transformOrigin: 'center' }}
        />
        {/* The printed banner is this shape. Saying so beats guessing. */}
        <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white">
          page 1 banner
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-slate-500">Drag to reposition</span>
        <button type="button" disabled={disabled} className={btn}
          onClick={() => commit({ ...v, zoom: v.zoom + 0.15 })}>Zoom +</button>
        <button type="button" disabled={disabled} className={btn}
          onClick={() => commit({ ...v, zoom: v.zoom - 0.15 })}>Zoom −</button>
        <button type="button" disabled={disabled} className={btn}
          onClick={() => commit({ zoom: 1, x: 0, y: 0, fit: !v.fit })}>
          {v.fit ? 'Fill banner' : 'Show whole photo'}
        </button>
        <button type="button" disabled={disabled} className={btn}
          onClick={() => commit({ ...DEFAULT_PHOTO_VIEW })}>Reset</button>
        <span className="text-[11px] font-mono text-slate-400">
          {Math.round(v.zoom * 100)}%
        </span>
      </div>
    </div>
  );
}

export default function SnowContractEditor({
  contract, onChange, onBack, onPrint, onDuplicate, onUploadMap, canEdit, saving, currentUser,
}: Props) {
  const [pane, setPane] = useState<'form' | 'preview'>('form');
  const [measuring, setMeasuring] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  // ONE file input, two destinations — which one the last click was for.
  const uploadTarget = useRef<'photo' | 'map'>('photo');
  const c = contract;
  // Derived figures the FORM shows and the document does not print.
  const sel = selectedPrice(c);
  const calledIn = calledInRate(c);

  // ── DRAGGABLE SPLIT ──────────────────────────────────────────────────────
  // Remembered per browser: how much room the form deserves depends on the
  // screen and on whether you are typing or reviewing, and that is not a
  // decision worth re-making every time the editor opens.
  const [split, setSplit] = useState(() => {
    const v = Number(localStorage.getItem(SPLIT_KEY));
    return v >= 30 && v <= 75 ? v : 55;
  });
  const splitHostRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current || !splitHostRef.current) return;
      const r = splitHostRef.current.getBoundingClientRect();
      const pct = Math.min(75, Math.max(30, ((e.clientX - r.left) / r.width) * 100));
      setSplit(pct);
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = '';
      setSplit(p => { localStorage.setItem(SPLIT_KEY, String(Math.round(p))); return p; });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  // ── PREVIEW SCALE-TO-FIT ─────────────────────────────────────────────────
  // The sheet is a fixed 8.5in wide; the pane is not. Measure and scale so a
  // full page width is always visible, however the split is dragged.
  const previewHostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.78);
  const [docH, setDocH] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = previewHostRef.current;
    if (!host) return;
    const measure = () => {
      const w = host.clientWidth - 24;             // the pane's own padding
      if (w > 0) setScale(Math.min(1, w / PAPER_W));
      // transform:scale leaves the ORIGINAL height in the flow, so the pane
      // would keep a tall empty gap under a scaled-down page. Carry the scaled
      // height explicitly instead.
      if (sheetRef.current) setDocH(sheetRef.current.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    if (sheetRef.current) ro.observe(sheetRef.current);
    return () => ro.disconnect();
  }, []);

  // Every edit routes through here so derived figures stay honest.
  const patch = (fn: (draft: SnowContract) => void) => {
    const draft: SnowContract = JSON.parse(JSON.stringify(c));
    fn(draft);
    onChange(withDerived({ ...draft, updatedAt: Date.now() }));
  };

  const hidden = useMemo(() => new Set(c.hiddenSections || []), [c.hiddenSections]);
  const hiddenList = SECTIONS.filter(s => hidden.has(s.id));
  const removeSection = (id: string) => patch(d => { d.hiddenSections = [...new Set([...(d.hiddenSections || []), id])]; });
  const restoreSection = (id: string) => patch(d => { d.hiddenSections = (d.hiddenSections || []).filter(x => x !== id); });
  const toggle = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Collapsible, because fourteen sections open at once is a scroll problem, not
  // a form. Open by default: a section you cannot see is a section you forget.
  const Section = ({ id, children }: { id: string; children: ReactNode }) => {
    const s = SECTIONS.find(x => x.id === id)!;
    if (hidden.has(id)) return null;
    const shut = collapsed.has(id);
    return (
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-1 px-4 py-3">
          <button type="button" onClick={() => toggle(id)}
            className="flex min-h-[36px] flex-1 items-center gap-2 text-left"
            aria-expanded={!shut}>
            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${shut ? '-rotate-90' : ''}`} />
            <h3 className="text-[15px] font-black text-slate-800">
              <span className="mr-1.5 text-slate-300">{s.n}</span>{s.title}
            </h3>
          </button>
          {canEdit && (
            <button type="button" onClick={() => removeSection(id)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:border-rose-200 hover:text-rose-600">
              remove
            </button>
          )}
        </div>
        {!shut && <div className="space-y-5 border-t border-slate-100 px-4 py-5">{children}</div>}
      </section>
    );
  };

  const measurementUsed = (m: PropertyMeasurement) => {
    patch(d => {
      d.scope.measurement = m;
      // Serviced area only — plow and shovel. Storage and hazard areas are
      // drawn for the map, not counted (see SnowAreaSpec.counts).
      d.scope.measuredSqft = m.totalSqft;
      if (m.address && !d.client.serviceAddress) d.client.serviceAddress = m.address;
    });
    setMeasuring(false);
  };

  const form = (
    <div className="space-y-4">
      {/* REMOVED-SECTION TRAY */}
      {hiddenList.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-100 p-4">
          <L>Removed from this contract — tap to restore</L>
          <div className="mt-1 flex flex-wrap gap-2">
            {hiddenList.map(s => (
              <button key={s.id} type="button" onClick={() => restoreSection(s.id)}
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-bold hover:border-sky-500 hover:text-sky-700">
                ↩ {s.title}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-slate-500">
            Removing a section hides it from the printed contract only — the content is kept.
          </p>
        </div>
      )}

      {/* A MIGRATED CONTRACT states neither of the two things the old shape
          could not express. Say so at the top of the form rather than letting
          a level-less contract print with nothing ticked. */}
      {needsRequote(c) && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="text-[13px] font-black uppercase tracking-wider text-amber-800">
            Re-quote needed
          </div>
          <p className="mt-1 text-[13px] text-amber-900">
            This contract was written before service levels existed. Its old services matrix
            cannot be read as a level, so no level and no prices were carried over — choose a
            level in Section 3 and enter the pricing in Section 4.
          </p>
          {c.legacyPricing && (
            <p className="mt-1.5 text-[12px] font-bold text-amber-800">
              Previously quoted: ${c.legacyPricing.seasonalTotal.toLocaleString('en-US')} seasonal
              {c.legacyPricing.perVisitTotal ? ` · $${c.legacyPricing.perVisitTotal.toLocaleString('en-US')} per visit` : ''}
              {' '}— for reference only, never printed.
            </p>
          )}
        </div>
      )}

      {/* STATUS + THE HEADER BLOCK. Quote date and validity print above
          Section 1 and are what Acceptance cross-references. */}
      <div className="grid gap-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Status">
          <select disabled={!canEdit} value={c.status} className={inputCls}
            onChange={e => patch(d => {
              const s = e.target.value as SnowContractStatus;
              d.status = s;
              if (s === 'sent' && !d.sentAt) d.sentAt = Date.now();
              if (s === 'signed') { d.signedAt = Date.now(); d.signedBy = currentUser.name; }
            })}>
            {(Object.keys(STATUS_LABEL) as SnowContractStatus[]).map(s =>
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Season">
          <input disabled={!canEdit} className={inputCls} defaultValue={c.season}
            onBlur={e => patch(d => { d.season = e.target.value; })} />
        </Field>
        <Field label="Quote date">
          <input type="date" disabled={!canEdit} className={inputCls} defaultValue={c.quoteDate}
            onBlur={e => patch(d => {
              d.quoteDate = e.target.value;
              // Keep the two dates together unless the validity has been set
              // by hand: a re-dated quote that keeps last month's expiry is a
              // quote that was already dead when it was sent.
              if (!d.validUntil || d.validUntil === validUntilFrom(c.quoteDate)) {
                d.validUntil = validUntilFrom(e.target.value);
              }
            })} />
        </Field>
        <Field label="Valid until">
          <input type="date" disabled={!canEdit} className={inputCls} defaultValue={c.validUntil}
            onBlur={e => patch(d => { d.validUntil = e.target.value; })} />
        </Field>
        <Field label="Term start">
          <input type="date" disabled={!canEdit} className={inputCls} defaultValue={c.term.start}
            onBlur={e => patch(d => { d.term.start = e.target.value; })} />
        </Field>
        <Field label="Term end">
          <input type="date" disabled={!canEdit} className={inputCls} defaultValue={c.term.end}
            onBlur={e => patch(d => { d.term.end = e.target.value; })} />
        </Field>
      </div>

      {/* 1 · CLIENT DETAILS */}
      <Section id="client">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Service address" span>
            <input disabled={!canEdit} className={inputCls} defaultValue={c.client.serviceAddress}
              onBlur={e => patch(d => { d.client.serviceAddress = e.target.value; })} />
          </Field>
          {([
            ['businessName', 'Client / business name'],
            ['siteContact', 'Site contact + phone'],
            ['billingContact', 'Billing contact + phone'],
            ['billingEmail', 'Billing email'],
          ] as ['businessName' | 'siteContact' | 'billingContact' | 'billingEmail', string][]).map(([k, label]) => (
            <Field key={k} label={label}>
              <input disabled={!canEdit} className={inputCls} defaultValue={c.client[k]}
                onBlur={e => patch(d => { d.client[k] = e.target.value; })} />
            </Field>
          ))}
          <Field label="Billing address (if different)" span>
            <input disabled={!canEdit} className={inputCls} defaultValue={c.client.billingAddress}
              onBlur={e => patch(d => { d.client.billingAddress = e.target.value; })} />
          </Field>
        </div>
      </Section>

      {/* 2 · PROPERTY SCOPE — two text fields and the map. Everything the old
          six-row table described is now drawn on the map instead. */}
      <Section id="scope">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Plow area">
            <textarea disabled={!canEdit} className={areaCls} defaultValue={c.scope.plowArea}
              placeholder="Main customer lot, rear dock, drive aisle"
              onBlur={e => patch(d => { d.scope.plowArea = e.target.value; })} />
          </Field>
          <Field label="Shovel area">
            <textarea disabled={!canEdit} className={areaCls} defaultValue={c.scope.shovelArea}
              placeholder="Front apron, accessible ramp, dock path"
              onBlur={e => patch(d => { d.scope.shovelArea = e.target.value; })} />
          </Field>
        </div>

        <div className="space-y-3 border-t border-slate-100 pt-4">
          <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-2.5 text-[14px] font-bold text-slate-700">
            <input type="checkbox" className="h-5 w-5" checked={!c.scope.showMap} disabled={!canEdit}
              onChange={e => patch(d => { d.scope.showMap = !e.target.checked; })} />
            Hide the service area map
          </label>
          <div className="flex flex-wrap items-center gap-2.5">
            {/* THE SHARED MEASURING TOOL — the SalesMaster component, mounted
                with the snow palette. No second drawing implementation. */}
            {c.scope.showMap && (
              <button type="button" disabled={!canEdit} onClick={() => setMeasuring(true)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-slate-800 px-4 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50">
                <Ruler className="h-4 w-4" />
                {c.scope.measurement ? 'Re-draw service areas' : 'Draw service areas on satellite'}
              </button>
            )}
            <button type="button" disabled={!canEdit || uploading} onClick={() => { uploadTarget.current = 'photo'; fileRef.current?.click(); }}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 px-4 text-xs font-black uppercase tracking-widest disabled:opacity-50">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {c.scope.sitePhoto ? 'Replace site photo' : 'Upload site photo'}
            </button>
            {c.scope.sitePhoto && canEdit && (
              <button type="button" onClick={() => patch(d => { d.scope.sitePhoto = undefined; d.scope.sitePhotoView = undefined; })}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[12px] font-bold text-slate-500 hover:border-rose-200 hover:text-rose-600">
                <X className="h-4 w-4" /> remove photo
              </button>
            )}
            {c.scope.showMap && (
              <button type="button" disabled={!canEdit || uploading} onClick={() => { uploadTarget.current = 'map'; fileRef.current?.click(); }}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 px-4 text-xs font-black uppercase tracking-widest disabled:opacity-50">
                <Upload className="h-4 w-4" /> Map image (fallback)
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={async e => {
                const f = e.target.files?.[0];
                if (!f) return;
                const target = uploadTarget.current;
                setUploading(true);
                const url = await onUploadMap(f);
                setUploading(false);
                if (url) {
                  patch(d => {
                    if (target === 'photo') {
                      d.scope.sitePhoto = url;
                      // A new photo starts centred and filling the banner. The
                      // previous photo's crop describes a picture that is no
                      // longer there.
                      d.scope.sitePhotoView = { ...DEFAULT_PHOTO_VIEW };
                    } else d.scope.mapImages = [url];
                  });
                }
                if (fileRef.current) fileRef.current.value = '';
              }} />
            {/* FRAME THE PHOTO. Only once there is one — an empty banner has
                nothing to frame, and the control would be furniture. */}
            {c.scope.sitePhoto && (
              <div className="w-full">
                <L>Framing — this is the page 1 banner</L>
                <PhotoFrame
                  src={c.scope.sitePhoto}
                  view={photoView(c)}
                  disabled={!canEdit}
                  onChange={v => patch(d => { d.scope.sitePhotoView = v; })}
                />
              </div>
            )}
            {c.scope.measuredSqft != null && (
              <span className="w-full text-[12px] font-bold text-emerald-700">
                {areaLabel(c.scope.measuredSqft)} of serviced area (plow + shovel) — the printed
                map and legend draw from this outline
              </span>
            )}
          </div>
        </div>
      </Section>

      {/* 3 · SERVICE LEVEL */}
      <Section id="services">
        <div>
          <L>Client selects one level</L>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {SERVICE_LEVELS.map(l => (
              <button key={l.n} type="button" disabled={!canEdit}
                onClick={() => patch(d => { d.serviceLevel = d.serviceLevel === l.n ? null : l.n; })}
                className={`rounded-lg border p-3 text-left ${c.serviceLevel === l.n
                  ? 'border-sky-700 bg-sky-50 ring-2 ring-sky-500/30' : 'border-slate-300 bg-white hover:bg-slate-50'}`}>
                <div className="text-[15px] font-black text-slate-800">Level {l.n}</div>
                <div className="text-[12px] font-bold text-slate-500">{l.short}</div>
              </button>
            ))}
          </div>
        </div>
        <p className="text-[12px] text-slate-500">
          What each level includes is fixed contract text and prints in full. Level 1 has no ice
          control of any kind — not even on call.
        </p>
      </Section>

      {/* 4 · PRICING — all three levels quoted, both ways. */}
      <Section id="pricing">
        <div>
          <L>Price every level — the client chooses from the printed table</L>
          <div className="space-y-3">
            {SERVICE_LEVELS.map(l => (
              <div key={l.n} className={`grid gap-3 rounded-lg border p-3 sm:grid-cols-[7rem_1fr_1fr] ${
                c.serviceLevel === l.n ? 'border-sky-300 bg-sky-50/40' : 'border-slate-200'}`}>
                <div className="self-center">
                  <div className="text-[14px] font-black text-slate-800">Level {l.n}</div>
                  <div className="text-[11px] font-bold text-slate-400">{l.short}</div>
                </div>
                <Field label="Seasonal (Option A)">
                  <input type="number" step="0.01" inputMode="decimal" disabled={!canEdit} className={`${inputCls} text-right`}
                    defaultValue={c.pricing.levels[l.n]?.seasonal || ''} placeholder="—"
                    onBlur={e => patch(d => { d.pricing.levels[l.n].seasonal = Number(e.target.value) || 0; })} />
                </Field>
                <Field label="Per visit (Option B)">
                  <input type="number" step="0.01" inputMode="decimal" disabled={!canEdit} className={`${inputCls} text-right`}
                    defaultValue={c.pricing.levels[l.n]?.perVisit || ''} placeholder="—"
                    onBlur={e => patch(d => { d.pricing.levels[l.n].perVisit = Number(e.target.value) || 0; })} />
                </Field>
              </div>
            ))}
          </div>
        </div>

        <div>
          <L>Client selects one pricing option</L>
          <div className="flex flex-wrap gap-2.5">
            {(['A', 'B'] as const).map(o => (
              <button key={o} type="button" disabled={!canEdit}
                onClick={() => patch(d => {
                  d.pricing.selectedOption = d.pricing.selectedOption === o ? null : o;
                  // Option B has no payment choice to make; clear a stale one
                  // rather than printing a tick under an option nobody picked.
                  if (d.pricing.selectedOption !== 'A') d.pricing.optionAPayment = null;
                })}
                className={`min-h-[44px] rounded-lg border px-4 text-xs font-black uppercase tracking-widest ${c.pricing.selectedOption === o
                  ? 'border-sky-800 bg-sky-700 text-white' : 'border-slate-300 bg-white text-slate-600'}`}>
                Option {o} — {o === 'A' ? 'seasonal' : 'per visit'}
              </button>
            ))}
          </div>
        </div>

        {c.pricing.selectedOption === 'A' && (
          <div className="space-y-4 rounded-lg border border-slate-200 p-3.5">
            <div>
              <L>Option A payment</L>
              <div className="flex flex-wrap gap-2.5">
                {([['instalments', '6 monthly instalments'], ['prepay', 'Paid in full — 5% off']] as const).map(([k, label]) => (
                  <button key={k} type="button" disabled={!canEdit}
                    onClick={() => patch(d => { d.pricing.optionAPayment = d.pricing.optionAPayment === k ? null : k; })}
                    className={`min-h-[44px] rounded-lg border px-4 text-xs font-black uppercase tracking-widest ${c.pricing.optionAPayment === k
                      ? 'border-sky-800 bg-sky-700 text-white' : 'border-slate-300 bg-white text-slate-600'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Prepay deadline">
                <input type="date" disabled={!canEdit} className={inputCls} defaultValue={c.pricing.prepayDeadline}
                  onBlur={e => patch(d => { d.pricing.prepayDeadline = e.target.value; })} />
              </Field>
              {/* WORKED OUT, NOT PRINTED. The document states the rule; these
                  are here so whoever is quoting sees what it comes to. */}
              <div><L>Each instalment</L>
                <div className="min-h-[44px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-[15px] font-black text-slate-700">
                  {sel ? `$${instalmentAmount(sel.seasonal).toFixed(2)}` : '—'}
                </div>
              </div>
              <div><L>Paid in full (5% off)</L>
                <div className="min-h-[44px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-[15px] font-black text-emerald-700">
                  {sel ? `$${prepayTotal(sel.seasonal).toFixed(2)}` : '—'}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
          <L>Additional services — derived, printed as rules not figures</L>
          <ul className="space-y-1 text-[13px] text-slate-600">
            <li>
              Called-in sanding / salting:{' '}
              <b>{c.serviceLevel === 1
                ? 'not available at Level 1'
                : calledIn != null && calledIn > 0 ? `$${calledIn.toFixed(2)} (50% of the Level 2 per-visit rate)` : 'set the Level 2 per-visit rate'}</b>
            </li>
            <li>
              Plowing called in below the trigger depth:{' '}
              <b>{sel && sel.perVisit > 0 ? `$${sel.perVisit.toFixed(2)} (this level's full per-visit rate)` : 'set the per-visit rate'}</b>
            </li>
            <li>Relocation / haul-away: <b>quoted when requested</b> — not included at any level.</li>
          </ul>
        </div>
      </Section>

      {/* 5 · TRIGGER & RESPONSE */}
      <Section id="trigger">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Trigger depth">
            <input disabled={!canEdit} className={inputCls} defaultValue={c.serviceTerms.triggerDepth}
              onBlur={e => patch(d => { d.serviceTerms.triggerDepth = e.target.value; })} />
          </Field>
          <div><L>Assigned service window</L>
            <div className="flex w-fit overflow-hidden rounded-lg border border-slate-300">
              {([['overnight', 'Overnight'], ['daytime', 'Daytime'], ['nonPriority', 'Non-priority']] as const).map(([k, label]) => (
                <button key={k} type="button" disabled={!canEdit}
                  onClick={() => patch(d => { d.serviceTerms.serviceWindow = d.serviceTerms.serviceWindow === k ? null : k; })}
                  className={`min-h-[44px] px-4 text-[11px] font-black uppercase tracking-widest ${c.serviceTerms.serviceWindow === k ? 'bg-sky-700 text-white' : 'bg-white text-slate-500'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {([
            ['overnightCutoff', 'Overnight — snowfall ends by (a.m.)'],
            ['overnightClearBy', 'Overnight — cleared by (a.m.)'],
            ['daytimeHours', 'Daytime — within (hours)'],
            ['nonPriorityHours', 'Non-priority — within (hours)'],
          ] as ['overnightCutoff' | 'overnightClearBy' | 'daytimeHours' | 'nonPriorityHours', string][]).map(([k, label]) => (
            <Field key={k} label={label}>
              <input disabled={!canEdit} className={inputCls} defaultValue={c.serviceTerms[k]}
                onBlur={e => patch(d => { d.serviceTerms[k] = e.target.value; })} />
            </Field>
          ))}
        </div>
        <p className="text-[12px] text-slate-500">
          All three windows print with their response times; the assigned one is ticked. The
          bullets under this section are fixed contract terms and are not editable here.
        </p>
      </Section>

      {/* 11 · INSURANCE — one editable figure inside fixed text. */}
      <Section id="insurance">
        <Field label="Commercial General Liability — not less than ($)">
          <input disabled={!canEdit} className={inputCls} defaultValue={c.insurance.cglAmount}
            placeholder={DEFAULT_CGL}
            onBlur={e => patch(d => { d.insurance.cglAmount = e.target.value.trim() || DEFAULT_CGL; })} />
        </Field>
        <p className="text-[12px] text-slate-500">
          Printed inside the clause. The rest of the section — WSIB, certificates on request,
          additional-insured before the season — is fixed text.
        </p>
      </Section>

      {/* FIXED-TEXT SECTIONS — removable, not editable. */}
      {(['payment', 'damage', 'indemnity', 'ice', 'delays', 'termination', 'contact', 'acceptance'] as const).map(id => (
        <Section key={id} id={id}>
          <p className="text-[13px] text-slate-500">
            Fixed contract text. It can be removed from this contract, but not reworded here —
            the wording is the same on every agreement.
          </p>
        </Section>
      ))}
    </div>
  );

  const preview = (
    <div className="lg:sticky lg:top-3">
      <div className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
        Live preview — the same render the printed contract uses
      </div>
      <div ref={previewHostRef} className="overflow-auto rounded-xl bg-slate-200 p-3 lg:max-h-[84vh]">
        <div style={{ height: docH * scale }}>
          <div ref={sheetRef} className="bg-white shadow-lg"
            style={{ width: PAPER_W, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <SnowContractDocument contract={c} mode="preview" />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={onBack} className="p-2 text-slate-500 hover:text-slate-900" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="truncate font-black text-slate-900">
              {c.client.businessName || 'Untitled contract'}
            </div>
            <div className="text-[11px] font-bold text-slate-400">
              {c.season} · {STATUS_LABEL[c.status]}
              {saving === 'saving' && <span className="ml-2 inline-flex items-center gap-1 text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> saving…</span>}
              {saving === 'saved' && <span className="ml-2 inline-flex items-center gap-1 text-emerald-600"><Check className="h-3 w-3" /> saved</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* MOBILE: full-width tabs, thumb-sized. */}
          <div className="flex rounded-lg bg-slate-100 p-1 lg:hidden">
            {(['form', 'preview'] as const).map(p => (
              <button key={p} type="button" onClick={() => setPane(p)}
                className={`min-h-[40px] rounded px-4 text-xs font-black uppercase ${pane === p ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>
                {p}
              </button>
            ))}
          </div>
          {canEdit && (
            <button type="button" onClick={onDuplicate}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-black uppercase tracking-widest">
              <Copy className="h-3.5 w-3.5" /> Duplicate for next season
            </button>
          )}
          <button type="button" onClick={onPrint}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-slate-800 px-4 text-xs font-black uppercase tracking-widest text-white">
            <Printer className="h-3.5 w-3.5" /> Print / PDF
          </button>
        </div>
      </div>

      {/* TWO PANES — a dragged split on desktop, tabbed full-width on mobile. */}
      <div ref={splitHostRef} className="lg:grid lg:gap-0"
        style={{ gridTemplateColumns: `${split}% 14px minmax(0,1fr)` }}>
        <div className={pane === 'form' ? '' : 'hidden lg:block'}>{form}</div>
        <div
          onPointerDown={() => { dragging.current = true; document.body.style.userSelect = 'none'; }}
          className="hidden lg:flex lg:cursor-col-resize lg:items-center lg:justify-center"
          role="separator" aria-orientation="vertical" aria-label="Resize form and preview">
          <div className="h-16 w-1.5 rounded-full bg-slate-300 transition-colors hover:bg-sky-500" />
        </div>
        <div className={pane === 'preview' ? '' : 'hidden lg:block'}>{preview}</div>
      </div>

      {measuring && (
        <PropertyMeasureTool
          onClose={() => setMeasuring(false)}
          onUse={measurementUsed}
          currentUser={currentUser}
          initial={c.scope.measurement || null}
          initialAddress={c.client.serviceAddress}
          // The SAME tool the lawn quote uses, switched to the snow palette:
          // plow / shovel / storage / hazard instead of add / subtract.
          palette="snow"
        />
      )}
    </div>
  );
}

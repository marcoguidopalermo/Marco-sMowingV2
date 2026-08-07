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
import type { SnowContract, SnowContractStatus, SnowServiceStatus, PropertyMeasurement } from '../types';
import SnowContractDocument from './SnowContractDocument';
import PropertyMeasureTool from './PropertyMeasureTool';
import { withDerived, STATUS_LABEL } from '../lib/snowContracts';
import { areaLabel } from '../lib/snowContractMap';
import { SECTIONS } from '../lib/snowContractText';

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

export default function SnowContractEditor({
  contract, onChange, onBack, onPrint, onDuplicate, onUploadMap, canEdit, saving, currentUser,
}: Props) {
  const [pane, setPane] = useState<'form' | 'preview'>('form');
  const [measuring, setMeasuring] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const c = contract;

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

  // Collapsible, because eleven sections open at once is a scroll problem, not
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
      d.scope.measuredSqft = m.totalSqft;
      // Seeds the field; editable afterwards, so a re-measure doesn't clobber
      // a hand-written override silently — it only fills a blank or a value
      // that still matches the previous measurement.
      const prev = c.scope.measuredSqft;
      if (!d.scope.totalArea || (prev != null && d.scope.totalArea === areaLabel(prev))) {
        d.scope.totalArea = areaLabel(m.totalSqft);
      }
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

      {/* STATUS + TERM */}
      <div className="grid gap-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-4">
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
        <Field label="Term start">
          <input type="date" disabled={!canEdit} className={inputCls} defaultValue={c.term.start}
            onBlur={e => patch(d => { d.term.start = e.target.value; })} />
        </Field>
        <Field label="Term end">
          <input type="date" disabled={!canEdit} className={inputCls} defaultValue={c.term.end}
            onBlur={e => patch(d => { d.term.end = e.target.value; })} />
        </Field>
      </div>

      {/* 1 · CLIENT */}
      <Section id="client">
        <div className="grid gap-5 sm:grid-cols-2">
          {([
            ['businessName', 'Client / Business'], ['siteContact', 'Site Contact'],
            ['billingEmail', 'Billing Email'], ['phone', 'Phone'],
          ] as [keyof SnowContract['client'], string][]).map(([k, label]) => (
            <Field key={k} label={label}>
              <input disabled={!canEdit} className={inputCls} defaultValue={c.client[k]}
                onBlur={e => patch(d => { d.client[k] = e.target.value; })} />
            </Field>
          ))}
          <Field label="Service Address" span>
            <input disabled={!canEdit} className={inputCls} defaultValue={c.client.serviceAddress}
              onBlur={e => patch(d => { d.client.serviceAddress = e.target.value; })} />
          </Field>
        </div>
      </Section>

      {/* 2 · SCOPE — every one of these is prose in practice, so every one is
          a textarea. They were single-line inputs, which is why describing a
          lot meant typing into a slot that scrolled sideways. */}
      <Section id="scope">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Total Serviced Area">
            <input disabled={!canEdit} className={inputCls} defaultValue={String(c.scope.totalArea ?? '')}
              onBlur={e => patch(d => { d.scope.totalArea = e.target.value; })} />
          </Field>
          <Field label="Access Notes">
            <input disabled={!canEdit} className={inputCls} defaultValue={String(c.scope.accessNotes ?? '')}
              onBlur={e => patch(d => { d.scope.accessNotes = e.target.value; })} />
          </Field>
          {([
            ['lotAreas', 'Lot / Driving Areas'], ['walkwaysEntrances', 'Walkways & Entrances'],
            ['snowStorage', 'Snow Storage Locations'], ['markedHazards', 'Marked Hazards / Obstacles'],
          ] as [keyof SnowContract['scope'], string][]).map(([k, label]) => (
            <Field key={k} label={label}>
              <textarea disabled={!canEdit} className={areaCls} defaultValue={String(c.scope[k] ?? '')}
                onBlur={e => patch(d => { (d.scope as any)[k] = e.target.value; })} />
            </Field>
          ))}
        </div>
        <Field label="Scope Description">
          <textarea rows={8} disabled={!canEdit} className={`${inputCls} min-h-[180px] resize-y`}
            defaultValue={c.scope.description}
            onBlur={e => patch(d => { d.scope.description = e.target.value; })} />
        </Field>

        <div className="space-y-3 border-t border-slate-100 pt-4">
          <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-2.5 text-[14px] font-bold text-slate-700">
            <input type="checkbox" className="h-5 w-5" checked={!c.scope.showMap} disabled={!canEdit}
              onChange={e => patch(d => { d.scope.showMap = !e.target.checked; })} />
            Description only — hide the site map
          </label>
          {c.scope.showMap && (
            <div className="flex flex-wrap items-center gap-2.5">
              {/* THE SHARED MEASURING TOOL — the SalesMaster component, mounted
                  as-is. No second measuring implementation. */}
              <button type="button" disabled={!canEdit} onClick={() => setMeasuring(true)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-slate-800 px-4 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50">
                <Ruler className="h-4 w-4" />
                {c.scope.measurement ? 'Re-measure area' : 'Measure area on satellite'}
              </button>
              <button type="button" disabled={!canEdit || uploading} onClick={() => fileRef.current?.click()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 px-4 text-xs font-black uppercase tracking-widest disabled:opacity-50">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload image
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={async e => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setUploading(true);
                  const url = await onUploadMap(f);
                  setUploading(false);
                  if (url) patch(d => { d.scope.mapImages = [...(d.scope.mapImages || []), url].slice(0, 2); });
                  if (fileRef.current) fileRef.current.value = '';
                }} />
              {(c.scope.mapImages || []).map((src, i) => (
                <span key={i} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-2.5 text-[12px] font-bold">
                  image {i + 1}
                  {canEdit && (
                    <button type="button" onClick={() => patch(d => { d.scope.mapImages = d.scope.mapImages.filter((_, j) => j !== i); })}
                      className="text-slate-400 hover:text-rose-600"><X className="h-4 w-4" /></button>
                  )}
                </span>
              ))}
              {c.scope.measuredSqft != null && (
                <span className="w-full text-[12px] font-bold text-emerald-700">
                  {areaLabel(c.scope.measuredSqft)} measured — the printed map draws from this outline
                </span>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* 3 · SERVICES — stacked per row rather than crammed onto one line, and
          BLANK is a real, selectable state, not the absence of a click. */}
      <Section id="services">
        <div className="space-y-4">
          {c.services.map((s, i) => (
            <div key={s.key} className="rounded-lg border border-slate-200 p-3.5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Service">
                  <input disabled={!canEdit} className={`${inputCls} font-bold`} defaultValue={s.label}
                    onBlur={e => patch(d => { d.services[i].label = e.target.value; })} />
                </Field>
                <Field label="Detail">
                  <input disabled={!canEdit} className={inputCls} defaultValue={s.detail} placeholder="lot and driving areas"
                    onBlur={e => patch(d => { d.services[i].detail = e.target.value; })} />
                </Field>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr]">
                <div>
                  <L>Marked as</L>
                  <div className="flex overflow-hidden rounded-lg border border-slate-300">
                    {([
                      ['blank', '—'], ['included', 'Incl.'], ['onCall', 'On call'], ['excluded', 'Excl.'],
                    ] as [SnowServiceStatus, string][]).map(([st, text]) => (
                      <button key={st} type="button" disabled={!canEdit}
                        onClick={() => patch(d => { d.services[i].status = st; })}
                        title={st === 'blank' ? 'No box ticked — nothing stated about this service' : undefined}
                        className={`min-h-[44px] px-3.5 text-[11px] font-black uppercase tracking-widest ${s.status === st
                          ? (st === 'included' ? 'bg-emerald-600 text-white'
                            : st === 'onCall' ? 'bg-amber-500 text-white'
                            : st === 'excluded' ? 'bg-slate-600 text-white' : 'bg-slate-800 text-white')
                          : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
                <Field label="Scope / notes">
                  <input disabled={!canEdit} className={inputCls} defaultValue={s.notes}
                    onBlur={e => patch(d => { d.services[i].notes = e.target.value; })} />
                </Field>
              </div>
              {canEdit && s.custom && (
                <button type="button" onClick={() => patch(d => { d.services.splice(i, 1); })}
                  className="mt-3 inline-flex min-h-[36px] items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-rose-600">
                  <Trash2 className="h-4 w-4" /> remove row
                </button>
              )}
            </div>
          ))}
        </div>
        {canEdit && (
          <button type="button"
            onClick={() => patch(d => {
              d.services.push({ key: `custom-${Date.now()}`, label: 'New service', detail: '', status: 'blank', notes: '', custom: true });
            })}
            className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-black uppercase tracking-widest text-sky-700">
            <Plus className="h-4 w-4" /> add service row
          </button>
        )}
        <p className="text-[12px] text-slate-500">
          <b>—</b> leaves every box blank, which is how a new contract starts: nothing is stated about
          a service until someone states it.
        </p>
      </Section>

      {/* 4 · PRICING */}
      <Section id="pricing">
        <div>
          <L>Client selects</L>
          <div className="flex flex-wrap gap-2.5">
            {(['A', 'B'] as const).map(o => (
              <button key={o} type="button" disabled={!canEdit}
                onClick={() => patch(d => { d.pricing.selectedOption = d.pricing.selectedOption === o ? null : o; })}
                className={`min-h-[44px] rounded-lg border px-4 text-xs font-black uppercase tracking-widest ${c.pricing.selectedOption === o
                  ? 'border-sky-800 bg-sky-700 text-white' : 'border-slate-300 bg-white text-slate-600'}`}>
                Option {o}
              </button>
            ))}
          </div>
        </div>

        {/* OPTION A */}
        <div className="space-y-4 rounded-lg border border-slate-200 p-3.5">
          <label className="flex min-h-[40px] items-center gap-2.5 text-[15px] font-black text-slate-800">
            <input type="checkbox" className="h-5 w-5" checked={c.pricing.optionA.enabled} disabled={!canEdit}
              onChange={e => patch(d => { d.pricing.optionA.enabled = e.target.checked; })} />
            Option A — Seasonal Contract
          </label>
          {c.pricing.optionA.enabled && (
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Total contract price">
                <input type="number" step="0.01" inputMode="decimal" disabled={!canEdit} className={inputCls}
                  defaultValue={c.pricing.optionA.totalPrice || ''} placeholder="leave blank for a ruled line"
                  onBlur={e => patch(d => { d.pricing.optionA.totalPrice = Number(e.target.value) || 0; })} />
              </Field>
              <div><L>6 instalments of</L>
                <div className="min-h-[44px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-[15px] font-black text-slate-700">
                  ${c.pricing.optionA.instalmentAmount.toFixed(2)}
                </div>
              </div>
              <div><L>Prepay total (5% off)</L>
                <div className="min-h-[44px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-[15px] font-black text-emerald-700">
                  ${c.pricing.optionA.prepayTotal.toFixed(2)}
                </div>
              </div>
              <label className="flex min-h-[40px] items-center gap-2.5 text-[14px] font-bold text-slate-700 sm:col-span-2">
                <input type="checkbox" className="h-5 w-5" checked={c.pricing.optionA.prepayDiscountEnabled} disabled={!canEdit}
                  onChange={e => patch(d => { d.pricing.optionA.prepayDiscountEnabled = e.target.checked; })} />
                Offer the pre-season discount
              </label>
              <Field label="Prepay deadline">
                <input type="date" disabled={!canEdit} className={inputCls} defaultValue={c.pricing.optionA.prepayDeadline}
                  onBlur={e => patch(d => { d.pricing.optionA.prepayDeadline = e.target.value; })} />
              </Field>
            </div>
          )}
        </div>

        {/* OPTION B */}
        <div className="space-y-4 rounded-lg border border-slate-200 p-3.5">
          <label className="flex min-h-[40px] items-center gap-2.5 text-[15px] font-black text-slate-800">
            <input type="checkbox" className="h-5 w-5" checked={c.pricing.optionB.enabled} disabled={!canEdit}
              onChange={e => patch(d => { d.pricing.optionB.enabled = e.target.checked; })} />
            Option B — Per-Service Rates
          </label>
          {c.pricing.optionB.enabled && (
            <>
              <div className="space-y-4">
                {c.pricing.optionB.lines.map((l, i) => (
                  <div key={i} className="grid gap-3 sm:grid-cols-[1fr_9rem_auto]">
                    <Field label={i === 0 ? 'Rate line' : ''}>
                      <input disabled={!canEdit} className={inputCls} defaultValue={l.label}
                        onBlur={e => patch(d => { d.pricing.optionB.lines[i].label = e.target.value; })} />
                    </Field>
                    <Field label={i === 0 ? 'Amount' : ''}>
                      <input type="number" step="0.01" inputMode="decimal" disabled={!canEdit}
                        className={`${inputCls} text-right`} defaultValue={l.amount || ''} placeholder="—"
                        onBlur={e => patch(d => { d.pricing.optionB.lines[i].amount = Number(e.target.value) || 0; })} />
                    </Field>
                    <div className="flex items-end">
                      {canEdit && (
                        <button type="button" onClick={() => patch(d => { d.pricing.optionB.lines.splice(i, 1); })}
                          className="flex h-[44px] w-[44px] items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                          <Trash2 className="h-4.5 w-4.5" />
                        </button>
                      )}
                    </div>
                    {/* The tonnage allowance and any other qualifier that has to
                        print beside the rate. */}
                    <Field label="" span>
                      <input disabled={!canEdit} className={inputCls} defaultValue={l.note || ''}
                        placeholder="qualifier printed after the amount — e.g. includes up to ___ tons"
                        onBlur={e => patch(d => { d.pricing.optionB.lines[i].note = e.target.value; })} />
                    </Field>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                {canEdit && (
                  <button type="button"
                    onClick={() => patch(d => { d.pricing.optionB.lines.push({ label: 'New line', amount: 0 }); })}
                    className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-black uppercase tracking-widest text-sky-700">
                    <Plus className="h-4 w-4" /> add rate line
                  </button>
                )}
                <span className="text-[15px] font-black text-slate-800">
                  Total per visit ${c.pricing.optionB.totalPerVisit.toFixed(2)}
                </span>
              </div>
            </>
          )}
        </div>

        {/* ADD-ONS */}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Sand $ / ton">
            <input type="number" step="0.01" inputMode="decimal" disabled={!canEdit} className={inputCls}
              defaultValue={c.pricing.addOns.sandPerTon || ''}
              onBlur={e => patch(d => { d.pricing.addOns.sandPerTon = Number(e.target.value) || 0; })} />
          </Field>
          <Field label="Sand loading fee">
            <input type="number" step="0.01" inputMode="decimal" disabled={!canEdit} className={inputCls}
              defaultValue={c.pricing.addOns.sandLoadingFee || ''}
              onBlur={e => patch(d => { d.pricing.addOns.sandLoadingFee = Number(e.target.value) || 0; })} />
          </Field>
          <Field label="After-hours / emergency call-out" span>
            <input disabled={!canEdit} className={inputCls} defaultValue={c.pricing.addOns.afterHours}
              placeholder="leave blank for a ruled line to fill in"
              onBlur={e => patch(d => { d.pricing.addOns.afterHours = e.target.value; })} />
          </Field>
          <Field label="On-site snow relocation" span>
            <textarea disabled={!canEdit} className={areaCls} defaultValue={c.pricing.addOns.relocation}
              onBlur={e => patch(d => { d.pricing.addOns.relocation = e.target.value; })} />
          </Field>
          <Field label="Off-site haul-away" span>
            <textarea disabled={!canEdit} className={areaCls} defaultValue={c.pricing.addOns.haulAway}
              onBlur={e => patch(d => { d.pricing.addOns.haulAway = e.target.value; })} />
          </Field>
        </div>
      </Section>

      {/* 5 · TRIGGER */}
      <Section id="trigger">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Trigger depth">
            <input disabled={!canEdit} className={inputCls} defaultValue={c.serviceTerms.triggerDepth}
              onBlur={e => patch(d => { d.serviceTerms.triggerDepth = e.target.value; })} />
          </Field>
          <div><L>Priority tier</L>
            <div className="flex w-fit overflow-hidden rounded-lg border border-slate-300">
              {(['standard', 'priority'] as const).map(t => (
                <button key={t} type="button" disabled={!canEdit}
                  onClick={() => patch(d => { d.serviceTerms.priorityTier = t; })}
                  className={`min-h-[44px] px-5 text-[11px] font-black uppercase tracking-widest ${c.serviceTerms.priorityTier === t ? 'bg-sky-700 text-white' : 'bg-white text-slate-500'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          {([['clearedBefore', 'Cleared before (a.m.)'], ['snowfallEndsBy', 'If snowfall ends by (a.m.)'],
            ['otherwiseWithinHours', 'Otherwise within (hours)']] as [keyof SnowContract['serviceTerms'], string][]).map(([k, label]) => (
            <Field key={k} label={label}>
              <input disabled={!canEdit} className={inputCls} defaultValue={String(c.serviceTerms[k])}
                onBlur={e => patch(d => { (d.serviceTerms as any)[k] = e.target.value; })} />
            </Field>
          ))}
        </div>
        <p className="text-[12px] text-slate-500">
          The bullets under this section are fixed contract terms and are not editable here.
        </p>
      </Section>

      {/* FIXED-TEXT SECTIONS — removable, not editable. */}
      {(['payment', 'damage', 'indemnity', 'insurance', 'contact', 'acceptance'] as const).map(id => (
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
        />
      )}
    </div>
  );
}

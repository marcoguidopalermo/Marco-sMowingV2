// SNOWMASTER · CONTRACT EDITOR.
//
// Two-pane on desktop, tabbed on mobile. The right pane is the SAME
// SnowContractDocument the print view renders — the preview is not a
// approximation of the output, it IS the output.
//
// Autosave on blur; no save button. Derived figures (instalment, prepay,
// per-visit total) recompute on every edit through withDerived, so they can
// never be stale relative to the totals they describe.
import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Check, Loader2, Plus, Trash2, Printer, Copy, Ruler, Upload, X, RotateCcw,
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

const L = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{children}</span>
);

const inputCls = 'w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60';

export default function SnowContractEditor({
  contract, onChange, onBack, onPrint, onDuplicate, onUploadMap, canEdit, saving, currentUser,
}: Props) {
  const [pane, setPane] = useState<'form' | 'preview'>('form');
  const [measuring, setMeasuring] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const c = contract;

  // Every edit routes through here so derived figures stay honest.
  const patch = (fn: (draft: SnowContract) => void) => {
    const draft: SnowContract = JSON.parse(JSON.stringify(c));
    fn(draft);
    onChange(withDerived({ ...draft, updatedAt: Date.now() }));
  };

  const hidden = new Set(c.hiddenSections || []);
  const hiddenList = SECTIONS.filter(s => hidden.has(s.id));
  const removeSection = (id: string) => patch(d => { d.hiddenSections = [...new Set([...(d.hiddenSections || []), id])]; });
  const restoreSection = (id: string) => patch(d => { d.hiddenSections = (d.hiddenSections || []).filter(x => x !== id); });

  const Section = ({ id, children }: { id: string; children: React.ReactNode }) => {
    const s = SECTIONS.find(x => x.id === id)!;
    if (hidden.has(id)) return null;
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-black text-slate-800">
            <span className="text-slate-300 mr-1.5">{s.n}</span>{s.title}
          </h3>
          {canEdit && (
            <button type="button" onClick={() => removeSection(id)}
              className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-rose-600 border border-slate-200 rounded px-1.5 py-0.5">
              remove
            </button>
          )}
        </div>
        {children}
      </div>
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
    <div className="space-y-3">
      {/* REMOVED-SECTION TRAY */}
      {hiddenList.length > 0 && (
        <div className="bg-slate-100 border border-slate-200 rounded-xl p-3">
          <L>Removed from this contract — click to restore</L>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {hiddenList.map(s => (
              <button key={s.id} type="button" onClick={() => restoreSection(s.id)}
                className="text-[11px] font-bold bg-white border border-slate-300 rounded px-2 py-1 hover:border-sky-500 hover:text-sky-700">
                ↩ {s.title}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-500 mt-1.5">
            Removing a section hides it from the printed contract only — the content is kept.
          </p>
        </div>
      )}

      {/* STATUS + TERM */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 grid gap-3 sm:grid-cols-4">
        <label className="block"><L>Status</L>
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
        </label>
        <label className="block"><L>Season</L>
          <input disabled={!canEdit} className={inputCls} defaultValue={c.season}
            onBlur={e => patch(d => { d.season = e.target.value; })} />
        </label>
        <label className="block"><L>Term start</L>
          <input type="date" disabled={!canEdit} className={inputCls} defaultValue={c.term.start}
            onBlur={e => patch(d => { d.term.start = e.target.value; })} />
        </label>
        <label className="block"><L>Term end</L>
          <input type="date" disabled={!canEdit} className={inputCls} defaultValue={c.term.end}
            onBlur={e => patch(d => { d.term.end = e.target.value; })} />
        </label>
      </div>

      {/* 1 · CLIENT */}
      <Section id="client">
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ['businessName', 'Client / Business'], ['siteContact', 'Site Contact'],
            ['serviceAddress', 'Service Address'], ['billingEmail', 'Billing Email'],
            ['phone', 'Phone'],
          ] as [keyof SnowContract['client'], string][]).map(([k, label]) => (
            <label key={k} className={k === 'serviceAddress' ? 'block sm:col-span-2' : 'block'}>
              <L>{label}</L>
              <input disabled={!canEdit} className={inputCls} defaultValue={c.client[k]}
                onBlur={e => patch(d => { d.client[k] = e.target.value; })} />
            </label>
          ))}
        </div>
      </Section>

      {/* 2 · SCOPE */}
      <Section id="scope">
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ['totalArea', 'Total Serviced Area'], ['lotAreas', 'Lot / Driving Areas'],
            ['walkwaysEntrances', 'Walkways & Entrances'], ['snowStorage', 'Snow Storage Locations'],
            ['markedHazards', 'Marked Hazards / Obstacles'], ['accessNotes', 'Access Notes'],
          ] as [keyof SnowContract['scope'], string][]).map(([k, label]) => (
            <label key={k} className="block"><L>{label}</L>
              <input disabled={!canEdit} className={inputCls} defaultValue={String(c.scope[k] ?? '')}
                onBlur={e => patch(d => { (d.scope as any)[k] = e.target.value; })} />
            </label>
          ))}
        </div>
        <label className="block"><L>Scope Description</L>
          <textarea rows={4} disabled={!canEdit} className={inputCls} defaultValue={c.scope.description}
            onBlur={e => patch(d => { d.scope.description = e.target.value; })} />
        </label>

        <div className="border-t border-slate-100 pt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <L>Site map</L>
            <label className="text-[11px] font-bold text-slate-600 inline-flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={!c.scope.showMap} disabled={!canEdit}
                onChange={e => patch(d => { d.scope.showMap = !e.target.checked; })} />
              description only (hide map)
            </label>
          </div>
          {c.scope.showMap && (
            <div className="flex flex-wrap items-center gap-2">
              {/* THE SHARED MEASURING TOOL — the SalesMaster component, mounted
                  as-is. No second measuring implementation. */}
              <button type="button" disabled={!canEdit} onClick={() => setMeasuring(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest bg-slate-800 text-white disabled:opacity-50">
                <Ruler className="w-3.5 h-3.5" />
                {c.scope.measurement ? 'Re-measure area' : 'Measure area on satellite'}
              </button>
              {c.scope.measuredSqft != null && (
                <span className="text-[11px] font-bold text-emerald-700">
                  {areaLabel(c.scope.measuredSqft)} measured — the printed map draws from this outline
                </span>
              )}
              <button type="button" disabled={!canEdit || uploading} onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border border-slate-300 disabled:opacity-50">
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
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
                <span key={i} className="inline-flex items-center gap-1 text-[10px] bg-slate-100 border border-slate-200 rounded px-1.5 py-1">
                  image {i + 1}
                  {canEdit && (
                    <button type="button" onClick={() => patch(d => { d.scope.mapImages = d.scope.mapImages.filter((_, j) => j !== i); })}
                      className="text-slate-400 hover:text-rose-600"><X className="w-3 h-3" /></button>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* 3 · SERVICES */}
      <Section id="services">
        <div className="space-y-1.5">
          {c.services.map((s, i) => (
            <div key={s.key} className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto] items-center border-b border-slate-100 pb-1.5">
              <div className="flex gap-1">
                <input disabled={!canEdit} className={`${inputCls} font-bold`} defaultValue={s.label}
                  onBlur={e => patch(d => { d.services[i].label = e.target.value; })} />
                <input disabled={!canEdit} className={inputCls} defaultValue={s.detail} placeholder="detail"
                  onBlur={e => patch(d => { d.services[i].detail = e.target.value; })} />
              </div>
              <div className="flex rounded-lg overflow-hidden border border-slate-300">
                {(['included', 'onCall', 'excluded'] as SnowServiceStatus[]).map(st => (
                  <button key={st} type="button" disabled={!canEdit}
                    onClick={() => patch(d => { d.services[i].status = st; })}
                    className={`px-2 py-1.5 text-[10px] font-black uppercase tracking-widest ${s.status === st
                      ? (st === 'included' ? 'bg-emerald-600 text-white' : st === 'onCall' ? 'bg-amber-500 text-white' : 'bg-slate-500 text-white')
                      : 'bg-white text-slate-500'}`}>
                    {st === 'onCall' ? 'On call' : st === 'included' ? 'Incl.' : 'Excl.'}
                  </button>
                ))}
              </div>
              <input disabled={!canEdit} className={inputCls} defaultValue={s.notes} placeholder="scope / notes"
                onBlur={e => patch(d => { d.services[i].notes = e.target.value; })} />
              {canEdit && s.custom && (
                <button type="button" onClick={() => patch(d => { d.services.splice(i, 1); })}
                  className="text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
              )}
              {!s.custom && <span />}
            </div>
          ))}
        </div>
        {canEdit && (
          <button type="button"
            onClick={() => patch(d => {
              d.services.push({ key: `custom-${Date.now()}`, label: 'New service', detail: '', status: 'excluded', notes: '', custom: true });
            })}
            className="text-[11px] font-black uppercase tracking-widest text-sky-700 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" /> add service row
          </button>
        )}
      </Section>

      {/* 4 · PRICING */}
      <Section id="pricing">
        <div className="flex flex-wrap items-center gap-3">
          <L>Client selects</L>
          {(['A', 'B'] as const).map(o => (
            <button key={o} type="button" disabled={!canEdit}
              onClick={() => patch(d => { d.pricing.selectedOption = d.pricing.selectedOption === o ? null : o; })}
              className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest border ${c.pricing.selectedOption === o
                ? 'bg-sky-700 text-white border-sky-800' : 'bg-white text-slate-600 border-slate-300'}`}>
              Option {o}
            </button>
          ))}
        </div>

        {/* OPTION A */}
        <div className="border border-slate-200 rounded-lg p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm font-black text-slate-800">
            <input type="checkbox" checked={c.pricing.optionA.enabled} disabled={!canEdit}
              onChange={e => patch(d => { d.pricing.optionA.enabled = e.target.checked; })} />
            Option A — Seasonal Contract
          </label>
          {c.pricing.optionA.enabled && (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block"><L>Total contract price</L>
                <input type="number" step="0.01" disabled={!canEdit} className={inputCls}
                  defaultValue={c.pricing.optionA.totalPrice || ''}
                  onBlur={e => patch(d => { d.pricing.optionA.totalPrice = Number(e.target.value) || 0; })} />
              </label>
              <div><L>6 instalments of</L>
                <div className="px-2 py-1.5 text-sm font-mono font-black text-slate-700 bg-slate-50 border border-slate-200 rounded-lg">
                  ${c.pricing.optionA.instalmentAmount.toFixed(2)}
                </div>
              </div>
              <div><L>Prepay total (5% off)</L>
                <div className="px-2 py-1.5 text-sm font-mono font-black text-emerald-700 bg-slate-50 border border-slate-200 rounded-lg">
                  ${c.pricing.optionA.prepayTotal.toFixed(2)}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600 sm:col-span-2">
                <input type="checkbox" checked={c.pricing.optionA.prepayDiscountEnabled} disabled={!canEdit}
                  onChange={e => patch(d => { d.pricing.optionA.prepayDiscountEnabled = e.target.checked; })} />
                offer the pre-season discount
              </label>
              <label className="block"><L>Prepay deadline</L>
                <input type="date" disabled={!canEdit} className={inputCls} defaultValue={c.pricing.optionA.prepayDeadline}
                  onBlur={e => patch(d => { d.pricing.optionA.prepayDeadline = e.target.value; })} />
              </label>
            </div>
          )}
        </div>

        {/* OPTION B */}
        <div className="border border-slate-200 rounded-lg p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm font-black text-slate-800">
            <input type="checkbox" checked={c.pricing.optionB.enabled} disabled={!canEdit}
              onChange={e => patch(d => { d.pricing.optionB.enabled = e.target.checked; })} />
            Option B — Per-Service Rates
          </label>
          {c.pricing.optionB.enabled && (
            <>
              {c.pricing.optionB.lines.map((l, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input disabled={!canEdit} className={inputCls} defaultValue={l.label}
                    onBlur={e => patch(d => { d.pricing.optionB.lines[i].label = e.target.value; })} />
                  <input type="number" step="0.01" disabled={!canEdit} className={`${inputCls} w-28 text-right`}
                    defaultValue={l.amount || ''}
                    onBlur={e => patch(d => { d.pricing.optionB.lines[i].amount = Number(e.target.value) || 0; })} />
                  {canEdit && (
                    <button type="button" onClick={() => patch(d => { d.pricing.optionB.lines.splice(i, 1); })}
                      className="text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                {canEdit && (
                  <button type="button"
                    onClick={() => patch(d => { d.pricing.optionB.lines.push({ label: 'New line', amount: 0 }); })}
                    className="text-[11px] font-black uppercase tracking-widest text-sky-700 inline-flex items-center gap-1">
                    <Plus className="w-3 h-3" /> add rate line
                  </button>
                )}
                <span className="text-sm font-black text-slate-800">
                  Total per visit ${c.pricing.optionB.totalPerVisit.toFixed(2)}
                </span>
              </div>
            </>
          )}
        </div>

        {/* ADD-ONS */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><L>Sand $ / ton</L>
            <input type="number" step="0.01" disabled={!canEdit} className={inputCls} defaultValue={c.pricing.addOns.sandPerTon}
              onBlur={e => patch(d => { d.pricing.addOns.sandPerTon = Number(e.target.value) || 0; })} />
          </label>
          <label className="block"><L>Sand loading fee</L>
            <input type="number" step="0.01" disabled={!canEdit} className={inputCls} defaultValue={c.pricing.addOns.sandLoadingFee}
              onBlur={e => patch(d => { d.pricing.addOns.sandLoadingFee = Number(e.target.value) || 0; })} />
          </label>
          <label className="block sm:col-span-2"><L>After-hours / emergency call-out</L>
            <input disabled={!canEdit} className={inputCls} defaultValue={c.pricing.addOns.afterHours}
              onBlur={e => patch(d => { d.pricing.addOns.afterHours = e.target.value; })} />
          </label>
        </div>
      </Section>

      {/* 5 · TRIGGER */}
      <Section id="trigger">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><L>Trigger depth</L>
            <input disabled={!canEdit} className={inputCls} defaultValue={c.serviceTerms.triggerDepth}
              onBlur={e => patch(d => { d.serviceTerms.triggerDepth = e.target.value; })} />
          </label>
          <div><L>Priority tier</L>
            <div className="flex rounded-lg overflow-hidden border border-slate-300 w-fit">
              {(['standard', 'priority'] as const).map(t => (
                <button key={t} type="button" disabled={!canEdit}
                  onClick={() => patch(d => { d.serviceTerms.priorityTier = t; })}
                  className={`px-3 py-1.5 text-[11px] font-black uppercase tracking-widest ${c.serviceTerms.priorityTier === t ? 'bg-sky-700 text-white' : 'bg-white text-slate-500'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          {([['clearedBefore', 'Cleared before (a.m.)'], ['snowfallEndsBy', 'If snowfall ends by (a.m.)'],
            ['otherwiseWithinHours', 'Otherwise within (hours)']] as [keyof SnowContract['serviceTerms'], string][]).map(([k, label]) => (
            <label key={k} className="block"><L>{label}</L>
              <input disabled={!canEdit} className={inputCls} defaultValue={String(c.serviceTerms[k])}
                onBlur={e => patch(d => { (d.serviceTerms as any)[k] = e.target.value; })} />
            </label>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">
          The bullets under this section are fixed contract terms and are not editable here.
        </p>
      </Section>

      {/* FIXED-TEXT SECTIONS — removable, not editable. */}
      {(['payment', 'damage', 'indemnity', 'insurance', 'contact', 'acceptance'] as const).map(id => (
        <Section key={id} id={id}>
          <p className="text-[11px] text-slate-500">
            Fixed contract text. It can be removed from this contract, but not reworded here —
            the wording is the same on every agreement.
          </p>
        </Section>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* HEADER */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button type="button" onClick={onBack} className="p-1.5 text-slate-500 hover:text-slate-900" aria-label="Back">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <div className="font-black text-slate-900 truncate">
              {c.client.businessName || 'Untitled contract'}
            </div>
            <div className="text-[11px] font-bold text-slate-400">
              {c.season} · {STATUS_LABEL[c.status]}
              {saving === 'saving' && <span className="ml-2 inline-flex items-center gap-1 text-slate-500"><Loader2 className="w-3 h-3 animate-spin" /> saving…</span>}
              {saving === 'saved' && <span className="ml-2 inline-flex items-center gap-1 text-emerald-600"><Check className="w-3 h-3" /> saved</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex lg:hidden bg-slate-100 rounded-lg p-1">
            {(['form', 'preview'] as const).map(p => (
              <button key={p} type="button" onClick={() => setPane(p)}
                className={`px-3 py-1.5 text-xs font-black rounded uppercase ${pane === p ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>
                {p}
              </button>
            ))}
          </div>
          {canEdit && (
            <button type="button" onClick={onDuplicate}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-slate-300">
              <Copy className="w-3.5 h-3.5" /> Duplicate for next season
            </button>
          )}
          <button type="button" onClick={onPrint}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest bg-slate-800 text-white">
            <Printer className="w-3.5 h-3.5" /> Print / PDF
          </button>
        </div>
      </div>

      {/* TWO PANES */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className={pane === 'form' ? '' : 'hidden lg:block'}>{form}</div>
        <div className={`${pane === 'preview' ? '' : 'hidden lg:block'}`}>
          <div className="sticky top-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
              Live preview — the same render the printed contract uses
            </div>
            <div className="bg-slate-200 rounded-xl p-3 overflow-auto max-h-[80vh]">
              <div className="bg-white shadow-lg mx-auto" style={{ width: '8.5in' , transform: 'scale(0.78)', transformOrigin: 'top center' }}>
                <SnowContractDocument contract={c} mode="preview" />
              </div>
            </div>
          </div>
        </div>
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

// FINANCEMASTER — equipment finance agreements (docs/financemaster-spec.md).
// Rendered only for FINANCE_VIEWERS on their real sign-in (App.tsx gate);
// the Firestore and Storage rules are what actually enforce it.
//
// Phase 2: the agreements list and editor. Figures are derived on the fly
// from the terms (lib/finance/calc) — nothing here stores a balance except
// a lender statement the user types in.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Landmark, Plus, ArrowLeft, Lock, Trash2, Upload, FileText, X, AlertTriangle, ChevronDown, ChevronRight, RefreshCw, Scissors } from 'lucide-react';
import type { FleetItem } from '../types';
import type { FinanceAgreement, AgreementAsset, AgreementType, Frequency, TaxMode, EndOfTermPlan, EndReason, ExtraKind, FinanceDocType, AgreementStatus } from '../lib/finance/types';
import { AGREEMENT_TYPE_LABEL, FREQUENCY_LABEL, END_PLAN_LABEL, END_REASON_LABEL, DOC_TYPE_LABEL, CONTRACT_DOC_TYPES, isLease } from '../lib/finance/types';
import type { FinanceDocument } from '../lib/finance/types';
import { agreementFigures, validateAgreement, DISPLAY_STATUS_LABEL, liveAssets, whatsLeft, unitWhatsLeft, type DisplayStatus, type WhatsLeftBar } from '../lib/finance/calc';
import { portfolio, splitEvenly, allocateByWeight, type UnitFinance } from '../lib/finance/portfolio';
import { addMonths, isValidYmd, monthsBetween } from '../lib/finance/schedule';
import { blankAgreement, newAgreementId } from '../lib/finance/edit';
import { fmtMoney } from '../lib/finance/money';
import { fleetItemLabel } from '../lib/fleetUtils';
import { isDisposed, DISPOSAL_LABEL } from '../lib/fleetDisposal';
import { uploadFile, deleteFile } from '../lib/storage';

interface Props {
  agreements: FinanceAgreement[];
  fleet: FleetItem[];                 // FULL fleet, incl. retired units (agreements outlive units)
  today: string;
  currentUser: { email: string; name: string };
  onSave: (a: FinanceAgreement) => Promise<boolean>;
  focusAgreementId?: string | null;
  onFocusHandled?: () => void;
}

const M = (c: number | null | undefined) => (c == null ? '—' : fmtMoney(c));
const MC = (c: number | null | undefined) => (c == null ? '—' : fmtMoney(c, { cents: true }));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (s?: string | null) => (s && isValidYmd(s) ? `${MONTHS[Number(s.slice(5, 7)) - 1]} ${Number(s.slice(8, 10))}, ${s.slice(0, 4)}` : '—');
const fmtMonth = (s?: string | null) => (s && isValidYmd(s) ? `${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` : '—');

const STATUS_STYLE: Record<DisplayStatus, string> = {
  financed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  proposed: 'bg-white text-slate-600 border-slate-400 border-dashed',
  past_maturity: 'bg-red-100 text-red-800 border-red-200',
  paid_off: 'bg-slate-100 text-slate-600 border-slate-200',
  ended: 'bg-slate-100 text-slate-500 border-slate-200',
};
export function StatusPill({ status }: { status: DisplayStatus }) {
  return <span className={`inline-block text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded border ${STATUS_STYLE[status]}`}>{DISPLAY_STATUS_LABEL[status]}</span>;
}

export default function FinanceMaster({ agreements, fleet, today, currentUser, onSave, focusAgreementId, onFocusHandled }: Props) {
  const [editing, setEditing] = useState<FinanceAgreement | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [filter, setFilter] = useState<'current' | 'proposed' | 'ended' | 'all'>('current');
  const [tab, setTab] = useState<'agreements' | 'contracts'>('agreements');
  const [q, setQ] = useState('');

  const visible = useMemo(() => agreements.filter(a => !a.deletedAt), [agreements]);
  const fleetById = useMemo(() => new Map(fleet.map(u => [u.id, u])), [fleet]);
  const pf = useMemo(() => portfolio(visible, fleet, today), [visible, fleet, today]);

  // Opened from a fleet unit's Finance badge.
  useEffect(() => {
    if (!focusAgreementId) return;
    const a = visible.find(x => x.id === focusAgreementId);
    if (a) { setEditing(a); setIsNew(false); }
    onFocusHandled?.();
  }, [focusAgreementId, visible, onFocusHandled]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return visible
      .map(a => ({ a, f: pf.figures.get(a.id) || agreementFigures(a, today) }))
      .filter(({ a, f }) => {
        if (filter === 'current' && !(f.displayStatus === 'financed' || f.displayStatus === 'past_maturity')) return false;
        if (filter === 'proposed' && f.displayStatus !== 'proposed') return false;
        if (filter === 'ended' && !(f.displayStatus === 'ended' || f.displayStatus === 'paid_off')) return false;
        if (!needle) return true;
        const hay = [a.lender, a.agreementNumber, a.borrower, a.notes, ...a.assets.map(x => x.labelSnapshot + ' ' + (x.description || '') + ' ' + (x.serialSnapshot || ''))].join(' ').toLowerCase();
        return hay.includes(needle);
      })
      .sort((x, y) => (x.a.maturityDate || '').localeCompare(y.a.maturityDate || ''));
  }, [visible, pf, filter, q, today]);

  if (editing) {
    return (
      <AgreementEditor
        key={editing.id}
        initial={editing}
        isNew={isNew}
        all={visible}
        fleet={fleet}
        fleetById={fleetById}
        today={today}
        currentUser={currentUser}
        onSave={onSave}
        onOpen={(a, asNew) => { setEditing(a); setIsNew(asNew); }}
        onClose={() => { setEditing(null); setIsNew(false); }}
      />
    );
  }

  const t = pf.total;
  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Landmark className="w-6 h-6 text-emerald-700" />
        <h1 className="text-2xl font-black text-slate-800">Finance</h1>
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 bg-slate-100 border border-slate-200 rounded px-2 py-0.5"><Lock className="w-3 h-3" /> Only you can see this</span>
        <div className="flex-1" />
        <button onClick={() => { setEditing(blankAgreement(today)); setIsNew(true); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800">
          <Plus className="w-4 h-4" /> New agreement
        </button>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {(['agreements', 'contracts'] as const).map(k => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm font-bold border-b-2 -mb-px ${tab === k ? 'border-emerald-700 text-emerald-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {k === 'agreements' ? 'Agreements' : 'Contracts'}
          </button>
        ))}
      </div>

      {tab === 'contracts' ? (
        <ContractsView agreements={visible} fleetById={fleetById} currentUser={currentUser} onSave={onSave}
          onOpenAgreement={(id) => { const x = visible.find(v => v.id === id); if (x) { setEditing(x); setIsNew(false); } }} />
      ) : (<>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Stat label="Monthly payments" value={M(t.monthly)} sub="before HST" />
        <Stat label="Still to pay" value={M(t.remaining)} sub="incl. residuals" />
        <Stat label="Residuals ahead" value={M(t.residual)} />
        <Stat label="Active agreements" value={String(t.agreements)} sub={`${t.units} unit${t.units === 1 ? '' : 's'}`} />
        <Stat label="Proposed" value={String(pf.proposed.agreements)} sub={pf.proposed.agreements ? `${M(pf.proposed.monthly)}/mo if signed` : 'none'} dashed />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(['current', 'proposed', 'ended', 'all'] as const).map(k => (
          <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-md text-xs font-bold border ${filter === k ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
            {k === 'current' ? 'Active' : k === 'proposed' ? 'Proposed' : k === 'ended' ? 'Ended' : 'All'}
          </button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search lender, unit, serial…" className="ml-auto border border-slate-300 rounded-md px-3 py-1.5 text-sm w-full sm:w-64" />
      </div>

      {rows.length === 0 ? (
        <div className="text-center text-slate-500 py-12 border border-dashed border-slate-300 rounded-lg">
          {visible.length === 0 ? 'No agreements yet. Add the first one with “New agreement”.' : 'Nothing matches.'}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(({ a, f }) => {
            const units = liveAssets(a);
            const months = isValidYmd(a.maturityDate) ? monthsBetween(today, a.maturityDate) : null;
            return (
              <button key={a.id} onClick={() => { setEditing(a); setIsNew(false); }}
                className={`w-full text-left bg-white rounded-lg border p-3 hover:shadow-sm hover:border-slate-400 transition ${a.status === 'proposed' ? 'border-dashed border-slate-400' : 'border-slate-200'}`}>
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-[220px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-slate-800">{a.lender || 'Unnamed lender'}</span>
                      {a.agreementNumber && <span className="text-xs text-slate-400">#{a.agreementNumber}</span>}
                      <StatusPill status={f.displayStatus} />
                      <span className="text-[11px] text-slate-500">{AGREEMENT_TYPE_LABEL[a.type]}</span>
                    </div>
                    <div className="text-xs text-slate-600 mt-1 truncate">
                      {units.length} unit{units.length === 1 ? '' : 's'}: {units.map(x => unitName(x, fleetById)).join(', ') || '—'}
                    </div>
                  </div>
                  <Fig label="Payment" value={`${M(a.plan.amount)}${a.plan.frequency === 'monthly' ? '/mo' : ` ${FREQUENCY_LABEL[a.plan.frequency].toLowerCase()}`}`} />
                  <Fig label="Left" value={`${f.paymentsRemaining} pmt${f.paymentsRemaining === 1 ? '' : 's'}`} />
                  <Fig label="Residual" value={M(a.residual || 0)} />
                  <Fig label="Matures" value={fmtMonth(a.maturityDate)} sub={months != null && f.displayStatus !== 'ended' && f.displayStatus !== 'paid_off' ? (months >= 0 ? `${months} mo` : `${-months} mo ago`) : undefined} warn={months != null && months <= 6 && f.displayStatus !== 'ended' && f.displayStatus !== 'paid_off'} />
                </div>
                <div className="mt-2"><WhatsLeftBarView bar={whatsLeft(a, f, today)} /></div>
              </button>
            );
          })}
        </div>
      )}
      </>)}
    </div>
  );
}

function Stat({ label, value, sub, dashed }: { label: string; value: string; sub?: string; dashed?: boolean }) {
  return (
    <div className={`bg-white rounded-lg p-3 border ${dashed ? 'border-dashed border-slate-400' : 'border-slate-200'}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-black text-slate-800">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}
function Fig({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="text-right min-w-[84px]">
      <div className="text-[10px] font-bold uppercase text-slate-400">{label}</div>
      <div className={`text-sm font-bold ${warn ? 'text-red-700' : 'text-slate-800'}`}>{value}</div>
      {sub && <div className={`text-[11px] ${warn ? 'text-red-600 font-bold' : 'text-slate-500'}`}>{sub}</div>}
    </div>
  );
}

function unitName(x: AgreementAsset, fleetById: Map<string, FleetItem>): string {
  const u = x.fleetUnitId ? fleetById.get(x.fleetUnitId) : undefined;
  return u ? fleetItemLabel(u) : (x.labelSnapshot || x.description || 'Item');
}

// ── Inputs ──────────────────────────────────────────────────────────────────
const inputCls = 'w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white disabled:bg-slate-50';

function Field({ label, children, hint, span }: { label: string; children: ReactNode; hint?: string; span?: 2 | 3 }) {
  return (
    <label className={`block ${span === 2 ? 'sm:col-span-2' : span === 3 ? 'sm:col-span-3' : ''}`}>
      <span className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-0.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-400 mt-0.5">{hint}</span>}
    </label>
  );
}

/** Dollars in, whole cents out. Keeps the text while typing; commits on blur. */
function MoneyInput({ value, onChange, placeholder, allowEmpty }: { value: number | null | undefined; onChange: (c: number | null) => void; placeholder?: string; allowEmpty?: boolean }) {
  const show = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));
  const [text, setText] = useState(show(value));
  useEffect(() => { setText(show(value)); }, [value]);
  return (
    <input inputMode="decimal" className={inputCls} value={text} placeholder={placeholder || '0.00'}
      onChange={e => setText(e.target.value)}
      onBlur={() => {
        const s = text.replace(/[$,\s]/g, '');
        if (!s) { onChange(allowEmpty ? null : 0); setText(allowEmpty ? '' : '0.00'); return; }
        const n = Number(s);
        if (!Number.isFinite(n)) { setText(show(value)); return; }
        const c = Math.round(n * 100);
        onChange(c); setText(show(c));
      }} />
  );
}
function NumInput({ value, onChange, step, allowEmpty }: { value: number | null | undefined; onChange: (n: number | null) => void; step?: string; allowEmpty?: boolean }) {
  return (
    <input type="number" step={step || '1'} className={inputCls} value={value == null ? '' : value}
      onChange={e => { const v = e.target.value; onChange(v === '' ? (allowEmpty ? null : 0) : Number(v)); }} />
  );
}
function DateInput({ value, onChange }: { value: string | undefined; onChange: (s: string) => void }) {
  return <input type="date" className={inputCls} value={value || ''} onChange={e => onChange(e.target.value)} />;
}
function Section({ title, children, right, defaultOpen = true }: { title: string; children: ReactNode; right?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="bg-white rounded-lg border border-slate-200">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-1 font-black text-slate-700 text-sm">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}{title}
        </button>
        <div className="flex-1" />
        {right}
      </div>
      {open && <div className="p-3">{children}</div>}
    </section>
  );
}

// ── Editor ──────────────────────────────────────────────────────────────────
interface EditorProps {
  initial: FinanceAgreement;
  isNew: boolean;
  all: FinanceAgreement[];
  fleet: FleetItem[];
  fleetById: Map<string, FleetItem>;
  today: string;
  currentUser: { email: string; name: string };
  onSave: (a: FinanceAgreement) => Promise<boolean>;
  onOpen: (a: FinanceAgreement, isNew: boolean) => void;
  onClose: () => void;
}

function AgreementEditor({ initial, isNew, all, fleet, fleetById, today, currentUser, onSave, onOpen, onClose }: EditorProps) {
  const [a, setA] = useState<FinanceAgreement>(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [docType, setDocType] = useState<FinanceDocType>('lease_contract');
  const [showSchedule, setShowSchedule] = useState(false);
  // Documents already saved on the stored agreement (uploads save at once).
  const savedDocs = useRef(initial.documents || []);
  const dirty = JSON.stringify(a) !== JSON.stringify(initial) || isNew;
  const set = (patch: Partial<FinanceAgreement>) => setA(prev => ({ ...prev, ...patch }));
  const setPlan = (patch: Partial<FinanceAgreement['plan']>) => setA(prev => ({ ...prev, plan: { ...prev.plan, ...patch } }));

  const figures = useMemo(() => agreementFigures(a, today), [a, today]);
  const issues = useMemo(() => validateAgreement(a), [a]);
  const errors = issues.filter(i => i.level === 'error');
  const live = liveAssets(a);
  const from = a.refinancedFromId ? all.find(x => x.id === a.refinancedFromId) : undefined;
  const by = a.refinancedById ? all.find(x => x.id === a.refinancedById) : undefined;

  const save = async (next = a): Promise<boolean> => {
    if (validateAgreement(next).some(i => i.level === 'error')) return false;
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    return ok;
  };
  const saveAndClose = async () => {
    if (!(await save())) return;
    // A refinance: close the old agreement and point it at this one.
    if (isNew && a.refinancedFromId && from && !from.refinancedById) {
      await onSave({ ...from, status: 'ended', endedAt: from.endedAt || a.startDate, endReason: 'refinanced', refinancedById: a.id });
    }
    onClose();
  };
  const leave = () => { if (!dirty || window.confirm('Leave without saving your changes?')) onClose(); };

  const expectFinanced = (a.acquisitionCost || 0) - (a.downPayment || 0) - (a.tradeInCredit || 0) + (a.taxFinanced || 0);
  const fillFinanced = () => set({ financedAmount: Math.max(0, expectFinanced) });
  const setTradeIns = (tradeIns: NonNullable<FinanceAgreement['tradeIns']>) =>
    set({ tradeIns, tradeInCredit: tradeIns.length ? tradeIns.reduce((s, x) => s + (x.value || 0), 0) : a.tradeInCredit });
  const fillMaturity = () => {
    if (!isValidYmd(a.startDate) || !(a.termMonths > 0)) return;
    set({ maturityDate: addMonths(a.startDate, a.termMonths) });
  };

  // Equipment
  const linkedIds = new Set(a.assets.map(x => x.fleetUnitId).filter(Boolean) as string[]);
  const pickable = fleet.filter(u => !linkedIds.has(u.id) && !isDisposed(u)).sort((x, y) => fleetItemLabel(x).localeCompare(fleetItemLabel(y), undefined, { numeric: true }));
  const setAsset = (i: number, patch: Partial<AgreementAsset>) => setA(prev => ({ ...prev, assets: prev.assets.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const addUnit = (id: string) => {
    const u = fleetById.get(id); if (!u) return;
    setA(prev => ({ ...prev, assets: [...prev.assets, { fleetUnitId: u.id, labelSnapshot: fleetItemLabel(u), serialSnapshot: u.serialNumber || '', allocatedValue: 0 }] }));
  };
  const addItem = () => setA(prev => ({ ...prev, assets: [...prev.assets, { fleetUnitId: null, labelSnapshot: '', description: '', allocatedValue: 0 }] }));
  const splitAlloc = () => {
    const idx = a.assets.map((x, i) => (!x.removedAt ? i : -1)).filter(i => i >= 0);
    const shares = splitEvenly(a.acquisitionCost || a.financedAmount, idx.length);
    setA(prev => ({ ...prev, assets: prev.assets.map((x, i) => (idx.includes(i) ? { ...x, allocatedValue: shares[idx.indexOf(i)] } : x)) }));
  };
  const allocByPrice = () => {
    const idx = a.assets.map((x, i) => (!x.removedAt ? i : -1)).filter(i => i >= 0);
    const shares = allocateByWeight(a.financedAmount, idx.map(i => a.assets[i].purchasePrice || 0));
    setA(prev => ({ ...prev, assets: prev.assets.map((x, i) => (idx.includes(i) ? { ...x, allocatedValue: shares[idx.indexOf(i)] } : x)) }));
  };
  const splitResidual = () => {
    const idx = a.assets.map((x, i) => (!x.removedAt ? i : -1)).filter(i => i >= 0);
    const shares = splitEvenly(a.residual || 0, idx.length);
    setA(prev => ({ ...prev, assets: prev.assets.map((x, i) => (idx.includes(i) ? { ...x, residualShare: shares[idx.indexOf(i)] } : x)) }));
  };

  // Documents — financing/{agreementId}/ (finance-viewer-only Storage path).
  const upload = async (files: FileList | null) => {
    if (!files || !files.length) return;
    try {
      for (const file of Array.from(files)) {
        setUploading(0);
        const sf = await uploadFile(`financing/${a.id}`, file, { uploadedBy: currentUser, onProgress: setUploading });
        const d = { ...sf, docType };
        setA(prev => ({ ...prev, documents: [...(prev.documents || []), d] }));
        // Saved straight away (for an existing agreement) so an upload never
        // leaves an orphan file behind a cancelled edit.
        if (!isNew) {
          savedDocs.current = [...savedDocs.current, d];
          await onSave({ ...initial, documents: savedDocs.current });
        }
      }
    } catch (e: any) {
      window.alert(`Upload failed: ${e?.message || e}`);
    } finally { setUploading(null); }
  };
  const removeDoc = async (path: string) => {
    if (!window.confirm('Delete this document?')) return;
    try { await deleteFile(path); } catch (e: any) { window.alert(e?.message || String(e)); return; }
    setA(prev => ({ ...prev, documents: (prev.documents || []).filter(d => d.path !== path) }));
    if (!isNew) {
      savedDocs.current = savedDocs.current.filter(d => d.path !== path);
      await onSave({ ...initial, documents: savedDocs.current });
    }
  };

  const refinance = () => {
    if (dirty && !isNew && !window.confirm('Unsaved changes on this agreement will be lost. Continue?')) return;
    const start = isValidYmd(a.maturityDate) ? a.maturityDate : today;
    const next: FinanceAgreement = {
      ...blankAgreement(start),
      id: newAgreementId(),
      lender: a.lender,
      borrower: a.borrower,
      type: 'loan',
      financedAmount: a.residual || 0,
      acquisitionCost: a.residual || 0,
      refinancedFromId: a.id,
      assets: live.map(x => ({ ...x, allocatedValue: x.residualShare ?? 0, residualShare: undefined })),
      notes: `Refinance of ${a.lender}${a.agreementNumber ? ` #${a.agreementNumber}` : ''}.`,
    };
    onOpen(next, true);
  };

  const softDelete = async () => {
    if (!window.confirm('Delete this agreement? It is hidden, not erased — it can be restored from the database if needed.')) return;
    if (await save({ ...a, deletedAt: Date.now() })) onClose();
  };

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap sticky top-0 z-10 bg-gray-100/95 backdrop-blur py-2">
        <button onClick={leave} className="inline-flex items-center gap-1 text-sm font-bold text-slate-600 hover:text-slate-900"><ArrowLeft className="w-4 h-4" /> Agreements</button>
        <h2 className="text-lg font-black text-slate-800 ml-2">{isNew ? 'New agreement' : a.lender || 'Agreement'}</h2>
        <StatusPill status={figures.displayStatus} />
        <div className="flex-1" />
        {!isNew && <button onClick={refinance} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-300 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50"><RefreshCw className="w-3.5 h-3.5" /> Refinance</button>}
        <button onClick={leave} className="px-3 py-1.5 rounded-md border border-slate-300 text-sm font-bold text-slate-700 bg-white">Cancel</button>
        <button disabled={saving || errors.length > 0 || !dirty} onClick={saveAndClose} className="px-4 py-1.5 rounded-md bg-emerald-700 text-white text-sm font-bold disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
      </div>

      {issues.length > 0 && (
        <div className="space-y-1">
          {issues.map((i, k) => (
            <div key={k} className={`flex items-start gap-2 text-sm rounded-md px-3 py-1.5 border ${i.level === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{i.message}
            </div>
          ))}
        </div>
      )}

      <Section title={`To confirm (${(a.flags || []).length})`} defaultOpen={(a.flags || []).length > 0} right={<button type="button" onClick={() => set({ flags: [...(a.flags || []), ''] })} className="text-xs font-bold text-emerald-700">+ Add</button>}>
        {(a.flags || []).length === 0 ? <div className="text-xs text-slate-500">Nothing open.</div> : (
          <div className="space-y-1">
            {(a.flags || []).map((fl, i) => (
              <div key={i} className="flex gap-2 items-center">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <input className={inputCls} value={fl} onChange={e => set({ flags: (a.flags || []).map((y, j) => (j === i ? e.target.value : y)) })} />
                <button type="button" title="Settled" onClick={() => set({ flags: (a.flags || []).filter((_, j) => j !== i) })}><X className="w-4 h-4 text-slate-400 hover:text-emerald-700" /></button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {(from || by) && (
        <div className="text-sm bg-sky-50 border border-sky-200 text-sky-900 rounded-md px-3 py-2 space-y-0.5">
          {from && <div>Refinances <button className="underline font-bold" onClick={() => onOpen(from, false)}>{from.lender} (matured {fmtMonth(from.maturityDate)})</button>.</div>}
          {by && <div>Refinanced by <button className="underline font-bold" onClick={() => onOpen(by, false)}>{by.lender} (from {fmtMonth(by.startDate)})</button>.</div>}
        </div>
      )}

      <FiguresPanel a={a} f={figures} />
      <div className="bg-white rounded-lg border border-slate-200 p-3"><WhatsLeftBarView bar={whatsLeft(a, figures, today)} /></div>

      <Section title="Agreement">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Status">
            <select className={inputCls} value={a.status} onChange={e => set({ status: e.target.value as AgreementStatus })}>
              <option value="active">Active (signed)</option>
              <option value="proposed">Proposed (not signed — what-if)</option>
              <option value="ended">Ended</option>
            </select>
          </Field>
          <Field label="Lender"><input className={inputCls} value={a.lender} onChange={e => set({ lender: e.target.value })} placeholder="Lender name" /></Field>
          <Field label="Agreement #"><input className={inputCls} value={a.agreementNumber || ''} onChange={e => set({ agreementNumber: e.target.value })} /></Field>
          <Field label="Type">
            <select className={inputCls} value={a.type} onChange={e => set({ type: e.target.value as AgreementType })}>
              {(Object.keys(AGREEMENT_TYPE_LABEL) as AgreementType[]).map(k => <option key={k} value={k}>{AGREEMENT_TYPE_LABEL[k]}</option>)}
            </select>
          </Field>
          <Field label="Borrower" hint="Which company holds it"><input className={inputCls} value={a.borrower || ''} onChange={e => set({ borrower: e.target.value })} placeholder="Marco's Mowing" /></Field>
          <Field label="End-of-term plan">
            <select className={inputCls} value={a.endOfTermPlan} onChange={e => set({ endOfTermPlan: e.target.value as EndOfTermPlan })}>
              {(Object.keys(END_PLAN_LABEL) as EndOfTermPlan[]).map(k => <option key={k} value={k}>{END_PLAN_LABEL[k]}</option>)}
            </select>
          </Field>
          <Field label="Start"><DateInput value={a.startDate} onChange={v => set({ startDate: v })} /></Field>
          <Field label="Term (months)"><NumInput value={a.termMonths} onChange={v => set({ termMonths: v || 0 })} /></Field>
          <Field label="Maturity" hint={isValidYmd(a.startDate) && a.termMonths > 0 && addMonths(a.startDate, a.termMonths) !== a.maturityDate ? `Start + term = ${fmtDate(addMonths(a.startDate, a.termMonths))}` : undefined}>
            <div className="flex gap-1">
              <DateInput value={a.maturityDate} onChange={v => set({ maturityDate: v })} />
              <button type="button" title="Set from start + term" onClick={fillMaturity} className="px-2 rounded-md border border-slate-300 text-xs font-bold text-slate-600">=</button>
            </div>
          </Field>
          {a.status === 'ended' && (
            <>
              <Field label="Ended on"><DateInput value={a.endedAt} onChange={v => set({ endedAt: v })} /></Field>
              <Field label="How it ended">
                <select className={inputCls} value={a.endReason || ''} onChange={e => set({ endReason: (e.target.value || undefined) as EndReason | undefined })}>
                  <option value="">—</option>
                  {(Object.keys(END_REASON_LABEL) as EndReason[]).map(k => <option key={k} value={k}>{END_REASON_LABEL[k]}</option>)}
                </select>
              </Field>
            </>
          )}
        </div>
      </Section>

      <Section title="Money in">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Acquisition cost (all units)"><MoneyInput value={a.acquisitionCost} onChange={c => set({ acquisitionCost: c || 0 })} /></Field>
          <Field label="Down payment"><MoneyInput value={a.downPayment} allowEmpty onChange={c => set({ downPayment: c ?? undefined })} /></Field>
          <Field label="Trade-in credit" hint={(a.tradeIns || []).length ? 'Sum of the trade-ins below' : undefined}>
            {(a.tradeIns || []).length
              ? <div className={`${inputCls} bg-slate-50`}>{MC(a.tradeInCredit || 0)}</div>
              : <MoneyInput value={a.tradeInCredit} allowEmpty onChange={c => set({ tradeInCredit: c ?? undefined })} />}
          </Field>
          <Field label="HST financed" hint="Tax on the purchase rolled into the loan"><MoneyInput value={a.taxFinanced} allowEmpty onChange={c => set({ taxFinanced: c ?? undefined })} /></Field>
          <Field label="Financed amount" hint={expectFinanced !== a.financedAmount ? `Cost − down − trade-in${a.taxFinanced ? ' + HST' : ''} = ${MC(expectFinanced)}` : undefined}>
            <div className="flex gap-1">
              <MoneyInput value={a.financedAmount} onChange={c => set({ financedAmount: c || 0 })} />
              <button type="button" title="Cost − down − trade-in + HST financed" onClick={fillFinanced} className="px-2 rounded-md border border-slate-300 text-xs font-bold text-slate-600">=</button>
            </div>
          </Field>
          <Field label="APR %" hint={isLease(a.type) ? 'Often unknown on a lease — leave blank' : 'Blank if unknown'}><NumInput step="0.01" allowEmpty value={a.aprPct ?? null} onChange={v => set({ aprPct: v })} /></Field>
        </div>
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Trade-ins</span>
            <span className="text-[11px] text-slate-400">part of the down payment</span>
            <button type="button" onClick={() => setTradeIns([...(a.tradeIns || []), { description: '', value: 0 }])} className="ml-auto text-xs font-bold text-emerald-700">+ Add</button>
          </div>
          {(a.tradeIns || []).map((t, i) => {
            const upd = (patch: Partial<typeof t>) => setTradeIns((a.tradeIns || []).map((y, j) => (j === i ? { ...y, ...patch } : y)));
            return (
              <div key={i} className="grid grid-cols-2 sm:grid-cols-[3fr_1fr_1fr_auto] gap-2 mb-1 items-center">
                <input className={`${inputCls} col-span-2 sm:col-span-1`} placeholder="Year, make, model of the traded unit" value={t.description} onChange={e => upd({ description: e.target.value })} />
                <input className={inputCls} placeholder="Serial" value={t.serial || ''} onChange={e => upd({ serial: e.target.value })} />
                <MoneyInput value={t.value} onChange={v => upd({ value: v || 0 })} />
                <button type="button" onClick={() => setTradeIns((a.tradeIns || []).filter((_, j) => j !== i))}><X className="w-4 h-4 text-slate-400 hover:text-red-600" /></button>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Payment plan">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Frequency">
            <select className={inputCls} value={a.plan.frequency} onChange={e => setPlan({ frequency: e.target.value as Frequency })}>
              {(Object.keys(FREQUENCY_LABEL) as Frequency[]).map(k => <option key={k} value={k}>{FREQUENCY_LABEL[k]}</option>)}
            </select>
          </Field>
          <Field label={a.tax.mode === 'included' ? 'Payment (tax included)' : 'Payment (before tax)'}><MoneyInput value={a.plan.amount} onChange={c => setPlan({ amount: c || 0 })} /></Field>
          <Field label="Number of payments"><NumInput value={a.plan.paymentCount} onChange={v => setPlan({ paymentCount: v || 0 })} /></Field>
          <Field label="First payment" hint="Often deferred, e.g. to spring"><DateInput value={a.plan.firstPaymentDate} onChange={v => setPlan({ firstPaymentDate: v })} /></Field>
          <Field label="Tax">
            <select className={inputCls} value={a.tax.mode} onChange={e => set({ tax: { ...a.tax, mode: e.target.value as TaxMode } })}>
              <option value="added">Added on top (HST charged on each payment)</option>
              <option value="included">Included in the payment</option>
              <option value="none">None</option>
            </select>
          </Field>
          <Field label="Tax rate %"><NumInput step="0.01" value={a.tax.ratePct} onChange={v => set({ tax: { ...a.tax, ratePct: v || 0 } })} /></Field>
          <Field label="Seasonal — months with no payment" span={3} hint="Skipped months don't count toward the number of payments">
            <div className="flex flex-wrap gap-1">
              {MONTHS.map((m, i) => {
                const on = (a.plan.skipMonths || []).includes(i + 1);
                return (
                  <button key={m} type="button" onClick={() => setPlan({ skipMonths: on ? (a.plan.skipMonths || []).filter(x => x !== i + 1) : [...(a.plan.skipMonths || []), i + 1].sort((x, y) => x - y) })}
                    className={`px-2 py-1 rounded text-xs font-bold border ${on ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-300'}`}>{m}</button>
                );
              })}
            </div>
          </Field>
        </div>

        <div className="mt-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Payment changes</span>
            <span className="text-[11px] text-slate-400">e.g. after one unit is paid out</span>
            <button type="button" onClick={() => set({ paymentChanges: [...(a.paymentChanges || []), { from: today, amount: a.plan.amount }] })} className="ml-auto text-xs font-bold text-emerald-700">+ Add</button>
          </div>
          {(a.paymentChanges || []).map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_2fr_auto] gap-2 mb-1 items-center">
              <DateInput value={c.from} onChange={v => set({ paymentChanges: (a.paymentChanges || []).map((x, j) => (j === i ? { ...x, from: v } : x)) })} />
              <MoneyInput value={c.amount} onChange={v => set({ paymentChanges: (a.paymentChanges || []).map((x, j) => (j === i ? { ...x, amount: v || 0 } : x)) })} />
              <input className={inputCls} placeholder="Note" value={c.note || ''} onChange={e => set({ paymentChanges: (a.paymentChanges || []).map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })} />
              <button type="button" onClick={() => set({ paymentChanges: (a.paymentChanges || []).filter((_, j) => j !== i) })}><X className="w-4 h-4 text-slate-400 hover:text-red-600" /></button>
            </div>
          ))}
        </div>
      </Section>

      <Section title={isLease(a.type) ? 'Residual / buyout and one-off payments' : 'Balloon and one-off payments'}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={isLease(a.type) ? 'Residual (buyout at maturity)' : 'Residual / balloon at maturity'} hint={a.endOfTermPlan === 'return' ? 'Plan is to return — not counted as a payment' : undefined}>
            <MoneyInput value={a.residual} allowEmpty onChange={c => set({ residual: c ?? undefined })} />
          </Field>
          <Field label="HST on the residual?">
            <select className={inputCls} value={a.residualTaxable ? 'y' : 'n'} onChange={e => set({ residualTaxable: e.target.value === 'y' })}>
              <option value="y">Yes — tax added at buyout</option>
              <option value="n">No</option>
            </select>
          </Field>
        </div>
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">One-off payments</span>
            <span className="text-[11px] text-slate-400">balloon, early payoff, fees</span>
            <button type="button" onClick={() => set({ extraPayments: [...(a.extraPayments || []), { date: today, amount: 0, kind: 'fee' }] })} className="ml-auto text-xs font-bold text-emerald-700">+ Add</button>
          </div>
          {(a.extraPayments || []).map((x, i) => {
            const upd = (patch: Partial<typeof x>) => set({ extraPayments: (a.extraPayments || []).map((y, j) => (j === i ? { ...y, ...patch } : y)) });
            return (
              <div key={i} className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_auto_2fr_auto] gap-2 mb-1 items-center">
                <DateInput value={x.date} onChange={v => upd({ date: v })} />
                <select className={inputCls} value={x.kind} onChange={e => upd({ kind: e.target.value as ExtraKind })}>
                  <option value="balloon">Balloon</option><option value="residual_buyout">Residual buyout</option><option value="payoff">Early payoff</option><option value="fee">Fee</option><option value="other">Other</option>
                </select>
                <MoneyInput value={x.amount} onChange={v => upd({ amount: v || 0 })} />
                <label className="text-xs text-slate-600 flex items-center gap-1"><input type="checkbox" checked={!!x.taxable} onChange={e => upd({ taxable: e.target.checked })} /> +HST</label>
                <input className={inputCls} placeholder="Note" value={x.note || ''} onChange={e => upd({ note: e.target.value })} />
                <button type="button" onClick={() => set({ extraPayments: (a.extraPayments || []).filter((_, j) => j !== i) })}><X className="w-4 h-4 text-slate-400 hover:text-red-600" /></button>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={`Equipment (${live.length})`} right={
        <div className="flex gap-2">
          {live.some(x => x.purchasePrice) && <button type="button" onClick={allocByPrice} className="text-xs font-bold text-slate-600 inline-flex items-center gap-1" title="Split the financed amount in proportion to purchase prices"><Scissors className="w-3.5 h-3.5" /> By price</button>}
          <button type="button" onClick={splitAlloc} className="text-xs font-bold text-slate-600 inline-flex items-center gap-1" title="Split the acquisition cost evenly"><Scissors className="w-3.5 h-3.5" /> Split cost</button>
          {(a.residual || 0) > 0 && <button type="button" onClick={splitResidual} className="text-xs font-bold text-slate-600 inline-flex items-center gap-1" title="Split the residual evenly"><Scissors className="w-3.5 h-3.5" /> Split residual</button>}
        </div>
      }>
        <div className="space-y-2">
          {a.assets.map((x, i) => {
            const u = x.fleetUnitId ? fleetById.get(x.fleetUnitId) : undefined;
            return (
              <div key={i} className={`border rounded-md p-2 ${x.removedAt ? 'bg-slate-50 border-slate-200 opacity-70' : 'border-slate-200'}`}>
                <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-end">
                  <div>
                    {x.fleetUnitId ? (
                      <div className="text-sm">
                        <span className="font-bold text-slate-800">{u ? fleetItemLabel(u) : x.labelSnapshot}</span>
                        {!u && <span className="ml-1 text-[11px] text-red-700 font-bold">(no longer in the fleet)</span>}
                        {u && isDisposed(u) && <span className="ml-1 text-[11px] text-slate-500 font-bold">({DISPOSAL_LABEL[u.disposal!.kind]})</span>}
                        {(u?.serialNumber || x.serialSnapshot) && <span className="ml-2 text-[11px] text-slate-500">S/N {u?.serialNumber || x.serialSnapshot}</span>}
                      </div>
                    ) : (
                      <Field label="Item (not in the fleet)"><input className={inputCls} value={x.description || ''} onChange={e => setAsset(i, { description: e.target.value, labelSnapshot: e.target.value })} placeholder="e.g. 3-pt snow blower" /></Field>
                    )}
                  </div>
                  <Field label="Purchase price"><MoneyInput value={x.purchasePrice} allowEmpty onChange={c => setAsset(i, { purchasePrice: c ?? undefined })} /></Field>
                  <Field label="Allocated value"><MoneyInput value={x.allocatedValue} onChange={c => setAsset(i, { allocatedValue: c || 0 })} /></Field>
                  <Field label="Residual share"><MoneyInput value={x.residualShare} allowEmpty onChange={c => setAsset(i, { residualShare: c ?? undefined })} /></Field>
                  <div className="flex gap-1 pb-1">
                    {!x.removedAt && (x.disposal
                      ? <button type="button" className="text-[11px] font-bold text-slate-600 border border-slate-300 rounded px-2 py-1" onClick={() => setAsset(i, { disposal: null })}>Not sold</button>
                      : <button type="button" className="text-[11px] font-bold text-slate-600 border border-slate-300 rounded px-2 py-1" title="Sold but still on the agreement — payments unchanged" onClick={() => setAsset(i, { disposal: { kind: 'sold', date: null } })}>Sold</button>)}
                    {!x.removedAt
                      ? <button type="button" className="text-[11px] font-bold text-slate-600 border border-slate-300 rounded px-2 py-1" title="Left the agreement mid-term (paid out, sold)" onClick={() => setAsset(i, { removedAt: today })}>Paid out</button>
                      : <button type="button" className="text-[11px] font-bold text-slate-600 border border-slate-300 rounded px-2 py-1" onClick={() => setAsset(i, { removedAt: undefined, removedReason: undefined })}>Undo</button>}
                    <button type="button" title="Remove (added by mistake)" onClick={() => setA(prev => ({ ...prev, assets: prev.assets.filter((_, j) => j !== i) }))}><Trash2 className="w-4 h-4 text-slate-400 hover:text-red-600" /></button>
                  </div>
                </div>
                {x.disposal && !x.removedAt && (
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_3fr] gap-2 mt-2">
                    <Field label="Sold on" hint={x.disposal.date ? undefined : 'Not known yet — flagged'}><DateInput value={x.disposal.date || ''} onChange={v => setAsset(i, { disposal: { ...x.disposal!, date: v || null } })} /></Field>
                    <Field label="Note" hint="Still on the agreement — the sale did not pay down the loan"><input className={inputCls} value={x.disposal.note || ''} onChange={e => setAsset(i, { disposal: { ...x.disposal!, note: e.target.value } })} /></Field>
                  </div>
                )}
                {!x.removedAt && <div className="mt-2"><WhatsLeftBarView bar={unitWhatsLeft(a, whatsLeft(a, figures, today), x)} compact /></div>}
                {x.removedAt && (
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_3fr] gap-2 mt-2">
                    <Field label="Left the agreement on"><DateInput value={x.removedAt} onChange={v => setAsset(i, { removedAt: v })} /></Field>
                    <Field label="Why" hint="Add a payment change from this date if the payment dropped"><input className={inputCls} value={x.removedReason || ''} onChange={e => setAsset(i, { removedReason: e.target.value })} placeholder="Paid out early / sold" /></Field>
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex gap-2 flex-wrap items-center">
            <select className={`${inputCls} sm:w-80`} value="" onChange={e => { if (e.target.value) addUnit(e.target.value); }}>
              <option value="">+ Add a fleet unit…</option>
              {pickable.map(u => <option key={u.id} value={u.id}>{fleetItemLabel(u)}</option>)}
            </select>
            <button type="button" onClick={addItem} className="text-xs font-bold text-emerald-700">+ Item not in the fleet</button>
          </div>
          {pickable.length === 0 && <div className="text-xs text-slate-500">Every fleet unit is already on this agreement.</div>}
        </div>
      </Section>

      <Section title="Lender balance" defaultOpen={!!a.balanceOverride}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <Field label="Balance on the statement"><MoneyInput value={a.balanceOverride?.amount ?? null} allowEmpty onChange={c => set({ balanceOverride: c == null ? null : { amount: c, asOf: a.balanceOverride?.asOf || today } })} /></Field>
          <Field label="As of"><DateInput value={a.balanceOverride?.asOf} onChange={v => a.balanceOverride && set({ balanceOverride: { ...a.balanceOverride, asOf: v } })} /></Field>
          <div className="text-xs text-slate-500 pb-2">Replaces the estimate. Payments after this date are taken off it.</div>
        </div>
      </Section>

      <Section title={`Documents (${(a.documents || []).length})`}>
        <div className="space-y-1">
          {(a.documents || []).map(d => (
            <div key={d.path} className="flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4 text-slate-400" />
              <a href={d.url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline truncate">{d.name}</a>
              <span className="text-[11px] text-slate-500">{DOC_TYPE_LABEL[d.docType] || d.docType}</span>
              <span className="text-[11px] text-slate-400">{new Date(d.uploadedAt).toLocaleDateString('en-CA')}</span>
              <div className="flex-1" />
              <button onClick={() => removeDoc(d.path)}><Trash2 className="w-4 h-4 text-slate-400 hover:text-red-600" /></button>
            </div>
          ))}
          <div className="flex gap-2 items-center flex-wrap pt-1">
            <select className={`${inputCls} w-48`} value={docType} onChange={e => setDocType(e.target.value as FinanceDocType)}>
              {(Object.keys(DOC_TYPE_LABEL) as FinanceDocType[]).map(k => <option key={k} value={k}>{DOC_TYPE_LABEL[k]}</option>)}
            </select>
            <label className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-300 bg-white text-sm font-bold text-slate-700 cursor-pointer hover:bg-slate-50">
              <Upload className="w-4 h-4" /> {uploading != null ? `Uploading ${uploading}%` : 'Upload PDF or photo'}
              <input type="file" accept="application/pdf,image/*" multiple className="hidden" disabled={uploading != null} onChange={e => { upload(e.target.files); e.target.value = ''; }} />
            </label>
            {isNew && <span className="text-[11px] text-slate-500">Save the agreement to keep uploads.</span>}
          </div>
        </div>
      </Section>

      <Section title="Notes">
        <textarea className={`${inputCls} min-h-[80px]`} value={a.notes || ''} onChange={e => set({ notes: e.target.value })} />
      </Section>

      <Section title={`Payment schedule (${figures.schedule.length})`} defaultOpen={false} right={<button onClick={() => setShowSchedule(!showSchedule)} className="text-xs font-bold text-slate-500">{showSchedule ? 'Upcoming only' : 'Show all'}</button>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase text-slate-500 text-left"><th className="py-1">Date</th><th>What</th><th className="text-right">Before tax</th><th className="text-right">Tax</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {figures.schedule.filter(p => showSchedule || p.date > today).map((p, i) => (
                <tr key={i} className={`border-t border-slate-100 ${p.date <= today ? 'text-slate-400' : ''} ${p.kind !== 'regular' ? 'font-bold' : ''}`}>
                  <td className="py-1">{fmtDate(p.date)}</td>
                  <td>{p.kind === 'regular' ? `Payment ${p.index}` : p.kind === 'residual' ? 'Residual / buyout' : p.kind.replace('_', ' ')}</td>
                  <td className="text-right">{MC(p.preTax)}</td><td className="text-right">{MC(p.tax)}</td><td className="text-right">{MC(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {!isNew && (
        <Section title={`History (${(a.audit || []).length})`} defaultOpen={false}>
          <div className="space-y-2 text-sm">
            {[...(a.audit || [])].reverse().map((e, i) => (
              <div key={i}>
                <div className="text-[11px] text-slate-500">{new Date(e.at).toLocaleString('en-CA')} · {e.by}</div>
                <ul className="list-disc ml-5 text-slate-700">{e.changes.map((c, j) => <li key={j}>{c}</li>)}</ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      {!isNew && (
        <div className="flex justify-end">
          <button onClick={softDelete} className="inline-flex items-center gap-1 text-sm font-bold text-red-700 hover:text-red-900"><Trash2 className="w-4 h-4" /> Delete agreement</button>
        </div>
      )}
    </div>
  );
}

function FiguresPanel({ a, f }: { a: FinanceAgreement; f: ReturnType<typeof agreementFigures> }) {
  const balLabel = f.balanceSource === 'lender' ? `Lender balance (${fmtDate(f.balanceAsOf)}${f.balanceAsOf ? ', less payments since' : ''})`
    : f.balanceSource === 'estimate' ? 'Estimated balance (from APR)'
    : isLease(a.type) ? 'Remaining obligation' : 'Remaining payments';
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <Stat label="Payments" value={`${f.paymentsMade} made · ${f.paymentsRemaining} left`} sub={f.nextPayment ? `Next ${fmtDate(f.nextPayment.date)} · ${MC(f.nextPayment.total)}` : 'None ahead'} dashed={a.status === 'proposed'} />
      <Stat label="Per month" value={M(f.monthlyEquivalent)} sub={a.plan.frequency !== 'monthly' || (a.plan.skipMonths || []).length ? 'averaged over the year, before HST' : 'before HST'} dashed={a.status === 'proposed'} />
      <Stat label={balLabel} value={M(f.balance)} sub={f.residualRemaining ? `incl. residual ${M(f.residualRemaining)}` : undefined} dashed={a.status === 'proposed'} />
      <Stat label="Cost of borrowing" value={M(f.costOfBorrowing)} sub={`All payments ${M(f.totalPayments)} − financed`} dashed={a.status === 'proposed'} />
    </div>
  );
}

// ── Fleet badge (finance viewer only) ───────────────────────────────────────

/** "Financed · matures Aug 2030" next to a unit; the full line in the tooltip. */
export function FinanceBadge({ items, onOpen }: { items: UnitFinance[] | undefined; onOpen?: (agreementId: string) => void }) {
  if (!items || !items.length) return null;
  const cur = items.find(x => x.agreement.status === 'active') || items[0];
  const { agreement: a, figures: f } = cur;
  const proposed = a.status === 'proposed';
  const tip = [
    `${DISPLAY_STATUS_LABEL[f.displayStatus]} · ${a.lender}`,
    `${fmtMoney(a.plan.amount)}/${a.plan.frequency === 'monthly' ? 'month' : FREQUENCY_LABEL[a.plan.frequency].toLowerCase()} group payment${a.aprPct ? ` · ${a.aprPct}%` : ''}`,
    `Matures ${fmtMonth(a.maturityDate)}${cur.residualShare ? ` · Residual ${fmtMoney(cur.residualShare)} allocated to this unit` : ''}`,
    items.length > 1 ? `+ ${items.length - 1} more (incl. proposed)` : '',
  ].filter(Boolean).join('\n');
  return (
    <span
      role="button"
      title={tip}
      onClick={e => { e.stopPropagation(); onOpen?.(a.id); }}
      className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded border cursor-pointer whitespace-nowrap ${proposed ? 'border-dashed border-slate-400 text-slate-600 bg-white' : f.displayStatus === 'past_maturity' ? 'bg-red-100 text-red-800 border-red-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'}`}
    >
      <Landmark className="w-3 h-3" />{proposed ? 'Proposed' : f.displayStatus === 'past_maturity' ? 'Past maturity' : 'Financed'} · {fmtMonth(a.maturityDate)}
    </span>
  );
}

// ── "What's left" bar ───────────────────────────────────────────────────────
const SEG = {
  down: { cls: 'bg-sky-300', label: 'Down / trade-in' },
  paid: { cls: 'bg-emerald-500', label: 'Paid' },
  owing: { cls: 'bg-amber-400', label: 'Still owing' },
  residual: { cls: 'bg-violet-500', label: 'Residual due' },
  unscheduled: { cls: 'bg-slate-300', label: 'Not in the schedule' },
} as const;

/** Down · paid · owing · residual, adding up to what was financed. Plain CSS. */
export function WhatsLeftBarView({ bar, compact }: { bar: WhatsLeftBar; compact?: boolean }) {
  if (bar.total <= 0) return null;
  const keys = (['down', 'paid', 'owing', 'residual', 'unscheduled'] as const).filter(k => bar[k] > 0);
  return (
    <div>
      <div className={`flex w-full overflow-hidden rounded ${compact ? 'h-2' : 'h-3'} bg-slate-100`} role="img"
        aria-label={keys.map(k => `${SEG[k].label} ${fmtMoney(bar[k])}`).join(', ')}>
        {keys.map(k => <div key={k} className={SEG[k].cls} style={{ width: `${(bar[k] / bar.total) * 100}%` }} title={`${SEG[k].label}: ${fmtMoney(bar[k], { cents: true })}`} />)}
      </div>
      <div className={`flex flex-wrap gap-x-3 gap-y-0.5 mt-1 ${compact ? 'text-[10px]' : 'text-[11px]'} text-slate-600`}>
        {keys.map(k => (
          <span key={k} className="inline-flex items-center gap-1 whitespace-nowrap">
            <span className={`inline-block w-2 h-2 rounded-sm ${SEG[k].cls}`} />{SEG[k].label} <b className="text-slate-800">{fmtMoney(bar[k])}</b>
          </span>
        ))}
        {bar.count > 0 && <span className="whitespace-nowrap text-slate-500">{bar.made} of {bar.count} payments made</span>}
      </div>
    </div>
  );
}

// ── Fleet unit Finance panel (finance viewer only) ──────────────────────────
export function FinanceUnitPanel({ unitId, items, today, onOpen }: { unitId: string; items: UnitFinance[] | undefined; today: string; onOpen?: (agreementId: string) => void }) {
  if (!items || !items.length) return null;
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50/40 p-2 space-y-2">
      <div className="flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-emerald-800"><Landmark className="w-3.5 h-3.5" /> Finance <span className="font-bold normal-case text-slate-500 tracking-normal">· only you see this</span></div>
      {items.map(({ agreement: a, figures: f, residualShare }) => {
        const asset = a.assets.find(x => x.fleetUnitId === unitId);
        if (!asset) return null;
        const bar = unitWhatsLeft(a, whatsLeft(a, f, today), asset);
        return (
          <div key={a.id} className={a.status === 'proposed' ? 'border border-dashed border-slate-400 rounded p-1.5' : ''}>
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <StatusPill status={f.displayStatus} />
              <button type="button" onClick={(e) => { e.stopPropagation(); onOpen?.(a.id); }} className="font-bold text-sky-700 hover:underline">{a.lender}</button>
              <span className="text-slate-600">{fmtMoney(a.plan.amount)}/{a.plan.frequency === 'monthly' ? 'mo' : FREQUENCY_LABEL[a.plan.frequency].toLowerCase()} group{a.aprPct != null ? ` · ${a.aprPct}%` : ''}</span>
              <span className="text-slate-600">Matures {fmtMonth(a.maturityDate)}</span>
              {residualShare > 0 && <span className="text-slate-600">Residual {fmtMoney(residualShare)} this unit</span>}
              {asset.disposal && <span className="text-[10px] font-black uppercase text-slate-500">{asset.disposal.kind}{asset.disposal.date ? ` ${asset.disposal.date}` : ' (date?)'}</span>}
            </div>
            <div className="mt-1"><WhatsLeftBarView bar={bar} compact /></div>
          </div>
        );
      })}
    </div>
  );
}

// ── Contracts: every agreement document in one place ────────────────────────
// Same Storage path (financing/{agreementId}/) and the same finance-only rule
// as the per-agreement upload; uploads here are saved onto that agreement.
function agreementLabel(a: FinanceAgreement, fleetById: Map<string, FleetItem>): string {
  const names = liveAssets(a).map(x => unitName(x, fleetById));
  const units = names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  return `${a.lender || 'Unnamed lender'}${a.agreementNumber ? ` #${a.agreementNumber}` : ''}${units ? ` — ${units}` : ''}`;
}

export function ContractsView({ agreements, fleetById, currentUser, onSave, onOpenAgreement }: {
  agreements: FinanceAgreement[];
  fleetById: Map<string, FleetItem>;
  currentUser: { email: string; name: string };
  onSave: (a: FinanceAgreement) => Promise<boolean>;
  onOpenAgreement?: (id: string) => void;
}) {
  const [fAgreement, setFAgreement] = useState('');
  const [fType, setFType] = useState<FinanceDocType | ''>('');
  const [upAgreement, setUpAgreement] = useState('');
  const [upType, setUpType] = useState<FinanceDocType>('financing_contract');
  const [uploading, setUploading] = useState<number | null>(null);

  const sorted = useMemo(() => [...agreements].sort((x, y) => agreementLabel(x, fleetById).localeCompare(agreementLabel(y, fleetById))), [agreements, fleetById]);
  const rows = useMemo(() => agreements
    .flatMap(a => (a.documents || []).map(d => ({ a, d })))
    .filter(({ a, d }) => (!fAgreement || a.id === fAgreement) && (!fType || d.docType === fType))
    .sort((x, y) => (y.d.uploadedAt || 0) - (x.d.uploadedAt || 0)), [agreements, fAgreement, fType]);
  const missing = agreements.filter(a => a.status !== 'ended' && !(a.documents || []).some(d => CONTRACT_DOC_TYPES.includes(d.docType)));

  const upload = async (files: FileList | null) => {
    const target = agreements.find(a => a.id === upAgreement);
    if (!files || !files.length || !target) return;
    let docs: FinanceDocument[] = [...(target.documents || [])];
    try {
      for (const file of Array.from(files)) {
        setUploading(0);
        const sf = await uploadFile(`financing/${target.id}`, file, { uploadedBy: currentUser, onProgress: setUploading });
        docs = [...docs, { ...sf, docType: upType }];
        if (!(await onSave({ ...target, documents: docs }))) break;
      }
    } catch (e: any) {
      window.alert(`Upload failed: ${e?.message || e}`);
    } finally { setUploading(null); }
  };

  return (
    <div className="space-y-3">
      {missing.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div className="font-bold flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Missing contract ({missing.length})</div>
          <ul className="mt-1 space-y-0.5">
            {missing.map(a => (
              <li key={a.id} className="flex items-center gap-2 flex-wrap">
                <button className="underline text-left" onClick={() => onOpenAgreement?.(a.id)}>{agreementLabel(a, fleetById)}</button>
                <button className="text-xs font-bold text-emerald-800" onClick={() => { setUpAgreement(a.id); setUpType(isLease(a.type) ? 'lease_contract' : 'financing_contract'); }}>Attach…</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 p-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Upload a document</div>
        <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_auto] gap-2 items-center">
          <select className={inputCls} value={upAgreement} onChange={e => setUpAgreement(e.target.value)}>
            <option value="">Which agreement?</option>
            {sorted.map(a => <option key={a.id} value={a.id}>{agreementLabel(a, fleetById)}</option>)}
          </select>
          <select className={inputCls} value={upType} onChange={e => setUpType(e.target.value as FinanceDocType)}>
            {(Object.keys(DOC_TYPE_LABEL) as FinanceDocType[]).map(k => <option key={k} value={k}>{DOC_TYPE_LABEL[k]}</option>)}
          </select>
          <label className={`inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-md border text-sm font-bold ${upAgreement ? 'border-slate-300 bg-white text-slate-700 cursor-pointer hover:bg-slate-50' : 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'}`}>
            <Upload className="w-4 h-4" /> {uploading != null ? `Uploading ${uploading}%` : 'PDF or photo'}
            <input type="file" accept="application/pdf,image/*" multiple className="hidden" disabled={!upAgreement || uploading != null} onChange={e => { upload(e.target.files); e.target.value = ''; }} />
          </label>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <select className={`${inputCls} sm:w-80`} value={fAgreement} onChange={e => setFAgreement(e.target.value)}>
          <option value="">All agreements</option>
          {sorted.map(a => <option key={a.id} value={a.id}>{agreementLabel(a, fleetById)}</option>)}
        </select>
        <select className={`${inputCls} sm:w-56`} value={fType} onChange={e => setFType(e.target.value as FinanceDocType | '')}>
          <option value="">All types</option>
          {(Object.keys(DOC_TYPE_LABEL) as FinanceDocType[]).map(k => <option key={k} value={k}>{DOC_TYPE_LABEL[k]}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="text-center text-slate-500 py-10 border border-dashed border-slate-300 rounded-lg">No documents{fAgreement || fType ? ' match' : ' yet'}.</div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">
          {rows.map(({ a, d }) => (
            <a key={d.path} href={d.url} target="_blank" rel="noreferrer" className="flex items-start gap-3 px-3 py-2 hover:bg-slate-50">
              <FileText className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-sky-800 truncate">{d.name}</div>
                <div className="text-xs text-slate-500 truncate">{agreementLabel(a, fleetById)}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px] font-bold text-slate-600">{DOC_TYPE_LABEL[d.docType] || d.docType}</div>
                <div className="text-[11px] text-slate-400">{d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString('en-CA') : ''}</div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

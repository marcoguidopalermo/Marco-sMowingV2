// OFFICEMASTER — one screen of everything with a deadline or needing office
// attention, soonest first. Dave (office@) and Marco only: the App gates on the
// real sign-in address; firestore.rules / storage.rules enforce it.
import { useMemo, useState, type ReactNode } from 'react';
import { Building2, Truck, CalendarClock, Wallet, Receipt, RefreshCw, ChevronDown, ChevronRight, Plus, Check, FileText, Upload, Trash2, ExternalLink, AlertTriangle, ListTodo, Lock } from 'lucide-react';
import type { FleetItem } from '../types';
import { fleetItemLabel } from '../lib/fleetUtils';
import { fleetCompliance, COMPLIANCE_LABEL } from '../lib/office/compliance';
import {
  CATEGORY_LABEL, RECURRENCE_OPTIONS, recurrenceLabel, dueTone, dueLabel, sortDeadlines, completeDeadline, newDeadlineId,
  type OfficeDeadline, type DeadlineCategory, type Recurrence,
} from '../lib/office/deadlines';
import { daysUntilDate } from '../lib/dateUtils';
import { previousPayPeriod, currentPayPeriod, periodRangeLabel, payDateLabel, type PayPeriodSettings } from '../lib/payPeriods';
import { uploadFile } from '../lib/storage';

// officeAR/latest as written by functions/src/jobber/officeAR.ts.
type AgeKey = 'notDue' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus';
export interface OfficeARDoc {
  status?: 'ok' | 'error' | 'skipped';
  lastAttemptAt?: number; lastAttemptKind?: string; lastError?: string | null;
  lastSuccessAt?: number; lastSuccessKind?: string; paidCheck?: 'full' | 'none'; paidCheckAt?: number | null;
  cost?: { queries: number; requestedMax: number; actualTotal: number; minAvailable: number | null; ms: number };
  data?: {
    owed: number; invoiceCount: number;
    aging: Record<AgeKey, { count: number; amount: number }>;
    chase: { invoiceId: string; invoiceNumber: string; client: string; balance: number; total: number; dueDate: string | null; daysOverdue: number; lastPayment: { date: string; amount: number } | null; url: string }[];
    mismatches: { kind: 'paid_with_balance' | 'zero_balance_open'; invoiceNumber: string; client: string; status: string; balance: number; total?: number; issued?: string | null; paid?: string | null; url: string }[];
    paidUnrecorded?: { count: number; amount: number; last12Months: { count: number; amount: number } };
    noInvoiceClients: { client: string; clientId: string; balance: number; url: string }[];
    credits: { clients: number; amount: number };
    badDebt: { count: number; amount: number };
    reconciliation: { openInvoices: number; owedWithoutInvoice: number; clientBalancesOwed: number; difference: number; clientsWithOpenInvoices: number; clientsNotMatching: number };
    duplicatesRemoved: number;
  };
}

interface Props {
  fleet: FleetItem[];
  deadlines: OfficeDeadline[];
  ar: OfficeARDoc | null | undefined;     // undefined = loading, null = never pulled
  arListenError?: string | null;
  payPeriod: PayPeriodSettings;
  today: string;
  currentUser: { email: string; name: string };
  onSaveDeadlines: (items: OfficeDeadline[]) => Promise<boolean>;
  onRefreshAR: () => Promise<{ status: string; message?: string }>;
  onOpenFleetUnit: (unitId: string) => void;
}

const $ = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const $0 = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-CA')}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (ymd?: string | null) => (ymd && /^\d{4}-\d{2}-\d{2}/.test(ymd) ? `${MON[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}, ${ymd.slice(0, 4)}` : '—');
const ago = (ms?: number) => {
  if (!ms) return '—';
  const m = Math.round((Date.now() - ms) / 60000);
  const t = new Date(ms).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return m < 1 ? `just now (${t})` : m < 60 ? `${m} min ago (${t})` : t;
};
const TONE_ROW = { red: 'text-red-700', amber: 'text-amber-800', none: 'text-slate-700' } as const;
const TONE_DOT = { red: 'bg-red-500', amber: 'bg-amber-400', none: 'bg-slate-300' } as const;

function Card({ icon, title, right, children }: { icon: ReactNode; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm min-w-0">
      <header className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-2.5 border-b border-slate-100">
        <span className="text-slate-500">{icon}</span>
        <h2 className="font-black text-slate-800 text-sm uppercase tracking-wide">{title}</h2>
        <div className="flex-1" />
        {right}
      </header>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}
function Fold({ label, count, children, defaultOpen = false, tone = 'slate' }: { label: string; count: number; children: ReactNode; defaultOpen?: boolean; tone?: 'slate' | 'amber' }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!count) return null;
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen(!open)} className={`flex items-center gap-1 text-xs font-black uppercase tracking-wide ${tone === 'amber' ? 'text-amber-700' : 'text-slate-500'}`}>
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}{label} ({count})
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

export default function OfficeMaster(props: Props) {
  const { fleet, deadlines, ar, payPeriod, today } = props;
  const compliance = useMemo(() => fleetCompliance(fleet), [fleet]);
  const sorted = useMemo(() => sortDeadlines(deadlines), [deadlines]);
  const overdueDeadlines = sorted.open.filter(x => daysUntilDate(x.dueDate!) < 0).length;
  const fleetRed = compliance.rows.filter(r => r.state === 'expired').length;
  const pastDue = ar?.data ? ar.data.owed - ar.data.aging.notDue.amount : null;

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 space-y-4 overflow-x-hidden">
      <div className="flex items-center gap-2 flex-wrap">
        <Building2 className="w-6 h-6 text-sky-700" />
        <h1 className="text-2xl font-black text-slate-800">Office</h1>
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 bg-slate-100 border border-slate-200 rounded px-2 py-0.5"><Lock className="w-3 h-3" /> Dave &amp; Marco</span>
      </div>
      <div className="flex flex-wrap gap-2 text-xs font-bold">
        <Chip tone={overdueDeadlines ? 'red' : 'none'}>{overdueDeadlines} deadline{overdueDeadlines === 1 ? '' : 's'} overdue</Chip>
        <Chip tone={fleetRed ? 'red' : 'none'}>{fleetRed} fleet renewal{fleetRed === 1 ? '' : 's'} expired</Chip>
        <Chip tone={compliance.missing.length ? 'amber' : 'none'}>{compliance.missing.length} fleet date{compliance.missing.length === 1 ? '' : 's'} not entered</Chip>
        <Chip tone={pastDue ? 'amber' : 'none'}>{pastDue == null ? 'A/R: data unavailable' : `${$0(pastDue)} past due`}</Chip>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="space-y-4 min-w-0">
          <DeadlinesCard {...props} sorted={sorted} />
          <ComplianceCard compliance={compliance} onOpen={props.onOpenFleetUnit} />
          <PayrollCard payPeriod={payPeriod} today={today} />
        </div>
        <div className="space-y-4 min-w-0">
          <ARCard ar={ar} listenError={props.arListenError} onRefresh={props.onRefreshAR} />
          <Card icon={<ListTodo className="w-4 h-4" />} title="Tasks">
            <div className="text-sm text-slate-500">TaskMaster will show here.</div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Chip({ tone, children }: { tone: 'red' | 'amber' | 'none'; children: ReactNode }) {
  const cls = tone === 'red' ? 'bg-red-50 text-red-800 border-red-200' : tone === 'amber' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-white text-slate-600 border-slate-200';
  return <span className={`px-2.5 py-1 rounded-full border ${cls}`}>{children}</span>;
}

// ── 1. Fleet compliance ─────────────────────────────────────────────────────
function ComplianceCard({ compliance, onOpen }: { compliance: ReturnType<typeof fleetCompliance>; onOpen: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const urgent = compliance.rows.filter(r => r.state !== 'ok');
  const shown = all ? compliance.rows : (urgent.length >= 6 ? urgent : compliance.rows.slice(0, Math.max(6, urgent.length)));
  return (
    <Card icon={<Truck className="w-4 h-4" />} title="Fleet compliance" right={<span className="text-[11px] text-slate-500">registration · safety</span>}>
      {compliance.rows.length === 0 ? <div className="text-sm text-slate-500">No dates entered.</div> : (
        <div className="divide-y divide-slate-100">
          {shown.map(r => {
            const tone = r.state === 'expired' ? 'red' : r.state === 'expiring' ? 'amber' : 'none';
            return (
              <button key={`${r.unit.id}-${r.key}`} type="button" onClick={() => onOpen(r.unit.id)} className={`w-full flex items-center gap-2 py-1.5 text-left text-sm hover:bg-slate-50 ${TONE_ROW[tone]}`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${TONE_DOT[tone]}`} />
                <span className="font-bold truncate min-w-0 flex-1">{fleetItemLabel(r.unit)}</span>
                <span className="text-xs text-slate-500 shrink-0">{COMPLIANCE_LABEL[r.key]}</span>
                <span className="text-xs shrink-0 w-24 text-right">{fmtDate(r.expiryDate)}</span>
                <span className="text-xs font-bold shrink-0 w-28 text-right hidden sm:block">{r.countdown}</span>
              </button>
            );
          })}
        </div>
      )}
      {compliance.rows.length > shown.length && <button type="button" onClick={() => setAll(true)} className="mt-2 text-xs font-bold text-sky-700">Show all {compliance.rows.length}</button>}
      <Fold label="Not entered" count={compliance.missing.length} tone="amber" defaultOpen>
        <div className="flex flex-wrap gap-1.5">
          {compliance.missing.map(m => (
            <button key={`${m.unit.id}-${m.key}`} type="button" onClick={() => onOpen(m.unit.id)} className="text-xs px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100">
              {fleetItemLabel(m.unit)} · {COMPLIANCE_LABEL[m.key]}
            </button>
          ))}
        </div>
      </Fold>
    </Card>
  );
}

// ── 2. Company deadlines & notices ──────────────────────────────────────────
const inputCls = 'w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white';
function DeadlinesCard({ sorted, onSaveDeadlines, currentUser }: Props & { sorted: ReturnType<typeof sortDeadlines> }) {
  const [editing, setEditing] = useState<OfficeDeadline | null>(null);
  const [isNew, setIsNew] = useState(false);
  const startNew = (kind: 'deadline' | 'notice') => {
    setEditing({ id: newDeadlineId(), kind, title: '', category: kind === 'notice' ? 'government' : 'other', dueDate: null, status: 'open', recurrence: null, documents: [] });
    setIsNew(true);
  };
  const markDone = async (x: OfficeDeadline) => {
    const { done, next } = completeDeadline(x, currentUser.name || currentUser.email);
    await onSaveDeadlines(next ? [done, next] : [done]);
  };
  const row = (x: OfficeDeadline) => {
    const d = x.dueDate ? daysUntilDate(x.dueDate) : null;
    const tone = x.status === 'done' ? 'none' : dueTone(d);
    return (
      <div key={x.id} className={`flex items-center gap-2 py-1.5 text-sm ${TONE_ROW[tone]}`}>
        <span className={`w-2 h-2 rounded-full shrink-0 ${TONE_DOT[tone]}`} />
        <button type="button" onClick={() => { setEditing(x); setIsNew(false); }} className="flex-1 min-w-0 text-left break-words">
          <span className="font-bold">{x.title || 'Untitled'}</span>
          <span className="text-xs text-slate-500 ml-1.5">{x.kind === 'notice' ? 'Notice · ' : ''}{CATEGORY_LABEL[x.category]}{x.recurrence ? ` · ${recurrenceLabel(x.recurrence)}` : ''}{(x.documents || []).length ? ` · ${(x.documents || []).length} doc` : ''}</span>
          <span className="block text-xs">{x.status === 'done' ? `Done ${x.doneAt ? new Date(x.doneAt).toLocaleDateString('en-CA') : ''}${x.doneBy ? ` by ${x.doneBy}` : ''}` : (x.dueDate ? `${fmtDate(x.dueDate)} · ${dueLabel(d)}` : 'No date yet')}</span>
        </button>
        {x.status === 'open' && <button type="button" title="Mark done" onClick={() => markDone(x)} className="shrink-0 p-1.5 rounded-md border border-slate-200 text-emerald-700 hover:bg-emerald-50"><Check className="w-4 h-4" /></button>}
      </div>
    );
  };
  return (
    <Card icon={<CalendarClock className="w-4 h-4" />} title="Company deadlines & notices" right={
      <div className="flex gap-1">
        <button type="button" onClick={() => startNew('deadline')} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-sky-700 text-white text-xs font-bold"><Plus className="w-3.5 h-3.5" /> Deadline</button>
        <button type="button" onClick={() => startNew('notice')} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-300 text-slate-700 text-xs font-bold"><Plus className="w-3.5 h-3.5" /> Notice</button>
      </div>
    }>
      {editing && <DeadlineEditor initial={editing} isNew={isNew} currentUser={currentUser} onSave={onSaveDeadlines} onDone={markDone} onClose={() => setEditing(null)} />}
      {sorted.open.length === 0 && sorted.noDate.length === 0 ? <div className="text-sm text-slate-500">Nothing open.</div> : (
        <div className="divide-y divide-slate-100">{sorted.open.map(row)}</div>
      )}
      <Fold label="Needs a date" count={sorted.noDate.length} tone="amber" defaultOpen>
        <div className="divide-y divide-slate-100">{sorted.noDate.map(row)}</div>
      </Fold>
      <Fold label="Done" count={sorted.done.length}>
        <div className="divide-y divide-slate-100 opacity-75">{sorted.done.slice(0, 50).map(row)}</div>
      </Fold>
    </Card>
  );
}

function DeadlineEditor({ initial, isNew, currentUser, onSave, onDone, onClose }: { initial: OfficeDeadline; isNew: boolean; currentUser: { email: string; name: string }; onSave: (items: OfficeDeadline[]) => Promise<boolean>; onDone: (x: OfficeDeadline) => Promise<void>; onClose: () => void }) {
  const [x, setX] = useState<OfficeDeadline>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const set = (p: Partial<OfficeDeadline>) => setX(prev => ({ ...prev, ...p }));
  const save = async (next = x) => {
    if (!next.title.trim()) { window.alert('Give it a title.'); return false; }
    setBusy('Saving…');
    const ok = await onSave([{ ...next, title: next.title.trim() }]);
    setBusy(null);
    return ok;
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    let docs = [...(x.documents || [])];
    try {
      for (const f of Array.from(files)) {
        setBusy('Uploading…');
        docs = [...docs, await uploadFile(`office/${x.id}`, f, { uploadedBy: currentUser })];
      }
      const next = { ...x, documents: docs };
      setX(next);
      if (!isNew) await onSave([next]);   // saved at once so the file is never orphaned
    } catch (e: any) { window.alert(`Upload failed: ${e?.message || e}`); } finally { setBusy(null); }
  };
  const recIdx = RECURRENCE_OPTIONS.findIndex(o => (!o.value && !x.recurrence) || (o.value && x.recurrence && o.value.every === x.recurrence.every && o.value.unit === x.recurrence.unit));
  return (
    <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50/40 p-3 space-y-2">
      <div className="text-xs font-black uppercase tracking-wide text-sky-800">{isNew ? (x.kind === 'notice' ? 'New notice' : 'New deadline') : x.kind === 'notice' ? 'Notice' : 'Deadline'}</div>
      <input className={inputCls} placeholder={x.kind === 'notice' ? 'e.g. MTO letter — vehicle inspection' : 'e.g. CVOR renewal'} value={x.title} onChange={e => set({ title: e.target.value })} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="col-span-1"><span className="block text-[11px] font-bold text-slate-500 uppercase">Category</span>
          <select className={inputCls} value={x.category} onChange={e => set({ category: e.target.value as DeadlineCategory })}>
            {(Object.keys(CATEGORY_LABEL) as DeadlineCategory[]).map(k => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}
          </select></label>
        <label className="col-span-1"><span className="block text-[11px] font-bold text-slate-500 uppercase">{x.kind === 'notice' ? 'Respond by' : 'Due / renewal'}</span>
          <input type="date" className={inputCls} value={x.dueDate || ''} onChange={e => set({ dueDate: e.target.value || null })} /></label>
        <label className="col-span-1"><span className="block text-[11px] font-bold text-slate-500 uppercase">Repeats</span>
          <select className={inputCls} value={recIdx < 0 ? 0 : recIdx} onChange={e => set({ recurrence: RECURRENCE_OPTIONS[Number(e.target.value)].value as Recurrence | null })}>
            {RECURRENCE_OPTIONS.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
          </select></label>
        <label className="col-span-1"><span className="block text-[11px] font-bold text-slate-500 uppercase">Reference #</span>
          <input className={inputCls} value={x.reference || ''} onChange={e => set({ reference: e.target.value })} /></label>
      </div>
      <textarea className={`${inputCls} min-h-[60px]`} placeholder="Notes" value={x.notes || ''} onChange={e => set({ notes: e.target.value })} />
      <div className="space-y-1">
        {(x.documents || []).map(d => (
          <a key={d.path} href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-sky-800 hover:underline"><FileText className="w-4 h-4" />{d.name}</a>
        ))}
        <label className="inline-flex items-center gap-1 text-xs font-bold text-slate-700 cursor-pointer"><Upload className="w-3.5 h-3.5" /> Attach letter / document
          <input type="file" accept="application/pdf,image/*" multiple className="hidden" onChange={e => { upload(e.target.files); e.target.value = ''; }} /></label>
      </div>
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <button type="button" disabled={!!busy} onClick={async () => { if (await save()) onClose(); }} className="px-3 py-1.5 rounded-md bg-sky-700 text-white text-sm font-bold disabled:opacity-50">{busy || 'Save'}</button>
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md border border-slate-300 text-sm font-bold text-slate-700">Cancel</button>
        {!isNew && x.status === 'open' && <button type="button" onClick={async () => { await onDone(x); onClose(); }} className="px-3 py-1.5 rounded-md border border-emerald-300 text-emerald-800 text-sm font-bold">Mark done{x.recurrence && x.dueDate ? ' (creates the next)' : ''}</button>}
        {!isNew && x.status === 'done' && <button type="button" onClick={async () => { if (await save({ ...x, status: 'open', doneAt: undefined, doneBy: undefined })) onClose(); }} className="px-3 py-1.5 rounded-md border border-slate-300 text-sm font-bold text-slate-700">Reopen</button>}
        <div className="flex-1" />
        {!isNew && <button type="button" title="Delete (kept on record)" onClick={async () => { if (window.confirm('Delete this item? It is hidden, not erased.')) { if (await save({ ...x, deletedAt: Date.now() })) onClose(); } }} className="p-1.5 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
      </div>
    </div>
  );
}

// ── 3. Payroll ──────────────────────────────────────────────────────────────
function PayrollCard({ payPeriod, today }: { payPeriod: PayPeriodSettings; today: string }) {
  const now = Date.now();
  // The period being paid next: the previous period until its pay date passes, then the current one.
  const prev = previousPayPeriod(payPeriod, now);
  const p = prev.payDate >= today ? prev : currentPayPeriod(payPeriod, now);
  const days = daysUntilDate(p.payDate);
  const tone = days <= 2 ? 'amber' : 'none';
  return (
    <Card icon={<Wallet className="w-4 h-4" />} title="Payroll">
      <div className={`text-sm ${TONE_ROW[tone]}`}>
        <span className="font-black">{days === 0 ? 'Payroll due today' : `Payroll due in ${days} day${days === 1 ? '' : 's'}`}</span>
        <span className="text-slate-600"> — pay date {payDateLabel(p)} for {periodRangeLabel(p)}</span>
      </div>
    </Card>
  );
}

// ── 4. A/R from Jobber ──────────────────────────────────────────────────────
const AGE_LABEL: Record<AgeKey, string> = { notDue: 'Not yet due', d1_30: '1–30 days', d31_60: '31–60 days', d61_90: '61–90 days', d90plus: '90+ days' };
const AGE_CLS: Record<AgeKey, string> = { notDue: 'bg-slate-300', d1_30: 'bg-amber-300', d31_60: 'bg-amber-500', d61_90: 'bg-orange-600', d90plus: 'bg-red-600' };

function ARCard({ ar, listenError, onRefresh }: { ar: OfficeARDoc | null | undefined; listenError?: string | null; onRefresh: Props['onRefreshAR'] }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [allChase, setAllChase] = useState(false);
  const data = ar?.data;
  const failed = !!listenError || (ar && ar.status && ar.status !== 'ok');
  const refresh = async () => {
    setBusy(true); setMsg(null);
    try { const r = await onRefresh(); setMsg(r.status === 'ok' ? 'Updated.' : r.message || r.status); }
    catch (e: any) { setMsg(e?.message || String(e)); } finally { setBusy(false); }
  };
  return (
    <Card icon={<Receipt className="w-4 h-4" />} title="Accounts receivable" right={
      <button type="button" disabled={busy} onClick={refresh} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-300 text-xs font-bold text-slate-700 disabled:opacity-50">
        <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> {busy ? 'Refreshing…' : 'Refresh now'}
      </button>
    }>
      <div className="text-[11px] text-slate-500 mb-2">
        From Jobber · last updated {ago(ar?.lastSuccessAt)}{msg ? <span className="ml-1 font-bold text-slate-700">· {msg}</span> : null}
      </div>
      {failed && (
        <div className="mb-2 flex items-start gap-1.5 text-xs rounded-md border border-red-200 bg-red-50 text-red-800 px-2 py-1.5">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span><b>Data unavailable</b> — {listenError || (ar?.status === 'skipped' ? `last pull skipped (${ar?.lastError})` : `last pull failed ${ago(ar?.lastAttemptAt)}: ${ar?.lastError}`)}.{data ? ' The figures below are from the last successful pull.' : ''}</span>
        </div>
      )}
      {ar === undefined && !listenError ? <div className="text-sm text-slate-500">Loading…</div>
        : !data ? <div className="text-sm font-bold text-slate-600">Data unavailable — no successful pull yet.</div>
        : <ARBody data={data} allChase={allChase} setAllChase={setAllChase} paidCheckAt={ar?.paidCheckAt} />}
    </Card>
  );
}

function ARBody({ data, allChase, setAllChase, paidCheckAt }: { data: NonNullable<OfficeARDoc['data']>; allChase: boolean; setAllChase: (b: boolean) => void; paidCheckAt?: number | null }) {
  const [allPaid, setAllPaid] = useState(false);
  const zeroOpen = data.mismatches.filter(m => m.kind === 'zero_balance_open');
  const paidRows = data.mismatches.filter(m => m.kind === 'paid_with_balance');
  const pu = data.paidUnrecorded;
  const keys: AgeKey[] = ['notDue', 'd1_30', 'd31_60', 'd61_90', 'd90plus'];
  const max = data.owed || 1;
  const chase = allChase ? data.chase : data.chase.slice(0, 10);
  const r = data.reconciliation;
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3 flex-wrap">
        <div><div className="text-[11px] font-bold uppercase text-slate-500">Total owed</div><div className="text-2xl font-black text-slate-800">{$(data.owed)}</div></div>
        <div className="text-xs text-slate-500 pb-1">{data.invoiceCount} open invoice{data.invoiceCount === 1 ? '' : 's'}</div>
      </div>
      <div className="flex w-full h-3 rounded overflow-hidden bg-slate-100" role="img" aria-label="A/R by age">
        {keys.filter(k => data.aging[k].amount > 0).map(k => <div key={k} className={AGE_CLS[k]} style={{ width: `${(data.aging[k].amount / max) * 100}%` }} title={`${AGE_LABEL[k]}: ${$(data.aging[k].amount)}`} />)}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-1 text-xs">
        {keys.map(k => (
          <div key={k} className="flex sm:block justify-between items-baseline rounded border border-slate-100 px-2 py-1">
            <div className="flex items-center gap-1 text-slate-500"><span className={`w-2 h-2 rounded-sm ${AGE_CLS[k]}`} />{AGE_LABEL[k]}</div>
            <div><b className="text-slate-800">{$0(data.aging[k].amount)}</b> <span className="text-slate-500">· {data.aging[k].count}</span></div>
          </div>
        ))}
      </div>

      <div>
        <div className="text-xs font-black uppercase tracking-wide text-slate-600 mb-1">Chase list ({data.chase.length} past due)</div>
        {data.chase.length === 0 ? <div className="text-sm text-slate-500">Nothing past due.</div> : (
          <div className="divide-y divide-slate-100">
            {chase.map(c => (
              <a key={c.invoiceId} href={c.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 py-1.5 text-sm hover:bg-slate-50">
                <span className={`shrink-0 w-14 text-right text-xs font-black ${c.daysOverdue > 60 ? 'text-red-700' : 'text-amber-800'}`}>{c.daysOverdue}d</span>
                <span className="flex-1 min-w-0">
                  <span className="font-bold text-slate-800 truncate block">{c.client}</span>
                  <span className="text-xs text-slate-500">#{c.invoiceNumber} · due {fmtDate(c.dueDate)} · {c.lastPayment ? `last paid ${fmtDate(c.lastPayment.date)} (${$0(c.lastPayment.amount)})` : 'no payment yet'}</span>
                </span>
                <span className="shrink-0 font-bold text-slate-800">{$(c.balance)}</span>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </a>
            ))}
          </div>
        )}
        {data.chase.length > chase.length && <button type="button" onClick={() => setAllChase(true)} className="mt-1 text-xs font-bold text-sky-700">Show all {data.chase.length}</button>}
      </div>

      <Fold label="$0 balance but still awaiting payment" count={zeroOpen.length} tone="amber" defaultOpen>
        <div className="divide-y divide-slate-100">
          {zeroOpen.map((m, i) => (
            <a key={i} href={m.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 py-1 text-sm hover:bg-slate-50">
              <span className="flex-1 min-w-0"><b>{m.client}</b> <span className="text-xs text-slate-500">#{m.invoiceNumber} · {m.status.replace(/_/g, ' ')}</span></span>
              <span className="shrink-0 font-bold">{$(m.balance)}</span>
            </a>
          ))}
        </div>
      </Fold>
      <Fold label={pu ? `Marked paid, payment not recorded in Jobber · ${$0(pu.amount)}` : 'Marked paid, payment not recorded in Jobber'} count={paidRows.length}>
        <div className="text-xs text-slate-600 mb-1.5">
          Jobber shows these as paid and does <b>not</b> count them in what clients owe, but no payment (or only part of it) is recorded on the invoice — usually paid outside Jobber.
          {pu ? ` Last 12 months: ${pu.last12Months.count} · ${$0(pu.last12Months.amount)}.` : ''} Checked {paidCheckAt ? ago(paidCheckAt) : 'overnight'}.
        </div>
        <div className="divide-y divide-slate-100">
          {(allPaid ? paidRows : paidRows.slice(0, 25)).map((m, i) => (
            <a key={i} href={m.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 py-1 text-sm hover:bg-slate-50">
              <span className="flex-1 min-w-0"><b className="truncate">{m.client}</b> <span className="text-xs text-slate-500">#{m.invoiceNumber} · marked paid {fmtDate(m.paid)}{m.total != null ? ` · of ${$0(m.total)}` : ''}</span></span>
              <span className="shrink-0 font-bold text-slate-600">{$(m.balance)}</span>
            </a>
          ))}
        </div>
        {paidRows.length > 25 && !allPaid && <button type="button" onClick={() => setAllPaid(true)} className="mt-1 text-xs font-bold text-sky-700">Show all {paidRows.length}</button>}
      </Fold>
      {zeroOpen.length === 0 && <div className="text-xs text-slate-500">No open invoices at $0.</div>}

      <Fold label={`Clients owing with no open invoice · ${$0(r.owedWithoutInvoice)}`} count={data.noInvoiceClients.length} tone="amber">
        <div className="divide-y divide-slate-100">
          {data.noInvoiceClients.map(c => (
            <a key={c.clientId} href={c.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 py-1 text-sm hover:bg-slate-50">
              <span className="flex-1 min-w-0 font-bold truncate">{c.client}</span><span className="shrink-0 font-bold">{$(c.balance)}</span>
            </a>
          ))}
        </div>
      </Fold>

      <div className={`text-xs rounded-md px-2 py-1.5 border break-words ${Math.abs(r.difference) < 0.01 && r.clientsNotMatching === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
        <b>Reconciliation:</b> open invoices {$(r.openInvoices)} + owing without an invoice {$(r.owedWithoutInvoice)} = {$(r.openInvoices + r.owedWithoutInvoice)} · client balances {$(r.clientBalancesOwed)}
        {Math.abs(r.difference) < 0.01 ? ' ✓' : ` · difference ${$(r.difference)}`}
        {r.clientsNotMatching ? ` · ${r.clientsNotMatching} client${r.clientsNotMatching === 1 ? '' : 's'} whose balance differs from their invoices` : ''}
        {data.credits.clients ? ` · ${data.credits.clients} clients in credit ${$(data.credits.amount)}` : ''}
        {data.badDebt.count ? ` · ${data.badDebt.count} bad-debt invoices` : ''}
      </div>
    </div>
  );
}

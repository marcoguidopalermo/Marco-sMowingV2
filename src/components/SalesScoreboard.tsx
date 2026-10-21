// SALESMASTER SCOREBOARD — big and simple. James (sales@) and Marco only — the
// App gates on the real sign-in address; firestore.rules enforces it.
//   1. Snow sales (top): FolloSoft season totals against the snow goal — the
//      only goal on the page. Snapshot details + entry form in a popup.
//   2. Summer work: total invoiced, by service category, by division. The
//      chase list, service names to assign and the details are popups.
import { useMemo, useState } from 'react';
import { RefreshCw, AlertTriangle, ExternalLink, EyeOff, Eye, Leaf, Clock, Tags, Settings2 } from 'lucide-react';
import { chaseList, type QuoteRow, type SnowEntry } from '../lib/sales/metrics';
import { rangeFor, PERIOD_LABEL, snowSeasonFor, torontoYmd, type PeriodKey, type Range } from '../lib/sales/periods';
import SalesBreakdown, { MappingTable } from './SalesBreakdown';
import SnowSales from './SnowSales';
import Popup from './Popup';
import ServiceNameAssign, { namesToAssign, type ServiceNamesDoc } from './ServiceNameAssign';
import type { SnowSnapshot, SnapshotInput, SnowGoal } from '../lib/sales/snapshots';
import type { InvoiceRow, CategoryOverrides } from '../lib/sales/categories';

export interface SalesMeta {
  status?: 'ok' | 'error' | 'skipped'; lastAttemptAt?: number; lastSuccessAt?: number; lastError?: string | null;
  since?: string; quoteCount?: number; requestCount?: number; invoiceCount?: number;
  bhByMonth?: Record<string, Record<string, number>>;
  cost?: { queries: number; actualTotal: number; requestedMax: number; minAvailable: number | null; ms: number };
}

interface Props {
  quotes: QuoteRow[];
  invoices: InvoiceRow[];
  categoryOverrides: CategoryOverrides;
  serviceNames: ServiceNamesDoc | null | undefined;
  canEditMapping: boolean;                  // admins among the viewers
  onSaveOverrides: (o: CategoryOverrides) => Promise<boolean>;
  meta: SalesMeta | null | undefined;      // undefined = loading, null = never pulled
  listenError?: string | null;
  snowEntries: SnowEntry[];                 // retired daily entries — used only if a season has no snapshots
  snapshots: SnowSnapshot[];                // FolloSoft season totals, one per day
  onSaveSnapshot: (s: SnapshotInput) => Promise<SnowSnapshot | null>;
  snowGoal: SnowGoal;
  canEditGoal: boolean;                     // admins among the viewers
  onSaveSnowGoal: (g: SnowGoal) => Promise<boolean>;
  today: string;
  currentUser: { email: string; name: string };
  onRefresh: () => Promise<{ status: string; message?: string }>;
}

const $ = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`;
const $2 = (n: number) => `$${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const md = (ymd?: string | null) => (ymd ? `${MON[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}` : '—');
const ago = (ms?: number) => {
  if (!ms) return '—';
  const m = Math.round((Date.now() - ms) / 60000);
  const t = new Date(ms).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return m < 1 ? `just now (${t})` : m < 60 ? `${m} min ago (${t})` : t;
};
const pill = (on: boolean) => `px-3 py-1.5 rounded-full border text-sm font-bold ${on ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white text-slate-600 border-slate-300'}`;
const inputCls = 'border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white w-full';
const action = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-bold';

export default function SalesScoreboard(p: Props) {
  const [period, setPeriod] = useState<PeriodKey>('season');
  const [custom, setCustom] = useState<Range>({ from: `${p.today.slice(0, 7)}-01`, to: p.today });
  const [popup, setPopup] = useState<null | 'chase' | 'names' | 'mapping'>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const range = rangeFor(period, p.today, custom);
  const snowSeason = snowSeasonFor(p.today);

  const hasData = !!p.meta?.lastSuccessAt;
  const failed = !!p.listenError || (!!p.meta?.status && p.meta.status !== 'ok');
  const beforeData = !!p.meta?.since && range.from < (torontoYmd(p.meta.since) || '');
  const waiting = useMemo(() => (hasData ? chaseList(p.quotes, p.today) : []), [p.quotes, p.today, hasData]);
  const toAssign = namesToAssign(p.serviceNames, p.categoryOverrides);
  const refresh = async () => {
    setBusy(true); setMsg(null);
    try { const r = await p.onRefresh(); setMsg(r.status === 'ok' ? 'Updated.' : r.message || r.status); } catch (e: any) { setMsg(e?.message || String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 min-w-0">
      <SnowSales
        snapshots={p.snapshots} entries={p.snowEntries} season={snowSeason} today={p.today} who={p.currentUser.name || p.currentUser.email}
        goal={p.snowGoal} canEditGoal={p.canEditGoal} onSaveGoal={p.onSaveSnowGoal} onSaveSnapshot={p.onSaveSnapshot}
      />

      {/* Summer work */}
      <section className="space-y-3" aria-label="Summer work">
        <div className="flex items-center gap-2">
          <Leaf className="w-5 h-5 text-emerald-700" />
          <h2 className="flex-1 text-lg font-black text-slate-800">Summer work</h2>
          <button type="button" disabled={busy} onClick={refresh} title="Pull the latest from Jobber" className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-300 bg-white text-xs font-bold text-slate-700 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Period">
          {(['season', 'year', 'month', 'week', 'custom'] as PeriodKey[]).map(k => <button key={k} type="button" onClick={() => setPeriod(k)} aria-pressed={period === k} className={pill(period === k)}>{PERIOD_LABEL[k]}</button>)}
        </div>
        {period === 'custom' && (
          <div className="flex gap-2 items-center flex-wrap text-sm">
            <input type="date" className={`${inputCls} w-auto`} value={custom.from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} />
            <span>to</span>
            <input type="date" className={`${inputCls} w-auto`} value={custom.to} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} />
          </div>
        )}
        <div className="text-xs text-slate-500">{md(range.from)}, {range.from.slice(0, 4)} – {md(range.to)}, {range.to.slice(0, 4)} · from Jobber, updated {ago(p.meta?.lastSuccessAt)}{msg ? <b className="ml-1 text-slate-700">· {msg}</b> : null}</div>
        {failed && (
          <div className="flex items-start gap-1.5 text-xs rounded-md border border-red-200 bg-red-50 text-red-800 px-2 py-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span><b>Data unavailable</b> — {p.listenError || (p.meta?.status === 'skipped' ? `last pull skipped (${p.meta?.lastError})` : `last pull failed ${ago(p.meta?.lastAttemptAt)}: ${p.meta?.lastError}`)}.{hasData ? ' Figures below are from the last successful pull.' : ''}</span>
          </div>
        )}
        {beforeData && <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">Jobber data starts {md(torontoYmd(p.meta?.since))}, {String(torontoYmd(p.meta?.since)).slice(0, 4)} — earlier dates aren't included.</div>}

        {/* Popup buttons */}
        {hasData && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setPopup('chase')} className={`${action} ${waiting.length ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-300 bg-white text-slate-700'}`}>
              <Clock className="w-4 h-4" /> {waiting.length} quote{waiting.length === 1 ? '' : 's'} waiting
            </button>
            {p.serviceNames && (
              <button type="button" onClick={() => setPopup('names')} className={`${action} border-slate-300 bg-white text-slate-700`}>
                <Tags className="w-4 h-4" /> {toAssign.length} name{toAssign.length === 1 ? '' : 's'} to assign
              </button>
            )}
            {p.canEditMapping && (
              <button type="button" onClick={() => setPopup('mapping')} className={`${action} border-slate-300 bg-white text-slate-700`} title="Category mapping — Jobber catalog and per-invoice overrides">
                <Settings2 className="w-4 h-4" /> Mapping
              </button>
            )}
          </div>
        )}

        {p.meta === undefined && !p.listenError ? <div className="rounded-xl bg-white border border-slate-200 p-4 text-sm text-slate-500">Loading…</div> : (
          <SalesBreakdown invoices={p.invoices} range={range} hasData={hasData} overrides={p.categoryOverrides} bhByMonth={p.meta?.bhByMonth} currentMonth={p.today.slice(0, 7)} />
        )}
      </section>

      {popup === 'chase' && <Popup title={`${waiting.length} quotes waiting`} onClose={() => setPopup(null)}><ChaseList quotes={p.quotes} today={p.today} /></Popup>}
      {popup === 'names' && (
        <Popup title="Service names to assign" onClose={() => setPopup(null)}>
          <ServiceNameAssign names={p.serviceNames} overrides={p.categoryOverrides} canEdit={p.canEditMapping} onSave={p.onSaveOverrides} />
        </Popup>
      )}
      {popup === 'mapping' && (
        <Popup title="Category mapping" onClose={() => setPopup(null)} wide>
          <MappingTable names={p.serviceNames} overrides={p.categoryOverrides} canEdit={p.canEditMapping} onSave={p.onSaveOverrides} invoices={p.invoices} who={p.currentUser.name || p.currentUser.email} />
        </Popup>
      )}
    </div>
  );
}

// ── Chase list (popup) — every quote waiting on the client ──────────────────
export function ChaseList({ quotes, today }: { quotes: QuoteRow[]; today: string }) {
  const [sort, setSort] = useState<'age' | 'amountDesc' | 'amountAsc'>('age');
  const [all, setAll] = useState(false);
  const chase = useMemo(() => chaseList(quotes, today, sort), [quotes, today, sort]);
  const unopened = chase.filter(c => !c.opened).length;
  const shown = all ? chase : chase.slice(0, 30);
  return (
    <div>
          {/* Chase list */}
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <div className="text-xs font-black uppercase tracking-wide text-slate-600">Chase list · {chase.length} waiting · {$(chase.reduce((s, c) => s + c.sub, 0))}</div>
              {unopened > 0 && <span className="text-[11px] font-black text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">{unopened} not opened</span>}
            </div>
            <div className="flex flex-wrap gap-1 mb-1.5" role="group" aria-label="Sort">
              {([['age', 'Oldest first'], ['amountDesc', 'Amount ↓'], ['amountAsc', 'Amount ↑']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setSort(k)} aria-pressed={sort === k} className={`px-2.5 py-1 rounded-full border text-[11px] font-bold ${sort === k ? 'bg-sky-700 text-white border-sky-700' : 'bg-white text-slate-600 border-slate-300'}`}>{l}</button>
              ))}
            </div>
            {chase.length === 0 ? <div className="text-sm text-slate-500">Nothing waiting.</div> : (
              <div className="divide-y divide-slate-100">
                {shown.map(c => (
                  <a key={c.id} href={c.url} target="_blank" rel="noreferrer" className={`flex items-center gap-2 py-1.5 text-sm hover:bg-slate-50 ${!c.opened ? 'bg-red-50/40' : ''}`}>
                    <span className="shrink-0 w-12 text-right text-xs font-black text-slate-600">{c.daysSinceSent == null ? '—' : `${c.daysSinceSent}d`}</span>
                    <span className="flex-1 min-w-0">
                      <span className="font-bold text-slate-800 truncate block">{c.cl}</span>
                      <span className="text-xs text-slate-500 block truncate">#{c.n}{c.t ? ` · ${c.t}` : ''}{c.s === 'changes_requested' ? ' · changes requested' : ''}</span>
                      {c.opened
                        ? <span className="text-[11px] text-emerald-700 inline-flex items-center gap-0.5"><Eye className="w-3 h-3" /> opened {md(torontoYmd(c.viewed))}</span>
                        : <span className="text-[11px] font-black text-red-700 inline-flex items-center gap-0.5"><EyeOff className="w-3 h-3" /> NOT OPENED — check it didn't go to spam</span>}
                    </span>
                    <span className="shrink-0 font-bold text-slate-800" title={`Incl. tax: ${$2(c.tot)}`}>{$(c.sub)}</span>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  </a>
                ))}
              </div>
            )}
            {chase.length > shown.length && <button type="button" onClick={() => setAll(true)} className="mt-1 text-xs font-bold text-sky-700">Show all {chase.length}</button>}
          </div>

    </div>
  );
}

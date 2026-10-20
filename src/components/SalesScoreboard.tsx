// SALESMASTER SCOREBOARD — James's two goals: raise AVERAGE TICKET and sell
// more CONTRACTS, per sales stream. James (sales@) and Marco only — the App
// gates on the real sign-in address; firestore.rules enforces it.
import { useMemo, useState, type ReactNode } from 'react';
import { Trophy, RefreshCw, AlertTriangle, ExternalLink, EyeOff, Eye, Snowflake, Building2, Leaf, Target as TargetIcon, Plus, Pencil, Trash2, TrendingUp, Users } from 'lucide-react';
import {
  quoteMetrics, chaseList, leadMetrics, salespeople, residentialSnow, commercialSnow, weeklyTrend, quoteTrendPoints, progressLine, commercialValue, commercialSoldDate,
  STREAM_LABEL, SOLD_STATUSES, type QuoteRow, type RequestRow, type SnowEntry, type CommercialLike, type StreamKey, type Target, type StreamFigures, type WeekPoint,
} from '../lib/sales/metrics';
import { rangeFor, PERIOD_LABEL, snowSeasonFor, snowSeasonLabel, torontoYmd, type PeriodKey, type Range } from '../lib/sales/periods';
import SalesBreakdown from './SalesBreakdown';
import type { InvoiceRow, CategoryOverrides } from '../lib/sales/categories';
import type { ServiceNamesDoc } from './ServiceNameAssign';

export interface SalesMeta {
  status?: 'ok' | 'error' | 'skipped'; lastAttemptAt?: number; lastSuccessAt?: number; lastError?: string | null;
  since?: string; quoteCount?: number; requestCount?: number; invoiceCount?: number;
  bhByMonth?: Record<string, Record<string, number>>;
  cost?: { queries: number; actualTotal: number; requestedMax: number; minAvailable: number | null; ms: number };
}
export type SalesTargets = Partial<Record<StreamKey, Target>>;

interface Props {
  quotes: QuoteRow[];
  requests: RequestRow[];
  invoices: InvoiceRow[];
  categoryOverrides: CategoryOverrides;
  serviceNames: ServiceNamesDoc | null | undefined;
  canEditMapping: boolean;                  // admins among the viewers
  onSaveOverrides: (o: CategoryOverrides) => Promise<boolean>;
  meta: SalesMeta | null | undefined;      // undefined = loading, null = never pulled
  listenError?: string | null;
  snowEntries: SnowEntry[];
  commercial: CommercialLike[];
  targets: SalesTargets;
  today: string;
  currentUser: { email: string; name: string };
  canEditSnow: boolean;                     // admins among the viewers
  onSaveSnowEntry: (e: SnowEntry) => Promise<boolean>;
  onSaveTargets: (t: SalesTargets) => Promise<boolean>;
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
const pill = (on: boolean) => `px-3 py-1.5 rounded-full border text-xs font-bold ${on ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white text-slate-600 border-slate-300'}`;
const inputCls = 'border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white w-full';

function Card({ icon, title, right, children }: { icon: ReactNode; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm min-w-0">
      <header className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-2.5 border-b border-slate-100">
        <span className="text-slate-500">{icon}</span>
        <h2 className="font-black text-slate-800 text-sm uppercase tracking-wide">{title}</h2>
        <div className="flex-1" />{right}
      </header>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}
function Stat({ label, value, sub, title, big }: { label: string; value: string; sub?: string; title?: string; big?: boolean }) {
  return (
    <div className={`rounded-lg border p-2.5 ${big ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`} title={title}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`${big ? 'text-3xl text-emerald-800' : 'text-xl text-slate-800'} font-black leading-tight`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

export default function SalesScoreboard(p: Props) {
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [custom, setCustom] = useState<Range>({ from: `${p.today.slice(0, 7)}-01`, to: p.today });
  const [sp, setSp] = useState<string | null>(null);
  const range = rangeFor(period, p.today, custom);
  const season = rangeFor('season', p.today);
  const snowSeason = snowSeasonFor(p.today);

  const hasData = !!p.meta?.lastSuccessAt;
  const failed = !!p.listenError || (!!p.meta?.status && p.meta.status !== 'ok');
  const beforeData = !!p.meta?.since && range.from < (torontoYmd(p.meta.since) || '');
  const people = useMemo(() => salespeople(p.quotes), [p.quotes]);
  const qm = useMemo(() => quoteMetrics(p.quotes, range, sp), [p.quotes, range.from, range.to, sp]);
  const leads = useMemo(() => leadMetrics(p.requests, range), [p.requests, range.from, range.to]);

  // Streams: the period's figures, and the season's for targets.
  const jobberFig = (r: Range): StreamFigures => { const m = quoteMetrics(p.quotes, r, sp); return { contracts: m.won.count, dollars: m.won.pre, avgTicket: m.avgTicket?.pre ?? null }; };
  const streams: { key: StreamKey; icon: ReactNode; period: StreamFigures | null; season: StreamFigures | null; seasonLabel: string; note?: string }[] = [
    { key: 'jobber', icon: <Leaf className="w-4 h-4" />, period: hasData ? jobberFig(range) : null, season: hasData ? jobberFig(season) : null, seasonLabel: `Season ${p.today.slice(0, 4)}`, note: 'Won quotes (sent in the period), before tax' },
    { key: 'resSnow', icon: <Snowflake className="w-4 h-4" />, period: residentialSnow(p.snowEntries, range), season: residentialSnow(p.snowEntries, null, snowSeason), seasonLabel: snowSeasonLabel(snowSeason), note: 'Entered by hand' },
    (() => { const per = commercialSnow(p.commercial, range); const sea = commercialSnow(p.commercial, null, snowSeason);
      return { key: 'comSnow' as StreamKey, icon: <Building2 className="w-4 h-4" />, period: per, season: sea, seasonLabel: snowSeasonLabel(snowSeason), note: `Approved or booked snow contracts${sea.noLevel ? ` · ${sea.noLevel} without a level chosen (no value)` : ''}` }; })(),
  ];

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <Trophy className="w-6 h-6 text-emerald-700" />
        <h1 className="text-2xl font-black text-slate-800">Scoreboard</h1>
        <span className="text-xs text-slate-500">Invoiced · won · pipeline, by service and division</span>
      </div>

      {/* Period + salesperson — buttons, not dropdowns */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Period">
          {(['week', 'month', 'season', 'year', 'custom'] as PeriodKey[]).map(k => <button key={k} type="button" onClick={() => setPeriod(k)} aria-pressed={period === k} className={pill(period === k)}>{PERIOD_LABEL[k]}</button>)}
        </div>
        {period === 'custom' && (
          <div className="flex gap-2 items-center flex-wrap text-sm">
            <input type="date" className={`${inputCls} w-auto`} value={custom.from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} />
            <span>to</span>
            <input type="date" className={`${inputCls} w-auto`} value={custom.to} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} />
          </div>
        )}
        <div className="text-xs text-slate-500">{md(range.from)}, {range.from.slice(0, 4)} – {md(range.to)}, {range.to.slice(0, 4)}</div>
        {people.length > 1 && (
          <div className="flex flex-wrap gap-1.5 items-center" role="group" aria-label="Salesperson">
            <Users className="w-3.5 h-3.5 text-slate-400" />
            <button type="button" onClick={() => setSp(null)} aria-pressed={!sp} className={pill(!sp)}>Everyone</button>
            {people.map(n => <button key={n} type="button" onClick={() => setSp(sp === n ? null : n)} aria-pressed={sp === n} className={pill(sp === n)}>{n}</button>)}
          </div>
        )}
      </div>

      <SalesBreakdown
        invoices={p.invoices} quotes={p.quotes} range={range} hasData={hasData}
        overrides={p.categoryOverrides} names={p.serviceNames} bhByMonth={p.meta?.bhByMonth}
        canEditMapping={p.canEditMapping} onSaveOverrides={p.onSaveOverrides}
        wonCount={qm.won.count} wonPre={qm.won.pre} wonIncl={qm.won.incl} waitingCount={chaseList(p.quotes, p.today, 'age', sp).length}
        avgTicketPre={qm.avgTicket?.pre ?? null}
        currentMonth={p.today.slice(0, 7)}
      />

      {/* Streams — contracts sold, with targets (average ticket secondary) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {streams.map(s => {
          const t = p.targets[s.key];
          return (
            <div key={s.key} className="bg-white rounded-xl border border-slate-200 p-3 min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-slate-600">{s.icon}{STREAM_LABEL[s.key]}</div>
              {s.period == null ? <div className="mt-2 text-sm font-bold text-slate-600">Data unavailable</div> : (
                <>
                  <div className="mt-1 text-[11px] font-bold uppercase text-slate-500">Contracts sold</div>
                  <div className="text-2xl font-black text-slate-800">{s.period.contracts} · {$(s.period.dollars)}</div>
                  <div className="text-xs text-slate-500">average {s.period.avgTicket != null ? $(s.period.avgTicket) : '—'}</div>
                </>
              )}
              {s.season && (
                <div className="mt-2 text-xs rounded-md bg-slate-50 border border-slate-100 px-2 py-1">
                  <span className="font-bold text-slate-600">{s.seasonLabel}:</span> {progressLine(s.season, t)}
                  {t?.contracts ? <ProgressBar value={s.season.contracts} max={t.contracts} /> : null}
                </div>
              )}
              <div className="mt-1 text-[10px] text-slate-400">{s.note}</div>
            </div>
          );
        })}
      </div>

      <JobberCard {...p} qm={qm} leads={leads} hasData={hasData} failed={failed} beforeData={beforeData} sp={sp} />
      <SnowCard {...p} range={range} snowSeason={snowSeason} />
      <TrendCard quotes={p.quotes} snowEntries={p.snowEntries} commercial={p.commercial} range={trendRange(period === 'week' || period === 'month' ? season : range, p.today)} sp={sp} hasData={hasData} />
      <TargetsCard targets={p.targets} onSave={p.onSaveTargets} seasonLabels={{ jobber: `Season ${p.today.slice(0, 4)}`, resSnow: snowSeasonLabel(snowSeason), comSnow: snowSeasonLabel(snowSeason) }} />
    </div>
  );
}

/** Trend ends today — no empty future weeks. */
const trendRange = (r: Range, today: string): Range => ({ from: r.from <= today ? r.from : today, to: r.to < today ? r.to : today });

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return <div className="mt-1 h-1.5 rounded bg-slate-200 overflow-hidden"><div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} /></div>;
}

// ── Jobber quotes ───────────────────────────────────────────────────────────
function JobberCard(p: Props & { qm: ReturnType<typeof quoteMetrics>; leads: ReturnType<typeof leadMetrics>; hasData: boolean; failed: boolean; beforeData: boolean; sp: string | null }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sort, setSort] = useState<'age' | 'amountDesc' | 'amountAsc'>('age');
  const [all, setAll] = useState(false);
  const chase = useMemo(() => chaseList(p.quotes, p.today, sort, p.sp), [p.quotes, p.today, sort, p.sp]);
  const unopened = chase.filter(c => !c.opened).length;
  const shown = all ? chase : chase.slice(0, 15);
  const { qm } = p;
  const refresh = async () => {
    setBusy(true); setMsg(null);
    try { const r = await p.onRefresh(); setMsg(r.status === 'ok' ? 'Updated.' : r.message || r.status); } catch (e: any) { setMsg(e?.message || String(e)); } finally { setBusy(false); }
  };
  return (
    <Card icon={<Leaf className="w-4 h-4" />} title="Jobber quotes — landscaping & projects" right={
      <button type="button" disabled={busy} onClick={refresh} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-300 text-xs font-bold text-slate-700 disabled:opacity-50">
        <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> {busy ? 'Refreshing…' : 'Refresh now'}
      </button>
    }>
      <div className="text-[11px] text-slate-500 mb-2">From Jobber · last updated {ago(p.meta?.lastSuccessAt)}{msg ? <b className="ml-1 text-slate-700">· {msg}</b> : null}</div>
      {p.failed && (
        <div className="mb-2 flex items-start gap-1.5 text-xs rounded-md border border-red-200 bg-red-50 text-red-800 px-2 py-1.5">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span><b>Data unavailable</b> — {p.listenError || (p.meta?.status === 'skipped' ? `last pull skipped (${p.meta?.lastError})` : `last pull failed ${ago(p.meta?.lastAttemptAt)}: ${p.meta?.lastError}`)}.{p.hasData ? ' Figures below are from the last successful pull.' : ''}</span>
        </div>
      )}
      {p.meta === undefined && !p.listenError ? <div className="text-sm text-slate-500">Loading…</div>
        : !p.hasData ? <div className="text-sm font-bold text-slate-600">Data unavailable — no successful pull yet.</div>
        : (
        <div className="space-y-4">
          {p.beforeData && <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">Jobber data starts {md(torontoYmd(p.meta?.since))}, {String(torontoYmd(p.meta?.since)).slice(0, 4)} — earlier dates aren't included.</div>}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat label="Won" value={`${qm.won.count} · ${$(qm.won.pre)}`} sub="approved + converted" title={`Incl. tax: ${$2(qm.won.incl)}`} />
            <Stat label="Average ticket (won)" value={qm.avgTicket ? $(qm.avgTicket.pre) : '—'} sub="before tax" title={qm.avgTicket ? `Incl. tax: ${$2(qm.avgTicket.incl)}` : undefined} />
            <Stat label="Win rate" value={qm.winRate == null ? '—' : `${Math.round(qm.winRate * 100)}%`} sub={`${qm.won.count} won of ${qm.won.count + qm.lost.count} decided`} />
            <Stat label="Sent" value={`${qm.sent.count} · ${$(qm.sent.pre)}`} title={`Incl. tax: ${$2(qm.sent.incl)}`} />
            <Stat label="Waiting on client" value={`${qm.waiting.count} · ${$(qm.waiting.pre)}`} title={`Incl. tax: ${$2(qm.waiting.incl)}`} />
            <Stat label="Sent → approved" value={qm.medianDaysToApprove == null ? '—' : `${qm.medianDaysToApprove} days`} sub="median" />
          </div>
          <div className="text-[11px] text-slate-500">
            Quotes <b>sent</b> in the period, with their status today. Dollar figures are <b>before tax</b> (hover a card for the amount with tax).
            {' '}Approved in the period (any send date): {qm.approvedInPeriod.count} · {$(qm.approvedInPeriod.pre)}.
          </div>

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

          {/* Leads */}
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-slate-600 mb-1">Leads (requests) in the period</div>
            <div className="text-sm text-slate-800"><b>{p.leads.count}</b> lead{p.leads.count === 1 ? '' : 's'} · <b>{p.leads.quoted}</b> became quotes{p.leads.count ? ` (${Math.round((p.leads.quoted / p.leads.count) * 100)}%)` : ''}</div>
            {p.leads.bySource.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                {p.leads.bySource.map(s => <span key={s.source} className="px-2 py-1 rounded border border-slate-200 bg-slate-50">{s.source}: <b>{s.count}</b> <span className="text-slate-500">({s.quoted} quoted)</span></span>)}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Snow ────────────────────────────────────────────────────────────────────
function SnowCard(p: Props & { range: Range; snowSeason: string }) {
  const blank = (): SnowEntry => ({ id: `ss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, date: p.today, season: p.snowSeason, contracts: 0, dollars: 0, note: '', source: 'manual' });
  const [draft, setDraft] = useState<SnowEntry>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const entries = p.snowEntries.filter(e => !e.deletedAt).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  const inPeriod = entries.filter(e => e.date >= p.range.from && e.date <= p.range.to);
  const sold = p.commercial.filter(c => SOLD_STATUSES.has(c.status) && !c.archived);
  const save = async () => {
    if (!(draft.contracts > 0) || !(draft.dollars >= 0) || !draft.date) { window.alert('Enter the date, contracts sold and dollars.'); return; }
    setBusy(true);
    const ok = await p.onSaveSnowEntry({ ...draft, contracts: Math.round(draft.contracts), dollars: Math.round(draft.dollars * 100) / 100 });
    setBusy(false);
    if (ok) { setDraft(blank()); setEditing(null); }
  };
  const seasons = [...new Set([p.snowSeason, ...entries.map(e => e.season)])].sort().reverse();
  return (
    <Card icon={<Snowflake className="w-4 h-4" />} title="Snow sales">
      <div className="text-xs font-black uppercase tracking-wide text-slate-600 mb-1">Residential — {editing ? 'edit entry' : 'add sales'}</div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
        <label className="col-span-1"><span className="block text-[11px] font-bold text-slate-500 uppercase">Date</span><input type="date" className={inputCls} value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} /></label>
        <label className="col-span-1"><span className="block text-[11px] font-bold text-slate-500 uppercase">Contracts</span><input inputMode="numeric" className={inputCls} value={draft.contracts || ''} onChange={e => setDraft(d => ({ ...d, contracts: Number(e.target.value.replace(/\D/g, '')) || 0 }))} placeholder="0" /></label>
        <label className="col-span-1"><span className="block text-[11px] font-bold text-slate-500 uppercase">Dollars sold</span><input inputMode="decimal" className={inputCls} value={draft.dollars || ''} onChange={e => setDraft(d => ({ ...d, dollars: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 }))} placeholder="0" /></label>
        <label className="col-span-1"><span className="block text-[11px] font-bold text-slate-500 uppercase">Season</span>
          <select className={inputCls} value={draft.season} onChange={e => setDraft(d => ({ ...d, season: e.target.value }))}>{seasons.map(s => <option key={s} value={s}>{snowSeasonLabel(s)}</option>)}</select></label>
        <label className="col-span-2 sm:col-span-1"><span className="block text-[11px] font-bold text-slate-500 uppercase">Note</span><input className={inputCls} value={draft.note || ''} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} placeholder="optional" /></label>
      </div>
      <div className="flex gap-2 mt-2">
        <button type="button" disabled={busy} onClick={save} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-emerald-700 text-white text-sm font-bold disabled:opacity-50"><Plus className="w-4 h-4" /> {editing ? 'Save changes' : 'Add'}</button>
        {editing && <button type="button" onClick={() => { setDraft(blank()); setEditing(null); }} className="px-3 py-1.5 rounded-md border border-slate-300 text-sm font-bold text-slate-700">Cancel</button>}
      </div>

      <div className="mt-3 text-xs text-slate-500">{inPeriod.length} entr{inPeriod.length === 1 ? 'y' : 'ies'} in the period · {entries.length} in all</div>
      <div className="divide-y divide-slate-100">
        {inPeriod.slice(0, 30).map(e => (
          <div key={e.id} className="flex items-center gap-2 py-1.5 text-sm">
            <span className="shrink-0 w-14 text-xs text-slate-500">{md(e.date)}</span>
            <span className="flex-1 min-w-0">
              <b>{e.contracts}</b> contract{e.contracts === 1 ? '' : 's'} · {$2(e.dollars)} <span className="text-xs text-slate-500">· avg {$(e.dollars / (e.contracts || 1))}</span>
              <span className="block text-[11px] text-slate-400 truncate">{snowSeasonLabel(e.season)} · {e.source === 'follosoft' ? 'FolloSoft import' : 'entered by hand'}{e.createdBy ? ` · ${e.createdBy}` : ''}{e.createdAt ? ` · ${new Date(e.createdAt).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}{e.note ? ` · ${e.note}` : ''}</span>
            </span>
            {p.canEditSnow && (
              <>
                <button type="button" title="Edit" onClick={() => { setDraft(e); setEditing(e.id); }} className="p-1 text-slate-400 hover:text-slate-700"><Pencil className="w-4 h-4" /></button>
                <button type="button" title="Delete (kept on record)" onClick={async () => { if (window.confirm('Delete this entry? It is hidden, not erased.')) await p.onSaveSnowEntry({ ...e, deletedAt: Date.now() }); }} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 text-xs font-black uppercase tracking-wide text-slate-600 mb-1">Commercial — approved or booked contracts</div>
      {sold.length === 0 ? <div className="text-sm text-slate-500">None yet ({p.commercial.filter(c => !c.archived).length} contract{p.commercial.length === 1 ? '' : 's'} in progress in SnowMaster).</div> : (
        <div className="divide-y divide-slate-100">
          {sold.map((c, i) => { const v = commercialValue(c); return (
            <div key={i} className="flex items-center gap-2 py-1 text-sm">
              <span className="flex-1 min-w-0 truncate"><b>{c.client?.businessName || 'Contract'}</b> <span className="text-xs text-slate-500">· {c.status} {md(commercialSoldDate(c))} · {c.season ? snowSeasonLabel(c.season) : ''}</span></span>
              <span className="shrink-0 font-bold">{v == null ? <span className="text-xs text-amber-700">level not chosen</span> : $(v)}</span>
            </div>
          ); })}
        </div>
      )}
    </Card>
  );
}

// ── Trend ───────────────────────────────────────────────────────────────────
function TrendCard({ quotes, snowEntries, commercial, range, sp, hasData }: { quotes: QuoteRow[]; snowEntries: SnowEntry[]; commercial: CommercialLike[]; range: Range; sp: string | null; hasData: boolean }) {
  const [stream, setStream] = useState<StreamKey>('jobber');
  const pts = stream === 'jobber' ? (hasData ? quoteTrendPoints(quotes, sp) : [])
    : stream === 'resSnow' ? snowEntries.filter(e => !e.deletedAt).map(e => ({ date: e.date, contracts: e.contracts, dollars: e.dollars }))
    : commercial.filter(c => SOLD_STATUSES.has(c.status) && !c.archived).map(c => ({ date: commercialSoldDate(c), contracts: 1, dollars: commercialValue(c) || 0 }));
  // The latest 16 weeks at most — fits a phone without sideways scrolling.
  const weeks = weeklyTrend(pts, range, 8).slice(-16);
  return (
    <Card icon={<TrendingUp className="w-4 h-4" />} title="Week by week" right={
      <div className="flex flex-wrap gap-1">{(['jobber', 'resSnow', 'comSnow'] as StreamKey[]).map(k => <button key={k} type="button" onClick={() => setStream(k)} aria-pressed={stream === k} className={pill(stream === k)}>{STREAM_LABEL[k]}</button>)}</div>
    }>
      {stream === 'jobber' && !hasData ? <div className="text-sm font-bold text-slate-600">Data unavailable</div> : <TrendChart weeks={weeks} />}
      <div className="mt-1 text-[11px] text-slate-500">Bars: contracts sold each week (by approval / sale date). Number under each bar: that week's average ticket{stream === 'jobber' ? ' before tax' : ''}.</div>
    </Card>
  );
}
function TrendChart({ weeks }: { weeks: WeekPoint[] }) {
  const max = Math.max(1, ...weeks.map(w => w.contracts));
  const avgs = weeks.map(w => w.avgTicket).filter((x): x is number => x != null);
  const half = Math.floor(avgs.length / 2);
  const early = half ? avgs.slice(0, half).reduce((a, b) => a + b, 0) / half : null;
  const late = avgs.length - half ? avgs.slice(half).reduce((a, b) => a + b, 0) / (avgs.length - half) : null;
  return (
    <div>
      {early != null && late != null && avgs.length >= 4 && (
        <div className={`text-xs font-bold mb-2 ${late >= early ? 'text-emerald-700' : 'text-amber-700'}`}>
          Average ticket {late >= early ? 'rising' : 'falling'}: {$(early)} in the earlier weeks → {$(late)} in the later weeks
        </div>
      )}
      <div className="flex items-end gap-1 h-32 overflow-x-auto pb-1">
        {weeks.map(w => (
          <div key={w.from} className="flex flex-col items-center justify-end h-full min-w-[30px] flex-1" title={`Week of ${md(w.from)}: ${w.contracts} sold${w.avgTicket != null ? `, avg ${$(w.avgTicket)}` : ''}`}>
            <span className="text-[10px] font-bold text-slate-700">{w.contracts || ''}</span>
            <div className="w-full rounded-t bg-emerald-500" style={{ height: `${(w.contracts / max) * 70}%`, minHeight: w.contracts ? 3 : 0 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1 overflow-x-auto">
        {weeks.map(w => (
          <div key={w.from} className="min-w-[30px] flex-1 text-center">
            <div className="text-[9px] text-slate-500">{md(w.from)}</div>
            <div className="text-[10px] font-bold text-emerald-800">{w.avgTicket != null ? `$${Math.round(w.avgTicket / 100) / 10}k` : '·'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Targets ─────────────────────────────────────────────────────────────────
function TargetsCard({ targets, onSave, seasonLabels }: { targets: SalesTargets; onSave: (t: SalesTargets) => Promise<boolean>; seasonLabels: Record<StreamKey, string> }) {
  const [edit, setEdit] = useState<SalesTargets | null>(null);
  const num = (v: string) => { const n = Number(v.replace(/[^\d.]/g, '')); return v.trim() === '' || !Number.isFinite(n) ? null : n; };
  return (
    <Card icon={<TargetIcon className="w-4 h-4" />} title="Targets" right={!edit ? <button type="button" onClick={() => setEdit(JSON.parse(JSON.stringify(targets || {})))} className="text-xs font-bold text-sky-700">Edit</button> : undefined}>
      <div className="space-y-2">
        {(['jobber', 'resSnow', 'comSnow'] as StreamKey[]).map(k => {
          const t = (edit || targets)[k] || {};
          return (
            <div key={k} className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr_1fr] gap-2 items-center text-sm">
              <div><b>{STREAM_LABEL[k]}</b> <span className="text-xs text-slate-500">· {seasonLabels[k]}</span></div>
              {edit ? (
                <>
                  <label className="text-xs"><span className="block text-[11px] font-bold text-slate-500 uppercase">Contracts</span><input inputMode="numeric" className={inputCls} value={t.contracts ?? ''} onChange={e => setEdit(x => ({ ...x, [k]: { ...(x?.[k] || {}), contracts: num(e.target.value) } }))} /></label>
                  <label className="text-xs"><span className="block text-[11px] font-bold text-slate-500 uppercase">Average ticket $</span><input inputMode="decimal" className={inputCls} value={t.avgTicket ?? ''} onChange={e => setEdit(x => ({ ...x, [k]: { ...(x?.[k] || {}), avgTicket: num(e.target.value) } }))} /></label>
                </>
              ) : (
                <>
                  <div className="text-slate-700">{t.contracts ? `${t.contracts} contracts` : <span className="text-slate-400">no contracts target</span>}</div>
                  <div className="text-slate-700">{t.avgTicket ? `avg ${$(t.avgTicket)}` : <span className="text-slate-400">no average target</span>}</div>
                </>
              )}
            </div>
          );
        })}
        {edit && (
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={async () => { if (await onSave(edit)) setEdit(null); }} className="px-3 py-1.5 rounded-md bg-emerald-700 text-white text-sm font-bold">Save targets</button>
            <button type="button" onClick={() => setEdit(null)} className="px-3 py-1.5 rounded-md border border-slate-300 text-sm font-bold text-slate-700">Cancel</button>
          </div>
        )}
      </div>
    </Card>
  );
}

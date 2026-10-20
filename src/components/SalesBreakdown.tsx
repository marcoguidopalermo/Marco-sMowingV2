// Sales by SERVICE CATEGORY and by DIVISION (SalesMaster scoreboard).
// Pre-tax headline, with tax on hover. Everything follows the scoreboard's
// date filter. Rules: docs/service-category-mapping.md; divisions: the sales
// pull's attribution (crew-days → Jobber assignee → unattributed).
import { useMemo, useState, type ReactNode } from 'react';
import { BarChart3, Building, Layers, AlertTriangle, ChevronDown, ChevronRight, Settings2, Receipt } from 'lucide-react';
import {
  invoiceBreakdown, quoteCategoryBreakdown, divisionBH, dollarsPerBH, CATEGORIES, COMMERCIAL_SNOW, UNATTRIBUTED, FALLBACK_MIN_SHARE, FALLBACK_MIN_BASIS,
  type InvoiceRow, type QuoteLike, type CategoryOverrides, type Category, type Ranked, type ListedLine,
} from '../lib/sales/categories';
import { CATALOG_DEFAULTS, lineOverrideKey } from '../../functions/src/shared/serviceCategories';
import type { Range } from '../lib/sales/periods';
import ServiceNameAssign, { type ServiceNamesDoc } from './ServiceNameAssign';

const $ = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-CA')}`;
const $2 = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mlabel = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

const CAT_COLOR: Record<string, string> = {
  'Lawn mowing': '#16a34a', 'Lawn care': '#65a30d', 'Hedges & shrubs': '#0d9488', 'Sod': '#4d7c0f', 'Cleanups': '#ca8a04',
  'Garden beds & landscaping': '#c026d3', 'Hardscape & gravel': '#78716c', 'Tree & stump': '#92400e', 'Snow': '#0284c7', 'Sweeping': '#6366f1', 'Other': '#94a3b8',
};
const DIV_COLOR: Record<string, string> = {
  'Lawn Division': '#16a34a', 'Small Projects': '#f59e0b', 'Large Projects': '#7c3aed', [COMMERCIAL_SNOW]: '#0284c7', [UNATTRIBUTED]: '#94a3b8',
};
const colorOf = (k: string, map: Record<string, string>) => map[k] || '#64748b';

interface Props {
  invoices: InvoiceRow[];
  quotes: QuoteLike[];
  range: Range;
  hasData: boolean;
  overrides: CategoryOverrides;
  names: ServiceNamesDoc | null | undefined;
  bhByMonth?: Record<string, Record<string, number>>;
  canEditMapping: boolean;
  onSaveOverrides: (o: CategoryOverrides) => Promise<boolean>;
  wonCount: number; wonPre: number; wonIncl: number;        // from the existing quote metrics (same cohort)
  waitingCount: number;
  avgTicketPre: number | null;
  currentMonth?: string;                                     // YYYY-MM, left out of $ per BH
  who?: string;                                              // recorded on per-invoice overrides
}

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

function RankedBars({ rows, colors, extra }: { rows: Ranked[]; colors: Record<string, string>; extra?: (r: Ranked) => ReactNode }) {
  const max = Math.max(1, ...rows.map(r => Math.abs(r.pre)));
  return (
    <div className="space-y-1.5">
      {rows.map(r => (
        <div key={r.key} title={`With tax: ${$2(r.incl)}`}>
          <div className="flex items-baseline gap-2 text-sm">
            <span className="flex-1 min-w-0 truncate font-bold text-slate-800">{r.key}</span>
            <span className="shrink-0 font-black text-slate-800">{$(r.pre)}</span>
            <span className="shrink-0 w-12 text-right text-xs text-slate-500">{pct(r.share)}</span>
          </div>
          <div className="h-2 rounded bg-slate-100 overflow-hidden"><div className="h-full rounded" style={{ width: `${Math.max(0, (r.pre / max) * 100)}%`, background: colorOf(r.key, colors) }} /></div>
          {extra && <div className="mt-0.5">{extra(r)}</div>}
        </div>
      ))}
    </div>
  );
}

function MonthBars({ months, keys, valueOf, colors }: { months: string[]; keys: string[]; valueOf: (m: number, k: string) => number; colors: Record<string, string> }) {
  const totals = months.map((_, i) => keys.reduce((s, k) => s + Math.max(0, valueOf(i, k)), 0));
  const max = Math.max(1, ...totals);
  return (
    <div className="space-y-1">
      {months.map((m, i) => (
        <div key={m} className="flex items-center gap-2 text-xs">
          <span className="w-12 shrink-0 text-slate-500">{mlabel(m)}</span>
          <div className="flex-1 h-3 rounded bg-slate-100 overflow-hidden flex" style={{ maxWidth: `${(totals[i] / max) * 100}%` }}>
            {keys.map(k => { const v = Math.max(0, valueOf(i, k)); return v ? <div key={k} style={{ width: `${(v / (totals[i] || 1)) * 100}%`, background: colorOf(k, colors) }} title={`${k}: ${$(v)}`} /> : null; })}
          </div>
          <span className="w-16 shrink-0 text-right font-bold text-slate-700">{$(totals[i])}</span>
        </div>
      ))}
    </div>
  );
}
function Legend({ keys, colors }: { keys: string[]; colors: Record<string, string> }) {
  return <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px] text-slate-600">{keys.map(k => <span key={k} className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: colorOf(k, colors) }} />{k}</span>)}</div>;
}

function Fold({ label, count, children, tone = 'slate', defaultOpen = false }: { label: string; count: number; children: ReactNode; tone?: 'slate' | 'amber'; defaultOpen?: boolean }) {
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
function LineList({ rows, note }: { rows: (ListedLine & { reason?: string })[]; note?: string }) {
  return (
    <div className="divide-y divide-slate-100">
      {note && <div className="text-[11px] text-slate-500 pb-1">{note}</div>}
      {rows.map((r, i) => (
        <a key={i} href={r.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 py-1 text-sm hover:bg-slate-50">
          <span className="flex-1 min-w-0"><b className="text-slate-800">#{r.n}</b> <span className="text-slate-700">{r.cl}</span> <span className="text-xs text-slate-500">· {r.d} · {r.text}</span></span>
          <span className="shrink-0 font-bold">{$2(r.amount)}</span>
        </a>
      ))}
    </div>
  );
}

export default function SalesBreakdown(p: Props) {
  const b = useMemo(() => invoiceBreakdown(p.invoices, p.range, p.overrides), [p.invoices, p.range.from, p.range.to, p.overrides]);
  const qb = useMemo(() => quoteCategoryBreakdown(p.quotes, p.range, p.overrides), [p.quotes, p.range.from, p.range.to, p.overrides]);
  const bh = divisionBH(p.bhByMonth, b.months, p.currentMonth);
  const catKeys = CATEGORIES.filter(c => b.byCategory.some(x => x.key === c));
  const divKeys = [...b.byDivision.map(d => d.key)].sort((a, c) => (DIVISIONS_ORDER.indexOf(a) - DIVISIONS_ORDER.indexOf(c)));
  if (!p.hasData) return <Card icon={<BarChart3 className="w-4 h-4" />} title="Sales by category and division"><div className="text-sm font-bold text-slate-600">Data unavailable — no successful pull yet.</div></Card>;
  if (!p.invoices.length) return <Card icon={<BarChart3 className="w-4 h-4" />} title="Sales by category and division"><div className="text-sm font-bold text-slate-600">Data unavailable — invoices arrive with the next sales pull.</div></Card>;
  return (
    <div className="space-y-4 min-w-0">
      {/* Headlines */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Headline label="Total invoiced" value={$(b.total.pre)} sub={`${b.invoices} invoices · before tax`} title={`With tax: ${$2(b.total.incl)}`} />
        <Headline label="Quotes won" value={`${p.wonCount} · ${$(p.wonPre)}`} sub="sent in the period, approved or converted" title={`With tax: ${$2(p.wonIncl)}`} />
        <Headline label="Open pipeline" value={`${p.waitingCount} · ${$(qb.pipeline.total)}`} sub="waiting on the client now" />
      </div>
      {p.avgTicketPre != null && <div className="text-xs text-slate-500">Average won quote {$(p.avgTicketPre)} before tax.</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <Card icon={<Layers className="w-4 h-4" />} title="Invoiced by service category">
          <RankedBars rows={b.byCategory} colors={CAT_COLOR} />
          <div className="mt-4 text-xs font-black uppercase tracking-wide text-slate-600">Month by month</div>
          <MonthBars months={b.months} keys={catKeys} colors={CAT_COLOR} valueOf={(i, k) => (b.monthly[i].byCategory as Record<string, number>)[k] || 0} />
          <Legend keys={catKeys} colors={CAT_COLOR} />
          <div className="mt-2 text-[11px] text-slate-500">By invoice lines: the catalog item where one is picked, otherwise the line's wording. Discounts come off the service they belong to. Before tax; hover for the amount with tax.</div>
          <Fold label="Asset sales — not counted as sales" count={b.assets.length}><LineList rows={b.assets} /></Fold>
          <Fold label="Trimming — in Other until you choose hedges or string trimming" count={b.trimming.length} tone="amber" defaultOpen><LineList rows={b.trimming} /></Fold>
          <Fold label="Discounts that couldn't be tied to a service (in Other)" count={b.untiedDiscounts.length}><LineList rows={b.untiedDiscounts} /></Fold>
          <Fold label="Lines with names not in a category (in Other)" count={b.unmapped.length}><LineList rows={b.unmapped.slice(0, 50)} note="Assign the names below and they move to their category." /></Fold>
        </Card>

        <Card icon={<Building className="w-4 h-4" />} title="Invoiced by division">
          <RankedBars rows={b.byDivision} colors={DIV_COLOR} extra={r => {
            const d = b.byDivision.find(x => x.key === r.key)!;
            const perBH = dollarsPerBH(b, r.key, bh);
            const parts: string[] = [];
            if (d.method1 || d.method2 || d.method4) parts.push(`${$(d.method1)} from crew records · ${$(d.method2)} from Jobber assignees${d.method4 ? ` · ${$(d.method4)} by service category` : ''}`);
            if (r.key === COMMERCIAL_SNOW) parts.push('snow lines on any invoice');
            if (r.key === UNATTRIBUTED) parts.push('no crew-day, no mapped assignee, no clear service category — listed below');
            if (bh.bh[r.key]) parts.push(`${bh.bh[r.key].toLocaleString('en-CA')} BH · ${perBH != null ? $(perBH) : '—'} invoiced per BH (provisional)`);
            return <span className="text-[11px] text-slate-500">{parts.join(' · ')}</span>;
          }} />
          <div className="mt-2 text-[11px] text-slate-500">
            {bh.withBH.length ? <>BH and $ per BH cover {bh.withBH.map(mlabel).join(', ')}{bh.without.length ? <> only — <b>no BH on record for {bh.without.map(mlabel).join(', ')}</b></> : ''}. Invoices are counted in the month they were issued, which can trail the work.</> : <b>No complete month with BH in this period — $ per BH isn't available.</b>}
            {bh.inProgress && <> {mlabel(bh.inProgress)} is left out: it's still being invoiced.</>}
            {bh.withBH.length > 0 && <> <b>$ per BH is provisional</b> until checked against your own figures: invoices are counted by issue date and BH by work date. Checked 2026-10-20 — Lawn bills at month end (79% of its dollars on the 26th–31st), so moving early-month invoices back a month changes Lawn by under $0.20/BH.</>}
          </div>
          <div className="mt-4 text-xs font-black uppercase tracking-wide text-slate-600">Month by month</div>
          <MonthBars months={b.months} keys={divKeys} colors={DIV_COLOR} valueOf={(i, k) => b.monthly[i].byDivision[k] || 0} />
          <Legend keys={divKeys} colors={DIV_COLOR} />
          <Fold label={`Unattributed invoices · ${$(b.unattributed.reduce((s, u) => s + u.amount, 0))}`} count={b.unattributed.length} tone="amber"><LineList rows={b.unattributed.slice(0, 100)} note="No CrewMaster crew-day, no mapped Jobber assignee, and a service category with no clear division. Kept in the totals, never dropped." /></Fold>
          <Fold label="Service category → division (4th fallback)" count={b.categoryDivisions.length}>
            <div className="text-[11px] text-slate-500 mb-1">Only for invoices the other methods can't place. A category is used when crew records put at least {Math.round(FALLBACK_MIN_SHARE * 100)}% of its dollars in one division, on at least {$(FALLBACK_MIN_BASIS)}. "Other" is never used — it's a catch-all, not a service.</div>
            <div className="divide-y divide-slate-100 text-xs">
              {b.categoryDivisions.map(c => (
                <div key={c.category} className={`flex items-center gap-2 py-1 ${c.used ? '' : 'text-slate-400'}`}>
                  <span className="flex-1">{c.category} → <b>{c.division}</b></span>
                  <span>{Math.round(c.share * 100)}% of {$(c.basis)}</span>
                  <span className="w-16 text-right font-bold">{c.used ? 'used' : 'not clear'}</span>
                </div>
              ))}
            </div>
          </Fold>
        </Card>
      </div>

      <Card icon={<Receipt className="w-4 h-4" />} title="Quotes by service category">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-slate-600 mb-1">Won · {$(qb.won.total)}</div>
            {qb.won.ranked.length ? <RankedBars rows={qb.won.ranked} colors={CAT_COLOR} /> : <div className="text-sm text-slate-500">None in this period.</div>}
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-slate-600 mb-1">Open pipeline · {$(qb.pipeline.total)}</div>
            <RankedBars rows={qb.pipeline.ranked} colors={CAT_COLOR} />
          </div>
        </div>
        <div className="mt-2 text-[11px] text-slate-500">Quote lines; optional lines count only when the client selected them. Before tax.</div>
      </Card>

      <Card icon={<AlertTriangle className="w-4 h-4" />} title="Service names to assign">
        <ServiceNameAssign names={p.names} overrides={p.overrides} canEdit={p.canEditMapping} onSave={p.onSaveOverrides} />
      </Card>

      <MappingTable names={p.names} overrides={p.overrides} canEdit={p.canEditMapping} onSave={p.onSaveOverrides} invoices={p.invoices} who={p.who} />
    </div>
  );
}

const DIVISIONS_ORDER = ['Lawn Division', 'Small Projects', 'Large Projects', COMMERCIAL_SNOW, UNATTRIBUTED];

function Headline({ label, value, sub, title }: { label: string; value: string; sub?: string; title?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3" title={title}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-2xl font-black text-slate-800 leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

/** Admin: which category each Jobber catalog item counts as. */
function MappingTable({ names, overrides, canEdit, onSave, invoices, who }: { names: ServiceNamesDoc | null | undefined; overrides: CategoryOverrides; canEdit: boolean; onSave: (o: CategoryOverrides) => Promise<boolean>; invoices: InvoiceRow[]; who?: string }) {
  const [open, setOpen] = useState(false);
  const [num, setNum] = useState('');
  const [line, setLine] = useState('');
  const [lineCat, setLineCat] = useState<Category | ''>('');
  const [note, setNote] = useState('');
  const found = invoices.find(i => i.n === num.trim().replace(/^#/, ''));
  const foundLines = found ? found.li.map(l => (Array.isArray(l) ? l[0] : l.t)) : [];
  const lineEntries = Object.entries(overrides.lines || {}).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  const saveLine = async () => {
    if (!found || !line || !lineCat) return;
    const next: CategoryOverrides = { ...overrides, lines: { ...(overrides.lines || {}), [lineOverrideKey(found.n, line)]: { category: lineCat, by: who || '', at: Date.now(), note: note.trim() } } };
    if (await onSave(next)) { setNum(''); setLine(''); setLineCat(''); setNote(''); }
  };
  const removeLine = (k: string) => { const next: CategoryOverrides = { ...overrides, lines: { ...(overrides.lines || {}) } }; delete next.lines![k]; return onSave(next); };
  const items = [...new Set([...(names?.catalog || []).map(c => c.name), ...Object.keys(CATALOG_DEFAULTS).map(k => k.trim())])];
  const used = new Map((names?.catalog || []).map(c => [c.name, c]));
  const setCat = (name: string, c: Category | '') => {
    const next: CategoryOverrides = { ...overrides, catalog: { ...(overrides.catalog || {}) } };
    if (c && c !== CATALOG_DEFAULTS[name]) next.catalog![name] = c; else delete next.catalog![name];
    return onSave(next);
  };
  return (
    <Card icon={<Settings2 className="w-4 h-4" />} title="Category mapping — Jobber catalog" right={<button type="button" onClick={() => setOpen(!open)} className="text-xs font-bold text-sky-700">{open ? 'Hide' : 'Show'}</button>}>
      {/* Per-invoice overrides — one line on one invoice, admin only, with who / when / why. */}
      <div className="mb-3">
        <div className="text-xs font-black uppercase tracking-wide text-slate-600 mb-1">Per-invoice overrides ({lineEntries.length})</div>
        {lineEntries.length > 0 && (
          <div className="divide-y divide-slate-100 mb-2">
            {lineEntries.map(([k, v]) => { const [n, text] = k.split('|'); const inv = invoices.find(i => i.n === n); return (
              <div key={k} className="flex items-center gap-2 py-1 text-sm flex-wrap">
                <span className="flex-1 min-w-[180px]"><b>#{n}</b> {inv ? inv.cl : ''} · "{text}" → <b>{v.category}</b>
                  <span className="block text-[11px] text-slate-500">{v.by || '—'}{v.at ? ` · ${new Date(v.at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}{v.note ? ` · ${v.note}` : ''}</span></span>
                {canEdit && <button type="button" onClick={() => removeLine(k)} className="text-[11px] font-bold text-red-700">Remove</button>}
              </div>
            ); })}
          </div>
        )}
        {canEdit && (
          <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr_1fr] gap-2 items-start">
            <input aria-label="Invoice number" className="border border-slate-300 rounded-md px-2 py-1 text-sm" placeholder="Invoice #" value={num} onChange={e => { setNum(e.target.value); setLine(''); }} />
            <select aria-label="Line" className="border border-slate-300 rounded-md px-2 py-1 text-sm bg-white" value={line} onChange={e => setLine(e.target.value)} disabled={!found}>
              <option value="">{found ? 'Which line?' : num ? 'No such invoice this year' : 'Enter an invoice #'}</option>
              {foundLines.map((t, i) => <option key={i} value={t}>{t}</option>)}
            </select>
            <select aria-label="Category" className="border border-slate-300 rounded-md px-2 py-1 text-sm bg-white" value={lineCat} onChange={e => setLineCat(e.target.value as Category)}>
              <option value="">Category…</option>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input aria-label="Note" className="sm:col-span-2 border border-slate-300 rounded-md px-2 py-1 text-sm" placeholder="Note (why)" value={note} onChange={e => setNote(e.target.value)} />
            <button type="button" disabled={!found || !line || !lineCat} onClick={saveLine} className="px-3 py-1 rounded-md bg-emerald-700 text-white text-sm font-bold disabled:opacity-40">Save override</button>
          </div>
        )}
      </div>
      {!open ? <div className="text-xs text-slate-500">{items.length} catalog items · {Object.keys(overrides.catalog || {}).length} changed from the agreed defaults. {canEdit ? 'Admins can change any item.' : ''}</div> : (
        <div className="divide-y divide-slate-100">
          {items.sort((a, c) => (used.get(c)?.amount || 0) - (used.get(a)?.amount || 0) || a.localeCompare(c)).map(name => {
            const cur = (overrides.catalog && overrides.catalog[name]) || CATALOG_DEFAULTS[name] || '';
            const u = used.get(name);
            return (
              <div key={name} className="flex items-center gap-2 py-1 text-sm flex-wrap">
                <span className="flex-1 min-w-[160px]">{name} <span className="text-[11px] text-slate-500">{u ? `· ${u.count} lines · ${$(u.amount)}` : '· not used this year'}{overrides.catalog?.[name] ? ' · changed' : ''}</span></span>
                {canEdit ? (
                  <select aria-label={`Category for ${name}`} className="border border-slate-300 rounded-md px-2 py-1 text-sm bg-white" value={cur} onChange={e => setCat(name, e.target.value as Category | '')}>
                    {!cur && <option value="">(by the rules)</option>}
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : <b className="text-sm">{cur || 'by the rules'}</b>}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

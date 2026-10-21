// Sales by SERVICE CATEGORY and by DIVISION (SalesMaster scoreboard).
// Pre-tax headline, with tax on hover. Everything follows the scoreboard's
// date filter. Rules: docs/service-category-mapping.md; divisions: the sales
// pull's attribution (crew-days → Jobber assignee → unattributed).
import { useMemo, useState, type ReactNode } from 'react';
import { Building, Layers, ChevronDown, ChevronRight, Settings2 } from 'lucide-react';
import Popup from './Popup';
import {
  invoiceBreakdown, serviceBreakdown, divisionBH, dollarsPerBH, COMMERCIAL_SNOW, UNATTRIBUTED, FALLBACK_MIN_SHARE, FALLBACK_MIN_BASIS,
  type InvoiceRow, type CategoryOverrides, type Ranked, type ListedLine, type InvoiceBreakdown,
} from '../lib/sales/categories';
import { CATALOG_DEFAULTS, lineOverrideKey } from '../../functions/src/shared/serviceCategories';
import type { Range } from '../lib/sales/periods';
import { ASSIGNABLE, type ServiceNamesDoc } from './ServiceNameAssign';
import { serviceCategory } from '../lib/sales/serviceMap';

const $ = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-CA')}`;
const $2 = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mlabel = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

const CAT_COLOR: Record<string, string> = {
  'Lawn mowing': '#16a34a', 'Lawn care': '#65a30d',
  'Dethatching': '#ca8a04', 'Cleanups & gardens': '#d97706', 'Arborist': '#0d9488', 'Stump grinding': '#92400e',
  'Sod': '#4d7c0f', 'Hardscape': '#57534e', 'Driveways': '#7c3aed', 'Gravel & rock': '#a8a29e', 'Grading & drainage': '#8b5cf6',
  'Soil & prep': '#78350f', 'Dump runs': '#44403c', 'Sweeping': '#6366f1', 'Commercial snow': '#0284c7',
  'Fees & adjustments': '#94a3b8', 'Unassigned': '#cbd5e1',
};
const DIV_COLOR: Record<string, string> = {
  'Lawn': '#16a34a', 'Lawn Division': '#16a34a', 'Small Projects': '#d97706', 'Large Projects': '#7c3aed', [COMMERCIAL_SNOW]: '#0284c7', [UNATTRIBUTED]: '#94a3b8',
};
const colorOf = (k: string, map: Record<string, string>) => map[k] || '#64748b';

interface Props {
  invoices: InvoiceRow[];
  range: Range;
  hasData: boolean;
  overrides: CategoryOverrides;
  bhByMonth?: Record<string, Record<string, number>>;
  currentMonth?: string;                                     // YYYY-MM, left out of $ per BH
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

function RankedBars({ rows, colors, extra, scale }: { rows: Ranked[]; colors: Record<string, string>; extra?: (r: Ranked) => ReactNode; scale?: number }) {
  const max = scale || Math.max(1, ...rows.map(r => Math.abs(r.pre)));
  return (
    <div className="space-y-1.5">
      {rows.map(r => (
        <div key={r.key} title={`With tax: ${$2(r.incl)}`}>
          <div className="flex items-baseline gap-2 text-sm">
            <span className="flex-1 min-w-0 truncate font-bold text-slate-800 text-base">{r.key}</span>
            <span className="shrink-0 font-black text-slate-800">{$(r.pre)}</span>
            <span className="shrink-0 w-12 text-right text-xs text-slate-500">{pct(r.share)}</span>
          </div>
          <div className="h-3 rounded bg-slate-100 overflow-hidden"><div className="h-full rounded" style={{ width: `${Math.max(0, (r.pre / max) * 100)}%`, background: colorOf(r.key, colors) }} /></div>
          {extra && <div className="mt-0.5">{extra(r)}</div>}
        </div>
      ))}
    </div>
  );
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
  // One breakdown for the cards (categories AND divisions — same lines, same range, same total)…
  const sb = useMemo(() => serviceBreakdown(p.invoices, p.range, p.overrides), [p.invoices, p.range.from, p.range.to, p.overrides]);
  // …and the crew view, only for $ per BH and the details.
  const b = useMemo(() => invoiceBreakdown(p.invoices, p.range, p.overrides), [p.invoices, p.range.from, p.range.to, p.overrides]);
  const [popup, setPopup] = useState<null | 'details' | 'unassigned' | 'equipment'>(null);
  if (!p.hasData) return <div className="rounded-xl bg-white border border-slate-200 p-4 text-sm font-bold text-slate-600">Data unavailable — no successful pull yet.</div>;
  if (!p.invoices.length) return <div className="rounded-xl bg-white border border-slate-200 p-4 text-sm font-bold text-slate-600">Data unavailable — invoices arrive with the next sales pull.</div>;
  const fees = sb.outside.find(x => x.key === 'Fees & adjustments');
  const unassigned = sb.outside.find(x => x.key === 'Unassigned');
  const equipment = sb.assets.reduce((s, a) => s + a.amount, 0);
  return (
    <div className="space-y-3 min-w-0">
      {sb.checks.length > 0 && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <b>The figures don't add up — please report this:</b>
          <ul className="list-disc ml-5">{sb.checks.map(c => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
      <div className="rounded-xl border border-slate-200 bg-white p-4" title={`With tax: ${$2(sb.total.incl)}`}>
        <div className="text-xs font-black uppercase tracking-wide text-slate-500">Total invoiced</div>
        <div className="text-4xl font-black text-emerald-800 leading-tight">{$(sb.total.pre)}</div>
        <div className="text-xs text-slate-500">{sb.invoices.toLocaleString('en-CA')} invoices · before tax · equipment sales not included</div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        <Card icon={<Building className="w-4 h-4" />} title="By division">
          <RankedBars rows={sb.byDivision} colors={DIV_COLOR} extra={r => <span className="text-[11px] text-slate-500">{(sb.categoriesOf[r.key] || []).join(' + ')}</span>} />
        </Card>
        <Card icon={<Layers className="w-4 h-4" />} title="By service category">
          <div className="space-y-3">
            {sb.byDivision.map(d => (
              <div key={d.key}>
                <div className="text-[11px] font-black uppercase tracking-wide mb-1" style={{ color: colorOf(d.key, DIV_COLOR) }}>{d.key}</div>
                <RankedBars rows={sb.byCategory.filter(c => (sb.categoriesOf[d.key] || []).includes(c.key))} colors={CAT_COLOR} scale={Math.max(1, ...sb.byCategory.map(c => Math.abs(c.pre)))} />
              </div>
            ))}
          </div>
        </Card>
      </div>
      {/* Not in any division — small lines */}
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm divide-y divide-slate-100">
        <div className="flex gap-2 py-1"><span className="flex-1 text-slate-700">Fees &amp; adjustments <span className="text-[11px] text-slate-500">· in no division</span></span><b>{$(fees?.pre || 0)}</b><span className="w-12 text-right text-xs text-slate-500">{pct(fees?.share || 0)}</span></div>
        <button type="button" onClick={() => setPopup('unassigned')} className="w-full flex gap-2 py-1 text-left"><span className="flex-1 text-slate-700 underline decoration-dotted">Unassigned <span className="text-[11px] text-slate-500">· {sb.unassigned.length} line{sb.unassigned.length === 1 ? '' : 's'}, in no division</span></span><b>{$(unassigned?.pre || 0)}</b><span className="w-12 text-right text-xs text-slate-500">{pct(unassigned?.share || 0)}</span></button>
        <button type="button" onClick={() => setPopup('equipment')} className="w-full flex gap-2 py-1 text-left"><span className="flex-1 text-slate-700 underline decoration-dotted">Equipment sales <span className="text-[11px] text-slate-500">· excluded from sales</span></span><b className="text-slate-500">{$(equipment)}</b><span className="w-12" /></button>
      </div>
      <div className="text-[11px] text-slate-500">Divisions are the sum of their categories; every share is of the same {$(sb.total.pre)} total for the dates above.</div>
      <button type="button" onClick={() => setPopup('details')} className="text-xs font-bold text-sky-700 underline">Details — crew view and $ per BH</button>
      {popup === 'details' && <Popup title="Sales details" onClose={() => setPopup(null)} wide><Details b={b} bhByMonth={p.bhByMonth} currentMonth={p.currentMonth} /></Popup>}
      {popup === 'unassigned' && <Popup title="Unassigned lines" onClose={() => setPopup(null)} wide><LineList rows={sb.unassigned} note="Not in any category the map places. Assign the name (Names to assign) or the invoice line (Mapping)." /></Popup>}
      {popup === 'equipment' && <Popup title="Equipment sales — excluded" onClose={() => setPopup(null)}><LineList rows={sb.assets} note={`Total ${$2(equipment)} — not counted as sales.`} /></Popup>}
    </div>
  );
}

/** Everything behind the headline bars — lists, the division methods, $ per BH (provisional). */
export function Details({ b, bhByMonth, currentMonth }: { b: InvoiceBreakdown; bhByMonth?: Record<string, Record<string, number>>; currentMonth?: string }) {
  const bh = divisionBH(bhByMonth, b.months, currentMonth);
  return (
    <div className="text-sm">
      <div className="text-xs font-black uppercase tracking-wide text-slate-600">Crew view — for $ per BH only</div>
      <div className="text-[11px] text-slate-500 mb-1">By which crew did the work (crew-days, then Jobber assignees). The division cards use the service map instead; $ per BH stays crew-based.</div>
      <div className="divide-y divide-slate-100">
        {b.byDivision.map(d => { const perBH = dollarsPerBH(b, d.key, bh); return (
          <div key={d.key} className="py-1">
            <div className="flex gap-2"><b className="flex-1">{d.key}</b><b>{$(d.pre)}</b></div>
            <div className="text-[11px] text-slate-500">
              {d.method1 || d.method2 || d.method4 ? `${$(d.method1)} from crew records · ${$(d.method2)} from Jobber assignees${d.method4 ? ` · ${$(d.method4)} by service category` : ''}` : d.key === COMMERCIAL_SNOW ? 'snow lines on any invoice' : d.key === UNATTRIBUTED ? 'no crew-day, no mapped assignee, no clear service category' : ''}
              {d.key === 'Large Projects' ? ' · dump runs always count here' : ''}
              {bh.bh[d.key] ? ` · ${bh.bh[d.key].toLocaleString('en-CA')} BH · ${perBH != null ? $(perBH) : '—'} invoiced per BH (provisional)` : ''}
            </div>
          </div>
        ); })}
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        {bh.withBH.length ? <>$ per BH covers {bh.withBH.map(mlabel).join(', ')}{bh.inProgress ? ` (${mlabel(bh.inProgress)} left out: still being invoiced)` : ''}. <b>Provisional</b> — invoices by issue date, BH by work date.</> : 'No complete month with BH in this period.'}
      </div>
      <Fold label="Equipment sales — not counted as sales" count={b.assets.length} defaultOpen><LineList rows={b.assets} /></Fold>
      <Fold label={`Unattributed invoices · ${$(b.unattributed.reduce((s, u) => s + u.amount, 0))}`} count={b.unattributed.length} tone="amber"><LineList rows={b.unattributed.slice(0, 100)} note="Kept in the totals, never dropped." /></Fold>
      <Fold label="Trimming — in Other until you choose hedges or string trimming" count={b.trimming.length} tone="amber"><LineList rows={b.trimming} /></Fold>
      <Fold label="Discounts that couldn't be tied to a service (in Other)" count={b.untiedDiscounts.length}><LineList rows={b.untiedDiscounts} /></Fold>
      <Fold label="Service category → division (4th fallback)" count={b.categoryDivisions.length}>
        <div className="text-[11px] text-slate-500 mb-1">Only for invoices the other methods can't place: at least {Math.round(FALLBACK_MIN_SHARE * 100)}% of a category's crew-record dollars in one division, on at least {$(FALLBACK_MIN_BASIS)}. Never "Other".</div>
        <div className="divide-y divide-slate-100 text-xs">
          {b.categoryDivisions.map(c => (
            <div key={c.category} className={`flex items-center gap-2 py-1 ${c.used ? '' : 'text-slate-400'}`}>
              <span className="flex-1">{c.category} → <b>{c.division}</b></span><span>{Math.round(c.share * 100)}% of {$(c.basis)}</span><span className="w-16 text-right font-bold">{c.used ? 'used' : 'not clear'}</span>
            </div>
          ))}
        </div>
      </Fold>
    </div>
  );
}


/** Admin: which category each Jobber catalog item counts as. */
export function MappingTable({ names, overrides, canEdit, onSave, invoices, who }: { names: ServiceNamesDoc | null | undefined; overrides: CategoryOverrides; canEdit: boolean; onSave: (o: CategoryOverrides) => Promise<boolean>; invoices: InvoiceRow[]; who?: string }) {
  const [open, setOpen] = useState(false);
  const [num, setNum] = useState('');
  const [line, setLine] = useState('');
  const [lineCat, setLineCat] = useState<string>('');
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
  // A catalog item's category as the scoreboard shows it: the agreed default through the service map.
  const shownDefault = (name: string) => (CATALOG_DEFAULTS[name] ? serviceCategory(CATALOG_DEFAULTS[name], name, name) : '');
  const setCat = (name: string, c: string) => {
    const next: CategoryOverrides = { ...overrides, catalog: { ...(overrides.catalog || {}) } };
    if (c && c !== shownDefault(name)) next.catalog![name] = c; else delete next.catalog![name];
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
            <select aria-label="Category" className="border border-slate-300 rounded-md px-2 py-1 text-sm bg-white" value={lineCat} onChange={e => setLineCat(e.target.value)}>
              <option value="">Category…</option>{ASSIGNABLE.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input aria-label="Note" className="sm:col-span-2 border border-slate-300 rounded-md px-2 py-1 text-sm" placeholder="Note (why)" value={note} onChange={e => setNote(e.target.value)} />
            <button type="button" disabled={!found || !line || !lineCat} onClick={saveLine} className="px-3 py-1 rounded-md bg-emerald-700 text-white text-sm font-bold disabled:opacity-40">Save override</button>
          </div>
        )}
      </div>
      {!open ? <div className="text-xs text-slate-500">{items.length} catalog items · {Object.keys(overrides.catalog || {}).length} changed from the agreed defaults. {canEdit ? 'Admins can change any item.' : ''}</div> : (
        <div className="divide-y divide-slate-100">
          {items.sort((a, c) => (used.get(c)?.amount || 0) - (used.get(a)?.amount || 0) || a.localeCompare(c)).map(name => {
            const cur = (overrides.catalog && overrides.catalog[name]) ? serviceCategory(overrides.catalog[name], name, name) : shownDefault(name);
            const u = used.get(name);
            return (
              <div key={name} className="flex items-center gap-2 py-1 text-sm flex-wrap">
                <span className="flex-1 min-w-[160px]">{name} <span className="text-[11px] text-slate-500">{u ? `· ${u.count} lines · ${$(u.amount)}` : '· not used this year'}{overrides.catalog?.[name] ? ' · changed' : ''}</span></span>
                {canEdit ? (
                  <select aria-label={`Category for ${name}`} className="border border-slate-300 rounded-md px-2 py-1 text-sm bg-white" value={cur} onChange={e => setCat(name, e.target.value)}>
                    {!cur && <option value="">(by the rules)</option>}
                    {ASSIGNABLE.map(c => <option key={c} value={c}>{c}</option>)}
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

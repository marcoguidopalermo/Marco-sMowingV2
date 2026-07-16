import { useMemo, useState } from 'react';
import { Calculator, Sliders, Plus, Trash2, DollarSign, TrendingUp, Info, RotateCcw, Save, FilePlus, Search, FolderOpen } from 'lucide-react';
import { SalesRates, SalesService, SalesMaterial, SalesMaterialUnit, SalesQuote } from '../types';
import {
  computeQuote, computeProfitTable, bhFromPrice, labourCostFor, money, buildQuoteSnapshot, MaterialLine, round2,
} from '../lib/salesMaster';

interface Props {
  rates: SalesRates;
  quotes: Record<string, SalesQuote>;
  isAdmin: boolean;
  currentUser: { email: string; name: string };
  onSaveRates: (r: SalesRates) => void;
  onSaveQuote: (q: SalesQuote) => void;
  onDeleteQuote: (id: string) => void;
}

const uid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const UNITS: SalesMaterialUnit[] = ['sqft', 'yard', 'load', 'each'];
const fmtWhen = (ms?: number) => ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

export default function SalesMaster({ rates, quotes, isAdmin, currentUser, onSaveRates, onSaveQuote, onDeleteQuote }: Props) {
  const [tab, setTab] = useState<'calculator' | 'saved' | 'rates'>('calculator');
  const activeServices = useMemo(() => rates.services.filter(s => s.active), [rates]);
  const activeMaterials = useMemo(() => rates.materials.filter(m => m.active), [rates]);

  const [serviceId, setServiceId] = useState(activeServices[0]?.id || '');
  const [lines, setLines] = useState<MaterialLine[]>([]);
  const [bh, setBh] = useState<number>(0);
  const [baselineBH, setBaselineBH] = useState<number>(0);
  const [priceInput, setPriceInput] = useState('');
  const [loadedQuoteId, setLoadedQuoteId] = useState<string | null>(null);
  const [loadedQuoteName, setLoadedQuoteName] = useState<string>('');

  const service = rates.services.find(s => s.id === serviceId);
  const q = useMemo(() => computeQuote(service, lines, bh, rates), [service, lines, bh, rates]);
  const profit = useMemo(() => computeProfitTable(q, service, rates), [q, service, rates]);
  // BH is kept full-precision internally; round only for display. The price
  // delta reads from the quote difference so a +$1000 nudge shows exactly.
  const bhDisp = round2(q.bh);
  const delta = round2(q.bh - baselineBH);
  const baselineQuote = round2(q.materialsCharged + baselineBH * q.serviceRate);
  const priceDelta = round2(q.quoteTotal - baselineQuote);
  const hasContent = !!serviceId && (lines.length > 0 || bh > 0);

  const setBudgetBH = (v: number) => { const n = Number(v) || 0; setBh(n); setBaselineBH(n); };
  const applyPrice = (newTotal: number) => {
    if (!(q.serviceRate > 0)) return;
    setBh(bhFromPrice(newTotal, q.materialsCharged, q.serviceRate));
  };
  const bump = (d: number) => applyPrice(round2(q.quoteTotal + d));

  const addLine = () => { const m = activeMaterials[0]; if (m) setLines(ls => [...ls, { materialId: m.id, qty: 0 }]); };

  const resetCalc = () => {
    if (hasContent && !window.confirm('Clear the calculator? This discards the current quote.')) return;
    setServiceId(activeServices[0]?.id || ''); setLines([]); setBh(0); setBaselineBH(0); setPriceInput('');
    setLoadedQuoteId(null); setLoadedQuoteName('');
  };
  // Save the current calc as a quote. asNew=true (Save As) always mints a new
  // id; otherwise update the loaded quote in place, or create if none loaded.
  const saveCurrent = (asNew: boolean) => {
    const suggested = asNew ? '' : loadedQuoteName;
    const name = (window.prompt(asNew ? 'Save as — quote name:' : 'Quote name:', suggested || '') || '').trim();
    if (!name) return;
    const id = (!asNew && loadedQuoteId) ? loadedQuoteId : `quote-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    onSaveQuote(buildQuoteSnapshot(id, name, service, q, rates));
    setLoadedQuoteId(id); setLoadedQuoteName(name);
  };
  const loadQuote = (sq: SalesQuote) => {
    setServiceId(sq.serviceId);
    setLines(sq.lines.map(l => ({ materialId: l.materialId, qty: l.qty })));
    setBh(sq.bh); setBaselineBH(sq.bh); setPriceInput('');
    setLoadedQuoteId(sq.id); setLoadedQuoteName(sq.name);
    setTab('calculator');
  };
  // Picker options include the currently-selected id even if it's been
  // deactivated (so a loaded quote referencing an inactive service/material
  // stays selectable and displays).
  const serviceOptions = useMemo(() => {
    const opts = [...activeServices];
    if (service && !service.active) opts.push(service);
    return opts;
  }, [activeServices, service]);
  const materialOptions = (currentId: string) => {
    const m = rates.materials.find(x => x.id === currentId);
    return (m && !m.active) ? [...activeMaterials, m] : activeMaterials;
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-100 p-4 md:p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><Calculator className="w-6 h-6 text-slate-700" /> SalesMaster</h2>
          <div className="flex flex-wrap bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
            <button onClick={() => setTab('calculator')} className={`px-3 py-1.5 text-sm font-bold rounded-md ${tab === 'calculator' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500'}`}>Calculator</button>
            <button onClick={() => setTab('saved')} className={`px-3 py-1.5 text-sm font-bold rounded-md ${tab === 'saved' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500'}`}>Saved quotes</button>
            {isAdmin && <button onClick={() => setTab('rates')} className={`px-3 py-1.5 text-sm font-bold rounded-md ${tab === 'rates' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500'}`}>Rates sheet</button>}
          </div>
        </div>

        {tab === 'calculator' && (
          <div className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
            {/* INPUTS */}
            <div className="space-y-4">
              {loadedQuoteName && (
                <div className="bg-sky-50 border border-sky-200 rounded-lg px-3 py-1.5 text-[12px] font-bold text-sky-800 flex items-center gap-1.5"><FolderOpen className="w-3.5 h-3.5" /> Editing: {loadedQuoteName}</div>
              )}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
                <div>
                  <label className="text-[11px] font-black uppercase tracking-widest text-slate-500 block mb-1">Service type</label>
                  <select value={serviceId} onChange={e => setServiceId(e.target.value)} className="w-full border border-slate-300 rounded-lg p-2 text-sm font-bold bg-white">
                    {serviceOptions.map(s => <option key={s.id} value={s.id}>{s.name} — {money(s.chargeRatePerHr)}/hr{s.active ? '' : ' (inactive)'}</option>)}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Materials</label>
                    <button onClick={addLine} className="text-[11px] font-bold text-emerald-700 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add line</button>
                  </div>
                  <div className="space-y-2">
                    {lines.length === 0 && <div className="text-[12px] text-slate-400 italic">No materials — labour-only job.</div>}
                    {lines.map((ln, i) => {
                      const m = rates.materials.find(x => x.id === ln.materialId);
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <select value={ln.materialId} onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, materialId: e.target.value } : l))} className="flex-1 min-w-0 border border-slate-300 rounded-lg p-2 text-sm font-medium bg-white">
                            {materialOptions(ln.materialId).map(x => <option key={x.id} value={x.id}>{x.name} ({x.unit}){x.active ? '' : ' (inactive)'}</option>)}
                          </select>
                          <input type="number" value={ln.qty || ''} placeholder="qty" onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, qty: Number(e.target.value) || 0 } : l))} className="w-20 border border-slate-300 rounded-lg p-2 text-sm text-right" />
                          <span className="text-[11px] text-slate-400 w-16 text-right">{m ? money(round2((ln.qty || 0) * m.chargePerUnit)) : ''}</span>
                          <button onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} className="text-slate-300 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-black uppercase tracking-widest text-slate-500 block mb-1">Budgeted BH (estimator's call)</label>
                  <input type="number" value={bh ? bhDisp : ''} onChange={e => setBudgetBH(Number(e.target.value))} className="w-full border border-slate-300 rounded-lg p-2 text-lg font-mono font-bold text-right" placeholder="0" />
                </div>
              </div>

              {/* TWO-WAY PRICE MANIPULATION */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5"><Sliders className="w-3.5 h-3.5" /> Price ⇄ BH manipulation</div>
                <div className="flex items-center gap-2 flex-wrap">
                  {[-500, -100, 100, 500, 1000].map(d => (
                    <button key={d} onClick={() => bump(d)} disabled={!(q.serviceRate > 0)} className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40">{d > 0 ? `+$${d}` : `−$${-d}`}</button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">Set total</span>
                  <input value={priceInput} onChange={e => setPriceInput(e.target.value)} placeholder={String(q.quoteTotal)} className="w-28 border border-slate-300 rounded-lg p-1.5 text-sm text-right" />
                  <button onClick={() => { const v = Number(priceInput); if (Number.isFinite(v)) { applyPrice(v); setPriceInput(''); } }} className="text-xs font-black uppercase tracking-widest bg-slate-800 text-white px-3 py-1.5 rounded-lg">Apply</button>
                  {delta !== 0 && <button onClick={() => setBh(baselineBH)} className="text-[11px] font-bold text-slate-500 underline">reset to budget</button>}
                </div>
                {delta !== 0 && (
                  <div className="text-[12px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                    {priceDelta > 0 ? '+' : '−'}{money(Math.abs(priceDelta))} → {bhDisp} BH ({delta > 0 ? '+' : ''}{delta} vs budget {baselineBH})
                  </div>
                )}
              </div>
            </div>

            {/* QUOTE BREAKDOWN */}
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">Quote breakdown</div>
                <div className="space-y-1 text-sm">
                  {q.lines.map(l => (
                    <div key={l.materialId} className="flex justify-between text-slate-600"><span>{l.name} — {l.qty} {l.unit} × {money(l.chargePerUnit)}</span><span className="font-mono">{money(l.lineCharge)}</span></div>
                  ))}
                  <div className="flex justify-between border-t border-slate-100 pt-1 font-medium text-slate-700"><span>Material charge</span><span className="font-mono">{money(q.materialsCharged)}</span></div>
                  <div className="flex justify-between text-slate-700"><span>Labour ({bhDisp} BH × {money(q.serviceRate)}/hr)</span><span className="font-mono">{money(q.labourCharge)}</span></div>
                </div>
                <div className="flex justify-between items-center border-t-2 border-slate-200 mt-2 pt-2">
                  <span className="text-sm font-black uppercase tracking-widest text-slate-500">Quote total</span>
                  <span className="text-2xl font-black text-slate-900">{money(q.quoteTotal)}</span>
                </div>
                <div className="flex justify-between items-center bg-emerald-50 border border-emerald-200 rounded-lg mt-3 px-3 py-2">
                  <span className="text-sm font-black uppercase tracking-widest text-emerald-700">Budgeted BH → crew</span>
                  <span className="text-2xl font-black text-emerald-700 font-mono">{bhDisp}</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button onClick={resetCalc} title="Clear the calculator back to blank" className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-black uppercase tracking-widest"><RotateCcw className="w-4 h-4" /> Reset</button>
                  <button onClick={() => saveCurrent(false)} disabled={!hasContent} title={loadedQuoteId ? 'Update the loaded quote' : 'Save this quote'} className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-xs font-black uppercase tracking-widest disabled:opacity-40"><Save className="w-4 h-4" /> Save</button>
                  <button onClick={() => saveCurrent(true)} disabled={!hasContent} title="Save a copy under a new name" className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-black uppercase tracking-widest disabled:opacity-40"><FilePlus className="w-4 h-4" /> Save as</button>
                </div>
                <div className="text-[10px] text-slate-400 mt-1.5 flex items-center gap-1"><Info className="w-3 h-3" /> Internal pricing workbench — build the client quote in Jobber. Saved quotes store charge-side numbers + BH only.</div>
              </div>
            </div>
            </div>{/* end inputs + breakdown grid */}

            {/* ADMIN-ONLY PROFIT PANEL — full-width bottom section. Desktop: a
                spacious three-column table. Mobile: three stacked scenario
                cards (no horizontal scroll, no microscopic text). */}
            {isAdmin && (
              <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-sm p-4 md:p-5 text-slate-100">
                <div className="text-[11px] font-black uppercase tracking-widest text-amber-400 mb-3 flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" /> Profit (admin only) · labour {money(labourCostFor(service, rates))}/hr{profit.hasOverhead ? ` · overhead ${money(profit.overheadPerBH)}/BH` : ''}</div>

                {/* Desktop / tablet table */}
                <div className="hidden sm:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                        <th className="text-left font-sans py-2 pr-4">Efficiency</th>
                        {profit.cols.map(c => <th key={c.eff} className="text-right font-mono py-2 px-4 w-40">{Math.round(c.eff * 100)}%</th>)}
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      <tr><td className="text-left font-sans text-slate-400 py-1.5 pr-4">Actual hours</td>{profit.cols.map(c => <td key={c.eff} className="text-right text-slate-200 px-4">{c.actualHours}</td>)}</tr>
                      <tr><td className="text-left font-sans text-slate-400 py-1.5 pr-4">Labour cost</td>{profit.cols.map(c => <td key={c.eff} className="text-right text-slate-200 px-4">{money(c.labourCost)}</td>)}</tr>
                      <tr><td className="text-left font-sans text-slate-400 py-1.5 pr-4">Material cost</td>{profit.cols.map(c => <td key={c.eff} className="text-right text-slate-200 px-4">{money(c.materialCost)}</td>)}</tr>
                      <tr className="border-t border-slate-700"><td className="text-left font-sans font-black text-emerald-400 py-2 pr-4">Gross profit</td>{profit.cols.map(c => <td key={c.eff} className="text-right font-black text-emerald-400 text-base px-4">{money(c.gp)}</td>)}</tr>
                      <tr><td className="text-left font-sans text-slate-400 pb-2 text-[12px] pr-4">margin</td>{profit.cols.map(c => <td key={c.eff} className="text-right text-slate-400 text-[12px] px-4">{c.margin.toFixed(1)}%</td>)}</tr>
                      {profit.hasOverhead && (<>
                        <tr className="border-t border-slate-700"><td className="text-left font-sans text-slate-400 py-2 pr-4">Overhead ({bhDisp}×{money(profit.overheadPerBH)})</td>{profit.cols.map(c => <td key={c.eff} className="text-right text-slate-200 px-4">{money(profit.overhead)}</td>)}</tr>
                        <tr><td className="text-left font-sans font-black text-amber-400 py-2 pr-4">Net after overhead</td>{profit.cols.map(c => <td key={c.eff} className="text-right font-black text-amber-400 text-base px-4">{money(c.net)}</td>)}</tr>
                        <tr><td className="text-left font-sans text-slate-400 text-[12px] pr-4">margin</td>{profit.cols.map(c => <td key={c.eff} className="text-right text-slate-400 text-[12px] px-4">{c.netMargin.toFixed(1)}%</td>)}</tr>
                      </>)}
                    </tbody>
                  </table>
                </div>

                {/* Mobile: three scenario cards */}
                <div className="sm:hidden grid grid-cols-1 gap-2">
                  {profit.cols.map(c => (
                    <div key={c.eff} className="bg-slate-800 rounded-lg p-3">
                      <div className="text-[11px] font-black uppercase tracking-widest text-slate-300 mb-1.5">{Math.round(c.eff * 100)}% efficiency</div>
                      <div className="grid grid-cols-2 gap-y-1 text-sm font-mono">
                        <span className="text-slate-400 font-sans">Actual hours</span><span className="text-right text-slate-200">{c.actualHours}</span>
                        <span className="text-slate-400 font-sans">Labour cost</span><span className="text-right text-slate-200">{money(c.labourCost)}</span>
                        <span className="text-slate-400 font-sans">Material cost</span><span className="text-right text-slate-200">{money(c.materialCost)}</span>
                        <span className="text-emerald-400 font-sans font-black border-t border-slate-700 pt-1">Gross profit</span><span className="text-right text-emerald-400 font-black border-t border-slate-700 pt-1">{money(c.gp)}</span>
                        <span className="text-slate-400 font-sans text-[11px]">margin</span><span className="text-right text-slate-400 text-[11px]">{c.margin.toFixed(1)}%</span>
                        {profit.hasOverhead && (<>
                          <span className="text-slate-400 font-sans border-t border-slate-700 pt-1">Overhead</span><span className="text-right text-slate-200 border-t border-slate-700 pt-1">{money(profit.overhead)}</span>
                          <span className="text-amber-400 font-sans font-black">Net after ovhd</span><span className="text-right text-amber-400 font-black">{money(c.net)}</span>
                          <span className="text-slate-400 font-sans text-[11px]">margin</span><span className="text-right text-slate-400 text-[11px]">{c.netMargin.toFixed(1)}%</span>
                        </>)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'saved' && <SavedQuotes quotes={quotes} currentUser={currentUser} isAdmin={isAdmin} onOpen={loadQuote} onDelete={onDeleteQuote} />}

        {tab === 'rates' && isAdmin && <RatesEditor rates={rates} onSave={onSaveRates} />}
      </div>
    </div>
  );
}

// ── Saved quotes list (managers + admins) ─────────────────────────────────
function SavedQuotes({ quotes, currentUser, isAdmin, onOpen, onDelete }: {
  quotes: Record<string, SalesQuote>; currentUser: { email: string; name: string }; isAdmin: boolean;
  onOpen: (q: SalesQuote) => void; onDelete: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.values(quotes)
      .filter(x => !q || `${x.name} ${x.serviceName}`.toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  }, [quotes, search]);
  const canDelete = (x: SalesQuote) => isAdmin || (x.createdBy?.email || '').toLowerCase() === currentUser.email.toLowerCase();

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search saved quotes by name or service…" className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm outline-none" />
      </div>
      {list.length === 0 ? (
        <div className="text-center text-slate-400 py-8">{Object.keys(quotes).length === 0 ? 'No saved quotes yet — build one in the Calculator and hit Save.' : 'No quotes match.'}</div>
      ) : (
        <div className="space-y-2">
          {list.map(x => (
            <div key={x.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex items-center justify-between gap-3">
              <button onClick={() => onOpen(x)} className="min-w-0 text-left flex-1">
                <div className="font-bold text-slate-800 truncate">{x.name}</div>
                <div className="text-[12px] text-slate-500">{x.serviceName || '—'} · <span className="font-mono font-bold text-slate-700">{money(x.quoteTotal)}</span> · {round2(x.bh)} BH</div>
                <div className="text-[10px] text-slate-400">{(x.updatedBy || x.createdBy)?.name || '—'} · {fmtWhen(x.updatedAt || x.createdAt)}</div>
              </button>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => onOpen(x)} title="Open in calculator" className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800"><FolderOpen className="w-4 h-4" /></button>
                {canDelete(x) && <button onClick={() => { if (window.confirm(`Delete quote "${x.name}"?`)) onDelete(x.id); }} title="Delete quote" className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Admin rates editor. PERSIST-ON-EDIT: text/number fields commit on blur;
// toggles / delete / add commit immediately. Seeded rows are just data in `r`,
// so they're fully editable and deletable. No "did it save?" ambiguity.
function RatesEditor({ rates, onSave }: { rates: SalesRates; onSave: (r: SalesRates) => void }) {
  const [r, setR] = useState<SalesRates>(JSON.parse(JSON.stringify(rates)));
  const num = (v: string) => Number(v) || 0;
  const commit = (next: SalesRates) => { setR(next); onSave(next); };   // immediate persist
  const patchSvc = (i: number, patch: Partial<SalesService>) => setR(s => ({ ...s, services: s.services.map((x, j) => j === i ? { ...x, ...patch } : x) }));
  const patchMat = (i: number, patch: Partial<SalesMaterial>) => setR(s => ({ ...s, materials: s.materials.map((x, j) => j === i ? { ...x, ...patch } : x) }));
  const persist = () => onSave(r);   // flush current local edits (on blur)

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 inline-flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> Changes save automatically as you edit.</div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 w-48">Global labour cost / hr (default)</span>
          <span className="text-slate-400"><DollarSign className="w-4 h-4 inline" /></span>
          <input type="number" value={r.labourCostPerHrDefault} onChange={e => setR(s => ({ ...s, labourCostPerHrDefault: num(e.target.value) }))} onBlur={persist} className="w-24 border border-slate-300 rounded-lg p-1.5 text-sm text-right font-mono" />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 w-48">Overhead / budgeted BH</span>
          <span className="text-slate-400"><DollarSign className="w-4 h-4 inline" /></span>
          <input type="number" value={r.overheadPerBH ?? 0} onChange={e => setR(s => ({ ...s, overheadPerBH: num(e.target.value) }))} onBlur={persist} className="w-24 border border-slate-300 rounded-lg p-1.5 text-sm text-right font-mono" />
          <span className="text-[10px] text-slate-400">0 = hide the net-after-overhead rows</span>
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Overhead note — how it was derived / last reviewed</label>
          <input value={r.overheadNote || ''} onChange={e => setR(s => ({ ...s, overheadNote: e.target.value }))} onBlur={persist} className="w-full border border-slate-300 rounded-lg p-1.5 text-sm" placeholder="e.g. placeholder — pending QBO-derived calculation" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Services</div>
          <button onClick={() => commit({ ...r, services: [...r.services, { id: uid('svc'), name: 'New service', chargeRatePerHr: 100, active: true }] })} className="text-[11px] font-bold text-emerald-700 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add service</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead><tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-left"><th className="py-1">Name</th><th className="py-1 text-right">Charge $/hr</th><th className="py-1 text-right">Labour cost $/hr (override)</th><th className="py-1 text-center">Active</th><th className="py-1" /></tr></thead>
            <tbody>
              {r.services.map((s, i) => (
                <tr key={s.id} className="border-t border-slate-50">
                  <td className="py-1 pr-2"><input value={s.name} onChange={e => patchSvc(i, { name: e.target.value })} onBlur={persist} className="w-full border border-slate-200 rounded px-2 py-1" /></td>
                  <td className="py-1 px-1"><input type="number" value={s.chargeRatePerHr} onChange={e => patchSvc(i, { chargeRatePerHr: num(e.target.value) })} onBlur={persist} className="w-24 border border-slate-200 rounded px-2 py-1 text-right font-mono" /></td>
                  <td className="py-1 px-1"><input type="number" value={s.labourCostPerHr ?? ''} placeholder="default" onChange={e => patchSvc(i, { labourCostPerHr: e.target.value === '' ? undefined : num(e.target.value) })} onBlur={persist} className="w-28 border border-slate-200 rounded px-2 py-1 text-right font-mono" /></td>
                  <td className="py-1 text-center"><input type="checkbox" checked={s.active} onChange={e => commit({ ...r, services: r.services.map((x, j) => j === i ? { ...x, active: e.target.checked } : x) })} /></td>
                  <td className="py-1 text-right"><button onClick={() => { if (window.confirm(`Delete service "${s.name}"?`)) commit({ ...r, services: r.services.filter((_, j) => j !== i) }); }} title="Delete service" className="text-slate-300 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Materials</div>
          <button onClick={() => commit({ ...r, materials: [...r.materials, { id: uid('mat'), name: 'New material', unit: 'each', costPerUnit: 0, chargePerUnit: 0, active: true }] })} className="text-[11px] font-bold text-emerald-700 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add material</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead><tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-left"><th className="py-1">Name</th><th className="py-1">Unit</th><th className="py-1 text-right">Cost / unit</th><th className="py-1 text-right">Charge / unit</th><th className="py-1 text-center">Active</th><th className="py-1" /></tr></thead>
            <tbody>
              {r.materials.map((m, i) => (
                <tr key={m.id} className="border-t border-slate-50">
                  <td className="py-1 pr-2"><input value={m.name} onChange={e => patchMat(i, { name: e.target.value })} onBlur={persist} className="w-full border border-slate-200 rounded px-2 py-1" /></td>
                  <td className="py-1 px-1"><select value={m.unit} onChange={e => commit({ ...r, materials: r.materials.map((x, j) => j === i ? { ...x, unit: e.target.value as SalesMaterialUnit } : x) })} className="border border-slate-200 rounded px-2 py-1">{UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select></td>
                  <td className="py-1 px-1"><input type="number" step="0.01" value={m.costPerUnit} onChange={e => patchMat(i, { costPerUnit: num(e.target.value) })} onBlur={persist} className="w-24 border border-slate-200 rounded px-2 py-1 text-right font-mono" /></td>
                  <td className="py-1 px-1"><input type="number" step="0.01" value={m.chargePerUnit} onChange={e => patchMat(i, { chargePerUnit: num(e.target.value) })} onBlur={persist} className="w-24 border border-slate-200 rounded px-2 py-1 text-right font-mono" /></td>
                  <td className="py-1 text-center"><input type="checkbox" checked={m.active} onChange={e => commit({ ...r, materials: r.materials.map((x, j) => j === i ? { ...x, active: e.target.checked } : x) })} /></td>
                  <td className="py-1 text-right"><button onClick={() => { if (window.confirm(`Delete material "${m.name}"?`)) commit({ ...r, materials: r.materials.filter((_, j) => j !== i) }); }} title="Delete material" className="text-slate-300 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

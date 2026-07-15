import { useMemo, useState } from 'react';
import { Calculator, Sliders, Plus, Trash2, Copy, Check, DollarSign, TrendingUp, Info } from 'lucide-react';
import { SalesRates, SalesService, SalesMaterial, SalesMaterialUnit } from '../types';
import {
  computeQuote, computeProfit, bhFromPrice, labourCostFor, money, quoteText, MaterialLine, round2,
} from '../lib/salesMaster';

interface Props {
  rates: SalesRates;
  isAdmin: boolean;
  onSaveRates: (r: SalesRates) => void;
}

const uid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const UNITS: SalesMaterialUnit[] = ['sqft', 'yard', 'load', 'each'];

async function copyToClipboard(text: string): Promise<boolean> {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch { /* fall */ }
  try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.focus(); ta.select(); const ok = document.execCommand('copy'); document.body.removeChild(ta); if (ok) return true; } catch { /* fall */ }
  return false;
}

export default function SalesMaster({ rates, isAdmin, onSaveRates }: Props) {
  const [tab, setTab] = useState<'calculator' | 'rates'>('calculator');
  const activeServices = useMemo(() => rates.services.filter(s => s.active), [rates]);
  const activeMaterials = useMemo(() => rates.materials.filter(m => m.active), [rates]);

  const [serviceId, setServiceId] = useState(activeServices[0]?.id || '');
  const [lines, setLines] = useState<MaterialLine[]>([]);
  const [bh, setBh] = useState<number>(0);
  const [baselineBH, setBaselineBH] = useState<number>(0);
  const [priceInput, setPriceInput] = useState('');
  const [copied, setCopied] = useState(false);

  const service = rates.services.find(s => s.id === serviceId);
  const q = useMemo(() => computeQuote(service, lines, bh, rates), [service, lines, bh, rates]);
  const profit = useMemo(() => computeProfit(q, service, rates), [q, service, rates]);
  // BH is kept full-precision internally; round only for display. The price
  // delta reads from the quote difference so a +$1000 nudge shows exactly.
  const bhDisp = round2(q.bh);
  const delta = round2(q.bh - baselineBH);
  const baselineQuote = round2(q.materialsCharged + baselineBH * q.serviceRate);
  const priceDelta = round2(q.quoteTotal - baselineQuote);

  const setBudgetBH = (v: number) => { const n = Number(v) || 0; setBh(n); setBaselineBH(n); };
  const applyPrice = (newTotal: number) => {
    if (!(q.serviceRate > 0)) return;
    setBh(bhFromPrice(newTotal, q.materialsCharged, q.serviceRate));
  };
  const bump = (d: number) => applyPrice(round2(q.quoteTotal + d));

  const addLine = () => { const m = activeMaterials[0]; if (m) setLines(ls => [...ls, { materialId: m.id, qty: 0 }]); };
  const copyQuote = async () => { if (await copyToClipboard(quoteText(service?.name || '', q))) { setCopied(true); setTimeout(() => setCopied(false), 1500); } };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-100 p-4 md:p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><Calculator className="w-6 h-6 text-slate-700" /> SalesMaster</h2>
          {isAdmin && (
            <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
              <button onClick={() => setTab('calculator')} className={`px-3 py-1.5 text-sm font-bold rounded-md ${tab === 'calculator' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500'}`}>Calculator</button>
              <button onClick={() => setTab('rates')} className={`px-3 py-1.5 text-sm font-bold rounded-md ${tab === 'rates' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500'}`}>Rates sheet</button>
            </div>
          )}
        </div>

        {tab === 'calculator' && (
          <div className="grid md:grid-cols-2 gap-4">
            {/* INPUTS */}
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
                <div>
                  <label className="text-[11px] font-black uppercase tracking-widest text-slate-500 block mb-1">Service type</label>
                  <select value={serviceId} onChange={e => setServiceId(e.target.value)} className="w-full border border-slate-300 rounded-lg p-2 text-sm font-bold bg-white">
                    {activeServices.map(s => <option key={s.id} value={s.id}>{s.name} — {money(s.chargeRatePerHr)}/hr</option>)}
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
                            {activeMaterials.map(x => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}
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

            {/* OUTPUT */}
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
                <button onClick={copyQuote} className={`mt-3 w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl font-black uppercase tracking-widest text-sm ${copied ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white hover:bg-slate-800'}`}>
                  {copied ? <><Check className="w-4 h-4" /> Copied ✓</> : <><Copy className="w-4 h-4" /> Copy quote</>}
                </button>
                <div className="text-[10px] text-slate-400 mt-1.5 flex items-center gap-1"><Info className="w-3 h-3" /> v1: calculate &amp; copy. Saving quotes / Jobber write = v2.</div>
              </div>

              {/* ADMIN-ONLY PROFIT PANEL */}
              {isAdmin && (
                <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-sm p-4 text-slate-100">
                  <div className="text-[11px] font-black uppercase tracking-widest text-amber-400 mb-2 flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" /> Profit (admin only)</div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between text-slate-300"><span>Material cost</span><span className="font-mono">{money(profit.materialsCost)}</span></div>
                    <div className="flex justify-between text-slate-300"><span>Labour cost @ budget ({bhDisp} × {money(labourCostFor(service, rates))})</span><span className="font-mono">{money(profit.labourCostBudget)}</span></div>
                    <div className="flex justify-between text-slate-400 text-[13px]"><span>Labour cost @ 80% eff ({round2(q.bh / 0.8)} × {money(labourCostFor(service, rates))})</span><span className="font-mono">{money(profit.labourCost80)}</span></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <div className="bg-slate-800 rounded-lg p-2 text-center">
                      <div className="text-[10px] uppercase tracking-widest text-slate-400">GP @ 100%</div>
                      <div className="text-lg font-black text-emerald-400">{money(profit.gpBudget)}</div>
                      <div className="text-[11px] text-slate-400">{profit.marginBudget}% margin</div>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-2 text-center">
                      <div className="text-[10px] uppercase tracking-widest text-slate-400">GP @ 80%</div>
                      <div className="text-lg font-black text-amber-400">{money(profit.gp80)}</div>
                      <div className="text-[11px] text-slate-400">{profit.margin80}% margin</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'rates' && isAdmin && <RatesEditor rates={rates} onSave={onSaveRates} />}
      </div>
    </div>
  );
}

// ── Admin rates editor ────────────────────────────────────────────────────
function RatesEditor({ rates, onSave }: { rates: SalesRates; onSave: (r: SalesRates) => void }) {
  const [r, setR] = useState<SalesRates>(JSON.parse(JSON.stringify(rates)));
  const setSvc = (i: number, patch: Partial<SalesService>) => setR(s => ({ ...s, services: s.services.map((x, j) => j === i ? { ...x, ...patch } : x) }));
  const setMat = (i: number, patch: Partial<SalesMaterial>) => setR(s => ({ ...s, materials: s.materials.map((x, j) => j === i ? { ...x, ...patch } : x) }));
  const num = (v: string) => Number(v) || 0;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Global labour cost / hr (default)</span>
          <span className="text-slate-400"><DollarSign className="w-4 h-4 inline" /></span>
          <input type="number" value={r.labourCostPerHrDefault} onChange={e => setR(s => ({ ...s, labourCostPerHrDefault: num(e.target.value) }))} className="w-24 border border-slate-300 rounded-lg p-1.5 text-sm text-right font-mono" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Services</div>
          <button onClick={() => setR(s => ({ ...s, services: [...s.services, { id: uid('svc'), name: 'New service', chargeRatePerHr: 100, active: true }] }))} className="text-[11px] font-bold text-emerald-700 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add service</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead><tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-left"><th className="py-1">Name</th><th className="py-1 text-right">Charge $/hr</th><th className="py-1 text-right">Labour cost $/hr (override)</th><th className="py-1 text-center">Active</th></tr></thead>
            <tbody>
              {r.services.map((s, i) => (
                <tr key={s.id} className="border-t border-slate-50">
                  <td className="py-1 pr-2"><input value={s.name} onChange={e => setSvc(i, { name: e.target.value })} className="w-full border border-slate-200 rounded px-2 py-1" /></td>
                  <td className="py-1 px-1"><input type="number" value={s.chargeRatePerHr} onChange={e => setSvc(i, { chargeRatePerHr: num(e.target.value) })} className="w-24 border border-slate-200 rounded px-2 py-1 text-right font-mono" /></td>
                  <td className="py-1 px-1"><input type="number" value={s.labourCostPerHr ?? ''} placeholder="default" onChange={e => setSvc(i, { labourCostPerHr: e.target.value === '' ? undefined : num(e.target.value) })} className="w-28 border border-slate-200 rounded px-2 py-1 text-right font-mono" /></td>
                  <td className="py-1 text-center"><input type="checkbox" checked={s.active} onChange={e => setSvc(i, { active: e.target.checked })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Materials</div>
          <button onClick={() => setR(s => ({ ...s, materials: [...s.materials, { id: uid('mat'), name: 'New material', unit: 'each', costPerUnit: 0, chargePerUnit: 0, active: true }] }))} className="text-[11px] font-bold text-emerald-700 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add material</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead><tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-left"><th className="py-1">Name</th><th className="py-1">Unit</th><th className="py-1 text-right">Cost / unit</th><th className="py-1 text-right">Charge / unit</th><th className="py-1 text-center">Active</th></tr></thead>
            <tbody>
              {r.materials.map((m, i) => (
                <tr key={m.id} className="border-t border-slate-50">
                  <td className="py-1 pr-2"><input value={m.name} onChange={e => setMat(i, { name: e.target.value })} className="w-full border border-slate-200 rounded px-2 py-1" /></td>
                  <td className="py-1 px-1"><select value={m.unit} onChange={e => setMat(i, { unit: e.target.value as SalesMaterialUnit })} className="border border-slate-200 rounded px-2 py-1">{UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select></td>
                  <td className="py-1 px-1"><input type="number" step="0.01" value={m.costPerUnit} onChange={e => setMat(i, { costPerUnit: num(e.target.value) })} className="w-24 border border-slate-200 rounded px-2 py-1 text-right font-mono" /></td>
                  <td className="py-1 px-1"><input type="number" step="0.01" value={m.chargePerUnit} onChange={e => setMat(i, { chargePerUnit: num(e.target.value) })} className="w-24 border border-slate-200 rounded px-2 py-1 text-right font-mono" /></td>
                  <td className="py-1 text-center"><input type="checkbox" checked={m.active} onChange={e => setMat(i, { active: e.target.checked })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={() => onSave(r)} className="px-5 py-2 text-sm font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm">Save rates</button>
      </div>
    </div>
  );
}

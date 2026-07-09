import { useMemo, useState } from 'react';
import { DollarSign, FlaskConical, RotateCcw, TrendingUp } from 'lucide-react';
import { MonthlySummary, BonusTier } from '../types';
import { STANDARD_BONUS_TIERS, computeBonus, rateForPct, nextTier } from '../lib/bonusTiers';

interface BonusCalculatorProps {
  summaries: Record<string, MonthlySummary>;  // finalized months
  liveSummary: MonthlySummary;                 // current month (MTD projection)
  currentYm: string;
}

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rateLabel = (r: number) => `$${r.toFixed(2)}/BH`;
const monthName = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

export default function BonusCalculator({ summaries, liveSummary, currentYm }: BonusCalculatorProps) {
  const months = useMemo(
    () => [...new Set([...Object.keys(summaries), currentYm])].sort().reverse(),
    [summaries, currentYm],
  );
  const [selected, setSelected] = useState<string>(months[0] || currentYm);
  const [sandbox, setSandbox] = useState<BonusTier[] | null>(null);

  const isProjection = selected === currentYm;
  const summary: MonthlySummary | undefined = isProjection ? liveSummary : summaries[selected];
  // Finalized months use THEIR stamped ladder; the live month uses the
  // current standard. Sandbox (ephemeral) overrides for modeling only.
  const officialTiers = (!isProjection && summary?.tierTable) ? summary.tierTable : STANDARD_BONUS_TIERS;
  const activeTiers = sandbox ?? officialTiers;
  const modeling = sandbox !== null;

  const result = useMemo(
    () => (summary ? computeBonus(summary, activeTiers) : null),
    [summary, activeTiers],
  );

  const editTier = (idx: number, field: 'minPct' | 'rate', value: string) => {
    const base = (sandbox ?? officialTiers).map(t => ({ ...t }));
    const num = Number(value);
    if (!Number.isFinite(num)) return;
    base[idx] = { ...base[idx], [field]: num };
    setSandbox(base);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 font-bold text-slate-700 text-sm">
          <DollarSign className="w-4 h-4 text-emerald-600" /> Bonus Calculator
          <span className="text-[10px] font-black uppercase tracking-widest text-rose-500 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">Admin</span>
        </div>
        <select
          value={selected}
          onChange={e => { setSelected(e.target.value); setSandbox(null); }}
          className="text-sm font-bold border border-slate-300 rounded p-1.5 bg-white text-slate-700"
        >
          {months.map(ym => (
            <option key={ym} value={ym}>{monthName(ym)}{ym === currentYm ? ' — MTD' : ''}</option>
          ))}
        </select>
      </div>

      {isProjection && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-[11px] font-bold text-amber-800 uppercase tracking-widest">
          Projection — month in progress. Figures settle at month-end.
        </div>
      )}
      {modeling && (
        <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-200 flex items-center justify-between gap-2">
          <span className="text-[11px] font-black text-indigo-700 uppercase tracking-widest flex items-center gap-1.5">
            <FlaskConical className="w-3.5 h-3.5" /> Modeling — not the official structure
          </span>
          <button onClick={() => setSandbox(null)} className="text-[11px] font-bold text-indigo-700 hover:text-indigo-900 inline-flex items-center gap-1">
            <RotateCcw className="w-3 h-3" /> Reset to standard
          </button>
        </div>
      )}

      {!summary || !result ? (
        <div className="p-6 text-center text-slate-400 text-sm">No data for {monthName(selected)}.</div>
      ) : (
        <div className="p-4 space-y-5">
          {/* TIER LADDER (sandbox-editable) */}
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Tier ladder ($/BH by division adjusted %)</div>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="text-[11px] text-slate-500">&lt; {activeTiers[0]?.minPct}% → $0</div>
              {activeTiers.map((t, i) => (
                <div key={i} className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded px-1.5 py-1">
                  <span className="text-[10px] text-slate-400">≥</span>
                  <input type="number" step="0.1" value={t.minPct} onChange={e => editTier(i, 'minPct', e.target.value)}
                    className="w-12 text-[11px] font-mono font-bold text-slate-700 bg-white border border-slate-200 rounded px-1 py-0.5 text-center" />
                  <span className="text-[10px] text-slate-400">%→$</span>
                  <input type="number" step="0.25" value={t.rate} onChange={e => editTier(i, 'rate', e.target.value)}
                    className="w-12 text-[11px] font-mono font-bold text-emerald-700 bg-white border border-slate-200 rounded px-1 py-0.5 text-center" />
                </div>
              ))}
            </div>
          </div>

          {/* PER DIVISION */}
          <div className="overflow-x-auto">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">By division</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <th className="py-1.5 pr-3 text-left">Division</th>
                  <th className="py-1.5 px-3 text-right">Adj %</th>
                  <th className="py-1.5 px-3 text-right">Tier</th>
                  <th className="py-1.5 px-3 text-right">BH</th>
                  <th className="py-1.5 pl-3 text-right">Pool</th>
                </tr>
              </thead>
              <tbody>
                {result.divisions.map(d => {
                  const nt = isProjection ? nextTier(d.adjustedEff, activeTiers) : null;
                  return (
                    <tr key={d.division} className="border-b border-slate-50">
                      <td className="py-1.5 pr-3 text-left font-bold text-slate-700">{d.division}</td>
                      <td className="py-1.5 px-3 text-right font-mono text-emerald-700 font-bold">{d.adjustedEff != null ? `${d.adjustedEff}%` : '—'}</td>
                      <td className="py-1.5 px-3 text-right font-mono text-slate-600">
                        {d.rate > 0 ? rateLabel(d.rate) : '—'}
                        {nt && <div className="text-[10px] text-amber-600 font-bold">{nt.gap}% from {rateLabel(nt.rate)}</div>}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono text-slate-600">{d.bh.toFixed(1)}</td>
                      <td className="py-1.5 pl-3 text-right font-mono font-black text-emerald-700">{money(d.pool)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-slate-200">
                  <td className="py-1.5 pr-3 text-left font-black text-slate-800" colSpan={4}>Company total</td>
                  <td className="py-1.5 pl-3 text-right font-mono font-black text-emerald-800">{money(result.companyTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* PER PERSON */}
          <div className="overflow-x-auto">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Per person ({result.perPerson.length})</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <th className="py-1.5 pr-3 text-left">Name</th>
                  <th className="py-1.5 px-3 text-left">BH by division → payout</th>
                  <th className="py-1.5 pl-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {result.perPerson.map(p => (
                  <tr key={p.empId} className="border-b border-slate-50">
                    <td className="py-1.5 pr-3 text-left font-medium text-slate-700 whitespace-nowrap">{p.name}</td>
                    <td className="py-1.5 px-3 text-left">
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-mono text-slate-500">
                        {p.byDivision.map(bd => (
                          <span key={bd.division}>
                            {bd.division.split(' ')[0]} {bd.bh.toFixed(1)}×{rateLabel(bd.rate)} = <b className={bd.payout > 0 ? 'text-emerald-700' : 'text-slate-400'}>{money(bd.payout)}</b>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-1.5 pl-3 text-right font-mono font-black text-emerald-700">{money(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-[11px] text-slate-400">
            <TrendingUp className="w-3 h-3 inline mr-1" />
            Payout = Σ (your BH in a division × that division's tier rate). Efficiency &amp; BH are read-only — the same
            numbers crews see (buildDivisionMtd). Per-person payouts sum to each division pool exactly.
            {!isProjection && summary.tierTable && ' Finalized month — computed from its stamped tier table.'}
          </div>
        </div>
      )}
    </div>
  );
}

import { useMemo, useState, Fragment } from 'react';
import { DollarSign, FlaskConical, RotateCcw, TrendingUp, Check, Ban, History, X } from 'lucide-react';
import { MonthlySummary, BonusTier, BonusPayoutRecord, BonusExcludeReason, BonusMarkState } from '../types';
import { STANDARD_BONUS_TIERS, computeBonus, rateForPct, nextTier } from '../lib/bonusTiers';
import {
  summarisePayout, stateOf, markOf, editOf, nextState, reasonLabel,
  EXCLUDE_REASONS, AMOUNT_REASONS,
} from '../lib/bonusPayouts';

interface BonusCalculatorProps {
  summaries: Record<string, MonthlySummary>;  // finalized months
  liveSummary: MonthlySummary;                 // current month (MTD projection)
  currentYm: string;
  isAdmin: boolean;
  // PAYOUT MARKERS — a layer over the calculation, never part of it.
  payouts: Record<string, BonusPayoutRecord>;
  onMark: (args: {
    ym: string; empId: string; empName: string;
    to: BonusMarkState | 'unmarked';
    amount: number;
    reason?: BonusExcludeReason;
    reasonNote?: string;
  }) => void | Promise<void>;
  // Set (or clear, with null) an adjusted payout amount for one person.
  onEditAmount: (args: {
    ym: string; empId: string; empName: string;
    amount: number | null; calculated: number; reason?: string;
  }) => void | Promise<void>;
}

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rateLabel = (r: number) => `$${r.toFixed(2)}/BH`;
const monthName = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

export default function BonusCalculator({
  summaries, liveSummary, currentYm, isAdmin, payouts, onMark, onEditAmount,
}: BonusCalculatorProps) {
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

  // ── PAYOUT MARKERS. Applied on top of `result`; `result` is never altered,
  // so every earned figure on screen is the calculation's own output.
  const payoutRec = payouts[selected];
  const payout = useMemo(() => summarisePayout(result, payoutRec), [result, payoutRec]);
  // Which row is mid-exclude (picking a reason).
  const [excluding, setExcluding] = useState<{ empId: string; name: string; amount: number } | null>(null);
  const [reason, setReason] = useState<BonusExcludeReason>('left_before_month_end');
  const [note, setNote] = useState('');
  const [showAudit, setShowAudit] = useState(false);

  const toggle = (empId: string, name: string, amount: number, tapped: BonusMarkState) => {
    const to = nextState(stateOf(payoutRec, empId), tapped);
    if (to === 'excluded') {
      setExcluding({ empId, name, amount });
      setReason('left_before_month_end');
      setNote('');
      return;
    }
    onMark({ ym: selected, empId, empName: name, to, amount });
  };
  // Inline amount editing.
  const [editing, setEditing] = useState<{ empId: string; name: string; calculated: number } | null>(null);
  const [draftAmount, setDraftAmount] = useState('');
  const [amountReason, setAmountReason] = useState('');
  const startEdit = (empId: string, name: string, calculated: number, current: number) => {
    setEditing({ empId, name, calculated });
    setDraftAmount(current.toFixed(2));
    setAmountReason('');
  };
  const commitEdit = () => {
    if (!editing) return;
    const v = Number(draftAmount);
    if (!Number.isFinite(v) || v < 0) return;
    // Setting it back to the calculated figure CLEARS the adjustment rather
    // than storing a no-op edit that would read as "edited" forever.
    const same = Math.round(v * 100) === Math.round(editing.calculated * 100);
    onEditAmount({
      ym: selected, empId: editing.empId, empName: editing.name,
      amount: same ? null : v, calculated: editing.calculated,
      reason: same ? undefined : (amountReason.trim() || undefined),
    });
    setEditing(null);
  };

  const confirmExclude = () => {
    if (!excluding) return;
    onMark({
      ym: selected, empId: excluding.empId, empName: excluding.name,
      to: 'excluded', amount: excluding.amount,
      reason, reasonNote: reason === 'other' ? note.trim() : undefined,
    });
    setExcluding(null);
  };

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

      {/* PROGRESS — what's done, what's withheld, what's left to pay. */}
      {summary && result && (
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-sm font-black text-slate-800">
            {payout.progress.paid} of {payout.progress.payable} marked paid
          </span>
          {payout.progress.excluded > 0 && (
            <span className="text-sm font-black text-rose-700">
              {payout.progress.excluded} excluded
            </span>
          )}
          {payout.progress.edited > 0 && (
            <span className="text-sm font-black text-indigo-700">
              {payout.progress.edited} edited ({payout.company.adjustments >= 0 ? '+' : '−'}{money(Math.abs(payout.company.adjustments))})
            </span>
          )}
          <span className="text-sm font-black text-emerald-700">
            {money(payout.company.toPay)} to pay
          </span>
          {payout.progress.payable > 0 && payout.progress.paid === payout.progress.payable && (
            <span className="text-[10px] font-black uppercase tracking-widest bg-emerald-100 text-emerald-800 border border-emerald-300 px-1.5 py-0.5 rounded">
              all paid
            </span>
          )}
          {(payoutRec?.audit?.length || 0) > 0 && (
            <button
              type="button"
              onClick={() => setShowAudit(v => !v)}
              className="ml-auto text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
            >
              <History className="w-3 h-3" /> {payoutRec!.audit.length} change{payoutRec!.audit.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}

      {showAudit && payoutRec && payoutRec.audit.length > 0 && (
        <div className="px-4 py-3 bg-white border-b border-slate-200 max-h-56 overflow-y-auto">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
            Payout trail — {monthName(selected)}
          </div>
          <div className="space-y-1">
            {[...payoutRec.audit].reverse().map((a, i) => (
              <div key={i} className="text-[11px] text-slate-600 flex flex-wrap gap-x-2">
                <span className="font-mono text-slate-400">
                  {new Date(a.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
                <span className="font-bold text-slate-800">{a.empName}</span>
                {a.kind === 'amount' ? (
                  <>
                    <span className="text-indigo-700 font-bold">amount</span>
                    <span className="font-mono text-slate-500">
                      {money(a.fromAmount ?? a.amount)} → <b className="text-indigo-700">{money(a.toAmount ?? a.amount)}</b>
                    </span>
                    <span className="text-slate-400">calculated {money(a.amount)}</span>
                    {a.amountReason && <span className="text-indigo-600">{a.amountReason}</span>}
                  </>
                ) : (
                  <>
                    <span className="text-slate-500">{a.from} → <b className={a.to === 'excluded' ? 'text-rose-700' : a.to === 'paid' ? 'text-emerald-700' : 'text-slate-600'}>{a.to}</b></span>
                    <span className="font-mono text-slate-500">{money(a.amount)}</span>
                    {a.reason && <span className="text-rose-600">{reasonLabel(a.reason, a.reasonNote)}</span>}
                  </>
                )}
                <span className="text-slate-400">by {a.byName}</span>
              </div>
            ))}
          </div>
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
                  <th className="py-1.5 px-3 text-right">Pool (calculated)</th>
                  <th className="py-1.5 px-3 text-right">Excluded</th>
                  <th className="py-1.5 px-3 text-right">Adjustments</th>
                  <th className="py-1.5 pl-3 text-right">To pay</th>
                </tr>
              </thead>
              <tbody>
                {result.divisions.map(d => {
                  const nt = isProjection ? nextTier(d.adjustedEff, activeTiers) : null;
                  return (
                    <tr key={d.division} className="border-b border-slate-50">
                      <td className="py-1.5 pr-3 text-left font-bold text-slate-700">{d.division}</td>
                      <td className="py-1.5 px-3 text-right font-mono text-emerald-700 font-bold">
                        {d.adjustedEff != null ? `${d.adjustedEff}%` : '—'}
                        {(() => {
                          const td = summary.divisions.find(sd => sd.division === d.division)?.traineeCreditedDays || 0;
                          return td > 0
                            ? <div className="text-[10px] text-amber-600 font-bold" title="Crew-days credited for carrying a trainee (+10% each)">incl. {td} trainee-day{td === 1 ? '' : 's'}</div>
                            : null;
                        })()}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono text-slate-600">
                        {d.rate > 0 ? rateLabel(d.rate) : '—'}
                        {nt && <div className="text-[10px] text-amber-600 font-bold">{nt.gap}% from {rateLabel(nt.rate)}</div>}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono text-slate-600">{d.bh.toFixed(1)}</td>
                      <td className="py-1.5 px-3 text-right font-mono text-slate-600">{money(d.pool)}</td>
                      <td className="py-1.5 px-3 text-right font-mono text-rose-600">
                        {(payout.byDivision[d.division]?.excluded || 0) > 0
                          ? `−${money(payout.byDivision[d.division].excluded)}` : '—'}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono text-indigo-700">
                        {(payout.byDivision[d.division]?.adjustments || 0) !== 0
                          ? `${payout.byDivision[d.division].adjustments > 0 ? '+' : '−'}${money(Math.abs(payout.byDivision[d.division].adjustments))}`
                          : '—'}
                      </td>
                      <td className="py-1.5 pl-3 text-right font-mono font-black text-emerald-700">
                        {money(payout.byDivision[d.division]?.toPay ?? d.pool)}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-slate-200">
                  <td className="py-1.5 pr-3 text-left font-black text-slate-800" colSpan={4}>Company total</td>
                  <td className="py-1.5 px-3 text-right font-mono font-black text-slate-700">{money(payout.company.calculated)}</td>
                  <td className="py-1.5 px-3 text-right font-mono font-black text-rose-700">
                    {payout.company.excluded > 0 ? `−${money(payout.company.excluded)}` : '—'}
                  </td>
                  <td className="py-1.5 px-3 text-right font-mono font-black text-indigo-700">
                    {payout.company.adjustments !== 0
                      ? `${payout.company.adjustments > 0 ? '+' : '−'}${money(Math.abs(payout.company.adjustments))}`
                      : '—'}
                  </td>
                  <td className="py-1.5 pl-3 text-right font-mono font-black text-emerald-800">{money(payout.company.toPay)}</td>
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
                  <th className="py-1.5 px-3 text-right">Total</th>
                  {isAdmin && <th className="py-1.5 pl-3 text-right">Payout</th>}
                </tr>
              </thead>
              <tbody>
                {result.perPerson.map(p => {
                  const st = stateOf(payoutRec, p.empId);
                  const m = markOf(payoutRec, p.empId);
                  const edit = editOf(payoutRec, p.empId);
                  const effective = edit ? edit.amount : p.total;
                  const isPaid = st === 'paid';
                  const isExcluded = st === 'excluded';
                  const rowCls = isExcluded
                    ? 'bg-rose-50/70 border-rose-200'
                    : isPaid ? 'bg-emerald-50/70 border-emerald-200'
                      : edit ? 'bg-indigo-50/50 border-indigo-100' : 'border-slate-50';
                  return (
                    <Fragment key={p.empId}>
                      <tr className={`border-b ${rowCls}`}>
                        <td className={`py-1.5 pr-3 text-left font-medium whitespace-nowrap ${isExcluded ? 'text-rose-900' : isPaid ? 'text-emerald-900 line-through' : 'text-slate-700'}`}>
                          {p.name}
                          {isExcluded && (
                            <span className="ml-1.5 text-[9px] font-black uppercase tracking-widest bg-rose-600 text-white px-1.5 py-0.5 rounded align-middle">
                              not entitled
                            </span>
                          )}
                          {isPaid && (
                            <span className="ml-1.5 text-[9px] font-black uppercase tracking-widest bg-emerald-600 text-white px-1.5 py-0.5 rounded align-middle">
                              paid
                            </span>
                          )}
                        </td>
                        <td className={`py-1.5 px-3 text-left ${isPaid ? 'line-through opacity-70' : ''}`}>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-mono text-slate-500">
                            {p.byDivision.map(bd => (
                              <span key={bd.division}>
                                {bd.division.split(' ')[0]} {bd.bh.toFixed(1)}×{rateLabel(bd.rate)} = <b className={bd.payout > 0 ? 'text-emerald-700' : 'text-slate-400'}>{money(bd.payout)}</b>
                              </span>
                            ))}
                          </div>
                        </td>
                        {/* THE CALCULATED AMOUNT IS NEVER REPLACED. An edited
                            row shows the payable figure AND the calculation it
                            came from; an excluded row shows it struck through.
                            The record has to read "earned X, excluded, not
                            paid" / "paying Y, calculated X". */}
                        <td className="py-1.5 px-3 text-right font-mono font-black whitespace-nowrap">
                          {editing?.empId === p.empId ? (
                            <div className="inline-flex items-center gap-1">
                              <span className="text-slate-400 text-[11px]">$</span>
                              <input
                                autoFocus
                                type="number"
                                step="0.01"
                                min="0"
                                value={draftAmount}
                                onChange={e => setDraftAmount(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') commitEdit();
                                  if (e.key === 'Escape') setEditing(null);
                                }}
                                className="w-24 text-right border border-emerald-400 rounded px-1 py-0.5 font-mono text-sm"
                              />
                            </div>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={!isAdmin}
                                onClick={() => startEdit(p.empId, p.name, p.total, effective)}
                                title={isAdmin ? 'Edit the payable amount' : undefined}
                                className={`${isAdmin ? 'hover:underline decoration-dotted cursor-pointer' : 'cursor-default'} ${isExcluded ? 'line-through text-rose-400' : isPaid ? 'line-through text-emerald-700' : 'text-emerald-700'}`}
                              >
                                {money(effective)}
                              </button>
                              {edit && (
                                <div className="text-[9px] font-bold text-indigo-700 normal-case">
                                  <span className="font-black uppercase tracking-widest bg-indigo-100 border border-indigo-300 px-1 py-0.5 rounded">edited</span>
                                  {' '}calculated <span className="font-mono">{money(p.total)}</span>
                                </div>
                              )}
                              {isExcluded && (
                                <div className="text-[9px] font-black uppercase tracking-widest text-rose-700">not paid</div>
                              )}
                            </>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="py-1.5 pl-3 text-right whitespace-nowrap">
                            <div className="inline-flex gap-1">
                              <button
                                type="button"
                                onClick={() => toggle(p.empId, p.name, p.total, 'paid')}
                                aria-pressed={isPaid}
                                title={isPaid ? 'Clear paid' : 'Mark paid'}
                                className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest border inline-flex items-center gap-1 ${isPaid ? 'bg-emerald-600 text-white border-emerald-700' : 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50'}`}
                              ><Check className="w-3 h-3" /> Paid</button>
                              <button
                                type="button"
                                onClick={() => toggle(p.empId, p.name, p.total, 'excluded')}
                                aria-pressed={isExcluded}
                                title={isExcluded ? 'Clear exclusion' : 'Exclude from payout'}
                                className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest border inline-flex items-center gap-1 ${isExcluded ? 'bg-rose-600 text-white border-rose-700' : 'bg-white text-rose-700 border-rose-300 hover:bg-rose-50'}`}
                              ><Ban className="w-3 h-3" /> Exclude</button>
                            </div>
                          </td>
                        )}
                      </tr>
                      {/* Reason line on an excluded row */}
                      {isExcluded && m && (
                        <tr className="bg-rose-50/40">
                          <td colSpan={isAdmin ? 4 : 3} className="px-3 pb-1.5 text-[11px] text-rose-800">
                            <b>{reasonLabel(m.reason, m.reasonNote)}</b>
                            <span className="text-rose-500">
                              {' '}· earned {money(p.total)}, excluded, not paid · marked by {m.byName}{' '}
                              {new Date(m.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          </td>
                        </tr>
                      )}
                      {/* Amount editor controls + quick reasons */}
                      {editing?.empId === p.empId && (
                        <tr className="bg-emerald-50">
                          <td colSpan={isAdmin ? 4 : 3} className="p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-800">
                                Pay {p.name} — calculated {money(p.total)}
                              </span>
                              {AMOUNT_REASONS.map(r => (
                                <button
                                  key={r}
                                  type="button"
                                  onClick={() => setAmountReason(r)}
                                  className={`px-2 py-1 rounded text-[11px] font-bold border ${amountReason === r ? 'bg-emerald-700 text-white border-emerald-800' : 'bg-white text-emerald-800 border-emerald-300'}`}
                                >{r}</button>
                              ))}
                              <input
                                value={amountReason}
                                onChange={e => setAmountReason(e.target.value)}
                                placeholder="reason (optional)"
                                className="text-[12px] border border-emerald-300 rounded px-2 py-1 min-w-[9rem]"
                              />
                              <button
                                type="button"
                                onClick={commitEdit}
                                className="px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest bg-emerald-700 text-white"
                              >Save amount</button>
                              {edit && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onEditAmount({ ym: selected, empId: p.empId, empName: p.name, amount: null, calculated: p.total });
                                    setEditing(null);
                                  }}
                                  className="px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest text-slate-600 border border-slate-300"
                                >Reset to calculated</button>
                              )}
                              <button
                                type="button"
                                onClick={() => setEditing(null)}
                                className="p-1 text-emerald-700 hover:text-emerald-900"
                                aria-label="Cancel"
                              ><X className="w-4 h-4" /></button>
                            </div>
                          </td>
                        </tr>
                      )}
                      {/* Edited note on a settled row */}
                      {edit && editing?.empId !== p.empId && (
                        <tr className={isExcluded ? 'bg-rose-50/40' : 'bg-indigo-50/40'}>
                          <td colSpan={isAdmin ? 4 : 3} className="px-3 pb-1.5 text-[11px] text-indigo-800">
                            <b>Amount edited</b>
                            <span className="text-indigo-500">
                              {' '}· paying {money(edit.amount)}, calculated {money(p.total)}
                              {' '}({edit.amount >= p.total ? '+' : '−'}{money(Math.abs(edit.amount - p.total))})
                              {edit.reason ? ` · ${edit.reason}` : ''}
                              {' '}· by {edit.byName} {new Date(edit.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              {isExcluded ? ' · EXCLUDED, so nothing is paid' : ''}
                            </span>
                          </td>
                        </tr>
                      )}
                      {/* Reason picker — shown inline while excluding */}
                      {excluding?.empId === p.empId && (
                        <tr className="bg-rose-50">
                          <td colSpan={isAdmin ? 4 : 3} className="p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[10px] font-black uppercase tracking-widest text-rose-700">
                                Exclude {p.name} — {money(p.total)} not paid. Reason:
                              </span>
                              {EXCLUDE_REASONS.map(r => (
                                <button
                                  key={r.key}
                                  type="button"
                                  onClick={() => setReason(r.key)}
                                  className={`px-2 py-1 rounded text-[11px] font-bold border ${reason === r.key ? 'bg-rose-600 text-white border-rose-700' : 'bg-white text-rose-700 border-rose-300'}`}
                                >{r.label}</button>
                              ))}
                              {reason === 'other' && (
                                <input
                                  autoFocus
                                  value={note}
                                  onChange={e => setNote(e.target.value)}
                                  placeholder="short reason"
                                  className="text-[12px] border border-rose-300 rounded px-2 py-1 min-w-[10rem]"
                                />
                              )}
                              <button
                                type="button"
                                onClick={confirmExclude}
                                disabled={reason === 'other' && note.trim() === ''}
                                className="px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest bg-rose-700 text-white disabled:opacity-40"
                              >Confirm exclude</button>
                              <button
                                type="button"
                                onClick={() => setExcluding(null)}
                                className="p-1 text-rose-500 hover:text-rose-800"
                                aria-label="Cancel"
                              ><X className="w-4 h-4" /></button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="text-[11px] text-slate-400">
            <TrendingUp className="w-3 h-3 inline mr-1" />
            Payout = Σ (your BH in a division × that division's tier rate). Efficiency &amp; BH are read-only — the same
            numbers crews see (buildDivisionMtd). Per-person payouts sum to each division pool exactly.
            {' '}Paid / excluded marks are a PAYOUT RECORD laid over this calculation: an exclusion withholds that
            person's share and reduces the total to pay, and <b>does not redistribute</b> — nobody else's figure moves.
            An edited amount is the same kind of decision: it changes what is PAID and shows the calculated figure
            beside it. What each person earned is unchanged by any mark or edit.
            {!isProjection && summary.tierTable && ' Finalized month — computed from its stamped tier table.'}
          </div>
        </div>
      )}
    </div>
  );
}

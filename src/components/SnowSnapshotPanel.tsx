// FOLLOSOFT SNAPSHOT — residential snow season totals copied from FolloSoft
// once a day (by James, Marco, or the 7:30 browser agent). Direct link:
// /#salesmaster/follosoft-snapshot (the form's id). Labels and the button
// wording are quoted in the agent's instructions — change them together.
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Camera } from 'lucide-react';
import { previousSnapshot, type SnowSnapshot, type SnapshotInput } from '../lib/sales/snapshots';
import { snowSeasonFor } from '../lib/sales/periods';

const $ = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`;
const $2 = (n: number) => `$${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (ymd: string) => `${MON[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}, ${ymd.slice(0, 4)}`;
const when = (ms: number) => new Date(ms).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const inputCls = 'border border-slate-300 rounded-md px-2 py-2 text-base bg-white text-slate-900 w-full';
const label = 'block text-sm font-bold text-slate-700 mb-0.5';


export default function SnowSnapshotPanel({ snapshots, season, today, who, onSave }: {
  snapshots: SnowSnapshot[]; season: string; today: string; who: string;
  onSave: (s: SnapshotInput) => Promise<SnowSnapshot | null>;
}) {
  const [date, setDate] = useState(today);
  const [contracts, setContracts] = useState('');
  const [value, setValue] = useState('');
  const [source, setSource] = useState<'manual' | 'agent'>('manual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SnowSnapshot | null>(null);

  const sameDay = snapshots.find(s => s.date === date);
  const recent = snapshots.filter(s => s.season === season).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);

  const save = async () => {
    setError(null); setSaved(null);
    const c = Number(contracts.replace(/[^\d]/g, ''));
    const v = Number(value.replace(/[^\d.]/g, ''));
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError('Enter the date.'); return; }
    if (contracts.trim() === '' || !Number.isFinite(c)) { setError('Enter the number of contracts.'); return; }
    if (value.trim() === '' || !Number.isFinite(v) || v <= 0) { setError('Enter the total value.'); return; }
    setBusy(true);
    const s = await onSave({ date, season: snowSeasonFor(date), contracts: c, totalValue: v, source });
    setBusy(false);
    if (!s) { setError('Not saved — see the message at the bottom of the screen.'); return; }
    setSaved(s); setContracts(''); setValue('');
  };

  return (
    <div className="space-y-3">
      {recent.length > 1 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div>
                <div className="text-[11px] font-bold uppercase text-slate-500">Trend — recent snapshots</div>
                <table className="w-full text-sm mt-1">
                  <thead><tr className="text-[11px] text-slate-500 text-left"><th className="font-bold">Date</th><th className="font-bold text-right">Contracts</th><th className="font-bold text-right">Total value</th><th className="font-bold text-right">Change</th></tr></thead>
                  <tbody>
                    {recent.map(s => { const prev = previousSnapshot(snapshots, s.date, s.season); return (
                      <tr key={s.date} className="border-t border-slate-100">
                        <td className="py-0.5">{longDate(s.date).replace(/, \d{4}$/, '')}{s.flags?.length ? <AlertTriangle className="inline w-3.5 h-3.5 ml-1 text-red-600" aria-label="flagged" /> : null}</td>
                        <td className="text-right">{s.contracts}</td>
                        <td className="text-right">{$(s.totalValue)}</td>
                        <td className="text-right text-xs text-slate-600">{prev ? `${s.contracts - prev.contracts >= 0 ? '+' : ''}${s.contracts - prev.contracts} · ${s.totalValue - prev.totalValue >= 0 ? '+' : '−'}${$(Math.abs(s.totalValue - prev.totalValue))}` : 'start'}</td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
            </div>
        </div>
      )}

      {/* The form — the direct link lands here */}
      <form id="follosoft-snapshot" aria-labelledby="follosoft-snapshot-title" className="rounded-lg border-2 border-emerald-600 bg-white p-3 scroll-mt-20" onSubmit={e => { e.preventDefault(); if (!busy) save(); }}>
        <div id="follosoft-snapshot-title" className="flex items-center gap-1.5 text-base font-black text-slate-800"><Camera className="w-4 h-4" /> FolloSoft snapshot</div>
        <div className="text-xs text-slate-500 mb-2">Season totals from FolloSoft ("___ contracts, for a total value of $___"). One per day — saving again for the same date replaces it (the earlier entry is kept on record).</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label htmlFor="snap-date"><span className={label}>Date</span><input id="snap-date" name="date" type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></label>
          <label htmlFor="snap-source"><span className={label}>Source</span>
            <select id="snap-source" name="source" className={inputCls} value={source} onChange={e => setSource(e.target.value as 'manual' | 'agent')}>
              <option value="manual">Manual</option>
              <option value="agent">Agent</option>
            </select></label>
          <label htmlFor="snap-contracts"><span className={label}>Contracts</span><input id="snap-contracts" name="contracts" inputMode="numeric" autoComplete="off" className={inputCls} value={contracts} onChange={e => setContracts(e.target.value)} placeholder="e.g. 357" /></label>
          <label htmlFor="snap-value"><span className={label}>Total value</span><input id="snap-value" name="totalValue" inputMode="decimal" autoComplete="off" className={inputCls} value={value} onChange={e => setValue(e.target.value)} placeholder="e.g. 256404" /></label>
        </div>
        <div className="mt-2 text-xs text-slate-500">Entered by: <b>{who}</b></div>
        {sameDay && !saved && <div className="mt-1 text-xs text-amber-800">A snapshot for {longDate(date)} already exists ({sameDay.contracts} contracts, {$(sameDay.totalValue)}). Saving replaces it.</div>}
        <button type="submit" disabled={busy} className="mt-3 w-full sm:w-auto px-5 py-2.5 rounded-md bg-emerald-700 text-white text-base font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save snapshot'}</button>
        {error && <div role="alert" className="mt-2 text-sm font-bold text-red-700">{error}</div>}
        {saved && (
          <div role="status" data-testid="snapshot-saved" className={`mt-3 rounded-md border px-3 py-2 text-sm ${saved.flags?.length ? 'bg-red-50 border-red-300 text-red-900' : 'bg-emerald-50 border-emerald-300 text-emerald-900'}`}>
            <div className="font-bold flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Saved: {saved.contracts} contracts, {$(saved.totalValue)} for {longDate(saved.date)} ({saved.source}).</div>
            {saved.history?.length ? <div className="text-xs">Replaced the earlier snapshot for that date (kept on record).</div> : null}
            {saved.flags?.length ? (
              <div className="mt-1"><div className="font-bold">Sanity check — please check against FolloSoft:</div><ul className="list-disc ml-5">{saved.flags.map(f => <li key={f}>{f}</li>)}</ul></div>
            ) : <div className="text-xs">Sanity check passed.</div>}
          </div>
        )}
      </form>
    </div>
  );
}

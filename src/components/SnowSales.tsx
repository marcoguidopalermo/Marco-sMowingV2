// SNOW SALES — the top of the SalesMaster scoreboard. Residential snow season
// totals from the FolloSoft snapshots, against the goal (650 by Jan 1 unless
// an admin changes it). The snapshot details and the entry form sit in a
// popup behind the small camera button; the direct link
// /#salesmaster/follosoft-snapshot opens that popup on the form (the 7:30
// browser agent uses it — see ~/Downloads/follosoft-agent-instructions.txt).
import { useEffect, useState } from 'react';
import { Snowflake, Camera, Clock, AlertTriangle, Pencil } from 'lucide-react';
import Popup from './Popup';
import SnowSnapshotPanel from './SnowSnapshotPanel';
import {
  residentialFigures, latestSnapshot, staleness, changeLine, goalProgress,
  type SnowSnapshot, type SnapshotInput, type SnowGoal,
} from '../lib/sales/snapshots';
import type { SnowEntry } from '../lib/sales/metrics';
import { snowSeasonLabel } from '../lib/sales/periods';

const $ = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`;
const $2 = (n: number) => `$${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const md = (ymd: string) => `${MON[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}`;
const longDate = (ymd: string) => `${md(ymd)}, ${ymd.slice(0, 4)}`;
const when = (ms: number) => new Date(ms).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const SNAPSHOT_ANCHOR = 'follosoft-snapshot';

export default function SnowSales(p: {
  snapshots: SnowSnapshot[]; entries: SnowEntry[]; season: string; today: string; who: string;
  goal: SnowGoal; canEditGoal: boolean; onSaveGoal: (g: SnowGoal) => Promise<boolean>;
  onSaveSnapshot: (s: SnapshotInput) => Promise<SnowSnapshot | null>;
  now?: number; startOpen?: 'snapshot' | 'goal';
}) {
  const [open, setOpen] = useState<null | 'snapshot' | 'goal'>(p.startOpen || null);
  // The direct link opens the snapshot popup (on load, or when the link is followed in an open tab).
  useEffect(() => {
    const check = () => { if (window.location.hash.includes(SNAPSHOT_ANCHOR)) setOpen('snapshot'); };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);
  const close = () => {
    setOpen(null);
    if (window.location.hash.includes(SNAPSHOT_ANCHOR)) window.history.replaceState(null, '', '#salesmaster');
  };

  const fig = residentialFigures(p.snapshots, p.entries, null, p.season);
  const latest = latestSnapshot(p.snapshots, p.season);
  const stale = staleness(latest, p.now ?? Date.now());
  const change = latest ? changeLine(latest, p.snapshots) : null;
  const g = goalProgress(fig.contracts, p.goal, p.today);

  return (
    <section className="rounded-2xl bg-sky-700 p-3 text-white" data-testid="snapshot-latest" aria-label="Snow sales">
      <div className="flex items-center gap-2">
        <Snowflake className="w-5 h-5" />
        <h2 className="flex-1 text-lg font-black">Snow sales <span className="text-sm font-bold text-sky-100">· {snowSeasonLabel(p.season)}</span></h2>
        <button type="button" onClick={() => setOpen('snapshot')} aria-label="FolloSoft snapshot" title="FolloSoft snapshot — details and entry"
          className="inline-flex items-center gap-1 rounded-lg bg-white/15 hover:bg-white/25 px-2 py-1.5 text-xs font-bold">
          <Camera className="w-4 h-4" /><span className="hidden sm:inline">Snapshot</span>
        </button>
      </div>
      {(stale.stale || !!latest?.flags?.length) && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {stale.stale && <span role="alert" className="inline-flex items-center gap-1 rounded-full bg-amber-300 text-amber-950 px-2 py-0.5 text-[11px] font-bold"><Clock className="w-3 h-3" /> {stale.hours} h old — today's snapshot not entered</span>}
          {!!latest?.flags?.length && <button type="button" onClick={() => setOpen('snapshot')} className="inline-flex items-center gap-1 rounded-full bg-red-200 text-red-900 px-2 py-0.5 text-[11px] font-bold"><AlertTriangle className="w-3 h-3" /> Latest snapshot flagged — check</button>}
        </div>
      )}

      <div className="mt-2 rounded-xl bg-white text-slate-800 p-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">Total contracts</div>
            <div className="leading-none mt-1"><span className="text-5xl font-black text-sky-800">{fig.contracts.toLocaleString('en-CA')}</span> <span className="text-lg font-bold text-slate-500">of {p.goal.contracts.toLocaleString('en-CA')}</span></div>
          </div>
          {p.canEditGoal && <button type="button" onClick={() => setOpen('goal')} aria-label="Change the goal" title="Change the goal" className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil className="w-4 h-4" /></button>}
        </div>
        <div className="mt-2 h-3 rounded-full bg-slate-200 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={p.goal.contracts} aria-valuenow={fig.contracts}>
          <div className="h-full rounded-full bg-sky-600" style={{ width: `${Math.round(g.pct * 100)}%` }} />
        </div>
        <div className="mt-1 text-sm font-bold text-slate-700">{fig.contracts.toLocaleString('en-CA')} of {p.goal.contracts.toLocaleString('en-CA')} · goal by {md(p.goal.by)}</div>
        <div className="text-xs text-slate-600">
          {g.met ? 'Goal reached.' : g.passed ? `${g.needed} short — the goal date has passed.` : `${g.needed} still needed · about ${g.perWeek} a week (${g.weeksLeft} week${g.weeksLeft === 1 ? '' : 's'} left)`}
          {change ? <span className="text-slate-500"> · {change}</span> : null}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-white text-slate-800 p-3">
          <div className="text-xs font-black uppercase tracking-wide text-slate-500">Average ticket</div>
          <div className="text-2xl font-black">{fig.avgTicket != null ? $2(fig.avgTicket) : '—'}</div>
        </div>
        <div className="rounded-xl bg-white text-slate-800 p-3">
          <div className="text-xs font-black uppercase tracking-wide text-slate-500">Total value</div>
          <div className="text-2xl font-black">{$(fig.dollars)}</div>
        </div>
      </div>
      {!latest && <div className="mt-1.5 text-xs text-sky-100">No FolloSoft snapshot yet — tap the camera to enter one.</div>}

      {open === 'snapshot' && (
        <Popup title="FolloSoft snapshot" onClose={close}>
          {latest && (
            <div className="mb-3 text-sm text-slate-700">
              <div>Latest: <b>{latest.contracts}</b> contracts, <b>{$(latest.totalValue)}</b> · {longDate(latest.date)}</div>
              <div className="text-xs text-slate-500">Entered by {latest.enteredBy} ({latest.source === 'agent' ? 'agent' : 'manual'}) · saved {when(latest.savedAt)}{change ? ` · ${change}` : ''}</div>
              {!!latest.flags?.length && (
                <div className="mt-1.5 rounded-md bg-red-50 border border-red-200 px-2 py-1 text-sm text-red-800">
                  <div className="font-bold flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Check this snapshot against FolloSoft:</div>
                  <ul className="list-disc ml-5">{latest.flags.map(f => <li key={f}>{f}</li>)}</ul>
                </div>
              )}
            </div>
          )}
          <SnowSnapshotPanel snapshots={p.snapshots} season={p.season} today={p.today} who={p.who} onSave={p.onSaveSnapshot} />
        </Popup>
      )}
      {open === 'goal' && <GoalEditor goal={p.goal} onSave={p.onSaveGoal} onClose={close} />}
    </section>
  );
}

function GoalEditor({ goal, onSave, onClose }: { goal: SnowGoal; onSave: (g: SnowGoal) => Promise<boolean>; onClose: () => void }) {
  const [n, setN] = useState(String(goal.contracts));
  const [by, setBy] = useState(goal.by);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const c = Number(n.replace(/[^\d]/g, ''));
    if (!(c > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(by)) { setErr('Enter the number of contracts and the date.'); return; }
    if (await onSave({ contracts: c, by })) onClose();
  };
  const input = 'border border-slate-300 rounded-md px-2 py-2 text-base bg-white text-slate-900 w-full';
  return (
    <Popup title="Snow goal" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <label><span className="block text-sm font-bold text-slate-700 mb-0.5">Contracts</span><input inputMode="numeric" className={input} value={n} onChange={e => setN(e.target.value)} /></label>
        <label><span className="block text-sm font-bold text-slate-700 mb-0.5">By</span><input type="date" className={input} value={by} onChange={e => setBy(e.target.value)} /></label>
      </div>
      {err && <div role="alert" className="mt-2 text-sm font-bold text-red-700">{err}</div>}
      <button type="button" onClick={save} className="mt-3 px-5 py-2.5 rounded-md bg-sky-700 text-white text-base font-bold">Save goal</button>
    </Popup>
  );
}

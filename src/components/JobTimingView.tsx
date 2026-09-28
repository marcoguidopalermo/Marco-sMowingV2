import { Fragment, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { Timer, Download, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { db } from '../lib/firebase';
import {
  aggregateProperties, coverageRows, CoverageDoc, divisionAverages, filterRecords, JobTimingRecord,
  MIN_RELIABLE_VISITS, propertiesCsv, PropertyRow, rankProperties, SERVICE_TYPES, serviceTypeOf,
  TimingFilters, visitsCsv,
} from '../lib/jobTiming';

// JOB TIMING — admin-only repricing view over Jobber visit timers.
// Reads the jobTimings root collection (server-written; the database only
// lets admins read it). Separate from pay, bonus and crew-day efficiency.

interface Props { today: string }

const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const fmtHrs = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));
const fmtVs = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`);

function download(name: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

// Per-visit efficiency over the season. Filled dots are fully-timed visits,
// hollow ones estimates; the dashed line is the division average.
function Sparkline({ points, avg }: { points: PropertyRow['trend']; avg: number | null }) {
  if (points.length < 2) return <span className="text-slate-300 text-xs">—</span>;
  const W = 96, H = 26, P = 3;
  const vals = points.map(p => p.eff);
  const max = Math.max(...vals, avg ?? 0) * 1.05, min = Math.min(...vals, avg ?? Infinity) * 0.95;
  const x = (i: number) => P + (i * (W - 2 * P)) / (points.length - 1);
  const y = (v: number) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P);
  return (
    <svg width={W} height={H} className="overflow-visible" aria-label="Efficiency by visit">
      {avg != null && <line x1={P} x2={W - P} y1={y(avg)} y2={y(avg)} className="stroke-slate-300" strokeDasharray="2 2" />}
      <polyline fill="none" className="stroke-emerald-600" strokeWidth={1.5} points={points.map((p, i) => `${x(i)},${y(p.eff)}`).join(' ')} />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.eff)} r={2} className={p.full ? 'fill-emerald-600' : 'fill-white stroke-emerald-600'} />
      ))}
    </svg>
  );
}

function MeasuredBar({ share }: { share: number }) {
  return (
    <div className="flex items-center gap-1.5" title={`${Math.round(share * 100)}% of these labour hours were fully timed; the rest are estimates`}>
      <div className="w-14 h-1.5 rounded-full bg-amber-200 overflow-hidden">
        <div className="h-full bg-emerald-600" style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <span className="text-[11px] text-slate-500 font-mono">{Math.round(share * 100)}%</span>
    </div>
  );
}

export default function JobTimingView({ today }: Props) {
  const [recs, setRecs] = useState<JobTimingRecord[] | null>(null);
  const [coverage, setCoverage] = useState<CoverageDoc | null>(null);
  const [lastRun, setLastRun] = useState<{ finishedAt: number; timedVisits: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [filters, setFilters] = useState<TimingFilters>({
    from: `${today.slice(0, 4)}-04-01`, to: today, division: '', crewKey: '', serviceType: '',
    lush: 'all', includeNoCrew: false,
  });
  const [dir, setDir] = useState<'under' | 'over'>('under');
  const [showUnreliable, setShowUnreliable] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const set = <K extends keyof TimingFilters>(k: K, v: TimingFilters[K]) => setFilters(f => ({ ...f, [k]: v }));

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const [snap, cov, runs] = await Promise.all([
        getDocs(collection(db, 'jobTimings')),
        getDoc(doc(db, 'jobTimingMeta', 'coverage')),
        getDocs(query(collection(db, 'jobTimingRuns'), orderBy('finishedAt', 'desc'), limit(1))),
      ]);
      setRecs(snap.docs.map(d => d.data() as JobTimingRecord));
      setCoverage(cov.exists() ? (cov.data() as CoverageDoc) : null);
      const r = runs.docs[0]?.data();
      setLastRun(r ? { finishedAt: r.finishedAt, timedVisits: r.timedVisits } : null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const all = recs || [];
  const divisions = useMemo(() => [...new Set(all.map(r => r.division).filter(Boolean))].sort(), [all]);
  const crews = useMemo(() => {
    const m = new Map<string, { label: string; division: string }>();
    for (const r of all) for (const d of Object.values(r.days)) d.crewKeys.forEach((k, i) => {
      if (!m.has(k)) m.set(k, { label: d.crewLabel.split(' + ')[i] || k, division: d.division });
    });
    return [...m.entries()].filter(([, c]) => !filters.division || c.division === filters.division)
      .sort((a, b) => a[1].label.localeCompare(b[1].label, undefined, { numeric: true }));
  }, [all, filters.division]);

  const filtered = useMemo(() => filterRecords(all, filters), [all, filters]);
  // Division averages come from the same filtered set, so "vs average" always
  // compares like with like (same dates, service types, crews).
  const divAvg = useMemo(() => divisionAverages(filtered), [filtered]);
  const props = useMemo(() => aggregateProperties(filtered, divAvg), [filtered, divAvg]);
  const ranked = useMemo(() => rankProperties(props.filter(p => p.reliable), dir), [props, dir]);
  const unreliable = useMemo(() => props.filter(p => !p.reliable).sort((a, b) => b.visits - a.visits), [props]);
  const cov = useMemo(() => coverageRows(coverage, filters), [coverage, filters]);

  const totals = useMemo(() => {
    const labour = filtered.reduce((a, r) => a + r.labourHours, 0);
    const measured = filtered.filter(r => r.quality === 'full').reduce((a, r) => a + r.labourHours, 0);
    return {
      visits: filtered.length,
      full: filtered.filter(r => r.quality === 'full').length,
      measuredShare: labour ? measured / labour : 0,
      properties: props.length,
      reliable: ranked.length,
    };
  }, [filtered, props, ranked]);

  const th = 'py-2 px-2 text-[10px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap';
  const sel = 'border border-slate-200 rounded-md px-2 py-1 text-sm bg-white';

  const renderRow = (p: PropertyRow, rank: number | null) => (
    <Fragment key={p.propertyId}>
      <tr className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(o => ({ ...o, [p.propertyId]: !o[p.propertyId] }))}>
        <td className="py-2 pl-3 pr-2 text-slate-400 font-mono text-xs">{rank ?? ''}</td>
        <td className="py-2 px-2">
          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
            {open[p.propertyId] ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
            <span className="truncate max-w-[18rem]">{p.label}</span>
            {p.lush && <span className="text-[10px] font-bold uppercase bg-lime-100 text-lime-800 rounded px-1">Lush</span>}
            {!p.reliable && <span className="text-[10px] font-bold uppercase bg-slate-100 text-slate-500 rounded px-1">Not yet reliable</span>}
          </div>
          <div className="text-[11px] text-slate-400 pl-5">{p.division} · {p.crews.join(', ') || 'no crew'} · {p.serviceTypes.join(', ')}</div>
        </td>
        <td className="py-2 px-2 text-right font-mono">{p.visits}<span className="text-slate-400 text-[11px]"> ({p.fullVisits} full)</span></td>
        <td className="py-2 px-2 text-right font-mono">{fmtHrs(p.avgLabour)}</td>
        <td className="py-2 px-2 text-right font-mono">{fmtHrs(p.avgBh)}</td>
        <td className="py-2 px-2 text-right font-mono font-bold text-slate-800">{fmtPct(p.efficiency)}</td>
        <td className={`py-2 px-2 text-right font-mono font-bold ${p.vsDivision == null ? 'text-slate-400' : p.vsDivision < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{fmtVs(p.vsDivision)}</td>
        <td className="py-2 px-2 text-right font-mono text-slate-500">{p.fullBhVisits > 0 ? fmtPct(p.fullEfficiency) : '—'}</td>
        <td className="py-2 px-2"><MeasuredBar share={p.measuredShare} /></td>
        <td className="py-2 px-2"><Sparkline points={p.trend} avg={p.divisionAvg} /></td>
        <td className={`py-2 pr-3 pl-2 text-right font-mono text-xs ${p.trendDelta == null ? 'text-slate-300' : p.trendDelta < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
          {p.trendDelta == null ? '—' : `${p.trendDelta >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(p.trendDelta * 100))}`}
        </td>
      </tr>
      {open[p.propertyId] && (
        <tr className="bg-slate-50/70">
          <td />
          <td colSpan={10} className="pb-3 pr-3">
            <table className="w-full text-xs">
              <thead><tr className="text-slate-400 text-left">
                <th className="py-1 font-bold">Date</th><th className="font-bold">Visit</th><th className="font-bold">Crew</th>
                <th className="font-bold">Method</th><th className="font-bold text-right">Labour</th><th className="font-bold text-right">BH</th>
                <th className="font-bold text-right">Eff.</th><th className="font-bold pl-3">Timed by</th>
              </tr></thead>
              <tbody>
                {p.records.map(r => (
                  <tr key={r.visitId} className="border-t border-slate-200/70">
                    <td className="py-1 font-mono whitespace-nowrap">{r.date}</td>
                    <td className="truncate max-w-[16rem]" title={r.title}>{r.title} <span className="text-slate-400">· {serviceTypeOf(r)}</span></td>
                    <td className="whitespace-nowrap">{r.crewLabel || <span className="text-slate-400">no crew</span>}</td>
                    <td className="whitespace-nowrap">
                      <span className={`rounded px-1 font-bold ${r.quality === 'full' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{r.method}</span>
                    </td>
                    <td className="text-right font-mono">{fmtHrs(r.labourHours)}</td>
                    <td className="text-right font-mono">{r.bh ?? (r.hourly ? 'hourly' : '—')}</td>
                    <td className="text-right font-mono">{fmtPct(r.efficiency)}</td>
                    <td className="pl-3 text-slate-500">{Object.values(r.days).flatMap(d => d.people.map(x => `${x.name} ${x.hours.toFixed(2)}h${x.onCrew ? '' : ' (off crew)'}`)).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </Fragment>
  );

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6 pb-20">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Timer className="w-5 h-5 text-emerald-600" />
            <h2 className="text-lg font-bold text-slate-800">Job Timing — per property</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-sm font-bold text-slate-600 border border-slate-200 rounded-md px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Reload
            </button>
            <button onClick={() => download(`job-timing-properties-${filters.from}-to-${filters.to}.csv`, propertiesCsv([...ranked, ...unreliable]))} disabled={!recs} className="flex items-center gap-1.5 text-sm font-bold text-white bg-emerald-600 rounded-md px-3 py-1.5 hover:bg-emerald-700 disabled:opacity-50">
              <Download className="w-4 h-4" /> Properties CSV
            </button>
            <button onClick={() => download(`job-timing-visits-${filters.from}-to-${filters.to}.csv`, visitsCsv(filtered))} disabled={!recs} className="flex items-center gap-1.5 text-sm font-bold text-emerald-700 border border-emerald-200 rounded-md px-3 py-1.5 hover:bg-emerald-50 disabled:opacity-50">
              <Download className="w-4 h-4" /> Visits CSV
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Labour hours from Jobber visit timers. <b>Efficiency = BH ÷ labour hours.</b> <span className="text-emerald-700 font-semibold">All timed</span> is measured;
          <span className="text-amber-700 font-semibold"> 1 × N</span> and <span className="text-amber-700 font-semibold">span × N</span> are estimates from part of the crew.
          Repricing data only — not used for pay, bonus or crew-day efficiency.
          {lastRun && <> Nightly re-read: {new Date(lastRun.finishedAt).toLocaleString()}.</>}
        </p>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <input type="date" className={sel} value={filters.from} onChange={e => set('from', e.target.value)} />
          <span className="text-slate-400 text-sm">to</span>
          <input type="date" className={sel} value={filters.to} onChange={e => set('to', e.target.value)} />
          <select className={sel} value={filters.division} onChange={e => setFilters(f => ({ ...f, division: e.target.value, crewKey: '' }))}>
            <option value="">All divisions</option>
            {divisions.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className={sel} value={filters.crewKey} onChange={e => set('crewKey', e.target.value)}>
            <option value="">All crews</option>
            {crews.map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
          </select>
          <select className={sel} value={filters.serviceType} onChange={e => set('serviceType', e.target.value)}>
            <option value="">All services</option>
            {SERVICE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className={sel} value={filters.lush} onChange={e => set('lush', e.target.value as TimingFilters['lush'])}>
            <option value="all">Lush + others</option>
            <option value="only">Lush accounts only</option>
            <option value="exclude">Exclude Lush</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={filters.includeNoCrew} onChange={e => set('includeNoCrew', e.target.checked)} />
            Include visits with no crew on the schedule
          </label>
        </div>
      </div>

      {err && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">Couldn't load job timing: {err}</div>}
      {!recs && !err && <div className="text-sm text-slate-500">Loading…</div>}

      {recs && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ['Timed visits', String(totals.visits)],
              ['Fully timed', `${totals.full} (${totals.visits ? Math.round((totals.full / totals.visits) * 100) : 0}%)`],
              ['Hours measured', `${Math.round(totals.measuredShare * 100)}%`],
              ['Properties', String(totals.properties)],
              [`Ranked (≥${MIN_RELIABLE_VISITS} visits)`, String(totals.reliable)],
            ].map(([k, v]) => (
              <div key={k} className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{k}</div>
                <div className="text-xl font-black text-slate-800 mt-0.5">{v}</div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 flex flex-wrap gap-4 text-sm">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 self-center">Division average efficiency</span>
            {Object.entries(divAvg).sort().map(([d, v]) => (
              <span key={d} className="text-slate-600">{d}: <b className="font-mono text-slate-800">{fmtPct(v)}</b></span>
            ))}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
              <div className="font-bold text-slate-700 text-sm">Properties vs division average</div>
              <div className="flex items-center gap-3">
                <div className="flex bg-slate-100 rounded-md p-0.5 text-xs font-bold">
                  <button onClick={() => setDir('under')} className={`px-2.5 py-1 rounded ${dir === 'under' ? 'bg-white shadow-sm text-red-700' : 'text-slate-500'}`}>Most under-budgeted</button>
                  <button onClick={() => setDir('over')} className={`px-2.5 py-1 rounded ${dir === 'over' ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-500'}`}>Most over-budgeted</button>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={showUnreliable} onChange={e => setShowUnreliable(e.target.checked)} />
                  Show {unreliable.length} not-yet-reliable
                </label>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className={`${th} pl-3`}>#</th>
                  <th className={th}>Property</th>
                  <th className={`${th} text-right`}>Visits</th>
                  <th className={`${th} text-right`}>Avg labour h</th>
                  <th className={`${th} text-right`}>Avg BH</th>
                  <th className={`${th} text-right`}>Efficiency</th>
                  <th className={`${th} text-right`}>Vs division</th>
                  <th className={`${th} text-right`} title="Efficiency over fully-timed visits only">Full-only eff.</th>
                  <th className={th} title="Share of labour hours that were measured rather than estimated">Measured</th>
                  <th className={th}>Season</th>
                  <th className={`${th} pr-3 text-right`} title="Later-half minus earlier-half efficiency, in points">Trend</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((p, i) => renderRow(p, i + 1))}
                {ranked.length === 0 && (
                  <tr><td colSpan={11} className="py-6 text-center text-sm text-slate-400">No property has {MIN_RELIABLE_VISITS}+ timed visits with a BH in this filter yet.</td></tr>
                )}
                {showUnreliable && unreliable.length > 0 && (
                  <tr><td colSpan={11} className="pt-4 pb-1 pl-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Not yet reliable — fewer than {MIN_RELIABLE_VISITS} timed visits with a BH</td></tr>
                )}
                {showUnreliable && unreliable.map(p => renderRow(p, null))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
            <div className="px-4 py-3 border-b border-slate-100 font-bold text-slate-700 text-sm">
              Timer coverage by crew
              <span className="ml-2 text-xs font-normal text-slate-400">completed Jobber visits that had a timer run on them{coverage ? ` · as of ${new Date(coverage.computedAt).toLocaleDateString()}` : ''}</span>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 text-left">
                <th className={`${th} pl-3`}>Crew</th><th className={`${th} text-right`}>Visits</th><th className={`${th} text-right`}>Timed</th><th className={`${th} pr-3`}>Coverage</th>
              </tr></thead>
              <tbody>
                {cov.map(c => (
                  <tr key={c.crewKey} className="border-t border-slate-100">
                    <td className="py-2 pl-3 font-semibold text-slate-700">{c.label}</td>
                    <td className="py-2 px-2 text-right font-mono">{c.visits}</td>
                    <td className="py-2 px-2 text-right font-mono">{c.timed}</td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="w-40 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className={`h-full ${c.pct >= 0.6 ? 'bg-emerald-600' : c.pct >= 0.25 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.round(c.pct * 100)}%` }} />
                        </div>
                        <span className="font-mono text-xs font-bold text-slate-700">{Math.round(c.pct * 100)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {cov.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-sm text-slate-400">No coverage figures yet — they're computed by the nightly pass.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

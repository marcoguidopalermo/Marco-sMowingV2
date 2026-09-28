import { Fragment, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { Timer, Download, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, SlidersHorizontal } from 'lucide-react';
import { db } from '../lib/firebase';
import {
  aggregateJobs, coverageRows, CoverageDoc, DATE_PRESETS, DatePreset, divisionStats, filterRecords, JobRow,
  JobTimingRecord, jobsCsv, MIN_RELIABLE_VISITS, presetRange, rankJobs, SERVICE_TYPES, serviceTypeOf,
  TimingFilters, visitsCsv,
} from '../lib/jobTiming';

// JOB TIMING — admin-only repricing view over Jobber visit timers.
// Reads the jobTimings root collection (server-written; the database only
// lets admins read it). Separate from pay, bonus and crew-day efficiency.
//
// One row per Jobber JOB: a weekly mowing job and a one-off cleanup at the
// same property are different work and are never averaged together.

interface Props { today: string }

const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const fmtHrs = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));
const fmtVs = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`);

// Street always; the city only when there's room, so a phone shows the part
// that identifies the property.
function addrLine(address: string) {
  if (!address) return '—';
  const i = address.lastIndexOf(', ');
  if (i < 0) return address;
  return <>{address.slice(0, i)}<span className="hidden sm:inline">{address.slice(i)}</span></>;
}

function download(name: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

// Per-visit efficiency over the range. Filled dots are fully-timed visits,
// hollow ones estimates; the dashed line is the division median.
function Sparkline({ points, line: refLine }: { points: JobRow['trend']; line: number | null }) {
  if (points.length < 2) return <span className="text-slate-300 text-xs">—</span>;
  const W = 88, H = 26, P = 3;
  const vals = points.map(p => p.eff);
  const max = Math.max(...vals, refLine ?? 0) * 1.05, min = Math.min(...vals, refLine ?? Infinity) * 0.95;
  const x = (i: number) => P + (i * (W - 2 * P)) / (points.length - 1);
  const y = (v: number) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P);
  return (
    <svg width={W} height={H} className="overflow-visible" aria-label="Efficiency by visit">
      {refLine != null && <line x1={P} x2={W - P} y1={y(refLine)} y2={y(refLine)} className="stroke-slate-300" strokeDasharray="2 2" />}
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
      <div className="w-12 h-1.5 rounded-full bg-amber-200 overflow-hidden">
        <div className="h-full bg-emerald-600" style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <span className="text-[11px] text-slate-500 font-mono">{Math.round(share * 100)}%</span>
    </div>
  );
}

export default function JobTimingView({ today }: Props) {
  const [recs, setRecs] = useState<JobTimingRecord[] | null>(null);
  const [coverage, setCoverage] = useState<CoverageDoc | null>(null);
  const [lastRun, setLastRun] = useState<{ finishedAt: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [preset, setPreset] = useState<DatePreset>('8w');
  const [filters, setFilters] = useState<TimingFilters>({
    ...presetRange('8w', today), division: '', crewKey: '', serviceType: '', lush: 'all', includeNoCrew: false,
  });
  const [dir, setDir] = useState<'under' | 'over'>('under');
  const [rankBy, setRankBy] = useState<'median' | 'average'>('median');
  const [groupByProperty, setGroupByProperty] = useState(false);
  const [showUnreliable, setShowUnreliable] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const set = <K extends keyof TimingFilters>(k: K, v: TimingFilters[K]) => setFilters(f => ({ ...f, [k]: v }));
  const pickPreset = (p: DatePreset) => {
    setPreset(p);
    if (p !== 'custom') setFilters(f => ({ ...f, ...presetRange(p, today) }));
  };
  const setDate = (k: 'from' | 'to', v: string) => { setPreset('custom'); set(k, v); };
  const resetFilters = () => {
    setPreset('8w');
    setFilters({ ...presetRange('8w', today), division: '', crewKey: '', serviceType: '', lush: 'all', includeNoCrew: false });
  };

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
      setLastRun(r ? { finishedAt: r.finishedAt } : null);
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
  // Division figures come from the same filtered set, so "vs division" always
  // compares like with like (same dates, service types, crews).
  const div = useMemo(() => divisionStats(filtered), [filtered]);
  const jobs = useMemo(() => aggregateJobs(filtered, div), [filtered, div]);
  const ranked = useMemo(() => rankJobs(jobs.filter(p => p.reliable), dir, rankBy), [jobs, dir, rankBy]);
  const unreliable = useMemo(() => jobs.filter(p => !p.reliable).sort((a, b) => b.visits - a.visits), [jobs]);
  const cov = useMemo(() => coverageRows(coverage, filters), [coverage, filters]);

  // By-property grouping: properties ordered by their worst (or best) ranked
  // job, each job still its own row.
  const propertyGroups = useMemo(() => {
    const list = showUnreliable ? [...ranked, ...unreliable] : ranked;
    const groups = new Map<string, JobRow[]>();
    for (const j of list) {
      const g = groups.get(j.propertyId) || [];
      g.push(j);
      groups.set(j.propertyId, g);
    }
    return [...groups.values()];
  }, [ranked, unreliable, showUnreliable]);

  const totals = useMemo(() => {
    const labour = filtered.reduce((a, r) => a + r.labourHours, 0);
    const measured = filtered.filter(r => r.quality === 'full').reduce((a, r) => a + r.labourHours, 0);
    return {
      visits: filtered.length,
      full: filtered.filter(r => r.quality === 'full').length,
      measuredShare: labour ? measured / labour : 0,
      jobs: jobs.length,
      reliable: ranked.length,
      skewed: ranked.filter(r => r.skewed).length,
    };
  }, [filtered, jobs, ranked]);

  const activeFilters = [filters.division, filters.crewKey, filters.serviceType, filters.lush !== 'all' ? 'l' : '', filters.includeNoCrew ? 'n' : '', preset !== '8w' ? 'd' : ''].filter(Boolean).length;

  const th = 'py-2 px-2 text-[10px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap';
  const sel = 'border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white min-w-0';
  const lbl = 'text-[10px] font-black uppercase tracking-widest text-slate-500';
  // First column stays pinned while the numbers scroll sideways on a phone.
  const stick = 'sticky left-0 z-[1] bg-inherit';

  const jobCell = (j: JobRow, showClient: boolean, rank: number | null) => (
    <td className={`${stick} py-2 pl-2 pr-2 align-top`}>
      <div className="flex items-start gap-1.5 w-[12.5rem] sm:w-[19rem]">
        <span className="text-slate-400 font-mono text-[11px] w-5 shrink-0 pt-0.5 text-right">{rank ?? ''}</span>
        {open[j.jobKey] ? <ChevronDown className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" />}
        <div className="min-w-0 flex-1">
          {showClient && (
            <>
              <div className="font-semibold text-slate-800 truncate" title={j.clientName}>{j.clientName}</div>
              <div className="text-xs text-slate-600 truncate" title={j.address}>{addrLine(j.address)}</div>
            </>
          )}
          <div className="text-[11px] text-slate-500 truncate" title={`Job #${j.jobNumber ?? '—'} · ${j.jobTitle}`}>
            <span className="font-mono">#{j.jobNumber ?? '—'}</span> · <span className="text-slate-700 font-medium">{j.jobTitle}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            <span className="text-[10px] text-slate-400">{j.serviceType} · {j.crews.join(', ') || 'no crew'}</span>
            {j.lush && <span className="text-[10px] font-bold uppercase bg-lime-100 text-lime-800 rounded px-1">Lush</span>}
            {!j.reliable && <span className="text-[10px] font-bold uppercase bg-slate-100 text-slate-500 rounded px-1">Not yet reliable</span>}
            {j.multiCrewVisits > 0 && (
              <span className="text-[10px] font-bold bg-sky-100 text-sky-800 rounded px-1"
                title={`${j.multiCrewVisits} of ${j.visits} visits were assigned to several crews. Each crew that timed it is compared on its own share of the BH (the performance sync's split); crews that didn't time it are left out.`}>
                Multi-crew · {j.multiCrewNote}
              </span>
            )}
          </div>
        </div>
      </div>
    </td>
  );

  const renderRow = (j: JobRow, rank: number | null, showClient: boolean, zebra: string) => (
    <Fragment key={j.jobKey}>
      <tr className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50 ${zebra}`} onClick={() => setOpen(o => ({ ...o, [j.jobKey]: !o[j.jobKey] }))}>
        {jobCell(j, showClient, rank)}
        <td className={`py-2 px-2 text-right font-mono align-top ${rankBy === 'median' ? 'font-bold text-slate-800' : 'text-slate-500'}`}>{fmtPct(j.medianEfficiency)}</td>
        {(() => { const v = rankBy === 'median' ? j.vsDivision : j.vsDivisionAvg; return (
          <td className={`py-2 px-2 text-right font-mono font-bold align-top ${v == null ? 'text-slate-400' : v < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{fmtVs(v)}</td>
        ); })()}
        <td className="py-2 px-2 text-right font-mono align-top whitespace-nowrap">{j.visits}<div className="text-slate-400 text-[10px]">{j.fullVisits} full</div></td>
        <td className="py-2 px-2 text-right font-mono align-top font-semibold">{fmtHrs(j.medianLabour)}</td>
        <td className="py-2 px-2 text-right font-mono align-top text-slate-500">{fmtHrs(j.avgLabour)}</td>
        <td className="py-2 px-2 text-right font-mono align-top">{fmtHrs(j.avgBh)}</td>
        <td className={`py-2 px-2 text-right font-mono align-top ${rankBy === 'average' ? 'font-bold text-slate-800' : 'text-slate-500'}`}>{fmtPct(j.efficiency)}</td>
        <td className="py-2 px-2 text-center align-top">
          {j.skewed && <span title={j.skewNote} className="inline-flex"><AlertTriangle className="w-4 h-4 text-amber-500" /></span>}
        </td>
        <td className="py-2 px-2 align-top"><MeasuredBar share={j.measuredShare} /></td>
        <td className="py-2 px-2 align-top"><Sparkline points={j.trend} line={j.divisionMedian} /></td>
        <td className={`py-2 pr-3 pl-2 text-right font-mono text-xs align-top ${j.trendDelta == null ? 'text-slate-300' : j.trendDelta < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
          {j.trendDelta == null ? '—' : `${j.trendDelta >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(j.trendDelta * 100))}`}
        </td>
      </tr>
      {open[j.jobKey] && (
        <tr className="bg-slate-50/70">
          <td colSpan={12} className="px-3 pb-3 pt-1">
            <div className="sticky left-3 max-w-[calc(100vw-4rem)] sm:max-w-none">
              <div className="text-sm font-semibold text-slate-800 break-words">{j.clientName}</div>
              <div className="text-xs text-slate-600">{j.address} · Job #{j.jobNumber ?? '—'} · {j.jobTitle}</div>
              {j.skewed && <div className="mt-1 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">{j.skewNote}</div>}
            </div>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-xs min-w-[40rem]">
                <thead><tr className="text-slate-400 text-left">
                  <th className="py-1 font-bold">Date</th><th className="font-bold">Visit</th><th className="font-bold">Crew</th>
                  <th className="font-bold">Method</th><th className="font-bold text-right">Labour</th><th className="font-bold text-right">BH</th>
                  <th className="font-bold text-right">Eff.</th><th className="font-bold pl-3">Timed by</th>
                </tr></thead>
                <tbody>
                  {j.records.map(r => (
                    <Fragment key={r.visitId}>
                    <tr className="border-t border-slate-200/70">
                      <td className="py-1 font-mono whitespace-nowrap">{r.date}</td>
                      <td className="truncate max-w-[14rem]" title={r.title}>{r.title} <span className="text-slate-400">· {serviceTypeOf(r)}</span></td>
                      <td className="whitespace-nowrap">{r.crewLabel || <span className="text-slate-400">no crew</span>}</td>
                      <td className="whitespace-nowrap">
                        {r.multiCrew && <span className="rounded px-1 font-bold bg-sky-100 text-sky-800 mr-1">multi-crew</span>}
                        <span className={`rounded px-1 font-bold ${r.quality === 'full' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{r.method}</span>
                      </td>
                      <td className="text-right font-mono">{fmtHrs(r.labourHours)}</td>
                      <td className="text-right font-mono whitespace-nowrap">
                        {r.bh ?? (r.hourly ? 'hourly' : '—')}
                        {r.multiCrew && r.visitBh != null && <span className="text-slate-400"> of {r.visitBh}</span>}
                      </td>
                      <td className="text-right font-mono">{fmtPct(r.efficiency)}</td>
                      <td className="pl-3 text-slate-500">{Object.values(r.days).flatMap(d => d.people.map(x => `${x.name} ${x.hours.toFixed(2)}h${x.onCrew ? '' : ' (off crew)'}`)).join(', ')}</td>
                    </tr>
                    {Object.values(r.days).filter(d => d.multiCrew).map(d => (
                      <tr key={`${r.visitId}-${d.date}-mc`}>
                        <td />
                        <td colSpan={7} className="pb-1.5 text-[11px] text-slate-500">
                          <span className="font-semibold text-sky-800">Split {d.multiCrew!.splitSource === 'sync' ? '(as credited by the sync)' : '(headcount)'}:</span>{' '}
                          {d.multiCrew!.crews.map(c => c.timed
                            ? `${c.label} ${c.shareBh} BH ÷ ${fmtHrs(c.labourHours)}h (${c.method})`
                            : `${c.label} ${c.shareBh} BH — didn't time, left out`).join(' · ')}
                          {d.multiCrew!.offCrewHours > 0 && ` · ${fmtHrs(d.multiCrew!.offCrewHours)}h by people on none of these crews not counted`}
                        </td>
                      </tr>
                    ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );

  const rankOf = new Map(ranked.map((j, i) => [j.jobKey, i + 1]));

  return (
    <div className="max-w-7xl mx-auto w-full space-y-4 pb-20">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Timer className="w-5 h-5 text-emerald-600" />
            <h2 className="text-lg font-bold text-slate-800">Job Timing — per job</h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-sm font-bold text-slate-600 border border-slate-200 rounded-md px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Reload
            </button>
            <button onClick={() => download(`job-timing-jobs-${filters.from}-to-${filters.to}.csv`, jobsCsv([...ranked, ...unreliable]))} disabled={!recs} className="flex items-center gap-1.5 text-sm font-bold text-white bg-emerald-600 rounded-md px-3 py-1.5 hover:bg-emerald-700 disabled:opacity-50">
              <Download className="w-4 h-4" /> Jobs CSV
            </button>
            <button onClick={() => download(`job-timing-visits-${filters.from}-to-${filters.to}.csv`, visitsCsv(filtered))} disabled={!recs} className="flex items-center gap-1.5 text-sm font-bold text-emerald-700 border border-emerald-200 rounded-md px-3 py-1.5 hover:bg-emerald-50 disabled:opacity-50">
              <Download className="w-4 h-4" /> Visits CSV
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Labour hours from Jobber visit timers, one row per Jobber job. <b>Efficiency = BH ÷ labour hours</b>; ranked by the <b>median</b> visit so one
          mistimed visit can't move a job. <span className="text-emerald-700 font-semibold">All timed</span> is measured;
          <span className="text-amber-700 font-semibold"> 1 × N</span> and <span className="text-amber-700 font-semibold">span × N</span> are estimates.
          Repricing data only — not used for pay, bonus or crew-day efficiency.
          {lastRun && <> Nightly re-read: {new Date(lastRun.finishedAt).toLocaleString()}.</>}
        </p>
      </div>

      {/* FILTERS — pinned at the top so they're always in reach. */}
      <div className="sticky top-0 z-20 bg-white rounded-xl shadow-md border-2 border-emerald-200 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <SlidersHorizontal className="w-4 h-4 text-emerald-600" /> Filters
            <span className="text-xs font-normal text-slate-500">{filters.from} → {filters.to}{activeFilters > 0 ? ` · ${activeFilters} changed` : ''}</span>
          </div>
          {activeFilters > 0 && <button onClick={resetFilters} className="text-xs font-bold text-emerald-700 hover:underline">Reset</button>}
        </div>
        <div>
          <div className={lbl}>Dates</div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {DATE_PRESETS.map(p => (
              <button key={p.id} onClick={() => pickPreset(p.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-bold border ${preset === p.id ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                {p.label}{p.id === '8w' ? ' (default)' : ''}
              </button>
            ))}
            <span className="flex items-center gap-1">
              <input type="date" className={`${sel} ${preset === 'custom' ? 'border-emerald-500' : ''}`} value={filters.from} onChange={e => setDate('from', e.target.value)} aria-label="From" />
              <span className="text-slate-400 text-xs">to</span>
              <input type="date" className={`${sel} ${preset === 'custom' ? 'border-emerald-500' : ''}`} value={filters.to} onChange={e => setDate('to', e.target.value)} aria-label="To" />
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label className="flex flex-col gap-1 min-w-0"><span className={lbl}>Division</span>
            <select className={sel} value={filters.division} onChange={e => setFilters(f => ({ ...f, division: e.target.value, crewKey: '' }))}>
              <option value="">All divisions</option>
              {divisions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 min-w-0"><span className={lbl}>Crew</span>
            <select className={sel} value={filters.crewKey} onChange={e => set('crewKey', e.target.value)}>
              <option value="">All crews</option>
              {crews.map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 min-w-0"><span className={lbl}>Service</span>
            <select className={sel} value={filters.serviceType} onChange={e => set('serviceType', e.target.value)}>
              <option value="">All services</option>
              {SERVICE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 min-w-0"><span className={lbl}>Lush accounts</span>
            <select className={sel} value={filters.lush} onChange={e => set('lush', e.target.value as TimingFilters['lush'])}>
              <option value="all">Lush + others</option>
              <option value="only">Lush only</option>
              <option value="exclude">Exclude Lush</option>
            </select>
          </label>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={filters.includeNoCrew} onChange={e => set('includeNoCrew', e.target.checked)} />
          Include visits with no crew on the schedule (early May)
        </label>
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
              [`Jobs ranked (≥${MIN_RELIABLE_VISITS} visits)`, `${totals.reliable} of ${totals.jobs}`],
              ['Avg ≠ median flags', String(totals.skewed)],
            ].map(([k, v]) => (
              <div key={k} className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{k}</div>
                <div className="text-xl font-black text-slate-800 mt-0.5">{v}</div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 self-center">Division efficiency (median / avg)</span>
            {Object.entries(div).sort().map(([d, v]) => (
              <span key={d} className="text-slate-600">{d}: <b className="font-mono text-slate-800">{fmtPct(v.median)}</b> <span className="font-mono text-slate-400">/ {fmtPct(v.avg)}</span></span>
            ))}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="px-3 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
              <div className="font-bold text-slate-700 text-sm">Jobs vs division</div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex bg-slate-100 rounded-md p-0.5 text-xs font-bold">
                  <button onClick={() => setGroupByProperty(false)} className={`px-2.5 py-1 rounded ${!groupByProperty ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>Ranked jobs</button>
                  <button onClick={() => setGroupByProperty(true)} className={`px-2.5 py-1 rounded ${groupByProperty ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>By property</button>
                </div>
                <div className="flex bg-slate-100 rounded-md p-0.5 text-xs font-bold">
                  <button onClick={() => setRankBy('median')} className={`px-2.5 py-1 rounded ${rankBy === 'median' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>Rank by median</button>
                  <button onClick={() => setRankBy('average')} className={`px-2.5 py-1 rounded ${rankBy === 'average' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>by average</button>
                </div>
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm bg-white">
                <thead>
                  <tr className="border-b border-slate-100 text-left bg-white">
                    <th className={`${th} ${stick} pl-3`}>Client · address · job</th>
                    <th className={`${th} text-right`} title="Median per-visit efficiency">Med. eff.</th>
                    <th className={`${th} text-right`}>Vs division</th>
                    <th className={`${th} text-right`}>Visits</th>
                    <th className={`${th} text-right`} title="Median labour hours per visit">Med. labour h</th>
                    <th className={`${th} text-right`}>Avg labour h</th>
                    <th className={`${th} text-right`}>Avg BH</th>
                    <th className={`${th} text-right`} title="Σ BH ÷ Σ labour hours">Avg eff.</th>
                    <th className={th} title="Average and median disagree — usually a timing problem, not a pricing one"><AlertTriangle className="w-3.5 h-3.5 inline" /></th>
                    <th className={th} title="Share of labour hours that were measured rather than estimated">Measured</th>
                    <th className={th}>Visits over time</th>
                    <th className={`${th} pr-3 text-right`} title="Later-half minus earlier-half median efficiency, in points">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {!groupByProperty && (
                    <>
                      {ranked.map((j, i) => renderRow(j, i + 1, true, 'bg-white'))}
                      {showUnreliable && unreliable.length > 0 && (
                        <tr><td colSpan={12} className="pt-4 pb-1 pl-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Not yet reliable — fewer than {MIN_RELIABLE_VISITS} timed visits with a BH</td></tr>
                      )}
                      {showUnreliable && unreliable.map(j => renderRow(j, null, true, 'bg-white'))}
                    </>
                  )}
                  {groupByProperty && propertyGroups.map(g => (
                    <Fragment key={g[0].propertyId}>
                      <tr className="border-t-2 border-slate-200 bg-slate-50">
                        <td colSpan={12} className="py-2 px-3">
                          <div className="sticky left-3 max-w-[calc(100vw-4rem)] sm:max-w-none">
                            <div className="font-semibold text-slate-800 truncate" title={g[0].clientName}>{g[0].clientName}</div>
                            <div className="text-xs text-slate-600">{g[0].address || '—'} · {g.length} job{g.length === 1 ? '' : 's'}</div>
                          </div>
                        </td>
                      </tr>
                      {g.map(j => renderRow(j, rankOf.get(j.jobKey) ?? null, false, 'bg-white'))}
                    </Fragment>
                  ))}
                  {ranked.length === 0 && (
                    <tr><td colSpan={12} className="py-6 text-center text-sm text-slate-400">No job has {MIN_RELIABLE_VISITS}+ timed visits with a BH in this filter yet — try a wider date range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
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
                    <td className="py-2 pl-3 font-semibold text-slate-700 whitespace-nowrap">{c.label}</td>
                    <td className="py-2 px-2 text-right font-mono">{c.visits}</td>
                    <td className="py-2 px-2 text-right font-mono">{c.timed}</td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="w-24 sm:w-40 h-2 rounded-full bg-slate-100 overflow-hidden">
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

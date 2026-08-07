// ── AD-HOC BOOKING LOOKUP ───────────────────────────────────────────────────
// The RAW view. Pick some Jobber assignees and a date range; see the booked
// BH, by week and by day, with the jobs behind it.
//
// Deliberately model-free: no declared capacity, no percentages, no colour
// bands, no attribution. It answers "how much does route #1 actually have
// next week" with nothing in between — which is what makes it the instrument
// for checking Booking and Schedule Balance rather than another view to be
// taken on trust.
//
// Reads the SAME forward snapshots as the other tools. No new pull.
import { useMemo, useState } from 'react';
import { Search, X, Clock, CalendarRange } from 'lucide-react';
import type { CapacityForecast, JobberUser, MultiDayJob, CapacitySettings, HourlyEstimate } from '../types';
import {
  forwardSlices, mergeSlices, mondayOf, buildWeeks, longDate, dayLabel, loadForSlice,
  type ForwardSlice,
} from '../lib/capacity';
import { addDaysToronto } from '../lib/dateUtils';

const bh = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

type Preset = 'this' | 'next' | 'four' | 'custom';

export default function BookingLookup({
  snapshots, multiDayJobs, jobberUsers, settings, today, hourlyEstimates,
}: {
  snapshots: CapacityForecast[];
  multiDayJobs: Record<string, MultiDayJob> | undefined;
  jobberUsers: JobberUser[];
  settings: CapacitySettings | undefined;
  today: string;
  hourlyEstimates?: Record<string, HourlyEstimate>;
}) {
  const slices = useMemo(
    () => forwardSlices(snapshots, multiDayJobs, today),
    [snapshots, multiDayJobs, today],
  );

  // Every assignee the snapshot actually contains, named. The Jobber user
  // list supplies names; the snapshot's own assigneeNames cover anyone the
  // user list hasn't caught up with.
  const assignees = useMemo(() => {
    const nameById = new Map((jobberUsers || []).map(u => [u.id, u.name]));
    const seen = new Map<string, { id: string; label: string; bh: number }>();
    for (const s of slices) {
      s.assigneeIds.forEach((id, i) => {
        const prev = seen.get(id);
        seen.set(id, {
          id,
          label: nameById.get(id) || prev?.label || s.assigneeNames?.[i] || id.slice(0, 12),
          bh: (prev?.bh || 0) + s.bh / Math.max(1, s.assigneeIds.length),
        });
      });
    }
    return [...seen.values()].sort((a, b) => b.bh - a.bh || a.label.localeCompare(b.label));
  }, [slices, jobberUsers]);

  const [picked, setPicked] = useState<string[]>([]);
  const [preset, setPreset] = useState<Preset>('four');
  const thisMonday = mondayOf(today);
  const [from, setFrom] = useState(thisMonday);
  const [to, setTo] = useState(addDaysToronto(thisMonday, 27));

  const range = useMemo(() => {
    if (preset === 'this') return { from: thisMonday, to: addDaysToronto(thisMonday, 6) };
    if (preset === 'next') return { from: addDaysToronto(thisMonday, 7), to: addDaysToronto(thisMonday, 13) };
    if (preset === 'four') return { from: thisMonday, to: addDaysToronto(thisMonday, 27) };
    return { from, to };
  }, [preset, from, to, thisMonday]);

  const toggle = (id: string) =>
    setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  const result = useMemo(() => {
    if (picked.length === 0) return null;
    const inRange = slices.filter(s =>
      s.date >= range.from && s.date <= range.to &&
      s.assigneeIds.some(a => picked.includes(a)));
    // A slice shared between a picked and an unpicked assignee counts only
    // its picked share — the same split the other views apply.
    const byDay = new Map<string, number>();
    const byWeek = new Map<string, number>();
    let total = 0;
    let estimated = 0;
    for (const s of inRange) {
      const share = s.assigneeIds.filter(a => picked.includes(a)).length / Math.max(1, s.assigneeIds.length);
      // Hourly work carries no tag; show its estimate here too so this
      // reconciles with Booking rather than quietly disagreeing.
      const load = loadForSlice(s, hourlyEstimates, settings);
      const amount = (load.estimated ? load.bh : s.bh) * share;
      total += amount;
      if (load.estimated) estimated += amount;
      byDay.set(s.date, (byDay.get(s.date) || 0) + amount);
      const wk = mondayOf(s.date);
      byWeek.set(wk, (byWeek.get(wk) || 0) + amount);
    }
    const weeks = buildWeeks(range.from, 26)
      .filter(w => w.start <= range.to)
      .map(w => ({ week: w, bh: byWeek.get(w.start) || 0 }))
      .filter(w => w.bh > 0 || (w.week.start >= mondayOf(range.from) && w.week.start <= range.to));
    return { inRange, total, estimated, byDay, weeks };
  }, [picked, slices, range, settings, hourlyEstimates]);

  const pickedLabels = assignees.filter(a => picked.includes(a.id)).map(a => a.label);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-slate-700" />
        <h3 className="text-sm font-black text-slate-900">Booking lookup</h3>
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          raw booked BH — no capacity, no model
        </span>
      </div>

      {/* ASSIGNEES */}
      <div>
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
          Jobber assignees {picked.length > 0 && `(${picked.length} selected)`}
        </div>
        {assignees.length === 0 ? (
          <p className="text-xs text-slate-500">No assignees in the current snapshot.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {assignees.map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => toggle(a.id)}
                className={`px-2 py-1 rounded-lg border text-[11px] font-bold ${picked.includes(a.id)
                  ? 'bg-slate-800 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
              >
                {a.label}
                <span className={`ml-1 font-mono ${picked.includes(a.id) ? 'text-white/60' : 'text-slate-400'}`}>
                  {bh(a.bh)}
                </span>
              </button>
            ))}
            {picked.length > 0 && (
              <button type="button" onClick={() => setPicked([])}
                className="px-2 py-1 text-[11px] font-bold text-slate-500 underline">clear</button>
            )}
          </div>
        )}
      </div>

      {/* RANGE */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-slate-100 rounded-lg p-1">
          {([['this', 'This week'], ['next', 'Next week'], ['four', 'Next 4 weeks'], ['custom', 'Custom']] as [Preset, string][]).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setPreset(k)}
              className={`px-2.5 py-1 text-[11px] font-black rounded ${preset === k ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>
              {label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="border border-slate-300 rounded px-1.5 py-1 font-mono" />
            <span className="text-slate-400">→</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="border border-slate-300 rounded px-1.5 py-1 font-mono" />
          </div>
        )}
        <span className="text-[10px] font-bold text-slate-400 inline-flex items-center gap-1">
          <CalendarRange className="w-3 h-3" />
          {longDate(range.from)} → {longDate(range.to)}
        </span>
      </div>

      {picked.length === 0 && (
        <p className="text-xs text-slate-500 border-t border-slate-100 pt-3">
          Pick one or more assignees to see what they actually have booked.
        </p>
      )}

      {result && (
        <div className="border-t border-slate-100 pt-3 space-y-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <div>
              <div className="text-3xl font-black text-slate-900 tabular-nums">{bh(result.total)}</div>
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                BH booked · {mergeSlices(result.inRange).length} jobs
              </div>
            </div>
            <div className="text-[11px] text-slate-500">
              {pickedLabels.join(', ')}
              {result.estimated > 0 && (
                <div className="text-slate-400">
                  includes {bh(result.estimated)} BH estimated from hourly work
                </div>
              )}
            </div>
          </div>

          {/* BY WEEK */}
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">By week</div>
            <div className="flex flex-wrap gap-2">
              {result.weeks.map(({ week, bh: wbh }) => (
                <div key={week.start} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                  <div className="text-[10px] font-bold text-slate-400">{week.rangeLabel}</div>
                  <div className="text-lg font-black text-slate-800 tabular-nums">{bh(wbh)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* BY DAY */}
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">By day</div>
            <div className="flex flex-wrap gap-1">
              {[...result.byDay.entries()].sort().map(([date, dbh]) => (
                <div key={date} className="rounded border border-slate-200 px-1.5 py-1 text-center min-w-[3.4rem]">
                  <div className="text-[9px] font-bold text-slate-400">{dayLabel(date)} {date.slice(8)}</div>
                  <div className="text-xs font-black text-slate-800 tabular-nums">{bh(dbh)}</div>
                </div>
              ))}
              {result.byDay.size === 0 && <span className="text-xs text-slate-400">Nothing booked in this range.</span>}
            </div>
          </div>

          {/* THE JOBS */}
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
              Jobs ({mergeSlices(result.inRange).length})
            </div>
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {mergeSlices(result.inRange).map((j: ForwardSlice) => (
                <div key={j.visitId} className="py-1.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-800 truncate">{j.client || 'No client name'}</div>
                    <div className="text-[11px] text-slate-500 truncate">{j.desc}{j.jobNumber ? ` · #${j.jobNumber}` : ''}</div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] font-bold text-slate-500">
                        {j.multiDay ? `${longDate(j.startDate)} → ${longDate(j.endDate)}` : longDate(j.startDate)}
                      </span>
                      <span className="text-[10px] text-slate-400">{j.assigneeNames.join(', ') || 'no assignee'}</span>
                      {j.isHourly && (
                        <span className="text-[9px] font-black uppercase tracking-widest bg-sky-50 text-sky-700 border border-sky-200 px-1.5 rounded inline-flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" /> hourly
                        </span>
                      )}
                      {j.untagged && (
                        <span className="text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-800 border border-amber-300 px-1.5 rounded">
                          no [BH] tag
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-black text-slate-900 tabular-nums">{bh(j.bh)}</div>
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">BH</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

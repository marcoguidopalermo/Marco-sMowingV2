// AVAILABILITY · MONTH — a month of who is NOT scheduled.
//
// Deliberately the same shape, controls and interaction as BookedOffCalendar,
// in green rather than red: month stepper, division filter, weekday header,
// per-week edge total, name tags from sm up with a tap-through for the full
// list. A manager who has used one has used both.
//
// THE DISTINCTION THAT MAKES IT USEFUL: a day nobody has scheduled yet has
// nobody on a crew, so "who isn't on a crew" would report the whole roster as
// free and every future day would read as fully available. Unbuilt days render
// grey and say "not scheduled yet" instead of a count. Only days with real
// assignments show real numbers.
//
// Month is for the pattern; tapping a day hands off to the daily view, which is
// where the reshuffle decision actually gets made.
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Filter, UserCheck, X, CalendarOff } from 'lucide-react';
import type { AppData } from '../types';
import { DIVISIONS } from '../constants';
import { buildAvailabilityMonth, type AvailabilityMonthDay } from '../lib/availabilityView';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Density → colour, deepening green as more people are free. Mirrors
// BookedOffCalendar's densityCell so the two grids read the same way, with the
// hue carrying the meaning. Static class strings so Tailwind keeps them.
function densityCell(count: number): string {
  if (count <= 0) return 'bg-white border-slate-200';
  if (count <= 2) return 'bg-emerald-50 border-emerald-200';
  if (count <= 4) return 'bg-emerald-100 border-emerald-300';
  if (count <= 6) return 'bg-emerald-200 border-emerald-400';
  return 'bg-emerald-300 border-emerald-500';
}
function densityBadge(count: number): string {
  if (count <= 2) return 'bg-emerald-200 text-emerald-900';
  if (count <= 4) return 'bg-emerald-300 text-emerald-900';
  if (count <= 6) return 'bg-emerald-400 text-white';
  return 'bg-emerald-600 text-white';
}

export default function AvailabilityMonth({
  appData, division, setDivision, onOpenDay, initialMonth,
}: {
  appData: AppData;
  // Division is owned by the parent so switching between Month and Day keeps
  // the filter — a manager who filtered to Lawn does not want it reset.
  division: string;
  setDivision: (d: string) => void;
  onOpenDay: (date: string) => void;
  initialMonth?: Date;
}) {
  const base = initialMonth || new Date();
  const [year, setYear] = useState(base.getFullYear());
  const [month, setMonth] = useState(base.getMonth());
  const [openDate, setOpenDate] = useState<string | null>(null);

  const monthStart = useMemo(() => new Date(year, month, 1), [year, month]);
  const monthEnd = useMemo(() => new Date(year, month + 1, 0), [year, month]);

  const days = useMemo(
    () => buildAvailabilityMonth(appData, ymd(monthStart), ymd(monthEnd), division),
    [appData, monthStart, monthEnd, division],
  );
  const byDate = useMemo(() => {
    const m = new Map<string, AvailabilityMonthDay>();
    for (const d of days) m.set(d.date, d);
    return m;
  }, [days]);

  // Leading blanks for the 1st's weekday, then each day, padded to fill the
  // final week — same matrix as the booked-off grid.
  const weeks = useMemo(() => {
    const cells: (string | null)[] = [];
    for (let i = 0; i < monthStart.getDay(); i++) cells.push(null);
    for (let d = 1; d <= monthEnd.getDate(); d++) cells.push(ymd(new Date(year, month, d)));
    while (cells.length % 7 !== 0) cells.push(null);
    const rows: (string | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [monthStart, monthEnd, year, month]);

  const builtDays = days.filter(d => d.built);
  const unbuiltCount = days.length - builtDays.length;

  const step = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };
  const goToday = () => {
    const d = new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const monthLabel = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const todayStr = ymd(new Date());
  const dayNum = (ds: string) => Number(ds.slice(8, 10));
  // Week edge total counts only BUILT days — summing unbuilt days would make a
  // week of unscheduled days look like a week of idle people.
  const weekTotal = (row: (string | null)[]) =>
    row.reduce((sum, ds) => {
      const d = ds ? byDate.get(ds) : null;
      return sum + (d && d.built ? d.count : 0);
    }, 0);

  const open = openDate ? byDate.get(openDate) : null;

  return (
    <div className="p-3 sm:p-4 pb-24">
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-4 px-3 sm:px-4 py-3 bg-gray-100/95 backdrop-blur border-b border-slate-200 mb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-white border border-slate-300 rounded-lg p-1 shadow-sm">
              <button onClick={() => step(-1)} aria-label="Previous month" className="p-1.5 hover:bg-slate-100 rounded text-slate-600"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={goToday} className="px-3 py-1 text-xs font-bold uppercase tracking-widest hover:bg-slate-100 rounded text-slate-700">Today</button>
              <button onClick={() => step(1)} aria-label="Next month" className="p-1.5 hover:bg-slate-100 rounded text-slate-600"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <div className="text-lg font-black tracking-wide text-slate-800 inline-flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-emerald-600" /> {monthLabel}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-[11px] font-bold text-slate-500">
              <span className="text-emerald-700 font-black">{builtDays.length}</span> day{builtDays.length === 1 ? '' : 's'} scheduled
              {unbuiltCount > 0 && <span className="text-slate-400"> · {unbuiltCount} not yet</span>}
              <span className="text-slate-400"> · crew staff only</span>
            </div>
            <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-lg px-2 py-1.5 shadow-sm">
              <Filter className="w-4 h-4 text-slate-500" />
              <select
                className="text-sm font-bold text-slate-700 bg-transparent outline-none cursor-pointer"
                value={division}
                onChange={e => setDivision(e.target.value)}
                aria-label="Filter by division"
              >
                <option value="All">All Divisions</option>
                {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-7 sm:grid-cols-8 gap-1 sm:gap-1.5 mb-1">
        {WEEKDAYS.map(w => (
          <div key={w} className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-slate-400 text-center py-1">{w}</div>
        ))}
        <div className="hidden sm:block text-[10px] font-black uppercase tracking-widest text-slate-400 text-center py-1">Wk</div>
      </div>

      <div className="space-y-1 sm:space-y-1.5">
        {weeks.map((row, ri) => (
          <div key={ri} className="grid grid-cols-7 sm:grid-cols-8 gap-1 sm:gap-1.5">
            {row.map((dateStr, ci) => {
              if (!dateStr) return <div key={ci} className="min-h-[64px] sm:min-h-[92px] rounded-lg bg-transparent" />;
              const d = byDate.get(dateStr);
              const isToday = dateStr === todayStr;
              // UNBUILT — grey, no count, no names. Says why it's empty rather
              // than implying the whole roster is standing around.
              if (!d || !d.built) {
                return (
                  <div key={ci}
                    className={`min-h-[64px] sm:min-h-[92px] rounded-lg border border-dashed border-slate-300 bg-slate-50 p-1 sm:p-1.5 flex flex-col ${isToday ? 'ring-2 ring-sky-400' : ''}`}
                    title="No crews built for this day yet">
                    <span className="text-[11px] sm:text-xs font-bold text-slate-400">{dayNum(dateStr)}</span>
                    <span className="mt-auto hidden sm:flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">
                      <CalendarOff className="w-2.5 h-2.5 shrink-0" /> not scheduled yet
                    </span>
                    <span className="sm:hidden mt-auto self-start text-[8px] font-black uppercase tracking-wide text-slate-400">—</span>
                  </div>
                );
              }
              const shown = d.unassigned.slice(0, 3);
              const extra = d.count - shown.length;
              return (
                <button
                  key={ci}
                  type="button"
                  onClick={() => setOpenDate(dateStr)}
                  className={`min-h-[64px] sm:min-h-[92px] rounded-lg border text-left p-1 sm:p-1.5 flex flex-col transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-400 ${densityCell(d.count)} ${isToday ? 'ring-2 ring-sky-400' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <span className={`text-[11px] sm:text-xs font-bold ${d.count > 0 ? 'text-emerald-900' : 'text-slate-400'}`}>{dayNum(dateStr)}</span>
                    {d.count > 0 && (
                      <span className={`text-[9px] sm:text-[10px] font-black rounded-full min-w-[16px] h-[16px] px-1 inline-flex items-center justify-center ${densityBadge(d.count)}`}>{d.count}</span>
                    )}
                  </div>
                  {/* Names from sm up; on a phone the badge carries the read and
                      a tap opens the full list. */}
                  <div className="hidden sm:flex flex-col gap-0.5 mt-1 overflow-hidden">
                    {shown.map(p => (
                      <span key={p.id} className="text-[10px] leading-tight font-semibold text-emerald-900 bg-white/70 rounded px-1 py-0.5 truncate">{p.name}</span>
                    ))}
                    {extra > 0 && <span className="text-[9px] font-bold text-emerald-800 px-1">+{extra} more</span>}
                    {d.count === 0 && (
                      <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">all assigned</span>
                    )}
                  </div>
                </button>
              );
            })}
            <div className="hidden sm:flex min-h-[92px] rounded-lg bg-slate-50 border border-slate-200 flex-col items-center justify-center">
              <span className="text-lg font-black text-slate-700">{weekTotal(row)}</span>
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">free</span>
            </div>
          </div>
        ))}
      </div>

      {builtDays.length === 0 && (
        <div className="text-center text-sm text-slate-400 italic py-6">
          No days scheduled this month yet{division !== 'All' ? ` in ${division}` : ''}.
        </div>
      )}

      {/* Day detail — the full list, plus the hand-off to the daily view. */}
      {openDate && open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setOpenDate(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-800">
                {new Date(`${openDate}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </h3>
              <button onClick={() => setOpenDate(null)} aria-label="Close" className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-3 space-y-1.5">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Not on a crew · {open.count}
              </div>
              {open.count === 0 ? (
                <div className="text-sm text-slate-400 italic text-center py-4">Everyone available is on a crew.</div>
              ) : open.unassigned.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border bg-emerald-50 border-emerald-200">
                  <span className="text-sm font-bold text-emerald-900">{p.name}</span>
                  {p.division && <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{p.division}</span>}
                </div>
              ))}
            </div>
            {/* MONTH FOR THE PATTERN, DAY FOR THE DECISION — crew headcounts
                and the lendable flags live on the daily view, so this hands
                over rather than duplicating them. */}
            <div className="p-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => { onOpenDay(openDate); setOpenDate(null); }}
                className="w-full min-h-[44px] rounded-lg bg-emerald-600 px-4 text-sm font-black text-white"
              >
                Open this day
              </button>
              <p className="mt-1.5 text-center text-[10px] font-bold text-slate-400">
                Crew headcounts, who can lend, and who&rsquo;s away
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

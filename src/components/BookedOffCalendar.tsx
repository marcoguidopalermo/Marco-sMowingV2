import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Filter, Plane, X, Clock } from 'lucide-react';
import { Employee, TimeOffRequest } from '../types';
import { DIVISIONS } from '../constants';

// A month grid of APPROVED time off — nothing else. Reads the same
// employee.awayDates ranges that approval + manual Personnel entry write
// into (full-day booked-off), so it needs no new data path. Each day shows
// red name tags; days deepen in red and carry a count badge as more people
// stack up, so a manager can scan a month and spot the thin weeks without
// reading every name. Shared by the schedule board's "Booked off" toggle
// and the time-off approval screen (which passes the pending request under
// review as a distinct overlay tag — see `pendingRequest`).

interface BookedOffCalendarProps {
  employees: Employee[];
  // Initial division filter — a manager's own division by default; 'All'
  // for admin. One of DIVISIONS or 'All'.
  defaultDivision?: string;
  // The pending request being reviewed on the approval screen. Its days
  // render as a distinct amber "pending" tag against the approved red ones
  // so the reviewer sees the coverage impact before deciding. Only full_day
  // requests carry a range worth overlaying on this month grid.
  pendingRequest?: TimeOffRequest | null;
  // Month to open on (Date; day ignored). Defaults to today.
  initialMonth?: Date;
}

// Map an employee's primaryCrew to the schedule-board division name so the
// division filter lines up with the board's own "All Divisions" control.
// Office / Snow / unset carry no division and only appear under "All".
function employeeDivisionName(emp: Employee): string | null {
  switch (emp.primaryCrew) {
    case 'Lawn': return 'Lawn Division';
    case 'Small Project': return 'Small Projects';
    case 'Large Project': return 'Large Projects';
    default: return null;
  }
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Density → colour. Deeper red as more people stack up on a day; the badge
// tracks the same climb. Static class strings so Tailwind keeps them.
function densityCell(count: number): string {
  if (count <= 0) return 'bg-white border-slate-200';
  if (count <= 2) return 'bg-rose-50 border-rose-200';
  if (count <= 4) return 'bg-rose-100 border-rose-300';
  if (count <= 6) return 'bg-rose-200 border-rose-400';
  return 'bg-rose-300 border-rose-500';
}
function densityBadge(count: number): string {
  if (count <= 2) return 'bg-rose-200 text-rose-800';
  if (count <= 4) return 'bg-rose-300 text-rose-900';
  if (count <= 6) return 'bg-rose-400 text-white';
  return 'bg-rose-600 text-white';
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface DayPerson {
  empId: string;
  name: string;
  division: string | null;
  pending?: boolean;
}

export default function BookedOffCalendar({
  employees,
  defaultDivision = 'All',
  pendingRequest = null,
  initialMonth,
}: BookedOffCalendarProps) {
  const base = initialMonth || new Date();
  const [year, setYear] = useState(base.getFullYear());
  const [month, setMonth] = useState(base.getMonth()); // 0-11
  const [division, setDivision] = useState(defaultDivision);
  const [openDate, setOpenDate] = useState<string | null>(null);

  const monthStart = useMemo(() => new Date(year, month, 1), [year, month]);
  const monthEnd = useMemo(() => new Date(year, month + 1, 0), [year, month]);
  const monthStartStr = ymd(monthStart);
  const monthEndStr = ymd(monthEnd);

  // date (YYYY-MM-DD) → people booked off that day, filtered by division.
  const byDate = useMemo(() => {
    const map = new Map<string, DayPerson[]>();
    const push = (date: string, p: DayPerson) => {
      const list = map.get(date);
      if (list) list.push(p); else map.set(date, [p]);
    };

    for (const emp of employees) {
      const div = employeeDivisionName(emp);
      if (division !== 'All' && div !== division) continue;
      for (const range of emp.awayDates || []) {
        if (!range?.start || !range?.end) continue;
        // Clip the range to the visible month, then walk its days.
        const from = range.start < monthStartStr ? monthStartStr : range.start;
        const to = range.end > monthEndStr ? monthEndStr : range.end;
        if (from > to) continue;
        const s = new Date(`${from}T12:00:00`);
        const e = new Date(`${to}T12:00:00`);
        if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) continue;
        for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
          push(ymd(d), { empId: emp.id, name: emp.name, division: div });
        }
      }
    }
    return map;
  }, [employees, division, monthStartStr, monthEndStr]);

  // The request under review, expanded across its days in this month. Held
  // separately so approved (red) and pending (amber) never blur together.
  const pendingByDate = useMemo(() => {
    const map = new Map<string, DayPerson>();
    const r = pendingRequest;
    if (!r || r.type !== 'full_day' || !r.startDate || !r.endDate) return map;
    const emp = employees.find(e => e.id === r.employeeId);
    const div = emp ? employeeDivisionName(emp) : null;
    if (division !== 'All' && div !== division) return map;
    const from = r.startDate < monthStartStr ? monthStartStr : r.startDate;
    const to = r.endDate > monthEndStr ? monthEndStr : r.endDate;
    if (from > to) return map;
    const s = new Date(`${from}T12:00:00`);
    const e = new Date(`${to}T12:00:00`);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return map;
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      map.set(ymd(d), { empId: r.employeeId, name: r.employeeName || 'Requester', division: div, pending: true });
    }
    return map;
  }, [pendingRequest, employees, division, monthStartStr, monthEndStr]);

  // Build the calendar matrix: leading blanks for the 1st's weekday, then
  // each day of the month, padded to complete the final week.
  const weeks = useMemo(() => {
    const cells: (string | null)[] = [];
    const lead = monthStart.getDay(); // 0 = Sun
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let day = 1; day <= monthEnd.getDate(); day++) cells.push(ymd(new Date(year, month, day)));
    while (cells.length % 7 !== 0) cells.push(null);
    const rows: (string | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [monthStart, monthEnd, year, month]);

  const monthTotal = useMemo(() => {
    let n = 0;
    for (const [date, list] of byDate) if (date >= monthStartStr && date <= monthEndStr) n += list.length;
    return n;
  }, [byDate, monthStartStr, monthEndStr]);

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

  const dayNum = (dateStr: string) => Number(dateStr.slice(8, 10));
  const weekTotal = (row: (string | null)[]) =>
    row.reduce((sum, ds) => sum + (ds ? (byDate.get(ds)?.length || 0) : 0), 0);

  const openList = openDate
    ? [...(byDate.get(openDate) || []), ...(pendingByDate.has(openDate) ? [pendingByDate.get(openDate)!] : [])]
    : [];

  return (
    <div className="p-3 sm:p-4 pb-24">
      {/* Controls — month stepper + division filter. Sticks while the weeks
          scroll under it. */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-4 px-3 sm:px-4 py-3 bg-gray-100/95 backdrop-blur border-b border-slate-200 mb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-white border border-slate-300 rounded-lg p-1 shadow-sm">
              <button onClick={() => step(-1)} aria-label="Previous month" className="p-1.5 hover:bg-slate-100 rounded text-slate-600"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={goToday} className="px-3 py-1 text-xs font-bold uppercase tracking-widest hover:bg-slate-100 rounded text-slate-700">Today</button>
              <button onClick={() => step(1)} aria-label="Next month" className="p-1.5 hover:bg-slate-100 rounded text-slate-600"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <div className="text-lg font-black tracking-wide text-slate-800 inline-flex items-center gap-2">
              <Plane className="w-5 h-5 text-rose-600" /> {monthLabel}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-[11px] font-bold text-slate-500">
              <span className="text-rose-700 font-black">{monthTotal}</span> booked-off day{monthTotal === 1 ? '' : 's'}
            </div>
            <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-lg px-2 py-1.5 shadow-sm">
              <Filter className="w-4 h-4 text-slate-500" />
              <select
                className="text-sm font-bold text-slate-700 bg-transparent outline-none cursor-pointer"
                value={division}
                onChange={e => setDivision(e.target.value)}
              >
                <option value="All">All Divisions</option>
                {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Weekday header — the trailing "Wk" total column only shows where it
          fits (sm+). */}
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
              const people = byDate.get(dateStr) || [];
              const pendingP = pendingByDate.get(dateStr);
              const count = people.length;
              const isToday = dateStr === todayStr;
              const shown = people.slice(0, 3);
              const extra = count - shown.length;
              return (
                <button
                  key={ci}
                  type="button"
                  onClick={() => setOpenDate(dateStr)}
                  className={`min-h-[64px] sm:min-h-[92px] rounded-lg border text-left p-1 sm:p-1.5 flex flex-col transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-rose-400 ${densityCell(count)} ${isToday ? 'ring-2 ring-sky-400' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <span className={`text-[11px] sm:text-xs font-bold ${count > 0 ? 'text-rose-900' : 'text-slate-400'}`}>{dayNum(dateStr)}</span>
                    {count > 0 && (
                      <span className={`text-[9px] sm:text-[10px] font-black rounded-full min-w-[16px] h-[16px] px-1 inline-flex items-center justify-center ${densityBadge(count)}`}>{count}</span>
                    )}
                  </div>
                  {/* Name tags — hidden on the narrowest widths where the
                      count badge carries the read; tap opens the full list. */}
                  <div className="hidden sm:flex flex-col gap-0.5 mt-1 overflow-hidden">
                    {shown.map((p, i) => (
                      <span key={i} className="text-[10px] leading-tight font-semibold text-rose-800 bg-white/70 rounded px-1 py-0.5 truncate">{p.name}</span>
                    ))}
                    {extra > 0 && <span className="text-[9px] font-bold text-rose-700 px-1">+{extra} more</span>}
                    {pendingP && (
                      <span className="text-[10px] leading-tight font-bold text-amber-800 bg-amber-100 border border-dashed border-amber-400 rounded px-1 py-0.5 truncate inline-flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5 shrink-0" /> {pendingP.name}
                      </span>
                    )}
                  </div>
                  {/* Mobile: a pending marker still needs to read distinctly. */}
                  {pendingP && (
                    <span className="sm:hidden mt-auto self-start text-[8px] font-black uppercase tracking-wide text-amber-800 bg-amber-100 border border-dashed border-amber-400 rounded px-1">pend</span>
                  )}
                </button>
              );
            })}
            {/* Per-week total on the row edge. */}
            <div className="hidden sm:flex min-h-[92px] rounded-lg bg-slate-50 border border-slate-200 flex-col items-center justify-center">
              <span className="text-lg font-black text-slate-700">{weekTotal(row)}</span>
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">off</span>
            </div>
          </div>
        ))}
      </div>

      {monthTotal === 0 && (
        <div className="text-center text-sm text-slate-400 italic py-6">No approved time off this month{division !== 'All' ? ` in ${division}` : ''}.</div>
      )}

      {/* Day detail — the full list when tags crowd at narrow widths. */}
      {openDate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setOpenDate(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-800">
                {new Date(`${openDate}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </h3>
              <button onClick={() => setOpenDate(null)} aria-label="Close" className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-3 space-y-1.5">
              {openList.length === 0 ? (
                <div className="text-sm text-slate-400 italic text-center py-4">No one booked off.</div>
              ) : openList.map((p, i) => (
                <div key={i} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${p.pending ? 'bg-amber-50 border-amber-300 border-dashed' : 'bg-rose-50 border-rose-200'}`}>
                  <span className={`text-sm font-bold ${p.pending ? 'text-amber-800' : 'text-rose-800'}`}>{p.name}</span>
                  <span className="flex items-center gap-2">
                    {p.division && <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{p.division}</span>}
                    {p.pending && <span className="text-[9px] font-black uppercase tracking-widest text-amber-700 bg-amber-100 border border-amber-300 rounded px-1.5 py-0.5">Pending</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

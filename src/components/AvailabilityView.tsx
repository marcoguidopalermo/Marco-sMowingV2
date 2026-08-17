// SCHEDULE BOARD · AVAILABILITY — who's free, who's short, who's away.
//
// Read at 6:45am on a phone while crews are being reshuffled, so the layout is
// single-column and thumb-sized by default and only spreads out on a desktop.
// The order is deliberate: WHO IS FREE first, because that is the question
// being asked; crew headcounts second, because that is where the free person
// goes; away last, because it explains a gap rather than filling one.
//
// READ-ONLY. Nothing here writes — reshuffling still happens on the board
// itself, and this view just tells you what to reshuffle.
import { useMemo, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Filter, Users, UserCheck, Plane, ChevronDown,
} from 'lucide-react';
import type { AppData } from '../types';
import { DIVISIONS } from '../constants';
import { addDaysToronto, formatTodayInToronto } from '../lib/dateUtils';
import { buildAvailabilityDay, type CrewHeadcount, type PersonRow } from '../lib/availabilityView';

// Delta → how the crew reads. Above its norm means someone could be lent out;
// below means it is short. A crew with no norm yet is neither.
function deltaChip(c: CrewHeadcount): { text: string; cls: string } {
  if (c.typical === null) {
    return { text: 'new crew', cls: 'bg-slate-100 text-slate-500 border-slate-300' };
  }
  if (c.delta === null || c.delta === 0) {
    return { text: 'usual size', cls: 'bg-slate-100 text-slate-600 border-slate-300' };
  }
  if (c.delta > 0) {
    return {
      text: `+${c.delta} · can lend ${c.delta === 1 ? 'one' : c.delta}`,
      cls: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    };
  }
  return {
    text: `${c.delta} · short ${Math.abs(c.delta)}`,
    cls: 'bg-amber-50 text-amber-900 border-amber-400',
  };
}

function PersonChip({ p, showDivision }: { p: PersonRow; showDivision?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
      <span className="text-[13px] font-bold text-slate-800">{p.name}</span>
      {showDivision && (
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {p.division || 'no division'}
        </span>
      )}
    </span>
  );
}

export default function AvailabilityView({
  appData, defaultDivision = 'All',
}: {
  appData: AppData;
  defaultDivision?: string;
}) {
  const [date, setDate] = useState(formatTodayInToronto());
  const [division, setDivision] = useState(defaultDivision);
  // Office / no-division staff are employed and unassigned but are not crew
  // material, and at 19 unassigned records they bury the six names that
  // matter. Grouped and collapsed rather than hidden — the count is always
  // visible and one tap shows them.
  const [showNoDivision, setShowNoDivision] = useState(false);

  const day = useMemo(
    () => buildAvailabilityDay(appData, date, division),
    [appData, date, division],
  );

  const isToday = date === formatTodayInToronto();
  const heading = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  // Unassigned split into field staff (grouped by the division they normally
  // work with) and everyone with no division.
  const { byDivision, noDivision } = useMemo(() => {
    const groups = new Map<string, PersonRow[]>();
    const none: PersonRow[] = [];
    for (const p of day.unassigned) {
      if (!p.division) { none.push(p); continue; }
      const g = groups.get(p.division);
      if (g) g.push(p); else groups.set(p.division, [p]);
    }
    return { byDivision: [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])), noDivision: none };
  }, [day.unassigned]);

  const canLend = day.crews.filter(c => (c.delta ?? 0) > 0);
  const short = day.crews.filter(c => (c.delta ?? 0) < 0);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-3 p-3 sm:p-4">
      {/* DATE + FILTER — stacked on a phone, one row from sm up. */}
      <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous day"
            onClick={() => setDate(d => addDaysToronto(d, -1))}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button"
            onClick={() => setDate(formatTodayInToronto())}
            className={`h-11 rounded-lg border px-3 text-xs font-black uppercase tracking-widest ${isToday ? 'border-slate-300 bg-slate-100 text-slate-500' : 'border-sky-400 bg-sky-50 text-sky-700'}`}>
            Today
          </button>
          <button type="button" aria-label="Next day"
            onClick={() => setDate(d => addDaysToronto(d, 1))}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-black text-slate-900 sm:text-lg">{heading}</div>
          <div className="text-[11px] font-bold text-slate-500">
            {day.totals.employed} employed · {day.totals.assigned} on a crew ·
            {' '}<span className="text-emerald-700">{day.totals.unassigned} free</span> ·
            {' '}<span className="text-rose-700">{day.totals.away} away</span>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-2">
          <Filter className="h-4 w-4 shrink-0 text-slate-500" />
          <select value={division} onChange={e => setDivision(e.target.value)}
            aria-label="Filter by division"
            className="h-11 w-full min-w-0 bg-transparent text-sm font-bold text-slate-700 outline-none sm:w-auto">
            <option value="All">All Divisions</option>
            {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* THE HEADLINE — the two facts a reshuffle turns on. */}
      {(canLend.length > 0 || short.length > 0) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {canLend.length > 0 && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3">
              <div className="text-[10px] font-black uppercase tracking-widest text-emerald-800">Can lend someone</div>
              <div className="mt-1 text-[13px] font-bold text-emerald-900">
                {canLend.map(c => `${c.key} (+${c.delta})`).join(' · ')}
              </div>
            </div>
          )}
          {short.length > 0 && (
            <div className="rounded-xl border border-amber-400 bg-amber-50 p-3">
              <div className="text-[10px] font-black uppercase tracking-widest text-amber-900">Running short</div>
              <div className="mt-1 text-[13px] font-bold text-amber-900">
                {short.map(c => `${c.key} (${c.delta})`).join(' · ')}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 1 · UNASSIGNED */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-emerald-700" />
          <h4 className="text-sm font-black text-slate-900">Not on a crew today</h4>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-black text-emerald-800">
            {day.unassigned.length}
          </span>
        </div>
        {day.unassigned.length === 0 ? (
          <p className="py-2 text-[13px] text-slate-500">Everyone available is on a crew.</p>
        ) : (
          <div className="space-y-2.5">
            {byDivision.map(([div, list]) => (
              <div key={div}>
                <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {div} · {list.length}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {list.map(p => <PersonChip key={p.id} p={p} />)}
                </div>
              </div>
            ))}
            {byDivision.length === 0 && noDivision.length > 0 && (
              <p className="text-[13px] text-slate-500">No field staff free — only office / no-division people below.</p>
            )}
            {noDivision.length > 0 && (
              <div className="border-t border-slate-100 pt-2">
                <button type="button" onClick={() => setShowNoDivision(v => !v)}
                  className="inline-flex min-h-[36px] items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-slate-500">
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showNoDivision ? 'rotate-180' : ''}`} />
                  No division · {noDivision.length}
                  <span className="font-bold normal-case tracking-normal text-slate-400">(office / other)</span>
                </button>
                {showNoDivision && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {noDivision.map(p => <PersonChip key={p.id} p={p} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2 · CREW HEADCOUNTS */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <Users className="h-4 w-4 text-slate-700" />
          <h4 className="text-sm font-black text-slate-900">Crews today</h4>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600">
            {day.crews.length}
          </span>
        </div>
        {day.crews.length === 0 ? (
          <p className="py-2 text-[13px] text-slate-500">
            No crews built for this day{division !== 'All' ? ` in ${division}` : ''}.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {day.crews.map(c => {
              const chip = deltaChip(c);
              return (
                <div key={c.key} className="rounded-xl border border-slate-200 p-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-black text-slate-900">{c.key}</span>
                    <span className="ml-auto whitespace-nowrap font-mono text-lg font-black leading-none text-slate-900">
                      {c.today}
                      <span className="text-xs font-bold text-slate-400">
                        {c.typical !== null ? ` / ${c.typical.size}` : ''}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${chip.cls}`}>
                      {chip.text}
                    </span>
                    {c.typical !== null && (
                      <span className="text-[10px] font-bold text-slate-400"
                        title={`Median crew size over ${c.typical.days} past scheduled day(s) in the last 28 days`}>
                        usual {c.typical.size} · {c.typical.days}d
                      </span>
                    )}
                  </div>
                  {c.people.length > 0 && (
                    <div className="mt-1.5 text-[11px] font-bold leading-snug text-slate-600">
                      {c.people.map(p => p.name).join(' · ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 3 · AWAY */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <Plane className="h-4 w-4 text-rose-600" />
          <h4 className="text-sm font-black text-slate-900">Away today</h4>
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-black text-rose-800">
            {day.away.length}
          </span>
        </div>
        {day.away.length === 0 ? (
          <p className="py-2 text-[13px] text-slate-500">Nobody away.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {day.away.map(a => (
              <span key={a.id}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 ${a.kind === 'booked_off' ? 'border-rose-200 bg-rose-50' : 'border-orange-200 bg-orange-50'}`}>
                <span className="text-[13px] font-bold text-slate-800">{a.name}</span>
                <span className={`text-[10px] font-black uppercase tracking-wider ${a.kind === 'booked_off' ? 'text-rose-700' : 'text-orange-700'}`}>
                  {a.kind === 'booked_off' ? 'booked off' : a.reason === 'sick' ? 'absent' : 'away'}
                </span>
              </span>
            ))}
          </div>
        )}
      </section>

      <p className="px-1 pb-2 text-[10px] font-bold text-slate-400">
        Read-only. Reshuffle on the board itself — nothing here changes a crew.
        &ldquo;Usual&rdquo; is the median crew size over past scheduled days in the last 28.
      </p>
    </div>
  );
}

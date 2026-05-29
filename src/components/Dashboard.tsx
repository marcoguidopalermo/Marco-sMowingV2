import { useMemo, useState } from 'react';
import { LayoutDashboard, TrendingUp, Crown, Users } from 'lucide-react';
import { AppSettings, Crew, Employee, PerformanceLog } from '../types';
import { addDaysToronto } from '../lib/dateUtils';
import {
  buildCrewLeaderboard,
  rankLeaderboard,
  CrewLeaderboardEntry,
  LEADERBOARD_MIN_BH,
} from '../lib/leaderboard';

interface DashboardProps {
  today: string;
  schedules: Record<string, Crew[]>;
  performance: Record<string, Record<string, PerformanceLog>>;
  employees: Employee[];
  settings?: AppSettings | null;
}

// ---------- WIDGET: CREW LEADERBOARD ----------
// Full crew ranking for a given Toronto date. Eligible crews (BH >
// LEADERBOARD_MIN_BH) ranked by efficiency desc; ineligible crews
// segregated into a "Not enough data yet" group at the bottom.
function CrewLeaderboardWidget({
  date,
  live,
  schedules,
  performance,
  employees,
  settings,
}: {
  date: string;
  live: boolean;
  schedules: Record<string, Crew[]>;
  performance: Record<string, Record<string, PerformanceLog>>;
  employees: Employee[];
  settings?: AppSettings | null;
}) {
  const ranked = useMemo<CrewLeaderboardEntry[]>(
    () => rankLeaderboard(buildCrewLeaderboard(date, schedules, performance, employees, settings || undefined)),
    [date, schedules, performance, employees, settings],
  );
  const eligible = ranked.filter(r => r.eligible);
  const ineligible = ranked.filter(r => !r.eligible);

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <header className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-bold text-slate-800">Crew Leaderboard</h3>
        </div>
        {live && (
          <div className="flex items-center gap-1.5">
            <span className="relative inline-flex w-2 h-2">
              <span className="absolute inline-flex w-full h-full rounded-full bg-rose-500 opacity-75 animate-ping" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-rose-600" />
            </span>
            <span className="text-[10px] font-black uppercase tracking-widest text-rose-700">Live</span>
          </div>
        )}
      </header>

      {eligible.length === 0 && ineligible.length === 0 ? (
        <div className="p-6 text-center text-sm italic text-slate-400">
          No crews scheduled on {date}.
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {eligible.length === 0 && (
            <div className="px-4 py-3 text-[11px] italic text-amber-700 bg-amber-50">
              {live
                ? `Calculating… no crew has crossed ${LEADERBOARD_MIN_BH} BH yet.`
                : `No crew crossed ${LEADERBOARD_MIN_BH} BH on this day.`}
            </div>
          )}
          {eligible.map((entry, idx) => (
            <LeaderboardRow key={entry.crew.id} entry={entry} rank={idx + 1} />
          ))}
          {ineligible.length > 0 && (
            <>
              <div className="px-4 py-2 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Not enough data yet — under {LEADERBOARD_MIN_BH} BH
              </div>
              {ineligible.map(entry => (
                <LeaderboardRow key={entry.crew.id} entry={entry} rank={null} />
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function LeaderboardRow({
  entry,
  rank,
}: {
  entry: CrewLeaderboardEntry;
  rank: number | null;
}) {
  const isTop = rank === 1;
  return (
    <div className={`px-4 py-3 grid grid-cols-12 gap-3 items-center ${isTop ? 'bg-amber-50/40' : ''}`}>
      <div className="col-span-1 text-center">
        {rank === null ? (
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">—</span>
        ) : isTop ? (
          <Crown className="w-5 h-5 text-amber-500 inline" />
        ) : (
          <span className="text-base font-black text-slate-600">{rank}</span>
        )}
      </div>
      <div className="col-span-5 min-w-0">
        <div className="font-bold text-slate-800 text-sm truncate">{entry.crewLabel}</div>
        <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5 truncate" title={entry.memberNames.join(' · ')}>
          <Users className="w-3 h-3 shrink-0" />
          {entry.memberNames.length === 0
            ? <span className="italic">No roster</span>
            : entry.memberNames.length <= 3
              ? entry.memberNames.join(' · ')
              : `${entry.memberNames.slice(0, 3).join(' · ')} +${entry.memberNames.length - 3}`}
        </div>
      </div>
      <div className="col-span-2 text-right font-mono font-bold text-slate-700 text-sm">{entry.bh.toFixed(1)}<span className="text-[9px] font-black text-slate-400 ml-0.5">BH</span></div>
      <div className="col-span-2 text-right font-mono font-bold text-slate-700 text-sm">{entry.ah.toFixed(1)}<span className="text-[9px] font-black text-slate-400 ml-0.5">AH</span></div>
      <div className="col-span-2 text-right">
        <div className="font-mono font-black text-emerald-700">
          {entry.efficiency != null ? `${entry.efficiency}%` : <span className="text-slate-300">—</span>}
        </div>
        {entry.allowancePct > 0 && entry.efficiency != null && (
          <div className="text-[9px] font-medium text-slate-500 mt-0.5 whitespace-nowrap">
            incl. {entry.allowancePct}% {entry.scheduledSize}-man adj
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- VIEW: DASHBOARD ----------
// First of a growing set of company-wide rollup widgets. The view
// owns the today/yesterday toggle and passes the resolved date down
// to each widget; widgets stay agnostic about how the date was
// chosen, which keeps them composable as more sections land.
export default function Dashboard({
  today,
  schedules,
  performance,
  employees,
  settings,
}: DashboardProps) {
  const [tab, setTab] = useState<'today' | 'yesterday'>('today');
  const yesterday = useMemo(() => {
    try { return addDaysToronto(today, -1); } catch { return ''; }
  }, [today]);
  const date = tab === 'today' ? today : yesterday;
  const live = tab === 'today';

  return (
    <div className="flex-1 overflow-y-auto bg-gray-100 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6 text-emerald-600" /> Dashboard
          </h2>
          <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
            <button
              onClick={() => setTab('today')}
              className={`px-4 py-1.5 text-xs font-black uppercase tracking-widest rounded-md ${tab === 'today' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500 hover:text-gray-700'}`}
            >Today</button>
            <button
              onClick={() => setTab('yesterday')}
              className={`px-4 py-1.5 text-xs font-black uppercase tracking-widest rounded-md ${tab === 'yesterday' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500 hover:text-gray-700'}`}
            >Yesterday</button>
          </div>
        </div>

        <div className="grid gap-6">
          <CrewLeaderboardWidget
            date={date}
            live={live}
            schedules={schedules}
            performance={performance}
            employees={employees}
            settings={settings}
          />
          {/* Future widgets land here — keep each as its own component
              so the section list stays composable. */}
        </div>
      </div>
    </div>
  );
}

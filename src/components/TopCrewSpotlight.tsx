import { useMemo } from 'react';
import { Crown, Users } from 'lucide-react';
import { Crew, Employee, PerformanceLog } from '../types';
import {
  buildCrewLeaderboard,
  topCrew,
  LEADERBOARD_MIN_BH,
} from '../lib/leaderboard';

interface TopCrewSpotlightProps {
  // Toronto YYYY-MM-DD the spotlight should display. Parent controls
  // which day (today or yesterday) so the surrounding tab toggle
  // owns the activeTab state.
  date: string;
  // When true, surface the blinking LIVE dot. Caller passes true only
  // for today's date.
  live: boolean;
  schedules: Record<string, Crew[]>;
  performance: Record<string, Record<string, PerformanceLog>>;
  employees: Employee[];
}

export default function TopCrewSpotlight({
  date,
  live,
  schedules,
  performance,
  employees,
}: TopCrewSpotlightProps) {
  const entries = useMemo(
    () => buildCrewLeaderboard(date, schedules, performance, employees),
    [date, schedules, performance, employees],
  );
  const winner = topCrew(entries);

  return (
    <div className="bg-gradient-to-br from-amber-50 via-white to-amber-50 border border-amber-200 rounded-2xl shadow-sm p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Crown className="w-4 h-4 text-amber-600" />
          <h3 className="text-[11px] font-black uppercase tracking-widest text-amber-800">Top Crew</h3>
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
      </div>

      {!winner ? (
        <div className="bg-white border border-amber-100 rounded-xl p-4 text-center">
          <div className="text-sm font-bold text-slate-700">
            {live ? "Today's leader — calculating…" : 'No leader recorded'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {live
              ? `Not enough completed work yet (waiting for the first crew to cross ${LEADERBOARD_MIN_BH} BH).`
              : `No crew crossed ${LEADERBOARD_MIN_BH} BH on ${date}.`}
          </div>
        </div>
      ) : (
        <div className="bg-white border border-amber-200 rounded-xl p-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-amber-500" />
              <span className="text-lg font-black text-slate-800">{winner.crewLabel}</span>
            </div>
            <div className="text-right">
              <div className="text-3xl font-black text-emerald-600 leading-none">
                {winner.efficiency != null ? `${winner.efficiency}%` : '—'}
              </div>
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">Efficiency</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <div className="bg-slate-50 rounded-lg p-2 text-center">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">BH</div>
              <div className="text-sm font-mono font-bold text-slate-800">{winner.bh.toFixed(1)}</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 text-center">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">AH</div>
              <div className="text-sm font-mono font-bold text-slate-800">{winner.ah.toFixed(1)}</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 text-center">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Jobs</div>
              <div className="text-sm font-mono font-bold text-slate-800">{winner.jobCount}</div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-amber-100">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 flex items-center gap-1">
              <Users className="w-3 h-3" /> Members
            </div>
            <div className="text-xs font-medium text-slate-700">
              {winner.memberNames.length > 0
                ? winner.memberNames.join(' · ')
                : <span className="italic text-slate-400">No roster recorded</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

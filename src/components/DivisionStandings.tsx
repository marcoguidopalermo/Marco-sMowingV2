import { useMemo } from 'react';
import { BarChart3, Crown } from 'lucide-react';
import { AppSettings, Crew, Employee, PerformanceLog } from '../types';
import { buildDivisionMtd } from '../lib/mtd';

interface DivisionStandingsProps {
  today: string;
  division: string;
  schedules: Record<string, Crew[]>;
  performance: Record<string, Record<string, PerformanceLog>>;
  employees: Employee[];
  settings?: AppSettings | null;
  // Stable key of the viewer's own crew today ("<division-lower>-<crewNumber>")
  // so their row can be highlighted. Optional.
  highlightCrewKey?: string | null;
}

// Division standings — every crew in the viewer's division ranked by
// their MONTH-TO-DATE adjusted efficiency (the same virtual-BH number
// the bonus reads, via buildDivisionMtd). This is the "elevate the
// team" board: it shows where each crew sits for the month, not just
// today.
export default function DivisionStandings({
  today,
  division,
  schedules,
  performance,
  employees,
  settings,
  highlightCrewKey,
}: DivisionStandingsProps) {
  const mtd = useMemo(
    () => buildDivisionMtd(today, division, performance, schedules, employees, settings || null),
    [today, division, performance, schedules, employees, settings],
  );

  const colorFor = (eff: number | null): string => {
    if (eff == null) return 'text-slate-400 bg-slate-100 border-slate-200';
    if (eff >= 90) return 'text-purple-700 bg-purple-100 border-purple-300';
    if (eff >= 80) return 'text-emerald-700 bg-emerald-100 border-emerald-300';
    if (eff >= 70) return 'text-yellow-700 bg-yellow-100 border-yellow-300';
    return 'text-red-700 bg-red-100 border-red-300';
  };

  return (
    <div className="bg-gradient-to-br from-indigo-50 via-white to-indigo-50 border border-indigo-200 rounded-2xl shadow-sm p-4 mb-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-indigo-600" />
          <h3 className="text-[11px] font-black uppercase tracking-widest text-indigo-800">
            Division Standings — {division}
          </h3>
        </div>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 shrink-0">
          {mtd.monthName} adjusted %
        </span>
      </div>

      {mtd.perCrew.length === 0 ? (
        <div className="bg-white border border-indigo-100 rounded-xl p-4 text-center">
          <div className="text-sm font-bold text-slate-700">No completed crew-days yet this month.</div>
          <div className="text-[11px] text-slate-500 mt-1">
            Standings appear once a crew in {division} has an approved day.
          </div>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {mtd.perCrew.map((c, i) => {
            const isMine = highlightCrewKey && c.crewKey === highlightCrewKey;
            const rank = i + 1;
            return (
              <li
                key={c.crewKey}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl border shadow-sm ${
                  isMine ? 'bg-lime-50 border-lime-300' : 'bg-white border-indigo-100'
                }`}
              >
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs font-black shrink-0">
                  {rank === 1 ? <Crown className="w-3.5 h-3.5 text-amber-500" /> : rank}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-800 truncate">
                    {c.crewLabel}
                    {isMine && <span className="ml-1.5 text-[10px] text-lime-700 font-black">(your crew)</span>}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {c.bh.toFixed(1)} BH · {c.ah.toFixed(1)} AH
                  </div>
                </div>
                <div className={`px-3 py-1.5 rounded-lg border font-black text-lg shrink-0 ${colorFor(c.adjustedEfficiency)}`}>
                  {c.adjustedEfficiency != null ? `${c.adjustedEfficiency}%` : '--'}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {mtd.traineeCreditedDays > 0 && (
        <p className="text-[10px] font-semibold text-amber-700 mt-2 leading-snug">
          Includes {mtd.traineeCreditedDays} trainee-day{mtd.traineeCreditedDays === 1 ? '' : 's'} credited this month (+10% each).
        </p>
      )}
      <p className="text-[10px] text-slate-400 italic mt-2 leading-snug">
        Month-to-date crew-size-adjusted efficiency — the bonus number. Settles at end of day; today's hours land tomorrow.
      </p>
    </div>
  );
}

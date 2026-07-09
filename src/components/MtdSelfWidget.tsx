import { useMemo } from 'react';
import { CalendarRange, Target, Layers } from 'lucide-react';
import { AppSettings, Crew, Employee, PerformanceLog } from '../types';
import { buildMtd, buildDivisionMtd, selfMtdBH } from '../lib/mtd';
import { DIVISIONS } from '../constants';

interface MtdSelfWidgetProps {
  today: string;
  currentUserEmployee: Employee | null;
  schedules: Record<string, Crew[]>;
  performance: Record<string, Record<string, PerformanceLog>>;
  employees: Employee[];
  settings?: AppSettings | null;
  // When set, the widget reports the viewer's DIVISION monthly
  // numbers (division BH + division adjusted efficiency — the
  // bonus-relevant number) instead of company-wide. The self-BH
  // tile is unchanged. Undefined → company-wide (legacy behavior).
  division?: string;
}

const formatNumber = (n: number) => n.toLocaleString('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export default function MtdSelfWidget({
  today,
  currentUserEmployee,
  schedules,
  performance,
  employees,
  settings,
  division,
}: MtdSelfWidgetProps) {
  // Self BH always comes from the company MTD (a worker's own BH is
  // the same figure regardless of scope, and this keeps the invariant
  // that self-BH is the person's total this month).
  const companyMtd = useMemo(
    () => buildMtd(today, performance, schedules, employees, settings || null),
    [today, performance, schedules, employees, settings],
  );
  const divisionMtd = useMemo(
    () => (division
      ? buildDivisionMtd(today, division, performance, schedules, employees, settings || null)
      : null),
    [today, division, performance, schedules, employees, settings],
  );
  const myBH = selfMtdBH(companyMtd, currentUserEmployee?.id);

  // "Your Month" — every division the signed-in worker has BH/AH in this
  // month, with that division's adjusted MTD % (the bonus-relevant number).
  // Month-based, NOT day-based: independent of today's crew and the widget's
  // `division` scope prop. All numbers come from buildDivisionMtd's
  // per-employee accumulation — the same basis the bonus calculator reads.
  const myDivisions = useMemo(() => {
    if (!currentUserEmployee) return [];
    const out: Array<{ division: string; myBH: number; myAH: number; divAdjEff: number | null }> = [];
    for (const div of DIVISIONS) {
      const dm = buildDivisionMtd(today, div, performance, schedules, employees, settings || null);
      const mine = dm.perEmployee.find(e => e.empId === currentUserEmployee.id);
      if (mine && (mine.bh > 0 || mine.ah > 0)) {
        out.push({ division: div, myBH: mine.bh, myAH: mine.ah, divAdjEff: dm.divisionAdjustedEfficiency });
      }
    }
    return out.sort((a, b) => b.myBH - a.myBH);
  }, [currentUserEmployee, today, performance, schedules, employees, settings]);

  // Headline scope: division when a division is supplied, else company.
  const monthLabel = divisionMtd ? divisionMtd.monthLabel : companyMtd.monthLabel;
  const headlineBH = divisionMtd ? divisionMtd.divisionBH : companyMtd.companyBH;
  const headlineAdjEff = divisionMtd
    ? divisionMtd.divisionAdjustedEfficiency
    : companyMtd.companyAdjustedEfficiency;
  const bhLabel = divisionMtd ? 'Division BH' : 'Company BH';
  const effLabel = divisionMtd ? 'Division Adjusted Eff.' : 'Company Adjusted Eff.';

  return (
    <div className="bg-gradient-to-br from-emerald-50 via-white to-emerald-50 border border-emerald-200 rounded-2xl shadow-sm p-4 mb-4">
      <div className="flex items-start justify-between mb-3 gap-2 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-emerald-600" />
            <h3 className="text-[11px] font-black uppercase tracking-widest text-emerald-800">
              {monthLabel || 'This Month'}
            </h3>
          </div>
          <span className="text-[10px] text-slate-500 italic">
            Monthly totals settle at end of day — today's hours land tomorrow.
          </span>
        </div>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 shrink-0">Month-to-date</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white border border-emerald-100 rounded-xl p-3 text-center">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{bhLabel}</div>
          <div className="text-2xl font-black text-emerald-700">{formatNumber(headlineBH)}</div>
        </div>
        <div className="bg-white border border-emerald-100 rounded-xl p-3 text-center">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{effLabel}</div>
          <div className="text-2xl font-black text-emerald-700">
            {headlineAdjEff != null ? `${headlineAdjEff}%` : '—'}
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
          <div className="text-[10px] font-black uppercase tracking-widest text-amber-700 mb-1 flex items-center justify-center gap-1">
            <Target className="w-3 h-3" /> You this month
          </div>
          <div className="text-2xl font-black text-amber-800">
            {currentUserEmployee ? `${formatNumber(myBH)} BH` : '—'}
          </div>
        </div>
      </div>

      {/* YOUR MONTH — per-division breakdown of the worker's own BH/hours,
          with each division's adjusted MTD %. Only divisions they've
          contributed to appear; month-based, so it shows even when the
          worker isn't scheduled today. Display-only. */}
      {currentUserEmployee && myDivisions.length > 0 && (
        <div className="mt-3 bg-white border border-amber-100 rounded-xl p-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-amber-700 mb-2 flex items-center gap-1">
            <Layers className="w-3 h-3" /> Your month by division
          </div>
          <div className="space-y-1.5">
            {myDivisions.map(c => (
              <div key={c.division} className="flex items-center justify-between gap-2 text-sm">
                <span className="font-bold text-slate-700 truncate">{c.division}</span>
                <span className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-slate-700"><b>{formatNumber(c.myBH)}</b> BH</span>
                  <span className="font-mono text-[11px] text-slate-400">{formatNumber(c.myAH)} hrs</span>
                  <span className="font-mono text-[11px] text-emerald-600 font-bold" title="This division's adjusted month-to-date efficiency">
                    {c.divAdjEff != null ? `${c.divAdjEff}%` : '—'} <span className="text-slate-400 font-normal">div adj</span>
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

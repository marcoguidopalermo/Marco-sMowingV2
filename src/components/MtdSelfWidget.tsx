import { useMemo } from 'react';
import { CalendarRange, Target } from 'lucide-react';
import { AppSettings, Crew, Employee, PerformanceLog } from '../types';
import { buildMtd, buildDivisionMtd, selfMtdBH } from '../lib/mtd';

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
    </div>
  );
}

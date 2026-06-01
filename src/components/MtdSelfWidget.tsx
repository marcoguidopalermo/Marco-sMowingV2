import { useMemo } from 'react';
import { CalendarRange, Target } from 'lucide-react';
import { AppSettings, Crew, Employee, PerformanceLog } from '../types';
import { buildMtd, selfMtdBH } from '../lib/mtd';

interface MtdSelfWidgetProps {
  today: string;
  currentUserEmployee: Employee | null;
  schedules: Record<string, Crew[]>;
  performance: Record<string, Record<string, PerformanceLog>>;
  employees: Employee[];
  settings?: AppSettings | null;
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
}: MtdSelfWidgetProps) {
  const mtd = useMemo(
    () => buildMtd(today, performance, schedules, employees, settings || null),
    [today, performance, schedules, employees, settings],
  );
  const myBH = selfMtdBH(mtd, currentUserEmployee?.id);

  return (
    <div className="bg-gradient-to-br from-emerald-50 via-white to-emerald-50 border border-emerald-200 rounded-2xl shadow-sm p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarRange className="w-4 h-4 text-emerald-600" />
          <h3 className="text-[11px] font-black uppercase tracking-widest text-emerald-800">
            {mtd.monthLabel || 'This Month'}
          </h3>
        </div>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Month-to-date</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white border border-emerald-100 rounded-xl p-3 text-center">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Company BH</div>
          <div className="text-2xl font-black text-emerald-700">{formatNumber(mtd.companyBH)}</div>
        </div>
        <div className="bg-white border border-emerald-100 rounded-xl p-3 text-center">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Company Adjusted Eff.</div>
          <div className="text-2xl font-black text-emerald-700">
            {mtd.companyAdjustedEfficiency != null ? `${mtd.companyAdjustedEfficiency}%` : '—'}
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

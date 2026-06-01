import { useMemo } from 'react';
import { CalendarRange, Users } from 'lucide-react';
import { AppSettings, Crew, Employee, PerformanceLog } from '../types';
import { buildMtd } from '../lib/mtd';

interface MtdCompanyWidgetProps {
  today: string;
  schedules: Record<string, Crew[]>;
  performance: Record<string, Record<string, PerformanceLog>>;
  employees: Employee[];
  settings?: AppSettings | null;
}

const formatBH = (n: number) => n.toLocaleString('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export default function MtdCompanyWidget({
  today,
  schedules,
  performance,
  employees,
  settings,
}: MtdCompanyWidgetProps) {
  const mtd = useMemo(
    () => buildMtd(today, performance, schedules, employees, settings || null),
    [today, performance, schedules, employees, settings],
  );
  const employeeTotal = useMemo(
    () => mtd.perEmployee.reduce((s, r) => s + r.bh, 0),
    [mtd.perEmployee],
  );

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <header className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-start justify-between flex-wrap gap-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-800">
              {mtd.monthLabel || 'This Month'}
            </h3>
          </div>
          <span className="text-[10px] text-slate-500 italic">
            Settled — today's data isn't included until end of day. Bonus-pool input.
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-600 shrink-0">
          <div>
            <span className="font-black uppercase tracking-widest text-[10px] text-slate-400 mr-1">Company BH</span>
            <span className="font-mono font-black text-slate-800">{formatBH(mtd.companyBH)}</span>
          </div>
          <div>
            <span className="font-black uppercase tracking-widest text-[10px] text-slate-400 mr-1">Adjusted Eff.</span>
            <span className="font-mono font-black text-emerald-700">
              {mtd.companyAdjustedEfficiency != null ? `${mtd.companyAdjustedEfficiency}%` : '—'}
            </span>
          </div>
        </div>
      </header>

      <div className="px-4 py-2 bg-slate-50 border-b border-gray-200 text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
        <Users className="w-3.5 h-3.5" /> Per-employee MTD BH share (bonus-pool input)
      </div>

      {mtd.perEmployee.length === 0 ? (
        <div className="p-6 text-center text-sm italic text-slate-400">
          No employee BH recorded yet this month.
        </div>
      ) : (
        <div className="max-h-[480px] overflow-y-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="border-b border-gray-200 text-[10px] text-gray-500 uppercase">
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2 text-right">MTD BH</th>
                <th className="px-3 py-2 text-right">MTD AH</th>
                <th className="px-3 py-2 text-right">Indiv Eff %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {mtd.perEmployee.map(row => {
                const eff = row.ah > 0 ? Number(((row.bh / row.ah) * 100).toFixed(1)) : null;
                return (
                  <tr key={row.empId} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-sm font-bold text-slate-800">{row.name}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700 text-sm">{formatBH(row.bh)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-700 text-sm">{formatBH(row.ah)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-600 text-sm">
                      {eff != null ? `${eff}%` : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-slate-50">
                <td className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Sum check</td>
                <td className="px-3 py-2 text-right font-mono font-black text-slate-800 text-sm">{formatBH(employeeTotal)}</td>
                <td className="px-3 py-2 text-right text-[10px] text-slate-400" colSpan={2}>
                  Company BH: <span className="font-mono font-black text-slate-700">{formatBH(mtd.companyBH)}</span>
                  {Math.abs(employeeTotal - mtd.companyBH) > 0.2 && (
                    <span className="ml-2 text-rose-600 font-black">Δ {(employeeTotal - mtd.companyBH).toFixed(2)}</span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

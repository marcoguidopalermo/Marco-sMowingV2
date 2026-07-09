import { useMemo, useState, Fragment } from 'react';
import { TrendingUp, ChevronDown, ChevronRight } from 'lucide-react';
import { AppData, MonthlySummary } from '../types';
import { buildMonthlySummary } from '../lib/monthlySummary';
import BonusCalculator from './BonusCalculator';

interface TrendsPageProps {
  appData: AppData;
  today: string;   // YYYY-MM-DD (Toronto)
  isAdmin: boolean;
}

const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)}%`);
const fmtNum = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(1));
const fmtInt = (v: number | null | undefined) => (v == null ? '—' : String(Math.round(v)));
const monthColLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};

export default function TrendsPage({ appData, today, isAdmin }: TrendsPageProps) {
  const currentYm = today.slice(0, 7);
  const [expandedDiv, setExpandedDiv] = useState<Record<string, boolean>>({});

  // Live month-to-date summary for the in-progress month (real-today MTD
  // semantics — matches the MTD widgets). Same shared bonus logic as the
  // stored finalized summaries, so the live column is directly comparable.
  const liveSummary = useMemo<MonthlySummary>(() => buildMonthlySummary(
    currentYm,
    appData.performance || {},
    appData.schedules || {},
    appData.employees || [],
    appData.settings,
    { generatedBy: 'live', finalized: false, now: Date.now(), todayOverride: today },
  ), [currentYm, appData.performance, appData.schedules, appData.employees, appData.settings, today]);

  const finalized = appData.monthlySummaries || {};
  const [employeesOpen, setEmployeesOpen] = useState(false);
  const months = useMemo(
    () => [...new Set([...Object.keys(finalized), currentYm])].sort(),
    [finalized, currentYm],
  );
  const summaryFor = (ym: string): MonthlySummary | undefined =>
    ym === currentYm ? liveSummary : finalized[ym];

  // Per-employee rows: union across all shown months, each carrying its
  // BH/AH share per month (same shares buildMtd already produced). Sorted by
  // total BH desc so top contributors lead.
  const employeeRows = useMemo(() => {
    const map: Record<string, { name: string; totalBh: number; perMonth: Record<string, { bh: number; ah: number; rawEff: number | null; adjustedEff: number | null }> }> = {};
    for (const ym of months) {
      for (const e of summaryFor(ym)?.perEmployee || []) {
        if (!map[e.empId]) map[e.empId] = { name: e.name, totalBh: 0, perMonth: {} };
        map[e.empId].perMonth[ym] = { bh: e.bh, ah: e.ah, rawEff: e.rawEff ?? null, adjustedEff: e.adjustedEff ?? null };
        map[e.empId].totalBh += e.bh;
      }
    }
    return Object.entries(map)
      .map(([empId, v]) => ({ empId, ...v }))
      .sort((a, b) => b.totalBh - a.totalBh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, finalized, liveSummary]);

  // Union of divisions across all shown months (stable order from first seen).
  const divisions = useMemo(() => {
    const seen: string[] = [];
    for (const ym of months) {
      for (const d of summaryFor(ym)?.divisions || []) {
        if (!seen.includes(d.division)) seen.push(d.division);
      }
    }
    return seen;
  }, [months, finalized, liveSummary]);

  if (months.length === 0) {
    return (
      <div className="max-w-6xl mx-auto w-full p-8 text-center text-slate-500">
        No monthly summaries yet. Finalize a month (or seed one) to populate Trends.
      </div>
    );
  }

  const isLive = (ym: string) => ym === currentYm;

  // A metric cell for the company section.
  const CompanyRow = ({ label, pick, fmt, strong }: {
    label: string; pick: (s: MonthlySummary) => number | null; fmt: (v: number | null) => string; strong?: boolean;
  }) => (
    <tr className={strong ? 'bg-emerald-50/40' : ''}>
      <td className={`py-1.5 pl-3 pr-4 text-left text-slate-600 whitespace-nowrap ${strong ? 'font-black' : 'font-medium'}`}>{label}</td>
      {months.map(ym => {
        const s = summaryFor(ym);
        const v = s ? pick(s) : null;
        return (
          <td key={ym} className={`py-1.5 px-3 text-right font-mono ${strong ? 'font-black text-emerald-700' : 'text-slate-700'}`}>
            {fmt(v)}
          </td>
        );
      })}
    </tr>
  );

  return (
    <div className="max-w-6xl mx-auto w-full space-y-6 pb-20">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-emerald-600" />
          <h2 className="text-lg font-bold text-slate-800">Trends — Month over Month</h2>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Bonus basis (approved crew-days only), computed with the same logic as the monthly bonus,
          so months are directly comparable. The rightmost column is the current month <b>to date</b> (in progress).
        </p>
      </div>

      {/* BONUS CALCULATOR — admin only. Reads efficiency/BH straight from the
          summaries; only tier lookup + arithmetic happen here. */}
      {isAdmin && (
        <BonusCalculator summaries={finalized} liveSummary={liveSummary} currentYm={currentYm} />
      )}

      {/* COMPANY */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-100 font-bold text-slate-700 text-sm">Company</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="py-2 pl-3 pr-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Metric</th>
              {months.map(ym => (
                <th key={ym} className="py-2 px-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap">
                  {monthColLabel(ym)}{isLive(ym) && <span className="ml-1 text-emerald-600">MTD</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <CompanyRow label="Adjusted %" strong pick={s => s.company.adjustedEff} fmt={fmtPct} />
            <CompanyRow label="Raw %" pick={s => s.company.rawEff} fmt={fmtPct} />
            <CompanyRow label="Budgeted Hrs (BH)" pick={s => s.company.bh} fmt={fmtNum} />
            <CompanyRow label="Actual Hrs (AH)" pick={s => s.company.ah} fmt={fmtNum} />
            <CompanyRow label="Jobs" pick={s => s.company.jobs} fmt={fmtInt} />
            <CompanyRow label="Employees" pick={s => s.company.employees} fmt={fmtInt} />
          </tbody>
        </table>
      </div>

      {/* PER DIVISION (headline), expandable to per-crew */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-100 font-bold text-slate-700 text-sm">By Division</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="py-2 pl-3 pr-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Division / Crew</th>
              {months.map(ym => (
                <th key={ym} className="py-2 px-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap">
                  {monthColLabel(ym)}{isLive(ym) && <span className="ml-1 text-emerald-600">MTD</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {divisions.map(div => {
              const expanded = !!expandedDiv[div];
              // Union of crews for this division across months (stable order).
              const crewKeys: Array<{ key: string; label: string }> = [];
              for (const ym of months) {
                const ds = summaryFor(ym)?.divisions.find(d => d.division === div);
                for (const c of ds?.perCrew || []) {
                  if (!crewKeys.some(k => k.key === c.crewKey)) crewKeys.push({ key: c.crewKey, label: c.crewLabel });
                }
              }
              return (
                <Fragment key={div}>
                  <tr className="border-b border-slate-50 bg-slate-50/60">
                    <td className="py-1.5 pl-3 pr-4 text-left">
                      <button
                        type="button"
                        onClick={() => setExpandedDiv(s => ({ ...s, [div]: !s[div] }))}
                        className="inline-flex items-center gap-1.5 font-bold text-slate-700 hover:text-slate-900"
                      >
                        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        {div}
                      </button>
                      <span className="ml-2 text-[10px] uppercase tracking-widest text-slate-400">Adj %</span>
                    </td>
                    {months.map(ym => {
                      const ds = summaryFor(ym)?.divisions.find(d => d.division === div);
                      return (
                        <td key={ym} className="py-1.5 px-3 text-right font-mono font-black text-emerald-700">
                          {fmtPct(ds?.adjustedEff ?? null)}
                        </td>
                      );
                    })}
                  </tr>
                  {expanded && (
                    <>
                      {(['bh', 'ah', 'jobs'] as const).map(metric => (
                        <tr key={`${div}-${metric}`} className="border-b border-slate-50">
                          <td className="py-1 pl-9 pr-4 text-left text-[11px] text-slate-500">
                            {metric === 'bh' ? 'BH' : metric === 'ah' ? 'AH' : 'Jobs'}
                          </td>
                          {months.map(ym => {
                            const ds = summaryFor(ym)?.divisions.find(d => d.division === div);
                            const v = ds ? ds[metric] : null;
                            return (
                              <td key={ym} className="py-1 px-3 text-right font-mono text-[11px] text-slate-600">
                                {metric === 'jobs' ? fmtInt(v ?? null) : fmtNum(v ?? null)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      {crewKeys.map(ck => (
                        <tr key={`${div}-${ck.key}`} className="border-b border-slate-50">
                          <td className="py-1 pl-9 pr-4 text-left text-[11px] text-slate-500">
                            {ck.label} <span className="text-slate-300">· Adj %</span>
                          </td>
                          {months.map(ym => {
                            const ds = summaryFor(ym)?.divisions.find(d => d.division === div);
                            const crew = ds?.perCrew.find(c => c.crewKey === ck.key);
                            return (
                              <td key={ym} className="py-1 px-3 text-right font-mono text-[11px] text-slate-600">
                                {fmtPct(crew?.adjustedEff ?? null)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* PER EMPLOYEE — collapsible; BH primary with AH beneath, sorted by
          total BH desc. Includes the live MTD column. */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        <button
          type="button"
          onClick={() => setEmployeesOpen(o => !o)}
          className="w-full px-4 py-3 border-b border-slate-100 font-bold text-slate-700 text-sm flex items-center gap-1.5 hover:bg-slate-50"
        >
          {employeesOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          By Employee ({employeeRows.length})
          <span className="ml-1 text-[10px] font-medium uppercase tracking-widest text-slate-400">BH · AH · EFF% · *EFF%</span>
        </button>
        {employeesOpen && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="py-2 pl-3 pr-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Employee</th>
                {months.map(ym => (
                  <th key={ym} className="py-2 px-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap">
                    {monthColLabel(ym)}{isLive(ym) && <span className="ml-1 text-emerald-600">MTD</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employeeRows.length === 0 ? (
                <tr><td colSpan={months.length + 1} className="py-3 text-center text-slate-400 text-xs">No employee data yet.</td></tr>
              ) : employeeRows.map(emp => (
                <tr key={emp.empId} className="border-b border-slate-50">
                  <td className="py-1.5 pl-3 pr-4 text-left font-medium text-slate-700 whitespace-nowrap">{emp.name}</td>
                  {months.map(ym => {
                    const cell = emp.perMonth[ym];
                    return (
                      <td key={ym} className="py-1.5 px-3 text-right">
                        <div className="font-mono font-bold text-slate-700">{cell ? fmtNum(cell.bh) : '—'}</div>
                        <div className="font-mono text-[10px] text-slate-400">{cell ? `${fmtNum(cell.ah)} AH` : ''}</div>
                        {cell && (
                          <div className="font-mono text-[10px]">
                            <span className="text-slate-500">{fmtPct(cell.rawEff)}</span>
                            {' '}<span className="text-emerald-600 font-bold" title="Adjusted (crew-size) efficiency">*{fmtPct(cell.adjustedEff)}</span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Basis note */}
      <div className="text-[11px] text-slate-400 px-1">
        Numbers reflect approved days only. Pending / waived crew-days are excluded (they were never bonus-eligible).
        Finalized months are stored snapshots; the current month recomputes live.
      </div>
    </div>
  );
}

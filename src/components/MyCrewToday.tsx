import { useMemo, useState } from 'react';
import { Calendar as CalendarIcon, Target, Clock, TrendingUp, Link2, Users, Truck, Hammer, Wrench } from 'lucide-react';
import { Crew, Employee, FleetItem, EquipmentSubtypeDefinition, PerformanceLog, PartialTimeOff } from '../types';
import { formatTimeRange, addDaysToronto } from '../lib/dateUtils';
import { sortFleetGrouped, fleetItemLabel, isFleetOutOfService } from '../lib/fleetUtils';
import { accumulateEmployeeEff, efficiencyPct, EmpEffStat } from '../lib/efficiency';

interface MyCrewTodayProps {
  today: string;
  currentUserEmployee: Employee | null;
  schedules: Record<string, Crew[]>;
  performance: Record<string, Record<string, PerformanceLog>>;
  employees: Employee[];
  fleet: FleetItem[];
  equipmentSubtypes: EquipmentSubtypeDefinition[];
  partialTimeOff: Record<string, PartialTimeOff[]>;
  jobberConnected: boolean;
  // Caller-controlled visibility for the Report-a-Repair launcher. App.tsx
  // passes a handler only for worker + foreman roles; admin/manager/mechanic
  // get `undefined` and the button stays hidden. The handler opens the
  // existing ManualTaskModal (the same modal launched from MechanicBoard).
  onReportRepair?: () => void;
}

const numericOr = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const deductHours = (d: unknown): number => {
  if (d == null) return 0;
  if (typeof d === 'number' || typeof d === 'string') return numericOr(d);
  if (typeof d === 'object' && 'hours' in (d as Record<string, unknown>)) {
    return numericOr((d as { hours: unknown }).hours);
  }
  return 0;
};

export default function MyCrewToday({
  today,
  currentUserEmployee,
  schedules,
  performance,
  employees,
  fleet,
  equipmentSubtypes,
  partialTimeOff,
  jobberConnected,
  onReportRepair,
}: MyCrewTodayProps) {
  const myCrews = useMemo<Crew[]>(() => {
    if (!currentUserEmployee) return [];
    const todaysCrews = schedules[today] || [];
    return todaysCrews.filter(c => (c.employees || []).includes(currentUserEmployee.id));
  }, [currentUserEmployee, schedules, today]);

  const tomorrowStr = useMemo(() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }, [today]);

  const scheduledTomorrow = useMemo(() => {
    if (!currentUserEmployee) return false;
    return (schedules[tomorrowStr] || []).some(c => (c.employees || []).includes(currentUserEmployee.id));
  }, [currentUserEmployee, schedules, tomorrowStr]);

  // ---- Tabs + Yesterday data --------------------------------------------
  // ALL HOOKS LIVE ABOVE THE EARLY RETURN. The previous build crashed
  // because a useMemo sat below `if (!currentUserEmployee) return …` — the
  // hook count varied between renders (Rules of Hooks violation), white-
  // screening users whose employee record loaded async. Keeping every hook
  // above the early return makes the order stable for every render.
  const [activeTab, setActiveTab] = useState<'today' | 'yesterday'>('today');

  // Yesterday's Toronto date — safe even if `today` is malformed (the
  // helper returns a best-effort string; downstream code tolerates a
  // bad key by finding no logs).
  const yesterdayDate = useMemo(() => {
    try { return addDaysToronto(today, -1); } catch { return ''; }
  }, [today]);

  // Per-employee efficiency for yesterday using the shared lib (which is a
  // byte-identical copy of Advanced Reporting's empStats formula). Every
  // failure mode — missing user record, missing performance map, missing
  // day entry, missing employeeAH, computation throw — collapses to
  // { eff:null, bh:null, ah:null } which renders the "No performance
  // data" failsafe message rather than crashing.
  const yesterday = useMemo(() => {
    const fallback = { date: yesterdayDate, eff: null as number | null, bh: null as number | null, ah: null as number | null };
    try {
      if (!currentUserEmployee || !currentUserEmployee.id || !yesterdayDate) return fallback;
      const myId = currentUserEmployee.id;
      const dayLogs = (performance && performance[yesterdayDate]) || {};
      const acc: Record<string, EmpEffStat> = {};
      for (const log of Object.values(dayLogs)) {
        if (!log) continue;
        if (log.approvalStatus !== 'approved') continue;
        if (!log.employeeAH || !Object.prototype.hasOwnProperty.call(log.employeeAH, myId)) continue;
        accumulateEmployeeEff(log, acc);
      }
      const stat = acc[myId];
      if (!stat) return fallback;
      const eff = efficiencyPct(stat);
      const bh = Number.isFinite(stat.bh) ? Number(stat.bh.toFixed(1)) : null;
      const ah = Number.isFinite(stat.ah) ? Number(stat.ah.toFixed(1)) : null;
      return { date: yesterdayDate, eff, bh, ah };
    } catch {
      return fallback;
    }
  }, [performance, currentUserEmployee, yesterdayDate]);

  // Defensive date formatter — never throws.
  const readableDate = (ymd: string): string => {
    if (!ymd) return 'yesterday';
    try {
      const d = new Date(`${ymd}T12:00:00`);
      if (Number.isNaN(d.getTime())) return ymd;
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch {
      return ymd;
    }
  };

  const empName = (id: string) => employees.find(e => e.id === id)?.name || 'Unknown';

  if (!currentUserEmployee) {
    return (
      <div className="flex-1 overflow-y-auto bg-gray-100 p-6">
        <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <Users className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <h2 className="text-lg font-bold text-slate-700">No linked employee record</h2>
          <p className="text-sm text-slate-500 mt-2">
            Your sign-in email isn't linked to an Employee record. Ask an admin to link your email in Manage Resources → Personnel.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-100 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-lime-600" /> My Crew Today
          </h2>
          <span className="text-xs text-slate-500 font-medium">{today}</span>
        </div>

        {/* Report-a-Repair launcher — only rendered for worker/foreman
            (App.tsx controls visibility by passing onReportRepair). The
            handler opens the existing ManualTaskModal; no new creation
            flow lives here. Single-line button, prominent but sized to
            sit comfortably above the tab toggle. */}
        {onReportRepair && (
          <button
            type="button"
            onClick={onReportRepair}
            className="w-full mb-4 min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-black uppercase tracking-widest text-white bg-slate-800 hover:bg-slate-900 rounded-xl shadow-sm border border-slate-900/10"
          >
            <Wrench className="w-4 h-4 text-lime-400" />
            Report a Repair
          </button>
        )}

        {/* TAB TOGGLE — Today (existing content) / Yesterday (individual perf) */}
        <div className="flex bg-white rounded-lg p-1 border border-slate-200 shadow-sm mb-4" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'today'}
            onClick={() => setActiveTab('today')}
            className={`flex-1 min-h-[44px] px-3 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'today' ? 'bg-lime-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}
          >Today</button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'yesterday'}
            onClick={() => setActiveTab('yesterday')}
            className={`flex-1 min-h-[44px] px-3 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'yesterday' ? 'bg-lime-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}
          >Yesterday</button>
        </div>

        {activeTab === 'today' ? (
        <>
        {myCrews.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
            <CalendarIcon className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <h3 className="text-lg font-bold text-slate-700">You're not scheduled to a crew today.</h3>
            <p className="text-sm text-slate-500 mt-2">
              {scheduledTomorrow
                ? "You're scheduled on a crew tomorrow — check back then."
                : 'Take it easy. Check the schedule view for upcoming days.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {myCrews.map(crew => {
              const log = performance[today]?.[crew.id];
              const jobs = log?.jobs || [];
              const sumBH = jobs.reduce((s, j) => s + numericOr(j.bh), 0);
              const rawAH = Object.values(log?.employeeAH || {}).reduce<number>(
                (s, v) => s + numericOr(v),
                0,
              );
              const deducAH = Object.values(log?.deductions || {}).reduce<number>(
                (s, v) => s + deductHours(v),
                0,
              );
              const sumAH = Math.max(0, rawAH - deducAH);
              const eff = sumAH > 0 ? Number(((sumBH / sumAH) * 100).toFixed(1)) : null;

              let effColor = 'text-slate-500 bg-slate-100 border-slate-200';
              if (eff != null) {
                if (eff >= 90) effColor = 'text-purple-700 bg-purple-100 border-purple-300';
                else if (eff >= 80) effColor = 'text-emerald-700 bg-emerald-100 border-emerald-300';
                else if (eff >= 70) effColor = 'text-yellow-700 bg-yellow-100 border-yellow-300';
                else effColor = 'text-red-700 bg-red-100 border-red-300';
              }

              const jobberJobs = jobs.filter(j => j.source === 'jobber').length;
              const lastSync = log?.lastJobberSyncAt;

              return (
                <div key={crew.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <div className="text-xs font-black uppercase tracking-widest text-slate-500">Your Crew</div>
                      <div className="text-lg font-bold text-slate-800">
                        {crew.division} #{crew.crewNumber}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {(crew.employees || []).length} {(crew.employees || []).length === 1 ? 'worker' : 'workers'}
                      </div>
                    </div>
                    <div className={`px-4 py-2 rounded-lg border font-bold flex flex-col items-center ${effColor}`}>
                      <span className="text-[10px] uppercase tracking-wide opacity-80 mb-0.5">Efficiency</span>
                      <span className="text-2xl leading-none">{eff != null ? `${eff}%` : '--'}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 divide-x divide-slate-100">
                    <div className="p-4 text-center">
                      <div className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Budget hrs</div>
                      <div className="text-2xl font-bold text-slate-800 mt-1">{sumBH.toFixed(1)}</div>
                      <Target className="w-3.5 h-3.5 text-emerald-300 mx-auto mt-1" />
                    </div>
                    <div className="p-4 text-center">
                      <div className="text-[10px] font-black uppercase tracking-widest text-green-700">Actual hrs</div>
                      <div className="text-2xl font-bold text-slate-800 mt-1">{sumAH.toFixed(1)}</div>
                      <Clock className="w-3.5 h-3.5 text-green-300 mx-auto mt-1" />
                    </div>
                    <div className="p-4 text-center">
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-600">Jobs</div>
                      <div className="text-2xl font-bold text-slate-800 mt-1">{jobs.length}</div>
                      {jobberJobs > 0 && (
                        <div className="text-[10px] text-lime-700 font-bold mt-1 flex items-center justify-center gap-1">
                          <Link2 className="w-3 h-3" /> {jobberJobs} from Jobber
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Fleet + Supplies — read-only mirror of the Schedule
                      board. Uses the same fleetUtils helpers (sortFleetGrouped
                      / fleetItemLabel / isFleetOutOfService) so the format
                      and ordering match Crew Builder exactly. Assignment
                      itself stays in Crew Builder / Schedule. */}
                  {(() => {
                    const crewFleet = (crew.fleet || [])
                      .map(id => fleet.find(f => f.id === id))
                      .filter((f): f is FleetItem => !!f);
                    const sortedFleet = sortFleetGrouped(crewFleet, equipmentSubtypes);
                    const crewSupplies = crew.supplies || [];
                    return (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/50">
                        <div className="bg-white rounded-lg border border-slate-200 p-3">
                          <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-slate-600 mb-2">
                            <Truck className="w-3.5 h-3.5" /> Fleet & Equipment
                          </div>
                          {sortedFleet.length === 0 ? (
                            <div className="text-sm text-slate-400 italic">No equipment assigned.</div>
                          ) : (
                            <ul className="space-y-1.5">
                              {sortedFleet.map(item => {
                                const oos = isFleetOutOfService(item);
                                return (
                                  <li
                                    key={item.id}
                                    className={`flex items-center gap-2 px-2 py-1.5 rounded border text-sm shadow-sm ${oos ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-slate-200 text-slate-800'}`}
                                    title={item.name}
                                  >
                                    {item.color && (
                                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 shadow-sm border border-slate-300 ${item.color}`} />
                                    )}
                                    <span className="font-bold truncate flex-1">{fleetItemLabel(item)}</span>
                                    <span className="text-[10px] font-bold uppercase bg-slate-100 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded shrink-0">
                                      {item.type}
                                    </span>
                                    {oos && (
                                      <span className="text-[10px] font-black uppercase bg-red-100 text-red-700 border border-red-200 px-1.5 py-0.5 rounded shrink-0">
                                        OOS
                                      </span>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>

                        <div className="bg-white rounded-lg border border-slate-200 p-3">
                          <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-slate-600 mb-2">
                            <Hammer className="w-3.5 h-3.5" /> Supplies & Tools
                          </div>
                          {crewSupplies.length === 0 ? (
                            <div className="text-sm text-slate-400 italic">No supplies assigned.</div>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {crewSupplies.map(tool => (
                                <span
                                  key={tool}
                                  className="inline-flex items-center bg-white px-2 py-1 rounded border border-slate-300 text-sm font-bold text-slate-800 shadow-sm"
                                >
                                  {tool}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {jobs.length > 0 && (
                    <details className="border-t border-slate-100">
                      <summary className="cursor-pointer px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
                        Show jobs ({jobs.length})
                      </summary>
                      <ul className="px-4 pb-3 space-y-1">
                        {jobs.map((j, i) => (
                          <li key={i} className="text-sm text-slate-700 flex items-center justify-between gap-2 border-b border-slate-50 last:border-0 py-1">
                            <span className="flex items-center gap-2 truncate">
                              {j.source === 'jobber' && (
                                <span className="text-[9px] font-black uppercase tracking-widest bg-lime-100 text-lime-700 border border-lime-300 px-1.5 py-0.5 rounded">Jobber</span>
                              )}
                              <span className={`truncate ${j.removedFromJobber ? 'line-through text-amber-700' : ''}`}>
                                {j.desc || '(untitled)'}
                              </span>
                            </span>
                            <span className="font-mono font-bold text-emerald-700 shrink-0">{numericOr(j.bh).toFixed(1)} BH</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  <details className="border-t border-slate-100">
                    <summary className="cursor-pointer px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
                      Crew roster ({(crew.employees || []).length})
                    </summary>
                    <ul className="px-4 pb-3 space-y-1">
                      {(crew.employees || []).map(eId => {
                        const pto = (partialTimeOff[today] || []).find(p => p.empId === eId);
                        return (
                          <li key={eId} className="text-sm text-slate-600 flex items-center gap-2 flex-wrap">
                            <span className={`w-1.5 h-1.5 rounded-full ${eId === currentUserEmployee.id ? 'bg-lime-500' : 'bg-slate-300'}`} />
                            {empName(eId)}{eId === currentUserEmployee.id && <span className="text-[10px] text-lime-700 font-bold">(you)</span>}
                            {pto && (
                              <span className="text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-300 px-1.5 py-0.5 rounded">
                                Time off: {formatTimeRange(pto.start, pto.end)}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </details>

                  <div className="bg-amber-50 border-t border-amber-100 px-4 py-2.5 text-[11px] font-medium text-amber-800 flex items-center justify-between gap-2 flex-wrap">
                    <span>
                      Preliminary — final after manager review.{' '}
                      {jobberConnected && lastSync && (
                        <span className="text-slate-500">
                          Last Jobber sync: {new Date(lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </>
        ) : (
          /* YESTERDAY tab — defensive end-to-end. yesterday.* is null
             whenever there's no employee record, no performance map, no
             approved log for the date, no entry for this worker, or the
             computation threw. In all those cases we render the "No
             performance data" message; never NaN, never crash. */
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">Your Performance — Yesterday</div>
            {yesterday.eff != null && yesterday.bh != null && yesterday.ah != null ? (
              <>
                <div className="text-sm font-medium text-slate-600 mb-3">{readableDate(yesterday.date)}</div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Efficiency</div>
                    <div className="text-2xl font-bold text-slate-800 mt-1">{yesterday.eff}%</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Budget hrs</div>
                    <div className="text-2xl font-bold text-slate-800 mt-1">{yesterday.bh.toFixed(1)}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="text-[10px] font-black uppercase tracking-widest text-green-700">Actual hrs</div>
                    <div className="text-2xl font-bold text-slate-800 mt-1">{yesterday.ah.toFixed(1)}</div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 italic mt-3 leading-snug">
                  Efficiency updates after your crew clocks out in Jobber and visits are marked complete. Numbers may be incomplete if the day isn't fully closed out.
                </p>
              </>
            ) : (
              <div className="text-center py-6">
                <CalendarIcon className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <p className="text-sm text-slate-500 font-medium">No performance data for {readableDate(yesterday.date)}.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

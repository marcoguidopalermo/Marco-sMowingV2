import { useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Calendar as CalendarIcon, Target, Clock, TrendingUp, Link2, Users, Truck, Hammer, Wrench, AlertCircle, AlertTriangle, CheckCircle, FileText } from 'lucide-react';
import { AppSettings, Crew, Employee, FleetItem, EquipmentSubtypeDefinition, PerformanceLog, PartialTimeOff, Inspection, HoursBankEntry } from '../types';
import { formatTimeRange, addDaysToronto } from '../lib/dateUtils';
import { personColorClass } from '../lib/personColor';
import { sortFleetGrouped, fleetItemLabel, isFleetOutOfService } from '../lib/fleetUtils';
import { accumulateEmployeeEff, efficiencyPct, EmpEffStat } from '../lib/efficiency';
import { isHourMaintenanceUnit } from '../lib/maintenanceUtils';
import { computeMonthlyStreaks, crewDayHasFlame, crewKeyOf } from '../lib/crewGamification';
import type { ActiveInspectionState } from './InspectionModal';
import TopCrewSpotlight from './TopCrewSpotlight';
import MtdSelfWidget from './MtdSelfWidget';
import DivisionStandings from './DivisionStandings';
import { MyHoursBank } from './HoursBank';
import { scanOutstandingCrewDays, managerCoversDivision } from '../lib/approvalOversight';

interface MyCrewTodayProps {
  // The signed-in person's own hours-bank entries, if they have any. Passed
  // pre-filtered: this screen never sees anybody else's ledger.
  myHoursBank?: HoursBankEntry[];
  today: string;
  currentUserEmployee: Employee | null;
  schedules: Record<string, Crew[]>;
  performance: Record<string, Record<string, PerformanceLog>>;
  employees: Employee[];
  fleet: FleetItem[];
  equipmentSubtypes: EquipmentSubtypeDefinition[];
  partialTimeOff: Record<string, PartialTimeOff[]>;
  jobberConnected: boolean;
  settings?: AppSettings | null;
  // Caller-controlled visibility for the Report-a-Repair launcher. App.tsx
  // passes a handler only for worker + foreman roles; admin/manager/mechanic
  // get `undefined` and the button stays hidden. The handler opens the
  // existing ManualTaskModal (the same modal launched from MechanicBoard).
  onReportRepair?: () => void;
  // Inspection access — App owns the modal state. Passing the setter
  // and the inspection list lets each fleet row open the same global
  // InspectionModal / InspectionReportModal that ScheduleBoard uses,
  // so workers can DVIR/CircleCheck or capture engine hours without
  // leaving My Crew Today. Optional: omit on roles/views where
  // inspections aren't relevant.
  setActiveInspection?: Dispatch<SetStateAction<ActiveInspectionState>>;
  setViewingInspectionId?: (id: string) => void;
  inspections?: Inspection[];
  // One-tap access to a unit's documents (view-only for workers). Opens the
  // App-level UnitDocumentsModal. Omit to hide the documents affordance.
  onOpenUnitDocuments?: (unitId: string) => void;
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
  myHoursBank,
  currentUserEmployee,
  schedules,
  performance,
  employees,
  fleet,
  equipmentSubtypes,
  partialTimeOff,
  jobberConnected,
  settings,
  onReportRepair,
  setActiveInspection,
  setViewingInspectionId,
  inspections,
  onOpenUnitDocuments,
}: MyCrewTodayProps) {
  const myCrews = useMemo<Crew[]>(() => {
    if (!currentUserEmployee) return [];
    const todaysCrews = schedules[today] || [];
    return todaysCrews.filter(c => (c.employees || []).includes(currentUserEmployee.id));
  }, [currentUserEmployee, schedules, today]);

  // 🔥/🔆 gamification (display-only, single-source approved math). testUserIds
  // matches the board so the crew sees the same numbers; streaks read only the
  // current month's loaded performance.
  const testUserIds = useMemo(() => new Set((employees || []).filter(e => e.isTestUser).map(e => e.id)), [employees]);
  const crewStreaks = useMemo(() => computeMonthlyStreaks(performance, today, testUserIds), [performance, today, testUserIds]);

  const tomorrowStr = useMemo(() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }, [today]);

  const scheduledTomorrow = useMemo(() => {
    if (!currentUserEmployee) return false;
    return (schedules[tomorrowStr] || []).some(c => (c.employees || []).includes(currentUserEmployee.id));
  }, [currentUserEmployee, schedules, tomorrowStr]);

  // The viewer's DIVISION for the day. When on more than one crew,
  // pick the crew where they worked the MOST hours (highest net AH
  // today); ties fall to the first crew (myCrews preserves schedule
  // order). That crew's division scopes every division widget below.
  // Also expose the stable crew key ("<division-lower>-<crewNumber>")
  // so the standings board can highlight the viewer's own crew.
  const { targetDivision, myCrewKey } = useMemo<{
    targetDivision: string | null;
    myCrewKey: string | null;
  }>(() => {
    if (myCrews.length === 0) return { targetDivision: null, myCrewKey: null };
    const crewAH = (crew: Crew): number => {
      const log = performance[today]?.[crew.id];
      const rawAH = Object.values(log?.employeeAH || {}).reduce<number>(
        (s, v) => s + numericOr(v), 0,
      );
      const deducAH = Object.values(log?.deductions || {}).reduce<number>(
        (s, v) => s + deductHours(v), 0,
      );
      return Math.max(0, rawAH - deducAH);
    };
    let best = myCrews[0];
    let bestAH = crewAH(best);
    for (let i = 1; i < myCrews.length; i++) {
      const ah = crewAH(myCrews[i]);
      if (ah > bestAH) { best = myCrews[i]; bestAH = ah; }
    }
    return {
      targetDivision: best.division,
      myCrewKey: `${(best.division || '').toLowerCase()}-${best.crewNumber}`,
    };
  }, [myCrews, performance, today]);

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
  // Identity colour for a roster member's dot (assigned colour → hash fallback).
  const empDot = (id: string) => {
    const e = employees.find(x => x.id === id);
    return personColorClass(e?.color, e?.linkedUserEmail || e?.email || id);
  };

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

        {/* HOURS BANK — their own, read-only, collapsed to the balance.
            Renders nothing at all when they have no ledger: an account nobody
            has banked into is not information. */}
        {!!myHoursBank?.length && (
          <div className="mb-4">
            <MyHoursBank entries={myHoursBank} collapsible />
          </div>
        )}

        {/* MANAGER REMINDER — division managers see a nudge when their
            division has crew-days from the past week still neither
            approved nor waived. Read-derived; only renders for a user
            with a managedDivision (i.e. a division manager). */}
        {currentUserEmployee.managedDivision && (() => {
          const recent = scanOutstandingCrewDays(performance, today, 7)
            .filter(o => managerCoversDivision(currentUserEmployee.managedDivision, o.division));
          if (recent.length === 0) return null;
          const dayCount = new Set(recent.map(o => o.date)).size;
          return (
            <div className="w-full mb-4 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-amber-900">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <span className="font-bold">You have {recent.length} unapproved crew-day{recent.length === 1 ? '' : 's'}</span>
                {' '}from the past week (across {dayCount} day{dayCount === 1 ? '' : 's'}). Approve or waive them in Performance.
              </span>
            </div>
          );
        })()}

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

        {/* TOP CREW SPOTLIGHT — the viewer's DIVISION leader for the
            selected day (division-wide bonus structure). Falls back to
            company-wide only if the viewer isn't on a crew today (no
            division to scope to). Live dot pulses while activeTab ===
            'today'; yesterday view shows the final standing with no dot. */}
        <TopCrewSpotlight
          date={activeTab === 'today' ? today : yesterdayDate}
          live={activeTab === 'today'}
          schedules={schedules}
          performance={performance}
          employees={employees}
          settings={settings}
          division={targetDivision || undefined}
        />

        {/* Month-to-date — the viewer's DIVISION totals (division BH +
            division adjusted efficiency, the bonus-relevant number) +
            the signed-in user's own BH share. Never surfaces other
            individuals' numbers. Falls back to company-wide when the
            viewer has no division today. */}
        <MtdSelfWidget
          today={today}
          currentUserEmployee={currentUserEmployee}
          schedules={schedules}
          performance={performance}
          employees={employees}
          settings={settings}
          division={targetDivision || undefined}
        />

        {/* DIVISION STANDINGS — every crew in the viewer's division
            ranked by MTD adjusted efficiency (the bonus number). Only
            shown when the viewer has a division today. */}
        {targetDivision && (
          <DivisionStandings
            today={today}
            division={targetDivision}
            schedules={schedules}
            performance={performance}
            employees={employees}
            settings={settings}
            highlightCrewKey={myCrewKey}
          />
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
                      {(() => {
                        // Flame reflects THIS crew's approved day today; streak is
                        // the crew's monthly consistency. Both read approved math.
                        const crewLog = performance[today]?.[crew.id];
                        const flame = crewDayHasFlame(crewLog, testUserIds);
                        const streak = crewStreaks[crewKeyOf(crew)] || 0;
                        if (!flame && streak === 0) return null;
                        return (
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            {flame && (
                              <span title="100%+ — hit budget" className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-orange-700 bg-orange-100 border border-orange-300 px-2 py-0.5 rounded-full">🔥 On fire</span>
                            )}
                            {streak > 0 && (
                              <span title={`${streak} approved day${streak === 1 ? '' : 's'} ≥80% this month`} className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${streak >= 20 ? 'bg-violet-100 text-violet-700 border-violet-300' : streak >= 10 ? 'bg-amber-100 text-amber-700 border-amber-300' : streak >= 5 ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>🔆 {streak} days ≥80%</span>
                            )}
                          </div>
                        );
                      })()}
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

                  {/* Today's truck + trailer — roadside document access.
                      One tap → that unit's insurance / registration / etc.
                      Only renders when a truck or trailer is assigned today
                      (no empty-state noise). Worker access is view-only. */}
                  {onOpenUnitDocuments && (() => {
                    const rolling = (crew.fleet || [])
                      .map(id => fleet.find(f => f.id === id))
                      .filter((f): f is FleetItem => !!f && (f.type === 'truck' || f.type === 'trailer'));
                    if (rolling.length === 0) return null;
                    return (
                      <div className="px-4 py-2.5 border-t border-slate-100 bg-white flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> Docs</span>
                        {rolling.map(item => (
                          <button
                            key={item.id}
                            onClick={() => onOpenUnitDocuments(item.id)}
                            title={`View ${item.name} documents (insurance, registration…)`}
                            className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 active:bg-slate-700"
                          >
                            {item.type === 'truck' ? <Truck className="w-4 h-4" /> : <Hammer className="w-4 h-4" />}
                            {fleetItemLabel(item)}
                          </button>
                        ))}
                      </div>
                    );
                  })()}

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
                                // Mirror of the ScheduleBoard inspection
                                // affordance: hour-tracked equipment +
                                // every non-equipment surface the Inspect
                                // button (when no inspection on this date)
                                // or a compact status icon (when one
                                // exists). Mowers/equipment without
                                // tracksEngineHours stay hidden — same
                                // rule as the schedule.
                                const canInspect = item.type !== 'equipment' || isHourMaintenanceUnit(item);
                                const todayInsp = canInspect && inspections
                                  ? inspections.find(i => i.unitId === item.id && i.date === today)
                                  : undefined;
                                const inspBadge = canInspect && todayInsp ? (() => {
                                  const status = todayInsp.status;
                                  const config = status === 'major'
                                    ? { cls: 'bg-red-100 text-red-700 ring-red-200 hover:bg-red-200', Icon: AlertCircle, title: 'Major defect — tap to view inspection' }
                                    : status === 'minor'
                                      ? { cls: 'bg-yellow-100 text-yellow-700 ring-yellow-200 hover:bg-yellow-200', Icon: AlertTriangle, title: 'Minor defect — tap to view inspection' }
                                      : { cls: 'bg-emerald-100 text-emerald-700 ring-emerald-200 hover:bg-emerald-200', Icon: CheckCircle, title: 'Inspected — tap to view inspection' };
                                  return config;
                                })() : null;
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
                                    {canInspect && !todayInsp && setActiveInspection && (
                                      <button
                                        onClick={() => setActiveInspection({ unitId: item.id, targetDate: today, defects: [], expandedCategory: null, draftSeverity: 'minor', draftNotes: '' })}
                                        className="text-[10px] font-black bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded uppercase hover:bg-blue-100 transition-colors shrink-0"
                                      >Inspect</button>
                                    )}
                                    {inspBadge && setViewingInspectionId && todayInsp && (
                                      <button
                                        onClick={() => setViewingInspectionId(todayInsp.id)}
                                        className={`p-1 rounded-full ring-1 shadow-sm transition-colors shrink-0 ${inspBadge.cls}`}
                                        title={inspBadge.title}
                                        aria-label={inspBadge.title}
                                      >
                                        <inspBadge.Icon className="w-3.5 h-3.5" />
                                      </button>
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
                            <span className={`w-2 h-2 rounded-full shadow-sm ${eId === currentUserEmployee.id ? 'bg-lime-500 ring-1 ring-lime-300' : empDot(eId)}`} />
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

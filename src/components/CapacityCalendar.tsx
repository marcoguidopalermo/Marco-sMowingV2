// CAPACITY — two purpose-built tools behind one switch, mounted from the
// SalesMaster tab (defaults to BOOKING) and the schedule board (defaults to
// SCHEDULE BALANCE).
//
//   BOOKING          division-level, rolling 4 weeks, booked vs a DECLARED
//                    weekly number. Answers "should we be selling more?"
//   SCHEDULE BALANCE crew-level, current + next week, week totals against a
//                    headcount ceiling. Answers "is any crew overbooked, and
//                    did we schedule this right?"
//
// Forward, READ-ONLY. The only thing written is the capacity SETTINGS, via
// the same shared editor Manage Resources hosts.
import { useMemo, useState } from 'react';
import {
  CalendarRange, RefreshCw, AlertTriangle, Info, Users, X, Clock, HelpCircle,
  Sliders, Scale, AlertOctagon,
} from 'lucide-react';
import type {
  AppData, AppSettings, CapacityForecast, CapacityScope, CapacitySettings, Employee,
} from '../types';
import CapacitySettingsPanel from './CapacitySettingsPanel';
import {
  buildBookingModel, buildBalanceModel, capacityOrDefault, mergeSlices, BAND_META,
  longDate, dayLabel, UNATTRIBUTED,
  type CapacityBand, type BookingCell, type BookingRow, type CapacityWeek,
  type ForwardSlice, type BalanceCrewRow,
} from '../lib/capacity';
import { formatTodayInToronto } from '../lib/dateUtils';
import { DIVISIONS } from '../constants';

export type CapacityTool = 'booking' | 'balance';

interface Props {
  appData: AppData;
  forecasts: Record<CapacityScope, CapacityForecast | null>;
  isAdmin: boolean;
  currentUserEmployee: Employee | null;
  onRefresh?: (scope: CapacityScope) => Promise<void>;
  canRefresh?: boolean;
  onSaveSettings?: (next: CapacitySettings) => Promise<void>;
  // Which tool this mount opens on. Sales opens on Booking, the board on
  // Schedule Balance — each entry point lands on the question it's about.
  defaultTool?: CapacityTool;
  variant?: 'page' | 'board';
}

// ── Band styling. The two reds are deliberately opposite in WEIGHT as well as
// hue: underbooked is a hollow dashed outline (an empty slot you can sell
// into); overbooked is a solid heavy block (a wall you can't push past).
const BAND_STYLE: Record<CapacityBand, { cell: string; bar: string; track: string; text: string }> = {
  under: {
    cell: 'bg-rose-50 border-2 border-dashed border-rose-400',
    bar: 'bg-rose-300', track: 'bg-rose-100', text: 'text-rose-800',
  },
  light: {
    cell: 'bg-amber-50 border border-amber-300',
    bar: 'bg-amber-400', track: 'bg-amber-100', text: 'text-amber-900',
  },
  healthy: {
    cell: 'bg-emerald-50 border border-emerald-300',
    bar: 'bg-emerald-500', track: 'bg-emerald-100', text: 'text-emerald-900',
  },
  over: {
    cell: 'bg-red-900 border border-red-950 shadow-inner',
    bar: 'bg-white', track: 'bg-red-800', text: 'text-white',
  },
};
const NO_CAP_STYLE = {
  cell: 'bg-slate-50 border border-slate-200',
  bar: 'bg-slate-300', track: 'bg-slate-200', text: 'text-slate-700',
};
// A week the pull never reached — NOT zero, NOT open.
const UNCOVERED_STYLE = {
  cell: 'bg-slate-100 border border-dashed border-slate-300',
  text: 'text-slate-400',
};

const styleFor = (band: CapacityBand | null) => (band ? BAND_STYLE[band] : NO_CAP_STYLE);
const bh = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold">
      <span className="text-slate-400 uppercase tracking-widest">Legend</span>
      <span className={`px-2 py-1 rounded ${BAND_STYLE.under.cell} ${BAND_STYLE.under.text}`}>
        &lt;70% UNDERBOOKED — sell into it
      </span>
      <span className={`px-2 py-1 rounded ${BAND_STYLE.light.cell} ${BAND_STYLE.light.text}`}>70–90% LIGHT</span>
      <span className={`px-2 py-1 rounded ${BAND_STYLE.healthy.cell} ${BAND_STYLE.healthy.text}`}>90–110% HEALTHY</span>
      <span className={`px-2 py-1 rounded inline-flex items-center gap-1 ${BAND_STYLE.over.cell} ${BAND_STYLE.over.text}`}>
        <AlertTriangle className="w-3 h-3" /> &gt;110% OVERBOOKED — can&apos;t deliver
      </span>
      <span className={`px-2 py-1 rounded ${NO_CAP_STYLE.cell} ${NO_CAP_STYLE.text}`}>no capacity declared — raw BH</span>
      <span className={`px-2 py-1 rounded ${UNCOVERED_STYLE.cell} ${UNCOVERED_STYLE.text}`}>
        not pulled — NOT an open week
      </span>
    </div>
  );
}

function BookingWeekCell({ cell, week, active, onClick }: {
  cell: BookingCell; week: CapacityWeek; active: boolean; onClick: () => void;
}) {
  if (cell.uncovered) {
    return (
      <button type="button" onClick={onClick}
        aria-label={`Week ${week.rangeLabel}: not pulled`}
        className={`w-full text-left rounded-lg p-3 ${UNCOVERED_STYLE.cell} ${active ? 'ring-2 ring-slate-800' : ''}`}>
        <div className={`text-lg font-black ${UNCOVERED_STYLE.text}`}>—</div>
        <div className={`text-[9px] font-black uppercase tracking-widest mt-1 ${UNCOVERED_STYLE.text}`}>not pulled</div>
      </button>
    );
  }
  const s = styleFor(cell.band);
  const pct = cell.pct;
  return (
    <button type="button" onClick={onClick}
      aria-label={`Week ${week.rangeLabel}: ${bh(cell.bh)} booked of ${cell.capacity === null ? 'undeclared' : bh(cell.capacity)}`}
      className={`w-full text-left rounded-lg p-3 transition-shadow ${s.cell} ${active ? 'ring-2 ring-slate-800 ring-offset-1' : 'hover:shadow-md'}`}>
      <div className="flex items-baseline justify-between gap-1">
        <span className={`text-2xl font-black tabular-nums ${s.text}`}>{bh(cell.bh)}</span>
        <span className={`text-[11px] font-bold tabular-nums opacity-80 ${s.text}`}>
          / {cell.capacity === null ? '—' : bh(cell.capacity)}
        </span>
      </div>
      <div className={`text-[9px] font-black uppercase tracking-widest opacity-60 ${s.text}`}>booked / declared</div>
      <div className={`h-2 rounded-full mt-2 overflow-hidden ${s.track}`}>
        {pct !== null && <div className={`h-full ${s.bar}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />}
      </div>
      <div className="flex items-center justify-between gap-1 mt-1.5">
        <span className={`text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-0.5 ${s.text}`}>
          {cell.band === 'over' && <AlertTriangle className="w-3 h-3" />}
          {cell.band ? BAND_META[cell.band].label : 'NO TARGET'}
        </span>
        {pct !== null && <span className={`text-sm font-black tabular-nums ${s.text}`}>{pct}%</span>}
      </div>
      {(cell.hourlyCount > 0 || cell.untaggedCount > 0) && (
        <div className={`text-[9px] font-bold mt-1 opacity-80 ${s.text}`}>
          {cell.hourlyCount > 0 && `${cell.hourlyCount} hourly`}
          {cell.hourlyCount > 0 && cell.untaggedCount > 0 && ' · '}
          {cell.untaggedCount > 0 && `${cell.untaggedCount} untagged`}
        </div>
      )}
    </button>
  );
}

function JobList({ jobs }: { jobs: ForwardSlice[] }) {
  const merged = mergeSlices(jobs);
  if (merged.length === 0) return <p className="text-sm text-slate-500">Nothing scheduled here.</p>;
  return (
    <div className="divide-y divide-slate-100">
      {merged.map(j => (
        <div key={j.visitId} className="py-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-bold text-slate-800 text-sm truncate">{j.client || 'No client name'}</div>
            <div className="text-xs text-slate-500 truncate">{j.desc}{j.jobNumber ? ` · #${j.jobNumber}` : ''}</div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className="text-[10px] font-bold text-slate-500">
                {j.multiDay ? `${longDate(j.startDate)} → ${longDate(j.endDate)}` : longDate(j.startDate)}
              </span>
              {j.multiDay && (
                <span className="text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded">
                  multi-day · {bh(j.totalRemaining)} BH left
                </span>
              )}
              {j.creditedBH > 0 && (
                <span className="text-[9px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded">
                  {bh(j.creditedBH)} BH already credited
                </span>
              )}
              {j.isHourly && (
                <span className="text-[9px] font-black uppercase tracking-widest bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5" /> hourly — no forward BH
                </span>
              )}
              {j.untagged && (
                <span className="text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded">
                  no [BH] tag — load unknown
                </span>
              )}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 truncate">
              {j.assigneeNames.length > 0 ? j.assigneeNames.join(', ') : 'no assignee on the visit'}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-lg font-black text-slate-900 tabular-nums">{bh(j.bh)}</div>
            <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">BH</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CapacityCalendar({
  appData, forecasts, isAdmin, currentUserEmployee, onRefresh, canRefresh,
  onSaveSettings, defaultTool = 'booking', variant = 'page',
}: Props) {
  const today = formatTodayInToronto();
  const snapshots = useMemo(
    () => [forecasts.projects, forecasts.lawn].filter(Boolean) as CapacityForecast[],
    [forecasts.projects, forecasts.lawn],
  );
  const settings = useMemo(() => capacityOrDefault(appData.settings?.capacity), [appData.settings?.capacity]);

  const [tool, setTool] = useState<CapacityTool>(defaultTool);
  const [drill, setDrill] = useState<{ rowKey: string; weekStart: string } | null>(null);
  const [dayDrill, setDayDrill] = useState<{ crewKey: string; date: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyScope, setBusyScope] = useState<CapacityScope | null>(null);

  // A division manager sees their own division; admins see everything.
  const managed = currentUserEmployee?.managedDivision;
  const ownDivision = !isAdmin && managed === 'lawn' ? 'Lawn Division'
    : !isAdmin && managed === 'small' ? 'Small Projects'
      : !isAdmin && managed === 'large' ? 'Large Projects' : null;
  // LAWN AND PROJECTS STAY SEPARATE on both tools. Lawn is a recurring route
  // and projects are one-off builds — mixing them in one grid makes neither
  // legible, and they're pulled as separate snapshots for the same reason.
  const isLawnDivision = (d: string) => /lawn/i.test(d);
  const [scope, setScope] = useState<CapacityScope>(
    ownDivision && isLawnDivision(ownDivision) ? 'lawn' : 'projects');
  const [division, setDivision] = useState<string>(ownDivision || 'All');
  // Divisions available inside the current scope — a manager stays pinned to
  // their own regardless.
  const scopeDivisions = useMemo(
    () => DIVISIONS.filter(d => (isLawnDivision(d) ? 'lawn' : 'projects') === scope),
    [scope],
  );

  const canEditSettings = isAdmin && !!onSaveSettings;
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState<AppSettings>(appData.settings || {});
  const [saving, setSaving] = useState(false);
  const openSettings = () => { setDraft(appData.settings || {}); setShowSettings(true); };
  const saveSettings = async () => {
    if (!onSaveSettings || saving) return;
    setSaving(true);
    try {
      await onSaveSettings(capacityOrDefault(draft.capacity));
      setShowSettings(false);
    } finally { setSaving(false); }
  };

  const booking = useMemo(() => buildBookingModel({
    snapshots,
    schedules: appData.schedules || {},
    multiDayJobs: appData.multiDayJobs,
    settings,
    today,
  }), [snapshots, appData.schedules, appData.multiDayJobs, settings, today]);

  const balance = useMemo(() => buildBalanceModel({
    snapshots,
    appData,
    multiDayJobs: appData.multiDayJobs,
    settings,
    today,
  }), [snapshots, appData, settings, today]);

  const refresh = async (scope: CapacityScope) => {
    if (!onRefresh || busy) return;
    setBusy(true); setBusyScope(scope);
    try { await onRefresh(scope); } finally { setBusy(false); setBusyScope(null); }
  };

  const inScope = (d: string) => (isLawnDivision(d) ? 'lawn' : 'projects') === scope;
  const visibleRows = useMemo(
    () => booking.rows.filter(r => inScope(r.division) && (division === 'All' || r.division === division)),
    [booking.rows, division, scope],
  );
  const visibleCrews = useMemo(
    () => balance.crews.filter(c => inScope(c.division) && (division === 'All' || c.division === division)),
    [balance.crews, division, scope],
  );

  const drillCell = useMemo(() => {
    if (!drill) return null;
    const all: BookingRow[] = [...booking.rows, ...(booking.unattributed ? [booking.unattributed] : [])];
    const row = all.find(r => r.division === drill.rowKey);
    if (!row) return null;
    const i = booking.weeks.findIndex(w => w.start === drill.weekStart);
    if (i < 0) return null;
    return { row, cell: row.cells[i], week: booking.weeks[i] };
  }, [drill, booking]);

  const dayCell = useMemo(() => {
    if (!dayDrill) return null;
    const crew = balance.crews.find(c => c.key === dayDrill.crewKey);
    if (!crew) return null;
    for (const w of crew.weeks) {
      const d = w.days.find(x => x.date === dayDrill.date);
      if (d) return { crew, day: d };
    }
    return null;
  }, [dayDrill, balance]);

  const hasForecast = snapshots.length > 0;

  return (
    <div className={variant === 'board' ? 'p-4 md:p-6 space-y-4' : 'space-y-4'}>
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {tool === 'booking'
              ? <CalendarRange className="w-5 h-5 text-slate-700" />
              : <Scale className="w-5 h-5 text-slate-700" />}
            <h3 className="text-lg font-black text-slate-900">
              {tool === 'booking' ? 'Booking' : 'Schedule balance'}
            </h3>
            {tool === 'balance' && (
              <span className="text-[10px] font-black uppercase tracking-widest bg-yellow-300 text-yellow-900 border border-yellow-500 px-1.5 py-0.5 rounded">
                Beta
              </span>
            )}
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              {tool === 'booking' ? 'should we be selling more?' : 'is any crew overbooked?'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-slate-100 rounded-lg p-1">
              <button type="button" onClick={() => { setTool('booking'); setDrill(null); setDayDrill(null); }}
                className={`px-3 py-1.5 text-xs font-black rounded uppercase ${tool === 'booking' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>
                Booking
              </button>
              <button type="button" onClick={() => { setTool('balance'); setDrill(null); setDayDrill(null); }}
                className={`px-3 py-1.5 text-xs font-black rounded uppercase inline-flex items-center gap-1 ${tool === 'balance' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>
                Schedule balance
                <span className="text-[8px] font-black uppercase bg-yellow-300 text-yellow-900 border border-yellow-500 px-1 rounded">Beta</span>
              </button>
            </div>
            {/* SCOPE — lawn and projects never share a grid. */}
            {!ownDivision && (
              <div className="flex bg-slate-100 rounded-lg p-1">
                {(['projects', 'lawn'] as CapacityScope[]).map(sc => (
                  <button key={sc} type="button"
                    onClick={() => { setScope(sc); setDivision('All'); setDrill(null); setDayDrill(null); }}
                    className={`px-3 py-1.5 text-xs font-black rounded uppercase ${scope === sc ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>
                    {sc === 'projects' ? 'Projects' : 'Lawn'}
                  </button>
                ))}
              </div>
            )}
            {isAdmin && scopeDivisions.length > 1 && (
              <select value={division} onChange={e => { setDivision(e.target.value); setDrill(null); setDayDrill(null); }}
                className="text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg px-2 py-2 outline-none">
                <option value="All">All {scope === 'lawn' ? 'lawn' : 'project'} divisions</option>
                {scopeDivisions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            {canRefresh && onRefresh && (
              <div className="inline-flex rounded-lg overflow-hidden border border-slate-800">
                <button type="button" onClick={() => refresh('projects')} disabled={busy}
                  title="Re-pull Large + Small Projects"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase tracking-widest bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${busy && busyScope === 'projects' ? 'animate-spin' : ''}`} />
                  {busy && busyScope === 'projects' ? 'Pulling' : 'Projects'}
                </button>
                <button type="button" onClick={() => refresh('lawn')} disabled={busy}
                  title="Re-pull the lawn route"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase tracking-widest bg-white text-slate-700 border-l border-slate-800 hover:bg-slate-100 disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${busy && busyScope === 'lawn' ? 'animate-spin' : ''}`} />
                  {busy && busyScope === 'lawn' ? 'Pulling' : 'Lawn'}
                </button>
              </div>
            )}
            {canEditSettings && (
              <button type="button" onClick={() => (showSettings ? setShowSettings(false) : openSettings())}
                aria-expanded={showSettings}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase tracking-widest rounded-lg border ${showSettings ? 'bg-slate-800 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
                <Sliders className="w-3.5 h-3.5" /> Settings
              </button>
            )}
          </div>
        </div>

        {tool === 'booking' && <Legend />}

        <div className="flex items-start gap-2 text-[11px] text-slate-500 border-t border-slate-100 pt-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
          <p>
            Reflects work <strong>scheduled in Jobber</strong> — won-but-unscheduled work doesn&apos;t
            appear, so an empty week may not be truly open.{' '}
            {(['projects', 'lawn'] as CapacityScope[]).map(scope => {
              const f = forecasts[scope];
              const label = scope === 'projects' ? 'Projects' : 'Lawn';
              if (!f) return <span key={scope} className="mr-2">{label}: <strong>not pulled yet</strong>.</span>;
              return (
                <span key={scope} className="mr-2">
                  {label} updated {new Date(f.generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.
                </span>
              );
            })}
          </p>
        </div>
      </div>

      {showSettings && canEditSettings && (
        <div className="space-y-3">
          <CapacitySettingsPanel settings={draft} setSettings={setDraft} isAdmin={isAdmin} />
          <div className="flex items-center gap-2">
            <button type="button" onClick={saveSettings} disabled={saving}
              className="px-4 py-2 text-xs font-black uppercase tracking-widest bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save capacity settings'}
            </button>
            <button type="button" onClick={() => setShowSettings(false)}
              className="px-3 py-2 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-800">Cancel</button>
            <span className="text-[10px] font-bold text-slate-400">Also in Manage Resources → App Settings.</span>
          </div>
        </div>
      )}

      {!hasForecast && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center space-y-2">
          <HelpCircle className="w-6 h-6 text-slate-300 mx-auto" />
          <p className="text-sm font-bold text-slate-700">No forecast pulled yet.</p>
          <p className="text-xs text-slate-500">
            The forward pull runs on its own schedule.{canRefresh ? ' Hit Refresh to pull it now.' : ' Check back shortly.'}
          </p>
        </div>
      )}

      {/* ══ TOOL 1: BOOKING ══════════════════════════════════════════════ */}
      {hasForecast && tool === 'booking' && (
        <>
          {/* BOOKED OUT TO — the number said on a phone call, and the most
              prominent thing on this screen by design. */}
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {visibleRows.map(row => (
              <div key={row.division} className={`rounded-2xl border-2 shadow-sm p-4 ${row.bookedOutTo ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200'}`}>
                <div className={`text-[10px] font-black uppercase tracking-widest ${row.bookedOutTo ? 'text-white/60' : 'text-slate-400'}`}>
                  {row.division} — booked out to
                </div>
                {row.bookedOutTo ? (
                  <>
                    <div className="text-3xl font-black leading-tight mt-0.5">{longDate(row.bookedOutTo)}</div>
                    <div className="text-[11px] font-bold text-white/60">
                      week of {row.bookedOutWeek && longDate(row.bookedOutWeek)} · {bh(row.totalBH)} BH booked in view
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-3xl font-black leading-tight mt-0.5 text-slate-400">Nothing booked</div>
                    <div className="text-[11px] font-bold text-slate-400">
                      {row.declared === null ? 'no weekly capacity declared' : `${bh(row.totalBH)} BH in view`}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 md:p-4 space-y-4 overflow-x-auto">
            {visibleRows.length === 0 && (
              <p className="text-sm text-slate-500 py-6 text-center">No divisions to show.</p>
            )}
            {visibleRows.map(row => (
              <div key={row.division} className="space-y-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-black text-slate-900">{row.division}</span>
                  {/* THE BASIS. Not just the number but the reasoning behind
                      it, so when it needs adjusting it's obvious what to
                      change — and obvious that it was declared, not derived. */}
                  <span className={`text-[10px] font-bold ${row.declared === null ? 'text-amber-700' : 'text-slate-400'}`}>
                    {row.declared === null ? 'capacity not set — showing raw BH' : row.declaredBasis}
                  </span>
                  {canEditSettings && (
                    <button type="button" onClick={openSettings}
                      className="text-[10px] font-black uppercase tracking-widest text-slate-600 underline hover:text-slate-900">
                      {row.declared === null ? 'set it' : 'adjust'}
                    </button>
                  )}
                </div>
                <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
                  {booking.weeks.map((week, i) => (
                    <div key={week.start}>
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                        {i === 0 ? 'This week' : week.rangeLabel}
                      </div>
                      <BookingWeekCell
                        cell={row.cells[i]} week={week}
                        active={!!drill && drill.rowKey === row.division && drill.weekStart === week.start}
                        onClick={() => setDrill(prev => (prev && prev.rowKey === row.division && prev.weekStart === week.start
                          ? null : { rowKey: row.division, weekStart: week.start }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {booking.unattributed && division === 'All' && scope === 'projects' && (
              <div className="space-y-2 border-t border-slate-200 pt-3">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">
                    Unattributed — {bh(booking.unattributed.totalBH)} BH whose Jobber assignee maps to no division
                  </span>
                </div>
                <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
                  {booking.weeks.map((week, i) => (
                    <BookingWeekCell key={week.start}
                      cell={booking.unattributed!.cells[i]} week={week}
                      active={!!drill && drill.rowKey === UNATTRIBUTED && drill.weekStart === week.start}
                      onClick={() => setDrill(prev => (prev && prev.rowKey === UNATTRIBUTED && prev.weekStart === week.start
                        ? null : { rowKey: UNATTRIBUTED, weekStart: week.start }))}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {drillCell && (
            <div className="bg-white rounded-2xl border-2 border-slate-800 shadow-lg p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    {drillCell.row.division} · week {drillCell.week.rangeLabel}
                  </div>
                  <div className="text-xl font-black text-slate-900">
                    {bh(drillCell.cell.bh)} BH
                    {drillCell.cell.pct !== null && (
                      <span className="text-sm font-bold text-slate-500 ml-2">
                        {drillCell.cell.pct}% of {bh(drillCell.cell.capacity || 0)} declared
                        {drillCell.cell.band && ` · ${BAND_META[drillCell.cell.band].meaning} — ${BAND_META[drillCell.cell.band].action}`}
                      </span>
                    )}
                  </div>
                </div>
                <button type="button" onClick={() => setDrill(null)} className="p-1.5 text-slate-400 hover:text-slate-800" aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <JobList jobs={drillCell.cell.jobs} />
            </div>
          )}
        </>
      )}

      {/* ══ TOOL 2: SCHEDULE BALANCE ═════════════════════════════════════ */}
      {hasForecast && tool === 'balance' && (
        <>
          {/* Scheduling errors first — this view doubles as a correctness
              check, and a wrong grid is worth less than knowing it's wrong. */}
          {balance.issues.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 space-y-1">
              <div className="text-[10px] font-black uppercase tracking-widest text-amber-800 inline-flex items-center gap-1.5">
                <AlertOctagon className="w-3.5 h-3.5" /> Scheduling issues in this window ({balance.issues.length})
              </div>
              {balance.issues.slice(0, 12).map((iss, i) => (
                <div key={i} className="text-[11px] text-amber-900">
                  {iss.date && <span className="font-mono text-amber-700">{iss.date} </span>}
                  {iss.crew && <b>{iss.crew} — </b>}
                  {iss.detail}
                </div>
              ))}
              {balance.issues.length > 12 && (
                <div className="text-[11px] font-bold text-amber-700">+{balance.issues.length - 12} more</div>
              )}
            </div>
          )}

          {balance.weeks.map((week, wi) => (
            <div key={week.start} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 md:p-4 overflow-x-auto">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                {wi === 0 ? 'This week' : 'Next week'} — {week.rangeLabel}
              </div>
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <th className="py-1.5 pr-3 text-left">Crew</th>
                    {week.days.map(d => (
                      <th key={d} className="py-1.5 px-1 text-center">{dayLabel(d)}<div className="font-mono text-[9px] text-slate-300">{d.slice(8)}</div></th>
                    ))}
                    <th className="py-1.5 pl-2 text-right">Week</th>
                    <th className="py-1.5 pl-2 text-right">Ceiling</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCrews.map(crew => {
                    const w = crew.weeks[wi];
                    return (
                      <tr key={crew.key} className={`border-t border-slate-100 ${w.over ? 'bg-red-50' : ''}`}>
                        <td className="py-1.5 pr-3 text-left whitespace-nowrap">
                          <div className="font-bold text-slate-800">{crew.label}</div>
                          <div className="text-[10px] font-bold text-slate-400 inline-flex items-center gap-1">
                            {w.scheduled
                              ? <><Users className="w-3 h-3" />{w.headcount} rostered</>
                              : <span className="text-slate-400">not scheduled</span>}
                          </div>
                        </td>
                        {w.days.map(d => (
                          <td key={d.date} className="py-1.5 px-1 text-center">
                            <button
                              type="button"
                              onClick={() => setDayDrill(prev => (prev && prev.crewKey === crew.key && prev.date === d.date
                                ? null : { crewKey: crew.key, date: d.date }))}
                              className={`w-full rounded px-1 py-1 font-mono text-xs ${d.bh > 0 ? 'font-black text-slate-800 hover:bg-slate-100' : 'text-slate-300'} ${dayDrill?.crewKey === crew.key && dayDrill?.date === d.date ? 'ring-2 ring-slate-800' : ''}`}
                              title={d.isScheduled ? `${d.rostered} rostered` : 'not scheduled'}
                            >
                              {d.bh > 0 ? bh(d.bh) : '·'}
                              {!d.isScheduled && d.bh > 0 && (
                                <div className="text-[8px] font-black uppercase text-amber-600">no crew</div>
                              )}
                            </button>
                          </td>
                        ))}
                        <td className={`py-1.5 pl-2 text-right font-mono font-black ${w.over ? 'text-red-900' : 'text-slate-800'}`}>
                          {bh(w.totalBH)}
                        </td>
                        <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                          {w.ceiling === null ? (
                            <span className="text-[10px] font-bold text-slate-400">not scheduled</span>
                          ) : w.over ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-900 text-white text-[10px] font-black uppercase tracking-widest">
                              <AlertTriangle className="w-3 h-3" /> Over by {bh(w.overBy)}
                            </span>
                          ) : (
                            <span className="text-[11px] font-mono text-slate-500">
                              of {bh(w.ceiling)}{w.ceilingPlaceholder ? '*' : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {visibleCrews.length === 0 && (
                    <tr><td colSpan={10} className="py-6 text-center text-sm text-slate-500">No crews scheduled in this window.</td></tr>
                  )}
                </tbody>
              </table>
              <p className="text-[10px] text-slate-400 mt-2">
                Daily cells are informational; the <b>week total</b> is what&apos;s checked against the
                ceiling, because the ceiling is a weekly figure. Headcount is the median of the days
                the crew is rostered, less approved time off. <b>*</b> = placeholder ceiling.
              </p>
            </div>
          ))}

          {dayCell && (
            <div className="bg-white rounded-2xl border-2 border-slate-800 shadow-lg p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    {dayCell.crew.label} · {longDate(dayCell.day.date)}
                  </div>
                  <div className="text-xl font-black text-slate-900">
                    {bh(dayCell.day.bh)} BH
                    <span className="text-sm font-bold text-slate-500 ml-2">
                      {dayCell.day.isScheduled ? `${dayCell.day.rostered} rostered` : 'crew not scheduled this day'}
                    </span>
                  </div>
                </div>
                <button type="button" onClick={() => setDayDrill(null)} className="p-1.5 text-slate-400 hover:text-slate-800" aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <JobList jobs={dayCell.day.jobs} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

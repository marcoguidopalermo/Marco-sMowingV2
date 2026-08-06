// CAPACITY CALENDAR — one component, two mounts (a SalesMaster tab and the
// schedule board's CAPACITY toggle). Forward, READ-ONLY: scheduled and
// uncompleted Jobber work, bucketed by week and crew, coloured against the
// admin-set weekly BH capacity.
//
// The only thing it writes is the capacity SETTINGS (weekly BH + colour
// thresholds), through the same shared editor Manage Resources hosts —
// reachable from a gear on this view so the basis for every percentage is
// one click away rather than buried two screens deep.
import { useMemo, useState } from 'react';
import {
  CalendarRange, ChevronDown, ChevronRight, ChevronLeft, RefreshCw,
  AlertTriangle, Info, TrendingUp, Users, X, Clock, HelpCircle, Sliders,
} from 'lucide-react';
import type { AppData, AppSettings, CapacityForecast, CapacityScope, CapacitySettings, Employee } from '../types';
import CapacitySettingsPanel from './CapacitySettingsPanel';
import {
  buildCapacityModel, capacityOrDefault, mergeSlices, BAND_META, longDate,
  type CapacityBand, type CapacityCell, type CapacityRow, type CapacityWeek,
} from '../lib/capacity';
import { formatTodayInToronto } from '../lib/dateUtils';
import { DIVISIONS } from '../constants';

interface Props {
  appData: AppData;
  // The forward snapshots, one per scope — each its own Firestore doc, held
  // outside appData so neither can be written back into the main document.
  // They are merged for display; a stale lawn pull still renders next to a
  // fresh projects one, each carrying its own "updated" stamp.
  forecasts: Record<CapacityScope, CapacityForecast | null>;
  isAdmin: boolean;
  currentUserEmployee: Employee | null;
  // Re-pulls ONE scope from Jobber (the scheduled passes run on their own).
  onRefresh?: (scope: CapacityScope) => Promise<void>;
  canRefresh?: boolean;
  // Saves the capacity settings block (admin only). Absent → the view is
  // read-only and points at an admin instead of offering an editor.
  onSaveSettings?: (next: CapacitySettings) => Promise<void>;
  // 'board' trims the outer chrome when mounted inside the schedule board,
  // which supplies its own header bar.
  variant?: 'page' | 'board';
}

// ── Band styling. The two reds are deliberately opposite in WEIGHT as well
// as hue: underbooked is a hollow, dashed outline (an empty slot you can
// sell into); overbooked is a solid, heavy block (a wall you can't push
// past). They can't be mistaken for one another at a glance or in print.
const BAND_STYLE: Record<CapacityBand, {
  cell: string; bar: string; track: string; chip: string; text: string;
}> = {
  under: {
    cell: 'bg-rose-50 border-2 border-dashed border-rose-400',
    bar: 'bg-rose-300',
    track: 'bg-rose-100',
    chip: 'bg-white text-rose-700 border border-rose-300',
    text: 'text-rose-800',
  },
  light: {
    cell: 'bg-amber-50 border border-amber-300',
    bar: 'bg-amber-400',
    track: 'bg-amber-100',
    chip: 'bg-amber-100 text-amber-800 border border-amber-300',
    text: 'text-amber-900',
  },
  healthy: {
    cell: 'bg-emerald-50 border border-emerald-300',
    bar: 'bg-emerald-500',
    track: 'bg-emerald-100',
    chip: 'bg-emerald-100 text-emerald-800 border border-emerald-300',
    text: 'text-emerald-900',
  },
  over: {
    cell: 'bg-red-900 border border-red-950 shadow-inner',
    bar: 'bg-white',
    track: 'bg-red-800',
    chip: 'bg-white text-red-900 border border-red-950',
    text: 'text-white',
  },
};
const NO_CAP_STYLE = {
  cell: 'bg-slate-50 border border-slate-200',
  bar: 'bg-slate-300',
  track: 'bg-slate-200',
  chip: 'bg-slate-100 text-slate-600 border border-slate-300',
  text: 'text-slate-700',
};
// A week the pull never reached. Deliberately NOT a band and deliberately
// not zero — hatched grey, no number, no percentage. Showing 0 BH here would
// colour it "underbooked — sell into it" and send a salesman to fill a week
// nobody has looked at.
const UNCOVERED_STYLE = {
  cell: 'bg-slate-100 border border-dashed border-slate-300',
  text: 'text-slate-400',
};

const styleFor = (band: CapacityBand | null) => (band ? BAND_STYLE[band] : NO_CAP_STYLE);
const bh = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

const monthLabel = (ymd: string) =>
  new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold">
      <span className="text-slate-400 uppercase tracking-widest">Legend</span>
      <span className={`px-2 py-1 rounded ${BAND_STYLE.under.cell} ${BAND_STYLE.under.text}`}>
        &lt;70% UNDERBOOKED — sell into it
      </span>
      <span className={`px-2 py-1 rounded ${BAND_STYLE.light.cell} ${BAND_STYLE.light.text}`}>
        70–90% LIGHT
      </span>
      <span className={`px-2 py-1 rounded ${BAND_STYLE.healthy.cell} ${BAND_STYLE.healthy.text}`}>
        90–110% HEALTHY
      </span>
      <span className={`px-2 py-1 rounded inline-flex items-center gap-1 ${BAND_STYLE.over.cell} ${BAND_STYLE.over.text}`}>
        <AlertTriangle className="w-3 h-3" /> &gt;110% OVERBOOKED — can&apos;t deliver
      </span>
      <span className={`px-2 py-1 rounded ${NO_CAP_STYLE.cell} ${NO_CAP_STYLE.text}`}>
        no capacity set — raw BH only
      </span>
      <span className={`px-2 py-1 rounded ${UNCOVERED_STYLE.cell} ${UNCOVERED_STYLE.text}`}>
        not pulled — beyond this snapshot&apos;s coverage, NOT an open week
      </span>
    </div>
  );
}

// One week cell: BH, bar, percentage, band label.
function Cell({ cell, week, active, onClick, compact }: {
  cell: CapacityCell; week: CapacityWeek; active: boolean;
  onClick: () => void; compact?: boolean;
}) {
  if (cell.uncovered) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Week ${week.rangeLabel}: not pulled — coverage ends earlier`}
        className={`w-full text-left rounded-lg p-2 ${UNCOVERED_STYLE.cell} ${active ? 'ring-2 ring-slate-800 ring-offset-1' : ''}`}
      >
        <div className={`text-[11px] font-black ${UNCOVERED_STYLE.text}`}>—</div>
        <div className={`text-[9px] font-black uppercase tracking-widest mt-2 leading-tight ${UNCOVERED_STYLE.text}`}>
          not pulled
        </div>
        <div className={`text-[9px] font-bold ${UNCOVERED_STYLE.text}`}>coverage ends earlier</div>
      </button>
    );
  }
  const s = styleFor(cell.band);
  const pct = cell.pct;
  const fill = pct === null ? 0 : Math.max(2, Math.min(100, pct));
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Week ${week.rangeLabel}: ${bh(cell.bh)} billable hours`}
      className={`w-full text-left rounded-lg p-2 transition-shadow ${s.cell} ${active ? 'ring-2 ring-slate-800 ring-offset-1' : 'hover:shadow-md'}`}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className={`font-black tabular-nums ${compact ? 'text-base' : 'text-lg'} ${s.text}`}>
          {bh(cell.bh)}<span className="text-[10px] font-bold opacity-70 ml-0.5">BH</span>
        </span>
        {pct !== null && (
          <span className={`text-[10px] font-black tabular-nums ${s.text}`}>{pct}%</span>
        )}
      </div>
      <div className={`h-1.5 rounded-full mt-1.5 overflow-hidden ${s.track}`}>
        {pct !== null && <div className={`h-full ${s.bar}`} style={{ width: `${fill}%` }} />}
      </div>
      <div className="flex items-center justify-between gap-1 mt-1">
        <span className={`text-[9px] font-black uppercase tracking-widest inline-flex items-center gap-0.5 ${s.text}`}>
          {cell.band === 'over' && <AlertTriangle className="w-2.5 h-2.5" />}
          {cell.band ? BAND_META[cell.band].label : 'NO CAPACITY SET'}
        </span>
        {cell.capacity !== null && (
          <span className={`text-[9px] font-bold opacity-70 tabular-nums ${s.text}`}>of {bh(cell.capacity)}</span>
        )}
      </div>
      {(cell.hourlyCount > 0 || cell.untaggedCount > 0) && (
        <div className={`text-[9px] font-bold mt-0.5 opacity-80 ${s.text}`}>
          {cell.hourlyCount > 0 && `${cell.hourlyCount} hourly`}
          {cell.hourlyCount > 0 && cell.untaggedCount > 0 && ' · '}
          {cell.untaggedCount > 0 && `${cell.untaggedCount} untagged`}
        </div>
      )}
    </button>
  );
}

// "Booked out to <date>" — the number a salesman says on the phone.
function BookedOut({ row, big }: { row: CapacityRow; big?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${row.bookedOutTo ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-500'}`}>
      <div className="text-[9px] font-black uppercase tracking-widest opacity-70">Booked out to</div>
      {row.bookedOutTo ? (
        <>
          <div className={`font-black leading-tight ${big ? 'text-2xl' : 'text-lg'}`}>{longDate(row.bookedOutTo)}</div>
          <div className="text-[10px] font-bold opacity-60">week of {row.bookedOutWeek && longDate(row.bookedOutWeek)}</div>
        </>
      ) : (
        <div className={`font-black leading-tight ${big ? 'text-2xl' : 'text-lg'}`}>Nothing booked</div>
      )}
    </div>
  );
}

// Where a row's capacity came from, spelled out. A percentage with no
// visible basis is a number nobody can check — this is the basis.
function CapacityNote({ row, onOpenSettings }: {
  row: CapacityRow;
  onOpenSettings?: () => void;
}) {
  const unset = (
    <span className="text-[10px] font-bold text-slate-400">
      no capacity set —{' '}
      {onOpenSettings ? (
        <button type="button" onClick={onOpenSettings} className="font-black text-slate-600 underline hover:text-slate-900">set it</button>
      ) : <span className="font-black text-slate-500">ask an admin to set it</span>}
    </span>
  );

  if (row.kind === 'division') {
    if (row.capacity === null) return unset;
    return (
      <span className="text-[10px] font-bold text-slate-500">
        {bh(row.capacity)} BH/wk (sum of {row.crews?.filter(c => c.capacity !== null).length || 0} crew
        {(row.crews?.filter(c => c.capacity !== null).length || 0) === 1 ? '' : 's'})
        {row.capacityPartial && (
          <span className="text-amber-700"> · partial — {row.crews?.filter(c => c.capacity === null).length} crew(s) unset, so this bar covers less than the whole division</span>
        )}
      </span>
    );
  }
  if (row.kind === 'unassigned') {
    return <span className="text-[10px] font-bold text-slate-400">no capacity — unattributed work</span>;
  }
  const d = row.capacityDetail;
  if (!d || d.bh === null) return unset;
  const basis = d.perPersonBH
    ? `${d.source === 'crew' ? 'crew override' : 'division default'}: ${d.perPersonBH} BH/person × ${d.crewSize} crew`
    : (d.source === 'crew' ? 'crew override' : 'division default');
  return (
    <span className="text-[10px] font-bold text-slate-500">
      {bh(d.bh)} BH/wk <span className="text-slate-400">({basis})</span>
      {d.placeholder && <span className="text-amber-700 font-black"> · PLACEHOLDER — confirm</span>}
    </span>
  );
}

export default function CapacityCalendar({
  appData, forecasts, isAdmin, currentUserEmployee, onRefresh, canRefresh,
  onSaveSettings, variant = 'page',
}: Props) {
  const today = formatTodayInToronto();
  const snapshots = useMemo(
    () => [forecasts.projects, forecasts.lawn].filter(Boolean) as CapacityForecast[],
    [forecasts.projects, forecasts.lawn],
  );
  // "Have we got anything at all to show?" — one scope arriving is enough.
  const forecast: CapacityForecast | null =
    snapshots.length === 0 ? null :
      snapshots.reduce((a, b) => (a.generatedAt >= b.generatedAt ? a : b));

  // A division manager lands on their own division; admins see everything.
  const managed = currentUserEmployee?.managedDivision;
  const defaultDivision =
    !isAdmin && managed === 'lawn' ? 'Lawn Division'
      : !isAdmin && managed === 'small' ? 'Small Projects'
        : !isAdmin && managed === 'large' ? 'Large Projects'
          : 'All';
  const [division, setDivision] = useState<string>(defaultDivision);
  const [range, setRange] = useState<'4week' | 'month'>('4week');
  const [monthOffset, setMonthOffset] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [drill, setDrill] = useState<{ rowKey: string; weekStart: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Settings, reachable from here. The draft lives in local state so an
  // admin can adjust several values and commit once; Save writes the whole
  // capacity block through the App's normal settings write.
  const canEditSettings = isAdmin && !!onSaveSettings;
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState<AppSettings>(appData.settings || {});
  const [saving, setSaving] = useState(false);
  const openSettings = () => {
    setDraft(appData.settings || {});
    setShowSettings(true);
  };
  const saveSettings = async () => {
    if (!onSaveSettings || saving) return;
    setSaving(true);
    try {
      await onSaveSettings(capacityOrDefault(draft.capacity));
      setShowSettings(false);
    } finally { setSaving(false); }
  };

  const model = useMemo(() => buildCapacityModel({
    forecasts: snapshots,
    schedules: appData.schedules || {},
    employees: appData.employees || [],
    multiDayJobs: appData.multiDayJobs,
    settings: capacityOrDefault(appData.settings?.capacity),
    today,
  }), [snapshots, appData.schedules, appData.employees, appData.multiDayJobs, appData.settings?.capacity, today]);

  // Month anchor built from (year, month, 1) so month-stepping can't skip a
  // month from a 29th–31st start date.
  const monthAnchor = useMemo(() => {
    const base = new Date(`${today}T12:00:00`);
    return new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  }, [today, monthOffset]);

  // Visible week window: 4 rolling weeks, or every remaining week of the
  // selected calendar month.
  const visible = useMemo(() => {
    if (range === '4week') return model.weeks.slice(0, 4).map((w, i) => ({ week: w, index: i }));
    const ym = `${monthAnchor.getFullYear()}-${String(monthAnchor.getMonth() + 1).padStart(2, '0')}`;
    const inMonth = model.weeks
      .map((w, i) => ({ week: w, index: i }))
      .filter(({ week }) => week.start.slice(0, 7) === ym || week.end.slice(0, 7) === ym);
    return inMonth.length > 0 ? inMonth : model.weeks.slice(0, 4).map((w, i) => ({ week: w, index: i }));
  }, [range, monthAnchor, model.weeks]);

  const rows = useMemo(() => {
    const list = division === 'All'
      ? model.divisions
      : model.divisions.filter(d => d.division === division);
    return list;
  }, [model.divisions, division]);

  const showUnassigned = model.unassigned && (division === 'All');

  const drillCell = useMemo(() => {
    if (!drill) return null;
    const all = [...model.divisions, ...model.divisions.flatMap(d => d.crews || []),
      ...(model.unassigned ? [model.unassigned] : [])];
    const row = all.find(r => r.key === drill.rowKey);
    if (!row) return null;
    const i = model.weeks.findIndex(w => w.start === drill.weekStart);
    if (i < 0) return null;
    return { row, cell: row.cells[i], week: model.weeks[i] };
  }, [drill, model]);

  const [busyScope, setBusyScope] = useState<CapacityScope | null>(null);
  const refresh = async (scope: CapacityScope) => {
    if (!onRefresh || busy) return;
    setBusy(true);
    setBusyScope(scope);
    try { await onRefresh(scope); } finally { setBusy(false); setBusyScope(null); }
  };

  const toggleCell = (rowKey: string, weekStart: string) =>
    setDrill(prev => (prev && prev.rowKey === rowKey && prev.weekStart === weekStart
      ? null : { rowKey, weekStart }));

  const monthName = monthAnchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // ── Rendering pieces ─────────────────────────────────────────────────────
  const renderRowGrid = (row: CapacityRow, indent = false) => (
    <div className="hidden md:grid gap-2 items-stretch" style={{ gridTemplateColumns: `minmax(190px, 1.2fr) repeat(${visible.length}, minmax(96px, 1fr))` }}>
      <div className={`flex flex-col justify-center ${indent ? 'pl-6' : ''}`}>
        <div className="flex items-center gap-1.5">
          {row.kind === 'division' && (
            <button
              type="button"
              onClick={() => setExpanded(e => ({ ...e, [row.key]: !e[row.key] }))}
              className="text-slate-400 hover:text-slate-800"
              aria-label={expanded[row.key] ? 'Collapse crews' : 'Expand crews'}
            >
              {expanded[row.key] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          )}
          <span className={`${row.kind === 'division' ? 'font-black text-slate-900' : 'font-bold text-slate-700 text-sm'}`}>
            {row.label}
          </span>
          {row.crewSize ? (
            <span className="text-[10px] font-bold text-slate-400 inline-flex items-center gap-0.5">
              <Users className="w-3 h-3" />{row.crewSize}
            </span>
          ) : null}
        </div>
        <CapacityNote row={row} onOpenSettings={canEditSettings ? openSettings : undefined} />
        {row.bookedOutTo && (
          <div className="text-[10px] font-black text-slate-600 mt-0.5">
            booked to {longDate(row.bookedOutTo)}
          </div>
        )}
      </div>
      {visible.map(({ week, index }) => (
        <Cell
          key={week.start}
          cell={row.cells[index]}
          week={week}
          compact={row.kind === 'crew'}
          active={!!drill && drill.rowKey === row.key && drill.weekStart === week.start}
          onClick={() => toggleCell(row.key, week.start)}
        />
      ))}
    </div>
  );

  // Mobile: one card per division/crew, weeks stacked as rows.
  const renderRowStack = (row: CapacityRow, indent = false) => (
    <div className={`md:hidden ${indent ? 'pl-3 border-l-2 border-slate-200 ml-2' : ''}`}>
      <div className="flex items-center justify-between gap-2 py-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {row.kind === 'division' && (
            <button
              type="button"
              onClick={() => setExpanded(e => ({ ...e, [row.key]: !e[row.key] }))}
              className="text-slate-400"
              aria-label={expanded[row.key] ? 'Collapse crews' : 'Expand crews'}
            >
              {expanded[row.key] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          )}
          <div className="min-w-0">
            <div className={`truncate ${row.kind === 'division' ? 'font-black text-slate-900' : 'font-bold text-slate-700 text-sm'}`}>{row.label}</div>
            <CapacityNote row={row} onOpenSettings={canEditSettings ? openSettings : undefined} />
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        {visible.map(({ week, index }) => (
          <div key={week.start} className="grid grid-cols-[64px_1fr] gap-2 items-center">
            <div className="text-[11px] font-black text-slate-500 leading-tight">{week.rangeLabel}</div>
            <Cell
              cell={row.cells[index]}
              week={week}
              compact
              active={!!drill && drill.rowKey === row.key && drill.weekStart === week.start}
              onClick={() => toggleCell(row.key, week.start)}
            />
          </div>
        ))}
      </div>
    </div>
  );


  return (
    <div className={variant === 'board' ? 'p-4 md:p-6 space-y-4' : 'space-y-4'}>
      {/* Header / controls */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarRange className="w-5 h-5 text-slate-700" />
            <h3 className="text-lg font-black text-slate-900">Capacity</h3>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              scheduled BH by week
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-slate-100 rounded-lg p-1">
              <button
                type="button"
                onClick={() => { setRange('4week'); setDrill(null); }}
                className={`px-3 py-1.5 text-xs font-black rounded ${range === '4week' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
              >4 WEEKS</button>
              <button
                type="button"
                onClick={() => { setRange('month'); setDrill(null); }}
                className={`px-3 py-1.5 text-xs font-black rounded ${range === 'month' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
              >MONTH</button>
            </div>
            {range === 'month' && (
              <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                <button
                  type="button"
                  disabled={monthOffset === 0}
                  onClick={() => setMonthOffset(o => Math.max(0, o - 1))}
                  className="p-1 rounded text-slate-600 disabled:opacity-30"
                  aria-label="Previous month"
                ><ChevronLeft className="w-4 h-4" /></button>
                <span className="text-xs font-black text-slate-700 px-1 whitespace-nowrap">{monthName}</span>
                <button
                  type="button"
                  disabled={monthOffset >= 3}
                  onClick={() => setMonthOffset(o => Math.min(3, o + 1))}
                  className="p-1 rounded text-slate-600 disabled:opacity-30"
                  aria-label="Next month"
                ><ChevronRight className="w-4 h-4" /></button>
              </div>
            )}
            {isAdmin && (
              <select
                value={division}
                onChange={e => { setDivision(e.target.value); setDrill(null); }}
                className="text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg px-2 py-2 outline-none"
              >
                <option value="All">All divisions</option>
                {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            {/* Refresh is SCOPED. Projects is the default because that's the
                half that changes between refreshes; lawn is 250+ visits a
                week, moves slowly, and gets its own (slower) schedule. */}
            {canRefresh && onRefresh && (
              <div className="inline-flex rounded-lg overflow-hidden border border-slate-800">
                <button
                  type="button"
                  onClick={() => refresh('projects')}
                  disabled={busy}
                  title="Re-pull Large + Small Projects (leaves the lawn snapshot alone)"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase tracking-widest bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${busy && busyScope === 'projects' ? 'animate-spin' : ''}`} />
                  {busy && busyScope === 'projects' ? 'Pulling' : 'Refresh projects'}
                </button>
                <button
                  type="button"
                  onClick={() => refresh('lawn')}
                  disabled={busy}
                  title="Re-pull Lawn — bigger and slower; it refreshes on its own three times a day"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase tracking-widest bg-white text-slate-700 border-l border-slate-800 hover:bg-slate-100 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${busy && busyScope === 'lawn' ? 'animate-spin' : ''}`} />
                  {busy && busyScope === 'lawn' ? 'Pulling' : 'Lawn'}
                </button>
              </div>
            )}
            {canEditSettings && (
              <button
                type="button"
                onClick={() => (showSettings ? setShowSettings(false) : openSettings())}
                aria-expanded={showSettings}
                title="Set the weekly BH capacity and colour thresholds"
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase tracking-widest rounded-lg border ${showSettings ? 'bg-slate-800 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
              >
                <Sliders className="w-3.5 h-3.5" /> Capacity settings
              </button>
            )}
          </div>
        </div>

        <Legend />

        {/* The caveat. Quiet, one line, always on. */}
        <div className="flex items-start gap-2 text-[11px] text-slate-500 border-t border-slate-100 pt-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
          <p>
            Reflects work <strong>scheduled in Jobber</strong> — won-but-unscheduled work
            doesn&apos;t appear, so an empty week may not be truly open.
            {' '}
            {/* Per-scope stamps: the two halves refresh on different
                cadences, so one "updated" time would misrepresent the other. */}
            {(['projects', 'lawn'] as CapacityScope[]).map(scope => {
              const f = forecasts[scope];
              const label = scope === 'projects' ? 'Projects' : 'Lawn';
              if (!f) return <span key={scope} className="mr-2">{label}: <strong>not pulled yet</strong>.</span>;
              const old = Date.now() - f.generatedAt > (scope === 'lawn' ? 12 : 6) * 3600 * 1000;
              return (
                <span key={scope} className="mr-2">
                  {label} updated {new Date(f.generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  {old && <span className="text-amber-700 font-bold"> (stale)</span>}.
                </span>
              );
            })}
          </p>
        </div>
      </div>

      {/* Settings, inline. Same editor Manage Resources hosts; this host
          commits it itself so an admin never has to leave the view whose
          numbers they're calibrating. */}
      {showSettings && canEditSettings && (
        <div className="space-y-3">
          <CapacitySettingsPanel settings={draft} setSettings={setDraft} isAdmin={isAdmin} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={saveSettings}
              disabled={saving}
              className="px-4 py-2 text-xs font-black uppercase tracking-widest bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50"
            >{saving ? 'Saving…' : 'Save capacity settings'}</button>
            <button
              type="button"
              onClick={() => setShowSettings(false)}
              className="px-3 py-2 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-800"
            >Cancel</button>
            <span className="text-[10px] font-bold text-slate-400">
              These same values live in Manage Resources → App Settings.
            </span>
          </div>
        </div>
      )}

      {!forecast && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center space-y-2">
          <HelpCircle className="w-6 h-6 text-slate-300 mx-auto" />
          <p className="text-sm font-bold text-slate-700">No forecast pulled yet.</p>
          <p className="text-xs text-slate-500">
            The forward pull runs on its own schedule through the day.
            {canRefresh ? ' Hit Refresh to pull it now.' : ' Check back shortly.'}
          </p>
        </div>
      )}

      {/* Per-scope health. Truncation is reported against the SCOPE it
          happened in — "later weeks understated" means something different
          for a 120-day projects pull than for a 56-day lawn one, and a
          blanket banner would tar the healthy half with the other's fault. */}
      {(['projects', 'lawn'] as CapacityScope[]).map(scope => {
        const f = forecasts[scope];
        if (!f || (!f.degraded && !f.truncated)) return null;
        const label = scope === 'projects' ? 'Projects' : 'Lawn';
        return (
          <div key={scope} className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-[11px] text-amber-900 space-y-1">
            {f.degraded && (
              <p><strong>{label} — reduced pull:</strong> multi-day spans are collapsed onto their start day and client names are missing.</p>
            )}
            {f.truncated && (
              <p>
                <strong>{label} — coverage ends {f.coveredThrough ? longDate(f.coveredThrough) : 'early'}.</strong>{' '}
                {f.stoppedForBudget
                  ? 'The pull stopped to leave Jobber API budget for the performance sync (pay comes first).'
                  : 'The pull hit its ceiling.'}{' '}
                Weeks past that date are shown as <strong>not pulled</strong> — they are unknown,
                not open. Don&apos;t sell into them on the strength of this view.
              </p>
            )}
          </div>
        );
      })}

      {/* Booked-out headline — the number for the phone call. */}
      {forecast && rows.length > 0 && (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(row => (
            <div key={row.key} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-black text-slate-900 truncate">{row.division}</div>
                <div className="text-[10px] font-bold text-slate-400">
                  {row.crews?.length || 0} crew{(row.crews?.length || 0) === 1 ? '' : 's'} ·{' '}
                  {bh(visible.reduce((s, { index }) => s + row.cells[index].bh, 0))} BH in view
                </div>
              </div>
              <BookedOut row={row} big />
            </div>
          ))}
        </div>
      )}

      {/* The grid */}
      {forecast && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 md:p-4 space-y-3 overflow-x-auto">
          {/* Week header (desktop) */}
          <div className="hidden md:grid gap-2 pb-1 border-b border-slate-100" style={{ gridTemplateColumns: `minmax(190px, 1.2fr) repeat(${visible.length}, minmax(96px, 1fr))` }}>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 self-end">Division / crew</div>
            {visible.map(({ week, index }) => (
              <div key={week.start} className="text-center">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {index === 0 ? 'This week' : `Week ${index + 1}`}
                </div>
                <div className="text-sm font-black text-slate-800">{week.rangeLabel}</div>
              </div>
            ))}
          </div>

          {rows.length === 0 && (
            <p className="text-sm text-slate-500 py-6 text-center">
              No crews found for this division in the last month of schedules.
            </p>
          )}

          {rows.map(row => (
            <div key={row.key} className="border-b border-slate-100 last:border-0 pb-3 last:pb-0">
              {renderRowGrid(row)}
              {renderRowStack(row)}
              {expanded[row.key] && (row.crews || []).map(crewRow => (
                <div key={crewRow.key} className="mt-2">
                  {renderRowGrid(crewRow, true)}
                  {renderRowStack(crewRow, true)}
                </div>
              ))}
            </div>
          ))}

          {showUnassigned && model.unassigned && (
            <div className="pt-2 border-t border-slate-200">
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">
                  Unassigned — scheduled work whose Jobber assignees don&apos;t map to a crew
                </span>
              </div>
              {renderRowGrid(model.unassigned)}
              {renderRowStack(model.unassigned)}
            </div>
          )}
        </div>
      )}

      {/* Drill-down: the jobs behind a week */}
      {drillCell && (
        <div className="bg-white rounded-2xl border-2 border-slate-800 shadow-lg p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Week {drillCell.week.rangeLabel} — {drillCell.row.label}
              </div>
              <div className="text-xl font-black text-slate-900">
                {bh(drillCell.cell.bh)} BH
                {drillCell.cell.pct !== null && (
                  <span className="text-sm font-bold text-slate-500 ml-2">
                    {drillCell.cell.pct}% of {bh(drillCell.cell.capacity || 0)}
                    {drillCell.cell.band && ` · ${BAND_META[drillCell.cell.band].meaning} — ${BAND_META[drillCell.cell.band].action}`}
                  </span>
                )}
              </div>
            </div>
            <button type="button" onClick={() => setDrill(null)} className="p-1.5 text-slate-400 hover:text-slate-800" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
          {mergeSlices(drillCell.cell.jobs).length === 0 ? (
            <p className="text-sm text-slate-500">Nothing scheduled in this week.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {mergeSlices(drillCell.cell.jobs).map(job => (
                <div key={job.visitId} className="py-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800 text-sm truncate">
                      {job.client || 'No client name'}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {job.desc}{job.jobNumber ? ` · #${job.jobNumber}` : ''}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className="text-[10px] font-bold text-slate-500">
                        {job.multiDay
                          ? `${longDate(job.startDate)} → ${longDate(job.endDate)}`
                          : longDate(job.startDate)}
                      </span>
                      {job.multiDay && (
                        <span className="text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded">
                          multi-day · {bh(job.totalRemaining)} BH left
                        </span>
                      )}
                      {job.creditedBH > 0 && (
                        <span className="text-[9px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded">
                          {bh(job.creditedBH)} BH already credited
                        </span>
                      )}
                      {job.isHourly && (
                        <span className="text-[9px] font-black uppercase tracking-widest bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" /> hourly — no forward BH
                        </span>
                      )}
                      {job.untagged && (
                        <span className="text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded">
                          no [BH] tag — load unknown
                        </span>
                      )}
                      {job.inferredCrew && (
                        <span className="text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded">
                          crew inferred — day not scheduled yet
                        </span>
                      )}
                    </div>
                    {job.assigneeNames.length > 0 && (
                      <div className="text-[10px] text-slate-400 mt-0.5 truncate">{job.assigneeNames.join(', ')}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-black text-slate-900 tabular-nums">{bh(job.bh)}</div>
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">BH this week</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {(drillCell.cell.hourlyCount > 0 || drillCell.cell.untaggedCount > 0) && (
            <p className="text-[11px] text-slate-500 border-t border-slate-100 pt-2">
              {drillCell.cell.untaggedCount > 0 && `${drillCell.cell.untaggedCount} scheduled job${drillCell.cell.untaggedCount === 1 ? '' : 's'} carry no [BH] tag and add 0 to this week's number. `}
              {drillCell.cell.hourlyCount > 0 && `${drillCell.cell.hourlyCount} [hourly] job${drillCell.cell.hourlyCount === 1 ? '' : 's'} have no forward BH by design.`}
            </p>
          )}
        </div>
      )}

      {forecast && (
        <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold text-slate-400">
          <span className="inline-flex items-center gap-1"><TrendingUp className="w-3 h-3" />
            {bh(model.totals.forwardBH)} BH remaining across {model.totals.visits} scheduled visit{model.totals.visits === 1 ? '' : 's'}
          </span>
          {model.totals.untagged > 0 && <span>{model.totals.untagged} untagged</span>}
          {model.totals.hourly > 0 && <span>{model.totals.hourly} hourly</span>}
          <span>horizon {monthLabel(model.weeks[0].start)} → {monthLabel(model.weeks[model.weeks.length - 1].start)}</span>
        </div>
      )}
    </div>
  );
}

import React, { useMemo, useState } from 'react';
import { Activity, Filter, ChevronDown, ChevronUp, Plus, ArrowRightCircle, MessageSquareText, CheckCircle, Trash2 } from 'lucide-react';
import { TaskActivity, TaskActivityType, FleetItem } from '../types';
import { fleetItemLabel } from '../lib/fleetUtils';

interface ActivityLogProps {
  activityLog: TaskActivity[];
  fleet: FleetItem[];
}

type DateRange = 'today' | 'week' | 'month' | 'all' | 'custom';
type ActionFilter = 'all' | TaskActivityType;

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfWeek(d: Date) { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; }
function startOfMonth(d: Date) { const x = startOfDay(d); x.setDate(1); return x; }

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function actionLabel(a: TaskActivity): string {
  switch (a.type) {
    case 'created': {
      const src = a.payload?.source;
      if (src === 'inspection') return 'created task from inspection';
      if (src === 'manual') return 'created task manually';
      if (src === 'auto-oos') return 'promoted OOS card to task';
      if (src === 'auto-maintenance') return 'promoted maintenance card to task';
      return 'created task';
    }
    case 'status_changed': return `moved task ${a.payload?.from || '?'} → ${a.payload?.to || '?'}`;
    case 'note_added': return 'added a note';
    case 'completed': return 'completed repair';
    case 'deleted': return 'deleted task';
  }
}

function actionIcon(t: TaskActivityType) {
  if (t === 'created') return <Plus className="w-3.5 h-3.5" />;
  if (t === 'status_changed') return <ArrowRightCircle className="w-3.5 h-3.5" />;
  if (t === 'note_added') return <MessageSquareText className="w-3.5 h-3.5" />;
  if (t === 'completed') return <CheckCircle className="w-3.5 h-3.5" />;
  return <Trash2 className="w-3.5 h-3.5" />;
}

function actionTone(t: TaskActivityType) {
  if (t === 'created') return 'bg-blue-100 text-blue-700';
  if (t === 'status_changed') return 'bg-amber-100 text-amber-700';
  if (t === 'note_added') return 'bg-slate-100 text-slate-700';
  if (t === 'completed') return 'bg-emerald-100 text-emerald-700';
  return 'bg-rose-100 text-rose-700';
}

export default function ActivityLog({ activityLog, fleet }: ActivityLogProps) {
  const [dateRange, setDateRange] = useState<DateRange>('week');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [mechanicFilter, setMechanicFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');
  const [unitFilter, setUnitFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const mechanicOptions = useMemo(() => {
    const map = new Map<string, string>();
    activityLog.forEach(a => {
      if (a.userEmail) map.set(a.userEmail, a.userName || a.userEmail);
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [activityLog]);

  const filtered = useMemo(() => {
    const now = new Date();
    let from: Date | null = null;
    let to: Date | null = null;
    if (dateRange === 'today') { from = startOfDay(now); }
    else if (dateRange === 'week') { from = startOfWeek(now); }
    else if (dateRange === 'month') { from = startOfMonth(now); }
    else if (dateRange === 'custom') {
      if (customStart) from = startOfDay(new Date(customStart));
      if (customEnd) { to = new Date(customEnd); to.setHours(23, 59, 59, 999); }
    }

    return activityLog
      .filter(a => {
        const ts = new Date(a.timestamp);
        if (from && ts < from) return false;
        if (to && ts > to) return false;
        if (mechanicFilter !== 'all' && a.userEmail !== mechanicFilter) return false;
        if (actionFilter !== 'all' && a.type !== actionFilter) return false;
        if (unitFilter !== 'all' && a.unitId !== unitFilter) return false;
        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [activityLog, dateRange, customStart, customEnd, mechanicFilter, actionFilter, unitFilter]);

  return (
    <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* FILTER BAR */}
      <div className="p-4 border-b border-gray-200 bg-slate-50 flex flex-wrap gap-3 items-end">
        <div className="flex items-center gap-2 mr-2">
          <Filter className="w-4 h-4 text-slate-500" />
          <span className="text-xs font-black uppercase tracking-widest text-slate-500">Filters</span>
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Date</label>
          <select value={dateRange} onChange={e => setDateRange(e.target.value as DateRange)} className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-sm font-medium text-slate-800 outline-none">
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="all">All Time</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        {dateRange === 'custom' && (
          <>
            <div className="flex flex-col">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">From</label>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-sm font-medium text-slate-800 outline-none" />
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">To</label>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-sm font-medium text-slate-800 outline-none" />
            </div>
          </>
        )}
        <div className="flex flex-col">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Mechanic</label>
          <select value={mechanicFilter} onChange={e => setMechanicFilter(e.target.value)} className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-sm font-medium text-slate-800 outline-none min-w-[160px]">
            <option value="all">All Mechanics</option>
            {mechanicOptions.map(([email, name]) => <option key={email} value={email}>{name}</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Action</label>
          <select value={actionFilter} onChange={e => setActionFilter(e.target.value as ActionFilter)} className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-sm font-medium text-slate-800 outline-none">
            <option value="all">All</option>
            <option value="created">Created</option>
            <option value="status_changed">Status Changed</option>
            <option value="note_added">Note Added</option>
            <option value="completed">Completed</option>
            <option value="deleted">Deleted</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Unit</label>
          <select value={unitFilter} onChange={e => setUnitFilter(e.target.value)} className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-sm font-medium text-slate-800 outline-none min-w-[140px]">
            <option value="all">All Units</option>
            {fleet.map(f => <option key={f.id} value={f.id}>{fleetItemLabel(f)}</option>)}
          </select>
        </div>
        <div className="ml-auto text-xs font-bold text-slate-500 bg-white border border-slate-200 px-3 py-1.5 rounded-md">
          <Activity className="w-3.5 h-3.5 inline mr-1.5 text-slate-400" />
          {filtered.length} entr{filtered.length === 1 ? 'y' : 'ies'}
        </div>
      </div>

      {/* TABLE */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-white border-b border-gray-200 text-[10px] text-gray-500 uppercase tracking-widest">
              <th className="p-3 font-black w-10"></th>
              <th className="p-3 font-black">Timestamp</th>
              <th className="p-3 font-black">User</th>
              <th className="p-3 font-black">Action</th>
              <th className="p-3 font-black">Unit</th>
              <th className="p-3 font-black">Task</th>
              <th className="p-3 font-black">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="p-12 text-center text-slate-300 italic font-medium">No activity matches the current filters.</td></tr>
            ) : filtered.map(a => {
              const isOpen = expanded[a.id];
              const ts = new Date(a.timestamp);
              const hasPayload = a.payload && Object.keys(a.payload).length > 0;
              return (
                <React.Fragment key={a.id}>
                  <tr onClick={() => setExpanded(s => ({ ...s, [a.id]: !s[a.id] }))} className="hover:bg-slate-50 cursor-pointer transition-colors">
                    <td className="p-3 align-top text-slate-300">
                      {hasPayload ? (isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />) : null}
                    </td>
                    <td className="p-3 align-top">
                      <div className="text-sm font-bold text-slate-800">{ts.toLocaleDateString()}</div>
                      <div className="text-[10px] font-medium text-slate-400">{ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {relativeTime(a.timestamp)}</div>
                    </td>
                    <td className="p-3 align-top text-sm font-bold text-slate-700">{a.userName || a.userEmail || <span className="italic text-slate-400">Unknown</span>}</td>
                    <td className="p-3 align-top">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${actionTone(a.type)}`}>
                        {actionIcon(a.type)}
                        {actionLabel(a)}
                      </span>
                    </td>
                    <td className="p-3 align-top text-sm font-medium text-slate-700">{a.unitName || <span className="italic text-slate-400">—</span>}</td>
                    <td className="p-3 align-top text-sm">
                      {a.taskCategory ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${a.taskSeverity === 'major' ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-700'}`}>{a.taskSeverity || 'minor'}</span>
                          <span className="font-medium text-slate-700">{a.taskCategory}</span>
                        </span>
                      ) : <span className="text-slate-300 italic">—</span>}
                    </td>
                    <td className="p-3 align-top text-xs text-slate-500 font-medium">
                      {a.type === 'completed' && a.payload && (
                        <span>${(a.payload.cost || 0).toFixed(2)} · {a.payload.laborHours || 0}h</span>
                      )}
                      {a.type === 'status_changed' && a.payload && (
                        <span>{a.payload.from} → {a.payload.to}</span>
                      )}
                      {a.type === 'note_added' && a.payload?.noteText && (
                        <span className="italic">"{String(a.payload.noteText).slice(0, 60)}"</span>
                      )}
                    </td>
                  </tr>
                  {isOpen && hasPayload && (
                    <tr className="bg-slate-50">
                      <td></td>
                      <td colSpan={6} className="p-4 text-xs">
                        <div className="bg-white border border-slate-200 rounded-lg p-3">
                          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Payload</div>
                          <pre className="text-xs text-slate-700 font-mono whitespace-pre-wrap break-all">{JSON.stringify(a.payload, null, 2)}</pre>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

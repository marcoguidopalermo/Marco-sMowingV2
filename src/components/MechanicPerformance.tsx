import { useMemo, useState } from 'react';
import { TrendingUp, Filter, Award, Flame, AlertCircle, DollarSign, ChevronDown, ChevronUp, Check, Undo2 } from 'lucide-react';
import { TaskActivity, Employee, MechanicPayChunk, MechanicTask, TimeEntry } from '../types';
import { chunksForMechanic, computeOpenChunkHours } from '../lib/payChunkUtils';
import { workersForCompletion, shareForMechanic, formatCredit } from '../lib/workCredit';

interface MechanicPerformanceProps {
  activityLog: TaskActivity[];
  // Pay-chunk inputs — drive the per-mechanic chunk display below
  // the existing aggregate table. Optional for back-compat; when
  // missing, the chunk section just doesn't render.
  employees?: Employee[];
  mechanicPayChunks?: Record<string, MechanicPayChunk>;
  mechanicTasks?: MechanicTask[];
  timeEntries?: TimeEntry[];
  // Mark-paid bookkeeping. Admin-only: when isAdmin is false the
  // actions don't render. The write + permission gate + audit live in
  // App.tsx (these are intent callbacks, same pattern as chunk
  // creation). Optional for back-compat.
  isAdmin?: boolean;
  onMarkChunksPaid?: (mechanicId: string, chunkIds: string[]) => void;
  onUnmarkChunkPaid?: (mechanicId: string, chunkId: string) => void;
}

type DateRange = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfWeek(d: Date) { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; }
function startOfMonth(d: Date) { const x = startOfDay(d); x.setDate(1); return x; }
function startOfYear(d: Date) { const x = startOfDay(d); x.setMonth(0, 1); return x; }

interface Row {
  email: string;
  name: string;
  total: number;
  minor: number;
  major: number;
  laborHours: number;
  cost: number;
}

export default function MechanicPerformance({
  activityLog,
  employees,
  mechanicPayChunks,
  mechanicTasks,
  timeEntries,
  isAdmin,
  onMarkChunksPaid,
  onUnmarkChunkPaid,
}: MechanicPerformanceProps) {
  const [expandedMech, setExpandedMech] = useState<Record<string, boolean>>({});
  const [dateRange, setDateRange] = useState<DateRange>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const rows = useMemo<Row[]>(() => {
    const now = new Date();
    let from: Date | null = null;
    let to: Date | null = null;
    if (dateRange === 'today') { from = startOfDay(now); }
    else if (dateRange === 'week') { from = startOfWeek(now); }
    else if (dateRange === 'month') { from = startOfMonth(now); }
    else if (dateRange === 'year') { from = startOfYear(now); }
    else if (dateRange === 'custom') {
      if (customStart) from = startOfDay(new Date(customStart));
      if (customEnd) { to = new Date(customEnd); to.setHours(23, 59, 59, 999); }
    }

    const map = new Map<string, Row>();
    activityLog
      .filter(a => a.type === 'completed')
      .filter(a => {
        const ts = new Date(a.timestamp);
        if (from && ts < from) return false;
        if (to && ts > to) return false;
        return true;
      })
      .forEach(a => {
        // Split every metric among the workers credited on the
        // completion (even split, share-weighted). Legacy rows credit the
        // completer fully (single worker, share 1). Grand totals are
        // preserved because each completion's shares sum to 1.
        const sev = a.taskSeverity || 'minor';
        const labor = Number(a.payload?.laborHours) || 0;
        const cost = Number(a.payload?.cost) || 0;
        for (const w of workersForCompletion(a)) {
          const key = w.userEmail || 'unknown';
          const row = map.get(key) || {
            email: key,
            name: w.userName || w.userEmail || 'Unknown',
            total: 0,
            minor: 0,
            major: 0,
            laborHours: 0,
            cost: 0
          };
          row.total += w.share;
          if (sev === 'major') row.major += w.share; else row.minor += w.share;
          row.laborHours += labor * w.share;
          row.cost += cost * w.share;
          map.set(key, row);
        }
      });

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [activityLog, dateRange, customStart, customEnd]);

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    total: acc.total + r.total,
    minor: acc.minor + r.minor,
    major: acc.major + r.major,
    laborHours: acc.laborHours + r.laborHours,
    cost: acc.cost + r.cost
  }), { total: 0, minor: 0, major: 0, laborHours: 0, cost: 0 }), [rows]);

  return (
    <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* FILTER BAR */}
      <div className="p-4 border-b border-gray-200 bg-slate-50 flex flex-wrap gap-3 items-end">
        <div className="flex items-center gap-2 mr-2">
          <Filter className="w-4 h-4 text-slate-500" />
          <span className="text-xs font-black uppercase tracking-widest text-slate-500">Date Range</span>
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Range</label>
          <select value={dateRange} onChange={e => setDateRange(e.target.value as DateRange)} className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-sm font-medium text-slate-800 outline-none">
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="year">This Year</option>
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
        <div className="ml-auto text-xs font-bold text-slate-500 bg-white border border-slate-200 px-3 py-1.5 rounded-md">
          <TrendingUp className="w-3.5 h-3.5 inline mr-1.5 text-slate-400" />
          {rows.length} mechanic{rows.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* SUMMARY CARDS */}
      <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3 border-b border-gray-200 bg-white">
        <SummaryCard label="Tasks Completed" value={formatCredit(totals.total)} tone="emerald" icon={<Award className="w-4 h-4" />} />
        <SummaryCard label="Minor Repairs" value={formatCredit(totals.minor)} tone="amber" icon={<AlertCircle className="w-4 h-4" />} />
        <SummaryCard label="Major Repairs" value={formatCredit(totals.major)} tone="rose" icon={<Flame className="w-4 h-4" />} />
        <SummaryCard label="Total Labor Hours" value={totals.laborHours.toFixed(1)} tone="slate" icon={<TrendingUp className="w-4 h-4" />} />
        <SummaryCard label="Total Cost Handled" value={`$${totals.cost.toFixed(2)}`} tone="slate" icon={<TrendingUp className="w-4 h-4" />} />
      </div>

      {/* TABLE */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-white border-b border-gray-200 text-[10px] text-gray-500 uppercase tracking-widest">
              <th className="p-3 font-black">Mechanic</th>
              <th className="p-3 font-black text-right">Tasks Completed</th>
              <th className="p-3 font-black text-right">Minor</th>
              <th className="p-3 font-black text-right">Major</th>
              <th className="p-3 font-black text-right">Labor Hours</th>
              <th className="p-3 font-black text-right">Cost Handled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="p-12 text-center text-slate-300 italic font-medium">No completed repairs in this range.</td></tr>
            ) : rows.map((r, idx) => (
              <tr key={r.email} className="hover:bg-slate-50 transition-colors">
                <td className="p-3 align-top">
                  <div className="flex items-center gap-2">
                    {idx === 0 && <Award className="w-4 h-4 text-amber-500" />}
                    <div>
                      <div className="text-sm font-bold text-slate-800">{r.name}</div>
                      <div className="text-[10px] font-medium text-slate-400">{r.email}</div>
                    </div>
                  </div>
                </td>
                <td className="p-3 align-top text-right font-mono text-lg font-black text-emerald-600">{formatCredit(r.total)}</td>
                <td className="p-3 align-top text-right font-mono text-sm font-bold text-amber-700">{formatCredit(r.minor)}</td>
                <td className="p-3 align-top text-right font-mono text-sm font-bold text-rose-600">{formatCredit(r.major)}</td>
                <td className="p-3 align-top text-right font-mono text-sm font-bold text-slate-700">{r.laborHours.toFixed(1)}</td>
                <td className="p-3 align-top text-right font-mono text-sm font-bold text-slate-700">${r.cost.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* PAY CHUNKS — one panel per mechanic with hoursPer1000 set.
          Each panel shows the current open chunk progress + a
          collapsible list of past closed chunks. Tasks attributable
          to a chunk are filtered by completion timestamp falling
          within [start, end]. Per-mechanic totals (earned $, lifetime
          hours) round out the readout. */}
      {employees && mechanicPayChunks && mechanicTasks && timeEntries && (() => {
        // Chunk-pay mechanics only — hourly mechanics have no chunks/payouts.
        const mechanics = employees.filter(e => e.systemRole === 'mechanic' && e.payMode !== 'hourly' && typeof e.hoursPer1000 === 'number' && (e.hoursPer1000 || 0) > 0);
        if (mechanics.length === 0) return null;
        // Source of truth for completions is the top-level activityLog
        // (the completion handler removes the task from mechanicTasks
        // and emits the 'completed' entry here). Counting completions
        // per chunk just needs the timestamp + actor email — both live
        // on the activity entry.
        // Multi-mechanic aware: a completion counts for this mechanic if
        // they're one of the credited workers, weighted by their share
        // (even split among collaborators). Legacy rows → completer, 1.
        const completedByMechanic = (email: string) => {
          const me = email.toLowerCase();
          return activityLog
            .filter(a => a.type === 'completed')
            .map(a => ({ completedTs: Date.parse(a.timestamp), share: shareForMechanic(a, me) }))
            .filter((x): x is { completedTs: number; share: number } => x.share > 0 && Number.isFinite(x.completedTs));
        };
        return (
          <div className="border-t border-gray-200 bg-slate-50 p-4">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 inline-flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5" /> Pay Chunks (Mechanic Payouts)
            </div>
            <div className="space-y-3">
              {mechanics.map(emp => {
                const email = (emp.linkedUserEmail || '').toLowerCase();
                if (!email) return null;
                const { open, closed } = chunksForMechanic(email, mechanicPayChunks);
                const expanded = !!expandedMech[emp.id];
                const allCompleted = completedByMechanic(email);
                const tasksInChunk = (chunk: MechanicPayChunk) => {
                  const startMs = chunk.startTimestamp;
                  const endMs = chunk.endTimestamp ?? Number.MAX_SAFE_INTEGER;
                  // Sum of share-weighted credit (work record), not a raw
                  // row count — collaborations count fractionally.
                  return allCompleted
                    .filter(x => x.completedTs >= startMs && x.completedTs < endMs)
                    .reduce((s, x) => s + x.share, 0);
                };
                const openHours = open ? computeOpenChunkHours(open, timeEntries) : 0;
                const openPct = open ? Math.min(100, Math.round((openHours / open.hoursThreshold) * 100)) : 0;
                const totalEarned = closed.length * 1000 + (open && open.hoursThreshold > 0 ? Math.min(1000, (openHours / open.hoursThreshold) * 1000) : 0);
                // Paid/owed count CLOSED chunks only ($1,000 each). The
                // open chunk is partial/accruing — never part of owed.
                // Treat both null and undefined as unpaid (!c.paidAt).
                const paidClosed = closed.filter(c => !!c.paidAt);
                const unpaidClosed = closed.filter(c => !c.paidAt);
                const totalPaid = paidClosed.length * 1000;
                const totalOwed = unpaidClosed.length * 1000;
                const canMark = !!isAdmin && !!onMarkChunksPaid;
                return (
                  <div key={emp.id} className="bg-white border border-slate-200 rounded-lg shadow-sm">
                    <button
                      type="button"
                      onClick={() => setExpandedMech(s => ({ ...s, [emp.id]: !s[emp.id] }))}
                      className="w-full text-left p-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-slate-800">{emp.name}</div>
                        <div className="text-[11px] text-slate-500">
                          ${1000} per {emp.hoursPer1000} hrs · {closed.length} closed chunk{closed.length === 1 ? '' : 's'}
                          {open && ` · current ${openHours.toFixed(1)}/${open.hoursThreshold} hrs`}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <div className="text-lg font-mono font-black text-emerald-700">${Math.round(totalEarned).toLocaleString()}</div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">earned</div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-mono font-black text-slate-600">${totalPaid.toLocaleString()}</div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">paid</div>
                        </div>
                        <div className="text-right">
                          <div className={`text-lg font-mono font-black ${totalOwed > 0 ? 'text-amber-700' : 'text-slate-400'}`}>${totalOwed.toLocaleString()}</div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">owed</div>
                        </div>
                        {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                      </div>
                    </button>
                    {expanded && (
                      <div className="border-t border-slate-100 p-3 space-y-3">
                        {open ? (
                          <div className="bg-amber-50/40 border border-amber-200 rounded-lg p-3">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="text-[10px] font-black uppercase tracking-widest text-amber-700">Current chunk</div>
                              <div className="text-[11px] font-medium text-slate-500">started {new Date(open.startTimestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                            </div>
                            <div className="font-mono text-lg font-black text-slate-800 mt-1">{openHours.toFixed(1)} / {open.hoursThreshold} hrs</div>
                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mt-2">
                              <div className="h-full bg-emerald-500" style={{ width: `${openPct}%` }} />
                            </div>
                            <div className="text-[11px] text-slate-500 mt-1">{formatCredit(tasksInChunk(open))} repair{tasksInChunk(open) === 1 ? '' : 's'} completed</div>
                          </div>
                        ) : (
                          <div className="text-[11px] italic text-slate-400">No open chunk for this mechanic.</div>
                        )}
                        {closed.length > 0 && (
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Past chunks ({closed.length})</div>
                              {canMark && unpaidClosed.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => onMarkChunksPaid!(emp.id, unpaidClosed.map(c => c.id))}
                                  className="text-[10px] font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded flex items-center gap-1"
                                >
                                  <Check className="w-3 h-3" /> Mark all owed paid (${totalOwed.toLocaleString()})
                                </button>
                              )}
                            </div>
                            <ul className="space-y-1">
                              {closed.slice(0, 10).map(c => {
                                const isPaid = !!c.paidAt;
                                return (
                                <li key={c.id} className="flex items-center justify-between gap-2 text-[11px] bg-white border border-slate-100 rounded px-2 py-1">
                                  <span className="font-bold text-slate-700 shrink-0">
                                    {new Date(c.startTimestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    {c.endTimestamp ? ` – ${new Date(c.endTimestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                                  </span>
                                  <span className="text-slate-500 font-mono truncate">{c.hoursWorked.toFixed(1)} hrs · {formatCredit(tasksInChunk(c))} repairs</span>
                                  <span className="flex items-center gap-1.5 shrink-0">
                                    {isPaid ? (
                                      <>
                                        <span className="font-bold text-slate-400 line-through">$1,000</span>
                                        <span
                                          className="text-[9px] font-black uppercase tracking-widest text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded"
                                          title={`Paid${c.paidByName ? ` by ${c.paidByName}` : ''}${c.paidAt ? ` on ${new Date(c.paidAt).toLocaleDateString()}` : ''}`}
                                        >Paid</span>
                                        {canMark && onUnmarkChunkPaid && (
                                          <button
                                            type="button"
                                            onClick={() => onUnmarkChunkPaid(emp.id, c.id)}
                                            title="Reverse this payment (paid in error)"
                                            className="text-slate-400 hover:text-rose-600 p-0.5 rounded"
                                          >
                                            <Undo2 className="w-3 h-3" />
                                          </button>
                                        )}
                                      </>
                                    ) : (
                                      <>
                                        <span className="font-bold text-amber-700">$1,000</span>
                                        {canMark && (
                                          <button
                                            type="button"
                                            onClick={() => onMarkChunksPaid!(emp.id, [c.id])}
                                            className="text-[9px] font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white px-1.5 py-0.5 rounded"
                                          >Mark paid</button>
                                        )}
                                      </>
                                    )}
                                  </span>
                                </li>
                                );
                              })}
                              {closed.length > 10 && (
                                <li className="text-[10px] italic text-slate-400 text-center pt-1">+ {closed.length - 10} older chunks</li>
                              )}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function SummaryCard({ label, value, tone, icon }: { label: string; value: string; tone: 'emerald' | 'amber' | 'rose' | 'slate'; icon: React.ReactNode }) {
  const tones = {
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-700',
    amber: 'bg-amber-50 border-amber-100 text-amber-700',
    rose: 'bg-rose-50 border-rose-100 text-rose-700',
    slate: 'bg-slate-50 border-slate-200 text-slate-700'
  };
  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest opacity-80">{icon}{label}</div>
      <div className="text-2xl font-black font-mono mt-1">{value}</div>
    </div>
  );
}

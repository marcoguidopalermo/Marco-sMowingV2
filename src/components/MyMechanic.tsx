import { useMemo, useState } from 'react';
import { Wrench, DollarSign, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { Employee, MechanicPayChunk, MechanicTask, TaskActivity, TimeEntry } from '../types';
import { chunksForMechanic, computeOpenChunkHours } from '../lib/payChunkUtils';
import { shareForMechanic, collaboratorNames, joinNames, formatCredit } from '../lib/workCredit';

interface MyMechanicProps {
  currentUserEmail: string;
  currentUserEmployee: Employee | null;
  mechanicPayChunks: Record<string, MechanicPayChunk>;
  mechanicTasks: MechanicTask[];
  // Top-level activity log — source of truth for completed repairs.
  // The completion handler removes the task from `mechanicTasks` and
  // writes the 'completed' entry HERE, so per-chunk repair listing
  // must read from activityLog rather than from mechanicTasks.
  activityLog: TaskActivity[];
  timeEntries: TimeEntry[];
  onOpenTask: (taskId: string) => void;
}

const MS_PER_HOUR = 3600 * 1000;

function formatDateShort(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

function formatDateLong(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

export default function MyMechanic({
  currentUserEmail,
  currentUserEmployee,
  mechanicPayChunks,
  mechanicTasks,
  activityLog,
  timeEntries,
  onOpenTask,
}: MyMechanicProps) {
  const me = (currentUserEmail || '').toLowerCase();
  const { open, closed } = useMemo(
    () => chunksForMechanic(me, mechanicPayChunks),
    [me, mechanicPayChunks],
  );
  const [pastOpen, setPastOpen] = useState<Record<string, boolean>>({});
  const [showAllClosed, setShowAllClosed] = useState(false);

  const hoursPer1000 = currentUserEmployee?.hoursPer1000;

  // Completed repairs this mechanic worked on. Sourced from activityLog
  // because the completion handler removes the task from `mechanicTasks`
  // after writing the 'completed' entry. Multi-mechanic aware: a repair
  // counts for me if I'm one of the credited workers (payload.workers),
  // and `share` is my fraction of it (even split among collaborators).
  // Legacy rows with no workers credit the completer fully (share 1).
  const myCompletions = useMemo(() => {
    return activityLog
      .filter(a => a.type === 'completed')
      .map(a => ({ activity: a, completedTs: Date.parse(a.timestamp), share: shareForMechanic(a, me) }))
      .filter((x): x is { activity: TaskActivity; completedTs: number; share: number } =>
        x.share > 0 && Number.isFinite(x.completedTs));
  }, [activityLog, me]);

  // Live task-id index — lets us decide whether each historical row
  // should still link out to the MyMechanicTaskModal. Tasks removed
  // by completion (the common case) render as a non-interactive
  // ledger row; tasks still around (e.g. re-opened) stay clickable.
  const liveTaskIds = useMemo(() => new Set(mechanicTasks.map(t => t.id)), [mechanicTasks]);

  // Repairs falling inside a chunk's window, newest-first.
  const completionsInChunk = (chunk: MechanicPayChunk) => {
    const startMs = chunk.startTimestamp;
    const endMs = chunk.endTimestamp ?? Number.MAX_SAFE_INTEGER;
    return myCompletions
      .filter(x => x.completedTs >= startMs && x.completedTs < endMs)
      .sort((a, b) => b.completedTs - a.completedTs);
  };

  // Live progress for the open chunk — uses the helper that re-reads
  // timeEntries so the bar moves between snapshot writes.
  const openHoursWorked = useMemo(() => {
    if (!open) return 0;
    return computeOpenChunkHours(open, timeEntries);
  }, [open, timeEntries]);

  // Totals across all chunks (open + closed).
  const totalHours = useMemo(() => {
    let h = closed.reduce((s, c) => s + (c.hoursWorked || 0), 0);
    if (open) h += openHoursWorked;
    return h;
  }, [closed, open, openHoursWorked]);

  // Earned $ = $1,000 per closed chunk + partial earnings on open
  // chunk (proportional to progress).
  const totalEarned = useMemo(() => {
    let dollars = closed.length * 1000;
    if (open && open.hoursThreshold > 0) {
      dollars += Math.min(1000, (openHoursWorked / open.hoursThreshold) * 1000);
    }
    return dollars;
  }, [closed.length, open, openHoursWorked]);

  // Visible closed chunks — first 10 unless "show all" is toggled.
  const visibleClosed = showAllClosed ? closed : closed.slice(0, 10);

  if (!currentUserEmployee) {
    return (
      <div className="flex-1 overflow-y-auto bg-gray-100 p-6">
        <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <Wrench className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <h2 className="text-lg font-bold text-slate-700">No linked employee record</h2>
          <p className="text-sm text-slate-500 mt-2">
            Your sign-in email isn't linked to an Employee record. Ask an admin to link your email in Manage Resources → Personnel.
          </p>
        </div>
      </div>
    );
  }

  if (typeof hoursPer1000 !== 'number' || hoursPer1000 <= 0) {
    return (
      <div className="flex-1 overflow-y-auto bg-gray-100 p-6">
        <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <DollarSign className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <h2 className="text-lg font-bold text-slate-700">No pay rate configured</h2>
          <p className="text-sm text-slate-500 mt-2">
            An admin hasn't set your Hours-per-$1,000 rate yet. Ask them to configure it in Manage Resources → Personnel.
          </p>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="flex-1 overflow-y-auto bg-gray-100 p-6">
        <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <Clock className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <h2 className="text-lg font-bold text-slate-700">No active pay chunk</h2>
          <p className="text-sm text-slate-500 mt-2">
            Your pay rate is set to <strong>${1000} per {hoursPer1000} hrs</strong>, but no chunk is open yet. Ask an admin to set up your first chunk in Personnel admin.
          </p>
        </div>
      </div>
    );
  }

  const pct = Math.min(100, Math.round((openHoursWorked / open.hoursThreshold) * 100));
  const remaining = Math.max(0, open.hoursThreshold - openHoursWorked);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-100 p-4 md:p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Wrench className="w-6 h-6 text-slate-700" /> MyMechanic
          </h2>
          <span className="text-xs text-slate-500 font-medium truncate">{currentUserEmployee.name}</span>
        </div>

        {/* SECTION 1 — CURRENT CHUNK */}
        <section className="bg-white rounded-xl shadow-sm border border-amber-200 p-4 md:p-5">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-amber-700 inline-flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5" /> Current Chunk
            </div>
            <div className="text-xs font-bold text-slate-500">$1,000 per {open.hoursThreshold} hrs</div>
          </div>

          <div className="flex items-end justify-between gap-3 mb-2 flex-wrap">
            <div className="font-mono text-2xl font-black text-slate-800">
              {openHoursWorked.toFixed(1)} <span className="text-base text-slate-500">/ {open.hoursThreshold} hrs</span>
            </div>
            <div className="text-sm font-bold text-emerald-700">
              {remaining > 0 ? `${remaining.toFixed(1)} hrs to next $1,000` : 'Threshold reached — closing on next sync'}
            </div>
          </div>

          <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="text-[11px] text-slate-500 mt-2">
            Chunk started {formatDateLong(open.startTimestamp)}
            {open.manualBackfill && ' · seeded by admin'}
          </div>

          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Repairs completed this chunk</div>
            {(() => {
              const rows = completionsInChunk(open);
              if (rows.length === 0) {
                return <div className="text-xs text-slate-400 italic">No repairs completed yet in this chunk.</div>;
              }
              return (
                <ul className="divide-y divide-slate-100">
                  {rows.map(({ activity, completedTs, share }) => {
                    const liveTask = liveTaskIds.has(activity.taskId);
                    const others = share < 1 ? collaboratorNames(activity, me) : [];
                    const Inner = (
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-slate-800 truncate">
                            {activity.taskCategory || 'Repair'}
                            {activity.unitName ? ` · ${activity.unitName}` : ''}
                          </div>
                          {activity.payload?.fixNotes && (
                            <div className="text-[11px] text-slate-500 truncate">{String(activity.payload.fixNotes)}</div>
                          )}
                          {others.length > 0 && (
                            <div className="text-[10px] font-bold text-violet-600 truncate">Collaborated with {joinNames(others)}</div>
                          )}
                        </div>
                        <span className="text-[10px] font-medium text-emerald-700 whitespace-nowrap shrink-0">
                          {formatDateShort(completedTs)}
                        </span>
                      </div>
                    );
                    return (
                      <li key={activity.id}>
                        {liveTask ? (
                          <button type="button" onClick={() => onOpenTask(activity.taskId)} className="w-full text-left py-2 px-1 hover:bg-slate-50 rounded transition-colors">{Inner}</button>
                        ) : (
                          <div className="py-2 px-1">{Inner}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              );
            })()}
          </div>
        </section>

        {/* SECTION 2 — PAST CHUNKS */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-700 inline-flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-slate-700" /> Past Chunks
            </h3>
            <span className="text-[10px] font-bold text-slate-400">{closed.length}</span>
          </div>
          {closed.length === 0 ? (
            <div className="text-sm text-slate-400 italic bg-white border border-dashed border-slate-200 rounded-lg p-4 text-center">No closed chunks yet.</div>
          ) : (
            <ul className="space-y-2">
              {visibleClosed.map(chunk => {
                const isOpen = !!pastOpen[chunk.id];
                const rows = completionsInChunk(chunk);
                // Weighted work-credit: sum of my shares (a collaboration
                // counts as a fraction of a repair). NOT pay — pay is the
                // clocked-hours figure shown separately.
                const taskCount = rows.reduce((s, r) => s + r.share, 0);
                return (
                  <li key={chunk.id} className="bg-white border border-slate-200 rounded-lg shadow-sm">
                    <button
                      type="button"
                      onClick={() => setPastOpen(s => ({ ...s, [chunk.id]: !s[chunk.id] }))}
                      className="w-full text-left p-3 flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-slate-800">
                          {formatDateShort(chunk.startTimestamp)}{chunk.endTimestamp ? ` – ${formatDateShort(chunk.endTimestamp)}` : ''}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {chunk.hoursWorked.toFixed(1)} hrs · $1,000 · {formatCredit(taskCount)} repair{taskCount === 1 ? '' : 's'}
                        </div>
                      </div>
                      {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
                    </button>
                    {isOpen && (
                      <div className="border-t border-slate-100 px-3 py-2">
                        {rows.length === 0 ? (
                          <div className="text-xs text-slate-400 italic">No repairs completed in this chunk.</div>
                        ) : (
                          <ul className="divide-y divide-slate-100">
                            {rows.map(({ activity, completedTs, share }) => {
                              const liveTask = liveTaskIds.has(activity.taskId);
                              const others = share < 1 ? collaboratorNames(activity, me) : [];
                              const Inner = (
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-bold text-slate-700 truncate">
                                    {activity.taskCategory || 'Repair'}{activity.unitName ? ` · ${activity.unitName}` : ''}
                                    {others.length > 0 && <span className="ml-1 text-[10px] font-bold text-violet-600">· with {joinNames(others)}</span>}
                                  </span>
                                  <span className="text-[10px] text-emerald-700 whitespace-nowrap shrink-0">{formatDateShort(completedTs)}</span>
                                </div>
                              );
                              return (
                                <li key={activity.id}>
                                  {liveTask ? (
                                    <button type="button" onClick={() => onOpenTask(activity.taskId)} className="w-full text-left py-1.5 px-1 hover:bg-slate-50 rounded transition-colors">{Inner}</button>
                                  ) : (
                                    <div className="py-1.5 px-1">{Inner}</div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
              {closed.length > 10 && !showAllClosed && (
                <li>
                  <button
                    type="button"
                    onClick={() => setShowAllClosed(true)}
                    className="w-full text-center py-2 text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800"
                  >
                    Show all ({closed.length})
                  </button>
                </li>
              )}
            </ul>
          )}
        </section>

        {/* SECTION 3 — TOTALS */}
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Total Hours</div>
              <div className="text-xl font-mono font-black text-slate-800 mt-1">{totalHours.toFixed(1)}</div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Total Earned</div>
              <div className="text-xl font-mono font-black text-emerald-700 mt-1">${Math.round(totalEarned).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-amber-700">Pay Rate</div>
              <div className="text-xl font-mono font-black text-amber-700 mt-1">$1,000 / {hoursPer1000}h</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
// MS_PER_HOUR retained for any future inline math callers.
void MS_PER_HOUR;

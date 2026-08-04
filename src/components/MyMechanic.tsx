import { useEffect, useMemo, useState } from 'react';
import { Wrench, DollarSign, Clock, ChevronDown, ChevronUp, Loader2, AlertTriangle } from 'lucide-react';
import { Employee, MechanicPayChunk, MechanicTask, TaskActivity, TimeEntry } from '../types';
import { chunksForMechanic, computeOpenChunkHours } from '../lib/payChunkUtils';
import { shareForMechanic, collaboratorNames, joinNames, formatCredit, assigneesForTask } from '../lib/workCredit';
import { MyHoursSection } from './ContractingMaster';

// The pay-period hours cards shape shared with the contractor Home.
type HoursCardData = { rangeLabel: string; payDate: string; hours: number };

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
  // HOURLY-mode home (mirrors the contractor Home). Absent/`'chunk'` → the
  // existing chunk screen (unchanged). Wired only when payMode === 'hourly'.
  payMode?: 'chunk' | 'hourly';
  myActivePunch?: TimeEntry | null;
  myTodayPunches?: TimeEntry[];
  // Honest-save: resolve true on a confirmed write, false on failure.
  onClockIn?: () => Promise<boolean>;
  onClockOut?: (note?: string) => Promise<boolean>;
  hoursCards?: { last: HoursCardData; current: HoursCardData };
  onGoToRepairs?: () => void;
  // Self-service own-hours edit (mirrors the contractor My Hours).
  employees?: Employee[];
  onSaveOwnTime?: (entry: TimeEntry, reason: string) => void;
}

// ── Home helpers (mirror the contractor Home's clock + hours cards) ──────────
const fmtHM = (h: number) => `${Math.floor(h)}h ${Math.round((h - Math.floor(h)) * 60)}m`;
const fmtTime = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : '—';

function MechanicClock({ active, today, onIn, onOut }: { active: TimeEntry | null; today: TimeEntry[]; onIn: () => Promise<boolean>; onOut: (note?: string) => Promise<boolean> }) {
  const [, force] = useState(0);
  const [showPunches, setShowPunches] = useState(false);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState<'in' | 'out' | null>(null);
  const [error, setError] = useState<'in' | 'out' | null>(null);
  useEffect(() => { const id = setInterval(() => force(n => n + 1), 30000); return () => clearInterval(id); }, []);
  const elapsed = active ? Math.max(0, (Date.now() - new Date(active.clockIn).getTime()) / 3600000) : 0;

  // Honest-save: await the write; only clear the UI on a confirmed success.
  // On failure show a retry — never a false success.
  const doIn = async () => {
    if (saving) return;
    setSaving('in'); setError(null);
    const ok = await onIn();               // active flips via parent on success
    setSaving(null); if (!ok) setError('in');
  };
  const doOut = async (n?: string) => {
    if (saving) return;
    setSaving('out'); setError(null);
    const ok = await onOut(n);
    setSaving(null);
    if (ok) { setNoting(false); setNote(''); } else { setError('out'); }
  };

  return (
    <div>
      {active ? (
        <div className="w-full rounded-2xl p-4 text-white bg-slate-800">
          {/* The big button reflects state: Clock out + live timer while in. */}
          <button
            onClick={() => { if (!noting) setNoting(true); }}
            disabled={saving === 'out'}
            className="w-full flex items-center justify-between gap-3 text-left disabled:opacity-80"
          >
            <span className="text-left">
              <span className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-amber-300">
                <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-300 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-300" /></span>
                Clocked in · {fmtHM(elapsed)}
              </span>
              <span className="block text-[11px] opacity-70">since {fmtTime(active.clockIn)}</span>
            </span>
            {!noting && <span className="px-4 py-3 rounded-xl font-black bg-amber-400 text-slate-900 inline-flex items-center gap-2">{saving === 'out' ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : 'Clock out'}</span>}
          </button>
          {noting && (
            <div className="mt-3 bg-white rounded-xl p-3 text-slate-800">
              <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">What was worked on? (optional)</label>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="e.g. replaced mower belt · unit 12" className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400 resize-none" autoFocus />
              {error === 'out' && <div className="mt-2 text-[12px] font-bold text-rose-600 inline-flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Couldn’t save — try again.</div>}
              <div className="flex gap-2 mt-2">
                <button onClick={() => doOut(note.trim() || undefined)} disabled={saving === 'out'} className="flex-1 py-2 rounded-lg font-black text-white bg-slate-800 disabled:opacity-60 inline-flex items-center justify-center gap-2">{saving === 'out' ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : (error === 'out' ? 'Retry clock out' : 'Save')}</button>
                <button onClick={() => doOut(undefined)} disabled={saving === 'out'} className="px-3 py-2 rounded-lg font-semibold border text-slate-600 disabled:opacity-60">Save without note</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <button onClick={doIn} disabled={saving === 'in'} className="w-full py-6 rounded-2xl font-black text-2xl text-white shadow bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 inline-flex items-center justify-center gap-3">
          {saving === 'in' ? <><Loader2 className="w-6 h-6 animate-spin" /> Saving…</> : 'Clock in'}
        </button>
      )}
      {error === 'in' && <div className="mt-1.5 text-center text-[12px] font-bold text-rose-600 inline-flex items-center gap-1.5 justify-center w-full"><AlertTriangle className="w-3.5 h-3.5" /> Couldn’t clock in — tap to retry.</div>}
      {today.length > 0 && (
        <div className="mt-1.5 text-center">
          <button onClick={() => setShowPunches(s => !s)} className="text-[11px] font-semibold text-gray-400 uppercase">{showPunches ? '▾ hide' : '▸'} today's punches ({today.length})</button>
          {showPunches && (
            <div className="space-y-1 mt-1 text-left">
              {today.map(e => (
                <div key={e.id} className="bg-white rounded border p-2 text-sm">
                  <div>{fmtTime(e.clockIn)} → {e.clockOut ? fmtTime(e.clockOut) : <span className="text-emerald-600 font-semibold">active</span>}</div>
                  {e.workNote && <div className="text-xs text-gray-500 italic mt-0.5">“{e.workNote}”</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PayHoursCard({ label, data, verb, inProgress }: { label: string; data: HoursCardData; verb: string; inProgress?: boolean }) {
  const hm = `${Math.floor(data.hours)}h ${Math.round((data.hours - Math.floor(data.hours)) * 60)}m`;
  return (
    <div className={`bg-white rounded-xl border p-3 ${inProgress ? 'border-emerald-200' : 'border-slate-200'}`}>
      <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: inProgress ? '#1E8449' : '#334155' }}>{label} · {data.rangeLabel}</div>
      <div className="text-2xl font-black" style={{ color: inProgress ? '#1E8449' : '#334155' }}>{hm}</div>
      <div className="text-[10px] text-gray-400">{inProgress ? 'in progress · ' : ''}{verb} {data.payDate}</div>
    </div>
  );
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
  payMode,
  myActivePunch,
  myTodayPunches,
  onClockIn,
  onClockOut,
  hoursCards,
  onGoToRepairs,
  employees,
  onSaveOwnTime,
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

  // Paid / owed — display-only, mechanics never mark anything.
  // Counts CLOSED chunks only ($1,000 each). The open chunk is
  // partial/accruing and never part of owed. Both null and undefined
  // count as unpaid (!c.paidAt).
  const totalPaid = useMemo(() => closed.filter(c => !!c.paidAt).length * 1000, [closed]);
  const totalOwed = useMemo(() => closed.filter(c => !c.paidAt).length * 1000, [closed]);

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

  // ── HOURLY PAY MODE — the simplified contractor-style Home (clock + own
  // pay-period hours + a repairs summary). No chunk machinery/UI. Chunk-pay
  // mechanics fall through to the unchanged chunk screen below. ──────────────
  if (payMode === 'hourly' && hoursCards && onClockIn && onClockOut) {
    const myOpen = mechanicTasks.filter(t => t.status !== 'done' && assigneesForTask(t).some(a => (a.userEmail || '').toLowerCase() === me));
    const priorityN = myOpen.filter(t => t.priority).length;
    const majorN = myOpen.filter(t => t.severity === 'major').length;
    return (
      <div className="flex-1 overflow-y-auto bg-gray-100 p-4 md:p-6 pb-24 md:pb-6">
        <div className="max-w-md mx-auto space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><Wrench className="w-6 h-6 text-slate-700" /> Home</h2>
            <span className="text-xs text-slate-500 font-medium truncate">{currentUserEmployee.name}</span>
          </div>
          {/* Big clock in/out — first, thumb-sized, live status + today's punches */}
          <MechanicClock active={myActivePunch || null} today={myTodayPunches || []} onIn={onClockIn} onOut={onClockOut} />
          {/* MY HOURS — own punches: readable log + edit/add-missed (reason-stamped,
              own-only), reusing the shared self-service form. */}
          {employees && onSaveOwnTime && (
            <MyHoursSection me={{ id: currentUserEmployee.id, name: currentUserEmployee.name }} employees={employees} payrollTimeEntries={timeEntries} periodCard={hoursCards.current} onSaveOwn={onSaveOwnTime} />
          )}
          {/* HOURS — own punches through the pay-period lens (hours only) */}
          <div>
            <div className="text-xs font-black uppercase tracking-widest mb-1 text-slate-700">Hours</div>
            <div className="grid grid-cols-2 gap-3">
              <PayHoursCard label="Last paycheque" data={hoursCards.last} verb="paid" />
              <PayHoursCard label="This paycheque" data={hoursCards.current} verb="pays" inProgress />
            </div>
          </div>
          {/* MY REPAIRS — cheap summary, tap through to the board */}
          {onGoToRepairs && (
            <button onClick={onGoToRepairs} className="w-full bg-white rounded-xl border p-3 flex items-center justify-between text-left hover:bg-slate-50" style={{ minHeight: 44 }}>
              <span>
                <span className="text-xs font-black uppercase tracking-widest block text-slate-700">My repairs</span>
                <span className="text-[11px] font-semibold text-slate-500">
                  {myOpen.length === 0 ? 'none assigned' : [`${myOpen.length} open`, priorityN ? `${priorityN} priority` : null, majorN ? `${majorN} major` : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="text-xs text-gray-400">Repairs →</span>
            </button>
          )}
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
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Paid</div>
              <div className="text-xl font-mono font-black text-slate-600 mt-1">${totalPaid.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-amber-700">Owed</div>
              <div className={`text-xl font-mono font-black mt-1 ${totalOwed > 0 ? 'text-amber-700' : 'text-slate-400'}`}>${totalOwed.toLocaleString()}</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
// MS_PER_HOUR retained for any future inline math callers.
void MS_PER_HOUR;

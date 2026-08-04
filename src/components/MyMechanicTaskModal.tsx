import { useEffect, useState, useRef } from 'react';
import { X, ArrowLeft, CheckCircle2, Send, Users, UserPlus, Flame, Clock, MessageSquare, ChevronDown, Trash2 } from 'lucide-react';
import { MechanicTask, FleetItem } from '../types';
import { assigneesForTask } from '../lib/workCredit';

const ASSIGNEE_PALETTE = [
  'bg-emerald-500', 'bg-sky-500', 'bg-amber-500', 'bg-rose-500',
  'bg-violet-500', 'bg-cyan-500', 'bg-pink-500', 'bg-orange-500',
];
function assigneeColor(email: string): string {
  if (!email) return 'bg-slate-400';
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) | 0;
  return ASSIGNEE_PALETTE[Math.abs(h) % ASSIGNEE_PALETTE.length];
}
function assigneeInitial(name: string, email: string): string {
  const src = (name || '').trim() || (email || '').split('@')[0] || '';
  return (src.charAt(0) || '?').toUpperCase();
}
function assigneeFullName(name: string, email: string): string {
  return (name || '').trim() || (email || '').split('@')[0] || 'Unknown';
}

interface UserOption {
  userEmail: string;
  userName: string;
}

interface MyMechanicTaskModalProps {
  // null = closed; the parent finds the live task on every render so
  // edits made elsewhere (or in this modal) reflect in real time.
  task: MechanicTask | null;
  // Live fleet — used to resolve the unit number for the header subline.
  // Lookup by `task.unitId`; missing unit or missing `unitNumber` field
  // means we just don't render the subline.
  fleet: FleetItem[];
  onClose: () => void;
  currentUserEmail: string;
  currentUserName: string;
  userOptions: UserOption[];
  // Generic direct status set. Writes the 'status_changed' activity
  // entry on the App.tsx side — same pattern MechanicBoard already uses.
  // Use this for todo↔doing transitions and for re-opening a completed
  // task (done → doing). NOT used for forward transitions INTO done —
  // those route through onRequestComplete so the parent can prompt for
  // part cost / labor hours / fix notes via CompletionModal.
  onChangeStatus: (taskId: string, newStatus: 'todo' | 'doing' | 'done') => void;
  // Opens the existing CompletionModal at the App.tsx layer for a
  // mark-complete flow. The submit handler over there writes the
  // Repair Log row, flips status to 'done', and emits the activity
  // entry — so we don't change status from here. Cancelling the
  // CompletionModal leaves the task unchanged.
  onRequestComplete: (taskId: string) => void;
  // Legacy single-assignee callback — pass null to unassign. Retained
  // for back-compat; multi-assignee writes go through onSetAssignees.
  onAssign: (taskId: string, assignedTo: { userEmail: string; userName: string } | null) => void;
  // Multi-mechanic assignment (no cap). Replaces the task's full
  // assignee list; an empty array unassigns.
  onSetAssignees: (taskId: string, assignees: Array<{ userEmail: string; userName: string }>) => void;
  onAddNote: (taskId: string, text: string) => void;
  // Delete is gated by canDeleteMechanicTask at the App.tsx layer; if
  // canDelete is false the button isn't rendered. Tapping it triggers
  // the shared ConfirmDeleteModal — the modal here doesn't close on its
  // own, so the user can still cancel.
  canDelete?: boolean;
  onDelete?: (taskId: string) => void;
}

const STATUS_LABEL: Record<MechanicTask['status'], string> = {
  todo: 'Todo',
  doing: 'In Progress',
  done: 'Complete',
};

function formatReportedDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function relativeOrAbs(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const diffMs = Date.now() - d.getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function MyMechanicTaskModal({
  task,
  fleet,
  onClose,
  currentUserEmail,
  currentUserName,
  userOptions,
  onChangeStatus,
  onRequestComplete,
  onSetAssignees,
  onAddNote,
  canDelete,
  onDelete,
}: MyMechanicTaskModalProps) {
  const [noteDraft, setNoteDraft] = useState('');
  const [showReassign, setShowReassign] = useState(false);
  const activityRef = useRef<HTMLDivElement>(null);

  // Reset transient state whenever the modal switches to a new task or closes.
  useEffect(() => {
    if (!task) {
      setNoteDraft('');
      setShowReassign(false);
    }
  }, [task?.id]);

  // Auto-scroll the activity list to the newest entry whenever the task
  // mutates (status change, new note, etc.) so the latest event is visible.
  useEffect(() => {
    if (!task || !activityRef.current) return;
    activityRef.current.scrollTop = activityRef.current.scrollHeight;
  }, [task?.activity?.length]);

  if (!task) return null;

  const me = (currentUserEmail || '').toLowerCase();
  // Multi-mechanic assignment — prefer the assignees[] list, falling back
  // to the legacy single assignedTo (handled in assigneesForTask).
  const assignees = assigneesForTask(task);
  const assignedEmails = new Set(assignees.map(a => a.userEmail.toLowerCase()));
  const assignedToMe = assignedEmails.has(me);
  const isMajor = task.severity === 'major';
  const status: MechanicTask['status'] = task.status;

  const goBack = () => {
    if (status === 'todo') return;
    // done → doing is a simple status flip (re-open). doing → todo
    // likewise. Neither needs the completion prompt.
    onChangeStatus(task.id, status === 'done' ? 'doing' : 'todo');
  };
  const markComplete = () => {
    if (status === 'done') return;
    // Always route through the CompletionModal flow — never bypass the
    // cost/hours capture on the way to 'done'.
    onRequestComplete(task.id);
  };

  const submitNote = () => {
    const text = noteDraft.trim();
    if (!text) return;
    onAddNote(task.id, text);
    setNoteDraft('');
  };

  // Notes feed — filter the activity log to only `note_added` entries.
  // Status changes, priority/waiting toggles, completions, etc. are still
  // written to the underlying activity array for audit purposes (App.tsx
  // emits them on every status mutation), they're just hidden from this
  // view. Sort oldest → newest so the conversation reads top-down.
  const notesFeed = (task.activity || [])
    .filter(a => a.type === 'note_added')
    .slice()
    .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

  // Roster candidates not already assigned (the "add another mechanic"
  // picker). "Assign to me" is its own button.
  const addableOptions = userOptions.filter(o =>
    !assignedEmails.has(o.userEmail.toLowerCase()) && o.userEmail.toLowerCase() !== me,
  );

  const toggleAssignee = (o: { userEmail: string; userName: string }) => {
    const lc = o.userEmail.toLowerCase();
    if (assignedEmails.has(lc)) {
      onSetAssignees(task.id, assignees.filter(a => a.userEmail.toLowerCase() !== lc));
    } else {
      onSetAssignees(task.id, [...assignees, { userEmail: o.userEmail, userName: o.userName }]);
    }
  };
  const assignSelf = () => {
    if (assignedToMe) return;
    onSetAssignees(task.id, [...assignees, { userEmail: currentUserEmail, userName: currentUserName }]);
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex md:items-center md:justify-center md:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white md:rounded-2xl shadow-2xl w-full md:max-w-2xl h-[100dvh] md:h-auto md:max-h-[92dvh] overflow-hidden flex flex-col">
        {/* Sticky header */}
        <div className="px-4 md:px-5 py-3 border-b border-slate-200 flex items-start justify-between gap-3 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full whitespace-nowrap inline-flex items-center gap-1 ${
                isMajor ? 'bg-rose-600 text-white' :
                task.isMaintenance ? 'bg-blue-100 text-blue-700' :
                'bg-amber-100 text-amber-700'
              }`}>
                {isMajor && <Flame className="w-3 h-3" />}
                {task.category}
              </span>
              <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                status === 'done' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
                status === 'doing' ? 'bg-sky-100 text-sky-700 border border-sky-200' :
                'bg-slate-100 text-slate-600 border border-slate-200'
              }`}>{STATUS_LABEL[status]}</span>
            </div>
            <h2 className="text-lg font-bold text-slate-800 truncate">{task.unitName || '—'}</h2>
            {(() => {
              // Unit-number subline — looked up live from fleet by task.unitId.
              // Hidden entirely if the task has no linked unit or the unit
              // has no unitNumber field (no "Unit #—" placeholder).
              const f = task.unitId ? fleet.find(x => x.id === task.unitId) : undefined;
              if (!f || typeof f.unitNumber !== 'number') return null;
              return (
                <div className="text-[11px] font-bold text-slate-500 mt-0.5">Unit #{f.unitNumber}</div>
              );
            })()}
            <div className="text-[11px] text-slate-500 mt-0.5 inline-flex items-center gap-1">
              <Clock className="w-3 h-3" /> Reported {formatReportedDate(task.dateReported)}
            </div>
            {(() => {
              const rep = task.reportedBy?.name || task.activity?.find(a => a.type === 'created')?.userName;
              return rep ? <div className="text-[11px] text-slate-500 mt-0.5">Reported by <span className="font-bold text-slate-700">{rep}</span></div> : null;
            })()}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-2 rounded min-w-[44px] min-h-[44px] inline-flex items-center justify-center shrink-0" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-4 md:px-5 py-4 space-y-4">
          {task.description && task.description !== 'Unit marked Out of Service' && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-700 whitespace-pre-wrap">
              {task.description}
            </div>
          )}

          {/* Assignees — multi-mechanic, no cap. Each assigned mechanic
              shows as a removable chip; "Assign to me" and "Add mechanic"
              extend the list. */}
          <section className="space-y-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 inline-flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Assignees
              {assignees.length > 0 && <span className="text-slate-400 font-bold normal-case tracking-normal">({assignees.length})</span>}
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              {assignees.length === 0 ? (
                <span className="text-sm font-bold text-slate-400">Unassigned</span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {assignees.map(a => {
                    const isMe = a.userEmail.toLowerCase() === me;
                    return (
                      <span
                        key={a.userEmail}
                        className="inline-flex items-center gap-1.5 pl-1 pr-1.5 py-1 rounded-full bg-slate-50 border border-slate-200"
                        title={a.userName || a.userEmail}
                      >
                        <span className={`w-6 h-6 rounded-full ${assigneeColor(a.userEmail)} text-white text-[10px] font-black flex items-center justify-center shrink-0 ring-1 ring-white`}>
                          {assigneeInitial(a.userName, a.userEmail)}
                        </span>
                        <span className="text-[11px] font-bold text-slate-700 truncate max-w-[90px]">
                          {assigneeFullName(a.userName, a.userEmail)}{isMe ? ' (You)' : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleAssignee(a)}
                          className="text-slate-400 hover:text-rose-600 p-0.5 rounded"
                          aria-label={`Remove ${a.userName || a.userEmail}`}
                          title="Remove from this task"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {!assignedToMe && (
                <button
                  type="button"
                  onClick={assignSelf}
                  className="min-h-[44px] px-3 py-2 text-[11px] font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow inline-flex items-center gap-1.5"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Assign to me
                </button>
              )}
              {addableOptions.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowReassign(v => !v)}
                    className="min-h-[44px] px-3 py-2 text-[11px] font-black uppercase tracking-widest bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg inline-flex items-center gap-1.5"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Add mechanic <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  {showReassign && (
                    <>
                      <button type="button" className="fixed inset-0 z-40 cursor-default" onClick={() => setShowReassign(false)} aria-label="Close picker" />
                      <div className="absolute z-50 mt-1 left-0 bg-white border border-slate-200 rounded-lg shadow-xl py-1 min-w-[200px] max-h-56 overflow-y-auto">
                        {addableOptions.map(o => (
                          <button
                            key={o.userEmail}
                            type="button"
                            onClick={() => { toggleAssignee(o); }}
                            className="block w-full text-left px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 truncate"
                            title={o.userEmail}
                          >
                            {o.userName || o.userEmail}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Status controls — simplified to two paths: Mark Complete
              (forward, opens CompletionModal for cost/labor capture) and
              Move Back / Reopen (backward, simple status flip). The old
              "Move Forward" step (todo → doing) is gone; the doing state
              is preserved in schema and still settable by any future path,
              but the manual one-step-forward affordance has been removed
              to keep the flow simple — Mark Complete handles the entire
              forward path. */}
          <section className="space-y-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Status</div>
            <div className="flex flex-wrap gap-2">
              {status !== 'todo' && (
                <button
                  type="button"
                  onClick={goBack}
                  className="min-h-[44px] px-3 py-2 text-[11px] font-black uppercase tracking-widest bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg inline-flex items-center gap-1.5"
                  title={status === 'done' ? 'Re-open this task' : 'Move status one step back'}
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> {status === 'done' ? 'Reopen' : 'Move Back'}
                </button>
              )}
              {status !== 'done' && (
                <button
                  type="button"
                  onClick={markComplete}
                  className="min-h-[44px] px-3 py-2 text-[11px] font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow inline-flex items-center gap-1.5"
                  title="Open the completion prompt (cost + labor hours)"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Mark Complete
                </button>
              )}
            </div>
          </section>

          {/* Notes feed — filtered view of the activity log, showing only
              user-added notes. Status changes / priority toggles / etc.
              are still appended to task.activity in the data layer for
              audit, but they're hidden here. */}
          <section className="space-y-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 inline-flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" /> Notes
              <span className="text-slate-400 font-bold normal-case tracking-normal">({notesFeed.length})</span>
            </div>
            <div ref={activityRef} className="bg-white border border-slate-200 rounded-xl max-h-72 overflow-y-auto divide-y divide-slate-100">
              {notesFeed.length === 0 ? (
                <div className="text-xs text-slate-400 italic px-3 py-4 text-center">No notes yet.</div>
              ) : (
                notesFeed.map(a => {
                  const noteText = a.payload?.noteText as string | undefined;
                  return (
                    <div key={a.id} className="px-3 py-2 text-[12px] leading-snug">
                      <div className="flex items-baseline justify-between gap-2 flex-wrap">
                        <span className="font-bold text-slate-700 truncate">{a.userName || a.userEmail || 'Unknown'}</span>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">{relativeOrAbs(a.timestamp)}</span>
                      </div>
                      {noteText && (
                        <div className="mt-1 bg-slate-50 border border-slate-100 rounded p-2 text-[12px] text-slate-700 whitespace-pre-wrap">{noteText}</div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>

        {/* Sticky bottom — add note + (gated) destructive delete */}
        <div className="border-t border-slate-200 bg-white p-3 md:p-4 shrink-0 space-y-2">
          {canDelete && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(task.id)}
              className="w-full md:w-auto min-h-[44px] px-3 py-2 text-[11px] font-black uppercase tracking-widest text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg inline-flex items-center justify-center gap-1.5"
              title="Permanently delete this task"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete task
            </button>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitNote(); } }}
              rows={1}
              placeholder="Add a note (e.g. Ordered the part, ETA Tuesday)…"
              className="flex-1 min-h-[44px] resize-y border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400"
            />
            <button
              type="button"
              onClick={submitNote}
              disabled={!noteDraft.trim()}
              className="min-h-[44px] px-4 py-2 text-[11px] font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow disabled:bg-slate-300 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              title="Send note (⌘/Ctrl+Enter)"
            >
              <Send className="w-3.5 h-3.5" /> Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

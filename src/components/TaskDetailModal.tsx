import { useState, useEffect } from 'react';
import { X, Trash2, MessageSquare, Send, Flame } from 'lucide-react';
import { TaskMasterTask, Employee } from '../types';

interface TaskDetailModalProps {
  task: TaskMasterTask | null;
  employees: Employee[];
  currentUserEmail: string;
  canEditAnyField: boolean;   // admin
  canDelete: boolean;         // admin
  onClose: () => void;
  onUpdate: (taskId: string, patch: Partial<TaskMasterTask>) => void;
  onStatusChange: (taskId: string, status: TaskMasterTask['status']) => void;
  onAddNote: (taskId: string, text: string) => void;
  onDelete: (taskId: string) => void;
}

function formatDateTime(ms: number): string {
  try { return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return ''; }
}

function toDateInput(ms: number | undefined): string {
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function TaskDetailModal({
  task,
  employees,
  currentUserEmail,
  canEditAnyField,
  canDelete,
  onClose,
  onUpdate,
  onStatusChange,
  onAddNote,
  onDelete,
}: TaskDetailModalProps) {
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftDue, setDraftDue] = useState('');
  const [draftAssigneeId, setDraftAssigneeId] = useState('');
  const [noteText, setNoteText] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (task) {
      setDraftTitle(task.title);
      setDraftDescription(task.description || '');
      setDraftDue(toDateInput(task.dueDate));
      setDraftAssigneeId(task.assignedTo?.employeeId || '');
      setNoteText('');
      setDirty(false);
    }
  }, [task?.id]);

  if (!task) return null;

  const me = (currentUserEmail || '').toLowerCase();
  const isAssignee = (task.assignedTo?.email || '').toLowerCase() === me;
  const canChangeStatus = canEditAnyField || isAssignee;

  // Same admin/manager filter as CreateTaskModal — only office-tier
  // employees are eligible task assignees. Defensive: if the existing
  // task's assignee no longer qualifies (e.g., demoted to worker), the
  // task is still shown but the dropdown cannot re-select them; admin
  // must pick a new admin/manager.
  const activeEmployees = (employees || [])
    .filter(e => e.status === 'Active')
    .filter(e => (e.linkedUserEmail || e.email))
    .filter(e => e.systemRole === 'admin' || e.systemRole === 'manager')
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const currentAssigneeEligible = !!activeEmployees.find(e => e.id === task.assignedTo?.employeeId);

  const saveEdits = () => {
    const patch: Partial<TaskMasterTask> = {};
    const t = draftTitle.trim();
    if (t && t !== task.title) patch.title = t;
    if ((draftDescription || '') !== (task.description || '')) patch.description = draftDescription;
    const due = draftDue ? Date.parse(`${draftDue}T23:59:59`) : null;
    const dueNow = task.dueDate || null;
    if ((due || null) !== dueNow) {
      if (due) patch.dueDate = due;
      else patch.dueDate = undefined;
    }
    if (draftAssigneeId && draftAssigneeId !== task.assignedTo?.employeeId) {
      const emp = activeEmployees.find(e => e.id === draftAssigneeId);
      if (emp) {
        const email = (emp.linkedUserEmail || emp.email || '').trim();
        if (email) patch.assignedTo = { employeeId: emp.id, email, name: emp.name || email };
      }
    }
    if (Object.keys(patch).length > 0) onUpdate(task.id, patch);
    setDirty(false);
  };

  const submitNote = () => {
    const t = noteText.trim();
    if (!t) return;
    onAddNote(task.id, t);
    setNoteText('');
  };

  const confirmDelete = () => {
    if (!window.confirm(`Delete task "${task.title}"? This cannot be undone.`)) return;
    onDelete(task.id);
  };

  const notes = (task.notes || []).slice().sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            {task.priority === 'high' && (
              <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border bg-rose-100 text-rose-700 border-rose-300 inline-flex items-center gap-0.5"><Flame className="w-2.5 h-2.5" />HIGH</span>
            )}
            <h2 className="text-lg font-bold text-slate-800">Task Detail</h2>
          </div>
          <div className="flex items-center gap-1">
            {canDelete && (
              <button onClick={confirmDelete} aria-label="Delete task" className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg" title="Delete task">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button onClick={onClose} aria-label="Close" className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Title</label>
            {canEditAnyField ? (
              <input
                type="text"
                value={draftTitle}
                onChange={e => { setDraftTitle(e.target.value); setDirty(true); }}
                className="w-full border border-slate-300 rounded-lg p-2 text-base font-bold text-slate-800 outline-none focus:ring-2 focus:ring-lime-400"
              />
            ) : (
              <div className="text-base font-bold text-slate-800">{task.title}</div>
            )}
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Description</label>
            {canEditAnyField ? (
              <textarea
                value={draftDescription}
                onChange={e => { setDraftDescription(e.target.value); setDirty(true); }}
                rows={4}
                className="w-full border border-slate-300 rounded-lg p-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-lime-400 resize-none"
              />
            ) : (
              <div className="text-sm text-slate-700 whitespace-pre-wrap">{task.description || <span className="italic text-slate-400">No description.</span>}</div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Status</label>
              {canChangeStatus ? (
                <select
                  value={task.status}
                  onChange={e => onStatusChange(task.id, e.target.value as TaskMasterTask['status'])}
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-lime-400 bg-white"
                >
                  <option value="not_started">Not Started</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Done</option>
                </select>
              ) : (
                <div className="text-sm font-bold text-slate-700">{task.status === 'not_started' ? 'Not Started' : task.status === 'in_progress' ? 'In Progress' : 'Done'}</div>
              )}
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Priority</label>
              {canEditAnyField ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onUpdate(task.id, { priority: 'normal' })}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border ${task.priority === 'normal' ? 'bg-slate-100 text-slate-700 border-slate-300' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                  >Normal</button>
                  <button
                    type="button"
                    onClick={() => onUpdate(task.id, { priority: 'high' })}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border inline-flex items-center justify-center gap-1 ${task.priority === 'high' ? 'bg-rose-100 text-rose-700 border-rose-300' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                  ><Flame className="w-3 h-3" /> High</button>
                </div>
              ) : (
                <div className="text-sm font-bold text-slate-700 capitalize">{task.priority}</div>
              )}
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Assignee</label>
              {canEditAnyField ? (
                <>
                  {!currentAssigneeEligible && (
                    <div className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mb-1">
                      Currently assigned to <span className="font-bold">{task.assignedTo?.name || task.assignedTo?.email}</span> — their role is no longer eligible. Pick a new admin/manager to reassign.
                    </div>
                  )}
                  <select
                    value={currentAssigneeEligible ? draftAssigneeId : ''}
                    onChange={e => { setDraftAssigneeId(e.target.value); setDirty(true); }}
                    className="w-full border border-slate-300 rounded-lg p-2 text-sm font-medium text-slate-800 outline-none focus:ring-2 focus:ring-lime-400 bg-white"
                  >
                    {!currentAssigneeEligible && <option value="">Pick a new assignee…</option>}
                    {activeEmployees.map(e => (
                      <option key={e.id} value={e.id}>{e.name}{e.isTestUser ? ' (TEST)' : ''}</option>
                    ))}
                  </select>
                  {activeEmployees.length === 0 && (
                    <div className="text-[11px] text-rose-600 mt-1">No eligible assignees — only admin/manager employees can be assigned.</div>
                  )}
                </>
              ) : (
                <div className="text-sm font-medium text-slate-700">{task.assignedTo?.name || task.assignedTo?.email || 'Unassigned'}</div>
              )}
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Due Date</label>
              {canEditAnyField ? (
                <input
                  type="date"
                  value={draftDue}
                  onChange={e => { setDraftDue(e.target.value); setDirty(true); }}
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-lime-400"
                />
              ) : (
                <div className="text-sm text-slate-700">{task.dueDate ? formatDateTime(task.dueDate) : <span className="italic text-slate-400">No due date.</span>}</div>
              )}
            </div>
          </div>

          {canEditAnyField && dirty && (
            <div className="flex items-center justify-end gap-2 border-t border-dashed border-slate-200 pt-3">
              <button
                type="button"
                onClick={() => {
                  if (!task) return;
                  setDraftTitle(task.title);
                  setDraftDescription(task.description || '');
                  setDraftDue(toDateInput(task.dueDate));
                  setDraftAssigneeId(task.assignedTo?.employeeId || '');
                  setDirty(false);
                }}
                className="text-xs font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-100 px-3 py-1.5 rounded-md"
              >Revert</button>
              <button
                type="button"
                onClick={saveEdits}
                className="text-xs font-black uppercase tracking-widest text-white bg-lime-600 hover:bg-lime-700 px-3 py-1.5 rounded-md shadow-sm"
              >Save edits</button>
            </div>
          )}

          <div className="border-t border-slate-100 pt-3 text-[11px] text-slate-500 grid grid-cols-1 sm:grid-cols-2 gap-1">
            <div>Created by <span className="font-bold text-slate-700">{task.createdBy?.name || task.createdBy?.email}</span></div>
            <div>{formatDateTime(task.createdAt)}</div>
            {task.status === 'done' && task.completedAt && (
              <>
                <div>Completed</div>
                <div>{formatDateTime(task.completedAt)}</div>
              </>
            )}
          </div>

          <div className="border-t border-slate-100 pt-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 inline-flex items-center gap-1.5 mb-2"><MessageSquare className="w-3.5 h-3.5" /> Notes</div>
            {notes.length === 0 ? (
              <div className="text-xs italic text-slate-400">No notes yet.</div>
            ) : (
              <ul className="space-y-2">
                {notes.map(n => (
                  <li key={n.id} className="bg-slate-50 border border-slate-100 rounded-lg p-2">
                    <div className="text-[11px] font-bold text-slate-700">{n.author?.name || n.author?.email}<span className="font-medium text-slate-400 ml-2">{formatDateTime(n.createdAt)}</span></div>
                    <div className="text-sm text-slate-800 whitespace-pre-wrap">{n.text}</div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitNote(); }}
                placeholder="Add a note…"
                className="flex-1 border border-slate-300 rounded-lg p-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-lime-400"
              />
              <button
                type="button"
                onClick={submitNote}
                disabled={!noteText.trim()}
                className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-widest text-white bg-slate-700 hover:bg-slate-800 disabled:bg-slate-300 px-3 py-2 rounded-md"
              >
                <Send className="w-3.5 h-3.5" /> Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

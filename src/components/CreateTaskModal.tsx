import { useState, useEffect } from 'react';
import { X, Flame } from 'lucide-react';
import { Employee } from '../types';

export interface CreateTaskSubmit {
  title: string;
  description: string;
  assignedTo: { employeeId: string; email: string; name: string };
  dueDate: number | null;
  priority: 'high' | 'normal';
}

interface CreateTaskModalProps {
  isOpen: boolean;
  employees: Employee[];
  onClose: () => void;
  onSubmit: (data: CreateTaskSubmit) => void;
}

export default function CreateTaskModal({ isOpen, employees, onClose, onSubmit }: CreateTaskModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<'high' | 'normal'>('normal');
  const [color, setColor] = useState('');
  const [error, setError] = useState('');

  // Reset on open so reopening doesn't leak the previous form's state.
  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDescription('');
      setAssigneeId('');
      setDueDate('');
      setPriority('normal');
      setError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Only admin/manager employees are eligible task assignees — the
  // feature is targeted at office workflows, not field worker tasking.
  // Workers/foremen/mechanics are intentionally hidden from the picker.
  const activeEmployees = (employees || [])
    .filter(e => e.status === 'Active')
    .filter(e => (e.linkedUserEmail || e.email))
    .filter(e => e.systemRole === 'admin' || e.systemRole === 'manager')
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const submit = () => {
    const t = title.trim();
    if (!t) { setError('Title is required.'); return; }
    const emp = activeEmployees.find(e => e.id === assigneeId);
    if (!emp) { setError('Pick an assignee.'); return; }
    const email = (emp.linkedUserEmail || emp.email || '').trim();
    if (!email) { setError("Selected employee has no email on file."); return; }
    let dueMs: number | null = null;
    if (dueDate) {
      const parsed = Date.parse(`${dueDate}T23:59:59`);
      dueMs = Number.isFinite(parsed) ? parsed : null;
    }
    onSubmit({
      title: t,
      description: description.trim(),
      assignedTo: { employeeId: emp.id, email, name: emp.name || email },
      dueDate: dueMs,
      priority,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-800">Create Task</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              autoFocus
              className="w-full border border-slate-300 rounded-lg p-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-lime-400"
            />
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              className="w-full border border-slate-300 rounded-lg p-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-lime-400 resize-none"
              placeholder="Optional — details, links, expectations…"
            />
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Assignee *</label>
            <select
              value={assigneeId}
              onChange={e => setAssigneeId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2 text-sm font-medium text-slate-800 outline-none focus:ring-2 focus:ring-lime-400 bg-white"
            >
              <option value="">Pick an employee…</option>
              {activeEmployees.map(e => (
                <option key={e.id} value={e.id}>{e.name}{e.isTestUser ? ' (TEST)' : ''}</option>
              ))}
            </select>
            {activeEmployees.length === 0 && (
              <div className="text-[11px] text-rose-600 mt-1">No eligible assignees — only admin and manager employees can be assigned tasks.</div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full border border-slate-300 rounded-lg p-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-lime-400"
              />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Priority</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPriority('normal')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${priority === 'normal' ? 'bg-slate-100 text-slate-700 border-slate-300' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                >
                  Normal
                </button>
                <button
                  type="button"
                  onClick={() => setPriority('high')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border inline-flex items-center justify-center gap-1 transition-colors ${priority === 'high' ? 'bg-rose-100 text-rose-700 border-rose-300' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                >
                  <Flame className="w-3 h-3" /> High
                </button>
              </div>
            </div>
          </div>

          {error && <div className="text-[12px] font-medium text-rose-600">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-200 px-3 py-2 rounded-md"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="text-xs font-black uppercase tracking-widest text-white bg-lime-600 hover:bg-lime-700 px-4 py-2 rounded-md shadow-sm"
          >
            Create Task
          </button>
        </div>
      </div>
    </div>
  );
}

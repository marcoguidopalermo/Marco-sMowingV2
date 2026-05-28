import { useMemo, useState } from 'react';
import { CheckSquare, Plus, ChevronDown, ChevronUp, MessageSquare, Flame } from 'lucide-react';
import { TaskMasterTask, Employee } from '../types';

interface TaskMasterProps {
  tasks: Record<string, TaskMasterTask>;
  employees: Employee[];
  canCreate: boolean;
  currentUserEmail: string;
  onOpenCreate: () => void;
  onOpenTask: (taskId: string) => void;
}

type SortKey = 'due' | 'created' | 'priority';

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDueDate(ms: number): { label: string; tone: 'red' | 'amber' | 'slate' } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const due = new Date(ms);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const diffDays = Math.round((dueDay - today) / DAY_MS);
  const dateStr = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (diffDays < 0) return { label: `Overdue · ${dateStr}`, tone: 'red' };
  if (diffDays === 0) return { label: 'Due today', tone: 'amber' };
  if (diffDays === 1) return { label: 'Due tomorrow', tone: 'amber' };
  return { label: dateStr, tone: 'slate' };
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function statusLabel(s: TaskMasterTask['status']): string {
  if (s === 'not_started') return 'Not Started';
  if (s === 'in_progress') return 'In Progress';
  return 'Done';
}

function statusToneChip(s: TaskMasterTask['status']): string {
  if (s === 'not_started') return 'bg-slate-100 text-slate-700 border-slate-200';
  if (s === 'in_progress') return 'bg-blue-100 text-blue-700 border-blue-200';
  return 'bg-emerald-100 text-emerald-700 border-emerald-200';
}

export default function TaskMaster({
  tasks,
  canCreate,
  currentUserEmail,
  onOpenCreate,
  onOpenTask,
}: TaskMasterProps) {
  const [sortKey, setSortKey] = useState<SortKey>('due');
  const [notStartedOpen, setNotStartedOpen] = useState(true);
  const [inProgressOpen, setInProgressOpen] = useState(true);
  const [doneOpen, setDoneOpen] = useState(false);

  const me = (currentUserEmail || '').toLowerCase();

  const sortFn = (a: TaskMasterTask, b: TaskMasterTask) => {
    if (sortKey === 'priority') {
      const aP = a.priority === 'high' ? 0 : 1;
      const bP = b.priority === 'high' ? 0 : 1;
      if (aP !== bP) return aP - bP;
      return (b.createdAt || 0) - (a.createdAt || 0);
    }
    if (sortKey === 'created') {
      return (b.createdAt || 0) - (a.createdAt || 0);
    }
    // due — tasks with no dueDate sink; otherwise ascending (soonest first)
    const aHas = typeof a.dueDate === 'number';
    const bHas = typeof b.dueDate === 'number';
    if (aHas && bHas) return (a.dueDate || 0) - (b.dueDate || 0);
    if (aHas) return -1;
    if (bHas) return 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  };

  const { notStarted, inProgress, done } = useMemo(() => {
    const all = Object.values(tasks || {});
    const ns: TaskMasterTask[] = [];
    const ip: TaskMasterTask[] = [];
    const dn: TaskMasterTask[] = [];
    const cutoff = Date.now() - 30 * DAY_MS;
    for (const t of all) {
      if (t.status === 'not_started') ns.push(t);
      else if (t.status === 'in_progress') ip.push(t);
      else if (t.status === 'done' && (t.completedAt || 0) >= cutoff) dn.push(t);
    }
    ns.sort(sortFn);
    ip.sort(sortFn);
    // Done always sorted newest-completed first regardless of sortKey —
    // it's a recent-completions ledger, not a planning queue.
    dn.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    return { notStarted: ns, inProgress: ip, done: dn };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, sortKey]);

  const renderRow = (t: TaskMasterTask) => {
    const firstName = (t.assignedTo?.name || '').split(/\s+/)[0] || (t.assignedTo?.email || '').split('@')[0];
    const initial = (firstName || '?').charAt(0).toUpperCase();
    const dueChip = typeof t.dueDate === 'number' ? formatDueDate(t.dueDate) : null;
    const dueTone = dueChip
      ? (dueChip.tone === 'red' ? 'bg-rose-50 text-rose-700 border-rose-200'
        : dueChip.tone === 'amber' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200')
      : '';
    const noteCount = (t.notes || []).length;
    const myAck = (t.acknowledgedBy || {})[me];
    const isUnack = (t.assignedTo?.email || '').toLowerCase() === me && (!myAck || myAck < t.createdAt);
    return (
      <button
        key={t.id}
        type="button"
        onClick={() => onOpenTask(t.id)}
        className={`w-full text-left p-3 rounded-lg border shadow-sm hover:shadow transition-all ${isUnack ? 'bg-fuchsia-50/60 border-fuchsia-200' : 'bg-white border-slate-200'}`}
      >
        <div className="flex items-start gap-3">
          <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-black ${isUnack ? 'bg-fuchsia-200 text-fuchsia-800' : 'bg-slate-200 text-slate-700'}`}>{initial}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {t.priority === 'high' && (
                <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border bg-rose-100 text-rose-700 border-rose-300 inline-flex items-center gap-0.5"><Flame className="w-2.5 h-2.5" />HIGH</span>
              )}
              <span className="text-sm font-bold text-slate-800 truncate">{t.title}</span>
            </div>
            {t.description && (
              <div className="text-[12px] text-slate-500 mt-0.5 line-clamp-2">{truncate(t.description, 120)}</div>
            )}
            <div className="text-[11px] font-medium text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
              <span className="truncate">{firstName}</span>
              {dueChip && <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${dueTone}`}>{dueChip.label}</span>}
              {noteCount > 0 && (
                <span className="inline-flex items-center gap-0.5 text-slate-400"><MessageSquare className="w-3 h-3" />{noteCount}</span>
              )}
            </div>
          </div>
          <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border ${statusToneChip(t.status)}`}>{statusLabel(t.status)}</span>
        </div>
      </button>
    );
  };

  const Section = ({
    title,
    items,
    isOpen,
    setOpen,
    emptyMsg,
  }: {
    title: string;
    items: TaskMasterTask[];
    isOpen: boolean;
    setOpen: (b: boolean) => void;
    emptyMsg: string;
  }) => (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-black uppercase tracking-widest text-slate-700">{title}</span>
          <span className="text-[10px] font-bold text-slate-400">{items.length}</span>
        </div>
        {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {isOpen && (
        <div className="border-t border-slate-100 p-3 space-y-2">
          {items.length === 0
            ? <div className="text-xs text-slate-400 italic text-center py-2">{emptyMsg}</div>
            : items.map(renderRow)}
        </div>
      )}
    </section>
  );

  return (
    <div className="flex-1 overflow-y-auto bg-gray-100 p-4 md:p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <CheckSquare className="w-6 h-6 text-slate-700" /> Tasks
          </h2>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Sort</label>
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as SortKey)}
              className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-xs font-medium text-slate-800 outline-none"
            >
              <option value="due">Due Date</option>
              <option value="created">Created</option>
              <option value="priority">Priority</option>
            </select>
            {canCreate && (
              <button
                type="button"
                onClick={onOpenCreate}
                className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-white bg-lime-600 hover:bg-lime-700 px-3 py-2 rounded-md shadow-sm transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Create Task
              </button>
            )}
          </div>
        </div>

        <Section title="Not Started" items={notStarted} isOpen={notStartedOpen} setOpen={setNotStartedOpen} emptyMsg="Nothing waiting." />
        <Section title="In Progress" items={inProgress} isOpen={inProgressOpen} setOpen={setInProgressOpen} emptyMsg="Nothing in progress." />
        <Section title="Done · last 30 days" items={done} isOpen={doneOpen} setOpen={setDoneOpen} emptyMsg="No completed tasks in the past 30 days." />
      </div>
    </div>
  );
}

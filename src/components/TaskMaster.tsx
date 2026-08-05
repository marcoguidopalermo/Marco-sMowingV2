import { useMemo, useState } from 'react';
import { CheckSquare, Plus, ChevronDown, ChevronUp, MessageSquare, Flame, Check, ClipboardList } from 'lucide-react';
import { TaskMasterTask, Employee, RoleTaskInstance, RoleMasterDuty, RoleMasterResponsibility } from '../types';
import { personColorClass } from '../lib/personColor';
import { dutyChip } from '../lib/roleResponsibilities';
import Stamp from './Stamp';

interface TaskMasterProps {
  tasks: Record<string, TaskMasterTask>;
  employees: Employee[];
  canCreate: boolean;
  currentUserEmail: string;
  onOpenCreate: () => void;
  onOpenTask: (taskId: string) => void;
  // One-tap complete from an open task card → status 'done' + completedAt.
  onComplete: (taskId: string) => void;
  // RoleMaster generated duty instances (open only) rendered in the SAME list.
  roleInstances?: RoleTaskInstance[];
  duties?: Record<string, RoleMasterDuty>;
  responsibilities?: Record<string, RoleMasterResponsibility>;
  categoryColors?: Record<string, string>;
  onOpenRoleInstance?: (id: string) => void;
  // Admin-only: unlocks the "All tasks" vs "Assigned to me" split. When
  // true the `tasks` prop is the full cross-user set; the component itself
  // separates the admin's own work (default landing) from everyone's.
  // Non-admins never receive others' tasks, so this stays false and the
  // board renders exactly as before — no visibility widened here.
  canViewAllTasks?: boolean;
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

// Stack open role instances by dutyId → one representative (earliest due) +
// count of outstanding, so multiple missed occurrences of a duty collapse.
interface RoleGroup { rep: RoleTaskInstance; count: number; }
function stackRoleInstances(list: RoleTaskInstance[]): RoleGroup[] {
  const byDuty: Record<string, RoleTaskInstance[]> = {};
  for (const i of list) (byDuty[i.dutyId] = byDuty[i.dutyId] || []).push(i);
  return Object.values(byDuty).map(arr => {
    arr.sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));
    return { rep: arr[0], count: arr.length };
  });
}

export default function TaskMaster({
  tasks,
  employees = [],
  canCreate,
  currentUserEmail,
  onOpenCreate,
  onOpenTask,
  onComplete,
  roleInstances = [],
  duties = {},
  responsibilities = {},
  categoryColors = {},
  onOpenRoleInstance,
  canViewAllTasks = false,
}: TaskMasterProps) {
  const [sortKey, setSortKey] = useState<SortKey>('due');
  const [notStartedOpen, setNotStartedOpen] = useState(true);
  const [doneOpen, setDoneOpen] = useState(false);
  // Admin scope split — personal work is the default landing; the full
  // picture is one tap away (mirrors the mechanic/contractor pattern).
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  // "All tasks" filters — inert on the "Assigned to me" tab.
  const [personFilter, setPersonFilter] = useState<string>('all'); // lowercase email | 'all'
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'done'>('all');

  const me = (currentUserEmail || '').toLowerCase();
  // Non-admins never get the split; force the personal scope so the board
  // is identical to before regardless of any stale state.
  const activeScope: 'mine' | 'all' = canViewAllTasks ? scope : 'mine';

  // Assignee IDENTITY colour: map each linked email to the colour set on the
  // employee record. `assigneeColor` resolves an assignee to a bg-*-500 class
  // — the person's assigned colour, or the deterministic hash fallback for
  // anyone without one. Drives the row's left-edge bar, avatar and name chip.
  const empColorByEmail = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees) {
      const email = (e.linkedUserEmail || e.email || '').toLowerCase();
      if (email && e.color) m.set(email, e.color);
    }
    return m;
  }, [employees]);
  const assigneeColor = (email: string | undefined) => {
    const e = (email || '').toLowerCase();
    return personColorClass(empColorByEmail.get(e), email);
  };

  // Distinct assignees across the full set — drives the person filter.
  const assigneeOptions = useMemo(() => {
    const byEmail = new Map<string, string>();
    for (const t of Object.values(tasks || {})) {
      const email = (t.assignedTo?.email || '').toLowerCase();
      if (email && !byEmail.has(email)) byEmail.set(email, t.assignedTo?.name || email);
    }
    return [...byEmail.entries()].map(([email, name]) => ({ email, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  // Tab counts — open items per scope, computed from the full set so both
  // badges read correctly no matter which tab is active.
  const { mineOpenCount, allOpenCount } = useMemo(() => {
    let mine = 0, all = 0;
    for (const t of Object.values(tasks || {})) {
      if (t.status === 'done') continue;
      all += 1;
      if ((t.assignedTo?.email || '').toLowerCase() === me) mine += 1;
    }
    for (const i of roleInstances) {
      if (i.status !== 'open') continue;
      all += 1;
      if ((i.assignedTo?.email || '').toLowerCase() === me) mine += 1;
    }
    return { mineOpenCount: mine, allOpenCount: all };
  }, [tasks, roleInstances, me]);

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

  // Scope + person filter, applied identically to tasks and role duties.
  const inScope = (email: string | undefined) => {
    const e = (email || '').toLowerCase();
    if (activeScope === 'mine') return e === me;
    if (personFilter !== 'all') return e === personFilter;
    return true;
  };

  const { notStarted, done } = useMemo(() => {
    const all = Object.values(tasks || {}).filter(t => inScope(t.assignedTo?.email));
    const ns: TaskMasterTask[] = [];
    const dn: TaskMasterTask[] = [];
    const cutoff = Date.now() - 30 * DAY_MS;
    for (const t of all) {
      // Two states: done (recent) vs open. Any non-'done' status —
      // including legacy 'in_progress' — counts as open.
      if (t.status === 'done') {
        if ((t.completedAt || 0) >= cutoff) dn.push(t);
      } else {
        ns.push(t);
      }
    }
    ns.sort(sortFn);
    // Done always sorted newest-completed first regardless of sortKey —
    // it's a recent-completions ledger, not a planning queue.
    dn.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    return { notStarted: ns, done: dn };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, sortKey, activeScope, personFilter, me]);

  const scopedRoleInstances = useMemo(
    () => roleInstances.filter(i => inScope(i.assignedTo?.email)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roleInstances, activeScope, personFilter, me],
  );
  const roleGroups = useMemo(() => stackRoleInstances(scopedRoleInstances), [scopedRoleInstances]);
  // Due-soon banner: open duties due within their dueSoonDays window (or overdue).
  const dueSoonCount = useMemo(() => {
    const now = Date.now();
    return scopedRoleInstances.filter(i => {
      const win = (i.dueSoonDays ?? 2) * DAY_MS;
      return (i.dueDate || 0) - now <= win;   // due within window OR overdue
    }).length;
  }, [scopedRoleInstances]);

  // A role-duty row (stacked). Urgency: overdue red, due-today/soon amber,
  // else slate — reusing the same tone vocabulary as regular tasks.
  const renderRoleRow = (g: RoleGroup) => {
    const inst = g.rep;
    const duty = duties[inst.dutyId];
    const belongs = duty ? dutyChip(duty, responsibilities, categoryColors) : null;
    const due = formatDueDate(inst.dueDate);
    const dueSoon = !due.tone.includes('red') && (inst.dueDate - Date.now() <= (inst.dueSoonDays ?? 2) * DAY_MS);
    const tone = due.tone === 'red' ? 'bg-rose-50 text-rose-700 border-rose-200'
      : (dueSoon || due.tone === 'amber') ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
    const firstName = (inst.assignedTo?.name || '').split(/\s+/)[0] || '?';
    const color = assigneeColor(inst.assignedTo?.email);
    return (
      <div key={`role-${inst.dutyId}`} role="button" tabIndex={0}
        onClick={() => onOpenRoleInstance?.(inst.id)}
        onKeyDown={(e) => { if (e.key === 'Enter') onOpenRoleInstance?.(inst.id); }}
        className="relative w-full text-left p-3 pl-4 rounded-lg border shadow-sm hover:shadow cursor-pointer bg-white border-indigo-200 overflow-hidden">
        <span className={`absolute inset-y-0 left-0 w-1.5 ${color}`} aria-hidden="true" />
        <div className="flex items-start gap-3">
          <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white ${color}`}><ClipboardList className="w-4 h-4" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${belongs ? belongs.color.chip : 'bg-indigo-50 text-indigo-700 border-indigo-200'}`}>Role duty{belongs ? ` · ${belongs.label}` : ''}</span>
              <span className="text-sm font-bold text-slate-800 truncate">{inst.title}</span>
              {g.count > 1 && <span className="text-[10px] font-black bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full">{g.count} outstanding</span>}
            </div>
            <div className="text-[11px] font-medium text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
              <span className={`inline-flex text-white text-[10px] font-bold px-1.5 py-0.5 rounded ${color}`}>{firstName}</span>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${tone}`}>{due.label}</span>
            </div>
          </div>
          <button type="button" onClick={(e) => { e.stopPropagation(); onOpenRoleInstance?.(inst.id); }}
            className="shrink-0 inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-widest">
            <Check className="w-4 h-4" /> Log
          </button>
        </div>
      </div>
    );
  };

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
    // The ASSIGNEE'S identity colour — their assigned palette colour (or the
    // hash fallback). Drives the left-edge bar + avatar + name chip so
    // ownership reads at a glance, especially on the admin All Tasks view.
    const assignColor = assigneeColor(t.assignedTo?.email);
    const done = t.status === 'done';
    return (
      <div
        key={t.id}
        role="button"
        tabIndex={0}
        onClick={() => onOpenTask(t.id)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenTask(t.id); } }}
        className={`relative w-full text-left p-3 pl-4 rounded-lg border shadow-sm hover:shadow transition-all cursor-pointer overflow-hidden ${isUnack ? 'bg-fuchsia-50/60 border-fuchsia-200' : 'bg-white border-slate-200'}`}
      >
        <span className={`absolute inset-y-0 left-0 w-1.5 ${assignColor}`} aria-hidden="true" />
        {/* COMPLETED stamp — centered overlay on done tasks. pointer-events-
            none keeps the card clickable; the body dims beneath it. */}
        {done && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <Stamp label="Completed" color="emerald" size="lg" rotate={-6} />
          </div>
        )}
        <div className={`flex items-start gap-3 ${done ? 'opacity-60' : ''}`}>
          <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-black text-white ${assignColor}`}>{initial}</div>
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
              <span className={`inline-flex items-center max-w-[140px] truncate text-white text-[10px] font-bold px-1.5 py-0.5 rounded ${assignColor}`}>{firstName}</span>
              {dueChip && <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${dueTone}`}>{dueChip.label}</span>}
              {noteCount > 0 && (
                <span className="inline-flex items-center gap-0.5 text-slate-400"><MessageSquare className="w-3 h-3" />{noteCount}</span>
              )}
            </div>
          </div>
          {/* Primary action on an open task — one-tap Complete. Done tasks
              carry the Completed stamp instead. */}
          {!done && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onComplete(t.id); }}
              className="shrink-0 inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-widest shadow-sm transition-colors"
              title="Mark this task complete"
            >
              <Check className="w-4 h-4" /> Complete
            </button>
          )}
        </div>
      </div>
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

        {/* Admin scope split — personal work first, everything one tap away. */}
        {canViewAllTasks && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setScope('mine')}
                aria-pressed={activeScope === 'mine'}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border transition-colors ${activeScope === 'mine' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                Assigned to me
                <span className={`text-[10px] font-black rounded-full px-1.5 py-0.5 ${activeScope === 'mine' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{mineOpenCount}</span>
              </button>
              <button
                type="button"
                onClick={() => setScope('all')}
                aria-pressed={activeScope === 'all'}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border transition-colors ${activeScope === 'all' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                All tasks
                <span className={`text-[10px] font-black rounded-full px-1.5 py-0.5 ${activeScope === 'all' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{allOpenCount}</span>
              </button>
            </div>

            {activeScope === 'all' && (
              <div className="flex items-center gap-2 flex-wrap bg-white border border-slate-200 rounded-lg px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Person</label>
                  <select
                    value={personFilter}
                    onChange={e => setPersonFilter(e.target.value)}
                    className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-xs font-medium text-slate-800 outline-none max-w-[160px]"
                  >
                    <option value="all">Everyone</option>
                    {assigneeOptions.map(a => <option key={a.email} value={a.email}>{a.name}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Status</label>
                  <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value as 'all' | 'open' | 'done')}
                    className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-xs font-medium text-slate-800 outline-none"
                  >
                    <option value="all">All</option>
                    <option value="open">Open</option>
                    <option value="done">Done</option>
                  </select>
                </div>
                {(personFilter !== 'all' || statusFilter !== 'all') && (
                  <button
                    type="button"
                    onClick={() => { setPersonFilter('all'); setStatusFilter('all'); }}
                    className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 ml-auto"
                  >Clear</button>
                )}
              </div>
            )}
          </div>
        )}

        {dueSoonCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm font-bold text-amber-800 flex items-center gap-2">
            <ClipboardList className="w-4 h-4" /> {dueSoonCount} role {dueSoonCount === 1 ? 'duty is' : 'duties are'} due soon or overdue.
          </div>
        )}
        {/* OPEN — regular tasks + role-duty groups interleaved by due date. */}
        {statusFilter !== 'done' && (
        <section className="bg-white rounded-xl shadow-sm border border-slate-200">
          <button type="button" onClick={() => setNotStartedOpen(!notStartedOpen)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-widest text-slate-700">Open</span>
              <span className="text-[10px] font-bold text-slate-400">{notStarted.length + roleGroups.length}</span>
            </div>
            {notStartedOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>
          {notStartedOpen && (
            <div className="border-t border-slate-100 p-3 space-y-2">
              {(() => {
                const rows: { due: number; node: React.ReactNode }[] = [
                  ...notStarted.map(t => ({ due: typeof t.dueDate === 'number' ? t.dueDate : Number.MAX_SAFE_INTEGER, node: renderRow(t) })),
                  ...roleGroups.map(g => ({ due: g.rep.dueDate || 0, node: renderRoleRow(g) })),
                ].sort((a, b) => a.due - b.due);
                return rows.length === 0
                  ? <div className="text-xs text-slate-400 italic text-center py-2">Nothing open.</div>
                  : rows.map((r, i) => <div key={i}>{r.node}</div>);
              })()}
            </div>
          )}
        </section>
        )}
        {statusFilter !== 'open' && (
          <Section title="Done · last 30 days" items={done} isOpen={doneOpen} setOpen={setDoneOpen} emptyMsg="No completed tasks in the past 30 days." />
        )}
      </div>
    </div>
  );
}

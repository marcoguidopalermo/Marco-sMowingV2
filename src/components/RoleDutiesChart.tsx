import { useMemo, useState } from 'react';
import { Employee, RoleMasterRole, RoleMasterDuty, RoleTaskInstance } from '../types';
import { categoryColor } from '../lib/roleCategories';
import {
  describeRecurrence, dutyChartStatus, nextOccurrence, seasonResumeDate, DutyChartStatus,
} from '../lib/roleMaster';
import { Pencil, ArrowRightLeft } from 'lucide-react';

interface Props {
  roles: Record<string, RoleMasterRole>;
  duties: Record<string, RoleMasterDuty>;
  instances: Record<string, RoleTaskInstance>;
  employees: Employee[];
  categoryColors: Record<string, string>;
  isAdmin: boolean;
  onEditDuty: (d: RoleMasterDuty) => void;
  onMoveDuty: (dutyId: string, newRoleId: string) => void;
}

const torontoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const statusRank = (k: DutyChartStatus['kind']) => ({ overdue: 0, due_soon: 1, caught_up: 2, neutral: 3 }[k]);
function StatusIcon({ s }: { s: DutyChartStatus }) {
  if (s.kind === 'overdue') return <span className="text-rose-600 font-black" title="Overdue">🔴{s.count > 1 ? ` ${s.count}` : ''}</span>;
  if (s.kind === 'due_soon') return <span title="Due soon">🟡</span>;
  if (s.kind === 'caught_up') return <span title="Caught up">✅</span>;
  return <span className="text-slate-300" title={s.note || 'Inactive'}>—</span>;
}

export default function RoleDutiesChart({ roles, duties, instances, employees, categoryColors, isAdmin, onEditDuty, onMoveDuty }: Props) {
  const today = torontoToday();
  const empName = (id?: string) => employees.find(e => e.id === id)?.name;
  const [fDiv, setFDiv] = useState('');
  const [fRole, setFRole] = useState('');
  const [fHolder, setFHolder] = useState('');
  const [fCat, setFCat] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [moveFor, setMoveFor] = useState<string | null>(null);

  const openByDuty = useMemo(() => {
    const m: Record<string, RoleTaskInstance[]> = {};
    for (const i of Object.values(instances)) if (i.status === 'open') (m[i.dutyId] = m[i.dutyId] || []).push(i);
    return m;
  }, [instances]);

  const rows = useMemo(() => Object.values(duties).map(duty => {
    const role = roles[duty.roleId];
    const holderId = role?.assignedEmployeeId;
    const open = openByDuty[duty.id] || [];
    const status = dutyChartStatus(duty, open, today);
    const nextOpen = open.map(i => i.occurrenceDate).sort()[0];
    const nextDue = nextOpen || nextOccurrence(duty, today) || '';
    return { duty, role, holderId, holderName: empName(holderId), status, nextDue };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [duties, roles, openByDuty, today]);

  const categories = useMemo(() => [...new Set(Object.values(duties).map(d => d.category))].sort(), [duties]);
  const divisions = useMemo(() => [...new Set(Object.values(duties).map(d => d.division).filter(Boolean))].sort() as string[], [duties]);

  const filtered = rows.filter(r => {
    if (fDiv && r.duty.division !== fDiv) return false;
    if (fRole && r.duty.roleId !== fRole) return false;
    if (fHolder && r.holderId !== fHolder) return false;
    if (fCat && r.duty.category !== fCat) return false;
    if (activeOnly && !r.duty.active) return false;
    if (overdueOnly && r.status.kind !== 'overdue') return false;
    return true;
  }).sort((a, b) => (a.nextDue || '9999').localeCompare(b.nextDue || '9999'));

  // Per-holder rollup: worst status + total overdue.
  const rollup = useMemo(() => {
    const m: Record<string, { name: string; worst: DutyChartStatus['kind']; overdue: number }> = {};
    for (const r of rows) {
      if (!r.holderId) continue;
      const e = m[r.holderId] || { name: r.holderName || '—', worst: 'neutral' as DutyChartStatus['kind'], overdue: 0 };
      if (statusRank(r.status.kind) < statusRank(e.worst)) e.worst = r.status.kind;
      if (r.status.kind === 'overdue') e.overdue += r.status.count;
      m[r.holderId] = e;
    }
    return Object.entries(m).sort((a, b) => statusRank(a[1].worst) - statusRank(b[1].worst));
  }, [rows]);

  const icon = (k: DutyChartStatus['kind']) => k === 'overdue' ? '🔴' : k === 'due_soon' ? '🟡' : k === 'caught_up' ? '✅' : '—';

  return (
    <div className="space-y-3">
      {/* Per-holder rollup strip */}
      {rollup.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap gap-2">
          {rollup.map(([id, r]) => (
            <button key={id} onClick={() => setFHolder(fHolder === id ? '' : id)}
              className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${fHolder === id ? 'bg-slate-800 text-white border-slate-800' : 'bg-slate-50 text-slate-700 border-slate-200'}`}>
              {r.name} {icon(r.worst)}{r.overdue > 1 ? ` ${r.overdue}` : ''}
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap gap-2 items-center text-xs">
        <select value={fDiv} onChange={e => setFDiv(e.target.value)} className="border border-slate-200 rounded px-2 py-1"><option value="">All divisions</option>{divisions.map(d => <option key={d} value={d}>{d}</option>)}</select>
        <select value={fRole} onChange={e => setFRole(e.target.value)} className="border border-slate-200 rounded px-2 py-1"><option value="">All roles</option>{Object.values(roles).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <select value={fHolder} onChange={e => setFHolder(e.target.value)} className="border border-slate-200 rounded px-2 py-1"><option value="">All holders</option>{[...new Set(rows.map(r => r.holderId).filter(Boolean))].map(id => <option key={id} value={id!}>{empName(id!) || id}</option>)}</select>
        <select value={fCat} onChange={e => setFCat(e.target.value)} className="border border-slate-200 rounded px-2 py-1"><option value="">All categories</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>
        <label className="flex items-center gap-1 font-bold text-slate-500"><input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} /> Active only</label>
        <label className="flex items-center gap-1 font-bold text-slate-500"><input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} /> Overdue only</label>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <th className="py-2 px-2 text-center">Status</th>
              <th className="py-2 px-2 text-left">Duty</th>
              <th className="py-2 px-2 text-left">Category</th>
              <th className="py-2 px-2 text-left">Role</th>
              <th className="py-2 px-2 text-left">Holder</th>
              <th className="py-2 px-2 text-left">Recurrence</th>
              <th className="py-2 px-2 text-left">Division</th>
              <th className="py-2 px-2 text-left">Next due</th>
              {isAdmin && <th className="py-2 px-2" />}
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ duty, role, holderId, holderName, status, nextDue }) => {
              const cc = categoryColor(duty.category, categoryColors);
              const resume = status.note === 'Dormant' ? seasonResumeDate(duty, today) : null;
              return (
                <tr key={duty.id} className={`border-b border-slate-50 ${duty.active ? '' : 'opacity-55'}`}>
                  <td className="py-1.5 px-2 text-center"><StatusIcon s={status} /></td>
                  <td className="py-1.5 px-2 font-medium text-slate-700">{duty.name}{status.note && <span className="ml-1.5 text-[9px] font-black uppercase bg-slate-200 text-slate-500 px-1 rounded">{status.note}</span>}</td>
                  <td className="py-1.5 px-2"><span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${cc.chip}`}>{duty.category}</span></td>
                  <td className="py-1.5 px-2 text-slate-600">{role?.name || '—'}</td>
                  <td className="py-1.5 px-2">{holderId ? <span className="text-slate-700">{holderName}</span> : <span className="text-rose-600 font-bold text-[11px] uppercase bg-rose-50 px-1.5 py-0.5 rounded">Unassigned</span>}</td>
                  <td className="py-1.5 px-2 text-slate-500 text-[12px]">{describeRecurrence(duty)}{resume ? ` · resumes ${resume}` : ''}</td>
                  <td className="py-1.5 px-2 text-slate-500 text-[12px]">{duty.division || '—'}</td>
                  <td className="py-1.5 px-2 font-mono text-[12px] text-slate-600">{nextDue || '—'}</td>
                  {isAdmin && (
                    <td className="py-1.5 px-2 whitespace-nowrap text-right">
                      {moveFor === duty.id ? (
                        <select autoFocus defaultValue="" onChange={e => { if (e.target.value) { onMoveDuty(duty.id, e.target.value); setMoveFor(null); } }} onBlur={() => setMoveFor(null)} className="border border-slate-300 rounded px-1 py-0.5 text-[11px]">
                          <option value="">Move to…</option>
                          {Object.values(roles).filter(r => r.id !== duty.roleId).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      ) : (
                        <div className="inline-flex gap-1">
                          <button onClick={() => setMoveFor(duty.id)} title="Move to another role" className="text-slate-400 hover:text-slate-700"><ArrowRightLeft className="w-3.5 h-3.5" /></button>
                          <button onClick={() => onEditDuty(duty)} title="Edit duty" className="text-slate-400 hover:text-slate-700"><Pencil className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-slate-400">No duties match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

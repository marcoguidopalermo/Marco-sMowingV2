import { useMemo, useState } from 'react';
import { ClipboardList, Plus, Power, ChevronDown, ChevronRight, Pencil, UserCog, History } from 'lucide-react';
import {
  Employee, RoleMasterRole, RoleMasterDuty, RoleTaskInstance, RoleRecurrence, RoleInstanceStatus,
} from '../types';

interface RoleMasterProps {
  roles: Record<string, RoleMasterRole>;
  duties: Record<string, RoleMasterDuty>;
  instances: Record<string, RoleTaskInstance>;
  employees: Employee[];
  isAdmin: boolean;
  masterEnabled: boolean;
  onSetMasterEnabled: (v: boolean) => void;
  onSaveRole: (r: RoleMasterRole) => void;
  onSaveDuty: (d: RoleMasterDuty) => void;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const uid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function recurrenceLabel(r: RoleRecurrence): string {
  if (r.kind === 'weekly') return `Weekly · ${DOW[r.dayOfWeek ?? 1]}`;
  if (r.kind === 'biweekly') return `Biweekly${r.anchorDate ? ` · from ${r.anchorDate}` : ''}`;
  return `Monthly · ${r.dayOfMonth === 'last' ? 'last day' : `day ${r.dayOfMonth ?? 1}`}`;
}
const statusChip = (s: RoleInstanceStatus): string => ({
  open: 'bg-slate-100 text-slate-600', done: 'bg-emerald-100 text-emerald-700',
  done_late: 'bg-amber-100 text-amber-700', skipped: 'bg-slate-200 text-slate-500',
  missed: 'bg-rose-100 text-rose-700', voided: 'bg-slate-200 text-slate-400 line-through',
}[s] || 'bg-slate-100');

export default function RoleMaster({
  roles, duties, instances, employees, isAdmin, masterEnabled, onSetMasterEnabled, onSaveRole, onSaveDuty,
}: RoleMasterProps) {
  const [tab, setTab] = useState<'directory' | 'manage' | 'history'>('directory');
  const [expandedRole, setExpandedRole] = useState<Record<string, boolean>>({});
  const [editRole, setEditRole] = useState<RoleMasterRole | null>(null);
  const [editDuty, setEditDuty] = useState<RoleMasterDuty | null>(null);

  const empName = (id?: string) => employees.find(e => e.id === id)?.name || (id ? '(unknown)' : '(unassigned)');
  const roleList = useMemo(() => Object.values(roles).sort((a, b) => a.name.localeCompare(b.name)), [roles]);
  const dutiesOf = (roleId: string) => Object.values(duties).filter(d => d.roleId === roleId);

  const RoleCard = ({ role }: { role: RoleMasterRole }) => {
    const open = !!expandedRole[role.id];
    const rd = dutiesOf(role.id);
    const byCat: Record<string, RoleMasterDuty[]> = {};
    for (const d of rd) (byCat[d.category] = byCat[d.category] || []).push(d);
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <button type="button" onClick={() => setExpandedRole(s => ({ ...s, [role.id]: !s[role.id] }))}
          className="w-full text-left p-4 flex items-center justify-between gap-3 hover:bg-slate-50">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-slate-800">{role.name}</span>
              {!role.active && <span className="text-[10px] font-black uppercase bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded">inactive</span>}
            </div>
            {role.description && <div className="text-xs text-slate-500 mt-0.5">{role.description}</div>}
            <div className="text-[11px] text-slate-600 mt-1"><UserCog className="w-3 h-3 inline mr-1" />Held by <b>{empName(role.assignedEmployeeId)}</b> · {rd.length} duties</div>
          </div>
          {open ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
        </button>
        {open && (
          <div className="border-t border-slate-100 p-4 space-y-3">
            {isAdmin && (
              <div className="flex gap-2">
                <button onClick={() => setEditRole(role)} className="text-[11px] font-bold text-slate-600 border border-slate-300 rounded px-2 py-1 inline-flex items-center gap-1"><Pencil className="w-3 h-3" /> Edit role</button>
                <button onClick={() => setEditDuty({ id: uid('duty'), name: '', category: Object.keys(byCat)[0] || 'General', sop: '', notePrompt: '', recurrence: { kind: 'weekly', dayOfWeek: 1 }, dueSoonDays: 2, roleId: role.id, division: role.division, tier: 'admin', active: true })} className="text-[11px] font-bold text-white bg-slate-700 rounded px-2 py-1 inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Add duty</button>
              </div>
            )}
            {Object.keys(byCat).sort().map(cat => (
              <div key={cat}>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{cat}</div>
                <div className="space-y-1">
                  {byCat[cat].map(d => (
                    <div key={d.id} className="flex items-center justify-between gap-2 text-sm border border-slate-100 rounded px-2 py-1.5">
                      <div className="min-w-0">
                        <span className="font-medium text-slate-700">{d.name}</span>
                        {!d.active && <span className="ml-2 text-[9px] uppercase bg-slate-200 text-slate-500 px-1 rounded">off</span>}
                        <div className="text-[11px] text-slate-400">{recurrenceLabel(d.recurrence)} · asks: “{d.notePrompt}”</div>
                      </div>
                      {isAdmin && <button onClick={() => setEditDuty(d)} className="shrink-0 text-slate-400 hover:text-slate-700"><Pencil className="w-3.5 h-3.5" /></button>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {rd.length === 0 && <div className="text-xs text-slate-400 italic">No duties yet.</div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-100 p-4 md:p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><ClipboardList className="w-6 h-6 text-slate-700" /> RoleMaster</h2>
          <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
            <button onClick={() => setTab('directory')} className={`px-3 py-1.5 text-sm font-bold rounded-md ${tab === 'directory' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500'}`}>Directory</button>
            {isAdmin && <button onClick={() => setTab('manage')} className={`px-3 py-1.5 text-sm font-bold rounded-md ${tab === 'manage' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500'}`}>Manage</button>}
            {isAdmin && <button onClick={() => setTab('history')} className={`px-3 py-1.5 text-sm font-bold rounded-md ${tab === 'history' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500'}`}><History className="w-3.5 h-3.5 inline" /> History</button>}
          </div>
        </div>

        {isAdmin && (
          <div className={`rounded-xl border p-3 flex items-center justify-between gap-3 ${masterEnabled ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
            <div>
              <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><Power className="w-4 h-4" /> Duty generation {masterEnabled ? 'ON' : 'OFF (beta)'}</div>
              <div className="text-[11px] text-slate-500">When ON, the scheduled sync generates recurring duty tasks onto holders' calendars. Default OFF.</div>
            </div>
            <button onClick={() => onSetMasterEnabled(!masterEnabled)} className={`shrink-0 text-xs font-black uppercase tracking-widest px-3 py-2 rounded-lg ${masterEnabled ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-white'}`}>{masterEnabled ? 'Turn OFF' : 'Turn ON'}</button>
          </div>
        )}

        {tab === 'directory' && (
          <div className="space-y-3">
            {roleList.length === 0 ? <div className="text-center text-slate-400 py-8">No roles defined yet.</div> : roleList.map(r => <RoleCard key={r.id} role={r} />)}
          </div>
        )}

        {tab === 'manage' && isAdmin && (
          <div className="space-y-3">
            <button onClick={() => setEditRole({ id: uid('role'), name: '', description: '', tier: 'admin', active: true })} className="text-sm font-bold text-white bg-lime-600 hover:bg-lime-700 px-3 py-2 rounded-md inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> New Role</button>
            {roleList.map(r => <RoleCard key={r.id} role={r} />)}
          </div>
        )}

        {tab === 'history' && isAdmin && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 font-bold text-slate-700 text-sm">Accountability history</div>
            <div className="divide-y divide-slate-50 max-h-[60vh] overflow-y-auto">
              {Object.values(instances)
                .filter(i => i.status !== 'open')
                .sort((a, b) => (b.resolvedAt || b.completedAt || 0) - (a.resolvedAt || a.completedAt || 0))
                .slice(0, 200)
                .map(i => (
                  <div key={i.id} className="px-4 py-2 text-sm flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-medium text-slate-700">{i.title}</span>
                      <span className="text-[11px] text-slate-400 ml-2">{i.occurrenceDate} · {i.assignedTo?.name}</span>
                      {(i.completionNote || i.skipReason || i.voidReason) && <div className="text-[11px] text-slate-500 mt-0.5 italic">“{i.completionNote || i.skipReason || i.voidReason}”</div>}
                    </div>
                    <span className={`shrink-0 text-[10px] font-black uppercase px-1.5 py-0.5 rounded ${statusChip(i.status)}`}>{i.status.replace('_', ' ')}</span>
                  </div>
                ))}
              {Object.values(instances).filter(i => i.status !== 'open').length === 0 && <div className="px-4 py-6 text-center text-slate-400 text-sm">No completed/terminal duties yet.</div>}
            </div>
          </div>
        )}
      </div>

      {editRole && <RoleEditor role={editRole} employees={employees} onClose={() => setEditRole(null)} onSave={(r) => { onSaveRole(r); setEditRole(null); }} />}
      {editDuty && <DutyEditor duty={editDuty} onClose={() => setEditDuty(null)} onSave={(d) => { onSaveDuty(d); setEditDuty(null); }} />}
    </div>
  );
}

function RoleEditor({ role, employees, onClose, onSave }: { role: RoleMasterRole; employees: Employee[]; onClose: () => void; onSave: (r: RoleMasterRole) => void }) {
  const [r, setR] = useState<RoleMasterRole>({ ...role });
  const assignable = employees.filter(e => e.status === 'Active' && (e.linkedUserEmail || e.email));
  return (
    <Modal title={role.name ? 'Edit role' : 'New role'} onClose={onClose}>
      <Field label="Name"><input value={r.name} onChange={e => setR({ ...r, name: e.target.value })} className="inp" /></Field>
      <Field label="Description"><textarea value={r.description || ''} onChange={e => setR({ ...r, description: e.target.value })} className="inp h-16" /></Field>
      <Field label="Assigned to"><select value={r.assignedEmployeeId || ''} onChange={e => setR({ ...r, assignedEmployeeId: e.target.value || undefined })} className="inp"><option value="">(unassigned)</option>{assignable.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
      <Field label="Division"><input value={r.division || ''} onChange={e => setR({ ...r, division: e.target.value })} className="inp" placeholder="all / lawn / small / large" /></Field>
      <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={r.active} onChange={e => setR({ ...r, active: e.target.checked })} /> Active</label>
      <SaveBar onClose={onClose} disabled={!r.name.trim()} onSave={() => onSave({ ...r, updatedAt: Date.now() })} />
    </Modal>
  );
}

function DutyEditor({ duty, onClose, onSave }: { duty: RoleMasterDuty; onClose: () => void; onSave: (d: RoleMasterDuty) => void }) {
  const [d, setD] = useState<RoleMasterDuty>({ ...duty });
  const rec = d.recurrence;
  const setRec = (patch: Partial<RoleRecurrence>) => setD({ ...d, recurrence: { ...rec, ...patch } });
  return (
    <Modal title={duty.name ? 'Edit duty' : 'New duty'} onClose={onClose}>
      <Field label="Name"><input value={d.name} onChange={e => setD({ ...d, name: e.target.value })} className="inp" /></Field>
      <Field label="Category"><input value={d.category} onChange={e => setD({ ...d, category: e.target.value })} className="inp" placeholder="Payroll, Bookkeeping…" /></Field>
      <Field label="Recurrence">
        <div className="flex gap-2 flex-wrap items-center">
          <select value={rec.kind} onChange={e => setRec({ kind: e.target.value as RoleRecurrence['kind'] })} className="inp w-auto">
            <option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option>
          </select>
          {(rec.kind === 'weekly') && <select value={rec.dayOfWeek ?? 1} onChange={e => setRec({ dayOfWeek: Number(e.target.value) })} className="inp w-auto">{DOW.map((n, i) => <option key={i} value={i}>{n}</option>)}</select>}
          {rec.kind === 'biweekly' && <input type="date" value={rec.anchorDate || ''} onChange={e => setRec({ anchorDate: e.target.value })} className="inp w-auto" title="Anchor date (every 14 days from here)" />}
          {rec.kind === 'monthly' && (
            <select value={String(rec.dayOfMonth ?? 1)} onChange={e => setRec({ dayOfMonth: e.target.value === 'last' ? 'last' : Number(e.target.value) })} className="inp w-auto">
              {Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>day {i + 1}</option>)}<option value="last">last day</option>
            </select>
          )}
        </div>
      </Field>
      <Field label="Completion note prompt (required at completion)"><input value={d.notePrompt} onChange={e => setD({ ...d, notePrompt: e.target.value })} className="inp" placeholder="e.g. Pay period + exceptions" /></Field>
      <Field label="Due-soon window (days)"><input type="number" value={d.dueSoonDays} onChange={e => setD({ ...d, dueSoonDays: Number(e.target.value) || 0 })} className="inp w-24" /></Field>
      <Field label="SOP (how-to)"><textarea value={d.sop} onChange={e => setD({ ...d, sop: e.target.value })} className="inp h-28 font-mono text-xs" placeholder="Step-by-step…" /></Field>
      <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={d.active} onChange={e => setD({ ...d, active: e.target.checked })} /> Active</label>
      <SaveBar onClose={onClose} disabled={!d.name.trim() || !d.notePrompt.trim() || !d.category.trim()} onSave={() => onSave({ ...d, updatedAt: Date.now() })} />
    </Modal>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="mb-3"><label className="text-[11px] font-black uppercase tracking-widest text-slate-500 block mb-1">{label}</label>{children}</div>
);
const Modal = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => (
  <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
      <h3 className="text-lg font-bold text-slate-800 mb-4">{title}</h3>
      <style>{`.inp{width:100%;border:1px solid #cbd5e1;border-radius:.5rem;padding:.5rem;font-size:.875rem;outline:none}`}</style>
      {children}
    </div>
  </div>
);
const SaveBar = ({ onClose, onSave, disabled }: { onClose: () => void; onSave: () => void; disabled?: boolean }) => (
  <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
    <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
    <button onClick={onSave} disabled={disabled} className="px-5 py-2 text-sm font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:bg-slate-300">Save</button>
  </div>
);

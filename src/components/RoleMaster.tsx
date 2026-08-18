import { useMemo, useState } from 'react';
import { ClipboardList, Plus, Power, ChevronDown, ChevronRight, Pencil, UserCog, History, Layers, Search } from 'lucide-react';
import {
  Employee, RoleMasterRole, RoleMasterDuty, RoleMasterResponsibility, RoleMasterTemplate, RoleMasterPolicy, RoleMasterPolicyRequest, RoleTaskInstance, RoleRecurrence, RoleInstanceStatus,
} from '../types';
import { categoryColor, CATEGORY_PALETTE } from '../lib/roleCategories';
import { dutyChip, responsibilityColor } from '../lib/roleResponsibilities';
import { SEASON_PRESETS, RoleSeason, dutySeason, describeRecurrence, dutyChartStatus } from '../lib/roleMaster';
import SopText from './SopText';
import SeasonChip from './SeasonChip';
import RoleDutiesChart from './RoleDutiesChart';
import RoleLibrary from './RoleLibrary';

interface RoleMasterProps {
  roles: Record<string, RoleMasterRole>;
  duties: Record<string, RoleMasterDuty>;
  responsibilities: Record<string, RoleMasterResponsibility>;
  instances: Record<string, RoleTaskInstance>;
  employees: Employee[];
  isAdmin: boolean;
  masterEnabled: boolean;
  onSetMasterEnabled: (v: boolean) => void;
  onSaveRole: (r: RoleMasterRole) => void;
  onSaveDuty: (d: RoleMasterDuty) => void;
  onSaveResponsibility: (r: RoleMasterResponsibility) => void;
  templates: Record<string, RoleMasterTemplate>;
  policies: Record<string, RoleMasterPolicy>;
  policyRequests: Record<string, RoleMasterPolicyRequest>;
  isManager: boolean;
  currentUser: { id: string; name: string };
  uploadedBy: { email: string; name: string };
  onSaveTemplate: (t: RoleMasterTemplate) => void;
  onDeleteTemplate: (id: string) => void;
  onSavePolicy: (p: RoleMasterPolicy) => void;
  onDeletePolicy: (id: string) => void;
  onSavePolicyRequest: (id: string, policyId: string, text: string) => void;
  onResolvePolicyRequest: (id: string, note: string) => void;
  categoryColors: Record<string, string>;
  onSetCategoryColor: (category: string, colorKey: string) => void;
}

// Duty belongs-to chip (responsibility name+color, else category tag, else none).
function DutyBelongsChip({ duty, responsibilities, categoryColors }: { duty: RoleMasterDuty; responsibilities: Record<string, RoleMasterResponsibility>; categoryColors: Record<string, string> }) {
  const chip = dutyChip(duty, responsibilities, categoryColors);
  if (!chip) return null;
  return <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${chip.color.chip}`} title={chip.kind === 'responsibility' ? 'Responsibility' : 'Category'}>{chip.label}</span>;
}

// Small toggle switch (admin active/inactive control).
function Toggle({ on, onChange, title }: { on: boolean; onChange: () => void; title?: string }) {
  return (
    <button type="button" title={title} onClick={(e) => { e.stopPropagation(); onChange(); }}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const uid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const statusChip = (s: RoleInstanceStatus): string => ({
  open: 'bg-slate-100 text-slate-600', done: 'bg-emerald-100 text-emerald-700',
  done_late: 'bg-amber-100 text-amber-700', skipped: 'bg-slate-200 text-slate-500',
  missed: 'bg-rose-100 text-rose-700', voided: 'bg-slate-200 text-slate-400 line-through',
}[s] || 'bg-slate-100');

export default function RoleMaster({
  roles, duties, responsibilities, instances, employees, isAdmin, masterEnabled, onSetMasterEnabled, onSaveRole, onSaveDuty, onSaveResponsibility,
  templates, policies, policyRequests, isManager, currentUser, uploadedBy, onSaveTemplate, onDeleteTemplate, onSavePolicy, onDeletePolicy, onSavePolicyRequest, onResolvePolicyRequest,
  categoryColors, onSetCategoryColor,
}: RoleMasterProps) {
  const [tab, setTab] = useState<'directory' | 'responsibilities' | 'duties' | 'library' | 'manage' | 'history'>('directory');
  const [expandedRole, setExpandedRole] = useState<Record<string, boolean>>({});
  const [expandedDuty, setExpandedDuty] = useState<Record<string, boolean>>({});
  const [expandedResp, setExpandedResp] = useState<Record<string, boolean>>({});
  const [showInactive, setShowInactive] = useState(true);   // admin-only control
  const [editRole, setEditRole] = useState<RoleMasterRole | null>(null);
  const [editDuty, setEditDuty] = useState<RoleMasterDuty | null>(null);
  const [editResp, setEditResp] = useState<RoleMasterResponsibility | null>(null);
  const [respQuery, setRespQuery] = useState('');

  const empName = (id?: string) => employees.find(e => e.id === id)?.name || (id ? '(unknown)' : '(unassigned)');
  const roleList = useMemo(() => Object.values(roles).sort((a, b) => a.name.localeCompare(b.name)), [roles]);
  const dutiesOf = (roleId: string) => Object.values(duties).filter(d => d.roleId === roleId);
  const respList = useMemo(() => Object.values(responsibilities).sort((a, b) => a.name.localeCompare(b.name)), [responsibilities]);
  const respsOf = (roleId: string) => respList.filter(r => r.roleId === roleId);
  const dutiesOfResp = (respId: string) => Object.values(duties).filter(d => d.responsibilityId === respId);
  // Holder resolved THROUGH the owning role (ownership follows the role).
  const roleHolderName = (roleId: string) => empName(roles[roleId]?.assignedEmployeeId);
  const today = useMemo(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), []);
  const openInstancesByDuty = useMemo(() => {
    const m: Record<string, RoleTaskInstance[]> = {};
    for (const i of Object.values(instances)) if (i.status === 'open') (m[i.dutyId] = m[i.dutyId] || []).push(i);
    return m;
  }, [instances]);
  const instancesForDuty = (dutyId: string) => openInstancesByDuty[dutyId] || [];
  const dutyStatusIcon = (duty: RoleMasterDuty, open: RoleTaskInstance[]): string => {
    const s = dutyChartStatus(duty, open, today);
    return s.kind === 'overdue' ? `🔴${s.count > 1 ? ` ${s.count}` : ''}` : s.kind === 'due_soon' ? '🟡' : s.kind === 'caught_up' ? '✅' : '—';
  };

  const RoleCard = ({ role, manage }: { role: RoleMasterRole; manage?: boolean }) => {
    const open = !!expandedRole[role.id];
    // Duty visibility: everyone sees active; admins additionally see inactive
    // (dimmed) unless they hide them via the filter.
    const rd = dutiesOf(role.id).filter(d => d.active || (isAdmin && showInactive));
    const rr = respsOf(role.id).filter(r => r.active || (isAdmin && showInactive));
    // Group a role's duties by belongs-to label (responsibility name, else
    // category tag, else "Ungrouped") — the chip resolves the same way.
    const groupLabel = (d: RoleMasterDuty) => { const c = dutyChip(d, responsibilities, categoryColors); return c ? (c.kind === 'responsibility' ? `◆ ${c.label}` : c.label) : 'Ungrouped'; };
    const byGroup: Record<string, RoleMasterDuty[]> = {};
    for (const d of rd) (byGroup[groupLabel(d)] = byGroup[groupLabel(d)] || []).push(d);
    return (
      <div className={`bg-white rounded-xl border shadow-sm ${role.active ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
        <div className="p-4 flex items-center justify-between gap-3">
          <button type="button" onClick={() => setExpandedRole(s => ({ ...s, [role.id]: !s[role.id] }))} className="min-w-0 text-left flex-1">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${role.active ? 'bg-emerald-500' : 'bg-slate-300'}`} title={role.active ? 'Active' : 'Inactive'} />
              <span className="text-base font-bold text-slate-800">{role.name}</span>
              {!role.active && <span className="text-[10px] font-black uppercase bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded">Inactive</span>}
            </div>
            {role.description && <div className="text-xs text-slate-500 mt-0.5">{role.description}</div>}
            <div className="text-[11px] text-slate-600 mt-1"><UserCog className="w-3 h-3 inline mr-1" />Held by <b>{empName(role.assignedEmployeeId)}</b> · {dutiesOf(role.id).length} duties{respsOf(role.id).length > 0 ? ` · ${respsOf(role.id).length} responsibilities` : ''}</div>
          </button>
          <div className="flex items-center gap-2 shrink-0">
            {isAdmin && manage && <Toggle on={role.active} onChange={() => onSaveRole({ ...role, active: !role.active, updatedAt: Date.now() })} title="Active" />}
            <button type="button" onClick={() => setExpandedRole(s => ({ ...s, [role.id]: !s[role.id] }))}>{open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}</button>
          </div>
        </div>
        {open && (
          <div className="border-t border-slate-100 p-4 space-y-3">
            {isAdmin && (
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => setEditRole(role)} className="text-[11px] font-bold text-slate-600 border border-slate-300 rounded px-2 py-1 inline-flex items-center gap-1"><Pencil className="w-3 h-3" /> Edit role</button>
                <button onClick={() => setEditDuty({ id: uid('duty'), name: '', category: 'General', sop: '', notePrompt: '', recurrence: { kind: 'weekly', dayOfWeek: 1 }, dueSoonDays: 2, roleId: role.id, division: role.division, tier: 'admin', active: true })} className="text-[11px] font-bold text-white bg-slate-700 rounded px-2 py-1 inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Add duty</button>
                <button onClick={() => setEditResp({ id: uid('resp'), name: '', description: '', sop: '', roleId: role.id, division: role.division, tier: 'admin', active: true })} className="text-[11px] font-bold text-white bg-indigo-600 rounded px-2 py-1 inline-flex items-center gap-1"><Layers className="w-3 h-3" /> Add responsibility</button>
              </div>
            )}

            {/* Responsibilities this role owns (v1.7) — standing ownership. */}
            {rr.length > 0 && (
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 flex items-center gap-1"><Layers className="w-3 h-3" /> Responsibilities</div>
                <div className="space-y-1">
                  {rr.map(r => {
                    const rc = responsibilityColor(r);
                    const dc = dutiesOfResp(r.id).length;
                    return (
                      <div key={r.id} className={`text-sm border border-slate-100 rounded px-2 py-1.5 ${r.active ? '' : 'opacity-55 bg-slate-50'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${rc.chip}`}>{r.name}</span>
                            {!r.active && <span className="ml-2 text-[9px] font-black uppercase bg-slate-200 text-slate-500 px-1 rounded">Inactive</span>}
                            {r.description && <div className="text-[11px] text-slate-500 mt-0.5">{r.description}</div>}
                            <div className="text-[10px] text-slate-400">{dc} {dc === 1 ? 'duty' : 'duties'}</div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {r.sop && <button onClick={() => setExpandedResp(s => ({ ...s, [r.id]: !s[r.id] }))} className="text-[10px] font-bold text-indigo-600 border border-indigo-200 rounded px-1.5 py-0.5">SOP</button>}
                            {isAdmin && <button onClick={() => setEditResp(r)} className="text-slate-400 hover:text-slate-700"><Pencil className="w-3.5 h-3.5" /></button>}
                          </div>
                        </div>
                        {r.sop && expandedResp[r.id] && <SopText text={r.sop} className="mt-2 text-[12px] text-slate-700 bg-slate-50 border border-slate-100 rounded p-2" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {Object.keys(byGroup).sort().map(group => (
              <div key={group}>
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{group}</span>
                </div>
                <div className="space-y-1">
                  {byGroup[group].map(d => (
                    <div key={d.id} className={`text-sm border border-slate-100 rounded px-2 py-1.5 ${d.active ? '' : 'opacity-55 bg-slate-50'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-medium text-slate-700">{d.name}</span>
                          <span className="ml-1.5 align-middle"><DutyBelongsChip duty={d} responsibilities={responsibilities} categoryColors={categoryColors} /></span>
                          {!d.active && <span className="ml-2 text-[9px] font-black uppercase bg-slate-200 text-slate-500 px-1 rounded">Inactive</span>}
                          {dutySeason(d) && <span className="ml-1.5 align-middle"><SeasonChip season={dutySeason(d) as RoleSeason} /></span>}
                          <div className="text-[11px] text-slate-400">{describeRecurrence(d)} · asks: “{d.notePrompt}”</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {d.sop && <button onClick={() => setExpandedDuty(s => ({ ...s, [d.id]: !s[d.id] }))} className="text-[10px] font-bold text-indigo-600 border border-indigo-200 rounded px-1.5 py-0.5">SOP</button>}
                          {isAdmin && manage && <Toggle on={d.active} onChange={() => onSaveDuty({ ...d, active: !d.active, updatedAt: Date.now() })} title="Active" />}
                          {isAdmin && <button onClick={() => setEditDuty(d)} className="text-slate-400 hover:text-slate-700"><Pencil className="w-3.5 h-3.5" /></button>}
                        </div>
                      </div>
                      {d.sop && expandedDuty[d.id] && (
                        <SopText text={d.sop} className="mt-2 text-[12px] text-slate-700 bg-slate-50 border border-slate-100 rounded p-2" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {rd.length === 0 && rr.length === 0 && <div className="text-xs text-slate-400 italic">No responsibilities or duties yet.</div>}
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
          <div className="flex flex-wrap bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
            <button onClick={() => setTab('directory')} className={`px-3 py-1.5 text-sm font-bold rounded-md ${tab === 'directory' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500'}`}>Directory</button>
            <button onClick={() => setTab('responsibilities')} className={`px-3 py-1.5 text-sm font-bold rounded-md ${tab === 'responsibilities' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500'}`}>Responsibilities</button>
            <button onClick={() => setTab('duties')} className={`px-3 py-1.5 text-sm font-bold rounded-md ${tab === 'duties' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500'}`}>Duties</button>
            <button onClick={() => setTab('library')} className={`px-3 py-1.5 text-sm font-bold rounded-md ${tab === 'library' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500'}`}>Library</button>
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
            {isAdmin && (
              <label className="flex items-center gap-2 text-[11px] font-bold text-slate-500"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive</label>
            )}
            {(() => {
              const visible = roleList.filter(r => r.active || (isAdmin && showInactive));
              return visible.length === 0 ? <div className="text-center text-slate-400 py-8">No roles to show.</div> : visible.map(r => <RoleCard key={r.id} role={r} manage={false} />);
            })()}
          </div>
        )}

        {tab === 'responsibilities' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                <input value={respQuery} onChange={e => setRespQuery(e.target.value)} placeholder="Search responsibilities, roles, holders…" className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm outline-none" />
              </div>
              {isAdmin && (
                <button onClick={() => { const first = roleList[0]; setEditResp({ id: uid('resp'), name: '', description: '', sop: '', roleId: first?.id || '', division: first?.division, tier: 'admin', active: true }); }} className="inline-flex items-center gap-1.5 text-sm font-black uppercase tracking-widest text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-2 rounded-lg shadow-sm"><Plus className="w-4 h-4" /> Add responsibility</button>
              )}
            </div>
            {(() => {
              const q = respQuery.trim().toLowerCase();
              const visible = respList
                .filter(r => r.active || (isAdmin && showInactive))
                .filter(r => {
                  if (!q) return true;
                  const role = roles[r.roleId];
                  return [r.name, r.description, r.division, role?.name, roleHolderName(r.roleId)].some(s => (s || '').toLowerCase().includes(q));
                });
              if (visible.length === 0) return <div className="text-center text-slate-400 py-8">{respList.length === 0 ? 'No responsibilities defined yet.' : 'No responsibilities match.'}</div>;
              return visible.map(r => {
                const rc = responsibilityColor(r);
                const role = roles[r.roleId];
                const rduties = dutiesOfResp(r.id).filter(d => d.active || (isAdmin && showInactive));
                const open = !!expandedResp[r.id];
                return (
                  <div key={r.id} className={`bg-white rounded-xl border shadow-sm ${r.active ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
                    <div className="p-4 flex items-start justify-between gap-3">
                      <button type="button" onClick={() => setExpandedResp(s => ({ ...s, [r.id]: !s[r.id] }))} className="min-w-0 text-left flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Layers className="w-4 h-4 text-slate-400" />
                          <span className={`text-[11px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${rc.chip}`}>{r.name}</span>
                          {!r.active && <span className="text-[10px] font-black uppercase bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded">Inactive</span>}
                        </div>
                        {r.description && <div className="text-xs text-slate-500 mt-1">{r.description}</div>}
                        <div className="text-[11px] text-slate-600 mt-1">
                          <UserCog className="w-3 h-3 inline mr-1" />Owned by <b>{role?.name || '(no role)'}</b> · held by <b>{roleHolderName(r.roleId)}</b>
                          {r.division ? ` · ${r.division}` : ''} · {rduties.length} {rduties.length === 1 ? 'duty' : 'duties'}
                        </div>
                      </button>
                      <div className="flex items-center gap-2 shrink-0">
                        {isAdmin && <button onClick={() => setEditResp(r)} className="text-slate-400 hover:text-slate-700"><Pencil className="w-4 h-4" /></button>}
                        <button type="button" onClick={() => setExpandedResp(s => ({ ...s, [r.id]: !s[r.id] }))}>{open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}</button>
                      </div>
                    </div>
                    {open && (
                      <div className="border-t border-slate-100 p-4 space-y-3">
                        {r.sop && <SopText text={r.sop} className="text-[12px] text-slate-700 bg-slate-50 border border-slate-100 rounded p-2" />}
                        {rduties.length === 0 ? (
                          <div className="text-xs text-slate-400 italic">As-needed ownership — no scheduled duties. Ownership + how-to above is the whole picture.</div>
                        ) : (
                          <div className="space-y-1">
                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Linked duties</div>
                            {rduties.map(d => {
                              const open = instancesForDuty(d.id);
                              const st = dutyStatusIcon(d, open);
                              const dutyHolder = roleHolderName(d.roleId);
                              const differs = d.roleId !== r.roleId;
                              return (
                                <div key={d.id} className={`text-sm border border-slate-100 rounded px-2 py-1.5 flex items-center justify-between gap-2 ${d.active ? '' : 'opacity-55 bg-slate-50'}`}>
                                  <div className="min-w-0">
                                    <span className="mr-1.5">{st}</span>
                                    <span className="font-medium text-slate-700">{d.name}</span>
                                    {dutySeason(d) && <span className="ml-1.5 align-middle"><SeasonChip season={dutySeason(d) as RoleSeason} /></span>}
                                    <div className="text-[11px] text-slate-400">{describeRecurrence(d)} · held by <b className={differs ? 'text-amber-700' : ''}>{dutyHolder}</b>{differs ? ' (differs from owner)' : ''}</div>
                                  </div>
                                  {isAdmin && <button onClick={() => setEditDuty(d)} className="text-slate-400 hover:text-slate-700 shrink-0"><Pencil className="w-3.5 h-3.5" /></button>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        )}

        {tab === 'duties' && (
          <RoleDutiesChart
            roles={roles} duties={duties} responsibilities={responsibilities} instances={instances} employees={employees}
            categoryColors={categoryColors} isAdmin={isAdmin}
            onEditDuty={(d) => setEditDuty(d)}
            onAddDuty={() => {
              const first = roleList[0];
              setEditDuty({ id: uid('duty'), name: '', category: 'General', sop: '', notePrompt: '', recurrence: { kind: 'weekly', dayOfWeek: 1 }, dueSoonDays: 2, roleId: first?.id || '', division: first?.division, tier: 'admin', active: true });
            }}
            onMoveDuty={(dutyId, newRoleId) => { const d = duties[dutyId]; if (d) onSaveDuty({ ...d, roleId: newRoleId, updatedAt: Date.now() }); }}
          />
        )}

        {tab === 'library' && (
          <RoleLibrary
            templates={templates} policies={policies} policyRequests={policyRequests}
            isAdmin={isAdmin} isManager={isManager} currentUser={currentUser} uploadedBy={uploadedBy}
            categoryColors={categoryColors}
            onSaveTemplate={onSaveTemplate} onDeleteTemplate={onDeleteTemplate}
            onSavePolicy={onSavePolicy} onDeletePolicy={onDeletePolicy}
            onSavePolicyRequest={onSavePolicyRequest} onResolvePolicyRequest={onResolvePolicyRequest}
          />
        )}

        {tab === 'manage' && isAdmin && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => setEditRole({ id: uid('role'), name: '', description: '', tier: 'admin', active: true })} className="text-sm font-bold text-white bg-lime-600 hover:bg-lime-700 px-3 py-2 rounded-md inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> New Role</button>
              <label className="flex items-center gap-2 text-[11px] font-bold text-slate-500"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive</label>
            </div>
            {roleList.filter(r => r.active || showInactive).map(r => <RoleCard key={r.id} role={r} manage={true} />)}
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
                      {i.category && <span className={`ml-2 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${categoryColor(i.category, categoryColors).chip}`}>{i.category}</span>}
                      <span className="text-[11px] text-slate-400 ml-2">{i.occurrenceDate} · {i.assignedTo?.name}</span>
                      {(i.completionNote || i.skipReason || i.voidReason) && <div className="text-[11px] text-slate-500 mt-0.5 italic">“{i.completionNote || i.skipReason || i.voidReason}”</div>}
                      {i.sopSnapshot && (
                        <details className="mt-1">
                          <summary className="text-[10px] font-bold uppercase tracking-widest text-slate-400 cursor-pointer">SOP as followed</summary>
                          <SopText text={i.sopSnapshot} className="mt-1 text-[11px] text-slate-600 bg-slate-50 border border-slate-100 rounded p-2" />
                        </details>
                      )}
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
      {editDuty && <DutyEditor duty={editDuty} roles={roleList} responsibilities={respList} categoryColors={categoryColors} onSetCategoryColor={onSetCategoryColor} onClose={() => setEditDuty(null)} onSave={(d) => { onSaveDuty(d); setEditDuty(null); }} />}
      {editResp && <ResponsibilityEditor resp={editResp} roles={roleList} onClose={() => setEditResp(null)} onSave={(r) => { onSaveResponsibility(r); setEditResp(null); }} />}
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

function DutyEditor({ duty, roles, responsibilities, categoryColors, onSetCategoryColor, onClose, onSave }: { duty: RoleMasterDuty; roles: RoleMasterRole[]; responsibilities: RoleMasterResponsibility[]; categoryColors: Record<string, string>; onSetCategoryColor: (c: string, k: string) => void; onClose: () => void; onSave: (d: RoleMasterDuty) => void }) {
  const [d, setD] = useState<RoleMasterDuty>({ ...duty });
  const rec = d.recurrence;
  const setRec = (patch: Partial<RoleRecurrence>) => setD({ ...d, recurrence: { ...rec, ...patch } });
  const cat = (d.category || '').trim();
  // Highlight ONLY the explicitly-mapped color for this category. Do NOT fall
  // back to categoryColor()'s name-hash — that made the "selected" swatch cycle
  // on every keystroke while typing the category (a derived-state leak, not a
  // real selection change). Unmapped category → nothing ringed until a click.
  const activeKey = cat ? (categoryColors[cat] || '') : '';
  const roleOptions = roles.filter(r => r.active || r.id === d.roleId);

  // ── BELONGS TO — one field: a responsibility XOR a plain category tag XOR
  // none. Responsibility wins (its category is cleared on save).
  const deriveBelongs = (x: RoleMasterDuty): 'responsibility' | 'category' | 'none' =>
    x.responsibilityId ? 'responsibility' : (x.category || '').trim() ? 'category' : 'none';
  const [belongs, setBelongs] = useState<'responsibility' | 'category' | 'none'>(deriveBelongs(duty));
  const respOptions = responsibilities.filter(r => r.active || r.id === d.responsibilityId);
  const buildBelongs = (): Pick<RoleMasterDuty, 'responsibilityId' | 'category'> => {
    if (belongs === 'responsibility' && d.responsibilityId) return { responsibilityId: d.responsibilityId, category: '' };
    if (belongs === 'category') return { responsibilityId: undefined, category: (d.category || '').trim() };
    return { responsibilityId: undefined, category: '' };
  };
  const belongsBtn = (active: boolean) => `text-xs font-bold px-3 py-1.5 rounded-lg border ${active ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`;

  // ── DURATION — one field, three modes. Derived from the duty, edited
  // locally, and folded back into the storage fields on save (season →
  // season+seasonWindow; custom+repeat → seasonWindow; custom one-shot →
  // activeFrom/Until; indefinite → all cleared). One mechanic, no parallel
  // paths; the generators only ever read seasonWindow / activeFrom / activeUntil.
  const mmddToDate = (md: string) => md ? `${new Date().getFullYear()}-${md}` : '';
  const deriveMode = (x: RoleMasterDuty): 'indefinite' | 'season' | 'custom' =>
    x.season ? 'season' : (x.seasonWindow || x.activeFrom || x.activeUntil) ? 'custom' : 'indefinite';
  const [durMode, setDurMode] = useState<'indefinite' | 'season' | 'custom'>(deriveMode(duty));
  const [season, setSeason] = useState<RoleSeason | undefined>(duty.season);
  const [repeatAnnually, setRepeatAnnually] = useState<boolean>(!!duty.seasonWindow && !duty.season);
  const [customFrom, setCustomFrom] = useState<string>(duty.activeFrom || (duty.seasonWindow?.fromMonthDay ? mmddToDate(duty.seasonWindow.fromMonthDay) : ''));
  const [customTo, setCustomTo] = useState<string>(duty.activeUntil || (duty.seasonWindow?.toMonthDay ? mmddToDate(duty.seasonWindow.toMonthDay) : ''));

  const buildDuration = (): Pick<RoleMasterDuty, 'season' | 'seasonWindow' | 'activeFrom' | 'activeUntil'> => {
    if (durMode === 'season' && season) {
      const p = SEASON_PRESETS[season];
      return { season, seasonWindow: { fromMonthDay: p.fromMonthDay, toMonthDay: p.toMonthDay }, activeFrom: undefined, activeUntil: undefined };
    }
    if (durMode === 'custom') {
      if (repeatAnnually) {
        return { season: undefined, seasonWindow: (customFrom && customTo) ? { fromMonthDay: customFrom.slice(5), toMonthDay: customTo.slice(5) } : undefined, activeFrom: undefined, activeUntil: undefined };
      }
      return { season: undefined, seasonWindow: undefined, activeFrom: customFrom || undefined, activeUntil: customTo || undefined };
    }
    return { season: undefined, seasonWindow: undefined, activeFrom: undefined, activeUntil: undefined };
  };
  const modeBtn = (active: boolean) => `text-xs font-bold px-3 py-1.5 rounded-lg border ${active ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`;

  return (
    <Modal title={duty.name ? 'Edit duty' : 'New duty'} onClose={onClose}>
      <Field label="Name"><input value={d.name} onChange={e => setD({ ...d, name: e.target.value })} className="inp" /></Field>
      <Field label="Role (who holds this duty)">
        <select value={d.roleId} onChange={e => { const r = roles.find(x => x.id === e.target.value); setD({ ...d, roleId: e.target.value, division: r?.division ?? d.division }); }} className="inp">
          <option value="">(select a role)</option>
          {roleOptions.map(r => <option key={r.id} value={r.id}>{r.name}{r.active ? '' : ' (inactive)'}</option>)}
        </select>
      </Field>
      <Field label="Belongs to (grouping + color chip)">
        <div className="flex gap-1.5 flex-wrap mb-2">
          <button type="button" onClick={() => setBelongs('responsibility')} className={belongsBtn(belongs === 'responsibility')}>Responsibility</button>
          <button type="button" onClick={() => setBelongs('category')} className={belongsBtn(belongs === 'category')}>Category tag</button>
          <button type="button" onClick={() => setBelongs('none')} className={belongsBtn(belongs === 'none')}>None</button>
        </div>
        {belongs === 'responsibility' && (
          respOptions.length === 0 ? (
            <div className="text-[11px] text-slate-400 italic">No responsibilities yet — create one first, or use a category tag.</div>
          ) : (
            <select value={d.responsibilityId || ''} onChange={e => setD({ ...d, responsibilityId: e.target.value || undefined })} className="inp">
              <option value="">(pick a responsibility)</option>
              {respOptions.map(r => <option key={r.id} value={r.id}>{r.name}{r.active ? '' : ' (inactive)'}</option>)}
            </select>
          )
        )}
        {belongs === 'category' && (<>
          <input value={d.category} onChange={e => setD({ ...d, category: e.target.value })} className="inp" placeholder="Payroll, Bookkeeping…" />
          {cat && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Color</span>
              {CATEGORY_PALETTE.map(c => (
                <button key={c.key} type="button" title={c.label} onClick={() => onSetCategoryColor(cat, c.key)}
                  className={`w-5 h-5 rounded-full ${c.dot} ${activeKey === c.key ? 'ring-2 ring-offset-1 ring-slate-800' : ''}`} />
              ))}
            </div>
          )}
        </>)}
        {belongs === 'none' && <div className="text-[11px] text-slate-400 italic">No grouping — the duty shows no chip.</div>}
      </Field>

      {/* RECURRENCE — how often it fires. */}
      <Field label="Recurrence (how often)">
        <div className="flex gap-2 flex-wrap items-center">
          <select value={rec.kind} onChange={e => setRec({ kind: e.target.value as RoleRecurrence['kind'] })} className="inp w-auto">
            <option value="weekdays">Every weekday</option><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
          </select>
          {(rec.kind === 'weekly') && <select value={rec.dayOfWeek ?? 1} onChange={e => setRec({ dayOfWeek: Number(e.target.value) })} className="inp w-auto">{DOW.map((n, i) => <option key={i} value={i}>{n}</option>)}</select>}
          {rec.kind === 'biweekly' && <input type="date" value={rec.anchorDate || ''} onChange={e => setRec({ anchorDate: e.target.value })} className="inp w-auto" title="Anchor date (every 14 days from here)" />}
          {rec.kind === 'monthly' && (
            <select value={String(rec.dayOfMonth ?? 1)} onChange={e => setRec({ dayOfMonth: e.target.value === 'last' ? 'last' : Number(e.target.value) })} className="inp w-auto">
              {Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>day {i + 1}</option>)}<option value="last">last day</option>
            </select>
          )}
          {rec.kind === 'yearly' && (<>
            <select value={rec.month ?? 1} onChange={e => setRec({ month: Number(e.target.value) })} className="inp w-auto">{MONTHS.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}</select>
            <select value={rec.day ?? 1} onChange={e => setRec({ day: Number(e.target.value) })} className="inp w-auto">{Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select>
          </>)}
        </div>
      </Field>

      {/* DURATION — the window it fires within (separate from recurrence). */}
      <Field label="Duration (when it runs)">
        <div className="flex gap-1.5 flex-wrap mb-2">
          <button type="button" onClick={() => setDurMode('indefinite')} className={modeBtn(durMode === 'indefinite')}>Indefinite</button>
          <button type="button" onClick={() => { setDurMode('season'); if (!season) setSeason('summer'); }} className={modeBtn(durMode === 'season')}>Season</button>
          <button type="button" onClick={() => setDurMode('custom')} className={modeBtn(durMode === 'custom')}>Custom window</button>
        </div>
        {durMode === 'indefinite' && <div className="text-[11px] text-slate-400">Runs forever — no start or end.</div>}
        {durMode === 'season' && (
          <div className="space-y-1.5">
            <div className="flex gap-2 flex-wrap">
              {(['summer', 'winter'] as RoleSeason[]).map(s => {
                const p = SEASON_PRESETS[s];
                return (
                  <button key={s} type="button" onClick={() => setSeason(s)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold ${season === s ? p.chip + ' ring-2 ring-offset-1 ring-slate-400' : 'bg-white text-slate-600 border-slate-200'}`}>
                    {p.emoji} {p.label} <span className="text-[10px] opacity-70">{p.fromMonthDay}→{p.toMonthDay}</span>
                  </button>
                );
              })}
            </div>
            <div className="text-[11px] text-slate-400">Auto-fills the dates and repeats every year; dormant outside the band, resumes automatically the following year — no manual toggling.</div>
          </div>
        )}
        {durMode === 'custom' && (
          <div className="space-y-2">
            <div className="flex gap-2 items-center">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="inp w-auto" />
              <span className="text-slate-400 text-xs">to</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="inp w-auto" />
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={repeatAnnually} onChange={e => setRepeatAnnually(e.target.checked)} /> Repeat every year</label>
            <div className="text-[11px] text-slate-400">{repeatAnnually ? 'Runs the same month/day band every year (the dates’ year is ignored).' : 'Runs once within this window, then ends.'}</div>
          </div>
        )}
      </Field>

      <Field label="Completion note prompt (required at completion)"><input value={d.notePrompt} onChange={e => setD({ ...d, notePrompt: e.target.value })} className="inp" placeholder="e.g. Pay period + exceptions" /></Field>
      <Field label="Due-soon window (days)"><input type="number" value={d.dueSoonDays} onChange={e => setD({ ...d, dueSoonDays: Number(e.target.value) || 0 })} className="inp w-24" /></Field>
      <Field label="SOP (how-to) — supports [label](https://…) and bare links"><textarea value={d.sop} onChange={e => setD({ ...d, sop: e.target.value })} className="inp h-28 font-mono text-xs" placeholder="Step-by-step… Full guide: [Payroll walkthrough](https://scribehow.com/…)" /></Field>
      {d.sop.trim() && (
        <div className="mb-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Preview</div>
          <SopText text={d.sop} className="text-[12px] text-slate-700 bg-slate-50 border border-slate-100 rounded p-2" />
        </div>
      )}
      <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={d.active} onChange={e => setD({ ...d, active: e.target.checked })} /> Active</label>
      <SaveBar onClose={onClose} disabled={!d.name.trim() || !d.notePrompt.trim() || !d.roleId || (belongs === 'responsibility' && !d.responsibilityId) || (belongs === 'category' && !(d.category || '').trim())} onSave={() => onSave({ ...d, ...buildDuration(), ...buildBelongs(), updatedAt: Date.now() })} />
    </Modal>
  );
}

function ResponsibilityEditor({ resp, roles, onClose, onSave }: { resp: RoleMasterResponsibility; roles: RoleMasterRole[]; onClose: () => void; onSave: (r: RoleMasterResponsibility) => void }) {
  const [r, setR] = useState<RoleMasterResponsibility>({ ...resp });
  const roleOptions = roles.filter(x => x.active || x.id === r.roleId);
  // Highlight ONLY an explicitly-chosen color. Do NOT fall back to the
  // name-hash (responsibilityColor) — that made the "selected" swatch cycle
  // per keystroke while typing the name. Nothing ringed until a swatch click.
  const activeColor = r.color || '';
  return (
    <Modal title={resp.name ? 'Edit responsibility' : 'New responsibility'} onClose={onClose}>
      <Field label="Name"><input value={r.name} onChange={e => setR({ ...r, name: e.target.value })} className="inp" placeholder="Website & Domain, Company Insurance…" /></Field>
      <Field label="Owning role (ownership follows the role, not a person)">
        <select value={r.roleId} onChange={e => { const role = roles.find(x => x.id === e.target.value); setR({ ...r, roleId: e.target.value, division: role?.division ?? r.division }); }} className="inp">
          <option value="">(select a role)</option>
          {roleOptions.map(x => <option key={x.id} value={x.id}>{x.name}{x.active ? '' : ' (inactive)'}</option>)}
        </select>
      </Field>
      <Field label="Description"><textarea value={r.description || ''} onChange={e => setR({ ...r, description: e.target.value })} className="inp h-16" placeholder="What this area of ownership covers." /></Field>
      <Field label="Color">
        <div className="flex items-center gap-1.5 flex-wrap">
          {CATEGORY_PALETTE.map(c => (
            <button key={c.key} type="button" title={c.label} onClick={() => setR({ ...r, color: c.key })}
              className={`w-6 h-6 rounded-full ${c.dot} ${activeColor === c.key ? 'ring-2 ring-offset-1 ring-slate-800' : ''}`} />
          ))}
        </div>
      </Field>
      <Field label="SOP (how-to) — supports [label](https://…) and bare links"><textarea value={r.sop} onChange={e => setR({ ...r, sop: e.target.value })} className="inp h-28 font-mono text-xs" placeholder="Access + how-to… e.g. Registrar: [GoDaddy account](https://…) — login in 1Password." /></Field>
      {r.sop.trim() && (
        <div className="mb-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Preview</div>
          <SopText text={r.sop} className="text-[12px] text-slate-700 bg-slate-50 border border-slate-100 rounded p-2" />
        </div>
      )}
      <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={r.active} onChange={e => setR({ ...r, active: e.target.checked })} /> Active</label>
      <SaveBar onClose={onClose} disabled={!r.name.trim() || !r.roleId} onSave={() => onSave({ ...r, updatedAt: Date.now() })} />
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

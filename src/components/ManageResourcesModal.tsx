import React, { useEffect, useState, useMemo, useRef } from 'react';
import type { ComponentType, Dispatch, SetStateAction } from 'react';
import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { functions, db, appId } from '../lib/firebase';
import {
  Settings, X, Users, Truck, Package, Hammer, Map as MapIcon, ShieldCheck,
  Plus, Trash2, Calendar as CalendarIcon, CreditCard as IdCard,
  AlertTriangle, CheckSquare, UserCircle, Clock, Sliders, Link2, Mail
} from 'lucide-react';
import { Employee, FleetItem, InventoryItem, Job, AppSettings, RolePermissionsOverride, UserRole, JobberUser, PRIMARY_CREWS, EquipmentSubtypeDefinition, PartialTimeOff } from '../types';
import { makeSubtypeId } from '../lib/fleetUtils';
import { DIVISIONS, CREW_NUMBERS, ROUTE_FREQUENCIES, DAYS_OF_WEEK, DEFAULT_EOD_REMINDER, DEFAULT_CREW_SIZE_ALLOWANCE } from '../constants';
import { resolveWeightBand, weightBandLabel, hasLegacyWeightClassOnly, needsPlateRenewal, needsCommercialSafety } from '../lib/fleetUtils';
import { ROLE_PERMISSIONS, Permission, can } from '../lib/permissions';
import { formatDate, needsAudit } from '../lib/dateUtils';

// Inline-edit shape for pre-scheduled partial time-off (date carried on the row
// rather than as a map key). Persisted form lives in AppData.partialTimeOff.
type PartialTimeOffDraft = PartialTimeOff & { date: string };

interface JobberAuthState {
  accountName?: string;
  connectedAt?: number;
  connectedBy?: string;
}

interface ManageResourcesModalProps {
  isOpen: boolean;
  onClose: () => void;
  manageTab: string;
  setManageTab: Dispatch<SetStateAction<string>>;
  fleetFilter: string;
  setFleetFilter: Dispatch<SetStateAction<string>>;
  localEmployees: Employee[];
  setLocalEmployees: Dispatch<SetStateAction<Employee[]>>;
  localFleet: FleetItem[];
  setLocalFleet: Dispatch<SetStateAction<FleetItem[]>>;
  // Snapshot of appData.fleet at modal-open time. Used to detect
  // whether a unit's currentEngineHours has already been persisted —
  // if so, the Current Hrs input in the setup form locks (ongoing
  // hour updates happen via the Fleet List inline edit, not here).
  persistedFleet: FleetItem[];
  // Pay-chunk ledger — read-only here. Drives the "Set up first
  // chunk" rollout form's visibility: shown only when a mechanic
  // has hoursPer1000 set and no open chunk for them yet.
  mechanicPayChunks: Record<string, import('../types').MechanicPayChunk>;
  // Called when the manager submits the rollout form. App.tsx
  // creates a backfilled open chunk for this mechanic with the
  // provided startTimestamp + manualHoursOffset, and writes via
  // syncToCloud.
  onCreateInitialChunk: (
    emp: Employee,
    hoursAlreadyWorked: number,
    startTimestamp: number,
  ) => void;
  localInventory: InventoryItem[];
  setLocalInventory: Dispatch<SetStateAction<InventoryItem[]>>;
  localSupplies: string[];
  setLocalSupplies: Dispatch<SetStateAction<string[]>>;
  localRoutes: Job[];
  setLocalRoutes: Dispatch<SetStateAction<Job[]>>;
  localPermissions: RolePermissionsOverride;
  setLocalPermissions: Dispatch<SetStateAction<RolePermissionsOverride>>;
  localSettings: AppSettings;
  setLocalSettings: Dispatch<SetStateAction<AppSettings>>;
  localAdmins: string[];
  setLocalAdmins: Dispatch<SetStateAction<string[]>>;
  localEquipmentSubtypes: EquipmentSubtypeDefinition[];
  setLocalEquipmentSubtypes: Dispatch<SetStateAction<EquipmentSubtypeDefinition[]>>;
  localPartialTimeOff: PartialTimeOffDraft[];
  setLocalPartialTimeOff: Dispatch<SetStateAction<PartialTimeOffDraft[]>>;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  currentUserRole: UserRole;
  jobberUsersList: JobberUser[];
  showToastMsg: (msg: string) => void;
  onSave: () => void | Promise<void>;
  ClassAIcon: ComponentType<{ className?: string; title?: string }>;
  SkidSteerIcon: ComponentType<{ className?: string; title?: string }>;
}

export default function ManageResourcesModal({
  isOpen,
  onClose,
  manageTab,
  setManageTab,
  fleetFilter,
  setFleetFilter,
  localEmployees,
  setLocalEmployees,
  localFleet,
  setLocalFleet,
  persistedFleet,
  mechanicPayChunks,
  onCreateInitialChunk,
  localInventory,
  setLocalInventory,
  localSupplies,
  setLocalSupplies,
  localRoutes,
  setLocalRoutes,
  localPermissions,
  setLocalPermissions,
  localSettings,
  setLocalSettings,
  localAdmins,
  setLocalAdmins,
  localEquipmentSubtypes,
  setLocalEquipmentSubtypes,
  localPartialTimeOff,
  setLocalPartialTimeOff,
  isAdmin,
  isSuperAdmin,
  currentUserRole,
  jobberUsersList,
  showToastMsg,
  onSave,
  ClassAIcon,
  SkidSteerIcon,
}: ManageResourcesModalProps) {
  const canManageJobber =
    isSuperAdmin || (isAdmin && can('canManageJobberIntegration', currentUserRole));
  const [jobberAuth, setJobberAuth] = useState<JobberAuthState | null>(null);
  const [jobberBusy, setJobberBusy] = useState(false);
  // Per-employee draft state for the "Set up first chunk" rollout
  // form. Keyed by employee id so multiple mechanics' drafts don't
  // collide. Empty entries default to "0 hrs already worked" /
  // today's date inside the form's handler.
  const [chunkSetupDrafts, setChunkSetupDrafts] = useState<Record<string, { hours: string; startDate: string }>>({});
  // Locked-with-edit state for each maintenance item's Next Due
  // input. Keyed by item id. Falsy/missing => locked (read-only
  // display). Clicking Edit on a row flips it to true, exposing
  // a number input. Reset when the modal opens.
  const [nextDueUnlocked, setNextDueUnlocked] = useState<Record<string, boolean>>({});

  // Tracks the linkedUserEmail at focus-start per employee, so onBlur can
  // detect whether the field was newly populated vs changed from a prior value.
  const linkedFocusRef = useRef<Map<string, string>>(new Map());

  const sortedJobberUsers = useMemo(() => {
    const isCrewLike = (name: string) => /#/.test(name) || /^(plow|pre|sub)/i.test(name);
    // Hide archived users. Missing/undefined isArchived (older synced
    // records) is treated as active so we don't accidentally empty the
    // dropdown before the next sync populates the field.
    const visible = jobberUsersList.filter(u => u.isArchived !== true);
    return [...visible].sort((a, b) => {
      const aCrew = isCrewLike(a.name), bCrew = isCrewLike(b.name);
      if (aCrew !== bCrew) return aCrew ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [jobberUsersList]);

  const jobberUsersById = useMemo(() => {
    const map = new Map<string, JobberUser>();
    for (const u of jobberUsersList) map.set(u.id, u);
    return map;
  }, [jobberUsersList]);

  const jobberDuplicates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of localEmployees) {
      if (e.jobberUserId) counts.set(e.jobberUserId, (counts.get(e.jobberUserId) || 0) + 1);
    }
    return counts;
  }, [localEmployees]);

  useEffect(() => {
    if (!isOpen || !canManageJobber) return;
    const ref = doc(db, 'artifacts', appId, 'private', 'data', 'jobberAuth', 'main');
    const unsub = onSnapshot(
      ref,
      snap => setJobberAuth(snap.exists() ? (snap.data() as JobberAuthState) : null),
      () => setJobberAuth(null),
    );
    return unsub;
  }, [isOpen, canManageJobber]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex md:items-center md:justify-center md:p-4 print:hidden">
      <div className="bg-white md:rounded-xl shadow-2xl h-full md:h-auto w-full md:max-w-5xl flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }}>
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 shrink-0"><h2 className="text-xl font-black flex items-center gap-2 text-slate-800"><Settings className="w-5 h-5 text-lime-500" /> Manage Resources</h2><button onClick={onClose} className="text-gray-500 hover:text-gray-800 min-w-[44px] min-h-[44px] inline-flex items-center justify-center"><X className="w-6 h-6" /></button></div>
        <div className="flex border-b border-gray-200 overflow-x-auto bg-white shrink-0">
          <button onClick={() => setManageTab('employees')} className={`px-6 py-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${manageTab === 'employees' ? 'text-green-600 border-green-600 bg-green-50/50' : 'text-gray-500 border-transparent hover:bg-gray-50'}`}><Users className="w-4 h-4" /> Personnel</button>
           <button onClick={() => setManageTab('fleet')} className={`px-6 py-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${manageTab === 'fleet' ? 'text-green-600 border-green-600 bg-green-50/50' : 'text-gray-500 border-transparent hover:bg-gray-50'}`}><Truck className="w-4 h-4" /> Fleet & Equip</button>
          {isAdmin && (
            <button onClick={() => setManageTab('equipmentSubtypes')} className={`px-6 py-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${manageTab === 'equipmentSubtypes' ? 'text-sky-600 border-sky-600 bg-sky-50/50' : 'text-gray-500 border-transparent hover:bg-gray-50'}`}><Hammer className="w-4 h-4" /> Equipment Subtypes</button>
          )}
          <button onClick={() => setManageTab('inventory')} className={`px-6 py-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${manageTab === 'inventory' ? 'text-emerald-600 border-emerald-600 bg-emerald-50/50' : 'text-gray-500 border-transparent hover:bg-gray-50'}`}><Package className="w-4 h-4" /> InventoryMaster</button>
          <button onClick={() => setManageTab('supplies')} className={`px-6 py-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${manageTab === 'supplies' ? 'text-slate-600 border-slate-600 bg-slate-50/50' : 'text-gray-500 border-transparent hover:bg-gray-50'}`}><Hammer className="w-4 h-4" /> Supplies/Tools</button>
          {/* Routes Database tab removed — superseded by Jobber integration.
              State + localRoutes plumbing is left in place so the data model
              stays intact; tab content panel + Settings entry stay reachable
              only via legacy code paths (unreachable from UI). */}
          {isAdmin && (
            <button onClick={() => setManageTab('permissions')} className={`px-6 py-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${manageTab === 'permissions' ? 'text-lime-600 border-lime-600 bg-lime-50/50' : 'text-gray-500 border-transparent hover:bg-gray-50'}`}><ShieldCheck className="w-4 h-4" /> Permissions</button>
          )}
          {isAdmin && (
            <button onClick={() => setManageTab('authorized')} className={`px-6 py-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${manageTab === 'authorized' ? 'text-rose-600 border-rose-600 bg-rose-50/50' : 'text-gray-500 border-transparent hover:bg-gray-50'}`}><Mail className="w-4 h-4" /> Authorized Emails</button>
          )}
          <button onClick={() => setManageTab('settings')} className={`px-6 py-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${manageTab === 'settings' ? 'text-slate-700 border-slate-700 bg-slate-50/50' : 'text-gray-500 border-transparent hover:bg-gray-50'}`}><Sliders className="w-4 h-4" /> App Settings</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-slate-50 relative">
          {manageTab === 'employees' && (
            <div className="space-y-3">
              {localEmployees.map((emp, idx) => {
                const linkedNorm = (emp.linkedUserEmail || '').trim().toLowerCase();
                const linkedDuplicate = !!linkedNorm && localEmployees.some((other, oi) => oi !== idx && (other.linkedUserEmail || '').trim().toLowerCase() === linkedNorm);
                const sysRole = emp.systemRole || 'worker';
                const sysRoleBadgeColor =
                  sysRole === 'admin' ? 'bg-lime-100 text-lime-700 border-lime-300'
                  : sysRole === 'manager' ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                  : sysRole === 'foreman' ? 'bg-blue-100 text-blue-700 border-blue-300'
                  : sysRole === 'mechanic' ? 'bg-amber-100 text-amber-700 border-amber-300'
                  : 'bg-slate-100 text-slate-700 border-slate-300';
                const isTestUser = !!emp.isTestUser;
                return (
                <div key={emp.id} className={`flex flex-col gap-3 p-4 rounded-xl border shadow-sm ${isTestUser ? 'bg-fuchsia-50/40 border-fuchsia-200' : 'bg-white border-gray-200'}`}>
                  <div className="flex flex-wrap gap-3 items-center">
                    <input className="flex-1 min-w-[150px] border border-gray-300 rounded-lg p-2 text-sm font-bold text-gray-800 outline-none focus:ring-2 focus:ring-green-400" value={emp.name} onChange={e => { const ne = [...localEmployees]; ne[idx].name = e.target.value; setLocalEmployees(ne); }} />
                    {isTestUser && (
                      <span
                        className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded border bg-fuchsia-100 text-fuchsia-700 border-fuchsia-300"
                        title="Sentinel record — used by View As: Test User. Cannot be deleted."
                      >TEST</span>
                    )}
                    <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded border ${sysRoleBadgeColor}`}>{sysRole}</span>
                    <select className="border border-gray-300 rounded-lg p-2 text-sm font-bold bg-gray-50" value={emp.status} onChange={e => { const ne = [...localEmployees]; ne[idx].status = e.target.value; setLocalEmployees(ne); }}><option value="Active">Active</option><option value="Away">Away (Indefinite)</option></select>
                    <label className="flex items-center gap-1.5 text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 font-semibold"><input type="checkbox" checked={emp.hasLicense || false} onChange={e => { const ne = [...localEmployees]; ne[idx].hasLicense = e.target.checked; setLocalEmployees(ne); }} className="rounded text-green-600 focus:ring-green-500 w-4 h-4" /><IdCard className="w-4 h-4 text-green-600" /> License</label>
                    <label className="flex items-center gap-1.5 text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 font-semibold"><input type="checkbox" checked={emp.hasClassA || false} onChange={e => { const ne = [...localEmployees]; ne[idx].hasClassA = e.target.checked; setLocalEmployees(ne); }} className="rounded text-purple-600 focus:ring-purple-500 w-4 h-4" /><ClassAIcon className="w-4 h-4 text-purple-600" /> Class A</label>
                    <label className="flex items-center gap-1.5 text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 font-semibold"><input type="checkbox" checked={emp.timeMasterEnabled !== false} onChange={e => { const ne = [...localEmployees]; ne[idx].timeMasterEnabled = e.target.checked; setLocalEmployees(ne); }} className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4" /><Clock className="w-4 h-4 text-emerald-600" /> TimeMaster</label>
                    <button
                      onClick={() => {
                        if (isTestUser) return;
                        const linkedEmail = (emp.linkedUserEmail || '').trim().toLowerCase();
                        const willRevoke = !!linkedEmail && localAdmins.some(a => (a || '').trim().toLowerCase() === linkedEmail);
                        const confirmMsg = willRevoke
                          ? `Removing ${emp.name || 'this employee'} will also revoke their app access (${linkedEmail}). Continue?`
                          : `Remove ${emp.name || 'this employee'}?`;
                        if (!window.confirm(confirmMsg)) return;
                        setLocalEmployees(localEmployees.filter(e => e.id !== emp.id));
                        if (willRevoke) {
                          setLocalAdmins(localAdmins.filter(a => (a || '').trim().toLowerCase() !== linkedEmail));
                        }
                      }}
                      disabled={isTestUser}
                      className={`p-2 rounded-lg transition-colors ml-auto ${isTestUser ? 'text-slate-300 cursor-not-allowed' : 'text-red-400 hover:bg-red-50'}`}
                      title={isTestUser ? 'Test User sentinel — cannot be deleted' : 'Delete employee'}
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="flex flex-col gap-3 bg-orange-50/50 p-3 rounded-lg border border-orange-100">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs font-bold text-orange-800 uppercase flex items-center gap-1.5">
                        <CalendarIcon className="w-3.5 h-3.5" /> Scheduled Time Off
                      </span>
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => { const ne = [...localEmployees]; if (!ne[idx].awayDates) ne[idx].awayDates = []; ne[idx].awayDates.push({ start: '', end: '' }); setLocalEmployees(ne); }}
                          className="text-xs font-bold text-orange-700 hover:bg-orange-200 bg-orange-100 border border-orange-200 px-2 py-1 rounded"
                          title="Add a full-day or multi-day range (orange)"
                        >+ Full Day</button>
                        <button
                          onClick={() => setLocalPartialTimeOff([...localPartialTimeOff, { id: `pto-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, empId: emp.id, date: '', start: '', end: '' }])}
                          className="text-xs font-bold text-amber-700 hover:bg-amber-200 bg-amber-100 border border-amber-200 px-2 py-1 rounded"
                          title="Pre-schedule a partial day with start/end times (yellow)"
                        >+ Partial Day</button>
                      </div>
                    </div>

                    {/* Full-day list (orange — existing behavior, supports a range) */}
                    <div className="flex flex-col gap-1">
                      <div className="text-[10px] font-black uppercase tracking-widest text-orange-700/80 pl-1">Full Days</div>
                      {(!emp.awayDates || emp.awayDates.length === 0)
                        ? <div className="text-xs text-orange-600/60 italic font-medium pl-1">No full days scheduled.</div>
                        : <div className="space-y-2">{emp.awayDates.map((dateRange, dIdx) => (
                            <div key={dIdx} className="flex items-center gap-3 bg-white p-1.5 rounded-lg border border-orange-200 shadow-sm w-fit">
                              <input type="date" className="border-none bg-transparent outline-none p-1 text-sm font-bold text-gray-700" value={dateRange.start || ''} onChange={e => { const ne = [...localEmployees]; ne[idx].awayDates[dIdx].start = e.target.value; setLocalEmployees(ne); }} />
                              <span className="text-sm font-bold text-orange-400">to</span>
                              <input type="date" className="border-none bg-transparent outline-none p-1 text-sm font-bold text-gray-700" value={dateRange.end || ''} onChange={e => { const ne = [...localEmployees]; ne[idx].awayDates[dIdx].end = e.target.value; setLocalEmployees(ne); }} />
                              <button onClick={() => { const ne = [...localEmployees]; ne[idx].awayDates.splice(dIdx, 1); setLocalEmployees(ne); }} className="text-red-400 hover:bg-red-50 p-1.5 rounded ml-2"><X className="w-3.5 h-3.5" /></button>
                            </div>
                          ))}</div>}
                    </div>

                    {/* Partial-day list (yellow/amber — single day, start/end times).
                        Persisted into appData.partialTimeOff on Save; display-only. */}
                    <div className="flex flex-col gap-1">
                      <div className="text-[10px] font-black uppercase tracking-widest text-amber-700/80 pl-1 flex items-center gap-2 flex-wrap">
                        Partial Days
                        <span className="text-[9px] font-bold normal-case tracking-normal text-amber-600/80">Display only — no effect on BH / AH / efficiency</span>
                      </div>
                      {(() => {
                        const myPartials = localPartialTimeOff
                          .map((p, gIdx) => ({ p, gIdx }))
                          .filter(x => x.p.empId === emp.id);
                        if (myPartials.length === 0) {
                          return <div className="text-xs text-amber-600/60 italic font-medium pl-1">No partial days scheduled.</div>;
                        }
                        return (
                          <div className="space-y-2">
                            {myPartials.map(({ p, gIdx }) => (
                              <div key={p.id} className="flex items-center gap-2 bg-white p-1.5 rounded-lg border border-amber-200 shadow-sm w-fit flex-wrap">
                                <input type="date" className="border-none bg-transparent outline-none p-1 text-sm font-bold text-gray-700" value={p.date} onChange={e => { const ne = [...localPartialTimeOff]; ne[gIdx] = { ...ne[gIdx], date: e.target.value }; setLocalPartialTimeOff(ne); }} />
                                <span className="text-sm font-bold text-amber-400">·</span>
                                <input type="time" className="border-none bg-transparent outline-none p-1 text-sm font-bold text-gray-700" value={p.start} onChange={e => { const ne = [...localPartialTimeOff]; ne[gIdx] = { ...ne[gIdx], start: e.target.value }; setLocalPartialTimeOff(ne); }} />
                                <span className="text-sm font-bold text-amber-400">to</span>
                                <input type="time" className="border-none bg-transparent outline-none p-1 text-sm font-bold text-gray-700" value={p.end} onChange={e => { const ne = [...localPartialTimeOff]; ne[gIdx] = { ...ne[gIdx], end: e.target.value }; setLocalPartialTimeOff(ne); }} />
                                <button onClick={() => setLocalPartialTimeOff(localPartialTimeOff.filter(x => x.id !== p.id))} className="text-red-400 hover:bg-red-50 p-1.5 rounded ml-2"><X className="w-3.5 h-3.5" /></button>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 bg-lime-50/40 p-3 rounded-lg border border-lime-100">
                    <div className="text-[10px] font-black uppercase tracking-widest text-lime-700 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> System Access {!isAdmin && <span className="text-slate-400 normal-case tracking-normal font-medium">(read-only — admin only)</span>}</div>
                    <div className="flex flex-wrap gap-3 items-start">
                      <div className="flex-1 min-w-[220px]">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">Email <span className="text-slate-400 normal-case tracking-normal">(contact + sign-in)</span></label>
                        <input
                          type="email"
                          placeholder="user@example.com"
                          disabled={!isAdmin}
                          value={emp.linkedUserEmail || ''}
                          onFocus={() => { linkedFocusRef.current.set(emp.id, emp.linkedUserEmail || ''); }}
                          onChange={e => {
                            const ne = [...localEmployees];
                            const v = e.target.value;
                            // Single source of truth: linkedUserEmail and email always stay in sync.
                            ne[idx].linkedUserEmail = v;
                            ne[idx].email = v;
                            setLocalEmployees(ne);
                          }}
                          onBlur={() => {
                            const oldVal = (linkedFocusRef.current.get(emp.id) || '').trim().toLowerCase();
                            linkedFocusRef.current.delete(emp.id);
                            const newVal = (emp.linkedUserEmail || '').trim().toLowerCase();
                            if (!newVal) return; // cleared — leave authorizedEmails alone
                            if (!EMAIL_RX.test(newVal)) return; // malformed — no-op
                            const adminsNorm = localAdmins.map(a => (a || '').trim().toLowerCase()).filter(Boolean);
                            if (adminsNorm.includes(newVal)) return; // already authorized
                            const next = Array.from(new Set([...adminsNorm, newVal])).sort();
                            setLocalAdmins(next);
                            const wasChange = !!oldVal && oldVal !== newVal && adminsNorm.includes(oldVal);
                            if (wasChange) {
                              showToastMsg(`Added ${newVal} to Authorized Emails. ${oldVal} is still authorized — remove via Authorized Emails tab if needed.`);
                            } else {
                              showToastMsg(`Added ${newVal} to Authorized Emails`);
                            }
                          }}
                          className={`w-full bg-white border rounded-lg p-2 text-sm font-medium text-slate-800 outline-none focus:ring-2 focus:ring-lime-400 disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed ${linkedDuplicate ? 'border-rose-400 ring-1 ring-rose-200' : 'border-gray-300'}`}
                        />
                        {linkedDuplicate && <div className="text-[10px] text-rose-600 font-bold mt-1">Email already linked to another employee.</div>}
                      </div>
                      <div className="w-44">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">System Role</label>
                        <select
                          disabled={!isAdmin}
                          value={emp.systemRole || 'worker'}
                          onChange={e => { const ne = [...localEmployees]; ne[idx].systemRole = e.target.value as any; setLocalEmployees(ne); }}
                          className="w-full bg-white border border-gray-300 rounded-lg p-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-lime-400 disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed"
                        >
                          <option value="admin">Admin</option>
                          <option value="manager">Manager</option>
                          <option value="foreman">Foreman</option>
                          <option value="worker">Worker</option>
                          <option value="mechanic">Mechanic</option>
                        </select>
                      </div>
                      <div className="w-44">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">Manages Division</label>
                        <select
                          disabled={!isAdmin}
                          value={emp.managedDivision || ''}
                          onChange={e => { const ne = [...localEmployees]; const v = e.target.value; ne[idx].managedDivision = v === '' ? undefined : v as any; setLocalEmployees(ne); }}
                          className="w-full bg-white border border-gray-300 rounded-lg p-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-lime-400 disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed"
                        >
                          <option value="">(None)</option>
                          <option value="lawn">Lawn</option>
                          <option value="small">Small Projects</option>
                          <option value="large">Large Projects</option>
                          <option value="all">All</option>
                        </select>
                      </div>
                      <div className="w-44">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">Primary Crew</label>
                        <select
                          disabled={!isAdmin}
                          value={emp.primaryCrew || ''}
                          onChange={e => { const ne = [...localEmployees]; const v = e.target.value; ne[idx].primaryCrew = v === '' ? undefined : v as any; setLocalEmployees(ne); }}
                          className="w-full bg-white border border-gray-300 rounded-lg p-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-lime-400 disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed"
                        >
                          <option value="">(None)</option>
                          {PRIMARY_CREWS.map(pc => <option key={pc} value={pc}>{pc}</option>)}
                        </select>
                      </div>
                      <div className="w-56">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">Jobber User</label>
                        {(() => {
                          const jobberId = emp.jobberUserId || '';
                          const isDup = !!jobberId && (jobberDuplicates.get(jobberId) || 0) > 1;
                          const otherEmp = isDup
                            ? localEmployees.find((o, oi) => oi !== idx && o.jobberUserId === jobberId)
                            : undefined;
                          const selectedUser = jobberId ? jobberUsersById.get(jobberId) : undefined;
                          const selectedIsArchived = !!selectedUser && selectedUser.isArchived === true;
                          return (
                            <>
                              <select
                                disabled={!isAdmin}
                                value={jobberId}
                                onChange={e => {
                                  const ne = [...localEmployees];
                                  ne[idx].jobberUserId = e.target.value || undefined;
                                  setLocalEmployees(ne);
                                }}
                                title={isDup && otherEmp ? `Already linked to ${otherEmp.name}` : undefined}
                                className={`w-full bg-white border rounded-lg p-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-lime-400 disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed ${isDup ? 'border-amber-400 ring-1 ring-amber-200' : 'border-gray-300'}`}
                              >
                                <option value="">(None)</option>
                                {selectedIsArchived && selectedUser && (
                                  <option key={selectedUser.id} value={selectedUser.id}>
                                    {selectedUser.name} (inactive)
                                  </option>
                                )}
                                {sortedJobberUsers.map(u => (
                                  <option key={u.id} value={u.id}>{u.name}</option>
                                ))}
                              </select>
                              {isDup && otherEmp && (
                                <div className="text-[10px] text-amber-700 font-bold mt-1">
                                  Already linked to {otherEmp.name}
                                </div>
                              )}
                              {jobberId && !selectedUser && (
                                <div className="text-[10px] text-amber-700 font-bold mt-1">
                                  Linked ID not in current Jobber user list — re-sync or re-pick.
                                </div>
                              )}
                              {selectedIsArchived && (
                                <div className="text-[10px] text-slate-500 font-medium mt-1">
                                  This Jobber user is archived. Link preserved — pick an active user to replace.
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                  {sysRole === 'mechanic' && (
                    <div className="flex flex-col gap-2 bg-amber-50/40 p-3 rounded-lg border border-amber-100">
                      <div className="text-[10px] font-black uppercase tracking-widest text-amber-800 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" /> Mechanic Pay Chunks
                      </div>
                      <div className="flex flex-wrap gap-3 items-end">
                        <div className="w-44">
                          <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">Hours per $1,000</label>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            disabled={!isAdmin}
                            value={typeof emp.hoursPer1000 === 'number' ? emp.hoursPer1000 : ''}
                            onChange={e => {
                              const ne = [...localEmployees];
                              const v = e.target.value;
                              ne[idx] = { ...ne[idx], hoursPer1000: v === '' ? undefined : Number(v) };
                              setLocalEmployees(ne);
                            }}
                            placeholder="e.g. 20"
                            className="w-full bg-white border border-amber-200 rounded-lg p-2 text-sm font-mono font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-400 disabled:bg-slate-50"
                          />
                        </div>
                        <div className="text-[11px] text-amber-700/80 flex-1 min-w-[200px]">
                          A mechanic earns $1,000 for every <strong>{typeof emp.hoursPer1000 === 'number' ? emp.hoursPer1000 : 'N/A'}</strong> hrs clocked. Each $1,000 span is a "chunk" tracked on MyMechanic / PerformanceMaster.
                        </div>
                      </div>
                      {(() => {
                        if (typeof emp.hoursPer1000 !== 'number' || emp.hoursPer1000 <= 0) return null;
                        const empEmail = (emp.linkedUserEmail || '').toLowerCase();
                        if (!empEmail) {
                          return (
                            <div className="text-[11px] italic text-amber-700/80">
                              Link a sign-in email above before you can set up this mechanic's first chunk.
                            </div>
                          );
                        }
                        const hasOpenChunk = Object.values(mechanicPayChunks || {}).some(
                          c => (c.mechanicEmail || '').toLowerCase() === empEmail && c.status === 'open',
                        );
                        if (hasOpenChunk) {
                          return (
                            <div className="text-[11px] italic text-emerald-700/80">
                              Pay chunk already open for this mechanic. Updates happen via TimeMaster automatically.
                            </div>
                          );
                        }
                        const draft = chunkSetupDrafts[emp.id] || { hours: '', startDate: '' };
                        const today = new Date().toISOString().slice(0, 10);
                        return (
                          <div className="flex flex-wrap gap-3 items-end bg-white border border-amber-200 rounded-lg p-2">
                            <div className="w-44">
                              <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">Hours already worked this chunk</label>
                              <input
                                type="number"
                                min={0}
                                step={0.1}
                                disabled={!isAdmin}
                                value={draft.hours}
                                onChange={e => setChunkSetupDrafts(prev => ({ ...prev, [emp.id]: { ...draft, hours: e.target.value } }))}
                                placeholder="0"
                                className="w-full bg-white border border-amber-200 rounded-lg p-2 text-sm font-mono font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-400 disabled:bg-slate-50"
                              />
                            </div>
                            <div className="w-44">
                              <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">Chunk start date</label>
                              <input
                                type="date"
                                disabled={!isAdmin}
                                value={draft.startDate || today}
                                onChange={e => setChunkSetupDrafts(prev => ({ ...prev, [emp.id]: { ...draft, startDate: e.target.value } }))}
                                className="w-full bg-white border border-amber-200 rounded-lg p-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-400 disabled:bg-slate-50"
                              />
                            </div>
                            <button
                              type="button"
                              disabled={!isAdmin}
                              onClick={() => {
                                const hoursVal = Number(draft.hours || '0');
                                const safeHours = Number.isFinite(hoursVal) && hoursVal >= 0 ? hoursVal : 0;
                                const dateStr = draft.startDate || today;
                                const startMs = new Date(`${dateStr}T00:00:00`).getTime();
                                if (!Number.isFinite(startMs)) {
                                  showToastMsg('Pick a valid start date.');
                                  return;
                                }
                                onCreateInitialChunk(emp, safeHours, startMs);
                                setChunkSetupDrafts(prev => {
                                  const { [emp.id]: _ignored, ...rest } = prev;
                                  void _ignored;
                                  return rest;
                                });
                              }}
                              className="min-h-[40px] px-4 py-2 text-[11px] font-black uppercase tracking-widest bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow disabled:bg-slate-300 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                            >
                              Create First Chunk
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );})}
              <button onClick={() => setLocalEmployees([...localEmployees, { id: `e-${Date.now()}`, name: 'New Employee', status: 'Active', hasLicense: false, hasClassA: false, hasHeavyMachinery: false, awayDates: [] }])} className="w-full py-4 border-2 border-dashed border-green-300 text-green-600 rounded-xl font-bold hover:bg-green-50 transition-colors flex items-center justify-center gap-2"><Plus className="w-5 h-5" /> Add Employee</button>
            </div>
          )}

          {manageTab === 'fleet' && (
            <div className="space-y-4">
              {/* Fleet Filters */}
              <div className="flex bg-white rounded-lg border border-gray-300 overflow-hidden w-fit shadow-sm">
                {['truck', 'trailer', 'tractor', 'equipment'].map(type => (
                  <button key={type} onClick={() => setFleetFilter(type)} className={`px-4 py-2 text-sm font-bold capitalize transition-colors ${fleetFilter === type ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{type}</button>
                ))}
              </div>

              {localFleet.filter(f => f.type === fleetFilter).map((f) => {
                const realIdx = localFleet.findIndex(lf => lf.id === f.id);
                return (
                  <div key={f.id} className="flex flex-col gap-3 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div className="flex flex-wrap gap-3 items-center">
                      <div className="flex flex-col">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Unit #</label>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          placeholder="#"
                          value={typeof f.unitNumber === 'number' ? f.unitNumber : ''}
                          onChange={e => { const nf = [...localFleet]; const v = e.target.value; nf[realIdx].unitNumber = v === '' ? undefined : Number(v); setLocalFleet(nf); }}
                          className={`w-20 border-2 rounded-lg px-2 py-2 text-lg font-black text-center outline-none focus:ring-2 ${typeof f.unitNumber === 'number' ? 'border-slate-300 text-slate-900 focus:ring-slate-400' : 'border-amber-300 text-amber-900 focus:ring-amber-400'}`}
                        />
                      </div>
                      <input
                        className={`flex-1 min-w-[180px] border-2 rounded-lg px-3 py-2.5 text-xl font-black tracking-wide outline-none focus:ring-2 ${f.type === 'truck' ? 'border-emerald-300 text-emerald-900 focus:ring-emerald-400' : f.type === 'trailer' ? 'border-amber-300 text-amber-900 focus:ring-amber-400' : f.type === 'tractor' ? 'border-orange-300 text-orange-900 focus:ring-orange-400' : 'border-sky-300 text-sky-900 focus:ring-sky-400'}`}
                        placeholder={f.type === 'truck' ? 'e.g., F-150' : f.type === 'trailer' ? 'e.g., Flatbed A' : f.type === 'tractor' ? 'e.g., Kubota L3901' : 'e.g., SCAG Z72'}
                        value={f.name}
                        onChange={e => { const nf = [...localFleet]; nf[realIdx].name = e.target.value; setLocalFleet(nf); }}
                      />
                      <select className="border border-gray-300 rounded-lg p-2 text-sm font-semibold bg-gray-50 capitalize" value={f.type} onChange={e => { const nf = [...localFleet]; nf[realIdx].type = e.target.value; if (e.target.value !== 'equipment') nf[realIdx].equipmentSubtype = undefined; setLocalFleet(nf); }}><option value="truck">Truck</option><option value="trailer">Trailer</option><option value="tractor">Tractor</option><option value="equipment">Equipment</option></select>
                      {f.type === 'equipment' && (
                        <select className="border border-gray-300 rounded-lg p-2 text-sm font-semibold bg-gray-50" value={f.equipmentSubtype || ''} onChange={e => { const nf = [...localFleet]; const v = e.target.value; nf[realIdx].equipmentSubtype = v === '' ? undefined : v; setLocalFleet(nf); }}>
                          <option value="">Pick subtype…</option>
                          {[...localEquipmentSubtypes].sort((a, b) => a.sortOrder - b.sortOrder).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      )}
                      <select className="border border-gray-300 rounded-lg p-2 text-sm font-bold bg-gray-50" value={f.status} onChange={e => { const nf = [...localFleet]; nf[realIdx].status = e.target.value; setLocalFleet(nf); }}><option value="Active">Active</option><option value="Out of Service">Out of Service</option><option value="In Repair">In Repair</option></select>
                      <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-300 rounded-lg p-1.5">
                        {['bg-black', 'bg-gray-500', 'bg-white', 'bg-blue-600', 'bg-red-500', 'bg-green-500', 'bg-yellow-400', 'bg-orange-500'].map(color => (
                          <button key={color} onClick={() => { const nf = [...localFleet]; nf[realIdx].color = color; setLocalFleet(nf); }} className={`w-6 h-6 rounded-full ${color} border border-gray-300 transition-all ${f.color === color ? 'ring-2 ring-offset-1 ring-slate-800 scale-110' : 'opacity-60 hover:opacity-100'}`} />
                        ))}
                      </div>
                      {isAdmin && (
                        <button onClick={() => setLocalFleet(localFleet.filter(item => item.id !== f.id))} className="text-red-400 hover:bg-red-50 p-2 rounded-lg transition-colors ml-auto" title="Delete fleet (admin only)"><Trash2 className="w-5 h-5" /></button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-1">
                      <div className="flex flex-col gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Identification & Compliance</h5>
                        <div className="flex items-center gap-2">
                          {(() => {
                            // Trucks, trailers, and tractors carry a VIN (vehicle
                            // identification number); equipment carries a serial.
                            // Display-only relabel — the underlying field is the
                            // same `serialNumber` slot.
                            const isVin = f.type === 'truck' || f.type === 'trailer' || f.type === 'tractor';
                            return (
                              <>
                                <span className="text-xs font-bold text-slate-700 w-24">{isVin ? 'VIN #:' : 'Serial #:'}</span>
                                <input className="flex-1 border border-slate-300 rounded p-1.5 text-xs font-bold bg-white" placeholder={isVin ? 'VIN Number' : 'Serial Number'} value={f.serialNumber || ''} onChange={e => { const nf = [...localFleet]; nf[realIdx].serialNumber = e.target.value; setLocalFleet(nf); }} />
                              </>
                            );
                          })()}
                        </div>
                        {f.type === 'equipment' && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-700 w-24">Model #:</span>
                            <input className="flex-1 border border-slate-300 rounded p-1.5 text-xs font-bold bg-white" placeholder="Model Number" value={f.modelNumber || ''} onChange={e => { const nf = [...localFleet]; nf[realIdx].modelNumber = e.target.value; setLocalFleet(nf); }} />
                          </div>
                        )}

                        {f.type !== 'equipment' && (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-700 w-24">Plate #:</span>
                              <input
                                type="text"
                                className="flex-1 border border-slate-300 rounded p-1.5 text-xs font-mono font-semibold bg-white tracking-wider"
                                value={f.plateNumber || ''}
                                placeholder="e.g. ABCD 123"
                                onChange={e => { const nf = [...localFleet]; nf[realIdx].plateNumber = e.target.value; setLocalFleet(nf); }}
                              />
                            </div>
                            {f.type === 'truck' && (
                              <>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-slate-700 w-24">Reg. Gross Wt:</span>
                                  <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    className="w-32 border border-slate-300 rounded p-1.5 text-xs font-semibold bg-white"
                                    value={typeof f.registeredGrossWeight === 'number' ? f.registeredGrossWeight : ''}
                                    placeholder="kg"
                                    onChange={e => {
                                      const nf = [...localFleet];
                                      const v = e.target.value === '' ? undefined : Number(e.target.value);
                                      nf[realIdx].registeredGrossWeight = (typeof v === 'number' && Number.isFinite(v)) ? v : undefined;
                                      setLocalFleet(nf);
                                    }}
                                  />
                                  <span className="text-[10px] font-bold text-slate-500">kg</span>
                                  {(() => {
                                    const label = weightBandLabel(f);
                                    if (!label) return null;
                                    return <span className="text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border bg-slate-100 text-slate-700 border-slate-300">Band: {label}</span>;
                                  })()}
                                </div>
                                {hasLegacyWeightClassOnly(f) && (
                                  <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                    Legacy weight class: <span className="font-bold">{f.weightClass}</span>. Enter the registered gross weight above to update the classification.
                                  </div>
                                )}
                              </>
                            )}
                            {f.type === 'truck' && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-700 w-24">Compliance:</span>
                                <label className="flex items-center gap-2 cursor-pointer bg-white px-2 py-1 rounded border border-slate-300 flex-1">
                                  <input type="checkbox" checked={f.cvorRequired || false} onChange={e => { const nf = [...localFleet]; nf[realIdx].cvorRequired = e.target.checked; setLocalFleet(nf); }} className="w-4 h-4 rounded text-lime-600 focus:ring-lime-500" />
                                  <span className="text-[10px] font-black uppercase text-slate-600">CVOR/Schedule 1 Required</span>
                                </label>
                              </div>
                            )}
                            {f.type === 'trailer' && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-700 w-24">Yellow Sticker:</span>
                                <label className="flex items-center gap-2 cursor-pointer bg-white px-2 py-1 rounded border border-slate-300 flex-1">
                                  <input type="checkbox" checked={f.isYellowSticker || false} onChange={e => { const nf = [...localFleet]; nf[realIdx].isYellowSticker = e.target.checked; setLocalFleet(nf); }} className="w-4 h-4 rounded text-yellow-600 focus:ring-yellow-500" />
                                  <span className="text-[10px] font-black uppercase text-slate-600">CVOR - Yellow Sticker</span>
                                </label>
                              </div>
                            )}
                            {f.type === 'truck' && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-700 w-24">Connector Pins:</span>
                                <div className="flex items-center gap-2 flex-1">
                                  {(['7-pin', '5-pin', '4-pin'] as const).map(pin => {
                                    const checked = (f.connectorPins || []).includes(pin);
                                    return (
                                      <label key={pin} className="flex items-center gap-1 cursor-pointer bg-white px-2 py-1 rounded border border-slate-300">
                                        <input type="checkbox" checked={checked} onChange={e => { const nf = [...localFleet]; const cur = nf[realIdx].connectorPins || []; nf[realIdx].connectorPins = e.target.checked ? [...cur, pin] : cur.filter(p => p !== pin); setLocalFleet(nf); }} className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500" />
                                        <span className="text-[10px] font-black uppercase text-slate-600">{pin}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            {f.type === 'truck' && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-700 w-24">Ramp Rack:</span>
                                <label className="flex items-center gap-2 cursor-pointer bg-white px-2 py-1 rounded border border-slate-300 flex-1">
                                  <input type="checkbox" checked={f.hasRampRack || false} onChange={e => { const nf = [...localFleet]; nf[realIdx].hasRampRack = e.target.checked; setLocalFleet(nf); }} className="w-4 h-4 rounded text-orange-600 focus:ring-orange-500" />
                                  <span className="text-[10px] font-black uppercase text-slate-600">Has Ramp Rack (blocks trailer towing)</span>
                                </label>
                              </div>
                            )}
                            {f.type === 'trailer' && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-700 w-24">Trailer Pin:</span>
                                <select className="flex-1 border border-slate-300 rounded p-1.5 text-xs font-semibold bg-white" value={f.trailerPin || ''} onChange={e => { const nf = [...localFleet]; nf[realIdx].trailerPin = (e.target.value || undefined) as ('7-pin' | '5-pin' | '4-pin' | undefined); setLocalFleet(nf); }}>
                                  <option value="">Not specified</option>
                                  <option value="7-pin">7-pin</option>
                                  <option value="5-pin">5-pin</option>
                                  <option value="4-pin">4-pin</option>
                                </select>
                              </div>
                            )}
                          </>
                        )}

                        {f.type !== 'equipment' && (
                          needsCommercialSafety(f) ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-700 w-24">Commercial Safety Expiry:</span>
                              <input type="date" className="flex-1 border border-slate-300 rounded p-1.5 text-xs font-semibold bg-white" value={f.safetyExpiry || ''} onChange={e => { const nf = [...localFleet]; nf[realIdx].safetyExpiry = e.target.value; setLocalFleet(nf); }} />
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-700 w-24">Commercial Safety:</span>
                              <span className="text-[11px] italic text-slate-400">No renewal required</span>
                            </div>
                          )
                        )}

                        {f.type === 'truck' && (
                          needsPlateRenewal(f) ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-700 w-24">Plate Renewal:</span>
                              <input type="date" className="flex-1 border border-slate-300 rounded p-1.5 text-xs font-semibold bg-white" value={f.regExpiry || ''} onChange={e => { const nf = [...localFleet]; nf[realIdx].regExpiry = e.target.value; setLocalFleet(nf); }} />
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-700 w-24">Plate Renewal:</span>
                              <span className="text-[11px] italic text-slate-400">No renewal required</span>
                            </div>
                          )
                        )}
                      </div>

                      <div className="flex flex-col gap-2 bg-green-50/50 p-3 rounded-xl border border-green-100">
                        <h5 className="text-[10px] font-black text-green-800 uppercase tracking-widest">Maintenance & Odometer</h5>

                        {/* Truck-only odometer entry — a second entry
                            point alongside the Fleet List inline edit
                            and the crew daily inspection. Writes to
                            the same f.odometer field; the save loop
                            stamps lastOdometerUpdate when it changes
                            and runs the km maintenance spawn helper. */}
                        {f.type === 'truck' && (
                          <div className="flex items-center gap-2 bg-white border border-green-200 rounded p-2">
                            <span className="text-xs font-bold text-green-900 w-24">Odometer (km):</span>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={typeof f.odometer === 'number' ? f.odometer : ''}
                              onChange={e => {
                                const nf = [...localFleet];
                                const v = e.target.value;
                                nf[realIdx] = { ...nf[realIdx], odometer: v === '' ? undefined : Number(v) };
                                setLocalFleet(nf);
                              }}
                              className="flex-1 border border-green-200 rounded p-1.5 text-xs font-mono font-bold bg-white"
                              placeholder="km"
                            />
                          </div>
                        )}

                        {/* Engine-hour tracking — equipment and tractors
                            opt in. Trucks track maintenance by km
                            (auto, separate block below); trailers
                            don't track maintenance at all. When the
                            toggle is on, the manager sets a baseline
                            hour reading + a list of maintenance
                            schedules. Each new schedule's nextDueAt
                            is computed from the current reading +
                            threshold at add time. The Current Hrs
                            input locks after the unit's first
                            persisted save — ongoing weekly updates
                            happen via the Fleet List inline edit
                            (which also runs the spawn helper),
                            not here. */}
                        {(f.type === 'equipment' || f.type === 'tractor') && (
                        <>
                        <div className="border-t border-green-200 pt-2 mt-1">
                          <label className="flex items-center gap-2 text-xs font-bold text-green-900 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!!f.tracksEngineHours}
                              onChange={e => {
                                const nf = [...localFleet];
                                nf[realIdx] = { ...nf[realIdx], tracksEngineHours: e.target.checked };
                                if (!e.target.checked) {
                                  // Don't drop maintenanceItems / hours
                                  // — flip the flag off, retain data.
                                }
                                setLocalFleet(nf);
                              }}
                              className="w-4 h-4 rounded text-green-700 focus:ring-green-500"
                            />
                            Tracks engine hours
                          </label>
                        </div>
                        {f.tracksEngineHours && (() => {
                          // Current Hrs is now editable in BOTH the edit form
                          // and the Fleet List inline editor — same as the truck
                          // odometer. The setup-form save still runs the spawn
                          // helper so a fresh hour reading promotes due items.
                          const hasValidHours = typeof f.currentEngineHours === 'number' && f.currentEngineHours > 0;
                          return (
                          <div className="flex flex-col gap-2 bg-white border border-green-200 rounded p-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-green-900 w-24">Current Hrs:</span>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={typeof f.currentEngineHours === 'number' ? f.currentEngineHours : ''}
                                onChange={e => {
                                  const nf = [...localFleet];
                                  const v = e.target.value;
                                  nf[realIdx] = { ...nf[realIdx], currentEngineHours: v === '' ? undefined : Number(v) };
                                  setLocalFleet(nf);
                                }}
                                className="flex-1 border border-green-200 rounded p-1.5 text-xs font-mono font-bold bg-white"
                              />
                            </div>
                            <div className="text-[10px] font-black uppercase tracking-widest text-green-800 mt-1">Maintenance Schedules</div>
                            {(f.maintenanceItems || []).length === 0 ? (
                              <div className="text-[11px] italic text-green-700/60">No schedules yet. Add one below (e.g. Engine oil at 100 hrs).</div>
                            ) : (
                              <div className="space-y-1.5">
                                {(f.maintenanceItems || []).map((mi, miIdx) => {
                                  if ((mi.metric || 'hours') !== 'hours') return null;
                                  const isUnlocked = !!nextDueUnlocked[mi.id];
                                  const buffer = typeof mi.warnBuffer === 'number' ? mi.warnBuffer : 25;
                                  return (
                                  <div key={mi.id} className="flex flex-wrap items-center gap-2 bg-green-50/50 border border-green-200 rounded p-2">
                                    <input
                                      type="text"
                                      placeholder="Name (e.g. Engine oil)"
                                      value={mi.name}
                                      onChange={e => {
                                        const nf = [...localFleet];
                                        const items = [...(nf[realIdx].maintenanceItems || [])];
                                        items[miIdx] = { ...items[miIdx], name: e.target.value };
                                        nf[realIdx] = { ...nf[realIdx], maintenanceItems: items };
                                        setLocalFleet(nf);
                                      }}
                                      className="flex-1 min-w-[120px] border border-green-200 rounded p-1.5 text-xs font-bold bg-white"
                                    />
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px] font-bold text-green-900">Every</span>
                                      <input
                                        type="number"
                                        min={1}
                                        step={1}
                                        value={mi.threshold}
                                        onChange={e => {
                                          const nf = [...localFleet];
                                          const items = [...(nf[realIdx].maintenanceItems || [])];
                                          items[miIdx] = { ...items[miIdx], threshold: Number(e.target.value) || 0 };
                                          nf[realIdx] = { ...nf[realIdx], maintenanceItems: items };
                                          setLocalFleet(nf);
                                        }}
                                        className="w-16 border border-green-200 rounded p-1 text-xs font-mono font-bold bg-white"
                                      />
                                      <span className="text-[10px] font-bold text-green-900">hrs</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px] font-bold text-green-900">Next due:</span>
                                      {isUnlocked ? (
                                        <input
                                          type="number"
                                          min={0}
                                          step={1}
                                          value={mi.nextDueAt || ''}
                                          onChange={e => {
                                            const nf = [...localFleet];
                                            const items = [...(nf[realIdx].maintenanceItems || [])];
                                            items[miIdx] = { ...items[miIdx], nextDueAt: Number(e.target.value) || 0 };
                                            nf[realIdx] = { ...nf[realIdx], maintenanceItems: items };
                                            setLocalFleet(nf);
                                          }}
                                          className="w-20 border border-green-200 rounded p-1 text-xs font-mono font-bold bg-white"
                                        />
                                      ) : (
                                        <span className="text-[11px] font-mono font-bold text-green-900 bg-white border border-green-200 rounded px-2 py-1 min-w-[50px] text-center">{mi.nextDueAt}</span>
                                      )}
                                      <span className="text-[10px] font-bold text-green-900">hrs</span>
                                      <button
                                        type="button"
                                        onClick={() => setNextDueUnlocked(prev => ({ ...prev, [mi.id]: !prev[mi.id] }))}
                                        className="text-[10px] font-black uppercase tracking-widest text-emerald-700 hover:text-emerald-900 px-1"
                                        title={isUnlocked ? 'Lock the default' : 'Override the default'}
                                      >
                                        {isUnlocked ? 'Lock' : 'Edit'}
                                      </button>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px] font-bold text-green-900">Warn</span>
                                      <input
                                        type="number"
                                        min={0}
                                        step={1}
                                        value={buffer}
                                        onChange={e => {
                                          const nf = [...localFleet];
                                          const items = [...(nf[realIdx].maintenanceItems || [])];
                                          items[miIdx] = { ...items[miIdx], warnBuffer: Number(e.target.value) || 0 };
                                          nf[realIdx] = { ...nf[realIdx], maintenanceItems: items };
                                          setLocalFleet(nf);
                                        }}
                                        className="w-14 border border-green-200 rounded p-1 text-xs font-mono font-bold bg-white"
                                      />
                                      <span className="text-[10px] font-bold text-green-900">hrs before</span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const nf = [...localFleet];
                                        const items = (nf[realIdx].maintenanceItems || []).filter((_, i) => i !== miIdx);
                                        nf[realIdx] = { ...nf[realIdx], maintenanceItems: items };
                                        setLocalFleet(nf);
                                      }}
                                      className="text-rose-400 hover:text-rose-600 p-1 ml-auto"
                                      title="Remove this schedule"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  );
                                })}
                              </div>
                            )}
                            <button
                              type="button"
                              disabled={!hasValidHours}
                              onClick={() => {
                                if (!hasValidHours) return;
                                const nf = [...localFleet];
                                const existing = nf[realIdx].maintenanceItems || [];
                                // First item defaults to 100 hr threshold,
                                // second 500 (matches typical engine-oil /
                                // hydraulic-oil cadence); fall back to 100
                                // for any beyond that.
                                const defaultThreshold = existing.length === 0 ? 100 : existing.length === 1 ? 500 : 100;
                                const currentHrs = nf[realIdx].currentEngineHours as number;
                                const newItem = {
                                  id: `mi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                                  name: existing.length === 0 ? 'Engine oil' : existing.length === 1 ? 'Hydraulic oil' : '',
                                  threshold: defaultThreshold,
                                  nextDueAt: currentHrs + defaultThreshold,
                                  metric: 'hours' as const,
                                  warnBuffer: 25,
                                };
                                nf[realIdx] = { ...nf[realIdx], maintenanceItems: [...existing, newItem] };
                                setLocalFleet(nf);
                              }}
                              className={`text-[10px] font-black uppercase tracking-widest self-start inline-flex items-center gap-1 ${hasValidHours ? 'text-green-700 hover:text-green-900' : 'text-slate-400 cursor-not-allowed'}`}
                              title={hasValidHours ? 'Add a maintenance schedule' : 'Enter current engine hours first'}
                            >
                              <Plus className="w-3 h-3" /> Add schedule
                            </button>
                            {!hasValidHours && (
                              <div className="text-[10px] italic text-amber-700">Enter current engine hours first.</div>
                            )}
                          </div>
                          );
                        })()}
                        </>
                        )}

                        {/* Truck-only km maintenance — auto, no toggle.
                            Every truck shows an Oil change item; when
                            no km item is persisted yet, we render a
                            placeholder row pre-filled with the default
                            name + 5,000 km interval and a blank
                            next-due (Option A). Editing any field
                            materialises a real MaintenanceItem.
                            Trailers and tractors do NOT appear here —
                            trailers have no maintenance; tractors use
                            the equipment hours block above. */}
                        {f.type === 'truck' && (() => {
                          const allItems = f.maintenanceItems || [];
                          const kmItems = allItems.filter(mi => (mi.metric || 'hours') === 'km');
                          const showPlaceholder = kmItems.length === 0;
                          const materialiseFromPlaceholder = (patch: { name?: string; threshold?: number; nextDueAt?: number }) => {
                            const nf = [...localFleet];
                            const existing = nf[realIdx].maintenanceItems || [];
                            const newItem = {
                              id: `mi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                              name: patch.name ?? 'Oil change',
                              threshold: typeof patch.threshold === 'number' ? patch.threshold : 5000,
                              nextDueAt: typeof patch.nextDueAt === 'number' ? patch.nextDueAt : 0,
                              metric: 'km' as const,
                              warnBuffer: 500,
                            };
                            nf[realIdx] = { ...nf[realIdx], maintenanceItems: [...existing, newItem] };
                            setLocalFleet(nf);
                          };
                          return (
                            <div className="flex flex-col gap-2 bg-white border border-green-200 rounded p-2">
                              <div className="text-[10px] font-black uppercase tracking-widest text-green-800">Oil Changes / Maintenance (km)</div>
                              <div className="text-[10px] italic text-green-700/70">
                                Auto-tracked. Enter the initial "next due (km)" — until then it stays quiet (no warnings, no spawned tasks).
                              </div>
                              <div className="space-y-1.5">
                                {allItems.map((mi, miIdx) => {
                                  if ((mi.metric || 'hours') !== 'km') return null;
                                  const isUnlocked = !!nextDueUnlocked[mi.id];
                                  const buffer = typeof mi.warnBuffer === 'number' ? mi.warnBuffer : 500;
                                  // Unconfigured items (nextDueAt <= 0) stay
                                  // freely editable — there's no default to
                                  // protect yet, just the initial entry.
                                  const isUnconfigured = !mi.nextDueAt || mi.nextDueAt <= 0;
                                  return (
                                    <div key={mi.id} className="flex flex-wrap items-center gap-2 bg-green-50/50 border border-green-200 rounded p-2">
                                      <input
                                        type="text"
                                        placeholder="Name (e.g. Oil change)"
                                        value={mi.name}
                                        onChange={e => {
                                          const nf = [...localFleet];
                                          const items = [...(nf[realIdx].maintenanceItems || [])];
                                          items[miIdx] = { ...items[miIdx], name: e.target.value };
                                          nf[realIdx] = { ...nf[realIdx], maintenanceItems: items };
                                          setLocalFleet(nf);
                                        }}
                                        className="flex-1 min-w-[120px] border border-green-200 rounded p-1.5 text-xs font-bold bg-white"
                                      />
                                      <div className="flex items-center gap-1">
                                        <span className="text-[10px] font-bold text-green-900">Every</span>
                                        <input
                                          type="number"
                                          min={1}
                                          step={1}
                                          value={mi.threshold || ''}
                                          onChange={e => {
                                            const nf = [...localFleet];
                                            const items = [...(nf[realIdx].maintenanceItems || [])];
                                            items[miIdx] = { ...items[miIdx], threshold: Number(e.target.value) || 0 };
                                            nf[realIdx] = { ...nf[realIdx], maintenanceItems: items };
                                            setLocalFleet(nf);
                                          }}
                                          className="w-20 border border-green-200 rounded p-1 text-xs font-mono font-bold bg-white"
                                        />
                                        <span className="text-[10px] font-bold text-green-900">km</span>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <span className="text-[10px] font-bold text-green-900">Next due:</span>
                                        {(isUnlocked || isUnconfigured) ? (
                                          <input
                                            type="number"
                                            min={0}
                                            step={1}
                                            value={mi.nextDueAt || ''}
                                            placeholder="km"
                                            onChange={e => {
                                              const nf = [...localFleet];
                                              const items = [...(nf[realIdx].maintenanceItems || [])];
                                              items[miIdx] = { ...items[miIdx], nextDueAt: Number(e.target.value) || 0 };
                                              nf[realIdx] = { ...nf[realIdx], maintenanceItems: items };
                                              setLocalFleet(nf);
                                            }}
                                            className="w-24 border border-green-200 rounded p-1 text-xs font-mono font-bold bg-white"
                                          />
                                        ) : (
                                          <span className="text-[11px] font-mono font-bold text-green-900 bg-white border border-green-200 rounded px-2 py-1 min-w-[60px] text-center">{mi.nextDueAt}</span>
                                        )}
                                        <span className="text-[10px] font-bold text-green-900">km</span>
                                        {!isUnconfigured && (
                                          <button
                                            type="button"
                                            onClick={() => setNextDueUnlocked(prev => ({ ...prev, [mi.id]: !prev[mi.id] }))}
                                            className="text-[10px] font-black uppercase tracking-widest text-emerald-700 hover:text-emerald-900 px-1"
                                            title={isUnlocked ? 'Lock the default' : 'Override the default'}
                                          >
                                            {isUnlocked ? 'Lock' : 'Edit'}
                                          </button>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <span className="text-[10px] font-bold text-green-900">Warn</span>
                                        <input
                                          type="number"
                                          min={0}
                                          step={1}
                                          value={buffer}
                                          onChange={e => {
                                            const nf = [...localFleet];
                                            const items = [...(nf[realIdx].maintenanceItems || [])];
                                            items[miIdx] = { ...items[miIdx], warnBuffer: Number(e.target.value) || 0 };
                                            nf[realIdx] = { ...nf[realIdx], maintenanceItems: items };
                                            setLocalFleet(nf);
                                          }}
                                          className="w-16 border border-green-200 rounded p-1 text-xs font-mono font-bold bg-white"
                                        />
                                        <span className="text-[10px] font-bold text-green-900">km before</span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const nf = [...localFleet];
                                          const items = (nf[realIdx].maintenanceItems || []).filter((_, i) => i !== miIdx);
                                          nf[realIdx] = { ...nf[realIdx], maintenanceItems: items };
                                          setLocalFleet(nf);
                                        }}
                                        className="text-rose-400 hover:text-rose-600 p-1 ml-auto"
                                        title="Remove this item"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  );
                                })}
                                {showPlaceholder && (
                                  <div className="flex flex-wrap items-center gap-2 bg-amber-50/40 border border-amber-200 rounded p-2">
                                    <input
                                      type="text"
                                      placeholder="Name"
                                      value="Oil change"
                                      onChange={e => materialiseFromPlaceholder({ name: e.target.value })}
                                      className="flex-1 min-w-[120px] border border-amber-200 rounded p-1.5 text-xs font-bold bg-white"
                                    />
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px] font-bold text-green-900">Every</span>
                                      <input
                                        type="number"
                                        min={1}
                                        step={1}
                                        value={5000}
                                        onChange={e => materialiseFromPlaceholder({ threshold: Number(e.target.value) || 5000 })}
                                        className="w-20 border border-amber-200 rounded p-1 text-xs font-mono font-bold bg-white"
                                      />
                                      <span className="text-[10px] font-bold text-green-900">km</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px] font-bold text-green-900">Set next due:</span>
                                      <input
                                        type="number"
                                        min={0}
                                        step={1}
                                        value=""
                                        placeholder="km"
                                        onChange={e => {
                                          const v = Number(e.target.value);
                                          if (!Number.isFinite(v) || v <= 0) return;
                                          materialiseFromPlaceholder({ nextDueAt: v });
                                        }}
                                        className="w-24 border border-amber-200 rounded p-1 text-xs font-mono font-bold bg-white"
                                      />
                                      <span className="text-[10px] font-bold text-green-900">km</span>
                                    </div>
                                    <span className="text-[10px] font-bold text-amber-700 uppercase tracking-widest">Not yet configured</span>
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const nf = [...localFleet];
                                  const existing = nf[realIdx].maintenanceItems || [];
                                  const kmCount = existing.filter(mi => (mi.metric || 'hours') === 'km').length;
                                  const newItem = {
                                    id: `mi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                                    name: kmCount === 0 ? 'Oil change' : '',
                                    threshold: kmCount === 0 ? 5000 : 0,
                                    nextDueAt: 0,
                                    metric: 'km' as const,
                                    warnBuffer: 500,
                                  };
                                  nf[realIdx] = { ...nf[realIdx], maintenanceItems: [...existing, newItem] };
                                  setLocalFleet(nf);
                                }}
                                className="text-[10px] font-black uppercase tracking-widest self-start inline-flex items-center gap-1 text-green-700 hover:text-green-900"
                                title="Add a maintenance item"
                              >
                                <Plus className="w-3 h-3" /> Add maintenance item
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                    {/* Equipment Time Off — mirrors the Personnel
                        Scheduled Time Off editor, just on fleet.
                        Full-day inclusive ranges only (no partial
                        variant). Saving auto-removes the unit from
                        any crew assignments on those dates; the
                        scheduling availability check returns
                        booked_off (reason: service) on these days. */}
                    <div className="flex flex-col gap-3 bg-orange-50/50 p-3 rounded-lg border border-orange-100 mt-1">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-xs font-bold text-orange-800 uppercase flex items-center gap-1.5">
                          <CalendarIcon className="w-3.5 h-3.5" /> Equipment Time Off
                        </span>
                        <button
                          onClick={() => {
                            const nf = [...localFleet];
                            if (!nf[realIdx].awayDates) nf[realIdx].awayDates = [];
                            nf[realIdx].awayDates!.push({ start: '', end: '' });
                            setLocalFleet(nf);
                          }}
                          className="text-xs font-bold text-orange-700 hover:bg-orange-200 bg-orange-100 border border-orange-200 px-2 py-1 rounded"
                          title="Add a service / maintenance / out-of-rotation window"
                        >+ Add Range</button>
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="text-[10px] font-black uppercase tracking-widest text-orange-700/80 pl-1">Scheduled</div>
                        {(!f.awayDates || f.awayDates.length === 0)
                          ? <div className="text-xs text-orange-600/60 italic font-medium pl-1">No time off scheduled.</div>
                          : <div className="space-y-2">{f.awayDates.map((range, dIdx) => (
                              <div key={dIdx} className="flex items-center gap-3 bg-white p-1.5 rounded-lg border border-orange-200 shadow-sm w-fit">
                                <input
                                  type="date"
                                  className="border-none bg-transparent outline-none p-1 text-sm font-bold text-gray-700"
                                  value={range.start || ''}
                                  onChange={e => {
                                    const nf = [...localFleet];
                                    nf[realIdx].awayDates![dIdx].start = e.target.value;
                                    setLocalFleet(nf);
                                  }}
                                />
                                <span className="text-sm font-bold text-orange-400">to</span>
                                <input
                                  type="date"
                                  className="border-none bg-transparent outline-none p-1 text-sm font-bold text-gray-700"
                                  value={range.end || ''}
                                  onChange={e => {
                                    const nf = [...localFleet];
                                    nf[realIdx].awayDates![dIdx].end = e.target.value;
                                    setLocalFleet(nf);
                                  }}
                                />
                                <button
                                  onClick={() => {
                                    const nf = [...localFleet];
                                    nf[realIdx].awayDates!.splice(dIdx, 1);
                                    setLocalFleet(nf);
                                  }}
                                  className="text-red-400 hover:bg-red-50 p-1.5 rounded ml-2"
                                  title="Remove this range"
                                ><X className="w-3.5 h-3.5" /></button>
                              </div>
                            ))}</div>}
                      </div>
                    </div>
                  </div>
                )
              })}
              <button onClick={() => {
                const newType: FleetItem['type'] = (fleetFilter === 'truck' || fleetFilter === 'trailer' || fleetFilter === 'tractor' || fleetFilter === 'equipment') ? fleetFilter : 'equipment';
                // Suggest the next available unit # within the category.
                const usedNumbers = new Set(
                  localFleet
                    .filter(x => x.type === newType && typeof x.unitNumber === 'number')
                    .map(x => x.unitNumber as number),
                );
                let nextUnit = 1;
                while (usedNumbers.has(nextUnit)) nextUnit++;
                setLocalFleet([...localFleet, { id: `f-${Date.now()}`, name: '', type: newType, unitNumber: nextUnit, status: 'Active', weightClass: 'N/A', regExpiry: '', safetyExpiry: '', odometer: 0, lastOdometerUpdate: '', isRental: false, rentalEnd: '', repairTags: [] }]);
              }} className="w-full py-4 border-2 border-dashed border-green-300 text-green-600 rounded-xl font-bold hover:bg-green-50 transition-colors flex items-center justify-center gap-2"><Plus className="w-5 h-5" /> Add {fleetFilter === 'truck' ? 'Truck' : fleetFilter === 'trailer' ? 'Trailer' : fleetFilter === 'tractor' ? 'Tractor' : fleetFilter === 'equipment' ? 'Equipment' : 'Fleet/Equipment'}</button>
            </div>
          )}

          {manageTab === 'equipmentSubtypes' && isAdmin && (
            <EquipmentSubtypesPanel
              subtypes={localEquipmentSubtypes}
              setSubtypes={setLocalEquipmentSubtypes}
              localFleet={localFleet}
              setLocalFleet={setLocalFleet}
              showToastMsg={showToastMsg}
            />
          )}

          {manageTab === 'inventory' && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 p-5 rounded-xl flex items-start gap-4 shadow-sm">
                <Package className="w-8 h-8 text-emerald-600 shrink-0" />
                <div>
                  <h3 className="font-bold text-emerald-900 text-lg">InventoryMaster System</h3>
                  <p className="text-emerald-800 text-sm mt-1 leading-relaxed">Add supplies and materials here. When crews are assigned these items on the Schedule Board, stock will dynamically decrease. Perform an Audit to reset the current stock level. Items not audited in 14 days will show a warning.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {localInventory.map((inv, idx) => {
                  const isAuditDue = needsAudit(inv.lastAudit);
                  return (
                    <div key={inv.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                      {isAuditDue && <div className="bg-rose-500 text-white text-[10px] font-black uppercase tracking-widest text-center py-1 flex items-center justify-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Audit Overdue</div>}
                      <div className="p-4 flex-1 flex flex-col gap-3">
                        <div>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Item Name</span>
                          <input className="w-full font-bold text-lg text-slate-800 border-b border-dashed border-slate-300 outline-none focus:border-emerald-500 py-1" value={inv.name} onChange={e => { const ni = [...localInventory]; ni[idx].name = e.target.value; setLocalInventory(ni); }} />
                        </div>
                        <div className="flex gap-3">
                          <div className="flex-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Current Stock</span>
                            <div className="flex items-center gap-2 mt-1">
                              <input type="number" className="w-20 font-mono font-black text-xl text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-1.5 outline-none text-center" value={inv.stock} onChange={e => { const ni = [...localInventory]; ni[idx].stock = Number(e.target.value); setLocalInventory(ni); }} />
                              <select className="border border-slate-200 rounded p-1.5 text-xs font-bold text-slate-600 bg-slate-50 outline-none" value={inv.unit} onChange={e => { const ni = [...localInventory]; ni[idx].unit = e.target.value; setLocalInventory(ni); }}>
                                <option value="Bags">Bags</option><option value="Bottles">Bottles</option><option value="Yards">Yards</option><option value="Units">Units</option>
                              </select>
                            </div>
                          </div>
                        </div>
                        <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between">
                          <div className="text-[10px] font-bold text-slate-400">Last Audit: <span className="text-slate-600">{inv.lastAudit || 'Never'}</span></div>
                          <div className="flex gap-2">
                            <button onClick={() => { const ni = [...localInventory]; ni[idx].lastAudit = formatDate(new Date()); setLocalInventory(ni); showToastMsg(`${inv.name} audited!`); }} className="bg-slate-100 hover:bg-emerald-100 text-slate-600 hover:text-emerald-700 text-xs font-bold px-3 py-1.5 rounded transition-colors flex items-center gap-1"><CheckSquare className="w-3.5 h-3.5" /> Audit Now</button>
                            <button onClick={() => setLocalInventory(localInventory.filter(i => i.id !== inv.id))} className="text-red-400 hover:text-red-600 p-1.5"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <button onClick={() => setLocalInventory([...localInventory, { id: `inv-${Date.now()}`, name: 'New Material', unit: 'Units', stock: 0, lastAudit: formatDate(new Date()) }])} className="min-h-[200px] border-2 border-dashed border-emerald-300 text-emerald-600 rounded-xl font-bold hover:bg-emerald-50 transition-colors flex flex-col items-center justify-center gap-2"><Plus className="w-8 h-8" /><br />Add Inventory Item</button>
              </div>
            </div>
          )}

          {manageTab === 'supplies' && (
            <div className="space-y-4 max-w-2xl">
              <div className="bg-slate-50 border border-slate-200 p-5 rounded-xl flex items-start gap-4 shadow-sm">
                <Hammer className="w-8 h-8 text-slate-600 shrink-0" />
                <div>
                  <h3 className="font-bold text-slate-900 text-lg">Supplies & Tools Catalog</h3>
                  <p className="text-slate-600 text-sm mt-1 leading-relaxed">List standard equipment like Blowers, Trimmers, or Rakes here. You can then assign these to specific crews on the Schedule Board to track exactly what gear each team is carrying.</p>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
                {localSupplies.map((item, sIdx) => (
                  <div key={sIdx} className="p-3 flex items-center gap-4">
                    <input className="flex-1 border border-slate-200 rounded-lg p-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-slate-400" value={item} onChange={e => { const ns = [...localSupplies]; ns[sIdx] = e.target.value; setLocalSupplies(ns); }} />
                    <button onClick={() => setLocalSupplies(localSupplies.filter((_, i) => i !== sIdx))} className="text-red-400 hover:bg-red-50 p-2 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
              <button onClick={() => setLocalSupplies([...localSupplies, 'New Tool/Supply'])} className="w-full py-4 border-2 border-dashed border-slate-300 text-slate-500 rounded-xl font-bold hover:bg-slate-100 transition-colors flex items-center justify-center gap-2"><Plus className="w-5 h-5" /> Add to Catalog</button>
            </div>
          )}

          {manageTab === 'routes' && (
            <div className="space-y-3">
              <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm p-4 rounded-xl flex items-start gap-3 shadow-sm">
                <MapIcon className="w-6 h-6 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-lg">Route Database Setup</p>
                  <p className="mt-1 font-medium">Define your recurring lawns and properties here. Assign them to a specific Division and Crew, and select their frequency (Weekly or staggered Bi-Weekly). Managers can instantly pull these into their daily logs from the Performance Board.</p>
                </div>
              </div>
              {localRoutes.map((route, idx) => (
                <div key={route.id} className="flex flex-col lg:flex-row gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm items-center">
                  <div className="w-full lg:w-1/3 flex flex-col gap-1.5">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Property Name</span>
                    <input className="w-full border border-slate-300 rounded-lg p-2 text-sm font-bold text-slate-800 outline-none focus:border-green-500" placeholder="e.g. 123 Main St" value={route.name} onChange={e => { const nr = [...localRoutes]; nr[idx].name = e.target.value; setLocalRoutes(nr); }} />
                  </div>
                  <div className="w-full lg:w-24 flex flex-col gap-1.5">
                    <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">BH (Hours)</span>
                    <input type="number" step="0.1" className="w-full border border-emerald-300 bg-emerald-50 rounded-lg p-2 text-sm font-mono font-bold text-emerald-800 outline-none" value={route.bh} onChange={e => { const nr = [...localRoutes]; nr[idx].bh = Number(e.target.value); setLocalRoutes(nr); }} />
                  </div>
                  <div className="w-full lg:flex-1 flex flex-col gap-1.5">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Assigned Crew</span>
                    <div className="flex gap-2">
                      <select className="flex-1 border border-slate-300 rounded-lg p-2 text-sm font-bold bg-slate-50 outline-none" value={route.division} onChange={e => { const nr = [...localRoutes]; nr[idx].division = e.target.value; setLocalRoutes(nr); }}>
                        {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <select className="w-20 border border-slate-300 rounded-lg p-2 text-sm font-bold bg-slate-50 outline-none" value={route.crewNumber} onChange={e => { const nr = [...localRoutes]; nr[idx].crewNumber = Number(e.target.value); setLocalRoutes(nr); }}>
                        {CREW_NUMBERS.map(n => <option key={n} value={n}>#{n}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="w-full lg:w-36 flex flex-col gap-1.5">
                    <span className="text-[10px] font-black text-green-600 uppercase tracking-widest">Frequency</span>
                    <select className="w-full border border-green-200 bg-green-50 text-green-800 rounded-lg p-2 text-sm font-bold outline-none" value={route.frequency} onChange={e => { const nr = [...localRoutes]; nr[idx].frequency = e.target.value; setLocalRoutes(nr); }}>
                      {ROUTE_FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div className="w-full lg:w-36 flex flex-col gap-1.5">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Target Day</span>
                    <select className="w-full border border-slate-300 rounded-lg p-2 text-sm font-bold bg-white outline-none" value={route.targetDay} onChange={e => { const nr = [...localRoutes]; nr[idx].targetDay = e.target.value; setLocalRoutes(nr); }}>
                      {DAYS_OF_WEEK.map(day => <option key={day} value={day}>{day}</option>)}
                    </select>
                  </div>
                  <button onClick={() => setLocalRoutes(localRoutes.filter(r => r.id !== route.id))} className="text-red-400 p-2 hover:bg-red-50 rounded-lg transition-colors mt-auto lg:mb-1"><Trash2 className="w-5 h-5" /></button>
                </div>
              ))}
              <button onClick={() => setLocalRoutes([...localRoutes, { id: `r-${Date.now()}`, name: '', bh: 1.0, division: 'Lawn Division', crewNumber: 1, frequency: 'Weekly', targetDay: 'Monday' }])} className="w-full py-4 border-2 border-dashed border-emerald-400 text-emerald-600 rounded-xl font-bold hover:bg-emerald-50 transition-colors flex justify-center items-center gap-2"><Plus className="w-5 h-5" /> Add New Route</button>
            </div>
          )}

          {manageTab === 'permissions' && isAdmin && (() => {
            const ROLES: { value: UserRole; label: string }[] = [
              { value: 'admin', label: 'Admin' },
              { value: 'manager', label: 'Manager' },
              { value: 'foreman', label: 'Foreman' },
              { value: 'worker', label: 'Worker' },
              { value: 'mechanic', label: 'Mechanic' },
            ];
            const GROUPS: { title: string; keys: Permission[] }[] = [
              { title: 'Schedule', keys: ['canCreateCrews','canEditAnyCrew','canDispatchAnyCrew','canDeleteCrews','canCopyDay','canCloseOutCrew','canOverrideWarnings','canEditOwnCrew','canDispatchOwnCrew','canCloseOutOwnCrew'] },
              { title: 'Mechanic', keys: ['canViewMechanicMaster','canCreateRepairs','canEditRepairs','canCompleteRepairs','canDeleteRepairs','canAddTaskNotes'] },
              { title: 'Performance', keys: ['canViewPerformance','canEditAnyPerformance','canApprovePerformance','canAddUnscheduledCrew','canAddDeductions','canEditOwnPerformance','canAddDeductionsOwnCrew','canViewAdvancedReports'] },
              { title: 'TimeMaster', keys: ['canClockInOut','canViewOwnTimeMaster','canViewAllTimeMaster','canEditAnyTimeEntry','canExportTimeCSV'] },
              { title: 'Bulletins', keys: ['canViewBulletins','canPostBulletins','canDeleteBulletins','canUseAIInsight'] },
              { title: 'Resources', keys: ['canViewManageResources','canEditPersonnel','canEditFleet','canDeleteFleet','canEditInventory','canEditAppSettings'] },
              { title: 'Inspections', keys: ['canSubmitInspections','canViewInspectionLog','canViewAllInspections','canPrintInspections'] },
            ];
            const permLabel = (k: string) => k.replace(/^can/, '').replace(/([A-Z])/g, ' $1').trim();
            const effectiveValue = (role: UserRole, key: Permission): boolean => {
              if (role === 'admin') return true;
              const overridden = localPermissions[role]?.[key];
              if (typeof overridden === 'boolean') return overridden;
              return Boolean(ROLE_PERMISSIONS[role]?.[key]);
            };
            const setRolePerm = (role: UserRole, key: Permission, value: boolean) => {
              setLocalPermissions(prev => {
                const next: RolePermissionsOverride = { ...prev };
                const roleMap = { ...(next[role] || {}) };
                const hardcoded = Boolean(ROLE_PERMISSIONS[role]?.[key]);
                if (value === hardcoded) {
                  delete roleMap[key];
                } else {
                  roleMap[key] = value;
                }
                if (Object.keys(roleMap).length === 0) {
                  delete next[role];
                } else {
                  next[role] = roleMap;
                }
                return next;
              });
            };
            const handleToggle = (role: UserRole, key: Permission, currentValue: boolean) => {
              const nextValue = !currentValue;
              if (role !== 'admin' && currentValue && !nextValue) {
                const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
                if (!confirm(`${roleLabel} will no longer be able to ${permLabel(key)}. Continue?`)) return;
              }
              setRolePerm(role, key, nextValue);
            };
            const resetToDefaults = () => {
              if (!confirm('Reset all role permissions to defaults? This will undo all your customizations.')) return;
              setLocalPermissions({});
              showToastMsg('Permissions reset to defaults — Save to apply.');
            };

            return (
              <div className="space-y-4">
                <div className="bg-lime-50 border border-lime-200 p-5 rounded-xl flex items-start justify-between gap-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="w-7 h-7 text-lime-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-lime-900 text-lg">Role Permissions</h4>
                      <p className="text-lime-800 text-sm mt-1 leading-relaxed">Customize what each role can do. Changes apply immediately after Save. Admin always has every permission.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={resetToDefaults}
                    className="text-[10px] font-black uppercase tracking-widest text-lime-700 hover:text-lime-900 underline shrink-0"
                  >
                    Reset to Defaults
                  </button>
                </div>

                <div className="md:hidden bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <p className="text-xs font-bold text-amber-800">Best viewed on desktop. Pinch to zoom or scroll horizontally.</p>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
                  <table className="w-full min-w-[640px] text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500 sticky top-0">
                        <th className="px-4 py-3">Permission</th>
                        {ROLES.map(r => (
                          <th key={r.value} className="px-3 py-3 text-center">
                            {r.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {GROUPS.map(group => (
                        <React.Fragment key={group.title}>
                          <tr className="bg-slate-100/60 border-y border-slate-200">
                            <td colSpan={1 + ROLES.length} className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                              {group.title}
                            </td>
                          </tr>
                          {group.keys.map(key => (
                            <tr key={key} className="border-b border-slate-100 hover:bg-slate-50/50">
                              <td className="px-4 py-2.5 text-sm font-bold text-slate-700">{permLabel(key)}</td>
                              {ROLES.map(r => {
                                const current = effectiveValue(r.value, key);
                                const isAdminCol = r.value === 'admin';
                                const isOverridden = !isAdminCol && typeof localPermissions[r.value]?.[key] === 'boolean';
                                return (
                                  <td key={r.value} className="px-3 py-2.5 text-center relative">
                                    <input
                                      type="checkbox"
                                      checked={current}
                                      disabled={isAdminCol}
                                      onChange={() => handleToggle(r.value, key, current)}
                                      className="w-4 h-4 rounded border-slate-300 text-lime-600 focus:ring-lime-500 disabled:opacity-60 disabled:cursor-not-allowed"
                                      title={isAdminCol ? 'Admin always has every permission' : (isOverridden ? 'Customized — click to toggle' : 'Default value — click to override')}
                                    />
                                    {isOverridden && (
                                      <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-lime-500" title="Customized" />
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-[11px] text-slate-500 italic px-1">
                  Cells with a green dot are customized. Click any non-admin checkbox to override. Click again to return to default. Save All Changes to apply.
                </p>
              </div>
            );
          })()}

          {manageTab === 'authorized' && isAdmin && (
            <AuthorizedEmailsPanel
              emails={localAdmins}
              setEmails={setLocalAdmins}
              employees={localEmployees}
              showToastMsg={showToastMsg}
            />
          )}

          {manageTab === 'settings' && (
            <div className="space-y-6 max-w-3xl">
              <div className="bg-slate-50 border border-slate-200 p-5 rounded-xl flex items-start gap-4">
                <Sliders className="w-7 h-7 text-slate-700 shrink-0" />
                <div>
                  <h4 className="font-bold text-slate-900 text-lg">App Settings</h4>
                  <p className="text-slate-600 text-sm mt-1 leading-relaxed">Global behaviors that affect everyone using the app. {isAdmin ? 'You are an admin — fields are editable.' : 'Read-only — only admins can change these.'}</p>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-2">End-of-Day Reminder</label>
                  <p className="text-xs text-slate-500 mb-2">Shown to crews when they close out for the day. Keep it short and actionable.</p>
                  <textarea
                    rows={3}
                    value={localSettings.endOfDayReminder ?? ''}
                    placeholder={DEFAULT_EOD_REMINDER}
                    disabled={!isAdmin}
                    onChange={e => setLocalSettings({ ...localSettings, endOfDayReminder: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm font-medium outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-60 disabled:cursor-not-allowed resize-none"
                  />
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setLocalSettings({ ...localSettings, endOfDayReminder: DEFAULT_EOD_REMINDER })}
                      className="mt-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800"
                    >
                      Reset to default
                    </button>
                  )}
                </div>
              </div>

              {/* Crew-size efficiency allowance — additive bracket applied
                  to a crew's raw efficiency to correct for bigger-crew
                  drive/coordination overhead. The sync stamps each
                  crew-day with the CURRENT table values; past days that
                  were already stamped won't change when this table is
                  retuned. */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Crew-Size Efficiency Allowance</label>
                <p className="text-xs text-slate-500 mb-3">
                  Additive % added to a crew's raw efficiency based on the SCHEDULED roster size. Drop-in helpers don't count toward the bracket. Editing the table affects future syncs only — past stamped days keep their values.
                </p>
                <div className="space-y-2">
                  {(localSettings.crewSizeAllowance && localSettings.crewSizeAllowance.length > 0
                    ? localSettings.crewSizeAllowance
                    : DEFAULT_CREW_SIZE_ALLOWANCE).map((row, idx, rows) => (
                    <div key={idx} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 w-16">Size ≥</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={row.minSize}
                        disabled={!isAdmin}
                        onChange={e => {
                          const v = Number(e.target.value);
                          if (!Number.isFinite(v)) return;
                          const next = [...rows];
                          next[idx] = { ...next[idx], minSize: v };
                          setLocalSettings({ ...localSettings, crewSizeAllowance: next });
                        }}
                        className="w-16 border border-slate-300 rounded p-1 text-sm font-mono font-bold bg-white outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 w-16 text-right">Pct +</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={row.pct}
                        disabled={!isAdmin}
                        onChange={e => {
                          const v = Number(e.target.value);
                          if (!Number.isFinite(v)) return;
                          const next = [...rows];
                          next[idx] = { ...next[idx], pct: v };
                          setLocalSettings({ ...localSettings, crewSizeAllowance: next });
                        }}
                        className="w-16 border border-slate-300 rounded p-1 text-sm font-mono font-bold bg-white outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                      <span className="text-xs text-slate-500">%</span>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = rows.filter((_, i) => i !== idx);
                            setLocalSettings({ ...localSettings, crewSizeAllowance: next });
                          }}
                          className="ml-auto text-rose-400 hover:text-rose-600 p-1"
                          title="Remove this row"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-3 mt-3">
                    <button
                      type="button"
                      onClick={() => {
                        const current = localSettings.crewSizeAllowance && localSettings.crewSizeAllowance.length > 0
                          ? localSettings.crewSizeAllowance
                          : DEFAULT_CREW_SIZE_ALLOWANCE;
                        const next = [...current, { minSize: current[current.length - 1]?.minSize + 1 || 1, pct: 0 }];
                        setLocalSettings({ ...localSettings, crewSizeAllowance: next });
                      }}
                      className="text-[10px] font-black uppercase tracking-widest text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 border border-slate-300 rounded px-2 py-1"
                    >
                      <Plus className="w-3 h-3" /> Add row
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocalSettings({ ...localSettings, crewSizeAllowance: DEFAULT_CREW_SIZE_ALLOWANCE.slice() })}
                      className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800"
                    >
                      Reset to default
                    </button>
                  </div>
                )}
              </div>

              {isAdmin && (
                <div className="bg-white rounded-xl border border-amber-200 p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-amber-700">Dev / Phase 1 Verification</div>
                      <p className="text-xs text-slate-500 mt-1">Calls the deployed <code className="bg-slate-100 px-1 rounded">helloJobber</code> Cloud Function and toasts the response. Remove after Phase 1 wraps.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const callHello = httpsCallable<unknown, { message: string; timestamp: string }>(functions, 'helloJobber');
                        const result = await callHello({});
                        const data = result.data;
                        showToastMsg(`${data.message} · ${data.timestamp}`);
                      } catch (err: any) {
                        const msg = err?.message || String(err);
                        showToastMsg(`helloJobber failed: ${msg}`);
                      }
                    }}
                    className="px-4 py-2 text-xs font-black uppercase tracking-widest bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow"
                  >
                    Call helloJobber
                  </button>
                </div>
              )}

              {canManageJobber && (
                <div className="bg-white rounded-xl border border-lime-200 p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-start gap-3">
                      <Link2 className="w-5 h-5 text-lime-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-widest text-lime-700">Jobber Integration</div>
                        <p className="text-xs text-slate-500 mt-1">
                          {jobberAuth
                            ? 'CrewMaster is connected to your Jobber account. Read-only access to clients, jobs, scheduled items, users, and timesheets.'
                            : 'Connect CrewMaster to your Jobber account to begin syncing clients, jobs, and timesheets.'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {jobberAuth ? (
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="text-xs text-slate-700">
                        Connected{jobberAuth.accountName ? ` as ${jobberAuth.accountName}` : ''}
                        {jobberAuth.connectedAt ? ` since ${formatDate(new Date(jobberAuth.connectedAt))}` : ''}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          disabled={jobberBusy}
                          onClick={async () => {
                            setJobberBusy(true);
                            try {
                              const sync = httpsCallable<unknown, { count: number; lastSyncedAt: number }>(functions, 'jobberSyncUsers');
                              const result = await sync({});
                              const { count, lastSyncedAt } = result.data;
                              showToastMsg(`Synced ${count} Jobber user${count === 1 ? '' : 's'} at ${new Date(lastSyncedAt).toLocaleTimeString()}.`);
                            } catch (err: any) {
                              showToastMsg(`Sync failed: ${err?.message || String(err)}`);
                            } finally {
                              setJobberBusy(false);
                            }
                          }}
                          className="px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-lime-700 hover:text-white hover:bg-lime-600 border border-lime-300 rounded-lg disabled:opacity-50"
                        >
                          {jobberBusy ? 'Working…' : 'Refresh Jobber Users'}
                        </button>
                        <button
                          type="button"
                          disabled={jobberBusy}
                          onClick={async () => {
                            if (!window.confirm('Disconnect from Jobber? CrewMaster will stop syncing until you reconnect.')) return;
                            setJobberBusy(true);
                            try {
                              await deleteDoc(doc(db, 'artifacts', appId, 'private', 'data', 'jobberAuth', 'main'));
                              showToastMsg('Disconnected from Jobber.');
                            } catch (err: any) {
                              showToastMsg(`Disconnect failed: ${err?.message || String(err)}`);
                            } finally {
                              setJobberBusy(false);
                            }
                          }}
                          className="px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-slate-600 hover:text-rose-700 border border-slate-200 hover:border-rose-300 rounded-lg disabled:opacity-50"
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={jobberBusy}
                      onClick={async () => {
                        setJobberBusy(true);
                        try {
                          const start = httpsCallable<unknown, { url: string }>(functions, 'jobberOAuthStart');
                          const result = await start({});
                          const url = result.data?.url;
                          if (!url) throw new Error('No URL returned by jobberOAuthStart.');
                          window.open(url, '_blank', 'noopener,noreferrer');
                          showToastMsg('Approval window opened — complete the flow in the new tab.');
                        } catch (err: any) {
                          showToastMsg(`Connect failed: ${err?.message || String(err)}`);
                        } finally {
                          setJobberBusy(false);
                        }
                      }}
                      className="px-4 py-2 text-xs font-black uppercase tracking-widest bg-lime-600 hover:bg-lime-700 text-white rounded-lg shadow disabled:opacity-50"
                    >
                      {jobberBusy ? 'Opening…' : 'Connect to Jobber'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 bg-white flex justify-end gap-4 shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
          <button onClick={onClose} className="px-6 py-2.5 font-bold text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
          <button
            onClick={() => {
              const seen = new Set<string>();
              for (const e of localEmployees) {
                const key = (e.linkedUserEmail || '').trim().toLowerCase();
                if (!key) continue;
                if (seen.has(key)) {
                  showToastMsg(`Duplicate linked email: ${key}. Each email can link to only one employee.`);
                  return;
                }
                seen.add(key);
              }
              onSave();
            }}
            className="px-8 py-2.5 font-bold text-white bg-green-600 hover:bg-green-700 rounded-lg shadow transition-colors"
          >Save All Changes</button>
        </div>
      </div>
    </div>
  );
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AuthorizedEmailsPanelProps {
  emails: string[];
  setEmails: Dispatch<SetStateAction<string[]>>;
  employees: Employee[];
  showToastMsg: (msg: string) => void;
}

function AuthorizedEmailsPanel({ emails, setEmails, employees, showToastMsg }: AuthorizedEmailsPanelProps) {
  const [draft, setDraft] = useState('');

  const normalized = useMemo(
    () => emails.map(e => (e || '').trim().toLowerCase()).filter(Boolean),
    [emails],
  );

  const addEmail = () => {
    const candidate = draft.trim().toLowerCase();
    if (!candidate) return;
    if (!EMAIL_RX.test(candidate)) {
      showToastMsg('Please enter a valid email address.');
      return;
    }
    if (normalized.includes(candidate)) {
      showToastMsg('That email is already authorized.');
      return;
    }
    setEmails([...normalized, candidate].sort());
    setDraft('');
  };

  const removeEmail = (e: string) => {
    setEmails(normalized.filter(x => x !== e));
  };

  // Employee linkage hint: show which employee a given email is linked to (if any)
  const linkedNameByEmail = useMemo(() => {
    const map = new Map<string, string>();
    employees.forEach(emp => {
      const ke = (emp.linkedUserEmail || '').trim().toLowerCase();
      if (ke) map.set(ke, emp.name);
    });
    return map;
  }, [employees]);

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="bg-rose-50 border border-rose-200 p-5 rounded-xl flex items-start gap-4">
        <Mail className="w-6 h-6 text-rose-500 shrink-0 mt-1" />
        <div>
          <h4 className="font-bold text-slate-800 mb-1">Authorized Emails</h4>
          <p className="text-slate-600 text-sm leading-relaxed">
            Only the emails on this list can sign in to CrewMaster. Adding an email here lets that person log in; removing it blocks them at next sign-in (or the next snapshot refresh, whichever comes first). Emails are stored lowercase. The super admin (marcoguidopalermo@gmail.com) is always allowed and does not need to be on this list.
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-2">Add an email</label>
        <div className="flex gap-2">
          <input
            type="email"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } }}
            placeholder="name@example.com"
            className="flex-1 min-h-[44px] border border-slate-300 rounded-lg px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-rose-300"
          />
          <button
            type="button"
            onClick={addEmail}
            disabled={!draft.trim()}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 text-sm font-black uppercase tracking-widest bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {normalized.length === 0 ? (
          <div className="p-6 text-center text-slate-400 italic text-sm">
            No emails authorized. Only the super admin can sign in until you add at least one.
          </div>
        ) : (
          normalized.map(email => (
            <div key={email} className="flex items-center justify-between gap-3 px-4 py-3 min-h-[48px]">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-slate-800 truncate">{email}</div>
                {linkedNameByEmail.has(email) && (
                  <div className="text-[11px] text-slate-500 truncate">Linked to: {linkedNameByEmail.get(email)}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeEmail(email)}
                aria-label={`Remove ${email}`}
                className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>

      <p className="text-[11px] text-slate-500 italic px-1">
        Changes apply when you press Save All Changes. Removed users stay signed in until their next auth-state check.
      </p>
    </div>
  );
}

interface EquipmentSubtypesPanelProps {
  subtypes: EquipmentSubtypeDefinition[];
  setSubtypes: Dispatch<SetStateAction<EquipmentSubtypeDefinition[]>>;
  localFleet: FleetItem[];
  setLocalFleet: Dispatch<SetStateAction<FleetItem[]>>;
  showToastMsg: (msg: string) => void;
}

function EquipmentSubtypesPanel({
  subtypes,
  setSubtypes,
  localFleet,
  setLocalFleet,
  showToastMsg,
}: EquipmentSubtypesPanelProps) {
  const sorted = useMemo(
    () => [...subtypes].sort((a, b) => a.sortOrder - b.sortOrder),
    [subtypes],
  );

  const usageCountById = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of localFleet) {
      if (f.type !== 'equipment' || !f.equipmentSubtype) continue;
      map.set(f.equipmentSubtype, (map.get(f.equipmentSubtype) || 0) + 1);
    }
    return map;
  }, [localFleet]);

  const move = (id: string, direction: 'up' | 'down') => {
    const idx = sorted.findIndex(s => s.id === id);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const reordered = [...sorted];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    // Re-stamp sortOrder based on new position.
    const renumbered = reordered.map((s, i) => ({ ...s, sortOrder: i + 1 }));
    setSubtypes(renumbered);
  };

  const rename = (id: string, newName: string) => {
    setSubtypes(prev => prev.map(s => s.id === id ? { ...s, name: newName } : s));
  };

  const add = () => {
    const trimmed = 'New Subtype';
    let id = makeSubtypeId(trimmed);
    let suffix = 2;
    while (subtypes.some(s => s.id === id)) {
      id = `${makeSubtypeId(trimmed)}_${suffix++}`;
    }
    const maxOrder = subtypes.reduce((m, s) => Math.max(m, s.sortOrder), 0);
    setSubtypes([...subtypes, { id, name: trimmed, sortOrder: maxOrder + 1 }]);
  };

  const remove = (id: string) => {
    const target = subtypes.find(s => s.id === id);
    if (!target) return;
    const count = usageCountById.get(id) || 0;
    const msg = count > 0
      ? `${count} fleet item${count === 1 ? '' : 's'} use "${target.name}". Delete anyway? They will show as "Uncategorized Equipment" until reassigned.`
      : `Delete "${target.name}"? This action cannot be undone.`;
    if (!window.confirm(msg)) return;
    setSubtypes(prev => prev.filter(s => s.id !== id));
    if (count > 0) {
      // Orphan affected fleet items by clearing their equipmentSubtype.
      setLocalFleet(prev => prev.map(f =>
        f.type === 'equipment' && f.equipmentSubtype === id
          ? { ...f, equipmentSubtype: undefined }
          : f,
      ));
      showToastMsg(`Removed "${target.name}". ${count} item${count === 1 ? '' : 's'} now uncategorized.`);
    } else {
      showToastMsg(`Removed "${target.name}".`);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="bg-sky-50 border border-sky-200 p-5 rounded-xl flex items-start gap-4">
        <Hammer className="w-6 h-6 text-sky-500 shrink-0 mt-1" />
        <div>
          <h4 className="font-bold text-slate-800 mb-1">Equipment Subtypes</h4>
          <p className="text-slate-600 text-sm leading-relaxed">
            These are the categories you can pick from when adding equipment in the Fleet & Equip tab. Reorder with the ↑ / ↓ buttons — the order here is the order items appear on the Schedule Board sidebar. Removing a subtype that's in use will mark those items as "Uncategorized Equipment" until you reassign them.
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {sorted.length === 0 ? (
          <div className="p-6 text-center text-slate-400 italic text-sm">
            No subtypes defined. Add at least one before you can add equipment items.
          </div>
        ) : (
          sorted.map((s, i) => {
            const usage = usageCountById.get(s.id) || 0;
            return (
              <div key={s.id} className="flex items-center gap-2 px-3 py-2 min-h-[48px]">
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => move(s.id, 'up')}
                    disabled={i === 0}
                    aria-label="Move up"
                    className="min-w-[28px] min-h-[20px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed text-xs font-black"
                  >▲</button>
                  <button
                    type="button"
                    onClick={() => move(s.id, 'down')}
                    disabled={i === sorted.length - 1}
                    aria-label="Move down"
                    className="min-w-[28px] min-h-[20px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed text-xs font-black"
                  >▼</button>
                </div>
                <input
                  type="text"
                  value={s.name}
                  onChange={e => rename(s.id, e.target.value)}
                  className="flex-1 min-h-[40px] border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-sky-300"
                />
                <span className="text-[11px] text-slate-500 font-medium shrink-0 w-20 text-right">
                  {usage === 0 ? 'unused' : `${usage} item${usage === 1 ? '' : 's'}`}
                </span>
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  aria-label={`Delete ${s.name}`}
                  className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center text-rose-400 hover:text-rose-700 hover:bg-rose-50 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })
        )}
      </div>

      <button
        type="button"
        onClick={add}
        className="w-full py-3 border-2 border-dashed border-sky-300 text-sky-600 rounded-xl font-bold hover:bg-sky-50 transition-colors flex items-center justify-center gap-2"
      >
        <Plus className="w-5 h-5" /> Add Subtype
      </button>

      <p className="text-[11px] text-slate-500 italic px-1">
        Changes apply when you press Save All Changes. Existing items keep their references because subtype IDs are stable across renames.
      </p>
    </div>
  );
}

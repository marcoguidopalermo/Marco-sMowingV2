import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  PenTool, List, LayoutDashboard, ClipboardList, Plus, AlertCircle,
  CheckCircle, CheckCircle2, Flame, Trash2, Save, X, Clock, AlertTriangle, Wrench,
  Activity, ChevronDown, ChevronUp, FileSignature, TrendingUp,
  BookOpen, UserPlus, Package, Camera
} from 'lucide-react';
import { AppData, FleetItem, MechanicTask, PartsOrder, StoredFile } from '../types';
import { deleteFile } from '../lib/storage';
import PhotoViewer from './PhotoViewer';
import { assigneesForTask, collaboratorNames, joinNames, shareForMechanic } from '../lib/workCredit';
import FleetGroupedList from './FleetGroupedList';
import { DocRenewalChip } from './FleetRenewalsStrip';
import { getUnitAttention } from '../lib/fleetGrouping';
import { personColor } from '../lib/personColor';
import { isExpiringSoon, isExpired, isOdoStale, formatTodayInToronto } from '../lib/dateUtils';
import { fleetItemLabel, needsPlateRenewal, needsCommercialSafety, weightBandLabel } from '../lib/fleetUtils';
import { isKmMaintenanceUnit, isHourMaintenanceUnit } from '../lib/maintenanceUtils';
import InspectionLog from './InspectionLog';
import ActivityLog from './ActivityLog';
import MechanicPerformance from './MechanicPerformance';

// Short, human-readable reported-date for the task card header.
// "2026-05-18" → "May 18" (drops the year for compactness on mobile);
// falls back to the raw value if the input doesn't parse.
function formatReportedDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Compact age badge for the scannable row: "today" / "3d" / "2w" / "3mo".
// Returns { label, aging } — aging flips true past 7 days so the row can
// render the age in an alarm color while the repair sits unresolved.
function repairAge(iso: string, today: string): { label: string; aging: boolean } {
  if (!iso) return { label: '', aging: false };
  const start = Date.parse(`${iso}T12:00:00Z`);
  const now = Date.parse(`${today}T12:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(now)) return { label: '', aging: false };
  const days = Math.max(0, Math.floor((now - start) / 86_400_000));
  const label = days === 0 ? 'today'
    : days < 14 ? `${days}d`
    : days < 60 ? `${Math.floor(days / 7)}w`
    : `${Math.floor(days / 30)}mo`;
  return { label, aging: days >= 7 };
}

// Completion timestamp is a full ISO string (date + time) from the
// 'completed' activity entry; this just renders "May 18" for the row.
function formatCompletedAt(ts: string | number | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface MechanicBoardProps {
  appData: AppData;
  fleet: FleetItem[];
  mechanicTasks: MechanicTask[];
  repairLog: any[];
  cvorExpiry: string | undefined;

  mechanicView: string;
  setMechanicView: Dispatch<SetStateAction<string>>;
  editingOdoId: string | null;
  setEditingOdoId: Dispatch<SetStateAction<string | null>>;
  tempOdo: string;
  setTempOdo: Dispatch<SetStateAction<string>>;

  onOpenManualTask: (preFillUnit?: FleetItem) => void;
  onCvorChange: (value: string) => void;
  onTaskDrop: (task: MechanicTask, newStatus: string) => void;
  onMoveForward: (taskId: string, currentStatus: string) => void;
  onDeleteTask: (taskId: string) => void;
  onSaveOdometer: (fleetId: string) => void;
  // Engine-hour entry on the Fleet List, parallel to the odometer
  // save. App.tsx runs the auto-spawn helper after the write to
  // surface any due/overdue maintenance schedules.
  onSaveEngineHours: (fleetId: string, newHours: number) => void;
  // Winterize / Reactivate toggle. App.tsx confirms with a dialog
  // before winterizing and cleans up active maintenance tasks for
  // the unit. Reactivate just flips the flag.
  onToggleWinterize: (fleetId: string) => void;
  // Out-of-band "this oil change happened in the field" path.
  // Updates the maintenance schedule + writes an Inspection Log
  // entry; clears any active spawned task for this item.
  // `valueAtService` is hours OR km depending on the item's metric.
  // `explicitNextDue` is required when the item is km-metric (the
  // mechanic-edited next-due target); ignored for hours.
  // `placeholderDefaults` upgrades the call to "upsert": when no
  // item with `itemId` exists, the handler creates one with the
  // supplied defaults (used by the truck Option A placeholder when
  // a mechanic configures its initial next-due from Fleet List).
  onManualResetMaintenance: (
    fleetId: string,
    itemId: string,
    valueAtService: number,
    notes?: string,
    explicitNextDue?: number,
    placeholderDefaults?: { name: string; threshold: number; metric: 'hours' | 'km' },
  ) => void;
  onViewInspection: (inspectionId: string) => void;
  onAssignTask: (taskId: string, assignedTo: { userEmail: string; userName: string } | null) => void;
  // Multi-mechanic assignment (no cap) — replaces the task's assignee
  // list. Used by the inline "Assign to me" affordance on each card.
  onSetAssignees: (taskId: string, assignees: Array<{ userEmail: string; userName: string }>) => void;
  currentUserEmail: string;
  currentUserName: string;
  isAdmin: boolean;
  canEditRepairs: boolean;
  canViewAllInspections: boolean;
  currentEmployeeId: string | null;
  onAddTaskNote: (taskId: string, text: string) => void;
  onDeleteTaskNote: (taskId: string, noteId: string) => void;
  onTogglePriority: (task: MechanicTask) => void;
  onToggleWaitingOnParts: (task: MechanicTask) => void;
  // Persist a task's photo metadata array (after a delete from the board).
  onSetTaskPhotos: (taskId: string, photos: StoredFile[]) => void;
  onOpenUnitHistory: (unit: FleetItem) => void;
  // Granular delete gates + handlers. Each one opens the shared
  // ConfirmDeleteModal at the App.tsx layer (deliberate-wording dialog
  // + audit-log write). MechanicBoard only renders the affordance and
  // forwards the id; the parent owns the actual mutation.
  canDeleteMechanicTask: boolean;
  canDeleteRepairLog: boolean;
  canDeleteInspectionLog: boolean;
  onDeleteRepairLog: (logId: string) => void;
  onDeleteInspectionLog: (inspectionId: string) => void;
  // Repair Board scope toggle:
  //   'mine' = tasks assigned to the current mechanic + unassigned;
  //           completed list narrows to tasks completed by them.
  //   'all'  = everything (legacy admin/manager behavior).
  // App.tsx picks the default per role — mechanic gets 'mine', everyone
  // else gets 'all'. The toggle in the header lets either party flip.
  defaultRepairFilter: 'all' | 'mine';
  // Row-tap → open the existing detail modal (MyMechanicTaskModal) hosted
  // at the App.tsx layer. Was previously only reachable from MyMechanic.
  onOpenTask: (taskId: string) => void;
  // Parts request workflow. App.tsx owns the modal mount + state-machine.
  // MechanicBoard just renders the entry points and the Parts Orders tab.
  partsOrders: Record<string, PartsOrder>;
  // Called from the top-of-board "Request Parts" button (no prefill) and
  // each card's green "Request Parts" button (prefill from the task).
  onOpenRequestParts: (preFill: { unitId?: string; unitName?: string; repairId?: string } | null) => void;
  // Sets a partsOrder to ANY of the three states (any direction —
  // forward or backward). App.tsx writes a statusHistory audit entry
  // and recomputes the linked task's partsStatus for the wrench icon.
  onChangePartsStatus: (orderId: string, newStatus: 'requested' | 'ordered' | 'arrived') => void;
  onDeletePartsOrder: (orderId: string) => void;
  // Visibility of the Parts Orders tab. Admin + manager see it.
  canViewPartsOrders: boolean;
  // Whether the user can change the parts-order status via the chip
  // dropdown. Admin/manager/mechanic only — workers/foremen see the
  // chip as a read-only badge.
  canChangePartsStatus: boolean;
  // Mark-paid bookkeeping (Pay Chunks panel). Forwarded straight to
  // MechanicPerformance; App.tsx owns the write + audit + admin gate.
  onMarkChunksPaid: (mechanicId: string, chunkIds: string[]) => void;
  onUnmarkChunkPaid: (mechanicId: string, chunkId: string) => void;
}

export default function MechanicBoard({
  appData,
  fleet,
  mechanicTasks,
  repairLog,
  cvorExpiry,
  mechanicView,
  setMechanicView,
  editingOdoId,
  setEditingOdoId,
  tempOdo,
  setTempOdo,
  onOpenManualTask,
  onCvorChange,
  onTaskDrop,
  onMoveForward,
  onDeleteTask,
  onSaveOdometer,
  onSaveEngineHours,
  onToggleWinterize,
  onManualResetMaintenance,
  onViewInspection,
  onAssignTask,
  onSetAssignees,
  currentUserEmail,
  currentUserName,
  isAdmin,
  canEditRepairs,
  canViewAllInspections,
  currentEmployeeId,
  onAddTaskNote,
  onDeleteTaskNote,
  onTogglePriority,
  onToggleWaitingOnParts,
  onSetTaskPhotos,
  onOpenUnitHistory,
  canDeleteMechanicTask,
  canDeleteRepairLog,
  canDeleteInspectionLog,
  onDeleteRepairLog,
  onDeleteInspectionLog,
  defaultRepairFilter,
  onOpenTask,
  partsOrders,
  onOpenRequestParts,
  onChangePartsStatus,
  onDeletePartsOrder,
  canViewPartsOrders,
  canChangePartsStatus,
  onMarkChunksPaid,
  onUnmarkChunkPaid,
}: MechanicBoardProps) {
  // Repair Board scope. Initialized from the caller-supplied default —
  // App.tsx sets 'mine' for mechanic role, 'all' otherwise. The user can
  // flip via the toggle in the Active section header.
  const [repairFilter, setRepairFilter] = useState<'all' | 'mine'>(defaultRepairFilter);
  // Which active repair row is expanded inline (accordion — one at a time).
  // Compact rows keep 8+ repairs scannable on a phone; the tap reveals the
  // description + quick actions (priority / parts / assign) + a link to the
  // full detail modal. Null = all collapsed.
  const [expandedRepairId, setExpandedRepairId] = useState<string | null>(null);
  // Full-screen photo viewer (repair photos). Null when closed.
  const [photoViewer, setPhotoViewer] = useState<{ files: StoredFile[]; idx: number } | null>(null);
  // Which Parts Orders row's status-chip dropdown is currently open.
  // Null when no menu is open. The chip is rendered as a button when
  // canChangePartsStatus is true; clicking it sets this id and renders
  // the three-option dropdown anchored to that chip. Outside-click
  // (mousedown anywhere not on the chip/menu) clears it.
  const [openStatusMenuOrderId, setOpenStatusMenuOrderId] = useState<string | null>(null);
  useEffect(() => {
    if (!openStatusMenuOrderId) return;
    const handler = () => setOpenStatusMenuOrderId(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openStatusMenuOrderId]);
  const [bannerCriticalOpen, setBannerCriticalOpen] = useState(false);
  const [bannerWarningOpen, setBannerWarningOpen] = useState(false);
  const [highlightedFleetId, setHighlightedFleetId] = useState<string | null>(null);
  // Inline-edit state for the engine-hours cell (mirrors editingOdoId).
  const [editingHrsId, setEditingHrsId] = useState<string | null>(null);
  const [tempHrs, setTempHrs] = useState('');
  // Manual maintenance reset modal — single source of truth for the
  // small dialog that captures the reading + notes when a manager
  // logs a service that happened off-board. `metric` controls the
  // labels and whether the next-due input is surfaced (km only).
  const [resetCtx, setResetCtx] = useState<{ fleetId: string; itemId: string; itemName: string; defaultHours: number; metric: 'hours' | 'km'; threshold: number } | null>(null);
  const [resetHrs, setResetHrs] = useState('');
  const [resetNextDue, setResetNextDue] = useState('');
  // Locked-with-edit toggle for the Next Due field in the reset
  // modal. Defaults locked so the common case is one tap.
  const [resetNextDueLocked, setResetNextDueLocked] = useState(true);
  const [resetNotes, setResetNotes] = useState('');
  // Whether to surface winterized units in the Fleet List. Off by
  // default — winterized units are hidden from the active view.

  const focusFleetRow = (fleetId: string) => {
    setHighlightedFleetId(fleetId);
    const el = document.getElementById(`fleet-row-${fleetId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => setHighlightedFleetId(null), 2200);
  };

  // Maintenance summary buckets — calendar/registration/CVOR/odometer
  // only. The legacy oil-change-by-odometer signals were removed when
  // hour-based maintenance tracking landed; oil changes now surface as
  // yellow MAINTENANCE tasks on the Repair Board (auto-spawned from
  // engine-hour thresholds), not as a banner item here.
  const maintenanceGroups = useMemo(() => {
    const oosUnits: FleetItem[] = [];
    const regExpiredUnits: FleetItem[] = [];
    const safetyExpiredUnits: FleetItem[] = [];
    const cvorExpiredUnits: FleetItem[] = [];

    const odoStaleUnits: FleetItem[] = [];
    const regSoonUnits: FleetItem[] = [];
    const safetySoonUnits: FleetItem[] = [];
    // Maintenance / oil-change summary — derived from the same
    // getUnitAttention logic that drives the per-row Oil chip, so banner
    // and rows always agree. Read-only; no spawn/data side effects.
    const maintOverdueUnits: FleetItem[] = [];
    const maintSoonUnits: FleetItem[] = [];

    const cvorIsExpired = isExpired(cvorExpiry);
    const cvorIsSoon = isExpiringSoon(cvorExpiry);

    fleet.forEach(f => {
      if (f.isWinterized) return; // winterized units don't surface in alerts
      const plateGate = needsPlateRenewal(f);
      const safetyGate = needsCommercialSafety(f);
      const att = getUnitAttention(f);

      // CRITICAL
      if (f.status === 'Out of Service') oosUnits.push(f);
      if (plateGate && isExpired(f.regExpiry)) regExpiredUnits.push(f);
      if (safetyGate && isExpired(f.safetyExpiry)) safetyExpiredUnits.push(f);
      if (f.cvorRequired && cvorIsExpired) cvorExpiredUnits.push(f);
      if (att.maintStatus === 'overdue') maintOverdueUnits.push(f);

      // WARNING (maintenance coming due)
      if (att.maintStatus === 'soon') maintSoonUnits.push(f);

      // WARNING — odo-stale is truck-only (positive type gate via the
      // canonical helper). Equipment / tractor / trailer don't track
      // an odometer in this model, so they never appear here. Hour-
      // tracked units are covered by the parallel Missing Hour
      // Updates banner.
      if (isKmMaintenanceUnit(f) && !f.isWinterized && isOdoStale(f.lastOdometerUpdate)) odoStaleUnits.push(f);
      if (plateGate && !isExpired(f.regExpiry) && isExpiringSoon(f.regExpiry)) regSoonUnits.push(f);
      if (safetyGate && !isExpired(f.safetyExpiry) && isExpiringSoon(f.safetyExpiry)) safetySoonUnits.push(f);
    });

    const critical = [
      { key: 'oos', label: 'Out of Service', units: oosUnits },
      { key: 'maint-overdue', label: 'Maintenance overdue (oil change)', units: maintOverdueUnits },
      { key: 'reg-expired', label: 'Plate registration expired', units: regExpiredUnits },
      { key: 'safety-expired', label: 'Commercial safety expired', units: safetyExpiredUnits },
      { key: 'cvor-expired', label: 'CVOR expired', units: cvorExpiredUnits },
    ].filter(g => g.units.length > 0);

    const warning = [
      { key: 'maint-soon', label: 'Maintenance coming due (oil change)', units: maintSoonUnits },
      { key: 'odo-stale', label: 'Odometer not updated in 30+ days', units: odoStaleUnits },
      { key: 'reg-soon', label: 'Plate registration expiring within 30 days', units: regSoonUnits },
      { key: 'safety-soon', label: 'Commercial safety expiring within 30 days', units: safetySoonUnits },
      ...(cvorIsSoon && !cvorIsExpired ? [{ key: 'cvor-soon', label: 'CVOR expiring within 30 days', units: fleet.filter(f => f.cvorRequired && !f.isWinterized) }] : []),
    ].filter(g => g.units.length > 0);

    const criticalCount = critical.reduce((s, g) => s + g.units.length, 0);
    const warningCount = warning.reduce((s, g) => s + g.units.length, 0);

    return { critical, warning, criticalCount, warningCount };
  }, [fleet, cvorExpiry]);

  // Assignee candidates for repair tasks — mechanics only. Filter to
  // Employee records with systemRole === 'mechanic' and a linked sign-in
  // email (the email is the assignee.userEmail field). Previously this
  // derived from activityLog + inspectors, which leaked every role that
  // had ever written any activity entry — foremen, workers, managers —
  // into the picker. Display of an existing non-mechanic assignment is
  // handled in AssigneeBadge by reading task.assignedTo directly, so
  // legacy assignments still render; only the PICKER is restricted.
  const userOptions = useMemo(() => {
    const opts = (appData.employees || [])
      .filter(e => e.systemRole === 'mechanic' && !!e.linkedUserEmail)
      .map(e => ({ userEmail: e.linkedUserEmail as string, userName: e.name || e.linkedUserEmail as string }));
    // If the current user IS a mechanic but somehow isn't in employees
    // (e.g. they're acting as one via View As → Mechanic with no employee
    // record), make sure "Assign to me" still has a target to write back.
    if (currentUserEmail && !opts.some(o => o.userEmail === currentUserEmail)) {
      const meEmp = (appData.employees || []).find(e =>
        (e.linkedUserEmail || '').toLowerCase() === currentUserEmail.toLowerCase()
        && e.systemRole === 'mechanic',
      );
      if (meEmp) {
        opts.push({ userEmail: meEmp.linkedUserEmail as string, userName: meEmp.name || currentUserName });
      }
    }
    return opts.sort((a, b) => a.userName.localeCompare(b.userName));
  }, [appData.employees, currentUserEmail, currentUserName]);

  return (
    <div className="flex-1 flex flex-col lg:h-full overflow-y-auto lg:overflow-hidden bg-gray-100 p-6 pb-24 lg:pb-6 print:bg-white print:p-0 print:overflow-visible">
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-3 mb-6 print:hidden">
        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><PenTool className="w-6 h-6 text-green-600" /> MechanicMaster Pro</h2>
        <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm flex-wrap">
          <button onClick={() => setMechanicView('kanban')} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-bold rounded-md ${mechanicView === 'kanban' ? 'bg-slate-800 text-white' : 'text-gray-500 hover:text-gray-700'}`}><LayoutDashboard className="w-4 h-4" /> Repair Board</button>
          <button onClick={() => setMechanicView('tracker')} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-bold rounded-md ${mechanicView === 'tracker' ? 'bg-slate-800 text-white' : 'text-gray-500 hover:text-gray-700'}`}><List className="w-4 h-4" /> Fleet List</button>
          <button onClick={() => setMechanicView('log')} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-bold rounded-md ${mechanicView === 'log' ? 'bg-slate-800 text-white' : 'text-gray-500 hover:text-gray-700'}`}><ClipboardList className="w-4 h-4" /> Repair Log</button>
          <button onClick={() => setMechanicView('inspections')} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-bold rounded-md ${mechanicView === 'inspections' ? 'bg-slate-800 text-white' : 'text-gray-500 hover:text-gray-700'}`}><FileSignature className="w-4 h-4" /> Inspection Log</button>
          {canViewPartsOrders && (
            <button onClick={() => setMechanicView('parts')} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-bold rounded-md ${mechanicView === 'parts' ? 'bg-slate-800 text-white' : 'text-gray-500 hover:text-gray-700'}`}><Package className="w-4 h-4" /> Parts Orders</button>
          )}
          <button onClick={() => setMechanicView('activity')} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-bold rounded-md ${mechanicView === 'activity' ? 'bg-slate-800 text-white' : 'text-gray-500 hover:text-gray-700'}`}><Activity className="w-4 h-4" /> Activity Log</button>
          <button onClick={() => setMechanicView('performance')} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-bold rounded-md ${mechanicView === 'performance' ? 'bg-slate-800 text-white' : 'text-gray-500 hover:text-gray-700'}`}><TrendingUp className="w-4 h-4" /> Mechanic Performance</button>
        </div>
        <button onClick={() => onOpenManualTask()} className="w-full lg:w-auto justify-center px-6 py-2 min-h-[44px] bg-green-600 text-white font-black text-xs uppercase tracking-widest rounded-xl shadow-lg shadow-green-600/20 hover:bg-green-700 flex items-center gap-2"><Plus className="w-4 h-4" /> Report New Repair</button>
      </div>

      {mechanicView === 'kanban' ? (
      <>
        {/* Repair Board scope toggle — sits outside the scroll container
            so it stays visible while the list scrolls. Two-pill segmented
            control: "Assigned to me" (default for mechanics — strict, only
            tasks where assignedTo.userEmail === me) and "All Repairs"
            (default for admin/manager/foreman). */}
        {/* Top-of-board toolbar: generic Request Parts launcher on the
            left, scope toggle on the right. Both sit outside the scroll
            container so they stay visible while the list scrolls. */}
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap print:hidden">
          <button
            type="button"
            onClick={() => onOpenRequestParts(null)}
            className="min-h-[40px] inline-flex items-center gap-2 px-3 py-2 text-xs font-black uppercase tracking-widest bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow"
            title="Request parts (not tied to a specific repair)"
          >
            <Package className="w-4 h-4" /> Request Parts
          </button>
          <div role="tablist" className="inline-flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
            <button
              type="button"
              role="tab"
              aria-selected={repairFilter === 'mine'}
              onClick={() => setRepairFilter('mine')}
              className={`min-h-[40px] px-4 py-2 text-xs font-black uppercase tracking-widest rounded-md transition-colors ${
                repairFilter === 'mine'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Assigned to me
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={repairFilter === 'all'}
              onClick={() => setRepairFilter('all')}
              className={`min-h-[40px] px-4 py-2 text-xs font-black uppercase tracking-widest rounded-md transition-colors ${
                repairFilter === 'all'
                  ? 'bg-green-600 text-white shadow'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              All Repairs
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-6 flex-1 min-h-0 overflow-y-auto pb-2">
          {(() => {
            // Only real tasks from appData.mechanicTasks. The previous
            // implementation also injected synthetic auto-OOS and
            // auto-maintenance rows from fleet state — but those rendered
            // as `disabled` buttons (no real task to open in the modal),
            // which broke the row-tap UX and confused users into thinking
            // ALL rows were untappable. Auto-derived fleet status is still
            // surfaced via the maintenance summary banner + Fleet List view,
            // so dropping it here doesn't lose information; it just keeps
            // the Repair Board to actual reported repairs.
            const all: MechanicTask[] = mechanicTasks;
            // Sort: severity first (major above minor). Within each
            // severity bucket, tasks order by composite key:
            //   1) actionable BEFORE parts-pending (parts-pending tasks
            //      are waiting on outside input, so they sink to the
            //      bottom of the severity group). 'arrived' counts as
            //      actionable — the part is here, the mechanic can
            //      work it. Only 'requested' and 'ordered' are pending.
            //   2) priority BEFORE regular — applied independently
            //      within each of the actionable / parts-pending
            //      sub-buckets, so a priority task surfaces to the top
            //      of whatever bucket it's in.
            //   3) dateReported ascending (oldest first) as a tie-break.
            const isPartsPending = (t: MechanicTask) =>
              t.partsStatus === 'requested' || t.partsStatus === 'ordered';
            const sortBySeverityThenAge = (a: MechanicTask, b: MechanicTask) => {
              if (a.severity !== b.severity) return a.severity === 'major' ? -1 : 1;
              const aPending = isPartsPending(a) ? 1 : 0;
              const bPending = isPartsPending(b) ? 1 : 0;
              if (aPending !== bPending) return aPending - bPending;
              const aPrio = a.priority ? 0 : 1;
              const bPrio = b.priority ? 0 : 1;
              if (aPrio !== bPrio) return aPrio - bPrio;
              return (a.dateReported || '').localeCompare(b.dateReported || '');
            };
            // Scope filter ('mine' / 'all'). Strict definition per the
            // latest spec: "Assigned to me" shows ONLY tasks where the
            // current user is the assignee — unassigned and others'
            // tasks drop out. To pick up new work, the user flips to
            // "All Repairs" and uses the inline "Assign to me" button.
            // Complete list narrows to tasks whose 'completed' activity
            // entry is mine (preserves the old MyMechanic attribution).
            const me = (currentUserEmail || '').toLowerCase();
            // Multi-assignee aware: "mine" includes any task where I'm one
            // of the assignees (not just the sole legacy assignedTo).
            const inMineActive = (t: MechanicTask) =>
              assigneesForTask(t).some(a => a.userEmail.toLowerCase() === me);
            // Completed-by-me includes collaborations: I'm one of the
            // workers credited on the 'completed' activity.
            const inMineCompleted = (t: MechanicTask) => {
              const ca = (t.activity || []).find(a => a.type === 'completed');
              if (!ca) return false;
              return shareForMechanic(ca, me) > 0;
            };
            // Active = todo + doing combined visually (one list, sorted by
            // severity then oldest). `doing` is preserved in the schema —
            // this is purely a presentational merge.
            const activeList = all
              .filter(t => t.status === 'todo' || t.status === 'doing')
              .filter(t => repairFilter === 'all' ? true : inMineActive(t))
              .sort(sortBySeverityThenAge);
            const completeList = all
              .filter(t => t.status === 'done')
              .filter(t => repairFilter === 'all' ? true : inMineCompleted(t))
              .sort(sortBySeverityThenAge);

            // Severity sub-groups — Major first (oldest within), then
            // Minor (oldest within). The earlier sortBySeverityThenAge
            // already ordered the combined list correctly; split by
            // severity for the per-group sub-headers.
            const activeMajor = activeList.filter(t => t.severity === 'major');
            const activeMinor = activeList.filter(t => t.severity !== 'major');

            // Completed list is re-sorted by completion timestamp (newest
            // first) and capped at 50 — mirrors the old MyMechanic
            // Section 3. Items without a 'completed' activity entry
            // (legacy data) sort to the bottom via the empty-string fallback.
            const completedSorted = completeList
              .map(t => ({
                task: t,
                completedTs: (t.activity || []).find(a => a.type === 'completed')?.timestamp || '',
              }))
              .sort((a, b) => (b.completedTs || '').localeCompare(a.completedTs || ''))
              .slice(0, 50);

            // Helpers shared by active + completed rows. unitName falls
            // back to a live fleet lookup so renamed units stay in sync.
            const unitName = (task: MechanicTask): string => {
              if (task.unitId) {
                const f = fleet.find(x => x.id === task.unitId);
                if (f?.name) return f.name;
              }
              return task.unitName || '—';
            };
            // Unit-number subline. Returns null when the task has no
            // linked unit or the unit has no `unitNumber` set — callers
            // skip rendering rather than print a "Unit #—" placeholder.
            const unitNumberLabel = (task: MechanicTask): string | null => {
              if (!task.unitId) return null;
              const f = fleet.find(x => x.id === task.unitId);
              if (!f || typeof f.unitNumber !== 'number') return null;
              return `Unit #${f.unitNumber}`;
            };

            // Today (Toronto) — drives the compact per-row age badge.
            const today = formatTodayInToronto();

            // Append the current mechanic to the task's assignee list
            // (multi-assignee, no cap) rather than replacing it.
            const assignSelf = (taskId: string) => {
              const t = all.find(x => x.id === taskId);
              const current = assigneesForTask(t);
              if (current.some(a => a.userEmail.toLowerCase() === currentUserEmail.toLowerCase())) return;
              onSetAssignees(taskId, [...current, { userEmail: currentUserEmail, userName: currentUserName }]);
            };
            const meLc = (currentUserEmail || '').toLowerCase();

            // Assignee avatar — palette + initial derived from the
            // assignee's email so the badge color stays stable across
            // sessions (same approach AssigneeBadge uses elsewhere).
            // Consistent per-person avatar color — shared util (same hash
            // + palette as before, so colors are unchanged).
            const hashColorFor = personColor;
            const firstInitial = (name: string, email: string): string => {
              const src = (name || '').trim() || (email || '').split('@')[0] || '';
              return (src.charAt(0) || '?').toUpperCase();
            };
            const firstNameOnly = (name: string, email: string): string => {
              const src = (name || '').trim() || (email || '').split('@')[0] || '';
              if (!src) return '';
              const parts = src.split(/\s+/).filter(Boolean);
              const first = parts[0] || src;
              return first.charAt(0).toUpperCase() + first.slice(1);
            };

            // Parts-status tag colors — match the Parts Orders tab so the
            // two surfaces agree visually.
            const partsTagFor = (status: MechanicTask['partsStatus']) => {
              if (status === 'requested') return { label: 'Parts Requested', cls: 'bg-yellow-100 text-yellow-800 border-yellow-300' };
              if (status === 'ordered') return { label: 'Parts on Order', cls: 'bg-rose-100 text-rose-800 border-rose-300' };
              return { label: 'Parts Arrived', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
            };

            // Active-row renderer. Outer is a <div role="button"> so
            // nested interactive children (priority pill, request-parts
            // button, assign-to-me) can live INSIDE the card body without
            // the invalid-HTML nested-button problem. Each interactive
            // child calls e.stopPropagation() to prevent its tap from
            // bubbling up to the modal-open handler on the outer div.
            const renderActiveRow = (task: MechanicTask) => {
              const lc = (task.category || '').toLowerCase();
              const sourceKind: 'inspection' | 'maintenance' | 'manual' =
                task.inspectionId ? 'inspection'
                : task.isMaintenance ? 'maintenance'
                : /oil change|maintenance|sharpening|filter/.test(lc) ? 'maintenance'
                : /tire pressure|brakes|lights|hitch|defect/.test(lc) ? 'inspection'
                : 'manual';
              const hasPartsRequest = !!task.partsStatus;
              const partsTag = hasPartsRequest ? partsTagFor(task.partsStatus) : null;
              // Parts-waiting state. 'arrived' is actionable again so it is
              // NOT pending. The manual waitingOnParts flag also blocks,
              // unless parts arrived.
              const partsState: 'ordered' | 'requested' | 'waiting' | null =
                task.partsStatus === 'ordered' ? 'ordered'
                : task.partsStatus === 'requested' ? 'requested'
                : (task.waitingOnParts && task.partsStatus !== 'arrived') ? 'waiting'
                : null;
              const partsPending = partsState !== null;
              const isMajor = task.severity === 'major';
              const expanded = expandedRepairId === task.id;
              const asg = assigneesForTask(task);
              const rep = task.reportedBy?.name || task.activity?.find(a => a.type === 'created')?.userName;
              const age = repairAge(task.dateReported, today);
              const unassigned = asg.length === 0;
              // Left accent encodes urgency at a glance: priority → rose,
              // parts-blocked → rose/amber, major → rose, else source color.
              const accent =
                task.priority ? 'border-l-rose-500'
                : partsState === 'ordered' ? 'border-l-rose-400'
                : partsState ? 'border-l-amber-400'
                : isMajor ? 'border-l-rose-400'
                : sourceKind === 'inspection' ? 'border-l-blue-400'
                : sourceKind === 'maintenance' ? 'border-l-yellow-400'
                : 'border-l-slate-200';
              const toggle = () => setExpandedRepairId(expanded ? null : task.id);
              return (
                <li key={task.id}>
                  <div className={`border border-l-4 rounded-lg bg-white shadow-sm ${accent} ${partsPending ? 'opacity-75' : ''} ${expanded ? 'border-slate-300 shadow-md' : 'border-slate-200'}`}>
                    {/* COMPACT HEADER — the whole strip is one big tap target
                        (glove-friendly, min-h 52) that expands the row. */}
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={expanded}
                      onClick={toggle}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
                      aria-label={`${task.category} on ${unitName(task)} — tap for details`}
                      className="flex items-center gap-2 px-2.5 py-2 min-h-[52px] cursor-pointer rounded-lg active:bg-slate-50"
                    >
                      {(task.priority || isMajor) && (
                        <Flame className={`w-4 h-4 shrink-0 ${task.priority ? 'text-rose-500' : 'text-rose-400'}`} fill={task.priority ? '#f43f5e' : 'none'} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-bold text-sm text-slate-800 truncate">{unitName(task)}</span>
                          {isMajor && <span className="shrink-0 text-[8px] font-black uppercase tracking-widest bg-rose-600 text-white px-1 py-0.5 rounded">Major</span>}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {task.category}
                          {unitNumberLabel(task) ? ` · ${unitNumberLabel(task)}` : ''}
                          {rep ? ` · ${rep}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {partsPending && partsTag ? (
                          <Package className={`w-4 h-4 ${partsState === 'ordered' ? 'text-rose-500' : 'text-amber-500'}`} aria-label={partsTag.label} />
                        ) : unassigned ? (
                          <span className="text-[8px] font-black uppercase tracking-widest bg-slate-100 text-slate-500 border border-slate-300 px-1 py-0.5 rounded">Unassigned</span>
                        ) : (
                          <div className="flex -space-x-1.5" title={asg.map(a => a.userName || a.userEmail).join(', ')}>
                            {asg.slice(0, 3).map(a => (
                              <span key={a.userEmail} className={`w-5 h-5 rounded-full ${hashColorFor(a.userEmail)} text-white text-[9px] font-black flex items-center justify-center shrink-0 ring-1 ring-white`}>
                                {firstInitial(a.userName || '', a.userEmail || '')}
                              </span>
                            ))}
                          </div>
                        )}
                        {!!task.photos?.length && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-slate-400" title={`${task.photos.length} photo${task.photos.length > 1 ? 's' : ''}`}>
                            <Camera className="w-3.5 h-3.5" />{task.photos.length}
                          </span>
                        )}
                        {age.label && (
                          <span className={`text-[11px] font-bold tabular-nums ${age.aging ? 'text-rose-600' : 'text-slate-400'}`} title={`Reported ${formatReportedDate(task.dateReported)}`}>
                            {age.label}
                          </span>
                        )}
                        {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                      </div>
                    </div>

                    {/* EXPANDED PANEL — full description + reporter/assignees
                        + the board quick actions (priority / parts / assign)
                        + a link into the full detail modal. Nothing removed;
                        it just lives behind the tap now. */}
                    {expanded && (
                      <div className="px-2.5 pb-2.5 pt-1 border-t border-slate-100 space-y-2">
                        {task.description && task.description !== 'Unit marked Out of Service' && (
                          <div className="text-[12px] text-slate-600 mt-2 whitespace-pre-wrap">{task.description}</div>
                        )}
                        <div className="text-[11px] text-slate-500">
                          {asg.length ? `Assigned: ${asg.map(a => firstNameOnly(a.userName || '', a.userEmail || '')).join(', ')}` : 'Unassigned'}
                          {rep ? ` · Reported by ${rep}` : ''}
                          {task.dateReported ? ` · ${formatReportedDate(task.dateReported)}` : ''}
                        </div>
                        {!!task.photos?.length && (
                          <div className="flex flex-wrap gap-2">
                            {task.photos.map((f, i) => {
                              const canDel = isAdmin || (f.uploadedBy?.email || '').toLowerCase() === meLc;
                              return (
                                <div key={f.path} className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                                  <button type="button" onClick={() => setPhotoViewer({ files: task.photos!, idx: i })} className="w-full h-full" title="View photo">
                                    {f.kind === 'pdf'
                                      ? <span className="w-full h-full flex items-center justify-center"><FileSignature className="w-6 h-6 text-slate-400" /></span>
                                      : <img src={f.url} alt={f.name} className="w-full h-full object-cover" />}
                                  </button>
                                  {canDel && (
                                    <button
                                      type="button"
                                      title="Remove photo"
                                      onClick={async () => {
                                        onSetTaskPhotos(task.id, (task.photos || []).filter(p => p.path !== f.path));
                                        try { await deleteFile(f.path); } catch { /* metadata already dropped; orphan byte is harmless */ }
                                      }}
                                      className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => onTogglePriority(task)}
                            title={task.priority ? 'Unmark priority' : 'Mark as priority'}
                            aria-pressed={!!task.priority}
                            className={`min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border transition-colors ${
                              task.priority ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <Flame className="w-3 h-3" fill={task.priority ? '#f43f5e' : 'none'} />
                            Priority
                          </button>
                          {hasPartsRequest && partsTag ? (
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${partsTag.cls}`} title="Status managed in the Parts Orders tab">
                              <Package className="w-3 h-3" /> {partsTag.label}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onOpenRequestParts({ unitId: task.unitId, unitName: unitName(task), repairId: task.id })}
                              title="Request parts for this repair"
                              className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200"
                            >
                              <Package className="w-3 h-3" /> Request Parts
                            </button>
                          )}
                          {!asg.some(a => a.userEmail.toLowerCase() === meLc) && (
                            <button
                              type="button"
                              onClick={() => assignSelf(task.id)}
                              title="Add me to this repair"
                              className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                            >
                              <UserPlus className="w-3 h-3" /> Assign to me
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onOpenTask(task.id)}
                            className="min-h-[36px] inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white hover:bg-slate-800 ml-auto"
                          >
                            Open details →
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            };

            // Completed rows get the same compact one-line treatment — tap
            // opens the full detail modal (read-only history). The green
            // check + date sit on the right; collaboration credit is folded
            // into the muted subline so the row stays a single strip.
            const renderCompletedRow = ({ task, completedTs }: { task: MechanicTask; completedTs: string }) => {
              const completedAct = (task.activity || []).find(a => a.type === 'completed');
              const others = completedAct ? collaboratorNames(completedAct, completedAct.userEmail || '') : [];
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() => onOpenTask(task.id)}
                    className="w-full text-left flex items-center gap-2 px-2.5 py-2 min-h-[48px] bg-white border border-slate-200 rounded-lg shadow-sm hover:shadow-md hover:border-slate-300 transition-all active:bg-slate-50"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-bold text-sm text-slate-800 truncate">{unitName(task)}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {task.category}
                        {unitNumberLabel(task) ? ` · ${unitNumberLabel(task)}` : ''}
                        {others.length ? ` · with ${joinNames(others)}` : ''}
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-emerald-700 whitespace-nowrap shrink-0" title={String(completedTs)}>
                      {formatCompletedAt(completedTs)}
                    </span>
                  </button>
                </li>
              );
            };

            const emptyMsg = (kind: 'active' | 'complete') => (
              kind === 'active'
                ? (repairFilter === 'mine' ? 'No active repairs assigned to you.' : 'No active repairs.')
                : (repairFilter === 'mine' ? 'No completed repairs by you yet.' : 'No completed repairs yet.')
            );

            return (
              <>
                {/* ACTIVE — split into Major + Minor sub-groups so the
                    severity hierarchy is obvious at a glance. */}
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-700 flex items-center gap-1.5">
                      <ClipboardList className="w-4 h-4 text-slate-700" /> Active Repairs
                    </h3>
                    <span className="text-[10px] font-bold text-slate-400">{activeList.length}</span>
                  </div>
                  {activeList.length === 0 ? (
                    <div className="text-sm text-slate-400 italic bg-white border border-dashed border-slate-200 rounded-lg p-4 text-center">{emptyMsg('active')}</div>
                  ) : (
                    <div className="space-y-4">
                      {activeMajor.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-[10px] font-black uppercase tracking-widest text-rose-700 inline-flex items-center gap-1">
                              <Flame className="w-3 h-3" /> Major
                            </span>
                            <span className="text-[10px] font-bold text-slate-400">{activeMajor.length}</span>
                          </div>
                          <ul className="space-y-1.5 sm:space-y-2">
                            {activeMajor.map(task => renderActiveRow(task))}
                          </ul>
                        </div>
                      )}
                      {activeMinor.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">Minor</span>
                            <span className="text-[10px] font-bold text-slate-400">{activeMinor.length}</span>
                          </div>
                          <ul className="space-y-1.5 sm:space-y-2">
                            {activeMinor.map(task => renderActiveRow(task))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </section>

                {/* COMPLETED — newest first, capped at 50. */}
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-700 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Completed Repairs
                    </h3>
                    <span className="text-[10px] font-bold text-slate-400">{completedSorted.length}</span>
                  </div>
                  {completedSorted.length === 0 ? (
                    <div className="text-sm text-slate-400 italic bg-white border border-dashed border-slate-200 rounded-lg p-4 text-center">{emptyMsg('complete')}</div>
                  ) : (
                    <ul className="space-y-1.5 sm:space-y-2">
                      {completedSorted.map(item => renderCompletedRow(item))}
                    </ul>
                  )}
                </section>
              </>
            );
          })()}
        </div>
      </>
      ) : mechanicView === 'log' ? (
        <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 p-4 border-b border-gray-200 flex justify-between items-center">
            <h3 className="font-bold text-gray-800">Historical Repair Log</h3>
            <span className="text-xs font-medium bg-white border border-gray-200 px-2 py-1 rounded text-gray-500">Total YTD Cost: ${repairLog.reduce((s, r) => s + (Number(r.cost) || 0), 0).toFixed(2)}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead><tr className="bg-white border-b border-gray-200 text-xs text-gray-500 uppercase"><th className="p-4">Date</th><th className="p-4">Equipment</th><th className="p-4">Details</th><th className="p-4 text-right">Cost</th>{canDeleteRepairLog && <th className="p-4 text-right w-12">{/* delete */}</th>}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {repairLog.length === 0 ? <tr><td colSpan={canDeleteRepairLog ? 5 : 4} className="p-8 text-center text-gray-400 italic border-none">No repairs logged yet.</td></tr> : repairLog.map(log => (
                <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                  <td className="p-4 font-medium text-sm text-gray-700">{log.date}</td>
                  <td className="p-4 font-bold text-gray-900 text-sm">{log.equipmentName}</td>
                  <td className="p-4 text-sm text-gray-600">
                    {log.fixNotes}
                    {!!(log.photos?.length) && (
                      <button
                        type="button"
                        onClick={() => setPhotoViewer({ files: log.photos as StoredFile[], idx: 0 })}
                        title={`${log.photos.length} photo${log.photos.length > 1 ? 's' : ''}`}
                        className="ml-2 inline-flex items-center gap-0.5 text-[11px] font-bold text-slate-400 hover:text-slate-700 align-middle"
                      >
                        <Camera className="w-3.5 h-3.5" />{log.photos.length}
                      </button>
                    )}
                  </td>
                  <td className="p-4 text-right font-mono font-bold text-rose-600">${Number(log.cost).toFixed(2)}</td>
                  {canDeleteRepairLog && (
                    <td className="p-4 text-right">
                      <button
                        onClick={() => onDeleteRepairLog(log.id)}
                        title="Delete this repair log"
                        aria-label="Delete this repair log"
                        className="text-rose-400 hover:text-rose-600 p-1.5 hover:bg-rose-50 rounded min-w-[36px] min-h-[36px] inline-flex items-center justify-center"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : mechanicView === 'inspections' ? (
        <InspectionLog
          inspections={canViewAllInspections ? appData.inspections : appData.inspections.filter(i => currentEmployeeId !== null && i.driverId === currentEmployeeId)}
          fleet={fleet}
          onView={onViewInspection}
          canDelete={canDeleteInspectionLog}
          onDelete={onDeleteInspectionLog}
        />
      ) : mechanicView === 'parts' && canViewPartsOrders ? (
        <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 p-4 border-b border-gray-200 flex justify-between items-center gap-3 flex-wrap">
            <h3 className="font-bold text-gray-800 inline-flex items-center gap-2"><Package className="w-5 h-5 text-amber-600" /> Parts Orders</h3>
            <button
              type="button"
              onClick={() => onOpenRequestParts(null)}
              className="min-h-[36px] inline-flex items-center gap-2 px-3 py-1.5 text-xs font-black uppercase tracking-widest bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow"
            >
              <Plus className="w-4 h-4" /> New Request
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {(() => {
              const orders = Object.values(partsOrders || {});
              if (orders.length === 0) {
                return (
                  <div className="p-12 text-center text-slate-400 italic">No parts orders yet.</div>
                );
              }
              // Sort: Requested first, then Ordered, then Arrived. Oldest
              // first within each status group.
              const statusRank = (s: PartsOrder['status']) =>
                s === 'requested' ? 0 : s === 'ordered' ? 1 : 2;
              const sorted = [...orders].sort((a, b) => {
                const r = statusRank(a.status) - statusRank(b.status);
                if (r !== 0) return r;
                return (a.requestedAt || 0) - (b.requestedAt || 0);
              });
              const taskById: Record<string, MechanicTask | undefined> = {};
              for (const t of mechanicTasks) taskById[t.id] = t;
              const fmtDate = (ts: number) => {
                try { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
                catch { return ''; }
              };
              return (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white border-b border-gray-200 text-xs text-gray-500 uppercase">
                      <th className="p-4">Part</th>
                      <th className="p-4 w-16 text-right">Qty</th>
                      <th className="p-4">Unit</th>
                      <th className="p-4">Linked Repair</th>
                      <th className="p-4">Requested</th>
                      <th className="p-4">Status</th>
                      <th className="p-4 w-32 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sorted.map(order => {
                      const linkedTask = order.repairId ? taskById[order.repairId] : undefined;
                      const statusChipClass =
                        order.status === 'requested' ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                        : order.status === 'ordered' ? 'bg-rose-100 text-rose-800 border-rose-300'
                        : 'bg-emerald-100 text-emerald-800 border-emerald-300';
                      const statusLabel =
                        order.status === 'requested' ? 'Requested'
                        : order.status === 'ordered' ? 'Ordered'
                        : 'Arrived';
                      const statusMenuOpen = openStatusMenuOrderId === order.id;
                      const allStatuses = ['requested', 'ordered', 'arrived'] as const;
                      const labelFor = (s: 'requested' | 'ordered' | 'arrived') =>
                        s === 'requested' ? 'Requested' : s === 'ordered' ? 'Ordered' : 'Arrived';
                      const dotFor = (s: 'requested' | 'ordered' | 'arrived') =>
                        s === 'requested' ? 'bg-yellow-500'
                        : s === 'ordered' ? 'bg-rose-600'
                        : 'bg-emerald-600';
                      return (
                        <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                          <td className="p-4 font-bold text-gray-900 text-sm">
                            {order.partName}
                            {order.notes && (
                              <div className="text-xs font-normal text-gray-500 mt-0.5 italic">{order.notes}</div>
                            )}
                          </td>
                          <td className="p-4 text-right font-mono font-bold text-gray-700">{order.quantity}</td>
                          <td className="p-4 text-sm text-gray-700">
                            {order.unitName || (order.unitId ? '—' : <span className="italic text-gray-400">Generic</span>)}
                          </td>
                          <td className="p-4 text-sm">
                            {order.repairId ? (
                              linkedTask ? (
                                <button
                                  type="button"
                                  onClick={() => { setMechanicView('kanban'); onOpenTask(order.repairId!); }}
                                  className="text-emerald-700 hover:underline font-bold text-left"
                                  title="Open the linked repair"
                                >
                                  {linkedTask.category}{linkedTask.unitName ? ` · ${linkedTask.unitName}` : ''}
                                </button>
                              ) : (
                                <span className="text-gray-400 italic">Repair deleted</span>
                              )
                            ) : (
                              <span className="text-gray-400 italic">—</span>
                            )}
                          </td>
                          <td className="p-4 text-sm text-gray-600">
                            <div>{fmtDate(order.requestedAt)}</div>
                            <div className="text-[11px] text-gray-400">by {order.requestedBy.name || order.requestedBy.email}</div>
                          </td>
                          <td className="p-4">
                            <div className="relative inline-block">
                              <button
                                type="button"
                                disabled={!canChangePartsStatus}
                                onMouseDown={e => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!canChangePartsStatus) return;
                                  setOpenStatusMenuOrderId(statusMenuOpen ? null : order.id);
                                }}
                                aria-haspopup="menu"
                                aria-expanded={statusMenuOpen}
                                title={canChangePartsStatus ? 'Change status' : `Status: ${statusLabel}`}
                                className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full border inline-flex items-center gap-1 ${statusChipClass} ${canChangePartsStatus ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                              >
                                {statusLabel}
                                {canChangePartsStatus && <ChevronDown className="w-3 h-3" />}
                              </button>
                              {statusMenuOpen && (
                                <div
                                  role="menu"
                                  className="absolute z-50 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl min-w-[160px] overflow-hidden"
                                  onMouseDown={e => e.stopPropagation()}
                                  onClick={e => e.stopPropagation()}
                                >
                                  {allStatuses.map(s => {
                                    const isCurrent = order.status === s;
                                    return (
                                      <button
                                        key={s}
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                          if (!isCurrent) onChangePartsStatus(order.id, s);
                                          setOpenStatusMenuOrderId(null);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                                      >
                                        <span className={`w-2 h-2 rounded-full shrink-0 ${dotFor(s)}`} />
                                        <span className="flex-1 text-left">{labelFor(s)}</span>
                                        {isCurrent && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="p-4 text-right">
                            <button
                              type="button"
                              onClick={() => onDeletePartsOrder(order.id)}
                              className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                              title="Delete this parts order"
                              aria-label="Delete parts order"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              );
            })()}
          </div>
        </div>
      ) : mechanicView === 'activity' ? (
        <ActivityLog activityLog={appData.activityLog || []} fleet={fleet} />
      ) : mechanicView === 'performance' ? (
        <MechanicPerformance
          activityLog={appData.activityLog || []}
          employees={appData.employees}
          mechanicPayChunks={appData.mechanicPayChunks || {}}
          mechanicTasks={mechanicTasks}
          timeEntries={appData.timeEntries || []}
          isAdmin={isAdmin}
          onMarkChunksPaid={onMarkChunksPaid}
          onUnmarkChunkPaid={onUnmarkChunkPaid}
        />
      ) : (
        // Single scroll container for the whole Fleet List — header strip +
        // summary banner + grouped list scroll together. Mirrors the kanban
        // view's `flex-1 min-h-0 overflow-y-auto` (direct child of the root)
        // so scrolling works on mobile + desktop regardless of banner
        // height. The previous nested layout (outer flex-1 lg:min-h-0 +
        // inner scroller) only constrained height on lg, so the banner's
        // vertical space broke scroll on mobile.
        <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto pb-2">
          {/* Fleet-list header: CVOR expiry editor + Missing-Odo summary.
              These used to live above the view conditional (visible on
              every Mechanic tab) but they're Fleet-specific signals — a
              fleet expiry date and a per-fleet odometer staleness count —
              so they belong only on the Fleet List view. */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-wrap gap-4 items-center print:hidden">
            <div className="flex-1 min-w-[200px]">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Company CVOR</h4>
              <div className="flex items-center gap-2 mt-1">
                <input type="date" value={cvorExpiry || ''} onChange={(e) => onCvorChange(e.target.value)} className="bg-gray-50 border border-gray-200 rounded p-1.5 text-sm text-gray-800 font-medium outline-none" />
                {isExpiringSoon(cvorExpiry) && <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded font-bold">Expiring!</span>}
              </div>
            </div>
            <div className="flex-1 min-w-[200px] bg-red-50 border border-red-100 rounded-lg p-3">
              <h4 className="text-xs font-bold text-red-800 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Missing Odo Updates</h4>
              <p className="text-sm text-red-600 font-medium mt-1">{fleet.filter(f => isKmMaintenanceUnit(f) && !f.isWinterized && isOdoStale(f.lastOdometerUpdate)).length} vehicles unupdated in 30 days.</p>
            </div>
            {/* Missing Hour Updates — parallel banner for engine-hour-
                tracked units that haven't been read in 7+ days. Mirrors
                the ODO banner styling. Winterized units don't count. */}
            <div className="flex-1 min-w-[200px] bg-amber-50 border border-amber-100 rounded-lg p-3">
              <h4 className="text-xs font-bold text-amber-800 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Missing Hour Updates</h4>
              <p className="text-sm text-amber-700 font-medium mt-1">
                {fleet.filter(f => isHourMaintenanceUnit(f) && !f.isWinterized && (!f.lastHourUpdateAt || (Date.now() - f.lastHourUpdateAt) > 7 * 24 * 60 * 60 * 1000)).length} units unupdated in 7 days.
              </p>
            </div>
          </div>

          {/* MAINTENANCE SUMMARY BANNER */}
          {(maintenanceGroups.criticalCount > 0 || maintenanceGroups.warningCount > 0) && (
            <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm">
              {maintenanceGroups.criticalCount > 0 && (
                <div className="bg-rose-50 border-b border-rose-200">
                  <button
                    onClick={() => setBannerCriticalOpen(o => !o)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-rose-100/60 transition-colors"
                  >
                    <span className="flex items-center gap-2 text-rose-800 font-black uppercase tracking-widest text-xs">
                      <AlertCircle className="w-4 h-4" />
                      {maintenanceGroups.criticalCount} critical
                      {maintenanceGroups.warningCount > 0 && <span className="text-rose-400">·</span>}
                      {maintenanceGroups.warningCount > 0 && <span className="text-amber-700">{maintenanceGroups.warningCount} warnings</span>}
                    </span>
                    {bannerCriticalOpen ? <ChevronUp className="w-4 h-4 text-rose-600" /> : <ChevronDown className="w-4 h-4 text-rose-600" />}
                  </button>
                  {bannerCriticalOpen && (
                    <div className="px-4 pb-3 space-y-1.5">
                      {maintenanceGroups.critical.map(g => (
                        <div key={g.key} className="text-xs">
                          <span className="font-black text-rose-700 uppercase tracking-wider mr-2">{g.label}:</span>
                          {g.units.map((u, i) => (
                            <span key={u.id}>
                              <button onClick={() => focusFleetRow(u.id)} className="font-bold text-rose-900 hover:underline">{u.name}</button>
                              {i < g.units.length - 1 && <span className="text-rose-300">, </span>}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {maintenanceGroups.warningCount > 0 && (
                <div className="bg-amber-50">
                  <button
                    onClick={() => setBannerWarningOpen(o => !o)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-amber-100/60 transition-colors"
                  >
                    <span className="flex items-center gap-2 text-amber-800 font-black uppercase tracking-widest text-xs">
                      <AlertTriangle className="w-4 h-4" />
                      {maintenanceGroups.warningCount} warning{maintenanceGroups.warningCount === 1 ? '' : 's'}
                      {maintenanceGroups.criticalCount === 0 && <span className="text-amber-400 font-medium normal-case tracking-normal text-[11px] ml-2">(no critical issues)</span>}
                    </span>
                    {bannerWarningOpen ? <ChevronUp className="w-4 h-4 text-amber-700" /> : <ChevronDown className="w-4 h-4 text-amber-700" />}
                  </button>
                  {bannerWarningOpen && (
                    <div className="px-4 pb-3 space-y-1.5">
                      {maintenanceGroups.warning.map(g => (
                        <div key={g.key} className="text-xs">
                          <span className="font-black text-amber-700 uppercase tracking-wider mr-2">{g.label}:</span>
                          {g.units.map((u, i) => (
                            <span key={u.id}>
                              <button onClick={() => focusFleetRow(u.id)} className="font-bold text-amber-900 hover:underline">{u.name}</button>
                              {i < g.units.length - 1 && <span className="text-amber-300">, </span>}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        <div>
          <FleetGroupedList
            fleet={fleet}
            subtypes={appData.equipmentSubtypes || []}
            mechanicTasks={mechanicTasks}
            highlightId={highlightedFleetId}
            renderSummary={(f) => (
              <span className="block">
                <span className="font-bold text-gray-800 flex items-center gap-2 flex-wrap">
                  {f.color && <span className={`w-3 h-3 rounded-full ${f.color} shadow-sm border border-gray-200 inline-block`} />}
                  {fleetItemLabel(f)}
                  {f.status !== 'Active' && <span className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0.5 rounded">{f.status}</span>}
                  <DocRenewalChip unit={f} />
                  {f.isRental && <span className="bg-purple-100 text-purple-800 text-[10px] px-1.5 py-0.5 rounded">Rental</span>}
                  {f.isWinterized && <span className="bg-sky-100 text-sky-800 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Winterized</span>}
                  {(() => {
                    // Equipment Time Off chip — current AND upcoming ranges.
                    const today = formatTodayInToronto();
                    const ranges = (f.awayDates || []).filter(r => r.start && r.end);
                    const current = ranges.find(r => today >= r.start && today <= r.end);
                    if (current) {
                      return <span className="bg-orange-100 text-orange-800 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider" title={`Booked off through ${current.end}`}>Booked off</span>;
                    }
                    const upcoming = ranges
                      .filter(r => r.start > today)
                      .sort((a, b) => a.start.localeCompare(b.start))[0];
                    if (upcoming) {
                      return <span className="bg-orange-50 text-orange-700 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border border-orange-200" title={`Scheduled off ${upcoming.start} → ${upcoming.end}`}>Booked off {upcoming.start}</span>;
                    }
                    return null;
                  })()}
                </span>
                <span className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                  {f.type.toUpperCase()} <span className={f.color ? f.color.replace('bg-', 'text-') : 'text-gray-300'}>•</span> {weightBandLabel(f) || f.weightClass}
                </span>
              </span>
            )}
            renderDetails={(f) => {
              const isOdoOutdated = isKmMaintenanceUnit(f) && !f.isWinterized && isOdoStale(f.lastOdometerUpdate);
              const isHrsStale = isHourMaintenanceUnit(f) && !f.isWinterized && (!f.lastHourUpdateAt || (Date.now() - f.lastHourUpdateAt) > 7 * 24 * 60 * 60 * 1000);
              return (
                <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4">
                  <div className="align-top">
                        {/* Legacy odometer cell — hidden for trailers
                            (N/A) AND for hour-tracked equipment (whose
                            currentEngineHours field below is the canonical
                            hour reading). Trucks/tractors and equipment
                            without hour tracking continue to use this
                            cell as the only reading. */}
                        {f.type === 'trailer' ? <span className="text-gray-400 text-sm italic">N/A</span> : (f.type === 'equipment' && f.tracksEngineHours) ? null : (
                          <div className="flex flex-col gap-1">
                            {editingOdoId === f.id ? (
                              <div className="flex items-center gap-2"><input type="number" autoFocus className="w-24 border border-green-400 rounded px-2 py-1 text-sm outline-none" value={tempOdo} onChange={e => setTempOdo(e.target.value)} /><button onClick={() => onSaveOdometer(f.id)} className="bg-green-600 text-white p-1 rounded hover:bg-green-700"><Save className="w-4 h-4" /></button><button onClick={() => setEditingOdoId(null)} className="text-gray-400"><X className="w-4 h-4" /></button></div>
                            ) : (
                              <div className="flex items-center gap-2 cursor-pointer group" onClick={() => { setEditingOdoId(f.id); setTempOdo((f.odometer || '').toString()); }}><span className="font-semibold text-gray-800 text-sm">{f.odometer ? f.odometer.toLocaleString() : '0'} {f.type === 'equipment' ? 'hrs' : 'km'}</span><PenTool className="w-3 h-3 text-gray-300 group-hover:text-green-500" /></div>
                            )}
                            <div className={`text-[10px] font-medium flex items-center gap-1 ${isOdoOutdated ? 'text-red-600' : 'text-gray-400'}`}><Clock className="w-3 h-3" /> Last: {f.lastOdometerUpdate || 'Never'} {isOdoOutdated && "(Stale)"}</div>
                          </div>
                        )}
                        {/* Engine-hours entry — only for units flagged
                            tracksEngineHours and currently active (not
                            winterized). Mirrors the odometer inline-edit
                            pattern. Save runs the auto-spawn helper. */}
                        {f.tracksEngineHours && !f.isWinterized && (
                          <div className="flex flex-col gap-1 mt-2 pt-2 border-t border-slate-100">
                            {editingHrsId === f.id ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  autoFocus
                                  min={0}
                                  step={1}
                                  value={tempHrs}
                                  onChange={e => setTempHrs(e.target.value)}
                                  className="w-24 border border-amber-400 rounded px-2 py-1 text-sm outline-none"
                                />
                                <button
                                  onClick={() => {
                                    const n = Number(tempHrs);
                                    onSaveEngineHours(f.id, Number.isFinite(n) ? n : 0);
                                    setEditingHrsId(null);
                                  }}
                                  className="bg-amber-600 text-white p-1 rounded hover:bg-amber-700"
                                >
                                  <Save className="w-4 h-4" />
                                </button>
                                <button onClick={() => setEditingHrsId(null)} className="text-gray-400">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <div
                                className="flex items-center gap-2 cursor-pointer group"
                                onClick={() => { setEditingHrsId(f.id); setTempHrs(typeof f.currentEngineHours === 'number' ? String(f.currentEngineHours) : ''); }}
                              >
                                <span className="font-semibold text-amber-700 text-sm">
                                  {typeof f.currentEngineHours === 'number' ? f.currentEngineHours.toLocaleString() : '0'} engine hrs
                                </span>
                                <PenTool className="w-3 h-3 text-gray-300 group-hover:text-amber-600" />
                              </div>
                            )}
                            <div className={`text-[10px] font-medium flex items-center gap-1 ${isHrsStale ? 'text-amber-700' : 'text-gray-400'}`}>
                              <Clock className="w-3 h-3" />
                              Last hrs: {f.lastHourUpdateAt ? new Date(f.lastHourUpdateAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Never'}
                              {isHrsStale && ' (Stale)'}
                            </div>
                            {/* Stacked maintenance items — one row per
                                schedule with current/nextDueAt + hours-
                                to-next, color-coded by overdue/due-soon/
                                normal, plus a Reset button per row that
                                opens the manual-reset modal. */}
                            {(f.maintenanceItems || []).length === 0 ? (
                              <div className="text-[11px] italic text-slate-400 mt-1">
                                No maintenance schedules configured.
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1 mt-2">
                                {(f.maintenanceItems || []).map(mi => {
                                  const cur = typeof f.currentEngineHours === 'number' ? f.currentEngineHours : 0;
                                  const toNext = mi.nextDueAt - cur;
                                  const overdue = toNext <= 0;
                                  const dueSoon = !overdue && toNext <= 25;
                                  const tintCls = overdue
                                    ? 'bg-rose-50 border-rose-200 text-rose-800'
                                    : dueSoon
                                      ? 'bg-yellow-50 border-yellow-200 text-yellow-900'
                                      : 'bg-slate-50 border-slate-200 text-slate-700';
                                  const readout = overdue
                                    ? `OVERDUE by ${Math.abs(toNext)} hrs`
                                    : dueSoon
                                      ? `DUE SOON · ${toNext} hrs`
                                      : `${toNext} hrs to next`;
                                  return (
                                    <div key={mi.id} className={`flex items-center gap-2 px-2 py-1 rounded border text-[11px] font-medium ${tintCls}`}>
                                      <Wrench className="w-3 h-3 shrink-0" />
                                      <span className="font-bold truncate">{mi.name}</span>
                                      <span className="font-mono shrink-0">{cur} / {mi.nextDueAt} hrs</span>
                                      <span className="ml-auto text-[10px] font-black uppercase tracking-widest whitespace-nowrap">{readout}</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setResetCtx({
                                            fleetId: f.id,
                                            itemId: mi.id,
                                            itemName: mi.name,
                                            defaultHours: cur,
                                            metric: 'hours',
                                            threshold: mi.threshold || 0,
                                          });
                                          setResetHrs(String(cur));
                                          setResetNextDue(String(cur + (mi.threshold || 0)));
                                          setResetNextDueLocked(true);
                                          setResetNotes('');
                                        }}
                                        className="text-[10px] font-black uppercase tracking-widest text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 shrink-0"
                                        title={`Log a ${mi.name} service`}
                                      >
                                        Reset
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                        {/* Truck km maintenance — auto, no toggle.
                            Trailers and tractors don't render here
                            (isKmMaintenanceUnit is truck-only).
                            Color-coded by km-to-next with a 500 km
                            warning window. Trucks with no configured
                            km item show an Option A placeholder row
                            ("Set next oil change due (km)") that
                            opens the reset modal — no countdown, no
                            colour alert. */}
                        {isKmMaintenanceUnit(f) && !f.isWinterized && (() => {
                          const kmItems = (f.maintenanceItems || []).filter(mi => (mi.metric || 'hours') === 'km');
                          const curKm = typeof f.odometer === 'number' ? f.odometer : 0;
                          const placeholderId = `__placeholder__-${f.id}`;
                          return (
                            <div className="flex flex-col gap-1 mt-2 pt-2 border-t border-slate-100">
                              {kmItems.map(mi => {
                                // Unconfigured items (nextDueAt <= 0) get
                                // the neutral placeholder treatment too,
                                // matching the spawn helper's skip rule.
                                if (!mi.nextDueAt || mi.nextDueAt <= 0) {
                                  return (
                                    <div key={mi.id} className="flex items-center gap-2 px-2 py-1 rounded border text-[11px] font-medium bg-slate-50 border-slate-200 text-slate-700">
                                      <Wrench className="w-3 h-3 shrink-0" />
                                      <span className="font-bold truncate">{mi.name}</span>
                                      <span className="ml-auto text-[10px] font-black uppercase tracking-widest text-amber-700 whitespace-nowrap">Set next due (km)</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setResetCtx({
                                            fleetId: f.id,
                                            itemId: mi.id,
                                            itemName: mi.name,
                                            defaultHours: curKm,
                                            metric: 'km',
                                            threshold: mi.threshold || 5000,
                                          });
                                          setResetHrs(String(curKm));
                                          setResetNextDue(String(curKm + (mi.threshold || 5000)));
                                          setResetNextDueLocked(true);
                                          setResetNotes('');
                                        }}
                                        className="text-[10px] font-black uppercase tracking-widest text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 shrink-0"
                                        title="Set the next oil change km"
                                      >
                                        Set
                                      </button>
                                    </div>
                                  );
                                }
                                const toNext = mi.nextDueAt - curKm;
                                const overdue = toNext <= 0;
                                const dueSoon = !overdue && toNext <= 500;
                                const tintCls = overdue
                                  ? 'bg-rose-50 border-rose-200 text-rose-800'
                                  : dueSoon
                                    ? 'bg-yellow-50 border-yellow-200 text-yellow-900'
                                    : 'bg-slate-50 border-slate-200 text-slate-700';
                                const readout = overdue
                                  ? `OVERDUE by ${Math.abs(toNext).toLocaleString()} km`
                                  : dueSoon
                                    ? `DUE SOON · ${toNext.toLocaleString()} km`
                                    : `${toNext.toLocaleString()} km to next`;
                                return (
                                  <div key={mi.id} className={`flex items-center gap-2 px-2 py-1 rounded border text-[11px] font-medium ${tintCls}`}>
                                    <Wrench className="w-3 h-3 shrink-0" />
                                    <span className="font-bold truncate">{mi.name}</span>
                                    <span className="font-mono shrink-0">{curKm.toLocaleString()} / {mi.nextDueAt.toLocaleString()} km</span>
                                    <span className="ml-auto text-[10px] font-black uppercase tracking-widest whitespace-nowrap">{readout}</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setResetCtx({
                                          fleetId: f.id,
                                          itemId: mi.id,
                                          itemName: mi.name,
                                          defaultHours: curKm,
                                          metric: 'km',
                                          threshold: mi.threshold || 0,
                                        });
                                        setResetHrs(String(curKm));
                                        setResetNextDue(String(curKm + (mi.threshold || 0)));
                                        setResetNextDueLocked(true);
                                        setResetNotes('');
                                      }}
                                      className="text-[10px] font-black uppercase tracking-widest text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 shrink-0"
                                      title={`Log a ${mi.name} service`}
                                    >
                                      Reset
                                    </button>
                                  </div>
                                );
                              })}
                              {kmItems.length === 0 && (
                                <div className="flex items-center gap-2 px-2 py-1 rounded border text-[11px] font-medium bg-slate-50 border-slate-200 text-slate-700">
                                  <Wrench className="w-3 h-3 shrink-0" />
                                  <span className="font-bold truncate">Oil change</span>
                                  <span className="ml-auto text-[10px] font-black uppercase tracking-widest text-amber-700 whitespace-nowrap">Set next due (km)</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      // Virtual placeholder — the reset
                                      // modal will pass placeholderDefaults
                                      // through to onManualResetMaintenance
                                      // which materialises the real item.
                                      setResetCtx({
                                        fleetId: f.id,
                                        itemId: placeholderId,
                                        itemName: 'Oil change',
                                        defaultHours: curKm,
                                        metric: 'km',
                                        threshold: 5000,
                                      });
                                      setResetHrs(String(curKm));
                                      setResetNextDue(String(curKm + 5000));
                                      setResetNextDueLocked(true);
                                      setResetNotes('');
                                    }}
                                    className="text-[10px] font-black uppercase tracking-widest text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 shrink-0"
                                    title="Set the initial next oil change km"
                                  >
                                    Set
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                  </div>
                  <div className="align-top">
                        <div className="space-y-1.5 text-xs">
                          {f.type !== 'equipment' && (() => {
                            const plateGate = needsPlateRenewal(f);
                            const safetyGate = needsCommercialSafety(f);
                            const regClass = plateGate && (isExpiringSoon(f.regExpiry) || isExpired(f.regExpiry)) ? 'bg-red-50 text-red-700 font-bold' : 'bg-gray-50 text-gray-600';
                            const safetyClass = safetyGate && (isExpiringSoon(f.safetyExpiry) || isExpired(f.safetyExpiry)) ? 'bg-red-50 text-red-700 font-bold' : 'bg-gray-50 text-gray-600';
                            return (
                              <>
                                <div className="flex justify-between items-center px-2 py-1 rounded bg-gray-50 text-gray-600">
                                  <span>Plate:</span><span className="font-mono">{f.plateNumber || '—'}</span>
                                </div>
                                <div className={`flex justify-between items-center px-2 py-1 rounded ${regClass}`}>
                                  <span>Plate Renewal:</span>
                                  <span>{plateGate ? (f.regExpiry || 'Not set') : <span className="italic text-gray-400 font-normal">No renewal required</span>}</span>
                                </div>
                                {safetyGate ? (
                                  <div className={`flex justify-between items-center px-2 py-1 rounded ${safetyClass}`}>
                                    <span>Commercial Safety:</span><span>{f.safetyExpiry || 'Not set'}</span>
                                  </div>
                                ) : (
                                  <div className="flex justify-between items-center px-2 py-1 rounded bg-gray-50 text-gray-400 italic">
                                    <span>Commercial Safety:</span><span>No safety required</span>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                          {f.isRental && <div className="flex justify-between items-center bg-purple-50 text-purple-800 px-2 py-1 rounded font-bold"><span>Return:</span><span>{f.rentalEnd || 'Not set'}</span></div>}
                        </div>
                  </div>
                  <div className="md:border-l md:border-gray-100 md:pl-4 flex items-start">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => onOpenUnitHistory(f)}
                            title="View History"
                            aria-label="View History"
                            className="relative w-7 h-7 inline-flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 shadow-sm transition-colors"
                          >
                            <BookOpen className="w-4 h-4" />
                            {(() => {
                              const fnLen = Array.isArray(f.notes) ? f.notes.length : 0;
                              return fnLen > 0 ? (
                                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full bg-emerald-500 text-white text-[9px] font-black leading-none">
                                  {fnLen}
                                </span>
                              ) : null;
                            })()}
                          </button>
                          <button
                            onClick={() => onOpenManualTask(f)}
                            title="Schedule Repair"
                            aria-label="Schedule Repair"
                            className="w-7 h-7 inline-flex items-center justify-center rounded-full bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm transition-colors"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onToggleWinterize(f.id)}
                            title={f.isWinterized ? 'Reactivate this unit' : 'Mark winterized — hides from active fleet'}
                            aria-label={f.isWinterized ? 'Reactivate unit' : 'Winterize unit'}
                            className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded border whitespace-nowrap ${
                              f.isWinterized
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                : 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100'
                            }`}
                          >
                            {f.isWinterized ? 'Reactivate' : 'Winterize'}
                          </button>
                        </div>
                  </div>
                </div>
              );
            }}
          />
        </div>
        </div>
      )}

      {/* Manual maintenance reset modal — small inline dialog. Captures
          hours-at-service + optional notes; submit calls App.tsx's
          onManualResetMaintenance which advances the schedule, deletes
          any active spawned task, and writes an Inspection Log entry. */}
      {resetCtx && (
        <div
          className="fixed inset-0 bg-black/60 z-[110] flex md:items-center md:justify-center md:p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setResetCtx(null); }}
        >
          <div className="bg-white md:rounded-2xl shadow-2xl h-full md:h-auto w-full md:max-w-md overflow-hidden flex flex-col">
            <div className="p-5 border-b border-gray-200 bg-slate-900 text-white flex justify-between items-center">
              <div className="flex items-center gap-3">
                <Wrench className="w-6 h-6 text-emerald-400" />
                <h3 className="text-xl font-bold">Manual Reset · {resetCtx.itemName}</h3>
              </div>
              <button onClick={() => setResetCtx(null)} className="text-white/60 hover:text-white min-w-[44px] min-h-[44px] inline-flex items-center justify-center">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">
                  {resetCtx.metric === 'km' ? 'Odometer (km) at service' : 'Engine hours at service'}
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={resetHrs}
                  onChange={e => {
                    const v = e.target.value;
                    setResetHrs(v);
                    // Keep the next-due pre-fill in lockstep with the
                    // reading while the field stays locked; the user
                    // gets a sensible default until they click Edit.
                    if (resetNextDueLocked) {
                      const n = Number(v);
                      if (Number.isFinite(n)) {
                        setResetNextDue(String(n + (resetCtx.threshold || 0)));
                      }
                    }
                  }}
                  autoFocus
                  className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-400"
                />
                <div className="text-[11px] text-slate-500">
                  {resetCtx.metric === 'km'
                    ? "Replaces the truck's current odometer reading."
                    : 'Replaces the unit\'s current engine hours.'}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">
                  Next service due ({resetCtx.metric === 'km' ? 'km' : 'hrs'})
                </label>
                <div className="flex items-center gap-2">
                  {resetNextDueLocked ? (
                    <div className="flex-1 bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-mono font-bold text-slate-700">
                      {resetNextDue !== '' ? `${resetNextDue} ${resetCtx.metric === 'km' ? 'km' : 'hrs'}` : '—'}
                    </div>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={resetNextDue}
                      onChange={e => setResetNextDue(e.target.value)}
                      className="flex-1 bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-400"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setResetNextDueLocked(v => !v)}
                    className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700 hover:bg-emerald-50 rounded-lg border border-emerald-200"
                    title={resetNextDueLocked ? 'Override the pre-filled default' : 'Accept the pre-filled default'}
                  >
                    {resetNextDueLocked ? 'Edit' : 'Lock'}
                  </button>
                </div>
                <div className="text-[11px] text-slate-500">Locked = reading + configured interval. Click Edit to override.</div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Notes (optional)</label>
                <textarea
                  rows={3}
                  value={resetNotes}
                  onChange={e => setResetNotes(e.target.value)}
                  placeholder="What was done, who did it, parts used, etc."
                  className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-400 resize-none"
                />
              </div>
            </div>
            <div className="p-4 border-t border-slate-200 bg-white flex justify-end gap-2">
              <button
                onClick={() => setResetCtx(null)}
                className="min-h-[44px] px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const n = Number(resetHrs);
                  if (!Number.isFinite(n) || n < 0) return;
                  // Always pass an explicit next-due now — for hours
                  // items it locks in whatever the locked-with-edit
                  // field shows (default = reading + interval, or the
                  // mechanic's override).
                  const nd = Number(resetNextDue);
                  if (!Number.isFinite(nd) || nd < 0) return;
                  // Virtual placeholder ids are tagged so the App.tsx
                  // upsert path knows to materialise a new item from
                  // these defaults rather than search for an existing
                  // one. Real items don't carry the prefix.
                  const isPlaceholder = resetCtx.itemId.startsWith('__placeholder__-');
                  const placeholderDefaults = isPlaceholder ? {
                    name: resetCtx.itemName,
                    threshold: resetCtx.threshold,
                    metric: resetCtx.metric,
                  } : undefined;
                  onManualResetMaintenance(resetCtx.fleetId, resetCtx.itemId, n, resetNotes || undefined, nd, placeholderDefaults);
                  setResetCtx(null);
                }}
                disabled={
                  !Number.isFinite(Number(resetHrs)) || Number(resetHrs) < 0 ||
                  !Number.isFinite(Number(resetNextDue)) || Number(resetNextDue) < 0
                }
                className="min-h-[44px] px-5 py-2.5 text-sm font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                Log Service
              </button>
            </div>
          </div>
        </div>
      )}

      {photoViewer && (
        <PhotoViewer files={photoViewer.files} startIndex={photoViewer.idx} onClose={() => setPhotoViewer(null)} />
      )}
    </div>
  );
}

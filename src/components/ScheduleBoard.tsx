import { useState, useMemo, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction, ReactNode, DragEvent, ComponentType } from 'react';
import {
  CalendarDays, Calendar as CalendarIcon, ChevronLeft, ChevronRight,
  Filter, CloudSun, Cloud, Printer, Plus, Trash2, Users, Truck,
  ChevronDown, ChevronUp, X, Package, Hammer, Flame, CheckCircle, AlertTriangle, AlertCircle,
  TrendingUp, CreditCard as IdCard, Copy, ClipboardPaste, ShieldCheck,
  Moon, Lock, Link2, ArrowLeft, Plane, CalendarRange, UserCheck
} from 'lucide-react';
import { AppData, Crew, Employee, FleetItem, OverrideRecord, UserRole, JobberUser, MechanicTask, CapacityForecast, CapacityScope, CapacitySettings, HourlyEstimate } from '../types';
import DispatchConfirmModal from './DispatchConfirmModal';
import { logPerfActivity } from '../lib/perfAudit';
import { DIVISIONS, CREW_NUMBERS, EOD_WARNING_HOUR, PERMISSION_DENIED } from '../constants';
import { can, canForCrew } from '../lib/permissions';
import { getResourceAvailability, describeUnavailability, shortStatusLabel, ResourceType } from '../lib/availability';
import { formatDate, addDays, formatTodayInToronto, addDaysToronto, formatTimeRange } from '../lib/dateUtils';
import { resolveWeightBand } from '../lib/fleetUtils';
import { sortFleetGrouped, fleetItemLabel, isFleetOutOfService } from '../lib/fleetUtils';
import { getUnitReadiness } from '../lib/inspectionUtils';
import { isHourMaintenanceUnit } from '../lib/maintenanceUtils';
import type { ActiveInspectionState } from './InspectionModal';
import CrewCardWarning from './CrewCardWarning';
import OverrideModal from './OverrideModal';
import EndDayModal from './EndDayModal';
import BookedOffCalendar from './BookedOffCalendar';
import AvailabilityView from './AvailabilityView';
import CapacityCalendar from './CapacityCalendar';

const getCrewColors = (div: string, num: number) => {
  const palettes: Record<string, string[]> = {
    'Large Projects': ['bg-green-800 text-white border-green-900', 'bg-green-600 text-white border-green-700', 'bg-green-500 text-white border-green-600', 'bg-green-400 text-green-900 border-green-500', 'bg-green-300 text-green-900 border-green-400', 'bg-green-200 text-green-900 border-green-300'],
    'Lawn Division': ['bg-green-800 text-white border-green-900', 'bg-green-600 text-white border-green-700', 'bg-green-500 text-white border-green-600', 'bg-green-400 text-green-900 border-green-500', 'bg-green-300 text-green-900 border-green-400', 'bg-green-200 text-green-900 border-green-300'],
    'Small Projects': ['bg-purple-800 text-white border-purple-900', 'bg-purple-600 text-white border-purple-700', 'bg-purple-500 text-white border-purple-600', 'bg-purple-400 text-purple-900 border-purple-500', 'bg-purple-300 text-purple-900 border-purple-400', 'bg-purple-200 text-purple-900 border-purple-300']
  };
  const shades = palettes[div] || palettes['Large Projects'];
  return shades[Math.min(num - 1, 5)];
};

interface ScheduleBoardProps {
  appData: AppData;
  setAppData: Dispatch<SetStateAction<AppData>>;
  syncToCloud: (data: AppData) => Promise<boolean | undefined>;
  showToastMsg: (msg: string) => void;

  scheduleMode: 'daily' | 'weekly';
  setScheduleMode: Dispatch<SetStateAction<'daily' | 'weekly'>>;
  selectedDailyDate: string;
  setSelectedDailyDate: Dispatch<SetStateAction<string>>;
  crewFilter: string;
  setCrewFilter: Dispatch<SetStateAction<string>>;
  copiedDay: any;

  weekDays: Date[];
  startOfWeek: Date;

  canEditSchedule: boolean;
  canManageResources: boolean;

  weather: Record<string, any>;
  getWeatherIcon: (code: number | undefined) => ReactNode;
  getWeatherDescription: (code: number | undefined) => string;

  ClassAIcon: ComponentType<{ className?: string; title?: string }>;
  SkidSteerIcon: ComponentType<{ className?: string; title?: string }>;

  userEmail: string;
  userName: string;
  isManager: boolean;
  effectiveRole: UserRole;
  currentUserEmployee: Employee | null;
  draggingResource: { type: ResourceType; id: string } | null;
  clearDrag: () => void;

  setActiveInspection: Dispatch<SetStateAction<ActiveInspectionState>>;
  setViewingInspectionId: Dispatch<SetStateAction<string | null>>;
  setIsWeatherModalOpen: Dispatch<SetStateAction<boolean>>;

  handlePrevWeek: () => void;
  handleNextWeek: () => void;
  handleToday: () => void;
  handlePrint: () => void;
  handleCopyDay: (date: string) => void;
  handlePasteDay: (date: string) => void;
  addCrewToDay: (date: string) => void;

  jobberUsers: JobberUser[];
  jobberConnected: boolean;

  // CAPACITY view — the same component SalesMaster mounts, swapped into the
  // board body by the toggle below (mirrors "Booked off").
  capacityForecasts: Record<CapacityScope, CapacityForecast | null>;
  onRefreshCapacity: (scope: CapacityScope) => Promise<void>;
  canRefreshCapacity: boolean;
  onSaveCapacitySettings: (next: CapacitySettings) => Promise<void>;
  hourlyEstimates: Record<string, HourlyEstimate>;
  onSetHourlyEstimate: (visitId: string, bh: number | null, label?: string) => void | Promise<void>;
  isAdmin: boolean;
}

export default function ScheduleBoard({
  appData,
  setAppData,
  syncToCloud,
  showToastMsg,
  scheduleMode,
  setScheduleMode,
  selectedDailyDate,
  setSelectedDailyDate,
  crewFilter,
  setCrewFilter,
  copiedDay,
  weekDays,
  startOfWeek,
  canEditSchedule,
  canManageResources,
  weather,
  getWeatherIcon,
  getWeatherDescription,
  ClassAIcon,
  SkidSteerIcon,
  userEmail,
  userName,
  isManager,
  effectiveRole,
  currentUserEmployee,
  draggingResource,
  clearDrag,
  setActiveInspection,
  setViewingInspectionId,
  setIsWeatherModalOpen,
  handlePrevWeek,
  handleNextWeek,
  handleToday,
  handlePrint,
  handleCopyDay,
  handlePasteDay,
  addCrewToDay,
  jobberUsers,
  jobberConnected,
  capacityForecasts,
  onRefreshCapacity,
  canRefreshCapacity,
  onSaveCapacitySettings,
  hourlyEstimates,
  onSetHourlyEstimate,
  isAdmin,
}: ScheduleBoardProps) {
  const [overrideModalCtx, setOverrideModalCtx] = useState<{
    dateString: string;
    crewId: string;
    type: string;
    unitId: string;
    warningMessage: string;
    title: string;
    // When set, confirming the override also assigns the unit to the crew
    // (used for adding an out-of-service unit through an override).
    addUnit?: boolean;
  } | null>(null);
  const [expandedAudit, setExpandedAudit] = useState<Record<string, boolean>>({});
  const [copyCrewCtx, setCopyCrewCtx] = useState<{ sourceDate: string; crewId: string; targetDate: string } | null>(null);
  const [endDayCtx, setEndDayCtx] = useState<{ dateString: string; crewId: string } | null>(null);
  const [dispatchCtx, setDispatchCtx] = useState<{ dateString: string; crew: Crew; pendingOverrides: OverrideRecord[]; overrideKey: string } | null>(null);
  // "Booked off" mode swaps the whole board body for the monthly approved
  // time-off view. Off by default; toggling returns to the normal board.
  const [bookedOffView, setBookedOffView] = useState(false);
  // "Capacity" mode does the same with the forward capacity calendar —
  // exactly the view SalesMaster hosts, mounted here. The two modes are
  // mutually exclusive: turning one on turns the other off.
  const [capacityView, setCapacityView] = useState(false);
  // "Availability" does the same with the who's-free-today view. All three alt
  // views are mutually exclusive: turning one on turns the others off.
  const [availabilityView, setAvailabilityView] = useState(false);
  const altView = bookedOffView || capacityView || availabilityView;
  // A division manager opens the booked-off view on their own division;
  // admins / all-division managers open on "All". Mirrors the crewFilter
  // division mapping used across the board.
  const bookedOffDefaultDivision =
    currentUserEmployee?.managedDivision === 'lawn' ? 'Lawn Division'
      : currentUserEmployee?.managedDivision === 'small' ? 'Small Projects'
        : currentUserEmployee?.managedDivision === 'large' ? 'Large Projects'
          : 'All';

  const finalizeDispatch = (newMechanicTask: MechanicTask | null) => {
    if (!dispatchCtx) return;
    const { dateString, crew, pendingOverrides, overrideKey } = dispatchCtx;
    const newSchedules = { ...appData.schedules };
    newSchedules[dateString] = (newSchedules[dateString] || []).map(c =>
      c.id === crew.id
        ? { ...c, dispatched: true, dispatchOverrides: pendingOverrides.length > 0 ? pendingOverrides : undefined }
        : c,
    );
    const newOverrides = { ...(appData.overrides || {}) };
    delete newOverrides[overrideKey];
    const next: AppData = { ...appData, schedules: newSchedules, overrides: newOverrides };
    if (newMechanicTask) {
      next.mechanicTasks = [newMechanicTask, ...(appData.mechanicTasks || [])];
    }
    syncToCloud(next);
    if (newMechanicTask) {
      logPerfActivity({
        type: 'dispatch_issue_reported',
        targetDate: dateString,
        crewId: crew.id,
        crewLabel: `${crew.division} #${crew.crewNumber}`,
        userId: userEmail,
        userName,
        userRole: effectiveRole,
        valueLabel: newMechanicTask.category,
        reason: newMechanicTask.severity,
        reasonNote: `Reported issue on ${newMechanicTask.unitName}: ${newMechanicTask.description}`,
      });
      showToastMsg('Issue reported. Mechanic notified. Crew dispatched.');
    } else {
      showToastMsg(`${crew.division} #${crew.crewNumber} dispatched!`);
    }
    setDispatchCtx(null);
  };

  const [jobberPickerCrewId, setJobberPickerCrewId] = useState<string | null>(null);
  const [jobberPickerSearch, setJobberPickerSearch] = useState('');
  const [jobberPickerPos, setJobberPickerPos] = useState<{ top: number; left: number; width: number; placeAbove: boolean; listMaxHeight: number } | null>(null);
  const jobberPickerRef = useRef<HTMLDivElement | null>(null);

  const openJobberPicker = (crewId: string, triggerEl: HTMLElement) => {
    const rect = triggerEl.getBoundingClientRect();
    const margin = 16;
    const availableBelow = window.innerHeight - rect.bottom - margin;
    const availableAbove = rect.top - margin;
    const placeAbove = availableBelow < 240 && availableAbove > availableBelow;
    const space = placeAbove ? availableAbove : availableBelow;
    // Reserve ~64px for the search input + popover padding
    const listMaxHeight = Math.max(160, Math.min(360, space - 64));
    const desiredWidth = Math.max(rect.width, 260);
    const maxLeft = Math.max(margin, window.innerWidth - desiredWidth - margin);
    const clampedLeft = Math.min(Math.max(margin, rect.left), maxLeft);
    const finalWidth = Math.min(desiredWidth, window.innerWidth - 2 * margin);
    setJobberPickerPos({
      top: placeAbove ? rect.top - 4 : rect.bottom + 4,
      left: clampedLeft,
      width: finalWidth,
      placeAbove,
      listMaxHeight,
    });
    setJobberPickerCrewId(crewId);
    setJobberPickerSearch('');
  };

  const closeJobberPicker = () => {
    setJobberPickerCrewId(null);
    setJobberPickerSearch('');
    setJobberPickerPos(null);
  };

  const jobberUsersById = useMemo(() => {
    const m = new Map<string, JobberUser>();
    jobberUsers.forEach(u => m.set(u.id, u));
    return m;
  }, [jobberUsers]);

  const sortedJobberUsers = useMemo(() => {
    const isCrewLike = (name: string) => /#/.test(name) || /^(plow|pre|sub)/i.test(name);
    return [...jobberUsers].sort((a, b) => {
      const aCrew = isCrewLike(a.name), bCrew = isCrewLike(b.name);
      if (aCrew !== bCrew) return aCrew ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [jobberUsers]);

  useEffect(() => {
    if (!jobberPickerCrewId) return;
    const onDocClick = (e: MouseEvent) => {
      if (jobberPickerRef.current && !jobberPickerRef.current.contains(e.target as Node)) {
        closeJobberPicker();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [jobberPickerCrewId]);

  const toggleJobberAssignee = (dateString: string, crewId: string, userId: string) => {
    const targetCrew = (appData.schedules[dateString] || []).find(c => c.id === crewId);
    const currentList = targetCrew?.jobberAssigneeIds || [];
    const isAdding = !currentList.includes(userId);
    // Removing is always safe — no conflict possible. Adding requires
    // the user not already be tagged on a different crew that date.
    if (isAdding) {
      const conflictStatus = getResourceAvailability(userId, 'jobberAssignee', dateString, appData);
      if (conflictStatus.status === 'assigned' && conflictStatus.crewId !== crewId) {
        const userName = jobberUsersById.get(userId)?.name || userId;
        showToastMsg(`${userName} is already tagged on ${conflictStatus.crewName}. Remove there first or pick a different assignee.`);
        return;
      }
    }
    const newSchedules = { ...appData.schedules };
    newSchedules[dateString] = (newSchedules[dateString] || []).map(c => {
      if (c.id !== crewId) return c;
      const current = c.jobberAssigneeIds || [];
      const next = current.includes(userId)
        ? current.filter(id => id !== userId)
        : Array.from(new Set([...current, userId]));
      return { ...c, jobberAssigneeIds: next };
    });
    syncToCloud({ ...appData, schedules: newSchedules });
  };

  const removeJobberAssignee = (dateString: string, crewId: string, userId: string) => {
    const newSchedules = { ...appData.schedules };
    newSchedules[dateString] = (newSchedules[dateString] || []).map(c =>
      c.id !== crewId ? c : { ...c, jobberAssigneeIds: (c.jobberAssigneeIds || []).filter(id => id !== userId) }
    );
    syncToCloud({ ...appData, schedules: newSchedules });
  };

  const handleCopyCrew = (sourceDate: string, sourceCrewId: string, targetDate: string) => {
    const source = (appData.schedules[sourceDate] || []).find(c => c.id === sourceCrewId);
    if (!source) return;

    const today = formatTodayInToronto();
    if (targetDate < today) {
      if (!confirm(`Copying to past date (${targetDate}). Continue?`)) return;
    }

    const targetDayCrews = appData.schedules[targetDate] || [];
    // Pick crew number: prefer source.crewNumber within the same division, else next available.
    const takenInDivision = new Set(
      targetDayCrews.filter(c => c.division === source.division).map(c => c.crewNumber)
    );
    let nextNumber = source.crewNumber;
    if (takenInDivision.has(nextNumber)) {
      const candidates = (CREW_NUMBERS as number[]).slice().sort((a, b) => a - b);
      const free = candidates.find(n => !takenInDivision.has(n));
      if (free === undefined) {
        showToastMsg(`No free crew slots for ${source.division} on ${targetDate}.`);
        return;
      }
      nextNumber = free;
    }

    const newCrew: Crew = {
      id: `crew-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      division: source.division,
      crewNumber: nextNumber,
      employees: [...source.employees],
      fleet: [...source.fleet],
      inventory: source.inventory ? source.inventory.map(i => ({ ...i })) : [],
      isAdHoc: source.isAdHoc,
      notes: source.notes || '',
      supplies: source.supplies ? [...source.supplies] : [],
      // Reset run-time state — target day needs its own inspections / dispatch
      dispatched: false,
      dispatchOverrides: []
    };

    const newSchedules = { ...appData.schedules, [targetDate]: [...targetDayCrews, newCrew] };
    syncToCloud({ ...appData, schedules: newSchedules });
    showToastMsg(`Copied ${source.division} #${source.crewNumber} → ${targetDate} as #${nextNumber}`);
    setCopyCrewCtx(null);
  };

  const confirmOverride = (reason: string) => {
    if (!overrideModalCtx) return;
    const { dateString, crewId, type, unitId, warningMessage, addUnit } = overrideModalCtx;
    const key = `${dateString}|${crewId}`;
    const newRecord: OverrideRecord = {
      id: `ov-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      unitId,
      warningMessage,
      overriddenBy: userEmail,
      overriddenByName: userName,
      timestamp: new Date().toISOString(),
      reason: reason.trim() || undefined,
    };
    const newOverrides = {
      ...(appData.overrides || {}),
      [key]: [...((appData.overrides || {})[key] || []), newRecord],
    };
    const next: AppData = { ...appData, overrides: newOverrides };
    // "Add out-of-service unit" overrides also assign the unit to the crew,
    // so it lands on the crew with its OOS card warning already overridden.
    if (addUnit) {
      next.schedules = {
        ...appData.schedules,
        [dateString]: (appData.schedules[dateString] || []).map(c =>
          c.id === crewId && !c.fleet.includes(unitId)
            ? { ...c, fleet: [...c.fleet, unitId] }
            : c,
        ),
      };
    }
    syncToCloud(next);
    setOverrideModalCtx(null);
  };

  const getInvName = (id: string) => appData.inventory.find(i => i.id === id)?.name || 'Unknown Item';

  const updateCrewItem = (dateString: string, crewId: string, type: string, action: string, itemData: any) => {
    const daySchedules = appData.schedules[dateString] || [];
    const newSchedules = { ...appData.schedules };

    newSchedules[dateString] = daySchedules.map(crew => {
      if (crew.id !== crewId) return crew;
      const updated = { ...crew };

      if (type === 'employee' || type === 'fleet') {
        const key = type === 'employee' ? 'employees' : 'fleet';
        const list = [...updated[key]];
        if (action === 'add' && !list.includes(itemData)) list.push(itemData);
        if (action === 'remove') updated[key] = list.filter(id => id !== itemData);
        else updated[key] = list;
      } else if (type === 'inventory') {
        let invList = [...(updated.inventory || [])];
        if (action === 'add') {
          const existing = invList.find(i => i.id === itemData.id);
          if (existing) existing.qty += itemData.qty; else invList.push(itemData);
          // Deduct from global stock
          const newInv = appData.inventory.map(inv => inv.id === itemData.id ? { ...inv, stock: inv.stock - itemData.qty } : inv);
          setAppData(prev => ({ ...prev, inventory: newInv })); // optimistic local update
        }
        if (action === 'remove') {
          const item = invList.find(i => i.id === itemData);
          if (item) {
            // Return to global stock
            const newInv = appData.inventory.map(inv => inv.id === itemData ? { ...inv, stock: inv.stock + item.qty } : inv);
            setAppData(prev => ({ ...prev, inventory: newInv }));
            invList = invList.filter(i => i.id !== itemData);
          }
        }
        updated.inventory = invList;
      }
      return updated;
    });
    syncToCloud({ ...appData, schedules: newSchedules });
  };

  const onDrop = (e: DragEvent, dateString: string, crewId: string) => {
    e.preventDefault();
    clearDrag();
    if (scheduleMode !== 'daily') return; // weekly view does not accept drops
    try {
      const { type, id } = JSON.parse(e.dataTransfer.getData('text/plain'));
      const rType: ResourceType = type === 'fleet' ? 'fleet' : 'employee';

      // Permission: must be able to edit this crew. Foreman: own crew only.
      const targetCrew = (appData.schedules[dateString] || []).find(c => c.id === crewId) || null;
      const allowed = can('canEditAnyCrew', effectiveRole) || canForCrew('canEditOwnCrew', effectiveRole, currentUserEmployee, targetCrew);
      if (!allowed) {
        showToastMsg('Permission denied.');
        return;
      }

      // Availability: hard block on absent / booked_off / assigned. An
      // out-of-service fleet unit is not hard-blocked — a manager can add it
      // by confirming an override.
      const status = getResourceAvailability(id, rType, dateString, appData);
      if (status.status !== 'available') {
        if (status.status === 'oos' && rType === 'fleet' && isManager) {
          const unit = appData.fleet.find(f => f.id === id);
          setOverrideModalCtx({
            dateString,
            crewId,
            type: 'oos',
            unitId: id,
            warningMessage: `${unit?.name || 'This unit'} is Out of Service. Adding it to this crew requires an override.`,
            title: 'Add Out-of-Service Unit',
            addUnit: true,
          });
          return;
        }
        const resourceName = (rType === 'employee' ? appData.employees.find(e => e.id === id)?.name : appData.fleet.find(f => f.id === id)?.name) || 'Resource';
        showToastMsg(describeUnavailability(status, resourceName));
        return;
      }

      updateCrewItem(dateString, crewId, type, 'add', id);
    } catch (err) { }
  };

  const renderCrewCard = (dateString: string, crew: Crew, dayWeather: any) => {
    const crewEmps = crew.employees.map(id => appData.employees.find(e => e.id === id)).filter((e): e is Employee => !!e);
    const crewFleet = crew.fleet.map(id => appData.fleet.find(f => f.id === id)).filter((f): f is FleetItem => !!f);
    const crewInv = crew.inventory || [];

    const warnings: string[] = [];
    if (crewFleet.some(f => f.type === 'truck') && crewEmps.length > 0 && !crewEmps.some(e => e.hasLicense || e.hasClassA)) warnings.push("Needs licensed driver");
    if (crewFleet.some(f => resolveWeightBand(f) === '10999_plus') && crewEmps.length > 0 && !crewEmps.some(e => e.hasClassA)) warnings.push("Needs Class A Driver");

    // Card-level safety warnings (overridable)
    const cardWarnings: { type: string; unitId: string; message: string }[] = [];
    crewFleet.forEach(unit => {
      if (unit.status === 'Out of Service') {
        cardWarnings.push({ type: 'oos', unitId: unit.id, message: `${unit.name} is Out of Service` });
      }
    });
    const trucksOnCrew = crewFleet.filter(f => f.type === 'truck');
    const trailersOnCrew = crewFleet.filter(f => f.type === 'trailer');
    trucksOnCrew.forEach(truck => {
      trailersOnCrew.forEach(trailer => {
        if (truck.hasRampRack) {
          cardWarnings.push({
            type: 'pin-mismatch',
            unitId: `${truck.id}|${trailer.id}`,
            message: `${truck.name} has a ramp rack — incompatible with ${trailer.name}`,
          });
        } else if (trailer.trailerPin && !(truck.connectorPins || []).includes(trailer.trailerPin)) {
          cardWarnings.push({
            type: 'pin-mismatch',
            unitId: `${truck.id}|${trailer.id}`,
            message: `${truck.name} does not have a ${trailer.trailerPin} connector required by ${trailer.name}`,
          });
        }
      });
    });

    const overrideKey = `${dateString}|${crew.id}`;
    const pendingOverrides = (appData.overrides || {})[overrideKey] || [];
    const findOverride = (w: { type: string; unitId: string }) =>
      pendingOverrides.find(o => o.type === w.type && o.unitId === w.unitId);
    const allWarningsOverridden = cardWarnings.length > 0 && cardWarnings.every(w => !!findOverride(w));
    const hasUnoverriddenWarnings = cardWarnings.some(w => !findOverride(w));

    const colorClasses = getCrewColors(crew.division, crew.crewNumber);

    // Build availability-annotated option lists. Available items first, unavailable greyed out below.
    type EmpOpt = { emp: Employee; avail: ReturnType<typeof getResourceAvailability> };
    type FleetOpt = { f: FleetItem; avail: ReturnType<typeof getResourceAvailability> };
    const empOptions: EmpOpt[] = appData.employees
      // Palermo's contractors are a separate tenant — never assignable to
      // Marco's crews (keeps them out of all performance/BH/bonus/pay).
      .filter(e => e.systemRole !== 'contractor')
      .filter(e => !crew.employees.includes(e.id))
      .map(e => ({ emp: e, avail: getResourceAvailability(e.id, 'employee', dateString, appData) }))
      .sort((a, b) => Number(a.avail.status !== 'available') - Number(b.avail.status !== 'available'));
    const fleetOptions: FleetOpt[] = sortFleetGrouped(appData.fleet.filter(f => !crew.fleet.includes(f.id)), appData.equipmentSubtypes || [])
      .map(f => ({ f, avail: getResourceAvailability(f.id, 'fleet', dateString, appData) }))
      .sort((a, b) => Number(a.avail.status !== 'available') - Number(b.avail.status !== 'available'));

    // Drag conflict tint: if a resource is being dragged and dropping it on this crew would be
    // blocked, paint the crew card rose. Daily mode only — weekly has no drop targets.
    const dragConflict = !!draggingResource && scheduleMode === 'daily' && (() => {
      const s = getResourceAvailability(draggingResource!.id, draggingResource!.type, dateString, appData);
      if (s.status === 'available') return false;
      // OOS fleet can still be added via an override — not a hard conflict.
      if (s.status === 'oos' && draggingResource!.type === 'fleet' && isManager) return false;
      return true;
    })();
    const dragHighlightAllowed = !!draggingResource && scheduleMode === 'daily' && !dragConflict;

    return (
      <div
        key={crew.id}
        className={`bg-white rounded-xl shadow-sm border overflow-hidden mb-4 print:break-inside-avoid print:shadow-none flex flex-col transition-colors ${dragConflict ? 'border-rose-400 ring-2 ring-rose-200' : dragHighlightAllowed ? 'border-emerald-400 ring-2 ring-emerald-100' : 'border-gray-200'}`}
        onDragOver={scheduleMode === 'daily' ? (e => e.preventDefault()) : undefined}
        onDrop={scheduleMode === 'daily' ? (e => onDrop(e, dateString, crew.id)) : undefined}
      >

        {/* Header Ribbon */}
        <div className={`px-3 py-2 flex justify-between items-center ${colorClasses}`}>
          <div className="flex items-center gap-2 w-full">
            {!canEditSchedule ? (
              <div className="flex-1 text-sm font-bold px-1 truncate">{crew.division}</div>
            ) : (
              <select className="text-sm font-bold bg-transparent outline-none flex-1 appearance-none cursor-pointer text-inherit" value={crew.division} onChange={(e) => { const newSchedules = { ...appData.schedules }; newSchedules[dateString] = newSchedules[dateString].map(c => c.id === crew.id ? { ...c, division: e.target.value } : c); syncToCloud({ ...appData, schedules: newSchedules }); }}>
                {DIVISIONS.map(d => <option key={d} value={d} className="text-gray-900">{d}</option>)}
              </select>
            )}
            {!canEditSchedule ? (
              <div className="text-sm font-bold w-10 text-center border-l border-white/20 pl-2">#{crew.crewNumber}</div>
            ) : (
              <select className="text-sm font-bold bg-transparent outline-none w-10 text-center appearance-none cursor-pointer text-inherit border-l border-white/20 pl-2" value={crew.crewNumber} onChange={(e) => { const newSchedules = { ...appData.schedules }; newSchedules[dateString] = newSchedules[dateString].map(c => c.id === crew.id ? { ...c, crewNumber: Number(e.target.value) } : c); syncToCloud({ ...appData, schedules: newSchedules }); }}>
                {CREW_NUMBERS.map(n => <option key={n} value={n} className="text-gray-900">#{n}</option>)}
              </select>
            )}
            {canEditSchedule && (
              <div className="ml-auto flex items-center gap-1.5 relative">
                <button
                  onClick={() => setCopyCrewCtx(ctx => (ctx?.crewId === crew.id && ctx?.sourceDate === dateString ? null : { sourceDate: dateString, crewId: crew.id, targetDate: addDaysToronto(dateString, 1) }))}
                  className="text-white/60 hover:text-white"
                  title="Copy crew to another day"
                >
                  <Copy className="w-4 h-4" />
                </button>
                {(can('canDeleteCrews', effectiveRole) || canForCrew('canEditOwnCrew', effectiveRole, currentUserEmployee, crew)) && (
                  <button onClick={() => {
                    if (!can('canDeleteCrews', effectiveRole) && !canForCrew('canEditOwnCrew', effectiveRole, currentUserEmployee, crew)) { showToastMsg(PERMISSION_DENIED); return; }
                    const newSchedules = { ...appData.schedules };
                    newSchedules[dateString] = newSchedules[dateString].filter(c => c.id !== crew.id);
                    syncToCloud({ ...appData, schedules: newSchedules });
                  }} className="text-white/60 hover:text-white"><Trash2 className="w-4 h-4" /></button>
                )}
                {copyCrewCtx && copyCrewCtx.crewId === crew.id && copyCrewCtx.sourceDate === dateString && (
                  <div className="absolute right-0 top-full mt-1 z-30 w-56 bg-white border border-slate-200 rounded-lg shadow-xl p-3 text-slate-800">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Copy crew to which day?</div>
                    <input
                      type="date"
                      value={copyCrewCtx.targetDate}
                      onChange={(e) => setCopyCrewCtx(ctx => ctx ? { ...ctx, targetDate: e.target.value } : ctx)}
                      className="w-full border border-slate-300 rounded p-1.5 text-sm font-medium outline-none focus:ring-1 focus:ring-emerald-400"
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => handleCopyCrew(dateString, crew.id, copyCrewCtx.targetDate)}
                        disabled={!copyCrewCtx.targetDate}
                        className="flex-1 flex items-center justify-center gap-1 bg-emerald-600 text-white text-xs font-black uppercase tracking-widest px-2 py-1.5 rounded hover:bg-emerald-700 disabled:bg-slate-300"
                      >
                        <ClipboardPaste className="w-3.5 h-3.5" /> Paste
                      </button>
                      <button
                        onClick={() => setCopyCrewCtx(null)}
                        className="px-2 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-800"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {warnings.length > 0 && (
          <div className="bg-orange-50 border-b border-orange-100 px-3 py-1.5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-orange-800 font-semibold">{warnings.join(" • ")}</div>
          </div>
        )}

        {!crew.dispatched && cardWarnings.map(w => {
          const ov = findOverride(w);
          return (
            <CrewCardWarning
              key={`${w.type}|${w.unitId}`}
              message={w.message}
              isOverridden={!!ov}
              canOverride={isManager}
              overrideRecord={ov}
              onOverride={() => setOverrideModalCtx({
                dateString,
                crewId: crew.id,
                type: w.type,
                unitId: w.unitId,
                warningMessage: w.message,
                title: w.type === 'oos' ? `Override Out of Service` : `Override Pin/Compatibility`,
              })}
            />
          );
        })}

        <div className="p-3 space-y-3 flex-1 flex flex-col">
          <textarea className="w-full text-xs p-2 bg-gray-50 border border-gray-200 rounded-lg resize-none outline-none focus:bg-white focus:border-green-400 focus:ring-1 ring-green-400" placeholder="Manager notes / targets..." rows={2} defaultValue={crew.notes || ''} readOnly={!canEditSchedule} onBlur={(e) => { if (canEditSchedule) { const newSchedules = { ...appData.schedules }; newSchedules[dateString] = newSchedules[dateString].map(c => c.id === crew.id ? { ...c, notes: e.target.value } : c); syncToCloud({ ...appData, schedules: newSchedules }); } }} />

          {/* Personnel Section */}
          <div className="bg-slate-50 rounded-lg border border-slate-200 p-2 flex flex-col gap-1.5 min-h-[50px]">
            <div className="flex justify-between items-center text-xs font-bold text-slate-700 uppercase tracking-wide px-1">
              <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Personnel</span>
            </div>
            {crewEmps.map(emp => {
              // Partial-day time off — display-only yellow badge. Distinct from
              // a full-day absence (red), which removes the worker from the crew.
              const pto = (appData.partialTimeOff?.[dateString] || []).find(p => p.empId === emp.id);
              return (
                <div key={emp.id} className="flex items-center justify-between bg-white px-2 py-1.5 rounded border border-slate-200 text-sm shadow-sm group">
                  <span className="truncate flex items-center gap-1.5 font-medium text-slate-800">
                    {emp.name} {emp.hasLicense && <IdCard className="w-3.5 h-3.5 text-green-600" />} {emp.hasClassA && <ClassAIcon className="w-3.5 h-3.5 text-purple-600" />} {emp.hasHeavyMachinery && <SkidSteerIcon className="w-3.5 h-3.5 text-orange-600" />}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {pto && (
                      <span className="text-[9px] font-black uppercase tracking-wide bg-amber-100 text-amber-700 border border-amber-300 px-1.5 py-0.5 rounded whitespace-nowrap" title="Partial time off">
                        Time off: {formatTimeRange(pto.start, pto.end)}
                      </span>
                    )}
                    {canEditSchedule && <button onClick={() => updateCrewItem(dateString, crew.id, 'employee', 'remove', emp.id)} className="text-gray-300 hover:text-red-500"><X className="w-4 h-4" /></button>}
                  </div>
                </div>
              );
            })}
            {canEditSchedule && empOptions.length > 0 && (
              <div className="relative mt-1">
                <select
                  className="w-full text-xs text-slate-500 font-bold bg-white border border-dashed border-slate-300 rounded p-1.5 appearance-none cursor-pointer outline-none hover:bg-slate-50"
                  onChange={(e) => { if (e.target.value) updateCrewItem(dateString, crew.id, 'employee', 'add', e.target.value); e.target.value = ''; }}
                  defaultValue=""
                >
                  <option value="" disabled>+ Assign Employee...</option>
                  {empOptions.map(({ emp, avail }) => {
                    const suffix = avail.status === 'available' ? '' : ` — ${shortStatusLabel(avail)}`;
                    return (
                      <option key={emp.id} value={emp.id} disabled={avail.status !== 'available'}>
                        {emp.name} ({emp.systemRole || 'worker'}){suffix}
                      </option>
                    );
                  })}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2 pointer-events-none" />
              </div>
            )}
          </div>

          {/* Fleet Section */}
          <div className="bg-gray-100 rounded-lg border border-gray-200 p-2 flex flex-col gap-1.5 min-h-[50px]">
            <div className="flex justify-between items-center text-xs font-bold text-gray-700 uppercase tracking-wide px-1">
              <span className="flex items-center gap-1.5"><Truck className="w-3.5 h-3.5" /> Fleet & Equip</span>
            </div>
            {sortFleetGrouped(crewFleet, appData.equipmentSubtypes || []).map(veh => {
              const readiness = getUnitReadiness(veh.id, appData, dateString);
              const oos = isFleetOutOfService(veh);
              const todayInsp = appData.inspections.find(i => i.unitId === veh.id && i.date === dateString);

              return (
                <div key={veh.id} className={`flex items-center justify-between px-2 py-1.5 rounded border text-sm shadow-sm group ${oos ? 'bg-red-50 border-red-300' : 'bg-white border-gray-200'}`} title={veh.name}>
                  <div className="flex items-center gap-2 overflow-hidden">
                    {veh.color && <div className={`w-3 h-3 rounded-full shrink-0 shadow-sm border border-gray-300 ${veh.color}`} />}
                    <span className={`truncate font-bold flex items-center gap-1.5 ${oos ? 'text-red-700' : 'text-gray-800'}`}>
                      {fleetItemLabel(veh)}
                      {veh.repairTags?.includes('priority') && <span title="Priority Repair"><Flame className="w-3 h-3 text-red-500" /></span>}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Equipment that doesn't track engine hours stays
                        out of the inspection UI (no Inspect button, no
                        indicator) — same rule that was added to keep
                        mowers from being permanently blocked. Hour-
                        tracked equipment + tractors opt back in so the
                        inspection can capture engine hours for the
                        oil-change schedule. Trucks/trailers always
                        surface. Compact icons keep unit names readable. */}
                    {(veh.type !== 'equipment' || isHourMaintenanceUnit(veh)) && readiness === 'missing' && (
                      <button onClick={() => setActiveInspection({ unitId: veh.id, targetDate: dateString, defects: [], expandedCategory: null, draftSeverity: 'minor', draftNotes: '' })} className="text-[10px] font-black bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded uppercase hover:bg-blue-100 transition-colors">Inspect</button>
                    )}
                    {(veh.type !== 'equipment' || isHourMaintenanceUnit(veh)) && todayInsp && (() => {
                      const status = todayInsp.status;
                      // Compact circular icon button. Colour follows
                      // the inspection result; tap reaches the full
                      // inspection detail just like the old pill did.
                      const config = status === 'major'
                        ? { cls: 'bg-red-100 text-red-700 ring-red-200 hover:bg-red-200', Icon: AlertCircle, title: 'Major defect — tap to view inspection' }
                        : status === 'minor'
                          ? { cls: 'bg-yellow-100 text-yellow-700 ring-yellow-200 hover:bg-yellow-200', Icon: AlertTriangle, title: 'Minor defect — tap to view inspection' }
                          : { cls: 'bg-emerald-100 text-emerald-700 ring-emerald-200 hover:bg-emerald-200', Icon: CheckCircle, title: 'Inspected — tap to view inspection' };
                      const { cls, Icon, title } = config;
                      return (
                        <button
                          onClick={() => setViewingInspectionId(todayInsp.id)}
                          className={`p-1 rounded-full ring-1 shadow-sm transition-colors ${cls}`}
                          title={title}
                          aria-label={title}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </button>
                      );
                    })()}
                    {canEditSchedule && <button onClick={() => updateCrewItem(dateString, crew.id, 'fleet', 'remove', veh.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><X className="w-4 h-4" /></button>}
                  </div>
                </div>
              );
            })}
            {canEditSchedule && fleetOptions.length > 0 && (
              <div className="relative mt-1">
                <select
                  className="w-full text-xs text-gray-500 font-bold bg-white border border-dashed border-gray-300 rounded p-1.5 appearance-none cursor-pointer outline-none hover:bg-gray-50"
                  onChange={(e) => {
                    const val = e.target.value;
                    e.target.value = '';
                    if (!val) return;
                    const picked = fleetOptions.find(o => o.f.id === val);
                    if (picked && picked.avail.status === 'oos') {
                      // Out-of-service unit — gate the add behind an override.
                      setOverrideModalCtx({
                        dateString,
                        crewId: crew.id,
                        type: 'oos',
                        unitId: val,
                        warningMessage: `${picked.f.name} is Out of Service. Adding it to this crew requires an override.`,
                        title: 'Add Out-of-Service Unit',
                        addUnit: true,
                      });
                      return;
                    }
                    updateCrewItem(dateString, crew.id, 'fleet', 'add', val);
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>+ Assign Fleet...</option>
                  {fleetOptions.map(({ f, avail }) => {
                    const isOos = avail.status === 'oos';
                    // OOS units stay selectable for managers (add via override);
                    // every other unavailable status remains a hard block.
                    const selectable = avail.status === 'available' || (isOos && isManager);
                    const suffix = avail.status === 'available'
                      ? ''
                      : isOos && isManager
                        ? ' — Out of service (override)'
                        : ` — ${shortStatusLabel(avail)}`;
                    return (
                      <option key={f.id} value={f.id} disabled={!selectable}>
                        {fleetItemLabel(f)}{suffix}
                      </option>
                    );
                  })}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2 top-2 pointer-events-none" />
              </div>
            )}
          </div>

          {/* Inventory Section */}
          <div className="bg-emerald-50/50 rounded-lg border border-emerald-100 p-2 flex flex-col gap-1.5">
            <div className="flex justify-between items-center text-xs font-bold text-emerald-800 uppercase tracking-wide px-1">
              <span className="flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> Inventory</span>
            </div>
            {crewInv.map(inv => (
              <div key={inv.id} className="flex items-center justify-between bg-white px-2 py-1.5 rounded border border-emerald-200 text-sm shadow-sm">
                <span className="truncate text-emerald-900 font-medium flex-1 mr-2">{getInvName(inv.id)}</span>
                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">{inv.qty}x</span>
                <button onClick={() => updateCrewItem(dateString, crew.id, 'inventory', 'remove', inv.id)} className="text-gray-300 hover:text-red-500 ml-2"><X className="w-4 h-4" /></button>
              </div>
            ))}
            {canManageResources && (
              <div className="flex gap-1 mt-1">
                <div className="relative flex-1">
                  <select id={`inv-sel-${crew.id}`} className="w-full text-xs text-emerald-700 font-bold bg-white border border-dashed border-emerald-300 rounded p-1.5 appearance-none cursor-pointer outline-none hover:bg-emerald-50" defaultValue="">
                    <option value="" disabled>Item...</option>
                    {appData.inventory.map(i => <option key={i.id} value={i.id} disabled={i.stock <= 0}>{i.name} (Stk: {i.stock})</option>)}
                  </select>
                </div>
                <input type="number" id={`inv-qty-${crew.id}`} placeholder="Qty" className="w-12 text-xs border border-dashed border-emerald-300 rounded p-1.5 outline-none text-center bg-white text-emerald-900 font-bold" defaultValue="1" min="1" />
                <button onClick={() => {
                  const sel = document.getElementById(`inv-sel-${crew.id}`) as HTMLSelectElement;
                  const qty = document.getElementById(`inv-qty-${crew.id}`) as HTMLInputElement;
                  if (sel && qty && sel.value && Number(qty.value) > 0) {
                    updateCrewItem(dateString, crew.id, 'inventory', 'add', { id: sel.value, qty: Number(qty.value) });
                    sel.value = ''; qty.value = '1';
                  }
                }} className="bg-emerald-100 text-emerald-700 border border-emerald-200 p-1.5 rounded hover:bg-emerald-200 transition-colors">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Supplies Section */}
          <div className="bg-slate-50 rounded-lg border border-slate-200 p-2 flex flex-col gap-1.5">
            <div className="flex justify-between items-center text-xs font-bold text-slate-700 uppercase tracking-wide px-1">
              <span className="flex items-center gap-1.5"><Hammer className="w-3.5 h-3.5" /> Supplies & Tools</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(crew.supplies || []).map(tool => (
                <div key={tool} className="flex items-center gap-1 bg-white px-2 py-1 rounded border border-slate-300 text-[11px] font-bold text-slate-800 shadow-sm">
                  {tool}
                  {canEditSchedule && <button onClick={() => {
                    const newSchedules = { ...appData.schedules };
                    newSchedules[dateString] = newSchedules[dateString].map(c => c.id === crew.id ? { ...c, supplies: (c.supplies || []).filter(t => t !== tool) } : c);
                    syncToCloud({ ...appData, schedules: newSchedules });
                  }} className="text-gray-300 hover:text-red-500"><X className="w-3 h-3" /></button>}
                </div>
              ))}
            </div>
            {canEditSchedule && (
              <div className="relative mt-1">
                <select className="w-full text-xs text-slate-500 font-bold bg-white border border-dashed border-slate-300 rounded p-1.5 appearance-none cursor-pointer outline-none hover:bg-slate-50" onChange={(e) => {
                  if (e.target.value) {
                    const tool = e.target.value;
                    const newSchedules = { ...appData.schedules };
                    newSchedules[dateString] = newSchedules[dateString].map(c => c.id === crew.id ? { ...c, supplies: Array.from(new Set([...(c.supplies || []), tool])) } : c);
                    syncToCloud({ ...appData, schedules: newSchedules });
                  }
                  e.target.value = '';
                }} defaultValue="">
                  <option value="" disabled>+ Add Tool/Supply...</option>
                  {(appData.supplies || []).filter(t => !(crew.supplies || []).includes(t)).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2 pointer-events-none" />
              </div>
            )}
          </div>

          {/* Jobber Assignees Section */}
          {jobberConnected && (() => {
            const editable = canEditSchedule;
            const assigneeIds = crew.jobberAssigneeIds || [];
            const pickerOpen = jobberPickerCrewId === crew.id;
            const searchLc = jobberPickerSearch.toLowerCase();
            const filteredOptions = sortedJobberUsers.filter(u =>
              !searchLc || u.name.toLowerCase().includes(searchLc)
            );
            return (
              <div className="bg-lime-50/60 rounded-lg border border-lime-200 p-2 flex flex-col gap-1.5">
                <div className="flex justify-between items-center text-xs font-bold text-lime-800 uppercase tracking-wide px-1">
                  <span className="flex items-center gap-1.5"><Link2 className="w-3.5 h-3.5" /> Jobber Crew</span>
                </div>
                {jobberUsers.length === 0 ? (
                  <p className="text-[11px] text-slate-500 italic px-1">
                    No Jobber users synced yet — click Refresh Jobber Users in App Settings.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {assigneeIds.map(id => {
                        const u = jobberUsersById.get(id);
                        const stale = !u;
                        return (
                          <span
                            key={id}
                            title={stale ? 'User no longer active in Jobber — re-tag or remove' : undefined}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold border shadow-sm ${stale ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-white border-lime-300 text-lime-900'}`}
                          >
                            {stale && <AlertTriangle className="w-3 h-3 text-amber-600" />}
                            <span className="truncate max-w-[140px]">{u?.name || id}</span>
                            {editable && (
                              <button
                                type="button"
                                onClick={() => removeJobberAssignee(dateString, crew.id, id)}
                                className="text-slate-400 hover:text-red-500"
                                aria-label="Remove assignee"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </span>
                        );
                      })}
                      {assigneeIds.length === 0 && !editable && (
                        <span className="text-[11px] text-slate-400 italic px-1">No Jobber assignees tagged.</span>
                      )}
                    </div>
                    {editable && (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            if (pickerOpen) {
                              closeJobberPicker();
                            } else {
                              openJobberPicker(crew.id, e.currentTarget);
                            }
                          }}
                          className="w-full text-left text-xs text-lime-700 font-bold bg-white border border-dashed border-lime-300 rounded p-1.5 cursor-pointer hover:bg-lime-50 flex items-center justify-between"
                        >
                          <span>+ Tag Jobber assignee…</span>
                          <ChevronDown className="w-3.5 h-3.5 text-lime-400" />
                        </button>
                        {pickerOpen && jobberPickerPos && (
                          <div
                            ref={jobberPickerRef}
                            style={{
                              position: 'fixed',
                              top: jobberPickerPos.top,
                              left: jobberPickerPos.left,
                              width: jobberPickerPos.width,
                              transform: jobberPickerPos.placeAbove ? 'translateY(-100%)' : undefined,
                            }}
                            className="z-50 bg-white border border-slate-200 rounded-lg shadow-xl p-2"
                          >
                            <input
                              autoFocus
                              type="text"
                              value={jobberPickerSearch}
                              onChange={e => setJobberPickerSearch(e.target.value)}
                              placeholder="Search Jobber users…"
                              className="w-full text-sm px-3 py-2 min-h-[40px] border border-slate-200 rounded outline-none focus:border-lime-400 focus:ring-1 focus:ring-lime-200"
                            />
                            <div
                              style={{ maxHeight: jobberPickerPos.listMaxHeight }}
                              className="overflow-y-auto mt-1.5"
                            >
                              {filteredOptions.length === 0 ? (
                                <p className="text-[11px] text-slate-400 italic px-2 py-2">No matches.</p>
                              ) : filteredOptions.map(u => {
                                const selected = assigneeIds.includes(u.id);
                                const avail = selected
                                  ? { status: 'available' as const }
                                  : getResourceAvailability(u.id, 'jobberAssignee', dateString, appData);
                                const blocked = avail.status === 'assigned' && avail.crewId !== crew.id;
                                const blockedSuffix = blocked && avail.status === 'assigned'
                                  ? ` — On ${avail.crewName}`
                                  : '';
                                return (
                                  <button
                                    key={u.id}
                                    type="button"
                                    disabled={blocked}
                                    title={blocked ? `Already tagged on ${avail.status === 'assigned' ? avail.crewName : ''}` : undefined}
                                    onClick={() => { if (!blocked) toggleJobberAssignee(dateString, crew.id, u.id); }}
                                    className={`w-full text-left text-sm px-3 py-2.5 min-h-[40px] rounded flex items-center gap-2 ${selected ? 'bg-lime-50 text-lime-900' : blocked ? 'text-slate-400 cursor-not-allowed' : 'hover:bg-slate-50 text-slate-700'}`}
                                  >
                                    <span className={`w-3.5 h-3.5 border rounded flex items-center justify-center shrink-0 ${selected ? 'bg-lime-600 border-lime-600' : 'border-slate-300 bg-white'}`}>
                                      {selected && <CheckCircle className="w-3 h-3 text-white" />}
                                    </span>
                                    <span className="truncate">{u.name}{blockedSuffix}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })()}

          {/* Dispatch Section */}
          <div className="mt-auto pt-3 border-t border-slate-100">
            {(() => {
              const fleetEmpty = crew.fleet.length === 0;
              // Equipment (mowers etc.) doesn't get inspected — exclude
              // it from the dispatch readiness gate. Otherwise an
              // equipment-only crew would be permanently blocked by a
              // "missing" inspection state that doesn't apply to it.
              const anyMissing = crew.fleet.some(fid => {
                const unit = appData.fleet.find(u => u.id === fid);
                if (unit?.type === 'equipment') return false;
                return getUnitReadiness(fid, appData, dateString) === 'missing';
              });

              if (crew.dispatched) {
                const dispOvs = crew.dispatchOverrides || [];
                const auditOpen = !!expandedAudit[crew.id];
                const isClosed = !!crew.equipmentClosedAt;
                const perfLog = appData.performance?.[dateString]?.[crew.id];
                const isApproved = perfLog?.approvalStatus === 'approved';
                const today = formatTodayInToronto();
                const past10pm = (dateString < today) || (dateString === today && new Date().getHours() >= EOD_WARNING_HOUR);
                const showCloseWarning = !isClosed && past10pm;
                return (
                  <div className="space-y-2">
                    <div className={`bg-green-600 text-white p-3 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-green-600/20 ${showCloseWarning ? 'ring-2 ring-rose-400' : ''}`}>
                      <CheckCircle className="w-5 h-5" />
                      <span className="text-sm font-black uppercase tracking-widest">Dispatched</span>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[9px] font-black uppercase tracking-widest bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Dispatched</span>
                      {isClosed ? (
                        <span className="text-[9px] font-black uppercase tracking-widest bg-slate-200 text-slate-700 px-2 py-0.5 rounded inline-flex items-center gap-1"><Lock className="w-2.5 h-2.5" /> Closed</span>
                      ) : showCloseWarning ? (
                        <span className="text-[9px] font-black uppercase tracking-widest bg-rose-100 text-rose-700 px-2 py-0.5 rounded inline-flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5" /> Not Closed</span>
                      ) : null}
                      {isApproved && (
                        <span className="text-[9px] font-black uppercase tracking-widest bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded inline-flex items-center gap-1"><CheckCircle className="w-2.5 h-2.5" /> Approved</span>
                      )}
                    </div>

                    {(can('canCloseOutCrew', effectiveRole) || canForCrew('canCloseOutOwnCrew', effectiveRole, currentUserEmployee, crew)) && (
                      <button
                        onClick={() => setEndDayCtx({ dateString, crewId: crew.id })}
                        className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-colors ${isClosed
                          ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'}`}
                      >
                        {isClosed ? <Lock className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                        {isClosed ? 'Closed for the Day · Re-open' : 'End Day'}
                      </button>
                    )}

                    {dispOvs.length > 0 && (
                      <button
                        onClick={() => setExpandedAudit(p => ({ ...p, [crew.id]: !p[crew.id] }))}
                        className="w-full flex items-center justify-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest hover:bg-amber-100 transition-colors"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Dispatched with {dispOvs.length} Override{dispOvs.length !== 1 ? 's' : ''}
                        {auditOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    {dispOvs.length > 0 && auditOpen && (
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 space-y-1.5">
                        {dispOvs.map(o => (
                          <div key={o.id} className="bg-white border border-slate-200 rounded p-2">
                            <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{o.type}</div>
                            <div className="text-xs text-slate-800 font-semibold mt-0.5">{o.warningMessage}</div>
                            <div className="text-[10px] text-slate-500 mt-1">
                              Overridden by {o.overriddenByName} · {new Date(o.timestamp).toLocaleString()}
                            </div>
                            {o.reason && (
                              <div className="text-[10px] text-slate-600 italic mt-0.5">"{o.reason}"</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              const canDispatch = can('canDispatchAnyCrew', effectiveRole) || canForCrew('canDispatchOwnCrew', effectiveRole, currentUserEmployee, crew);
              const blocked = fleetEmpty || anyMissing || hasUnoverriddenWarnings || !canDispatch;
              const cautionMode = !blocked && cardWarnings.length > 0 && allWarningsOverridden;
              const unresolvedCount = cardWarnings.filter(w => !findOverride(w)).length;

              const label = !canDispatch
                ? 'Dispatch — Permission Denied'
                : fleetEmpty
                  ? 'No Fleet Assigned'
                  : anyMissing
                    ? 'Inspection Required'
                    : hasUnoverriddenWarnings
                      ? `${unresolvedCount} Unresolved Warning${unresolvedCount !== 1 ? 's' : ''}`
                      : cautionMode
                        ? 'Dispatch with Overrides'
                        : 'Dispatch Crew';

              const buttonClass = blocked
                ? `bg-slate-100 text-slate-400 cursor-not-allowed${hasUnoverriddenWarnings ? ' border-2 border-rose-300' : ''}`
                : cautionMode
                  ? 'bg-amber-500 text-white hover:bg-amber-600 active:scale-95 shadow-amber-200'
                  : 'bg-slate-800 text-white hover:bg-slate-900 active:scale-95 shadow-slate-200';

              return (
                <button
                  disabled={blocked}
                  onClick={() => {
                    if (!canDispatch) { showToastMsg(PERMISSION_DENIED); return; }
                    setDispatchCtx({ dateString, crew, pendingOverrides, overrideKey });
                  }}
                  className={`w-full py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg font-black uppercase tracking-widest text-xs ${buttonClass}`}
                >
                  <TrendingUp className="w-4 h-4" />
                  {label}
                </button>
              );
            })()}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-100 print:bg-white print:overflow-visible relative">
      <div className="bg-white border-b border-gray-200 p-4 flex flex-wrap items-center justify-between shadow-sm print:shadow-none print:border-b-2 print:border-gray-800 print:mb-4 gap-4">
        <div className="flex items-center gap-4">
          {bookedOffView ? (
            <div className="text-gray-800 text-lg font-black tracking-wide inline-flex items-center gap-2">
              <Plane className="w-5 h-5 text-rose-600" /> Booked off
              <span className="text-[11px] font-bold text-slate-400 normal-case tracking-normal">approved time off</span>
            </div>
          ) : availabilityView ? (
            <div className="text-gray-800 text-lg font-black tracking-wide inline-flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-emerald-700" /> Availability
              <span className="text-[11px] font-bold text-slate-400 normal-case tracking-normal">who&rsquo;s free today</span>
            </div>
          ) : capacityView ? (
            <div className="text-gray-800 text-lg font-black tracking-wide inline-flex items-center gap-2">
              <CalendarRange className="w-5 h-5 text-slate-700" /> Capacity
              <span className="text-[11px] font-bold text-slate-400 normal-case tracking-normal">scheduled BH by week</span>
            </div>
          ) : (
            <>
              {scheduleMode === 'weekly' && (
                <button
                  type="button"
                  onClick={() => setScheduleMode('daily')}
                  aria-label="Back to daily view"
                  title="Back to daily view"
                  className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center text-slate-600 hover:bg-gray-100 rounded-lg print:hidden"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              )}
              <div className="flex items-center bg-gray-100 rounded-lg p-1 print:hidden">
                <button onClick={() => setScheduleMode('weekly')} className={`px-3 py-1.5 text-sm font-bold rounded ${scheduleMode === 'weekly' ? 'bg-white shadow-sm text-green-700' : 'text-gray-500 hover:text-gray-700'}`}><CalendarDays className="w-4 h-4 inline mr-1" /> 7-Day</button>
                <button onClick={() => setScheduleMode('daily')} className={`px-3 py-1.5 text-sm font-bold rounded ${scheduleMode === 'daily' ? 'bg-white shadow-sm text-green-700' : 'text-gray-500 hover:text-gray-700'}`}><CalendarIcon className="w-4 h-4 inline mr-1" /> Daily</button>
              </div>

              <div className="flex items-center bg-gray-100 rounded-lg p-1 print:hidden">
                <button onClick={() => scheduleMode === 'weekly' ? handlePrevWeek() : setSelectedDailyDate(addDaysToronto(selectedDailyDate, -1))} className="p-1.5 hover:bg-white rounded shadow-sm text-gray-600"><ChevronLeft className="w-4 h-4" /></button>
                <button onClick={() => scheduleMode === 'weekly' ? handleToday() : setSelectedDailyDate(formatTodayInToronto())} className="px-3 py-1.5 text-xs font-bold uppercase hover:bg-white rounded shadow-sm text-gray-700 mx-1">Today</button>
                <button onClick={() => scheduleMode === 'weekly' ? handleNextWeek() : setSelectedDailyDate(addDaysToronto(selectedDailyDate, 1))} className="p-1.5 hover:bg-white rounded shadow-sm text-gray-600"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          {!altView && (
            <>
              <div className="text-gray-800 text-lg font-black tracking-wide print:text-xl mr-2">
                {scheduleMode === 'weekly' ? `Week of ${startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : new Date(`${selectedDailyDate}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </div>

              <div className="flex items-center gap-2 bg-white border border-gray-300 rounded-lg px-2 py-1.5 shadow-sm print:hidden">
                <Filter className="w-4 h-4 text-gray-500" />
                <select className="text-sm font-bold text-gray-700 bg-transparent outline-none cursor-pointer" value={crewFilter} onChange={(e) => setCrewFilter(e.target.value)}>
                  <option value="All">All Divisions</option>
                  {DIVISIONS.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
            </>
          )}

          <button
            onClick={() => { setBookedOffView(v => !v); setCapacityView(false); setAvailabilityView(false); }}
            aria-pressed={bookedOffView}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-colors print:hidden shadow-sm border ${bookedOffView ? 'bg-rose-600 text-white border-rose-700 hover:bg-rose-700' : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'}`}
          ><Plane className="w-4 h-4" /> Booked off</button>
          <button
            onClick={() => { setAvailabilityView(v => !v); setBookedOffView(false); setCapacityView(false); }}
            aria-pressed={availabilityView}
            title="Who's free today, and which crews are above or below their usual size"
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-colors print:hidden shadow-sm border ${availabilityView ? 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700' : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'}`}
          ><UserCheck className="w-4 h-4" /> Availability</button>
          {/* Capacity is a management view (the same one SalesMaster hosts) —
              managers and admins only, matching who the booked-out number is
              for. */}
          {isManager && (
            <button
              onClick={() => { setCapacityView(v => !v); setBookedOffView(false); setAvailabilityView(false); }}
              aria-pressed={capacityView}
              title="Forward scheduled BH by week — how far out we're booked"
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-colors print:hidden shadow-sm border ${capacityView ? 'bg-slate-800 text-white border-slate-900 hover:bg-slate-700' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}`}
            ><CalendarRange className="w-4 h-4" /> Capacity</button>
          )}
          {!altView && (
            <>
              <button onClick={() => setIsWeatherModalOpen(true)} className="flex items-center gap-2 bg-green-50 text-green-700 border border-green-200 px-3 py-2 rounded-lg text-sm font-bold hover:bg-green-100 transition-colors print:hidden shadow-sm"><CloudSun className="w-4 h-4" /> Weather</button>
              <button onClick={handlePrint} className="flex items-center gap-2 bg-slate-800 text-white px-3 py-2 rounded-lg text-sm font-bold hover:bg-slate-700 transition-colors print:hidden shadow-sm"><Printer className="w-4 h-4" /> Print</button>
            </>
          )}
        </div>
      </div>

      {availabilityView ? (
        <div className="flex-1 overflow-y-auto">
          <AvailabilityView appData={appData} defaultDivision={bookedOffDefaultDivision} />
        </div>
      ) : bookedOffView ? (
        <div className="flex-1 overflow-y-auto">
          <BookedOffCalendar
            employees={appData.employees || []}
            defaultDivision={bookedOffDefaultDivision}
          />
        </div>
      ) : capacityView && isManager ? (
        <div className="flex-1 overflow-y-auto">
          <CapacityCalendar
            appData={appData}
            forecasts={capacityForecasts}
            isAdmin={isAdmin}
            currentUserEmployee={currentUserEmployee}
            onRefresh={onRefreshCapacity}
            canRefresh={canRefreshCapacity}
            onSaveSettings={onSaveCapacitySettings}
            jobberUsers={jobberUsers}
            hourlyEstimates={hourlyEstimates}
            onSetHourlyEstimate={onSetHourlyEstimate}
            defaultTool="balance"
            variant="board"
          />
        </div>
      ) : (
      <div className={`flex-1 overflow-x-auto print:overflow-visible ${scheduleMode === 'weekly' ? 'overflow-y-hidden' : 'overflow-y-auto p-6'}`}>
        {scheduleMode === 'weekly' ? (
          <div className="flex h-full min-w-max p-4 gap-4 print:p-0 print:flex-wrap print:w-full print:min-w-0 print:gap-2">
            {weekDays.map((date) => {
              const dateString = formatDate(date);
              let daySchedules = appData.schedules[dateString] || [];
              if (crewFilter !== 'All') daySchedules = daySchedules.filter(c => c.division === crewFilter);
              const isToday = formatTodayInToronto() === dateString;
              const dayWeather = weather[dateString];

              return (
                <div key={dateString} className="flex flex-col w-[350px] bg-gray-50/50 rounded-2xl border border-gray-200 overflow-hidden shadow-sm h-full print:w-[32%] print:h-auto print:mb-4 print:rounded-none print:border print:shadow-none print:break-inside-avoid">
                  <div className={`p-3 border-b border-gray-200 flex justify-between items-start ${isToday ? 'bg-green-50 border-green-100' : 'bg-white'}`}>
                    <div>
                      <div className={`text-sm font-bold uppercase ${isToday ? 'text-green-600' : 'text-gray-500 print:text-gray-800'}`}>{date.toLocaleDateString('en-US', { weekday: 'long' })}</div>
                      <div className={`text-lg font-light ${isToday ? 'text-green-800' : 'text-gray-800'}`}>{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-1 print:hidden">
                        {copiedDay && copiedDay.date !== dateString && <button onClick={() => handlePasteDay(dateString)} className="p-1.5 bg-green-50 border border-green-200 rounded-lg shadow-sm text-green-700 hover:bg-green-100"><ClipboardPaste className="w-4 h-4" /></button>}
                        <button onClick={() => handleCopyDay(dateString)} className="p-1.5 bg-white border border-gray-200 rounded-lg shadow-sm text-gray-600 hover:text-green-600"><Copy className="w-4 h-4" /></button>
                        {canEditSchedule && <button onClick={() => addCrewToDay(dateString)} className="p-1.5 bg-green-600 text-white rounded-lg shadow-sm hover:bg-green-700 transition-colors"><Plus className="w-4 h-4" /></button>}
                      </div>
                      {dayWeather && (
                        <button onClick={() => setIsWeatherModalOpen(true)} className="flex items-center gap-1 mt-1 bg-white px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-50 print:hidden shadow-sm">
                          {getWeatherIcon(dayWeather.code)}
                          <div className="text-[10px] font-bold text-gray-600"><span className="text-red-500">{dayWeather.max}°</span> / <span className="text-green-500">{dayWeather.min}°</span></div>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 p-3 overflow-y-auto print:overflow-visible print:p-2">
                    {daySchedules.length === 0 ? <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-2 border-2 border-dashed border-gray-200 rounded-xl min-h-[150px] print:hidden"><Users className="w-8 h-8 opacity-20" /><span className="text-sm font-medium">No crews scheduled</span></div> : daySchedules.map(crew => renderCrewCard(dateString, crew, dayWeather))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          // --- DAILY VIEW GRID ---
          <div className="max-w-7xl mx-auto w-full">
            {(() => {
              let daySchedules = appData.schedules[selectedDailyDate] || [];
              if (crewFilter !== 'All') daySchedules = daySchedules.filter(c => c.division === crewFilter);
              const dayWeather = weather[selectedDailyDate];

              return (
                <div className="space-y-6">
                  {/* Daily Header */}
                  <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-gray-200 shadow-sm print:hidden">
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-3">
                        {dayWeather ? getWeatherIcon(dayWeather.code) : <Cloud className="w-8 h-8 text-gray-300" />}
                        <div>
                          <div className="text-sm font-bold text-gray-500 uppercase tracking-widest">Weather Forecast</div>
                          <div className="font-medium text-gray-800">{dayWeather ? getWeatherDescription(dayWeather.code) : 'Data unavailable'} {dayWeather && <span className="ml-2 font-bold"><span className="text-red-500">{dayWeather.max}°</span> / <span className="text-green-500">{dayWeather.min}°</span></span>}</div>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {copiedDay && copiedDay.date !== selectedDailyDate && <button onClick={() => handlePasteDay(selectedDailyDate)} className="px-4 py-2 font-bold bg-green-50 border border-green-200 rounded-lg shadow-sm text-green-700 hover:bg-green-100 flex items-center gap-2"><ClipboardPaste className="w-4 h-4" /> Paste Copied Day</button>}
                      <button onClick={() => handleCopyDay(selectedDailyDate)} className="px-4 py-2 font-bold bg-white border border-gray-200 rounded-lg shadow-sm text-gray-600 hover:text-green-600 flex items-center gap-2"><Copy className="w-4 h-4" /> Copy Day</button>
                      {canEditSchedule && <button onClick={() => addCrewToDay(selectedDailyDate)} className="px-4 py-2 font-bold bg-green-600 text-white rounded-lg shadow hover:bg-green-700 transition-colors flex items-center gap-2"><Plus className="w-4 h-4" /> Add Crew</button>}
                    </div>
                  </div>

                  {/* Grid of Crew Cards */}
                  {daySchedules.length === 0 ? (
                    <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-20 flex flex-col items-center justify-center text-gray-400">
                      <CalendarIcon className="w-16 h-16 mb-4 opacity-20" />
                      <p className="text-xl font-medium text-gray-500">No crews scheduled for this day.</p>
                      {canEditSchedule && <button onClick={() => addCrewToDay(selectedDailyDate)} className="mt-6 px-6 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg font-bold hover:bg-green-100">Click here to add one</button>}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 items-start">
                      {daySchedules.map(crew => renderCrewCard(selectedDailyDate, crew, dayWeather))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
      )}

      <OverrideModal
        isOpen={!!overrideModalCtx}
        title={overrideModalCtx?.title || 'Override Warning'}
        warningMessage={overrideModalCtx?.warningMessage || ''}
        onConfirm={confirmOverride}
        onClose={() => setOverrideModalCtx(null)}
      />

      {dispatchCtx && (
        <DispatchConfirmModal
          isOpen={true}
          onClose={() => setDispatchCtx(null)}
          crew={dispatchCtx.crew}
          dateString={dispatchCtx.dateString}
          employees={appData.employees}
          fleet={appData.fleet}
          jobberUsers={jobberUsers}
          onConfirmDispatch={finalizeDispatch}
          currentUserEmail={userEmail}
          currentUserName={userName || userEmail}
          currentUserRole={effectiveRole}
          showToastMsg={showToastMsg}
        />
      )}

      <EndDayModal
        crew={endDayCtx ? (appData.schedules[endDayCtx.dateString] || []).find(c => c.id === endDayCtx.crewId) || null : null}
        dateString={endDayCtx?.dateString || ''}
        reminderText={appData.settings?.endOfDayReminder}
        currentUserEmail={userEmail}
        isAdmin={isManager}
        onClose={() => setEndDayCtx(null)}
        onConfirmClose={() => {
          if (!endDayCtx) return;
          const crew = (appData.schedules[endDayCtx.dateString] || []).find(c => c.id === endDayCtx.crewId);
          if (!crew) return;
          if (!can('canCloseOutCrew', effectiveRole) && !canForCrew('canCloseOutOwnCrew', effectiveRole, currentUserEmployee, crew)) {
            showToastMsg(PERMISSION_DENIED);
            return;
          }
          const newSchedules = { ...appData.schedules };
          newSchedules[endDayCtx.dateString] = (newSchedules[endDayCtx.dateString] || []).map(c =>
            c.id === endDayCtx.crewId
              ? { ...c, equipmentClosedAt: new Date().toISOString(), equipmentClosedBy: userEmail, equipmentClosedByName: userName || userEmail }
              : c
          );
          syncToCloud({ ...appData, schedules: newSchedules });
          showToastMsg('Crew closed for the day.');
          setEndDayCtx(null);
        }}
        onReopen={() => {
          if (!endDayCtx) return;
          const crew = (appData.schedules[endDayCtx.dateString] || []).find(c => c.id === endDayCtx.crewId);
          if (!crew) return;
          if (crew.equipmentClosedBy !== userEmail && !isManager) return;
          const newSchedules = { ...appData.schedules };
          newSchedules[endDayCtx.dateString] = (newSchedules[endDayCtx.dateString] || []).map(c =>
            c.id === endDayCtx.crewId
              ? { ...c, equipmentClosedAt: undefined, equipmentClosedBy: undefined, equipmentClosedByName: undefined }
              : c
          );
          syncToCloud({ ...appData, schedules: newSchedules });
          showToastMsg('Crew re-opened.');
          setEndDayCtx(null);
        }}
      />
    </div>
  );
}

import { FleetItem, MaintenanceItem, MechanicTask } from '../types';

// Hours within nextDueAt at which the auto-spawn helper creates a
// yellow "due soon" maintenance task. Once currentEngineHours crosses
// nextDueAt itself, the task is promoted to priority.
const DUE_SOON_WINDOW = 25;
// Km buffer for the km-variant spawn — wider than the hour window
// because trucks rack up distance faster than a mower racks up hours.
const DUE_SOON_WINDOW_KM = 500;
// Threshold for the Missing Hour Updates banner — 7 days since last
// reading is the same cadence the ODO-staleness check uses.
const HOUR_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export function isEngineHoursStale(lastHourUpdateAt: number | undefined): boolean {
  if (!lastHourUpdateAt) return true;
  return (Date.now() - lastHourUpdateAt) > HOUR_STALE_MS;
}

export function unitNeedsHourUpdate(unit: FleetItem): boolean {
  if (!unit.tracksEngineHours) return false;
  if (unit.isWinterized) return false;
  return isEngineHoursStale(unit.lastHourUpdateAt);
}

// True for any unit whose maintenance items are evaluated against the
// odometer. Trucks auto-track (no toggle); trailers and tractors do
// not. Centralised so call sites can't drift.
export function isKmMaintenanceUnit(unit: FleetItem): boolean {
  return unit.type === 'truck';
}

// True for any unit whose maintenance items are evaluated against
// engine hours. Equipment + tractor; both opt in via tracksEngineHours.
export function isHourMaintenanceUnit(unit: FleetItem): boolean {
  if (!unit.tracksEngineHours) return false;
  return unit.type === 'equipment' || unit.type === 'tractor';
}

function maintenanceTaskDescription(
  item: MaintenanceItem,
  unit: FleetItem,
  currentValue: number,
): string {
  const unitLabel = item.metric === 'km' ? 'km' : 'hrs';
  if (item.metric === 'km') {
    return `${item.name} target is ${item.nextDueAt} ${unitLabel} (default interval ${item.threshold} km). ` +
      `${unit.name} is at ${currentValue} ${unitLabel}.`;
  }
  return `${item.name} is scheduled every ${item.threshold} hrs. ` +
    `${unit.name} is at ${currentValue} hrs, next service was at ${item.nextDueAt} hrs.`;
}

function makeMaintenanceTask(
  unit: FleetItem,
  item: MaintenanceItem,
  currentValue: number,
  overdue: boolean,
): MechanicTask {
  return {
    id: `task-maint-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    unitId: unit.id,
    unitName: unit.name,
    category: 'Maintenance',
    description: maintenanceTaskDescription(item, unit, currentValue),
    notes: [],
    severity: 'minor',
    status: 'todo',
    dateReported: new Date().toISOString().slice(0, 10),
    isMaintenance: true,
    source: 'maintenance',
    sourceMaintenanceItemId: item.id,
    priority: overdue,
    activity: [],
  };
}

// Internal: shared loop that processes one unit's maintenance items
// against a numeric "current value" (hours OR km). The metric-aware
// caller passes the metric default buffer; each item can override
// via item.warnBuffer. Returns updated items + tasks.
function processMaintenance(
  unit: FleetItem,
  mechanicTasks: MechanicTask[],
  currentValue: number,
  defaultBuffer: number,
  metricFilter: 'hours' | 'km',
): { items: MaintenanceItem[]; mechanicTasks: MechanicTask[] } {
  const items = unit.maintenanceItems || [];
  const nextItems: MaintenanceItem[] = [];
  let nextTasks: MechanicTask[] = [...mechanicTasks];

  for (const item of items) {
    const next = { ...item };
    // Skip items whose metric doesn't match this pass. Default
    // (undefined) is treated as 'hours' for back-compat with mower
    // data written before the unify.
    const itemMetric = item.metric || 'hours';
    if (itemMetric !== metricFilter) {
      nextItems.push(next);
      continue;
    }
    // Skip unconfigured items (initial truck oil-change placeholder
    // or any item missing a real next-due). 0 explicitly means
    // "not yet set" — every truck will be at >= 0 km, so a
    // nextDueAt of 0 would otherwise spawn an immediate overdue
    // task on first odometer save.
    if (typeof item.nextDueAt !== 'number' || item.nextDueAt <= 0) {
      nextItems.push(next);
      continue;
    }
    // Per-item warning buffer overrides the metric default. Legacy
    // items without warnBuffer keep the historic 25 hr / 500 km
    // behaviour automatically.
    const buffer = typeof item.warnBuffer === 'number' && item.warnBuffer > 0
      ? item.warnBuffer
      : defaultBuffer;
    const overdue = currentValue >= item.nextDueAt;
    const dueSoon = !overdue && currentValue >= item.nextDueAt - buffer;
    const activeIdx = item.activeTaskId
      ? nextTasks.findIndex(t => t.id === item.activeTaskId && t.status !== 'done')
      : -1;
    const hasActive = activeIdx >= 0;

    if (overdue) {
      if (hasActive) {
        const existing = nextTasks[activeIdx];
        if (!existing.priority) {
          nextTasks[activeIdx] = { ...existing, priority: true };
        }
      } else {
        const t = makeMaintenanceTask(unit, item, currentValue, true);
        t.category = item.name;
        t.description = maintenanceTaskDescription(item, unit, currentValue);
        nextTasks.push(t);
        next.activeTaskId = t.id;
      }
    } else if (dueSoon) {
      if (!hasActive) {
        const t = makeMaintenanceTask(unit, item, currentValue, false);
        t.category = item.name;
        nextTasks.push(t);
        next.activeTaskId = t.id;
      }
    }

    nextItems.push(next);
  }

  return { items: nextItems, mechanicTasks: nextTasks };
}

// Walks a unit's maintenance schedules against its current engine hours
// and decides which need a task spawned (or promoted to priority).
// Pure function — caller wires the resulting mechanicTasks list back
// into appData via syncToCloud. Returns the updated items array and
// the FULL replacement mechanicTasks array (existing tasks may be
// mutated to set priority on overdue promotion).
export function processMaintenanceForHourUpdate(
  unit: FleetItem,
  mechanicTasks: MechanicTask[],
): { items: MaintenanceItem[]; mechanicTasks: MechanicTask[] } {
  // Hour-tracked units are equipment + tractor (both opt in via
  // tracksEngineHours). Any other type — or a winterized unit —
  // bails out: no spawn, no mutation.
  if (!isHourMaintenanceUnit(unit) || unit.isWinterized) {
    return { items: unit.maintenanceItems || [], mechanicTasks };
  }
  const currentHrs = typeof unit.currentEngineHours === 'number' ? unit.currentEngineHours : 0;
  return processMaintenance(unit, mechanicTasks, currentHrs, DUE_SOON_WINDOW, 'hours');
}

// Km counterpart of processMaintenanceForHourUpdate. Truck-only
// (auto, no per-unit toggle); winterized trucks bail out. Reads the
// unit's odometer as the current value and uses a 500 km warning
// window. Same priority-promotion semantics as the hour variant.
// Items with nextDueAt <= 0 are treated as unconfigured and skipped
// (initial truck oil-change placeholder).
export function processMaintenanceForOdometerUpdate(
  unit: FleetItem,
  mechanicTasks: MechanicTask[],
): { items: MaintenanceItem[]; mechanicTasks: MechanicTask[] } {
  if (!isKmMaintenanceUnit(unit) || unit.isWinterized) {
    return { items: unit.maintenanceItems || [], mechanicTasks };
  }
  const currentKm = typeof unit.odometer === 'number' ? unit.odometer : 0;
  return processMaintenance(unit, mechanicTasks, currentKm, DUE_SOON_WINDOW_KM, 'km');
}

// Advances a maintenance item to "just serviced" state. Called from
// CompletionModal submit (when source==='maintenance') and from the
// manual-reset modal. For hour-based items, nextDueAt auto-recomputes
// from threshold. For km-based items, the mechanic enters the next
// due explicitly (synthetic vs conventional oil); pass that in via
// explicitNextDueAt to bypass the threshold-based recompute.
export function resetMaintenanceItem(
  item: MaintenanceItem,
  valueAtService: number,
  explicitNextDueAt?: number,
): MaintenanceItem {
  const nextDueAt = typeof explicitNextDueAt === 'number' && Number.isFinite(explicitNextDueAt)
    ? explicitNextDueAt
    : valueAtService + item.threshold;
  return {
    ...item,
    lastServiceAt: Date.now(),
    lastServiceValue: valueAtService,
    // Retain lastServiceHours writes for hour items so any
    // downstream code still reading the old field keeps working.
    lastServiceHours: (item.metric || 'hours') === 'hours' ? valueAtService : item.lastServiceHours,
    nextDueAt,
    activeTaskId: undefined,
  };
}

import { FleetItem, MaintenanceItem, MechanicTask } from '../types';

// Hours within nextDueAt at which the auto-spawn helper creates a
// yellow "due soon" maintenance task. Once currentEngineHours crosses
// nextDueAt itself, the task is promoted to priority.
const DUE_SOON_WINDOW = 25;
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

function maintenanceTaskTitle(item: MaintenanceItem, unit: FleetItem, overdue: boolean): string {
  const suffix = overdue ? ' (OVERDUE)' : ' due soon';
  return `${item.name} change${suffix} — ${unit.name}`;
}

function maintenanceTaskDescription(
  item: MaintenanceItem,
  unit: FleetItem,
  currentHrs: number,
): string {
  return `${item.name} is scheduled every ${item.threshold} hrs. ` +
    `${unit.name} is at ${currentHrs} hrs, next service was at ${item.nextDueAt} hrs.`;
}

function makeMaintenanceTask(
  unit: FleetItem,
  item: MaintenanceItem,
  currentHrs: number,
  overdue: boolean,
): MechanicTask {
  return {
    id: `task-maint-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    unitId: unit.id,
    unitName: unit.name,
    category: 'Maintenance',
    description: maintenanceTaskDescription(item, unit, currentHrs),
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
  // Defensive: engine-hour tracking is equipment-only. If a unit
  // somehow has tracksEngineHours set with type !== 'equipment'
  // (legacy data, or a bad write), bail out — no spawn, no mutation.
  // Same for winterized units (their schedule pauses by design).
  if (unit.type !== 'equipment' || unit.isWinterized) {
    return { items: unit.maintenanceItems || [], mechanicTasks };
  }
  const currentHrs = typeof unit.currentEngineHours === 'number' ? unit.currentEngineHours : 0;
  const items = unit.maintenanceItems || [];
  const nextItems: MaintenanceItem[] = [];
  let nextTasks: MechanicTask[] = [...mechanicTasks];

  for (const item of items) {
    const next = { ...item };
    if (typeof item.nextDueAt !== 'number') {
      nextItems.push(next);
      continue;
    }
    const overdue = currentHrs >= item.nextDueAt;
    const dueSoon = !overdue && currentHrs >= item.nextDueAt - DUE_SOON_WINDOW;
    const activeIdx = item.activeTaskId
      ? nextTasks.findIndex(t => t.id === item.activeTaskId && t.status !== 'done')
      : -1;
    const hasActive = activeIdx >= 0;

    if (overdue) {
      if (hasActive) {
        // Promote existing task to priority if it isn't already.
        const existing = nextTasks[activeIdx];
        if (!existing.priority) {
          nextTasks[activeIdx] = { ...existing, priority: true };
        }
      } else {
        const t = makeMaintenanceTask(unit, item, currentHrs, true);
        t.category = item.name;
        // Description / title encode overdue state.
        t.description = maintenanceTaskDescription(item, unit, currentHrs);
        nextTasks.push(t);
        next.activeTaskId = t.id;
      }
    } else if (dueSoon) {
      if (!hasActive) {
        const t = makeMaintenanceTask(unit, item, currentHrs, false);
        t.category = item.name;
        nextTasks.push(t);
        next.activeTaskId = t.id;
      }
      // If hasActive, leave it as-is — already at due-soon priority.
    } else {
      // Below the due-soon window. Don't spawn; don't promote. If an
      // active task somehow exists (e.g. hours rewound below the
      // threshold after a typo correction), leave it — the manager
      // can manually delete it via the kebab if they want.
    }

    nextItems.push(next);
  }

  return { items: nextItems, mechanicTasks: nextTasks };
}

// Advances a maintenance item to "just serviced" state. Called from
// CompletionModal submit (when source==='maintenance') and from the
// manual-reset modal. Returns the updated item.
export function resetMaintenanceItem(
  item: MaintenanceItem,
  hoursAtService: number,
): MaintenanceItem {
  return {
    ...item,
    lastServiceAt: Date.now(),
    lastServiceHours: hoursAtService,
    nextDueAt: hoursAtService + item.threshold,
    activeTaskId: undefined,
  };
}

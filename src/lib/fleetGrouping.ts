import { FleetItem, EquipmentSubtypeDefinition, MechanicTask } from '../types';
import { sortFleetGrouped } from './fleetUtils';
import { needsPlateRenewal, needsCommercialSafety } from './fleetUtils';
import {
  isKmMaintenanceUnit,
  isHourMaintenanceUnit,
  isEngineHoursStale,
} from './maintenanceUtils';
import { isOdoStale } from './dateUtils';

// Presentation-only grouping + per-unit status for the reorganized fleet
// lists (Mechanic Board "Fleet List" + Manage "Fleet & Equip" tab). Pure
// helpers — no data mutation, no maintenance/pay logic. Everything here
// composes existing predicates so the two lists agree.

// Default due-soon windows, mirrored from maintenanceUtils (kept local so
// this module stays a pure read layer; the spawn engine owns the real
// values). hours / km.
const WARN_HOURS = 25;
const WARN_KM = 500;

export interface FleetSubgroup {
  key: string;
  label: string;
  units: FleetItem[];
}

export interface FleetGroup {
  key: string;
  label: string;
  units: FleetItem[];          // every unit in the group (flat)
  subgroups?: FleetSubgroup[]; // equipment only: by subtype
}

// Partition the fleet into Trucks / Trailers / Tractors / Equipment, each
// sorted ascending (type → subtype → unitNumber via sortFleetGrouped).
// Equipment is sub-grouped by equipmentSubtype, showing every defined
// subtype (so empty categories still surface) plus an "Other" bucket for
// orphaned / unknown subtypes.
export function groupFleet(
  fleet: FleetItem[],
  subtypes: EquipmentSubtypeDefinition[] = [],
): FleetGroup[] {
  const sorted = sortFleetGrouped(fleet, subtypes);
  const byType = (t: string) => sorted.filter(f => f.type === t);

  const equipment = byType('equipment');
  const knownIds = new Set(subtypes.map(s => s.id));
  const subgroups: FleetSubgroup[] = [...subtypes]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(s => ({ key: s.id, label: s.name, units: equipment.filter(e => e.equipmentSubtype === s.id) }));
  const orphans = equipment.filter(e => !e.equipmentSubtype || !knownIds.has(e.equipmentSubtype));
  if (orphans.length > 0) subgroups.push({ key: '__other__', label: 'Other', units: orphans });

  return [
    { key: 'truck', label: 'Trucks', units: byType('truck') },
    { key: 'trailer', label: 'Trailers', units: byType('trailer') },
    { key: 'tractor', label: 'Tractors', units: byType('tractor') },
    { key: 'equipment', label: 'Equipment', units: equipment, subgroups },
  ];
}

export type AttentionLevel = 'alert' | 'warning' | 'none';

export interface UnitAttention {
  // Highest severity for the row icon. alert (past due) > warning
  // (coming due / open repair) > none.
  level: AttentionLevel;
  pastDue: boolean;      // a maintenance item is at/over its next-due reading
  comingDue: boolean;    // a maintenance item is within its warn buffer
  openRepair: boolean;   // an open (non-done) repair exists for this unit
  missingInfo: boolean;  // any unfilled/stale required field
  missing: string[];     // human-readable list of what's missing/stale
  // Oil-change / maintenance status for the per-row colour chip.
  //   'overdue' (red)  — current >= nextDueAt
  //   'soon'    (yellow) — within the warn buffer of next-due
  //   'good'    (green)  — below next-due − buffer
  //   'unset'   (grey)   — a maintenance unit (km/hour) with NO configured
  //                        schedule; shown grey so it's clearly "not set".
  //   'none'             — not a maintenance unit (trailer / non-tracking
  //                        equipment); no oil chip applies.
  maintStatus: 'overdue' | 'soon' | 'good' | 'unset' | 'none';
}

// Compute the display status for one unit. Composes existing predicates;
// does NOT spawn tasks or change data. Winterized units report 'none'
// with no missing flags (they're intentionally excluded from alerts,
// matching the existing banners).
export function getUnitAttention(
  unit: FleetItem,
  opts?: { hasOpenRepair?: boolean },
): UnitAttention {
  if (unit.isWinterized) {
    return { level: 'none', pastDue: false, comingDue: false, openRepair: false, missingInfo: false, missing: [], maintStatus: 'none' };
  }

  const isKm = isKmMaintenanceUnit(unit);
  const isHr = isHourMaintenanceUnit(unit);
  const current = isKm
    ? (typeof unit.odometer === 'number' ? unit.odometer : 0)
    : (typeof unit.currentEngineHours === 'number' ? unit.currentEngineHours : 0);
  const metric: 'hours' | 'km' = isKm ? 'km' : 'hours';
  const defaultBuffer = isKm ? WARN_KM : WARN_HOURS;

  let pastDue = false;
  let comingDue = false;
  let hasUnsetNextDue = false;

  const items = unit.maintenanceItems || [];
  // Only evaluate items whose metric matches how this unit is tracked.
  const relevant = items.filter(mi => (mi.metric || 'hours') === metric);
  let configuredCount = 0;
  for (const mi of relevant) {
    if (typeof mi.nextDueAt !== 'number' || mi.nextDueAt <= 0) {
      hasUnsetNextDue = true; // unconfigured schedule
      continue;
    }
    configuredCount++;
    const buffer = typeof mi.warnBuffer === 'number' && mi.warnBuffer > 0 ? mi.warnBuffer : defaultBuffer;
    if (current >= mi.nextDueAt) pastDue = true;
    else if (current >= mi.nextDueAt - buffer) comingDue = true;
  }

  // Oil-change / maintenance chip status. Maintenance units (km trucks /
  // hour equipment+tractors) always get a chip: grey 'unset' when no
  // schedule is configured, else green/yellow/red. Non-maintenance units
  // (trailers / non-tracking equipment) get 'none' (no chip).
  const isMaintUnit = isKm || isHr;
  const maintStatus: UnitAttention['maintStatus'] =
    !isMaintUnit
      ? 'none'
      : configuredCount === 0
        ? 'unset'
        : pastDue ? 'overdue' : comingDue ? 'soon' : 'good';

  const missing: string[] = [];
  // A maintenance-tracked unit with NO matching schedules, or one with an
  // unconfigured next-due, counts as missing info.
  if ((isKm || isHr) && (relevant.length === 0 || hasUnsetNextDue)) {
    missing.push(isKm ? 'Oil change / next-due not set' : 'Maintenance next-due not set');
  }
  if (isKm && isOdoStale(unit.lastOdometerUpdate)) missing.push('Odometer not updated');
  if (isHr && isEngineHoursStale(unit.lastHourUpdateAt)) missing.push('Engine hours not updated');
  if (needsPlateRenewal(unit) && !unit.regExpiry) missing.push('Plate renewal date');
  if (needsCommercialSafety(unit) && !unit.safetyExpiry) missing.push('Commercial safety date');

  const openRepair = !!opts?.hasOpenRepair;
  const missingInfo = missing.length > 0;

  const level: AttentionLevel = pastDue
    ? 'alert'
    : (comingDue || openRepair)
      ? 'warning'
      : 'none';

  return { level, pastDue, comingDue, openRepair, missingInfo, missing, maintStatus };
}

// Set of unit ids with an open (non-done) repair — lets a list compute
// the open-repair flag once and feed it into getUnitAttention.
export function openRepairUnitIds(tasks: MechanicTask[] | undefined): Set<string> {
  const set = new Set<string>();
  for (const t of tasks || []) {
    if (t.status !== 'done' && t.unitId) set.add(t.unitId);
  }
  return set;
}

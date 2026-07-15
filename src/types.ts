export type UserRole = 'admin' | 'manager' | 'foreman' | 'worker' | 'mechanic';

export type ManagedDivision = 'lawn' | 'small' | 'large' | 'all';

export type PrimaryCrew = 'Office' | 'Lawn' | 'Small Project' | 'Large Project' | 'Snow';
export const PRIMARY_CREWS: PrimaryCrew[] = ['Office', 'Lawn', 'Small Project', 'Large Project', 'Snow'];

export interface Employee {
  id: string;
  name: string;
  status: string;
  hasLicense: boolean;
  hasClassA: boolean;
  hasHeavyMachinery: boolean;
  awayDates: { start: string; end: string }[];
  email?: string;
  timeMasterEnabled?: boolean;
  linkedUserEmail?: string;
  systemRole?: UserRole;
  jobberUserId?: string;
  managedDivision?: ManagedDivision;
  primaryCrew?: PrimaryCrew;
  // Mechanic pay-chunk rate. When set, every (hoursPer1000) clocked
  // hours yields $1,000 of accountability — drives the pay-chunk
  // state machine. Only meaningful for systemRole === 'mechanic'.
  hoursPer1000?: number;
  // Sentinel Employee record auto-bootstrapped on first load so an
  // admin can "View As: Test User" and exercise every non-admin
  // surface without signing into a real account. Exactly one
  // employee in the directory carries this flag; it cannot be
  // deleted via the Personnel admin form.
  isTestUser?: boolean;
}

// One slice of $1,000 of mechanic pay, defined by clocked-hours
// accumulation between two timestamps. Open chunks accumulate hours
// until they cross `hoursThreshold`, at which point they close and a
// new chunk opens. The threshold is snapshotted at chunk-open time
// so historical chunks are unaffected when the rate changes.
export interface MechanicPayChunk {
  id: string;
  mechanicId: string;
  mechanicEmail: string;
  startTimestamp: number;
  endTimestamp?: number;
  hoursThreshold: number;
  hoursWorked: number;
  status: 'open' | 'closed';
  // True when an admin used the rollout form to seed an open chunk
  // with already-accrued hours (no historical TimeMaster data to
  // sum from). `manualHoursOffset` is the seed value added to the
  // computed sum since `startTimestamp`.
  manualBackfill?: boolean;
  manualHoursOffset?: number;
  // Mark-paid bookkeeping (additive, closed chunks only). A closed
  // chunk with paidAt set is settled; without it, it's owed. NOTE:
  // syncToCloud's scrubber converts undefined → null, so readers must
  // treat BOTH null and undefined as unpaid — always test
  // `!chunk.paidAt`. Un-marking DELETES these three keys (never sets
  // them to undefined). The earning state machine never reads or
  // writes these; they're pure bookkeeping on top of it.
  paidAt?: number;
  paidBy?: string;
  paidByName?: string;
}

export interface TimeEntryNote {
  author: string;
  authorName: string;
  timestamp: string;
  text: string;
}

export interface TimeEntry {
  id: string;
  userEmail: string;
  userName: string;
  clockIn: string;
  clockOut?: string;
  inLocation?: { lat: number; lng: number };
  outLocation?: { lat: number; lng: number };
  notes: TimeEntryNote[];
  editedBy?: string;
  editedAt?: string;
  isUnclosed?: boolean;
  // Manual entry — created via the "Add Manual Entry" modal for
  // missed punches rather than a real clock-in / clock-out tap.
  // Functionally identical to a clocked entry (same hours math,
  // same pay-chunk feeding); the flag is purely a record/UI marker.
  manualEntry?: boolean;
  enteredBy?: { email: string; name: string };
  // Sub-variant of manualEntry. When true, the manager entered
  // HOURS only (not specific times). clockIn / clockOut are
  // synthesized (nominal 8:00 AM start + hours duration) so the
  // existing timestamp-based math (pay chunks, duration, etc.)
  // works unchanged. The TimeMaster row uses this flag to render
  // "X hrs (entered as hours)" instead of the in/out columns.
  manualHoursOnly?: boolean;
}

export type FleetType = 'truck' | 'trailer' | 'tractor' | 'equipment';

// Admin-managed equipment subtype definitions. Persisted in
// AppData.equipmentSubtypes; seeded from DEFAULT_EQUIPMENT_SUBTYPES
// on first load if missing/empty. FleetItem.equipmentSubtype stores
// the `id` of one of these entries (or undefined for orphans).
export interface EquipmentSubtypeDefinition {
  id: string;
  name: string;
  sortOrder: number;
}

export const DEFAULT_EQUIPMENT_SUBTYPES: EquipmentSubtypeDefinition[] = [
  { id: 'stand_on_mower',   name: 'Stand On Mower',     sortOrder: 1 },
  { id: 'rider_mower',      name: 'Rider Mower',        sortOrder: 2 },
  { id: 'single_blade',     name: 'Single Blade Mower', sortOrder: 3 },
  { id: 'dual_blade',       name: 'Dual Blade Mower',   sortOrder: 4 },
  { id: 'grass_trimmer',    name: 'Grass Trimmer',      sortOrder: 5 },
  { id: 'hedge_trimmer',    name: 'Hedge Trimmer',      sortOrder: 6 },
  { id: 'backpack_blower',  name: 'Backpack Blower',    sortOrder: 7 },
  { id: 'handheld_blower',  name: 'Handheld Blower',    sortOrder: 8 },
  { id: 'chainsaw',         name: 'Chainsaw',           sortOrder: 9 },
];

// Per-unit document (registration, insurance, ownership, safety cert).
// Extends StoredFile (bytes in Storage under fleet/{unitId}/{docType}/…) with
// document-specific metadata. Stored on FleetItem.documents — metadata only.
export type FleetDocType = 'insurance' | 'registration' | 'ownership' | 'safety_inspection' | 'other';
export interface FleetDocument extends StoredFile {
  docType: FleetDocType;
  // Free-text label, required in practice only for docType 'other'.
  label?: string;
  // Optional expiry (YYYY-MM-DD). Ownership has none; insurance /
  // registration / safety inspection do — drives the expiry warnings.
  expiryDate?: string;
  notes?: string;
}

export interface FleetItem {
  id: string;
  name: string;
  type: string;
  status: string;
  // Uploaded documents for this unit (metadata only; bytes in Storage).
  documents?: FleetDocument[];
  // Legacy weight-class label. New records derive their band from
  // `registeredGrossWeight` via resolveWeightBand(); this string is
  // preserved on existing records for back-compat and only consulted
  // when RGW is absent. Editing UI no longer surfaces it — the
  // manager enters RGW and the band is computed.
  weightClass: string;
  // Registered gross weight in kg. Truck-only in practice — source
  // of truth for the band (under_3000 / 3000_4500 / 4501_10999 /
  // 10999_plus). When undefined, resolveWeightBand falls back to
  // mapping the legacy `weightClass` string.
  registeredGrossWeight?: number;
  // License plate. Trucks AND trailers; equipment has no plate.
  plateNumber?: string;
  color?: string;
  odometer?: number;
  repairTags: string[];
  lastOdometerUpdate?: string;
  cvorRequired?: boolean;
  lastInspectionId?: string;
  inspectionStatus?: 'green' | 'yellow' | 'red' | 'missing';
  regExpiry?: string;
  safetyExpiry?: string;
  commercialSafetyExpire?: string;
  isYellowSticker?: boolean;
  serialNumber?: string;
  modelNumber?: string;
  isRental?: boolean;
  rentalEnd?: string;
  mechanicNotes?: string;
  connectorPins?: ('7-pin' | '5-pin' | '4-pin')[];
  hasRampRack?: boolean;
  trailerPin?: '7-pin' | '5-pin' | '4-pin';
  notes?: UnitNote[];
  unitNumber?: number;
  // References an EquipmentSubtypeDefinition.id from
  // appData.equipmentSubtypes. Stored as a stable ID so renaming a
  // subtype doesn't orphan items.
  equipmentSubtype?: string;
  // Engine-hour tracking & per-unit maintenance schedule. Independent
  // of the odometer; some units (equipment, large mowers) run on
  // hours not km. Auto-spawn logic in App.tsx writes activeTaskId on
  // each maintenance item when it crosses the warning threshold.
  tracksEngineHours?: boolean;
  currentEngineHours?: number;
  // ms timestamp of the last hour reading — drives the Missing Hour
  // Updates banner.
  lastHourUpdateAt?: number;
  // Km-based maintenance opt-in for trucks / trailers / tractors.
  // Parallel to tracksEngineHours but keyed off the existing odometer
  // reading. When true, maintenanceItems are evaluated on odometer
  // updates by processMaintenanceForOdometerUpdate.
  tracksMaintenance?: boolean;
  maintenanceItems?: MaintenanceItem[];
  // Seasonal storage. Winterized units hide from the active Fleet
  // List, can't be assigned, can't be inspected. Reactivate to
  // restore.
  isWinterized?: boolean;
  winterizedAt?: number;
  // Equipment Time Off — same shape, same inclusive-range
  // semantics as Employee.awayDates. Admin enters scheduled
  // maintenance / service windows directly via ManageResources
  // (no request/approval flow). Saving a range auto-removes
  // the unit from any crew assignments on those dates.
  awayDates?: { start: string; end: string }[];
}

// One maintenance schedule on a fleet unit. Two metric variants:
//   - 'hours' (default; mowers/equipment) — driven by currentEngineHours,
//     500-style buffer = 25 hrs, completion auto-recomputes nextDueAt
//     from threshold (rigid interval).
//   - 'km' (trucks/trailers/tractors) — driven by odometer, 500 km
//     buffer, threshold acts as a PRE-FILL default for next-due only;
//     the mechanic enters the explicit next-due at service time
//     (oil-grade dependent — synthetic vs conventional).
// activeTaskId mirrors the most recent spawned maintenance task so
// the helper doesn't double-spawn. Completing the task (or Manual
// Reset) advances lastServiceAt + lastServiceValue + nextDueAt and
// clears activeTaskId.
export interface MaintenanceItem {
  id: string;
  name: string;
  threshold: number;
  nextDueAt: number;
  lastServiceAt?: number;
  // Reading at last service. Generic name — works for hours or km.
  // lastServiceHours is retained for back-compat reads of pre-unify
  // data; new writes set lastServiceValue.
  lastServiceValue?: number;
  lastServiceHours?: number;
  activeTaskId?: string;
  metric?: 'hours' | 'km';
  // Per-item due-soon buffer (yellow-warning window) in the item's
  // metric units. Editable in the Fleet edit form; falls back to the
  // metric default (500 km / 25 hrs) when undefined. Spawn helper
  // reads this to decide when to surface a maintenance task.
  warnBuffer?: number;
}

export interface UnitNote {
  id: string;
  author: string;
  authorName: string;
  timestamp: string;
  text: string;
}

export interface OverrideRecord {
  id: string;
  type: string;
  unitId: string;
  warningMessage: string;
  overriddenBy: string;
  overriddenByName: string;
  timestamp: string;
  reason?: string;
}

// One row per hard-delete of a mechanic record. The snapshot field holds
// the full pre-delete record JSON so an admin can manually reconstruct
// what was removed (or restore it via direct Firestore edit if needed).
export interface DeletionAuditEntry {
  id: string;
  timestamp: number;
  userEmail: string;
  userName: string;
  userRole: UserRole;
  recordType: 'task' | 'repair_log' | 'inspection_log' | 'time_entry';
  recordId: string;
  summary: {
    title?: string;
    unitName?: string;
    severity?: string;
    date?: string;
  };
  snapshot: unknown;
}

// How a Jobber visit's BH is split across multiple CrewMaster crews when
// the visit's assignees map to more than one crew on the same date.
// The map appData.visitBHSplits is keyed by jobberVisitId.
//   - splitMethod 'auto'  → headcount-proportional, recomputed by the sync
//   - splitMethod 'manual' → manager-overridden, preserved across syncs
// A single-crew visit has no entry in this map.
export interface VisitBHSplit {
  visitId: string;
  totalBH: number;
  splits: Array<{ crewId: string; bh: number }>;
  splitMethod: 'auto' | 'manual';
  lastUpdatedAt: number;
}

// Partial-day time off for an employee on a given date — e.g. a 1-3 PM
// appointment. DISPLAY ONLY: never feeds BH / AH / efficiency math (actual
// hours come from the Jobber time clock) and never gates crew assignment.
// Stored per date in AppData.partialTimeOff, keyed by YYYY-MM-DD.
export interface PartialTimeOff {
  id: string;
  empId: string;
  start: string; // "HH:MM" 24-hour, from an <input type="time">
  end: string;   // "HH:MM" 24-hour
}

// Digital time-off request + approval flow. Submitted by any user
// from TimeMaster, approved/denied from the new Time Off page by
// canApproveTimeOff role(s). On approval, the request is written
// into the same employee.awayDates / partialTimeOff structures that
// manual Personnel entry uses, so downstream behavior is identical.
// `applied*` markers are stamped on approval so revert can undo
// cleanly without guessing.
export interface TimeOffRequest {
  id: string;
  employeeId: string;
  employeeEmail: string;
  employeeName: string;
  type: 'full_day' | 'partial';
  // full_day:
  startDate?: string;
  endDate?: string;
  // partial:
  partialDate?: string;
  partialStart?: string;
  partialEnd?: string;
  note?: string;
  status: 'pending' | 'approved' | 'denied' | 'cancelled' | 'reverted';
  createdAt: number;
  reviewedBy?: { email: string; name: string };
  reviewedAt?: number;
  denialReason?: string;
  // Tracks the Personnel write that approval emitted, so revert can
  // surgically undo it.
  appliedAwayDateRange?: { start: string; end: string };
  appliedPartialKeys?: Array<{ date: string; ptoId: string }>;
  // Notification tracking — TaskMaster per-record pattern.
  seenByRequester?: number;
  acknowledgedByAdmin?: Record<string, number>;
}

// Custom override map: rolePermissions[role][permissionKey] = boolean
// Permission key is whatever ROLE_PERMISSIONS in lib/permissions.ts defines.
// `undefined` for any role+permission falls back to the hardcoded default.
export type RolePermissionsOverride = Partial<Record<UserRole, Partial<Record<string, boolean>>>>;

export interface DefectDetail {
  category: string;
  severity: 'minor' | 'major';
  notes: string;
  photoUrl?: string;
}

export type TaskActivityType = 'created' | 'status_changed' | 'note_added' | 'note_deleted' | 'priority_changed' | 'waiting_on_parts_changed' | 'completed' | 'deleted';

export interface TaskActivity {
  id: string;
  type: TaskActivityType;
  userEmail: string;
  userName: string;
  timestamp: string;
  taskId: string;
  unitId?: string;
  unitName?: string;
  taskCategory?: string;
  taskSeverity?: 'minor' | 'major';
  // Reporter of the underlying repair, stamped onto each activity so the
  // repair log shows "Reported by" even after the task itself is removed.
  reportedBy?: { employeeId: string; name: string };
  payload?: Record<string, any>;
}

export interface TaskNote {
  id: string;
  author: string;
  authorName: string;
  timestamp: string;
  text: string;
}

// A file stored in Firebase Storage, referenced from Firestore by metadata
// only — the bytes never live in Firestore. Shared across every upload
// surface (repair photos now; fleet docs, policies, duty photos next).
export interface StoredFile {
  url: string;                 // download URL
  path: string;                // full Storage path (used for delete)
  name: string;                // original filename
  size: number;                // bytes AFTER compression
  contentType: string;
  uploadedAt: number;
  uploadedBy: { email: string; name: string };
  kind: 'image' | 'pdf' | 'other';
  // Which stage of a repair the photo documents. Absent on non-repair
  // surfaces. 'report' = problem as filed; 'completion' = finished work.
  phase?: 'report' | 'completion';
}

export interface MechanicTask {
  id: string;
  unitId?: string;
  unitName: string;
  category: string;
  description: string;
  notes?: TaskNote[];
  // Repair photos (Storage bytes; metadata only here). Report-time shots
  // documenting the problem; completion shots are merged onto the
  // repairLog entry when the task is closed.
  photos?: StoredFile[];
  severity: 'minor' | 'major';
  status: 'todo' | 'doing' | 'done';
  dateReported: string;
  isMaintenance?: boolean;
  inspectionId?: string;
  // Who reported the repair (may differ from who entered it — a manager
  // can file on behalf of a crew member). Defaults to the enterer at
  // creation. Backfill: entries without this fall back to their 'created'
  // activity's userName for display.
  reportedBy?: { employeeId: string; name: string };
  activity?: TaskActivity[];
  // Legacy single assignee. Kept for back-compat — readers prefer
  // `assignees` when it's present and fall back to this otherwise (see
  // assigneesForTask in lib/workCredit). Assignment writers keep this in
  // sync with assignees[0] so surfaces not yet multi-aware still render.
  assignedTo?: { userEmail: string; userName: string };
  // Multi-mechanic assignment (no cap). When non-empty this is the
  // source of truth for who the task is assigned to.
  assignees?: Array<{ userEmail: string; userName: string }>;
  priority?: boolean;
  waitingOnParts?: boolean;
  // Mirror of the earliest-stage open partsOrder linked to this repair
  // (any partsOrder where order.repairId === task.id). Recomputed on
  // every partsOrder mutation. Sort + wrench-icon color on the Repair
  // Board read this field.
  partsStatus?: 'requested' | 'ordered' | 'arrived';
  // Provenance of the task. 'manual' = filed via Report Repair;
  // 'inspection' = generated from a defect on an inspection;
  // 'maintenance' = auto-spawned by the engine-hour threshold helper.
  // The Repair Board treats 'maintenance' specially: yellow visual
  // tint, MAINTENANCE chip in place of the severity badge, and the
  // CompletionModal asks for "Engine hours at service" so the
  // maintenance schedule can advance.
  source?: 'manual' | 'inspection' | 'maintenance';
  // When source==='maintenance', this links back to the
  // MaintenanceItem.id on the parent fleet unit so the reset logic
  // can find the right schedule to advance on completion.
  sourceMaintenanceItemId?: string;
}

// Parts request workflow. A PartsOrder is created either generically
// (top "Request Parts" button on the Repair Board, no repairId) or
// from a specific repair card (green "Request Parts" button on the
// card, repairId set to that task's id). Status flows
// requested → ordered → arrived. Manager/admin promotes 'requested' →
// 'ordered'; mechanic/manager/admin promotes 'ordered' → 'arrived'.
export interface PartsOrder {
  id: string;
  partName: string;
  quantity: number;
  unitId?: string;
  unitName?: string;
  notes?: string;
  repairId?: string;
  status: 'requested' | 'ordered' | 'arrived';
  requestedBy: { email: string; name: string };
  requestedAt: number;
  orderedBy?: { email: string; name: string };
  orderedAt?: number;
  arrivedBy?: { email: string; name: string };
  arrivedAt?: number;
  // Append-only audit trail for status changes. Created at order-creation
  // time is captured by requestedBy/At alone; this array starts empty and
  // appends an entry on every subsequent state transition (in any
  // direction — Arrived → Ordered, Ordered → Requested, etc. are all
  // recorded). Not shown in the main UI for v1; retained for retrospective
  // debugging and future audit displays.
  statusHistory?: Array<{
    from: 'requested' | 'ordered' | 'arrived';
    to: 'requested' | 'ordered' | 'arrived';
    by: { email: string; name: string };
    at: number;
  }>;
}

export interface Inspection {
  id: string;
  unitId: string;
  driverId: string;
  driverName: string;
  inspectorEmail?: string;
  inspectorName?: string;
  type: 'DVIR' | 'CircleCheck' | 'Trailer' | 'Maintenance';
  date: string;
  timestamp: string;
  odometer: number;
  location: string;
  defects: DefectDetail[];
  isMajor: boolean;
  signature: string;
  status: 'clean' | 'minor' | 'major';
  // Maintenance-entry-only fields. Populated when a maintenance task
  // is completed (CompletionModal) or when an admin/manager presses
  // Manual Reset on a Fleet List maintenance item. Other entry types
  // leave these blank.
  maintenanceItemId?: string;
  maintenanceItemName?: string;
  hoursAtService?: number;
  // Km reading at the time of a truck/trailer/tractor maintenance
  // service. Mutually exclusive with hoursAtService in practice
  // (the unit either tracks hours or km).
  kmAtService?: number;
  maintenanceMetric?: 'hours' | 'km';
  performedBy?: { email: string; name: string };
  maintenanceNotes?: string;
  maintenanceSource?: 'task_completion' | 'manual_reset';
  // Audit trail for reading-validation overrides. Set when the
  // inspector confirmed a reading that tripped a guard
  // (lower-than-last, or jumped by more than the threshold) and
  // chose to proceed anyway. Absence = reading was within range
  // or equal to the prior value. Stored on the inspection itself
  // so the trail survives even if the unit's reading is later
  // corrected.
  readingOverride?: {
    type: 'lower' | 'jump';
    metric: 'km' | 'hours';
    enteredValue: number;
    lastValue: number;
    overriddenBy: { email: string; name: string };
    at: string;
  };
}

export interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  stock: number;
  lastAudit: string;
}

export interface Crew {
  id: string;
  division: string;
  crewNumber: number;
  employees: string[];
  fleet: string[];
  inventory: { id: string; qty: number }[];
  isAdHoc?: boolean;
  notes?: string;
  supplies?: string[];
  dispatched?: boolean;
  dispatchOverrides?: OverrideRecord[];
  equipmentClosedAt?: string;
  equipmentClosedBy?: string;
  equipmentClosedByName?: string;
  jobberAssigneeIds?: string[];
}

export interface JobberUser {
  id: string;
  name: string;
  isAccountOwner: boolean;
  isArchived?: boolean;
}

export interface Job {
  id: string;
  name: string;
  bh: number;
  division?: string;
  crewNumber?: number;
  frequency?: string;
  targetDay?: string;
}

export interface Deduction {
  hours: number | string;
  reason?: string;
}

// Deduction values may be a legacy number/string OR the new object shape.
export type DeductionValue = number | string | Deduction;

export interface ShiftHistoryEntry {
  fromDate: string;
  toDate: string;
  fromCrewId: string;
  toCrewId: string;
  userEmail: string;
  userName: string;
  timestamp: number;
}

export interface PerformanceJobRow {
  desc: string;
  bh: number | string;
  routeId?: string;
  source?: 'manual' | 'jobber';
  jobberVisitId?: string;
  jobberJobId?: string;
  jobberJobNumber?: string;
  manuallyEditedAt?: string;
  hasJobberConflict?: boolean;
  jobberSuggestedValue?: number;
  removedFromJobber?: boolean;
  awaitingCompletionReview?: boolean;
  awaitingHourlyBH?: boolean;
  isIncompleteVisit?: boolean;
  totalBH?: number;
  jobberTagType?: 'bh' | 'hourly';
  carriedForwardFrom?: string;
  manuallyShifted?: boolean;
  shiftedFromDate?: string;
  shiftHistory?: ShiftHistoryEntry[];
  movedToDate?: string;
  ghostFromVisitId?: string;
  awaitingBhTag?: boolean;
}

export interface CarryForwardCandidate {
  jobberVisitId: string;
  jobberJobId: string;
  jobTitle: string;
  priorDate: string;
  priorCrewId: string;
  priorCumulativePct: number;
  remainingBH: number;
  totalBH: number;
}

export type PerfActivityType =
  | 'manual_job_added'
  | 'manual_job_edited'
  | 'manual_job_removed'
  | 'jobber_bh_unlocked'
  | 'jobber_bh_edited'
  | 'jobber_bh_reverted'
  | 'hourly_bh_entered'
  | 'hourly_bh_edited'
  | 'deduction_added'
  | 'deduction_edited'
  | 'deduction_removed'
  | 'worker_removed'
  | 'worker_unscheduled_added'
  | 'ah_split'
  | 'ah_manually_edited'
  | 'multiday_percent_marked'
  | 'multiday_split_added'
  | 'multiday_percent_overridden'
  | 'job_type_converted'
  | 'entry_deleted'
  | 'entry_cleared'
  | 'approval_granted'
  | 'approval_revoked'
  | 'multiday_auto_credited_on_completion'
  | 'multiday_carried_forward'
  | 'dispatch_issue_reported'
  | 'bh_shifted_day'
  | 'visit_auto_moved_on_completion'
  | 'bh_filled_in_manually'
  | 'approval_waived'
  | 'chunk_marked_paid'
  | 'chunk_payment_reversed'
  | 'performance_month_pushed'
  | 'performance_day_archived'
  | 'performance_day_unlocked'
  | 'schedule_month_archived';

export interface PerfActivityEntry {
  id: string;
  type: PerfActivityType;
  timestamp: number;
  userId: string;
  userName: string;
  userRole: UserRole;
  targetDate: string;
  crewId: string;
  crewLabel: string;
  workerId?: string;
  workerName?: string;
  jobberJobId?: string;
  jobTitle?: string;
  valueBefore?: number | string | null;
  valueAfter?: number | string | null;
  valueLabel?: string;
  reason?: string;
  reasonNote?: string;
  sourceJobberVisitId?: string;
}

export interface CompletionEntry {
  targetDate: string;
  percentComplete: number;
  creditedBH: number;
  crewId: string;
  // Stable cross-day crew identity ("<division-lower>-<crewNumber>") —
  // crewId is unique per-day (regenerated whenever the crew row is
  // created), so the auto-credit + priorPct filters can't rely on it
  // for matching the same crew across days. crewKey is populated at
  // write time and matched at read time, with a fallback to crewId for
  // legacy entries written before this field existed.
  crewKey?: string;
  markedAt: number;
  markedBy: string;
  markedByName: string;
  isRetroactive: boolean;
  reasonNote?: string;
}

export interface MultiDayJob {
  // Primary identifier — the map appData.multiDayJobs is keyed by this.
  // Each Jobber visit gets its own ledger; multi-visit recurring jobs no
  // longer collide. `jobberJobId` is retained as parent-job metadata for
  // display/grouping only and must NOT be used for keying/lookups.
  jobberVisitId: string;
  jobberJobId: string;
  jobberJobNumber: number | string;
  title: string;
  totalBH: number;
  // Informational only — kept on the record but no longer drives any
  // branching in the sync or attribution path. Lawn = regular job.
  isLawnJob: boolean;
  manualOverride: boolean;
  completionHistory: CompletionEntry[];
  status: 'in_progress' | 'complete';
  // Set when the ledger is first created; never read anywhere. The Phase 0
  // storage stopgap (syncToCloud) strips it from COMPLETED ledgers to save
  // space, so it is optional on already-slimmed records.
  firstSeenAt?: number;
  // Manager-driven escape hatch. When true, the carry-forward
  // prompt no longer surfaces this visit and the cloud sync's
  // auto-credit / candidate emission both skip it. The existing
  // completionHistory and any BH already credited on prior days
  // are NOT touched — this is purely a "stop tracking it" flag.
  dismissedCarryForward?: boolean;
  dismissedCarryForwardAt?: number;
  dismissedCarryForwardBy?: { email: string; name: string };
}

export interface PerformanceLog {
  division: string;
  crewNumber: number;
  isAdHoc: boolean;
  jobs: PerformanceJobRow[];
  employeeAH: Record<string, any>;
  deductions: Record<string, DeductionValue>;
  // Manual-AH marker. Keys are employee ids whose employeeAH value was
  // deliberately set by a manager (currently: the AH Split modal, on
  // BOTH the source and target crew-days). A flagged entry is
  // authoritative pay data: the Jobber sync must never overwrite it
  // with the whole-day timesheet total, and the ghost-AH prune must
  // never strip it (a split-in worker is off-roster + jobber-linked —
  // the exact signature the prune otherwise treats as sync garbage).
  manualAH?: Record<string, boolean>;
  // 'waived' is a terminal, manager-set state meaning "this crew-day
  // does not require approval" (e.g. a shop / odd-jobs day). It is
  // locked like 'approved' (editing disabled, sync skips it) and,
  // because isBonusEligible is strict === 'approved', it is excluded
  // from bonus/MTD by construction — a waived day never counts.
  approvalStatus?: 'pending' | 'approved' | 'waived';
  approvedAt?: string;
  approvedBy?: string;
  approvedByName?: string;
  // Waiver metadata — set together when approvalStatus === 'waived'.
  // waivedReason is REQUIRED at the point of waiving (empty rejected).
  waivedReason?: string;
  waivedBy?: string;
  waivedByName?: string;
  waivedAt?: string;
  lastJobberSyncAt?: number;
  removedEmployees?: string[];
  // Snapshot of the crew-size efficiency allowance applied to this
  // crew on this date. Stamped by the sync from
  // appData.settings.crewSizeAllowance + scheduledSize at sync
  // time so retuning the table later doesn't rewrite history.
  // `effectivePct` is the concurrency-weighted blend when the sync
  // had timesheet intervals to walk — solo windows use the 1-man
  // pct, fully-staffed windows use the N-man pct, blended by
  // duration. Legacy stamps without `effectivePct` fall back to
  // `pct` (single roster-based number) so historical reads don't
  // change. `segments` is the per-window breakdown kept for audit.
  crewSizeAllowance?: {
    size: number;
    pct: number;
    effectivePct?: number;
    segments?: { size: number; pct: number; durationMs: number }[];
    // Coalescing threshold (minutes) the stamp was computed against.
    // Stamped by the sync from CONCURRENCY_TOLERANCE_MIN. On read,
    // getCrewAllowance honours the stamp only when it matches the
    // current constant; mismatch triggers live-recompute from the
    // immutable employeeTimesheets. This lets us tune the threshold
    // and have history auto-rebase on the next render without a
    // bulk re-sync (which couldn't touch approved crew-days anyway).
    tolerance?: number;
  };
  // Per-employee Jobber timesheet intervals captured at sync time.
  // Same source as employeeAH (the daily totals are unchanged) — this
  // is the additive interval list used to derive concurrency-weighted
  // BH split + time-windowed crew-size allowance. A worker can have
  // multiple intervals per day (split shifts). endAt === null marks
  // an open/ticking shift at sync time; downstream math treats null
  // as "[startAt, now]". Absent (legacy log, or sync ran before this
  // field landed) → downstream math falls back to today's flat
  // formulas, no regression.
  employeeTimesheets?: Record<string, { startAt: string; endAt: string | null }[]>;
}

export interface SyncLogEntry {
  id?: string;
  targetDate: string;
  triggeredBy: 'manual' | 'scheduled';
  triggeredByUserId?: string;
  triggeredAt: number;
  visitsProcessed: number;
  visitsParsed: number;
  visitsUnmatched: number;
  parseErrors: number;
  entriesCreated: number;
  entriesUpdated: number;
  entriesSkippedApproved: number;
  crewsAffected: number;
  errors: string[];
  warnings?: string[];
  multiDayAutoCredited?: number;
  carryForwardCandidates?: CarryForwardCandidate[];
}

// Editable rule for the crew-size efficiency allowance. Each row
// applies to a min headcount, ordered ascending. The applied
// percentage for a given size is the pct of the highest row whose
// minSize ≤ size. See DEFAULT_CREW_SIZE_ALLOWANCE for the seed.
export interface CrewSizeAllowanceRow {
  minSize: number;
  pct: number;
}

export interface AppSettings {
  endOfDayReminder?: string;
  // Admin-editable allowance table. When absent, the default
  // (1-2 → 0%, 3 → 10%, 4 → 15%, 5+ → 20%) applies.
  crewSizeAllowance?: CrewSizeAllowanceRow[];
  // RoleMaster MASTER TOGGLE. Default OFF (undefined/false) for beta — the
  // server-side duty→task generator produces NOTHING until an admin flips
  // this on. Per-role and per-duty `active` flags gate further.
  roleMasterGenerationEnabled?: boolean;
  // RoleMaster category → palette color-key map. Small + bounded (a handful
  // of categories). New categories auto-assign the next unused palette color.
  roleMasterCategoryColors?: Record<string, string>;
}

export type BulletinAudienceRole = 'admin' | 'manager' | 'foreman' | 'mechanic' | 'worker';

// TaskMaster — admin-assigned tasks for employees. Distinct from
// MechanicTask (which lives on the Repair Board). Stored as a map
// keyed by id so individual mutations are cheap with the full-
// document setDoc sync pattern.
export interface TaskMasterNote {
  id: string;
  author: { email: string; name: string };
  text: string;
  createdAt: number;
}

export interface TaskMasterTask {
  id: string;
  title: string;
  description?: string;
  assignedTo: { employeeId: string; email: string; name: string };
  createdBy: { email: string; name: string };
  createdAt: number;
  dueDate?: number;
  priority: 'high' | 'normal';
  // Two states only: 'not_started' (open) → 'done'. The legacy
  // 'in_progress' value was removed; readers treat any non-'done' status
  // as open (see TaskMaster grouping) so old data degrades gracefully.
  status: 'not_started' | 'done';
  completedAt?: number;
  notes?: TaskMasterNote[];
  // Per-user "last seen" timestamps for the assignment badge. Keyed
  // by lowercase email. If acknowledgedBy[user] < createdAt, the
  // task counts as unacknowledged for that user. Opening TaskMaster
  // bumps every assigned task's entry to Date.now().
  acknowledgedBy?: Record<string, number>;
}

export interface BulletinPost {
  id: string;
  title: string;
  content: string;
  date: string;
  author: string;
  audience?: BulletinAudienceRole[];
  isAdminOnly?: boolean;
}

// ── RoleMaster ──────────────────────────────────────────────────────────
// Roles + recurring duties + generated task instances. All three live in
// subcollections (roleMaster/roles, /duties, /taskInstances) — nothing
// unbounded enters the 1 MiB-capped appData doc. Terminal instances are
// retained forever as the accountability record.

export type RoleRecurrenceKind = 'weekly' | 'biweekly' | 'monthly' | 'yearly';
export interface RoleRecurrence {
  kind: RoleRecurrenceKind;
  // weekly / biweekly: 0=Sun..6=Sat.
  dayOfWeek?: number;
  // biweekly: the reference date (YYYY-MM-DD) every 14 days counts from.
  anchorDate?: string;
  // monthly: 1..31, or 'last' for the last calendar day.
  dayOfMonth?: number | 'last';
  // yearly: month (1..12) + day (1..31, clamped to the month length).
  month?: number;
  day?: number;
}

export interface RoleMasterRole {
  id: string;
  name: string;
  description?: string;
  assignedEmployeeId?: string;
  division?: string;
  createdBy?: { email: string; name: string };
  tier: 'admin';              // v1: admin-defined only
  active: boolean;
  updatedAt?: number;
}

// A RESPONSIBILITY (v1.7) — standing ownership of an area (e.g. "Website &
// Domain", "Company Insurance"), distinct from a duty (recurring work).
// Ownership follows the OWNING ROLE (roleId), not a person; the current
// holder resolves through the role's assignment. May have zero linked duties
// (as-needed ownership) or several (a duty links back via responsibilityId).
// Own subcollection: roleMasterResponsibilities/{id} — never in the main doc.
export interface RoleMasterResponsibility {
  id: string;
  name: string;
  description?: string;
  sop: string;                // how-to (markdown + clickable links, same as duty SOPs)
  roleId: string;             // the OWNING role
  division?: string;
  color?: string;             // palette key (same CATEGORY_PALETTE as category chips)
  createdBy?: { email: string; name: string };
  tier: 'admin';
  active: boolean;
  updatedAt?: number;
}

// A reusable TEMPLATE (v1.8 Library) — email/copy blocks staff copy-paste.
// Placeholders like [Customer Name] stay literal (no merge system in v1).
// Own subcollection: roleMasterTemplates/{id}.
export interface RoleMasterTemplate {
  id: string;
  title: string;
  category: string;           // lightweight tag (Quotes, Billing, Scheduling…)
  body: string;               // plain text; line breaks preserved
  notes?: string;             // when to use it
  createdBy?: { email: string; name: string };
  updatedAt?: number;
  active: boolean;
}

// A POLICY / DOCUMENT (v1.8 Library) — an uploaded PDF (StoredFile in
// Storage at policies/{id}/…) OR an external link (Google Doc / Scribe).
// Own subcollection: roleMasterPolicies/{id}.
export interface RoleMasterPolicy {
  id: string;
  title: string;
  category?: string;
  file?: StoredFile;          // uploaded doc (bytes in Storage; metadata here)
  link?: string;             // external URL (mutually used with file; one or the other)
  description?: string;
  createdBy?: { email: string; name: string };
  updatedAt?: number;
  active: boolean;
}

export interface RoleMasterDuty {
  id: string;
  name: string;
  // ── BELONGS TO (v1.7). A duty belongs to EITHER a responsibility OR a plain
  // category tag, never both. When responsibilityId is set the responsibility
  // IS the grouping (name + color) and `category` is cleared/ignored. When
  // absent, `category` is a lightweight color label only (no ownership).
  responsibilityId?: string;
  category: string;           // display-only color tag when no responsibilityId
  sop: string;                // how-to (markdown)
  notePrompt: string;         // REQUIRED completion question
  recurrence: RoleRecurrence;
  dueSoonDays: number;        // amber window before due (default 2)
  roleId: string;
  division?: string;
  tier: 'admin';
  active: boolean;
  // ── DURATION (the window a duty fires within). Three shapes, all optional
  // and mutually exclusive per the editor. Absent = INDEFINITE (runs forever
  // — byte-identical to pre-v1.6 behaviour):
  //  • ONE-SHOT bounded window → activeFrom/activeUntil (past activeUntil =
  //    "Ended"; does NOT repeat).
  //  • ANNUAL band → seasonWindow (MM-DD, generates every year, dormant
  //    outside; year-wrapping bands supported e.g. '11-01'→'04-30').
  //  • SEASON preset → `season` tag PLUS the matching seasonWindow (the tag
  //    is display/identity only; generators read seasonWindow, so a season is
  //    just a named, colored annual band — one mechanic, not two).
  activeFrom?: string;        // YYYY-MM-DD
  activeUntil?: string;       // YYYY-MM-DD
  seasonWindow?: { fromMonthDay: string; toMonthDay: string };
  season?: 'summer' | 'winter';
  lastGeneratedThrough?: string;  // YYYY-MM-DD cursor advanced by the engine
  updatedAt?: number;
}

export type RoleInstanceStatus =
  | 'open' | 'done' | 'done_late' | 'skipped' | 'missed' | 'voided';

// TaskMasterTask-compatible so it can render in the same unified list.
export interface RoleTaskInstance {
  id: string;                 // `${dutyId}-${YYYY-MM-DD}`
  title: string;
  assignedTo: { employeeId: string; email: string; name: string };
  createdAt: number;
  dueDate: number;            // ms — occurrence date end-of-day
  status: RoleInstanceStatus;
  // RoleMaster linkage + accountability fields.
  dutyId: string;
  roleId: string;
  category?: string;
  occurrenceDate: string;     // YYYY-MM-DD
  generated: true;
  dueSoonDays?: number;
  completedAt?: number;
  completionNote?: string;
  sopSnapshot?: string;       // SOP text frozen at completion (history fidelity)
  skipReason?: string;
  voidReason?: string;
  resolvedAt?: number;
  resolvedBy?: { email: string; name: string };
  reassignedTo?: { employeeId: string; email: string; name: string };
}

// ── Trends / monthly summaries ──────────────────────────────────────────
// Compact, bonus-basis snapshot of one month. Built ONLY via the shared
// buildMtd/buildDivisionMtd/countBonusJobs (see lib/monthlySummary.ts) so
// every month is directly comparable to the bonus totals.
export interface MonthlyCrewSummary {
  crewKey: string;
  crewLabel: string;
  crewNumber: number;
  bh: number;
  ah: number;
  adjustedEff: number | null;
}
// One tier of the bonus ladder: adjusted % >= minPct pays `rate` $/BH.
// Floor semantics on lookup (84.9% → the 80% tier). <lowest minPct → $0.
export interface BonusTier {
  minPct: number;
  rate: number;
}

// Per-employee BH within a division (bonus payout basis). Sourced ONLY from
// buildDivisionMtd's perEmployee accumulation — never re-derived.
export interface MonthlyDivisionEmployee {
  empId: string;
  name: string;
  bh: number;
}

export interface MonthlyDivisionSummary {
  division: string;
  bh: number;
  ah: number;
  rawEff: number | null;
  adjustedEff: number | null;
  jobs: number;
  perCrew: MonthlyCrewSummary[];
  // Per-employee BH shares within this division (drives per-person payout).
  perEmployee: MonthlyDivisionEmployee[];
}
export interface MonthlyEmployeeSummary {
  empId: string;
  name: string;
  bh: number;
  ah: number;
  rawEff: number | null;
  adjustedEff: number | null;
}
export interface MonthlySummary {
  month: string;            // 'YYYY-MM'
  monthLabel: string;
  basis: 'approved-days';
  cutoff: string | null;
  company: {
    bh: number;
    ah: number;
    rawEff: number | null;
    adjustedEff: number | null;
    jobs: number;
    employees: number;
  };
  divisions: MonthlyDivisionSummary[];
  perEmployee: MonthlyEmployeeSummary[];
  crewDayCounts: { approved: number; pending: number; waived: number };
  generatedAt: number;
  generatedBy: string;
  finalized: boolean;
  // Bonus tier ladder stamped at generation time. Finalized months compute
  // payouts from THEIR stamped table so history can't shift if the standard
  // changes later. Optional for back-compat (older summaries fall back to
  // the current STANDARD_BONUS_TIERS on read).
  tierTable?: BonusTier[];
}

export interface AppData {
  schedules: Record<string, Crew[]>;
  employees: Employee[];
  fleet: FleetItem[];
  routes: Job[];
  inventory: InventoryItem[];
  repairLog: any[];
  bulletins: any[];
  dailyAbsences: Record<string, any>;
  partialTimeOff?: Record<string, PartialTimeOff[]>;
  performance: Record<string, Record<string, PerformanceLog>>;
  // "Push Month" — completed months are MOVED out of this single 1 MiB-
  // capped doc into their own performanceMonths/{YYYY-MM} sheets (one doc
  // per month, full detail). This array lists the months that now live on
  // sheets: they are (a) stripped from the appData-doc write so the doc
  // stays small, (b) overlaid back into the in-memory `performance` map on
  // read so every reader/bonus calc is unchanged, and (c) terminal/locked
  // (no re-edit/re-approve, and the sync refuses to touch them). NO DATA
  // IS DELETED — the month's full data lives on its sheet. Format: 'YYYY-MM'.
  pushedMonths?: string[];
  // Rolling partial push: individual SETTLED days of a not-yet-finalized
  // month that have been archived to their month sheet (kept lean so the
  // doc never hits the cap mid-month). Keyed by date 'YYYY-MM-DD' → archived
  // timestamp (ms). Stripped from the doc write and overlaid back on read,
  // exactly like pushedMonths but at day granularity. When a month is later
  // finalized (whole-month push), its per-day entries here collapse into
  // pushedMonths. NO DATA LOSS — the day lives on performanceMonths/{YYYY-MM}.
  archivedDays?: Record<string, number>;
  // Unlock race guard: an admin-unlocked archived day is stamped here
  // (date → unlockedAt ms) so the very next cycle does NOT immediately
  // re-archive it. Suppression ends when the grace period passes or the day
  // is re-settled (see isArchiveSuppressed).
  unlockedDays?: Record<string, number>;
  // Trends: compact per-month performance summaries (bonus basis), one per
  // finalized month + optionally seeded history. Keyed by 'YYYY-MM'. Lives
  // in the monthlySummaries subcollection and is overlaid here on read —
  // NOT written back into the appData doc. Read-only reporting.
  monthlySummaries?: Record<string, MonthlySummary>;
  // Schedules relocation: past months whose schedules moved to their own
  // scheduleMonths/{YYYY-MM} sheet. Format 'YYYY-MM'. Stripped from the doc
  // write and overlaid back on read (mirrors pushedMonths for performance).
  // Only PAST months — the current + future months stay in the doc.
  archivedScheduleMonths?: string[];
  authorizedEmails: string[];
  supplies: string[];
  inspections: Inspection[];
  cvorExpiry?: string;
  mechanicTasks: MechanicTask[];
  activityLog?: TaskActivity[];
  timeEntries: TimeEntry[];
  overrides: Record<string, OverrideRecord[]>;
  rolePermissions?: RolePermissionsOverride;
  settings?: AppSettings;
  multiDayJobs?: Record<string, MultiDayJob>;
  // Parts request workflow. Each PartsOrder is keyed by its own id;
  // an optional repairId links the order back to a mechanicTask.
  // Generic (top-of-board) requests have no repairId.
  partsOrders?: Record<string, PartsOrder>;
  // Mechanic pay-chunk ledger. Keyed by chunk id; one open chunk per
  // mechanic at a time. State machine driven by TimeMaster updates
  // and the view-render safety net.
  mechanicPayChunks?: Record<string, MechanicPayChunk>;
  equipmentSubtypes?: EquipmentSubtypeDefinition[];
  // BH split records for visits whose assignees span multiple crews.
  // Single-crew visits do not appear in this map.
  visitBHSplits?: Record<string, VisitBHSplit>;
  // Audit trail for hard-deletes of mechanic records (tasks, repair logs,
  // inspection logs). Append-only. Captured atomically with the record
  // removal in a single syncToCloud write, so a failed write rolls back
  // both the deletion and the audit entry.
  deletionAuditLog?: DeletionAuditEntry[];
  // Per-user "last seen" timestamp (ms) for the Bulletin Board. Keyed by
  // the user's normalized email. Compared against each bulletin's
  // `createdAt` to compute the unread-count badge on the nav item.
  bulletinReads?: Record<string, number>;
  // RoleMaster — overlaid live from their subcollections (roleMaster/*),
  // never written into the appData doc. Read-only mirrors for the UI.
  roleMasterRoles?: Record<string, RoleMasterRole>;
  roleMasterDuties?: Record<string, RoleMasterDuty>;
  roleMasterResponsibilities?: Record<string, RoleMasterResponsibility>;
  roleMasterTemplates?: Record<string, RoleMasterTemplate>;
  roleMasterPolicies?: Record<string, RoleMasterPolicy>;
  roleTaskInstances?: Record<string, RoleTaskInstance>;
  // Schema sentinel for the multi-day ledger keying scheme. v2 = keyed by
  // jobberVisitId. Anything < 2 (or missing) triggers a one-time wipe of
  // multiDayJobs in the next sync so legacy jobId-keyed entries don't mix
  // with the new visit-keyed ones.
  __multiDayKeyVersion?: number;
  // TaskMaster — admin/manager-assigned employee tasks. Keyed by id.
  // Distinct from `mechanicTasks` (Repair Board) and `activityLog`
  // (mechanic completion audit trail).
  tasks?: Record<string, TaskMasterTask>;
  // Digital time-off request ledger. Keyed by request id. Approval
  // flow writes into Employee.awayDates / partialTimeOff so
  // downstream availability gating is identical to manual entry.
  timeOffRequests?: Record<string, TimeOffRequest>;
}

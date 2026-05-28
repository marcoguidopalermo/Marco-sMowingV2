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

export interface FleetItem {
  id: string;
  name: string;
  type: string;
  status: string;
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
  recordType: 'task' | 'repair_log' | 'inspection_log';
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
  payload?: Record<string, any>;
}

export interface TaskNote {
  id: string;
  author: string;
  authorName: string;
  timestamp: string;
  text: string;
}

export interface MechanicTask {
  id: string;
  unitId?: string;
  unitName: string;
  category: string;
  description: string;
  notes?: TaskNote[];
  severity: 'minor' | 'major';
  status: 'todo' | 'doing' | 'done';
  dateReported: string;
  isMaintenance?: boolean;
  inspectionId?: string;
  activity?: TaskActivity[];
  assignedTo?: { userEmail: string; userName: string };
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
  | 'bh_filled_in_manually';

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
  firstSeenAt: number;
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
  approvalStatus?: 'pending' | 'approved';
  approvedAt?: string;
  approvedBy?: string;
  approvedByName?: string;
  lastJobberSyncAt?: number;
  removedEmployees?: string[];
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

export interface AppSettings {
  endOfDayReminder?: string;
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
  status: 'not_started' | 'in_progress' | 'done';
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

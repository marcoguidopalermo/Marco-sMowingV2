import type { LawnConfig } from './lib/lawnPricing';

export type UserRole = 'admin' | 'manager' | 'foreman' | 'worker' | 'mechanic' | 'contractor' | 'property_manager' | 'marketing';

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
  // Personal IDENTITY colour — a CATEGORY_PALETTE key (e.g. 'indigo').
  // Auto-assigned (cycling) when the employee is created, editable by an
  // admin in Personnel. Renders wherever this person appears (task rows,
  // avatars) so ownership reads at a glance. Absent/legacy → the app falls
  // back to the deterministic email hash (personColorClass), so a person
  // without an assigned colour still looks consistent.
  color?: string;
  // Mechanic PAY MODE. 'chunk' = the $1,000-per-N-hours chunk machinery
  // (current behavior). 'hourly' = paid/read from clocked time like any
  // employee; the chunk machinery + its UI don't apply. ABSENT = 'chunk' so
  // existing mechanics keep chunk pay unchanged (no silent pay change). Only
  // meaningful for systemRole === 'mechanic'.
  payMode?: 'chunk' | 'hourly';
  // Mechanic pay-chunk rate. When set, every (hoursPer1000) clocked
  // hours yields $1,000 of accountability — drives the pay-chunk
  // state machine. Only meaningful for a chunk-pay mechanic.
  hoursPer1000?: number;
  // ContractingMaster (Palermo's) billing role → T&M rate. Only meaningful
  // for systemRole === 'contractor'. Never touches Marco's pay math.
  contractingBillingRole?: ContractingBillingRole;
  // Contracting MANAGER (Tony) — full ContractingMaster (projects, reports,
  // invoices, assignment). Regular contractors (Kris) create work orders +
  // shopping items + clock, but don't mint invoices.
  contractingManager?: boolean;
  // Custom hourly rate that overrides the billing-role rate card for this
  // contractor. Only meaningful for systemRole === 'contractor'.
  contractingHourlyOverride?: number;
  // Sentinel Employee record auto-bootstrapped on first load so an
  // admin can "View As: Test User" and exercise every non-admin
  // surface without signing into a real account. Exactly one
  // employee in the directory carries this flag; it cannot be
  // deleted via the Personnel admin form.
  isTestUser?: boolean;
  // Employment start / hire date (YYYY-MM-DD). Optional — the basis
  // for the trainee-toggle's stale-start-date guard (see TRAINEE_
  // STALE_HIRE_DAYS). Absent → the guard can't verify tenure and
  // warns softly instead of blocking.
  hireDate?: string;
  // ADMIN-ONLY trainee efficiency credit window. When present and a
  // crew-day's date falls within [startDate, endDate] inclusive, any
  // crew this employee works that day earns the flat trainee credit
  // (TRAINEE_CREDIT_PCT) at the SAME additive layer as the crew-size
  // credit — never by editing raw BH/AH. null / absent = not a
  // trainee. Only an admin can set this (a manager crediting their
  // own division's number is a conflict of interest).
  training?: {
    startDate: string;   // YYYY-MM-DD, inclusive
    endDate: string;     // YYYY-MM-DD, inclusive (start + 6 = 7 days)
  } | null;
  // Append-only ledger of every trainee-window action for audit and
  // for surfacing the "needs N extensions" signal. Never mutated in
  // place — each start/extend/clear pushes a new row.
  trainingHistory?: {
    action: 'start' | 'extend' | 'clear';
    startDate: string;
    endDate: string;
    by: string;               // admin email
    byName: string;           // admin display name
    at: number;               // ms epoch
    hireDateAtToggle?: string | null;  // snapshot for the audit
    staleFlagged?: boolean;   // true when the stale-start-date guard fired
  }[];
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
  // ── CLOCKED ON SOMEBODY ELSE'S BEHALF ───────────────────────────────────
  // Set when a manager or admin started or stopped this punch FOR the
  // employee — a dead phone, a forgotten punch — rather than the employee
  // tapping it themselves. Absent on a self-punch, which is the normal case.
  //
  // This is a manager creating pay data for another person, so it is never
  // silent: the marker renders on the entry everywhere it appears, including
  // the employee's own timesheet, and a reason is required at the time and
  // kept as a note on the entry.
  startedBy?: { email: string; name: string };
  stoppedBy?: { email: string; name: string };
  // BACK-DATED. When a manager sets the punch to the time the employee
  // actually started or stopped, rather than the moment they noticed, these
  // hold the moment the RECORD was made. clockIn / clockOut stay the worked
  // times, because that is what pay is owed on.
  //
  // Present only when the two differ. The gap between them is the whole point:
  // "Started by Jonah at 8:00 (entered 8:20)" says both when the work began
  // and when somebody wrote it down, which a single timestamp cannot.
  startedEnteredAt?: string;
  stoppedEnteredAt?: string;
  // Optional "what was worked on" note captured at clock-out (contracting
  // punches) — surfaces on the entry, the report reference panel, and can be
  // carried into a billable line. Editable after the fact by Tony/Marco.
  workNote?: string;
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
// ── ACCESS-LIST AUDIT ──────────────────────────────────────────────────────
// One entry per address added to or removed from authorizedEmails — the list
// that decides who can get into the app at all. Changes to it were previously
// unrecorded: an address could appear or disappear with no trace of who did it
// or when, which is the one place that should never be true.
//
// Stored in its own ROOT-LEVEL collection with create-only rules (the same
// model as hoursBank), so an entry cannot be edited or deleted afterwards —
// including by an admin. A security log that the app can rewrite is not one.
export interface AuthorizedEmailAuditEntry {
  id: string;
  at: number;                       // epoch ms
  action: 'added' | 'removed';
  email: string;                    // the address added or removed (normalized)
  byEmail: string;                  // who made the change
  byName: string;
  // Size of the list AFTER the change — makes a clobbering write obvious in
  // the log without having to reconstruct state from the entries.
  listLengthAfter: number;
}

export interface DeletionAuditEntry {
  id: string;
  timestamp: number;
  userEmail: string;
  userName: string;
  userRole: UserRole;
  recordType: 'task' | 'repair_log' | 'inspection_log' | 'time_entry' | 'snow_contract';
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
  // MANAGER NOTE for this crew on this day. Scoped per crew-day by the shape
  // of the data itself: this Crew object lives in schedules[YYYY-MM-DD], so a
  // note written on Tuesday exists only inside Tuesday's array and cannot be
  // read from Wednesday's. The crew reads it on My Crew Today.
  notes?: string;
  // Who last wrote the note and when — a note from three days ago reads
  // differently from one written this morning, and the crew needs to be able
  // to tell. Stamped on save; ISO string, matching equipmentClosedAt below.
  notesAt?: string;
  notesBy?: string;
  notesByName?: string;
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
  | 'multiday_entry_edited'
  | 'multiday_entry_deleted'
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
  | 'crew_day_flagged'
  | 'crew_day_flag_resolved'
  | 'crew_day_audited'
  | 'approval_note_saved'
  | 'chunk_marked_paid'
  | 'chunk_payment_reversed'
  | 'performance_month_pushed'
  | 'performance_day_archived'
  | 'performance_day_unlocked'
  | 'schedule_month_archived'
  | 'partial_resolved_complete'
  | 'partial_resolved_carry'
  | 'partial_resolved_void'
  | 'trainee_credit_started'
  | 'trainee_credit_extended'
  | 'trainee_credit_cleared';

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
  // Timeline edit audit — stamped when an entry is edited in place (date /
  // crew / % / BH) via the multi-day timeline. Original marked* fields are
  // preserved; these record the most recent correction.
  editedBy?: string;
  editedByName?: string;
  editedAt?: number;
}

// A Jobber BH change detected on an APPROVED/WAIVED crew-day. The sync records
// (never applies) these; an admin reviews and deliberately applies or ignores.
export interface JobberBhConflict {
  jobberVisitId: string;
  jobTitle: string;
  targetDate: string;
  crewId: string;
  crewLabel: string;
  oldBH: number;              // what's stored on the approved day now
  newBH: number;             // what Jobber now reports (crew share)
  // Full parsed VISIT total (not the crew share). Drives the multi-day
  // ledger's totalBH reconciliation when an admin applies. Optional — absent
  // on conflicts written before this field existed; the next sync re-emits it.
  newTotalBH?: number;
  lockState: 'approved' | 'waived';
  detectedAt: number;
}

// One entry in a multi-day ledger's append-only scope (totalBH) history.
export interface ScopeChangeEntry {
  previousTotalBH: number;
  newTotalBH: number;
  changedAt: number;
  source: 'jobber' | 'manual';
  // BH already credited at the instant the scope changed — never recomputed.
  creditedAtChange: number;
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
  // Jobber's BH total changed after this ledger was created. The sync updates
  // `totalBH`; credited history is NEVER recomputed (remaining = max(0, total −
  // credited)). `totalBelowCredited` is set when the NEW total is below what's
  // already credited — surfaced in the UI rather than clamped to a wrong 0.
  totalBelowCredited?: boolean;
  bhTotalChangedAt?: number;
  bhTotalChangedFrom?: number;
  // Append-only log of every scope (totalBH) change — never overwritten, so a
  // ledger that looks odd months later is explainable without digging through
  // the audit log. `creditedAtChange` snapshots BH already credited the moment
  // the scope moved (the never-recompute guarantee, made visible per change).
  scopeHistory?: ScopeChangeEntry[];
  // ── Month-end resolution of a blocking partial job. Set by the drill-through
  // resolution actions. NEVER recomputes completionHistory / already-credited
  // BH — 'voided' closes only the uncredited remainder; 'completed'/'carried'
  // are markers (the BH credit for 'completed' is an ordinary completionHistory
  // entry). `resolvedMonth` scopes the post-finalize resolutions summary. ──
  resolvedKind?: 'completed' | 'carried' | 'voided';
  resolvedMonth?: string;                 // 'YYYY-MM' the resolution settled
  resolvedBH?: number;                     // remaining BH affected at resolution time
  resolvedAt?: number;
  resolvedBy?: { email: string; name: string };
  // Void metadata (resolvedKind === 'voided'). The uncredited remainder is
  // closed; credited BH on prior days is untouched.
  voidedRemainder?: { bh: number; reason: string; byEmail: string; byName: string; at: number };
}

// ── CREW-DAY FLAG (daily audit) ────────────────────────────────────────────
// A flag is LIVE STATE with a resolution loop, not history. "Is this crew-day
// currently flagged?" must be answerable by reading one record, not by
// reconstructing it from an append-only log — which is why this exists
// alongside logPerfActivity rather than inside it. Both are written on every
// flag and every resolution; they answer different questions.
//
// Own subcollection crewDayFlags/{id} — never in the main doc, and NEVER
// deleted: the flag and its resolution stay on the crew-day's record
// permanently, so a year later you can still see it was queried and why the
// answer was what it was.
//
// CONSEQUENCE: raising a flag UNAPPROVES the crew-day, so it stops counting
// toward efficiency, bonus and month totals until somebody signs it off. That
// is what gives the audit teeth. It changes approval STATE only — no BH, AH,
// deduction or pay number is ever touched by flagging or resolving.
//
// Language is deliberately neutral throughout: "flagged for review", "needs
// attention", "resolved". A flag is a question, not an accusation.
export interface CrewDayFlag {
  id: string;                    // `flag-<ms>-<rand>`
  date: string;                  // YYYY-MM-DD — the crew-day flagged
  crewId: string;
  crewLabel: string;             // "Lawn Division #3", denormalized for lists
  division: string;              // PerformanceLog.division, for manager routing
  // WHY. Required at the point of flagging — a flag with no reason is just an
  // unapproval, and the manager receiving it has nothing to act on.
  reason: string;
  raisedBy: { email: string; name: string };
  raisedAt: number;
  status: 'open' | 'resolved';
  // The approval state the crew-day held BEFORE the flag, so resolving can put
  // it back rather than inventing one. A waived day returns to waived: waived
  // is excluded from bonus by construction, and silently converting it to
  // approved would change what the day counts for — a pay consequence a flag
  // must never have.
  previousApprovalStatus?: 'pending' | 'approved' | 'waived';
  // RESOLUTION. The note is required too: a manager may resolve by EXPLAINING
  // ("this is correct because the second crew arrived at noon") as well as by
  // changing something. An answer is the point; a change is one kind of answer.
  resolvedBy?: { email: string; name: string };
  resolvedAt?: number;
  resolutionNote?: string;
}

// ── CREW-DAY AUDIT MARKER ──────────────────────────────────────────────────
// "James has been through this date." One record per audited DATE (not per
// crew): he audits a day as a whole, and the point of the marker is that a
// MISSED day is visible rather than silently skipped.
//
// Own subcollection crewDayAudits/{date}. Deliberately separate from
// approvalStatus: auditing is a review pass, approval is a pay gate, and
// conflating them would make one imply the other.
export interface CrewDayAudit {
  date: string;                  // YYYY-MM-DD, also the document id
  auditedBy: { email: string; name: string };
  auditedAt: number;
  // What the day looked like when it was signed off — so the history can say
  // "8 crew-days, 2 flagged" without re-deriving it from a month that may
  // since have been pushed to a sheet.
  crewDayCount: number;
  flaggedCount: number;
  note?: string;
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
  // APPROVAL NOTE — the manager's explanation of an unusual day, written at
  // approval time: "truck broke down, 2 hrs waiting on a tow", "trainee first
  // week". OPTIONAL by design: most days need no explanation, and requiring
  // one would train people to type "n/a", which is worse than silence because
  // it looks like an answer.
  //
  // Its purpose is to reach the auditor BEFORE a flag does — an odd-looking
  // number with an ordinary explanation beside it costs nobody a round-trip.
  // It is pure metadata: writing or editing it never touches approval state,
  // BH, AH, deductions or any pay figure.
  //
  // Rides into the month sheet with the rest of the log, so the explanation
  // survives with the day it explains.
  approvalNote?: string;
  approvalNoteBy?: { email: string; name: string };
  approvalNoteAt?: number;
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
  // SalesMaster rates sheet — bounded (a handful of services + materials),
  // admin-edited. Absent → the coded DEFAULT_SALES_RATES seed is used.
  salesMaster?: SalesRates;
  // ContractingMaster T&M rate card (bounded). Absent → DEFAULT_CONTRACTING_RATES.
  contractingRates?: ContractingRateCard;
  // ContractingMaster rental properties (bounded, editable). Absent → the
  // default seed list from lib/contracting CONTRACTING_PROPERTIES.
  contractingProperties?: ContractingProperty[];
  // ContractingMaster shopping suppliers (bounded, editable). Absent → the
  // default list from lib/contracting.
  contractingSuppliers?: ContractingSupplier[];
  // ContractingMaster audit trail for project delete/archive/restore (bounded,
  // newest last, capped in the handler).
  contractingAuditLog?: { action: string; detail: string; by: string; at: number }[];
  // TimeMaster bi-weekly pay-period anchor/cadence (admin-editable). Absent →
  // DEFAULT_PAY_PERIOD from lib/payPeriods. Display/range-selection only.
  payPeriod?: { anchorStart: string; lengthDays: number; payLagDays: number };
  // Month-to-month notice length in days (default 60), admin-editable.
  contractingNoticeDays?: number;
  // CAPACITY CALENDAR — weekly BH capacity per crew/division + the colour
  // thresholds. Bounded (a handful of divisions × crews), admin-edited.
  // Absent → nothing is assumed: a crew with no capacity shows raw BH and
  // NO bar/percentage rather than a made-up number.
  capacity?: CapacitySettings;
}

// ══ HOURS BANK ════════════════════════════════════════════════════════════
// Some crew bank hours instead of being paid them out. This is the LEDGER of
// that arrangement: hours in, hours out, running balance, per employee.
//
// APPEND-ONLY, AND THAT IS THE WHOLE DESIGN. An entry is never edited and
// never deleted — a mistake is corrected by a REVERSING entry that carries a
// reason. This is money owed to somebody: a ledger you can quietly edit is not
// a record of what happened, it is a record of what the last person to touch
// it wanted it to say.
//
// It is also SEPARATE FROM TIME. Banking hours does not touch timeEntries,
// pay chunks, performance or bonus math — nothing here is an input to any of
// them. The employee worked the hours either way; this only tracks whether
// they were paid out or held.
export type HoursBankEntryType = 'banked' | 'paid_out' | 'reversal';

export interface HoursBankEntry {
  id: string;
  // WHOSE ledger. The id is the key; the name is a SNAPSHOT taken when the
  // entry was written, so a renamed or removed employee's history still reads
  // as what it was at the time.
  employeeId: string;
  employeeName: string;
  type: HoursBankEntryType;
  // SIGNED, and the only source of the balance: banked is positive, paid out
  // is negative, a reversal is the exact negation of what it reverses. One
  // number rather than a magnitude plus a direction, because two fields that
  // must agree eventually will not. Balance = Σ hours.
  hours: number;
  // BANKED entries: the pay period the hours are banked FROM, as YYYY-MM-DD
  // bounds taken from the pay-period model rather than typed by hand.
  periodStart?: string;
  periodEnd?: string;
  // PAID OUT entries: the date the money went out.
  paidOn?: string;
  note?: string;
  // REVERSALS: which entry this corrects, and why. Both required on a
  // reversal — a correction with no stated reason is just another mystery.
  reversesId?: string;
  reversalReason?: string;
  // The audit, on every entry: what was recorded, when, by whom. Stamped from
  // the signed-in identity by the save handler, never from the form.
  recordedAt: number;
  recordedBy: { email: string; name: string };
}

// ══ SNOWMASTER · COMMERCIAL CONTRACT BUILDER ══════════════════════════════
// One document per client per season in the snowContracts collection. Replaces
// a standalone HTML file that was filled in, printed and emailed but saved
// nothing — the point of this record is that the contract survives.
// The pipeline ONE record moves along — a contract is never re-created at a
// stage. QUOTED → SENT → APPROVED → BOOKED, with DECLINED as an off-ramp from
// any stage and EXPIRED for a quote whose validUntil passed unanswered.
//
// Renamed from the original draft/sent/signed/declined/expired set:
// 'draft' → 'quoted' (the record IS a quote from the moment it exists, and
// "draft" wrongly implied it wasn't real yet) and 'signed' → 'approved'
// (approval is the client's decision; the signed paper is now an attached PDF,
// which is a separate fact). BOOKED is new: approved means they said yes,
// booked means it is on the route. Legacy values are migrated on read by
// normalizeStatus in lib/snowContracts — nothing stored is orphaned.
export type SnowContractStatus =
  | 'quoted' | 'sent' | 'approved' | 'booked' | 'declined' | 'expired';

// What an attached PDF IS. The workflow is: build the document in the
// standalone HTML builder, print to PDF, attach it here — so the record keeps
// the pipeline and the actual paper that was sent or signed.
export type SnowContractDocLabel = 'quote' | 'sent_copy' | 'signed_copy' | 'other';

export interface SnowContractDocument {
  id: string;
  label: SnowContractDocLabel;
  // Free text shown alongside the label; the only place 'other' can explain
  // itself, and optional on the two fixed labels.
  note?: string;
  // Bytes live in Storage under snowContracts/{contractId}/ — Firestore holds
  // this metadata only, same as every other upload surface.
  file: StoredFile;
}

// ── SERVICE LEVEL ──────────────────────────────────────────────────────────
// The Client picks ONE. This replaced a per-service Included/On-call/Excluded
// matrix: the levels are cumulative and their contents are fixed legal text
// (see SERVICE_LEVELS in snowContractText), so the contract stores the choice
// and nothing else. `null` means nobody has chosen yet — a contract must never
// imply a level nobody agreed to, and that includes contracts migrated from
// the old matrix, where the level cannot be inferred.
export type SnowServiceLevel = 1 | 2 | 3;

// Two INDEPENDENT selections: which level, and how it is priced. Option A also
// carries its own payment choice, which the document makes a third tick.
export type SnowPricingOption = 'A' | 'B';
export type SnowOptionAPayment = 'instalments' | 'prepay';

// Assigned by the Contractor from route capacity, not requested by the Client.
// All three response windows print; this says which one is ticked.
export type SnowServiceWindow = 'overnight' | 'daytime' | 'nonPriority';

// What a drawn area on the service map MEANS. Absent on a ring drawn by the
// lawn measuring tool, which has no purposes — see MeasureRing.
export type SnowAreaPurpose = 'plow' | 'shovel' | 'storage' | 'hazard';

// The banner photo's framing. Mirrors the reference's own pan/zoom model
// (translate then scale, about the centre), with the offsets normalized.
export interface SnowPhotoView {
  zoom: number;      // 1 = the photo exactly covering the banner
  x: number;         // pan, % of banner width  (+right)
  y: number;         // pan, % of banner height (+down)
  // false = cover (fill the banner, crop the overflow) — the default, and what
  // a banner wants. true = contain, for a photo that must not be cropped.
  fit?: boolean;
}

// One level's two prices. Both print for all three levels, side by side, so
// the Client can see what each level costs before choosing.
export interface SnowLevelPrice {
  seasonal: number;    // Option A — the whole term
  perVisit: number;    // Option B — per visit
}

export interface SnowContract {
  id: string;
  season: string;                 // "2026/2027"
  status: SnowContractStatus;
  // Who and when, stamped as the record crosses each stage. Set once on entry
  // and never cleared by a later move, so a booked contract still shows when
  // it was sent and approved.
  sentAt?: number;
  sentBy?: string;
  approvedAt?: number;
  approvedBy?: string;
  bookedAt?: number;
  bookedBy?: string;
  declinedAt?: number;
  declinedBy?: string;
  /** @deprecated pre-BOOKED field, migrated into approvedAt/approvedBy on
   *  read. Kept so an old record does not silently lose who approved it. */
  signedAt?: number;
  /** @deprecated migrated into approvedBy. */
  signedBy?: string;
  // WHICH CREW the site is on — free text, e.g. "Tony, Tom, Al". Free text
  // rather than a reference to a crew record on purpose: snow crews are named
  // ad hoc per site and change through a season, and requiring a managed crew
  // list before a contract can be entered would be setup standing in the way
  // of the thing you actually want to do. The list filters on the distinct
  // values found, so it organises itself from whatever gets typed.
  crew?: string;
  // Attached PDFs — the quote, and the sent and signed paper for this
  // contract. Multiple allowed; a contract commonly gains a quote, then a
  // sent copy, then a signed one.
  documents?: SnowContractDocument[];
  // ARCHIVE — the alternative to deleting an agreement. An approved or booked
  // contract is a commercial commitment, and its signed PDF is often the only
  // copy; archiving takes it out of the working list without destroying it.
  // Archived records keep everything, are excluded from the pipeline counts,
  // and are visible behind the list's "Show archived" toggle.
  archived?: boolean;
  archivedAt?: number;
  archivedBy?: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  clientId?: string;
  // Header block, ABOVE Section 1: the address is the page's title and the two
  // dates sit beside it. `validUntil` is what Acceptance cross-references —
  // it is deliberately not inside a section, which is why that clause now
  // points at "the top of this Agreement" rather than at a section number.
  quoteDate: string;              // YYYY-MM-DD
  validUntil: string;             // YYYY-MM-DD
  client: {
    businessName: string;
    siteContact: string;          // name + phone in one field, as the form asks
    billingContact: string;
    billingEmail: string;
    billingAddress: string;       // only when different from the service address
    // The property. Held here rather than at the top level because the list,
    // search and the measuring tool's address seed all read it from here.
    serviceAddress: string;
    /** @deprecated pre-2026 field; migrated into siteContact. Kept so an old
     *  record does not silently lose the number. */
    phone?: string;
  };
  term: { start: string; end: string };
  scope: {
    // The two free-text fields that survive on the printed page, in the legend
    // column beside the map. Everything else about the property is now drawn.
    plowArea: string;
    shovelArea: string;
    showMap: boolean;
    sitePhoto?: string;           // Storage URL — the page-1 banner
    // How that photo is FRAMED in the banner. A site photo is nearly always
    // the wrong shape for a 3.7:1 strip, so cover-and-centre puts the horizon
    // wherever the camera happened to be pointing; this is the choice of which
    // band of the picture shows.
    //
    // x and y are PERCENTAGES OF THE BANNER, not pixels: the editor frames the
    // photo in a box the width of the form column and it prints in a box the
    // width of the page, and a pixel offset would mean two different crops.
    sitePhotoView?: SnowPhotoView;
    mapImages: string[];          // 0–2 Storage URLs (fallback when unmeasured)
    measuredSqft?: number;
    measurement?: PropertyMeasurement;   // same shape SalesMaster stores
    // ── legacy, kept so migrated contracts lose nothing ──
    // None of these print any more: the old six-row scope table is gone, and
    // storage and hazards are drawn on the map instead of described.
    /** @deprecated */ totalArea?: string;
    /** @deprecated */ snowStorage?: string;
    /** @deprecated */ markedHazards?: string;
    /** @deprecated */ accessNotes?: string;
    /** @deprecated */ description?: string;
  };
  serviceLevel: SnowServiceLevel | null;
  pricing: {
    selectedOption: SnowPricingOption | null;
    // All three levels are quoted whether or not they are chosen — the matrix
    // prints every row, and the Client picks from it.
    levels: Record<SnowServiceLevel, SnowLevelPrice>;
    optionAPayment: SnowOptionAPayment | null;
    prepayDeadline: string;
  };
  serviceTerms: {
    triggerDepth: string;
    serviceWindow: SnowServiceWindow | null;
    overnightCutoff: string;      // "2:00" — snowfall must end by
    overnightClearBy: string;     // "8:00" — cleared by
    daytimeHours: string;         // "24"
    nonPriorityHours: string;     // "48"
  };
  insurance: {
    cglAmount: string;            // "5,000,000" — printed inside the clause
  };
  // What the old pricing shape held, carried across the rewrite so a renewal
  // can still see last season's figures. NEVER printed and never migrated into
  // the new fields: the old total was for a services matrix, not for a level,
  // so re-quoting is deliberate rather than inherited.
  legacyPricing?: { seasonalTotal: number; perVisitTotal: number };
  // Sections removed from THIS contract's printed output. Never deletes the
  // underlying data — restoring a section brings its content back intact.
  hiddenSections: string[];
}

// ══ BONUS PAYOUT MARKERS ══════════════════════════════════════════════════
// A PAYOUT-TRACKING layer that sits ON TOP of the bonus calculation. It never
// changes what was earned: efficiency, division pools and per-person shares
// are computed by lib/bonusTiers from the monthly summaries and are untouched
// by anything here. These records only say what happened to a share
// afterwards — paid out, or withheld.
export type BonusMarkState = 'paid' | 'excluded';

// Why a share isn't being paid. Fixed options because this gets picked dozens
// of times a month and free text would rot into inconsistency; 'other' keeps
// the escape hatch with a note.
export type BonusExcludeReason = 'left_before_month_end' | 'not_yet_eligible' | 'other';

export interface BonusPayoutMark {
  empId: string;
  empName: string;
  state: BonusMarkState;
  reason?: BonusExcludeReason;
  reasonNote?: string;
  // The calculated share AT THE MOMENT OF MARKING. Never used in any total —
  // the displayed figures always come from the live calculation — but a
  // payout record has to be able to say what the number was when someone
  // acted on it.
  amountAtMark: number;
  by: string;
  byName: string;
  at: number;
}

// An ADJUSTED payout amount — e.g. rounding $43 up to $50. Stored SEPARATELY
// from the paid/excluded state so the two compose: clearing "paid" doesn't
// discard the adjustment, and adjusting doesn't disturb the state. The
// calculated figure is never overwritten — it stays the record of what was
// earned, and both numbers are shown together.
export interface BonusAmountEdit {
  empId: string;
  empName: string;
  amount: number;             // what to pay instead
  calculatedAtEdit: number;   // what the math said at the moment of editing
  reason?: string;            // "Rounded up", or a short typed note
  by: string;
  byName: string;
  at: number;
}

export interface BonusPayoutAudit {
  at: number;
  by: string;
  byName: string;
  empId: string;
  empName: string;
  // 'state' = paid/excluded change (the default for entries written before
  // amount editing existed). 'amount' = the payable figure was adjusted.
  kind?: 'state' | 'amount';
  from: BonusMarkState | 'unmarked';
  to: BonusMarkState | 'unmarked';
  reason?: BonusExcludeReason;
  reasonNote?: string;
  amount: number;
  // Amount edits only: the figure before and after.
  fromAmount?: number;
  toAmount?: number;
  amountReason?: string;
}

// One document per month, in its own subcollection — off the main appData doc.
export interface BonusPayoutRecord {
  ym: string;
  marks: Record<string, BonusPayoutMark>;   // empId → mark (absent = unmarked)
  // empId → adjusted amount (absent = pay the calculated figure).
  edits?: Record<string, BonusAmountEdit>;
  audit: BonusPayoutAudit[];                // append-only
}

// ── HOURLY ESTIMATES. An [hourly] visit carries no [BH] tag, and every one
// is different — a duration-derived or defaulted figure would be fiction
// dressed as data. So capacity ASKS instead of guessing: the job is listed
// unestimated until someone puts a number on it. Keyed by Jobber visit id so
// an estimate survives every re-sync of the forward snapshot.
export interface HourlyEstimate {
  visitId: string;
  bh: number;
  // Kept for the record so the list stays readable if the visit later drops
  // out of the pull window.
  label?: string;
  by: string;
  byName: string;
  at: number;
}

export interface HourlyEstimateRecord {
  estimates: Record<string, HourlyEstimate>;
}

// ══ CAPACITY CALENDAR ═════════════════════════════════════════════════════
// Forward view of SCHEDULED, UNCOMPLETED work. Read-only: these types feed
// a display + admin settings values only. They never touch performance, pay,
// efficiency or the multi-day ledger.

// ── TOOL 1: BOOKING CAPACITY. Declared by MANAGEMENT per division, and
// carrying its own reasoning so it can be argued with:
//
//     crews × people per crew × BH per person per week = weekly capacity
//
// EVERY ONE OF THESE IS TYPED IN. None is inferred from the schedule or the
// roster — that model was deliberately removed, because Jobber "assignees"
// are route slots rather than people and any schedule-derived crew size
// inherits that mapping's gaps. Stating the parts rather than one flat total
// means that when the number needs changing, it is obvious WHAT to change.
export interface DeclaredCapacity {
  // Absent → treated as 1 crew, so a single-crew division needn't state it.
  crews?: number | null;
  peoplePerCrew?: number | null;
  bhPerPerson?: number | null;
  placeholder?: boolean;
}

// ── TOOL 2: HEADCOUNT CEILINGS. Company-wide weekly BH a crew of N can
// deliver. NON-LINEAR on purpose: a 1-person crew does not deliver half of a
// 2-person crew, because travel and setup are per-crew, not per-head.
export interface HeadcountCeiling {
  headcount: number;    // "this many people or more"
  weeklyBH: number;
  placeholder?: boolean;
}

// Colour bands, as PERCENTAGES of capacity. Every value is admin-editable.
//   pct <  underPct   → RED, UNDERBOOKED ("sell into it")
//   pct <  lightPct   → AMBER, light
//   pct <= healthyPct → GREEN, healthy
//   pct >  healthyPct → DARK RED, OVERBOOKED ("can't deliver")
// The two red states mean opposite things and are drawn differently.
export interface CapacityThresholds {
  underPct: number;
  lightPct: number;
  healthyPct: number;
}

// An EXPLICIT mapping from a Jobber assignee to where its work belongs.
// Jobber "users" are route/crew SLOTS ("#1 (SOUTH)"), not people — one per
// crew-day, and they move between crews over time. Deriving the mapping from
// the schedule therefore works only as well as the schedule is filled in.
// An explicit mapping is stated once, persists independently of the schedule,
// and survives a route moving crews.
export interface AssigneeMapping {
  division: string;
  // Optional finer grain. Division is what Booking needs; a crew number
  // additionally pins the slot for Schedule Balance.
  crewNumber?: number | null;
  // The label at the time of mapping, so the list stays readable even if the
  // Jobber user list hasn't been re-synced.
  label?: string;
}

export interface CapacitySettings {
  // Tool 1 — declared weekly BH, keyed by division name.
  declared?: Record<string, DeclaredCapacity>;
  // assigneeId → where its work belongs. Takes PRECEDENCE over the
  // schedule-derived match; anything absent falls back to the schedule.
  assigneeMap?: Record<string, AssigneeMapping>;
  // Tool 2 — weekly ceiling by crew headcount, ascending.
  headcountCeilings?: HeadcountCeiling[];
  thresholds?: CapacityThresholds;
  // Scheduled auto-refresh, per scope, independently. ABSENT = OFF: the
  // forecast is still beta, and a scheduled pull spends from the same Jobber
  // query budget the performance sync draws on — not worth spending daily on
  // a view nobody has opened yet. The scheduled function reads this and skips
  // the scope entirely (no Jobber call at all) when it isn't true; the manual
  // Refresh button is unaffected either way.
  autoRefresh?: Partial<Record<CapacityScope, boolean>>;
}

// ── The forecast snapshot written by the jobberSyncCapacity function.
// Mirrors functions/src/jobber/capacityForecast.ts — keep the two in step.
export interface CapacityForecastVisit {
  visitId: string;
  jobId: string | null;
  jobNumber: string | null;
  // Title with the [BH] / [hourly] tag stripped.
  desc: string;
  client: string | null;
  // Scheduled span (Toronto YYYY-MM-DD). endDate === startDate for a
  // single-day visit.
  startDate: string;
  endDate: string;
  // Parsed [BH] total for the WHOLE visit; 0 when hourly or untagged. What
  // actually gets booked is this MINUS anything already credited on the
  // multi-day ledger.
  bh: number;
  isHourly: boolean;
  untagged: boolean;
  assigneeIds: string[];
  assigneeNames: string[];
  // Scheduled duration in hours from Jobber's startAt/endAt, same-day visits
  // only. The basis for estimating an [hourly] visit's capacity load.
  durationHours?: number;
}

// Which half of the business a snapshot covers. Lawn is high-volume and
// slow-moving; projects are few and change constantly, so each gets its own
// document, horizon and refresh cadence.
export type CapacityScope = 'projects' | 'lawn';

export interface CapacityForecast {
  scope?: CapacityScope;
  generatedAt: number;
  generatedBy: 'manual' | 'scheduled';
  windowStart: string;
  windowEnd: string;
  today: string;
  visits: CapacityForecastVisit[];
  stats: {
    fetched: number;
    kept: number;
    completeSkipped: number;
    endedBeforeToday: number;
    untagged: number;
    hourly: number;
    // Visits skipped because they belong to the other scope's document.
    otherScope?: number;
    hourlyWithDuration?: number;
    untaggedWithDuration?: number;
  };
  truncated: boolean;
  // The date this snapshot actually covers through. Weeks past it were never
  // fetched — UNKNOWN, not empty. The view must never colour them "open".
  coveredThrough?: string;
  // The pull stopped early to leave Jobber API budget for the performance sync.
  stoppedForBudget?: boolean;
  // Serialized size of the snapshot document, recorded by the pull.
  sizeBytes?: number;
  // The forward query fell back to a reduced shape: multi-day spans collapse
  // to their start day and client names are missing. Surfaced in the UI.
  degraded: boolean;
  warnings: string[];
}

// ══ ContractingMaster (Palermo's Contracting) types ═══════════════════════
export type ContractingBillingRole = 'gc_pm' | 'skilled_carpenter' | 'general_labour';
export interface ContractingRateCard { gc_pm: number; skilled_carpenter: number; general_labour: number; }

// ── Property management (v2): PROPERTY → UNITS → TENANCIES (multi-payer) ────
// Reference layer only — NO payment tracking, bills, or ledgers.
export interface ContractingTenant { name: string; phone?: string; email?: string; rentAmount?: number; main?: boolean; }
export type ContractingTenancyStatus = 'fixed_term' | 'month_to_month';
export interface ContractingDeposit { collected?: boolean; amount?: number; dateCollected?: string; note?: string; }
export interface ContractingTenancy {
  id: string;
  status: ContractingTenancyStatus;
  leaseStart?: string;             // YYYY-MM-DD
  leaseEnd?: string;               // fixed_term expiry
  moveOutAt?: string;              // ACTUAL move-out date entered (drives countdown)
  moveOutBy?: string;
  deposit?: ContractingDeposit;    // structured (collected / amount / date / note)
  // DEPRECATED (read-migrated): computedEnd→moveOutAt, depositNote→deposit.note
  noticeGivenAt?: string;
  noticeBy?: string;
  computedEnd?: string;
  depositNote?: string;
  notes?: string;
  tenants: ContractingTenant[];    // rent lives per tenant; total DERIVES (sum)
  createdAt?: number;
  endedAt?: number;
  endedBy?: string;
  audit?: { at: number; by: string; action: string }[];
}
export interface ContractingUnit {
  id: string;
  name: string;                    // "Main floor", "Unit 2", "Basement"
  notes?: string;
  tenancy?: ContractingTenancy;    // at most one ACTIVE (absent = VACANT)
  history?: ContractingTenancy[];  // ended tenancies (kept per unit)
}
export interface ContractingProperty { id: string; name: string; corp?: boolean; notes?: string; active?: boolean; units?: ContractingUnit[]; }
export interface ContractingSupplier { id: string; name: string; active?: boolean; }
export type ContractingPhaseType = 'fixed' | 'tm';
// Audit trail for a fixed-price change on a phase (who/when/from→to).
export interface ContractingPriceAudit { at: number; by: string; from: number; to: number; }
export type ContractingStatus = 'planned' | 'in_progress' | 'on_hold' | 'complete' | 'closed';
export interface ContractingChecklistItem { id: string; text: string; required: boolean; done: boolean; doneBy?: string; doneAt?: number; }
export interface ContractingPhase {
  id: string;
  name: string;
  type: ContractingPhaseType;
  fixedPrice?: number;            // pre-HST (fixed phases)
  status: ContractingStatus;
  description?: string;
  checklist: ContractingChecklistItem[];
  tmStartAt?: number;             // T&M clock start → seeds the first open report
  note?: string;                  // e.g. window-package approval note
  priceAudit?: ContractingPriceAudit[];  // fixed-price change history (audited)
  completionPct?: number;         // 0–100, MANUAL, informational only (not billing)
  completionPctBy?: string;
  completionPctAt?: number;
}
export interface ContractingProject {
  id: string;
  name: string;
  client?: { name: string; contact?: string };
  propertyRef?: string;
  status: ContractingStatus;
  notes?: string;                 // INTERNAL — never client-facing
  phases: ContractingPhase[];
  archived?: boolean;             // hidden from the default board; restorable
  archivedBy?: string;
  archivedAt?: number;
  createdBy?: { id: string; name: string };
  createdAt?: number;
  updatedAt?: number;
}

export interface ContractingTimeEntry {
  id: string;
  projectId: string;
  phaseId: string;
  contractorId: string;
  contractorName: string;
  billingRole: ContractingBillingRole;
  clockIn: number;                // ms; for manual lines, the day it applies
  clockOut?: number;
  manual?: boolean;               // manually-added billable line
  hours?: number;                 // explicit hours (manual) — else derived from clock
  rateOverride?: number;          // per-line rate (the odd exception) — else role/override rate
  description?: string;           // what the hours were for (carried from a punch note; frozen on invoicing)
  detached?: boolean;             // clock entry removed from its window report → back to unbilled
  reportId?: string;              // attached open report
  status: 'open' | 'invoiced';
  createdBy?: { id: string; name: string };
  createdAt?: number;
}

export interface ContractingReceipt {
  id: string;
  description: string;
  cost: number;                   // INTERNAL — never client-facing
  markupPct: number;              // INTERNAL — never client-facing
  billed: number;                 // cost × (1 + markupPct/100)
  photo?: StoredFile;
  preApprovedRef?: string;
  addedBy?: { id: string; name: string };
  addedAt?: number;
}
export interface ContractingLabourLine { contractorId: string; name: string; billingRole: ContractingBillingRole; hours: number; rate: number; amount: number; }
export interface ContractingReportSnapshot {
  labourLines: ContractingLabourLine[];
  labourSubtotal: number;
  materialLines: { description: string; billed: number }[];  // client-safe (no cost/markup)
  materialsSubtotal: number;
  subtotalPreHst: number;
  hst: number;
  total: number;
}
export interface ContractingProgressReport {
  id: string;
  projectId: string;
  phaseId: string;
  startAt: number;
  endAt?: number;
  status: 'open' | 'invoiced';
  reportNumber: number;
  // OVERRIDE for the client-facing invoice number this report will mint with.
  // Absent = use the sequence (nextProgNumber), which stays the default for
  // every new report. Set when a specific number is needed: matching one
  // already sent on paper, or repairing a mis-sequence. See
  // lib/contractingEdits.reportMintNumber.
  numberOverride?: string;
  receipts: ContractingReceipt[];
  manualTime: ContractingTimeEntry[];   // manual billable time lines on this report
  snapshot?: ContractingReportSnapshot;  // frozen at invoicing
  createdAt?: number;
  updatedAt?: number;
}

export type ContractingInvoiceKind = 'tm' | 'retainer' | 'completion' | 'historical';
export interface ContractingInvoice {
  id: string;
  number: string;                 // PROG-00N or manual
  projectId: string;
  phaseId?: string;
  kind: ContractingInvoiceKind;
  periodStart?: number;
  periodEnd?: number;
  amountPreHst: number;
  hst: number;
  total: number;
  reportId?: string;
  scopeDescription?: string;      // client-facing scope text
  issuedAt?: number;
  dueAt?: number;
  // Lifecycle: MINTED (awaitingSend) → SENT (sentAt) → PAID (paid). Freshly
  // minted T&M invoices carry awaitingSend; legacy/seeded default to sent.
  awaitingSend?: boolean;
  sentAt?: number;
  sentBy?: string;
  paid?: boolean;
  paidAt?: number;
  paidBy?: string;
  // VOID (not hard-delete): contributes zero to every total, hidden from
  // default views, kept as an accounted stub so numbering stays sequential.
  voided?: boolean;
  voidReason?: string;
  voidedBy?: string;
  voidedAt?: number;
  createdBy?: { id: string; name: string };
  createdAt?: number;
}

// Two-state model: in progress → complete. Legacy 'open' is read-migrated to
// 'in_progress' by woStatus() in lib/contracting.
export type ContractingWorkOrderStatus = 'open' | 'in_progress' | 'done';
export interface ContractingWorkOrder {
  id: string;
  property: string;
  title: string;
  description?: string;
  priority: 'low' | 'normal' | 'high';
  status: ContractingWorkOrderStatus;
  photos?: StoredFile[];
  completionNote?: string;
  assigneeIds?: string[];         // assigned contractors (Marco/Tony assign)
  assigneeNames?: string[];       // denormalized names (parallel to assigneeIds)
  assigneeId?: string;            // DEPRECATED single-assignee (read-migrated → assigneeIds)
  assigneeName?: string;          // DEPRECATED
  unitId?: string;                // optional UNIT tag (property-level orders leave blank)
  scheduledAt?: number;           // optional planned date (ms; noon, or exact time when scheduledHasTime)
  scheduledHasTime?: boolean;     // true when scheduledAt carries a real time (tenant appointment)
  dueAt?: number;                 // optional deadline (ms, local noon)
  archived?: boolean;             // hidden from default list (declutter)
  createdBy?: { id: string; name: string };
  createdAt?: number;
  updatedAt?: number;
  editedBy?: string;              // light audit — last editor / time
  editedAt?: number;
}

// Personal TO-DO / FOLLOW-UP items — PRIVATE per user (filtered by userId).
export interface ContractingPersonalItem {
  id: string;
  userId: string;
  list: 'todo' | 'followup';
  text: string;
  done?: boolean;
  doneAt?: number;
  movedAt?: number;               // last To-Do ↔ Follow-Up move (no ceremony)
  createdBy?: { id: string; name: string };
  createdAt?: number;
}

export interface ContractingShoppingItem {
  id: string;
  item: string;
  qty?: string;
  projectTag?: string;
  supplier?: string;              // optional supplier tag → groups the list by store

  addedBy?: { id: string; name: string };
  addedAt?: number;
  purchased?: boolean;
  purchasedBy?: string;
  purchasedAt?: number;
}

// ── SalesMaster (v1) — pricing rates sheet. Bounded data (small fixed set),
// admin-only editing. Actual COST fields are admin-only at the UI layer.
export type SalesMaterialUnit = 'sqft' | 'yard' | 'load' | 'each' | 'tonne';
export interface SalesService {
  id: string;
  name: string;
  chargeRatePerHr: number;      // client-facing labour rate ($/BH)
  labourCostPerHr?: number;     // optional internal cost override; else global default
  division?: string;
  active: boolean;
}
export interface SalesMaterial {
  id: string;
  name: string;
  unit: SalesMaterialUnit;
  costPerUnit: number;          // internal cost (admin-only)
  chargePerUnit: number;        // client-facing charge
  active: boolean;
  // Optional coverage rule: "one <unit> covers <coverageSqft> sqft at
  // <coverageDepthInches> inches." Lets the calculator convert area + depth →
  // quantity. Absent → plain qty entry (unchanged).
  coverageSqft?: number;
  coverageDepthInches?: number;
}
export interface SalesRates {
  labourCostPerHrDefault: number;   // internal labour cost when a service has no override
  overheadPerBH?: number;           // internal overhead allocated per BUDGETED BH
  overheadNote?: string;            // how it was derived / last reviewed
  services: SalesService[];
  materials: SalesMaterial[];
}

// A SAVED QUOTE. Stores CHARGE-SIDE snapshot numbers + BH only — never cost
// fields (the GP panel is computed live, admin-only, never stored, so a
// manager viewing a saved quote sees no cost data). Rates are snapshotted at
// save time so a later rate change never silently rewrites an old quote.
// Own subcollection salesMasterQuotes/{id} — this list GROWS.
export interface SalesQuoteLine {
  materialId: string; name: string; unit: string; qty: number; chargePerUnit: number;
  // Coverage-calc provenance (when qty was computed from area + depth).
  coverageNote?: string; area?: number; depthInches?: number;
}
export interface SalesQuote {
  id: string;
  name: string;
  serviceId: string;
  serviceName: string;          // snapshot
  serviceChargeRate: number;    // snapshot
  lines: SalesQuoteLine[];      // charge-side snapshot
  bh: number;
  materialsCharged: number;     // snapshot
  labourCharge: number;         // snapshot
  quoteTotal: number;           // snapshot
  overheadPerBH?: number;       // snapshot of the overhead rate at save time
  createdBy?: { email: string; name: string };
  createdAt?: number;
  updatedBy?: { email: string; name: string };
  updatedAt?: number;
}

// ── SalesMaster · Snow — driveway snow-clearing season quotes. The estimator
// traces the driveway on a grid; snowPricing.ts (the single source of truth for
// snow pricing) turns it into a tier + price. Saved so the traced shape can be
// reopened at renewal instead of re-measured. Own subcollection snowQuotes/{id}
// — this list GROWS (never in the appData main doc). Stores the full grid + the
// derived numbers + the pricing config version in force at save time, so a
// quote saved under old rates still explains itself after rates change.
export interface SnowQuote {
  id: string;
  name: string;                 // free-form label, usually the client / address
  client?: string;              // client the quote belongs to (reused at renewal)
  grid: number[][];             // the traced shape (0 empty, 1 open, 2 drag)
  lanes: number;
  depth: number;
  cars: number;
  dragCount: number;
  tier: 1 | 2 | 3 | 'custom';
  basePrice: number;
  premium: boolean;
  busyRoad: boolean;
  danger: number;
  total: number | null;         // STANDARD total; null when custom
  // Premium total (Standard + config.PREMIUM); null when custom. Added when
  // Standard + Premium became always-shown side by side. Older quotes predate
  // this field — the other total is derived from the stamped config version and
  // old records are never rewritten.
  premiumTotal?: number | null;
  isCustom: boolean;
  pricingConfigVersion: string; // snapshot of the config that priced this quote
  quotedBy?: { email: string; name: string };
  quotedAt?: number;
  updatedBy?: { email: string; name: string };
  updatedAt?: number;
}

// ── SalesMaster · Snow rate config — the editable pricing NUMBERS, stored as
// IMMUTABLE VERSIONS (never overwritten in place). Each save appends a new
// version doc; quotes stamp the version they were priced under so a historical
// quote always resolves to its original prices. v1 is the hard-coded default in
// snowPricing.ts and is never written here. Super-admin only (enforced in the
// rate-sheet screen, the write handlers, and firestore.rules).
// Lives in a TOP-LEVEL `snowRateConfigs` collection (outside artifacts/**) so a
// dedicated rule can restrict WRITES to the super-admin — the artifacts/** rule
// grants write to every authorized user and cannot be narrowed. The shape below
// mirrors SnowConfig in src/lib/snowPricing.ts (the single source of truth).
export interface SnowConfigShape {
  TIER_1: number; TIER_2: number; TIER_3: number; CUSTOM_FLOOR: number;
  PREMIUM: number; BUSY_ROAD: number; DRAG_RATE: number;
  DRAG_COUNTS_TOWARD_SIZE: boolean; DANGER_OPTIONS: number[];
}
export interface SnowRateAuditChange { field: string; key: string; from: string; to: string }
export interface SnowRateConfigVersion {
  id: string;                       // = version, e.g. 'snow-v2'
  version: string;                  // 'snow-v2'
  config: SnowConfigShape;          // the full config snapshot for this version
  changes: SnowRateAuditChange[];   // field-level diff vs the previous version
  note?: string;                    // e.g. "Reverted to snow-v1"
  revertedFrom?: string;            // set when this version was created by a revert
  createdBy?: { email: string; name: string };
  createdAt?: number;
}

// ── SalesMaster · Lawn rate config — same immutable-version model as the snow
// one. Top-level `lawnRateConfigs` collection so a dedicated rule locks WRITES
// to the super-admin. The config snapshot is the LawnConfig from lawnPricing.ts
// (referenced rather than re-declared, so the doc shape can't drift from the
// engine's — a small, deliberate difference from the snow types).
export type LawnRateAuditChange = SnowRateAuditChange;
export interface LawnRateConfigVersion {
  id: string;                       // = version, e.g. 'lawn-v2'
  version: string;
  config: LawnConfig;
  changes: LawnRateAuditChange[];
  note?: string;
  revertedFrom?: string;
  createdBy?: { email: string; name: string };
  createdAt?: number;
}

// ── SalesMaster · satellite property measurement. Produced by the shared
// PropertyMeasureTool (Google Maps). A small payload (a few hundred bytes)
// saved WITH the quote in its subcollection — never the main appData doc. The
// outline re-renders when a quote is reopened (the record of what was measured,
// if a tier is ever disputed). Areas are add-polygons minus exclusion-polygons.
export interface LatLngLiteral { lat: number; lng: number }
// A ring is wrapped in { path } because Firestore forbids NESTED arrays (an
// array element cannot itself be an array). polygons/exclusions are therefore
// arrays of maps, each holding one ring's vertex list — same data, storable.
export interface MeasureRing {
  path: LatLngLiteral[];
  // What this area IS, on a snow contract. Absent for lawn measuring, which
  // has no purposes and is unaffected by this field — a ring with no purpose
  // behaves exactly as it always has.
  //
  // 'plow' and 'shovel' are SERVICED area and count toward totalSqft.
  // 'storage' and 'hazard' are drawn for the map and legend only: a snow pile
  // location and a marked obstacle are not area being cleared, so counting
  // them would inflate the figure the price is built on.
  purpose?: SnowAreaPurpose;
}
// A single point rather than an area — a hydrant, a bollard, a curb corner.
// The reference's map tool allows one click to drop a marker, so the model has
// to be able to hold one.
export interface MeasureMarker {
  at: LatLngLiteral;
  purpose: SnowAreaPurpose;
}
export interface PropertyMeasurement {
  polygons: MeasureRing[];            // added areas (front yard, back yard…)
  exclusions: MeasureRing[];          // subtracted areas (driveway, pool, beds…)
  totalSqft: number;                  // Σ serviced polygons − Σ exclusions (clamped ≥ 0)
  markers?: MeasureMarker[];          // point features; never contribute area
  address?: string;                   // resolved search address, if any
  measuredAt: number;
  measuredBy?: { email: string; name: string };
}

// ── SalesMaster · Lawn — mowing (weekly/biweekly, by sq ft tier) + lawn-care
// packages. Priced by lawnPricing.ts (single source of truth). Mirrors
// SnowQuote: own subcollection lawnQuotes/{id} (GROWS; never the main appData
// doc), version-stamped so a loaded quote resolves against its own config.
export interface LawnQuote {
  id: string;
  client?: string;                 // optional free-text
  sqft: number;
  tierIndex: number;
  tierLabel: string;
  mowingBase: number;              // weekly tier base at quote time
  veryHilly: boolean;
  pushMow: boolean;
  clutter: boolean;
  travelZone: string;              // mowing travel zone key
  // Which frequency the client is going with (optional marker — both are always
  // shown/saved; this only feeds the report's weekly/biweekly split).
  frequency?: 'weekly' | 'biweekly' | null;
  weeklyAnnual: number; weeklyMonthly: number; weeklyPerCut: number;
  biweeklyAnnual: number; biweeklyMonthly: number; biweeklyPerCut: number;
  // Price entry mode (A sq ft · B weekly seasonal · C weekly per-cut). Absent on
  // pre-mode quotes → treated as 'sqft'. Modes B/C carry the typed base and have
  // no tier / packages.
  priceMode?: 'sqft' | 'seasonal' | 'percut';
  basePriceInput?: number;           // the typed weekly figure for modes B / C
  // Optional satellite measurement that produced the sqft (mode A). Its outline
  // re-renders when the quote is reopened. Small; saved with the quote.
  measurement?: PropertyMeasurement;
  // Packages — a quote may carry several (one Jobber deposit spans them all).
  selectedPackages?: string[];       // package keys
  selectedPackage?: string | null;   // LEGACY single-field mirror (migrated on load)
  packageTravelPerVisit?: number;    // legacy; packages now use the mowing zone's per-visit rate
  packageTotal?: number | null;      // Σ of all selected packages
  // ── Mid-season proration + overgrown + BH (mowing only). Optional — older
  // quotes predate this and resolve against their stamped config as before. ──
  firstCutDate?: string;             // the first-cut-date model (replaces startDate + firstCut)
  firstCutWeek?: number;             // season week the first cut falls in (1-indexed)
  startDate?: string;                // LEGACY — migrated to firstCutDate on read
  firstCut?: 'this' | 'next';        // LEGACY — first-cut timing
  signupWeek?: number;               // LEGACY — season week the signup falls in
  seasonDiscountPct?: number;        // never negative — no surcharge
  overgrownKey?: string;
  overgrownMultiplier?: number;
  catchUpPct?: number;               // (mult−1)×DISCOUNT_PER_WEEK — billed separately
  weeklyProrated?: number; weeklyInstalments?: number; weeklyDeposit?: number;
  weeklyCatchUp?: number; weeklyFirstInvoice?: number; weeklyCutsLeft?: number; weeklyBhPerVisit?: number; weeklyFirstVisitBH?: number;
  biweeklyProrated?: number; biweeklyInstalments?: number; biweeklyDeposit?: number;
  biweeklyCatchUp?: number; biweeklyFirstInvoice?: number; biweeklyCutsLeft?: number; biweeklyBhPerVisit?: number; biweeklyFirstVisitBH?: number;
  pricingConfigVersion: string;
  quotedBy?: { email: string; name: string };
  quotedAt?: number;
  updatedBy?: { email: string; name: string };
  updatedAt?: number;
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
  // NAMED RECIPIENTS — employee ids. Combines with `audience` by UNION: you
  // see the bulletin if your role is in the audience OR you are named. Both
  // empty = everyone, which is what the board has always done.
  //
  // Ids rather than emails, so "To: Cody, Diego" still reads correctly after a
  // rename or an address change, and so the send layer resolves the current
  // address rather than one frozen at posting time.
  recipientIds?: string[];
  isAdminOnly?: boolean;
  // ── SCHEDULED POSTING ───────────────────────────────────────────────────
  // When set and still in the future, the bulletin is QUEUED: hidden from the
  // board except for its author and admins, who see it in a "Scheduled"
  // section and can edit or cancel it until it goes.
  //
  // Visibility is derived from this timestamp, NOT from the `published` flag
  // below. That is deliberate: bulletins live on the main appData doc, which
  // every whole-document save rewrites, so a stale client could revert a flag
  // — but it cannot revert the passage of time. The worst a lost flag can
  // cause is a duplicate notification, and even that is guarded server-side by
  // a dedupe marker. A bulletin that silently never appears would be the one
  // failure this feature cannot have.
  publishAt?: number;
  // Send the announcement push when it publishes (the notify checkbox, kept
  // until the moment it fires rather than at the moment it was written).
  notifyOnPublish?: boolean;
  // Stamped by the scheduled publisher. Informational — see the note above.
  published?: boolean;
  publishedAt?: number;
}

// ── RoleMaster ──────────────────────────────────────────────────────────
// Roles + recurring duties + generated task instances. All three live in
// subcollections (roleMaster/roles, /duties, /taskInstances) — nothing
// unbounded enters the 1 MiB-capped appData doc. Terminal instances are
// retained forever as the accountability record.

// 'weekdays' fires every Mon–Fri. Added for duties that are genuinely daily
// work rather than a weekly checkpoint — the daily crew-day audit, where a
// day skipped is a day that can no longer be verified. Deliberately Mon–Fri
// rather than all seven: a weekend with no audit is not a gap, and generating
// an instance nobody is expected to do would train people to ignore overdue.
export type RoleRecurrenceKind = 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
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
  updatedBy?: { email: string; name: string };
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
  updatedBy?: { email: string; name: string };
  updatedAt?: number;
  active: boolean;
}

// A change request against a (read-only-to-managers) policy. Managers submit
// input; admins resolve with a note. Never deleted — it's an input record.
// Own subcollection roleMasterPolicyRequests/{id} (grows).
export interface RoleMasterPolicyRequest {
  id: string;
  policyId: string;
  text: string;
  createdBy: { id: string; name: string };
  createdAt: number;
  status: 'open' | 'resolved';
  resolvedBy?: { id: string; name: string };
  resolvedAt?: number;
  resolutionNote?: string;
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
  // Count of approved crew-days this month that earned the trainee
  // credit in this division. Surfaced as a rollup note so the credit
  // is never applied silently. Optional for back-compat.
  traineeCreditedDays?: number;
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
    // Company-wide count of approved crew-days that earned the
    // trainee credit this month. Optional for back-compat.
    traineeCreditedDays?: number;
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

// ── MarketingMaster ────────────────────────────────────────────────────
// Five flat, marketing-namespaced subcollections. Deliberately NOT in the
// main appData doc — the content calendar, the shot list, the link board and
// the clip feedback log all grow without bound. No platform split anywhere:
// content is cross-posted, so a "platform" field would be structure nobody
// asked for.
//
// Hooks that are intentionally NOT built: analytics / platform metrics,
// auto-publishing, media file storage (links only — no bytes), crew-facing
// shot requests, notifications.

export type MarketingContentStatus = 'idea' | 'planned' | 'scheduled' | 'posted';

// One planned piece of content on the monthly calendar.
// Own subcollection marketingContent/{id}.
export interface MarketingContentItem {
  id: string;
  title: string;
  // YYYY-MM-DD. The single scheduling field — dragging a chip to another day
  // or editing the date field are the same write.
  date: string;
  status: MarketingContentStatus;
  notes?: string;
  // Set when this entry was created by scheduling a post-queue clip. Holds the
  // NORMALIZED clip key — the same key the feedback thread and the queue row
  // are keyed by — so the entry links back to the conversation without storing
  // a message id or a queue-row id.
  //
  // This one field IS the whole queue ↔ calendar linkage, and it points one
  // way. The queue row stores nothing about scheduling: it finds its entry by
  // matching this key, the way feedback finds a thread. That is what makes
  // `date` below the SINGLE scheduled date — reschedule from the queue and
  // reschedule from the calendar are the same write to the same field, so the
  // two sides cannot disagree, and deleting the entry from the calendar
  // silently returns the queue row to undated with no id left to clean up.
  clip?: string;
  // Attached reference links, held as MarketingLink ids. THE source of truth
  // for attachment — a MarketingLink never points back at an item, so a link
  // is attached in exactly one place and can't drift.
  links: string[];
  createdBy?: { email: string; name: string };
  createdAt?: number;
  updatedBy?: { email: string; name: string };
  updatedAt?: number;
}

export type MarketingShotStatus = 'needed' | 'captured';

// A shot still to be captured — THE shot queue. "Shots to follow up" and the
// shot queue are one list, not two: both are "work that needs filming", and
// this shape already carried every field a queue needs (description, target
// date, needed/captured with a dim-and-collapse section). Two lists with the
// same schema and the same semantics would only drift, so a reference link
// promoted to the queue becomes a MarketingShot like any other — it just
// carries sourceLinkId as well.
// Own subcollection marketingShots/{id}.
export interface MarketingShot {
  id: string;
  description: string;
  // Free-text job / client reference ("Riverside Dr — new patio"). Optional,
  // and deliberately NOT a foreign key: marketing shouldn't need the job
  // roster to jot down a shot.
  reference?: string;
  // Set when the shot was promoted from a saved reference link ("make
  // something like this"). Holds a MarketingLink id. The LINK IS NOT DELETED
  // on promotion — it keeps its title, note and byline on the links board and
  // gains an "in shot queue" badge, so the reference and its history survive
  // the move instead of being consumed by it. A dangling id (link later
  // deleted) degrades to no chip — never a crash.
  sourceLinkId?: string;
  targetDate?: string; // YYYY-MM-DD
  status: MarketingShotStatus;
  notes?: string;
  capturedAt?: number;
  createdBy?: { email: string; name: string };
  createdAt?: number;
  updatedBy?: { email: string; name: string };
  updatedAt?: number;
}

// A saved reference link (Instagram video, article, anything). Paste-and-save
// is the whole interaction; the title is derived from the URL and stays
// editable. Own subcollection marketingLinks/{id}.
export interface MarketingLink {
  id: string;
  url: string;
  title: string;
  note?: string;
  addedBy: { email: string; name: string };
  addedAt: number;
}

// ── Music ──────────────────────────────────────────────────────────────
// Tracks to use in videos. Deliberately the SAME shape and the same
// paste-a-link-and-save interaction as MarketingLink above — a sound lives on
// Spotify, in a TikTok sound page or on YouTube, and the app stores the pointer
// and the conversation, never the audio.
//
// The only thing it adds over a reference link is `used`: a sound already used
// in a video should stop competing for attention, without being deleted —
// knowing what has been used is exactly what stops it being used twice.
export interface MarketingTrack {
  id: string;
  url: string;
  // Derived from the URL on save (same helper the links panel uses) and
  // renameable in place, because a Spotify URL makes a poor track name.
  title: string;
  note?: string;
  // Marked once the track has appeared in a posted video. Collapses the row
  // into the dimmed "already used" section rather than removing it.
  used?: boolean;
  usedAt?: number;
  usedBy?: { email: string; name: string };
  addedBy: { email: string; name: string };
  addedAt: number;
}

// ── Clip feedback ──────────────────────────────────────────────────────
// The marketer drops numbered footage in Google Drive (#0058); Marco reviews
// it THERE and writes feedback HERE. The app stores the words, never the
// bytes — there is no upload path and no file field by design.
//
// Split across two subcollections on purpose:
//   • marketingFeedback/{id}   — one doc per message. Append-only in spirit;
//     threading is derived by grouping on `clip`, so there is no parent id to
//     keep in sync and a reply is just another row.
//   • marketingClips/{clipKey} — one doc per clip, holding the state that
//     belongs to the CLIP rather than to any one message: status and the
//     optional Drive link. Keyed by the normalized clip number, so a reply on
//     #0058 always resolves to the same doc without a lookup.
//
// Storing status on the clip rather than denormalizing it onto every message
// is what stops "open" and "addressed" from drifting apart mid-thread.

export type MarketingClipStatus = 'open' | 'addressed';

// One message on ONE subject — the shared comment shape for all three
// commentable surfaces (clip feedback, reference links, to-dos). Threads are
// derived by grouping on the subject, so there is no parent id to keep in sync
// and a reply is just another row.
//
// Back-compat is the whole reason this interface grew rather than being
// replaced: every message written before subjects existed carries `clip` and
// neither subject field, and commentSubject() in MarketingComments reads that
// as {subjectType:'clip', subjectId: clipKey(clip)}. Nothing on disk is
// migrated, rewritten or backfilled — the old docs simply keep working.
export type MarketingFeedbackSubjectType = 'clip' | 'link' | 'todo' | 'music';

export interface MarketingFeedbackEntry {
  id: string;
  // What this message is about. Absent on pre-subject docs, which are clip
  // messages by definition.
  subjectType?: MarketingFeedbackSubjectType;
  // The subject's id: a normalized clip key, a MarketingLink id, a
  // MarketingTodo id, or a MarketingTrack id.
  subjectId?: string;
  // The NORMALIZED clip key (see clipKey) — "#0058", "0058" and "58" all land
  // on "58", so the thread survives however the number was typed. Still
  // written for clip messages so their shape on disk is unchanged; absent on
  // link and to-do comments.
  clip?: string;
  text: string;
  createdBy?: { email: string; name: string };
  createdAt?: number;
}

// Readable alias — this is a comment on anything, not just clip feedback.
export type MarketingComment = MarketingFeedbackEntry;

// Per-clip state. `id` IS the normalized clip key and doubles as the doc id.
export interface MarketingClipThread {
  id: string;
  status: MarketingClipStatus;
  // Optional Drive link for the clip. Not required — the numbering is the key,
  // and a thread with no link is the normal case.
  url?: string;
  // Stamped whenever status or url changes, so "who marked this addressed"
  // is answerable without walking the message history.
  updatedBy?: { email: string; name: string };
  updatedAt?: number;
}

// ── Post queue ─────────────────────────────────────────────────────────
// Clips that have been reviewed and are ready to go out, in the order they
// should be posted. Fed from the clip-feedback section ("Send to post queue"),
// so an entry is always ABOUT a clip.
//
// The doc id IS the normalized clip key — the same key marketingFeedback rows
// group on. That is what keeps history attached: the feedback thread is not
// copied, referenced by message id, or moved. It is found the way it always
// is, by grouping messages on the clip key, so queueing a clip cannot orphan
// its conversation and un-queueing cannot strand it. Keying by clip also makes
// "send to post queue" idempotent — the same clip twice updates one row rather
// than duplicating it.
//
// Kept in its OWN subcollection rather than as fields on MarketingClipThread
// because saveMarketingClip writes the clip doc whole (callers build a fresh
// {id,status,url}), so queue fields living there would be blanked the next
// time someone marked the clip addressed.
//
// A queued clip can be SCHEDULED onto the content calendar, and that adds no
// field here on purpose: the calendar entry carries the clip key (see
// MarketingContentItem.clip) and owns the date. Scheduling does NOT remove the
// row — the queue stays the one view of what's ready and what's committed, and
// marking POSTED is the only thing that clears it.
export type MarketingPostQueueStatus = 'queued' | 'posted';

export interface MarketingPostQueueEntry {
  // The normalized clip key, doubling as the doc id.
  id: string;
  // Short "why / what" note for the poster. Independent of the feedback
  // thread — the thread is the review conversation, this is the posting note.
  note?: string;
  // Ascending sort key. Gaps and ties are tolerated: the panel sorts by
  // (order, queuedAt) and renumbers on any move, so a tie can never make the
  // list order look random.
  order: number;
  status: MarketingPostQueueStatus;
  queuedBy?: { email: string; name: string };
  queuedAt?: number;
  postedBy?: { email: string; name: string };
  postedAt?: number;
}

// ── Shared to-do ───────────────────────────────────────────────────────
// ONE list for everyone with marketing access — not per-user. There is no
// owner, no assignee and no per-item permission: anyone who can see the board
// can add, edit, tick and delete anything on it. addedBy is a byline so the
// list reads as a conversation between the two or three people using it, NOT
// an access control field.
//
// Priority is deliberately two-state. A three-tier scheme invites arguing
// about the middle tier; high/normal is the actual decision being made.
// Own subcollection marketingTodos/{id}.
export type MarketingTodoPriority = 'high' | 'normal';

export interface MarketingTodo {
  id: string;
  text: string;
  priority: MarketingTodoPriority;
  // YYYY-MM-DD. Optional — most items never get one. A date in the past
  // flags the row amber; it never blocks, hides or escalates anything.
  dueDate?: string;
  done: boolean;
  // Stamped when done flips true and CLEARED when it flips back, so a
  // re-opened item can't keep a stale completion time. Sorts the collapsed
  // Done section newest-first.
  doneAt?: number;
  addedBy?: { email: string; name: string };
  addedAt?: number;
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
  // Jobber BH changes that landed on APPROVED/WAIVED days — the sync never
  // overwrites a locked day, so it records them here (keyed by targetDate) for
  // admins to deliberately apply or ignore. Self-healing per date on each sync.
  jobberBhConflicts?: Record<string, JobberBhConflict[]>;
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
  roleMasterPolicyRequests?: Record<string, RoleMasterPolicyRequest>;
  salesMasterQuotes?: Record<string, SalesQuote>;
  snowQuotes?: Record<string, SnowQuote>;
  snowRateConfigs?: Record<string, SnowRateConfigVersion>;
  lawnQuotes?: Record<string, LawnQuote>;
  lawnRateConfigs?: Record<string, LawnRateConfigVersion>;
  // ── ContractingMaster (Palermo's) — namespaced subcollections, overlaid
  // live. ZERO contact with performance/BH/bonus/pay. Never in the main doc.
  contractingProjects?: Record<string, ContractingProject>;
  contractingTimeEntries?: Record<string, ContractingTimeEntry>;
  contractingProgressReports?: Record<string, ContractingProgressReport>;
  contractingInvoices?: Record<string, ContractingInvoice>;
  contractingWorkOrders?: Record<string, ContractingWorkOrder>;
  contractingShoppingList?: Record<string, ContractingShoppingItem>;
  contractingPersonalItems?: Record<string, ContractingPersonalItem>;
  // Property management (v2) — full hierarchy off the main doc.
  contractingPropertyDocs?: Record<string, ContractingProperty>;
  // ── MarketingMaster — namespaced subcollections, overlaid live. Never in
  // the main doc (all three grow). Read-only mirrors for the UI.
  marketingContent?: Record<string, MarketingContentItem>;
  marketingShots?: Record<string, MarketingShot>;
  marketingLinks?: Record<string, MarketingLink>;
  marketingMusic?: Record<string, MarketingTrack>;
  marketingFeedback?: Record<string, MarketingFeedbackEntry>;
  marketingClips?: Record<string, MarketingClipThread>;
  marketingPostQueue?: Record<string, MarketingPostQueueEntry>;
  marketingTodos?: Record<string, MarketingTodo>;
  // ── Hours bank — one doc per LEDGER ENTRY. Grows forever and is never
  // trimmed: it is the record of hours owed to people.
  hoursBank?: Record<string, HoursBankEntry>;
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
// NOTE: the capacity FORECAST is deliberately NOT part of AppData. It lives
// in its own document (capacityForecast/current), is held in its own React
// state and passed as a prop — so a snapshot of a few thousand visits can
// never be written back into the 1 MiB appData doc.

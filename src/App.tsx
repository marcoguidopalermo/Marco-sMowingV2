import React, { useState, useEffect, useMemo, useRef } from 'react';
import logo from '@/assets/logo/logowhite.png';
import logoBlack from '@/assets/logo/LOGOBLACK.png';
import { LoginDemo } from './components/blocks/LoginDemo';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc, deleteField, collection, deleteDoc } from 'firebase/firestore';
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Users, Truck, Plus, Trash2, GripVertical,
  UserCircle, Wrench, Settings, Printer, AlertTriangle, Sun, Cloud, CloudRain, CloudLightning,
  Snowflake, X, CreditCard as IdCard, Copy, ClipboardPaste, Filter, AlignLeft, CloudSun, Activity,
  PenTool, AlertCircle, CheckCircle, Clock, List, LayoutDashboard, Save, TrendingUp, BarChart,
  Target, Award, CalendarDays, FileSignature, Map, CheckSquare, Info, Sparkles, Loader2,
  MessageSquareText, Leaf, Download, LogOut, ShieldCheck, UserPlus, Megaphone, Lock,
  Thermometer, Flame, Hourglass, Package, ClipboardList, BookOpen, ChevronDown, Hammer, Calculator,
  ChevronUp, Layers, Eye
} from 'lucide-react';

import {
  Employee, FleetItem, DefectDetail, MechanicTask, StoredFile, FleetDocument,
  Inspection, InventoryItem, Crew, Job, PerformanceLog, AppData,
  TaskActivity, TaskActivityType, BulletinAudienceRole, TaskNote, UnitNote, AppSettings, UserRole, RolePermissionsOverride, JobberUser, PrimaryCrew, PRIMARY_CREWS,
  EquipmentSubtypeDefinition, DEFAULT_EQUIPMENT_SUBTYPES, PartialTimeOff,
  DeletionAuditEntry, PartsOrder, MaintenanceItem, MechanicPayChunk,
  TaskMasterTask, TaskMasterNote, TimeOffRequest, MultiDayJob, MonthlySummary,
  RoleMasterRole, RoleMasterDuty, RoleMasterResponsibility, RoleMasterTemplate, RoleMasterPolicy, RoleMasterPolicyRequest, SalesQuote, RoleTaskInstance,
  ContractingProject, ContractingTimeEntry, ContractingProgressReport, ContractingInvoice, ContractingWorkOrder, ContractingShoppingItem, ContractingPersonalItem, ContractingRateCard, TimeEntry
} from './types';
import { processMaintenanceForHourUpdate, processMaintenanceForOdometerUpdate, resetMaintenanceItem, isKmMaintenanceUnit, isHourMaintenanceUnit } from './lib/maintenanceUtils';
import { processPayChunksOnTimeUpdate } from './lib/payChunkUtils';
import { assigneesForTask } from './lib/workCredit';
import { can, canForCrew, resolveRole, canAccessView, firstAccessibleView, defaultLandingView, AppView, setPermissionOverrides, ROLE_PERMISSIONS } from './lib/permissions';
import { getResourceAvailability, describeUnavailability, ResourceType } from './lib/availability';
import AIInsightModal from './components/AIInsightModal';
import ManualTaskModal from './components/ManualTaskModal';
import RequestPartsModal, { type RequestPartsModalState, type RequestPartsSubmit } from './components/RequestPartsModal';
import RepairModal from './components/RepairModal';
import PrintModal from './components/PrintModal';
import CompletionModal from './components/CompletionModal';
import WeatherModal from './components/WeatherModal';
import InspectionModal from './components/InspectionModal';
import RouteSelectionModal from './components/RouteSelectionModal';
import InspectionReportModal from './components/InspectionReportModal';
import ManageResourcesModal from './components/ManageResourcesModal';
import UnitDocumentsModal from './components/UnitDocumentsModal';
import SettingsModal, { ManageTab } from './components/SettingsModal';
import UnitHistoryModal from './components/UnitHistoryModal';
import BulletinBoard from './components/BulletinBoard';
import MechanicBoard from './components/MechanicBoard';
import PerformanceBoard from './components/PerformanceBoard';
import MyCrewToday from './components/MyCrewToday';
import Dashboard from './components/Dashboard';
import MyMechanic from './components/MyMechanic';
import MyMechanicTaskModal from './components/MyMechanicTaskModal';
import ConfirmDeleteModal from './components/ConfirmDeleteModal';
import PartialTimeOffModal from './components/PartialTimeOffModal';
import ScheduleBoard from './components/ScheduleBoard';
import TimeMaster from './components/TimeMaster';
import TimeMasterWidget from './components/TimeMasterWidget';
import TaskMaster from './components/TaskMaster';
import CreateTaskModal, { type CreateTaskSubmit } from './components/CreateTaskModal';
import TaskDetailModal from './components/TaskDetailModal';
import RoleMaster from './components/RoleMaster';
import SalesMaster from './components/SalesMaster';
import ContractingMaster from './components/ContractingMaster';
import { computeReportTotals, labourForReport, ratesOrDefault as contractingRatesOrDefault, nextProgNumber, DEFAULT_CONTRACTING_RATES, rateMapFor, propertiesOrDefault, suppliersOrDefault, projectIsRemovable, planPhaseMerge } from './lib/contracting';
import type { ContractingProperty, ContractingSupplier } from './types';
import { payPeriodSettings, currentPayPeriod, previousPayPeriod, periodRangeLabel, payDateLabel } from './lib/payPeriods';
import { noticeDaysOrDefault } from './lib/propertyMgmt';
import { ratesOrDefault } from './lib/salesMaster';
import RoleInstanceModal from './components/RoleInstanceModal';
import RequestTimeOffModal, { type RequestTimeOffSubmit } from './components/RequestTimeOffModal';

// --- CUSTOM ICONS ---
const ClassAIcon = ({ className, title }: { className?: string; title?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {title && <title>{title}</title>}
    <rect x="2" y="5" width="20" height="14" rx="2"></rect>
    <path d="M8 15l3-6 3 6"></path>
    <path d="M9.5 13h5"></path>
  </svg>
);

const SkidSteerIcon = ({ className, title }: { className?: string; title?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {title && <title>{title}</title>}
    <circle cx="7" cy="17" r="2.5" />
    <circle cx="15" cy="17" r="2.5" />
    <path d="M5 14V8h5l2.5 4H16" />
    <path d="M3 14h12v3H3z" />
    <path d="M10 10l6 3h4v-2l-2-2" />
  </svg>
);

import { auth, db, appId, functions } from './lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { logPerfActivity } from './lib/perfAudit';
import {
  monthOfDate, extractMonth, monthSettlementStatus,
  SHEET_SIZE_WARN_BYTES,
} from './lib/performanceMonths';
import { buildMonthlySummary } from './lib/monthlySummary';
import { nextUnusedColorKey } from './lib/roleCategories';
import { callGeminiWithRetry } from './lib/gemini';

import {
  INITIAL_EMPLOYEES, INITIAL_FLEET, INITIAL_INVENTORY,
  TEST_USER_ID, TEST_USER_EMAIL, TEST_USER_NAME,
  DIVISIONS, CREW_NUMBERS, WEIGHT_CLASSES, ROUTE_FREQUENCIES, DAYS_OF_WEEK,
  DVIR_DEFECTS, CIRCLE_CHECK_DEFECTS, DEFAULT_EOD_REMINDER, PERMISSION_DENIED,
  ODOMETER_JUMP_WARN_KM, ENGINE_HOURS_JUMP_WARN
} from './constants';


import {
  getStartOfWeek, formatDate, addDays, formatTodayInToronto,
  isExpiringSoon, isExpired, isOdoStale, needsAudit
} from './lib/dateUtils';
import { getRequiredInspectionType, getUnitReadiness } from './lib/inspectionUtils';
import { sortFleetGrouped, fleetItemLabel, isFleetOutOfService } from './lib/fleetUtils';

const SUPER_ADMIN_EMAIL = 'marcoguidopalermo@gmail.com';
const normalizeEmail = (e: string | null | undefined): string => (e || '').trim().toLowerCase();

export default function App() {
  // --- STATE ---
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // True once the FIRST appData snapshot for the signed-in user has been
  // applied. Until then, role + employee are still derived from the seed
  // (INITIAL_EMPLOYEES), so any role/record-dependent UI (and the one-shot
  // landing redirect) must wait — otherwise an admin briefly renders as a
  // worker / "no employee record" and the redirect locks the view to My
  // Crew Today. Reset whenever `user` changes so a new sign-in re-waits.
  const [dataLoaded, setDataLoaded] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [weather, setWeather] = useState<Record<string, any>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [jobberUsers, setJobberUsers] = useState<JobberUser[]>([]);
  const [jobberConnected, setJobberConnected] = useState(false);

  // Real signed-in identity. These are pinned to the Firebase auth
  // user and never change at the View As layer. The
  // impersonation-aware `displayEmail` and `displayName` are derived
  // further down (after appData is in scope) and are what the rest
  // of the codebase consumes.
  const realDisplayEmail = user?.email || "marcoguidopalermo@gmail.com";
  const realDisplayName = user?.displayName || realDisplayEmail;

  // Navigation & Views
  const [currentView, setCurrentView] = useState('schedule');
  const [scheduleMode, setScheduleMode] = useState<'daily' | 'weekly'>('daily');
  const [selectedDailyDate, setSelectedDailyDate] = useState(formatTodayInToronto());
  const [crewFilter, setCrewFilter] = useState('All');
  const [sidebarCrewFilter, setSidebarCrewFilter] = useState<'All' | PrimaryCrew>('All');
  const [sidebarFleetFilter, setSidebarFleetFilter] = useState<'All' | 'truck' | 'trailer' | 'tractor' | 'equipment'>('All');
  // Per-section collapse state for the schedule sidebar. Default expanded;
  // session-only (resets on reload).
  const [sidebarOpen, setSidebarOpen] = useState<{ personnel: boolean; fleet: boolean }>({ personnel: true, fleet: true });
  // Immersive mode: sidebar takes over with full vertical space for the
  // drag-drop sections only. Resets on navigation away from Schedule and
  // on every page reload (session-only).
  const [crewBuilderMode, setCrewBuilderMode] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [copiedDay, setCopiedDay] = useState(null);

  // Auth gate state
  const [authRejected, setAuthRejected] = useState<string | null>(null);
  // True once the current signed-in user has passed the client-side
  // authorizedEmails check at least once this session. After that we do
  // NOT eject them on a later snapshot that momentarily lacks their email
  // (stale/empty/mid-write list) — real revocation is enforced
  // server-side by Firestore rules and surfaces via the snapshot
  // permission-denied error handler. Reset whenever `user` changes (new
  // sign-in / sign-out) so the first decision for a fresh user is always
  // a genuine check. A ref (not state) so updating it never re-renders or
  // re-runs the snapshot effect.
  const sessionAuthorizedRef = useRef(false);
  // Phase 1: multiDayJobs lives in its own subcollection, not the appData
  // doc. We keep the doc's (legacy, pre-removal) copy and the live
  // subcollection copy in refs and merge them into appData.multiDayJobs —
  // the subcollection OVERLAYS the doc-base so fresh writes always win and
  // the cutover is safe regardless of migration order. After the one-time
  // removal pass strips the doc field, the doc-base is just {}.
  const docMultiDayJobsRef = useRef<Record<string, MultiDayJob>>({});
  const subMultiDayJobsRef = useRef<Record<string, MultiDayJob>>({});
  // Phase 3: inspections live in their own subcollection. Same overlay model
  // as multiDayJobs — doc-base copy + live subcollection, merged by id
  // (subcollection wins), newest-first to match the prepend convention.
  const docInspectionsRef = useRef<Inspection[]>([]);
  const subInspectionsRef = useRef<Inspection[]>([]);
  // "Push Month": completed months live in performanceMonths/{YYYY-MM}
  // sheets, not the appData doc. docPerformanceRef holds the doc's own
  // (current-month) performance; subPerformanceMonthsRef holds the
  // flattened date→crew map overlaid from every loaded month sheet. The
  // live appData.performance is the sheets overlaid UNDER the doc copy
  // (doc wins for the current month; by invariant a month is only ever
  // in ONE place, so there is no real overlap). Mirrors the multiDayJobs
  // overlay so every performance reader (board, MTD, reports) is unchanged.
  const docPerformanceRef = useRef<Record<string, Record<string, PerformanceLog>>>({});
  const subPerformanceMonthsRef = useRef<Record<string, Record<string, PerformanceLog>>>({});
  // Trends: monthlySummaries subcollection, overlaid like multiDayJobs. Not
  // stored in the appData doc — a live map merged in on every render.
  const subMonthlySummariesRef = useRef<Record<string, MonthlySummary>>({});
  // RoleMaster — three subcollections, overlaid like the others.
  const subRoleMasterRolesRef = useRef<Record<string, RoleMasterRole>>({});
  const subRoleMasterDutiesRef = useRef<Record<string, RoleMasterDuty>>({});
  const subRoleMasterResponsibilitiesRef = useRef<Record<string, RoleMasterResponsibility>>({});
  const subRoleMasterTemplatesRef = useRef<Record<string, RoleMasterTemplate>>({});
  const subRoleMasterPoliciesRef = useRef<Record<string, RoleMasterPolicy>>({});
  const subRoleMasterPolicyRequestsRef = useRef<Record<string, RoleMasterPolicyRequest>>({});
  const subSalesMasterQuotesRef = useRef<Record<string, SalesQuote>>({});
  const subRoleTaskInstancesRef = useRef<Record<string, RoleTaskInstance>>({});
  // ContractingMaster (Palermo's) — namespaced subcollections, own tenant.
  const subContractingProjectsRef = useRef<Record<string, ContractingProject>>({});
  const subContractingTimeEntriesRef = useRef<Record<string, ContractingTimeEntry>>({});
  const subContractingProgressReportsRef = useRef<Record<string, ContractingProgressReport>>({});
  const subContractingInvoicesRef = useRef<Record<string, ContractingInvoice>>({});
  const subContractingWorkOrdersRef = useRef<Record<string, ContractingWorkOrder>>({});
  const subContractingShoppingListRef = useRef<Record<string, ContractingShoppingItem>>({});
  const subContractingPersonalItemsRef = useRef<Record<string, ContractingPersonalItem>>({});
  const subContractingPropertyDocsRef = useRef<Record<string, ContractingProperty>>({});
  const mergePerformance = (
    docPerf: Record<string, Record<string, PerformanceLog>>,
    monthOverlay: Record<string, Record<string, PerformanceLog>>,
  ): Record<string, Record<string, PerformanceLog>> => ({ ...monthOverlay, ...docPerf });
  // Schedules → per-month sheets (scheduleMonths/{YYYY-MM}). Same overlay as
  // performance: the doc keeps the current + future months; PAST months live
  // on their sheet. docSchedulesRef holds the doc's own copy; the sheets are
  // overlaid UNDER it (doc wins; a month is only ever in one place). Keeps
  // the crew-size-allowance FALLBACK (appData.schedules[date]) resolving for
  // archived dates so Advanced Reports on old ranges are unchanged.
  const docSchedulesRef = useRef<Record<string, Crew[]>>({});
  const subScheduleMonthsRef = useRef<Record<string, Crew[]>>({});
  const mergeSchedules = (
    docSched: Record<string, Crew[]>,
    monthOverlay: Record<string, Crew[]>,
  ): Record<string, Crew[]> => ({ ...monthOverlay, ...docSched });
  const mergeInspections = (base: Inspection[], sub: Inspection[]): Inspection[] => {
    // NB: `Map` is the lucide icon import in this file — use a plain object.
    const byId: Record<string, Inspection> = {};
    for (const i of base) if (i && i.id) byId[i.id] = i;
    for (const i of sub) if (i && i.id) byId[i.id] = i; // subcollection wins
    return Object.values(byId).sort(
      (a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')),
    );
  };

  // Modals & Forms State
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isWeatherModalOpen, setIsWeatherModalOpen] = useState(false);
  const [aiModal, setAiModal] = useState({ isOpen: false, title: '', content: '', isLoading: false });
  const [manageTab, setManageTab] = useState('employees');
  const [fleetFilter, setFleetFilter] = useState('truck');

  const [localEmployees, setLocalEmployees] = useState<Employee[]>([]);
  const [localFleet, setLocalFleet] = useState<FleetItem[]>([]);
  const [localRoutes, setLocalRoutes] = useState<Job[]>([]);
  const [localAdmins, setLocalAdmins] = useState<string[]>([]);
  // Baseline snapshot of authorizedEmails captured when the Manage modal
  // opens. Used at save time to apply only the admin's intentional deltas
  // (added / removed emails) on top of the LATEST server list, instead of
  // overwriting it wholesale with a possibly-stale localAdmins — which
  // could silently drop an admin added by someone else while the modal
  // was open. See the Personnel save handler.
  const localAdminsBaselineRef = useRef<string[]>([]);
  const [localEquipmentSubtypes, setLocalEquipmentSubtypes] = useState<EquipmentSubtypeDefinition[]>([]);
  // Inline-edit drafts of pre-scheduled partial time-off. Flat shape (date inside
  // the record) makes inline editing easy; rehydrated into the keyed
  // PartialTimeOff map on save.
  const [localPartialTimeOff, setLocalPartialTimeOff] = useState<(PartialTimeOff & { date: string })[]>([]);
  const [localInventory, setLocalInventory] = useState<InventoryItem[]>([]);
  const [localSupplies, setLocalSupplies] = useState<string[]>([]);
  const [localSettings, setLocalSettings] = useState<AppSettings>({ endOfDayReminder: DEFAULT_EOD_REMINDER });
  const [localPermissions, setLocalPermissions] = useState<RolePermissionsOverride>({});
  const [isSystemPrinting, setIsSystemPrinting] = useState(false);
  const [completionModal, setCompletionModal] = useState<import('./components/CompletionModal').CompletionModalState>({
    isOpen: false, taskId: '', partCost: '', laborHours: '', fixNotes: ''
  });

  // Print State
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [printSelection, setPrintSelection] = useState<string[]>([]);
  const [printType, setPrintType] = useState<'daily' | 'weekly' | 'range'>('daily');
  const [printDateRange, setPrintDateRange] = useState({ start: formatDate(new Date()), end: formatDate(new Date()) });
  const [printDailyDate, setPrintDailyDate] = useState<string>(formatDate(new Date()));
  const [manualTaskModal, setManualTaskModal] = useState<import('./components/ManualTaskModal').ManualTaskModalState>({ isOpen: false, unitId: '', unitName: '', category: '', description: '', severity: 'minor', priority: false });
  // Which unit's documents modal is open (null = closed). Opened from the
  // MyCrewToday truck/trailer strip (worker view-only) and the fleet
  // manager surface (admin/manager, editable).
  const [documentsUnitId, setDocumentsUnitId] = useState<string | null>(null);
  const [requestPartsModal, setRequestPartsModal] = useState<RequestPartsModalState>({ isOpen: false });
  const [historyUnitId, setHistoryUnitId] = useState<string | null>(null);
  const [draggingResource, setDraggingResource] = useState<{ type: ResourceType; id: string } | null>(null);
  // MyMechanic detail-modal target. The modal looks up the live task by id
  // on every render so concurrent edits (status, assignee, notes) reflect
  // instantly without closing.
  const [myMechanicTaskId, setMyMechanicTaskId] = useState<string | null>(null);
  // TaskMaster state — create modal flag + detail target. Detail modal
  // also looks up the live task by id every render.
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [taskMasterDetailId, setTaskMasterDetailId] = useState<string | null>(null);
  // Time-off request modal state — when `editingTimeOffId` is set the
  // modal opens pre-filled for an edit; otherwise it's a fresh submit.
  const [isTimeOffModalOpen, setIsTimeOffModalOpen] = useState(false);
  const [editingTimeOffId, setEditingTimeOffId] = useState<string | null>(null);
  // Delete-confirmation context. The orchestrator helpers below populate
  // it; ConfirmDeleteModal reads it; the confirm handler stored here
  // executes the actual deletion + audit write in a single syncToCloud.
  const [deleteCtx, setDeleteCtx] = useState<{
    kind: DeletionAuditEntry['recordType'];
    title: string;
    body: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  // Open partial time-off modal for a specific employee + date.
  const [partialTimeOffCtx, setPartialTimeOffCtx] = useState<{ empId: string; empName: string; dateStr: string } | null>(null);

  // View Permissions
  const [viewAsRole, setViewAsRole] = useState<UserRole | null>(null);
  // Test User impersonation. Mutually exclusive with viewAsRole —
  // selecting one clears the other. When true, every downstream
  // identity derivation resolves to the Test User Employee record
  // (email, name, role, employee match) so all employee-linked
  // views and audit attributions flow through Test User without
  // per-call-site changes.
  const [viewAsTestUser, setViewAsTestUser] = useState(false);
  // Per-employee impersonation. When set (admin only), the app adopts that
  // employee's full identity (email/name/employee record/role) so their
  // personal views populate. Mutually exclusive with viewAsRole/viewAsTestUser.
  const [viewAsEmployeeId, setViewAsEmployeeId] = useState<string | null>(null);
  const [viewAsMenuOpen, setViewAsMenuOpen] = useState(false);
  const viewAsMenuRefDesktop = useRef<HTMLDivElement | null>(null);
  const viewAsMenuRefMobile = useRef<HTMLDivElement | null>(null);
  const [newAdminEmail, setNewAdminEmail] = useState('');

  // MechanicMaster State
  const [mechanicView, setMechanicView] = useState('kanban');
  const [repairModal, setRepairModal] = useState({ isOpen: false, fleetId: null, fixNotes: '', cost: '' });
  // Submit guards for the two repair-creation paths. The refs are the hard
  // re-entrancy lock (synchronous — blocks a double-tap before React can
  // re-render); the state flags drive the disabled/"Saving…" button UI.
  const repairSubmitRef = useRef(false);
  const [isLoggingRepair, setIsLoggingRepair] = useState(false);
  const completionSubmitRef = useRef(false);
  const [isCompletingRepair, setIsCompletingRepair] = useState(false);
  // Duplicate-repair cleanup (super-admin maintenance tool) preview state.
  const [repairCleanupCtx, setRepairCleanupCtx] = useState<{ removeIds: string[]; groups: number } | null>(null);
  const [activeInspection, setActiveInspection] = useState<{ unitId: string | null, targetDate: string, defects: DefectDetail[], expandedCategory: string | null, draftSeverity: 'minor' | 'major', draftNotes: string }>({ unitId: null, targetDate: '', defects: [], expandedCategory: null, draftSeverity: 'minor', draftNotes: '' });
  const [viewingInspectionId, setViewingInspectionId] = useState<string | null>(null);
  const [editingOdoId, setEditingOdoId] = useState(null);
  const [tempOdo, setTempOdo] = useState('');

  // PerformanceMaster State
  const [perfDate, setPerfDate] = useState(formatTodayInToronto());
  const [perfTab, setPerfTab] = useState('entry');
  const [reportStartDate, setReportStartDate] = useState(formatDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [reportEndDate, setReportEndDate] = useState(formatDate(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)));
  const [dailyLogs, setDailyLogs] = useState<Record<string, PerformanceLog>>({});
  const [routeModalCrewId, setRouteModalCrewId] = useState<string | null>(null);
  const [routeFilters, setRouteFilters] = useState({ division: 'Lawn Division', targetDay: 'Monday', frequency: 'Weekly' });
  const [selectedRouteIds, setSelectedRouteIds] = useState<Set<string>>(new Set());

  // Bulletin Board State
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [bulletinAudience, setBulletinAudience] = useState<BulletinAudienceRole[]>([]);

  // Core App Data Structure
  const [appData, setAppData] = useState<AppData>({
    schedules: {},
    employees: INITIAL_EMPLOYEES,
    fleet: INITIAL_FLEET,
    routes: [],
    inventory: INITIAL_INVENTORY,
    repairLog: [],
    bulletins: [{ id: 'b1', title: "Welcome to Marco's Mowing ERP", content: 'The new system is live. Check out the Daily View and the new Inventory tracking!', date: formatDate(new Date()), isAdminOnly: false, author: 'System' }],
    dailyAbsences: {},
    partialTimeOff: {},
    performance: {},
    authorizedEmails: ["marcoguidopalermo@gmail.com"],
    supplies: ["Blower", "Trimmer", "Mower (Push)", "Rake", "Shovel", "Wheelbarrow", "Fuel Can (Mix)", "Fuel Can (Gas)"],
    inspections: [],
    mechanicTasks: [],
    activityLog: [],
    timeEntries: [],
    overrides: {},
    rolePermissions: {},
    settings: { endOfDayReminder: DEFAULT_EOD_REMINDER },
    multiDayJobs: {},
    visitBHSplits: {},
    bulletinReads: {},
    deletionAuditLog: [],
    equipmentSubtypes: DEFAULT_EQUIPMENT_SUBTYPES,
    tasks: {},
    timeOffRequests: {},
  });

  // REAL PERMISSIONS (based on linked Employee record)
  const realCurrentEmail = normalizeEmail(user?.email);
  const isSuperAdmin = !!realCurrentEmail && realCurrentEmail === SUPER_ADMIN_EMAIL;
  const realCurrentUserEmployee: Employee | null = realCurrentEmail
    ? (appData.employees.find(e => normalizeEmail(e.linkedUserEmail) === realCurrentEmail) || null)
    : null;
  const realCurrentUserRole: UserRole = isSuperAdmin ? 'admin' : resolveRole(realCurrentUserEmployee);

  // Test User impersonation. The sentinel Employee record is found
  // by flag, not by id, so a renamed record keeps working. Only
  // engages for real admins to prevent a non-admin from somehow
  // toggling viewAsTestUser and escalating.
  const testUserEmployee = (appData.employees || []).find(e => e.isTestUser) || null;
  const isImpersonatingTestUser = realCurrentUserRole === 'admin' && viewAsTestUser && !!testUserEmployee;

  // Per-employee impersonation target (admin only). Resolved from the
  // chosen id against the live roster.
  const viewAsEmployee: Employee | null = (realCurrentUserRole === 'admin' && viewAsEmployeeId)
    ? ((appData.employees || []).find(e => e.id === viewAsEmployeeId) || null)
    : null;

  // The employee whose identity we adopt: the Test User sentinel OR a
  // chosen real employee. Both swap the FULL identity (email/name/record/
  // role); they're mutually exclusive in the UI.
  const impersonatedEmployee: Employee | null = isImpersonatingTestUser
    ? testUserEmployee
    : viewAsEmployee;
  const isImpersonatingIdentity = !!impersonatedEmployee;

  // Effective identity. When impersonating an employee (Test User or a
  // real person) these all resolve to that employee's record so downstream
  // consumers (TimeMaster, MyMechanic, My Crew Today, activity attribution,
  // pay chunks) behave as if that person is signed in.
  const currentEmail = isImpersonatingIdentity
    ? normalizeEmail(impersonatedEmployee!.linkedUserEmail || impersonatedEmployee!.email || '')
    : realCurrentEmail;
  const currentUserEmployee: Employee | null = isImpersonatingIdentity
    ? impersonatedEmployee
    : realCurrentUserEmployee;
  const currentUserRole: UserRole = isImpersonatingIdentity
    ? resolveRole(impersonatedEmployee)
    : realCurrentUserRole;
  const displayEmail = isImpersonatingIdentity
    ? (impersonatedEmployee!.linkedUserEmail || impersonatedEmployee!.email || realDisplayEmail)
    : realDisplayEmail;
  const displayName = isImpersonatingIdentity
    ? (impersonatedEmployee!.name || (isImpersonatingTestUser ? TEST_USER_NAME : realDisplayName))
    : realDisplayName;

  // VIEW PERMISSIONS (admin's role/employee switcher). Identity
  // impersonation supersedes the simple role switcher.
  const effectiveRole: UserRole = isImpersonatingIdentity
    ? resolveRole(impersonatedEmployee)
    : ((realCurrentUserRole === 'admin' && viewAsRole) ? viewAsRole : realCurrentUserRole);
  const isViewingAs =
    isImpersonatingIdentity ||
    (realCurrentUserRole === 'admin' && viewAsRole !== null && viewAsRole !== 'admin');

  const isAdmin = effectiveRole === 'admin';
  const isManager = effectiveRole === 'admin' || effectiveRole === 'manager';
  const isRealAdmin = realCurrentUserRole === 'admin';
  // ContractingMaster (Palermo's) — full-manage is admin OR the contracting
  // manager flag (Tony). Regular contractors (Kris) only view + clock + WO/shop.
  const canManageContracting = isAdmin || !!currentUserEmployee?.contractingManager;

  // Real CrewMaster employees an admin can impersonate — sourced from
  // appData.employees (the actual personnel roster), NOT Jobber users.
  // Includes EVERY role (workers, foremen, managers, mechanics). Mechanics
  // aren't on Jobber, so a Jobber-derived list would miss them. We exclude
  // only the Test User (its own menu entry) and explicitly inactive/away/
  // archived records — anything else (incl. employees whose status field
  // was never set to the exact string 'Active') still shows.
  const impersonatableEmployees = useMemo(() => {
    const isInactive = (s: string | undefined) => {
      const v = (s || '').toLowerCase();
      return v.includes('away') || v.includes('inactive') || v.includes('archive') || v.includes('terminat');
    };
    return (appData.employees || [])
      .filter(e => !e.isTestUser && !isInactive(e.status) && !!(e.name || e.linkedUserEmail || e.email))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [appData.employees]);
  // Current View-As target label for the dropdown button.
  const viewAsLabel = isImpersonatingTestUser ? 'Test User'
    : viewAsEmployee ? (viewAsEmployee.name || viewAsEmployee.linkedUserEmail || 'Employee')
    : (viewAsRole || 'admin');
  // Navigate straight to an impersonated identity's home dashboard.
  const goToImpersonatedHome = (role: UserRole) => setCurrentView(defaultLandingView(role));

  // Top-level permission gates (used by sidebar navigation, top-level renders)
  const canEditSchedule = can('canCreateCrews', effectiveRole) || can('canEditAnyCrew', effectiveRole) || can('canEditOwnCrew', effectiveRole);
  const canManageResources = can('canViewManageResources', effectiveRole);
  const canViewMechanic = can('canViewMechanicMaster', effectiveRole);

  // --- Bulletin unread-count badge -----------------------------------------
  // Subscribes to the same source as the Bulletin Board view (appData.bulletins
  // + the audience filter) so the count stays in sync with the content; no
  // extra listener, no polling. The number is the count of visible bulletins
  // with createdAt > the current user's lastReadAt. Legacy bulletins with no
  // createdAt fall back to midnight of their `date` field so they don't all
  // count as unread forever on first deploy.
  const bulletinCreatedAt = (b: any): number => {
    if (typeof b?.createdAt === 'number') return b.createdAt;
    const parsed = Date.parse(`${b?.date || ''}T00:00:00`);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const bulletinReadKey = (displayEmail || '').trim().toLowerCase();
  const bulletinUnreadCount = useMemo(() => {
    const list: any[] = appData.bulletins || [];
    const reads = appData.bulletinReads || {};
    const lastReadAt = reads[bulletinReadKey] || 0;
    return list.filter((b: any) => {
      // Same audience filter the Bulletin Board view itself uses.
      const aud = (b.audience || []) as string[];
      if (aud.length === 0) {
        if (b.isAdminOnly && !isAdmin) return false;
      } else if (!aud.includes(effectiveRole as string)) {
        return false;
      }
      return bulletinCreatedAt(b) > lastReadAt;
    }).length;
  }, [appData.bulletins, appData.bulletinReads, bulletinReadKey, effectiveRole, isAdmin]);

  // When the user is viewing the Bulletin Board, mark all currently-visible
  // bulletins as read. Re-fires on every bulletins change so a new post
  // arriving while the user is on the page is auto-marked, not surfaced as
  // an unread on next leave/return.
  useEffect(() => {
    if (currentView !== 'bulletins' || !bulletinReadKey) return;
    if (bulletinUnreadCount === 0) return;
    const list: any[] = appData.bulletins || [];
    const newest = list.reduce((m, b: any) => Math.max(m, bulletinCreatedAt(b)), 0);
    if (newest <= 0) return;
    syncToCloud({
      ...appData,
      bulletinReads: { ...(appData.bulletinReads || {}), [bulletinReadKey]: newest },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, bulletinUnreadCount]);

  // --- TaskMaster badge ----------------------------------------------------
  // Counts tasks assigned to the effective user that haven't been
  // acknowledged since they were created. Opening the TaskMaster view
  // bumps acknowledgedBy for every visible-to-me task to Date.now().
  const taskMasterUnreadCount = useMemo(() => {
    if (!canAccessView('taskmaster', effectiveRole)) return 0;
    const me = (displayEmail || '').trim().toLowerCase();
    if (!me) return 0;
    const map = appData.tasks || {};
    let count = 0;
    for (const t of Object.values(map)) {
      if (!t || t.status === 'done') continue;
      const assignee = (t.assignedTo?.email || '').toLowerCase();
      if (assignee !== me) continue;
      const ack = (t.acknowledgedBy || {})[me] || 0;
      if (ack < (t.createdAt || 0)) count += 1;
    }
    return count;
  }, [appData.tasks, displayEmail, effectiveRole]);

  // Acknowledge all my-visible tasks on view entry. Same pattern as the
  // bulletins read tracker. Touch only entries whose acknowledged
  // timestamp is stale relative to createdAt so concurrent re-renders
  // don't churn the document.
  useEffect(() => {
    if (currentView !== 'taskmaster') return;
    const me = (displayEmail || '').trim().toLowerCase();
    if (!me) return;
    const map = appData.tasks || {};
    const stale = Object.values(map).filter(t => {
      if (!t) return false;
      const assignee = (t.assignedTo?.email || '').toLowerCase();
      if (assignee !== me) return false;
      const ack = (t.acknowledgedBy || {})[me] || 0;
      return ack < (t.createdAt || 0);
    });
    if (stale.length === 0) return;
    const now = Date.now();
    const next = { ...map };
    for (const t of stale) {
      next[t.id] = { ...t, acknowledgedBy: { ...(t.acknowledgedBy || {}), [me]: now } };
    }
    syncToCloud({ ...appData, tasks: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, appData.tasks]);

  // --- Time-off badges ----------------------------------------------------
  // Admin badge — pending requests this approver hasn't acknowledged
  // since they were created. Per-record ack (TaskMaster pattern).
  const timeOffPendingForAdminCount = useMemo(() => {
    if (!can('canApproveTimeOff', effectiveRole)) return 0;
    const me = (displayEmail || '').trim().toLowerCase();
    if (!me) return 0;
    const map = appData.timeOffRequests || {};
    let count = 0;
    for (const r of Object.values(map)) {
      if (!r || r.status !== 'pending') continue;
      const ack = (r.acknowledgedByAdmin || {})[me] || 0;
      if (ack < (r.createdAt || 0)) count += 1;
    }
    return count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appData.timeOffRequests, displayEmail, effectiveRole]);

  // Requester badge — my requests whose status changed since I last
  // viewed TimeMaster. Counts approved + denied transitions.
  const timeOffStatusChangesForMeCount = useMemo(() => {
    const me = (displayEmail || '').trim().toLowerCase();
    if (!me) return 0;
    const map = appData.timeOffRequests || {};
    let count = 0;
    for (const r of Object.values(map)) {
      if (!r || (r.employeeEmail || '').toLowerCase() !== me) continue;
      if (r.status !== 'approved' && r.status !== 'denied') continue;
      const seen = r.seenByRequester || 0;
      if ((r.reviewedAt || 0) > seen) count += 1;
    }
    return count;
  }, [appData.timeOffRequests, displayEmail]);

  // Acknowledge on view-entry — TimeMaster for the requester.
  // (The approver-side acknowledgment is handled inside TimeMaster
  // now that the approval queue is a tab there, not its own view.)
  useEffect(() => {
    if (currentView !== 'timemaster') return;
    const me = (displayEmail || '').trim().toLowerCase();
    if (!me) return;
    const map = appData.timeOffRequests || {};
    const stale = Object.values(map).filter(r => {
      if (!r || (r.employeeEmail || '').toLowerCase() !== me) return false;
      if (r.status !== 'approved' && r.status !== 'denied') return false;
      return (r.reviewedAt || 0) > (r.seenByRequester || 0);
    });
    if (stale.length === 0) return;
    const now = Date.now();
    const next = { ...map };
    for (const r of stale) {
      next[r.id] = { ...r, seenByRequester: now };
    }
    syncToCloud({ ...appData, timeOffRequests: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, appData.timeOffRequests]);

  // Modal-clobber protection. When the Personnel modal is open and an
  // external write changes appData.employees (awayDates approval) or
  // appData.partialTimeOff, re-merge those time-off fields into the
  // modal's local drafts so a subsequent modal save doesn't overwrite
  // the just-landed approval. In-progress edits to OTHER fields
  // (names, roles, etc.) are preserved — only the time-off slice is
  // re-derived.
  useEffect(() => {
    if (!isManageModalOpen) return;
    setLocalEmployees(prev => prev.map(local => {
      const fresh = appData.employees.find(e => e.id === local.id);
      if (!fresh) return local;
      return { ...local, awayDates: JSON.parse(JSON.stringify(fresh.awayDates || [])) };
    }));
    const flatPTO: (PartialTimeOff & { date: string })[] = [];
    Object.entries(appData.partialTimeOff || {}).forEach(([date, list]) => {
      (list || []).forEach(p => flatPTO.push({ ...p, date }));
    });
    setLocalPartialTimeOff(flatPTO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appData.employees, appData.partialTimeOff, isManageModalOpen]);

  // Parallel modal-clobber protection for fleet awayDates. When an
  // external write changes appData.fleet (e.g. a deploy lands fresh
  // Equipment Time Off ranges entered elsewhere), re-merge the
  // awayDates slice into the modal's localFleet draft. In-progress
  // edits to OTHER fleet fields (names, maintenance items, etc.)
  // are preserved — only the time-off slice is re-derived.
  useEffect(() => {
    if (!isManageModalOpen) return;
    setLocalFleet(prev => prev.map(local => {
      const fresh = appData.fleet.find(f => f.id === local.id);
      if (!fresh) return local;
      return { ...local, awayDates: JSON.parse(JSON.stringify(fresh.awayDates || [])) };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appData.fleet, isManageModalOpen]);

  // Mirror appData.rolePermissions into the permissions module-level cache.
  // can() reads this cache; useEffect ensures every appData update refreshes it.
  useEffect(() => {
    setPermissionOverrides(appData.rolePermissions);
  }, [appData.rolePermissions]);

  // Auto-exit Crew Builder mode if the user leaves the Schedule view.
  useEffect(() => {
    if (crewBuilderMode && currentView !== 'schedule') setCrewBuilderMode(false);
  }, [currentView, crewBuilderMode]);

  // Close View As dropdown on outside click
  useEffect(() => {
    if (!viewAsMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideDesktop = viewAsMenuRefDesktop.current?.contains(target);
      const insideMobile = viewAsMenuRefMobile.current?.contains(target);
      if (!insideDesktop && !insideMobile) {
        setViewAsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [viewAsMenuOpen]);

  // One-time role-aware landing redirect + ongoing fallback to first
  // accessible view if the current view stops being permitted (e.g. View As).
  const initialLandingRedirectDone = useRef(false);
  useEffect(() => {
    // Gate ALL role-based navigation on data-ready. While appData is still
    // the seed, effectiveRole is the transient 'worker' default — firing
    // either the one-shot landing redirect OR the access fallback here
    // would lock an admin onto the worker view (My Crew Today). Waiting
    // for `dataLoaded` means we redirect against the real role exactly once.
    if (!user || loading || !dataLoaded) return;
    if (!initialLandingRedirectDone.current && effectiveRole) {
      const target = defaultLandingView(effectiveRole);
      if (currentView !== target && canAccessView(target, effectiveRole)) {
        setCurrentView(target);
      }
      initialLandingRedirectDone.current = true;
      return;
    }
    if (!canAccessView(currentView as AppView, effectiveRole)) {
      setCurrentView(firstAccessibleView(effectiveRole));
    }
  }, [currentView, effectiveRole, loading, user, dataLoaded]);

  // Pay-chunk safety net. Runs whenever timeEntries / employees /
  // mechanicPayChunks change in state. For each open chunk, calls
  // processPayChunksOnTimeUpdate; if any chunk actually closes
  // (helper returns a NEW object reference), writes the result.
  // The helper returns the same input ref when nothing closes, so
  // this effect short-circuits cleanly and doesn't loop. Catches
  // cases where a TimeMaster save was missed by the wrapper (admin
  // edits via another path, rollout backfill creating an already-
  // overdue chunk, etc.).
  useEffect(() => {
    if (!user || loading) return;
    if (isViewingAs) return; // view-only: no background writes while impersonating
    const chunks = appData.mechanicPayChunks || {};
    const openEmails = new Set<string>();
    for (const c of Object.values(chunks)) {
      if (c.status === 'open' && c.mechanicEmail) openEmails.add(c.mechanicEmail.toLowerCase());
    }
    if (openEmails.size === 0) return;
    let merged = chunks;
    for (const email of openEmails) {
      merged = processPayChunksOnTimeUpdate(
        email,
        merged,
        appData.employees,
        appData.timeEntries || [],
      );
    }
    if (merged !== chunks) {
      syncToCloud({ ...appData, mechanicPayChunks: merged });
    }
    // We intentionally exclude `appData` and `syncToCloud` from the
    // dep list to avoid re-running on every appData mutation — only
    // changes to the inputs that matter for the chunk math should
    // trigger this safety net.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appData.timeEntries, appData.employees, appData.mechanicPayChunks, user, loading]);

  // Test User bootstrap. INITIAL_EMPLOYEES seeds the sentinel on
  // fresh installs; this useEffect handles existing Firestore
  // databases that predate the feature. Idempotent — once written,
  // the snapshot listener will include it and `exists` short-
  // circuits forever after.
  useEffect(() => {
    if (loading || !user) return;
    if (isViewingAs) return; // view-only: don't seed while impersonating
    if (!Array.isArray(appData.employees)) return;
    const exists = appData.employees.some(e => e.isTestUser);
    if (exists) return;
    const seed: Employee = {
      id: TEST_USER_ID,
      name: TEST_USER_NAME,
      status: 'Active',
      hasLicense: false,
      hasClassA: false,
      hasHeavyMachinery: false,
      awayDates: [],
      isTestUser: true,
      email: TEST_USER_EMAIL,
      linkedUserEmail: TEST_USER_EMAIL,
      systemRole: 'mechanic',
      timeMasterEnabled: true,
    };
    syncToCloud({ ...appData, employees: [...appData.employees, seed] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appData.employees, user, loading]);

  // --- INIT EFFECTS ---
  useEffect(() => {
    fetch('https://api.open-meteo.com/v1/forecast?latitude=48.3809&longitude=-89.2477&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto')
      .then(res => res.json())
      .then(data => {
        const weatherMap: Record<string, any> = {};
        data.daily.time.forEach((dateStr: string, i: number) => { weatherMap[dateStr] = { max: Math.round(data.daily.temperature_2m_max[i]), min: Math.round(data.daily.temperature_2m_min[i]), code: data.daily.weathercode[i] }; });
        setWeather(weatherMap);
      }).catch(() => console.error("Weather fetch failed"));
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      // Gate render on DATA-ready, not AUTH-ready. For a SIGNED-IN user we
      // keep the loader up until the first appData snapshot is applied (the
      // snapshot effect resets `dataLoaded` on (re)subscribe and the
      // snapshot handler sets it true + clears loading). Only clear loading
      // here when signed OUT, so the login screen shows promptly.
      if (!currentUser) {
        setLoading(false);
        setDataLoaded(false);
      }
    });
  }, []);

  useEffect(() => {
    // New sign-in (or sign-out): the next authorization decision for this
    // user is a genuine first check, not a re-check of an active session.
    sessionAuthorizedRef.current = false;
    // Re-wait for this user's first appData snapshot before rendering any
    // role/employee-dependent UI (keeps the loader up; the snapshot handler
    // sets dataLoaded=true). Reset here — not in onAuthStateChanged — so it
    // only flips when `user` actually changes, never stranding the loader.
    setDataLoaded(false);
    if (!user) return;
    const dataRef = doc(db, 'artifacts', appId, 'public', 'data', 'appData', 'main');
    return onSnapshot(dataRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();

        // Phase 1: remember the doc's (legacy) multiDayJobs copy; the live
        // value is the subcollection overlaid on top (see the subcollection
        // listener effect). Pre-removal the doc still carries a frozen copy;
        // post-removal this is {}.
        docMultiDayJobsRef.current = (data.multiDayJobs || {}) as Record<string, MultiDayJob>;
        // Phase 3: same — remember the doc's legacy inspections copy; live
        // value is the subcollection overlaid on top (pre-removal this is
        // the frozen doc copy, post-removal []).
        docInspectionsRef.current = (data.inspections || []) as Inspection[];
        // Push Month: remember the doc's own performance (current month)
        // so the syncToCloud DOC write can substitute it (stripping any
        // pushed month), and overlay the loaded month sheets on top for
        // readers.
        docPerformanceRef.current = (data.performance || {}) as Record<string, Record<string, PerformanceLog>>;
        // Schedules: doc-base (current + future) overlaid by past-month sheets.
        docSchedulesRef.current = (data.schedules || {}) as Record<string, Crew[]>;

        const newAppData = {
          schedules: mergeSchedules(docSchedulesRef.current, subScheduleMonthsRef.current),
          archivedScheduleMonths: data.archivedScheduleMonths || [],
          employees: data.employees || INITIAL_EMPLOYEES,
          // Lazy backfill: equipment that opted into hour tracking
          // before currentEngineHours existed has its hours in the
          // legacy `odometer` field. Copy that across into
          // currentEngineHours so the new system has a reading to
          // work from. Doesn't touch units where currentEngineHours
          // is already set, doesn't touch non-equipment. In-memory
          // only — the next fleet save (any save) persists the
          // migrated value to Firestore.
          fleet: (data.fleet || INITIAL_FLEET).map((f: FleetItem) => {
            if (
              f.type === 'equipment' &&
              f.tracksEngineHours &&
              typeof f.currentEngineHours !== 'number' &&
              typeof f.odometer === 'number'
            ) {
              return { ...f, currentEngineHours: f.odometer };
            }
            return f;
          }),
          routes: data.routes || [],
          inventory: data.inventory || INITIAL_INVENTORY,
          repairLog: data.repairLog || [],
          bulletins: data.bulletins || [],
          dailyAbsences: data.dailyAbsences || {},
          partialTimeOff: data.partialTimeOff || {},
          // Doc-base (current month) overlaid by the live month sheets.
          performance: mergePerformance(docPerformanceRef.current, subPerformanceMonthsRef.current),
          pushedMonths: data.pushedMonths || [],
          archivedDays: data.archivedDays || {},
          unlockedDays: data.unlockedDays || {},
          // Trends summaries live in a subcollection, overlaid via the ref.
          monthlySummaries: subMonthlySummariesRef.current,
          roleMasterRoles: subRoleMasterRolesRef.current,
          roleMasterDuties: subRoleMasterDutiesRef.current,
          roleMasterResponsibilities: subRoleMasterResponsibilitiesRef.current,
          roleMasterTemplates: subRoleMasterTemplatesRef.current,
          roleMasterPolicies: subRoleMasterPoliciesRef.current,
          roleMasterPolicyRequests: subRoleMasterPolicyRequestsRef.current,
          salesMasterQuotes: subSalesMasterQuotesRef.current,
          roleTaskInstances: subRoleTaskInstancesRef.current,
          // ContractingMaster — overlaid from namespaced subcollections.
          contractingProjects: subContractingProjectsRef.current,
          contractingTimeEntries: subContractingTimeEntriesRef.current,
          contractingProgressReports: subContractingProgressReportsRef.current,
          contractingInvoices: subContractingInvoicesRef.current,
          contractingWorkOrders: subContractingWorkOrdersRef.current,
          contractingShoppingList: subContractingShoppingListRef.current,
          contractingPersonalItems: subContractingPersonalItemsRef.current,
          contractingPropertyDocs: subContractingPropertyDocsRef.current,
          authorizedEmails: data.authorizedEmails || [SUPER_ADMIN_EMAIL],
          supplies: data.supplies || ["Blower", "Trimmer", "Mower (Push)", "Rake", "Shovel", "Wheelbarrow", "Fuel Can (Mix)", "Fuel Can (Gas)"],
          // Doc-base overlaid by the live subcollection (Phase 3).
          inspections: mergeInspections(docInspectionsRef.current, subInspectionsRef.current),
          cvorExpiry: data.cvorExpiry,
          mechanicTasks: data.mechanicTasks || [],
          activityLog: data.activityLog || [],
          timeEntries: data.timeEntries || [],
          overrides: data.overrides || {},
          rolePermissions: (data.rolePermissions && typeof data.rolePermissions === 'object' && !('foreman' in data.rolePermissions && 'canEditSchedule' in (data.rolePermissions as any).foreman))
            ? (data.rolePermissions as RolePermissionsOverride)
            : {},
          settings: data.settings || { endOfDayReminder: DEFAULT_EOD_REMINDER },
          // Doc-base overlaid by the live subcollection (Phase 1).
          multiDayJobs: { ...docMultiDayJobsRef.current, ...subMultiDayJobsRef.current },
          partsOrders: data.partsOrders || {},
          mechanicPayChunks: data.mechanicPayChunks || {},
          tasks: data.tasks || {},
          timeOffRequests: data.timeOffRequests || {},
          visitBHSplits: data.visitBHSplits || {},
          bulletinReads: data.bulletinReads || {},
          deletionAuditLog: data.deletionAuditLog || [],
          __multiDayKeyVersion: data.__multiDayKeyVersion,
          // Seed equipment subtypes on first load (or when wiped). Once
          // an admin edits them, this value will be present and we
          // preserve it verbatim.
          equipmentSubtypes: (Array.isArray(data.equipmentSubtypes) && data.equipmentSubtypes.length > 0)
            ? data.equipmentSubtypes
            : DEFAULT_EQUIPMENT_SUBTYPES,
        };

        // AUTH GATE — confirm this user's email is on the authorized list.
        //
        // This client-side check is a convenience / early-rejection layer
        // only. The REAL security gate is server-side Firestore rules,
        // which reject reads for unauthorized users and surface here as a
        // permission-denied snapshot error (handled in the error callback
        // below). So this check is deliberately LENIENT for active
        // sessions to avoid kicking out a genuinely-authorized user on a
        // transient snapshot:
        //   • Eject only on the user's FIRST authorization decision this
        //     session — a fresh login that is genuinely not on the list.
        //   • Once a user has passed once, never eject them on a later
        //     snapshot. A momentarily stale / empty / mid-write
        //     authorizedEmails array (e.g. another client's full-document
        //     save echoing an out-of-date list) can no longer kick a live
        //     session. Real revocation still takes effect server-side.
        //   • Treat an empty or missing authorizedEmails array as
        //     INDETERMINATE (don't eject) — never as "deny everyone".
        //     This also closes the old `[] is truthy` edge where an empty
        //     array bypassed the super-admin fallback and ejected everyone.
        const userEmail = normalizeEmail(user.email);
        const isSuper = userEmail === SUPER_ADMIN_EMAIL;
        const allowed = (Array.isArray(data.authorizedEmails) ? data.authorizedEmails : [])
          .map((e: string) => normalizeEmail(e))
          .filter(Boolean);
        const listKnown = allowed.length > 0; // empty/missing = indeterminate
        const authorized = isSuper || (!!userEmail && allowed.includes(userEmail));
        // Reject ONLY a confirmed, stable rejection: we have a definitive
        // list, the user isn't on it, and this is their initial decision
        // this session (not a re-check of an already-authorized session).
        if (!authorized && listKnown && !sessionAuthorizedRef.current) {
          setAuthRejected(`Your email (${userEmail || 'unknown'}) is not authorized to access CrewMaster. Contact your administrator.`);
          signOut(auth).catch(() => { /* ignore — onAuthStateChanged will clear user regardless */ });
          setLoading(false);
          return;
        }
        if (authorized) {
          // Mark the session as having passed the gate so subsequent
          // snapshots can't eject it on a transient miss.
          sessionAuthorizedRef.current = true;
          setAuthRejected(null);
        }

        setAppData(newAppData);
      } else {
        console.warn("No remote data found, initializing with defaults.");
        setDoc(dataRef, appData).catch((err: any) => console.error("Init err:", err));
      }
      // First snapshot applied — role/employee now derive from real data,
      // so it's safe to drop the loader and let the landing redirect run.
      setLoading(false); setDataLoaded(true); setErrorMsg(null);
    }, (error) => {
      console.error("Firestore Listen Error:", error);
      // Firestore rules reject snapshot reads for users not on the
      // authorizedEmails list. Treat that as an auth rejection rather than a
      // generic connection error.
      const code = (error as { code?: string }).code || '';
      if (code === 'permission-denied') {
        const userEmail = normalizeEmail(user?.email);
        setAuthRejected(`Your email (${userEmail || 'unknown'}) is not authorized to access CrewMaster. Contact your administrator.`);
        signOut(auth).catch(() => { /* ignore */ });
      } else {
        setErrorMsg(`Cloud connection lost: ${error.message}`);
      }
      // Release the loader on error too (show the error / app rather than
      // spinning forever); the permission-denied branch above signs out.
      setLoading(false); setDataLoaded(true);
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const authRef = doc(db, 'artifacts', appId, 'private', 'data', 'jobberAuth', 'main');
    const usersRef = doc(db, 'artifacts', appId, 'private', 'data', 'jobberUsers', 'main');
    const unsubAuth = onSnapshot(
      authRef,
      snap => setJobberConnected(snap.exists()),
      () => setJobberConnected(false),
    );
    const unsubUsers = onSnapshot(
      usersRef,
      snap => {
        const data = snap.data() as { users?: JobberUser[] } | undefined;
        setJobberUsers(Array.isArray(data?.users) ? data!.users : []);
      },
      () => setJobberUsers([]),
    );
    return () => { unsubAuth(); unsubUsers(); };
  }, [user]);

  // Phase 1: live multiDayJobs subcollection listener. Rebuilds the
  // Record<jobberVisitId, MultiDayJob> map from one-doc-per-ledger and
  // merges it OVER the appData doc's (legacy) copy so every existing
  // keyed reader (appData.multiDayJobs[visitId]) works unchanged. Keyed
  // by the stored jobberVisitId field, so no doc-id decoding is needed.
  useEffect(() => {
    if (!user) return;
    const mdjCol = collection(db, 'artifacts', appId, 'public', 'data', 'multiDayJobs');
    return onSnapshot(
      mdjCol,
      (snap) => {
        const map: Record<string, MultiDayJob> = {};
        snap.forEach((d) => {
          const v = d.data() as MultiDayJob;
          if (v && v.jobberVisitId) map[v.jobberVisitId] = v;
        });
        subMultiDayJobsRef.current = map;
        setAppData((prev) => ({
          ...prev,
          multiDayJobs: { ...docMultiDayJobsRef.current, ...map },
        }));
      },
      (err) => { console.error('multiDayJobs subcollection listen error:', err); },
    );
  }, [user]);

  // Phase 3: live inspections subcollection listener. Rebuilds the
  // Inspection[] from one-doc-per-inspection and merges it OVER the appData
  // doc's legacy copy so every existing reader (UnitHistoryModal,
  // InspectionLog, MyCrewToday, etc.) works unchanged.
  useEffect(() => {
    if (!user) return;
    const inspCol = collection(db, 'artifacts', appId, 'public', 'data', 'inspections');
    return onSnapshot(
      inspCol,
      (snap) => {
        const list: Inspection[] = [];
        snap.forEach((d) => {
          const v = d.data() as Inspection;
          if (v && v.id) list.push(v);
        });
        subInspectionsRef.current = list;
        setAppData((prev) => ({
          ...prev,
          inspections: mergeInspections(docInspectionsRef.current, list),
        }));
      },
      (err) => { console.error('inspections subcollection listen error:', err); },
    );
  }, [user]);

  // Push Month: live performanceMonths subcollection listener. Each doc is
  // one completed month (id = YYYY-MM) holding that month's FULL data under
  // `days: { [date]: { [crewId]: PerformanceLog } }`. We flatten every
  // month's days into one date→crew map and merge it UNDER the doc's
  // current-month performance, so every reader (PerformanceBoard, MTD,
  // Advanced Reports, MyCrewToday) sees pushed months exactly as if they
  // were still in the doc — byte-for-byte identical, just relocated. No
  // reader changes; bonus/MTD parity is preserved by construction.
  useEffect(() => {
    if (!user) return;
    const monthsCol = collection(db, 'artifacts', appId, 'public', 'data', 'performanceMonths');
    return onSnapshot(
      monthsCol,
      (snap) => {
        const overlay: Record<string, Record<string, PerformanceLog>> = {};
        snap.forEach((d) => {
          const v = d.data() as { days?: Record<string, Record<string, PerformanceLog>> };
          const days = v?.days || {};
          for (const [date, dayMap] of Object.entries(days)) {
            overlay[date] = dayMap;
          }
        });
        subPerformanceMonthsRef.current = overlay;
        setAppData((prev) => ({
          ...prev,
          performance: mergePerformance(docPerformanceRef.current, overlay),
        }));
      },
      (err) => { console.error('performanceMonths subcollection listen error:', err); },
    );
  }, [user]);

  // Trends: live monthlySummaries subcollection listener. One compact doc
  // per month (id = YYYY-MM). Read-only reporting — never written back into
  // the appData doc.
  useEffect(() => {
    if (!user) return;
    const col = collection(db, 'artifacts', appId, 'public', 'data', 'monthlySummaries');
    return onSnapshot(
      col,
      (snap) => {
        const map: Record<string, MonthlySummary> = {};
        snap.forEach((d) => {
          const v = d.data() as MonthlySummary;
          if (v && v.month) map[v.month] = v;
        });
        subMonthlySummariesRef.current = map;
        setAppData((prev) => ({ ...prev, monthlySummaries: map }));
      },
      (err) => { console.error('monthlySummaries subcollection listen error:', err); },
    );
  }, [user]);

  // Schedules per-month sheet listener. One doc per past month (id = YYYY-MM)
  // holding `days: { [date]: Crew[] }`. Flattened + overlaid UNDER the doc's
  // current/future schedules, so every schedules reader (crew-size allowance
  // fallback in Advanced Reports, etc.) resolves archived dates unchanged.
  useEffect(() => {
    if (!user) return;
    const col = collection(db, 'artifacts', appId, 'public', 'data', 'scheduleMonths');
    return onSnapshot(
      col,
      (snap) => {
        const overlay: Record<string, Crew[]> = {};
        snap.forEach((d) => {
          const v = d.data() as { days?: Record<string, Crew[]> };
          for (const [date, crews] of Object.entries(v?.days || {})) overlay[date] = crews;
        });
        subScheduleMonthsRef.current = overlay;
        setAppData((prev) => ({
          ...prev,
          schedules: mergeSchedules(docSchedulesRef.current, overlay),
        }));
      },
      (err) => { console.error('scheduleMonths subcollection listen error:', err); },
    );
  }, [user]);

  // RoleMaster: roles, duties, and generated task instances — each its own
  // subcollection, overlaid live (never in the appData doc).
  useEffect(() => {
    if (!user) return;
    const mk = <T extends { id?: string }>(
      name: string, ref: React.MutableRefObject<Record<string, T>>, key: keyof AppData,
    ) => onSnapshot(
      collection(db, 'artifacts', appId, 'public', 'data', name),
      (snap) => {
        const map: Record<string, T> = {};
        snap.forEach((d) => { const v = d.data() as T; if (v && v.id) map[v.id] = v; });
        ref.current = map;
        setAppData((prev) => ({ ...prev, [key]: map }));
      },
      (err) => { console.error(`${name} subcollection listen error:`, err); },
    );
    const u1 = mk('roleMasterRoles', subRoleMasterRolesRef, 'roleMasterRoles');
    const u2 = mk('roleMasterDuties', subRoleMasterDutiesRef, 'roleMasterDuties');
    const u3 = mk('roleTaskInstances', subRoleTaskInstancesRef, 'roleTaskInstances');
    const u4 = mk('roleMasterResponsibilities', subRoleMasterResponsibilitiesRef, 'roleMasterResponsibilities');
    const u5 = mk('roleMasterTemplates', subRoleMasterTemplatesRef, 'roleMasterTemplates');
    const u6 = mk('roleMasterPolicies', subRoleMasterPoliciesRef, 'roleMasterPolicies');
    const u7 = mk('salesMasterQuotes', subSalesMasterQuotesRef, 'salesMasterQuotes');
    const u8 = mk('roleMasterPolicyRequests', subRoleMasterPolicyRequestsRef, 'roleMasterPolicyRequests');
    // ContractingMaster (Palermo's) — namespaced subcollections.
    const c1 = mk('contractingProjects', subContractingProjectsRef, 'contractingProjects');
    const c2 = mk('contractingTimeEntries', subContractingTimeEntriesRef, 'contractingTimeEntries');
    const c3 = mk('contractingProgressReports', subContractingProgressReportsRef, 'contractingProgressReports');
    const c4 = mk('contractingInvoices', subContractingInvoicesRef, 'contractingInvoices');
    const c5 = mk('contractingWorkOrders', subContractingWorkOrdersRef, 'contractingWorkOrders');
    const c6 = mk('contractingShoppingList', subContractingShoppingListRef, 'contractingShoppingList');
    const c7 = mk('contractingPersonalItems', subContractingPersonalItemsRef, 'contractingPersonalItems');
    const c8 = mk('contractingPropertyDocs', subContractingPropertyDocsRef, 'contractingPropertyDocs');
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); u8(); c1(); c2(); c3(); c4(); c5(); c6(); c7(); c8(); };
  }, [user]);

  useEffect(() => {
    const savedLogs = appData.performance?.[perfDate] || {};
    const initialLogs: Record<string, PerformanceLog> = {};
    const schedules = appData.schedules[perfDate] || [];
    // Test users are ghosts to performance — they must never sit in a
    // log's employeeAH (an empty test-user entry silently blocks approval
    // since the row is hidden from display). Drop them on render and never
    // seed them below.
    const testUserIds = new Set((appData.employees || []).filter(e => e.isTestUser).map(e => e.id));

    Object.keys(savedLogs).forEach(cId => {
      if (savedLogs[cId].isAdHoc) initialLogs[cId] = { ...savedLogs[cId] };
    });

    schedules.forEach(crew => {
      const saved = savedLogs[crew.id] || { jobs: [], employeeAH: {}, deductions: {}, removedEmployees: [] as string[] };
      const removed = new Set(saved.removedEmployees || []);

      // Fresh copies so the ghost-prune below never mutates the shared
      // appData.performance maps in place.
      const nextAH: Record<string, any> = { ...(saved.employeeAH || {}) };
      const nextDeduc: Record<string, any> = { ...(saved.deductions || {}) };

      // Ghost-AH prune (Step 1 of the AH-reconciliation fix). Drop AH
      // entries for workers auto-attributed by a prior sync who have since
      // been removed from this crew's schedule. ALL guards must hold, so it
      // never touches manually-added unscheduled workers, approved days,
      // already manually-removed entries, or manualAH-flagged entries
      // (AH-split workers — flagged explicitly, because a split-in worker
      // is off-roster + jobber-linked, the exact ghost signature; without
      // the flag the prune would delete their pay hours on every rebuild):
      //   1. an Employee record exists for the key
      //   2. that employee is jobber-linked (hours came from auto-attribution)
      //   3. the day is NOT approved (approved days are immutable)
      //   4. the key is NOT already in removedEmployees
      //   5. the key is NOT flagged in manualAH (deliberate manual pay data)
      // plus the trigger: the key is NOT on the current crew roster.
      const isApprovedDay = savedLogs[crew.id]?.approvalStatus === 'approved';
      if (!isApprovedDay) {
        const rosterIds = new Set(crew.employees || []);
        const manualFlags = savedLogs[crew.id]?.manualAH || {};
        for (const empId of Object.keys(nextAH)) {
          // Test users never belong in performance AH — drop them on any
          // non-approved day regardless of roster / jobber-link, so they
          // can't sit in the stored log and silently block approval.
          if (testUserIds.has(empId)) {
            delete nextAH[empId];
            delete nextDeduc[empId];
            continue;
          }
          if (manualFlags[empId]) continue;            // manual split/attribution — authoritative, keep
          if (rosterIds.has(empId)) continue;          // still scheduled — keep
          if (removed.has(empId)) continue;            // already manually removed — keep
          const emp = appData.employees.find(e => e.id === empId);
          if (!emp) continue;                          // no employee record — keep (don't touch)
          if (!emp.jobberUserId) continue;             // not sync-attributed — keep (manual / unscheduled)
          // All guards satisfied → ghost left behind by a schedule removal.
          delete nextAH[empId];
          delete nextDeduc[empId];
        }
      }

      initialLogs[crew.id] = {
        ...saved,
        division: crew.division || 'Large Projects', crewNumber: crew.crewNumber || 1, isAdHoc: false,
        jobs: saved.jobs || [], employeeAH: nextAH, deductions: nextDeduc,
        removedEmployees: saved.removedEmployees || [],
      };
      crew.employees.forEach(eId => {
        if (removed.has(eId)) return;
        if (testUserIds.has(eId)) return;   // never seed a test user into AH
        if (initialLogs[crew.id].employeeAH[eId] === undefined) initialLogs[crew.id].employeeAH[eId] = '';
        if (initialLogs[crew.id].deductions[eId] === undefined) initialLogs[crew.id].deductions[eId] = '';
      });
    });
    setDailyLogs(initialLogs);
  }, [perfDate, appData.schedules, appData.performance]);

  // Earliest-stage open partsOrder linked to a repair. Sort priority is
  // requested < ordered < arrived; the displayed wrench color reflects
  // the LEAST-progressed order on a task with multiple linked orders.
  // No linked orders → undefined (no wrench rendered on the card).
  const computePartsStatus = (
    repairId: string,
    orders: Record<string, PartsOrder>,
  ): MechanicTask['partsStatus'] => {
    const linked = Object.values(orders).filter(o => o.repairId === repairId);
    if (linked.length === 0) return undefined;
    if (linked.some(o => o.status === 'requested')) return 'requested';
    if (linked.some(o => o.status === 'ordered')) return 'ordered';
    return 'arrived';
  };

  // Derived variables
  const startOfWeek = getStartOfWeek(currentDate);
  const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(startOfWeek, i));

  const showToastMsg = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4500); };
  const getEmpName = (id: string) => appData.employees.find(e => e.id === id)?.name || 'Unknown';

  const openManageTab = (tab: ManageTab) => {
    setLocalEmployees(JSON.parse(JSON.stringify(appData.employees)));
    setLocalFleet(JSON.parse(JSON.stringify(appData.fleet)));
    setLocalRoutes(JSON.parse(JSON.stringify(appData.routes || [])));
    setLocalAdmins(appData.authorizedEmails || []);
    // Remember the list as loaded so the save can diff against it.
    localAdminsBaselineRef.current = (appData.authorizedEmails || []).map(e => normalizeEmail(e)).filter(Boolean);
    setLocalInventory(JSON.parse(JSON.stringify(appData.inventory || [])));
    setLocalSupplies(appData.supplies || []);
    setLocalPermissions(JSON.parse(JSON.stringify(appData.rolePermissions || {})));
    setLocalSettings(appData.settings || { endOfDayReminder: DEFAULT_EOD_REMINDER });
    setLocalEquipmentSubtypes(JSON.parse(JSON.stringify(appData.equipmentSubtypes || DEFAULT_EQUIPMENT_SUBTYPES)));
    // Flatten partial time-off map into draft rows for inline editing.
    const flatPTO: (PartialTimeOff & { date: string })[] = [];
    Object.entries(appData.partialTimeOff || {}).forEach(([date, list]) => {
      (list || []).forEach(p => flatPTO.push({ ...p, date }));
    });
    setLocalPartialTimeOff(flatPTO);
    setManageTab(tab);
    setIsSettingsModalOpen(false);
    setIsManageModalOpen(true);
  };

  // --- MAINTENANCE COMPLETION PREFILL ---
  // Shared by every path that closes a maintenance task — task-detail
  // modal, drag-drop onto Done, and the arrow's todo→doing→done
  // promotion. Returns the CompletionModalState fields that flip the
  // dialog into Maintenance mode (km vs hours, default reading,
  // mechanic-editable next-due pre-fill). Returns {} for repair
  // tasks; the caller spreads the result into the modal state.
  const buildMaintCompletionPrefill = (
    task: { unitId?: string; source?: string; sourceMaintenanceItemId?: string } | undefined,
  ): Partial<import('./components/CompletionModal').CompletionModalState> => {
    if (!task || task.source !== 'maintenance' || !task.unitId) return {};
    const u = appData.fleet.find(f => f.id === task.unitId);
    if (!u) return { isMaintenance: true };
    const item = (u.maintenanceItems || []).find(mi => mi.id === task.sourceMaintenanceItemId);
    const metric: 'hours' | 'km' = item?.metric || 'hours';
    // Pre-fill the reading at service from the unit's current
    // reading. Next-due defaults to (reading + interval) for BOTH
    // metrics; the modal shows it as locked-with-edit so the
    // mechanic accepts or overrides deliberately.
    let reading = 0;
    if (metric === 'km') {
      reading = typeof u.odometer === 'number' ? u.odometer : 0;
    } else if (typeof u.currentEngineHours === 'number') {
      reading = u.currentEngineHours;
    }
    const interval = typeof item?.threshold === 'number' ? item.threshold : 0;
    return {
      isMaintenance: true,
      maintenanceItemName: item?.name,
      hoursAtService: String(reading),
      maintenanceMetric: metric,
      nextDueAtService: String(reading + interval),
      nextDueLocked: true,
    };
  };

  // --- TASK ACTIVITY HELPERS ---
  const makeActivity = (
    type: TaskActivityType,
    task: Pick<MechanicTask, 'id' | 'unitId' | 'unitName' | 'category' | 'severity' | 'reportedBy'>,
    payload?: Record<string, any>
  ): TaskActivity => ({
    id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    type,
    userEmail: displayEmail,
    userName: displayName,
    timestamp: new Date().toISOString(),
    taskId: task.id,
    unitId: task.unitId,
    unitName: task.unitName,
    taskCategory: task.category,
    taskSeverity: task.severity,
    // Carry the repair's reporter onto every activity so the log shows it
    // even for completed repairs whose task row has been removed.
    reportedBy: task.reportedBy,
    payload: isViewingAs ? { ...(payload || {}), viewAsRole } : payload,
  });

  // --- DELETE ORCHESTRATOR -----------------------------------------------
  // Hard-delete a mechanic record (task / repair log / inspection log).
  // The audit entry is appended and the record is removed in the SAME
  // syncToCloud write, so a failed write rolls back both (Firestore setDoc
  // is atomic). On failure the confirm modal stays open so the user can
  // retry or cancel.
  const executeDelete = async (
    kind: DeletionAuditEntry['recordType'],
    recordId: string,
    snapshot: unknown,
    summary: DeletionAuditEntry['summary'],
    nextAppDataPatch: (data: AppData) => AppData,
  ): Promise<boolean> => {
    const entry: DeletionAuditEntry = {
      id: `del-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      userEmail: displayEmail,
      userName: displayName,
      userRole: effectiveRole,
      recordType: kind,
      recordId,
      summary,
      snapshot,
    };
    const patched = nextAppDataPatch(appData);
    const next: AppData = {
      ...patched,
      deletionAuditLog: [entry, ...(appData.deletionAuditLog || [])],
    };
    const ok = await syncToCloud(next);
    return !!ok;
  };

  const requestDeleteTask = (taskId: string) => {
    if (!can('canDeleteMechanicTask', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
    const task = (appData.mechanicTasks || []).find(t => t.id === taskId);
    if (!task) { showToastMsg('Task not found.'); return; }
    setDeleteCtx({
      kind: 'task',
      title: 'Delete this task?',
      body: 'This task and its activity history will be permanently removed. This cannot be undone.',
      confirmLabel: 'Delete task',
      onConfirm: async () => {
        // Preserve the existing per-task 'deleted' activity-log entry the
        // previous direct-delete path wrote — older code (and audit views)
        // expect to see this in the global activityLog regardless of the
        // new deletionAuditLog.
        const act = makeActivity('deleted', task);
        const ok = await executeDelete(
          'task',
          task.id,
          task,
          { title: task.description || task.category, unitName: task.unitName, severity: task.severity, date: task.dateReported },
          (d) => ({
            ...d,
            mechanicTasks: (d.mechanicTasks || []).filter(t => t.id !== task.id),
            activityLog: [act, ...(d.activityLog || [])],
          }),
        );
        if (ok) {
          if (myMechanicTaskId === task.id) setMyMechanicTaskId(null);
          setDeleteCtx(null);
          showToastMsg('Task deleted.');
        } else {
          showToastMsg('Delete failed — audit not written. Try again.');
        }
      },
    });
  };

  const requestDeleteRepairLog = (logId: string) => {
    if (!can('canDeleteRepairLog', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
    const log = (appData.repairLog || []).find((r: any) => r.id === logId);
    if (!log) { showToastMsg('Repair log not found.'); return; }
    setDeleteCtx({
      kind: 'repair_log',
      title: 'Delete this repair log?',
      body: 'This repair record will be permanently removed from maintenance history. This cannot be undone.',
      confirmLabel: 'Delete repair log',
      onConfirm: async () => {
        const ok = await executeDelete(
          'repair_log',
          log.id,
          log,
          { title: log.fixNotes, unitName: log.equipmentName, date: log.date },
          (d) => ({ ...d, repairLog: (d.repairLog || []).filter((r: any) => r.id !== log.id) }),
        );
        if (ok) { setDeleteCtx(null); showToastMsg('Repair log deleted.'); }
        else showToastMsg('Delete failed — audit not written. Try again.');
      },
    });
  };

  const requestDeleteInspectionLog = (inspectionId: string) => {
    if (!can('canDeleteInspectionLog', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
    const insp = (appData.inspections || []).find(i => i.id === inspectionId);
    if (!insp) { showToastMsg('Inspection not found.'); return; }
    setDeleteCtx({
      kind: 'inspection_log',
      title: 'Delete this inspection log?',
      body: 'This inspection record will be permanently removed from inspection history. This cannot be undone.',
      confirmLabel: 'Delete inspection log',
      onConfirm: async () => {
        const ok = await executeDelete(
          'inspection_log',
          insp.id,
          insp,
          { title: `${insp.type} inspection`, unitName: (appData.fleet.find(f => f.id === insp.unitId)?.name) || insp.unitId, severity: insp.status, date: insp.date },
          (d) => ({ ...d, inspections: (d.inspections || []).filter(i => i.id !== insp.id) }),
        );
        if (ok) { setDeleteCtx(null); showToastMsg('Inspection log deleted.'); }
        else showToastMsg('Delete failed — audit not written. Try again.');
      },
    });
  };

  // --- DUPLICATE-REPAIR CLEANUP (super-admin maintenance) ----------------
  // Groups repairLog by equipmentId|date|fixNotes|cost. Any group with >1
  // entry is a double-submit; we keep the earliest-created (smallest
  // rep-<ts>) and mark the rest for removal. Pure — no side effects.
  const findDuplicateRepairs = (
    repairLog: any[],
  ): { removeIds: string[]; groups: number } => {
    // Plain object as the map — `Map` is shadowed by a lucide-react icon
    // import in this file, so the global Map constructor isn't usable here.
    const groups: Record<string, any[]> = {};
    for (const r of repairLog || []) {
      const key = `${r.equipmentId}|${r.date}|${r.fixNotes || ''}|${Number(r.cost) || 0}`;
      (groups[key] = groups[key] || []).push(r);
    }
    const removeIds: string[] = [];
    let dupGroups = 0;
    for (const arr of Object.values(groups)) {
      if (arr.length <= 1) continue;
      dupGroups++;
      const sorted = [...arr].sort((a, b) => {
        const ta = Number(String(a.id || '').match(/^rep-(\d+)/)?.[1]) || 0;
        const tb = Number(String(b.id || '').match(/^rep-(\d+)/)?.[1]) || 0;
        return ta - tb;
      });
      for (let i = 1; i < sorted.length; i++) removeIds.push(sorted[i].id);
    }
    return { removeIds, groups: dupGroups };
  };

  // Step 1: back up the whole appData doc, compute the preview, and open the
  // confirm modal. Nothing is written here — bulk delete waits for confirm.
  const handleCleanupDuplicateRepairs = () => {
    if (!isSuperAdmin) { showToastMsg(PERMISSION_DENIED); return; }
    const { removeIds, groups } = findDuplicateRepairs(appData.repairLog || []);
    if (removeIds.length === 0) { showToastMsg('No duplicate repairs found.'); return; }
    // Back up appData to a downloaded JSON file before any bulk deletion.
    try {
      const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `appData-backup-${formatDate(new Date())}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Backup is best-effort; the preview/confirm gate still protects data.
    }
    setIsSettingsModalOpen(false);
    setRepairCleanupCtx({ removeIds, groups });
  };

  // Step 2: actually remove the duplicates. The same syncToCloud that caps
  // the audit log runs here, so this write also shrinks the doc — the
  // un-sticking write when the doc was previously too big to save.
  const confirmCleanupDuplicateRepairs = async () => {
    if (!repairCleanupCtx) return;
    const removeSet = new Set(repairCleanupCtx.removeIds);
    const ok = await syncToCloud({
      ...appData,
      repairLog: (appData.repairLog || []).filter((r: any) => !removeSet.has(r.id)),
    });
    if (ok) {
      showToastMsg(`Removed ${repairCleanupCtx.removeIds.length} duplicate repair${repairCleanupCtx.removeIds.length === 1 ? '' : 's'}.`);
      setRepairCleanupCtx(null);
    } else {
      showToastMsg('Cleanup failed — try again. Your backup was downloaded.');
    }
  };

  const handlePrevWeek = () => setCurrentDate(addDays(currentDate, -7));
  const handleNextWeek = () => setCurrentDate(addDays(currentDate, 7));
  const handleToday = () => setCurrentDate(new Date());

  const handlePrint = () => {
    // Collect all crews for the current view to allow selection
    let crewsToSelect: any[] = [];
    if (scheduleMode === 'daily') {
      crewsToSelect = appData.schedules[selectedDailyDate] || [];
    } else {
      weekDays.forEach(d => {
        const dateStr = formatDate(d);
        const dayCrews = appData.schedules[dateStr] || [];
        crewsToSelect = [...crewsToSelect, ...dayCrews.map(c => ({ ...c, dateStr }))];
      });
    }
    setPrintSelection((crewsToSelect as any[]).map(c => c.id));
    setPrintType(scheduleMode);
    setPrintDailyDate(selectedDailyDate);
    setIsPrintModalOpen(true);
  };


  const syncToCloud = async (newData: AppData) => {
    // VIEW-ONLY GUARD. While impersonating (any View-As: role, Test User,
    // or a specific employee) the session is a pure preview — block every
    // write so clicking around can't mutate real data. Returns false so
    // callers treat it as a failed save (no optimistic local mutation,
    // no "saved" toast). Exiting View-As re-enables writes.
    if (isViewingAs) {
      showToastMsg('View Only — exit "View As" to make changes.');
      return false;
    }
    // Defensive normalize-on-save for authorizedEmails. Firestore rules
    // compare the request token's lowercased email against the stored
    // array AS-IS, so any uppercase/whitespace entry silently denies
    // reads. Every UI write path already normalizes, but a direct edit
    // via Firebase Console (or any future write that forgets to call
    // normalizeEmail) would re-introduce drift. Re-normalizing on every
    // syncToCloud is idempotent (clean lists pass through unchanged)
    // and cheap (one map+filter+sort over a tiny array).
    const normalizedAuthEmails = Array.from(
      new Set((newData.authorizedEmails || [])
        .map(e => normalizeEmail(e))
        .filter(Boolean)),
    ).sort();
    // Bound the in-document deletion audit log so a delete (which appends a
    // record snapshot) can never push the single appData doc past
    // Firestore's 1 MiB limit. Two non-destructive levers — neither touches
    // the who/when/what summary that the audit trail relies on:
    //   1. Keep only the most recent MAX_AUDIT_ENTRIES.
    //   2. Strip oversized snapshots from heavy record types. `time_entry`
    //      snapshots are EXEMPT — TimeMaster reconstructs the deleted entry
    //      from them — but those are tiny TimeEntry objects, never the bloat.
    // Runs on every save against the in-memory object before the write, so
    // it self-heals existing bloat on the next successful sync (and lets the
    // duplicate-repair cleanup write get the doc back under the cap).
    const MAX_AUDIT_ENTRIES = 500;
    const MAX_SNAPSHOT_BYTES = 4000;
    const normalizedAuditLog = (newData.deletionAuditLog || [])
      .slice(0, MAX_AUDIT_ENTRIES)
      .map((e: any) => {
        if (!e || e.recordType === 'time_entry' || e.snapshot == null) return e;
        let tooBig = false;
        try { tooBig = JSON.stringify(e.snapshot).length > MAX_SNAPSHOT_BYTES; }
        catch { tooBig = true; }
        return tooBig ? { ...e, snapshot: { trimmed: true } } : e;
      });
    // PHASE 0 STORAGE STOPGAP — bound activityLog. TYPE-AWARE: 'completed'
    // entries are the ONLY ones any stat reads (MechanicPerformance /
    // MyMechanic labor+cost+counts, pay-chunk repair counts), so they are
    // EXEMPT from both the floor and the age trim — completion history is
    // never shortened. Non-completed types (created, status_changed, notes,
    // priority/parts toggles, deleted) are display-only churn (~74% of the
    // log): they keep a floor of the most-recent ACTIVITY_LOG_FLOOR plus
    // anything from the last 90 days, and a non-completed entry is dropped
    // only when it is BOTH beyond that floor AND older than 90 days. The
    // list is newest-first (prepended on every write). Unparseable
    // timestamps are kept (never silently delete on a bad date). Idempotent
    // and self-heals existing bloat on the next sync.
    const ACTIVITY_LOG_FLOOR = 300;
    const ACTIVITY_LOG_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
    const activityCutoffMs = Date.now() - ACTIVITY_LOG_MAX_AGE_MS;
    let nonCompletedSeen = 0;
    const normalizedActivityLog = (newData.activityLog || [])
      .filter((e: any) => {
        if (e?.type === 'completed') return true;   // stats source — never trim
        nonCompletedSeen++;
        if (nonCompletedSeen <= ACTIVITY_LOG_FLOOR) return true;  // within floor
        const t = e?.timestamp ? Date.parse(e.timestamp) : NaN;
        return Number.isNaN(t) ? true : t >= activityCutoffMs;    // else 90-day age
      });

    // PHASE 0 STORAGE STOPGAP — slim COMPLETED multi-day ledgers. Once a
    // ledger is complete its credited BH already lives in
    // performance[date][crew].jobs[].bh (the bonus source of truth); the
    // ledger is just tracking metadata. We strip the write-only / display-
    // only strings (reasonNote, markedBy, markedByName) from each
    // completionHistory entry and drop the dead `firstSeenAt` field. We
    // DELIBERATELY keep every entry and every STRUCTURAL field
    // (targetDate, crewKey, crewId, percentComplete, creditedBH, markedAt,
    // isRetroactive) plus isLawnJob, so nothing that is read regresses:
    //   - auto-move guard reads completionHistory.length > 0            ✓ (all entries kept)
    //   - re-sync short-circuit finds the entry by targetDate+crewKey
    //     then reads percentComplete + creditedBH                       ✓ (all kept)
    //   - carry-forward skips completed ledgers entirely                ✓
    //   - CompletionReviewModal save logic reads targetDate/pct/
    //     creditedBH/markedAt; job-type toggle reads isLawnJob          ✓ (all kept)
    // In-progress ledgers are left FULLY intact — they still need full
    // history for carry-forward. We do NOT collapse multi-entry histories
    // or drop ledgers (that would break the per-crew re-sync match / need
    // reader changes — out of Phase 0 scope). Idempotent + self-healing.
    const slimLedger = (j: any) => {
      if (!j || j.status !== 'complete') return j;
      const { firstSeenAt: _drop, ...rest } = j;
      return {
        ...rest,
        completionHistory: (j.completionHistory || []).map((e: any) => {
          const { reasonNote: _r, markedBy: _mb, markedByName: _mn, ...keep } = e;
          return keep;
        }),
      };
    };
    const slimMdjMap = (m: Record<string, any>) => {
      const out: Record<string, any> = {};
      for (const [k, j] of Object.entries(m || {})) out[k] = slimLedger(j);
      return out;
    };
    // Slimmed new (the live merged map with this save's change) + slimmed
    // current, used both for the optimistic local state and the
    // subcollection diff below.
    const nextMdj = slimMdjMap(newData.multiDayJobs || {});
    const prevMdj = slimMdjMap(appData.multiDayJobs || {});

    const safeData: AppData = {
      ...newData,
      authorizedEmails: normalizedAuthEmails,
      deletionAuditLog: normalizedAuditLog,
      activityLog: normalizedActivityLog,
      // Optimistic LOCAL state shows the live merged map (with the change).
      // The DOC write below substitutes the frozen doc-base instead.
      multiDayJobs: nextMdj,
    };
    // Optimistic update
    setAppData(safeData);
    if (!user) return;

    // PHASE 1 — route multiDayJobs changes to the subcollection (one doc per
    // percent-encoded jobberVisitId). Diff slimmed-new vs slimmed-current so
    // we write ONLY the ledgers this save changed; untouched ledgers (incl.
    // not-yet-migrated doc-base ones) are left to the migration script, not
    // mass-rewritten here. A subcollection failure is non-fatal — the
    // appData doc write below still runs.
    const mdjColRef = collection(db, 'artifacts', appId, 'public', 'data', 'multiDayJobs');
    const mdjEncId = (visitId: string) => encodeURIComponent(visitId);
    try {
      for (const [k, v] of Object.entries(nextMdj)) {
        if (JSON.stringify(prevMdj[k]) !== JSON.stringify(v)) {
          const cleanLedger = JSON.parse(JSON.stringify(v, (_key, val) => val === undefined ? null : val));
          await setDoc(doc(mdjColRef, mdjEncId(k)), cleanLedger);
        }
      }
      for (const k of Object.keys(prevMdj)) {
        if (!(k in nextMdj)) await deleteDoc(doc(mdjColRef, mdjEncId(k)));
      }
    } catch (err: any) {
      console.error('multiDayJobs subcollection write error:', err);
    }

    // PHASE 3 — route inspections changes to the subcollection (one doc per
    // inspection id). Diff by id: write created/changed, delete removed.
    // Every inspection is kept (DOT retention) — just relocated. Untouched
    // doc-base inspections are left to the migration script. Non-fatal.
    const inspColRef = collection(db, 'artifacts', appId, 'public', 'data', 'inspections');
    const nextInsp = newData.inspections || [];
    // Plain objects (Map is the lucide icon import here).
    const prevInspById: Record<string, Inspection> = {};
    for (const i of (appData.inspections || [])) if (i && i.id) prevInspById[i.id] = i;
    const nextInspIds: Record<string, true> = {};
    for (const i of nextInsp) if (i && i.id) nextInspIds[i.id] = true;
    try {
      for (const i of nextInsp) {
        if (!i || !i.id) continue;
        if (JSON.stringify(prevInspById[i.id]) !== JSON.stringify(i)) {
          const cleanInsp = JSON.parse(JSON.stringify(i, (_k, val) => val === undefined ? null : val));
          await setDoc(doc(inspColRef, encodeURIComponent(i.id)), cleanInsp);
        }
      }
      for (const id of Object.keys(prevInspById)) {
        if (!nextInspIds[id]) await deleteDoc(doc(inspColRef, encodeURIComponent(id)));
      }
    } catch (err: any) {
      console.error('inspections subcollection write error:', err);
    }

    // DOC write — multiDayJobs (Phase 1) and inspections (Phase 3) are
    // substituted with their FROZEN doc-base refs: pre-migration this
    // preserves the legacy in-doc copies so nothing is lost; after each
    // one-time removal pass empties that base, this writes the empty value
    // and the doc shrinks. No second code change is needed for the cutover.
    // Push Month: the DOC only ever stores the CURRENT (unpushed) month's
    // performance. Strip any date belonging to a pushed month from the doc
    // write — those live on their performanceMonths/{YYYY-MM} sheet. This
    // is idempotent and self-healing: even if a pushed month leaked into
    // the in-memory map, it can never be written back into the doc (which
    // is what kept the doc under the 1 MiB cap). Pushed months are locked,
    // so there are no legitimate edits to them to preserve here.
    const pushedSet = new Set(safeData.pushedMonths || []);
    const archivedSet = safeData.archivedDays || {};
    const docPerformance: Record<string, Record<string, PerformanceLog>> = {};
    for (const [date, dayMap] of Object.entries(safeData.performance || {})) {
      // A date lives on a sheet if its whole month was pushed OR the
      // individual day was rolling-archived — strip either from the doc.
      if (pushedSet.has(date.slice(0, 7))) continue;
      if (archivedSet[date]) continue;
      docPerformance[date] = dayMap;
    }
    // Schedules: strip any date whose month was archived to a scheduleMonths
    // sheet, so the overlaid (past-month) schedules never re-bloat the doc.
    // Current/future months are never in archivedScheduleMonths, so live
    // scheduling writes through unchanged.
    const archivedSchedSet = new Set(safeData.archivedScheduleMonths || []);
    const docSchedules: Record<string, Crew[]> = {};
    for (const [date, crews] of Object.entries(safeData.schedules || {})) {
      if (archivedSchedSet.has(date.slice(0, 7))) continue;
      docSchedules[date] = crews;
    }
    const docPayload = {
      ...safeData,
      performance: docPerformance,
      schedules: docSchedules,
      multiDayJobs: docMultiDayJobsRef.current,
      inspections: docInspectionsRef.current,
    };
    // Scrubber: Firestore does not allow 'undefined'. Convert to null or remove.
    const cleanData = JSON.parse(JSON.stringify(docPayload, (key, value) =>
      value === undefined ? null : value
    ));

    try {
      await setDoc(doc(doc(db, 'artifacts', appId), 'public', 'data', 'appData', 'main'), cleanData);
      return true;
    }
    catch (err: any) {
      console.error("Database Save Error:", err);
      showToastMsg(`Failed to save: ${err.code === 'permission-denied' ? 'Permission Denied (Rules Expired?)' : err.message}`);
      return false;
    }
  };

  // ── Sheet write/merge helper (shared by rolling archive + whole-month
  // push) ───────────────────────────────────────────────────────────────
  // MERGES `addDays` (date→crewMap) into the existing performanceMonths/{ym}
  // sheet (never overwrites prior days — a partial sheet fills gradually),
  // re-reads to VERIFY the day count, warns if the sheet nears its own
  // 1 MiB cap, then writes a belt-and-suspenders backup. Returns the merged
  // day count on success, or null on any failure (caller must then NOT
  // remove anything from the doc). The `terminal` flag stamps whole-month
  // finalization metadata.
  const cleanForFirestore = (obj: any) => JSON.parse(JSON.stringify(obj, (_k, v) => v === undefined ? null : v));
  const writeAndVerifySheet = async (
    ym: string,
    addDays: Record<string, Record<string, PerformanceLog>>,
    meta: { terminal: boolean },
  ): Promise<number | null> => {
    try {
      const sheetRef = doc(db, 'artifacts', appId, 'public', 'data', 'performanceMonths', ym);
      const existingSnap = await getDoc(sheetRef);
      const existingDays: Record<string, Record<string, PerformanceLog>> =
        existingSnap.exists() ? ((existingSnap.data() as any)?.days || {}) : {};
      const existingMeta = existingSnap.exists() ? (existingSnap.data() as any) : {};
      // Merge — new days added, existing days preserved (never overwritten
      // wholesale; a re-archive of the same date is a harmless no-op copy).
      const mergedDays = { ...existingDays, ...addDays };
      const mergedCount = Object.keys(mergedDays).length;
      const expected = Object.keys(existingDays).length
        + Object.keys(addDays).filter(d => !(d in existingDays)).length;
      const payload: any = {
        ...existingMeta,
        month: ym,
        days: mergedDays,
        dayCount: mergedCount,
        lastArchivedAt: Date.now(),
        lastArchivedBy: displayEmail,
      };
      if (meta.terminal) {
        payload.pushedAt = Date.now();
        payload.pushedBy = displayEmail;
        payload.pushedByName = displayName;
      }
      const cleaned = cleanForFirestore(payload);
      // Sheet-size watch — month sheets are themselves 1 MiB-capped docs.
      const bytes = JSON.stringify(cleaned).length;
      if (bytes > SHEET_SIZE_WARN_BYTES) {
        console.warn(`[month-sheet] ${ym} sheet is ${(bytes / 1024).toFixed(0)} KB — approaching the 1 MiB cap.`);
        showToastMsg(`⚠️ ${ym} month sheet is ${(bytes / 1024).toFixed(0)} KB — nearing its 1 MiB limit. Flag for follow-up.`);
      }
      await setDoc(sheetRef, cleaned);
      // VERIFY — re-read; the persisted day count must match the merge.
      const check = await getDoc(sheetRef);
      const got = check.exists() ? Object.keys((check.data() as any)?.days || {}).length : -1;
      if (got !== expected) {
        console.error(`[month-sheet] ${ym} verify failed: got ${got}, expected ${expected}. No removal.`);
        return null;
      }
      // BACKUP — separate collection the overlay never reads, before removal.
      await setDoc(
        doc(db, 'artifacts', appId, 'public', 'data', 'performanceMonthsBackup', `${ym}-${Date.now()}`),
        cleaned,
      );
      return got;
    } catch (err: any) {
      console.error(`[month-sheet] ${ym} write/verify/backup failed:`, err);
      return null;
    }
  };

  // NOTE: rolling/catch-up archiving + auto-finalize now run SERVER-SIDE in
  // the scheduled sync (functions/src/jobber/archive.ts) so the doc is kept
  // lean on the server clock without an admin opening the board. The manual
  // "Push Month" button (pushMonth) and admin Unlock (unlockDay) below remain
  // for on-demand control.

  // ── Unlock (reverse a day's archive) ──────────────────────────────────
  // Admin-only, per-day. Copies the day back from its month sheet into the
  // main doc, removes it from the sheet, and stamps unlockedDays so the
  // rolling scan can't immediately re-archive it (race guard). The day
  // returns to normal approval-locking — an admin un-approves a crew-day to
  // edit it. Handles both rolling-archived days (archivedDays) and days in a
  // finalized month (downgrades that month out of pushedMonths, keeping its
  // other days archived).
  const unlockDay = async (date: string): Promise<boolean> => {
    if (isViewingAs) { showToastMsg('View Only — exit "View As" to make changes.'); return false; }
    if (!isAdmin) { showToastMsg(PERMISSION_DENIED); return false; }
    const ym = monthOfDate(date);
    const inArchived = !!(appData.archivedDays || {})[date];
    const inPushedMonth = (appData.pushedMonths || []).includes(ym);
    if (!inArchived && !inPushedMonth) { showToastMsg('That day is not archived.'); return false; }
    try {
      const sheetRef = doc(db, 'artifacts', appId, 'public', 'data', 'performanceMonths', ym);
      const snap = await getDoc(sheetRef);
      const sheetDays: Record<string, Record<string, PerformanceLog>> =
        snap.exists() ? ((snap.data() as any)?.days || {}) : {};
      const dayData = sheetDays[date] || (appData.performance || {})[date];
      if (!dayData) { showToastMsg(`No sheet data found for ${date}.`); return false; }
      // Remove the day from the sheet (keep the rest); re-verify.
      const remaining = { ...sheetDays };
      delete remaining[date];
      const existingMeta = snap.exists() ? (snap.data() as any) : {};
      await setDoc(sheetRef, cleanForFirestore({ ...existingMeta, month: ym, days: remaining, dayCount: Object.keys(remaining).length }));
      const check = await getDoc(sheetRef);
      const got = check.exists() ? Object.keys((check.data() as any)?.days || {}).length : -1;
      if (got !== Object.keys(remaining).length) {
        showToastMsg(`Unlock aborted — sheet re-verify failed for ${date}. No changes.`);
        return false;
      }
      // Restore the day into the doc + clear markers + set the race guard.
      const nextArchived = { ...(appData.archivedDays || {}) };
      delete nextArchived[date];
      let nextPushed = appData.pushedMonths || [];
      if (inPushedMonth) {
        // Downgrade the finalized month: it's no longer wholly on the sheet.
        // Its OTHER days stay archived (added to archivedDays) so they remain
        // stripped from the doc; only this day returns.
        nextPushed = nextPushed.filter(m => m !== ym);
        const now = Date.now();
        for (const d of Object.keys(remaining)) {
          if (monthOfDate(d) === ym) nextArchived[d] = now;
        }
      }
      const nextUnlocked = { ...(appData.unlockedDays || {}), [date]: Date.now() };
      const nextPerf = { ...(appData.performance || {}), [date]: dayData };
      const ok = await syncToCloud({
        ...appData,
        performance: nextPerf,
        pushedMonths: nextPushed,
        archivedDays: nextArchived,
        unlockedDays: nextUnlocked,
      });
      if (ok === false) { showToastMsg('Unlock failed on the doc write — retry.'); return false; }
      logPerfActivity({
        type: 'performance_day_unlocked',
        targetDate: formatTodayInToronto(),
        crewId: 'performance-day',
        crewLabel: date,
        userId: user?.uid || displayEmail,
        userName: displayName,
        userRole: effectiveRole,
        valueLabel: 'day',
        reasonNote: `Unlocked ${date} — copied back to the doc for editing. Auto-archive suppressed for 72h or until re-settled. Un-approve the crew-day(s) to edit.`,
      });
      showToastMsg(`Unlocked ${date} — editable again (un-approve the crew-day to edit). Won't re-archive for 72h.`);
      return true;
    } catch (err: any) {
      console.error('[unlock-day] failed:', err);
      showToastMsg(`Unlock failed for ${date}: ${err?.message || String(err)}.`);
      return false;
    }
  };

  // ── Push Month ──────────────────────────────────────────────────────
  // MOVE a completed month out of the 1 MiB-capped appData doc into its own
  // performanceMonths/{YYYY-MM} sheet. Gated copy → verify → backup →
  // remove, so NO DATA IS EVER DELETED: the remove (via syncToCloud's
  // write-strip) only runs after the sheet is written AND re-read to
  // confirm it landed. Returns true on success. Admin-only. Refuses the
  // current month and any month with unsettled (non-approved/waived)
  // crew-days. MERGES with a partially-filled sheet (rolling archive may
  // already have moved some of the month's days) — never overwrites it.
  const pushMonth = async (ym: string, opts?: { auto?: boolean }): Promise<boolean> => {
    if (isViewingAs) { if (!opts?.auto) showToastMsg('View Only — exit "View As" to make changes.'); return false; }
    if (!isAdmin) { if (!opts?.auto) showToastMsg(PERMISSION_DENIED); return false; }
    if ((appData.pushedMonths || []).includes(ym)) {
      if (!opts?.auto) showToastMsg(`${ym} is already on its own sheet.`);
      return false;
    }
    // Never push the current (in-progress) month — it must stay in the doc.
    if (ym >= monthOfDate(formatTodayInToronto())) {
      if (!opts?.auto) showToastMsg('Cannot push the current month — it is still in progress.');
      return false;
    }
    // Settlement guard: every crew-day must be approved or waived.
    const settle = monthSettlementStatus(appData.performance || {}, ym);
    if (settle.dayCount === 0) {
      if (!opts?.auto) showToastMsg(`No performance data for ${ym}.`);
      return false;
    }
    if (!settle.settled) {
      if (!opts?.auto) {
        const sample = settle.blocking.slice(0, 3).map(b => `${b.date} ${b.crewLabel} (${b.status})`).join(', ');
        showToastMsg(`Can't push ${ym}: ${settle.blocking.length} unsettled crew-day${settle.blocking.length === 1 ? '' : 's'} — ${sample}${settle.blocking.length > 3 ? '…' : ''}. Approve or waive them first.`);
      }
      return false;
    }

    // Days still in the DOC for this month — rolling archive may already
    // have moved the rest onto the sheet. We MERGE only these into the
    // (possibly partial) sheet; already-archived days stay put, never
    // overwritten, never a failure.
    const inDocDays = extractMonth(docPerformanceRef.current || {}, ym);
    const inDocCount = Object.keys(inDocDays).length;
    const alreadyArchivedForYm = Object.keys(appData.archivedDays || {})
      .filter(d => monthOfDate(d) === ym).length;
    // MERGE → VERIFY → BACKUP, stamping terminal (finalized) metadata.
    const mergedCount = await writeAndVerifySheet(ym, inDocDays, { terminal: true });
    if (mergedCount === null) {
      if (!opts?.auto) showToastMsg(`Push aborted — sheet write/verify failed for ${ym}. No data removed.`);
      return false;
    }
    // The finalized sheet must hold EVERY day of the month:
    // in-doc remaining + already-rolling-archived.
    const expectedTotal = inDocCount + alreadyArchivedForYm;
    if (mergedCount !== expectedTotal) {
      showToastMsg(`Push aborted — ${ym} day-count mismatch (sheet ${mergedCount}, expected ${expectedTotal}). No data removed.`);
      return false;
    }
    // REMOVE — mark the month terminal in pushedMonths; collapse its per-day
    // archived markers into the month marker; the write-strip drops all of
    // ym's dates from the doc.
    const nextPushed = [...(appData.pushedMonths || []), ym].sort();
    const nextArchived = { ...(appData.archivedDays || {}) };
    for (const d of Object.keys(nextArchived)) if (monthOfDate(d) === ym) delete nextArchived[d];
    const ok = await syncToCloud({ ...appData, pushedMonths: nextPushed, archivedDays: nextArchived });
    if (ok === false) {
      // The sheet + backup remain (idempotent — a retry re-merges). Nothing removed.
      showToastMsg(`Push wrote the ${ym} sheet but the doc update failed — nothing removed, safe to retry.`);
      return false;
    }
    logPerfActivity({
      type: 'performance_month_pushed',
      targetDate: formatTodayInToronto(),
      crewId: 'performance-month',
      crewLabel: ym,
      userId: user?.uid || displayEmail,
      userName: displayName,
      userRole: effectiveRole,
      valueLabel: 'crew-days',
      valueAfter: settle.crewDayCount,
      reasonNote: `${opts?.auto ? 'Auto-pushed' : 'Pushed'} ${ym} → sheet (${mergedCount} day${mergedCount === 1 ? '' : 's'}: ${inDocCount} merged from doc + ${alreadyArchivedForYm} already-archived; ${settle.crewDayCount} crew-days). Finalized/locked; full detail on performanceMonths/${ym}.`,
    });
    // Trends: auto-generate the finalized month's summary (bonus basis, via
    // the shared buildMtd/buildDivisionMtd). READ-ONLY w.r.t. performance —
    // writes only the monthlySummaries doc. Idempotent (overwrites cleanly).
    // Non-fatal: a summary hiccup must never fail the finalize.
    try {
      const summary = buildMonthlySummary(
        ym, appData.performance || {}, appData.schedules || {}, appData.employees || [], appData.settings,
        { generatedBy: displayEmail, finalized: true, now: Date.now() },
      );
      await setDoc(
        doc(db, 'artifacts', appId, 'public', 'data', 'monthlySummaries', ym),
        cleanForFirestore(summary),
      );
    } catch (err) {
      console.error('[push-month] monthly summary write failed (non-fatal):', err);
    }
    if (!opts?.auto) showToastMsg(`Pushed ${ym} — ${mergedCount} days on its sheet, doc shrunk.`);
    return true;
  };

  // TRENDS SUMMARY BACKFILL. Server-side auto-finalize (archive.ts) moves a
  // completed month to pushedMonths but does NOT compute its Trends summary —
  // that math (buildMtd/buildDivisionMtd) lives only here, so we never risk a
  // server/client drift in pay numbers. This effect generates + writes the
  // monthlySummaries doc for any pushed month that lacks one. Idempotent,
  // once per session, non-viewing sessions only (needs write access). Not
  // doc-size-critical (summaries are their own subcollection).
  const summaryBackfillRanRef = useRef(false);
  useEffect(() => {
    if (!user || loading || isViewingAs) return;
    if (summaryBackfillRanRef.current) return;
    if (!dataLoaded) return;
    summaryBackfillRanRef.current = true;
    const existing = subMonthlySummariesRef.current || {};
    const missing = (appData.pushedMonths || []).filter(ym => !existing[ym]);
    if (missing.length === 0) return;
    (async () => {
      for (const ym of missing) {
        try {
          const summary = buildMonthlySummary(
            ym, appData.performance || {}, appData.schedules || {}, appData.employees || [], appData.settings,
            { generatedBy: `backfill:${displayEmail}`, finalized: true, now: Date.now() },
          );
          const clean = (obj: any) => JSON.parse(JSON.stringify(obj, (_k, v) => v === undefined ? null : v));
          // eslint-disable-next-line no-await-in-loop
          await setDoc(
            doc(db, 'artifacts', appId, 'public', 'data', 'monthlySummaries', ym),
            clean(summary),
          );
        } catch (err) {
          console.error(`[trends] summary backfill failed for ${ym}:`, err);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, dataLoaded, isViewingAs, appData.pushedMonths]);

  // ── RoleMaster handlers ─────────────────────────────────────────────
  // Roles/duties/instances live in their own subcollections; these write
  // directly (like the month sheets), never touching the appData doc.
  const roleColl = (name: string) => collection(db, 'artifacts', appId, 'public', 'data', name);
  const cleanRM = (o: any) => JSON.parse(JSON.stringify(o, (_k, v) => v === undefined ? null : v));
  const saveRoleMasterRole = async (r: RoleMasterRole) => {
    if (!isAdmin) { showToastMsg(PERMISSION_DENIED); return; }
    await setDoc(doc(roleColl('roleMasterRoles'), r.id), cleanRM({ ...r, createdBy: r.createdBy || { email: displayEmail, name: displayName } }));
    showToastMsg('Role saved.');
  };
  const saveRoleMasterDuty = async (d: RoleMasterDuty) => {
    if (!isAdmin) { showToastMsg(PERMISSION_DENIED); return; }
    await setDoc(doc(roleColl('roleMasterDuties'), d.id), cleanRM(d));
    // New category → auto-assign the next unused palette color (bounded map
    // in settings; persisted only when the category isn't mapped yet).
    const cat = (d.category || '').trim();
    const map = appData.settings?.roleMasterCategoryColors || {};
    if (cat && !map[cat]) {
      await syncToCloud({ ...appData, settings: { ...(appData.settings || {}), roleMasterCategoryColors: { ...map, [cat]: nextUnusedColorKey(map) } } });
    }
    showToastMsg('Duty saved.');
  };
  const setRoleCategoryColor = async (category: string, colorKey: string) => {
    if (!isAdmin) { showToastMsg(PERMISSION_DENIED); return; }
    const map = appData.settings?.roleMasterCategoryColors || {};
    await syncToCloud({ ...appData, settings: { ...(appData.settings || {}), roleMasterCategoryColors: { ...map, [category]: colorKey } } });
  };
  const saveRoleMasterResponsibility = async (r: RoleMasterResponsibility) => {
    if (!isAdmin) { showToastMsg(PERMISSION_DENIED); return; }
    await setDoc(doc(roleColl('roleMasterResponsibilities'), r.id), cleanRM({ ...r, createdBy: r.createdBy || { email: displayEmail, name: displayName } }));
    showToastMsg('Responsibility saved.');
  };
  // Library — Templates (admin + managers edit; admin deletes) and Policies
  // (admin-only). Own subcollections; never in the main doc.
  const saveRoleMasterTemplate = async (t: RoleMasterTemplate) => {
    if (!isManager) { showToastMsg(PERMISSION_DENIED); return; }
    await setDoc(doc(roleColl('roleMasterTemplates'), t.id), cleanRM({ ...t, createdBy: t.createdBy || { email: displayEmail, name: displayName }, updatedBy: { email: displayEmail, name: displayName }, updatedAt: Date.now() }));
    showToastMsg('Template saved.');
  };
  const deleteRoleMasterTemplate = async (id: string) => {
    if (!isAdmin) { showToastMsg(PERMISSION_DENIED); return; }
    await deleteDoc(doc(roleColl('roleMasterTemplates'), id));
    showToastMsg('Template deleted.');
  };
  const saveRoleMasterPolicy = async (p: RoleMasterPolicy) => {
    if (!isAdmin) { showToastMsg(PERMISSION_DENIED); return; }
    await setDoc(doc(roleColl('roleMasterPolicies'), p.id), cleanRM({ ...p, createdBy: p.createdBy || { email: displayEmail, name: displayName }, updatedBy: { email: displayEmail, name: displayName }, updatedAt: Date.now() }));
    showToastMsg('Policy saved.');
  };
  const deleteRoleMasterPolicy = async (id: string) => {
    if (!isAdmin) { showToastMsg(PERMISSION_DENIED); return; }
    await deleteDoc(doc(roleColl('roleMasterPolicies'), id));
    showToastMsg('Policy deleted.');
  };
  // Policy change requests — managers + admins create/edit-own-open; admin
  // resolves. Never deleted (input record). Own subcollection.
  const reqCreatorId = () => displayEmail.toLowerCase();
  const saveRoleMasterPolicyRequest = async (id: string, policyId: string, text: string) => {
    if (!isManager) { showToastMsg(PERMISSION_DENIED); return; }
    const existing = appData.roleMasterPolicyRequests?.[id];
    if (existing) {
      // Edit allowed only by the creator while still OPEN.
      if (existing.status !== 'open' || (existing.createdBy?.id || '') !== reqCreatorId()) { showToastMsg(PERMISSION_DENIED); return; }
      await setDoc(doc(roleColl('roleMasterPolicyRequests'), id), cleanRM({ ...existing, text }));
      showToastMsg('Request updated.');
      return;
    }
    const rec: RoleMasterPolicyRequest = {
      id, policyId, text,
      createdBy: { id: reqCreatorId(), name: displayName },
      createdAt: Date.now(), status: 'open',
    };
    await setDoc(doc(roleColl('roleMasterPolicyRequests'), id), cleanRM(rec));
    showToastMsg('Change request submitted.');
  };
  const resolveRoleMasterPolicyRequest = async (id: string, note: string) => {
    if (!isAdmin) { showToastMsg(PERMISSION_DENIED); return; }
    const existing = appData.roleMasterPolicyRequests?.[id];
    if (!existing) return;
    await setDoc(doc(roleColl('roleMasterPolicyRequests'), id), cleanRM({
      ...existing, status: 'resolved',
      resolvedBy: { id: reqCreatorId(), name: displayName },
      resolvedAt: Date.now(), resolutionNote: note.trim() || undefined,
    }));
    showToastMsg('Request resolved.');
  };
  // SalesMaster rates — bounded, admin-only, stored in the settings doc.
  const saveSalesRates = async (r: import('./types').SalesRates) => {
    if (!isAdmin) { showToastMsg(PERMISSION_DENIED); return; }
    await syncToCloud({ ...appData, settings: { ...(appData.settings || {}), salesMaster: r } });
    showToastMsg('Rates saved.');
  };
  // SalesMaster saved quotes — own subcollection (grows). Admin + manager
  // create/edit (working documents, charge-side + BH only — no cost data).
  // Delete: admin OR the quote's creator.
  const saveSalesQuote = async (q: SalesQuote) => {
    if (!isManager) { showToastMsg(PERMISSION_DENIED); return; }
    const existing = appData.salesMasterQuotes?.[q.id];
    const now = Date.now();
    const rec: SalesQuote = {
      ...q,
      createdBy: existing?.createdBy || q.createdBy || { email: displayEmail, name: displayName },
      createdAt: existing?.createdAt || q.createdAt || now,
      updatedBy: { email: displayEmail, name: displayName },
      updatedAt: now,
    };
    await setDoc(doc(roleColl('salesMasterQuotes'), q.id), cleanRM(rec));
    showToastMsg('Quote saved.');
  };
  const deleteSalesQuote = async (id: string) => {
    const q = appData.salesMasterQuotes?.[id];
    const isCreator = (q?.createdBy?.email || '').toLowerCase() === displayEmail.toLowerCase();
    if (!isAdmin && !isCreator) { showToastMsg(PERMISSION_DENIED); return; }
    await deleteDoc(doc(roleColl('salesMasterQuotes'), id));
    showToastMsg('Quote deleted.');
  };
  const setRoleMasterMaster = async (enabled: boolean) => {
    if (!isAdmin) { showToastMsg(PERMISSION_DENIED); return; }
    await syncToCloud({ ...appData, settings: { ...(appData.settings || {}), roleMasterGenerationEnabled: enabled } });
    showToastMsg(enabled ? 'Duty generation ON.' : 'Duty generation OFF.');
  };

  // ── ContractingMaster (Palermo's) handlers ─────────────────────────────
  // A separate tenant: writes ONLY to contracting-namespaced subcollections,
  // never appData performance/BH/bonus/pay. Manage actions require
  // canManageContracting (admin or Tony); clocking + work orders + shopping
  // are open to any contractor.
  const contractingUser = { id: currentUserEmployee?.id || displayEmail, name: displayName };
  // Contractor clock-in/out (minimal surface in the portal). Punches land in
  // the SAME payroll time data (appData.timeEntries) — contractors appear in
  // Dave's TimeMaster period views. No hours review / periods here.
  const myActivePunch: TimeEntry | null = (appData.timeEntries || []).find(e => e.userEmail === displayEmail && !e.clockOut) || null;
  const myTodayPunches: TimeEntry[] = (appData.timeEntries || []).filter(e => e.userEmail === displayEmail && new Date(e.clockIn).toDateString() === new Date().toDateString()).sort((a, b) => new Date(b.clockIn).getTime() - new Date(a.clockIn).getTime());
  const contractorClockIn = () => {
    const ne: TimeEntry = { id: `time-${Date.now()}`, userEmail: displayEmail, userName: displayName, clockIn: new Date().toISOString(), notes: [] };
    syncToCloud({ ...appData, timeEntries: [ne, ...(appData.timeEntries || [])] });
    showToastMsg('Clocked in.');
  };
  const contractorClockOut = () => {
    if (!myActivePunch) return;
    syncToCloud({ ...appData, timeEntries: (appData.timeEntries || []).map(e => e.id === myActivePunch.id ? { ...e, clockOut: new Date().toISOString() } : e) });
    showToastMsg('Clocked out.');
  };
  // Contractor home HOURS cards — the pay-period lens over THEIR OWN punches
  // (hours only, never rates/pay). Display-only read of the payroll data.
  const contractorHours = (() => {
    const cfg = payPeriodSettings(appData.settings);
    const nowMs = Date.now();
    const cur = currentPayPeriod(cfg, nowMs);
    const prev = previousPayPeriod(cfg, nowMs);
    const mine = (appData.timeEntries || []).filter(e => e.userEmail === displayEmail);
    const sum = (s: number, e: number) => mine.reduce((acc, x) => {
      const t = new Date(x.clockIn).getTime();
      if (t < s || t > e) return acc;
      const out = x.clockOut ? new Date(x.clockOut).getTime() : nowMs;
      return acc + Math.max(0, (out - t) / 3600000);
    }, 0);
    return {
      last: { rangeLabel: periodRangeLabel(prev), payDate: payDateLabel(prev), hours: sum(prev.startMs, prev.endMs) },
      current: { rangeLabel: periodRangeLabel(cur), payDate: payDateLabel(cur), hours: sum(cur.startMs, cur.endMs) },
    };
  })();
  const contractingRates: ContractingRateCard = contractingRatesOrDefault(appData.settings?.contractingRates);
  const contractingSuppliers: ContractingSupplier[] = suppliersOrDefault(appData.settings?.contractingSuppliers);
  const contractingNoticeDays = noticeDaysOrDefault(appData.settings);
  // Property management (v2). Prefer the subcollection docs (full hierarchy);
  // fall back to the legacy settings list (each given a default unit) until the
  // one-time migration seeds the subcollection.
  const propertyDocs = Object.values(appData.contractingPropertyDocs || {});
  const contractingProperties: ContractingProperty[] = propertyDocs.length
    ? propertyDocs
    : propertiesOrDefault(appData.settings?.contractingProperties).map(p => ({ ...p, units: [{ id: `def-unit-${p.id}`, name: 'Whole property' }] }));
  // Property management is admin + contracting manager (Tony) + property
  // manager (Linda). Contractors NEVER manage or see tenant/lease data.
  const isPropertyManager = effectiveRole === 'property_manager';
  const canManageProperties = canManageContracting || isPropertyManager;
  const saveContractingRates = async (r: ContractingRateCard) => {
    if (!canManageContracting) { showToastMsg(PERMISSION_DENIED); return; }
    await syncToCloud({ ...appData, settings: { ...(appData.settings || {}), contractingRates: r } });
    showToastMsg('Rate card saved.');
  };
  const saveContractingPropertyDoc = async (p: ContractingProperty) => {
    if (!canManageProperties) { showToastMsg(PERMISSION_DENIED); return; }
    await setDoc(doc(roleColl('contractingPropertyDocs'), p.id), cleanRM(p));
  };
  const deleteContractingPropertyDoc = async (id: string) => {
    if (!canManageProperties) { showToastMsg(PERMISSION_DENIED); return; }
    const p = subContractingPropertyDocsRef.current[id];
    await deleteDoc(doc(roleColl('contractingPropertyDocs'), id));
    await appendContractingAudit('property.delete', `${p?.name || id}`);
    showToastMsg('Property deleted.');
  };
  const saveContractingSuppliers = async (list: ContractingSupplier[]) => {
    if (!canManageContracting) { showToastMsg(PERMISSION_DENIED); return; }
    await syncToCloud({ ...appData, settings: { ...(appData.settings || {}), contractingSuppliers: list } });
  };
  const saveContractingProject = async (p: ContractingProject) => {
    if (!canManageContracting) { showToastMsg(PERMISSION_DENIED); return; }
    await setDoc(doc(roleColl('contractingProjects'), p.id), cleanRM(p));
  };
  // Bounded audit trail for project delete/archive/restore (settings doc).
  const appendContractingAudit = async (action: string, detail: string) => {
    const prev = appData.settings?.contractingAuditLog || [];
    const next = [...prev, { action, detail, by: displayName, at: Date.now() }].slice(-200);
    await syncToCloud({ ...appData, settings: { ...(appData.settings || {}), contractingAuditLog: next } });
  };
  // Delete a project — ONLY when nothing is attached (guard mirrors phase
  // removal). Anything attached must be archived instead. Confirm-gated at the
  // UI; audited here.
  const deleteContractingProject = async (id: string) => {
    if (!canManageContracting) { showToastMsg(PERMISSION_DENIED); return; }
    const proj = subContractingProjectsRef.current[id];
    const removable = projectIsRemovable(id, Object.values(subContractingInvoicesRef.current), Object.values(subContractingProgressReportsRef.current), Object.values(subContractingTimeEntriesRef.current));
    if (!removable) { showToastMsg('Project has attached billing/time — archive it instead.'); return; }
    await appendContractingAudit('project.delete', `${proj?.name || id}`);
    await deleteDoc(doc(roleColl('contractingProjects'), id));
    showToastMsg('Project deleted.');
  };
  // Merge one phase INTO another (generalizable): re-points every invoice,
  // report, and time entry from source → target, folds source's checklist /
  // notes / (fixed) price into target, drops source. Snapshots stay frozen —
  // only the phaseId reference moves. Guarded + audited.
  const mergeContractingPhases = async (projectId: string, sourceId: string, targetId: string, mergedName?: string) => {
    if (!canManageContracting) { showToastMsg(PERMISSION_DENIED); return; }
    const project = subContractingProjectsRef.current[projectId];
    if (!project) return;
    const plan = planPhaseMerge(
      project, sourceId, targetId, mergedName,
      Object.values(subContractingInvoicesRef.current),
      Object.values(subContractingProgressReportsRef.current),
      Object.values(subContractingTimeEntriesRef.current),
    );
    if (plan.error || !plan.mergedProject) { showToastMsg(plan.error || 'Cannot merge.'); return; }
    const now = Date.now();
    for (const id of plan.invoiceIds) await setDoc(doc(roleColl('contractingInvoices'), id), cleanRM({ phaseId: targetId }), { merge: true } as any);
    for (const id of plan.reportIds) await setDoc(doc(roleColl('contractingProgressReports'), id), cleanRM({ phaseId: targetId }), { merge: true } as any);
    for (const id of plan.timeEntryIds) await setDoc(doc(roleColl('contractingTimeEntries'), id), cleanRM({ phaseId: targetId }), { merge: true } as any);
    // Fold-in survivor (absorbs discarded open reports' receipts + manual time)
    // then delete the folded-away duplicates → exactly one open report.
    if (plan.keptReport) await setDoc(doc(roleColl('contractingProgressReports'), plan.keptReport.id), cleanRM({ ...plan.keptReport, updatedAt: now }));
    for (const id of plan.deleteReportIds) await deleteDoc(doc(roleColl('contractingProgressReports'), id));
    await setDoc(doc(roleColl('contractingProjects'), projectId), cleanRM({ ...plan.mergedProject, updatedAt: now }));
    await appendContractingAudit('phase.merge', `${project.name}: "${plan.sourceName}" → "${plan.targetName}" (re-pointed ${plan.invoiceIds.length} inv / ${plan.reportIds.length} rpt / ${plan.timeEntryIds.length} time)`);
    showToastMsg('Phases merged.');
  };
  // Archive / restore a project (reversible; data intact). Audited.
  const archiveContractingProject = async (id: string, archived: boolean) => {
    if (!canManageContracting) { showToastMsg(PERMISSION_DENIED); return; }
    const proj = subContractingProjectsRef.current[id];
    if (!proj) return;
    await setDoc(doc(roleColl('contractingProjects'), id), cleanRM({ ...proj, archived, archivedBy: archived ? displayName : undefined, archivedAt: archived ? Date.now() : undefined, updatedAt: Date.now() }));
    await appendContractingAudit(archived ? 'project.archive' : 'project.restore', `${proj.name}`);
    showToastMsg(archived ? 'Project archived.' : 'Project restored.');
  };
  const saveContractingReport = async (r: ContractingProgressReport) => {
    if (!canManageContracting) { showToastMsg(PERMISSION_DENIED); return; }
    await setDoc(doc(roleColl('contractingProgressReports'), r.id), cleanRM(r));
  };
  // Open the first/next billing period for a T&M phase. Start at the previous
  // report's endAt, else the phase's tmStartAt, else now — no gaps/overlaps.
  const openContractingReport = async (projectId: string, phaseId: string, startAtOverride?: number) => {
    if (!canManageContracting) { showToastMsg(PERMISSION_DENIED); return; }
    const all = Object.values(subContractingProgressReportsRef.current);
    if (all.some(r => r.projectId === projectId && r.phaseId === phaseId && r.status === 'open')) { showToastMsg('A billing period is already open.'); return; }
    const prior = all.filter(r => r.projectId === projectId && r.phaseId === phaseId);
    const lastEnd = prior.reduce((m, r) => Math.max(m, r.endAt || 0), 0);
    const phase = subContractingProjectsRef.current[projectId]?.phases.find(ph => ph.id === phaseId);
    const startAt = startAtOverride || lastEnd || phase?.tmStartAt || Date.now();
    const reportNumber = prior.reduce((m, r) => Math.max(m, r.reportNumber), 0) + 1;
    const rep: ContractingProgressReport = { id: `crep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, projectId, phaseId, startAt, status: 'open', reportNumber, receipts: [], manualTime: [], createdAt: Date.now(), updatedAt: Date.now() };
    await setDoc(doc(roleColl('contractingProgressReports'), rep.id), cleanRM(rep));
    showToastMsg('Billing period opened.');
  };
  // Close-without-invoicing (discard) an open report. Empty → delete outright;
  // if it holds materials or manual lines, require clearing them first (the
  // open-report workbench makes that trivial) — nothing is silently destroyed.
  const discardContractingReport = async (reportId: string) => {
    if (!canManageContracting) { showToastMsg(PERMISSION_DENIED); return; }
    const report = subContractingProgressReportsRef.current[reportId];
    if (!report || report.status !== 'open') { showToastMsg('Report not open.'); return; }
    if ((report.receipts || []).length || (report.manualTime || []).length) { showToastMsg('Clear this period’s material and hours lines first, then discard.'); return; }
    await deleteDoc(doc(roleColl('contractingProgressReports'), reportId));
    await appendContractingAudit('report.discard', `Report #${report.reportNumber} closed without invoicing (empty)`);
    showToastMsg('Period discarded.');
  };
  // Light-touch edit log for open-report workbench actions (who/what/when).
  const logContractingEdit = async (detail: string) => {
    if (!canManageContracting) return;
    await appendContractingAudit('report.edit', detail);
  };
  // End an open report: snapshot the lines, mint the sequential PROG invoice,
  // mark attached time invoiced, then auto-open the next period. All within
  // the contracting namespace.
  const endContractingReport = async (reportId: string) => {
    if (!canManageContracting) { showToastMsg(PERMISSION_DENIED); return; }
    const report = subContractingProgressReportsRef.current[reportId];
    if (!report || report.status !== 'open') { showToastMsg('Report not open.'); return; }
    const now = Date.now();
    const ended: ContractingProgressReport = { ...report, endAt: now };
    // Labour = the report's batch "+ Add hours" lines (manual). Contracting
    // clock-in was removed in v1.8 — nothing to auto-attach or freeze.
    const labour = labourForReport(ended);
    const snapshot = computeReportTotals(labour, report.receipts, contractingRates, rateMapFor(appData.employees || [], contractingRates));
    const number = nextProgNumber(Object.values(subContractingInvoicesRef.current));
    const project = subContractingProjectsRef.current[report.projectId];
    const phase = project?.phases.find(ph => ph.id === report.phaseId);
    const invoice: ContractingInvoice = {
      id: `cinv-${now}-${Math.random().toString(36).slice(2, 6)}`, number, projectId: report.projectId, phaseId: report.phaseId, kind: 'tm',
      periodStart: report.startAt, periodEnd: now, amountPreHst: snapshot.subtotalPreHst, hst: snapshot.hst, total: snapshot.total,
      reportId: report.id, scopeDescription: phase ? `${phase.name} — labour and materials, ${new Date(report.startAt).toLocaleDateString('en-CA')} to ${new Date(now).toLocaleDateString('en-CA')}.` : undefined,
      // Minted but not yet sent — awaits a "Mark sent" tap; due reckons from
      // period end (= now) until then.
      issuedAt: now, dueAt: now + 14 * 86400000, awaitingSend: true, paid: false, createdBy: contractingUser, createdAt: now,
    };
    // Persist: frozen report + minted invoice, then auto-open the next period.
    await setDoc(doc(roleColl('contractingProgressReports'), report.id), cleanRM({ ...ended, status: 'invoiced', snapshot, updatedAt: now }));
    await setDoc(doc(roleColl('contractingInvoices'), invoice.id), cleanRM(invoice));
    const nextNo = report.reportNumber + 1;
    const next: ContractingProgressReport = { id: `crep-${now}-${Math.random().toString(36).slice(2, 6)}`, projectId: report.projectId, phaseId: report.phaseId, startAt: now, status: 'open', reportNumber: nextNo, receipts: [], manualTime: [], createdAt: now, updatedAt: now };
    await setDoc(doc(roleColl('contractingProgressReports'), next.id), cleanRM(next));
    showToastMsg(`Invoice ${number} minted · ${next ? 'next period open' : ''}`);
  };
  const saveContractingInvoice = async (inv: ContractingInvoice) => {
    if (!canManageContracting) { showToastMsg(PERMISSION_DENIED); return; }
    await setDoc(doc(roleColl('contractingInvoices'), inv.id), cleanRM(inv));
  };
  // VOID an invoice (never hard-delete): it contributes zero to every total
  // and is hidden from default views, surviving as an accounted stub so PROG
  // numbering stays sequential. Voiding RELEASES the backing report's lines
  // back to billable — the report reopens (or, if the phase already has an open
  // period, its labour + materials fold into that one) so the work re-invoices.
  const voidContractingInvoice = async (id: string, reason: string) => {
    if (!canManageContracting) { showToastMsg(PERMISSION_DENIED); return; }
    const inv = subContractingInvoicesRef.current[id];
    if (!inv || inv.voided) return;
    const now = Date.now();
    if (inv.reportId) {
      const R = subContractingProgressReportsRef.current[inv.reportId];
      if (R) {
        const otherOpen = Object.values(subContractingProgressReportsRef.current).find(r => r.id !== R.id && r.projectId === R.projectId && r.phaseId === R.phaseId && r.status === 'open');
        if (otherOpen) {
          // Fold the voided report's lines into the existing open period, drop R.
          await setDoc(doc(roleColl('contractingProgressReports'), otherOpen.id), cleanRM({ ...otherOpen, manualTime: [...(otherOpen.manualTime || []), ...(R.manualTime || [])], receipts: [...(otherOpen.receipts || []), ...(R.receipts || [])], updatedAt: now }));
          await deleteDoc(doc(roleColl('contractingProgressReports'), R.id));
        } else {
          // Reopen the backing report → its lines are billable again.
          await setDoc(doc(roleColl('contractingProgressReports'), R.id), cleanRM({ ...R, status: 'open', endAt: null, snapshot: null, updatedAt: now }));
        }
      }
    }
    await setDoc(doc(roleColl('contractingInvoices'), id), cleanRM({ ...inv, voided: true, voidReason: reason, voidedBy: displayName, voidedAt: now, paid: false, paidAt: null }));
    await appendContractingAudit('invoice.void', `${inv.number} (${inv.total ? '$' + inv.total : ''}) voided — ${reason}`);
    showToastMsg(`${inv.number} voided.`);
  };
  const saveContractingWorkOrder = async (w: ContractingWorkOrder) => {
    await setDoc(doc(roleColl('contractingWorkOrders'), w.id), cleanRM(w));
  };
  const deleteContractingWorkOrder = async (id: string) => {
    if (!canManageContracting) { showToastMsg(PERMISSION_DENIED); return; }
    const w = subContractingWorkOrdersRef.current[id];
    await deleteDoc(doc(roleColl('contractingWorkOrders'), id));
    await appendContractingAudit('workorder.delete', `${w?.title || id}${w?.property ? ` @ ${w.property}` : ''}`);
    showToastMsg('Work order deleted.');
  };
  const saveContractingShoppingItem = async (s: ContractingShoppingItem) => {
    await setDoc(doc(roleColl('contractingShoppingList'), s.id), cleanRM(s));
  };
  const deleteContractingShoppingItem = async (id: string) => {
    // Anyone deletes their own added items; managers delete any (enforced at UI).
    const it = subContractingShoppingListRef.current[id];
    if (!canManageContracting && it?.addedBy?.id !== contractingUser.id) { showToastMsg(PERMISSION_DENIED); return; }
    await deleteDoc(doc(roleColl('contractingShoppingList'), id));
  };
  // Personal TO-DO / FOLLOW-UP items — private per user (guard: own items only).
  const saveContractingPersonalItem = async (it: ContractingPersonalItem) => {
    if (it.userId !== contractingUser.id) { showToastMsg(PERMISSION_DENIED); return; }
    await setDoc(doc(roleColl('contractingPersonalItems'), it.id), cleanRM(it));
  };
  const deleteContractingPersonalItem = async (id: string) => {
    const it = subContractingPersonalItemsRef.current[id];
    if (it && it.userId !== contractingUser.id) { showToastMsg(PERMISSION_DENIED); return; }
    await deleteDoc(doc(roleColl('contractingPersonalItems'), id));
  };
  const [roleInstanceModalId, setRoleInstanceModalId] = useState<string | null>(null);
  const resolveInstance = async (id: string, patch: Partial<RoleTaskInstance>) => {
    await setDoc(doc(roleColl('roleTaskInstances'), id), cleanRM(patch), { merge: true } as any);
  };
  const completeRoleInstance = async (id: string, note: string) => {
    if (isViewingAs) { showToastMsg('View Only.'); return; }
    const inst = appData.roleTaskInstances?.[id]; if (!inst) return;
    if (!note.trim()) { showToastMsg('A completion note is required.'); return; }
    const duty = appData.roleMasterDuties?.[inst.dutyId];
    const now = Date.now();
    const late = now > (inst.dueDate || 0) + 86400000;  // past end of due day
    await resolveInstance(id, {
      status: late ? 'done_late' : 'done', completedAt: now, completionNote: note.trim(),
      sopSnapshot: duty?.sop, resolvedAt: now, resolvedBy: { email: displayEmail, name: displayName },
    });
    logPerfActivity({ type: 'ah_manually_edited', targetDate: inst.occurrenceDate, crewId: 'rolemaster', crewLabel: inst.title, userId: user?.uid || displayEmail, userName: displayName, userRole: effectiveRole, valueLabel: 'duty', reasonNote: `Completed${late ? ' (late)' : ''}: ${note.trim()}` });
    setRoleInstanceModalId(null); showToastMsg('Duty completed.');
  };
  const skipRoleInstance = async (id: string, reason: string) => {
    if (isViewingAs) { showToastMsg('View Only.'); return; }
    if (!reason.trim()) { showToastMsg('A reason is required to skip.'); return; }
    await resolveInstance(id, { status: 'skipped', skipReason: reason.trim(), resolvedAt: Date.now(), resolvedBy: { email: displayEmail, name: displayName } });
    setRoleInstanceModalId(null); showToastMsg('Duty skipped.');
  };
  const voidRoleInstance = async (id: string, reason: string) => {
    if (!isAdmin) { showToastMsg(PERMISSION_DENIED); return; }
    if (!reason.trim()) { showToastMsg('A reason is required to void.'); return; }
    await resolveInstance(id, { status: 'voided', voidReason: reason.trim(), resolvedAt: Date.now(), resolvedBy: { email: displayEmail, name: displayName } });
    setRoleInstanceModalId(null); showToastMsg('Duty voided.');
  };
  const reassignRoleInstance = async (id: string, employeeId: string) => {
    if (!isAdmin) { showToastMsg(PERMISSION_DENIED); return; }
    const emp = appData.employees.find(e => e.id === employeeId); if (!emp) return;
    const to = { employeeId: emp.id, email: (emp.linkedUserEmail || emp.email || '').toLowerCase(), name: emp.name || emp.id };
    await resolveInstance(id, { assignedTo: to, reassignedTo: to });
    showToastMsg(`Reassigned to ${emp.name}.`);
  };
  const batchCompleteRoleInstances = async (ids: string[], note: string) => {
    if (isViewingAs) { showToastMsg('View Only.'); return; }
    if (!note.trim()) { showToastMsg('A completion note is required.'); return; }
    const now = Date.now();
    for (const id of ids) {
      const inst = appData.roleTaskInstances?.[id]; if (!inst) continue;
      const duty = appData.roleMasterDuties?.[inst.dutyId];
      // eslint-disable-next-line no-await-in-loop
      await resolveInstance(id, { status: 'done_late', completedAt: now, completionNote: note.trim(), sopSnapshot: duty?.sop, resolvedAt: now, resolvedBy: { email: displayEmail, name: displayName } });
    }
    setRoleInstanceModalId(null); showToastMsg(`Caught up ${ids.length} duties.`);
  };

  const handleCopyDay = (dateString: string) => {
    if (!can('canCopyDay', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
    setCopiedDay({ date: dateString, crews: appData.schedules[dateString] || [] } as any);
    showToastMsg(`Copied ${dateString}`);
  };
  const handlePasteDay = (targetDateString: string) => {
    if (!can('canCopyDay', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
    if (!copiedDay) return;
    const copiedData = copiedDay as { date: string; crews: Crew[] };
    // Reset the dispatch state on paste — a pasted day is a fresh plan, not
    // an already-dispatched one. The spread copied `dispatched`/
    // `dispatchOverrides` verbatim, leaking the source day's dispatched
    // status. Mirror how a brand-new crew is created (dispatched:false,
    // dispatchOverrides:[]). Everything else (employees, fleet, supplies,
    // crew structure) copies as before.
    const newCrews = copiedData.crews.map(c => ({
      ...c,
      id: `crew-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      dispatched: false,
      dispatchOverrides: [],
    }));
    const pastedEmpIds = new Set(newCrews.flatMap(c => c.employees));
    const pastedFleetIds = new Set(newCrews.flatMap(c => c.fleet));

    let existingDayCrews = (appData.schedules[targetDateString] || []).map(c => ({
      ...c,
      employees: c.employees.filter(id => !pastedEmpIds.has(id)),
      fleet: c.fleet.filter(id => !pastedFleetIds.has(id))
    }));
    syncToCloud({ ...appData, schedules: { ...appData.schedules, [targetDateString]: [...existingDayCrews, ...newCrews] } });
    showToastMsg(`Pasted to ${targetDateString}`);
  };

  const getWeatherIcon = (code: number | undefined) => {
    if (code === undefined) return null;
    if (code === 0) return <Sun className="w-5 h-5 text-yellow-500" />;
    if (code >= 1 && code <= 3) return <Cloud className="w-5 h-5 text-gray-400" />;
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return <CloudRain className="w-5 h-5 text-green-500" />;
    if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return <Snowflake className="w-5 h-5 text-green-300" />;
    if (code >= 95 && code <= 99) return <CloudLightning className="w-5 h-5 text-purple-500" />;
    return <Cloud className="w-5 h-5 text-gray-400" />;
  };

  const getWeatherDescription = (code: number | undefined) => {
    if (code === undefined) return 'Unknown';
    if (code === 0) return 'Clear skies';
    if (code >= 1 && code <= 3) return 'Partly cloudy to overcast';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'Rain or showers expected';
    if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'Snow expected';
    if (code >= 95 && code <= 99) return 'Thunderstorms likely';
    return 'Cloudy';
  };

  const handleGenerateMorningBriefing = async (dateString: string, crew: Crew, dayWeather: any) => {
    if (!can('canUseAIInsight', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
    const crewEmps = crew.employees.map(id => appData.employees.find(e => e.id === id)).filter(Boolean);
    const crewFleet = crew.fleet.map(id => appData.fleet.find(f => f.id === id)).filter(Boolean);

    setAiModal({ isOpen: true, title: `Morning Briefing: ${crew.division} ${crew.crewNumber}`, content: '', isLoading: true });

    const weatherString = dayWeather ? `${dayWeather.max}°C / ${dayWeather.min}°C, ${getWeatherDescription(dayWeather.code)}` : 'Weather unknown.';
    const empString = crewEmps.map(e => e.name).join(', ') || 'No employees assigned yet.';
    const fleetString = crewFleet.map(f => f.name).join(', ') || 'No fleet assigned yet.';

    const prompt = `Act as an expert operations manager for a landscaping company. Write a short, bulleted morning huddle briefing to be read by the foreman of this crew before they head out.
    Date: ${dateString}
    Weather: ${weatherString}
    Crew Name: ${crew.division} ${crew.crewNumber}
    Team Members: ${empString}
    Assigned Fleet/Equipment: ${fleetString}
    Manager Notes: ${crew.notes || 'None'}

    Make the briefing highly practical, energetic, and professional. 
    1. Acknowledge the weather (e.g., remind them to stay hydrated if hot, or drive safe if raining).
    2. Remind them to do circle checks on their specific assigned fleet.
    3. Incorporate the manager notes as their primary objective.
    Keep the whole response under 150 words. Do not use generic filler.`;

    try {
      const response = await callGeminiWithRetry(prompt);
      setAiModal(prev => ({ ...prev, isLoading: false, content: response }));
    } catch (error) {
      setAiModal(prev => ({ ...prev, isLoading: false, content: "Failed to generate briefing. Please try again." }));
      console.error(error);
    }
  };

  // --- ACTIONS ---
  const toggleSickDay = (empId: string, dateStr: string) => {
    const newAbsences: Record<string, string[]> = { ...appData.dailyAbsences };
    if (!newAbsences[dateStr]) newAbsences[dateStr] = [];

    let newSchedules: Record<string, Crew[]> = { ...appData.schedules };

    if (newAbsences[dateStr].includes(empId)) {
      newAbsences[dateStr] = newAbsences[dateStr].filter(id => id !== empId);
    } else {
      newAbsences[dateStr].push(empId);
      // Auto remove from any crews today
      if (newSchedules[dateStr]) {
        newSchedules[dateStr] = newSchedules[dateStr].map(crew => ({
          ...crew, employees: crew.employees.filter(id => id !== empId)
        }));
      }
    }
    syncToCloud({ ...appData, dailyAbsences: newAbsences, schedules: newSchedules });
  };

  // Partial-day time off — display only. Unlike a full-day absence, the
  // employee stays on their crew (they work most of the day); we only
  // annotate the time range. Never touches BH / AH / efficiency.
  const savePartialTimeOff = (empId: string, dateStr: string, start: string, end: string) => {
    const map: Record<string, PartialTimeOff[]> = { ...(appData.partialTimeOff || {}) };
    const day = (map[dateStr] || []).filter(p => p.empId !== empId);
    day.push({ id: `pto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, empId, start, end });
    map[dateStr] = day;
    syncToCloud({ ...appData, partialTimeOff: map });
    setPartialTimeOffCtx(null);
  };

  const removePartialTimeOff = (empId: string, dateStr: string) => {
    const map: Record<string, PartialTimeOff[]> = { ...(appData.partialTimeOff || {}) };
    const day = (map[dateStr] || []).filter(p => p.empId !== empId);
    if (day.length) map[dateStr] = day; else delete map[dateStr];
    syncToCloud({ ...appData, partialTimeOff: map });
    setPartialTimeOffCtx(null);
  };

  // --- TIME-OFF HANDLERS ---
  // Locate the requester's Employee record. Approvals write to this
  // employee's awayDates / the partialTimeOff map for THIS employee.
  const findEmployeeForRequest = (r: TimeOffRequest): Employee | null => {
    const list = appData.employees || [];
    return list.find(e => e.id === r.employeeId)
      || list.find(e => normalizeEmail(e.linkedUserEmail) === normalizeEmail(r.employeeEmail))
      || null;
  };

  const submitTimeOffRequest = (data: RequestTimeOffSubmit) => {
    const me = (displayEmail || '').trim().toLowerCase();
    // Re-resolve employee on submit so the latest linkage is used.
    const myEmp = (appData.employees || []).find(e => normalizeEmail(e.linkedUserEmail) === me) || currentUserEmployee;
    if (!myEmp) { showToastMsg('Your sign-in is not linked to an Employee record. Ask an admin to link it.'); return; }
    if (editingTimeOffId) {
      const existing = (appData.timeOffRequests || {})[editingTimeOffId];
      if (!existing || existing.status !== 'pending') { showToastMsg('This request can no longer be edited.'); return; }
      const updated: TimeOffRequest = {
        ...existing,
        type: data.type,
        startDate: data.startDate,
        endDate: data.endDate,
        partialDate: data.partialDate,
        partialStart: data.partialStart,
        partialEnd: data.partialEnd,
        note: data.note,
      };
      syncToCloud({ ...appData, timeOffRequests: { ...(appData.timeOffRequests || {}), [existing.id]: updated } });
      setIsTimeOffModalOpen(false);
      setEditingTimeOffId(null);
      showToastMsg('Request updated.');
      return;
    }
    const id = `to-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newReq: TimeOffRequest = {
      id,
      employeeId: myEmp.id,
      employeeEmail: (myEmp.linkedUserEmail || myEmp.email || displayEmail).toLowerCase(),
      employeeName: myEmp.name || displayName,
      type: data.type,
      startDate: data.startDate,
      endDate: data.endDate,
      partialDate: data.partialDate,
      partialStart: data.partialStart,
      partialEnd: data.partialEnd,
      note: data.note,
      status: 'pending',
      createdAt: Date.now(),
      // Author implicitly "saw" the pending state.
      seenByRequester: Date.now(),
    };
    syncToCloud({ ...appData, timeOffRequests: { ...(appData.timeOffRequests || {}), [id]: newReq } });
    setIsTimeOffModalOpen(false);
    setEditingTimeOffId(null);
    showToastMsg('Time-off request submitted for approval.');
  };

  const cancelTimeOffRequest = (id: string) => {
    const existing = (appData.timeOffRequests || {})[id];
    if (!existing || existing.status !== 'pending') return;
    const me = (displayEmail || '').trim().toLowerCase();
    if ((existing.employeeEmail || '').toLowerCase() !== me) { showToastMsg(PERMISSION_DENIED); return; }
    const updated: TimeOffRequest = {
      ...existing,
      status: 'cancelled',
      reviewedAt: Date.now(),
      reviewedBy: { email: displayEmail, name: displayName },
    };
    syncToCloud({ ...appData, timeOffRequests: { ...(appData.timeOffRequests || {}), [id]: updated } });
    showToastMsg('Request cancelled.');
  };

  // Enumerate every YYYY-MM-DD between two inclusive endpoints. Used
  // by the full-day approval write to clear the requester from any
  // crews scheduled in the range (matches toggleSickDay's behavior).
  const eachDateInRange = (start: string, end: string): string[] => {
    if (!start || !end) return [];
    const out: string[] = [];
    const s = new Date(`${start}T12:00:00`);
    const e = new Date(`${end}T12:00:00`);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return [];
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      out.push(`${y}-${m}-${day}`);
    }
    return out;
  };

  const approveTimeOffRequest = (id: string) => {
    if (!can('canApproveTimeOff', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
    const existing = (appData.timeOffRequests || {})[id];
    if (!existing || existing.status !== 'pending') return;
    const emp = findEmployeeForRequest(existing);
    if (!emp) { showToastMsg("Couldn't find the requester's Employee record."); return; }

    if (existing.type === 'full_day') {
      if (!existing.startDate || !existing.endDate) { showToastMsg('Request is missing dates.'); return; }
      const newRange = { start: existing.startDate, end: existing.endDate };
      const nextEmployees: Employee[] = (appData.employees || []).map(e => {
        if (e.id !== emp.id) return e;
        return { ...e, awayDates: [ ...(e.awayDates || []), newRange ] };
      });
      // Auto-remove from any crews scheduled within the range — mirror
      // toggleSickDay (App.tsx:1022). Schedule reflects reality after
      // approval; manager can re-add the worker if the time-off is
      // later reverted (revert intentionally doesn't restore crews).
      const nextSchedules = { ...(appData.schedules || {}) };
      const dates = eachDateInRange(existing.startDate, existing.endDate);
      for (const d of dates) {
        const day = nextSchedules[d];
        if (!day) continue;
        nextSchedules[d] = day.map(crew => ({ ...crew, employees: crew.employees.filter(eid => eid !== emp.id) }));
      }
      const updated: TimeOffRequest = {
        ...existing,
        status: 'approved',
        reviewedAt: Date.now(),
        reviewedBy: { email: displayEmail, name: displayName },
        appliedAwayDateRange: newRange,
      };
      syncToCloud({
        ...appData,
        employees: nextEmployees,
        schedules: nextSchedules,
        timeOffRequests: { ...(appData.timeOffRequests || {}), [id]: updated },
      });
      showToastMsg(`Approved — ${existing.employeeName} blocked off ${newRange.start} → ${newRange.end}.`);
      return;
    }

    // PARTIAL — display-only chip, no crew removal.
    if (!existing.partialDate || !existing.partialStart || !existing.partialEnd) { showToastMsg('Request is missing partial-day fields.'); return; }
    const ptoId = `pto-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const newPto: PartialTimeOff = { id: ptoId, empId: emp.id, start: existing.partialStart, end: existing.partialEnd };
    const nextPartial: Record<string, PartialTimeOff[]> = { ...(appData.partialTimeOff || {}) };
    const dayList = nextPartial[existing.partialDate] ? [...nextPartial[existing.partialDate]] : [];
    dayList.push(newPto);
    nextPartial[existing.partialDate] = dayList;
    const updated: TimeOffRequest = {
      ...existing,
      status: 'approved',
      reviewedAt: Date.now(),
      reviewedBy: { email: displayEmail, name: displayName },
      appliedPartialKeys: [{ date: existing.partialDate, ptoId }],
    };
    syncToCloud({
      ...appData,
      partialTimeOff: nextPartial,
      timeOffRequests: { ...(appData.timeOffRequests || {}), [id]: updated },
    });
    showToastMsg(`Approved — ${existing.employeeName} partial day on ${existing.partialDate}.`);
  };

  const denyTimeOffRequest = (id: string, reason: string) => {
    if (!can('canApproveTimeOff', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
    const existing = (appData.timeOffRequests || {})[id];
    if (!existing || existing.status !== 'pending') return;
    const updated: TimeOffRequest = {
      ...existing,
      status: 'denied',
      reviewedAt: Date.now(),
      reviewedBy: { email: displayEmail, name: displayName },
      denialReason: reason || undefined,
    };
    syncToCloud({ ...appData, timeOffRequests: { ...(appData.timeOffRequests || {}), [id]: updated } });
    showToastMsg('Request denied.');
  };

  const revertTimeOffRequest = (id: string) => {
    const existing = (appData.timeOffRequests || {})[id];
    if (!existing || existing.status !== 'approved') return;
    const me = (displayEmail || '').trim().toLowerCase();
    if ((existing.employeeEmail || '').toLowerCase() !== me) { showToastMsg(PERMISSION_DENIED); return; }
    let nextEmployees = appData.employees || [];
    let nextPartial = appData.partialTimeOff || {};
    const emp = findEmployeeForRequest(existing);

    if (existing.appliedAwayDateRange && emp) {
      const target = existing.appliedAwayDateRange;
      nextEmployees = (appData.employees || []).map(e => {
        if (e.id !== emp.id) return e;
        const ranges = (e.awayDates || []).filter(d => !(d.start === target.start && d.end === target.end));
        return { ...e, awayDates: ranges };
      });
    }
    if (existing.appliedPartialKeys && existing.appliedPartialKeys.length > 0) {
      const map: Record<string, PartialTimeOff[]> = { ...(appData.partialTimeOff || {}) };
      for (const key of existing.appliedPartialKeys) {
        const list = map[key.date];
        if (!list) continue;
        const remaining = list.filter(p => p.id !== key.ptoId);
        if (remaining.length === 0) delete map[key.date]; else map[key.date] = remaining;
      }
      nextPartial = map;
    }
    const updated: TimeOffRequest = {
      ...existing,
      status: 'reverted',
      // reviewedAt left as original approval time; record revert time
      // separately if a future audit needs to distinguish.
    };
    syncToCloud({
      ...appData,
      employees: nextEmployees,
      partialTimeOff: nextPartial,
      timeOffRequests: { ...(appData.timeOffRequests || {}), [id]: updated },
    });
    showToastMsg('Approved time-off reverted.');
  };

  // Idempotency guard for repair creation: true if a repair with the same
  // unit + date + notes + cost was logged within the last ~12s (the
  // optimistic-update race window). Repair ids are `rep-<ts>[-rand]`, so we
  // recover the creation time from the id. Backstops the in-flight ref guard
  // against re-render races and cross-device double-submits.
  const recentDuplicateRepairExists = (
    equipmentId: string,
    date: string,
    fixNotes: string,
    cost: number,
  ): boolean => {
    const now = Date.now();
    return (appData.repairLog || []).some((r: any) => {
      if (r.equipmentId !== equipmentId) return false;
      if (r.date !== date) return false;
      if ((r.fixNotes || '') !== (fixNotes || '')) return false;
      if ((Number(r.cost) || 0) !== cost) return false;
      const ts = Number(String(r.id || '').match(/^rep-(\d+)/)?.[1]);
      return Number.isFinite(ts) && now - ts < 12000;
    });
  };

  // SOFT pre-submit guards for repair creation (used by BOTH creation
  // paths). Returns true to proceed, false to abort (modal left open so the
  // user can edit or cancel). These catch the near-blank RESUBMIT dupes the
  // 12s/exact-content checks miss — without ever HARD-blocking, since a unit
  // legitimately can have several different repairs in one day.
  //   1. Day-level: a repair for this unit already exists today (any
  //      content / any time) → warn + confirm. Matches on equipmentId+date
  //      only — the only key that fires on the observed junk. Confirm lets
  //      genuine multiple same-day repairs through.
  //   2. Blank-submit: no notes AND $0 cost → warn + confirm (every observed
  //      resubmit was near-blank).
  const confirmRepairSubmit = (
    equipmentId: string,
    date: string,
    fixNotes: string,
    cost: number,
  ): boolean => {
    const alreadyToday = (appData.repairLog || []).some(
      (r: any) => r.equipmentId === equipmentId && r.date === date,
    );
    if (alreadyToday && !window.confirm(
      'This unit already has a repair logged today.\n\nThis may be a duplicate ' +
      'resubmit. Add another repair for it anyway?',
    )) return false;
    const isBlank = (!fixNotes || !fixNotes.trim()) && (Number(cost) || 0) === 0;
    if (isBlank && !window.confirm(
      'This repair has no notes and $0 cost.\n\nLog it anyway?',
    )) return false;
    return true;
  };

  const handleRepairComplete = async () => {
    if (!can('canCompleteRepairs', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
    // Hard re-entrancy guard — a second tap while the first is in flight is
    // a no-op (synchronous, beats the React re-render).
    if (repairSubmitRef.current) return;
    const { fleetId, fixNotes, cost } = repairModal;
    if (!fleetId) return;
    const costNum = Number(cost) || 0;
    const today = formatDate(new Date());
    // Content idempotency: if an identical repair was just logged, treat the
    // tap as a duplicate submit and just close the modal.
    if (recentDuplicateRepairExists(fleetId, today, fixNotes, costNum)) {
      setRepairModal({ isOpen: false, fleetId: null, fixNotes: '', cost: '' });
      showToastMsg("Repair already logged.");
      return;
    }
    // Soft day-level + blank-submit guards. Abort (modal stays open) if the
    // user declines either confirm.
    if (!confirmRepairSubmit(fleetId, today, fixNotes, costNum)) return;
    repairSubmitRef.current = true;
    setIsLoggingRepair(true);
    try {
      const fItem = appData.fleet.find(f => f.id === fleetId);
      const newLogEntry = {
        id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        equipmentId: fleetId, equipmentName: fItem?.name || 'Unknown',
        date: today, fixNotes, cost: costNum,
      };
      const newFleet = appData.fleet.map(f => f.id === fleetId ? { ...f, status: 'Active', repairTags: [] } : f);
      const ok = await syncToCloud({ ...appData, fleet: newFleet, repairLog: [newLogEntry, ...appData.repairLog] });
      if (ok) {
        setRepairModal({ isOpen: false, fleetId: null, fixNotes: '', cost: '' });
        showToastMsg("Repair logged successfully.");
      } else {
        showToastMsg("Save failed — try again.");
      }
    } finally {
      repairSubmitRef.current = false;
      setIsLoggingRepair(false);
    }
  };

  const toggleRepairTag = (fleetId: string, tag: string) => {
    const newFleet = appData.fleet.map(f => {
      if (f.id !== fleetId) return f;
      const tags = f.repairTags || [];
      return { ...f, repairTags: tags.includes(tag) ? tags.filter((t: string) => t !== tag) : [...tags, tag] } as FleetItem;
    });
    syncToCloud({ ...appData, fleet: newFleet });
  };

  const addCrewToDay = (dateString: string) => {
    if (!can('canCreateCrews', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
    const daySchedules = appData.schedules[dateString] || [];
    const lpCrews = daySchedules.filter(c => c.division === 'Large Projects');
    let nextNum = 1;
    while (lpCrews.some(c => c.crewNumber === nextNum)) nextNum++;

    const newSchedules = {
      ...appData.schedules,
      [dateString]: [...daySchedules, { id: `crew-${Date.now()}`, division: 'Large Projects', crewNumber: nextNum, notes: '', employees: [], fleet: [], inventory: [], supplies: [] }]
    };
    syncToCloud({ ...appData, schedules: newSchedules });
  };


  const onDragStart = (e: React.DragEvent, type: string, item: any) => {
    if (scheduleMode !== 'daily') {
      // Weekly view: drag-drop disabled; use the dropdown instead.
      e.preventDefault();
      return;
    }
    const dateStr = selectedDailyDate;
    const rType = (type === 'fleet' ? 'fleet' : 'employee') as ResourceType;
    const status = getResourceAvailability(item.id, rType, dateStr, appData);
    // OOS fleet/equipment is draggable for managers/admins — ScheduleBoard's
    // onDrop gates the actual add behind an override confirmation (which writes
    // the audit OverrideRecord). Every other unavailable status, and OOS for
    // non-managers, remains a hard block.
    const oosOverrideAllowed = status.status === 'oos' && rType === 'fleet' && isManager;
    if (status.status !== 'available' && !oosOverrideAllowed) {
      e.preventDefault();
      showToastMsg(describeUnavailability(status, item.name));
      return;
    }
    setDraggingResource({ type: rType, id: item.id });
    e.dataTransfer.setData('text/plain', JSON.stringify({ type, id: item.id }));
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragEnd = () => setDraggingResource(null);


  // --- RENDERERS ---
  const renderSidebarItem = (item: any, type: string, contextDate: string | null = null) => {
    const isEmp = type === 'employee';
    const rType: ResourceType = isEmp ? 'employee' : 'fleet';
    let isDraggable = true, visClass = 'bg-white border-gray-200 hover:border-green-400', subText: React.ReactNode = null;

    // Use the unified availability helper so badge + drag gating stay in sync.
    const avail = contextDate ? getResourceAvailability(item.id, rType, contextDate, appData) : { status: 'available' as const };
    if (avail.status !== 'available') {
      isDraggable = false;
      switch (avail.status) {
        case 'absent':
          visClass = 'border-rose-200 bg-rose-50 opacity-70';
          subText = <span className="text-[10px] bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full font-bold">{avail.reason === 'sick' ? 'Sick / Absent' : 'Away Indef.'}</span>;
          break;
        case 'booked_off':
          visClass = 'border-orange-200 bg-orange-50';
          subText = <span className="text-[10px] bg-orange-100 text-orange-800 px-2 py-0.5 rounded-full font-bold">Booked Off</span>;
          break;
        case 'oos':
          visClass = 'border-red-200 opacity-60 bg-red-50';
          subText = <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full uppercase font-bold">{item.status}</span>;
          break;
        case 'assigned':
          visClass = 'border-blue-200 bg-blue-50 opacity-70';
          subText = <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-bold truncate max-w-[120px]" title={`On ${avail.crewName}`}>On {avail.crewName}</span>;
          break;
      }
    }

    const Icon = isEmp ? UserCircle : (item.type === 'equipment' ? SkidSteerIcon : (item.type === 'trailer' ? Wrench : Truck));
    const draggable = isDraggable && canEditSchedule && scheduleMode === 'daily';

    return (
      <div key={item.id} draggable={draggable} onDragStart={(e) => onDragStart(e, type, item)} onDragEnd={onDragEnd} className={`flex items-center gap-3 p-2.5 mb-2 border rounded-lg shadow-sm transition-all ${visClass} ${draggable ? 'cursor-grab' : ''}`}>
        {draggable ? <GripVertical className="w-4 h-4 text-gray-400" /> : <div className="w-4" />}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-gray-900 flex items-center gap-1.5 truncate">
            {!isEmp && item.color && <div className={`w-3 h-3 rounded-full ${item.color} flex-shrink-0 shadow-sm border border-gray-300`} />}
            {isEmp ? item.name : fleetItemLabel(item)}
            {isEmp && item.hasLicense && <IdCard className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />}
            {isEmp && item.hasClassA && <ClassAIcon className="w-3.5 h-3.5 text-purple-600 flex-shrink-0" title="Class A" />}
            {isEmp && item.hasHeavyMachinery && <SkidSteerIcon className="w-3.5 h-3.5 text-orange-600 flex-shrink-0" title="Heavy Machinery" />}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {isEmp ? (
              <span className="text-[10px] bg-gray-100 text-gray-600 border border-gray-200 px-1.5 rounded uppercase font-bold">{item.systemRole || 'worker'}</span>
            ) : (
              <>
                <span className="text-[10px] bg-gray-100 text-gray-600 border border-gray-200 px-1.5 rounded uppercase font-bold">{item.type}</span>
                {/* Inspection readiness pill — trucks/trailers/tractors
                    only. Equipment (mowers etc.) is not inspected. */}
                {item.type !== 'equipment' && (() => {
                  const readiness = getUnitReadiness(item.id, appData, contextDate);
                  const labels = { green: 'Inspected', yellow: 'Minor Defect', red: 'Out of Service', missing: 'Needs Inspection' };
                  const colors = { green: 'bg-emerald-100 text-emerald-700 border-emerald-200', yellow: 'bg-yellow-100 text-yellow-700 border-yellow-200', red: 'bg-red-100 text-red-700 border-red-200', missing: 'bg-slate-100 text-slate-500 border-slate-200' };
                  return <span className={`text-[10px] border px-1.5 rounded uppercase font-black ${colors[readiness]}`}>{labels[readiness]}</span>;
                })()}
              </>
            )}
            {subText}
          </div>
        </div>
        {isEmp && contextDate && canManageResources && (
          <>
            <button onClick={() => setPartialTimeOffCtx({ empId: item.id, empName: item.name, dateStr: contextDate })} className={`p-1.5 rounded-lg border transition-colors ${appData.partialTimeOff?.[contextDate]?.some((p: PartialTimeOff) => p.empId === item.id) ? 'bg-amber-100 border-amber-300 text-amber-600' : 'bg-gray-50 border-gray-200 text-gray-400 hover:text-amber-500 hover:bg-amber-50'}`} title="Partial Time Off">
              <Clock className="w-4 h-4" />
            </button>
            <button onClick={() => toggleSickDay(item.id, contextDate)} className={`p-1.5 rounded-lg border transition-colors ${appData.dailyAbsences[contextDate]?.includes(item.id) ? 'bg-rose-100 border-rose-300 text-rose-600' : 'bg-gray-50 border-gray-200 text-gray-400 hover:text-rose-500 hover:bg-rose-50'}`} title="Toggle Absence">
              <Thermometer className="w-4 h-4" />
            </button>
          </>
        )}
        {!isEmp && <Icon className={`w-5 h-5 flex-shrink-0 ${isDraggable ? 'text-gray-500' : 'text-red-400'}`} title={item.name} />}
      </div>
    );
  };


  const renderMechanicBoard = () => (
    <MechanicBoard
      appData={appData}
      fleet={appData.fleet}
      mechanicTasks={appData.mechanicTasks}
      repairLog={appData.repairLog}
      cvorExpiry={appData.cvorExpiry}
      currentUserEmail={displayEmail}
      currentUserName={displayName}
      onViewInspection={(id) => setViewingInspectionId(id)}
      onAssignTask={(taskId, assignedTo) => {
        if (!can('canEditRepairs', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
        const updated = appData.mechanicTasks.map(t =>
          t.id === taskId ? { ...t, assignedTo: assignedTo === null ? undefined : assignedTo } : t
        );
        syncToCloud({ ...appData, mechanicTasks: updated });
      }}
      onSetAssignees={(taskId, assignees) => {
        if (!can('canEditRepairs', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
        const updated = appData.mechanicTasks.map(t =>
          t.id === taskId
            ? { ...t, assignees, assignedTo: assignees[0] || undefined }
            : t,
        );
        syncToCloud({ ...appData, mechanicTasks: updated });
      }}
      onTogglePriority={(task) => {
        if (!can('canEditRepairs', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
        const existing = appData.mechanicTasks.find(t => t.id === task.id);
        if (existing) {
          const next = !existing.priority;
          const act = makeActivity('priority_changed', existing, { priority: next });
          const updated = appData.mechanicTasks.map(t =>
            t.id === task.id ? { ...t, priority: next, activity: [...(t.activity || []), act] } : t
          );
          syncToCloud({ ...appData, mechanicTasks: updated, activityLog: [act, ...(appData.activityLog || [])] });
          return;
        }
        // Synthetic task — promote with priority=true and activity trail
        const source = task.isMaintenance ? 'auto-maintenance' : 'auto-oos';
        const promoted: MechanicTask = { ...task, priority: true, activity: [] };
        const createdAct = makeActivity('created', promoted, { source, sourceRefId: task.unitId });
        const priorityAct = makeActivity('priority_changed', promoted, { priority: true });
        promoted.activity = [createdAct, priorityAct];
        syncToCloud({
          ...appData,
          mechanicTasks: [promoted, ...appData.mechanicTasks],
          activityLog: [priorityAct, createdAct, ...(appData.activityLog || [])],
        });
      }}
      onSetTaskPhotos={(taskId, photos) => {
        // Persist a repair's photo metadata array (after a board-side photo
        // delete). Bytes are removed from Storage by the caller; here we
        // only write the trimmed metadata onto the task. No pay/stat paths.
        const updated = appData.mechanicTasks.map(t =>
          t.id === taskId ? { ...t, photos } : t
        );
        syncToCloud({ ...appData, mechanicTasks: updated });
      }}
      onToggleWaitingOnParts={(task) => {
        if (!can('canEditRepairs', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
        const existing = appData.mechanicTasks.find(t => t.id === task.id);
        if (existing) {
          const next = !existing.waitingOnParts;
          const act = makeActivity('waiting_on_parts_changed', existing, { waitingOnParts: next });
          const updated = appData.mechanicTasks.map(t =>
            t.id === task.id ? { ...t, waitingOnParts: next, activity: [...(t.activity || []), act] } : t
          );
          syncToCloud({ ...appData, mechanicTasks: updated, activityLog: [act, ...(appData.activityLog || [])] });
          return;
        }
        // Synthetic — promote with waitingOnParts=true
        const source = task.isMaintenance ? 'auto-maintenance' : 'auto-oos';
        const promoted: MechanicTask = { ...task, waitingOnParts: true, activity: [] };
        const createdAct = makeActivity('created', promoted, { source, sourceRefId: task.unitId });
        const wopAct = makeActivity('waiting_on_parts_changed', promoted, { waitingOnParts: true });
        promoted.activity = [createdAct, wopAct];
        syncToCloud({
          ...appData,
          mechanicTasks: [promoted, ...appData.mechanicTasks],
          activityLog: [wopAct, createdAct, ...(appData.activityLog || [])],
        });
      }}
      mechanicView={mechanicView}
      setMechanicView={setMechanicView}
      editingOdoId={editingOdoId}
      setEditingOdoId={setEditingOdoId}
      tempOdo={tempOdo}
      setTempOdo={setTempOdo}
      onOpenManualTask={(preFillUnit) => setManualTaskModal({
        isOpen: true,
        unitId: preFillUnit?.id || '',
        unitName: preFillUnit?.name || '',
        category: '',
        description: '',
        severity: 'minor',
        priority: false,
      })}
      onCvorChange={(value) => syncToCloud({ ...appData, cvorExpiry: value })}
      onTaskDrop={(task, newStatus) => {
        if (newStatus === 'done') {
          if (!can('canCompleteRepairs', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
          // Look up the canonical task (might be a synthetic one not
          // in appData.mechanicTasks yet — fall back to the dropped
          // task for source/maint metadata in that case).
          const canonical = appData.mechanicTasks.find(t => t.id === task.id) || task;
          setCompletionModal({
            isOpen: true,
            taskId: task.id,
            unitId: task.unitId,
            unitName: task.unitName,
            partCost: '',
            laborHours: '',
            fixNotes: task.description || '',
            selectedWorkers: assigneesForTask(canonical),
            ...buildMaintCompletionPrefill(canonical),
          });
        } else {
          if (!can('canEditRepairs', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
          // Promote synthetic tasks (auto-generated for OOS/maintenance fleet state, not in appData)
          const existing = appData.mechanicTasks.find(t => t.id === task.id);
          if (existing) {
            const statusAct = makeActivity('status_changed', existing, { from: existing.status, to: newStatus });
            const updated = appData.mechanicTasks.map(t => t.id === task.id ? { ...t, status: newStatus as any, activity: [...(t.activity || []), statusAct] } : t);
            syncToCloud({ ...appData, mechanicTasks: updated, activityLog: [statusAct, ...(appData.activityLog || [])] });
          } else {
            // Synthetic promotion: emit 'created' (auto-oos or auto-maintenance)
            const source = task.isMaintenance ? 'auto-maintenance' : 'auto-oos';
            const promoted: MechanicTask = { ...task, status: newStatus as any, activity: [] };
            const createdAct = makeActivity('created', promoted, { source, sourceRefId: task.unitId });
            const statusAct = makeActivity('status_changed', promoted, { from: 'todo', to: newStatus });
            promoted.activity = [createdAct, statusAct];
            syncToCloud({
              ...appData,
              mechanicTasks: [promoted, ...appData.mechanicTasks],
              activityLog: [statusAct, createdAct, ...(appData.activityLog || [])]
            });
          }
        }
      }}
      onMoveForward={(taskId, currentStatus) => {
        const existing = appData.mechanicTasks.find(t => t.id === taskId);
        const newStatus = currentStatus === 'todo' ? 'doing' : 'done';
        if (newStatus === 'done' && existing) {
          if (!can('canCompleteRepairs', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
          // Open completion modal instead of just changing status.
          // Maintenance tasks get the metric-aware prefill so the
          // schedule advances on submit.
          setCompletionModal({
            isOpen: true,
            taskId: existing.id,
            unitId: existing.unitId,
            unitName: existing.unitName,
            partCost: '',
            laborHours: '',
            fixNotes: existing.description || '',
            selectedWorkers: assigneesForTask(existing),
            ...buildMaintCompletionPrefill(existing),
          });
          return;
        }
        if (!can('canEditRepairs', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
        if (!existing) {
          syncToCloud({ ...appData, mechanicTasks: appData.mechanicTasks.map(t => t.id === taskId ? { ...t, status: newStatus as any } : t) });
          return;
        }
        const act = makeActivity('status_changed', existing, { from: existing.status, to: newStatus });
        const updated = appData.mechanicTasks.map(t => t.id === taskId ? { ...t, status: newStatus as any, activity: [...(t.activity || []), act] } : t);
        syncToCloud({ ...appData, mechanicTasks: updated, activityLog: [act, ...(appData.activityLog || [])] });
      }}
      onDeleteTask={requestDeleteTask}
      onSaveOdometer={(fleetId) => {
        const unit = appData.fleet.find(v => v.id === fleetId);
        if (!unit) { setEditingOdoId(null); return; }
        const newKm = Number(tempOdo);
        const updatedUnit: FleetItem = {
          ...unit,
          odometer: newKm,
          lastOdometerUpdate: formatDate(new Date()),
        };
        // Truck maintenance (auto, no toggle): run the km spawn
        // helper so an oil change crossing its nextDueKm (or coming
        // within 500 km of it) surfaces as a yellow/red Repair Board
        // task. No-op for non-trucks and for unconfigured items.
        const { items, mechanicTasks } = processMaintenanceForOdometerUpdate(
          updatedUnit,
          appData.mechanicTasks,
        );
        updatedUnit.maintenanceItems = items;
        const nextFleet = appData.fleet.map(v => v.id === fleetId ? updatedUnit : v);
        syncToCloud({ ...appData, fleet: nextFleet, mechanicTasks });
        setEditingOdoId(null);
        showToastMsg("Updated");
      }}
      onSaveEngineHours={(fleetId, newHours) => {
        if (!Number.isFinite(newHours) || newHours < 0) {
          showToastMsg('Engine hours must be a non-negative number.');
          return;
        }
        const unit = appData.fleet.find(f => f.id === fleetId);
        if (!unit) return;
        const prev = typeof unit.currentEngineHours === 'number' ? unit.currentEngineHours : null;
        if (prev !== null && newHours < prev) {
          // Defensive prompt — typos that go backward (e.g. 500 vs 5000)
          // would otherwise silently rewind the schedule. Use confirm
          // so the manager can override deliberately.
          const ok = window.confirm(
            `Engine hours going DOWN: ${prev} → ${newHours}. ` +
            'Confirm if this is intentional.',
          );
          if (!ok) return;
        }
        // Build the updated unit, then run the spawn helper to advance
        // any due/overdue maintenance schedules and surface them as
        // tasks on the Repair Board.
        const updatedUnit: FleetItem = {
          ...unit,
          currentEngineHours: newHours,
          lastHourUpdateAt: Date.now(),
        };
        const { items, mechanicTasks } = processMaintenanceForHourUpdate(
          updatedUnit,
          appData.mechanicTasks,
        );
        updatedUnit.maintenanceItems = items;
        const nextFleet = appData.fleet.map(f => f.id === fleetId ? updatedUnit : f);
        syncToCloud({ ...appData, fleet: nextFleet, mechanicTasks });
        showToastMsg('Hours updated.');
      }}
      onToggleWinterize={(fleetId) => {
        if (effectiveRole !== 'admin' && effectiveRole !== 'manager') {
          showToastMsg(PERMISSION_DENIED);
          return;
        }
        const unit = appData.fleet.find(f => f.id === fleetId);
        if (!unit) return;
        if (!unit.isWinterized) {
          const ok = window.confirm(
            `Mark ${unit.name} as winterized? It will be hidden from active fleet, ` +
            "can't be assigned to crews, can't be inspected, and can't have " +
            'repairs filed until manually reactivated.',
          );
          if (!ok) return;
          // Winterize: flip flag, clear any open maintenance tasks for
          // this unit (season is over — no point holding a stale yellow
          // task on the Repair Board through winter), clear activeTaskId
          // on each maintenance item.
          const itemIdsToClear = new Set(
            (unit.maintenanceItems || []).map(mi => mi.activeTaskId).filter((id): id is string => !!id),
          );
          const nextTasks = appData.mechanicTasks.filter(t => !(t.unitId === unit.id && t.source === 'maintenance' && t.status !== 'done'));
          const nextItems = (unit.maintenanceItems || []).map(mi =>
            mi.activeTaskId && itemIdsToClear.has(mi.activeTaskId)
              ? { ...mi, activeTaskId: undefined }
              : mi,
          );
          const updatedUnit: FleetItem = {
            ...unit,
            isWinterized: true,
            winterizedAt: Date.now(),
            maintenanceItems: nextItems,
          };
          const nextFleet = appData.fleet.map(f => f.id === fleetId ? updatedUnit : f);
          syncToCloud({ ...appData, fleet: nextFleet, mechanicTasks: nextTasks });
          showToastMsg(`${unit.name} winterized.`);
        } else {
          // Reactivate.
          const updatedUnit: FleetItem = {
            ...unit,
            isWinterized: false,
            winterizedAt: undefined,
          };
          const nextFleet = appData.fleet.map(f => f.id === fleetId ? updatedUnit : f);
          syncToCloud({ ...appData, fleet: nextFleet });
          showToastMsg(`${unit.name} reactivated.`);
        }
      }}
      onManualResetMaintenance={(fleetId, itemId, valueAtService, notes, explicitNextDue, placeholderDefaults) => {
        if (!can('canCompleteRepairs', effectiveRole)) {
          showToastMsg(PERMISSION_DENIED);
          return;
        }
        if (!Number.isFinite(valueAtService) || valueAtService < 0) {
          showToastMsg('Service reading must be non-negative.');
          return;
        }
        const unit = appData.fleet.find(f => f.id === fleetId);
        if (!unit) return;
        const existingItem = (unit.maintenanceItems || []).find(mi => mi.id === itemId);
        // Upsert mode: when no item with this id exists, treat this
        // as the first-time configuration of a virtual placeholder
        // (Option A truck oil change). The caller provides the
        // defaults (name, threshold, metric); we synthesize a new
        // MaintenanceItem and append it.
        const item: MaintenanceItem | undefined = existingItem || (placeholderDefaults ? {
          id: `mi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: placeholderDefaults.name,
          threshold: placeholderDefaults.threshold,
          nextDueAt: 0,
          metric: placeholderDefaults.metric,
        } : undefined);
        if (!item) return;
        const metric = item.metric || 'hours';
        if (typeof explicitNextDue !== 'number' || !Number.isFinite(explicitNextDue) || explicitNextDue < 0) {
          showToastMsg(metric === 'km'
            ? 'Next due (km) is required and must be non-negative.'
            : 'Next due (hrs) is required and must be non-negative.');
          return;
        }
        const resetItem = resetMaintenanceItem(item, valueAtService, explicitNextDue);
        const nextItems = existingItem
          ? (unit.maintenanceItems || []).map(mi => mi.id === itemId ? resetItem : mi)
          : [...(unit.maintenanceItems || []), resetItem];
        const updatedUnit: FleetItem = metric === 'km'
          ? {
            ...unit,
            maintenanceItems: nextItems,
            odometer: valueAtService,
            lastOdometerUpdate: formatDate(new Date()),
          }
          : {
            ...unit,
            maintenanceItems: nextItems,
            currentEngineHours: valueAtService,
            lastHourUpdateAt: Date.now(),
          };
        // Delete the active task associated with this item, if any.
        const taskIdToDelete = item.activeTaskId;
        const nextTasks = taskIdToDelete
          ? appData.mechanicTasks.filter(t => t.id !== taskIdToDelete)
          : appData.mechanicTasks;
        // Write a Maintenance entry to the inspection log so the
        // service is captured in the unit's history. Km entries
        // store the reading in kmAtService + odometer for parity
        // with non-maintenance entries; hour entries continue to
        // populate hoursAtService.
        const inspectionEntry: Inspection = {
          id: `insp-maint-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          unitId: unit.id,
          driverId: '',
          driverName: '',
          inspectorEmail: displayEmail,
          inspectorName: displayName,
          type: 'Maintenance',
          date: new Date().toISOString().slice(0, 10),
          timestamp: new Date().toISOString(),
          odometer: metric === 'km' ? valueAtService : 0,
          location: '',
          defects: [],
          isMajor: false,
          signature: '',
          status: 'clean',
          // Use the resolved item's id so a first-time upsert (Option A
          // truck oil change) links the inspection to the freshly
          // generated MaintenanceItem id, not the virtual placeholder.
          maintenanceItemId: resetItem.id,
          maintenanceItemName: item.name,
          hoursAtService: metric === 'hours' ? valueAtService : undefined,
          kmAtService: metric === 'km' ? valueAtService : undefined,
          maintenanceMetric: metric,
          performedBy: { email: displayEmail, name: displayName },
          maintenanceNotes: notes || undefined,
          maintenanceSource: 'manual_reset',
        };
        const nextFleet = appData.fleet.map(f => f.id === fleetId ? updatedUnit : f);
        const nextInspections = [inspectionEntry, ...appData.inspections];
        syncToCloud({ ...appData, fleet: nextFleet, mechanicTasks: nextTasks, inspections: nextInspections });
        showToastMsg(`${item.name} reset to ${valueAtService} ${metric === 'km' ? 'km' : 'hrs'}.`);
      }}
      isAdmin={isAdmin}
      canEditRepairs={can('canEditRepairs', effectiveRole)}
      canViewAllInspections={can('canViewAllInspections', effectiveRole)}
      currentEmployeeId={currentUserEmployee?.id || null}
      onAddTaskNote={(taskId, text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const existing = appData.mechanicTasks.find(t => t.id === taskId);
        if (!existing) return;
        const note: TaskNote = {
          id: `tnote-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          author: displayEmail,
          authorName: displayName,
          timestamp: new Date().toISOString(),
          text: trimmed,
        };
        const act = makeActivity('note_added', existing, { noteText: trimmed, noteId: note.id });
        const updated = appData.mechanicTasks.map(t => t.id === taskId
          ? { ...t, notes: [...(Array.isArray(t.notes) ? t.notes : []), note], activity: [...(t.activity || []), act] }
          : t);
        syncToCloud({ ...appData, mechanicTasks: updated, activityLog: [act, ...(appData.activityLog || [])] });
      }}
      onDeleteTaskNote={(taskId, noteId) => {
        const existing = appData.mechanicTasks.find(t => t.id === taskId);
        if (!existing) return;
        const note = (Array.isArray(existing.notes) ? existing.notes : []).find(n => n.id === noteId);
        if (!note) return;
        if (note.author !== displayEmail && !isAdmin) return;
        const act = makeActivity('note_deleted', existing, { noteText: note.text, noteId });
        const updated = appData.mechanicTasks.map(t => t.id === taskId
          ? { ...t, notes: (Array.isArray(t.notes) ? t.notes : []).filter(n => n.id !== noteId), activity: [...(t.activity || []), act] }
          : t);
        syncToCloud({ ...appData, mechanicTasks: updated, activityLog: [act, ...(appData.activityLog || [])] });
      }}
      onOpenUnitHistory={(unit) => setHistoryUnitId(unit.id)}
      canDeleteMechanicTask={can('canDeleteMechanicTask', effectiveRole)}
      canDeleteRepairLog={can('canDeleteRepairLog', effectiveRole)}
      canDeleteInspectionLog={can('canDeleteInspectionLog', effectiveRole)}
      onDeleteRepairLog={requestDeleteRepairLog}
      onDeleteInspectionLog={requestDeleteInspectionLog}
      defaultRepairFilter={effectiveRole === 'mechanic' ? 'mine' : 'all'}
      onOpenTask={(taskId) => setMyMechanicTaskId(taskId)}
      partsOrders={appData.partsOrders || {}}
      onOpenRequestParts={(preFill) => setRequestPartsModal({
        isOpen: true,
        preFillUnitId: preFill?.unitId,
        preFillUnitName: preFill?.unitName,
        repairId: preFill?.repairId,
      })}
      onChangePartsStatus={(orderId, newStatus) => {
        // Admin/manager/mechanic can change the status to ANY state
        // (forward or backward). Workers/foremen are read-only — the
        // dropdown doesn't even open for them on the client side, but
        // this gate is the authoritative check.
        if (effectiveRole !== 'admin' && effectiveRole !== 'manager' && effectiveRole !== 'mechanic') {
          showToastMsg(PERMISSION_DENIED);
          return;
        }
        const existing = (appData.partsOrders || {})[orderId];
        if (!existing) return;
        // Picking the current state is a no-op — no audit entry written.
        if (existing.status === newStatus) return;
        const now = Date.now();
        const actor = { email: displayEmail, name: displayName };
        const historyEntry = {
          from: existing.status,
          to: newStatus,
          by: actor,
          at: now,
        };
        const updated: PartsOrder = {
          ...existing,
          status: newStatus,
          statusHistory: [...(existing.statusHistory || []), historyEntry],
        };
        // Stamp the by/at for the NEW state. requestedBy/At are never
        // overwritten — they represent the original creation. When the
        // user moves the order BACK into a state it was in before, the
        // by/at fields are updated to reflect THIS transition (the most
        // recent time the order entered that state).
        if (newStatus === 'ordered') {
          updated.orderedBy = actor;
          updated.orderedAt = now;
        } else if (newStatus === 'arrived') {
          updated.arrivedBy = actor;
          updated.arrivedAt = now;
        }
        const nextOrders = { ...(appData.partsOrders || {}), [orderId]: updated };
        // Recompute partsStatus for the linked task. If multiple parts
        // orders link to the same repair, the task reflects the
        // earliest-stage open order (requested < ordered < arrived);
        // when all are 'arrived' the task shows green. Reverting an
        // 'arrived' order back to 'requested' correctly demotes the
        // task's wrench from green → yellow.
        const nextTasks = existing.repairId
          ? appData.mechanicTasks.map(t => t.id === existing.repairId
              ? { ...t, partsStatus: computePartsStatus(existing.repairId!, nextOrders) }
              : t)
          : appData.mechanicTasks;
        syncToCloud({ ...appData, partsOrders: nextOrders, mechanicTasks: nextTasks });
      }}
      onDeletePartsOrder={(orderId) => {
        if (effectiveRole !== 'admin' && effectiveRole !== 'manager') { showToastMsg(PERMISSION_DENIED); return; }
        const existing = (appData.partsOrders || {})[orderId];
        if (!existing) return;
        const nextOrders = { ...(appData.partsOrders || {}) };
        delete nextOrders[orderId];
        const nextTasks = existing.repairId
          ? appData.mechanicTasks.map(t => t.id === existing.repairId
              ? { ...t, partsStatus: computePartsStatus(existing.repairId!, nextOrders) }
              : t)
          : appData.mechanicTasks;
        syncToCloud({ ...appData, partsOrders: nextOrders, mechanicTasks: nextTasks });
      }}
      canViewPartsOrders={effectiveRole === 'admin' || effectiveRole === 'manager'}
      canChangePartsStatus={effectiveRole === 'admin' || effectiveRole === 'manager' || effectiveRole === 'mechanic'}
      onMarkChunksPaid={(mechanicId, chunkIds) => {
        if (isViewingAs) { showToastMsg('View Only — exit "View As" to make changes.'); return; }
        // Money-out bookkeeping — admin ONLY (stricter than chunk creation,
        // which allows manager too).
        if (!isAdmin) { showToastMsg(PERMISSION_DENIED); return; }
        const chunks = appData.mechanicPayChunks || {};
        const now = Date.now();
        // Idempotent: only stamp CLOSED, currently-UNPAID chunks. Skips
        // the open chunk (never in the id list, but guarded anyway),
        // already-paid chunks (preserve original payer/timestamp), and
        // unknown ids.
        const toStamp = chunkIds.filter(id => {
          const c = chunks[id];
          return !!c && c.status === 'closed' && !c.paidAt;
        });
        if (toStamp.length === 0) { showToastMsg('Nothing to mark — those chunks are already paid.'); return; }
        const nextChunks = { ...chunks };
        for (const id of toStamp) {
          nextChunks[id] = { ...nextChunks[id], paidAt: now, paidBy: displayEmail, paidByName: displayName };
        }
        syncToCloud({ ...appData, mechanicPayChunks: nextChunks });
        const emp = appData.employees.find(e => e.id === mechanicId);
        const stamped = toStamp.map(id => nextChunks[id]);
        const starts = stamped.map(c => c.startTimestamp).filter(Boolean) as number[];
        const ends = stamped.map(c => c.endTimestamp ?? c.startTimestamp).filter(Boolean) as number[];
        const range = starts.length
          ? `${new Date(Math.min(...starts)).toLocaleDateString()} – ${new Date(Math.max(...ends)).toLocaleDateString()}`
          : '';
        logPerfActivity({
          type: 'chunk_marked_paid',
          targetDate: formatTodayInToronto(),
          crewId: 'mechanic-pay',
          crewLabel: emp?.name || mechanicId,
          userId: user?.uid || displayEmail,
          userName: displayName,
          userRole: effectiveRole,
          workerId: mechanicId,
          workerName: emp?.name,
          valueLabel: 'chunks paid',
          valueAfter: toStamp.length,
          reasonNote: `${toStamp.length} chunk${toStamp.length === 1 ? '' : 's'} · $${(toStamp.length * 1000).toLocaleString()}${range ? ` · ${range}` : ''}`,
        });
        showToastMsg(`Marked ${toStamp.length} chunk${toStamp.length === 1 ? '' : 's'} paid ($${(toStamp.length * 1000).toLocaleString()}).`);
      }}
      onUnmarkChunkPaid={(mechanicId, chunkId) => {
        if (isViewingAs) { showToastMsg('View Only — exit "View As" to make changes.'); return; }
        if (!isAdmin) { showToastMsg(PERMISSION_DENIED); return; }
        const chunks = appData.mechanicPayChunks || {};
        const c = chunks[chunkId];
        if (!c || !c.paidAt) { showToastMsg('That chunk is not marked paid.'); return; }
        // Reversal: DELETE the three stamp keys (never set undefined —
        // the syncToCloud scrubber would persist null and the "!paidAt"
        // readers already treat null as unpaid, but deleting keeps the
        // record clean).
        const { paidAt: _pa, paidBy: _pb, paidByName: _pn, ...rest } = c;
        const nextChunks = { ...chunks, [chunkId]: rest };
        syncToCloud({ ...appData, mechanicPayChunks: nextChunks });
        const emp = appData.employees.find(e => e.id === mechanicId);
        logPerfActivity({
          type: 'chunk_payment_reversed',
          targetDate: formatTodayInToronto(),
          crewId: 'mechanic-pay',
          crewLabel: emp?.name || mechanicId,
          userId: user?.uid || displayEmail,
          userName: displayName,
          userRole: effectiveRole,
          workerId: mechanicId,
          workerName: emp?.name,
          valueLabel: 'chunks paid',
          valueAfter: -1,
          reasonNote: `Reversed 1 chunk · $1,000${c.startTimestamp ? ` · ${new Date(c.startTimestamp).toLocaleDateString()}` : ''}`,
        });
        showToastMsg('Payment reversed — chunk is owed again.');
      }}
    />
  );

  const canDeletePerfEntry = (crewId: string): boolean => {
    if (isAdmin || isManager) return true;
    const crew = (appData.schedules[perfDate] || []).find(c => c.id === crewId);
    if (!crew) return false;
    return canForCrew('canEditOwnCrew', effectiveRole, currentUserEmployee, crew);
  };

  const handleDeletePerfEntry = async (crewId: string) => {
    if (isViewingAs) { showToastMsg('View Only — exit "View As" to make changes.'); return; }
    console.info('[perf-delete] click', { date: perfDate, crewId });
    const allowed = canDeletePerfEntry(crewId);
    console.info('[perf-delete] permission', { crewId, allowed });
    if (!allowed) {
      showToastMsg(PERMISSION_DENIED);
      return;
    }
    const savedEntry = appData.performance?.[perfDate]?.[crewId];
    const existing = savedEntry || dailyLogs[crewId];
    if (existing?.approvalStatus === 'approved') {
      console.info('[perf-delete] blocked: approved', { crewId });
      showToastMsg('Approved entries cannot be deleted — unapprove first.');
      return;
    }
    const isAdHoc = !!existing?.isAdHoc;
    const onSchedule = (appData.schedules?.[perfDate] || []).some(c => c.id === crewId);
    const isLocalOnly = !savedEntry;
    const label = existing
      ? `${existing.division || 'crew'} #${existing.crewNumber ?? ''}`.trim()
      : 'this crew';
    const dialog = isAdHoc
      ? `Delete this unscheduled crew entry for ${perfDate}?\n\n(${label})\n\nManually entered BH/AH will be lost.`
      : `Clear all entered BH/AH for ${perfDate}?\n\n(${label})\n\nThe crew is still on the schedule — this resets its performance entry to a fresh draft. Any Jobber-sourced data will return on the next sync.`;
    const confirmed = confirm(dialog);
    console.info('[perf-delete] confirm', { crewId, confirmed, isAdHoc, onSchedule, isLocalOnly });
    if (!confirmed) return;

    // Unsaved entry (only in local dailyLogs, not yet in Firestore):
    // Firestore deleteField on a missing path is a no-op, and the rebuild
    // useEffect won't fire because appData didn't change — the card would
    // appear stuck. Handle it locally instead.
    if (isLocalOnly) {
      console.info('[perf-delete] local-only — removing from dailyLogs without Firestore write');
      setDailyLogs(prev => { const n = { ...prev }; delete n[crewId]; return n; });
      logPerfActivity({
        type: 'entry_deleted',
        targetDate: perfDate,
        crewId,
        crewLabel: label,
        userId: user?.uid || displayEmail,
        userName: displayName,
        userRole: effectiveRole,
      });
      showToastMsg(`Deleted unsaved entry: ${label}`);
      return;
    }

    const ref = doc(db, 'artifacts', appId, 'public', 'data', 'appData', 'main');
    console.info('[perf-delete] writing', {
      path: `performance.${perfDate}.${crewId}`,
      isAdHoc,
      onSchedule,
    });
    try {
      await updateDoc(ref, { [`performance.${perfDate}.${crewId}`]: deleteField() });
      console.info('[perf-delete] write succeeded — snapshot will update local state');
      // Snapshot listener will fire and the dailyLogs-rebuild useEffect
      // will run. For ad-hoc entries the row disappears; for scheduled
      // crews the row stays but with empty BH/AH (fresh draft).
      logPerfActivity({
        type: isAdHoc ? 'entry_deleted' : 'entry_cleared',
        targetDate: perfDate,
        crewId,
        crewLabel: label,
        userId: user?.uid || displayEmail,
        userName: displayName,
        userRole: effectiveRole,
      });
      showToastMsg(
        isAdHoc
          ? `Deleted entry: ${label}`
          : `Cleared data: ${label} (crew remains on schedule)`,
      );
    } catch (err: any) {
      console.error('[perf-delete] write failed', err);
      showToastMsg(`Delete failed: ${err?.message || String(err)}`);
    }
  };

  const renderPerformanceBoard = () => (
    <PerformanceBoard
      performance={appData.performance}
      pushedMonths={appData.pushedMonths || []}
      archivedDays={appData.archivedDays || {}}
      onPushMonth={pushMonth}
      onUnlockDay={unlockDay}
      routes={appData.routes}
      employees={appData.employees}
      startOfWeek={startOfWeek}
      perfTab={perfTab}
      setPerfTab={setPerfTab}
      perfDate={perfDate}
      setPerfDate={setPerfDate}
      reportStartDate={reportStartDate}
      setReportStartDate={setReportStartDate}
      reportEndDate={reportEndDate}
      setReportEndDate={setReportEndDate}
      dailyLogs={dailyLogs}
      setDailyLogs={setDailyLogs}
      routeModalCrewId={routeModalCrewId}
      setRouteModalCrewId={setRouteModalCrewId}
      routeFilters={routeFilters}
      setRouteFilters={setRouteFilters}
      selectedRouteIds={selectedRouteIds}
      setSelectedRouteIds={setSelectedRouteIds}
      onSaveDaily={async () => { await syncToCloud({ ...appData, performance: { ...appData.performance, [perfDate]: dailyLogs } }); showToastMsg("Saved!"); }}
      onPersistCrewDay={async (crewId, log) => {
        // Merge ONE crew-day into saved performance immediately (same merge
        // semantics onSaveDaily / approve / waive use) so unscheduled job /
        // crew additions survive the dailyLogs rebuild without a manual Save.
        // Per-crew merge → never clobbers other crews or other days. Returns
        // the write result so the board can show an honest Saved✓ / error ack.
        const newPerf = { ...appData.performance };
        newPerf[perfDate] = { ...(newPerf[perfDate] || {}), [crewId]: log };
        const ok = await syncToCloud({ ...appData, performance: newPerf });
        return ok !== false;
      }}
      isManager={isManager}
      onApprove={(crewId, log) => {
        if (isViewingAs) { showToastMsg('View Only — exit "View As" to make changes.'); return; }
        if (!can('canApprovePerformance', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
        const approvedLog: PerformanceLog = {
          ...log,
          approvalStatus: 'approved',
          approvedAt: new Date().toISOString(),
          approvedBy: displayEmail,
          approvedByName: displayName,
        };
        const newDailyLogs = { ...dailyLogs, [crewId]: approvedLog };
        setDailyLogs(newDailyLogs);
        const newPerf = { ...appData.performance };
        newPerf[perfDate] = { ...(newPerf[perfDate] || {}), [crewId]: approvedLog };
        syncToCloud({ ...appData, performance: newPerf });
        logPerfActivity({
          type: 'approval_granted',
          targetDate: perfDate,
          crewId,
          crewLabel: `${log.division} #${log.crewNumber}`,
          userId: user?.uid || displayEmail,
          userName: displayName,
          userRole: effectiveRole,
        });
        showToastMsg("Approved & locked.");
      }}
      onUnapprove={(crewId) => {
        if (isViewingAs) { showToastMsg('View Only — exit "View As" to make changes.'); return; }
        if (!can('canApprovePerformance', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
        const log = dailyLogs[crewId];
        if (!log) return;
        const reopenedLog: PerformanceLog = {
          ...log,
          approvalStatus: 'pending',
          approvedAt: undefined,
          approvedBy: undefined,
          approvedByName: undefined,
        };
        const newDailyLogs = { ...dailyLogs, [crewId]: reopenedLog };
        setDailyLogs(newDailyLogs);
        const newPerf = { ...appData.performance };
        newPerf[perfDate] = { ...(newPerf[perfDate] || {}), [crewId]: reopenedLog };
        syncToCloud({ ...appData, performance: newPerf });
        logPerfActivity({
          type: 'approval_revoked',
          targetDate: perfDate,
          crewId,
          crewLabel: `${log.division} #${log.crewNumber}`,
          userId: user?.uid || displayEmail,
          userName: displayName,
          userRole: effectiveRole,
        });
        showToastMsg("Unapproved — fields are editable.");
      }}
      onWaive={(crewId, log, reason) => {
        if (isViewingAs) { showToastMsg('View Only — exit "View As" to make changes.'); return; }
        if (!can('canApprovePerformance', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
        const trimmed = (reason || '').trim();
        if (!trimmed) { showToastMsg('A reason is required to waive.'); return; }
        const waivedLog: PerformanceLog = {
          ...log,
          approvalStatus: 'waived',
          waivedReason: trimmed,
          waivedAt: new Date().toISOString(),
          waivedBy: displayEmail,
          waivedByName: displayName,
          // Clear any prior approval signature so the two states never mix.
          approvedAt: undefined,
          approvedBy: undefined,
          approvedByName: undefined,
        };
        const newDailyLogs = { ...dailyLogs, [crewId]: waivedLog };
        setDailyLogs(newDailyLogs);
        const newPerf = { ...appData.performance };
        newPerf[perfDate] = { ...(newPerf[perfDate] || {}), [crewId]: waivedLog };
        syncToCloud({ ...appData, performance: newPerf });
        logPerfActivity({
          type: 'approval_waived',
          targetDate: perfDate,
          crewId,
          crewLabel: `${log.division} #${log.crewNumber}`,
          userId: user?.uid || displayEmail,
          userName: displayName,
          userRole: effectiveRole,
          reasonNote: trimmed,
        });
        showToastMsg("Waived — no approval required, excluded from bonus.");
      }}
      onUnwaive={(crewId) => {
        if (isViewingAs) { showToastMsg('View Only — exit "View As" to make changes.'); return; }
        if (!can('canApprovePerformance', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
        const log = dailyLogs[crewId];
        if (!log) return;
        const reopenedLog: PerformanceLog = {
          ...log,
          approvalStatus: 'pending',
          waivedReason: undefined,
          waivedAt: undefined,
          waivedBy: undefined,
          waivedByName: undefined,
        };
        const newDailyLogs = { ...dailyLogs, [crewId]: reopenedLog };
        setDailyLogs(newDailyLogs);
        const newPerf = { ...appData.performance };
        newPerf[perfDate] = { ...(newPerf[perfDate] || {}), [crewId]: reopenedLog };
        syncToCloud({ ...appData, performance: newPerf });
        logPerfActivity({
          type: 'approval_revoked',
          targetDate: perfDate,
          crewId,
          crewLabel: `${log.division} #${log.crewNumber}`,
          userId: user?.uid || displayEmail,
          userName: displayName,
          userRole: effectiveRole,
          reasonNote: 'un-waived',
        });
        showToastMsg("Un-waived — fields are editable.");
      }}
      jobberConnected={jobberConnected}
      canSyncJobber={!isViewingAs && can('canTriggerJobberSync', effectiveRole)}
      showToastMsg={showToastMsg}
      canDeleteEntry={canDeletePerfEntry}
      onDeleteEntry={handleDeletePerfEntry}
      multiDayJobs={appData.multiDayJobs || {}}
      appData={appData}
      syncToCloud={syncToCloud}
      canMarkMultiDay={can('canMarkMultiDayCompletion', effectiveRole)}
      canOverrideJobType={can('canOverrideJobType', effectiveRole)}
      defaultDivisionFilter={currentUserEmployee?.managedDivision === 'lawn' ? 'lawn' : currentUserEmployee?.managedDivision === 'small' ? 'small' : currentUserEmployee?.managedDivision === 'large' ? 'large' : 'all'}
      currentUserId={user?.uid || displayEmail}
      currentUserName={displayName}
      currentUserRole={effectiveRole}
      isAdmin={isAdmin}
    />
  );

  const renderBulletinBoard = () => (
    <BulletinBoard
      bulletins={appData.bulletins}
      isAdmin={isAdmin}
      canPost={can('canPostBulletins', effectiveRole)}
      canDelete={can('canDeleteBulletins', effectiveRole)}
      effectiveRole={effectiveRole}
      newTitle={newTitle}
      setNewTitle={setNewTitle}
      newContent={newContent}
      setNewContent={setNewContent}
      audience={bulletinAudience}
      setAudience={setBulletinAudience}
      onPost={() => {
        if (!can('canPostBulletins', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
        if (!newTitle || !newContent) return;
        const nowMs = Date.now();
        const newBulletin: any = {
          id: `b-${nowMs}`,
          title: newTitle,
          content: newContent,
          date: formatDate(new Date()),
          // Millisecond timestamp drives unread-badge math. `date` stays
          // as YYYY-MM-DD for display.
          createdAt: nowMs,
          author: displayEmail,
        };
        if (bulletinAudience.length > 0) newBulletin.audience = bulletinAudience;
        // Bump the poster's own lastReadAt to this bulletin's timestamp so
        // they don't briefly see "1 unread" for their own post before the
        // on-view effect resolves it.
        const nextReads = bulletinReadKey
          ? { ...(appData.bulletinReads || {}), [bulletinReadKey]: nowMs }
          : appData.bulletinReads;
        syncToCloud({ ...appData, bulletins: [newBulletin, ...appData.bulletins], bulletinReads: nextReads });
        setNewTitle(''); setNewContent(''); setBulletinAudience([]);
      }}
      onDelete={(id) => {
        if (!can('canDeleteBulletins', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
        syncToCloud({ ...appData, bulletins: appData.bulletins.filter(x => x.id !== id) });
      }}
    />
  );

  // --- MAIN APP (UNLOCKED PREVIEW MODE) ---
  // Show the loader while auth resolves AND, for a signed-in user, until
  // the first appData snapshot is applied (data-ready). This prevents
  // rendering role/employee-dependent UI against the seed (admin flashing
  // as worker / "no record"). Signed-out users fall through to the login
  // screen immediately (loading cleared on null user; dataLoaded ignored).
  if (loading || (user && !dataLoaded)) return <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white"><Loader2 className="w-8 h-8 animate-spin text-lime-500" /></div>;
  
  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      alert(err.message);
    }
  };

  // Email/password sign-up. SECURITY: the entered email is checked against
  // the authorizedEmails allowlist (server-side, via the checkEmailAuthorized
  // Cloud Function) BEFORE any Firebase account is created. An unauthorized
  // email never reaches createUserWithEmailAndPassword — no account, not even
  // a partial one. Errors propagate to AuthSignUp, which renders them in
  // plain language. authorizedEmails is the single gate; there is no PIN.
  const handleEmailSignUp = async (email: string, password: string) => {
    setAuthRejected(null);
    const normalized = email.trim().toLowerCase();
    const checkEmailAuthorized = httpsCallable<{ email: string }, { authorized: boolean }>(
      functions,
      'checkEmailAuthorized',
    );
    const result = await checkEmailAuthorized({ email: normalized });
    if (!result.data?.authorized) {
      const rejection = new Error(
        "This email isn't authorized. Contact your administrator to be added.",
      ) as Error & { code?: string };
      rejection.code = 'app/not-authorized';
      throw rejection;
    }
    // Allowlist check passed — now create the account and sign the user in.
    // onAuthStateChanged + the appData listener take it to their role-based
    // landing page using the existing Employee/role logic.
    await createUserWithEmailAndPassword(auth, normalized, password);
  };

  // Forgot Password handler — wires the Forgot Password form to
  // Firebase's sendPasswordResetEmail. Email is normalized (trim +
  // lowercase) so a Reset request from a mis-typed casing still
  // hits the right account. Firebase deliberately does NOT throw
  // on unknown emails (privacy — avoid leaking which accounts
  // exist), so the form's success transition is reached for
  // legitimate sends AND for unknown emails. Real errors
  // (network, malformed, rate-limit) bubble up to the form's
  // error state instead of a fake success.
  const handlePasswordReset = async (email: string): Promise<void> => {
    const normalized = normalizeEmail(email);
    await sendPasswordResetEmail(auth, normalized);
  };

  if (!user) return (
    <LoginDemo
      onSubmit={(email, pass) => { setAuthRejected(null); return signInWithEmailAndPassword(auth, email, pass).catch(err => alert(err.message)); }}
      onGoogleSubmit={() => { setAuthRejected(null); handleGoogleLogin(); }}
      onSignUp={handleEmailSignUp}
      onPasswordReset={handlePasswordReset}
      banner={authRejected}
    />
  );


  if (isSystemPrinting) {
    return (
      <div className="bg-white min-h-screen p-8">
        <div className="max-w-4xl mx-auto space-y-12">
          <div className="flex justify-between items-end border-b-4 border-slate-800 pb-4">
            <div>
              <h1 className="text-4xl font-black text-slate-900 tracking-tighter">CREW MASTER</h1>
              <p className="text-xs font-black text-slate-500 uppercase tracking-[0.5em] mt-1">Official Operational Schedule</p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-black text-slate-800 uppercase">{printType === 'daily' ? 'Daily Report' : printType === 'weekly' ? 'Weekly Summary' : 'Operational Report'}</div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Generated: {new Date().toLocaleString()}</div>
            </div>
          </div>
          
          <div className="space-y-10">
            {(() => {
              const crewsToPrint: any[] = [];
              const uniqueIds = new Set<string>();
              if (printType === 'daily') { (appData.schedules[printDailyDate] || []).forEach(c => { if (printSelection.includes(c.id) && !uniqueIds.has(`${printDailyDate}-${c.id}`)) { crewsToPrint.push({ ...c, dateStr: printDailyDate }); uniqueIds.add(`${printDailyDate}-${c.id}`); } }); }
              else if (printType === 'weekly') { weekDays.forEach(d => { const ds = formatDate(d); (appData.schedules[ds] || []).forEach(c => { if (printSelection.includes(c.id) && !uniqueIds.has(`${ds}-${c.id}`)) { crewsToPrint.push({ ...c, dateStr: ds }); uniqueIds.add(`${ds}-${c.id}`); } }); }); }
              else {
                const start = new Date(printDateRange.start); const end = new Date(printDateRange.end);
                for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                  const ds = formatDate(d); (appData.schedules[ds] || []).forEach(c => { if (printSelection.includes(c.id) && !uniqueIds.has(`${ds}-${c.id}`)) { crewsToPrint.push({ ...c, dateStr: ds }); uniqueIds.add(`${ds}-${c.id}`); } });
                }
              }
              return crewsToPrint.map(crew => {
                const emps = crew.employees.map(id => appData.employees.find(e => e.id === id)).filter(Boolean);
                const fleet = crew.fleet.map(id => appData.fleet.find(f => f.id === id)).filter(Boolean);
                const inv = (crew.inventory || []).map(i => ({ name: appData.inventory.find(item => item.id === i.id)?.name || 'Unknown', qty: i.qty }));
                return (
                  <div key={`${crew.dateStr}-${crew.id}`} className="border-2 border-slate-200 rounded-3xl overflow-hidden break-inside-avoid shadow-sm mb-10">
                    <div className="bg-slate-800 text-white p-6 flex justify-between items-center">
                      <div><div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/50 mb-1">{crew.dateStr}</div><h2 className="text-2xl font-black uppercase">{crew.division} <span className="text-green-400">#{crew.crewNumber}</span></h2></div>
                    </div>
                    <div className="p-8 grid grid-cols-2 gap-x-12 gap-y-8">
                      <div className="space-y-4">
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 border-b pb-2 flex items-center gap-2"><Users className="w-4 h-4" /> Personnel</h3>
                        <div className="space-y-2">{emps.map((e: any) => (<div key={e.id} className="flex items-center justify-between text-sm font-bold text-slate-800 border-b border-slate-50 pb-1"><span>{e.name}</span><span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded uppercase">{e.systemRole || 'worker'}</span></div>))}</div>
                      </div>
                      <div className="space-y-4">
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 border-b pb-2 flex items-center gap-2"><Truck className="w-4 h-4" /> Fleet & Equipment</h3>
                        <div className="space-y-2">{fleet.map((f: any) => (<div key={f.id} className="flex items-center justify-between text-sm font-bold text-slate-800 border-b border-slate-50 pb-1"><span>{fleetItemLabel(f)}</span><span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded uppercase">{f.type}</span></div>))}</div>
                      </div>
                      <div className="space-y-4">
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 border-b pb-2 flex items-center gap-2"><Package className="w-4 h-4" /> Inventory</h3>
                        <div className="space-y-2">{inv.length > 0 ? inv.map((i: any, idx: number) => (<div key={idx} className="flex justify-between text-sm font-bold text-slate-800 border-b border-slate-50 pb-1"><span>{i.name}</span><span className="text-green-600">{i.qty} units</span></div>)) : <div className="text-xs text-slate-300 italic font-medium">No inventory assigned</div>}</div>
                      </div>
                      <div className="space-y-4">
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 border-b pb-2 flex items-center gap-2"><Flame className="w-4 h-4" /> Supplies / Tools</h3>
                        <div className="flex flex-wrap gap-2">{crew.supplies && crew.supplies.length > 0 ? crew.supplies.map(s => (<span key={s} className="bg-slate-50 border border-slate-200 px-3 py-1 rounded-lg text-xs font-bold text-slate-600">{s}</span>)) : <div className="text-xs text-slate-300 italic font-medium">Standard kit only</div>}</div>
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100 font-sans overflow-hidden print:overflow-visible print:h-auto print:bg-white relative">
      <style>{`
        @media print {
          body { background: white !important; overflow: visible !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; position: static !important; inset: auto !important; height: auto !important; overflow: visible !important; width: 100% !important; }
          @page { margin: 1cm; }
        }
      `}</style>
      {toast && <div className="fixed top-6 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-6 py-4 rounded-2xl shadow-2xl z-[200] flex items-center gap-3 animate-in slide-in-from-top-4 duration-300"><AlertTriangle className="w-5 h-5 text-lime-400" /><span className="font-bold text-sm">{toast}</span></div>}

      {isViewingAs && (
        <div className="fixed top-0 inset-x-0 bg-amber-500 text-slate-900 px-4 py-2 flex items-center justify-center gap-3 z-[150] shadow-md no-print">
          <Eye className="w-4 h-4" />
          <span className="text-xs font-black uppercase tracking-widest">
            View Only · Viewing as {isImpersonatingIdentity ? displayName : viewAsRole}
            {isImpersonatingIdentity && <span className="ml-1 normal-case font-bold opacity-80">({effectiveRole})</span>}
          </span>
          <button
            onClick={() => { setViewAsRole(null); setViewAsTestUser(false); setViewAsEmployeeId(null); }}
            className="text-[10px] font-black uppercase tracking-widest bg-slate-900 text-amber-300 hover:bg-slate-800 px-3 py-1 rounded"
          >
            Exit to Admin
          </button>
        </div>
      )}

      {/* LEFT SIDEBAR: RESOURCES (desktop only — hidden in weekly schedule view to reclaim width) */}
      <div className={`${crewBuilderMode ? 'fixed inset-0 z-50 flex w-full md:relative md:z-10 md:w-96' : (currentView === 'schedule' && scheduleMode === 'weekly' ? 'hidden' : 'hidden md:flex w-72')} bg-gray-50 border-r border-gray-200 flex-col h-full shadow-lg no-print shrink-0`}>
        {crewBuilderMode && (
          <div className="p-3 bg-amber-50 border-b border-amber-300 shrink-0">
            <button
              onClick={() => setCrewBuilderMode(false)}
              className="w-full min-h-[44px] flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg font-black uppercase text-xs tracking-widest shadow"
            >
              <X className="w-4 h-4" /> Exit Crew Builder
            </button>
            <div className="text-[10px] font-black uppercase tracking-widest text-amber-700 text-center mt-2">
              Crew Builder Mode · {selectedDailyDate}
            </div>
          </div>
        )}
        {!crewBuilderMode && (
        <div className="p-4 bg-white border-b border-gray-200 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-center py-2">
            <img src={logoBlack} alt="Logo" className="h-24 w-auto" />
          </div>
          <TimeMasterWidget
            appData={appData}
            userEmail={displayEmail}
            userName={displayName}
            syncToCloud={syncToCloud}
          />
          <div className="flex flex-col bg-gray-200 rounded-lg p-1 mt-1 gap-1">
            {canAccessView('schedule', effectiveRole) && (
              <button onClick={() => setCurrentView('schedule')} className={`flex items-center justify-between px-3 py-2 text-sm font-bold rounded-md transition-all ${currentView === 'schedule' ? 'bg-white shadow-sm text-green-700' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-300/50'}`}><span className="flex items-center gap-2"><CalendarDays className="w-4 h-4" /> Schedule</span></button>
            )}
            {canAccessView('mechanic', effectiveRole) && (
              <button onClick={() => setCurrentView('mechanic')} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-md transition-all ${currentView === 'mechanic' ? 'bg-white shadow-sm text-green-700' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-300/50'}`}><Wrench className="w-4 h-4" /> MechanicMaster</button>
            )}
            {canAccessView('performance', effectiveRole) && (
              <button onClick={() => setCurrentView('performance')} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-md transition-all ${currentView === 'performance' ? 'bg-white shadow-sm text-emerald-700' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-300/50'}`}><TrendingUp className="w-4 h-4" /> PerformanceMaster</button>
            )}
            {canAccessView('dashboard', effectiveRole) && (
              <button onClick={() => setCurrentView('dashboard')} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-md transition-all ${currentView === 'dashboard' ? 'bg-white shadow-sm text-emerald-700' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-300/50'}`}><LayoutDashboard className="w-4 h-4" /> Dashboard</button>
            )}
            {canAccessView('mycrew', effectiveRole) && !canAccessView('performance', effectiveRole) && (
              <button onClick={() => setCurrentView('mycrew')} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-md transition-all ${currentView === 'mycrew' ? 'bg-white shadow-sm text-lime-600' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-300/50'}`}><TrendingUp className="w-4 h-4" /> My Crew Today</button>
            )}
            {canAccessView('mymechanic', effectiveRole) && (
              <button onClick={() => setCurrentView('mymechanic')} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-md transition-all ${currentView === 'mymechanic' ? 'bg-white shadow-sm text-amber-700' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-300/50'}`}><ClipboardList className="w-4 h-4" /> MyMechanic</button>
            )}
            {canAccessView('timemaster', effectiveRole) && (() => {
              // Combined badge: approver-side pending count + requester-
              // side status-change count. The TimeMaster page exposes both
              // surfaces via tabs (My Logs / All Users / Approvals), so a
              // single icon-level signal is enough.
              const tmBadge = (can('canApproveTimeOff', effectiveRole) ? timeOffPendingForAdminCount : 0) + timeOffStatusChangesForMeCount;
              return (
                <button onClick={() => setCurrentView('timemaster')} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-md transition-all ${currentView === 'timemaster' ? 'bg-white shadow-sm text-emerald-700' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-300/50'}`}>
                  <span className="relative inline-flex">
                    <Clock className="w-4 h-4" />
                    {tmBadge > 0 && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center shadow ring-1 ring-white" aria-label={`${tmBadge} time-off update${tmBadge === 1 ? '' : 's'}`}>
                        {tmBadge > 99 ? '99+' : tmBadge}
                      </span>
                    )}
                  </span>
                  TimeMaster
                </button>
              );
            })()}
            {canAccessView('bulletins', effectiveRole) && (
              <button onClick={() => setCurrentView('bulletins')} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-md transition-all ${currentView === 'bulletins' ? 'bg-white shadow-sm text-lime-600' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-300/50'}`}>
                <span className="relative inline-flex">
                  <Megaphone className="w-4 h-4" />
                  {bulletinUnreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center shadow ring-1 ring-white" aria-label={`${bulletinUnreadCount} unread bulletins`}>
                      {bulletinUnreadCount > 99 ? '99+' : bulletinUnreadCount}
                    </span>
                  )}
                </span>
                Bulletin Board
              </button>
            )}
            {canAccessView('taskmaster', effectiveRole) && (
              <button onClick={() => setCurrentView('taskmaster')} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-md transition-all ${currentView === 'taskmaster' ? 'bg-white shadow-sm text-lime-700' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-300/50'}`}>
                <span className="relative inline-flex">
                  <CheckSquare className="w-4 h-4" />
                  {taskMasterUnreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center shadow ring-1 ring-white" aria-label={`${taskMasterUnreadCount} new tasks`}>
                      {taskMasterUnreadCount > 99 ? '99+' : taskMasterUnreadCount}
                    </span>
                  )}
                </span>
                Tasks
              </button>
            )}
            {canAccessView('rolemaster', effectiveRole) && (
              <button onClick={() => setCurrentView('rolemaster')} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-md transition-all ${currentView === 'rolemaster' ? 'bg-white shadow-sm text-slate-800' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-300/50'}`}>
                <ClipboardList className="w-4 h-4" /> RoleMaster
              </button>
            )}
            {canAccessView('salesmaster', effectiveRole) && (
              <button onClick={() => setCurrentView('salesmaster')} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-md transition-all ${currentView === 'salesmaster' ? 'bg-white shadow-sm text-slate-800' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-300/50'}`}>
                <Calculator className="w-4 h-4" /> SalesMaster
              </button>
            )}
            {canAccessView('schedule', effectiveRole) && canEditSchedule && (
              <button
                onClick={() => {
                  setCurrentView('schedule');
                  setScheduleMode('daily');
                  setCrewBuilderMode(true);
                }}
                className="flex items-center gap-2 px-3 py-2 text-sm font-black rounded-md transition-all bg-lime-600 text-white hover:bg-lime-700 shadow-sm mt-1"
              >
                <Layers className="w-4 h-4" /> Crew Builder
              </button>
            )}
          </div>
          {/* Palermo's Contracting — a separate portal attached below the
              CrewMaster nav, visually distinct (slate/gold). For contractor-
              role users this is the ONLY nav block (the group above is empty). */}
          {canAccessView('contracting', effectiveRole) && (
            <div className="mt-3">
              <div className="border-t-2 border-dashed border-gray-300 mb-2" />
              <div className="rounded-lg p-1.5 shadow-sm" style={{ backgroundColor: '#2E4053' }}>
                <div className="px-2 pt-0.5 pb-1 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5" style={{ color: '#B7950B' }}>
                  <span className="w-4 h-4 rounded-sm flex items-center justify-center text-[10px] font-black" style={{ backgroundColor: '#B7950B', color: '#2E4053' }}>P</span>
                  Palermo's Contracting
                </div>
                <button onClick={() => setCurrentView('contracting')} className="w-full flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-md transition-all" style={currentView === 'contracting' ? { backgroundColor: '#B7950B', color: '#2E4053' } : { color: 'white' }}>
                  <Hammer className="w-4 h-4" /> Contracting Portal
                </button>
              </div>
            </div>
          )}
          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className="flex justify-center items-center gap-2 w-full bg-white border border-gray-300 hover:border-green-500 hover:text-green-600 text-gray-700 px-3 py-2 rounded-lg font-medium shadow-sm transition-all text-sm mt-2 min-h-[44px]"
          >
            <Settings className="w-4 h-4" /> Settings
          </button>
        </div>
        )}

        {currentView === 'schedule' && crewBuilderMode ? (
          <div className={`flex-1 ${crewBuilderMode ? 'flex flex-col p-3 gap-2 overflow-hidden' : 'overflow-y-auto p-4 space-y-4'}`}>
            <div className={crewBuilderMode && sidebarOpen.personnel ? 'flex flex-col flex-1 min-h-[200px]' : 'flex flex-col'}>
              <button
                type="button"
                onClick={() => setSidebarOpen(o => ({ ...o, personnel: !o.personnel }))}
                className="w-full text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center justify-between hover:text-gray-700"
              >
                <span className="flex items-center gap-2"><Users className="w-4 h-4" /> Personnel</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${sidebarOpen.personnel ? '' : '-rotate-90'}`} />
              </button>
              {sidebarOpen.personnel && (
                <>
                  <select
                    value={sidebarCrewFilter}
                    onChange={e => setSidebarCrewFilter(e.target.value as 'All' | PrimaryCrew)}
                    className="w-full mb-2 text-xs font-bold bg-white border border-gray-300 rounded px-2 py-1.5 outline-none"
                  >
                    <option value="All">All crews</option>
                    {PRIMARY_CREWS.map(pc => <option key={pc} value={pc}>{pc}</option>)}
                  </select>
                  <div className={`space-y-1 ${crewBuilderMode ? 'flex-1 overflow-y-auto' : 'max-h-[320px] overflow-y-auto'} pr-1`}>
                    {appData.employees
                      .filter(emp => sidebarCrewFilter === 'All' || emp.primaryCrew === sidebarCrewFilter)
                      .map(emp => renderSidebarItem(emp, 'employee', scheduleMode === 'daily' ? selectedDailyDate : formatDate(currentDate)))}
                  </div>
                </>
              )}
            </div>
            <div className={crewBuilderMode && sidebarOpen.fleet ? 'flex flex-col flex-1 min-h-[200px]' : 'flex flex-col'}>
              <button
                type="button"
                onClick={() => setSidebarOpen(o => ({ ...o, fleet: !o.fleet }))}
                className="w-full text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center justify-between hover:text-gray-700"
              >
                <span className="flex items-center gap-2"><Truck className="w-4 h-4" /> Fleet & Equip</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${sidebarOpen.fleet ? '' : '-rotate-90'}`} />
              </button>
              {sidebarOpen.fleet && (
                <>
                  <select
                    value={sidebarFleetFilter}
                    onChange={e => setSidebarFleetFilter(e.target.value as 'All' | 'truck' | 'trailer' | 'tractor' | 'equipment')}
                    className="w-full mb-2 text-xs font-bold bg-white border border-gray-300 rounded px-2 py-1.5 outline-none capitalize"
                  >
                    <option value="All">All types</option>
                    <option value="truck">Truck</option>
                    <option value="trailer">Trailer</option>
                    <option value="tractor">Tractor</option>
                    <option value="equipment">Equipment</option>
                  </select>
                  <div className={`space-y-1 ${crewBuilderMode ? 'flex-1 overflow-y-auto' : 'max-h-[320px] overflow-y-auto'} pr-1`}>
                    {sortFleetGrouped(
                      appData.fleet.filter(f => sidebarFleetFilter === 'All' || f.type === sidebarFleetFilter),
                      appData.equipmentSubtypes || [],
                    ).map(f => renderSidebarItem(f, 'fleet'))}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4"></div>
        )}

        {/* BOTTOM SIDEBAR */}
        {!crewBuilderMode && (
        <div className="p-4 border-t border-gray-200 bg-white space-y-3">
          <div className="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-200">
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="bg-lime-100 p-1.5 rounded-full"><UserCircle className="w-5 h-5 text-lime-700"/></div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-800 truncate">{displayEmail}</div>
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">{effectiveRole}{isViewingAs ? ' (viewing)' : ''}</div>
              </div>
            </div>
          </div>

          {/* VIEW AS (Visible to real admins only) */}
          {isRealAdmin && (
            <div ref={viewAsMenuRefDesktop} className="relative">
              <button
                type="button"
                onClick={() => setViewAsMenuOpen(o => !o)}
                className="w-full flex items-center justify-between bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 transition-colors"
                aria-haspopup="menu"
                aria-expanded={viewAsMenuOpen}
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">System View:</span>
                  <span className="capitalize truncate max-w-[120px]">{viewAsLabel}</span>
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${viewAsMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {viewAsMenuOpen && (
                <div role="menu" className="absolute left-0 right-0 bottom-full mb-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-30 max-h-[70vh] overflow-y-auto">
                  <div className="px-3 py-1.5 bg-slate-50 text-[8px] font-black uppercase tracking-widest text-slate-400">Roles</div>
                  {([
                    { v: 'admin' as UserRole, label: 'Admin', sub: 'your real role — reset' },
                    { v: 'manager' as UserRole, label: 'Manager', sub: '' },
                    { v: 'foreman' as UserRole, label: 'Foreman', sub: '' },
                    { v: 'worker' as UserRole, label: 'Worker', sub: '' },
                    { v: 'mechanic' as UserRole, label: 'Mechanic', sub: '' },
                  ]).map(opt => {
                    const selected = !isImpersonatingIdentity && (viewAsRole || 'admin') === opt.v;
                    return (
                      <button
                        key={opt.v}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setViewAsTestUser(false);
                          setViewAsEmployeeId(null);
                          setViewAsRole(opt.v === 'admin' ? null : opt.v);
                          setViewAsMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs font-bold flex flex-col gap-0.5 transition-colors ${selected ? 'bg-lime-50 text-lime-700' : 'text-slate-700 hover:bg-slate-50'}`}
                      >
                        <span>{opt.label}</span>
                        {opt.sub && <span className="text-[9px] font-medium tracking-wide text-slate-400 normal-case">{opt.sub}</span>}
                      </button>
                    );
                  })}
                  {/* Test User sentinel grouped with the roles. */}
                  {testUserEmployee && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setViewAsRole(null);
                        setViewAsEmployeeId(null);
                        setViewAsTestUser(true);
                        setViewAsMenuOpen(false);
                        goToImpersonatedHome(resolveRole(testUserEmployee));
                      }}
                      className={`w-full text-left px-3 py-2 text-xs font-bold flex flex-col gap-0.5 transition-colors ${isImpersonatingTestUser ? 'bg-fuchsia-50 text-fuchsia-700' : 'text-slate-700 hover:bg-slate-50'}`}
                    >
                      <span className="flex items-center gap-1.5">
                        Test User
                        <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-700 border border-fuchsia-200">TEST</span>
                      </span>
                      <span className="text-[9px] font-medium tracking-wide text-slate-400 normal-case">full identity — {resolveRole(testUserEmployee)}</span>
                    </button>
                  )}
                  {/* Users — real CrewMaster employees (every role incl.
                      mechanics) from appData.employees. Each adopts that
                      person's identity / populated dashboard (view-only). */}
                  {impersonatableEmployees.length > 0 && (
                    <div className="border-t border-slate-200 px-3 py-1.5 bg-slate-50 text-[8px] font-black uppercase tracking-widest text-slate-400">Users</div>
                  )}
                  {impersonatableEmployees.map(emp => {
                    const selected = viewAsEmployeeId === emp.id;
                    return (
                      <button
                        key={emp.id}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setViewAsRole(null);
                          setViewAsTestUser(false);
                          setViewAsEmployeeId(emp.id);
                          setViewAsMenuOpen(false);
                          goToImpersonatedHome(resolveRole(emp));
                        }}
                        className={`w-full text-left px-3 py-2 text-xs font-bold flex flex-col gap-0.5 transition-colors ${selected ? 'bg-sky-50 text-sky-700' : 'text-slate-700 hover:bg-slate-50'}`}
                      >
                        <span className="truncate">{emp.name || emp.linkedUserEmail || 'Unnamed'}</span>
                        <span className="text-[9px] font-medium tracking-wide text-slate-400 normal-case">{resolveRole(emp)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <button onClick={() => signOut(auth)} className="flex items-center justify-center gap-2 w-full text-sm text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-3 py-2 rounded font-bold transition shadow-sm">
              <LogOut size={16} /> Sign Out
            </button>
          </div>
        </div>
        )}
      </div>

      {/* Main content column — hosts sticky mobile top bar + view + leaves room for bottom nav on mobile */}
      <div className="flex-1 flex flex-col h-full overflow-hidden pb-16 md:pb-0 min-w-0">
        {/* Mobile-only top bar — slim chrome with role chip + sign out + admin actions */}
        <div className="md:hidden sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm flex items-center justify-between gap-2 px-3 py-2 no-print">
          <div className="flex items-center gap-2 min-w-0">
            <div className="bg-lime-100 p-1 rounded-full shrink-0"><UserCircle className="w-5 h-5 text-lime-700"/></div>
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 leading-none">{effectiveRole}</div>
              <div className="text-[11px] font-medium text-slate-600 truncate leading-tight">{displayEmail}</div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isRealAdmin && (
              <div ref={viewAsMenuRefMobile} className="relative">
                <button
                  type="button"
                  onClick={() => setViewAsMenuOpen(o => !o)}
                  aria-label="View As"
                  title={`System View: ${viewAsLabel}`}
                  className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded-lg"
                >
                  <ShieldCheck className="w-5 h-5" />
                </button>
                {viewAsMenuOpen && (
                  <div role="menu" className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-50 min-w-[180px] max-h-[70vh] overflow-y-auto">
                    <div className="px-3 py-1.5 bg-slate-50 text-[8px] font-black uppercase tracking-widest text-slate-400">Roles</div>
                    {(['admin','manager','foreman','worker','mechanic'] as UserRole[]).map(v => {
                      const selected = !isImpersonatingIdentity && (viewAsRole || 'admin') === v;
                      return (
                        <button
                          key={v}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setViewAsTestUser(false);
                            setViewAsEmployeeId(null);
                            setViewAsRole(v === 'admin' ? null : v);
                            setViewAsMenuOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2.5 text-xs font-bold capitalize ${selected ? 'bg-lime-50 text-lime-700' : 'text-slate-700 hover:bg-slate-50'}`}
                        >
                          {v}{v === 'admin' ? ' (real)' : ''}
                        </button>
                      );
                    })}
                    {testUserEmployee && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setViewAsRole(null);
                          setViewAsEmployeeId(null);
                          setViewAsTestUser(true);
                          setViewAsMenuOpen(false);
                          goToImpersonatedHome(resolveRole(testUserEmployee));
                        }}
                        className={`w-full text-left px-3 py-2.5 text-xs font-bold flex items-center gap-1.5 ${isImpersonatingTestUser ? 'bg-fuchsia-50 text-fuchsia-700' : 'text-slate-700 hover:bg-slate-50'}`}
                      >
                        Test User
                        <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-700 border border-fuchsia-200">TEST</span>
                      </button>
                    )}
                    {impersonatableEmployees.length > 0 && (
                      <div className="border-t border-slate-200 px-3 py-1.5 bg-slate-50 text-[8px] font-black uppercase tracking-widest text-slate-400">Users</div>
                    )}
                    {impersonatableEmployees.map(emp => {
                      const selected = viewAsEmployeeId === emp.id;
                      return (
                        <button
                          key={emp.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setViewAsRole(null);
                            setViewAsTestUser(false);
                            setViewAsEmployeeId(emp.id);
                            setViewAsMenuOpen(false);
                            goToImpersonatedHome(resolveRole(emp));
                          }}
                          className={`w-full text-left px-3 py-2.5 text-xs font-bold ${selected ? 'bg-sky-50 text-sky-700' : 'text-slate-700 hover:bg-slate-50'}`}
                        >
                          <span className="truncate block">{emp.name || emp.linkedUserEmail || 'Unnamed'}</span>
                          <span className="text-[9px] font-medium tracking-wide text-slate-400 normal-case">{resolveRole(emp)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => setIsSettingsModalOpen(true)}
              aria-label="Settings"
              title="Settings"
              className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded-lg"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              onClick={() => signOut(auth)}
              aria-label="Sign Out"
              title="Sign Out"
              className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-rose-600 hover:bg-rose-50 rounded-lg"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>

      {currentView === 'mechanic' ? renderMechanicBoard() : currentView === 'performance' ? renderPerformanceBoard() : currentView === 'mymechanic' ? (
        <>
          {/* Mobile-only clock-in bar — the desktop sidebar widget
              is hidden below md, leaving phone users with no path
              to Clock In/Out. Mount the same TimeMasterWidget here
              so mechanics can clock in from their landing screen
              even when MyMechanic's "no linked employee" wall is
              showing (the widget itself doesn't gate on linkage). */}
          <div className="md:hidden shrink-0 px-4 pt-4 bg-gray-100">
            <TimeMasterWidget
              appData={appData}
              userEmail={displayEmail}
              userName={displayName}
              syncToCloud={syncToCloud}
            />
          </div>
          <MyMechanic
            currentUserEmail={displayEmail}
            currentUserEmployee={currentUserEmployee}
            mechanicPayChunks={appData.mechanicPayChunks || {}}
            mechanicTasks={appData.mechanicTasks || []}
            activityLog={appData.activityLog || []}
            timeEntries={appData.timeEntries || []}
            onOpenTask={(taskId) => setMyMechanicTaskId(taskId)}
          />
        </>
      ) : currentView === 'dashboard' ? (
        <Dashboard
          today={formatTodayInToronto()}
          schedules={appData.schedules}
          performance={appData.performance}
          employees={appData.employees}
          settings={appData.settings}
        />
      ) : currentView === 'mycrew' ? (
        <>
          {/* Mobile-only clock-in bar — see the mirror block above
              the MyMechanic mount for the rationale. Workers and
              foremen land on MyCrewToday on mobile and need a path
              to clock in without leaving the page. */}
          <div className="md:hidden shrink-0 px-4 pt-4 bg-gray-100">
            <TimeMasterWidget
              appData={appData}
              userEmail={displayEmail}
              userName={displayName}
              syncToCloud={syncToCloud}
            />
          </div>
          <MyCrewToday
            today={formatTodayInToronto()}
            currentUserEmployee={currentUserEmployee}
            schedules={appData.schedules}
            performance={appData.performance}
            employees={appData.employees}
            fleet={appData.fleet}
            equipmentSubtypes={appData.equipmentSubtypes || []}
            partialTimeOff={appData.partialTimeOff || {}}
            jobberConnected={jobberConnected}
            settings={appData.settings}
            setActiveInspection={setActiveInspection}
            setViewingInspectionId={setViewingInspectionId}
            inspections={appData.inspections}
            onOpenUnitDocuments={(unitId) => setDocumentsUnitId(unitId)}
          onReportRepair={(effectiveRole === 'worker' || effectiveRole === 'foreman' || effectiveRole === 'manager') ? () => setManualTaskModal({
            isOpen: true,
            unitId: '',
            unitName: '',
            category: '',
            description: '',
            severity: 'minor',
            priority: false,
          }) : undefined}
          />
        </>
      ) : currentView === 'timemaster' ? (
        <TimeMaster
          appData={appData}
          // Wrap syncToCloud so any TimeMaster write that touches
          // timeEntries triggers the pay-chunk state machine for
          // every mechanic with an open chunk. Pure transformation:
          // we recompute chunks against the about-to-be-written
          // timeEntries, merge the result into the payload, then
          // forward to the real syncToCloud. No-op if no mechanics
          // have open chunks (no work to do).
          syncToCloud={async (next) => {
            const nextTimeEntries = next.timeEntries || [];
            const nextEmployees = next.employees || appData.employees;
            const startingChunks = next.mechanicPayChunks || appData.mechanicPayChunks || {};
            const affectedEmails = new Set<string>();
            for (const c of Object.values(startingChunks)) {
              if (c && c.status === 'open' && c.mechanicEmail) {
                affectedEmails.add(c.mechanicEmail.toLowerCase());
              }
            }
            let mergedChunks = startingChunks;
            for (const email of affectedEmails) {
              mergedChunks = processPayChunksOnTimeUpdate(
                email,
                mergedChunks,
                nextEmployees,
                nextTimeEntries,
              );
            }
            return syncToCloud({ ...next, mechanicPayChunks: mergedChunks });
          }}
          userEmail={displayEmail}
          userName={displayName}
          currentUserRole={effectiveRole}
          isAdmin={isAdmin}
          canViewAll={can('canViewAllTimeMaster', effectiveRole)}
          canEditAny={can('canEditAnyTimeEntry', effectiveRole)}
          canExportCSV={can('canExportTimeCSV', effectiveRole)}
          showToastMsg={showToastMsg}
          onOpenTimeOffRequest={() => { setEditingTimeOffId(null); setIsTimeOffModalOpen(true); }}
          onEditTimeOffRequest={(requestId) => { setEditingTimeOffId(requestId); setIsTimeOffModalOpen(true); }}
          onCancelTimeOffRequest={cancelTimeOffRequest}
          onRevertTimeOffRequest={revertTimeOffRequest}
          canApproveTimeOff={can('canApproveTimeOff', effectiveRole)}
          timeOffPendingCount={timeOffPendingForAdminCount}
          onApproveTimeOff={approveTimeOffRequest}
          onDenyTimeOff={denyTimeOffRequest}
        />
      ) : currentView === 'bulletins' ? renderBulletinBoard()
        : currentView === 'taskmaster' ? (
        <TaskMaster
          // Admins see every task; managers (and any other future
          // canViewTaskMaster role) only see tasks assigned to them.
          // Filtering is at the render level — storage is untouched.
          tasks={(() => {
            const all = appData.tasks || {};
            if (isAdmin) return all;
            const me = (displayEmail || '').trim().toLowerCase();
            const out: Record<string, TaskMasterTask> = {};
            for (const t of Object.values(all)) {
              if (t && (t.assignedTo?.email || '').toLowerCase() === me) out[t.id] = t;
            }
            return out;
          })()}
          employees={appData.employees || []}
          canCreate={can('canCreateTasks', effectiveRole)}
          currentUserEmail={displayEmail}
          onOpenCreate={() => setIsCreateTaskOpen(true)}
          onOpenTask={(taskId) => setTaskMasterDetailId(taskId)}
          onComplete={(taskId) => {
            const existing = (appData.tasks || {})[taskId];
            if (!existing) return;
            const me = (displayEmail || '').toLowerCase();
            const isAssignee = (existing.assignedTo?.email || '').toLowerCase() === me;
            if (!can('canCreateTasks', effectiveRole) && !isAssignee) { showToastMsg(PERMISSION_DENIED); return; }
            const next: TaskMasterTask = { ...existing, status: 'done', completedAt: Date.now() };
            syncToCloud({ ...appData, tasks: { ...(appData.tasks || {}), [taskId]: next } });
          }}
          // RoleMaster: generated duty instances render in this same list.
          // Admins see all open instances; everyone else sees their own.
          roleInstances={(() => {
            const me = (displayEmail || '').trim().toLowerCase();
            return Object.values(appData.roleTaskInstances || {})
              .filter(i => i.status === 'open')
              .filter(i => isAdmin || (i.assignedTo?.email || '').toLowerCase() === me);
          })()}
          duties={appData.roleMasterDuties || {}}
          responsibilities={appData.roleMasterResponsibilities || {}}
          categoryColors={appData.settings?.roleMasterCategoryColors || {}}
          onOpenRoleInstance={(id) => setRoleInstanceModalId(id)}
        />
      ) : currentView === 'rolemaster' ? (
        <RoleMaster
          roles={appData.roleMasterRoles || {}}
          duties={appData.roleMasterDuties || {}}
          responsibilities={appData.roleMasterResponsibilities || {}}
          templates={appData.roleMasterTemplates || {}}
          policies={appData.roleMasterPolicies || {}}
          policyRequests={appData.roleMasterPolicyRequests || {}}
          instances={appData.roleTaskInstances || {}}
          employees={appData.employees || []}
          isAdmin={isAdmin}
          isManager={isManager}
          currentUser={{ id: displayEmail.toLowerCase(), name: displayName }}
          uploadedBy={{ email: displayEmail, name: displayName }}
          masterEnabled={!!appData.settings?.roleMasterGenerationEnabled}
          onSetMasterEnabled={setRoleMasterMaster}
          onSaveRole={saveRoleMasterRole}
          onSaveDuty={saveRoleMasterDuty}
          onSaveResponsibility={saveRoleMasterResponsibility}
          onSaveTemplate={saveRoleMasterTemplate}
          onDeleteTemplate={deleteRoleMasterTemplate}
          onSavePolicy={saveRoleMasterPolicy}
          onDeletePolicy={deleteRoleMasterPolicy}
          onSavePolicyRequest={saveRoleMasterPolicyRequest}
          onResolvePolicyRequest={resolveRoleMasterPolicyRequest}
          categoryColors={appData.settings?.roleMasterCategoryColors || {}}
          onSetCategoryColor={setRoleCategoryColor}
        />
      ) : currentView === 'salesmaster' ? (
        <SalesMaster
          rates={ratesOrDefault(appData.settings?.salesMaster)}
          quotes={appData.salesMasterQuotes || {}}
          isAdmin={isAdmin}
          currentUser={{ email: displayEmail, name: displayName }}
          onSaveRates={saveSalesRates}
          onSaveQuote={saveSalesQuote}
          onDeleteQuote={deleteSalesQuote}
        />
      ) : currentView === 'contracting' ? (
        <ContractingMaster
          projects={appData.contractingProjects || {}}
          timeEntries={appData.contractingTimeEntries || {}}
          reports={appData.contractingProgressReports || {}}
          invoices={appData.contractingInvoices || {}}
          workOrders={appData.contractingWorkOrders || {}}
          shoppingList={appData.contractingShoppingList || {}}
          employees={appData.employees || []}
          rates={contractingRates}
          properties={contractingProperties}
          suppliers={contractingSuppliers}
          currentUser={contractingUser}
          isAdmin={isAdmin}
          canManage={canManageContracting}
          uploadedBy={{ email: displayEmail, name: displayName }}
          canManageProperties={canManageProperties}
          isPropertyManager={isPropertyManager}
          noticeDays={contractingNoticeDays}
          onSavePropertyDoc={saveContractingPropertyDoc}
          onDeletePropertyDoc={deleteContractingPropertyDoc}
          onSaveRates={saveContractingRates}
          onSaveSuppliers={saveContractingSuppliers}
          onDiscardReport={discardContractingReport}
          onLogEdit={logContractingEdit}
          onSaveProject={saveContractingProject}
          onDeleteProject={deleteContractingProject}
          onArchiveProject={archiveContractingProject}
          onMergePhases={mergeContractingPhases}
          onOpenReport={openContractingReport}
          onEndReport={endContractingReport}
          onSaveReport={saveContractingReport}
          onSaveInvoice={saveContractingInvoice}
          onVoidInvoice={voidContractingInvoice}
          onSaveWorkOrder={saveContractingWorkOrder}
          onDeleteWorkOrder={deleteContractingWorkOrder}
          onSaveShoppingItem={saveContractingShoppingItem}
          onDeleteShoppingItem={deleteContractingShoppingItem}
          personalItems={appData.contractingPersonalItems || {}}
          onSavePersonalItem={saveContractingPersonalItem}
          onDeletePersonalItem={deleteContractingPersonalItem}
          hoursCards={contractorHours}
          myActivePunch={myActivePunch}
          myTodayPunches={myTodayPunches}
          onClockIn={contractorClockIn}
          onClockOut={contractorClockOut}
        />
      ) : (
        <ScheduleBoard
          appData={appData}
          setAppData={setAppData}
          syncToCloud={syncToCloud}
          showToastMsg={showToastMsg}
          scheduleMode={scheduleMode}
          setScheduleMode={setScheduleMode}
          selectedDailyDate={selectedDailyDate}
          setSelectedDailyDate={setSelectedDailyDate}
          crewFilter={crewFilter}
          setCrewFilter={setCrewFilter}
          copiedDay={copiedDay}
          weekDays={weekDays}
          startOfWeek={startOfWeek}
          canEditSchedule={canEditSchedule}
          canManageResources={canManageResources}
          weather={weather}
          getWeatherIcon={getWeatherIcon}
          getWeatherDescription={getWeatherDescription}
          ClassAIcon={ClassAIcon}
          SkidSteerIcon={SkidSteerIcon}
          userEmail={displayEmail}
          userName={displayName}
          isManager={isManager}
          effectiveRole={effectiveRole}
          currentUserEmployee={currentUserEmployee}
          draggingResource={draggingResource}
          clearDrag={onDragEnd}
          setActiveInspection={setActiveInspection}
          setViewingInspectionId={setViewingInspectionId}
          setIsWeatherModalOpen={setIsWeatherModalOpen}
          handlePrevWeek={handlePrevWeek}
          handleNextWeek={handleNextWeek}
          handleToday={handleToday}
          handlePrint={handlePrint}
          handleCopyDay={handleCopyDay}
          handlePasteDay={handlePasteDay}
          addCrewToDay={addCrewToDay}
          jobberUsers={jobberUsers}
          jobberConnected={jobberConnected}
        />
      )}
      </div>

      {/* Mobile bottom nav — fixed, only renders below md, role-gated.
          Items are a uniform shape ({ key, label, Icon, badge, isActive,
          onClick, visible }) so we can mix true view-nav buttons with
          action-only entries (e.g. the worker-only Repair button, which
          opens the ManualTaskModal rather than switching views). */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 h-16 bg-slate-900 border-t border-slate-700 flex items-stretch no-print">
        {(() => {
          // Worker's Repair entry uses the SAME ManualTaskModal the
          // MechanicBoard "Report New Repair" button opens — no new
          // creation path, just a new launcher.
          const openRepairModal = () => setManualTaskModal({
            isOpen: true,
            unitId: '',
            unitName: '',
            category: '',
            description: '',
            severity: 'minor',
            priority: false,
          });
          type NavBtn = {
            key: string;
            label: string;
            Icon: typeof Users;
            badge: number;
            isActive: boolean;
            onClick: () => void;
            visible: boolean;
          };
          const items: NavBtn[] = [
            { key: 'mycrew', label: 'My Crew', Icon: Users, badge: 0,
              isActive: currentView === 'mycrew',
              onClick: () => setCurrentView('mycrew'),
              visible: canAccessView('mycrew', effectiveRole) },
            // MyMechanic — pay-chunk home screen for mechanics. Sits
            // as the leftmost mechanic-only nav item (canAccessView
            // returns true only for role === 'mechanic').
            { key: 'mymechanic', label: 'MyMechanic', Icon: ClipboardList, badge: 0,
              isActive: currentView === 'mymechanic',
              onClick: () => setCurrentView('mymechanic'),
              visible: canAccessView('mymechanic', effectiveRole) },
            { key: 'schedule', label: 'Schedule', Icon: CalendarDays, badge: 0,
              isActive: currentView === 'schedule',
              onClick: () => setCurrentView('schedule'),
              // Mechanic role drops schedule from the bottom nav (they
              // don't run crews) — same rule as the previous implementation.
              visible: canAccessView('schedule', effectiveRole) && effectiveRole !== 'mechanic' },
            // Worker-only Repair launcher. Sits between Schedule and Time
            // so workers see a 5-item nav: My Crew | Schedule | Repair |
            // Time | Bulletin. NOT shown to foreman/admin/manager/mechanic.
            { key: 'repair-action', label: 'Repair', Icon: Wrench, badge: 0,
              isActive: false,
              onClick: openRepairModal,
              visible: effectiveRole === 'worker' },
            { key: 'mechanic', label: 'Mechanic', Icon: Wrench, badge: 0,
              isActive: currentView === 'mechanic',
              onClick: () => setCurrentView('mechanic'),
              visible: canAccessView('mechanic', effectiveRole) },
            { key: 'performance', label: 'Perf', Icon: TrendingUp, badge: 0,
              isActive: currentView === 'performance',
              onClick: () => setCurrentView('performance'),
              visible: canAccessView('performance', effectiveRole) },
            { key: 'dashboard', label: 'Dash', Icon: LayoutDashboard, badge: 0,
              isActive: currentView === 'dashboard',
              onClick: () => setCurrentView('dashboard'),
              visible: canAccessView('dashboard', effectiveRole) },
            { key: 'timemaster', label: 'Time', Icon: Clock,
              badge: (can('canApproveTimeOff', effectiveRole) ? timeOffPendingForAdminCount : 0) + timeOffStatusChangesForMeCount,
              isActive: currentView === 'timemaster',
              onClick: () => setCurrentView('timemaster'),
              visible: canAccessView('timemaster', effectiveRole) },
            { key: 'bulletins', label: 'Bulletin', Icon: Megaphone, badge: bulletinUnreadCount,
              isActive: currentView === 'bulletins',
              onClick: () => setCurrentView('bulletins'),
              visible: canAccessView('bulletins', effectiveRole) },
            { key: 'taskmaster', label: 'Tasks', Icon: CheckSquare, badge: taskMasterUnreadCount,
              isActive: currentView === 'taskmaster',
              onClick: () => setCurrentView('taskmaster'),
              visible: canAccessView('taskmaster', effectiveRole) },
            // Palermo's Contracting portal — mobile entry (shopping list is
            // phone-first, so contractors live here on their phones).
            { key: 'contracting', label: "Palermo's", Icon: Hammer, badge: 0,
              isActive: currentView === 'contracting',
              onClick: () => setCurrentView('contracting'),
              visible: canAccessView('contracting', effectiveRole) },
          ];
          return items.filter(i => i.visible).map(({ key, label, Icon, badge, isActive, onClick }) => (
            <button
              key={key}
              onClick={onClick}
              className={`flex-1 min-w-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors ${isActive ? 'text-lime-400 bg-slate-800' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <span className="relative inline-flex">
                <Icon className="w-5 h-5" />
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center shadow ring-1 ring-slate-900" aria-label={`${badge} unread`}>
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-black uppercase tracking-wider">{label}</span>
            </button>
          ));
        })()}
      </nav>

      {/* SETTINGS MODAL — universal launcher */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        currentUserEmail={displayEmail}
        effectiveRole={effectiveRole}
        onOpenManageTab={openManageTab}
        onSignOut={() => { setIsSettingsModalOpen(false); signOut(auth); }}
        isSuperAdmin={isSuperAdmin}
        onCleanupDuplicateRepairs={handleCleanupDuplicateRepairs}
      />

      {/* DUPLICATE-REPAIR CLEANUP — preview + confirm. A backup of appData
          was already downloaded when this opened. Nothing is removed until
          the user confirms here. */}
      {repairCleanupCtx && (
        <div className="fixed inset-0 bg-black/60 z-[95] flex md:items-center md:justify-center md:p-4">
          <div className="bg-white md:rounded-2xl shadow-2xl w-full md:max-w-md h-full md:h-auto flex flex-col overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">Clean Up Duplicate Repairs</h2>
              <button onClick={() => setRepairCleanupCtx(null)} aria-label="Close" className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4 text-sm text-slate-700">
              <p>
                Found <span className="font-black">{repairCleanupCtx.removeIds.length}</span> duplicate
                repair {repairCleanupCtx.removeIds.length === 1 ? 'entry' : 'entries'} across{' '}
                <span className="font-black">{repairCleanupCtx.groups}</span> {repairCleanupCtx.groups === 1 ? 'repair' : 'repairs'} (same unit, date, notes and cost).
              </p>
              <p className="text-slate-600">
                The earliest entry in each group is kept; the later duplicates are removed.
                A full backup of your data was just downloaded to your device.
              </p>
              <p className="text-[12px] text-rose-600 font-semibold">This cannot be undone (restore from the backup if needed).</p>
            </div>
            <div className="p-5 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
              <button onClick={() => setRepairCleanupCtx(null)} className="px-5 py-2.5 font-bold text-slate-600 hover:bg-slate-200 rounded-lg">Cancel</button>
              <button onClick={confirmCleanupDuplicateRepairs} className="px-6 py-2.5 font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow">Remove {repairCleanupCtx.removeIds.length} duplicate{repairCleanupCtx.removeIds.length === 1 ? '' : 's'}</button>
            </div>
          </div>
        </div>
      )}

      {/* PARTIAL TIME-OFF MODAL — manager/admin entry for a partial-day absence */}
      <PartialTimeOffModal
        isOpen={!!partialTimeOffCtx}
        employeeName={partialTimeOffCtx?.empName || ''}
        dateLabel={partialTimeOffCtx?.dateStr || ''}
        existing={(() => {
          if (!partialTimeOffCtx) return null;
          const p = appData.partialTimeOff?.[partialTimeOffCtx.dateStr]?.find(x => x.empId === partialTimeOffCtx.empId);
          return p ? { start: p.start, end: p.end } : null;
        })()}
        onSave={(s, e) => { if (partialTimeOffCtx) savePartialTimeOff(partialTimeOffCtx.empId, partialTimeOffCtx.dateStr, s, e); }}
        onRemove={() => { if (partialTimeOffCtx) removePartialTimeOff(partialTimeOffCtx.empId, partialTimeOffCtx.dateStr); }}
        onClose={() => setPartialTimeOffCtx(null)}
      />

      {/* MANAGE RESOURCES MODAL */}
      <ManageResourcesModal
        isOpen={isManageModalOpen}
        onClose={() => setIsManageModalOpen(false)}
        manageTab={manageTab}
        setManageTab={setManageTab}
        fleetFilter={fleetFilter}
        setFleetFilter={setFleetFilter}
        localEmployees={localEmployees}
        setLocalEmployees={setLocalEmployees}
        localFleet={localFleet}
        setLocalFleet={setLocalFleet}
        persistedFleet={appData.fleet}
        onOpenUnitDocuments={(unitId) => setDocumentsUnitId(unitId)}
        mechanicPayChunks={appData.mechanicPayChunks || {}}
        contractingRates={contractingRates}
        onCreateInitialChunk={(emp, hoursAlreadyWorked, startTimestamp) => {
          if (!isAdmin && !isManager) { showToastMsg(PERMISSION_DENIED); return; }
          const email = (emp.linkedUserEmail || '').toLowerCase();
          if (!email) { showToastMsg('Link a sign-in email before creating a chunk.'); return; }
          if (typeof emp.hoursPer1000 !== 'number' || emp.hoursPer1000 <= 0) {
            showToastMsg('Set Hours per $1,000 first.');
            return;
          }
          const chunkId = `chunk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const newChunk: MechanicPayChunk = {
            id: chunkId,
            mechanicId: emp.id,
            mechanicEmail: email,
            startTimestamp,
            hoursThreshold: emp.hoursPer1000,
            hoursWorked: hoursAlreadyWorked,
            status: 'open',
            manualBackfill: true,
            manualHoursOffset: hoursAlreadyWorked,
          };
          const nextChunks = { ...(appData.mechanicPayChunks || {}), [chunkId]: newChunk };
          syncToCloud({ ...appData, mechanicPayChunks: nextChunks });
          showToastMsg(`First chunk opened for ${emp.name}.`);
        }}
        localInventory={localInventory}
        setLocalInventory={setLocalInventory}
        localSupplies={localSupplies}
        setLocalSupplies={setLocalSupplies}
        localRoutes={localRoutes}
        setLocalRoutes={setLocalRoutes}
        localPermissions={localPermissions}
        setLocalPermissions={setLocalPermissions}
        localSettings={localSettings}
        setLocalSettings={setLocalSettings}
        localAdmins={localAdmins}
        setLocalAdmins={setLocalAdmins}
        localEquipmentSubtypes={localEquipmentSubtypes}
        setLocalEquipmentSubtypes={setLocalEquipmentSubtypes}
        localPartialTimeOff={localPartialTimeOff}
        setLocalPartialTimeOff={setLocalPartialTimeOff}
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
        currentUserRole={currentUserRole}
        jobberUsersList={jobberUsers}
        showToastMsg={showToastMsg}
        ClassAIcon={ClassAIcon}
        SkidSteerIcon={SkidSteerIcon}
        onSave={async () => {
          // Fleet uniqueness: per category (truck/trailer/tractor) OR per
          // equipment subtype. Items without a unitNumber are skipped
          // (legacy migration grace — warning chip is shown inline).
          // (Note: lucide-react's `Map` icon shadows the global Map class
          // in this file, so we use a plain object keyed by scope#number.)
          const seen: Record<string, FleetItem> = {};
          for (const f of localFleet) {
            if (typeof f.unitNumber !== 'number') continue;
            const scope = f.type === 'equipment'
              ? `equipment:${f.equipmentSubtype || '(no subtype)'}`
              : `${f.type}`;
            const key = `${scope}#${f.unitNumber}`;
            const dup = seen[key];
            if (dup) {
              showToastMsg(`Duplicate Unit #${f.unitNumber} in ${scope.replace('equipment:', '')}: "${dup.name}" and "${f.name}". Fix before saving.`);
              return;
            }
            seen[key] = f;
          }
          // Normalize emails to lowercase before persisting so Firestore rules + client gate
          // can do exact-match comparisons reliably.
          const normalizedEmployees = localEmployees.map(e => ({
            ...e,
            linkedUserEmail: e.linkedUserEmail ? normalizeEmail(e.linkedUserEmail) : e.linkedUserEmail,
            email: e.email ? normalizeEmail(e.email) : e.email,
          }));
          // Authorized-emails save = a 3-way merge, NOT a wholesale
          // overwrite. localAdmins was captured when the modal opened and
          // may be stale (another admin could have added someone since).
          // Overwriting with it would silently drop that person and kick
          // them out at the next snapshot. Instead, compute only THIS
          // admin's intentional deltas (added / removed vs. the baseline
          // loaded at modal-open) and apply them on top of the LATEST
          // server list. Net effect: untouched lists pass the live list
          // through unchanged; concurrent additions by others survive;
          // the admin's own add/remove still take effect.
          const baseline = localAdminsBaselineRef.current; // normalized at modal-open
          const current = localAdmins.map(e => normalizeEmail(e)).filter(Boolean);
          const baselineSet = new Set(baseline);
          const currentSet = new Set(current);
          const added = current.filter(e => !baselineSet.has(e));
          const removed = baseline.filter(e => !currentSet.has(e));
          const removedSet = new Set(removed);
          const latest = (appData.authorizedEmails || []).map(e => normalizeEmail(e)).filter(Boolean);
          const merged = new Set(latest);
          for (const e of added) merged.add(e);
          for (const e of removedSet) merged.delete(e);
          const normalizedAdmins = Array.from(merged).sort();

          // Validate pre-scheduled partial time-off drafts and rebuild the keyed map.
          // A row touched but not fully filled is a save-blocker; an entirely blank
          // row is treated as a cancelled draft and silently dropped.
          for (const p of localPartialTimeOff) {
            const touched = !!(p.date || p.start || p.end);
            const complete = !!(p.date && p.start && p.end);
            if (touched && !complete) {
              showToastMsg('Partial time off needs a date, start, and end. Complete the row or remove it.');
              return;
            }
            if (complete && p.end <= p.start) {
              showToastMsg('Partial time off: end time must be after start time.');
              return;
            }
          }
          const ptoMap: Record<string, PartialTimeOff[]> = {};
          for (const p of localPartialTimeOff) {
            if (!p.date || !p.start || !p.end) continue;
            if (!ptoMap[p.date]) ptoMap[p.date] = [];
            ptoMap[p.date].push({ id: p.id, empId: p.empId, start: p.start, end: p.end });
          }

          // Fix 1 — for any hour-tracked equipment whose
          // currentEngineHours changed during this edit session, run
          // the maintenance spawn helper. This mirrors what the Fleet
          // List inline-edit Save button does; without it, ongoing
          // hour updates entered in the setup form would persist
          // without ever surfacing a due-soon / overdue task.
          let fleetAfterSpawn = localFleet;
          let tasksAfterSpawn = appData.mechanicTasks;
          for (const unit of localFleet) {
            if (unit.type !== 'equipment') continue;
            if (!unit.tracksEngineHours) continue;
            if (unit.isWinterized) continue;
            if (typeof unit.currentEngineHours !== 'number') continue;
            const prior = appData.fleet.find(p => p.id === unit.id);
            const priorHrs = prior && typeof prior.currentEngineHours === 'number' ? prior.currentEngineHours : null;
            if (priorHrs === unit.currentEngineHours) continue; // unchanged
            const { items, mechanicTasks: nextTasks } = processMaintenanceForHourUpdate(unit, tasksAfterSpawn);
            const updatedUnit: FleetItem = {
              ...unit,
              maintenanceItems: items,
              // Stamp lastHourUpdateAt so the Missing Hour Updates banner
              // resets — the setup-form save counts as a real reading.
              lastHourUpdateAt: Date.now(),
            };
            fleetAfterSpawn = fleetAfterSpawn.map(f => f.id === unit.id ? updatedUnit : f);
            tasksAfterSpawn = nextTasks;
          }
          // Truck maintenance (auto, no toggle) — surface any item
          // whose nextDueKm is already at/past the unit's odometer
          // immediately. Helper is idempotent (activeTaskId guard)
          // and skips unconfigured items (nextDueAt <= 0), so we
          // don't need a "did the odometer change" gate. When the
          // mechanic edited the odometer in this modal, stamp
          // lastOdometerUpdate so the Missing Odo banner resets —
          // mirrors what the Fleet List inline save does.
          for (const unit of fleetAfterSpawn) {
            if (!isKmMaintenanceUnit(unit)) continue;
            if (unit.isWinterized) continue;
            const prior = appData.fleet.find(p => p.id === unit.id);
            const odoChanged = prior?.odometer !== unit.odometer;
            const { items, mechanicTasks: nextTasks } = processMaintenanceForOdometerUpdate(unit, tasksAfterSpawn);
            const updatedUnit: FleetItem = {
              ...unit,
              maintenanceItems: items,
              ...(odoChanged ? { lastOdometerUpdate: formatDate(new Date()) } : {}),
            };
            fleetAfterSpawn = fleetAfterSpawn.map(f => f.id === unit.id ? updatedUnit : f);
            tasksAfterSpawn = nextTasks;
          }
          // Equipment Time Off sweep — for every fleet unit, take
          // the union of its awayDates ranges and strip the unit id
          // from any crew assigned on those dates. Mirrors the
          // employee approveTimeOffRequest auto-remove (App.tsx
          // ~1287) but applied at modal-save time since fleet uses
          // direct admin entry, not a request/approval flow.
          // Idempotent: re-running with the same ranges produces
          // the same nextSchedules.
          let nextSchedules: Record<string, Crew[]> = { ...(appData.schedules || {}) };
          for (const unit of fleetAfterSpawn) {
            const ranges = unit.awayDates || [];
            if (ranges.length === 0) continue;
            const dates = new Set<string>();
            for (const r of ranges) {
              if (!r.start || !r.end) continue;
              for (const d of eachDateInRange(r.start, r.end)) dates.add(d);
            }
            for (const d of dates) {
              const day = nextSchedules[d];
              if (!day) continue;
              nextSchedules[d] = day.map(crew => ({ ...crew, fleet: crew.fleet.filter(id => id !== unit.id) }));
            }
          }
          // Unit documents are managed out-of-band (UnitDocumentsModal
          // writes them straight to appData.fleet). This modal's draft
          // (localFleet, captured at open) never edits `documents`, so
          // preserve the LIVE array — otherwise a save here would clobber a
          // document uploaded during this editing session.
          fleetAfterSpawn = fleetAfterSpawn.map(u => {
            const live = appData.fleet.find(p => p.id === u.id);
            return live ? { ...u, documents: live.documents } : u;
          });
          const success = await syncToCloud({
            ...appData,
            employees: normalizedEmployees,
            fleet: fleetAfterSpawn,
            mechanicTasks: tasksAfterSpawn,
            routes: localRoutes,
            authorizedEmails: normalizedAdmins,
            inventory: localInventory,
            supplies: localSupplies,
            rolePermissions: localPermissions,
            settings: localSettings,
            equipmentSubtypes: localEquipmentSubtypes,
            partialTimeOff: ptoMap,
            schedules: nextSchedules,
          });
          if (success) {
            setIsManageModalOpen(false);
            showToastMsg("System Resources updated successfully!");
          }
        }}
      />

      {/* REPAIR LOG MODAL */}
      <RepairModal
        state={repairModal}
        setState={setRepairModal}
        onConfirm={handleRepairComplete}
        isSubmitting={isLoggingRepair}
      />

      {/* MANUAL TASK MODAL */}
      <ManualTaskModal
        state={manualTaskModal}
        setState={setManualTaskModal}
        fleet={appData.fleet}
        employees={appData.employees || []}
        defaultReporterId={currentUserEmployee?.id}
        uploaderEmail={displayEmail}
        uploaderName={displayName}
        onSubmit={async () => {
          // Resolve the reporter (defaults to the enterer's employee record).
          const reporterId = (manualTaskModal as any).reportedByEmployeeId || currentUserEmployee?.id;
          const reporterEmp = (appData.employees || []).find(e => e.id === reporterId);
          const reportedBy = reporterEmp
            ? { employeeId: reporterEmp.id, name: reporterEmp.name || displayName }
            : { employeeId: currentUserEmployee?.id || '', name: displayName };
          const photos = manualTaskModal.photos || [];
          const newTask: MechanicTask = {
            // Reuse the draft id the modal minted so report-time photos
            // (already uploaded to repairs/{draftId}) match the task.
            id: manualTaskModal.draftId || `task-${Date.now()}`,
            unitId: manualTaskModal.unitId || undefined,
            unitName: manualTaskModal.unitName,
            category: manualTaskModal.category,
            description: manualTaskModal.description,
            notes: [],
            severity: manualTaskModal.severity as any,
            status: 'todo',
            dateReported: formatDate(new Date()),
            reportedBy,
            activity: [],
            priority: !!manualTaskModal.priority,
            ...(photos.length ? { photos } : {}),
          };
          const act = makeActivity('created', newTask, { source: 'manual' });
          newTask.activity = [act];
          const success = await syncToCloud({
            ...appData,
            mechanicTasks: [newTask, ...appData.mechanicTasks],
            activityLog: [act, ...(appData.activityLog || [])]
          });
          if (success) {
            setManualTaskModal({ isOpen: false, unitId: '', unitName: '', category: '', description: '', severity: 'minor', priority: false });
            showToastMsg("Repair task added to board.");
          }
        }}
      />

      {/* UNIT DOCUMENTS MODAL — per-unit documents (insurance / registration
          / ownership / safety inspection) with expiry states + service
          history. Metadata rides on the fleet record; bytes in Storage at
          fleet/{unitId}/{docType}/. Admin + manager edit; workers view-only. */}
      {documentsUnitId && (() => {
        const unit = appData.fleet.find(f => f.id === documentsUnitId);
        if (!unit) return null;
        return (
          <UnitDocumentsModal
            unit={unit}
            repairLog={appData.repairLog || []}
            canEdit={isManager}
            uploadedBy={{ email: displayEmail, name: displayName }}
            onClose={() => setDocumentsUnitId(null)}
            onSave={(unitId, documents) => {
              // Metadata-only write onto the existing fleet record. No pay/
              // performance/RoleMaster paths; bytes already live in Storage.
              const nextFleet = appData.fleet.map(f => f.id === unitId ? { ...f, documents } : f);
              syncToCloud({ ...appData, fleet: nextFleet });
            }}
          />
        );
      })()}

      {/* REQUEST PARTS MODAL — opened from the top of the Repair Board
          (generic, no repair linkage) or from a repair card's green
          "Parts" button (prefilled unit + repairId set on submit). */}
      <RequestPartsModal
        state={requestPartsModal}
        onClose={() => setRequestPartsModal({ isOpen: false })}
        fleet={appData.fleet}
        onSubmit={async (payload: RequestPartsSubmit) => {
          if (!can('canCreateRepairs', effectiveRole)) {
            showToastMsg(PERMISSION_DENIED);
            return;
          }
          const orderId = `pord-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const order: PartsOrder = {
            id: orderId,
            partName: payload.partName,
            quantity: payload.quantity,
            status: 'requested',
            requestedBy: { email: displayEmail, name: displayName },
            requestedAt: Date.now(),
          };
          if (payload.unitId) order.unitId = payload.unitId;
          if (payload.unitName) order.unitName = payload.unitName;
          if (payload.notes) order.notes = payload.notes;
          if (payload.repairId) order.repairId = payload.repairId;
          const nextOrders = { ...(appData.partsOrders || {}), [orderId]: order };
          // If this request is linked to a repair, set that repair's
          // partsStatus so the card's wrench icon picks up the new
          // 'requested' state immediately (the live snapshot will
          // also reflect via computePartsStatus on subsequent changes).
          const nextTasks = payload.repairId
            ? appData.mechanicTasks.map(t => t.id === payload.repairId
                ? { ...t, partsStatus: computePartsStatus(payload.repairId!, nextOrders) }
                : t)
            : appData.mechanicTasks;
          const success = await syncToCloud({
            ...appData,
            partsOrders: nextOrders,
            mechanicTasks: nextTasks,
          });
          if (success) {
            setRequestPartsModal({ isOpen: false });
            showToastMsg(payload.repairId
              ? `Parts requested for repair — order tracked in Parts Orders.`
              : `Parts request submitted — tracked in Parts Orders.`);
          }
        }}
      />

      {/* WEATHER MODAL */}
      <WeatherModal
        isOpen={isWeatherModalOpen}
        onClose={() => setIsWeatherModalOpen(false)}
        weekDays={weekDays}
        weather={weather}
        getWeatherIcon={getWeatherIcon}
        getWeatherDescription={getWeatherDescription}
      />

      {/* GENERAL AI MODAL */}
      <AIInsightModal
        isOpen={aiModal.isOpen}
        title={aiModal.title}
        content={aiModal.content}
        isLoading={aiModal.isLoading}
        onClose={() => setAiModal({ ...aiModal, isOpen: false })}
      />


      {/* PRINT SELECTION MODAL */}
      <PrintModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        printType={printType}
        setPrintType={setPrintType}
        printDateRange={printDateRange}
        setPrintDateRange={setPrintDateRange}
        printSelection={printSelection}
        setPrintSelection={setPrintSelection}
        schedules={appData.schedules}
        selectedDailyDate={printDailyDate}
        setSelectedDailyDate={setPrintDailyDate}
        weekDays={weekDays}
        onPrint={() => {
          setIsPrintModalOpen(false);
          setIsSystemPrinting(true);
          setTimeout(() => {
            window.print();
            setIsSystemPrinting(false);
          }, 500);
        }}
      />
      {/* INSPECTION MODAL */}
      <InspectionModal
        state={activeInspection}
        setState={setActiveInspection}
        fleet={appData.fleet}
        showToastMsg={showToastMsg}
        onSubmit={async (unit, type) => {
          const odoEl = document.getElementById('insp-odo') as HTMLInputElement | null;
          const reading = odoEl ? Number(odoEl.value) : 0;
          const loc = (document.getElementById('insp-loc') as HTMLInputElement).value;
          const sig = (document.getElementById('insp-sig') as HTMLInputElement).value;

          // Handle potentially unsaved draft defect
          let finalDefects = [...activeInspection.defects];
          if (activeInspection.expandedCategory && activeInspection.draftNotes) {
            const draftDefect: DefectDetail = {
              category: activeInspection.expandedCategory,
              severity: activeInspection.draftSeverity,
              notes: activeInspection.draftNotes
            };
            finalDefects = [...finalDefects.filter(d => d.category !== activeInspection.expandedCategory), draftDefect];
          }

          const hasMajor = finalDefects.some(d => d.severity === 'major');

          if (!sig) return showToastMsg("Signature required.");

          // ---- Reading guards (lower-than-last, big-jump) -----------------
          // Trailers don't capture a numeric reading — skip both guards.
          // Hour-tracked units validate against currentEngineHours with
          // the hour threshold; km units against odometer with the km
          // threshold. The (confirmed) reading then flows through the
          // normal maintenance recompute below, so override only means
          // "yes this reading is intended" — it never bypasses the
          // oil-change trigger.
          const hourUnit = isHourMaintenanceUnit(unit);
          const kmUnit = isKmMaintenanceUnit(unit) || (type !== 'Trailer' && !hourUnit);
          const metric: 'hours' | 'km' = hourUnit ? 'hours' : 'km';
          const unitLabel = hourUnit ? 'hrs' : 'km';
          const baseline: number | null = type === 'Trailer'
            ? null
            : hourUnit
              ? (typeof unit.currentEngineHours === 'number' ? unit.currentEngineHours : null)
              : (typeof unit.odometer === 'number' ? unit.odometer : null);
          let readingOverride: Inspection['readingOverride'] | undefined;
          if (type !== 'Trailer' && baseline !== null && Number.isFinite(reading)) {
            if (reading < baseline) {
              const proceed = window.confirm(
                `This is lower than the last reading (${baseline} ${unitLabel}). ` +
                "Readings shouldn't decrease.\n\n" +
                "OK = Override (it's correct)\n" +
                'Cancel = Fix it'
              );
              if (!proceed) return;
              readingOverride = {
                type: 'lower',
                metric,
                enteredValue: reading,
                lastValue: baseline,
                overriddenBy: { email: displayEmail, name: displayName },
                at: new Date().toISOString(),
              };
            } else {
              const threshold = hourUnit ? ENGINE_HOURS_JUMP_WARN : ODOMETER_JUMP_WARN_KM;
              const delta = reading - baseline;
              if (delta > threshold) {
                const proceed = window.confirm(
                  `This is ${delta} ${unitLabel} more than the last reading ` +
                  `(${baseline} ${unitLabel}) — that's a large jump. Is this correct?\n\n` +
                  'OK = Override (proceed)\n' +
                  'Cancel = Fix it'
                );
                if (!proceed) return;
                readingOverride = {
                  type: 'jump',
                  metric,
                  enteredValue: reading,
                  lastValue: baseline,
                  overriddenBy: { email: displayEmail, name: displayName },
                  at: new Date().toISOString(),
                };
              }
            }
          }

          if (hasMajor) {
            if (!confirm("This report contains a MAJOR DEFECT. The unit will be marked OUT OF SERVICE. Continue?")) return;
          }

          const newInsp: Inspection = {
            id: `insp-${Date.now()}`,
            unitId: unit.id,
            driverId: user.uid,
            driverName: displayName,
            inspectorEmail: displayEmail,
            inspectorName: displayName,
            type,
            date: activeInspection.targetDate || formatDate(new Date()),
            timestamp: new Date().toISOString(),
            odometer: reading,
            location: loc,
            defects: finalDefects,
            isMajor: hasMajor,
            signature: sig,
            status: hasMajor ? 'major' : finalDefects.length > 0 ? 'minor' : 'clean',
            ...(readingOverride ? { readingOverride } : {}),
          };

          const newInspections = [newInsp, ...appData.inspections];

          // Process Defects into Mechanic Tasks (with activity entries)
          let newTasks = [...appData.mechanicTasks];
          const spawnedActivity: TaskActivity[] = [];
          finalDefects.forEach(d => {
            // Dedup: only add if no active task for this unit and category exists
            const exists = newTasks.find(t => t.unitId === unit.id && t.category === d.category && t.status !== 'done');
            if (!exists) {
              const newTask: MechanicTask = {
                id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                unitId: unit.id,
                unitName: unit.name,
                category: d.category,
                description: d.notes,
                notes: [],
                severity: d.severity,
                status: 'todo',
                dateReported: formatDate(new Date()),
                inspectionId: newInsp.id,
                activity: []
              };
              const act = makeActivity('created', newTask, { source: 'inspection', sourceRefId: newInsp.id });
              newTask.activity = [act];
              spawnedActivity.push(act);
              newTasks.push(newTask);
            }
          });

          // Build the updated unit. Hour-tracked units capture engine
          // hours; km units capture odometer; trailers capture neither.
          // Inspection status / OOS / repairTags are uniform across types.
          const baseFleetUpdate = (f: FleetItem): FleetItem => ({
            ...f,
            ...(type === 'Trailer'
              ? {}
              : hourUnit
                ? { currentEngineHours: reading, lastHourUpdateAt: Date.now() }
                : { odometer: reading, lastOdometerUpdate: formatDate(new Date()) }),
            lastInspectionId: newInsp.id,
            inspectionStatus: (hasMajor ? 'red' : finalDefects.length > 0 ? 'yellow' : 'green') as 'green' | 'yellow' | 'red' | 'missing',
            status: hasMajor ? 'Out of Service' : (f.status === 'Out of Service' ? 'Active' : f.status),
            repairTags: Array.from(new Set([...(f.repairTags || []), ...finalDefects.map(d => d.category), ...(hasMajor ? ['priority'] : [])]))
          } as FleetItem);

          let updatedUnit = baseFleetUpdate(unit);

          // Run the maintenance spawn helper on the updated unit so an
          // inspection-captured reading crossing an oil-change interval
          // surfaces (or promotes) a Repair Board task. Helper is
          // idempotent (activeTaskId guard) and bails out for the wrong
          // unit type or winterized units, so it's safe to call
          // unconditionally for non-trailers.
          if (hourUnit && !updatedUnit.isWinterized) {
            const { items, mechanicTasks: nextTasks } = processMaintenanceForHourUpdate(updatedUnit, newTasks);
            updatedUnit = { ...updatedUnit, maintenanceItems: items };
            newTasks = nextTasks;
          } else if (kmUnit && type !== 'Trailer' && !updatedUnit.isWinterized) {
            const { items, mechanicTasks: nextTasks } = processMaintenanceForOdometerUpdate(updatedUnit, newTasks);
            updatedUnit = { ...updatedUnit, maintenanceItems: items };
            newTasks = nextTasks;
          }

          const newFleet = appData.fleet.map(f => f.id === unit.id ? updatedUnit : f);

          const success = await syncToCloud({
            ...appData,
            fleet: newFleet,
            inspections: newInspections,
            mechanicTasks: newTasks,
            activityLog: [...spawnedActivity, ...(appData.activityLog || [])]
          });
          if (success) {
            setActiveInspection({ unitId: null, targetDate: '', defects: [], expandedCategory: null, draftSeverity: 'minor', draftNotes: '' });
            showToastMsg("Inspection completed successfully!");
          }
        }}
      />

      {/* INSPECTION REPORT MODAL */}
      <InspectionReportModal
        inspectionId={viewingInspectionId}
        onClose={() => setViewingInspectionId(null)}
        inspections={appData.inspections}
        fleet={appData.fleet}
      />

      {/* TIME-OFF REQUEST MODAL — used for both new submission and
          editing a pending request (when editingTimeOffId is set). */}
      <RequestTimeOffModal
        isOpen={isTimeOffModalOpen}
        editingRequest={editingTimeOffId ? (appData.timeOffRequests || {})[editingTimeOffId] || null : null}
        requesterName={currentUserEmployee?.name || displayName}
        onClose={() => { setIsTimeOffModalOpen(false); setEditingTimeOffId(null); }}
        onSubmit={(data: RequestTimeOffSubmit) => submitTimeOffRequest(data)}
      />

      {/* TASKMASTER MODALS — create + detail. Detail re-resolves the
          task by id every render so status/note edits don't close it. */}
      <CreateTaskModal
        isOpen={isCreateTaskOpen}
        employees={appData.employees || []}
        onClose={() => setIsCreateTaskOpen(false)}
        onSubmit={(data: CreateTaskSubmit) => {
          if (!can('canCreateTasks', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
          const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const me = (displayEmail || '').trim().toLowerCase();
          const now = Date.now();
          const newTask: TaskMasterTask = {
            id,
            title: data.title,
            description: data.description || undefined,
            assignedTo: data.assignedTo,
            createdBy: { email: displayEmail, name: displayName },
            createdAt: now,
            dueDate: data.dueDate || undefined,
            priority: data.priority,
            status: 'not_started',
            notes: [],
            // Author has implicitly "acknowledged" their own creation.
            acknowledgedBy: { [me]: now },
          };
          syncToCloud({ ...appData, tasks: { ...(appData.tasks || {}), [id]: newTask } });
          setIsCreateTaskOpen(false);
          showToastMsg('Task created.');
        }}
      />
      <TaskDetailModal
        task={taskMasterDetailId ? (appData.tasks || {})[taskMasterDetailId] || null : null}
        employees={appData.employees || []}
        currentUserEmail={displayEmail}
        canEditAnyField={can('canCreateTasks', effectiveRole)}
        canDelete={can('canCreateTasks', effectiveRole)}
        onClose={() => setTaskMasterDetailId(null)}
        onUpdate={(taskId, patch) => {
          if (!can('canCreateTasks', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
          const existing = (appData.tasks || {})[taskId];
          if (!existing) return;
          const merged: TaskMasterTask = { ...existing, ...patch };
          // `dueDate: undefined` patch means "clear it" — drop the field.
          if (patch.dueDate === undefined && Object.prototype.hasOwnProperty.call(patch, 'dueDate')) {
            delete (merged as any).dueDate;
          }
          syncToCloud({ ...appData, tasks: { ...(appData.tasks || {}), [taskId]: merged } });
        }}
        onStatusChange={(taskId, status) => {
          const existing = (appData.tasks || {})[taskId];
          if (!existing) return;
          const me = (displayEmail || '').toLowerCase();
          const isAssignee = (existing.assignedTo?.email || '').toLowerCase() === me;
          if (!can('canCreateTasks', effectiveRole) && !isAssignee) { showToastMsg(PERMISSION_DENIED); return; }
          const next: TaskMasterTask = { ...existing, status };
          if (status === 'done') next.completedAt = Date.now();
          else delete (next as any).completedAt;
          syncToCloud({ ...appData, tasks: { ...(appData.tasks || {}), [taskId]: next } });
        }}
        onAddNote={(taskId, text) => {
          const existing = (appData.tasks || {})[taskId];
          if (!existing) return;
          const me = (displayEmail || '').toLowerCase();
          const isAssignee = (existing.assignedTo?.email || '').toLowerCase() === me;
          // Admins + assignee can comment. Could broaden later.
          if (!can('canCreateTasks', effectiveRole) && !isAssignee) { showToastMsg(PERMISSION_DENIED); return; }
          const note: TaskMasterNote = {
            id: `tnote-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            author: { email: displayEmail, name: displayName },
            text,
            createdAt: Date.now(),
          };
          const next: TaskMasterTask = { ...existing, notes: [...(existing.notes || []), note] };
          syncToCloud({ ...appData, tasks: { ...(appData.tasks || {}), [taskId]: next } });
        }}
        onDelete={(taskId) => {
          if (!can('canCreateTasks', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
          const map = { ...(appData.tasks || {}) };
          delete map[taskId];
          syncToCloud({ ...appData, tasks: map });
          setTaskMasterDetailId(null);
          showToastMsg('Task deleted.');
        }}
      />

      {/* ROLEMASTER INSTANCE MODAL — SOP + required note completion, skip,
          void (admin), reassign (admin), and batch catch-up of a duty's
          outstanding instances. */}
      {roleInstanceModalId && (() => {
        const inst = (appData.roleTaskInstances || {})[roleInstanceModalId];
        if (!inst) return null;
        const duty = (appData.roleMasterDuties || {})[inst.dutyId];
        const role = (appData.roleMasterRoles || {})[inst.roleId];
        const outstanding = Object.values(appData.roleTaskInstances || {})
          .filter(i => i.dutyId === inst.dutyId && i.status === 'open')
          .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));
        return (
          <RoleInstanceModal
            instance={inst}
            duty={duty}
            roleName={role?.name}
            outstanding={outstanding}
            employees={appData.employees || []}
            isAdmin={isAdmin}
            responsibilities={appData.roleMasterResponsibilities || {}}
            categoryColors={appData.settings?.roleMasterCategoryColors || {}}
            onClose={() => setRoleInstanceModalId(null)}
            onComplete={(note) => completeRoleInstance(inst.id, note)}
            onSkip={(reason) => skipRoleInstance(inst.id, reason)}
            onVoid={(reason) => voidRoleInstance(inst.id, reason)}
            onReassign={(empId) => reassignRoleInstance(inst.id, empId)}
            onBatchComplete={(ids, note) => batchCompleteRoleInstances(ids, note)}
          />
        );
      })()}

      {/* MYMECHANIC TASK DETAIL MODAL — opens in place over MyMechanic.
          Looks up the live task by id every render so status/assignee/notes
          changes from this modal (or anywhere else) reflect immediately
          without closing. */}
      <MyMechanicTaskModal
        task={myMechanicTaskId ? (appData.mechanicTasks || []).find(t => t.id === myMechanicTaskId) || null : null}
        fleet={appData.fleet}
        onClose={() => setMyMechanicTaskId(null)}
        currentUserEmail={displayEmail}
        currentUserName={displayName}
        userOptions={(() => {
          // Mechanic-only candidates — derived from Employee records with
          // systemRole === 'mechanic' and a linked sign-in email. Same
          // filter MechanicBoard's internal userOptions uses; the two
          // surfaces must agree. (The previous derivation pulled from
          // activityLog/inspectors and leaked every role into the picker.)
          return (appData.employees || [])
            .filter(e => e.systemRole === 'mechanic' && !!e.linkedUserEmail)
            .map(e => ({
              userEmail: e.linkedUserEmail as string,
              userName: e.name || (e.linkedUserEmail as string),
            }))
            .sort((a, b) => a.userName.localeCompare(b.userName));
        })()}
        onChangeStatus={(taskId, newStatus) => {
          if (!can('canEditRepairs', effectiveRole) && !(newStatus === 'done' && can('canCompleteRepairs', effectiveRole))) {
            showToastMsg(PERMISSION_DENIED);
            return;
          }
          const existing = (appData.mechanicTasks || []).find(t => t.id === taskId);
          if (!existing || existing.status === newStatus) return;
          // Mirror MechanicBoard's status-change wiring: makeActivity +
          // sync into both the task's activity log and the top-level
          // activityLog.
          const act = makeActivity('status_changed', existing, { from: existing.status, to: newStatus });
          const updated = (appData.mechanicTasks || []).map(t =>
            t.id === taskId ? { ...t, status: newStatus, activity: [...(t.activity || []), act] } : t);
          syncToCloud({ ...appData, mechanicTasks: updated, activityLog: [act, ...(appData.activityLog || [])] });
        }}
        onRequestComplete={(taskId) => {
          // Permission check first — only canCompleteRepairs can finish
          // a task. canEditRepairs alone isn't enough (mirrors the gate
          // in onTaskDrop's 'done' branch).
          if (!can('canCompleteRepairs', effectiveRole)) {
            showToastMsg(PERMISSION_DENIED);
            return;
          }
          const existing = (appData.mechanicTasks || []).find(t => t.id === taskId);
          if (!existing || existing.status === 'done') return;
          // Maintenance-task path: pull current hours from the unit
          // so the modal can prefill "Engine hours at service" and
          // the submit handler can advance the schedule on save.
          // Hand off to CompletionModal: it owns the part cost / labor
          // hours / fix notes prompt and, on submit, writes the Repair
          // Log row, flips status to 'done', and emits activity. We
          // close the detail modal first so the CompletionModal renders
          // cleanly on top without two modal layers fighting for focus.
          // Maintenance metadata (metric + readings) is built by the
          // shared helper used by drag-drop and arrow paths too.
          setMyMechanicTaskId(null);
          setCompletionModal({
            isOpen: true,
            taskId: existing.id,
            unitId: existing.unitId,
            unitName: existing.unitName,
            partCost: '',
            laborHours: '',
            fixNotes: existing.description || '',
            selectedWorkers: assigneesForTask(existing),
            ...buildMaintCompletionPrefill(existing),
          });
        }}
        onAssign={(taskId, assignedTo) => {
          if (!can('canEditRepairs', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
          const updated = (appData.mechanicTasks || []).map(t =>
            t.id === taskId ? { ...t, assignedTo: assignedTo === null ? undefined : assignedTo } : t);
          syncToCloud({ ...appData, mechanicTasks: updated });
        }}
        onSetAssignees={(taskId, assignees) => {
          if (!can('canEditRepairs', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
          const updated = (appData.mechanicTasks || []).map(t =>
            t.id === taskId
              ? { ...t, assignees, assignedTo: assignees[0] || undefined }
              : t);
          syncToCloud({ ...appData, mechanicTasks: updated });
        }}
        onAddNote={(taskId, text) => {
          const trimmed = text.trim();
          if (!trimmed) return;
          const existing = (appData.mechanicTasks || []).find(t => t.id === taskId);
          if (!existing) return;
          const note: TaskNote = {
            id: `tnote-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            author: displayEmail,
            authorName: displayName,
            timestamp: new Date().toISOString(),
            text: trimmed,
          };
          const act = makeActivity('note_added', existing, { noteText: trimmed, noteId: note.id });
          const updated = (appData.mechanicTasks || []).map(t => t.id === taskId
            ? { ...t, notes: [...(Array.isArray(t.notes) ? t.notes : []), note], activity: [...(t.activity || []), act] }
            : t);
          syncToCloud({ ...appData, mechanicTasks: updated, activityLog: [act, ...(appData.activityLog || [])] });
        }}
        canDelete={can('canDeleteMechanicTask', effectiveRole)}
        onDelete={(taskId) => requestDeleteTask(taskId)}
      />

      {/* CONFIRM-DELETE MODAL — single mount, fed by deleteCtx state.
          Each requestDelete* helper above sets the context with record-
          specific copy + a confirm handler that performs the audit-then-
          delete write atomically. */}
      <ConfirmDeleteModal
        isOpen={!!deleteCtx}
        title={deleteCtx?.title || ''}
        body={deleteCtx?.body || ''}
        confirmLabel={deleteCtx?.confirmLabel || 'Delete'}
        onConfirm={async () => { if (deleteCtx) await deleteCtx.onConfirm(); }}
        onClose={() => setDeleteCtx(null)}
      />

      {/* UNIT HISTORY MODAL */}
      <UnitHistoryModal
        unit={historyUnitId ? appData.fleet.find(f => f.id === historyUnitId) || null : null}
        inspections={appData.inspections}
        currentUserEmail={displayEmail}
        isAdmin={isAdmin}
        onClose={() => setHistoryUnitId(null)}
        onAddNote={(text) => {
          if (!historyUnitId) return;
          const trimmed = text.trim();
          if (!trimmed) return;
          const note: UnitNote = {
            id: `unote-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            author: displayEmail,
            authorName: displayName,
            timestamp: new Date().toISOString(),
            text: trimmed,
          };
          const updatedFleet = appData.fleet.map(f => f.id === historyUnitId
            ? { ...f, notes: [...(Array.isArray(f.notes) ? f.notes : []), note] }
            : f);
          syncToCloud({ ...appData, fleet: updatedFleet });
        }}
        onDeleteNote={(noteId) => {
          if (!historyUnitId) return;
          const unit = appData.fleet.find(f => f.id === historyUnitId);
          if (!unit) return;
          const note = (Array.isArray(unit.notes) ? unit.notes : []).find(n => n.id === noteId);
          if (!note) return;
          if (note.author !== displayEmail && !isAdmin) return;
          const updatedFleet = appData.fleet.map(f => f.id === historyUnitId
            ? { ...f, notes: (Array.isArray(f.notes) ? f.notes : []).filter(n => n.id !== noteId) }
            : f);
          syncToCloud({ ...appData, fleet: updatedFleet });
        }}
        onViewInspection={(id) => setViewingInspectionId(id)}
      />

      {/* PRINT-ONLY HIDDEN COMPONENT */}
      <div className="hidden print-only bg-white p-8">
        <div className="max-w-4xl mx-auto space-y-12">
          <div className="flex justify-between items-end border-b-4 border-slate-800 pb-4">
            <div>
              <h1 className="text-4xl font-black text-slate-900 tracking-tighter">CREW MASTER</h1>
              <p className="text-xs font-black text-slate-500 uppercase tracking-[0.5em] mt-1">Official Operational Schedule</p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-black text-slate-800 uppercase">{printType === 'daily' ? 'Daily Report' : printType === 'weekly' ? 'Weekly Summary' : 'Operational Report'}</div>
              <div className="text-sm font-bold text-slate-500 tracking-widest">
                {printType === 'daily' ? printDailyDate :
                 printType === 'weekly' ? `Week of ${formatDate(startOfWeek)}` :
                 `${printDateRange.start} — ${printDateRange.end}`}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-12">
            {(() => {
              const crewsToPrint: any[] = [];
              const uniqueIds = new Set<string>();
              
              if (printType === 'daily') {
                (appData.schedules[printDailyDate] || []).forEach(c => {
                  if (printSelection.includes(c.id) && !uniqueIds.has(`${printDailyDate}-${c.id}`)) {
                    crewsToPrint.push({ ...c, dateStr: printDailyDate });
                    uniqueIds.add(`${printDailyDate}-${c.id}`);
                  }
                });
              } else if (printType === 'weekly') {
                weekDays.forEach(d => { 
                  const ds = formatDate(d); 
                  (appData.schedules[ds] || []).forEach(c => {
                    if (printSelection.includes(c.id) && !uniqueIds.has(`${ds}-${c.id}`)) {
                      crewsToPrint.push({ ...c, dateStr: ds });
                      uniqueIds.add(`${ds}-${c.id}`);
                    }
                  }); 
                }); 
              } else {
                // Range
                const start = new Date(printDateRange.start);
                const end = new Date(printDateRange.end);
                for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                  const ds = formatDate(d);
                  (appData.schedules[ds] || []).forEach(c => {
                    if (printSelection.includes(c.id) && !uniqueIds.has(`${ds}-${c.id}`)) {
                      crewsToPrint.push({ ...c, dateStr: ds });
                      uniqueIds.add(`${ds}-${c.id}`);
                    }
                  });
                }
              }
              
              return crewsToPrint.map(crew => {
                const emps = crew.employees.map(id => appData.employees.find(e => e.id === id)).filter(Boolean);
                const fleet = crew.fleet.map(id => appData.fleet.find(f => f.id === id)).filter(Boolean);
                const inv = (crew.inventory || []).map(i => ({ name: appData.inventory.find(item => item.id === i.id)?.name || 'Unknown', qty: i.qty }));
                
                return (
                  <div key={`${crew.dateStr}-${crew.id}`} className="border-2 border-slate-200 rounded-3xl overflow-hidden break-inside-avoid">
                    <div className="bg-slate-800 text-white p-6 flex justify-between items-center">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/50 mb-1">{crew.dateStr}</div>
                        <h2 className="text-2xl font-black uppercase">{crew.division} <span className="text-green-400">#{crew.crewNumber}</span></h2>
                      </div>
                      <div className="text-right border-l border-white/20 pl-6">
                        <div className="text-[10px] font-black uppercase tracking-widest text-white/50">Est. Base Hours</div>
                        <div className="text-2xl font-black text-white">{crew.isAdHoc ? 'AD-HOC' : 'STD'}</div>
                      </div>
                    </div>
                    
                    <div className="p-8 grid grid-cols-2 gap-x-12 gap-y-8">
                      <div className="space-y-4">
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 border-b pb-2 flex items-center gap-2"><Users className="w-4 h-4" /> Personnel</h3>
                        <div className="space-y-2">
                          {emps.map((e: any) => (
                            <div key={e.id} className="flex items-center justify-between text-sm font-bold text-slate-800 border-b border-slate-50 pb-1">
                              <span>{e.name}</span>
                              <span className="text-[10px] uppercase text-slate-400">{e.systemRole || 'worker'}</span>
                            </div>
                          ))}
                          {emps.length === 0 && <p className="text-xs text-slate-300 italic">No personnel assigned</p>}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 border-b pb-2 flex items-center gap-2"><Truck className="w-4 h-4" /> Equipment & Fleet</h3>
                        <div className="space-y-2">
                          {fleet.map(f => {
                    // Equipment (mowers etc.) isn't inspected — render
                    // a neutral dot and skip the inspection-type label.
                    const isEquipment = f.type === 'equipment';
                    const readiness = isEquipment ? null : getUnitReadiness(f.id, appData, crew.dateStr);
                    const statusColors = {
                      green: 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]',
                      yellow: 'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.6)]',
                      red: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]',
                      missing: 'bg-slate-300 border-2 border-slate-400'
                    };
                    const dotCls = readiness ? statusColors[readiness] : 'bg-slate-200 border border-slate-300';

                    return (
                      <div key={f.id} className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-gray-200 shadow-sm group/item">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotCls}`} title={readiness ? `Status: ${readiness}` : f.type} />
                          <div className="flex flex-col min-w-0">
                            <span className="text-sm font-bold text-gray-800 truncate">{fleetItemLabel(f)}</span>
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-tighter">{f.type}{isEquipment ? '' : ` • ${getRequiredInspectionType(f)}`}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                          {fleet.length === 0 && <p className="text-xs text-slate-300 italic">No equipment assigned</p>}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 border-b pb-2 flex items-center gap-2"><Package className="w-4 h-4" /> Inventory</h3>
                        <div className="space-y-2">
                          {inv.map((i: any, idx: number) => (
                            <div key={idx} className="flex items-center justify-between text-sm font-bold text-slate-800 border-b border-slate-50 pb-1">
                              <span>{i.name}</span>
                              <span className="text-[10px] text-green-600 bg-green-50 px-2 py-0.5 rounded">x{i.qty}</span>
                            </div>
                          ))}
                          {inv.length === 0 && <p className="text-xs text-slate-300 italic">No inventory assigned</p>}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 border-b pb-2 flex items-center gap-2"><Hammer className="w-4 h-4" /> Supplies & Tools</h3>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {(crew.supplies || []).map((s: string) => (
                            <span key={s} className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase px-2.5 py-1.5 rounded-lg border border-slate-200">{s}</span>
                          ))}
                          {(crew.supplies || []).length === 0 && <p className="text-xs text-slate-300 italic">No supplies assigned</p>}
                        </div>
                      </div>

                      <div className="col-span-2 mt-4">
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 border-b pb-2 mb-3">Crew Notes & Operational Instructions</h3>
                        <div className="bg-slate-50 p-6 rounded-2xl text-sm font-medium text-slate-600 italic leading-relaxed border-l-4 border-slate-200 min-h-[80px]">
                          {crew.notes || "No additional instructions provided for this shift."}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
          
          <div className="pt-20 text-center border-t border-slate-100">
            <p className="text-[9px] font-black text-slate-300 uppercase tracking-[1em]">END OF SCHEDULE REPORT • CONFIDENTIAL</p>
          </div>
        </div>
      </div>


      {/* REPAIR COMPLETION MODAL */}
      <CompletionModal
        state={completionModal}
        setState={setCompletionModal}
        uploaderEmail={displayEmail}
        uploaderName={displayName}
        mechanicRoster={(appData.employees || [])
          .filter(e => e.status === 'Active' && e.systemRole === 'mechanic' && !!e.linkedUserEmail)
          .map(e => ({ userEmail: e.linkedUserEmail as string, userName: e.name || (e.linkedUserEmail as string) }))
          .sort((a, b) => a.userName.localeCompare(b.userName))}
        onSubmit={async () => {
          if (!can('canCompleteRepairs', effectiveRole)) { showToastMsg(PERMISSION_DENIED); return; }
          // Hard re-entrancy guard against double-submit while in flight.
          if (completionSubmitRef.current) return;
          const { taskId, unitId, partCost, laborHours, fixNotes } = completionModal;
          const costNum = Number(partCost) || 0;
          const repairDate = formatDate(new Date());
          // Content idempotency: identical repair just logged → treat as dup.
          if (unitId && recentDuplicateRepairExists(unitId, repairDate, fixNotes, costNum)) {
            setCompletionModal({ ...completionModal, isOpen: false });
            showToastMsg("Repair already logged.");
            return;
          }
          // Soft day-level + blank-submit guards. Abort (modal stays open) if
          // the user declines either confirm.
          if (unitId && !confirmRepairSubmit(unitId, repairDate, fixNotes, costNum)) return;
          completionSubmitRef.current = true;
          setIsCompletingRepair(true);
          try {
          // Build the 'completed' activity. If the task isn't in mechanicTasks (synthetic), use modal data.
          const existing = appData.mechanicTasks.find(t => t.id === taskId);
          // Carry photos forward: the task's report-time photos + any
          // completion photos just attached. Metadata only — bytes already
          // live in Storage under repairs/{taskId}/.
          const mergedPhotos = [
            ...((existing?.photos as StoredFile[] | undefined) || []),
            ...((completionModal.photos as StoredFile[] | undefined) || []),
          ];
          const newLogEntry = {
            id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, equipmentId: unitId, equipmentName: completionModal.unitName,
            date: repairDate, fixNotes, cost: costNum, laborHours: Number(laborHours) || 0,
            ...(mergedPhotos.length ? { photos: mergedPhotos } : {}),
          };
          const taskRef = existing || {
            id: taskId,
            unitId,
            unitName: completionModal.unitName || 'Unknown',
            category: 'Repair',
            severity: 'minor' as const
          };
          // Who worked on this repair → even-split work-credit. Priority:
          // the explicit "Who worked on this?" selection, else the task's
          // assignees, else whoever marked it complete. Shares are 1/N and
          // sum to one repair. This is the WORK record only — pay stays on
          // each mechanic's real clocked hours, untouched.
          let workerList = (completionModal.selectedWorkers || [])
            .filter(w => w && w.userEmail)
            .map(w => ({ userEmail: w.userEmail, userName: w.userName || w.userEmail }));
          if (workerList.length === 0) workerList = assigneesForTask(existing);
          if (workerList.length === 0) workerList = [{ userEmail: displayEmail, userName: displayName }];
          const share = 1 / workerList.length;
          const workersPayload = workerList.map(w => ({ ...w, share }));
          const completedAct = makeActivity('completed', taskRef, {
            cost: Number(partCost) || 0,
            laborHours: Number(laborHours) || 0,
            fixNotes,
            workers: workersPayload,
          });
          const newTasks = appData.mechanicTasks.filter(t => t.id !== taskId);
          const hasOpenMajor = newTasks.some(t => t.unitId === unitId && t.severity === 'major' && t.status !== 'done');
          // Maintenance-task completion: advance the unit's schedule via
          // resetMaintenanceItem and update its current engine hours
          // from the captured reading. Required when source==='maintenance'.
          const isMaint = completionModal.isMaintenance === true;
          const maintMetric: 'hours' | 'km' = completionModal.maintenanceMetric === 'km' ? 'km' : 'hours';
          const maintReading = isMaint && completionModal.hoursAtService !== undefined && completionModal.hoursAtService !== ''
            ? Number(completionModal.hoursAtService)
            : null;
          if (isMaint && (maintReading === null || !Number.isFinite(maintReading) || maintReading < 0)) {
            showToastMsg(
              maintMetric === 'km'
                ? 'Odometer at service must be a non-negative number.'
                : 'Engine hours at service must be a non-negative number.',
            );
            return;
          }
          const maintNextDue = isMaint && completionModal.nextDueAtService !== undefined && completionModal.nextDueAtService !== ''
            ? Number(completionModal.nextDueAtService)
            : null;
          if (isMaint && (maintNextDue === null || !Number.isFinite(maintNextDue) || maintNextDue < 0)) {
            showToastMsg(
              maintMetric === 'km'
                ? 'Next service due (km) must be a non-negative number.'
                : 'Next service due (hrs) must be a non-negative number.',
            );
            return;
          }
          const maintItemId = isMaint && existing ? existing.sourceMaintenanceItemId : undefined;
          const newFleet = appData.fleet.map(f => {
            if (f.id !== unitId) return f;
            let next: FleetItem = hasOpenMajor ? f : { ...f, status: 'Active', repairTags: [] };
            // Maintenance schedule advance, in-place on the matching
            // item. Both metrics now route the mechanic-entered
            // next-due through resetMaintenanceItem as an explicit
            // override (locked default = currentReading + interval).
            if (isMaint && maintItemId && maintReading !== null) {
              const items = (next.maintenanceItems || []).map(mi =>
                mi.id === maintItemId
                  ? resetMaintenanceItem(mi, maintReading, maintNextDue as number)
                  : mi,
              );
              next = maintMetric === 'km'
                ? {
                  ...next,
                  maintenanceItems: items,
                  odometer: maintReading,
                  lastOdometerUpdate: formatDate(new Date()),
                }
                : {
                  ...next,
                  maintenanceItems: items,
                  currentEngineHours: maintReading,
                  lastHourUpdateAt: Date.now(),
                };
            }
            return next;
          });
          // Inspection-log entry for the maintenance service (if applicable).
          const maintInspection: Inspection | null = isMaint && maintReading !== null ? {
            id: `insp-maint-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            unitId: unitId || '',
            driverId: '',
            driverName: '',
            inspectorEmail: displayEmail,
            inspectorName: displayName,
            type: 'Maintenance',
            date: formatDate(new Date()),
            timestamp: new Date().toISOString(),
            odometer: maintMetric === 'km' ? maintReading : 0,
            location: '',
            defects: [],
            isMajor: false,
            signature: '',
            status: 'clean',
            maintenanceItemId: maintItemId,
            maintenanceItemName: completionModal.maintenanceItemName,
            hoursAtService: maintMetric === 'hours' ? maintReading : undefined,
            kmAtService: maintMetric === 'km' ? maintReading : undefined,
            maintenanceMetric: maintMetric,
            performedBy: { email: displayEmail, name: displayName },
            maintenanceNotes: fixNotes || undefined,
            maintenanceSource: 'task_completion',
          } : null;
          const success = await syncToCloud({
            ...appData,
            fleet: newFleet,
            mechanicTasks: newTasks,
            repairLog: [newLogEntry, ...appData.repairLog],
            activityLog: [completedAct, ...(appData.activityLog || [])],
            inspections: maintInspection ? [maintInspection, ...appData.inspections] : appData.inspections,
          });
          if (success) {
            setCompletionModal({ ...completionModal, isOpen: false });
            showToastMsg("Repair completed and logged.");
          } else {
            showToastMsg("Save failed — try again.");
          }
          } finally {
            completionSubmitRef.current = false;
            setIsCompletingRepair(false);
          }
        }}
        isSubmitting={isCompletingRepair}
      />
    </div>
  );
}

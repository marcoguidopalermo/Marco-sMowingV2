import { UserRole, Employee, Crew, RolePermissionsOverride } from '../types';

export const ROLE_PERMISSIONS = {
  admin: {
    canViewSchedule: true,
    canCreateCrews: true,
    canEditAnyCrew: true,
    canEditOwnCrew: true,
    canDispatchAnyCrew: true,
    canDispatchOwnCrew: true,
    canDeleteCrews: true,
    canOverrideWarnings: true,
    canCopyDay: true,
    canCloseOutCrew: true,
    canCloseOutOwnCrew: true,
    canViewMechanicMaster: true,
    canCreateRepairs: true,
    canEditRepairs: true,
    canCompleteRepairs: true,
    canDeleteRepairs: true,
    canDeleteMechanicTask: true,
    canDeleteRepairLog: true,
    canDeleteInspectionLog: true,
    canAddTaskNotes: true,
    canDeleteAnyTaskNote: true,
    canViewPerformance: true,
    canEditAnyPerformance: true,
    canEditOwnPerformance: true,
    canApprovePerformance: true,
    canAddUnscheduledCrew: true,
    canAddDeductions: true,
    canAddDeductionsOwnCrew: true,
    canViewAdvancedReports: true,
    canViewAllTimeMaster: true,
    canViewOwnTimeMaster: true,
    canEditAnyTimeEntry: true,
    canExportTimeCSV: true,
    canClockInOut: true,
    canPostBulletins: true,
    canDeleteBulletins: true,
    canViewBulletins: true,
    canUseAIInsight: true,
    canViewManageResources: true,
    canEditPersonnel: true,
    canEditFleet: true,
    canDeleteFleet: true,
    canEditInventory: true,
    canEditAppSettings: true,
    canSubmitInspections: true,
    canViewInspectionLog: true,
    canViewAllInspections: true,
    canPrintInspections: true,
    canManageJobberIntegration: true,
    canTriggerJobberSync: true,
    canViewOwnCrewLive: true,
    canMarkMultiDayCompletion: true,
    canOverrideJobType: true,
    canViewMultiDayHistory: true,
    canViewPerfActivityLog: true,
    canViewTaskMaster: true,
    canCreateTasks: true,
    canViewRoleMaster: true,
    canManageRoleMaster: true,
    canViewSalesMaster: true,
    canApproveTimeOff: true,
    canViewDashboard: true,
  },
  manager: {
    canViewSchedule: true,
    canCreateCrews: true,
    canEditAnyCrew: true,
    canEditOwnCrew: true,
    canDispatchAnyCrew: true,
    canDispatchOwnCrew: true,
    canDeleteCrews: true,
    canOverrideWarnings: true,
    canCopyDay: true,
    canCloseOutCrew: true,
    canCloseOutOwnCrew: true,
    canViewMechanicMaster: true,
    canCreateRepairs: true,
    canEditRepairs: true,
    canCompleteRepairs: true,
    canDeleteRepairs: true,
    // Delete granularity: manager can delete task cards (test data
    // cleanup) but NOT repair-log or inspection-log history rows.
    canDeleteMechanicTask: true,
    canDeleteRepairLog: false,
    canDeleteInspectionLog: false,
    canAddTaskNotes: true,
    canDeleteAnyTaskNote: false,
    canViewPerformance: true,
    canEditAnyPerformance: true,
    canEditOwnPerformance: true,
    canApprovePerformance: true,
    canAddUnscheduledCrew: true,
    canAddDeductions: true,
    canAddDeductionsOwnCrew: true,
    canViewAdvancedReports: true,
    canViewAllTimeMaster: true,
    canViewOwnTimeMaster: true,
    canEditAnyTimeEntry: true,
    canExportTimeCSV: true,
    canClockInOut: true,
    canPostBulletins: true,
    canDeleteBulletins: false,
    canViewBulletins: true,
    canUseAIInsight: true,
    canViewManageResources: true,
    canEditPersonnel: false,
    canEditFleet: true,
    canDeleteFleet: false,
    canEditInventory: true,
    canEditAppSettings: false,
    canSubmitInspections: true,
    canViewInspectionLog: true,
    canViewAllInspections: true,
    canPrintInspections: true,
    canManageJobberIntegration: false,
    canTriggerJobberSync: true,
    canViewOwnCrewLive: true,
    canMarkMultiDayCompletion: true,
    canOverrideJobType: true,
    canViewMultiDayHistory: true,
    canViewPerfActivityLog: false,
    canViewTaskMaster: true,
    canCreateTasks: false,
    canViewRoleMaster: true,
    canManageRoleMaster: false,
    canViewSalesMaster: true,
    canApproveTimeOff: false,
    canViewDashboard: true,
  },
  foreman: {
    canViewSchedule: true,
    canCreateCrews: false,
    canEditAnyCrew: false,
    canEditOwnCrew: true,
    canDispatchAnyCrew: false,
    canDispatchOwnCrew: true,
    canDeleteCrews: false,
    canOverrideWarnings: false,
    canCopyDay: false,
    canCloseOutCrew: false,
    canCloseOutOwnCrew: true,
    canViewMechanicMaster: true,
    canCreateRepairs: true,
    canEditRepairs: false,
    canCompleteRepairs: false,
    canDeleteRepairs: false,
    canDeleteMechanicTask: false,
    canDeleteRepairLog: false,
    canDeleteInspectionLog: false,
    canAddTaskNotes: true,
    canDeleteAnyTaskNote: false,
    canViewPerformance: true,
    canEditAnyPerformance: false,
    canEditOwnPerformance: true,
    canApprovePerformance: false,
    canAddUnscheduledCrew: false,
    canAddDeductions: false,
    canAddDeductionsOwnCrew: true,
    canViewAdvancedReports: false,
    canViewAllTimeMaster: false,
    canViewOwnTimeMaster: true,
    canEditAnyTimeEntry: false,
    canExportTimeCSV: false,
    canClockInOut: true,
    canPostBulletins: false,
    canDeleteBulletins: false,
    canViewBulletins: true,
    canUseAIInsight: false,
    canViewManageResources: false,
    canEditPersonnel: false,
    canEditFleet: false,
    canDeleteFleet: false,
    canEditInventory: false,
    canEditAppSettings: false,
    canSubmitInspections: true,
    canViewInspectionLog: true,
    canViewAllInspections: false,
    canPrintInspections: true,
    canManageJobberIntegration: false,
    canTriggerJobberSync: false,
    canViewOwnCrewLive: true,
    canMarkMultiDayCompletion: false,
    canOverrideJobType: false,
    canViewMultiDayHistory: false,
    canViewPerfActivityLog: false,
    canViewTaskMaster: false,
    canCreateTasks: false,
    canViewRoleMaster: true,
    canManageRoleMaster: false,
    canViewSalesMaster: false,
    canApproveTimeOff: false,
    canViewDashboard: false,
  },
  worker: {
    canViewSchedule: true,
    canCreateCrews: false,
    canEditAnyCrew: false,
    canEditOwnCrew: false,
    canDispatchAnyCrew: false,
    canDispatchOwnCrew: false,
    canDeleteCrews: false,
    canOverrideWarnings: false,
    canCopyDay: false,
    canCloseOutCrew: false,
    canCloseOutOwnCrew: true,
    canViewMechanicMaster: false,
    canCreateRepairs: false,
    canEditRepairs: false,
    canCompleteRepairs: false,
    canDeleteRepairs: false,
    canDeleteMechanicTask: false,
    canDeleteRepairLog: false,
    canDeleteInspectionLog: false,
    canAddTaskNotes: false,
    canDeleteAnyTaskNote: false,
    canViewPerformance: false,
    canEditAnyPerformance: false,
    canEditOwnPerformance: false,
    canApprovePerformance: false,
    canAddUnscheduledCrew: false,
    canAddDeductions: false,
    canAddDeductionsOwnCrew: false,
    canViewAdvancedReports: false,
    canViewAllTimeMaster: false,
    canViewOwnTimeMaster: true,
    canEditAnyTimeEntry: false,
    canExportTimeCSV: false,
    canClockInOut: true,
    canPostBulletins: false,
    canDeleteBulletins: false,
    canViewBulletins: true,
    canUseAIInsight: false,
    canViewManageResources: false,
    canEditPersonnel: false,
    canEditFleet: false,
    canDeleteFleet: false,
    canEditInventory: false,
    canEditAppSettings: false,
    canSubmitInspections: true,
    canViewInspectionLog: true,
    canViewAllInspections: false,
    canPrintInspections: true,
    canManageJobberIntegration: false,
    canTriggerJobberSync: false,
    canViewOwnCrewLive: true,
    canMarkMultiDayCompletion: false,
    canOverrideJobType: false,
    canViewMultiDayHistory: false,
    canViewPerfActivityLog: false,
    canViewTaskMaster: false,
    canCreateTasks: false,
    canViewRoleMaster: true,
    canManageRoleMaster: false,
    canViewSalesMaster: false,
    canApproveTimeOff: false,
    canViewDashboard: false,
  },
  mechanic: {
    canViewSchedule: false,
    canCreateCrews: false,
    canEditAnyCrew: false,
    canEditOwnCrew: false,
    canDispatchAnyCrew: false,
    canDispatchOwnCrew: false,
    canDeleteCrews: false,
    canOverrideWarnings: false,
    canCopyDay: false,
    canCloseOutCrew: false,
    canCloseOutOwnCrew: false,
    canViewMechanicMaster: true,
    canCreateRepairs: true,
    canEditRepairs: true,
    canCompleteRepairs: true,
    canDeleteRepairs: true,
    // Mechanic can delete task cards (test data + mistakes) but cannot
    // delete repair-log or inspection-log history rows.
    canDeleteMechanicTask: true,
    canDeleteRepairLog: false,
    canDeleteInspectionLog: false,
    canAddTaskNotes: true,
    canDeleteAnyTaskNote: false,
    canViewPerformance: false,
    canEditAnyPerformance: false,
    canEditOwnPerformance: false,
    canApprovePerformance: false,
    canAddUnscheduledCrew: false,
    canAddDeductions: false,
    canAddDeductionsOwnCrew: false,
    canViewAdvancedReports: false,
    canViewAllTimeMaster: false,
    canViewOwnTimeMaster: true,
    canEditAnyTimeEntry: false,
    canExportTimeCSV: false,
    canClockInOut: true,
    canPostBulletins: false,
    canDeleteBulletins: false,
    canViewBulletins: true,
    canUseAIInsight: false,
    canViewManageResources: false,
    canEditPersonnel: false,
    canEditFleet: false,
    canDeleteFleet: false,
    canEditInventory: false,
    canEditAppSettings: false,
    canSubmitInspections: true,
    canViewInspectionLog: true,
    canViewAllInspections: true,
    canPrintInspections: true,
    canManageJobberIntegration: false,
    canTriggerJobberSync: false,
    canViewOwnCrewLive: false,
    canMarkMultiDayCompletion: false,
    canOverrideJobType: false,
    canViewMultiDayHistory: false,
    canViewPerfActivityLog: false,
    canViewTaskMaster: false,
    canCreateTasks: false,
    canViewRoleMaster: true,
    canManageRoleMaster: false,
    canViewSalesMaster: false,
    canApproveTimeOff: false,
    canViewDashboard: false,
  },
} as const;

export type Permission = keyof typeof ROLE_PERMISSIONS['admin'];

const OWN_CREW_PERMISSIONS = new Set<Permission>([
  'canEditOwnCrew',
  'canDispatchOwnCrew',
  'canCloseOutOwnCrew',
  'canEditOwnPerformance',
  'canAddDeductionsOwnCrew',
]);

// Module-level override cache. Populated by App.tsx via setPermissionOverrides
// whenever appData.rolePermissions changes. `undefined` for any role+permission
// falls through to the hardcoded ROLE_PERMISSIONS default.
let _overrides: RolePermissionsOverride = {};

export function setPermissionOverrides(overrides: RolePermissionsOverride | undefined): void {
  _overrides = overrides || {};
}

export function getPermissionOverrides(): RolePermissionsOverride {
  return _overrides;
}

export function can(action: Permission, role: UserRole | null | undefined): boolean {
  if (!role) return false;
  // Admin always has every permission — non-overridable safety net.
  if (role === 'admin') return Boolean(ROLE_PERMISSIONS.admin[action]);
  const override = _overrides[role]?.[action];
  if (typeof override === 'boolean') return override;
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return Boolean(perms[action]);
}

export function canForCrew(
  action: Permission,
  role: UserRole | null | undefined,
  user: Employee | null,
  crew: Crew | null | undefined,
): boolean {
  if (!role || !crew) return false;
  if (!can(action, role)) return false;
  if (!OWN_CREW_PERMISSIONS.has(action)) return true;
  if (!user) return false;
  return crew.employees.includes(user.id);
}

export function resolveRole(employee: Employee | null | undefined): UserRole {
  if (!employee) return 'worker';
  return employee.systemRole || 'worker';
}

export type AppView = 'schedule' | 'mechanic' | 'mymechanic' | 'performance' | 'dashboard' | 'mycrew' | 'timemaster' | 'bulletins' | 'taskmaster' | 'rolemaster' | 'salesmaster';

export const APP_VIEW_ORDER: AppView[] = ['schedule', 'mechanic', 'mymechanic', 'performance', 'dashboard', 'mycrew', 'timemaster', 'bulletins', 'taskmaster', 'rolemaster', 'salesmaster'];

export function canAccessView(view: AppView, role: UserRole | null | undefined): boolean {
  switch (view) {
    case 'schedule': return can('canViewSchedule', role);
    case 'mechanic': return can('canViewMechanicMaster', role);
    // MyMechanic is the mechanic's pay-chunk home screen (reinstated
    // for the pay-chunks feature). Mechanic-only by design;
    // admin/manager preview via View As → Mechanic.
    case 'mymechanic': return role === 'mechanic';
    case 'performance': return can('canViewPerformance', role);
    // Company-wide rollup view (crew leaderboard today, more widgets
    // to come). Manager + admin only by default.
    case 'dashboard': return can('canViewDashboard', role);
    case 'mycrew': return can('canViewOwnCrewLive', role);
    // TimeMaster now also hosts the time-off approval queue as an
    // internal tab (gated by canApproveTimeOff), so the top-level
    // accessibility just needs the TimeMaster permission OR the
    // approval permission. An admin who only has canApproveTimeOff
    // (no TimeMaster permission) can still reach the approvals tab.
    case 'timemaster': return can('canViewOwnTimeMaster', role) || can('canViewAllTimeMaster', role) || can('canApproveTimeOff', role);
    case 'bulletins': return can('canViewBulletins', role);
    case 'taskmaster': return can('canViewTaskMaster', role);
    case 'rolemaster': return can('canViewRoleMaster', role);
    case 'salesmaster': return can('canViewSalesMaster', role);
  }
}

export function defaultLandingView(role: UserRole | null | undefined): AppView {
  switch (role) {
    case 'admin':
    case 'manager':
      return 'schedule';
    case 'foreman':
    case 'worker':
      return 'mycrew';
    case 'mechanic':
      // Mechanics land on MyMechanic (pay-chunk home). They can still
      // navigate to MechanicMaster for repair work.
      return 'mymechanic';
    default:
      return 'schedule';
  }
}

export function firstAccessibleView(role: UserRole | null | undefined): AppView {
  return APP_VIEW_ORDER.find(v => canAccessView(v, role)) || 'schedule';
}

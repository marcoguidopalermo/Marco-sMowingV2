import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  TrendingUp, CalendarDays, BarChart, Save, Calendar as CalendarIcon,
  Target, FileSignature, Map, Plus, Clock, X,
  Filter, Award, Truck, Users, CheckCircle, Unlock, Link2, AlertTriangle, RefreshCw, Trash2, MoreVertical, Split as SplitIcon, ChevronLeft, ChevronRight, X as XIcon
} from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { functions, db, appId } from '../lib/firebase';
import { Employee, Job, PerformanceLog, DeductionValue, SyncLogEntry, PerformanceJobRow, MultiDayJob, AppData, UserRole } from '../types';
import { logPerfActivity } from '../lib/perfAudit';
import CompletionReviewModal from './CompletionReviewModal';
import AHSplitModal from './AHSplitModal';
import SplitBHModal from './SplitBHModal';
import PerformanceActivityLog from './PerformanceActivityLog';
import { can } from '../lib/permissions';
import { getCrewAllowance, adjustedEfficiency, allowanceTag } from '../lib/crewAllowance';
import { DIVISIONS, CREW_NUMBERS, PERMISSION_DENIED } from '../constants';
import { formatDate, addDays, getStartOfWeek, formatTodayInToronto, addDaysToronto } from '../lib/dateUtils';
import RouteSelectionModal from './RouteSelectionModal';

// Backward-compat helpers: deductions may be number|string (legacy) or { hours, reason } (new)
function deductHours(d: DeductionValue | undefined): number {
  if (d == null) return 0;
  if (typeof d === 'number' || typeof d === 'string') return Number(d) || 0;
  if (typeof d === 'object' && 'hours' in d) return Number((d as any).hours) || 0;
  return 0;
}
function deductHoursRaw(d: DeductionValue | undefined): number | string {
  if (d == null) return '';
  if (typeof d === 'number' || typeof d === 'string') return d;
  if (typeof d === 'object' && 'hours' in d) return (d as any).hours ?? '';
  return '';
}
function deductReason(d: DeductionValue | undefined): string {
  if (d == null) return '';
  if (typeof d === 'object' && 'reason' in d) return (d as any).reason || '';
  return '';
}

interface RouteFilters {
  division: string;
  targetDay: string;
  frequency: string;
}

interface PerformanceBoardProps {
  performance: Record<string, Record<string, PerformanceLog>>;
  routes: Job[];
  employees: Employee[];
  startOfWeek: Date;

  perfTab: string;
  setPerfTab: Dispatch<SetStateAction<string>>;
  perfDate: string;
  setPerfDate: Dispatch<SetStateAction<string>>;
  reportStartDate: string;
  setReportStartDate: Dispatch<SetStateAction<string>>;
  reportEndDate: string;
  setReportEndDate: Dispatch<SetStateAction<string>>;
  dailyLogs: Record<string, PerformanceLog>;
  setDailyLogs: Dispatch<SetStateAction<Record<string, PerformanceLog>>>;
  routeModalCrewId: string | null;
  setRouteModalCrewId: Dispatch<SetStateAction<string | null>>;
  routeFilters: RouteFilters;
  setRouteFilters: Dispatch<SetStateAction<RouteFilters>>;
  selectedRouteIds: Set<string>;
  setSelectedRouteIds: Dispatch<SetStateAction<Set<string>>>;

  onSaveDaily: () => void | Promise<void>;
  isManager: boolean;
  onApprove: (crewId: string, log: PerformanceLog) => void;
  onUnapprove: (crewId: string) => void;

  jobberConnected: boolean;
  canSyncJobber: boolean;
  showToastMsg: (msg: string) => void;
  canDeleteEntry: (crewId: string) => boolean;
  onDeleteEntry: (crewId: string) => void | Promise<void>;

  multiDayJobs: Record<string, MultiDayJob>;
  appData: AppData;
  syncToCloud: (data: AppData) => Promise<boolean | undefined>;
  canMarkMultiDay: boolean;
  canOverrideJobType: boolean;
  defaultDivisionFilter: 'all' | 'lawn' | 'small' | 'large';
  currentUserId: string;
  currentUserName: string;
  currentUserRole: UserRole;
  isAdmin: boolean;
}

export default function PerformanceBoard({
  performance,
  routes,
  employees,
  startOfWeek,
  perfTab,
  setPerfTab,
  perfDate,
  setPerfDate,
  reportStartDate,
  setReportStartDate,
  reportEndDate,
  setReportEndDate,
  dailyLogs,
  setDailyLogs,
  routeModalCrewId,
  setRouteModalCrewId,
  routeFilters,
  setRouteFilters,
  selectedRouteIds,
  setSelectedRouteIds,
  onSaveDaily,
  isManager,
  onApprove,
  onUnapprove,
  jobberConnected,
  canSyncJobber,
  showToastMsg,
  canDeleteEntry,
  onDeleteEntry,
  multiDayJobs,
  appData,
  syncToCloud,
  canMarkMultiDay,
  canOverrideJobType,
  defaultDivisionFilter,
  currentUserId,
  currentUserName,
  currentUserRole,
  isAdmin,
}: PerformanceBoardProps) {
  const crewLabelFor = (cId: string): string => {
    const log = dailyLogs[cId];
    return log ? `${log.division} #${log.crewNumber}` : cId;
  };
  const auditCtx = (cId: string) => ({
    targetDate: perfDate,
    crewId: cId,
    crewLabel: crewLabelFor(cId),
    userId: currentUserId,
    userName: currentUserName,
    userRole: currentUserRole,
  });
  const getEmpName = (id: string) => employees.find(e => e.id === id)?.name || 'Unknown';

  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncLogEntry | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [divisionFilter, setDivisionFilter] = useState<'all' | 'lawn' | 'small' | 'large' | 'adhoc'>(
    defaultDivisionFilter === 'all' ? 'all' : defaultDivisionFilter,
  );
  // Per-visit review state. The multi-day ledger is keyed by jobberVisitId,
  // so the modal opens against a specific visit's history — never the
  // parent job's. Recurring/multi-visit jobs no longer collide.
  const [reviewVisitId, setReviewVisitId] = useState<string | null>(null);
  const [reviewCrewId, setReviewCrewId] = useState<string | null>(null);

  const openReview = (jobberVisitId: string, crewId: string) => {
    setReviewVisitId(jobberVisitId);
    setReviewCrewId(crewId);
  };
  const closeReview = () => { setReviewVisitId(null); setReviewCrewId(null); };

  const [splitCtx, setSplitCtx] = useState<{ crewId: string; empId: string; workerName: string } | null>(null);
  // Multi-crew BH split modal context. Opened from the kebab on any row
  // that is part of a multi-crew visit (visitBHSplits has >1 crew).
  const [splitBHCtx, setSplitBHCtx] = useState<{ visitId: string; visitTitle: string; visitTotalBH: number } | null>(null);

  const [rowMenuKey, setRowMenuKey] = useState<string | null>(null);
  // Direction the kebab menu opens. Computed from the button's viewport
  // position at click time so bottom-of-list rows flip the menu upward
  // instead of clipping below the viewport.
  const [rowMenuDir, setRowMenuDir] = useState<'down' | 'up'>('down');
  const [shiftPickerCtx, setShiftPickerCtx] = useState<{
    sourceCrewId: string;
    sourceJobIdx: number;
    sourceDate: string;
    destDate: string;
    candidates: Array<{ id: string; division: string; crewNumber: number }>;
  } | null>(null);

  const [carryForwardModalOpen, setCarryForwardModalOpen] = useState(false);
  const [carryForwardSkipped, setCarryForwardSkipped] = useState<Set<string>>(new Set());
  const [carryForwardChoices, setCarryForwardChoices] = useState<Record<string, string>>({});

  // Reset session dismissals + selections when the date changes.
  useEffect(() => {
    setCarryForwardSkipped(new Set());
    setCarryForwardChoices({});
    setCarryForwardModalOpen(false);
  }, [perfDate]);

  const pendingCarryForward = useMemo(() => {
    const candidates = lastSync?.carryForwardCandidates || [];
    return candidates.filter(c => {
      // Skip/match by visit, not by parent job — a recurring job may have
      // multiple visits in flight at once, each with its own ledger.
      if (carryForwardSkipped.has(c.jobberVisitId)) return false;
      // Permanently dismissed via the Delete button — never surface
      // this candidate again, regardless of what the sync emitted.
      if (multiDayJobs?.[c.jobberVisitId]?.dismissedCarryForward) return false;
      const existsToday = Object.values(dailyLogs).some(log =>
        log.jobs.some(j => j.jobberVisitId && j.jobberVisitId === c.jobberVisitId),
      );
      return !existsToday;
    });
  }, [lastSync, carryForwardSkipped, dailyLogs, multiDayJobs]);

  const handleCarryForwardContinue = async (
    candidate: NonNullable<SyncLogEntry['carryForwardCandidates']>[number],
    targetCrewId: string,
  ) => {
    const targetLog = dailyLogs[targetCrewId];
    if (!targetLog) {
      showToastMsg('Pick a crew first.');
      return;
    }
    const crewLabel = `${targetLog.division} #${targetLog.crewNumber}`;
    // Preserve the same visit id across days — a single visit spanning
    // Mon-Wed shares one ledger; do NOT invent a fresh continuation id.
    // source:'jobber' + isIncompleteVisit:true because the row IS a
    // continuation of a still-open Jobber visit (same jobberVisitId,
    // same ledger). The legacy 'manual' stamp hid the kebab partial flow
    // behind the isJobber gate, breaking day-2 onward of multi-day visits.
    const newRow: PerformanceJobRow = {
      desc: candidate.jobTitle,
      bh: 0,
      source: 'jobber',
      jobberVisitId: candidate.jobberVisitId,
      jobberJobId: candidate.jobberJobId,
      totalBH: candidate.totalBH,
      isIncompleteVisit: true,
      awaitingCompletionReview: true,
      carriedForwardFrom: candidate.priorDate,
    };
    setDailyLogs(prev => {
      const n = { ...prev };
      const target = n[targetCrewId];
      if (!target) return prev;
      n[targetCrewId] = { ...target, jobs: [...target.jobs, newRow] };
      return n;
    });
    // Persist immediately so the modal can be used right away.
    await syncToCloud({
      ...appData,
      performance: {
        ...(appData.performance || {}),
        [perfDate]: {
          ...((appData.performance || {})[perfDate] || {}),
          [targetCrewId]: {
            ...((appData.performance || {})[perfDate]?.[targetCrewId] || targetLog),
            jobs: [
              ...(((appData.performance || {})[perfDate]?.[targetCrewId]?.jobs) || targetLog.jobs),
              newRow,
            ],
          },
        },
      },
    });
    logPerfActivity({
      type: 'multiday_carried_forward',
      targetDate: perfDate,
      crewId: targetCrewId,
      crewLabel,
      userId: currentUserId,
      userName: currentUserName,
      userRole: currentUserRole,
      jobberJobId: candidate.jobberJobId,
      sourceJobberVisitId: candidate.jobberVisitId,
      jobTitle: candidate.jobTitle,
      valueLabel: '%',
      valueBefore: candidate.priorCumulativePct,
      reasonNote: `Carried forward from ${candidate.priorDate} (${candidate.remainingBH} BH remaining)`,
    });
    showToastMsg(`Carried forward to ${crewLabel}. Open the ⋯ menu to mark partial %.`);
  };

  const handleCarryForwardSkip = (jobberVisitId: string) => {
    setCarryForwardSkipped(prev => {
      const n = new Set(prev);
      n.add(jobberVisitId);
      return n;
    });
  };

  // Permanent dismissal. Sets the sticky flag on the multiDayJob so
  // the prompt never resurfaces — even after a refresh or another
  // Jobber sync. Previously-credited BH on prior days stays intact;
  // we ONLY touch the carry-forward tracking flag, never the
  // completionHistory or any performance row.
  const handleCarryForwardDelete = async (jobberVisitId: string, jobTitle: string) => {
    if (!window.confirm(`Remove this job's carry-forward tracking?\n\nPreviously awarded BH on prior days stays intact, but "${jobTitle}" won't be carried forward again.`)) return;
    const existing = (appData.multiDayJobs || {})[jobberVisitId];
    if (!existing) {
      // Defensive — emitter ran from a stale syncLog; nothing to dismiss.
      // Still session-skip so the candidate doesn't re-render this tab.
      setCarryForwardSkipped(prev => { const n = new Set(prev); n.add(jobberVisitId); return n; });
      return;
    }
    const updated: MultiDayJob = {
      ...existing,
      dismissedCarryForward: true,
      dismissedCarryForwardAt: Date.now(),
      dismissedCarryForwardBy: { email: currentUserId, name: currentUserName },
    };
    await syncToCloud({
      ...appData,
      multiDayJobs: { ...(appData.multiDayJobs || {}), [jobberVisitId]: updated },
    });
    showToastMsg(`"${jobTitle}" removed from carry-forward tracking.`);
  };

  // Numeric input drafts — onChange writes here, onBlur commits to
  // dailyLogs. This prevents the controlled-input + state-cascade pattern
  // from clobbering in-progress typing (multi-digit numbers, decimals,
  // empty-to-null clearing).
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});
  const draftKey = (cId: string, rowIdx: number, field: string) => `${cId}::${rowIdx}::${field}`;
  const inputValue = (key: string, fallback: number | string | null | undefined): string => {
    if (inputDrafts[key] !== undefined) return inputDrafts[key];
    if (fallback === null || fallback === undefined) return '';
    return String(fallback);
  };
  const setDraft = (key: string, value: string) => {
    setInputDrafts(prev => ({ ...prev, [key]: value }));
  };
  const clearDraft = (key: string) => {
    setInputDrafts(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const computeDestDate = (sourceDate: string, direction: 'prev' | 'next'): string => {
    // Parse YYYY-MM-DD in local time (avoid UTC midnight drift).
    const d = new Date(`${sourceDate}T00:00:00`);
    return formatDate(addDays(d, direction === 'prev' ? -1 : 1));
  };

  const executeShift = (
    sourceCrewId: string,
    sourceJobIdx: number,
    sourceDate: string,
    destDate: string,
    destCrewId: string,
  ) => {
    const sourceLog = dailyLogs[sourceCrewId];
    const row = sourceLog?.jobs[sourceJobIdx];
    if (!sourceLog || !row) return;

    if (sourceLog.approvalStatus === 'approved') {
      showToastMsg(`Cannot shift: ${sourceDate} is approved. Unapprove first.`);
      return;
    }
    const destDayMap = (appData.performance || {})[destDate] || {};
    const destExistingLog = destDayMap[destCrewId];
    if (destExistingLog?.approvalStatus === 'approved') {
      const lbl = `${destExistingLog.division} #${destExistingLog.crewNumber}`;
      showToastMsg(`Cannot shift: ${destDate} ${lbl} is approved. Unapprove first.`);
      return;
    }

    const destSchedule = appData.schedules?.[destDate] || [];
    const destCrew = destSchedule.find(c => c.id === destCrewId);
    if (!destExistingLog && !destCrew) {
      showToastMsg('Destination crew not found in schedule.');
      return;
    }

    // 1. Commit any in-memory edits on the source date back into appData
    //    so we don't lose them in the cross-date write.
    const sourcePerformanceForDate: Record<string, PerformanceLog> = {
      ...((appData.performance || {})[sourceDate] || {}),
    };
    for (const [k, v] of Object.entries(dailyLogs)) {
      sourcePerformanceForDate[k] = v;
    }

    // 2. Remove the row from the source crew.
    const sourceNewJobs = sourceLog.jobs.filter((_, i) => i !== sourceJobIdx);
    sourcePerformanceForDate[sourceCrewId] = {
      ...sourceLog,
      jobs: sourceNewJobs,
    };

    // 3. Build the destination row with shift markers + history.
    const newDestRow: PerformanceJobRow = {
      ...row,
      manuallyShifted: true,
      shiftedFromDate: sourceDate,
      shiftHistory: [
        ...(row.shiftHistory || []),
        {
          fromDate: sourceDate,
          toDate: destDate,
          fromCrewId: sourceCrewId,
          toCrewId: destCrewId,
          userEmail: currentUserId,
          userName: currentUserName,
          timestamp: Date.now(),
        },
      ],
    };

    // 4. Append to destination crew (creating its log if it doesn't exist).
    const destPerformanceForDate: Record<string, PerformanceLog> = {
      ...destDayMap,
    };
    if (destExistingLog) {
      destPerformanceForDate[destCrewId] = {
        ...destExistingLog,
        jobs: [...(destExistingLog.jobs || []), newDestRow],
      };
    } else if (destCrew) {
      destPerformanceForDate[destCrewId] = {
        division: destCrew.division,
        crewNumber: destCrew.crewNumber,
        isAdHoc: false,
        jobs: [newDestRow],
        employeeAH: {},
        deductions: {},
        approvalStatus: 'pending',
      };
    }

    // 5. Persist both dates in one write.
    const nextAppData: AppData = {
      ...appData,
      performance: {
        ...(appData.performance || {}),
        [sourceDate]: sourcePerformanceForDate,
        [destDate]: destPerformanceForDate,
      },
    };
    syncToCloud(nextAppData);

    // 6. Reflect removal in the local in-memory edit state for the current view.
    setDailyLogs(p => {
      const n = { ...p };
      const t = n[sourceCrewId];
      if (t) n[sourceCrewId] = { ...t, jobs: t.jobs.filter((_, i) => i !== sourceJobIdx) };
      return n;
    });

    const destLabel = destCrew
      ? `${destCrew.division} #${destCrew.crewNumber}`
      : destExistingLog
        ? `${destExistingLog.division} #${destExistingLog.crewNumber}`
        : destCrewId;
    logPerfActivity({
      type: 'bh_shifted_day',
      targetDate: destDate,
      crewId: destCrewId,
      crewLabel: destLabel,
      userId: currentUserId,
      userName: currentUserName,
      userRole: currentUserRole,
      sourceJobberVisitId: row.jobberVisitId,
      jobTitle: row.desc,
      reasonNote: `Shifted from ${sourceDate} (crew ${sourceCrewId}) to ${destDate} (${destLabel})`,
    });
    showToastMsg(`Moved to ${destDate} — credited to ${destLabel}`);
    setShiftPickerCtx(null);
  };

  // Multi-crew shift: move every crew's row for the given visitId from
  // sourceDate to destDate in a single round-trip. Each crew lands on its
  // same-id counterpart on destDate; if a crew isn't scheduled there, that
  // one is skipped with a toast and the rest still shift.
  const executeMultiCrewShift = (
    visitId: string,
    sourceDate: string,
    destDate: string,
  ) => {
    // Snapshot source-date performance, layered with any in-memory edits.
    const sourcePerformanceForDate: Record<string, PerformanceLog> = {
      ...((appData.performance || {})[sourceDate] || {}),
    };
    for (const [k, v] of Object.entries(dailyLogs)) {
      sourcePerformanceForDate[k] = v;
    }
    const destDayMap = (appData.performance || {})[destDate] || {};
    const destPerformanceForDate: Record<string, PerformanceLog> = { ...destDayMap };
    const destSchedule = appData.schedules?.[destDate] || [];

    const moved: string[] = [];
    const skipped: string[] = [];
    for (const [crewId, log] of Object.entries(sourcePerformanceForDate)) {
      const idx = (log.jobs || []).findIndex(j => j.jobberVisitId === visitId);
      if (idx === -1) continue;
      if (log.approvalStatus === 'approved') {
        const lbl = `${log.division} #${log.crewNumber}`;
        skipped.push(`${lbl} (approved on ${sourceDate})`);
        continue;
      }
      const destExistingLog = destPerformanceForDate[crewId];
      if (destExistingLog?.approvalStatus === 'approved') {
        const lbl = `${destExistingLog.division} #${destExistingLog.crewNumber}`;
        skipped.push(`${lbl} (approved on ${destDate})`);
        continue;
      }
      const destCrew = destSchedule.find(c => c.id === crewId);
      if (!destExistingLog && !destCrew) {
        skipped.push(`${log.division} #${log.crewNumber} (not on ${destDate})`);
        continue;
      }

      const row = log.jobs[idx];
      const newDestRow: PerformanceJobRow = {
        ...row,
        manuallyShifted: true,
        shiftedFromDate: sourceDate,
        shiftHistory: [
          ...(row.shiftHistory || []),
          {
            fromDate: sourceDate,
            toDate: destDate,
            fromCrewId: crewId,
            toCrewId: crewId,
            userEmail: currentUserId,
            userName: currentUserName,
            timestamp: Date.now(),
          },
        ],
      };
      sourcePerformanceForDate[crewId] = {
        ...log,
        jobs: log.jobs.filter((_, i) => i !== idx),
      };
      if (destExistingLog) {
        destPerformanceForDate[crewId] = {
          ...destExistingLog,
          jobs: [...(destExistingLog.jobs || []), newDestRow],
        };
      } else if (destCrew) {
        destPerformanceForDate[crewId] = {
          division: destCrew.division,
          crewNumber: destCrew.crewNumber,
          isAdHoc: false,
          jobs: [newDestRow],
          employeeAH: {},
          deductions: {},
          approvalStatus: 'pending',
        };
      }
      moved.push(`${log.division} #${log.crewNumber}`);
    }

    if (moved.length === 0) {
      showToastMsg(`No crews could be shifted. ${skipped.join(' · ') || ''}`);
      return;
    }

    const nextAppData: AppData = {
      ...appData,
      performance: {
        ...(appData.performance || {}),
        [sourceDate]: sourcePerformanceForDate,
        [destDate]: destPerformanceForDate,
      },
    };
    syncToCloud(nextAppData);

    // Reflect source-date removals in the local edit buffer.
    setDailyLogs(prev => {
      const n = { ...prev };
      for (const [crewId, log] of Object.entries(n)) {
        const idx = (log.jobs || []).findIndex(j => j.jobberVisitId === visitId);
        if (idx !== -1 && log.approvalStatus !== 'approved') {
          n[crewId] = { ...log, jobs: log.jobs.filter((_, i) => i !== idx) };
        }
      }
      return n;
    });

    logPerfActivity({
      type: 'bh_shifted_day',
      targetDate: destDate,
      crewId: '',
      crewLabel: moved.join(', '),
      userId: currentUserId,
      userName: currentUserName,
      userRole: currentUserRole,
      sourceJobberVisitId: visitId,
      reasonNote: `Multi-crew shift ${sourceDate} → ${destDate}: moved ${moved.length} (${moved.join(', ')})${skipped.length ? `; skipped ${skipped.join(', ')}` : ''}`,
    });
    const msg = skipped.length === 0
      ? `Shifted ${moved.length} crew${moved.length === 1 ? '' : 's'} to ${destDate}.`
      : `Shifted ${moved.length} crew${moved.length === 1 ? '' : 's'} to ${destDate}. Skipped: ${skipped.join('; ')}`;
    showToastMsg(msg);
  };

  const handleShiftRow = (cId: string, jIdx: number, direction: 'prev' | 'next') => {
    if (!isManager) { showToastMsg(PERMISSION_DENIED); return; }
    const sourceDate = perfDate;
    const destDate = computeDestDate(sourceDate, direction);

    const sourceLog = dailyLogs[cId];
    if (!sourceLog) { showToastMsg('Source crew not found.'); return; }
    if (sourceLog.approvalStatus === 'approved') {
      showToastMsg(`Cannot shift: ${sourceDate} is approved. Unapprove first.`);
      return;
    }

    // Multi-crew shift: if this row belongs to a multi-crew visit, shift
    // EVERY crew's row for that visit on this date in one atomic write.
    // Each crew lands on its same-id counterpart on destDate; if a crew
    // isn't scheduled on destDate, that one gets a toast and is skipped
    // (the others still shift).
    const sourceRow = sourceLog.jobs[jIdx];
    const visitId = sourceRow?.jobberVisitId;
    const vSplit = visitId ? (appData.visitBHSplits || {})[visitId] : undefined;
    if (visitId && vSplit && vSplit.splits.length > 1) {
      executeMultiCrewShift(visitId, sourceDate, destDate);
      return;
    }

    const sourceSchedule = appData.schedules?.[sourceDate] || [];
    const sourceCrew = sourceSchedule.find(c => c.id === cId);
    const sourceMowId = sourceCrew?.jobberAssigneeIds?.[0];
    const destSchedule = appData.schedules?.[destDate] || [];
    const matching = sourceMowId
      ? destSchedule.filter(c => (c.jobberAssigneeIds || []).includes(sourceMowId))
      : [];

    if (matching.length === 1) {
      executeShift(cId, jIdx, sourceDate, destDate, matching[0].id);
      return;
    }
    // Open picker. Candidates: matching crews if any, else all destination crews.
    const candidates = (matching.length > 0 ? matching : destSchedule)
      .map(c => ({ id: c.id, division: c.division, crewNumber: c.crewNumber }));
    if (candidates.length === 0) {
      showToastMsg(`No crews scheduled on ${destDate}. Add a crew first.`);
      return;
    }
    setShiftPickerCtx({
      sourceCrewId: cId,
      sourceJobIdx: jIdx,
      sourceDate,
      destDate,
      candidates,
    });
  };

  const unlockJobberBH = (crewId: string, jobIdx: number) => {
    const log = dailyLogs[crewId];
    const row = log?.jobs[jobIdx];
    if (!row) return;
    const currentBH = Number(row.bh) || 0;
    setDailyLogs(p => {
      const n = { ...p };
      const target = n[crewId];
      if (!target) return n;
      n[crewId] = {
        ...target,
        jobs: target.jobs.map((j, i) => i === jobIdx ? {
          ...j,
          manuallyEditedAt: new Date().toISOString(),
          jobberSuggestedValue: currentBH,
        } : j),
      };
      return n;
    });
    logPerfActivity({
      type: 'jobber_bh_unlocked',
      ...auditCtx(crewId),
      jobberJobId: row.jobberJobId,
      jobTitle: row.desc,
      valueLabel: 'BH',
      valueBefore: currentBH,
      sourceJobberVisitId: row.jobberVisitId,
    });
    setRowMenuKey(null);
  };

  const revertJobberBH = (crewId: string, jobIdx: number) => {
    const log = dailyLogs[crewId];
    const row = log?.jobs[jobIdx];
    if (!row) return;
    const restoredBH = typeof row.jobberSuggestedValue === 'number'
      ? row.jobberSuggestedValue
      : Number(row.bh) || 0;
    const prevBH = Number(row.bh) || 0;
    setDailyLogs(p => {
      const n = { ...p };
      const target = n[crewId];
      if (!target) return n;
      n[crewId] = {
        ...target,
        jobs: target.jobs.map((j, i) => {
          if (i !== jobIdx) return j;
          const next: PerformanceJobRow = { ...j, bh: restoredBH, hasJobberConflict: false };
          delete next.manuallyEditedAt;
          delete next.jobberSuggestedValue;
          return next;
        }),
      };
      return n;
    });
    logPerfActivity({
      type: 'jobber_bh_reverted',
      ...auditCtx(crewId),
      jobberJobId: row.jobberJobId,
      jobTitle: row.desc,
      valueLabel: 'BH',
      valueBefore: prevBH,
      valueAfter: restoredBH,
      sourceJobberVisitId: row.jobberVisitId,
    });
    setRowMenuKey(null);
  };

  // Optional partial-completion entry point, accessed from the row's
  // kebab menu. Lawn and non-lawn rows take the same path — no more ghost
  // conversion. If sync hasn't created a ledger yet (rare race), build
  // one inline from the row's parsed totalBH so the modal can open.
  const markPartiallyComplete = async (crewId: string, jobIdx: number) => {
    const log = dailyLogs[crewId];
    const row = log?.jobs[jobIdx];
    if (!row || !row.jobberVisitId) return;
    const totalBH = Number(row.totalBH) || Number(row.bh) || 0;
    if (totalBH <= 0) {
      showToastMsg('Cannot mark partial — total BH not parsed from job title. Edit the title in Jobber to include [XBH] and re-sync.');
      setRowMenuKey(null);
      return;
    }
    const jvid = row.jobberVisitId;
    const existingMD = appData.multiDayJobs?.[jvid];
    if (!existingMD) {
      const newMD = {
        jobberVisitId: jvid,
        jobberJobId: row.jobberJobId || '',
        jobberJobNumber: row.jobberJobNumber || '',
        title: row.desc,
        totalBH,
        isLawnJob: false,
        manualOverride: false,
        completionHistory: [],
        status: 'in_progress' as const,
        firstSeenAt: Date.now(),
      };
      // Local-row hint while the cloud round-trip completes.
      setDailyLogs(prev => {
        const n = { ...prev };
        const target = n[crewId];
        if (!target) return prev;
        n[crewId] = {
          ...target,
          jobs: target.jobs.map((j, i) => i === jobIdx ? { ...j, totalBH, awaitingCompletionReview: true } : j),
        };
        return n;
      });
      await syncToCloud({
        ...appData,
        multiDayJobs: { ...(appData.multiDayJobs || {}), [jvid]: newMD },
      });
    }
    setRowMenuKey(null);
    openReview(jvid, crewId);
  };

  const convertRowType = async (crewId: string, jobIdx: number, mode: 'to-multi-day' | 'to-single-day') => {
    if (!canOverrideJobType) return;
    const log = dailyLogs[crewId];
    if (!log) return;
    const row = log.jobs[jobIdx];
    const jobberVisitId = row.jobberVisitId;
    if (!jobberVisitId) {
      showToastMsg('No Jobber visit ID — cannot convert.');
      return;
    }
    const existingMD = multiDayJobs[jobberVisitId];
    if (mode === 'to-multi-day') {
      const totalBH = Number(row.totalBH ?? row.bh) || 0;
      const updated = {
        ...(existingMD || {
          jobberVisitId,
          jobberJobId: row.jobberJobId || '',
          jobberJobNumber: row.jobberJobNumber || '',
          title: row.desc,
          totalBH,
          completionHistory: [],
          status: 'in_progress' as const,
          firstSeenAt: Date.now(),
        }),
        isLawnJob: false,
        manualOverride: true,
        totalBH,
      };
      setDailyLogs(prev => {
        const n = { ...prev };
        const targetLog = n[crewId];
        if (!targetLog) return prev;
        const newJobs = targetLog.jobs.map((j, i) => i === jobIdx
          ? { ...j, bh: 0, totalBH, awaitingCompletionReview: true }
          : j);
        n[crewId] = { ...targetLog, jobs: newJobs };
        return n;
      });
      logPerfActivity({
        type: 'job_type_converted',
        ...auditCtx(crewId),
        jobberJobId: row.jobberJobId,
        sourceJobberVisitId: jobberVisitId,
        jobTitle: row.desc,
        valueBefore: 'single',
        valueAfter: 'multiday',
      });
      await syncToCloud({
        ...appData,
        multiDayJobs: { ...(appData.multiDayJobs || {}), [jobberVisitId]: updated },
      });
      showToastMsg(`Converted to multi-day. Use the ⋯ menu's "Mark partial %" to credit progress.`);
    } else {
      const hasHistory = existingMD && existingMD.completionHistory.length > 0;
      if (hasHistory) {
        if (!confirm(`This will discard ${existingMD!.completionHistory.length} completion entries. Continue?`)) return;
      }
      const totalBH = Number(row.totalBH ?? row.bh) || 0;
      const updated = {
        ...(existingMD || {
          jobberVisitId,
          jobberJobId: row.jobberJobId || '',
          jobberJobNumber: row.jobberJobNumber || '',
          title: row.desc,
          totalBH,
          completionHistory: [],
          status: 'complete' as const,
          firstSeenAt: Date.now(),
        }),
        isLawnJob: true,
        manualOverride: true,
        completionHistory: hasHistory ? [] : (existingMD?.completionHistory || []),
        totalBH,
      };
      setDailyLogs(prev => {
        const n = { ...prev };
        const targetLog = n[crewId];
        if (!targetLog) return prev;
        const newJobs = targetLog.jobs.map((j, i) => {
          if (i !== jobIdx) return j;
          const next = { ...j, bh: totalBH };
          delete next.awaitingCompletionReview;
          delete next.totalBH;
          return next;
        });
        n[crewId] = { ...targetLog, jobs: newJobs };
        return n;
      });
      logPerfActivity({
        type: 'job_type_converted',
        ...auditCtx(crewId),
        jobberJobId: row.jobberJobId,
        sourceJobberVisitId: jobberVisitId,
        jobTitle: row.desc,
        valueBefore: 'multiday',
        valueAfter: 'single',
      });
      await syncToCloud({
        ...appData,
        multiDayJobs: { ...(appData.multiDayJobs || {}), [jobberVisitId]: updated },
      });
      showToastMsg(`Converted to single-day. Credited ${totalBH} BH.`);
    }
    setRowMenuKey(null);
  };

  const divisionLabel = (key: typeof divisionFilter): string => {
    switch (key) {
      case 'all': return 'All Crews';
      case 'lawn': return 'Lawn Division';
      case 'small': return 'Small Projects';
      case 'large': return 'Large Projects';
      case 'adhoc': return 'Ad-Hoc Only';
    }
  };

  const matchesDivisionFilter = (log: PerformanceLog): boolean => {
    if (divisionFilter === 'all') return true;
    if (divisionFilter === 'adhoc') return !!log.isAdHoc;
    const d = log.division || '';
    if (divisionFilter === 'lawn') return /lawn/i.test(d);
    if (divisionFilter === 'small') return /small/i.test(d);
    if (divisionFilter === 'large') return /large/i.test(d);
    return true;
  };
  const [removeWorkerCtx, setRemoveWorkerCtx] = useState<
    { cId: string; empId: string } | null
  >(null);
  const [removeWorkerReason, setRemoveWorkerReason] = useState<string>('');
  const [removeWorkerOther, setRemoveWorkerOther] = useState<string>('');

  const REMOVE_REASONS = ['No-show', 'Switched crews', 'Sick', 'Other'];

  const openRemoveWorker = (cId: string, empId: string) => {
    setRemoveWorkerCtx({ cId, empId });
    setRemoveWorkerReason('');
    setRemoveWorkerOther('');
  };

  const closeRemoveWorker = () => {
    setRemoveWorkerCtx(null);
    setRemoveWorkerReason('');
    setRemoveWorkerOther('');
  };

  const confirmRemoveWorker = () => {
    if (!removeWorkerCtx) return;
    const { cId, empId } = removeWorkerCtx;
    const reason = removeWorkerReason === 'Other'
      ? (removeWorkerOther.trim() || 'Other')
      : removeWorkerReason;
    if (!reason) return;
    setDailyLogs(p => {
      const n = { ...p };
      const log = n[cId];
      if (!log) return n;
      const newAH = { ...log.employeeAH };
      const newDeduc = { ...log.deductions };
      delete newAH[empId];
      delete newDeduc[empId];
      const removed = Array.from(
        new Set([...(log.removedEmployees || []), empId]),
      );
      n[cId] = {
        ...log,
        employeeAH: newAH,
        deductions: newDeduc,
        removedEmployees: removed,
      };
      return n;
    });
    logPerfActivity({
      type: 'worker_removed',
      ...auditCtx(cId),
      workerId: empId,
      workerName: getEmpName(empId),
      reason,
    });
    closeRemoveWorker();
  };

  const handleDeleteClick = async (cId: string) => {
    if (deletingIds.has(cId)) return;
    setDeletingIds(prev => { const n = new Set(prev); n.add(cId); return n; });
    try {
      await onDeleteEntry(cId);
    } finally {
      setDeletingIds(prev => { const n = new Set(prev); n.delete(cId); return n; });
    }
  };

  useEffect(() => {
    if (!jobberConnected) { setLastSync(null); return; }
    const q = query(
      collection(db, 'artifacts', appId, 'private', 'data', 'syncLog'),
      where('targetDate', '==', perfDate),
    );
    return onSnapshot(q, snap => {
      const entries = snap.docs.map(d => d.data() as SyncLogEntry);
      entries.sort((a, b) => (b.triggeredAt || 0) - (a.triggeredAt || 0));
      setLastSync(entries[0] || null);
    }, () => setLastSync(null));
  }, [perfDate, jobberConnected]);

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      // Persist any in-progress local edits (new manual job rows,
      // unscheduled employees, AH inputs) BEFORE the cloud function reads
      // Firestore. Otherwise the sync's write triggers a snapshot, the
      // rebuild useEffect runs, and unsaved local state gets clobbered.
      await Promise.resolve(onSaveDaily());
      const sync = httpsCallable<{ targetDate: string }, {
        visitsParsed: number; visitsUnmatched: number; parseErrors: number;
        crewsAffected: number; entriesCreated: number; entriesUpdated: number;
        entriesSkippedApproved: number;
      }>(functions, 'jobberSyncPerformance');
      const res = await sync({ targetDate: perfDate });
      const d = res.data;
      const skipped = d.entriesSkippedApproved > 0 ? `, ${d.entriesSkippedApproved} skipped (approved)` : '';
      const unmatched = d.visitsUnmatched > 0 ? `, ${d.visitsUnmatched} unmatched` : '';
      const errors = d.parseErrors > 0 ? `, ${d.parseErrors} parse error${d.parseErrors === 1 ? '' : 's'}` : '';
      showToastMsg(`Synced ${d.visitsParsed} visits across ${d.crewsAffected} crew${d.crewsAffected === 1 ? '' : 's'}${skipped}${unmatched}${errors}.`);
    } catch (err: any) {
      showToastMsg(`Sync failed: ${err?.message || String(err)}`);
    } finally {
      setSyncing(false);
    }
  };

  const formatRelativeTime = (ms: number): string => {
    const diff = Date.now() - ms;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(ms).toLocaleDateString();
  };

  const calcReports = () => {
    let totals = { bh: 0, ah: 0, jobs: 0 };
    let divStats: Record<string, any> = {}; DIVISIONS.forEach(d => divStats[d] = { bh: 0, ah: 0, jobs: 0 });
    let crewStats: Record<string, any> = {}; let empStats: Record<string, any> = {};

    Object.entries(performance || {}).forEach(([date, dayLogs]) => {
      if (date >= reportStartDate && date <= reportEndDate) {
        Object.entries(dayLogs).forEach(([crewId, log]) => {
          const div = log.division || 'Large Projects';
          const cName = `${div} ${log.crewNumber || 1}`;

          let cBH = log.jobs.reduce((s: number, j: any) => s + Number(j.bh || 0), 0);
          let rawAH = Object.values(log.employeeAH).reduce((s: number, v: any) => s + Number(v || 0), 0);
          let deducAH = 0;
          for (const v of Object.values(log.deductions || {})) deducAH += deductHours(v as DeductionValue);
          let cAH = Math.max(0, rawAH - deducAH); // Net AH
          let jCount = log.jobs.length;

          totals.bh += cBH; totals.ah += cAH; totals.jobs += jCount;
          if (divStats[div]) { divStats[div].bh += cBH; divStats[div].ah += cAH; divStats[div].jobs += jCount; }

          if (!crewStats[cName]) crewStats[cName] = { div, bh: 0, ah: 0, jobs: 0 };
          crewStats[cName].bh += cBH; crewStats[cName].ah += cAH; crewStats[cName].jobs += jCount;

          Object.entries(log.employeeAH).forEach(([empId, ah]) => {
            const baseAH = Number(ah || 0);
            const indvDeduc = deductHours(log.deductions?.[empId]);
            const eAH = Math.max(0, baseAH - indvDeduc);

            if (eAH > 0) {
              const eBH = cAH > 0 ? cBH * (eAH / cAH) : 0;
              if (!empStats[empId]) empStats[empId] = { name: getEmpName(empId), bh: 0, ah: 0 };
              empStats[empId].ah += eAH; empStats[empId].bh += eBH;
            }
          });
        });
      }
    });
    return { totals, divStats, crewStats, empStats };
  };

  const r = calcReports();
  const overallEff = r.totals.ah > 0 ? Number(((r.totals.bh / r.totals.ah) * 100).toFixed(1)) : 0;

  const getCompletedRouteIdsForWeek = () => {
    const perfWeekStart = getStartOfWeek(perfDate);
    const completedIds = new Set<string>();
    for (let i = 0; i < 7; i++) {
      const d = formatDate(addDays(perfWeekStart, i));
      const dayLogs = performance[d] || {};
      Object.values(dayLogs).forEach((log: PerformanceLog) => { log.jobs.forEach((job: any) => { if (job.routeId) completedIds.add(job.routeId); }); });
      if (d === perfDate && Object.keys(dailyLogs).length > 0) {
        Object.values(dailyLogs).forEach((log: PerformanceLog) => { log.jobs.forEach((job: any) => { if (job.routeId) completedIds.add(job.routeId); }); });
      }
    }
    return completedIds;
  };

  const addSelectedRoutes = () => {
    if (!routeModalCrewId) return;
    const targetCrew = routeModalCrewId;
    const newLogs = { ...dailyLogs };
    const addedRoutes: Array<{ name: string; bh: number }> = [];
    selectedRouteIds.forEach(rId => {
      const route = routes.find(r => r.id === rId);
      if (route) {
        newLogs[targetCrew].jobs.push({ desc: route.name, bh: route.bh, routeId: route.id, source: 'manual' });
        addedRoutes.push({ name: route.name, bh: route.bh });
      }
    });
    setDailyLogs(newLogs);
    for (const r of addedRoutes) {
      logPerfActivity({
        type: 'manual_job_added',
        ...auditCtx(targetCrew),
        jobTitle: r.name,
        valueAfter: r.bh,
        valueLabel: 'BH',
      });
    }
    setRouteModalCrewId(null); setSelectedRouteIds(new Set());
  };

  return (
    <div className="flex-1 flex flex-col md:h-full overflow-y-auto bg-gray-100 p-6 pb-24 md:pb-6 print:bg-white print:pb-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><TrendingUp className="w-6 h-6 text-emerald-600" /> PerformanceMaster</h2>
        <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
          <button onClick={() => setPerfTab('entry')} className={`flex items-center gap-2 px-4 py-1.5 text-sm font-bold rounded-md ${perfTab === 'entry' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500 hover:text-gray-700'}`}><CalendarDays className="w-4 h-4" /> Daily Entry</button>
          <button onClick={() => setPerfTab('reports')} className={`flex items-center gap-2 px-4 py-1.5 text-sm font-bold rounded-md ${perfTab === 'reports' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500 hover:text-gray-700'}`}><BarChart className="w-4 h-4" /> Advanced Reports</button>
          {can('canViewPerfActivityLog', currentUserRole) && (
            <button onClick={() => setPerfTab('activity')} className={`flex items-center gap-2 px-4 py-1.5 text-sm font-bold rounded-md ${perfTab === 'activity' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500 hover:text-gray-700'}`}><Clock className="w-4 h-4" /> Activity Log</button>
          )}
        </div>
      </div>

      {perfTab === 'activity' ? (
        <PerformanceActivityLog setPerfTab={setPerfTab} setPerfDate={setPerfDate} showToastMsg={showToastMsg} />
      ) : perfTab === 'entry' ? (
        <div className="max-w-4xl mx-auto w-full pb-20 relative">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6 sticky top-0 z-10">
            <div className="flex justify-between items-center flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-bold text-gray-700">Select Date to Log:</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPerfDate(addDaysToronto(perfDate, -1))}
                    aria-label="Previous day"
                    title="Previous day"
                    className="w-10 h-10 flex items-center justify-center border border-gray-300 rounded text-slate-600 hover:bg-slate-50 focus:ring-2 focus:ring-emerald-400 outline-none"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <input type="date" value={perfDate} onChange={e => setPerfDate(e.target.value)} className="border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-emerald-400 outline-none font-medium" />
                  <button
                    type="button"
                    onClick={() => setPerfDate(addDaysToronto(perfDate, 1))}
                    aria-label="Next day"
                    title="Next day"
                    className="w-10 h-10 flex items-center justify-center border border-gray-300 rounded text-slate-600 hover:bg-slate-50 focus:ring-2 focus:ring-emerald-400 outline-none"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-slate-400" />
                  <select
                    value={divisionFilter}
                    onChange={e => setDivisionFilter(e.target.value as any)}
                    className="text-xs font-bold border border-gray-300 rounded p-1.5 bg-white text-slate-700"
                    title="Filter visible crews by division"
                  >
                    <option value="all">{divisionLabel('all')}</option>
                    <option value="lawn">{divisionLabel('lawn')}</option>
                    <option value="small">{divisionLabel('small')}</option>
                    <option value="large">{divisionLabel('large')}</option>
                    <option value="adhoc">{divisionLabel('adhoc')}</option>
                  </select>
                </div>
                {(() => {
                  const total = Object.keys(dailyLogs).length;
                  if (total === 0) return null;
                  const approved = Object.values(dailyLogs).filter(l => l.approvalStatus === 'approved').length;
                  return (
                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded ${approved === total ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {approved} of {total} approved
                    </span>
                  );
                })()}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {jobberConnected && canSyncJobber && (
                  <button
                    onClick={handleSyncNow}
                    disabled={syncing}
                    className="bg-lime-600 hover:bg-lime-700 text-white px-4 py-2 rounded-lg font-bold shadow flex items-center gap-2 disabled:opacity-60"
                    title="Pull Jobber visits + timesheets for this date and merge into drafts."
                  >
                    <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /> {syncing ? 'Syncing…' : 'Sync Now'}
                  </button>
                )}
                <button onClick={onSaveDaily} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg font-bold shadow flex items-center gap-2">
                  <Save className="w-4 h-4" /> Save Daily Data
                </button>
              </div>
            </div>
            {jobberConnected && lastSync && (
              <div className="mt-2 text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
                <Link2 className="w-3 h-3 text-lime-500" />
                <span>
                  Last synced {formatRelativeTime(lastSync.triggeredAt)}
                  {lastSync.triggeredBy === 'scheduled' ? ' (auto)' : ' (manual)'}
                  {typeof lastSync.visitsParsed === 'number' ? ` · ${lastSync.visitsParsed} visits` : ''}
                  {typeof lastSync.crewsAffected === 'number' ? `, ${lastSync.crewsAffected} crew${lastSync.crewsAffected === 1 ? '' : 's'}` : ''}
                  {lastSync.parseErrors > 0 ? ` · ${lastSync.parseErrors} parse error${lastSync.parseErrors === 1 ? '' : 's'}` : ''}
                  {lastSync.visitsUnmatched > 0 ? ` · ${lastSync.visitsUnmatched} unmatched` : ''}
                </span>
              </div>
            )}
          </div>

          {pendingCarryForward.length > 0 && (
            <div className="mb-4 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2 text-sm text-amber-900">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  <span className="font-bold">{pendingCarryForward.length}</span>
                  {' '}multi-day job{pendingCarryForward.length === 1 ? '' : 's'} in progress from prior days{' '}
                  not scheduled in Jobber today.
                </span>
              </div>
              <button
                onClick={() => setCarryForwardModalOpen(true)}
                className="min-h-[44px] text-[11px] font-black uppercase tracking-widest bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 rounded-lg shadow shrink-0"
              >
                Review
              </button>
            </div>
          )}

          {Object.keys(dailyLogs).length === 0 ? (
            <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-10 flex flex-col items-center justify-center text-gray-500">
              <CalendarIcon className="w-10 h-10 mb-3 opacity-20" />
              <p>No crews scheduled or logged for this date.</p>
              <button onClick={() => setDailyLogs(p => ({ ...p, [`adhoc-${Date.now()}`]: { division: 'Large Projects', crewNumber: 1, jobs: [], employeeAH: {}, deductions: {}, isAdHoc: true } }))} className="mt-4 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium shadow-sm hover:bg-gray-50">+ Add Unscheduled Crew</button>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(dailyLogs).filter(([, log]) => matchesDivisionFilter(log)).map(([cId, log]) => {
                const sumBH = log.jobs.reduce((s: number, j: any) => {
                  const bh = Number(j.bh || 0);
                  // Skip only UNcredited incomplete rows (pure ghost rows).
                  // A partially-credited incomplete row contributes its credit.
                  if (j.isIncompleteVisit && bh <= 0) return s;
                  return s + bh;
                }, 0);
                const rawAH = Object.values(log.employeeAH).reduce((s: number, v: any) => s + Number(v || 0), 0);
                let deducAH = 0;
                for (const v of Object.values(log.deductions || {})) deducAH += deductHours(v as DeductionValue);
                const sumAH = Math.max(0, rawAH - deducAH);
                const eff = sumAH > 0 ? Number(((sumBH / sumAH) * 100).toFixed(1)) : 0;

                // Crew-size allowance — additive on top of raw eff. The
                // sync stamps log.crewSizeAllowance per crew-day; in its
                // absence (today before the first sync, ad-hoc crews,
                // legacy data) we fall back to a live compute from the
                // current settings table. Bracket comes from the
                // SCHEDULED roster minus removedEmployees, never from
                // employeeAH (drop-ins don't inflate the size).
                const crewObj = (appData.schedules?.[perfDate] || []).find(c => c.id === cId);
                const allowance = getCrewAllowance(crewObj, log, appData.settings);
                const rawEffOrNull = sumAH > 0 ? eff : null;
                const adjEffNum = adjustedEfficiency(rawEffOrNull, allowance.pct);
                const effForColor = adjEffNum ?? 0;
                const effTag = allowanceTag(allowance.size, allowance.pct);

                let effColor = 'text-gray-500 bg-gray-100 border-gray-200';
                if (sumAH > 0) {
                  if (effForColor >= 90) effColor = 'text-purple-700 bg-purple-100 border-purple-300 shadow-purple-100';
                  else if (effForColor >= 80) effColor = 'text-emerald-700 bg-emerald-100 border-emerald-300 shadow-emerald-100';
                  else if (effForColor >= 70) effColor = 'text-yellow-700 bg-yellow-100 border-yellow-300 shadow-yellow-100';
                  else effColor = 'text-red-700 bg-red-100 border-red-300 shadow-red-100';
                }

                const isApproved = log.approvalStatus === 'approved';
                const lockTitle = isApproved ? 'Approved — unapprove to edit' : undefined;
                const approvedDate = log.approvedAt ? new Date(log.approvedAt) : null;
                const approvedDateStr = approvedDate ? approvedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
                const approvedTimeStr = approvedDate ? approvedDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
                const approverName = log.approvedByName || log.approvedBy || 'Unknown';
                return (
                  <div key={cId} className={`bg-white rounded-xl shadow-sm border overflow-hidden relative ${isApproved ? 'border-emerald-300' : 'border-gray-200'}`}>
                    {log.isAdHoc && <div className="absolute top-0 left-0 w-1 h-full bg-orange-400"></div>}
                    {!isApproved && canDeleteEntry(cId) && (
                      <button
                        type="button"
                        onClick={() => handleDeleteClick(cId)}
                        disabled={deletingIds.has(cId)}
                        title={log.isAdHoc ? 'Delete this unscheduled crew entry' : 'Clear all data for this entry'}
                        aria-label="Delete entry"
                        className="absolute top-2 left-3 z-10 text-slate-400 hover:text-rose-500 p-1.5 rounded transition-colors disabled:opacity-40 disabled:cursor-wait"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}

                    {isApproved ? (
                      <div className="border-b border-emerald-200 bg-emerald-50/40 p-4 pl-5">
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex-1 min-w-0">
                            <div
                              className="inline-block px-3 py-1 border-[3px] border-double border-emerald-700 text-emerald-700 font-black uppercase text-sm tracking-[0.25em] opacity-85 select-none"
                              style={{ transform: 'rotate(-4deg)' }}
                              title={lockTitle}
                            >
                              Approved
                            </div>
                            <div className="mt-3 max-w-[280px]">
                              <div
                                className="text-3xl text-slate-800 leading-none pl-1"
                                style={{ fontFamily: "'Caveat', 'Snell Roundhand', cursive", fontWeight: 600 }}
                              >
                                {approverName}
                              </div>
                              <div className="border-b border-slate-300 mt-1" />
                              <div className="text-[10px] text-slate-500 mt-1.5 font-medium tracking-wide uppercase">
                                Approved {approvedDateStr}{approvedTimeStr && <span className="text-slate-400"> · {approvedTimeStr}</span>}
                              </div>
                            </div>
                            <div className="mt-3 flex gap-2 items-center flex-wrap">
                              {log.isAdHoc ? <span className="text-[10px] bg-orange-100 text-orange-800 uppercase px-1.5 py-0.5 rounded font-bold">Ad-Hoc</span> : null}
                              <select value={log.division} onChange={e => setDailyLogs(p => ({ ...p, [cId]: { ...p[cId], division: e.target.value } }))} className="font-bold text-slate-700 bg-transparent border-transparent rounded px-2 py-1 outline-none cursor-not-allowed text-sm" disabled title={lockTitle}>
                                {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
                              </select>
                              <select value={log.crewNumber} onChange={e => setDailyLogs(p => ({ ...p, [cId]: { ...p[cId], crewNumber: Number(e.target.value) } }))} className="font-bold text-slate-700 bg-transparent border-transparent rounded px-2 py-1 outline-none cursor-not-allowed text-sm" disabled title={lockTitle}>
                                {CREW_NUMBERS.map(n => <option key={n} value={n}>{n}</option>)}
                              </select>
                            </div>
                          </div>
                          <div className="shrink-0">
                            <div className={`px-4 py-2 rounded-lg border shadow-sm font-bold flex flex-col items-center ${effColor}`}>
                              <span className="text-xs uppercase tracking-wide opacity-80 mb-0.5">Efficiency</span>
                              <span className="text-2xl leading-none">{sumAH > 0 && adjEffNum !== null ? `${adjEffNum}%` : '--'}</span>
                              {sumAH > 0 && effTag && (
                                <span className="text-[9px] font-medium tracking-wide opacity-80 mt-0.5">Raw {eff}% · {effTag}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="border-b border-gray-200 bg-gray-50 p-3 pl-4 flex justify-between items-center">
                        <div className="flex-1 flex gap-2 items-center">
                          {log.isAdHoc ? <span className="text-[10px] bg-orange-100 text-orange-800 uppercase px-1.5 py-0.5 rounded font-bold">Ad-Hoc</span> : null}
                          <select value={log.division} onChange={e => setDailyLogs(p => ({ ...p, [cId]: { ...p[cId], division: e.target.value } }))} className="font-bold text-gray-800 bg-white border border-gray-300 rounded px-2 py-1 outline-none disabled:bg-transparent disabled:border-transparent" disabled={!log.isAdHoc}>
                            {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                          <select value={log.crewNumber} onChange={e => setDailyLogs(p => ({ ...p, [cId]: { ...p[cId], crewNumber: Number(e.target.value) } }))} className="font-bold text-gray-800 bg-white border border-gray-300 rounded px-2 py-1 outline-none disabled:bg-transparent disabled:border-transparent" disabled={!log.isAdHoc}>
                            {CREW_NUMBERS.map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className={`px-4 py-2 rounded-lg border shadow-sm font-bold flex flex-col items-center ${effColor}`}>
                            <span className="text-xs uppercase tracking-wide opacity-80 mb-0.5">Efficiency</span>
                            <span className="text-2xl leading-none">{sumAH > 0 && adjEffNum !== null ? `${adjEffNum}%` : '--'}</span>
                            {sumAH > 0 && effTag && (
                              <span className="text-[9px] font-medium tracking-wide opacity-80 mt-0.5">Raw {eff}% · {effTag}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className={`px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-2 ${isApproved ? 'bg-white border-emerald-100' : 'bg-amber-50 border-amber-200'}`}>
                      {isApproved ? (
                        <span className="text-[10px] font-medium tracking-wide text-slate-400 italic">Locked by approval — unapprove to edit BH / AH / deductions.</span>
                      ) : (
                        <span className="text-[11px] font-black uppercase tracking-widest text-amber-800 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" /> Pending Review
                        </span>
                      )}
                      {isManager && (
                        isApproved ? (
                          <button
                            onClick={() => {
                              if (confirm("Unapprove this crew's performance? You'll be able to edit again.")) {
                                onUnapprove(cId);
                              }
                            }}
                            className="text-[10px] font-black uppercase tracking-widest bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 px-3 py-1.5 rounded-lg flex items-center gap-1.5"
                          >
                            <Unlock className="w-3.5 h-3.5" /> Unapprove
                          </button>
                        ) : (() => {
                          const missingAH = Object.entries(log.employeeAH)
                            .filter(([, v]) => v === '' || v == null || Number.isNaN(Number(v)))
                            .map(([eId]) => getEmpName(eId));
                          // Item 2: an incomplete row never blocks approval — partial
                          // completion is opt-in. Only genuinely-pending complete rows gate.
                          const awaitingReviewCount = log.jobs.filter((j: PerformanceJobRow) => j.awaitingCompletionReview && !j.isIncompleteVisit).length;
                          const awaitingHourlyCount = log.jobs.filter((j: PerformanceJobRow) => j.awaitingHourlyBH && (Number(j.bh) || 0) <= 0).length;
                          const awaitingBhTagCount = log.jobs.filter((j: PerformanceJobRow) => j.awaitingBhTag && (Number(j.bh) || 0) <= 0).length;
                          const blocked = missingAH.length > 0 || awaitingReviewCount > 0 || awaitingHourlyCount > 0 || awaitingBhTagCount > 0;
                          const reasons: string[] = [];
                          if (awaitingReviewCount > 0) reasons.push(`${awaitingReviewCount} multi-day visit${awaitingReviewCount === 1 ? '' : 's'} need completion review`);
                          if (awaitingHourlyCount > 0) reasons.push(`${awaitingHourlyCount} hourly visit${awaitingHourlyCount === 1 ? '' : 's'} need BH entered`);
                          if (awaitingBhTagCount > 0) reasons.push(`${awaitingBhTagCount} visit${awaitingBhTagCount === 1 ? '' : 's'} need a BH tag — enter manually`);
                          if (missingAH.length > 0) reasons.push(`missing clock-out for ${missingAH.join(', ')}`);
                          const tip = reasons.length > 0 ? `Cannot approve — ${reasons.join('; ')}` : undefined;
                          return (
                            <button
                              onClick={() => {
                                if (blocked) return;
                                if (confirm(`Approve this crew's performance for ${perfDate}? This will lock the BH/AH data.`)) {
                                  onApprove(cId, log);
                                }
                              }}
                              disabled={blocked}
                              title={tip}
                              className={`min-h-[40px] text-[11px] font-black uppercase tracking-widest px-4 py-2 rounded-lg flex items-center gap-1.5 shadow ${blocked ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}
                            >
                              <CheckCircle className="w-3.5 h-3.5" /> Approve & Sign Off
                            </button>
                          );
                        })()
                      )}
                    </div>

                    {/* Freshness disclaimer — sub-header strip, once per
                        crew card. Sits between the status strip and the
                        job rows so it's visible without crowding any row. */}
                    <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
                      <p className="text-[11px] text-slate-500 italic leading-snug">
                        Efficiency updates after the crew clocks out in Jobber and visits are marked complete. Numbers may be incomplete if the day isn't fully closed out.
                      </p>
                    </div>

                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="font-semibold text-gray-700 mb-3 flex justify-between border-b pb-2"><span className="flex items-center gap-1.5"><Target className="w-4 h-4 text-emerald-600" /> Completed Jobs (BH)</span><span className="text-sm bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded font-bold">Total: {sumBH.toFixed(1)} BH</span></h4>
                        <div className="space-y-2">
                          {log.jobs.map((job: PerformanceJobRow, jIdx) => {
                            const isJobber = job.source === 'jobber';
                            const isRemoved = !!job.removedFromJobber;
                            const hasConflict = !!job.hasJobberConflict;
                            const awaitingReview = !!job.awaitingCompletionReview;
                            const awaitingHourly = !!job.awaitingHourlyBH && (Number(job.bh) || 0) <= 0;
                            const awaitingBhTag = !!job.awaitingBhTag && (Number(job.bh) || 0) <= 0;
                            const isIncomplete = !!job.isIncompleteVisit;
                            const isGhost = !!job.movedToDate;
                            // Visit-keyed lookup — never falls through to a sibling
                            // visit's ledger. THIS is the structural fix.
                            const mdJob = job.jobberVisitId ? multiDayJobs[job.jobberVisitId] : undefined;
                            // "Multi-day" status — only render the dedicated status
                            // block when the row is actually mid-flow. A simple
                            // single-completion mdJob (one history entry at 100%,
                            // status complete) is treated as a normal completion
                            // and renders the standard ✓ one-liner below.
                            const mdHist = mdJob?.completionHistory || [];
                            const isMultiDay = !!mdJob && (
                              isIncomplete ||
                              awaitingReview ||
                              mdHist.length > 1 ||
                              (mdHist.length === 1 && mdHist[0].percentComplete < 100) ||
                              mdJob.status === 'in_progress'
                            );
                            const rowBg = isGhost
                              ? 'bg-slate-100 border-slate-200 opacity-75'
                              : isIncomplete
                                ? 'bg-slate-50 border-slate-200 border-dashed'
                                : awaitingHourly
                                  ? 'bg-amber-50 border-amber-300 border-dashed'
                                  : awaitingReview
                                    ? 'bg-amber-50 border-amber-300 border-dashed'
                                    : isRemoved
                                      ? 'bg-amber-50/60 border-amber-200'
                                      : hasConflict
                                        ? 'bg-amber-50/40 border-amber-200'
                                        : 'bg-gray-50 border-gray-200';
                            const menuKey = `${cId}::${jIdx}`;
                            const menuOpen = rowMenuKey === menuKey;
                            // Item 3: an incomplete hourly visit — manager logs hours
                            // for the day; the row is editable (1 hr = 1 BH).
                            const isHourlyIncomplete = isIncomplete && job.jobberTagType === 'hourly';
                            const bhEditable = !isJobber || !!job.manuallyEditedAt || awaitingHourly || awaitingBhTag || isHourlyIncomplete;
                            const isBHLocked = isJobber && !bhEditable && !isIncomplete && !awaitingReview;
                            const isBHUnlocked = isJobber && !!job.manuallyEditedAt && !isIncomplete && !awaitingReview && !awaitingHourly && !awaitingBhTag;
                            const isHourlyRow = !!job.awaitingHourlyBH || job.jobberTagType === 'hourly';
                            // No more "lawn ghost" — lawn and non-lawn incomplete
                            // rows take the same path. The kebab is available on
                            // every Jobber row (incomplete or complete) so the
                            // optional partial-completion flow lives there.
                            const canShowMenu = canOverrideJobType && isJobber;
                            const showConvertOption = canOverrideJobType && !!job.jobberVisitId && !isHourlyRow && !isIncomplete;
                            // Partial-completion kebab option: any Jobber row with
                            // a parsed totalBH and visit id. Replaces the forced
                            // amber buttons that used to sit on the row.
                            const showMarkPartialOption =
                              canMarkMultiDay && isJobber && !isGhost &&
                              !isHourlyRow && !awaitingHourly && !awaitingBhTag &&
                              !!job.jobberVisitId && Number(job.totalBH || 0) > 0;
                            const markPartialLabel = (mdHist.length > 0 || awaitingReview)
                              ? 'Adjust partial %'
                              : 'Mark partial %';
                            // Multi-crew BH split. vSplit is shared by every
                            // crew's row for this visit. isMultiCrew gates the
                            // chip and the "Split BH between crews" kebab item.
                            const vSplit = job.jobberVisitId
                              ? (appData.visitBHSplits || {})[job.jobberVisitId]
                              : undefined;
                            const isMultiCrew = !!vSplit && vSplit.splits.length > 1;
                            const showSplitBHOption = isMultiCrew && canMarkMultiDay && isJobber && !isGhost;
                            const handleAcceptJobber = () => {
                              if (typeof job.jobberSuggestedValue !== 'number') return;
                              if (!confirm(`Accept Jobber's value of ${job.jobberSuggestedValue} BH (replacing your ${job.bh} BH)?`)) return;
                              setDailyLogs(p => { const n = { ...p }; n[cId] = { ...n[cId], jobs: n[cId].jobs.map((j, i) => i === jIdx ? { ...j, bh: job.jobberSuggestedValue!, manuallyEditedAt: undefined, hasJobberConflict: false, jobberSuggestedValue: undefined } : j) }; return n; });
                            };
                            const handleKeepManual = () => {
                              setDailyLogs(p => { const n = { ...p }; n[cId] = { ...n[cId], jobs: n[cId].jobs.map((j, i) => i === jIdx ? { ...j, hasJobberConflict: false, jobberSuggestedValue: undefined } : j) }; return n; });
                            };
                            return (
                              <div key={jIdx} className={`flex flex-col gap-1 p-1.5 rounded border ${rowBg}`}>
                              {isJobber && job.desc && (
                                <div className="text-xs font-semibold text-slate-600 px-1 leading-snug break-words">
                                  {job.desc}
                                  {job.jobberJobNumber && <span className="text-slate-400 font-medium ml-1">· #{job.jobberJobNumber}</span>}
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                {isHourlyIncomplete ? (
                                  <span title="Hourly job, still open in Jobber — log the hours worked today; it carries forward until complete" className="shrink-0 text-[9px] font-black uppercase tracking-widest bg-amber-200 text-amber-900 border border-amber-400 px-1.5 py-0.5 rounded">Hourly — Log Hours</span>
                                ) : isIncomplete ? (
                                  <span title="Visit not yet marked complete in Jobber — 0 BH until partially marked or completed" className="shrink-0 text-[9px] font-black uppercase tracking-widest bg-slate-200 text-slate-600 border border-slate-300 px-1.5 py-0.5 rounded">Not Complete</span>
                                ) : awaitingHourly ? (
                                  <span title="Hourly job — manager calculates BH manually" className="shrink-0 text-[9px] font-black uppercase tracking-widest bg-amber-200 text-amber-900 border border-amber-400 px-1.5 py-0.5 rounded">Hourly — Enter BH</span>
                                ) : awaitingBhTag ? (
                                  <span title="Visit complete in Jobber but title has no [XBH] tag — enter BH manually" className="shrink-0 text-[9px] font-black uppercase tracking-widest bg-amber-200 text-amber-900 border border-amber-400 px-1.5 py-0.5 rounded">Awaiting BH tag</span>
                                ) : awaitingReview ? (
                                  <span title="Multi-day job — manager must review % complete" className="shrink-0 text-[9px] font-black uppercase tracking-widest bg-amber-200 text-amber-900 border border-amber-400 px-1.5 py-0.5 rounded">Pending</span>
                                ) : isJobber ? (
                                  <span title={job.jobberJobNumber ? `Jobber job #${job.jobberJobNumber}` : 'Synced from Jobber'} className="shrink-0 text-[9px] font-black uppercase tracking-widest bg-lime-100 text-lime-700 border border-lime-300 px-1.5 py-0.5 rounded">Jobber</span>
                                ) : (
                                  <FileSignature className="w-4 h-4 text-gray-400 ml-1 flex-shrink-0" />
                                )}
                                {job.manuallyShifted && job.shiftedFromDate && (
                                  <span
                                    title={
                                      job.shiftHistory && job.shiftHistory.length > 0
                                        ? job.shiftHistory.map(h => `${h.fromDate} → ${h.toDate} by ${h.userName}`).join(' · ')
                                        : `Shifted from ${job.shiftedFromDate}`
                                    }
                                    className="shrink-0 text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded"
                                  >
                                    Shifted from {job.shiftedFromDate}
                                  </span>
                                )}
                                {isGhost && job.movedToDate && (
                                  <span
                                    title={`Visit was on this date originally; credit moved to ${job.movedToDate} after Jobber completion.`}
                                    className="shrink-0 text-[10px] font-bold text-slate-500 bg-slate-200 border border-slate-300 px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                                  >
                                    Completed {job.movedToDate}, credit moved →
                                  </span>
                                )}
                                {/* Multi-crew split chip used to live here in
                                    the main-row flex cluster, but on narrow
                                    mobile widths it pushed the shift arrows
                                    and delete-X out of view. It's rendered
                                    on its own line below the row instead — see
                                    the `isMultiCrew && vSplit && ...` block
                                    near the row-bottom status area. */}
                                {isJobber ? (
                                  // Title now lives above the row for Jobber rows (read-only, full text).
                                  // Spacer keeps the chips/BH input/actions laid out the same way.
                                  <div className="flex-1 min-w-0" />
                                ) : (
                                  <input
                                    type="text"
                                    placeholder="Job Desc"
                                    value={job.desc}
                                    disabled={isApproved || isIncomplete || isGhost}
                                    title={isGhost ? `Credit moved to ${job.movedToDate} — kept here as audit ghost on locked day` : isIncomplete ? 'Visit not complete in Jobber — read-only' : isRemoved ? 'No longer in Jobber — remove or keep manually?' : lockTitle}
                                    onChange={e => setDailyLogs(p => { const n = { ...p }; n[cId] = { ...n[cId], jobs: n[cId].jobs.map((j, i) => i === jIdx ? { ...j, desc: e.target.value } : j) }; return n; })}
                                    className={`flex-1 min-w-0 border border-gray-300 rounded p-1.5 text-sm outline-none bg-white font-medium disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed ${isRemoved ? 'line-through text-amber-700' : ''} ${isIncomplete ? 'italic text-slate-400' : ''} ${isGhost ? 'italic text-slate-400 line-through' : ''}`}
                                  />
                                )}
                                {(() => {
                                  const bhKey = draftKey(cId, jIdx, 'bh');
                                  // Incomplete non-hourly rows: BH is read-only (credit comes
                                  // from the optional partial-completion flow in the kebab,
                                  // not typing). Incomplete hourly rows: BH input is editable.
                                  const inputDisabled = isApproved || isGhost || (isIncomplete && !isHourlyIncomplete);
                                  return (
                                <>
                                <input
                                  type="number"
                                  step="0.1"
                                  placeholder={isHourlyIncomplete ? 'Hrs' : 'BH'}
                                  value={inputValue(bhKey, job.bh)}
                                  disabled={inputDisabled}
                                  readOnly={isBHLocked && !isApproved}
                                  title={
                                    isHourlyIncomplete ? 'Hours worked today on this hourly job (1 hr = 1 BH)'
                                    : isIncomplete ? 'Not counted until partially marked or completed'
                                    : isRemoved ? 'No longer in Jobber — remove or keep manually?'
                                    : isBHLocked ? 'Locked — click ⋯ to edit'
                                    : isBHUnlocked ? 'Manually edited — click ⋯ to revert'
                                    : lockTitle
                                  }
                                  onChange={e => setDraft(bhKey, e.target.value)}
                                  onBlur={() => {
                                    const draftVal = inputDrafts[bhKey];
                                    if (draftVal === undefined) return;
                                    const newBhNum = Number(draftVal);
                                    const filledAwaitingTag = !!job.awaitingBhTag && Number.isFinite(newBhNum) && newBhNum > 0;
                                    setDailyLogs(p => { const n = { ...p }; n[cId] = { ...n[cId], jobs: n[cId].jobs.map((j, i) => {
                                      if (i !== jIdx) return j;
                                      const nextJob: PerformanceJobRow = { ...j, bh: draftVal };
                                      if (j.source === 'jobber' && !j.awaitingHourlyBH && !j.awaitingBhTag && j.jobberTagType !== 'hourly') {
                                        nextJob.manuallyEditedAt = new Date().toISOString();
                                      }
                                      if (j.awaitingHourlyBH && Number(draftVal) > 0) {
                                        delete nextJob.awaitingHourlyBH;
                                      }
                                      if (j.awaitingBhTag && Number(draftVal) > 0) {
                                        delete nextJob.awaitingBhTag;
                                      }
                                      return nextJob;
                                    }) }; return n; });
                                    clearDraft(bhKey);
                                    if (filledAwaitingTag) {
                                      logPerfActivity({
                                        type: 'bh_filled_in_manually',
                                        ...auditCtx(cId),
                                        jobTitle: job.desc,
                                        jobberJobId: job.jobberJobId,
                                        sourceJobberVisitId: job.jobberVisitId,
                                        valueBefore: 0,
                                        valueAfter: newBhNum,
                                        valueLabel: 'BH',
                                      });
                                    }
                                  }}
                                  className={`w-16 border rounded p-1.5 text-sm outline-none bg-white font-mono font-bold text-emerald-700 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed ${isRemoved ? 'line-through' : ''} ${(awaitingHourly || awaitingBhTag || isHourlyIncomplete) ? 'border-amber-400 ring-1 ring-amber-200' : isBHLocked ? 'bg-slate-100 border-slate-200 cursor-not-allowed' : 'border-gray-300'} ${(isIncomplete && !isHourlyIncomplete) ? 'italic text-slate-400' : ''}`}
                                />
                                {/* Partial-completion action moved to the ⋯ menu — see showMarkPartialOption. */}
                                </>
                                  );
                                })()}
                                {isBHUnlocked && (
                                  <span title="Manually edited — click ⋯ to revert" className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                                )}
                                {hasConflict && !isApproved && (
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={handleAcceptJobber}
                                      title={`Jobber says ${job.jobberSuggestedValue} — click to accept`}
                                      className="text-[9px] font-black uppercase tracking-widest bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded flex items-center gap-1"
                                    >
                                      <AlertTriangle className="w-3 h-3" /> {job.jobberSuggestedValue}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={handleKeepManual}
                                      title="Keep my value, dismiss conflict"
                                      className="text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 px-1.5 py-0.5 rounded"
                                    >
                                      Keep
                                    </button>
                                  </div>
                                )}
                                {canShowMenu && !isApproved && !isGhost && (
                                  <div className="relative shrink-0">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        if (menuOpen) { setRowMenuKey(null); return; }
                                        // Flip the menu upward when there's
                                        // more room above the button than
                                        // below it. Estimated menu height
                                        // is ~280px (six 44px-tall items +
                                        // padding); below that threshold
                                        // we still try down first.
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const spaceBelow = window.innerHeight - rect.bottom;
                                        const spaceAbove = rect.top;
                                        const EST_MENU_H = 280;
                                        setRowMenuDir(
                                          spaceBelow < EST_MENU_H && spaceAbove > spaceBelow ? 'up' : 'down',
                                        );
                                        setRowMenuKey(menuKey);
                                      }}
                                      title="Row options"
                                      className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded"
                                      aria-label="Row options"
                                    >
                                      <MoreVertical className="w-4 h-4" />
                                    </button>
                                    {menuOpen && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => setRowMenuKey(null)}
                                          className="fixed inset-0 z-30 cursor-default"
                                          aria-label="Close menu"
                                        />
                                        {/* Flips up/down based on rowMenuDir;
                                            max-h + overflow-y-auto so the
                                            menu never extends past the
                                            viewport even when room is tight
                                            in both directions. */}
                                        <div className={`absolute right-0 ${rowMenuDir === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'} z-40 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[185px] max-h-[60vh] overflow-y-auto`}>
                                          {isBHLocked && !awaitingHourly && !isIncomplete && (
                                            <button
                                              type="button"
                                              onClick={() => unlockJobberBH(cId, jIdx)}
                                              className="block w-full text-left text-xs px-3 py-2.5 min-h-[44px] hover:bg-slate-50 text-slate-700"
                                            >
                                              Edit BH manually
                                            </button>
                                          )}
                                          {isBHUnlocked && (
                                            <button
                                              type="button"
                                              onClick={() => revertJobberBH(cId, jIdx)}
                                              className="block w-full text-left text-xs px-3 py-2.5 min-h-[44px] hover:bg-slate-50 text-slate-700"
                                            >
                                              Revert to Jobber value
                                            </button>
                                          )}
                                          {showConvertOption && (
                                            isMultiDay ? (
                                              <button
                                                type="button"
                                                onClick={() => convertRowType(cId, jIdx, 'to-single-day')}
                                                className="block w-full text-left text-xs px-3 py-2.5 min-h-[44px] hover:bg-slate-50 text-slate-700"
                                              >
                                                Convert to single-day
                                              </button>
                                            ) : (
                                              <button
                                                type="button"
                                                onClick={() => convertRowType(cId, jIdx, 'to-multi-day')}
                                                className="block w-full text-left text-xs px-3 py-2.5 min-h-[44px] hover:bg-slate-50 text-slate-700"
                                              >
                                                Convert to multi-day
                                              </button>
                                            )
                                          )}
                                          {showMarkPartialOption && (
                                            <button
                                              type="button"
                                              onClick={() => markPartiallyComplete(cId, jIdx)}
                                              className="block w-full text-left text-xs px-3 py-2.5 min-h-[44px] hover:bg-slate-50 text-slate-700"
                                            >
                                              {markPartialLabel}
                                            </button>
                                          )}
                                          {showSplitBHOption && job.jobberVisitId && vSplit && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setRowMenuKey(null);
                                                setSplitBHCtx({
                                                  visitId: job.jobberVisitId!,
                                                  visitTitle: job.desc,
                                                  visitTotalBH: vSplit.totalBH,
                                                });
                                              }}
                                              className="block w-full text-left text-xs px-3 py-2.5 min-h-[44px] hover:bg-slate-50 text-slate-700"
                                            >
                                              Split BH between crews
                                            </button>
                                          )}
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}
                                {isManager && isJobber && !awaitingHourly && !isApproved && !isGhost && (isIncomplete || !isMultiDay) && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleShiftRow(cId, jIdx, 'prev')}
                                      title="Shift to previous day"
                                      aria-label="Shift to previous day"
                                      className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"
                                    >
                                      <ChevronLeft className="w-4 h-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleShiftRow(cId, jIdx, 'next')}
                                      title="Shift to next day"
                                      aria-label="Shift to next day"
                                      className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"
                                    >
                                      <ChevronRight className="w-4 h-4" />
                                    </button>
                                  </>
                                )}
                                <button disabled={isApproved || isGhost} title={isGhost ? 'Audit ghost — cannot remove from locked day' : isRemoved ? 'Remove this row' : lockTitle} onClick={() => {
                                  if (isGhost) return;
                                  logPerfActivity({
                                    type: 'manual_job_removed',
                                    ...auditCtx(cId),
                                    jobTitle: job.desc || '(blank)',
                                    valueBefore: job.bh,
                                    valueLabel: 'BH',
                                    sourceJobberVisitId: job.jobberVisitId,
                                  });
                                  setDailyLogs(p => { const n = { ...p }; n[cId] = { ...n[cId], jobs: n[cId].jobs.filter((_, i) => i !== jIdx) }; return n; });
                                  // If this was a Jobber row with a ledger, scrub the
                                  // completionHistory entries for THIS date+crew on the
                                  // visit's ledger so the next sync rebuilds cleanly.
                                  // Other dates/crews on the same visit are preserved.
                                  const jvid = job.jobberVisitId;
                                  const existingMD = jvid ? appData.multiDayJobs?.[jvid] : undefined;
                                  if (jvid && existingMD) {
                                    const before = existingMD.completionHistory.length;
                                    const newHistory = existingMD.completionHistory.filter(
                                      h => !(h.targetDate === perfDate && h.crewId === cId),
                                    );
                                    if (newHistory.length !== before) {
                                      syncToCloud({
                                        ...appData,
                                        multiDayJobs: {
                                          ...(appData.multiDayJobs || {}),
                                          [jvid]: { ...existingMD, completionHistory: newHistory },
                                        },
                                      });
                                      logPerfActivity({
                                        type: 'job_type_converted',
                                        ...auditCtx(cId),
                                        jobberJobId: job.jobberJobId,
                                        sourceJobberVisitId: jvid,
                                        jobTitle: job.desc,
                                        reasonNote: `Cleared ${before - newHistory.length} completion entries on X-removal`,
                                      });
                                    }
                                  }
                                }} className="text-red-400 hover:text-red-600 p-1 disabled:opacity-30 disabled:cursor-not-allowed"><X className="w-4 h-4" /></button>
                              </div>
                              {/* Multi-crew split indicator — rendered on its
                                  own line below the main row so a long chip
                                  ("Split: 4 of 20 BH (auto)") doesn't compete
                                  for horizontal space with the BH input,
                                  kebab, shift arrows, and delete-X. */}
                              {isMultiCrew && vSplit && job.jobberVisitId && (() => {
                                const myShare = vSplit.splits.find(s => s.crewId === cId)?.bh ?? 0;
                                return (
                                  <div className="pl-1">
                                    <span
                                      title={`Visit BH split across ${vSplit.splits.length} crews (${vSplit.splitMethod}). This crew's share: ${myShare} BH of ${vSplit.totalBH} BH total.`}
                                      className="inline-block text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-300 px-1.5 py-0.5 rounded"
                                    >
                                      Split: {myShare} of {vSplit.totalBH} BH ({vSplit.splitMethod})
                                    </span>
                                  </div>
                                );
                              })()}
                              {/* Single-day completed: minimal one-line confirmation. */}
                              {isJobber && !isIncomplete && !isGhost && !awaitingHourly && !awaitingBhTag && !awaitingReview && !isMultiDay && (Number(job.bh) || 0) > 0 && (
                                <div className="text-xs text-slate-600 pl-1">
                                  <span className="text-emerald-600 font-bold">✓</span> {Number(job.bh)} BH credited
                                </div>
                              )}
                              {isMultiDay && !awaitingHourly && job.jobberTagType !== 'hourly' && job.jobberVisitId && mdJob && !isApproved && !isGhost && !(isIncomplete && (Number(job.bh) || 0) === 0) && (() => {
                                // Status-only block — the manager action lives in the
                                // ⋯ menu ("Mark partial %" / "Adjust partial %"). This
                                // surfaces the current credited state so an in-progress
                                // multi-day visit is legible at a glance without a
                                // forced amber button next to every row.
                                const historyForThis = mdJob.completionHistory.find(
                                  h => h.targetDate === perfDate && h.crewId === cId,
                                );
                                const hasCreditedHistory = !!historyForThis && !awaitingReview;
                                const fullyCredited = hasCreditedHistory && (historyForThis!.percentComplete >= 100);
                                return (
                                <div className="flex items-center gap-2 pl-1 text-[11px]">
                                  {fullyCredited ? (
                                    <span className="text-slate-600">
                                      <span className="text-emerald-600 font-bold">✓</span> {Number(job.bh) || 0} BH credited <span className="text-slate-400">(of {job.totalBH ?? mdJob.totalBH} BH total)</span>
                                    </span>
                                  ) : hasCreditedHistory ? (
                                    <span className="text-slate-500">
                                      Today: {Number(job.bh) || 0} BH (of {job.totalBH ?? mdJob.totalBH} BH total · {historyForThis!.percentComplete}% done)
                                      {isIncomplete && <span className="ml-1 text-amber-600 font-bold">· partial (visit not complete)</span>}
                                    </span>
                                  ) : (
                                    <span className="text-amber-700 font-bold">
                                      {isIncomplete ? 'Visit in progress' : 'Manager review needed'} · total {job.totalBH ?? mdJob.totalBH} BH
                                    </span>
                                  )}
                                </div>
                                );
                              })()}
                              </div>
                            );
                          })}
                          <div className="flex gap-2 mt-2">
                            {/* "+ Route Database" button removed — superseded by Jobber sync. */}
                            <button disabled={isApproved} title={lockTitle} onClick={() => {
                              setDailyLogs(p => { const n = { ...p }; n[cId] = { ...n[cId], jobs: [...n[cId].jobs, { desc: '', bh: '', source: 'manual' }] }; return n; });
                              logPerfActivity({
                                type: 'manual_job_added',
                                ...auditCtx(cId),
                                jobTitle: '(blank)',
                                valueAfter: '',
                                valueLabel: 'BH',
                              });
                            }} className="w-10 flex items-center justify-center text-xs font-bold text-emerald-600 border border-dashed border-emerald-300 rounded p-2 hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed"><Plus className="w-4 h-4" /></button>
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="font-semibold text-gray-700 mb-3 flex justify-between border-b pb-2"><span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-green-600" /> Clocked Hours (AH)</span><span className="text-sm bg-green-50 text-green-800 px-2 py-0.5 rounded font-bold">Total: {sumAH.toFixed(1)} AH</span></h4>
                        <div className="space-y-2">
                          {(() => {
                          // Split the flat employeeAH list into the
                          // SCHEDULED roster (crew.employees minus
                          // removedEmployees) and HELPED-OUT drop-ins.
                          // Drop-in helpers (from the AH Split and
                          // "+ Add Unscheduled Employee" flows) live
                          // in employeeAH but not in crew.employees,
                          // so they sort to the second section and
                          // are excluded from the crew-size bracket.
                          const scheduledSet = new Set(
                            (crewObj?.employees || []).filter(
                              id => !(log.removedEmployees || []).includes(id),
                            ),
                          );
                          const allAhEntries = Object.entries(log.employeeAH);
                          const scheduledEntries = allAhEntries.filter(([id]) => scheduledSet.has(id));
                          const helpedOutEntries = allAhEntries.filter(([id]) => !scheduledSet.has(id));
                          const renderAhRow = ([empId, hrs]: [string, unknown]) => {
                            const hrsIsMissing = hrs === '' || hrs == null || Number.isNaN(Number(hrs));
                            const wasSynced = !!log.lastJobberSyncAt;
                            const empJobberLinked = !!employees.find(e => e.id === empId)?.jobberUserId;
                            const showMissingWarn = hrsIsMissing && wasSynced && empJobberLinked;
                            const hrsNum = Number(hrs);
                            const showLongDayWarn = Number.isFinite(hrsNum) && hrsNum >= 12;
                            const removeOpen = removeWorkerCtx?.cId === cId && removeWorkerCtx?.empId === empId;
                            const canRemove = !isApproved && canDeleteEntry(cId);
                            const canSplit = !isApproved && canDeleteEntry(cId) && hrsNum > 0;
                            return (
                            <div key={empId} className="flex flex-col bg-gray-50 border border-gray-200 rounded p-1.5 pl-3">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-gray-700 truncate mr-2 flex items-center gap-1.5">
                                  {getEmpName(empId)}
                                  {showMissingWarn && (
                                    <span title="No clock-out in Jobber — fix in Jobber and re-sync to enable approval" className="inline-flex">
                                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                    </span>
                                  )}
                                  {showLongDayWarn && (
                                    <span title="Long day — verify before approving. Possible missed clock-out or unrecorded crew switch." className="inline-flex items-center gap-0.5 text-[10px] font-black uppercase tracking-widest bg-amber-100 text-amber-800 border border-amber-300 px-1 py-0.5 rounded">
                                      <AlertTriangle className="w-3 h-3" /> 12h+
                                    </span>
                                  )}
                                </span>
                                <div className="flex items-center gap-2">
                                  {(() => {
                                    const ahKey = `${cId}::emp-${empId}::ah`;
                                    return (
                                  <input
                                    type="number"
                                    step="0.1"
                                    placeholder="Hrs"
                                    value={inputValue(ahKey, hrs as string | number | null)}
                                    disabled={isApproved}
                                    title={lockTitle}
                                    onChange={e => setDraft(ahKey, e.target.value)}
                                    onBlur={() => {
                                      const draftVal = inputDrafts[ahKey];
                                      if (draftVal === undefined) return;
                                      setDailyLogs(p => { const n = { ...p }; n[cId] = { ...n[cId], employeeAH: { ...n[cId].employeeAH, [empId]: draftVal } }; return n; });
                                      clearDraft(ahKey);
                                    }}
                                    className={`w-16 border rounded p-1.5 text-sm text-center bg-white outline-none font-mono font-bold text-green-700 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed ${showMissingWarn || showLongDayWarn ? 'border-amber-300 ring-1 ring-amber-200' : 'border-gray-300'}`}
                                  />
                                    );
                                  })()}
                                  {canSplit && (
                                    <button
                                      type="button"
                                      onClick={() => setSplitCtx({ crewId: cId, empId, workerName: getEmpName(empId) })}
                                      title="Split AH to another crew"
                                      aria-label="Split AH"
                                      className="min-w-[36px] min-h-[36px] md:min-w-[28px] md:min-h-[28px] inline-flex items-center justify-center text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                                    >
                                      <SplitIcon className="w-4 h-4" />
                                    </button>
                                  )}
                                  {canRemove ? (
                                    <button
                                      type="button"
                                      onClick={() => openRemoveWorker(cId, empId)}
                                      title="Remove worker from this entry"
                                      aria-label="Remove worker"
                                      className="text-slate-400 hover:text-rose-500 transition-colors"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  ) : (
                                    <div className="w-4" />
                                  )}
                                </div>
                              </div>
                              {removeOpen && (
                                <div className="mt-2 p-2 rounded border border-rose-200 bg-rose-50/60 space-y-2">
                                  <div className="text-[11px] font-black uppercase tracking-widest text-rose-700">
                                    Remove {getEmpName(empId)} — why?
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {REMOVE_REASONS.map(r => (
                                      <button
                                        key={r}
                                        type="button"
                                        onClick={() => setRemoveWorkerReason(r)}
                                        className={`px-2 py-1 text-[11px] font-bold rounded border ${removeWorkerReason === r ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                                      >
                                        {r}
                                      </button>
                                    ))}
                                  </div>
                                  {removeWorkerReason === 'Other' && (
                                    <input
                                      type="text"
                                      autoFocus
                                      value={removeWorkerOther}
                                      onChange={e => setRemoveWorkerOther(e.target.value)}
                                      placeholder="Reason…"
                                      className="w-full text-xs px-2 py-1 border border-slate-200 rounded outline-none focus:border-rose-300 focus:ring-1 focus:ring-rose-200"
                                    />
                                  )}
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={closeRemoveWorker}
                                      className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 px-2 py-1 rounded"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={confirmRemoveWorker}
                                      disabled={!removeWorkerReason || (removeWorkerReason === 'Other' && !removeWorkerOther.trim())}
                                      className="text-[10px] font-black uppercase tracking-widest bg-rose-600 hover:bg-rose-700 text-white px-3 py-1 rounded shadow disabled:bg-slate-300 disabled:cursor-not-allowed"
                                    >
                                      Confirm Remove
                                    </button>
                                  </div>
                                </div>
                              )}
                              {/* DEDUCTIONS ROW */}
                              <div className="flex items-center justify-end gap-2 mt-1 border-t border-gray-200 pt-1 border-dashed">
                                <span className="text-[10px] uppercase font-bold text-gray-400">Deductions:</span>
                                <div className="flex items-center gap-1">
                                  <span className="text-xs font-bold text-rose-500">-</span>
                                  {(() => {
                                    const dedKey = `${cId}::emp-${empId}::deduction`;
                                    return (
                                  <input
                                    type="number"
                                    step="0.1"
                                    placeholder="0"
                                    disabled={isApproved}
                                    value={inputValue(dedKey, deductHoursRaw(log.deductions?.[empId]))}
                                    onChange={e => setDraft(dedKey, e.target.value)}
                                    onBlur={() => {
                                      const draftVal = inputDrafts[dedKey];
                                      if (draftVal === undefined) return;
                                      setDailyLogs(p => {
                                        const n = { ...p };
                                        const cur = n[cId].deductions?.[empId];
                                        const nextVal = { hours: draftVal, reason: deductReason(cur) };
                                        n[cId] = { ...n[cId], deductions: { ...n[cId].deductions, [empId]: nextVal } };
                                        return n;
                                      });
                                      clearDraft(dedKey);
                                    }}
                                    className="w-12 border border-rose-200 rounded p-1 text-xs text-center bg-rose-50 outline-none text-rose-700 font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={isApproved ? lockTitle : "Subtract hours for breakdowns, meetings, etc."}
                                  />
                                    );
                                  })()}
                                  <input
                                    type="text"
                                    placeholder="Reason (optional)"
                                    disabled={isApproved}
                                    value={deductReason(log.deductions?.[empId])}
                                    onChange={e => setDailyLogs(p => {
                                      const n = { ...p };
                                      const cur = n[cId].deductions?.[empId];
                                      const nextVal = { hours: deductHoursRaw(cur), reason: e.target.value };
                                      n[cId] = { ...n[cId], deductions: { ...n[cId].deductions, [empId]: nextVal } };
                                      return n;
                                    })}
                                    className="w-32 border border-rose-200 rounded p-1 text-xs bg-rose-50 outline-none text-rose-700 font-medium placeholder:text-rose-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={isApproved ? lockTitle : "Why hours were deducted (breakdown, meeting, etc.)"}
                                  />
                                  {(deductHoursRaw(log.deductions?.[empId]) !== '' || deductReason(log.deductions?.[empId])) && (
                                    <button
                                      disabled={isApproved}
                                      onClick={() => {
                                        const prevDeduc = log.deductions?.[empId];
                                        const prevHours = prevDeduc != null ? deductHoursRaw(prevDeduc) : '';
                                        logPerfActivity({
                                          type: 'deduction_removed',
                                          ...auditCtx(cId),
                                          workerId: empId,
                                          workerName: getEmpName(empId),
                                          valueBefore: prevHours,
                                          valueLabel: 'BH',
                                          reasonNote: prevDeduc != null ? deductReason(prevDeduc) : undefined,
                                        });
                                        setDailyLogs(p => {
                                          const n = { ...p };
                                          const newDeduc = { ...n[cId].deductions };
                                          delete newDeduc[empId];
                                          n[cId] = { ...n[cId], deductions: newDeduc };
                                          return n;
                                        });
                                      }}
                                      className="text-rose-300 hover:text-rose-600 p-0.5 disabled:opacity-30 disabled:cursor-not-allowed"
                                      title={isApproved ? lockTitle : "Clear deduction"}
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                            );
                          };
                          const sectionHeader = (
                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 mt-1">
                              Scheduled crew · {allowance.size}-man{allowance.pct ? ` · ${allowance.pct}% allowance` : ''}
                            </div>
                          );
                          return (
                            <>
                              {sectionHeader}
                              {scheduledEntries.length > 0
                                ? scheduledEntries.map(renderAhRow)
                                : <div className="text-[11px] italic text-slate-400 px-1.5 py-2">No scheduled members logged hours yet.</div>}
                              {helpedOutEntries.length > 0 && (
                                <>
                                  <div className="text-[10px] font-black uppercase tracking-widest text-amber-700 mt-3 mb-1">
                                    Helped out · not counted for crew size
                                  </div>
                                  {helpedOutEntries.map(renderAhRow)}
                                </>
                              )}
                            </>
                          );
                          })()}
                          <select disabled={isApproved} title={lockTitle} onChange={e => {
                            const v = e.target.value;
                            if (!v) return;
                            setDailyLogs(p => { const n = { ...p }; n[cId] = { ...n[cId], employeeAH: { ...n[cId].employeeAH, [v]: '' } }; return n; });
                            logPerfActivity({
                              type: 'worker_unscheduled_added',
                              ...auditCtx(cId),
                              workerId: v,
                              workerName: getEmpName(v),
                            });
                            e.target.value = "";
                          }} defaultValue="" className="w-full text-xs font-bold text-green-600 border border-dashed border-green-300 rounded p-2 hover:bg-green-50 outline-none cursor-pointer text-center appearance-none disabled:opacity-40 disabled:cursor-not-allowed">
                            <option value="" disabled>+ Add Unscheduled Employee</option>
                            {employees.filter(e => !log.employeeAH.hasOwnProperty(e.id)).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <button
                onClick={() => setDailyLogs(p => ({ ...p, [`adhoc-${Date.now()}`]: { division: 'Large Projects', crewNumber: 1, jobs: [], employeeAH: {}, deductions: {}, isAdHoc: true } }))}
                className="w-full bg-white border-2 border-dashed border-orange-300 text-orange-700 hover:bg-orange-50 px-4 py-3 rounded-xl font-bold shadow-sm flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> Add Unscheduled Crew
              </button>
            </div>
          )}

          {/* --- SMART ROUTE SELECTION MODAL --- */}
          <RouteSelectionModal
            crewId={routeModalCrewId}
            onClose={() => { setRouteModalCrewId(null); setSelectedRouteIds(new Set()); }}
            routeFilters={routeFilters}
            setRouteFilters={setRouteFilters}
            selectedRouteIds={selectedRouteIds}
            setSelectedRouteIds={setSelectedRouteIds}
            routes={routes}
            getCompletedRouteIdsForWeek={getCompletedRouteIdsForWeek}
            onConfirm={addSelectedRoutes}
          />

          {/* --- MULTI-DAY % REVIEW MODAL --- */}
          {reviewVisitId && reviewCrewId && multiDayJobs[reviewVisitId] && (() => {
            // Look up the row on the current crew/date so we can pass its
            // crew share as the credit basis (vs the visit total). For a
            // single-crew visit, share == visit total — same behavior.
            const rowOnCrew = (dailyLogs[reviewCrewId]?.jobs || [])
              .find(j => j.jobberVisitId === reviewVisitId);
            const splitForVisit = (appData.visitBHSplits || {})[reviewVisitId];
            const shareFromSplit = splitForVisit?.splits.find(s => s.crewId === reviewCrewId)?.bh;
            const creditBasis = shareFromSplit ?? rowOnCrew?.totalBH ?? multiDayJobs[reviewVisitId].totalBH;
            return (
              <CompletionReviewModal
                isOpen={true}
                onClose={closeReview}
                job={multiDayJobs[reviewVisitId]}
                currentDate={perfDate}
                currentCrewId={reviewCrewId}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
                currentUserRole={currentUserRole}
                appData={appData}
                dailyLogs={dailyLogs}
                syncToCloud={syncToCloud}
                canOverride={canOverrideJobType}
                showToastMsg={showToastMsg}
                creditBasisBH={creditBasis}
              />
            );
          })()}

          {/* --- AH SPLIT MODAL --- */}
          {splitCtx && (
            <AHSplitModal
              isOpen={true}
              onClose={() => setSplitCtx(null)}
              date={perfDate}
              sourceCrewId={splitCtx.crewId}
              empId={splitCtx.empId}
              workerName={splitCtx.workerName}
              appData={appData}
              dailyLogs={dailyLogs}
              setDailyLogs={setDailyLogs}
              showToastMsg={showToastMsg}
              currentUserName={currentUserName}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
            />
          )}

          {/* --- SPLIT BH (multi-crew visit) MODAL --- */}
          {splitBHCtx && (
            <SplitBHModal
              isOpen={true}
              onClose={() => setSplitBHCtx(null)}
              visitId={splitBHCtx.visitId}
              visitTitle={splitBHCtx.visitTitle}
              visitTotalBH={splitBHCtx.visitTotalBH}
              date={perfDate}
              appData={appData}
              dailyLogs={dailyLogs}
              setDailyLogs={setDailyLogs}
              syncToCloud={syncToCloud}
              showToastMsg={showToastMsg}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              currentUserRole={currentUserRole}
            />
          )}

          {/* --- CARRY-FORWARD MODAL --- */}
          {carryForwardModalOpen && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center md:p-4">
              <div className="bg-white md:rounded-xl shadow-2xl w-full md:max-w-2xl h-full md:h-auto md:max-h-[90vh] overflow-hidden flex flex-col">
                <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Carry-Forward</div>
                    <h2 className="text-lg font-bold text-slate-800">Multi-day jobs in progress</h2>
                    <div className="text-xs text-slate-500 mt-0.5">Continue work on today's crew or skip for today.</div>
                  </div>
                  <button onClick={() => setCarryForwardModalOpen(false)} className="text-slate-400 hover:text-slate-700 p-1.5 rounded" aria-label="Close">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                  {pendingCarryForward.length === 0 ? (
                    <div className="text-center text-slate-400 italic py-6">No pending carry-forwards.</div>
                  ) : pendingCarryForward.map(c => {
                    // Visit-keyed: a recurring job may have multiple visits
                    // in flight, each with its own row in this list.
                    const choice = carryForwardChoices[c.jobberVisitId] || '';
                    const crewOptions = Object.entries(dailyLogs).map(([cid, log]) => ({
                      id: cid,
                      label: `${log.division} #${log.crewNumber}`,
                      approved: log.approvalStatus === 'approved',
                    }));
                    return (
                      <div key={c.jobberVisitId} className="border border-slate-200 rounded-lg p-3 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-sm text-slate-800 truncate">{c.jobTitle}</div>
                            <div className="text-xs text-slate-500 mt-0.5">
                              Prior {c.priorCumulativePct}% credited on {c.priorDate} ·{' '}
                              <span className="font-mono font-bold text-emerald-700">{c.remainingBH} BH</span>{' '}
                              remaining (of {c.totalBH} BH total)
                            </div>
                          </div>
                        </div>
                        {crewOptions.length === 0 ? (
                          <div className="text-xs text-amber-700 italic">No crews scheduled today — add a crew first.</div>
                        ) : (
                          <div className="flex flex-col md:flex-row md:items-center gap-2 md:flex-wrap">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Continue on:</label>
                            <select
                              value={choice}
                              onChange={e => setCarryForwardChoices(prev => ({ ...prev, [c.jobberVisitId]: e.target.value }))}
                              className="w-full md:w-auto min-h-[44px] border border-slate-300 rounded-lg p-2 text-sm font-bold"
                            >
                              <option value="">Pick a crew…</option>
                              {crewOptions.map(o => (
                                <option key={o.id} value={o.id} disabled={o.approved}>
                                  {o.label}{o.approved ? ' (approved)' : ''}
                                </option>
                              ))}
                            </select>
                            <div className="flex items-center gap-2 md:ml-auto">
                              <button
                                type="button"
                                onClick={() => handleCarryForwardSkip(c.jobberVisitId)}
                                className="min-h-[44px] text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 hover:bg-slate-100 px-3 py-2 rounded-lg"
                                title="Dismiss for this session — will reappear on refresh"
                              >
                                Skip
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCarryForwardDelete(c.jobberVisitId, c.jobTitle)}
                                className="min-h-[44px] text-[11px] font-black uppercase tracking-widest text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 px-3 py-2 rounded-lg"
                                title="Permanently stop carry-forward tracking. Prior BH stays intact."
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                disabled={!choice}
                                onClick={() => handleCarryForwardContinue(c, choice)}
                                className="min-h-[44px] text-[11px] font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg shadow disabled:bg-slate-300 disabled:cursor-not-allowed flex-1"
                              >
                                Continue
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
                  <button onClick={() => setCarryForwardModalOpen(false)} className="min-h-[44px] w-full md:w-auto px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg">
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="max-w-6xl mx-auto w-full space-y-6 pb-20">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-wrap gap-4 items-center">
            <span className="font-bold text-gray-700"><Filter className="w-4 h-4 inline mr-2" /> Time Range:</span>
            <input type="date" value={reportStartDate} onChange={e => setReportStartDate(e.target.value)} className="border border-gray-300 rounded p-1.5 text-sm" />
            <span className="text-gray-400">to</span>
            <input type="date" value={reportEndDate} onChange={e => setReportEndDate(e.target.value)} className="border border-gray-300 rounded p-1.5 text-sm" />

            <div className="flex gap-2 ml-auto">
              <button onClick={() => { const today = formatTodayInToronto(); setReportStartDate(today); setReportEndDate(today); }} className="text-xs font-bold bg-gray-100 px-3 py-1.5 rounded hover:bg-gray-200">Today</button>
              <button onClick={() => { setReportStartDate(formatDate(startOfWeek)); setReportEndDate(formatDate(addDays(startOfWeek, 6))); }} className="text-xs font-bold bg-gray-100 px-3 py-1.5 rounded hover:bg-gray-200">This Week</button>
              <button onClick={() => { const today = formatTodayInToronto(); const [yy, mm] = today.split('-'); const firstOfMonth = `${yy}-${mm}-01`; const lastDay = new Date(Number(yy), Number(mm), 0).getDate(); const lastOfMonth = `${yy}-${mm}-${String(lastDay).padStart(2, '0')}`; setReportStartDate(firstOfMonth); setReportEndDate(lastOfMonth); }} className="text-xs font-bold bg-gray-100 px-3 py-1.5 rounded hover:bg-gray-200">This Month</button>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col items-center"><div className="text-gray-500 font-bold uppercase tracking-wider text-[10px] mb-1">Total Budgeted Hrs</div><div className="text-3xl font-black text-emerald-600">{r.totals.bh.toFixed(1)}</div></div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col items-center"><div className="text-gray-500 font-bold uppercase tracking-wider text-[10px] mb-1">Total Actual Hrs</div><div className="text-3xl font-black text-green-600">{r.totals.ah.toFixed(1)}</div></div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col items-center"><div className="text-gray-500 font-bold uppercase tracking-wider text-[10px] mb-1">Total Jobs Done</div><div className="text-3xl font-black text-teal-600">{r.totals.jobs}</div></div>
            <div className="bg-gray-800 rounded-xl shadow-sm p-4 flex flex-col items-center relative overflow-hidden">
              <Target className="absolute -right-4 -bottom-4 w-20 h-20 text-gray-700 opacity-50" /><div className="text-gray-300 font-bold uppercase text-[10px] mb-1 z-10">Overall Efficiency</div>
              <div className={`text-4xl font-black z-10 ${overallEff >= 90 ? 'text-purple-400' : (overallEff >= 80 ? 'text-emerald-400' : (overallEff >= 70 ? 'text-yellow-400' : 'text-red-400'))}`}>{overallEff}%</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* DIVISION TABLE */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-gray-50 border-b border-gray-200 p-3"><h3 className="font-bold text-gray-800 flex items-center gap-2"><Award className="w-4 h-4 text-gray-500" /> Divisions</h3></div>
              <table className="w-full text-left">
                <thead><tr className="border-b border-gray-200 text-[10px] text-gray-500 uppercase"><th className="p-3">Name</th><th className="p-3 text-center">Jobs</th><th className="p-3 text-right">BH</th><th className="p-3 text-right">AH</th><th className="p-3 text-right">Eff %</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {DIVISIONS.map(d => {
                    const s = r.divStats[d]; const score = s.ah > 0 ? Number(((s.bh / s.ah) * 100).toFixed(1)) : 0;
                    return <tr key={d}><td className="p-3 font-bold text-gray-800 text-sm">{d}</td><td className="p-3 text-center font-bold text-teal-600 text-sm">{s.jobs}</td><td className="p-3 text-right text-emerald-600 font-medium text-sm">{s.bh.toFixed(1)}</td><td className="p-3 text-right text-green-600 font-medium text-sm">{s.ah.toFixed(1)}</td><td className="p-3 text-right font-bold text-sm">{s.ah > 0 ? `${score}%` : '--'}</td></tr>
                  })}
                </tbody>
              </table>
            </div>

            {/* CREWS TABLE */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-gray-50 border-b border-gray-200 p-3"><h3 className="font-bold text-gray-800 flex items-center gap-2"><Truck className="w-4 h-4 text-gray-500" /> Crews</h3></div>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-white"><tr className="border-b border-gray-200 text-[10px] text-gray-500 uppercase"><th className="p-3">Crew</th><th className="p-3 text-center">Jobs</th><th className="p-3 text-right">BH</th><th className="p-3 text-right">AH</th><th className="p-3 text-right">Eff %</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {Object.entries(r.crewStats).sort((a, b) => (b[1] as any).bh - (a[1] as any).bh).map(([name, s]) => {
                      const score = s.ah > 0 ? Number(((s.bh / s.ah) * 100).toFixed(1)) : 0;
                      return <tr key={name}><td className="p-3 font-bold text-gray-800 text-sm">{name} <div className="text-[10px] text-gray-400 font-normal">{s.div}</div></td><td className="p-3 text-center font-bold text-teal-600 text-sm">{s.jobs}</td><td className="p-3 text-right text-emerald-600 font-medium text-sm">{s.bh.toFixed(1)}</td><td className="p-3 text-right text-green-600 font-medium text-sm">{s.ah.toFixed(1)}</td><td className="p-3 text-right font-bold text-sm">{s.ah > 0 ? `${score}%` : '--'}</td></tr>
                    })}
                    {Object.keys(r.crewStats).length === 0 ? <tr><td colSpan={5} className="p-4 text-center text-gray-400 text-sm">No crew data in this range.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>

            {/* EMPLOYEE TABLE */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden lg:col-span-2">
              <div className="bg-gray-50 border-b border-gray-200 p-3"><h3 className="font-bold text-gray-800 flex items-center gap-2"><Users className="w-4 h-4 text-gray-500" /> Employee Breakdown (Proportional Split)</h3></div>
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-white"><tr className="border-b border-gray-200 text-xs text-gray-500 uppercase"><th className="p-3">Employee</th><th className="p-3 text-right">Earned BH</th><th className="p-3 text-right">Net Clocked AH</th><th className="p-3 text-right">Indiv Eff %</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {Object.entries(r.empStats).sort((a, b) => (b[1] as any).bh - (a[1] as any).bh).map(([eId, s]) => {
                      const score = s.ah > 0 ? Number(((s.bh / s.ah) * 100).toFixed(1)) : 0;
                      let color = 'text-gray-500';
                      if (s.ah > 0) { if (score >= 90) color = 'text-purple-600'; else if (score >= 80) color = 'text-emerald-600'; else if (score >= 70) color = 'text-yellow-600'; else color = 'text-red-600'; }
                      return <tr key={eId} className="hover:bg-gray-50"><td className="p-3 font-bold text-gray-800 text-sm">{s.name}</td><td className="p-3 text-right text-emerald-600 font-medium text-sm">{s.bh.toFixed(1)}</td><td className="p-3 text-right text-green-600 font-medium text-sm">{s.ah.toFixed(1)}</td><td className={`p-3 text-right font-black text-sm ${color}`}>{s.ah > 0 ? `${score}%` : '--'}</td></tr>
                    })}
                    {Object.keys(r.empStats).length === 0 ? <tr><td colSpan={4} className="p-4 text-center text-gray-400 text-sm">No employee data in this range.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </div>
      )}

      {shiftPickerCtx && (
        <div className="fixed inset-0 bg-black/60 z-50 flex md:items-center md:justify-center md:p-4">
          <div className="bg-white md:rounded-xl shadow-2xl w-full md:max-w-md h-full md:h-auto md:max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Shift Day</div>
                <h2 className="text-lg font-bold text-slate-800">Move to {shiftPickerCtx.destDate}</h2>
                <div className="text-xs text-slate-500 mt-0.5">Pick a destination crew. From {shiftPickerCtx.sourceDate}.</div>
              </div>
              <button onClick={() => setShiftPickerCtx(null)} aria-label="Close" className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100">
                <XIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {shiftPickerCtx.candidates.length === 0 ? (
                <div className="text-center text-slate-400 italic py-6">No crews scheduled on {shiftPickerCtx.destDate}.</div>
              ) : (
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {shiftPickerCtx.candidates.map(c => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => executeShift(
                          shiftPickerCtx.sourceCrewId,
                          shiftPickerCtx.sourceJobIdx,
                          shiftPickerCtx.sourceDate,
                          shiftPickerCtx.destDate,
                          c.id,
                        )}
                        className="w-full min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                      >
                        <span className="text-sm font-bold text-slate-800">{c.division} #{c.crewNumber}</span>
                        <ChevronRight className="w-4 h-4 text-slate-300" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
              <button onClick={() => setShiftPickerCtx(null)} className="min-h-[44px] px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

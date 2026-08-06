import { useMemo, useState } from 'react';
import { X, AlertTriangle, Plus, Clock, CheckCircle, Settings, Calendar as CalendarIcon } from 'lucide-react';
import { AppData, MultiDayJob, CompletionEntry, PerformanceJobRow, Crew, UserRole, PerformanceLog } from '../types';
import { logPerfActivity } from '../lib/perfAudit';
import { stableCrewKey } from '../lib/crewUtils';

interface CompletionReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: MultiDayJob;
  currentDate: string;
  currentCrewId: string;
  currentUserId: string;
  currentUserName: string;
  currentUserRole: UserRole;
  appData: AppData;
  // Live in-editor state for currentDate's crews. Manual AH / Split AH /
  // deductions edits live here until "Save All Changes" promotes them
  // into appData.performance. Without this, the modal's save would
  // overwrite the perfDate slot using the (stale) appData.performance
  // snapshot, dropping the manager's unsaved edits on next render.
  dailyLogs: Record<string, PerformanceLog>;
  syncToCloud: (data: AppData) => Promise<boolean | undefined>;
  canOverride: boolean;
  showToastMsg: (msg: string) => void;
  // Optional override for the BH basis used in the partial credit math.
  // For multi-crew visits, this should be THIS crew's share (row.totalBH),
  // not the visit total. If omitted, falls back to job.totalBH.
  creditBasisBH?: number;
}

interface SplitDraft {
  id: string;
  date: string;
  pct: string;
  crewId: string;
  reason: string;
}

const formatDateLabel = (d: string): string => {
  try {
    return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return d; }
};

const formatTime = (ms: number): string => {
  try { return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return ''; }
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

export default function CompletionReviewModal({
  isOpen, onClose, job, currentDate, currentCrewId,
  currentUserId, currentUserName, currentUserRole, appData, dailyLogs, syncToCloud,
  canOverride, showToastMsg, creditBasisBH,
}: CompletionReviewModalProps) {
  // Whether this visit has explicit per-crew BH allocations. With
  // splits, each crew's % timeline is independent (current behavior).
  // Without splits, multi-crew visits chip at a single shared BH pool
  // and the modal switches to a visit-wide cumulative interpretation
  // of % — see the no-split branches below.
  const hasSplits = !!appData.visitBHSplits?.[job.jobberVisitId];

  // Credit basis. With splits: caller-passed per-crew share (or job
  // total fallback). Without splits: always the whole job — the
  // cumulative model only makes sense against the full pool.
  const basisBH = hasSplits
    ? ((typeof creditBasisBH === 'number' && creditBasisBH > 0) ? creditBasisBH : job.totalBH)
    : job.totalBH;
  const sortedHistory = useMemo(
    () => [...job.completionHistory].sort((a, b) => a.targetDate.localeCompare(b.targetDate)),
    [job.completionHistory],
  );
  // Stable cross-day crew identity for the CURRENT crew (the row the user
  // tapped). All matching predicates below compare against this instead of
  // currentCrewId directly, so a Day 1 partial credit + Day 2 entry for
  // the same logical crew are recognized as the same crew even though
  // their per-day `crew.id`s differ.
  const currentCrewKey = useMemo(() => {
    const c = appData.schedules[currentDate]?.find(cr => cr.id === currentCrewId);
    return c ? stableCrewKey(c) : `crewid:${currentCrewId}`;
  }, [appData.schedules, currentDate, currentCrewId]);
  // Resolves a CompletionEntry to its stable crewKey, with fall-backs:
  //   1) entry already has crewKey (new entries written after this deploy)
  //   2) look up the crew row on entry.targetDate by entry.crewId and
  //      derive the crewKey from its division+crewNumber (legacy entries)
  //   3) synthetic key based on raw crewId — guarantees the match is never
  //      a false positive against another crew, even if we can't resolve
  const entryCrewKey = (e: CompletionEntry): string => {
    if (e.crewKey) return e.crewKey;
    const c = appData.schedules[e.targetDate]?.find(cr => cr.id === e.crewId);
    if (c) return stableCrewKey(c);
    return `crewid:${e.crewId}`;
  };
  // Human label "Division #N" for a (date, crewId) — resolves from the day's
  // schedule, then the performance log, then falls back to the raw id.
  const crewLabelFor = (date: string, crewId: string): string => {
    const c = appData.schedules[date]?.find(cr => cr.id === crewId);
    if (c) return `${c.division} #${c.crewNumber}`;
    const log = appData.performance?.[date]?.[crewId];
    if (log) return `${log.division} #${log.crewNumber}`;
    return crewId;
  };
  // Label for the crew the user tapped — used in the consequence line so a
  // percentage reads as the crediting action it is.
  const currentCrewLabel = useMemo(
    () => crewLabelFor(currentDate, currentCrewId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appData.schedules, appData.performance, currentDate, currentCrewId],
  );
  // ORPHAN REPORT (read-only): existing completionHistory entries that credit
  // BH but have NO crew-day row carrying this visit on their date — i.e.
  // ledger credit no crew-day reflects. Reported, never auto-fixed. (A row on
  // ANY crew that day counts as attached, matching "does a row for this visit
  // exist on that date at all?")
  const orphanedEntries = useMemo(() => {
    const out: { date: string; crew: string; bh: number }[] = [];
    for (const h of job.completionHistory || []) {
      const bh = Number(h.creditedBH) || 0;
      if (bh <= 0) continue;
      const dayMap = appData.performance?.[h.targetDate] || {};
      const hasRow = Object.values(dayMap).some(log =>
        (log.jobs || []).some(r => r.jobberVisitId === job.jobberVisitId));
      if (!hasRow) out.push({ date: h.targetDate, crew: crewLabelFor(h.targetDate, h.crewId), bh });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.completionHistory, job.jobberVisitId, appData.performance, appData.schedules]);
  const existingForToday = useMemo(
    () => sortedHistory.find(h => h.targetDate === currentDate && entryCrewKey(h) === currentCrewKey),
    // entryCrewKey closes over appData.schedules which is reflected via currentCrewKey's deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortedHistory, currentDate, currentCrewKey],
  );
  // Per-crew priorPct — used in the WITH-SPLITS branch. Each crew's %
  // timeline is independent; last entry on this crew before today.
  const perCrewPriorPct = useMemo(() => {
    const myPrior = sortedHistory.filter(h => entryCrewKey(h) === currentCrewKey && h.targetDate < currentDate);
    return myPrior.length === 0 ? 0 : myPrior[myPrior.length - 1].percentComplete;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedHistory, currentDate, currentCrewKey]);
  // Cumulative priorPct — used in the NO-SPLITS branch. Derived from
  // stored creditedBH (not percentComplete) so legacy entries written
  // under per-crew interpretation still contribute their real credit
  // to the cumulative tally regardless of how their % was meant.
  const cumulativePriorBH = useMemo(() => {
    return sortedHistory
      .filter(h => h.targetDate < currentDate)
      .reduce((sum, h) => sum + (Number(h.creditedBH) || 0), 0);
  }, [sortedHistory, currentDate]);
  const cumulativePriorPct = useMemo(() => {
    if (job.totalBH <= 0) return 0;
    return Math.min(100, round2((cumulativePriorBH / job.totalBH) * 100));
  }, [cumulativePriorBH, job.totalBH]);
  const priorPct = hasSplits ? perCrewPriorPct : cumulativePriorPct;

  const [newPct, setNewPct] = useState<string>(existingForToday ? String(existingForToday.percentComplete) : '');
  const [splits, setSplits] = useState<SplitDraft[]>([]);
  const [splitFormOpen, setSplitFormOpen] = useState(false);
  const [splitDate, setSplitDate] = useState('');
  const [splitPct, setSplitPct] = useState('');
  const [splitCrew, setSplitCrew] = useState('');
  const [splitReason, setSplitReason] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const nextPctNumber = Number(newPct);
  const nextPctValid = newPct !== '' && Number.isFinite(nextPctNumber) && nextPctNumber >= priorPct && nextPctNumber <= 100;
  const delta = nextPctValid ? Math.max(0, nextPctNumber - priorPct) : 0;
  // Credit math uses this crew's share (basisBH), not the visit total.
  const previewBH = round2((delta / 100) * basisBH);

  // Crews available on the split date (for the picker default).
  const crewsForSplitDate: Crew[] = splitDate ? (appData.schedules[splitDate] || []) : [];

  const isDateApproved = (date: string, crewId: string): boolean => {
    return appData.performance?.[date]?.[crewId]?.approvalStatus === 'approved';
  };

  const addSplit = () => {
    const pctNum = Number(splitPct);
    if (!splitDate) { showToastMsg('Pick a date for the split.'); return; }
    if (splits.some(s => s.date === splitDate)) { showToastMsg('Already have a split for that date.'); return; }
    if (sortedHistory.some(h => h.targetDate === splitDate)) { showToastMsg('That date already has a completion entry.'); return; }
    if (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100) { showToastMsg('% must be 0–100.'); return; }
    const effectiveCrew = splitCrew || crewsForSplitDate[0]?.id || currentCrewId;
    if (isDateApproved(splitDate, effectiveCrew)) {
      showToastMsg(`Cannot split to ${splitDate} — entry is approved. Unapprove first.`);
      return;
    }
    // Validation. Two paths must agree with the credit math used by
    // submit() — one per branch:
    //   - WITH splits: each crew's % timeline is independent. Validate
    //     per-crew monotonicity only.
    //   - WITHOUT splits: visit-wide cumulative-by-creditedBH timeline.
    //     New entries must yield % ≥ running cumulative %. Legacy
    //     entries' creditedBH counts toward the tally as-is, sidestepping
    //     the legacy %-interpretation mismatch.
    if (hasSplits) {
      const splitCrewObj = appData.schedules[splitDate]?.find(c => c.id === effectiveCrew);
      const newSplitKey = splitCrewObj ? stableCrewKey(splitCrewObj) : `crewid:${effectiveCrew}`;
      const all = [
        ...sortedHistory.map(h => ({ targetDate: h.targetDate, percentComplete: h.percentComplete, crewKey: entryCrewKey(h) })),
        ...splits.map(s => {
          const cObj = appData.schedules[s.date]?.find(c => c.id === s.crewId);
          const cKey = cObj ? stableCrewKey(cObj) : `crewid:${s.crewId}`;
          return { targetDate: s.date, percentComplete: Number(s.pct), crewKey: cKey };
        }),
        { targetDate: splitDate, percentComplete: pctNum, crewKey: newSplitKey },
      ];
      const byCrew = new Map<string, typeof all>();
      for (const m of all) {
        const arr = byCrew.get(m.crewKey) || [];
        arr.push(m);
        byCrew.set(m.crewKey, arr);
      }
      for (const [, list] of byCrew) {
        list.sort((a, b) => a.targetDate.localeCompare(b.targetDate));
        let prev = 0;
        for (const m of list) {
          if (m.percentComplete < prev) {
            showToastMsg(`${m.targetDate}'s % (${m.percentComplete}) must be ≥ prior entry's % on this crew (${prev}).`);
            return;
          }
          prev = m.percentComplete;
        }
      }
    } else {
      type WalkEntry = { targetDate: string; percentComplete: number; creditedBH: number; markedAt: number; isNew: boolean };
      const all: WalkEntry[] = [
        ...sortedHistory.map(h => ({ targetDate: h.targetDate, percentComplete: h.percentComplete, creditedBH: Number(h.creditedBH) || 0, markedAt: h.markedAt || 0, isNew: false })),
        ...splits.map(s => ({ targetDate: s.date, percentComplete: Number(s.pct), creditedBH: 0, markedAt: 0, isNew: true })),
        { targetDate: splitDate, percentComplete: pctNum, creditedBH: 0, markedAt: 0, isNew: true },
      ].sort((a, b) => {
        const dc = a.targetDate.localeCompare(b.targetDate);
        if (dc !== 0) return dc;
        return (a.markedAt || 0) - (b.markedAt || 0);
      });
      let cumBH = 0;
      for (const m of all) {
        if (m.isNew) {
          const cumPct = job.totalBH > 0 ? (cumBH / job.totalBH) * 100 : 0;
          if (m.percentComplete + 0.05 < cumPct) {
            showToastMsg(`${m.targetDate}'s % (${m.percentComplete}) must be ≥ cumulative prior (${round2(cumPct)}%).`);
            return;
          }
          const delta = Math.max(0, m.percentComplete - cumPct);
          cumBH = round2(cumBH + (delta / 100) * job.totalBH);
        } else {
          cumBH = round2(cumBH + m.creditedBH);
        }
      }
    }
    setSplits(prev => [...prev, {
      id: `split-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      date: splitDate, pct: splitPct, crewId: effectiveCrew, reason: splitReason.trim(),
    }]);
    setSplitDate(''); setSplitPct(''); setSplitCrew(''); setSplitReason('');
    setSplitFormOpen(false);
  };

  const removeSplit = (id: string) => setSplits(prev => prev.filter(s => s.id !== id));

  const submit = async (mode: 'confirm' | 'force-100') => {
    setBusy(true);
    try {
      // Build the new entries from the user's inputs.
      const now = Date.now();
      const newEntries: CompletionEntry[] = [];
      for (const s of splits) {
        const effCrew = s.crewId || currentCrewId;
        if (isDateApproved(s.date, effCrew)) {
          showToastMsg(`Cannot split to ${s.date} — entry is approved. Unapprove first.`);
          setBusy(false);
          return;
        }
        // Resolve the split's stable crew identity. For most splits the
        // target date already has a crew row in the schedule; we derive
        // the key from there. If the crew isn't found (rare race), fall
        // back to a synthetic key so this entry can't collide with a
        // different crew's entries later.
        const splitCrewObj = appData.schedules[s.date]?.find(c => c.id === effCrew);
        const splitCrewKey = splitCrewObj ? stableCrewKey(splitCrewObj) : `crewid:${effCrew}`;
        const entry: CompletionEntry = {
          targetDate: s.date,
          percentComplete: Number(s.pct),
          creditedBH: 0, // recomputed below
          crewId: effCrew,
          crewKey: splitCrewKey,
          markedAt: now,
          markedBy: currentUserId,
          markedByName: currentUserName,
          isRetroactive: true,
        };
        if (s.reason) entry.reasonNote = s.reason;
        newEntries.push(entry);
      }
      const pctForToday = mode === 'force-100' ? 100 : nextPctNumber;
      if (mode === 'confirm' && !nextPctValid) {
        showToastMsg(`% must be between ${priorPct} and 100.`);
        setBusy(false);
        return;
      }
      // Today's entry — replace existing or insert new.
      if (existingForToday) {
        // Update in place by replacing during merge.
      }
      if (mode === 'force-100' || nextPctValid) {
        const todayEntry: CompletionEntry = {
          targetDate: currentDate,
          percentComplete: pctForToday,
          creditedBH: 0,
          crewId: currentCrewId,
          crewKey: currentCrewKey,
          markedAt: now,
          markedBy: currentUserId,
          markedByName: currentUserName,
          isRetroactive: false,
        };
        if (mode === 'force-100') todayEntry.reasonNote = 'Override: marked fully complete';
        newEntries.push(todayEntry);
      }

      // GUARD — a completion must attach to a real crew-day. Refuse to write
      // any NEW entry whose (date, crew) has no PerformanceLog: otherwise the
      // ledger would carry credit that no crew-day reflects (the orphaned-
      // credit bug). This mirrors the row-write loop's overlay exactly (base
      // performance + dailyLogs for the current editor day), so the check
      // matches precisely what that loop would — and previously silently
      // skipped. Credited BH / the sync paths are untouched; we just fail
      // loudly here instead of writing an unattached entry.
      const perfForCheck: Record<string, Record<string, PerformanceLog>> = { ...(appData.performance || {}) };
      if (dailyLogs && Object.keys(dailyLogs).length > 0) perfForCheck[currentDate] = { ...dailyLogs };
      for (const e of newEntries) {
        const crewLog = perfForCheck[e.targetDate]?.[e.crewId];
        const label = crewLabelFor(e.targetDate, e.crewId);
        if (!crewLog) {
          showToastMsg(`No crew-day exists for ${label} on ${formatDateLabel(e.targetDate)} — add that crew to the day (record its BH/AH) before crediting completion.`);
          setBusy(false);
          return;
        }
        if (crewLog.approvalStatus === 'approved') {
          showToastMsg(`${label} on ${formatDateLabel(e.targetDate)} is approved — unapprove it first.`);
          setBusy(false);
          return;
        }
      }

      // Merge: drop any existing entry on (date + stable crew identity)
      // that we're replacing. Stable identity matches across days, so a
      // re-save with the same crewKey on the same date supersedes the
      // prior entry even if the per-day crewId differs.
      const merged: CompletionEntry[] = [];
      const replacedKeys = new Set(newEntries.map(e => `${e.targetDate}|${entryCrewKey(e)}`));
      for (const e of sortedHistory) {
        if (replacedKeys.has(`${e.targetDate}|${entryCrewKey(e)}`)) continue;
        merged.push(e);
      }
      merged.push(...newEntries);
      // Stable cross-crew ordering on the same date — needed for the
      // no-split cumulative walk and harmless to the per-crew bucketing.
      merged.sort((a, b) => {
        const dc = a.targetDate.localeCompare(b.targetDate);
        if (dc !== 0) return dc;
        return (a.markedAt || 0) - (b.markedAt || 0);
      });

      // Per-crew bucketing — used directly by the with-splits credit
      // math and indirectly by both branches' completion checks +
      // current-crew "final %" lookup for the toast.
      const visitSplit = appData.visitBHSplits?.[job.jobberVisitId];
      const perCrew = new Map<string, CompletionEntry[]>();
      for (const e of merged) {
        const key = entryCrewKey(e);
        const arr = perCrew.get(key) || [];
        arr.push(e);
        perCrew.set(key, arr);
      }

      // Total credited BH across all crews after this save. The
      // no-split branch populates it from a cumulative walk; the
      // with-splits branch sums per-crew shares after recomputation.
      let cumBHTotal = 0;

      if (hasSplits) {
        // WITH SPLITS — per-crew bucketed credit math (unchanged).
        // Each crew's % timeline is independent, against its share.
        const shareFor = (key: string): number => {
          if (key === currentCrewKey) return basisBH;
          if (visitSplit) {
            for (const slot of visitSplit.splits) {
              const slotCrew = appData.schedules[currentDate]?.find(c => c.id === slot.crewId);
              const slotKey = slotCrew ? stableCrewKey(slotCrew) : `crewid:${slot.crewId}`;
              if (slotKey === key) return slot.bh;
            }
          }
          return job.totalBH;
        };
        for (const [key, list] of perCrew) {
          const share = shareFor(key);
          let prevPct = 0;
          for (const entry of list) {
            if (entry.percentComplete < prevPct) {
              showToastMsg(`Validation failed: crew ${key} on ${entry.targetDate} drops below prior day's %.`);
              setBusy(false);
              return;
            }
            const d = Math.max(0, entry.percentComplete - prevPct);
            entry.creditedBH = round2((d / 100) * share);
            prevPct = entry.percentComplete;
          }
        }
        for (const list of perCrew.values()) {
          for (const e of list) cumBHTotal = round2(cumBHTotal + (Number(e.creditedBH) || 0));
        }
      } else {
        // NO SPLITS — visit-wide cumulative timeline. Legacy entries
        // keep their stored creditedBH (their % field is untrustworthy
        // under the new model). New entries get fresh credit = delta
        // from the running cumulative % against the FULL job.totalBH.
        // Clamp so the total never exceeds job.totalBH — prevents the
        // 125%-overcredit failure mode from the reported bug.
        const newEntrySet = new Set<CompletionEntry>(newEntries);
        let cumBH = 0;
        for (const entry of merged) {
          if (newEntrySet.has(entry)) {
            const cumPct = job.totalBH > 0 ? (cumBH / job.totalBH) * 100 : 0;
            if (entry.percentComplete + 0.05 < cumPct) {
              showToastMsg(`Validation failed: ${entry.targetDate}'s % (${entry.percentComplete}) is below cumulative prior (${round2(cumPct)}%).`);
              setBusy(false);
              return;
            }
            const delta = Math.max(0, entry.percentComplete - cumPct);
            let bh = round2((delta / 100) * job.totalBH);
            const remaining = round2(job.totalBH - cumBH);
            if (bh > remaining) bh = remaining;
            entry.creditedBH = bh;
            cumBH = round2(cumBH + bh);
          } else {
            cumBH = round2(cumBH + (Number(entry.creditedBH) || 0));
          }
        }
        cumBHTotal = cumBH;
      }
      // For the "complete" status decision, use THIS crew's latest % —
      // looked up by stable identity so a partial from a prior day rolls
      // forward correctly.
      const myList = perCrew.get(currentCrewKey) || [];
      const myFinalPct = myList.length > 0 ? myList[myList.length - 1].percentComplete : 0;

      // Walk merged entries and apply credits to the matching PerformanceLog
      // rows. Skip approved entries — we shouldn't have tried to write them
      // (split blocked above) but guard defensively.
      //
      // Base is appData.performance, overlaid with dailyLogs[currentDate]
      // for the perfDate slot. Without that overlay, unsaved manual AH /
      // Split AH / deductions edits living in dailyLogs (but not yet
      // promoted to appData.performance via the "Save All Changes" button)
      // would be silently overwritten by this writeback. Other dates
      // (retroactive splits) read from appData.performance unchanged —
      // dailyLogs only ever holds the currently-open editor day.
      const nextPerformance: Record<string, Record<string, PerformanceLog>> = { ...(appData.performance || {}) };
      // The dailyLogs map is keyed by crewId for the current day. Treat it
      // as the authoritative view for currentDate so the modal preserves
      // every unsaved manual edit on that day.
      if (dailyLogs && Object.keys(dailyLogs).length > 0) {
        nextPerformance[currentDate] = { ...dailyLogs };
      }
      for (const entry of merged) {
        const day = { ...(nextPerformance[entry.targetDate] || {}) };
        const crewLog = day[entry.crewId];
        if (!crewLog) {
          // No PerformanceLog for this crew/date. NEW entries can't reach here
          // — the guard above rejects the save before we get this far. So this
          // only skips a pre-existing (legacy) orphaned entry being carried
          // through the merge unchanged; it's surfaced by the orphan report,
          // never auto-fixed.
          continue;
        }
        if (crewLog.approvalStatus === 'approved') continue;
        // Row's totalBH = crew's share (not visit total). For single-crew,
        // shareFor falls through to job.totalBH.
        const rowTotalBH = (() => {
          if (entry.crewId === currentCrewId) return basisBH;
          if (visitSplit) {
            const slot = visitSplit.splits.find(s => s.crewId === entry.crewId);
            if (slot) return slot.bh;
          }
          return job.totalBH;
        })();
        let updatedRow = false;
        const newJobs: PerformanceJobRow[] = crewLog.jobs.map(r => {
          // Match by visit, not by parent job. This is the structural fix:
          // two visits of the same Jobber job share jobberJobId but have
          // distinct jobberVisitIds, so Visit 2's credit can never overwrite
          // Visit 1's row.
          if (r.jobberVisitId && r.jobberVisitId === job.jobberVisitId) {
            updatedRow = true;
            const updated: PerformanceJobRow = {
              ...r,
              bh: entry.creditedBH,
              totalBH: rowTotalBH,
            };
            delete updated.awaitingCompletionReview;
            return updated;
          }
          return r;
        });
        if (!updatedRow) {
          // Synthetic row for a retroactive split on a date that didn't have
          // a visit row yet for this job.
          newJobs.push({
            desc: job.title,
            bh: entry.creditedBH,
            source: 'jobber',
            jobberVisitId: job.jobberVisitId,
            jobberJobId: job.jobberJobId,
            jobberJobNumber: String(job.jobberJobNumber),
            totalBH: rowTotalBH,
          });
        }
        day[entry.crewId] = { ...crewLog, jobs: newJobs };
        nextPerformance[entry.targetDate] = day;
      }

      // Visit-complete decision. With splits: every crew on the split
      // must independently hit 100% of its share. Without splits: the
      // visit-wide cumulative credit must reach (effectively) 100% of
      // job.totalBH — never "each crew at 100%" (that would imply
      // double-crediting on a shared pool).
      let allCrewsComplete: boolean;
      if (hasSplits) {
        if (visitSplit) {
          allCrewsComplete = visitSplit.splits.every(s => {
            const slotCrew = appData.schedules[currentDate]?.find(c => c.id === s.crewId);
            const slotKey = slotCrew ? stableCrewKey(slotCrew) : `crewid:${s.crewId}`;
            const list = perCrew.get(slotKey) || [];
            const last = list[list.length - 1];
            return !!last && last.percentComplete >= 100;
          });
        } else {
          // Defensive: hasSplits true but visitSplit somehow null.
          allCrewsComplete = myFinalPct >= 100;
        }
      } else {
        const cumFinalPct = job.totalBH > 0 ? (cumBHTotal / job.totalBH) * 100 : 0;
        allCrewsComplete = cumFinalPct >= 99.95;
      }
      const nextMultiDay = {
        ...(appData.multiDayJobs || {}),
        [job.jobberVisitId]: {
          ...job,
          completionHistory: merged,
          status: (mode === 'force-100' || allCrewsComplete) ? 'complete' as const : 'in_progress' as const,
        },
      };
      const success = await syncToCloud({
        ...appData,
        performance: nextPerformance,
        multiDayJobs: nextMultiDay,
      });
      if (success) {
        const currentCrew = appData.schedules[currentDate]?.find(c => c.id === currentCrewId);
        const crewLabel = currentCrew ? `${currentCrew.division} #${currentCrew.crewNumber}` : currentCrewId;
        if (mode === 'force-100') {
          logPerfActivity({
            type: 'multiday_percent_overridden',
            targetDate: currentDate,
            crewId: currentCrewId,
            crewLabel,
            userId: currentUserId,
            userName: currentUserName,
            userRole: currentUserRole,
            jobberJobId: job.jobberJobId,
            sourceJobberVisitId: job.jobberVisitId,
            jobTitle: job.title,
            valueBefore: priorPct,
            valueAfter: 100,
            valueLabel: '%',
          });
        } else if (nextPctValid) {
          logPerfActivity({
            type: 'multiday_percent_marked',
            targetDate: currentDate,
            crewId: currentCrewId,
            crewLabel,
            userId: currentUserId,
            userName: currentUserName,
            userRole: currentUserRole,
            jobberJobId: job.jobberJobId,
            sourceJobberVisitId: job.jobberVisitId,
            jobTitle: job.title,
            valueBefore: priorPct,
            valueAfter: nextPctNumber,
            valueLabel: '%',
          });
        }
        for (const s of splits) {
          const sCrew = appData.schedules[s.date]?.find(c => c.id === s.crewId);
          const sLabel = sCrew ? `${sCrew.division} #${sCrew.crewNumber}` : s.crewId;
          logPerfActivity({
            type: 'multiday_split_added',
            targetDate: s.date,
            crewId: s.crewId,
            crewLabel: sLabel,
            userId: currentUserId,
            userName: currentUserName,
            userRole: currentUserRole,
            jobberJobId: job.jobberJobId,
            sourceJobberVisitId: job.jobberVisitId,
            jobTitle: job.title,
            valueAfter: Number(s.pct),
            valueLabel: '%',
            reasonNote: s.reason || undefined,
          });
        }
        showToastMsg(`Updated ${job.title} — ${myFinalPct}% credited.`);
        onClose();
      }
    } catch (err: any) {
      showToastMsg(`Failed: ${err?.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleLawnStyle = async () => {
    if (!canOverride) return;
    const wasLawn = job.isLawnJob;
    if (!confirm(wasLawn
      ? `Treat "${job.title}" as multi-day going forward? Future syncs will require % review for new visits.`
      : `Treat "${job.title}" as single-day (auto-credit on completion) going forward?`
    )) return;
    setBusy(true);
    try {
      const updated: MultiDayJob = { ...job, isLawnJob: !wasLawn, manualOverride: true };
      // Per-visit only — no cross-visit propagation. The flag is now
      // informational; the sync no longer branches on it.
      const success = await syncToCloud({
        ...appData,
        multiDayJobs: { ...(appData.multiDayJobs || {}), [job.jobberVisitId]: updated },
      });
      if (success) {
        showToastMsg(`"${job.title}" set to ${wasLawn ? 'multi-day' : 'single-day'}.`);
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const todayDelta = round2((Math.max(0, nextPctNumber - priorPct) / 100) * basisBH);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center md:p-4">
      <div className="bg-white md:rounded-xl shadow-2xl w-full md:max-w-2xl h-full md:h-auto md:max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Completion Review</div>
            <h2 className="text-lg font-bold text-slate-800 truncate">{job.title}</h2>
            <div className="text-xs text-slate-500 mt-0.5">
              {basisBH !== job.totalBH ? (
                <>This crew's share: {basisBH} BH (of {job.totalBH} visit BH)</>
              ) : (
                <>Total: {job.totalBH} BH</>
              )}
              {' · '}
              {hasSplits
                ? <>Currently {priorPct}% complete on this crew</>
                : <>Currently {priorPct}% of the job complete</>}
              {job.manualOverride && <span className="ml-2 text-amber-700 font-bold">· Manual override</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {canOverride && (
              <button onClick={() => setSettingsOpen(o => !o)} className="text-slate-400 hover:text-slate-700 p-1.5 rounded" aria-label="Settings">
                <Settings className="w-4 h-4" />
              </button>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1.5 rounded" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {settingsOpen && (
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 text-xs">
            <button
              onClick={toggleLawnStyle}
              disabled={busy}
              className="text-left w-full hover:bg-white p-2 rounded border border-slate-200 disabled:opacity-50"
            >
              <div className="font-bold text-slate-700">
                {job.isLawnJob ? 'Switch to multi-day (require % review)' : 'Switch to single-day (auto-credit at 100%)'}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Affects future syncs only. Existing completion entries stay.
              </div>
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {orphanedEntries.length > 0 && (
            <div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-md p-3">
              <div className="flex items-center gap-1.5 font-black uppercase tracking-widest text-[11px] text-rose-700 mb-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Orphaned credit — no crew-day carries this
              </div>
              <div className="mb-1.5">
                {orphanedEntries.length} completion {orphanedEntries.length === 1 ? 'entry credits' : 'entries credit'} BH that no crew-day on {orphanedEntries.length === 1 ? 'its date' : 'their dates'} reflects. Credited BH is preserved — add the crew-day (or re-sync) to attach it. Not auto-fixed.
              </div>
              <ul className="space-y-0.5">
                {orphanedEntries.map((o, i) => (
                  <li key={i} className="font-mono text-[11px] text-rose-700">
                    {formatDateLabel(o.date)} · {o.crew} · <span className="font-bold">{o.bh} BH</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!hasSplits && cumulativePriorPct >= 100 && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
              Already 100% complete from prior entries — no further % can be credited. Use the Override button only if you need to revisit.
            </div>
          )}
          <div>
            <label className="text-xs font-black uppercase tracking-widest text-slate-600 block mb-2">
              What % is this job complete at end of {formatDateLabel(currentDate)}?
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="number"
                value={newPct}
                onChange={e => setNewPct(e.target.value)}
                min={priorPct}
                max={100}
                step={1}
                placeholder={`${priorPct}-100`}
                className="w-24 border border-slate-300 rounded-lg p-2 text-lg font-mono font-bold text-emerald-700 outline-none focus:ring-2 focus:ring-emerald-400"
              />
              <span className="text-sm text-slate-500">%</span>
              {newPct !== '' && !nextPctValid && (
                <span className="text-xs text-rose-600 font-bold">
                  Must be between {priorPct} and 100.
                </span>
              )}
            </div>
            {/* Consequence line — marking a % IS the crediting action, so state
                it plainly before saving (which crew, which date, how much). */}
            {nextPctValid && (
              <div className="mt-2 text-sm font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                This will credit <span className="font-black">{todayDelta} BH</span> to {currentCrewLabel} on {formatDateLabel(currentDate)}.
                {splits.length > 0 && <span className="text-emerald-700 font-medium"> Plus {splits.length} retroactive {splits.length === 1 ? 'entry' : 'entries'} below.</span>}
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-black uppercase tracking-widest text-slate-600">Need to retroactively credit a past day?</div>
              {!splitFormOpen && (
                <button onClick={() => setSplitFormOpen(true)} className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> Split to past day
                </button>
              )}
            </div>

            {splits.length > 0 && (
              <ul className="space-y-1 mb-2">
                {splits.map(s => (
                  <li key={s.id} className="text-xs flex items-center justify-between bg-amber-50 border border-amber-200 rounded p-2">
                    <span><span className="font-bold">{formatDateLabel(s.date)}</span> · {s.pct}% · {appData.schedules[s.date]?.find(c => c.id === s.crewId) ? `${appData.schedules[s.date]!.find(c => c.id === s.crewId)!.division} #${appData.schedules[s.date]!.find(c => c.id === s.crewId)!.crewNumber}` : s.crewId}{s.reason ? ` · ${s.reason}` : ''}</span>
                    <button onClick={() => removeSplit(s.id)} className="text-slate-400 hover:text-rose-500"><X className="w-3.5 h-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}

            {splitFormOpen && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="flex flex-wrap gap-2 items-end">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Date</label>
                    <input
                      type="date"
                      value={splitDate}
                      max={currentDate}
                      onChange={e => { setSplitDate(e.target.value); setSplitCrew(''); }}
                      className="border border-slate-300 rounded p-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">% complete</label>
                    <input
                      type="number"
                      value={splitPct}
                      onChange={e => setSplitPct(e.target.value)}
                      min={0}
                      max={100}
                      step={1}
                      placeholder="0-100"
                      className="w-20 border border-slate-300 rounded p-1.5 text-sm font-mono font-bold text-emerald-700"
                    />
                  </div>
                  <div className="flex-1 min-w-[150px]">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Crew</label>
                    <select
                      value={splitCrew}
                      onChange={e => setSplitCrew(e.target.value)}
                      disabled={!splitDate}
                      className="w-full border border-slate-300 rounded p-1.5 text-sm font-bold disabled:bg-slate-100"
                    >
                      <option value="">{crewsForSplitDate.length === 0 ? '(no crews on date)' : 'auto / pick…'}</option>
                      {crewsForSplitDate.map(c => {
                        const approved = isDateApproved(splitDate, c.id);
                        return <option key={c.id} value={c.id} disabled={approved}>{c.division} #{c.crewNumber}{approved ? ' (approved — unapprove first)' : ''}</option>;
                      })}
                    </select>
                  </div>
                </div>
                <textarea
                  value={splitReason}
                  onChange={e => setSplitReason(e.target.value)}
                  placeholder="Reason note (optional)…"
                  rows={2}
                  className="w-full border border-slate-200 rounded p-2 text-xs outline-none focus:ring-2 focus:ring-emerald-200"
                />
                <div className="flex items-center justify-end gap-2">
                  <button onClick={() => { setSplitFormOpen(false); setSplitDate(''); setSplitPct(''); setSplitCrew(''); setSplitReason(''); }} className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 px-2 py-1 rounded">
                    Cancel
                  </button>
                  <button onClick={addSplit} className="text-[10px] font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded shadow">
                    Add retroactive entry
                  </button>
                </div>
              </div>
            )}
          </div>

          {sortedHistory.length > 0 && (
            <div className="border-t border-slate-200 pt-4">
              <div className="text-xs font-black uppercase tracking-widest text-slate-600 mb-2">Completion history</div>
              <ul className="space-y-1">
                {sortedHistory.map((h, i) => {
                  const crew = appData.schedules[h.targetDate]?.find(c => c.id === h.crewId);
                  const crewLabel = crew ? `${crew.division} #${crew.crewNumber}` : h.crewId;
                  return (
                    <li key={i} className="text-xs flex items-center justify-between border-b border-slate-100 py-1">
                      <span className="flex items-center gap-1.5">
                        {h.isRetroactive && <Clock className="w-3 h-3 text-amber-500" />}
                        <span className="font-bold text-slate-700">{formatDateLabel(h.targetDate)}</span>
                        <span className="text-slate-600">— {h.percentComplete}% ({h.creditedBH} BH)</span>
                        <span className="text-slate-400">· {crewLabel}</span>
                      </span>
                      <span className="text-[10px] text-slate-400 truncate ml-2">
                        marked {formatTime(h.markedAt)} by {h.markedByName}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex flex-col-reverse md:flex-row md:items-center md:justify-between gap-2 flex-wrap">
          {canOverride && (
            <button
              onClick={() => submit('force-100')}
              disabled={busy}
              className="min-h-[44px] text-[11px] font-black uppercase tracking-widest text-amber-700 hover:text-amber-900 px-3 py-2 rounded-lg hover:bg-amber-50 disabled:opacity-50 text-left"
              title="Mark this job as fully complete (100%). Credits remaining %."
            >
              Override: Mark fully complete (100%)
            </button>
          )}
          <div className="flex items-center gap-2 md:ml-auto w-full md:w-auto">
            <button onClick={onClose} disabled={busy} className="min-h-[44px] flex-1 md:flex-none px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">
              Cancel
            </button>
            <button
              onClick={() => submit('confirm')}
              disabled={busy || (!nextPctValid && splits.length === 0)}
              className="min-h-[44px] flex-1 md:flex-none px-5 py-2.5 text-sm font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              <CheckCircle className="w-4 h-4" /> Confirm %
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

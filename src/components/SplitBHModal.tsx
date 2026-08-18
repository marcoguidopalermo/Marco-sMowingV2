import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { X, Split as SplitIcon, Users, RotateCcw } from 'lucide-react';
import { AppData, PerformanceLog, VisitBHSplit, UserRole } from '../types';
import { logPerfActivity } from '../lib/perfAudit';

interface SplitBHModalProps {
  isOpen: boolean;
  onClose: () => void;
  visitId: string;
  visitTitle: string;
  visitTotalBH: number;
  date: string;
  appData: AppData;
  dailyLogs: Record<string, PerformanceLog>;
  setDailyLogs: Dispatch<SetStateAction<Record<string, PerformanceLog>>>;
  syncToCloud: (data: AppData) => Promise<boolean | undefined>;
  // BH splits are written per-visit through App's targeted path — a
  // whole-document save no longer carries them. See saveVisitBHSplits.
  saveVisitBHSplits: (
    next: AppData['visitBHSplits'], baseline: AppData['visitBHSplits'],
  ) => Promise<boolean>;
  showToastMsg: (msg: string) => void;
  currentUserId: string;
  currentUserName: string;
  currentUserRole: UserRole;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

// Effective headcount for the auto-split: assigned employees on the date,
// minus anyone on full-day absence (dailyAbsences). Partial time off DOES
// count — the worker was on the crew for some of the day.
function effectiveHeadcount(
  crewId: string,
  date: string,
  appData: AppData,
): number {
  const crew = (appData.schedules?.[date] || []).find(c => c.id === crewId);
  if (!crew) return 0;
  const absent = new Set<string>((appData.dailyAbsences?.[date] as string[]) || []);
  return (crew.employees || []).filter(empId => !absent.has(empId)).length;
}

function buildHeadcountSplit(
  crewIds: string[],
  totalBH: number,
  headcounts: number[],
): Array<{ crewId: string; bh: number }> {
  const totalHead = headcounts.reduce((a, b) => a + b, 0);
  let result: Array<{ crewId: string; bh: number }>;
  if (totalHead === 0) {
    const per = round1(totalBH / crewIds.length);
    result = crewIds.map(c => ({ crewId: c, bh: per }));
  } else {
    result = crewIds.map((c, i) => ({
      crewId: c,
      bh: round1(totalBH * (headcounts[i] / totalHead)),
    }));
  }
  // Land the sum exactly on totalBH — assign drift to the largest share.
  const sum = result.reduce((a, s) => a + s.bh, 0);
  const drift = round1(totalBH - sum);
  if (Math.abs(drift) >= 0.05 && result.length > 0) {
    let maxIdx = 0;
    for (let i = 1; i < result.length; i++) {
      if (result[i].bh > result[maxIdx].bh) maxIdx = i;
    }
    result[maxIdx] = { ...result[maxIdx], bh: round1(result[maxIdx].bh + drift) };
  }
  return result;
}

export default function SplitBHModal({
  isOpen, onClose, visitId, visitTitle, visitTotalBH, date,
  appData, dailyLogs, setDailyLogs, syncToCloud, saveVisitBHSplits, showToastMsg,
  currentUserId, currentUserName, currentUserRole,
}: SplitBHModalProps) {
  const existing: VisitBHSplit | undefined =
    (appData.visitBHSplits || {})[visitId];

  // Working draft of splits keyed by crewId. String-typed for editability.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Crew label + headcount per involved crew. Derived from the existing
  // split's crew list (which the sync keeps in sync with Jobber assignees).
  const crewMeta = useMemo(() => {
    if (!existing) return [] as Array<{ id: string; label: string; head: number }>;
    return existing.splits.map(s => {
      const crew = (appData.schedules?.[date] || []).find(c => c.id === s.crewId);
      const label = crew ? `${crew.division} #${crew.crewNumber}` :
        (dailyLogs[s.crewId]
          ? `${dailyLogs[s.crewId].division} #${dailyLogs[s.crewId].crewNumber}`
          : s.crewId);
      return { id: s.crewId, label, head: effectiveHeadcount(s.crewId, date, appData) };
    });
  }, [existing, appData, date, dailyLogs]);

  // Prefill drafts whenever the modal opens against a fresh visit.
  useEffect(() => {
    if (!isOpen || !existing) return;
    const next: Record<string, string> = {};
    for (const s of existing.splits) {
      next[s.crewId] = String(s.bh);
    }
    setDrafts(next);
  }, [isOpen, existing]);

  if (!isOpen || !existing) return null;

  const parsed = crewMeta.map(c => ({
    crewId: c.id,
    label: c.label,
    head: c.head,
    bh: Number(drafts[c.id] ?? '0'),
  }));
  const sum = round1(parsed.reduce((a, s) => a + (Number.isFinite(s.bh) ? s.bh : 0), 0));
  const sumDelta = round1(sum - visitTotalBH);
  const sumValid = Math.abs(sumDelta) < 0.05;
  const allNonNegative = parsed.every(s => Number.isFinite(s.bh) && s.bh >= 0);
  const atLeastOnePositive = parsed.some(s => Number.isFinite(s.bh) && s.bh > 0);
  const canSave = sumValid && allNonNegative && atLeastOnePositive;

  const applyHeadcountReset = () => {
    const split = buildHeadcountSplit(
      crewMeta.map(c => c.id),
      visitTotalBH,
      crewMeta.map(c => c.head),
    );
    const next: Record<string, string> = {};
    for (const s of split) next[s.crewId] = String(s.bh);
    setDrafts(next);
  };

  const commit = async (method: 'manual' | 'auto') => {
    const newSplits = parsed.map(p => ({ crewId: p.crewId, bh: round1(p.bh) }));
    const updated: VisitBHSplit = {
      visitId,
      totalBH: visitTotalBH,
      splits: newSplits,
      splitMethod: method,
      lastUpdatedAt: Date.now(),
    };
    // Mirror new totalBH onto each affected crew's row for THIS date so the
    // row's "X / Y BH" math (and the partial-completion modal's credit
    // basis, which uses row.totalBH) reflects the new share immediately,
    // without waiting for the next sync.
    setDailyLogs(prev => {
      const n = { ...prev };
      for (const { crewId, bh: share } of newSplits) {
        const log = n[crewId];
        if (!log) continue;
        const jobs = log.jobs.map(j => {
          if (j.jobberVisitId !== visitId) return j;
          return { ...j, totalBH: share };
        });
        n[crewId] = { ...log, jobs };
      }
      return n;
    });
    const newAppData: AppData = {
      ...appData,
      visitBHSplits: {
        ...(appData.visitBHSplits || {}),
        [visitId]: updated,
      },
    };
    // Also patch performance map's rows so the persisted store agrees
    // with the in-memory edit. Only touches THIS date's logs for the
    // involved crews; leaves every other date/crew untouched.
    const perfDayBefore = (newAppData.performance || {})[date] || {};
    const perfDayAfter: Record<string, PerformanceLog> = { ...perfDayBefore };
    for (const { crewId, bh: share } of newSplits) {
      const log = perfDayAfter[crewId];
      if (!log) continue;
      perfDayAfter[crewId] = {
        ...log,
        jobs: (log.jobs || []).map(j =>
          j.jobberVisitId === visitId ? { ...j, totalBH: share } : j,
        ),
      };
    }
    newAppData.performance = {
      ...(newAppData.performance || {}),
      [date]: perfDayAfter,
    };
    // The split itself goes through the targeted per-visit write — this is pay
    // attribution, and the other thirty-odd visits in the map must not be
    // rewritten from this client's memory. The performance rows it patches
    // alongside continue through the document. If the split is refused, the
    // rows that would disagree with it are not written either.
    if (!(await saveVisitBHSplits(newAppData.visitBHSplits, appData.visitBHSplits))) return;
    await syncToCloud(newAppData);
    logPerfActivity({
      type: 'multiday_split_added',
      targetDate: date,
      crewId: newSplits[0]?.crewId || '',
      crewLabel: crewMeta[0]?.label || '',
      userId: currentUserId,
      userName: currentUserName,
      userRole: currentUserRole,
      sourceJobberVisitId: visitId,
      jobTitle: visitTitle,
      valueLabel: 'BH',
      reasonNote: `Split (${method}): ${newSplits.map(s => `${s.bh}`).join(' / ')} of ${visitTotalBH} BH`,
    });
    showToastMsg(`Saved BH split (${method}) for ${visitTitle}.`);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center md:p-4">
      <div className="bg-white md:rounded-xl shadow-2xl w-full md:max-w-lg h-full md:h-auto md:max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
              <SplitIcon className="w-3.5 h-3.5" /> Split BH between crews
            </div>
            <h2 className="text-lg font-bold text-slate-800 truncate">{visitTitle}</h2>
            <div className="text-xs text-slate-500">
              Total: <span className="font-mono font-bold text-emerald-700">{visitTotalBH} BH</span> · {date}
              <span className="ml-2 text-slate-400">Currently {existing.splitMethod}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1.5 rounded" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {parsed.map((row) => (
            <div key={row.crewId} className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm text-slate-800 truncate">{row.label}</div>
                <div className="text-[11px] text-slate-500 flex items-center gap-1">
                  <Users className="w-3 h-3" /> {row.head} {row.head === 1 ? 'person' : 'people'}
                </div>
              </div>
              <input
                type="number"
                step="0.1"
                min={0}
                value={drafts[row.crewId] ?? ''}
                onChange={e => setDrafts(prev => ({ ...prev, [row.crewId]: e.target.value }))}
                className={`w-24 border rounded-lg p-2 text-base font-mono font-bold text-emerald-700 outline-none focus:ring-2 focus:ring-emerald-400 ${row.bh < 0 || !Number.isFinite(row.bh) ? 'border-rose-400 ring-1 ring-rose-200' : 'border-slate-300'}`}
              />
              <span className="text-xs font-bold text-slate-500">BH</span>
            </div>
          ))}

          <div className={`mt-2 p-3 rounded-lg border flex items-center justify-between ${sumValid ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-300'}`}>
            <span className={`text-xs font-black uppercase tracking-widest ${sumValid ? 'text-emerald-700' : 'text-rose-700'}`}>
              Total
            </span>
            <span className={`font-mono font-bold text-sm ${sumValid ? 'text-emerald-700' : 'text-rose-700'}`}>
              {sum.toFixed(1)} / {visitTotalBH.toFixed(1)} BH
              {!sumValid && (
                <span className="ml-2 text-[11px] uppercase">
                  ({sumDelta > 0 ? '+' : ''}{sumDelta.toFixed(1)})
                </span>
              )}
            </span>
          </div>

          {!atLeastOnePositive && (
            <p className="text-xs font-bold text-rose-600">At least one crew must have BH &gt; 0.</p>
          )}
          {!allNonNegative && (
            <p className="text-xs font-bold text-rose-600">Each share must be ≥ 0.</p>
          )}

          <button
            type="button"
            onClick={applyHeadcountReset}
            className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg px-3 py-2"
            title="Recompute the headcount-proportional split"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset to headcount split
          </button>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex flex-col-reverse md:flex-row md:items-center md:justify-end gap-2">
          <button onClick={onClose} className="min-h-[44px] px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg">
            Cancel
          </button>
          <button
            onClick={() => commit('manual')}
            disabled={!canSave}
            className="min-h-[44px] px-5 py-2.5 text-sm font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            Save split
          </button>
        </div>
      </div>
    </div>
  );
}

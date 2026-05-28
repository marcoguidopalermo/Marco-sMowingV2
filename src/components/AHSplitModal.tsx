import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { X, Split as SplitIcon } from 'lucide-react';
import { AppData, PerformanceLog, UserRole } from '../types';
import { logPerfActivity } from '../lib/perfAudit';

interface AHSplitModalProps {
  isOpen: boolean;
  onClose: () => void;
  date: string;
  sourceCrewId: string;
  empId: string;
  workerName: string;
  appData: AppData;
  dailyLogs: Record<string, PerformanceLog>;
  setDailyLogs: Dispatch<SetStateAction<Record<string, PerformanceLog>>>;
  showToastMsg: (msg: string) => void;
  currentUserName: string;
  currentUserId: string;
  currentUserRole: UserRole;
}

const REASONS = ['Switched crews', 'Helping out', 'Other'];

export default function AHSplitModal({
  isOpen, onClose, date, sourceCrewId, empId, workerName,
  appData, dailyLogs, setDailyLogs, showToastMsg, currentUserName,
  currentUserId, currentUserRole,
}: AHSplitModalProps) {
  const sourceLog = dailyLogs[sourceCrewId];
  const currentAH = Number(sourceLog?.employeeAH?.[empId] ?? 0);

  const [hours, setHours] = useState<string>('');
  const [targetCrewId, setTargetCrewId] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [reasonOther, setReasonOther] = useState<string>('');

  if (!isOpen) return null;

  // Candidate target crews: other crews on today's schedule that have a
  // PerformanceLog entry (so the rebuild useEffect will preserve them).
  const candidates = Object.entries(dailyLogs)
    .filter(([cid, log]) => cid !== sourceCrewId && !!log)
    .map(([cid, log]) => ({
      id: cid,
      label: `${log.division} #${log.crewNumber}`,
      approved: log.approvalStatus === 'approved',
    }));

  const hoursNum = Number(hours);
  const hoursValid = hours !== '' && Number.isFinite(hoursNum) && hoursNum > 0 && hoursNum <= currentAH;
  const targetLog = targetCrewId ? dailyLogs[targetCrewId] : undefined;
  const targetApproved = !!targetLog && targetLog.approvalStatus === 'approved';
  const reasonValid = !!reason && (reason !== 'Other' || reasonOther.trim().length > 0);

  const canSubmit = hoursValid && !!targetCrewId && !targetApproved && reasonValid;

  const submit = () => {
    if (!canSubmit) return;
    const movedHours = hoursNum;
    const finalReason = reason === 'Other' ? reasonOther.trim() : reason;
    setDailyLogs(prev => {
      const next = { ...prev };
      // Subtract from source.
      const sLog = next[sourceCrewId];
      if (sLog) {
        const newAH = { ...sLog.employeeAH };
        const remaining = currentAH - movedHours;
        newAH[empId] = remaining;
        next[sourceCrewId] = { ...sLog, employeeAH: newAH };
      }
      // Add to target.
      const tLog = next[targetCrewId];
      if (tLog) {
        const newAH = { ...tLog.employeeAH };
        const existingTargetHours = Number(newAH[empId] ?? 0) || 0;
        newAH[empId] = existingTargetHours + movedHours;
        next[targetCrewId] = { ...tLog, employeeAH: newAH };
      }
      return next;
    });
    const sourceLabel = sourceLog ? `${sourceLog.division} #${sourceLog.crewNumber}` : sourceCrewId;
    const targetLabel = targetLog ? `${targetLog.division} #${targetLog.crewNumber}` : targetCrewId;
    logPerfActivity({
      type: 'ah_split',
      targetDate: date,
      crewId: sourceCrewId,
      crewLabel: sourceLabel,
      userId: currentUserId,
      userName: currentUserName,
      userRole: currentUserRole,
      workerId: empId,
      workerName,
      valueBefore: currentAH,
      valueAfter: currentAH - movedHours,
      valueLabel: 'AH',
      reason: finalReason,
      reasonNote: `Moved ${movedHours} hrs → ${targetLabel}`,
    });
    showToastMsg(`Moved ${movedHours} hrs from ${workerName} → ${targetLabel}. Save Daily Data to persist.`);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center md:p-4">
      <div className="bg-white md:rounded-xl shadow-2xl w-full md:max-w-md h-full md:h-auto md:max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
              <SplitIcon className="w-3.5 h-3.5" /> Split AH
            </div>
            <h2 className="text-lg font-bold text-slate-800 truncate">{workerName}</h2>
            <div className="text-xs text-slate-500">on {date}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1.5 rounded" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="text-sm text-slate-700">
            Current AH on {sourceLog ? <span className="font-bold">{sourceLog.division} #{sourceLog.crewNumber}</span> : 'source'}:{' '}
            <span className="font-mono font-bold text-green-700">{currentAH} hrs</span>
          </div>

          <div>
            <label className="text-xs font-black uppercase tracking-widest text-slate-600 block mb-1">Move how many hours?</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={hours}
                onChange={e => setHours(e.target.value)}
                min={0.1}
                max={currentAH}
                step={0.1}
                placeholder="0"
                className="w-24 border border-slate-300 rounded-lg p-2 text-lg font-mono font-bold text-emerald-700 outline-none focus:ring-2 focus:ring-emerald-400"
              />
              <span className="text-sm text-slate-500">hrs</span>
              {hours !== '' && !hoursValid && (
                <span className="text-xs text-rose-600 font-bold">Must be 0–{currentAH}.</span>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs font-black uppercase tracking-widest text-slate-600 block mb-1">Target crew</label>
            {candidates.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm font-medium text-amber-900">
                No other crews scheduled on this day to split hours to.
              </div>
            ) : (
              <select
                value={targetCrewId}
                onChange={e => setTargetCrewId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg p-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-400"
              >
                <option value="">Pick a crew…</option>
                {candidates.map(c => (
                  <option key={c.id} value={c.id} disabled={c.approved}>
                    {c.label}{c.approved ? ' (approved — unapprove first)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="text-xs font-black uppercase tracking-widest text-slate-600 block mb-1">Why?</label>
            <div className="flex flex-wrap gap-2">
              {REASONS.map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={`min-h-[44px] px-3 py-2 text-xs font-bold rounded-lg border ${reason === r ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                >
                  {r}
                </button>
              ))}
            </div>
            {reason === 'Other' && (
              <input
                type="text"
                autoFocus
                value={reasonOther}
                onChange={e => setReasonOther(e.target.value)}
                placeholder="Reason…"
                className="mt-2 w-full text-xs px-2 py-1.5 border border-slate-200 rounded outline-none focus:border-emerald-300 focus:ring-1 focus:ring-emerald-200"
              />
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex flex-col-reverse md:flex-row md:items-center md:justify-end gap-2">
          <button onClick={onClose} className="min-h-[44px] px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="min-h-[44px] px-5 py-2.5 text-sm font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            Move {hoursValid ? hoursNum : ''} hrs
          </button>
        </div>
      </div>
    </div>
  );
}

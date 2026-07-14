import type { Dispatch, SetStateAction } from 'react';
import { useState } from 'react';
import { CheckCircle, X, Wrench, Users, Check } from 'lucide-react';
import type { StoredFile } from '../types';
import PhotoUpload from './PhotoUpload';

interface Worker { userEmail: string; userName: string; }

const WORKER_PALETTE = [
  'bg-emerald-500', 'bg-sky-500', 'bg-amber-500', 'bg-rose-500',
  'bg-violet-500', 'bg-cyan-500', 'bg-pink-500', 'bg-orange-500',
];
function workerColor(email: string): string {
  if (!email) return 'bg-slate-400';
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) | 0;
  return WORKER_PALETTE[Math.abs(h) % WORKER_PALETTE.length];
}
function workerInitial(name: string, email: string): string {
  const src = (name || '').trim() || (email || '').split('@')[0] || '';
  return (src.charAt(0) || '?').toUpperCase();
}
function workerFirstName(name: string, email: string): string {
  const src = (name || '').trim() || (email || '').split('@')[0] || '';
  if (!src) return 'Unknown';
  const first = src.split(/\s+/).filter(Boolean)[0] || src;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export interface CompletionModalState {
  isOpen: boolean;
  taskId: string;
  unitId?: string;
  unitName?: string;
  partCost: string;
  laborHours: string;
  fixNotes: string;
  // "Who worked on this task?" — pre-seeded with the task's assignees
  // when the modal opens, the mechanic can add more helpers (no cap) or
  // deselect. On submit App.tsx splits work-credit evenly among these
  // workers (1/N each). If left empty it falls back to the task's
  // assignees, then to whoever completed it.
  selectedWorkers?: Worker[];
  // Maintenance-only inputs. Set when the task being completed has
  // source==='maintenance' so the modal can prompt for the reading at
  // service time and advance the unit's schedule.
  isMaintenance?: boolean;
  maintenanceItemName?: string;
  // The numeric reading at service time. For hour-tracked equipment
  // this is engine hours; for km-tracked trucks it is the odometer.
  // The label flips on `maintenanceMetric`.
  hoursAtService?: string;
  // Metric of the maintenance schedule being closed. Drives the
  // unit label and the placeholder; the rest of the maintenance
  // panel is identical for both.
  maintenanceMetric?: 'hours' | 'km';
  // Next-due target, pre-filled by App.tsx with (currentReading +
  // item.threshold) for both metrics. The modal renders this as a
  // locked-by-default display with an Edit toggle (see
  // nextDueLocked). The submit handler always reads it (locked or
  // not) and forwards as the explicit override to
  // resetMaintenanceItem, so the default still gets persisted
  // unchanged if the mechanic accepts it.
  nextDueAtService?: string;
  // UI-only: undefined / true => locked (read-only display +
  // Edit button); false => unlocked (number input + Lock button).
  // Defaults to locked so the common case is one click.
  nextDueLocked?: boolean;
  // Completion photos of the finished work. Uploaded to repairs/{taskId};
  // merged onto the repairLog entry (with the task's report photos) on save.
  photos?: StoredFile[];
}

interface CompletionModalProps {
  state: CompletionModalState;
  setState: Dispatch<SetStateAction<CompletionModalState>>;
  onSubmit: () => void | Promise<void>;
  // Active mechanics available to credit on this repair. The selector
  // also always shows anyone already selected (e.g. a legacy assignee no
  // longer in the active roster) so pre-seeded picks never vanish.
  mechanicRoster?: Worker[];
  // True while the save awaits the cloud write — disables the button and
  // shows "Saving…". The modal only closes on success, so without this a
  // slow connection invites a re-tap and a duplicate repair entry.
  isSubmitting?: boolean;
  uploaderEmail: string;
  uploaderName: string;
}

export default function CompletionModal({ state, setState, onSubmit, mechanicRoster = [], isSubmitting = false, uploaderEmail, uploaderName }: CompletionModalProps) {
  const [uploading, setUploading] = useState(false);
  if (!state.isOpen) return null;
  const selected = state.selectedWorkers || [];
  const isSelected = (email: string) => selected.some(w => w.userEmail.toLowerCase() === email.toLowerCase());
  const toggleWorker = (w: Worker) => {
    setState(s => {
      const cur = s.selectedWorkers || [];
      const has = cur.some(x => x.userEmail.toLowerCase() === w.userEmail.toLowerCase());
      return {
        ...s,
        selectedWorkers: has
          ? cur.filter(x => x.userEmail.toLowerCase() !== w.userEmail.toLowerCase())
          : [...cur, w],
      };
    });
  };
  // Roster to display = active mechanics ∪ anyone already selected, deduped.
  const pickList: Worker[] = (() => {
    const byEmail = new Map<string, Worker>();
    for (const w of mechanicRoster) byEmail.set(w.userEmail.toLowerCase(), w);
    for (const w of selected) if (!byEmail.has(w.userEmail.toLowerCase())) byEmail.set(w.userEmail.toLowerCase(), w);
    return Array.from(byEmail.values()).sort((a, b) => (a.userName || '').localeCompare(b.userName || ''));
  })();
  const isKm = state.isMaintenance && state.maintenanceMetric === 'km';
  const unitLabel = isKm ? 'km' : 'hrs';
  const readingLabel = isKm
    ? `Odometer (km) at service${state.maintenanceItemName ? ` (${state.maintenanceItemName})` : ''}`
    : `Engine hours at service${state.maintenanceItemName ? ` (${state.maintenanceItemName})` : ''}`;
  return (
    <div className="fixed inset-0 bg-black/60 z-[90] flex md:items-center md:justify-center md:p-4">
      <div className="bg-white md:rounded-2xl shadow-2xl h-[100dvh] md:h-auto md:max-h-[92dvh] w-full md:max-w-md overflow-hidden flex flex-col animate-in zoom-in-95">
        <div className="p-5 border-b border-gray-200 bg-slate-900 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <h2 className="text-xl font-bold">Complete Repair</h2>
          </div>
          <button onClick={() => setState({ ...state, isOpen: false })} className="text-white/60 hover:text-white min-w-[44px] min-h-[44px] inline-flex items-center justify-center"><X className="w-6 h-6" /></button>
        </div>

        <div className="p-6 space-y-4 flex-1 min-h-0 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Unit</span>
            <p className="font-bold text-slate-800">{state.unitName}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Est. Part Cost ($)</label>
              <input type="number" value={state.partCost} onChange={e => setState({ ...state, partCost: e.target.value })} className="w-full border border-slate-300 rounded-xl p-3 font-mono font-bold text-lg outline-none focus:ring-2 focus:ring-green-500" placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Est. Labour Hours</label>
              <input type="number" value={state.laborHours} onChange={e => setState({ ...state, laborHours: e.target.value })} className="w-full border border-slate-300 rounded-xl p-3 font-mono font-bold text-lg outline-none focus:ring-2 focus:ring-green-500" placeholder="0.0" />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Mechanic Fix Notes</label>
            <textarea value={state.fixNotes} onChange={e => setState({ ...state, fixNotes: e.target.value })} className="w-full border border-slate-300 rounded-xl p-3 text-sm font-medium outline-none focus:ring-2 focus:ring-green-500 resize-none" rows={3} placeholder="What was fixed?" />
          </div>

          {/* Completion photos of the finished work (optional). */}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Photos of finished work (optional)</label>
            <PhotoUpload
              dir={`repairs/${state.taskId}`}
              value={state.photos || []}
              onChange={photos => setState(s => ({ ...s, photos }))}
              uploadedBy={{ email: uploaderEmail, name: uploaderName }}
              phase="completion"
              onUploadingChange={setUploading}
            />
          </div>

          {/* WHO WORKED ON THIS TASK? — multi-select, no cap. Pre-seeded
              with the task's assignees; helpers can be added or removed.
              Work-credit is split evenly (1/N) among the selected workers
              on submit. This is the WORK record only — it does not touch
              anyone's clocked-hours pay. */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest inline-flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Who worked on this task?
            </label>
            {pickList.length === 0 ? (
              <div className="text-[11px] text-slate-400 italic border border-dashed border-slate-200 rounded-xl p-3">
                No mechanics on the roster — credit will go to whoever completes the task.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {pickList.map(w => {
                  const on = isSelected(w.userEmail);
                  return (
                    <button
                      key={w.userEmail}
                      type="button"
                      onClick={() => toggleWorker(w)}
                      aria-pressed={on}
                      title={w.userName || w.userEmail}
                      className={`relative inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border transition-colors ${
                        on
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className={`relative w-6 h-6 rounded-full ${workerColor(w.userEmail)} text-white text-[10px] font-black flex items-center justify-center shrink-0 ring-1 ring-white`}>
                        {workerInitial(w.userName, w.userEmail)}
                        {on && (
                          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-600 border border-white flex items-center justify-center">
                            <Check className="w-2 h-2 text-white" />
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] font-bold truncate max-w-[80px]">{workerFirstName(w.userName, w.userEmail)}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="text-[11px] text-slate-400">
              {selected.length === 0
                ? 'None selected — credit defaults to the assignee(s), or you if unassigned.'
                : selected.length === 1
                  ? 'Solo — full credit to 1 mechanic.'
                  : `Split evenly — ${(1 / selected.length).toFixed(2)} of the repair each (${selected.length} mechanics).`}
            </div>
          </div>

          {state.isMaintenance && (() => {
            const nextDueLocked = state.nextDueLocked !== false;
            const hint = isKm
              ? 'Locked default uses the truck\'s configured interval. Click Edit to override (e.g. synthetic ~12,000 km vs conventional ~5,000 km).'
              : 'Locked default uses the unit\'s configured interval. Click Edit to override (e.g. set the real cadence when backfilling an in-progress unit).';
            return (
              <div className="bg-amber-50/40 border border-amber-200 rounded-xl p-4 space-y-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-amber-700 flex items-center gap-1.5">
                  <Wrench className="w-3.5 h-3.5" /> Maintenance Schedule
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    {readingLabel}
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={state.hoursAtService ?? ''}
                    onChange={e => setState({ ...state, hoursAtService: e.target.value })}
                    className="w-full border border-amber-200 rounded-xl p-3 font-mono font-bold text-lg outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                    placeholder="0"
                  />
                  <div className="text-[11px] text-amber-700/80">
                    {isKm
                      ? "Updates the truck's odometer and advances this maintenance schedule."
                      : "Used to advance this unit's maintenance schedule and update its current engine hours."}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    Next service due ({unitLabel})
                  </label>
                  <div className="flex items-center gap-2">
                    {nextDueLocked ? (
                      <div className="flex-1 border border-amber-200 rounded-xl p-3 font-mono font-bold text-lg bg-white text-slate-700">
                        {state.nextDueAtService && state.nextDueAtService !== '' ? `${state.nextDueAtService} ${unitLabel}` : `— ${unitLabel}`}
                      </div>
                    ) : (
                      <input
                        type="number"
                        required
                        min={0}
                        value={state.nextDueAtService ?? ''}
                        onChange={e => setState({ ...state, nextDueAtService: e.target.value })}
                        className="flex-1 border border-amber-200 rounded-xl p-3 font-mono font-bold text-lg outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                        placeholder="0"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setState({ ...state, nextDueLocked: !nextDueLocked })}
                      className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700 hover:bg-emerald-50 rounded-lg border border-emerald-200"
                      title={nextDueLocked ? 'Override the pre-filled default' : 'Accept the pre-filled default'}
                    >
                      {nextDueLocked ? 'Edit' : 'Lock'}
                    </button>
                  </div>
                  <div className="text-[11px] text-amber-700/80">{hint}</div>
                </div>
              </div>
            );
          })()}

        </div>

        <div className="p-5 bg-slate-50 border-t border-slate-200 flex justify-end gap-3 shrink-0">
          <button onClick={() => setState({ ...state, isOpen: false })} disabled={isSubmitting} className="px-6 py-2.5 font-bold text-slate-500 disabled:opacity-50">Cancel</button>
          <button onClick={onSubmit} disabled={isSubmitting || uploading} className="px-8 py-2.5 font-black text-white bg-green-600 rounded-xl shadow-lg shadow-green-600/20 uppercase tracking-widest text-xs disabled:opacity-60 disabled:cursor-not-allowed">{isSubmitting ? 'Saving…' : uploading ? 'Uploading…' : 'Save & Close Task'}</button>
        </div>
      </div>
    </div>
  );
}

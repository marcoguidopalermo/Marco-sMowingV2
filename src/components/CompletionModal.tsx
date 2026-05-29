import type { Dispatch, SetStateAction } from 'react';
import { CheckCircle, X, Wrench } from 'lucide-react';

export interface CompletionModalState {
  isOpen: boolean;
  taskId: string;
  unitId?: string;
  unitName?: string;
  partCost: string;
  laborHours: string;
  fixNotes: string;
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
}

interface CompletionModalProps {
  state: CompletionModalState;
  setState: Dispatch<SetStateAction<CompletionModalState>>;
  onSubmit: () => void | Promise<void>;
}

export default function CompletionModal({ state, setState, onSubmit }: CompletionModalProps) {
  if (!state.isOpen) return null;
  const isKm = state.isMaintenance && state.maintenanceMetric === 'km';
  const unitLabel = isKm ? 'km' : 'hrs';
  const readingLabel = isKm
    ? `Odometer (km) at service${state.maintenanceItemName ? ` (${state.maintenanceItemName})` : ''}`
    : `Engine hours at service${state.maintenanceItemName ? ` (${state.maintenanceItemName})` : ''}`;
  return (
    <div className="fixed inset-0 bg-black/60 z-[90] flex md:items-center md:justify-center md:p-4">
      <div className="bg-white md:rounded-2xl shadow-2xl h-full md:h-auto w-full md:max-w-md overflow-hidden flex flex-col animate-in zoom-in-95">
        <div className="p-5 border-b border-gray-200 bg-slate-900 text-white flex justify-between items-center">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <h2 className="text-xl font-bold">Complete Repair</h2>
          </div>
          <button onClick={() => setState({ ...state, isOpen: false })} className="text-white/60 hover:text-white min-w-[44px] min-h-[44px] inline-flex items-center justify-center"><X className="w-6 h-6" /></button>
        </div>

        <div className="p-6 space-y-4">
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

        <div className="p-5 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button onClick={() => setState({ ...state, isOpen: false })} className="px-6 py-2.5 font-bold text-slate-500">Cancel</button>
          <button onClick={onSubmit} className="px-8 py-2.5 font-black text-white bg-green-600 rounded-xl shadow-lg shadow-green-600/20 uppercase tracking-widest text-xs">Save & Close Task</button>
        </div>
      </div>
    </div>
  );
}

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
  // Metric of the maintenance schedule being closed. 'hours' (mowers,
  // legacy default) preserves the rigid-threshold flow. 'km' (trucks)
  // surfaces the editable next-due input below.
  maintenanceMetric?: 'hours' | 'km';
  // Editable next-due target (km). Pre-filled with currentKm +
  // item.threshold so the mechanic can accept the default OR override
  // (synthetic ~12,000 vs conventional ~5,000). Ignored when
  // maintenanceMetric === 'hours'.
  nextDueAtService?: string;
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

          {state.isMaintenance && (
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
              {isKm && (
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    Next oil change due ({unitLabel})
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={state.nextDueAtService ?? ''}
                    onChange={e => setState({ ...state, nextDueAtService: e.target.value })}
                    className="w-full border border-amber-200 rounded-xl p-3 font-mono font-bold text-lg outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                    placeholder="0"
                  />
                  <div className="text-[11px] text-amber-700/80">
                    Editable — pre-filled from the default interval. Adjust for the oil grade actually used (e.g. synthetic ~12,000 km, conventional ~5,000 km).
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        <div className="p-5 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button onClick={() => setState({ ...state, isOpen: false })} className="px-6 py-2.5 font-bold text-slate-500">Cancel</button>
          <button onClick={onSubmit} className="px-8 py-2.5 font-black text-white bg-green-600 rounded-xl shadow-lg shadow-green-600/20 uppercase tracking-widest text-xs">Save & Close Task</button>
        </div>
      </div>
    </div>
  );
}

import type { Dispatch, SetStateAction } from 'react';
import { PenTool, X, Flag } from 'lucide-react';
import { FleetItem, Employee } from '../types';
import { fleetItemLabel } from '../lib/fleetUtils';

export interface ManualTaskModalState {
  isOpen: boolean;
  unitId: string;
  unitName: string;
  category: string;
  description: string;
  severity: string;
  priority?: boolean;
  // Who reported the repair. Defaults to the enterer; changeable.
  reportedByEmployeeId?: string;
}

interface ManualTaskModalProps {
  state: ManualTaskModalState;
  setState: Dispatch<SetStateAction<ManualTaskModalState>>;
  fleet: FleetItem[];
  employees?: Employee[];
  defaultReporterId?: string;   // the current user's employee id
  onSubmit: () => void | Promise<void>;
}

export default function ManualTaskModal({ state, setState, fleet, employees = [], defaultReporterId, onSubmit }: ManualTaskModalProps) {
  if (!state.isOpen) return null;
  const reporterId = state.reportedByEmployeeId ?? defaultReporterId ?? '';
  const reporters = employees.filter(e => e.status === 'Active');
  return (
    <div className="fixed inset-0 bg-black/60 z-[110] flex md:items-center md:justify-center md:p-4">
      <div className="bg-white md:rounded-2xl shadow-2xl h-full md:h-auto w-full md:max-w-md overflow-hidden flex flex-col animate-in slide-in-from-bottom-8">
        <div className="p-5 border-b border-gray-200 bg-slate-900 text-white flex justify-between items-center">
          <div className="flex items-center gap-3">
            <PenTool className="w-6 h-6 text-lime-400" />
            <h3 className="text-xl font-bold">Report New Repair</h3>
          </div>
          <button onClick={() => setState({ ...state, isOpen: false })} className="text-white/60 hover:text-white transition-colors min-w-[44px] min-h-[44px] inline-flex items-center justify-center"><X className="w-6 h-6" /></button>
        </div>

        <div className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Select Equipment (Optional)</label>
            <select
              className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-lime-400"
              value={state.unitId}
              onChange={e => {
                const unit = fleet.find(f => f.id === e.target.value);
                setState({ ...state, unitId: e.target.value, unitName: unit ? unit.name : '' });
              }}
            >
              <option value="">Other / Not in List</option>
              {fleet.map(f => <option key={f.id} value={f.id}>{fleetItemLabel(f)}</option>)}
            </select>
          </div>

          {!state.unitId && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Equipment Name</label>
              <input
                type="text"
                placeholder="e.g. Red Rake, Custom Trailer"
                className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-lime-400"
                value={state.unitName}
                onChange={e => setState({ ...state, unitName: e.target.value })}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Category / Issue</label>
            <input
              type="text"
              placeholder="e.g. Engine noise, Broken handle"
              className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-lime-400"
              value={state.category}
              onChange={e => setState({ ...state, category: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Severity</label>
            <div className="flex gap-2">
              <button onClick={() => setState({ ...state, severity: 'minor' })} className={`flex-1 py-2 rounded-lg font-bold text-xs uppercase border transition-all ${state.severity === 'minor' ? 'bg-amber-50 border-amber-300 text-amber-700 shadow-sm' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>Minor</button>
              <button onClick={() => setState({ ...state, severity: 'major' })} className={`flex-1 py-2 rounded-lg font-bold text-xs uppercase border transition-all ${state.severity === 'major' ? 'bg-rose-50 border-rose-300 text-rose-700 shadow-sm' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>Major/Safety</button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Description</label>
            <textarea
              rows={3}
              placeholder="Details about the repair needed..."
              className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-lime-400 resize-none"
              value={state.description}
              onChange={e => setState({ ...state, description: e.target.value })}
            />
          </div>

          {reporters.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Reported by</label>
              <select
                className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-lime-400"
                value={reporterId}
                onChange={e => setState({ ...state, reportedByEmployeeId: e.target.value })}
              >
                {!reporters.some(e => e.id === reporterId) && <option value={reporterId}>{reporterId ? '(you)' : '—'}</option>}
                {reporters.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <div className="text-[10px] text-slate-400">Defaults to you — change if filing on someone's behalf.</div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer bg-rose-50 border border-rose-200 px-3 py-2 rounded-xl">
            <input
              type="checkbox"
              checked={!!state.priority}
              onChange={e => setState({ ...state, priority: e.target.checked })}
              className="w-4 h-4 text-rose-600 rounded focus:ring-rose-500"
            />
            <Flag className="w-4 h-4 text-rose-600" /> Mark as Priority
          </label>
        </div>

        <div className="p-5 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button onClick={() => setState({ ...state, isOpen: false })} className="px-6 py-2.5 font-bold text-slate-500 hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
          <button
            disabled={!state.unitName || !state.category}
            onClick={onSubmit}
            className="px-8 py-2.5 font-black text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-lg disabled:opacity-50 transition-all uppercase tracking-widest text-xs"
          >
            Submit Task
          </button>
        </div>
      </div>
    </div>
  );
}

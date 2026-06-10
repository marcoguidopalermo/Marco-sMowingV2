import type { Dispatch, SetStateAction } from 'react';
import { CheckCircle, X } from 'lucide-react';

export interface RepairModalState {
  isOpen: boolean;
  fleetId: null;
  fixNotes: string;
  cost: string;
}

interface RepairModalProps {
  state: RepairModalState;
  setState: Dispatch<SetStateAction<RepairModalState>>;
  onConfirm: () => void;
  // True while the save is in flight — disables the button and shows
  // "Saving…" so a second tap on a slow connection can't double-submit.
  isSubmitting?: boolean;
}

export default function RepairModal({ state, setState, onConfirm, isSubmitting = false }: RepairModalProps) {
  if (!state.isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex md:items-center md:justify-center md:p-4">
      <div className="bg-white md:rounded-2xl shadow-2xl h-full md:h-auto w-full md:max-w-lg overflow-hidden flex flex-col animate-in zoom-in-95">
        <div className="p-5 border-b border-gray-200 bg-green-50 flex justify-between items-center">
          <h2 className="text-xl font-bold flex items-center gap-2 text-green-900"><CheckCircle className="w-6 h-6 text-green-600" /> Log Repair Completion</h2>
          <button onClick={() => setState({ isOpen: false, fleetId: null, fixNotes: '', cost: '' })} className="text-gray-500 hover:text-gray-800 min-w-[44px] min-h-[44px] inline-flex items-center justify-center"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-5 bg-white">
          <div>
            <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-2">What was fixed?</label>
            <textarea rows={3} placeholder="Replaced spark plugs, oil change, greased tracks..." value={state.fixNotes} onChange={e => setState({ ...state, fixNotes: e.target.value })} className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-green-500 resize-none font-medium"></textarea>
          </div>
          <div>
            <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-2">Cost of Parts / Outsourced Labor ($)</label>
            <input type="number" placeholder="0.00" value={state.cost} onChange={e => setState({ ...state, cost: e.target.value })} className="w-full border border-gray-300 rounded-lg p-3 font-mono font-bold text-lg outline-none focus:ring-2 focus:ring-green-500" />
          </div>
        </div>
        <div className="p-5 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
          <button onClick={() => setState({ isOpen: false, fleetId: null, fixNotes: '', cost: '' })} disabled={isSubmitting} className="px-5 py-2.5 font-bold text-gray-600 hover:bg-gray-200 rounded-lg disabled:opacity-50">Cancel</button>
          <button onClick={onConfirm} disabled={isSubmitting} className="px-6 py-2.5 font-bold text-white bg-green-600 hover:bg-green-700 rounded-lg shadow disabled:opacity-60 disabled:cursor-not-allowed">{isSubmitting ? 'Saving…' : 'Save to Repair Log'}</button>
        </div>
      </div>
    </div>
  );
}

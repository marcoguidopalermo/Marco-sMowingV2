import { useEffect, useState } from 'react';
import { X, Package } from 'lucide-react';
import { FleetItem } from '../types';
import { fleetItemLabel } from '../lib/fleetUtils';

export interface RequestPartsModalState {
  isOpen: boolean;
  // When set, the form's unit field starts populated and locked to this
  // unit (the green "Request Parts" button on a repair card). When null,
  // the form acts as a generic request — the user can pick any unit or
  // leave it blank.
  preFillUnitId?: string;
  preFillUnitName?: string;
  // If opened from a repair card, the resulting partsOrder will carry
  // this id so the linkage drives sort + wrench-icon color on the card.
  repairId?: string;
}

export interface RequestPartsSubmit {
  partName: string;
  quantity: number;
  unitId?: string;
  unitName?: string;
  notes?: string;
  repairId?: string;
}

interface RequestPartsModalProps {
  state: RequestPartsModalState;
  onClose: () => void;
  onSubmit: (payload: RequestPartsSubmit) => void | Promise<void>;
  fleet: FleetItem[];
}

export default function RequestPartsModal({ state, onClose, onSubmit, fleet }: RequestPartsModalProps) {
  const [partName, setPartName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitId, setUnitId] = useState('');
  const [unitName, setUnitName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Reset form on open. When the modal opens from a repair card, the
  // unit fields are pre-filled and locked; when opened from the top
  // generic button, they start blank and the user picks (or leaves
  // blank for generic supplies).
  useEffect(() => {
    if (!state.isOpen) return;
    setPartName('');
    setQuantity('1');
    setUnitId(state.preFillUnitId || '');
    setUnitName(state.preFillUnitName || '');
    setNotes('');
    setBusy(false);
  }, [state.isOpen, state.preFillUnitId, state.preFillUnitName]);

  if (!state.isOpen) return null;

  const qtyNum = Number(quantity);
  const partNameValid = partName.trim().length > 0;
  const qtyValid = Number.isFinite(qtyNum) && qtyNum > 0;
  const canSubmit = partNameValid && qtyValid && !busy;
  const isLockedToUnit = !!state.preFillUnitId;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      // If a unitId is set but the unit isn't in the fleet (e.g. user
      // typed a free-text unit on a generic request), keep unitName as
      // the source of truth. Most paths will have unitName from either
      // the prefill or the dropdown selection.
      const payload: RequestPartsSubmit = {
        partName: partName.trim(),
        quantity: qtyNum,
      };
      if (unitId) {
        const f = fleet.find(x => x.id === unitId);
        payload.unitId = unitId;
        payload.unitName = f?.name || unitName || undefined;
      } else if (unitName.trim()) {
        payload.unitName = unitName.trim();
      }
      const trimmedNotes = notes.trim();
      if (trimmedNotes) payload.notes = trimmedNotes;
      if (state.repairId) payload.repairId = state.repairId;
      await onSubmit(payload);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[110] flex md:items-center md:justify-center md:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white md:rounded-2xl shadow-2xl h-full md:h-auto w-full md:max-w-md overflow-hidden flex flex-col">
        <div className="p-5 border-b border-gray-200 bg-slate-900 text-white flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Package className="w-6 h-6 text-amber-400" />
            <h3 className="text-xl font-bold">Request Parts</h3>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white min-w-[44px] min-h-[44px] inline-flex items-center justify-center">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Part Name / Description</label>
            <input
              type="text"
              placeholder="e.g. Brake pad set, hydraulic hose"
              value={partName}
              onChange={e => setPartName(e.target.value)}
              autoFocus
              className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Quantity</label>
            <input
              type="number"
              min={1}
              step={1}
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-400"
            />
            {!qtyValid && quantity !== '' && (
              <div className="text-[11px] text-rose-600 font-bold">Quantity must be a positive number.</div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">
              Unit {isLockedToUnit ? '(from repair)' : '(optional — leave blank for generic supplies)'}
            </label>
            {isLockedToUnit ? (
              <div className="w-full bg-slate-100 border border-slate-200 p-3 rounded-xl text-sm font-bold text-slate-700">
                {unitName || '—'}
              </div>
            ) : (
              <select
                value={unitId}
                onChange={e => {
                  const id = e.target.value;
                  setUnitId(id);
                  const f = fleet.find(x => x.id === id);
                  setUnitName(f?.name || '');
                }}
                className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="">(Generic — no unit)</option>
                {fleet.map(f => <option key={f.id} value={f.id}>{fleetItemLabel(f)}</option>)}
              </select>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Notes (optional)</label>
            <textarea
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Need by Friday, vendor preference, part number"
              className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-amber-400 resize-none"
            />
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 bg-white flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            disabled={busy}
            className="min-h-[44px] px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="min-h-[44px] px-5 py-2.5 text-sm font-black uppercase tracking-widest bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow disabled:bg-slate-300 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            <Package className="w-4 h-4" /> Submit Request
          </button>
        </div>
      </div>
    </div>
  );
}

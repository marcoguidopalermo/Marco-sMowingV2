import { useEffect, useState } from 'react';
import { ShieldCheck, X, AlertTriangle } from 'lucide-react';

interface OverrideModalProps {
  isOpen: boolean;
  title: string;
  warningMessage: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

export default function OverrideModal({ isOpen, title, warningMessage, onConfirm, onClose }: OverrideModalProps) {
  const [reason, setReason] = useState('');

  // Reset reason when modal opens
  useEffect(() => {
    if (isOpen) setReason('');
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex md:items-center md:justify-center md:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col animate-in zoom-in-95">
        <div className="p-5 border-b border-gray-200 bg-slate-900 text-white flex justify-between items-center">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-amber-400" />
            <h3 className="text-lg font-bold">{title}</h3>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white min-w-[44px] min-h-[44px] inline-flex items-center justify-center"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
            <p className="text-xs font-bold text-rose-800 leading-relaxed">{warningMessage}</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Reason (optional)</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this warning being overridden?"
              className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-amber-400 resize-none"
            />
          </div>
          <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wide leading-relaxed">
            This override is per-dispatch only. The warning will reappear on future dispatch attempts.
          </p>
        </div>
        <div className="p-5 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2.5 font-bold text-slate-500 hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
          <button onClick={() => onConfirm(reason)} className="px-6 py-2.5 font-black text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow uppercase tracking-widest text-xs flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> Confirm Override
          </button>
        </div>
      </div>
    </div>
  );
}

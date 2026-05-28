import { useEffect, useState } from 'react';
import { Clock, X } from 'lucide-react';

interface PartialTimeOffModalProps {
  isOpen: boolean;
  employeeName: string;
  dateLabel: string;
  // Existing partial entry for this employee/date, if one is already recorded.
  existing: { start: string; end: string } | null;
  onSave: (start: string, end: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

// Manager/admin entry point for PARTIAL-day time off (e.g. a 1-3 PM
// appointment). Display-only — see PartialTimeOff in types.ts.
export default function PartialTimeOffModal({
  isOpen,
  employeeName,
  dateLabel,
  existing,
  onSave,
  onRemove,
  onClose,
}: PartialTimeOffModalProps) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState('');

  // Pre-fill from any existing entry each time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setStart(existing?.start || '');
      setEnd(existing?.end || '');
      setError('');
    }
  }, [isOpen, existing]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (!start || !end) { setError('Enter both a start and end time.'); return; }
    // "HH:MM" 24-hour strings compare correctly as plain strings.
    if (end <= start) { setError('End time must be after the start time.'); return; }
    onSave(start, end);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex md:items-center md:justify-center md:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col animate-in zoom-in-95">
        <div className="p-5 border-b border-gray-200 bg-amber-500 text-white flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5" />
            <h3 className="text-lg font-bold">Partial Time Off</h3>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white min-w-[44px] min-h-[44px] inline-flex items-center justify-center"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm font-medium text-slate-600">
            <span className="font-bold text-slate-800">{employeeName}</span> — {dateLabel}
          </p>
          <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 leading-relaxed">
            Display only — partial time off does not change budget hours, actual hours, or efficiency. Worked time is tracked by the Jobber time clock.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Start</label>
              <input
                type="time"
                value={start}
                onChange={e => setStart(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">End</label>
              <input
                type="time"
                value={end}
                onChange={e => setEnd(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>
          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </div>
        <div className="p-5 bg-slate-50 border-t border-slate-200 flex justify-between items-center gap-3">
          <div>
            {existing && (
              <button onClick={onRemove} className="px-4 py-2.5 font-bold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors text-sm">
                Remove
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-5 py-2.5 font-bold text-slate-500 hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
            <button onClick={handleSave} className="px-6 py-2.5 font-black text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow uppercase tracking-widest text-xs flex items-center gap-2">
              <Clock className="w-4 h-4" /> Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

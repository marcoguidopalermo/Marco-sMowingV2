import { useEffect, useState } from 'react';
import { X, Plane } from 'lucide-react';
import { TimeOffRequest } from '../types';

export interface RequestTimeOffSubmit {
  type: 'full_day' | 'partial';
  startDate?: string;
  endDate?: string;
  partialDate?: string;
  partialStart?: string;
  partialEnd?: string;
  note?: string;
}

interface RequestTimeOffModalProps {
  isOpen: boolean;
  editingRequest?: TimeOffRequest | null;
  requesterName: string;
  onClose: () => void;
  onSubmit: (data: RequestTimeOffSubmit) => void;
}

export default function RequestTimeOffModal({
  isOpen,
  editingRequest,
  requesterName,
  onClose,
  onSubmit,
}: RequestTimeOffModalProps) {
  const [type, setType] = useState<'full_day' | 'partial'>('full_day');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [partialDate, setPartialDate] = useState('');
  const [partialStart, setPartialStart] = useState('');
  const [partialEnd, setPartialEnd] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    if (editingRequest) {
      setType(editingRequest.type);
      setStartDate(editingRequest.startDate || '');
      setEndDate(editingRequest.endDate || '');
      setPartialDate(editingRequest.partialDate || '');
      setPartialStart(editingRequest.partialStart || '');
      setPartialEnd(editingRequest.partialEnd || '');
      setNote(editingRequest.note || '');
    } else {
      setType('full_day');
      setStartDate('');
      setEndDate('');
      setPartialDate('');
      setPartialStart('');
      setPartialEnd('');
      setNote('');
    }
    setError('');
  }, [isOpen, editingRequest?.id]);

  if (!isOpen) return null;

  const submit = () => {
    if (type === 'full_day') {
      if (!startDate) { setError('Pick a start date.'); return; }
      if (!endDate) { setError('Pick an end date.'); return; }
      if (endDate < startDate) { setError('End date must be on or after start date.'); return; }
      onSubmit({ type: 'full_day', startDate, endDate, note: note.trim() || undefined });
    } else {
      if (!partialDate) { setError('Pick a date.'); return; }
      if (!partialStart || !partialEnd) { setError('Set start and end times.'); return; }
      if (partialEnd <= partialStart) { setError('End time must be after start time.'); return; }
      onSubmit({ type: 'partial', partialDate, partialStart, partialEnd, note: note.trim() || undefined });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Plane className="w-5 h-5 text-sky-600" />
            <h2 className="text-lg font-bold text-slate-800">{editingRequest ? 'Edit time-off request' : 'Request time off'}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="text-[11px] text-slate-500">
            Requesting as <span className="font-bold text-slate-700">{requesterName}</span>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType('full_day')}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border ${type === 'full_day' ? 'bg-sky-100 text-sky-700 border-sky-300' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
            >Full Day(s)</button>
            <button
              type="button"
              onClick={() => setType('partial')}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border ${type === 'partial' ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
            >Partial Day</button>
          </div>

          {type === 'full_day' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Start date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-sky-400"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">End date (inclusive)</label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={e => setEndDate(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-sky-400"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Date</label>
                <input
                  type="date"
                  value={partialDate}
                  onChange={e => setPartialDate(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">From</label>
                  <input
                    type="time"
                    value={partialStart}
                    onChange={e => setPartialStart(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg p-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">To</label>
                  <input
                    type="time"
                    value={partialEnd}
                    onChange={e => setPartialEnd(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg p-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Reason (optional)</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder="Doctor's appointment, vacation, family event…"
              className="w-full border border-slate-300 rounded-lg p-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-sky-400 resize-none"
            />
          </div>

          {error && <div className="text-[12px] font-medium text-rose-600">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <button onClick={onClose} className="text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-200 px-3 py-2 rounded-md">Cancel</button>
          <button onClick={submit} className="text-xs font-black uppercase tracking-widest text-white bg-sky-600 hover:bg-sky-700 px-4 py-2 rounded-md shadow-sm">
            {editingRequest ? 'Save changes' : 'Submit request'}
          </button>
        </div>
      </div>
    </div>
  );
}

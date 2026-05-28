import { Moon, Smile, X, CheckCircle, Lock, Unlock, Info } from 'lucide-react';
import { Crew } from '../types';
import { getDailyJoke, DEFAULT_EOD_REMINDER } from '../constants';

interface EndDayModalProps {
  crew: Crew | null;
  dateString: string;
  reminderText: string | undefined;
  currentUserEmail: string;
  isAdmin: boolean;
  onClose: () => void;
  onConfirmClose: () => void;
  onReopen: () => void;
}

export default function EndDayModal({
  crew,
  dateString,
  reminderText,
  currentUserEmail,
  isAdmin,
  onClose,
  onConfirmClose,
  onReopen,
}: EndDayModalProps) {
  if (!crew) return null;

  const isClosed = !!crew.equipmentClosedAt;
  const reminder = (reminderText && reminderText.trim()) || DEFAULT_EOD_REMINDER;
  const joke = getDailyJoke(dateString);
  const canReopen = isClosed && (crew.equipmentClosedBy === currentUserEmail || isAdmin);
  const closedByName = crew.equipmentClosedByName || crew.equipmentClosedBy || 'Unknown';
  const closedAtDisplay = crew.equipmentClosedAt
    ? new Date(crew.equipmentClosedAt).toLocaleString()
    : '';

  return (
    <div className="fixed inset-0 bg-black/60 z-[95] flex md:items-center md:justify-center md:p-4">
      <div className="bg-white md:rounded-2xl shadow-2xl h-full md:h-auto w-full md:max-w-lg overflow-hidden flex flex-col animate-in zoom-in-95">
        <div className="p-5 border-b border-gray-200 bg-slate-800 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            {isClosed ? <Lock className="w-6 h-6 text-emerald-400" /> : <Moon className="w-6 h-6 text-amber-300" />}
            <div>
              <h2 className="text-xl font-bold">
                {isClosed ? `Re-open ${crew.division} #${crew.crewNumber}?` : `Closing out ${crew.division} #${crew.crewNumber} for the day`}
              </h2>
              <p className="text-[10px] uppercase font-black tracking-widest text-slate-400">{dateString}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors min-w-[44px] min-h-[44px] inline-flex items-center justify-center" aria-label="Close"><X className="w-6 h-6" /></button>
        </div>

        <div className="p-6 space-y-5 bg-slate-50">
          {!isClosed ? (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                <Info className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-amber-800 mb-1">End-of-Day Reminder</div>
                  <p className="text-sm font-medium text-amber-900 leading-relaxed">{reminder}</p>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3">
                <Smile className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-emerald-700 mb-1">Joke of the Day</div>
                  <p className="text-sm font-medium text-slate-700 italic leading-relaxed">{joke}</p>
                </div>
              </div>
            </>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <div className="text-[10px] font-black uppercase tracking-widest text-emerald-800 mb-1">Currently Closed</div>
              <p className="text-sm font-bold text-emerald-900">By {closedByName}</p>
              <p className="text-xs text-emerald-700 mt-0.5">{closedAtDisplay}</p>
              {!canReopen && (
                <p className="text-xs text-slate-500 italic mt-2">Only {closedByName} or an admin can re-open.</p>
              )}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-slate-200 bg-white flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-6 py-2.5 font-bold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
          {!isClosed ? (
            <button
              onClick={onConfirmClose}
              className="px-8 py-2.5 font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-lg shadow-emerald-600/20 uppercase tracking-widest text-xs flex items-center gap-2"
            >
              <CheckCircle className="w-4 h-4" /> Crew is closed for the day
            </button>
          ) : (
            <button
              onClick={onReopen}
              disabled={!canReopen}
              className="px-8 py-2.5 font-black text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg shadow-lg shadow-amber-600/20 uppercase tracking-widest text-xs flex items-center gap-2"
            >
              <Unlock className="w-4 h-4" /> Re-open Crew
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

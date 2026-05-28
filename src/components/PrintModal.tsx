import type { Dispatch, SetStateAction } from 'react';
import { Printer, X, AlertCircle } from 'lucide-react';
import { Crew } from '../types';
import { formatDate } from '../lib/dateUtils';

interface PrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  printType: 'daily' | 'weekly' | 'range';
  setPrintType: Dispatch<SetStateAction<'daily' | 'weekly' | 'range'>>;
  printDateRange: { start: string; end: string };
  setPrintDateRange: Dispatch<SetStateAction<{ start: string; end: string }>>;
  printSelection: string[];
  setPrintSelection: Dispatch<SetStateAction<string[]>>;
  schedules: Record<string, Crew[]>;
  selectedDailyDate: string;
  setSelectedDailyDate: Dispatch<SetStateAction<string>>;
  weekDays: Date[];
  onPrint: () => void;
}

export default function PrintModal({
  isOpen,
  onClose,
  printType,
  setPrintType,
  printDateRange,
  setPrintDateRange,
  printSelection,
  setPrintSelection,
  schedules,
  selectedDailyDate,
  setSelectedDailyDate,
  weekDays,
  onPrint,
}: PrintModalProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-[70] flex md:items-center md:justify-center md:p-4">
      <div className="bg-white md:rounded-2xl shadow-2xl h-full md:h-auto w-full md:max-w-2xl overflow-hidden flex flex-col animate-in zoom-in-95">
        <div className="p-5 border-b border-gray-200 bg-slate-800 text-white flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Printer className="w-6 h-6 text-green-400" />
            <div>
              <h2 className="text-xl font-bold">Print Schedule Manager</h2>
              <p className="text-[10px] uppercase font-black tracking-widest text-slate-400">Select crews and options for professional printing</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors min-w-[44px] min-h-[44px] inline-flex items-center justify-center"><X className="w-6 h-6" /></button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-6">
          <div className="flex gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
            <button onClick={() => setPrintType('daily')} className={`flex-1 py-2.5 rounded-lg font-black uppercase text-[10px] tracking-widest transition-all ${printType === 'daily' ? 'bg-white shadow-sm text-green-600' : 'text-slate-400 hover:text-slate-600'}`}>Daily</button>
            <button onClick={() => setPrintType('weekly')} className={`flex-1 py-2.5 rounded-lg font-black uppercase text-[10px] tracking-widest transition-all ${printType === 'weekly' ? 'bg-white shadow-sm text-green-600' : 'text-slate-400 hover:text-slate-600'}`}>Weekly</button>
            <button onClick={() => setPrintType('range')} className={`flex-1 py-2.5 rounded-lg font-black uppercase text-[10px] tracking-widest transition-all ${printType === 'range' ? 'bg-white shadow-sm text-green-600' : 'text-slate-400 hover:text-slate-600'}`}>Date Range</button>
          </div>

          {printType === 'daily' && (
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <label className="text-[10px] font-black text-slate-400 uppercase mb-1 block">Print Schedule For</label>
              <input
                type="date"
                value={selectedDailyDate}
                onChange={e => { setSelectedDailyDate(e.target.value); setPrintSelection([]); }}
                className="w-full bg-white border border-slate-200 p-2 rounded-lg text-sm font-bold outline-none"
              />
            </div>
          )}

          {printType === 'range' && (
            <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase mb-1 block">Start Date</label>
                <input type="date" value={printDateRange.start} onChange={e => setPrintDateRange({ ...printDateRange, start: e.target.value })} className="w-full bg-white border border-slate-200 p-2 rounded-lg text-sm font-bold outline-none" />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase mb-1 block">End Date</label>
                <input type="date" value={printDateRange.end} onChange={e => setPrintDateRange({ ...printDateRange, end: e.target.value })} className="w-full bg-white border border-slate-200 p-2 rounded-lg text-sm font-bold outline-none" />
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Select Crews to Include</h4>
              <div className="flex gap-3">
                <button onClick={() => {
                  const allIds: string[] = [];
                  if (printType === 'daily') { (schedules[selectedDailyDate] || []).forEach(c => allIds.push(c.id)); }
                  else if (printType === 'weekly') { weekDays.forEach(d => (schedules[formatDate(d)] || []).forEach(c => allIds.push(c.id))); }
                  else {
                    const start = new Date(printDateRange.start);
                    const end = new Date(printDateRange.end);
                    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                      (schedules[formatDate(d)] || []).forEach(c => allIds.push(c.id));
                    }
                  }
                  setPrintSelection(Array.from(new Set(allIds)));
                }} className="text-[10px] font-bold text-green-600 hover:underline">Select All</button>
                <button onClick={() => setPrintSelection([])} className="text-[10px] font-bold text-slate-400 hover:underline">Clear All</button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {(() => {
                const availableCrews: any[] = [];
                if (printType === 'daily') { (schedules[selectedDailyDate] || []).forEach(c => availableCrews.push({ ...c, dateStr: selectedDailyDate })); }
                else if (printType === 'weekly') { weekDays.forEach(d => { const ds = formatDate(d); (schedules[ds] || []).forEach(c => availableCrews.push({ ...c, dateStr: ds })); }); }
                else {
                  const start = new Date(printDateRange.start);
                  const end = new Date(printDateRange.end);
                  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                    const ds = formatDate(d);
                    (schedules[ds] || []).forEach(c => availableCrews.push({ ...c, dateStr: ds }));
                  }
                }

                if (availableCrews.length === 0) return <div className="col-span-2 py-8 text-center text-slate-400 italic font-medium">No crews available to print for this selection.</div>;

                return availableCrews.map(crew => (
                  <label key={`${crew.dateStr}-${crew.id}`} className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${printSelection.includes(crew.id) ? 'bg-green-50 border-green-200' : 'bg-white border-slate-200 hover:bg-slate-50'}`}>
                    <input type="checkbox" checked={printSelection.includes(crew.id)} onChange={e => { if (e.target.checked) setPrintSelection([...printSelection, crew.id]); else setPrintSelection(printSelection.filter(id => id !== crew.id)); }} className="w-5 h-5 rounded border-slate-300 text-green-600 focus:ring-green-500" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-black text-slate-800 truncate">{crew.division} #{crew.crewNumber}</div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{crew.dateStr}</div>
                    </div>
                  </label>
                ));
              })()}
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
            <p className="text-[11px] font-bold text-amber-800 leading-relaxed uppercase">The printout will include Date, Personnel, Equipment, Inventory, and Tools/Supplies for each selected crew on a professional layout.</p>
          </div>
        </div>

        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2.5 font-bold text-slate-500 hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
          <button onClick={onPrint} disabled={printSelection.length === 0} className="px-8 py-2.5 font-black text-white bg-green-600 hover:bg-green-700 rounded-lg shadow-lg shadow-green-600/20 disabled:opacity-50 transition-all flex items-center gap-2 uppercase tracking-widest text-xs"><Printer className="w-4 h-4" /> Generate Printout</button>
        </div>
      </div>
    </div>
  );
}

import { FileSignature, X, CheckCircle, AlertCircle } from 'lucide-react';
import { Inspection, FleetItem } from '../types';

interface InspectionReportModalProps {
  inspectionId: string | null;
  onClose: () => void;
  inspections: Inspection[];
  fleet: FleetItem[];
}

export default function InspectionReportModal({ inspectionId, onClose, inspections, fleet }: InspectionReportModalProps) {
  if (!inspectionId) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-[90] flex md:items-center md:justify-center md:p-4">
      {(() => {
        const insp = inspections.find(i => i.id === inspectionId);
        if (!insp) return null;
        const unit = fleet.find(f => f.id === insp.unitId);

        return (
          <div className="bg-white md:rounded-2xl shadow-2xl h-full md:h-auto w-full md:max-w-lg overflow-hidden flex flex-col animate-in slide-in-from-bottom-4">
            <div className="p-5 border-b border-gray-200 bg-slate-900 text-white flex justify-between items-center">
              <div className="flex items-center gap-3">
                <FileSignature className="w-6 h-6 text-lime-400" />
                <div>
                  <h2 className="text-xl font-bold">Inspection Report</h2>
                  <p className="text-[10px] uppercase font-black tracking-widest text-slate-400">{insp.type} • {insp.date}</p>
                </div>
              </div>
              <button onClick={onClose} className="text-white/60 hover:text-white transition-colors min-w-[44px] min-h-[44px] inline-flex items-center justify-center"><X className="w-6 h-6" /></button>
            </div>

            <div className="p-8 space-y-8 bg-white overflow-y-auto max-h-[70vh]">
              <div className="grid grid-cols-2 gap-8 border-b border-slate-100 pb-6">
                <div>
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Vehicle / Unit</h4>
                  <p className="text-lg font-black text-slate-800">{unit?.name || 'Unknown'}</p>
                  <p className="text-xs font-bold text-slate-500 uppercase">{unit?.type}</p>
                </div>
                <div className="text-right">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Driver</h4>
                  <p className="text-lg font-black text-slate-800">{insp.driverName}</p>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">{new Date(insp.timestamp).toLocaleTimeString()}</p>
                </div>
              </div>

              <div className={`grid ${insp.type === 'Trailer' ? 'grid-cols-1' : 'grid-cols-2'} gap-8`}>
                {insp.type !== 'Trailer' && (
                  <div>
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Odometer</h4>
                    <p className="text-xl font-mono font-black text-slate-800">{insp.odometer.toLocaleString()}</p>
                  </div>
                )}
                <div>
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Location</h4>
                  <p className="text-sm font-bold text-slate-800">{insp.location || 'Not Specified'}</p>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">Defects Found</h4>
                {insp.defects.length === 0 ? (
                  <div className="flex items-center gap-2 text-green-600 bg-green-50 p-4 rounded-xl border border-green-100">
                    <CheckCircle className="w-5 h-5" />
                    <span className="text-sm font-black uppercase tracking-widest">No Defects Reported</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {insp.defects.map(d => (
                      <div key={d.category} className="flex flex-col gap-1 p-3 bg-rose-50 border border-rose-100 rounded-xl">
                        <div className="flex items-center gap-2">
                          <AlertCircle className={`w-4 h-4 ${d.severity === 'major' ? 'text-rose-600' : 'text-amber-600'}`} />
                          <span className="text-sm font-black text-rose-900 uppercase">{d.category}</span>
                          <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${d.severity === 'major' ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-700'}`}>{d.severity}</span>
                        </div>
                        {d.notes && <p className="text-xs font-medium text-rose-800 italic ml-6">"{d.notes}"</p>}
                      </div>
                    ))}
                    {insp.isMajor && (
                      <div className="bg-rose-600 text-white p-3 rounded-xl text-center text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-rose-200 mt-4">
                         Priority: Major Safety Defect
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="pt-6 border-t border-slate-100">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Driver Signature</h4>
                <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 text-center">
                  <p className="text-2xl font-medium italic text-slate-800 tracking-tighter" style={{ fontFamily: 'Dancing Script, cursive' }}>{insp.signature}</p>
                  <div className="h-0.5 w-48 bg-slate-300 mx-auto mt-2" />
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-2">Digitally Signed & Verified</p>
                </div>
              </div>
            </div>

            <div className="p-5 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button onClick={onClose} className="px-8 py-2.5 bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-slate-800 transition-colors shadow-lg">Close Report</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

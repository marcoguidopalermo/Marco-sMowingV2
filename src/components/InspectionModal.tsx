import type { Dispatch, SetStateAction } from 'react';
import { ShieldCheck, X, ChevronUp, ChevronDown, AlertTriangle, CheckCircle } from 'lucide-react';
import { DefectDetail, FleetItem } from '../types';
import { DVIR_DEFECTS, CIRCLE_CHECK_DEFECTS, TRAILER_DEFECTS } from '../constants';
import { getRequiredInspectionType } from '../lib/inspectionUtils';

export interface ActiveInspectionState {
  unitId: string | null;
  targetDate: string;
  defects: DefectDetail[];
  expandedCategory: string | null;
  draftSeverity: 'minor' | 'major';
  draftNotes: string;
}

interface InspectionModalProps {
  state: ActiveInspectionState;
  setState: Dispatch<SetStateAction<ActiveInspectionState>>;
  fleet: FleetItem[];
  onSubmit: (unit: FleetItem, type: 'DVIR' | 'CircleCheck' | 'Trailer') => void | Promise<void>;
  showToastMsg: (msg: string) => void;
}

export default function InspectionModal({ state: activeInspection, setState: setActiveInspection, fleet, onSubmit, showToastMsg }: InspectionModalProps) {
  if (!activeInspection.unitId) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-[80] flex md:items-center md:justify-center md:p-4">
      {(() => {
        const unit = fleet.find(f => f.id === activeInspection.unitId);
        if (!unit) return null;
        const type = getRequiredInspectionType(unit);
        const categories = type === 'DVIR' ? DVIR_DEFECTS : type === 'CircleCheck' ? CIRCLE_CHECK_DEFECTS : TRAILER_DEFECTS;

        return (
          <div className="bg-white md:rounded-2xl shadow-2xl h-full md:h-auto w-full md:max-w-xl overflow-hidden flex flex-col animate-in zoom-in-95 md:max-h-[90vh]">
            <div className="p-5 border-b border-gray-200 bg-slate-800 text-white flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                <ShieldCheck className={`w-6 h-6 ${type === 'DVIR' ? 'text-blue-400' : type === 'CircleCheck' ? 'text-green-400' : 'text-teal-400'}`} />
                <div>
                  <h2 className="text-xl font-bold">{type === 'DVIR' ? 'Formal DVIR (Schedule 1)' : type === 'CircleCheck' ? 'Company Circle Check' : 'Trailer Inspection'}</h2>
                  <p className="text-[10px] uppercase font-black tracking-widest text-slate-400">Unit: {unit.name} • {unit.type}</p>
                </div>
              </div>
              <button onClick={() => setActiveInspection({ unitId: null, targetDate: '', defects: [], expandedCategory: null, draftSeverity: 'minor', draftNotes: '' })} className="text-white/60 hover:text-white transition-colors min-w-[44px] min-h-[44px] inline-flex items-center justify-center"><X className="w-6 h-6" /></button>
            </div>

            <div className="p-6 overflow-y-auto space-y-8 bg-slate-50 flex-1">
              <div className={`grid ${type === 'Trailer' ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>
                {type !== 'Trailer' && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Odometer Reading</label>
                    <input type="number" id="insp-odo" className="w-full border border-slate-300 rounded-xl p-3 font-mono font-bold text-lg outline-none focus:ring-2 focus:ring-slate-800" defaultValue={unit.odometer || 0} />
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Location</label>
                  <input type="text" id="insp-loc" className="w-full border border-slate-300 rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-800" placeholder="e.g. Shop / Site" />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-black uppercase tracking-widest text-slate-800">Safety Checklist</h3>
                  <button
                    onClick={() => {
                      if (activeInspection.defects.length > 0) {
                        if (!confirm("This will clear all reported defects. Proceed?")) return;
                      }
                      setActiveInspection({ ...activeInspection, defects: [], expandedCategory: null });
                      showToastMsg("All items marked clear.");
                      // Focus signature field
                      setTimeout(() => {
                        const sigField = document.getElementById('insp-sig');
                        if (sigField) {
                          sigField.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          sigField.focus();
                        }
                      }, 500);
                    }}
                    className="text-[10px] font-black bg-green-50 text-green-700 px-3 py-1.5 rounded-lg border border-green-200 hover:bg-green-100 transition-all uppercase tracking-widest"
                  >
                    No defects found — mark all clear
                  </button>
                </div>

                <div className="space-y-2">
                  {categories.map(cat => {
                    const existingDefect = activeInspection.defects.find(d => d.category === cat);
                    const isExpanded = activeInspection.expandedCategory === cat;

                    return (
                      <div key={cat} className={`bg-white border rounded-xl overflow-hidden transition-all ${existingDefect ? 'border-rose-300 ring-1 ring-rose-100' : 'border-slate-200 shadow-sm'}`}>
                        <button
                          onClick={() => {
                            if (isExpanded) {
                              setActiveInspection({ ...activeInspection, expandedCategory: null });
                            } else {
                              setActiveInspection({
                                ...activeInspection,
                                expandedCategory: cat,
                                draftSeverity: existingDefect?.severity || 'minor',
                                draftNotes: existingDefect?.notes || ''
                              });
                            }
                          }}
                          className="w-full p-4 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-2.5 h-2.5 rounded-full ${existingDefect ? (existingDefect.severity === 'major' ? 'bg-rose-500' : 'bg-amber-500') : 'bg-slate-200'}`} />
                            <span className={`text-sm font-bold ${existingDefect ? 'text-rose-900' : 'text-slate-700'}`}>{cat}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {existingDefect && <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${existingDefect.severity === 'major' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{existingDefect.severity}</span>}
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="p-4 border-t border-slate-100 bg-slate-50 space-y-4 animate-in slide-in-from-top-2">
                            <div className="space-y-2">
                              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Severity Level</label>
                              <div className="flex bg-white p-1 rounded-xl border border-slate-200">
                                <button
                                  onClick={() => setActiveInspection({ ...activeInspection, draftSeverity: 'minor' })}
                                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${activeInspection.draftSeverity === 'minor' ? 'bg-amber-100 text-amber-800' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                  Minor Defect
                                </button>
                                <button
                                  onClick={() => {
                                    if (confirm("Reporting a MAJOR DEFECT will ground this vehicle immediately. Are you sure?")) {
                                      setActiveInspection({ ...activeInspection, draftSeverity: 'major' });
                                    }
                                  }}
                                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${activeInspection.draftSeverity === 'major' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                  Major Defect
                                </button>
                              </div>
                            </div>

                            {activeInspection.draftSeverity === 'major' && (
                              <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl flex items-start gap-2 animate-in fade-in">
                                <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5" />
                                <p className="text-[10px] font-bold text-rose-800 leading-relaxed uppercase">Selecting this will mark the unit as **OUT OF SERVICE** and notify the mechanic and operations manager.</p>
                              </div>
                            )}

                            <div className="space-y-2">
                              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Defect Notes</label>
                              <textarea
                                className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm font-medium outline-none focus:ring-2 focus:ring-slate-800 resize-none"
                                placeholder="Describe the issue..."
                                rows={2}
                                value={activeInspection.draftNotes}
                                onChange={e => setActiveInspection({ ...activeInspection, draftNotes: e.target.value })}
                              />
                            </div>

                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  const newDefects = activeInspection.defects.filter(d => d.category !== cat);
                                  setActiveInspection({ ...activeInspection, defects: newDefects, expandedCategory: null });
                                }}
                                className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-rose-600 transition-colors"
                              >
                                Clear
                              </button>
                              <button
                                onClick={() => {
                                  const newDefect: DefectDetail = {
                                    category: cat,
                                    severity: activeInspection.draftSeverity,
                                    notes: activeInspection.draftNotes
                                  };
                                  const newDefects = [...activeInspection.defects.filter(d => d.category !== cat), newDefect];
                                  setActiveInspection({ ...activeInspection, defects: newDefects, expandedCategory: null });
                                }}
                                className="flex-1 bg-slate-800 text-white py-2 rounded-lg text-xs font-black uppercase tracking-widest shadow-md hover:bg-slate-900 transition-all"
                              >
                                Save Defect
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>



              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Driver Confirmation</label>
                <input type="text" id="insp-sig" className="w-full border-b-2 border-slate-300 bg-transparent p-3 text-xl font-medium outline-none italic placeholder:text-slate-200" placeholder="Type name to sign..." />
              </div>
            </div>

            <div className="p-5 border-t border-gray-200 bg-white flex justify-end gap-3 shrink-0">
              <button onClick={() => setActiveInspection({ unitId: null, targetDate: '', defects: [], expandedCategory: null, draftSeverity: 'minor', draftNotes: '' })} className="px-6 py-2.5 font-bold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
              <button
                onClick={() => onSubmit(unit, type)}
                className={`px-8 py-2.5 font-black text-white rounded-lg shadow-lg transition-all uppercase tracking-widest text-xs flex items-center gap-2 ${type === 'DVIR' ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20' : type === 'CircleCheck' ? 'bg-green-600 hover:bg-green-700 shadow-green-600/20' : 'bg-teal-600 hover:bg-teal-700 shadow-teal-600/20'}`}
              >
                <CheckCircle className="w-4 h-4" /> Submit Report
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

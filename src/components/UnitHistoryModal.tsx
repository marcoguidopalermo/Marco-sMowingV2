import { useState } from 'react';
import { BookOpen, X, MessageSquare, FileSignature, Send, ShieldCheck } from 'lucide-react';
import { FleetItem, Inspection } from '../types';
import { weightBandLabel } from '../lib/fleetUtils';

function relativeTimeShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

interface UnitHistoryModalProps {
  unit: FleetItem | null;
  inspections: Inspection[];
  currentUserEmail: string;
  isAdmin: boolean;
  onClose: () => void;
  onAddNote: (text: string) => void;
  onDeleteNote: (noteId: string) => void;
  onViewInspection: (inspectionId: string) => void;
}

export default function UnitHistoryModal({
  unit,
  inspections,
  currentUserEmail,
  isAdmin,
  onClose,
  onAddNote,
  onDeleteNote,
  onViewInspection,
}: UnitHistoryModalProps) {
  const [draft, setDraft] = useState('');

  if (!unit) return null;

  const notes = [...(Array.isArray(unit.notes) ? unit.notes : [])].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const unitInspections = inspections
    .filter(i => i.unitId === unit.id)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const submitNote = () => {
    if (!draft.trim()) return;
    onAddNote(draft);
    setDraft('');
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[90] flex md:items-center md:justify-center md:p-4">
      <div className="bg-white md:rounded-2xl shadow-2xl h-full md:h-auto w-full md:max-w-2xl overflow-hidden flex flex-col animate-in zoom-in-95 md:max-h-[90vh]">
        <div className="p-5 border-b border-gray-200 bg-slate-800 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-emerald-400" />
            <div>
              <h2 className="text-xl font-bold">{unit.name} History</h2>
              <p className="text-[10px] uppercase font-black tracking-widest text-slate-400">{unit.type} • {weightBandLabel(unit) || unit.weightClass}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors min-w-[44px] min-h-[44px] inline-flex items-center justify-center" aria-label="Close"><X className="w-6 h-6" /></button>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50">
          <section className="p-6 border-b border-slate-200 bg-white">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-800 flex items-center gap-2"><MessageSquare className="w-4 h-4 text-emerald-600" /> Notes</h3>
              <span className="text-[10px] font-bold text-slate-400">{notes.length} total</span>
            </div>

            <div className="space-y-2">
              {notes.length === 0 && (
                <p className="text-xs italic text-slate-400 py-3">No notes yet — add the first one.</p>
              )}
              {notes.map(n => {
                const canDelete = n.author === currentUserEmail || isAdmin;
                return (
                  <div key={n.id} className="bg-slate-50 border border-slate-100 rounded-lg p-3">
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-black text-slate-700">{n.authorName || n.author}</span>
                        <span className="text-[10px] text-slate-400"> · {relativeTimeShort(n.timestamp)}</span>
                      </div>
                      {canDelete && (
                        <button
                          onClick={() => onDeleteNote(n.id)}
                          className="text-slate-300 hover:text-rose-500 shrink-0"
                          title="Delete note"
                          aria-label="Delete note"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-slate-700 font-medium mt-1 whitespace-pre-wrap">{n.text}</p>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <input
                type="text"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitNote(); } }}
                placeholder="Add a note about this unit..."
                className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-400"
              />
              <button
                onClick={submitNote}
                disabled={!draft.trim()}
                className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-colors"
              >
                <Send className="w-3.5 h-3.5" /> Add Note
              </button>
            </div>
          </section>

          <section className="p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-800 flex items-center gap-2"><FileSignature className="w-4 h-4 text-blue-600" /> Inspection History</h3>
              <span className="text-[10px] font-bold text-slate-400">{unitInspections.length} on record</span>
            </div>

            {unitInspections.length === 0 ? (
              <p className="text-xs italic text-slate-400 py-3">No inspections recorded.</p>
            ) : (
              <div className="space-y-2">
                {unitInspections.map(insp => {
                  const minorCount = insp.defects.filter(d => d.severity === 'minor').length;
                  const majorCount = insp.defects.filter(d => d.severity === 'major').length;
                  const statusColor =
                    insp.status === 'major' ? 'bg-rose-50 border-rose-200 text-rose-800'
                    : insp.status === 'minor' ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800';
                  const typeColor =
                    insp.type === 'DVIR' ? 'text-blue-600'
                    : insp.type === 'CircleCheck' ? 'text-green-600'
                    : 'text-teal-600';
                  return (
                    <button
                      key={insp.id}
                      onClick={() => onViewInspection(insp.id)}
                      className="w-full text-left bg-white border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all rounded-lg p-3 flex items-center gap-3"
                    >
                      <ShieldCheck className={`w-5 h-5 shrink-0 ${typeColor}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-black text-slate-800">{insp.date}</span>
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{insp.type}</span>
                          <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded border ${statusColor}`}>{insp.status}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                          By {insp.inspectorName || insp.driverName || 'Unknown'}
                          {(minorCount > 0 || majorCount > 0) && (
                            <span className="text-slate-400"> · {minorCount} minor / {majorCount} major</span>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-300 shrink-0">View →</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="p-4 border-t border-slate-200 bg-white flex justify-end shrink-0">
          <button onClick={onClose} className="px-6 py-2 font-bold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

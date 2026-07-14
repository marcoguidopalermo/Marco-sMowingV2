import { useMemo, useRef, useState } from 'react';
import { X, FileText, Camera, ImagePlus, Loader2, Trash2, Wrench, ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react';
import type { FleetItem, FleetDocument, FleetDocType } from '../types';
import { uploadFile, deleteFile } from '../lib/storage';
import { DOC_TYPES, docTypeLabel, docExpiryState, groupDocsByType } from '../lib/fleetDocuments';
import { isKmMaintenanceUnit, isHourMaintenanceUnit } from '../lib/maintenanceUtils';
import PhotoViewer from './PhotoViewer';

interface Props {
  unit: FleetItem;
  repairLog: any[];
  canEdit: boolean;
  uploadedBy: { email: string; name: string };
  onSave: (unitId: string, documents: FleetDocument[]) => void;
  onClose: () => void;
}

const expiryChip = (state: ReturnType<typeof docExpiryState>) => {
  if (state === 'expired') return { cls: 'bg-red-100 text-red-700 border-red-300', label: 'Expired' };
  if (state === 'expiring') return { cls: 'bg-amber-100 text-amber-700 border-amber-300', label: 'Expiring soon' };
  if (state === 'ok') return { cls: 'bg-emerald-100 text-emerald-700 border-emerald-300', label: 'Valid' };
  return null;
};

export default function UnitDocumentsModal({ unit, repairLog, canEdit, uploadedBy, onSave, onClose }: Props) {
  const docs = unit.documents || [];
  const grouped = useMemo(() => groupDocsByType(docs), [docs]);
  const [uploadType, setUploadType] = useState<FleetDocType>('registration');
  const [uploadExpiry, setUploadExpiry] = useState('');
  const [uploadLabel, setUploadLabel] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ files: FleetDocument[]; idx: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const isVin = unit.type === 'truck' || unit.type === 'trailer' || unit.type === 'tractor';
  const service = useMemo(
    () => (repairLog || []).filter(r => r.equipmentId === unit.id).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
    [repairLog, unit.id],
  );

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null); setBusy(true);
    const base = unit.documents || [];   // captured once → no double-append on re-render
    const added: FleetDocument[] = [];
    for (const file of Array.from(files)) {
      try {
        setProgress(0);
        const stored = await uploadFile(`fleet/${unit.id}/${uploadType}`, file, { uploadedBy, onProgress: setProgress });
        const doc: FleetDocument = {
          ...stored,
          docType: uploadType,
          ...(uploadExpiry ? { expiryDate: uploadExpiry } : {}),
          ...(uploadType === 'other' && uploadLabel.trim() ? { label: uploadLabel.trim() } : {}),
        };
        added.push(doc);
        onSave(unit.id, [...base, ...added]);
      } catch (e: any) {
        setError(e?.message || 'Upload failed.');
      }
    }
    setBusy(false); setProgress(null); setUploadExpiry(''); setUploadLabel('');
  };

  const removeDoc = async (doc: FleetDocument) => {
    onSave(unit.id, (unit.documents || []).filter(d => d.path !== doc.path));
    try { await deleteFile(doc.path); } catch { /* metadata already dropped */ }
  };
  const patchDoc = (path: string, fields: Partial<FleetDocument>) =>
    onSave(unit.id, (unit.documents || []).map(d => (d.path === path ? { ...d, ...fields } : d)));

  return (
    <div className="fixed inset-0 bg-black/60 z-[120] flex md:items-center md:justify-center md:p-4" onClick={onClose}>
      <div className="bg-white md:rounded-2xl shadow-2xl h-[100dvh] md:h-auto md:max-h-[92dvh] w-full md:max-w-lg overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 bg-slate-900 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <FileText className="w-6 h-6 text-sky-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-lg font-bold truncate">{unit.name}</h3>
              <div className="text-[11px] text-white/60 uppercase tracking-widest">{unit.type} · Documents</div>
            </div>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white min-w-[44px] min-h-[44px] inline-flex items-center justify-center"><X className="w-6 h-6" /></button>
        </div>

        <div className="p-4 space-y-4 flex-1 min-h-0 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
          {/* Unit info — plate / VIN / mileage or hours + last-updated stamp. */}
          <div className="grid grid-cols-2 gap-2 text-sm bg-slate-50 border border-slate-200 rounded-xl p-3">
            <Info label="Plate" value={unit.plateNumber} />
            <Info label={isVin ? 'VIN' : 'Serial'} value={unit.serialNumber} />
            {isKmMaintenanceUnit(unit) && (
              <Info label="Mileage (km)" value={unit.odometer != null ? Number(unit.odometer).toLocaleString() : undefined} sub={unit.lastOdometerUpdate ? `updated ${unit.lastOdometerUpdate}` : 'not set'} />
            )}
            {isHourMaintenanceUnit(unit) && (
              <Info label="Engine hours" value={unit.currentEngineHours != null ? String(unit.currentEngineHours) : undefined} sub={unit.lastHourUpdateAt ? `updated ${new Date(unit.lastHourUpdateAt).toISOString().slice(0, 10)}` : 'not set'} />
            )}
            <Info label="Unit #" value={typeof unit.unitNumber === 'number' ? String(unit.unitNumber) : undefined} />
          </div>

          {/* Documents grouped by type, current-first with expiry badges. */}
          {DOC_TYPES.map(t => {
            const list = grouped[t.key];
            if (list.length === 0 && !canEdit) return null;
            return (
              <div key={t.key} className="space-y-1.5">
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">{t.label}</div>
                {list.length === 0 ? (
                  <div className="text-xs text-slate-400 italic">None uploaded.</div>
                ) : (
                  <ul className="space-y-1.5">
                    {list.map((doc, i) => {
                      const st = docExpiryState(doc);
                      const chip = expiryChip(st);
                      return (
                        <li key={doc.path} className={`border rounded-lg p-2 ${st === 'expired' ? 'border-red-200 bg-red-50/40' : st === 'expiring' ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => setViewer({ files: list, idx: i })} className="w-11 h-11 rounded overflow-hidden border border-slate-200 bg-slate-50 shrink-0" title="View">
                              {doc.kind === 'pdf'
                                ? <span className="w-full h-full flex items-center justify-center"><FileText className="w-5 h-5 text-slate-400" /></span>
                                : <img src={doc.url} alt={doc.name} className="w-full h-full object-cover" />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-bold text-slate-700 truncate">{docTypeLabel(doc)}</div>
                              <div className="text-[10px] text-slate-400 truncate">{doc.name} · {(doc.size / 1024).toFixed(0)} KB</div>
                              {chip && <span className={`inline-block mt-0.5 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${chip.cls}`}>{chip.label}{doc.expiryDate ? ` · ${doc.expiryDate}` : ''}</span>}
                            </div>
                            {canEdit && (
                              <button type="button" onClick={() => removeDoc(doc)} title="Delete document" className="text-slate-300 hover:text-red-500 shrink-0 min-w-[36px] min-h-[36px] inline-flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
                            )}
                          </div>
                          {canEdit && (
                            <div className="flex flex-wrap items-center gap-2 mt-1.5 pl-[52px]">
                              <label className="text-[10px] font-bold text-slate-500 flex items-center gap-1">
                                Expiry
                                <input type="date" value={doc.expiryDate || ''} onChange={e => patchDoc(doc.path, { expiryDate: e.target.value || undefined })} className="border border-slate-200 rounded px-1.5 py-0.5 text-[11px]" />
                              </label>
                              {doc.docType === 'other' && (
                                <input type="text" placeholder="Label" value={doc.label || ''} onChange={e => patchDoc(doc.path, { label: e.target.value })} className="border border-slate-200 rounded px-1.5 py-0.5 text-[11px] flex-1 min-w-[100px]" />
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}

          {/* Upload control — admin/manager only. */}
          {canEdit && (
            <div className="border border-dashed border-slate-300 rounded-xl p-3 space-y-2 bg-slate-50">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Add document</div>
              <div className="flex flex-wrap gap-2">
                <select value={uploadType} onChange={e => setUploadType(e.target.value as FleetDocType)} className="border border-slate-200 rounded-lg px-2 py-2 text-sm font-bold bg-white">
                  {DOC_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
                <label className="text-xs font-bold text-slate-500 flex items-center gap-1">
                  Expiry
                  <input type="date" value={uploadExpiry} onChange={e => setUploadExpiry(e.target.value)} className="border border-slate-200 rounded px-1.5 py-1 text-[11px]" />
                </label>
                {uploadType === 'other' && (
                  <input type="text" placeholder="Label" value={uploadLabel} onChange={e => setUploadLabel(e.target.value)} className="border border-slate-200 rounded px-2 py-1 text-xs flex-1 min-w-[120px]" />
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => cameraRef.current?.click()} disabled={busy} className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-50">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />} Take photo
                </button>
                <button type="button" onClick={() => libraryRef.current?.click()} disabled={busy} className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-black uppercase tracking-widest hover:bg-slate-100 disabled:opacity-50">
                  <ImagePlus className="w-4 h-4" /> Choose file
                </button>
              </div>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
              <input ref={libraryRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
              {busy && progress !== null && <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} /></div>}
              {busy && <div className="text-[11px] text-slate-500">Uploading… {progress ?? 0}%</div>}
              {error && <div className="text-[11px] font-bold text-rose-600">{error}</div>}
            </div>
          )}

          {!canEdit && docs.length === 0 && (
            <div className="text-sm text-slate-400 italic flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> No documents on file for this unit.</div>
          )}

          {/* Service history — the existing repair log, filtered to this unit. */}
          <div className="border-t border-slate-100 pt-3">
            <button type="button" onClick={() => setShowHistory(s => !s)} className="w-full flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-slate-500">
              <span className="inline-flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5" /> Service history ({service.length})</span>
              {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showHistory && (
              service.length === 0 ? (
                <div className="text-xs text-slate-400 italic mt-2">No repairs logged for this unit.</div>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {service.slice(0, 25).map(r => (
                    <li key={r.id} className="flex items-start justify-between gap-2 text-xs border border-slate-100 rounded-lg px-2 py-1.5">
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] text-slate-500">{r.date}</div>
                        <div className="text-slate-700 truncate">{r.fixNotes || '—'}</div>
                      </div>
                      <span className="font-mono font-bold text-rose-600 shrink-0">${Number(r.cost || 0).toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        </div>
      </div>

      {viewer && <PhotoViewer files={viewer.files} startIndex={viewer.idx} onClose={() => setViewer(null)} />}
    </div>
  );
}

function Info({ label, value, sub }: { label: string; value?: string; sub?: string }) {
  return (
    <div>
      <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</div>
      <div className={`font-bold ${value ? 'text-slate-800' : 'text-slate-300'}`}>{value || '—'}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

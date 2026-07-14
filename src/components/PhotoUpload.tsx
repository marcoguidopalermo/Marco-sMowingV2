import { useRef, useState } from 'react';
import { Camera, ImagePlus, X, Loader2, FileText } from 'lucide-react';
import type { StoredFile } from '../types';
import { uploadFile, deleteFile } from '../lib/storage';
import PhotoViewer from './PhotoViewer';

interface PhotoUploadProps {
  // Storage directory for this surface, e.g. `repairs/${taskId}`.
  dir: string;
  value: StoredFile[];
  onChange: (files: StoredFile[]) => void;
  uploadedBy: { email: string; name: string };
  phase?: StoredFile['phase'];
  // Bubbles up while any upload is in flight so the parent form can
  // disable submit (works with the repair double-submit guard).
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
  // Whether the current user may delete a given photo (uploader/admin).
  canDelete?: (f: StoredFile) => boolean;
  label?: string;
}

// Shared pick-or-capture uploader: camera capture + library pick, client
// compression + progress, thumbnails with delete, tap-to-view. Reused by
// every Storage surface. Bytes go to Storage; the parent stores the
// returned StoredFile[] as metadata.
export default function PhotoUpload({
  dir, value, onChange, uploadedBy, phase, onUploadingChange, disabled, canDelete, label,
}: PhotoUploadProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busyCount, setBusyCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [viewIdx, setViewIdx] = useState<number | null>(null);

  const setUploading = (n: number) => {
    setBusyCount(n);
    onUploadingChange?.(n > 0);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const picked = Array.from(files);
    setUploading(picked.length);
    const added: StoredFile[] = [];
    for (const file of picked) {
      try {
        setProgress(0);
        const stored = await uploadFile(dir, file, {
          uploadedBy,
          phase,
          onProgress: (pct) => setProgress(pct),
        });
        added.push(stored);
        // Commit incrementally so a mid-batch failure keeps prior successes.
        onChange([...value, ...added]);
      } catch (err: any) {
        setError(err?.message || 'Upload failed.');
      } finally {
        setBusyCount(c => {
          const next = Math.max(0, c - 1);
          onUploadingChange?.(next > 0);
          return next;
        });
      }
    }
    setProgress(null);
  };

  const removeAt = async (i: number) => {
    const f = value[i];
    if (!f) return;
    // Optimistically drop from the array, then delete the bytes.
    onChange(value.filter((_, idx) => idx !== i));
    try {
      await deleteFile(f.path);
    } catch (err: any) {
      setError(err?.message || 'Could not remove file from storage.');
    }
  };

  const uploading = busyCount > 0;

  return (
    <div className="space-y-2">
      {label && <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{label}</label>}

      {/* Thumbnails */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((f, i) => (
            <div key={f.path} className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200 bg-slate-50 group">
              <button type="button" onClick={() => setViewIdx(i)} className="w-full h-full" title="View">
                {f.kind === 'pdf'
                  ? <span className="w-full h-full flex items-center justify-center"><FileText className="w-6 h-6 text-slate-400" /></span>
                  : <img src={f.url} alt={f.name} className="w-full h-full object-cover" />}
              </button>
              {(!canDelete || canDelete(f)) && !disabled && (
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  title="Remove photo"
                  className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pick / capture buttons — glove-friendly (min-h 44). */}
      {!disabled && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            disabled={uploading}
            className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />} Take photo
          </button>
          <button
            type="button"
            onClick={() => libraryRef.current?.click()}
            disabled={uploading}
            className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-black uppercase tracking-widest hover:bg-slate-50 disabled:opacity-50"
          >
            <ImagePlus className="w-4 h-4" /> Choose
          </button>
        </div>
      )}

      {/* Camera capture opens the rear camera directly on mobile. */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
      {/* Library pick: images + PDFs, multi-select. */}
      <input ref={libraryRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />

      {uploading && progress !== null && (
        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {uploading && <div className="text-[11px] text-slate-500">Uploading… {progress ?? 0}%</div>}
      {error && <div className="text-[11px] font-bold text-rose-600">{error}</div>}

      {viewIdx !== null && <PhotoViewer files={value} startIndex={viewIdx} onClose={() => setViewIdx(null)} />}
    </div>
  );
}

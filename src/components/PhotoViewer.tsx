import { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, FileText, Download } from 'lucide-react';
import type { StoredFile } from '../types';

interface PhotoViewerProps {
  files: StoredFile[];
  startIndex?: number;
  onClose: () => void;
}

// Full-screen viewer for stored images / PDFs. Opened by tapping a
// thumbnail; supports prev/next across the file set and keyboard arrows.
export default function PhotoViewer({ files, startIndex = 0, onClose }: PhotoViewerProps) {
  const [idx, setIdx] = useState(Math.min(Math.max(0, startIndex), Math.max(0, files.length - 1)));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') setIdx(i => Math.max(0, i - 1));
      else if (e.key === 'ArrowRight') setIdx(i => Math.min(files.length - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [files.length, onClose]);

  if (files.length === 0) return null;
  const f = files[idx];
  const isPdf = f.kind === 'pdf' || f.contentType === 'application/pdf';

  return (
    <div className="fixed inset-0 z-[200] bg-black/90 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between p-3 text-white/90" onClick={e => e.stopPropagation()}>
        <span className="text-sm font-bold truncate">{f.name}{files.length > 1 ? `  ·  ${idx + 1}/${files.length}` : ''}</span>
        <div className="flex items-center gap-1">
          <a href={f.url} target="_blank" rel="noopener noreferrer" title="Open / download" className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center hover:bg-white/10 rounded-lg"><Download className="w-5 h-5" /></a>
          <button onClick={onClose} title="Close" className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center hover:bg-white/10 rounded-lg"><X className="w-6 h-6" /></button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center min-h-0 px-2" onClick={e => e.stopPropagation()}>
        {idx > 0 && (
          <button onClick={() => setIdx(i => Math.max(0, i - 1))} className="absolute left-1 top-1/2 -translate-y-1/2 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-white/80 hover:bg-white/10 rounded-full"><ChevronLeft className="w-8 h-8" /></button>
        )}
        {isPdf ? (
          <a href={f.url} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-3 text-white/90 p-8">
            <FileText className="w-16 h-16" />
            <span className="font-bold underline">Open PDF</span>
          </a>
        ) : (
          <img src={f.url} alt={f.name} className="max-h-full max-w-full object-contain select-none" />
        )}
        {idx < files.length - 1 && (
          <button onClick={() => setIdx(i => Math.min(files.length - 1, i + 1))} className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-white/80 hover:bg-white/10 rounded-full"><ChevronRight className="w-8 h-8" /></button>
        )}
      </div>

      <div className="p-2 text-center text-white/50 text-[11px]" onClick={e => e.stopPropagation()}>
        Uploaded by {f.uploadedBy?.name || '—'}
      </div>
    </div>
  );
}

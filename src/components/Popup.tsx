// A simple popup: a sheet from the bottom on a phone, a centred box on wider
// screens. Escape or the Close button closes it.
import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export default function Popup({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className={`bg-white w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-xl`}>
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-white border-b border-slate-100 px-4 py-3">
          <h2 className="flex-1 text-base font-black text-slate-800">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-300 text-sm font-bold text-slate-700"><X className="w-4 h-4" /> Close</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

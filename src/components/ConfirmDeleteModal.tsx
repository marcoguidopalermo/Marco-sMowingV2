import { useEffect, useState } from 'react';
import { X, AlertTriangle, Trash2 } from 'lucide-react';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

// Deliberate-wording delete confirmation. Each call site passes the
// record-specific title / body / confirm label (see DELETE_DIALOG_COPY
// in App.tsx) so it never reads as a generic "Are you sure?" — the
// reader must actually look at it to know what they're about to delete.
export default function ConfirmDeleteModal({
  isOpen, title, body, confirmLabel, onConfirm, onClose,
}: ConfirmDeleteModalProps) {
  const [busy, setBusy] = useState(false);

  // Reset busy flag whenever the modal opens fresh (covers a re-open
  // after a prior failed attempt).
  useEffect(() => { if (isOpen) setBusy(false); }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      // onClose is called by the parent on success; on failure we want
      // to leave the modal up so the user can retry or cancel.
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[200] flex md:items-center md:justify-center md:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="bg-white md:rounded-2xl shadow-2xl w-full md:max-w-md h-full md:h-auto overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 bg-rose-50 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="shrink-0 w-9 h-9 rounded-full bg-rose-100 inline-flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-black text-rose-900 leading-tight">{title}</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-slate-400 hover:text-slate-700 disabled:opacity-50 p-2 rounded min-w-[44px] min-h-[44px] inline-flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 px-5 py-4 text-sm text-slate-700 leading-relaxed">
          {body}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex flex-col-reverse md:flex-row md:items-center md:justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[44px] px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className="min-h-[44px] px-5 py-2.5 text-sm font-black uppercase tracking-widest bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow disabled:bg-slate-300 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
          >
            <Trash2 className="w-4 h-4" />
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

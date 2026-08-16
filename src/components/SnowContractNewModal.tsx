// SNOWMASTER · NEW CONTRACT.
//
// "+ New contract" used to mint an empty record and drop you into the two-pane
// editor. It now asks for the five things CrewMaster needs and saves — the
// document itself is built in the standalone HTML builder and attached as a
// PDF, either here at creation or later from the record.
//
// The PDF is OPTIONAL on purpose: a contract usually exists as a name and an
// address before the paper does, and requiring the file to create the record
// would mean the pipeline could not show anything until the document was
// finished.
import { useState } from 'react';
import { Loader2, Upload, FileText, X } from 'lucide-react';
import type { SnowContractDocLabel } from '../types';
import { ContractFields, DOC_LABEL, type SnowContractFields } from './SnowContractSimple';

export default function SnowContractNewModal({
  onClose, onCreate,
}: {
  onClose: () => void;
  // Creates the record, then (if a file was picked) attaches it. Returns the
  // new id, or null if creation failed.
  onCreate: (
    fields: SnowContractFields,
    file: { file: File; label: SnowContractDocLabel } | null,
    onProgress: (pct: number) => void,
  ) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<SnowContractFields>({
    businessName: '', serviceAddress: '', crew: '', serviceWindow: null, status: 'quoted',
  });
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState<SnowContractDocLabel>('quote');
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);

  const ready = draft.businessName.trim().length > 0 && !busy;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      role="dialog" aria-modal="true" onClick={onClose}>
      <div className="my-8 w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black text-slate-900">New contract</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <ContractFields draft={draft} onChange={p => setDraft(d => ({ ...d, ...p }))} disabled={busy} />

        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
              Contract PDF <span className="font-bold normal-case tracking-normal text-slate-400">— optional, can be added later</span>
            </span>
            <div className="ml-auto flex items-center gap-2">
              <select value={label} onChange={e => setLabel(e.target.value as SnowContractDocLabel)}
                disabled={busy}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-700">
                {(Object.keys(DOC_LABEL) as SnowContractDocLabel[]).map(k =>
                  <option key={k} value={k}>{DOC_LABEL[k]}</option>)}
              </select>
              <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-white ${busy ? 'bg-slate-400' : 'bg-slate-700'}`}>
                <Upload className="h-3.5 w-3.5" /> Choose file
                <input type="file" accept="application/pdf,image/*" className="hidden" disabled={busy}
                  onChange={e => { setFile(e.target.files?.[0] || null); e.target.value = ''; }} />
              </label>
            </div>
          </div>
          {file ? (
            <div className="flex items-center gap-2 text-[12px] font-bold text-slate-700">
              <FileText className="h-3.5 w-3.5 text-slate-400" />
              <span className="truncate">{file.name}</span>
              {!busy && (
                <button type="button" onClick={() => setFile(null)}
                  className="text-[11px] font-black uppercase tracking-widest text-rose-600 underline">
                  remove
                </button>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-slate-500">
              Nothing attached yet — build it in the contract builder, print to PDF, and attach it here or later.
            </p>
          )}
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="min-h-[44px] flex-1 rounded-lg border border-slate-300 px-3 text-sm font-bold">
            Cancel
          </button>
          <button type="button" disabled={!ready}
            onClick={async () => {
              setBusy(true); setPct(0);
              try {
                const id = await onCreate(draft, file ? { file, label } : null, setPct);
                if (id) onClose();
              } finally { setBusy(false); }
            }}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 text-sm font-black text-white disabled:opacity-40">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {file ? `${pct}%` : 'Saving…'}</> : 'Create contract'}
          </button>
        </div>
        {!draft.businessName.trim() && (
          <p className="mt-2 text-center text-[11px] font-bold text-slate-400">A contract name is required.</p>
        )}
      </div>
    </div>
  );
}

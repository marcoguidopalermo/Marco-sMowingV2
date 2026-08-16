// SNOWMASTER · CONTRACT RECORD (simplified).
//
// THE DOCUMENT IS NO LONGER BUILT HERE. Contracts are written in the
// standalone HTML builder, printed to PDF and attached; CrewMaster tracks the
// pipeline around them. So this record holds only what CrewMaster needs to
// answer on its own — who it is, where, what stage it's at, which crew has it,
// and which response window — plus the PDFs themselves.
//
// The old two-pane editor (SnowContractEditor) and the document renderer
// (SnowContractDocument) are still in the repo but are no longer mounted
// anywhere. Nothing here imports them. Everything they edited — service level,
// the pricing grid, scope, the site map and photo, term dates, insurance
// amount, trigger depth and the response-hour figures — is PARKED: still on
// the record, still migrated, never shown or overwritten by this view. A
// contract entered before the simplification keeps every one of those values,
// and if the editor is ever remounted they are all still there.
import { useState } from 'react';
import { ArrowLeft, Check, Loader2, Paperclip, FileText, Trash2, Upload, ArchiveRestore } from 'lucide-react';
import type {
  SnowContract, SnowContractStatus, SnowContractDocLabel, SnowServiceWindow, StoredFile,
} from '../types';
import { STATUS_LABEL } from '../lib/snowContracts';
import SnowContractDeleteModal from './SnowContractDeleteModal';

export const WINDOW_LABEL: Record<SnowServiceWindow, string> = {
  overnight: 'Overnight', daytime: 'Daytime', nonPriority: 'Non-priority',
};
export const DOC_LABEL: Record<SnowContractDocLabel, string> = {
  quote: 'Quote', sent_copy: 'Sent copy', signed_copy: 'Signed copy', other: 'Other',
};

const inputCls = 'w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2.5 '
  + 'text-[15px] leading-snug text-slate-900 outline-none transition '
  + 'focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 '
  + 'disabled:bg-slate-50 disabled:text-slate-500';

const stampDate = (ms: number) => {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US',
    sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
};
const fileSize = (b: number) =>
  (b >= 1024 * 1024 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-500">{label}</span>
    {children}
  </label>
);

// The five fields shared by the create form and the record view, so the thing
// you fill in to make a contract is literally the thing you see afterwards.
export function ContractFields({
  draft, onChange, disabled,
}: {
  draft: SnowContractFields;
  onChange: (patch: Partial<SnowContractFields>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label="Contract name">
        <input className={inputCls} disabled={disabled} value={draft.businessName}
          onChange={e => onChange({ businessName: e.target.value })}
          placeholder="Business name" autoFocus />
      </Field>
      <Field label="Service address">
        <input className={inputCls} disabled={disabled} value={draft.serviceAddress}
          onChange={e => onChange({ serviceAddress: e.target.value })}
          placeholder="1175 Rosslyn Road" />
      </Field>
      <Field label="Crew">
        <input className={inputCls} disabled={disabled} value={draft.crew}
          onChange={e => onChange({ crew: e.target.value })}
          placeholder="Tony, Tom, Al" />
      </Field>
      <Field label="Service window">
        <select className={inputCls} disabled={disabled} value={draft.serviceWindow ?? ''}
          onChange={e => onChange({ serviceWindow: (e.target.value || null) as SnowServiceWindow | null })}>
          <option value="">Not set</option>
          {(Object.keys(WINDOW_LABEL) as SnowServiceWindow[]).map(w =>
            <option key={w} value={w}>{WINDOW_LABEL[w]}</option>)}
        </select>
      </Field>
      <Field label="Status">
        <select className={inputCls} disabled={disabled} value={draft.status}
          onChange={e => onChange({ status: e.target.value as SnowContractStatus })}>
          {(Object.keys(STATUS_LABEL) as SnowContractStatus[]).map(s =>
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </Field>
    </div>
  );
}

export interface SnowContractFields {
  businessName: string;
  serviceAddress: string;
  crew: string;
  serviceWindow: SnowServiceWindow | null;
  status: SnowContractStatus;
}

export const fieldsOf = (c: SnowContract): SnowContractFields => ({
  businessName: c.client.businessName || '',
  serviceAddress: c.client.serviceAddress || '',
  crew: c.crew || '',
  serviceWindow: c.serviceTerms?.serviceWindow ?? null,
  status: c.status,
});

// Apply the five fields back onto a contract WITHOUT touching anything else —
// this is what parks the detailed data: every other key is spread through
// untouched, including the whole pricing/scope/insurance shape.
export function applyFields(
  c: SnowContract, f: SnowContractFields, who: string,
): SnowContract {
  const now = Date.now();
  const next: SnowContract = {
    ...c,
    client: { ...c.client, businessName: f.businessName.trim(), serviceAddress: f.serviceAddress.trim() },
    crew: f.crew.trim(),
    serviceTerms: { ...c.serviceTerms, serviceWindow: f.serviceWindow },
    status: f.status,
    updatedAt: now,
  };
  // Stage stamps, same rule as before: set on entry, first time only, never
  // cleared by a later move.
  if (f.status === 'sent' && !next.sentAt) { next.sentAt = now; next.sentBy = who; }
  if (f.status === 'approved' && !next.approvedAt) { next.approvedAt = now; next.approvedBy = who; }
  if (f.status === 'booked') {
    if (!next.bookedAt) { next.bookedAt = now; next.bookedBy = who; }
    if (!next.approvedAt) { next.approvedAt = now; next.approvedBy = who; }
  }
  if (f.status === 'declined' && !next.declinedAt) { next.declinedAt = now; next.declinedBy = who; }
  return next;
}

// ── ATTACHMENTS ────────────────────────────────────────────────────────────
export function Attachments({
  contract, canEdit, onUpload, onRemove,
}: {
  contract: SnowContract;
  canEdit: boolean;
  onUpload: (file: File, label: SnowContractDocLabel, onProgress: (pct: number) => void) => Promise<void>;
  onRemove: (docId: string, path: string) => void;
}) {
  const [label, setLabel] = useState<SnowContractDocLabel>('quote');
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const docs = contract.documents || [];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Paperclip className="h-4 w-4 text-slate-700" />
        <h4 className="text-sm font-black text-slate-900">Contract PDF</h4>
        <span className="text-[11px] font-bold text-slate-400">
          {docs.length === 0 ? 'none attached' : `${docs.length} attached`}
        </span>
        {canEdit && (
          <div className="ml-auto flex items-center gap-2">
            <select value={label} onChange={e => setLabel(e.target.value as SnowContractDocLabel)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-700">
              {(Object.keys(DOC_LABEL) as SnowContractDocLabel[]).map(k =>
                <option key={k} value={k}>{DOC_LABEL[k]}</option>)}
            </select>
            <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-white ${busy ? 'bg-slate-400' : 'bg-slate-800'}`}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {busy ? `${pct}%` : 'Attach PDF'}
              <input type="file" accept="application/pdf,image/*" className="hidden" disabled={busy}
                onChange={async e => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  setBusy(true); setPct(0);
                  try { await onUpload(f, label, setPct); } finally { setBusy(false); }
                }} />
            </label>
          </div>
        )}
      </div>
      {docs.length === 0 ? (
        <p className="text-[12px] text-slate-500">
          Build the contract in the HTML builder, print it to PDF, and attach it here.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {docs.map(d => (
            <li key={d.id} className="flex items-center gap-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <a href={d.file.url} target="_blank" rel="noreferrer"
                  className="block truncate text-[13px] font-bold text-sky-700 underline">
                  {d.file.name}
                </a>
                <div className="text-[10px] font-bold text-slate-400">
                  {DOC_LABEL[d.label] || d.label} · {fileSize(d.file.size)} ·
                  {' '}{stampDate(d.file.uploadedAt)} by {d.file.uploadedBy?.name || d.file.uploadedBy?.email || 'unknown'}
                </div>
              </div>
              {canEdit && (
                <button type="button" title="Remove attachment"
                  onClick={() => {
                    if (!window.confirm(`Remove "${d.file.name}" from this contract?`)) return;
                    onRemove(d.id, d.file.path);
                  }}
                  className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── THE RECORD VIEW ────────────────────────────────────────────────────────
export default function SnowContractSimple({
  contract, onChange, onBack, onUploadDocument, onDeleteDocument,
  onDeleteContract, onArchiveContract, canDelete, canEdit, saving, currentUser,
}: {
  contract: SnowContract;
  onChange: (next: SnowContract) => void;
  onBack: () => void;
  onUploadDocument: (file: File, onProgress: (pct: number) => void) => Promise<StoredFile | null>;
  onDeleteDocument: (path: string) => Promise<void>;
  onDeleteContract: () => Promise<void>;
  onArchiveContract: (archived: boolean) => Promise<void>;
  canDelete: boolean;
  canEdit: boolean;
  saving: 'idle' | 'saving' | 'saved';
  currentUser: { email: string; name: string };
}) {
  const c = contract;
  const [draft, setDraft] = useState<SnowContractFields>(() => fieldsOf(c));
  const [deleting, setDeleting] = useState(false);

  // Autosave on change, matching the old editor's no-save-button behaviour.
  const patch = (p: Partial<SnowContractFields>) => {
    const next = { ...draft, ...p };
    setDraft(next);
    onChange(applyFields(c, next, currentUser.name));
  };

  const stamps: [string, number | undefined, string | undefined][] = [
    ['Sent', c.sentAt, c.sentBy],
    ['Approved', c.approvedAt, c.approvedBy],
    ['Booked', c.bookedAt, c.bookedBy],
    ['Declined', c.declinedAt, c.declinedBy],
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onBack}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-black uppercase tracking-widest">
          <ArrowLeft className="h-3.5 w-3.5" /> All contracts
        </button>
        <span className="text-[11px] font-bold text-slate-400">
          {saving === 'saving' ? 'Saving…' : saving === 'saved' ? <><Check className="inline h-3 w-3" /> Saved</> : ''}
        </span>
        {c.archived && (
          <span className="rounded border border-amber-400 bg-amber-50 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-amber-800">
            Archived
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {canDelete && (c.archived ? (
            <button type="button" onClick={() => onArchiveContract(false)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-amber-400 bg-amber-50 px-3 text-xs font-black uppercase tracking-widest text-amber-800">
              <ArchiveRestore className="h-3.5 w-3.5" /> Restore
            </button>
          ) : (
            <button type="button" onClick={() => setDeleting(true)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-rose-300 px-3 text-xs font-black uppercase tracking-widest text-rose-700">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <ContractFields draft={draft} onChange={patch} disabled={!canEdit} />
        {stamps.some(([, at]) => at) && (
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-[10px] font-bold text-slate-500">
            {stamps.map(([lab, at, by]) => at ? (
              <span key={lab}>{lab} {stampDate(at)}{by ? ` by ${by}` : ''}</span>
            ) : null)}
          </div>
        )}
      </div>

      <Attachments
        contract={c}
        canEdit={canEdit}
        onUpload={async (file, label, onProgress) => {
          const stored = await onUploadDocument(file, onProgress);
          if (!stored) return;
          onChange({
            ...c,
            documents: [
              ...(c.documents || []),
              { id: `scd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, label, file: stored },
            ],
            updatedAt: Date.now(),
          });
        }}
        onRemove={(docId, path) => {
          onChange({ ...c, documents: (c.documents || []).filter(d => d.id !== docId), updatedAt: Date.now() });
          void onDeleteDocument(path);
        }}
      />

      {deleting && (
        <SnowContractDeleteModal
          contract={c}
          onClose={() => setDeleting(false)}
          onArchive={async () => { await onArchiveContract(true); setDeleting(false); }}
          onDelete={async () => { await onDeleteContract(); setDeleting(false); }}
        />
      )}
    </div>
  );
}

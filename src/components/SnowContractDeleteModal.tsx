// SNOWMASTER · CONTRACT DELETE CONFIRM.
//
// Shared by the contracts LIST (row trash button) and the editor, so the
// confirmation is defined once and cannot drift between the two places it can
// be triggered from.
//
// A PLAIN confirm: name the contract, say it can't be undone, Cancel/Delete.
// It previously required typing the business name (or the contract id on an
// untitled record) — that gate is gone. Deleting a contract is a routine part
// of working a season's list, and making every one of them a typing exercise
// taxed the common case to guard the rare one.
//
// What is NOT relaxed, because none of it is friction the user has to absorb:
// the deletion is still audited with the full record as its snapshot, and its
// Storage attachments are still removed before the record goes, so nothing is
// orphaned in the bucket. Both live in App.tsx's deleteSnowContractRecord.
import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import type { SnowContract } from '../types';
import { STATUS_LABEL } from '../lib/snowContracts';

export default function SnowContractDeleteModal({
  contract, onClose, onArchive, onDelete,
}: {
  contract: SnowContract;
  onClose: () => void;
  onArchive: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const name = contract.client.businessName?.trim() || '';
  // An accepted agreement still says so — but as a line of text, not a gate.
  const committed = contract.status === 'approved' || contract.status === 'booked';
  const [busy, setBusy] = useState(false);
  const attachments = (contract.documents || []).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="mb-2 text-lg font-black text-slate-900">
          Delete {name || 'this untitled contract'}?
        </h3>

        <p className="text-[13px] text-slate-700">
          This can&rsquo;t be undone.
          {attachments > 0 && (
            <> Its {attachments} attached file{attachments === 1 ? '' : 's'} will be removed too.</>
          )}
        </p>

        {committed && (
          <p className="mt-2 text-[12px] font-bold text-amber-800">
            Heads up — this contract is {STATUS_LABEL[contract.status].toLowerCase()}. Archiving
            keeps the record and its attachments and just takes it off the working list.
          </p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="min-h-[44px] flex-1 rounded-lg border border-slate-300 px-3 text-sm font-bold">
            Cancel
          </button>
          <button type="button" disabled={busy}
            onClick={async () => { setBusy(true); try { await onDelete(); } finally { setBusy(false); } }}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 text-sm font-black text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete
          </button>
        </div>

        {/* Archive stays reachable as a quiet third option rather than a third
            primary button — without it there is no way to archive at all, and
            the archived list, its toggle and Restore would be dead code. */}
        <button type="button" disabled={busy}
          onClick={async () => { setBusy(true); try { await onArchive(); } finally { setBusy(false); } }}
          className="mt-2 w-full text-center text-[12px] font-bold text-amber-700 underline underline-offset-2 disabled:opacity-50">
          Archive instead
        </button>
      </div>
    </div>
  );
}

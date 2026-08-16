// SNOWMASTER · CONTRACT DELETE CONFIRM.
//
// Shared by the contracts LIST (row trash button) and the editor, so the guard
// on destroying a contract is defined once and cannot drift between the two
// places it can be triggered from.
import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import type { SnowContract } from '../types';
import { STATUS_LABEL } from '../lib/snowContracts';

const inputCls = 'w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2.5 '
  + 'text-[15px] leading-snug text-slate-900 outline-none transition '
  + 'focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30';

const stampDate = (ms: number) => {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US',
    sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
};

// DELETE CONFIRM — type the exact business name, same pattern as project
// deletion in ContractingMaster.
//
// A contract that reached APPROVED or BOOKED is a commercial commitment, and
// its signed PDF is frequently the only copy anyone has. So the two paths are
// not equally weighted: for those records ARCHIVE is the primary action, and
// permanent deletion needs the typed name PLUS an explicit acknowledgement
// that the agreement and its attachments are being destroyed. A quote nobody
// accepted keeps the plain single-gate delete — junk should be easy to remove.
export default function SnowContractDeleteModal({
  contract, onClose, onArchive, onDelete,
}: {
  contract: SnowContract;
  onClose: () => void;
  onArchive: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const name = contract.client.businessName?.trim() || '';
  const committed = contract.status === 'approved' || contract.status === 'booked';
  const [typed, setTyped] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  // An untitled contract has no name to type, so fall back to its id — there
  // still has to be something deliberate to type.
  const target = name || contract.id;
  const match = typed.trim() === target;
  const canDelete = match && (!committed || ack) && !busy;
  const attachments = (contract.documents || []).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="mb-2 text-lg font-black text-slate-900">
          {committed ? 'Archive or delete this contract?' : 'Delete this contract?'}
        </h3>

        {committed && (
          <div className="mb-3 rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
            <p className="text-[13px] font-bold text-amber-900">
              This contract is {STATUS_LABEL[contract.status].toUpperCase()}
              {contract.approvedAt ? ` — approved ${stampDate(contract.approvedAt)}` : ''}
              {contract.bookedAt ? `, booked ${stampDate(contract.bookedAt)}` : ''}.
            </p>
            <p className="mt-1 text-[12px] text-amber-900">
              It represents an agreement the client accepted. Archiving keeps the record and its
              attachments and only removes it from the working list — that is almost always what
              you want here.
            </p>
          </div>
        )}

        <p className="mb-3 text-[13px] text-slate-700">
          Deleting <b>{name || 'this untitled contract'}</b> permanently removes the record
          {attachments > 0
            ? <> and <b>{attachments} attached file{attachments === 1 ? '' : 's'}</b> from storage</>
            : null}. This cannot be undone.
        </p>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-500">
            Type {name ? 'the business name' : 'the contract id'} to confirm
          </span>
          <input className={inputCls} value={typed} onChange={e => setTyped(e.target.value)}
            placeholder={target} autoFocus autoComplete="off" />
        </label>

        {committed && (
          <label className="mt-3 flex items-start gap-2">
            <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="mt-1" />
            <span className="text-[12px] font-bold text-rose-700">
              I understand this destroys an accepted agreement and any signed copy attached to it.
            </span>
          </label>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="min-h-[44px] flex-1 rounded-lg border border-slate-300 px-3 text-sm font-bold">
            Cancel
          </button>
          <button type="button" disabled={busy}
            onClick={async () => { setBusy(true); try { await onArchive(); } finally { setBusy(false); } }}
            className={`min-h-[44px] flex-1 rounded-lg px-3 text-sm font-black ${committed ? 'bg-amber-500 text-white' : 'border border-amber-400 bg-amber-50 text-amber-800'}`}>
            Archive instead
          </button>
          <button type="button" disabled={!canDelete}
            onClick={async () => { setBusy(true); try { await onDelete(); } finally { setBusy(false); } }}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 text-sm font-black text-white disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete permanently
          </button>
        </div>
      </div>
    </div>
  );
}

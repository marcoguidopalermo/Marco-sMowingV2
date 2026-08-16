// SNOWMASTER · CONTRACT LIST — every contract for a season, at a glance.
import { Fragment, useMemo, useState } from 'react';
import { Plus, Search, FileText, ExternalLink, Archive, ArchiveRestore, Trash2, ChevronDown } from 'lucide-react';
import type { SnowContract, SnowContractStatus } from '../types';
import { headlinePrice, STATUS_LABEL, STATUS_FLOW, STATUS_OFFRAMP, seasonFor } from '../lib/snowContracts';
import SnowContractDeleteModal from './SnowContractDeleteModal';

// Attachment labels, shown on the expanded multi-PDF picker.
const DOC_LABEL: Record<string, string> = {
  quote: 'Quote', sent_copy: 'Sent copy', signed_copy: 'Signed copy', other: 'Other',
};

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Colour tracks progress along the pipeline: neutral while it's only a quote,
// sky once it's with the client, green on approval and a stronger green when
// it's actually on the route. Off-ramps are red and amber.
const STATUS_CHIP: Record<SnowContractStatus, string> = {
  quoted: 'bg-slate-100 text-slate-600 border-slate-300',
  sent: 'bg-sky-50 text-sky-700 border-sky-300',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  booked: 'bg-emerald-600 text-white border-emerald-700',
  declined: 'bg-rose-50 text-rose-700 border-rose-300',
  expired: 'bg-amber-50 text-amber-800 border-amber-300',
};

// The hosted standalone builder. Deployed from
// reference/Marcos_Snow_Contract_Builder.html by scripts/copy-contract-builder.mjs
// at build time, so the page served here is the same file the transcription
// guard verifies — there is no second copy to drift.
const BUILDER_URL = '/snow-contract-builder';

export default function SnowContractList({
  contracts, onOpen, onNew, onRename, onDelete, onArchive, canDelete, canEdit, today,
}: {
  contracts: Record<string, SnowContract>;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, businessName: string) => Promise<void>;
  onDelete: (id: string) => Promise<boolean>;
  onArchive: (id: string, archived: boolean) => Promise<void>;
  canDelete: boolean;
  canEdit: boolean;
  today: string;
}) {
  const all = useMemo(() => Object.values(contracts), [contracts]);
  const seasons = useMemo(() => {
    const s = new Set(all.map(c => c.season));
    s.add(seasonFor(new Date(`${today}T12:00:00`)));
    return [...s].sort().reverse();
  }, [all, today]);

  const [season, setSeason] = useState<string>(seasons[0] || '');
  const [status, setStatus] = useState<'all' | SnowContractStatus>('all');
  const [q, setQ] = useState('');
  // Archived records are OUT of the working list by default — that is the
  // point of archiving. They are never deleted, just behind this toggle.
  const [showArchived, setShowArchived] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter(c => (showArchived ? !!c.archived : !c.archived))
      .filter(c => (season === 'all' || c.season === season))
      .filter(c => (status === 'all' || c.status === status))
      .filter(c => !needle
        || c.client.businessName.toLowerCase().includes(needle)
        || c.client.serviceAddress.toLowerCase().includes(needle))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [all, season, status, q, showArchived]);

  // Pipeline counts follow the SEASON and the search box but NOT the status
  // filter — a stage count that changed when you filtered by that stage would
  // just report itself.
  const counts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = all
      .filter(c => !c.archived)          // archived is not part of the pipeline
      .filter(c => (season === 'all' || c.season === season))
      .filter(c => !needle
        || c.client.businessName.toLowerCase().includes(needle)
        || c.client.serviceAddress.toLowerCase().includes(needle));
    const out = Object.fromEntries(
      (Object.keys(STATUS_LABEL) as SnowContractStatus[]).map(s => [s, 0]),
    ) as Record<SnowContractStatus, number>;
    for (const c of base) if (out[c.status] !== undefined) out[c.status]++;
    return out;
  }, [all, season, q]);

  // Across every season — the toggle is about reaching archived records at
  // all, and scoping it to the season in view would hide the way in.
  const archivedCount = useMemo(() => all.filter(c => c.archived).length, [all]);

  // ── ROW STATE ────────────────────────────────────────────────────────────
  // The list is the working surface: rename, open a PDF and clear out dead
  // quotes without opening a record. Each of these is a per-row mode rather
  // than a modal, so the table stays where it is while you work down it.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [expandedDocsId, setExpandedDocsId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deleting = deletingId ? contracts[deletingId] : null;

  const startRename = (c: SnowContract) => {
    setRenamingId(c.id);
    setRenameDraft(c.client.businessName || '');
  };
  const commitRename = async (c: SnowContract) => {
    const next = renameDraft.trim();
    setRenamingId(null);
    // No-op if unchanged or emptied — a blank business name is what "Untitled"
    // already means, and saving one would only churn updatedAt.
    if (!next || next === (c.client.businessName || '')) return;
    await onRename(c.id, next);
  };

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 mr-auto">
          <FileText className="w-5 h-5 text-slate-700" />
          <h3 className="text-lg font-black text-slate-900">Commercial contracts</h3>
        </div>
        <select value={season} onChange={e => setSeason(e.target.value)}
          className="text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg px-2 py-2">
          <option value="all">All seasons</option>
          {seasons.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value as any)}
          className="text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg px-2 py-2">
          <option value="all">All statuses</option>
          {(Object.keys(STATUS_LABEL) as SnowContractStatus[]).map(s =>
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="business or address"
            className="text-xs border border-slate-300 rounded-lg pl-7 pr-2 py-2 outline-none w-52" />
        </div>
        {archivedCount > 0 && (
          <button type="button" onClick={() => setShowArchived(v => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border ${showArchived ? 'bg-amber-100 text-amber-900 border-amber-400' : 'bg-white text-slate-600 border-slate-300'}`}>
            <Archive className="w-3.5 h-3.5" /> {showArchived ? 'Viewing archived' : `Archived (${archivedCount})`}
          </button>
        )}
        <a href={BUILDER_URL} target="_blank" rel="noreferrer"
          title="Open the standalone HTML contract builder in a new tab"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border-2 border-sky-600 text-sky-700 bg-sky-50 hover:bg-sky-100">
          <ExternalLink className="w-3.5 h-3.5" /> Open contract builder
        </a>
        {canEdit && (
          <button type="button" onClick={onNew}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest bg-slate-800 text-white">
            <Plus className="w-3.5 h-3.5" /> New contract
          </button>
        )}
      </div>

      {/* PIPELINE — counts for the season in view, clickable as filters. Only
          the forward stages get a column each; declined and expired are
          off-ramps, shown after the arrow rather than as steps along it. */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 flex flex-wrap items-center gap-2">
        {STATUS_FLOW.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <span className="text-slate-300 font-black">→</span>}
            <button type="button" onClick={() => setStatus(status === s ? 'all' : s)}
              className={`rounded-lg border px-3 py-1.5 text-left transition ${status === s ? 'ring-2 ring-sky-500/40 border-sky-400' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{STATUS_LABEL[s]}</div>
              <div className="text-lg font-black leading-none text-slate-900">{counts[s]}</div>
            </button>
          </div>
        ))}
        <span className="mx-1 h-8 w-px bg-slate-200" />
        {STATUS_OFFRAMP.map(s => (
          <button key={s} type="button" onClick={() => setStatus(status === s ? 'all' : s)}
            className={`rounded-lg border px-3 py-1.5 text-left transition ${status === s ? 'ring-2 ring-sky-500/40 border-sky-400' : 'border-slate-200 hover:border-slate-300'}`}>
            <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{STATUS_LABEL[s]}</div>
            <div className="text-lg font-black leading-none text-slate-400">{counts[s]}</div>
          </button>
        ))}
        {status !== 'all' && (
          <button type="button" onClick={() => setStatus('all')}
            className="ml-auto text-[11px] font-black uppercase tracking-widest text-slate-500 underline">
            Clear filter
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
              <th className="py-2 px-3 text-left">Business</th>
              <th className="py-2 px-3 text-left">Address</th>
              <th className="py-2 px-3 text-left">Status</th>
              <th className="py-2 px-3 text-center">PDF</th>
              <th className="py-2 px-3 text-right">Price</th>
              <th className="py-2 px-3 text-right">Updated</th>
              <th className="py-2 px-3 text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-sm text-slate-500">
                {showArchived
                  ? 'No archived contracts.'
                  : `No contracts${season !== 'all' ? ` for ${season}` : ''} yet.`}
              </td></tr>
            )}
            {rows.map(c => {
              const p = headlinePrice(c);
              const docs = c.documents || [];
              const renaming = renamingId === c.id;
              const expanded = expandedDocsId === c.id;
              return (
                <Fragment key={c.id}>
                  {/* The ROW opens the record; every control inside it stops
                      propagation so a rename or a delete never also navigates. */}
                  <tr onClick={() => onOpen(c.id)}
                    className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer">
                    <td className="py-2 px-3 text-left font-bold text-slate-800">
                      {renaming ? (
                        <input
                          autoFocus
                          value={renameDraft}
                          onClick={e => e.stopPropagation()}
                          onChange={e => setRenameDraft(e.target.value)}
                          onBlur={() => void commitRename(c)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); void commitRename(c); }
                            if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null); }
                          }}
                          className="w-full min-w-[10rem] rounded border border-sky-400 px-1.5 py-1 text-sm font-bold outline-none ring-2 ring-sky-500/30"
                          placeholder="Business name"
                        />
                      ) : (
                        <button type="button" title={canEdit ? 'Click to rename' : undefined}
                          onClick={e => { e.stopPropagation(); if (canEdit) startRename(c); else onOpen(c.id); }}
                          className={`text-left font-bold ${canEdit ? 'hover:underline decoration-dotted underline-offset-2' : ''}`}>
                          {c.client.businessName || <span className="text-slate-400">Untitled</span>}
                        </button>
                      )}
                      <div className="text-[10px] font-bold text-slate-400">
                        {c.season}{c.archived ? ' · archived' : ''}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-left text-slate-600">{c.client.serviceAddress || '—'}</td>
                    <td className="py-2 px-3 text-left">
                      <span className={`text-[10px] font-black uppercase tracking-widest border px-1.5 py-0.5 rounded ${STATUS_CHIP[c.status]}`}>
                        {STATUS_LABEL[c.status]}
                      </span>
                    </td>
                    {/* PDF — nothing at all when there are none. One opens
                        straight to the file; several expand a picker rather
                        than guessing which one was meant. */}
                    <td className="py-2 px-3 text-center">
                      {docs.length === 0 ? null : docs.length === 1 ? (
                        <a href={docs[0].file.url} target="_blank" rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          title={`Open ${docs[0].file.name}`}
                          className="inline-flex items-center gap-1 rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-sky-700 hover:bg-sky-100">
                          <FileText className="w-3 h-3" /> PDF
                        </a>
                      ) : (
                        <button type="button"
                          onClick={e => { e.stopPropagation(); setExpandedDocsId(expanded ? null : c.id); }}
                          title={`${docs.length} attachments`}
                          className="inline-flex items-center gap-1 rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-sky-700 hover:bg-sky-100">
                          <FileText className="w-3 h-3" /> {docs.length}
                          <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        </button>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-black text-slate-800">
                      {p.kind === null ? <span className="text-slate-300">—</span> : money(p.amount)}
                      <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                        {p.kind === 'seasonal' ? 'seasonal' : p.kind === 'perVisit' ? 'per visit' : ''}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right text-[11px] text-slate-500">
                      {c.updatedAt ? new Date(c.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {canDelete && (
                        c.archived ? (
                          <button type="button" title="Restore from archive"
                            onClick={e => { e.stopPropagation(); void onArchive(c.id, false); }}
                            className="rounded-lg p-1.5 text-amber-600 hover:bg-amber-50">
                            <ArchiveRestore className="w-4 h-4" />
                          </button>
                        ) : (
                          <button type="button" title="Delete this contract"
                            onClick={e => { e.stopPropagation(); setDeletingId(c.id); }}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                  {expanded && docs.length > 1 && (
                    <tr className="bg-slate-50/70">
                      <td colSpan={7} className="px-3 pb-2 pt-1">
                        <div className="flex flex-wrap gap-1.5">
                          {docs.map(d => (
                            <a key={d.id} href={d.file.url} target="_blank" rel="noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-sky-700 hover:border-sky-400">
                              <FileText className="w-3 h-3 text-slate-400" />
                              <span className="max-w-[16rem] truncate">{d.file.name}</span>
                              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                                {DOC_LABEL[d.label] || d.label}
                              </span>
                            </a>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {deleting && (
        <SnowContractDeleteModal
          contract={deleting}
          onClose={() => setDeletingId(null)}
          onArchive={async () => { await onArchive(deleting.id, true); setDeletingId(null); }}
          // Close only on SUCCESS. A delete can be refused part-way — an
          // attachment that would not delete aborts before the record goes, so
          // nothing is orphaned — and closing then would hide that behind a
          // toast. Leaving the modal up keeps the retry in front of the user.
          onDelete={async () => { const ok = await onDelete(deleting.id); if (ok) setDeletingId(null); }}
        />
      )}
    </div>
  );
}

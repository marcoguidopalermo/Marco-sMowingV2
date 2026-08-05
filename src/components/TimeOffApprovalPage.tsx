import { useMemo, useState } from 'react';
import { Plane, Check, X, ChevronDown, ChevronUp, Calendar as CalendarIcon, MessageSquare, CalendarRange } from 'lucide-react';
import { TimeOffRequest, Employee } from '../types';
import BookedOffCalendar from './BookedOffCalendar';

interface TimeOffApprovalPageProps {
  requests: Record<string, TimeOffRequest>;
  employees: Employee[];
  onApprove: (requestId: string) => void;
  onDeny: (requestId: string, reason: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDate(d: string): string {
  try {
    return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return d; }
}
function formatDateTime(ms: number): string {
  try { return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return ''; }
}

function describeRange(r: TimeOffRequest): string {
  if (r.type === 'full_day') {
    if (r.startDate && r.endDate && r.startDate === r.endDate) return formatDate(r.startDate);
    if (r.startDate && r.endDate) return `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`;
    return '—';
  }
  return `${formatDate(r.partialDate || '')} · ${r.partialStart || ''}–${r.partialEnd || ''}`;
}

function statusChip(status: TimeOffRequest['status']) {
  if (status === 'pending') return { label: 'Pending', cls: 'bg-amber-100 text-amber-700 border-amber-300' };
  if (status === 'approved') return { label: 'Approved', cls: 'bg-emerald-100 text-emerald-700 border-emerald-300' };
  if (status === 'denied') return { label: 'Denied', cls: 'bg-rose-100 text-rose-700 border-rose-300' };
  if (status === 'cancelled') return { label: 'Cancelled', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  return { label: 'Reverted', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
}

export default function TimeOffApprovalPage({
  requests,
  employees,
  onApprove,
  onDeny,
}: TimeOffApprovalPageProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [denyTargetId, setDenyTargetId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState('');
  // Coverage panel: the pending request currently overlaid on the month
  // grid so the reviewer sees its impact against already-approved days.
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const previewReq = previewId ? (requests || {})[previewId] : null;
  const previewMonth = previewReq?.startDate
    ? new Date(`${previewReq.startDate}T12:00:00`)
    : previewReq?.partialDate
      ? new Date(`${previewReq.partialDate}T12:00:00`)
      : undefined;
  const showCoverage = (id: string) => { setPreviewId(id); setCoverageOpen(true); };

  const empName = (id: string) => employees.find(e => e.id === id)?.name || id;
  const overlapNote = (r: TimeOffRequest): string | null => {
    if (r.type !== 'full_day' || !r.startDate || !r.endDate) return null;
    const emp = employees.find(e => e.id === r.employeeId);
    if (!emp) return null;
    const overlaps = (emp.awayDates || []).filter(d => {
      if (!d.start || !d.end) return false;
      return !(d.end < r.startDate! || d.start > r.endDate!);
    });
    if (overlaps.length === 0) return null;
    return overlaps.map(o => `${formatDate(o.start)} – ${formatDate(o.end)}`).join(', ');
  };

  const { pending, history } = useMemo(() => {
    const cutoff = Date.now() - 60 * DAY_MS;
    const all = Object.values(requests || {});
    const p = all.filter(r => r.status === 'pending').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const h = all
      .filter(r => r.status !== 'pending' && ((r.reviewedAt || r.createdAt || 0) >= cutoff))
      .sort((a, b) => (b.reviewedAt || b.createdAt || 0) - (a.reviewedAt || a.createdAt || 0));
    return { pending: p, history: h };
  }, [requests]);

  const submitDeny = () => {
    if (!denyTargetId) return;
    onDeny(denyTargetId, denyReason.trim());
    setDenyTargetId(null);
    setDenyReason('');
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-100 p-4 md:p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Plane className="w-6 h-6 text-sky-700" /> Time Off Requests
          </h2>
          <button
            type="button"
            onClick={() => { setCoverageOpen(o => !o); if (!coverageOpen && !previewId) setPreviewId(null); }}
            aria-pressed={coverageOpen}
            className={`inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest px-3 py-2 rounded-lg border shadow-sm ${coverageOpen ? 'bg-rose-600 text-white border-rose-700' : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'}`}
          >
            <CalendarRange className="w-4 h-4" /> {coverageOpen ? 'Hide coverage' : 'Month coverage'}
          </button>
        </div>

        {/* Booked-off coverage — the same monthly grid the schedule board
            shows, so the reviewer reads that month's coverage in the same
            breath. The request under review overlays as a distinct pending
            tag against the already-approved days. */}
        {coverageOpen && (
          <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            {previewReq && (
              <div className="px-4 py-2 border-b border-slate-100 bg-amber-50 text-[12px] text-amber-800 flex items-center gap-2 flex-wrap">
                <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border bg-amber-100 border-amber-300 text-amber-700">Previewing</span>
                <span className="font-bold">{empName(previewReq.employeeId)}</span>
                <span className="text-amber-700">{describeRange(previewReq)}</span>
                <button onClick={() => setPreviewId(null)} className="ml-auto text-[10px] font-black uppercase tracking-widest text-amber-700 hover:underline">Clear</button>
              </div>
            )}
            <BookedOffCalendar
              key={previewId || 'none'}
              employees={employees}
              pendingRequest={previewReq}
              initialMonth={previewMonth}
            />
          </section>
        )}

        <section className="bg-white rounded-xl shadow-sm border border-slate-200">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="text-xs font-black uppercase tracking-widest text-amber-700 inline-flex items-center gap-2">
              <CalendarIcon className="w-3.5 h-3.5" /> Pending
              <span className="text-[10px] font-bold text-slate-400">{pending.length}</span>
            </div>
          </div>
          <div className="p-3 space-y-2">
            {pending.length === 0 ? (
              <div className="text-xs text-slate-400 italic text-center py-4">No pending requests.</div>
            ) : pending.map(r => {
              const overlap = overlapNote(r);
              return (
                <div key={r.id} className="p-3 rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-slate-800">{empName(r.employeeId)}</div>
                      <div className="text-[12px] text-slate-600 mt-0.5">
                        <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${r.type === 'full_day' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-amber-50 text-amber-700 border-amber-200'} mr-2`}>
                          {r.type === 'full_day' ? 'Full Day' : 'Partial'}
                        </span>
                        {describeRange(r)}
                      </div>
                      {r.note && (
                        <div className="text-[11px] text-slate-500 mt-1 inline-flex items-start gap-1"><MessageSquare className="w-3 h-3 mt-0.5 shrink-0" /> {r.note}</div>
                      )}
                      {overlap && (
                        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
                          Already booked off: {overlap}
                        </div>
                      )}
                      <div className="text-[10px] text-slate-400 mt-1">submitted {formatDateTime(r.createdAt)}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => showCoverage(r.id)}
                        title="See this month's booked-off coverage with this request overlaid"
                        className={`min-h-[36px] inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border ${previewId === r.id && coverageOpen ? 'bg-rose-600 text-white border-rose-700' : 'text-rose-600 hover:bg-rose-50 border-rose-200'}`}
                      >
                        <CalendarRange className="w-3.5 h-3.5" /> Coverage
                      </button>
                      <button
                        type="button"
                        onClick={() => setDenyTargetId(r.id)}
                        className="min-h-[36px] inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-widest text-rose-600 hover:bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg"
                      >
                        <X className="w-3.5 h-3.5" /> Deny
                      </button>
                      <button
                        type="button"
                        onClick={() => onApprove(r.id)}
                        className="min-h-[36px] inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-widest text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-lg shadow-sm"
                      >
                        <Check className="w-3.5 h-3.5" /> Approve
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-white rounded-xl shadow-sm border border-slate-200">
          <button
            type="button"
            onClick={() => setHistoryOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
          >
            <div className="text-xs font-black uppercase tracking-widest text-slate-700 inline-flex items-center gap-2">
              History · last 60 days
              <span className="text-[10px] font-bold text-slate-400">{history.length}</span>
            </div>
            {historyOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>
          {historyOpen && (
            <div className="border-t border-slate-100 p-3 space-y-2">
              {history.length === 0 ? (
                <div className="text-xs text-slate-400 italic text-center py-4">No history in the past 60 days.</div>
              ) : history.map(r => {
                const chip = statusChip(r.status);
                return (
                  <div key={r.id} className="p-3 rounded-lg border border-slate-200 bg-white">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-slate-800">{empName(r.employeeId)}</span>
                          <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${chip.cls}`}>{chip.label}</span>
                        </div>
                        <div className="text-[12px] text-slate-600 mt-0.5">{describeRange(r)}</div>
                        {r.note && (
                          <div className="text-[11px] text-slate-500 mt-1">{r.note}</div>
                        )}
                        {r.denialReason && (
                          <div className="text-[11px] text-rose-600 mt-1">Denial reason: {r.denialReason}</div>
                        )}
                        <div className="text-[10px] text-slate-400 mt-1">
                          {r.reviewedAt ? <>reviewed {formatDateTime(r.reviewedAt)}{r.reviewedBy?.name ? ` by ${r.reviewedBy.name}` : ''}</> : <>submitted {formatDateTime(r.createdAt)}</>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {denyTargetId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-800">Deny request</h3>
              <button onClick={() => { setDenyTargetId(null); setDenyReason(''); }} aria-label="Close" className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Reason (optional)</label>
              <textarea
                value={denyReason}
                onChange={e => setDenyReason(e.target.value)}
                rows={3}
                placeholder="Visible to the requester."
                className="w-full border border-slate-300 rounded-lg p-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-rose-400 resize-none"
              />
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
              <button onClick={() => { setDenyTargetId(null); setDenyReason(''); }} className="text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-200 px-3 py-2 rounded-md">Cancel</button>
              <button onClick={submitDeny} className="text-xs font-black uppercase tracking-widest text-white bg-rose-600 hover:bg-rose-700 px-4 py-2 rounded-md shadow-sm">Confirm deny</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

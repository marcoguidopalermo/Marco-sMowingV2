// DAILY AUDIT — the flag RECORD, not a second place to review crew-days.
//
// Flags are raised on the daily entry board, against the crew-day card that
// prompted them (see CrewDayFlagStrip). This screen is what the record is FOR:
//
//   · Open flags first — those are the ones still costing a day its approval.
//   · The per-manager rollup for the month. The individual flag is a
//     correction; the pattern is the management information, and it is what a
//     review conversation actually needs.
//   · Every flag, newest first, filterable by status, division, manager and
//     date range, with the reason and — where resolved — the answer.
//   · Which weekdays have been through the audit, so a skipped day is visible.
//   · Who clocked hours but was on no crew: the error class that becomes
//     unverifiable a week later.
//
// READ-ONLY. Tap a flag to jump to that crew-day on the entry board, which is
// where flagging and signing off happen. The crew-day detail is deliberately
// NOT duplicated here — the entry board already shows it.
import { useMemo, useState } from 'react';
import {
  AlertCircle, Check, ChevronLeft, ChevronRight, Clock, Flag, MessageSquare, Users,
} from 'lucide-react';
import type { AppData, CrewDayAudit, CrewDayFlag, UserRole } from '../types';
import { addDaysToronto, formatTodayInToronto } from '../lib/dateUtils';
import { buildAuditHistory, buildDailyAudit } from '../lib/dailyAudit';
import { canFlagCrewDay, FLAG_LABELS } from '../lib/crewDayFlags';
import {
  buildFlagRows, buildManagerRollup, divisionsInRecord, filterFlagRows,
  managersInRecord, type FlagFilters, type FlagRow,
} from '../lib/flagRecord';

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, {
  weekday: 'short', month: 'short', day: 'numeric',
});

// ── One row in the record ──────────────────────────────────────────────────
function FlagCard({ row, onOpen }: { row: FlagRow; onOpen: () => void }) {
  const f = row.flag;
  const open = f.status === 'open';
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Open ${f.crewLabel} on ${f.date} on the daily entry board`}
      className={`w-full text-left rounded-xl border px-4 py-3 hover:ring-2 hover:ring-slate-300 ${open ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-800">{f.crewLabel}</div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {dayLabel(f.date)}
            {row.manager ? ` · ${row.manager.name}` : ' · no manager assigned'}
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${open ? 'bg-amber-200 text-amber-900' : 'bg-emerald-100 text-emerald-800'}`}>
          {open ? FLAG_LABELS.open : FLAG_LABELS.resolved}
        </span>
      </div>

      <div className="mt-2 text-[13px] text-slate-800">{f.reason}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">
        {f.raisedBy.name} · {new Date(f.raisedAt).toLocaleString()}
      </div>

      {f.status === 'resolved' && (
        <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
            Signed off{f.resolvedBy ? ` · ${f.resolvedBy.name}` : ''}
            {row.daysToResolve !== null && ` · ${row.daysToResolve}d`}
          </div>
          <div className="text-[13px] text-slate-800 mt-1">{f.resolutionNote}</div>
        </div>
      )}
      {open && (
        <div className="mt-2 text-[11px] font-semibold text-amber-800">
          Not counting toward efficiency or bonus until signed off.
        </div>
      )}
    </button>
  );
}

export default function DailyAuditView({
  appData, flags, audits, role, onMarkAudited, onOpenCrewDay,
}: {
  appData: AppData;
  flags: CrewDayFlag[];
  audits: Record<string, CrewDayAudit>;
  role: UserRole | null | undefined;
  onMarkAudited: (date: string, crewDays: number, flagged: number) => Promise<boolean>;
  /**
   * Jump to a crew-day on the daily entry board — the division is passed so the
   * board can widen a division filter that would otherwise hide the card.
   */
  onOpenCrewDay: (date: string, crewId: string, division: string) => void;
}) {
  const today = formatTodayInToronto();
  // The audited history and the unassigned list are per-date, so the strip
  // doubles as the date selector. Opens on yesterday — the duty's subject.
  const [date, setDate] = useState(() => addDaysToronto(today, -1));
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [filters, setFilters] = useState<FlagFilters>({ status: 'all', division: 'all', managerId: 'all' });
  const [marking, setMarking] = useState(false);

  const employees = appData.employees || [];
  const rows = useMemo(() => buildFlagRows(flags, employees), [flags, employees]);
  const openRows = useMemo(() => rows.filter(r => r.flag.status === 'open'), [rows]);
  const filtered = useMemo(() => filterFlagRows(rows, filters), [rows, filters]);
  const rollup = useMemo(
    () => buildManagerRollup(flags, employees, month), [flags, employees, month],
  );
  const divisions = useMemo(() => divisionsInRecord(flags), [flags]);
  const managers = useMemo(() => managersInRecord(flags, employees), [flags, employees]);

  // Only for the audited stamp's counts and the unassigned list — the crew-day
  // detail itself is not rendered here.
  const day = useMemo(
    () => buildDailyAudit({ appData, date, flags, audits }),
    [appData, date, flags, audits],
  );
  const history = useMemo(
    () => buildAuditHistory({
      performance: appData.performance || {}, audits, today, days: 21,
    }),
    [appData.performance, audits, today],
  );
  const canMark = canFlagCrewDay(role);
  const set = (patch: Partial<FlagFilters>) => setFilters(f => ({ ...f, ...patch }));

  return (
    <div className="space-y-4">
      {/* ── OPEN FLAGS ─────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Flag className="w-4 h-4 text-amber-600" />
          <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">
            {openRows.length === 0
              ? 'Nothing needs attention'
              : `${openRows.length} needs attention`}
          </span>
        </div>
        {openRows.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-[13px] text-slate-500">
            No open flags. Every crew-day that was queried has been signed off.
          </div>
        ) : (
          <div className="space-y-2">
            {openRows.map(r => (
              <FlagCard key={r.flag.id} row={r}
                onOpen={() => onOpenCrewDay(r.flag.date, r.flag.crewId, r.flag.division)} />
            ))}
          </div>
        )}
      </div>

      {/* ── PER-MANAGER ROLLUP ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">
            By manager
          </span>
          <input
            type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]"
          />
        </div>
        {rollup.length === 0 ? (
          <div className="px-4 py-5 text-[13px] text-slate-500">
            No flags on crew-days in this month.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rollup.map(r => (
              <div key={r.managerId} className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-slate-800">{r.managerName}</div>
                  <div className="text-[11px] text-slate-400">{r.divisions.join(' · ')}</div>
                </div>
                <div className="flex items-center gap-3 text-[12px] font-mono">
                  <span className="text-slate-500">{r.total} total</span>
                  <span className={r.open > 0 ? 'font-bold text-amber-700' : 'text-slate-400'}>
                    {r.open} open
                  </span>
                  <span className="text-emerald-700">{r.resolved} resolved</span>
                  {r.avgDaysToResolve !== null && (
                    <span className="text-slate-400">{r.avgDaysToResolve}d avg</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── THE RECORD ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">
            All flags ({filtered.length})
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={filters.status} onChange={e => set({ status: e.target.value as FlagFilters['status'] })}
              className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]">
              <option value="all">Any status</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
            </select>
            <select value={filters.division} onChange={e => set({ division: e.target.value })}
              className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]">
              <option value="all">Any division</option>
              {divisions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={filters.managerId} onChange={e => set({ managerId: e.target.value })}
              className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]">
              <option value="all">Any manager</option>
              {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input type="date" value={filters.from || ''} onChange={e => set({ from: e.target.value })}
              title="Crew-days from" className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]" />
            <input type="date" value={filters.to || ''} onChange={e => set({ to: e.target.value })}
              title="Crew-days to" className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]" />
            {(filters.from || filters.to || filters.status !== 'all'
              || filters.division !== 'all' || filters.managerId !== 'all') && (
              <button
                onClick={() => setFilters({ status: 'all', division: 'all', managerId: 'all' })}
                className="rounded-lg px-2 py-1 text-[12px] font-bold text-slate-500"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-slate-500">
            {rows.length === 0
              ? 'No crew-day has been flagged yet.'
              : 'No flags match these filters.'}
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {filtered.map(r => (
              <FlagCard key={r.flag.id} row={r}
                onOpen={() => onOpenCrewDay(r.flag.date, r.flag.crewId, r.flag.division)} />
            ))}
          </div>
        )}
      </div>

      {/* ── AUDITED / NOT AUDITED ──────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">
          Weekdays audited
        </div>
        <div className="flex flex-wrap gap-1.5">
          {history.map(d => {
            const tone = d.audited ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
              : d.missed ? 'bg-rose-100 text-rose-800 border-rose-300'
                : 'bg-slate-50 text-slate-400 border-slate-200';
            return (
              <button
                key={d.date} onClick={() => setDate(d.date)}
                title={d.audited ? `Audited by ${d.auditedByName}`
                  : d.noWork ? 'No work recorded' : 'Not audited'}
                className={`rounded-lg border px-2 py-1 text-[11px] font-bold ${tone} ${d.date === date ? 'ring-2 ring-slate-800' : ''}`}
              >
                {d.date.slice(5)}
                {d.audited && d.flaggedCount ? ` · ${d.flaggedCount}⚑` : ''}
              </button>
            );
          })}
        </div>
        <div className="mt-2 text-[11px] text-slate-400">
          Green audited · red not audited · grey no work recorded. Weekends excluded.
        </div>
      </div>

      {/* ── THE SELECTED DATE: who isn't accounted for, and sign-off ───── */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2">
          <button onClick={() => setDate(addDaysToronto(date, -1))}
            className="p-1.5 rounded-lg hover:bg-slate-100" aria-label="Previous day">
            <ChevronLeft className="w-4 h-4 text-slate-600" />
          </button>
          <div className="text-center">
            <div className="text-[13px] font-bold text-slate-800">{dayLabel(date)}</div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {day.totals.crewDays} crew-day{day.totals.crewDays === 1 ? '' : 's'}
              {day.totals.flagged > 0 && ` · ${day.totals.flagged} flagged`}
            </div>
          </div>
          <button onClick={() => setDate(addDaysToronto(date, 1))} disabled={date >= today}
            className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30" aria-label="Next day">
            <ChevronRight className="w-4 h-4 text-slate-600" />
          </button>
        </div>

        {/* EXPLANATIONS — the manager's account of an odd day, with the figures
            it answers, so a number that would prompt a flag arrives already
            explained. Deliberately not the full crew-day detail (the entry
            board has that) — the note plus the numbers it refers to. */}
        {day.explained.length > 0 && (
          <div className="m-3 rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3">
            <div className="flex items-center gap-2 text-sky-800">
              <MessageSquare className="w-4 h-4" />
              <span className="text-[11px] font-black uppercase tracking-widest">
                Explained by the manager · {day.explained.length}
              </span>
            </div>
            <div className="mt-2 space-y-2">
              {day.explained.map(c => (
                <div key={c.crewId} className="rounded-lg bg-white border border-sky-200 px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="text-[13px] font-bold text-slate-800">{c.crewLabel}</span>
                    <span className="text-[11px] font-mono text-slate-500">
                      {c.cBH} BH · {c.cAH} AH · {c.rawEfficiency === null ? '—' : `${c.rawEfficiency}%`}
                      {c.adjustedEfficiency !== null && c.allowancePct > 0 ? ` (adj ${c.adjustedEfficiency}%)` : ''}
                    </span>
                  </div>
                  <div className="text-[13px] text-slate-800 mt-1">{c.approvalNote}</div>
                  {c.approvalNoteBy && (
                    <div className="text-[11px] text-slate-400 mt-0.5">— {c.approvalNoteBy}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {day.workedButUnassignedCount > 0 && (
          <div className="m-3 rounded-xl border-2 border-rose-300 bg-rose-50 px-4 py-3">
            <div className="flex items-center gap-2 text-rose-800">
              <AlertCircle className="w-4 h-4" />
              <span className="text-[11px] font-black uppercase tracking-widest">
                {day.workedButUnassignedCount} worked but on no crew
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {day.unassigned.filter(u => u.worked).map(u => (
                <span key={u.id} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2 py-1">
                  <span className="text-[13px] font-bold text-slate-800">{u.name}</span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono text-rose-700">
                    <Clock className="w-3 h-3" />{u.hoursWorked}h
                  </span>
                </span>
              ))}
            </div>
            <div className="mt-2 text-[12px] text-rose-700">
              They clocked time but appear on no crew and in no crew-day's hours.
            </div>
          </div>
        )}

        {day.unassigned.some(u => !u.worked) && (
          <div className="px-4 py-3 border-t border-slate-100">
            <div className="flex items-center gap-2 text-slate-500">
              <Users className="w-4 h-4" />
              <span className="text-[11px] font-black uppercase tracking-widest">
                Not on a crew, no hours recorded
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {day.unassigned.filter(u => !u.worked).map(u => (
                <span key={u.id} className="rounded-lg border border-slate-200 px-2 py-1 text-[13px] font-semibold text-slate-600">
                  {u.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {canMark && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between gap-3 flex-wrap">
            {day.audited ? (
              <div className="text-[13px] text-slate-600">
                <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700">
                  <Check className="w-4 h-4" /> Audited
                </span>
                {' — '}{day.audited.auditedBy.name}
                {', '}{new Date(day.audited.auditedAt).toLocaleString()}
              </div>
            ) : (
              <>
                <div className="text-[13px] text-slate-600">
                  Been through this day on the entry board?
                </div>
                <button
                  onClick={async () => {
                    setMarking(true);
                    await onMarkAudited(date, day.totals.crewDays, day.totals.flagged);
                    setMarking(false);
                  }}
                  disabled={marking}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
                >
                  {marking ? 'Saving…' : 'Mark audited'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

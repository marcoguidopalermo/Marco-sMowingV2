// DAILY AUDIT — yesterday's crew-days, all divisions, in one place.
//
// James works through this every weekday morning. He audits DAILY rather than
// weekly because whether a worker was actually on a crew is only verifiable
// while it is fresh: a week later there is nothing left to check against.
//
// The layout follows what he is scanning for, in the order the errors matter:
//   1. WHO ISN'T ACCOUNTED FOR — somebody who clocked hours but is on no crew.
//      That is the error that becomes unverifiable, so it goes first and loudest.
//   2. THE CREW-DAYS — crew, people, jobs, BH, AH, efficiency, side by side, so
//      a short crew or an implausible number stands out by comparison.
//   3. THE HISTORY — which days have been through this, so a MISSED day is
//      visible rather than silently skipped.
//
// Language is neutral throughout: "flagged for review", "needs attention",
// "resolved". A flag is a question, not an accusation.
import { useMemo, useState } from 'react';
import {
  AlertCircle, Check, ChevronLeft, ChevronRight, Clock, Flag, MessageSquare, Users,
} from 'lucide-react';
import type { AppData, CrewDayAudit, CrewDayFlag, UserRole, ManagedDivision } from '../types';
import { addDaysToronto, formatTodayInToronto } from '../lib/dateUtils';
import { buildAuditHistory, buildDailyAudit, type AuditCrewRow } from '../lib/dailyAudit';
import {
  canFlagCrewDay, canResolveFlag, crewDayFlaggable, FLAG_LABELS, noteIsUsable,
} from '../lib/crewDayFlags';

const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

// ── One crew-day ───────────────────────────────────────────────────────────
function CrewCard({
  row, canFlag, canResolveThis, onFlag, onResolve, blockedMessage,
}: {
  row: AuditCrewRow;
  canFlag: boolean;
  canResolveThis: boolean;
  onFlag: (crewId: string, reason: string) => Promise<boolean>;
  onResolve: (flagId: string, note: string) => Promise<boolean>;
  blockedMessage?: string;
}) {
  const [open, setOpen] = useState<'flag' | 'resolve' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const flag = row.openFlag;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const ok = flag
      ? await onResolve(flag.id, note)
      : await onFlag(row.crewId, note);
    setBusy(false);
    if (ok) { setOpen(null); setNote(''); }
  };

  return (
    <div className={`rounded-xl border bg-white ${flag ? 'border-amber-400 ring-1 ring-amber-200' : 'border-slate-200'}`}>
      <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-800">{row.crewLabel}</div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {row.headcount} on crew · {row.jobCount} job{row.jobCount === 1 ? '' : 's'}
            {row.isAdHoc && ' · ad-hoc'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {flag && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider">
              <Flag className="w-3 h-3" /> {FLAG_LABELS.flaggedBadge}
            </span>
          )}
          {!flag && row.approvalStatus === 'approved' && (
            <span className="rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider">Approved</span>
          )}
          {!flag && row.approvalStatus === 'waived' && (
            <span className="rounded-full bg-slate-100 text-slate-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider">Waived</span>
          )}
          {!flag && row.approvalStatus === 'pending' && (
            <span className="rounded-full bg-slate-100 text-slate-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider">Not approved</span>
          )}
        </div>
      </div>

      {/* The four numbers, side by side — a short crew or an implausible
          efficiency reads by comparison with its neighbours. */}
      <div className="grid grid-cols-4 divide-x divide-slate-100 border-b border-slate-100">
        {[
          { label: 'BH', value: String(row.cBH) },
          { label: 'AH', value: String(row.cAH) },
          { label: 'Eff', value: pct(row.rawEfficiency) },
          { label: 'Adj', value: pct(row.adjustedEfficiency) },
        ].map(m => (
          <div key={m.label} className="px-3 py-2.5 text-center">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{m.label}</div>
            <div className="text-base font-bold text-slate-800 font-mono">{m.value}</div>
          </div>
        ))}
      </div>
      {row.allowancePct > 0 && (
        <div className="px-4 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          adj includes {row.allowancePct}% allowance
        </div>
      )}

      <div className="px-4 py-3 flex flex-wrap gap-1.5">
        {row.people.length === 0 && (
          <span className="text-[13px] text-slate-400">Nobody recorded on this crew.</span>
        )}
        {row.people.map(p => (
          <span key={p.id} className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 ${p.dropIn ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
            <span className="text-[13px] font-bold text-slate-800">{p.name}</span>
            <span className="text-[11px] font-mono text-slate-500">{p.ah}h</span>
            {p.dropIn && (
              <span className="text-[9px] font-black uppercase tracking-wider text-indigo-500">drop-in</span>
            )}
          </span>
        ))}
      </div>

      {row.jobTitles.length > 0 && (
        <div className="px-4 pb-3 text-[12px] text-slate-500 leading-relaxed">
          {row.jobTitles.join(' · ')}
        </div>
      )}

      {/* The open question and its answer */}
      {flag && (
        <div className="mx-4 mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
          <div className="text-[10px] font-black uppercase tracking-widest text-amber-700">
            {FLAG_LABELS.open}
          </div>
          <div className="text-[13px] text-slate-800 mt-1">{flag.reason}</div>
          <div className="text-[11px] text-slate-500 mt-1">
            {flag.raisedBy.name} · {new Date(flag.raisedAt).toLocaleString()}
          </div>
        </div>
      )}

      <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
        {!flag && canFlag && !blockedMessage && (
          <button
            onClick={() => { setOpen(open === 'flag' ? null : 'flag'); setNote(''); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-bold text-slate-700 hover:bg-slate-50"
          >
            <Flag className="w-3.5 h-3.5" /> {FLAG_LABELS.action}
          </button>
        )}
        {!flag && canFlag && blockedMessage && (
          <span className="text-[12px] text-slate-500 leading-snug">{blockedMessage}</span>
        )}
        {flag && canResolveThis && (
          <button
            onClick={() => { setOpen(open === 'resolve' ? null : 'resolve'); setNote(''); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-700"
          >
            <Check className="w-3.5 h-3.5" /> {FLAG_LABELS.resolveAction}
          </button>
        )}
        {flag && !canResolveThis && (
          <span className="text-[12px] text-slate-500">
            {row.division} manager to sign off.
          </span>
        )}
        {row.flagCount > (flag ? 1 : 0) && (
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
            <MessageSquare className="w-3 h-3" />
            {row.flagCount} review{row.flagCount === 1 ? '' : 's'} on record
          </span>
        )}
      </div>

      {open && (
        <div className="px-4 pb-4">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            {open === 'flag' ? FLAG_LABELS.reasonPrompt : FLAG_LABELS.resolutionPrompt}
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            autoFocus
            className="w-full rounded-lg border border-slate-300 p-2 text-[13px]"
            placeholder={open === 'flag'
              ? 'e.g. Kyle has hours but is not on any crew.'
              : 'e.g. Kyle was lent to #2 that afternoon — hours are correct.'}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={submit}
              disabled={!noteIsUsable(note) || busy}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
            >
              {busy ? 'Saving…' : open === 'flag' ? FLAG_LABELS.action : FLAG_LABELS.resolveAction}
            </button>
            <button
              onClick={() => { setOpen(null); setNote(''); }}
              className="rounded-lg px-3 py-1.5 text-[12px] font-bold text-slate-500"
            >
              Cancel
            </button>
            {!noteIsUsable(note) && (
              <span className="text-[11px] text-slate-400">A note is required.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DailyAuditView({
  appData, flags, audits, role, managedDivision,
  onFlag, onResolve, onMarkAudited,
}: {
  appData: AppData;
  flags: CrewDayFlag[];
  audits: Record<string, CrewDayAudit>;
  role: UserRole | null | undefined;
  managedDivision: ManagedDivision | null | undefined;
  onFlag: (date: string, crewId: string, reason: string) => Promise<boolean>;
  onResolve: (flagId: string, note: string) => Promise<boolean>;
  onMarkAudited: (date: string, crewDays: number, flagged: number) => Promise<boolean>;
}) {
  const today = formatTodayInToronto();
  // Opens on YESTERDAY, because that is what the duty is about.
  const [date, setDate] = useState(() => addDaysToronto(today, -1));
  const [marking, setMarking] = useState(false);

  const audit = useMemo(
    () => buildDailyAudit({ appData, date, flags, audits }),
    [appData, date, flags, audits],
  );
  const history = useMemo(
    () => buildAuditHistory({
      performance: appData.performance || {}, audits, today, days: 21,
    }),
    [appData.performance, audits, today],
  );
  const eligibility = crewDayFlaggable({
    date, today,
    pushedMonths: appData.pushedMonths, archivedDays: appData.archivedDays,
  });
  const canFlag = canFlagCrewDay(role);

  return (
    <div className="space-y-4">
      {/* Date stepper */}
      <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <button
          onClick={() => setDate(addDaysToronto(date, -1))}
          className="p-2 rounded-lg hover:bg-slate-100" aria-label="Previous day"
        >
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div className="text-center min-w-0">
          <div className="text-sm font-bold text-slate-800">
            {new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
              weekday: 'long', month: 'short', day: 'numeric',
            })}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {audit.totals.crewDays} crew-day{audit.totals.crewDays === 1 ? '' : 's'}
            {' · '}{audit.totals.cBH} BH / {audit.totals.cAH} AH
          </div>
        </div>
        <button
          onClick={() => setDate(addDaysToronto(date, 1))}
          disabled={date >= today}
          className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30" aria-label="Next day"
        >
          <ChevronRight className="w-5 h-5 text-slate-600" />
        </button>
      </div>

      {!eligibility.allowed && eligibility.reason !== 'future-date' && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] text-slate-600">
          {eligibility.message}
        </div>
      )}

      {/* 1 — WHO ISN'T ACCOUNTED FOR. First, because it is the error that
          stops being checkable. */}
      {audit.workedButUnassignedCount > 0 && (
        <div className="rounded-xl border-2 border-rose-300 bg-rose-50 px-4 py-3">
          <div className="flex items-center gap-2 text-rose-800">
            <AlertCircle className="w-4 h-4" />
            <span className="text-[11px] font-black uppercase tracking-widest">
              {audit.workedButUnassignedCount} worked but on no crew
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {audit.unassigned.filter(u => u.worked).map(u => (
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

      {/* 2 — THE CREW-DAYS */}
      {audit.crews.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-[13px] text-slate-500">
          No crew-days with work recorded on this date.
        </div>
      ) : (
        <div className="space-y-3">
          {audit.crews.map(row => (
            <CrewCard
              key={row.crewId}
              row={row}
              canFlag={canFlag}
              canResolveThis={canResolveFlag(role, managedDivision, row.division)}
              blockedMessage={eligibility.allowed ? undefined : eligibility.message}
              onFlag={(crewId, reason) => onFlag(date, crewId, reason)}
              onResolve={onResolve}
            />
          ))}
        </div>
      )}

      {/* Unassigned who did NOT work — context, not an error. */}
      {audit.unassigned.some(u => !u.worked) && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2 text-slate-500">
            <Users className="w-4 h-4" />
            <span className="text-[11px] font-black uppercase tracking-widest">
              Not on a crew, no hours recorded
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {audit.unassigned.filter(u => !u.worked).map(u => (
              <span key={u.id} className="rounded-lg border border-slate-200 px-2 py-1 text-[13px] font-semibold text-slate-600">
                {u.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Mark the date audited */}
      {canFlag && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          {audit.audited ? (
            <div className="text-[13px] text-slate-600">
              <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700">
                <Check className="w-4 h-4" /> Audited
              </span>
              {' — '}{audit.audited.auditedBy.name}
              {', '}{new Date(audit.audited.auditedAt).toLocaleString()}
            </div>
          ) : (
            <>
              <div className="text-[13px] text-slate-600">
                Been through this day?
                {audit.totals.flagged > 0 && ` ${audit.totals.flagged} still needs attention.`}
              </div>
              <button
                onClick={async () => {
                  setMarking(true);
                  await onMarkAudited(date, audit.totals.crewDays, audit.totals.flagged);
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

      {/* 3 — THE HISTORY. A missed day is the point. */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">
          Recent weekdays
        </div>
        <div className="flex flex-wrap gap-1.5">
          {history.map(d => {
            const tone = d.audited ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
              : d.missed ? 'bg-rose-100 text-rose-800 border-rose-300'
                : 'bg-slate-50 text-slate-400 border-slate-200';
            return (
              <button
                key={d.date}
                onClick={() => setDate(d.date)}
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
    </div>
  );
}

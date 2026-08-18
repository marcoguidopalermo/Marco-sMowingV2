// FLAG A CREW-DAY, from the crew-day card on the daily entry board.
//
// This lives here rather than on a separate audit screen because it is where
// crews are already being reviewed: the numbers, the people and the jobs are
// all on screen, so the question can be raised against what prompted it.
//
// Raising a flag UNAPPROVES the crew-day, so it stops counting toward
// efficiency, bonus and month totals until a manager signs it off. Both notes
// are required — a flag with no reason is just an unapproval the manager can't
// act on, and a sign-off with no note leaves no answer on the record.
//
// Neutral language throughout: this is a question about a crew-day.
import { useState } from 'react';
import { Check, Flag, MessageSquare } from 'lucide-react';
import type { CrewDayFlag } from '../types';
import { FLAG_LABELS, noteIsUsable } from '../lib/crewDayFlags';

export default function CrewDayFlagStrip({
  crewId, division, openFlag, flagCount, canFlag, canResolveThis,
  blockedMessage, onFlag, onResolve,
}: {
  crewId: string;
  division: string;
  openFlag?: CrewDayFlag;
  /** Every flag ever raised on this crew-day, open or resolved. */
  flagCount: number;
  canFlag: boolean;
  canResolveThis: boolean;
  /** Set when this day can't be flagged (pushed month / archived day). */
  blockedMessage?: string;
  onFlag: (crewId: string, reason: string) => Promise<boolean>;
  onResolve: (flagId: string, note: string) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<'flag' | 'resolve' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Nothing to show and nothing to offer — keep the card as it was.
  if (!openFlag && !canFlag && flagCount === 0) return null;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const ok = openFlag
      ? await onResolve(openFlag.id, note)
      : await onFlag(crewId, note);
    setBusy(false);
    if (ok) { setMode(null); setNote(''); }
  };

  return (
    <div className={`px-4 py-2.5 border-b ${openFlag ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-100'}`}>
      {openFlag ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-black uppercase tracking-widest text-amber-800 flex items-center gap-1.5">
              <Flag className="w-3.5 h-3.5" /> {FLAG_LABELS.flaggedBadge}
            </div>
            <div className="text-[13px] text-slate-800 mt-1">{openFlag.reason}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {openFlag.raisedBy.name} · {new Date(openFlag.raisedAt).toLocaleString()}
              {' · not counting toward efficiency or bonus until signed off'}
            </div>
          </div>
          {canResolveThis ? (
            <button
              onClick={() => { setMode(mode === 'resolve' ? null : 'resolve'); setNote(''); }}
              className="min-h-[40px] text-[11px] font-black uppercase tracking-widest px-3 py-2 rounded-lg flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow"
            >
              <Check className="w-3.5 h-3.5" /> {FLAG_LABELS.resolveAction}
            </button>
          ) : (
            <span className="text-[11px] text-slate-500 self-center">
              {division} manager to sign off.
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            {flagCount > 0 && (
              <>
                <MessageSquare className="w-3 h-3" />
                {flagCount} review{flagCount === 1 ? '' : 's'} on record
              </>
            )}
          </span>
          {canFlag && (blockedMessage ? (
            <span className="text-[11px] text-slate-500 leading-snug">{blockedMessage}</span>
          ) : (
            <button
              onClick={() => { setMode(mode === 'flag' ? null : 'flag'); setNote(''); }}
              className="min-h-[36px] text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg flex items-center gap-1.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-100"
            >
              <Flag className="w-3.5 h-3.5" /> {FLAG_LABELS.action}
            </button>
          ))}
        </div>
      )}

      {mode && (
        <div className="mt-2.5">
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
            {mode === 'flag' ? FLAG_LABELS.reasonPrompt : FLAG_LABELS.resolutionPrompt}
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            autoFocus
            className="w-full rounded-lg border border-slate-300 p-2 text-[13px]"
            placeholder={mode === 'flag'
              ? 'e.g. Kyle has hours but is not on any crew.'
              : 'e.g. Kyle was lent to #2 that afternoon — hours are correct.'}
          />
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <button
              onClick={submit}
              disabled={!noteIsUsable(note) || busy}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-white disabled:opacity-40"
            >
              {busy ? 'Saving…' : mode === 'flag' ? FLAG_LABELS.action : FLAG_LABELS.resolveAction}
            </button>
            <button
              onClick={() => { setMode(null); setNote(''); }}
              className="rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-slate-500"
            >
              Cancel
            </button>
            {!noteIsUsable(note) && (
              <span className="text-[11px] text-slate-400">A note is required.</span>
            )}
            {mode === 'flag' && (
              <span className="text-[11px] text-slate-500">
                Flagging unapproves this crew-day and tells the {division} manager.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

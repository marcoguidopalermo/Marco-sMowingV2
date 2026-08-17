// SCHEDULE BOARD · CREW NOTE.
//
// The note used to be a two-row textarea wedged into the crew card, which gave
// about a line and a half of visible text for something like "start at the
// Rosslyn job first, gate code 4471, Dave needs the small trailer". This is the
// same field with room to write it in.
//
// Saves on close — there is no separate Save button, matching the board's
// autosave-on-blur behaviour everywhere else. Escape cancels without writing,
// so a half-typed thought can be abandoned.
import { useEffect, useRef, useState } from 'react';
import { X, StickyNote, Trash2 } from 'lucide-react';

export default function CrewNoteModal({
  crewLabel, dateLabel, initial, authorName, savedAt, readOnly, onClose, onSave,
}: {
  crewLabel: string;
  dateLabel: string;
  initial: string;
  authorName?: string;
  savedAt?: string;
  readOnly?: boolean;
  onClose: () => void;
  // Called with the trimmed text on close, ONLY when it differs from what was
  // there. An unchanged open-and-close writes nothing and leaves the original
  // author and timestamp alone.
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const initialRef = useRef(initial);

  useEffect(() => {
    ref.current?.focus();
    // Put the caret at the end rather than selecting everything, so typing
    // appends to an existing note instead of replacing it.
    const len = ref.current?.value.length ?? 0;
    ref.current?.setSelectionRange(len, len);
  }, []);

  const commit = () => {
    if (!readOnly && text.trim() !== initialRef.current.trim()) onSave(text.trim());
    onClose();
  };

  const when = savedAt ? new Date(savedAt) : null;
  const whenLabel = when && !Number.isNaN(when.getTime())
    ? when.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog" aria-modal="true" aria-label={`Note for ${crewLabel}`}
      onClick={commit}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.stopPropagation(); onClose(); }   // cancel, no write
      }}>
      <div className="w-full max-w-xl rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-start gap-2">
          <StickyNote className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-black leading-tight text-slate-900">
              {readOnly ? 'Crew note' : 'Note for the crew'}
            </h3>
            <p className="truncate text-[11px] font-bold text-slate-500">{crewLabel} · {dateLabel}</p>
          </div>
          <button type="button" onClick={commit} aria-label="Close and save"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <textarea
          ref={ref}
          value={text}
          readOnly={readOnly}
          onChange={e => setText(e.target.value)}
          rows={8}
          placeholder={'Anything the crew needs to know before they leave — where to start, gate codes, who to call…'}
          className="w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-[15px] leading-relaxed text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30 read-only:bg-slate-50"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold text-slate-400">
            {authorName && whenLabel
              ? `Last written by ${authorName} · ${whenLabel}`
              : readOnly ? '' : 'The crew sees this on My Crew Today.'}
          </span>
          {!readOnly && text.trim().length > 0 && (
            <button type="button"
              onClick={() => { setText(''); }}
              className="ml-auto inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-widest text-rose-600">
              <Trash2 className="h-3 w-3" /> Clear
            </button>
          )}
        </div>

        <button type="button" onClick={commit}
          className="mt-3 min-h-[44px] w-full rounded-xl bg-slate-800 px-4 text-sm font-black text-white">
          {readOnly ? 'Close' : 'Save & close'}
        </button>
      </div>
    </div>
  );
}

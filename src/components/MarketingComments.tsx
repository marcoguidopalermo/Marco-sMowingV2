// MarketingComments — ONE comment thread, used by every commentable surface on
// the Marketing page: clip feedback, reference links and to-dos.
//
// There is one component, one storage shape and one write path. Three parallel
// thread implementations would drift and mean fixing the same bug three times,
// so a surface says WHAT is being discussed — a subject, {subjectType,
// subjectId} — and gets the same thread, the same composer and the same
// delete behaviour for free.
//
// STORAGE — deliberately still marketingFeedback/{id}, the collection the clip
// threads already live in. That collection was always "one doc per message,
// grouped by what it's about"; the only change is that "what it's about" is now
// a subject rather than always a clip. Existing docs carry `clip` and no
// subject fields, and `commentSubject` reads them as {clip, <that number>} —
// so every message written before this change keeps its thread, its text, its
// byline and its timestamp exactly as it was. No migration, no rewrite, no
// backfill: nothing is touched on disk.
import { useState } from 'react';
import { CornerDownRight, MessageSquare, Trash2 } from 'lucide-react';
import type { MarketingFeedbackEntry } from '../types';

// The three things you can talk about on this page.
export type MarketingSubjectType = 'clip' | 'link' | 'todo';
export interface MarketingSubject {
  subjectType: MarketingSubjectType;
  subjectId: string;
}

const SUBJECT_TYPES: MarketingSubjectType[] = ['clip', 'link', 'todo'];

// ── ids and stamps ─────────────────────────────────────────────────────
export function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function prettyStamp(ms?: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// ── clip numbers ───────────────────────────────────────────────────────
// Footage is numbered in Drive as #0058. People type that four different
// ways, and every one of them has to land on the same thread — otherwise the
// conversation silently forks and half the feedback goes missing.
//
// "#0058", "0058", " 58 ", "#58" → "58". Leading zeros are presentation, not
// identity, so they're stripped from the key and re-applied on display.
// Non-numeric clip names (a "0058B" alt take) are kept verbatim, uppercased.
// The result doubles as a Firestore doc id, so anything outside [A-Z0-9_-] is
// dropped rather than risking an invalid path.
export function clipKey(raw: string): string {
  const v = (raw || '').trim().replace(/^#+/, '').trim().toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
  if (!v) return '';
  if (/^\d+$/.test(v)) return String(parseInt(v, 10));
  return v;
}

// Key → what the user sees. Pure numbers get padded back to the 4-digit house
// style (#0058); anything else is shown as typed.
export function clipLabel(key: string): string {
  if (!key) return '';
  return /^\d+$/.test(key) ? `#${key.padStart(4, '0')}` : `#${key}`;
}

// ── the subject ────────────────────────────────────────────────────────
// THE back-compat seam. A message written before subjects existed has `clip`
// and nothing else; it reads as a clip subject, which is exactly what it is.
// A message written now carries subjectType/subjectId, and clip messages ALSO
// keep writing `clip` so the old shape stays true on disk and any reader that
// still groups on it keeps working.
export function commentSubject(e: MarketingFeedbackEntry): MarketingSubject {
  const type = SUBJECT_TYPES.includes(e.subjectType as MarketingSubjectType)
    ? (e.subjectType as MarketingSubjectType)
    : 'clip';
  const raw = (type === 'clip' ? (e.subjectId || e.clip) : e.subjectId) || '';
  return { subjectType: type, subjectId: type === 'clip' ? clipKey(raw) : raw };
}

// Map key for grouping. Type-prefixed, so a to-do and a clip that happen to
// share an id can never land in the same thread.
export function subjectKey(s: MarketingSubject): string {
  return `${s.subjectType}:${s.subjectId}`;
}

// Every comment, grouped by subject, oldest first WITHIN a thread — it's a
// conversation, and a back-and-forth read bottom-up is not a conversation.
// Threads are derived by grouping, never stored: no parent pointer to corrupt,
// and a reply is just another row.
export function groupComments(
  feedback: Record<string, MarketingFeedbackEntry>,
): Map<string, MarketingFeedbackEntry[]> {
  const out = new Map<string, MarketingFeedbackEntry[]>();
  for (const e of Object.values(feedback)) {
    const s = commentSubject(e);
    if (!s.subjectId) continue;
    const k = subjectKey(s);
    const list = out.get(k);
    if (list) list.push(e); else out.set(k, [e]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }
  return out;
}

// Build a message on a subject. createdBy / createdAt are deliberately absent —
// they are stamped by the save handler from the signed-in identity, never from
// anything a panel could get wrong.
export function newComment(s: MarketingSubject, text: string): MarketingFeedbackEntry {
  return {
    id: newId('mf'),
    subjectType: s.subjectType,
    subjectId: s.subjectId,
    // Clip messages keep the original field as well, so the shape on disk is
    // identical to every message written before subjects existed.
    clip: s.subjectType === 'clip' ? s.subjectId : undefined,
    text,
  };
}

// A count chip for a surface that keeps its thread collapsed (links, to-dos).
// Renders NOTHING at zero — an item nobody has commented on shows no extra
// furniture at all.
export function CommentCount({
  n, open, onClick, label = 'comment',
}: {
  n: number;
  open: boolean;
  onClick: () => void;
  label?: string;
}) {
  if (!n && !open) return null;
  return (
    <button
      onClick={onClick}
      title={open ? 'Hide the discussion' : `${n} ${label}${n === 1 ? '' : 's'} — tap to read and reply`}
      className={`inline-flex items-center gap-1 shrink-0 min-h-[32px] px-2 rounded-full border text-[10px] font-black uppercase tracking-widest ${
        open
          ? 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300'
          : 'bg-slate-50 text-slate-500 border-slate-200 hover:text-fuchsia-700 hover:border-fuchsia-200'
      }`}
    >
      <MessageSquare className="w-3 h-3" /> {n || ''}
    </button>
  );
}

// ── the thread ─────────────────────────────────────────────────────────
// The messages plus the composer. `composer` is the only difference between
// the three surfaces: clip feedback keeps its Reply button (the threads are
// always on screen, so an always-open box on every one of them would be a wall
// of textareas), while links and to-dos are already expanded by the time this
// renders and want to type straight away.
export function CommentThread({
  entries, onAdd, onDelete, composer = 'toggle', placeholder = 'Write a comment…',
  replyLabel = 'Reply',
}: {
  entries: MarketingFeedbackEntry[];
  onAdd: (text: string) => void;
  onDelete: (id: string) => void;
  composer?: 'toggle' | 'always';
  placeholder?: string;
  replyLabel?: string;
}) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(composer === 'always');

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft('');
    if (composer === 'toggle') setOpen(false);
  };

  return (
    <div className="space-y-2">
      {entries.map(e => (
        <div key={e.id} className="flex items-start gap-2">
          <div className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <p className="text-sm font-bold text-slate-800 whitespace-pre-wrap break-words">{e.text}</p>
            <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">
              {e.createdBy?.name || 'Unknown'}
              {e.createdAt ? ` · ${prettyStamp(e.createdAt)}` : ''}
            </span>
          </div>
          <button
            onClick={() => onDelete(e.id)}
            aria-label="Delete comment"
            className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center text-slate-200 hover:text-rose-600 shrink-0"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}

      {open ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={placeholder}
            rows={3}
            autoFocus={composer === 'toggle'}
            className="w-full border border-gray-300 rounded-lg p-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400 resize-y min-h-[76px]"
          />
          <div className="flex justify-end gap-2">
            {composer === 'toggle' && (
              <button
                onClick={() => { setOpen(false); setDraft(''); }}
                className="min-h-[40px] px-3 text-slate-500 hover:bg-slate-100 rounded-lg text-[11px] font-black uppercase tracking-widest"
              >
                Cancel
              </button>
            )}
            <button
              onClick={send}
              disabled={!draft.trim()}
              className="min-h-[40px] px-4 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-40 text-white rounded-lg text-[11px] font-black uppercase tracking-widest shadow"
            >
              {replyLabel}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="min-h-[40px] px-2 inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-fuchsia-700"
        >
          <CornerDownRight className="w-3.5 h-3.5" /> {replyLabel}
        </button>
      )}
    </div>
  );
}

// MarketingMaster — one module, one scroll: CALENDAR · TO-DO · SHOT QUEUE ·
// LINKS · CLIP FEEDBACK · POST QUEUE. No tabs, no navigation.
//
// Built for a marketer who is just starting, so it stays deliberately thin:
//   • Calendar — a month of planned content. No platform split (everything is
//     cross-posted), no approval chain, no recurrence.
//   • To-do — ONE shared list for everyone with marketing access. Two-state
//     priority, optional due date, no owner and no per-item permissions.
//   • Shot queue — work that still needs filming. Fed by hand and by promoting
//     a reference link ("make something like this"). ONE list, not two: the
//     old "shots to follow up" IS this queue (see MarketingShot in types.ts).
//   • Links — a board of saved references. Paste a URL, hit save, done. A link
//     can be sent to the shot queue and STAYS here, badged.
//   • Clip feedback — review notes against a Drive clip number, threaded per
//     clip. The footage stays in Drive; only the words live here.
//
// All THREE commentable surfaces here — clip feedback, reference links and
// to-dos — run on the one thread component in MarketingComments.tsx, over one
// subject shape and one collection. See that file for why.
//   • Post queue — reviewed clips in the order they go out. Fed from clip
//     feedback; each row is keyed by the clip number, so its thread is always
//     one click away and can never be orphaned.
//
// The two queues read top-to-bottom as the actual pipeline:
//   link → shot queue → (filmed) → clip feedback → post queue → posted.
//
// Nothing here reads or writes any other surface: no crews, no schedule, no
// performance, no pay. The six subcollections are the whole data footprint.
import { useMemo, useRef, useState } from 'react';
import {
  CalendarDays, Camera, Link2, ChevronLeft, ChevronRight, Plus, X, Trash2,
  ExternalLink, Check, Paperclip, Pencil, Megaphone, MessageSquare, Search,
  RotateCcw, Send, ArrowUp, ArrowDown, ListChecks, Flag,
} from 'lucide-react';
import type {
  MarketingClipStatus, MarketingClipThread, MarketingContentItem,
  MarketingContentStatus, MarketingFeedbackEntry, MarketingLink, MarketingShot,
  MarketingPostQueueEntry, MarketingTodo, MarketingTodoPriority,
} from '../types';
import {
  CommentCount, CommentThread, clipKey, clipLabel, groupComments,
  newComment, newId, prettyStamp, subjectKey,
} from './MarketingComments';
import type { MarketingSubject } from './MarketingComments';

interface Props {
  content: Record<string, MarketingContentItem>;
  shots: Record<string, MarketingShot>;
  links: Record<string, MarketingLink>;
  // Every comment on the page, whatever it is about — clips, links and to-dos
  // share one collection and one component. Threads are derived by subject.
  comments: Record<string, MarketingFeedbackEntry>;
  clips: Record<string, MarketingClipThread>;
  postQueue: Record<string, MarketingPostQueueEntry>;
  currentUser: { email: string; name: string };
  onSaveContent: (item: MarketingContentItem) => void;
  onDeleteContent: (id: string) => void;
  onSaveShot: (shot: MarketingShot) => void;
  onDeleteShot: (id: string) => void;
  onSaveLink: (link: MarketingLink) => void;
  onDeleteLink: (id: string) => void;
  onSaveComment: (entry: MarketingFeedbackEntry) => void;
  onDeleteComment: (id: string) => void;
  onSaveClip: (thread: MarketingClipThread) => void;
  onSavePostQueue: (entry: MarketingPostQueueEntry) => void;
  onDeletePostQueue: (id: string) => void;
  todos: Record<string, MarketingTodo>;
  onSaveTodo: (todo: MarketingTodo) => void;
  onDeleteTodo: (id: string) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const STATUSES: MarketingContentStatus[] = ['idea', 'planned', 'scheduled', 'posted'];

// Status → chip colours. Static class strings so Tailwind keeps them.
const STATUS_CHIP: Record<MarketingContentStatus, string> = {
  idea: 'bg-slate-100 text-slate-700 border-slate-300',
  planned: 'bg-sky-100 text-sky-800 border-sky-300',
  scheduled: 'bg-amber-100 text-amber-800 border-amber-300',
  posted: 'bg-lime-100 text-lime-800 border-lime-400',
};
const STATUS_DOT: Record<MarketingContentStatus, string> = {
  idea: 'bg-slate-400',
  planned: 'bg-sky-500',
  scheduled: 'bg-amber-500',
  posted: 'bg-lime-500',
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function prettyDate(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// "Aug 22" — for chips where the weekday is noise and the width is scarce.
function shortDate(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Best-effort URL normalize. A pasted "instagram.com/reel/xyz" is a URL as far
// as the user is concerned, so add the scheme rather than rejecting it.
function normalizeUrl(raw: string): string {
  const v = (raw || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

function parseUrl(raw: string): URL | null {
  try { return new URL(normalizeUrl(raw)); } catch { return null; }
}

// Derive a readable title from the URL alone — that's all we can do without a
// network fetch, and fetching a title is not worth a v1. The manual title/note
// field is always there when this guess isn't good enough.
function titleFromUrl(raw: string): string {
  const u = parseUrl(raw);
  if (!u) return '';
  const host = u.hostname.replace(/^www\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  if (/instagram\.com$/i.test(host)) {
    if (parts[0] === 'reel' || parts[0] === 'reels') return 'Instagram reel';
    if (parts[0] === 'p') return 'Instagram post';
    if (parts[0] === 'tv') return 'Instagram video';
    if (parts[0]) return `Instagram · @${parts[0]}`;
    return 'Instagram';
  }
  if (/(youtube\.com|youtu\.be)$/i.test(host)) return 'YouTube video';
  if (/tiktok\.com$/i.test(host)) return 'TikTok video';
  if (/facebook\.com$/i.test(host)) return 'Facebook post';
  // Everything else: humanize the last meaningful path segment, else the host.
  const last = [...parts].reverse().find(p => !/^\d+$/.test(p) && p.length > 2);
  if (last) {
    const words = decodeURIComponent(last)
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[-_+]+/g, ' ')
      .trim();
    if (words) return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return host;
}

function hostOf(raw: string): string {
  const u = parseUrl(raw);
  return u ? u.hostname.replace(/^www\./, '') : raw;
}

export default function MarketingMaster({
  content, shots, links, comments, clips, postQueue, currentUser,
  onSaveContent, onDeleteContent,
  onSaveShot, onDeleteShot,
  onSaveLink, onDeleteLink,
  onSaveComment, onDeleteComment, onSaveClip,
  onSavePostQueue, onDeletePostQueue,
  todos, onSaveTodo, onDeleteTodo,
}: Props) {
  // `links` is normalized on the way in so every consumer below can treat it
  // as an array — a doc written before the field existed (or one whose empty
  // array round-tripped as null) must not crash the calendar.
  const contentList = useMemo(
    () => Object.values(content)
      .map(i => ({ ...i, links: i.links || [] }))
      .sort((a, b) => (a.date || '').localeCompare(b.date || '')),
    [content],
  );
  const linkList = useMemo(
    () => Object.values(links).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)),
    [links],
  );

  // ONE grouping for the whole page: every comment, keyed by its subject. All
  // three commentable panels read their threads out of this map, so there is a
  // single traversal and a single definition of "which thread is this in".
  const threads = useMemo(() => groupComments(comments), [comments]);
  const addComment = (s: MarketingSubject, text: string) => onSaveComment(newComment(s, text));

  return (
    <div className="flex-1 overflow-y-auto bg-gray-100">
      <div className="px-3 md:px-5 py-3 md:py-4 max-w-[1700px] mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <div className="bg-fuchsia-100 p-1.5 rounded-lg"><Megaphone className="w-5 h-5 text-fuchsia-700" /></div>
          <h1 className="text-lg md:text-xl font-black uppercase tracking-widest text-slate-800">Marketing</h1>
        </div>

        {/* (a) CONTENT CALENDAR — the anchor. Widest, first, and on a wide
            screen it carries its scan-list in a column beside the grid; below
            xl that column drops underneath. */}
        <CalendarSection
          items={contentList}
          links={links}
          currentUser={currentUser}
          onSave={onSaveContent}
          onDelete={onDeleteContent}
          onSaveLink={onSaveLink}
        />

        {/* (b) TO-DO — one shared list, directly under the calendar: it is
            the "what do I actually need to do" of this board, so it sits
            above the pipeline panels rather than beside them. */}
        <TodoPanel
          todos={todos}
          threads={threads}
          onSave={onSaveTodo}
          onDelete={onDeleteTodo}
          onAddComment={addComment}
          onDeleteComment={onDeleteComment}
        />

        {/* (c) SHOT QUEUE and (d) LINKS — compact panels side by side on
            desktop, stacked in that order on a phone. Adjacent on purpose:
            promoting a link to the shot queue moves it one panel left. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <ShotsPanel shots={shots} links={links} onSave={onSaveShot} onDelete={onDeleteShot} />
          <LinksPanel
            links={linkList}
            items={contentList}
            shots={shots}
            threads={threads}
            currentUser={currentUser}
            onSaveLink={onSaveLink}
            onDeleteLink={onDeleteLink}
            onSaveContent={onSaveContent}
            onSaveShot={onSaveShot}
            onAddComment={addComment}
            onDeleteComment={onDeleteComment}
          />
        </div>

        {/* (e) CLIP FEEDBACK — full width. The footage lives in Drive; this
            holds only the conversation about it, keyed by clip number. */}
        <FeedbackPanel
          threads={threads}
          clips={clips}
          postQueue={postQueue}
          onAddComment={addComment}
          onDeleteComment={onDeleteComment}
          onSaveClip={onSaveClip}
          onSavePostQueue={onSavePostQueue}
        />

        {/* (f) POST QUEUE — last, because it is the end of the pipeline: a
            clip only lands here once its feedback is done. It reaches back UP
            to the calendar: scheduling a queued clip writes a calendar entry,
            which is why the panel takes the content list and its writers. */}
        <PostQueuePanel
          postQueue={postQueue}
          threads={threads}
          content={contentList}
          onSave={onSavePostQueue}
          onDelete={onDeletePostQueue}
          onSaveContent={onSaveContent}
          onDeleteContent={onDeleteContent}
        />
      </div>
    </div>
  );
}

// A section shell: heading strip + body. Keeps the three sections visually
// parallel so the page reads as one screen rather than three pasted modules.
function Panel({
  title, Icon, count, action, children,
}: {
  title: string;
  Icon: typeof CalendarDays;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 flex-wrap">
        <Icon className="w-4 h-4 text-fuchsia-600 shrink-0" />
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-700">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">{count}</span>
        )}
        {action && <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-2 flex-wrap">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/* ══════════════════════ CALENDAR ══════════════════════════════════════ */

function CalendarSection({
  items, links, currentUser, onSave, onDelete, onSaveLink,
}: {
  items: MarketingContentItem[];
  links: Record<string, MarketingLink>;
  currentUser: { email: string; name: string };
  onSave: (i: MarketingContentItem) => void;
  onDelete: (id: string) => void;
  onSaveLink: (l: MarketingLink) => void;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-11
  const [editing, setEditing] = useState<MarketingContentItem | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthItems = useMemo(
    () => items.filter(i => (i.date || '').startsWith(monthPrefix)),
    [items, monthPrefix],
  );
  const byDate = useMemo(() => {
    const map = new Map<string, MarketingContentItem[]>();
    for (const i of monthItems) {
      const list = map.get(i.date);
      if (list) list.push(i); else map.set(i.date, [i]);
    }
    return map;
  }, [monthItems]);

  const step = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  // Leading blanks so the 1st lands under its weekday, then the real days.
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${monthPrefix}-${String(i + 1).padStart(2, '0')}`),
  ];

  const blank = (date: string): MarketingContentItem => ({
    id: newId('mc'), title: '', date, status: 'idea', notes: '', links: [],
  });

  // Drag-to-reschedule. Same write as editing the date field, so there is no
  // second code path to keep honest.
  const dropOn = (date: string) => {
    if (!dragId) return;
    const item = items.find(i => i.id === dragId);
    setDragId(null);
    if (!item || item.date === date) return;
    onSave({ ...item, date });
  };

  return (
    <Panel
      title="Content calendar"
      Icon={CalendarDays}
      count={monthItems.length}
      action={(
        <>
          <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
            <button onClick={() => step(-1)} aria-label="Previous month" className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-500 hover:bg-slate-50"><ChevronLeft className="w-5 h-5" /></button>
            <div className="px-2 text-xs font-black uppercase tracking-widest text-slate-700 whitespace-nowrap">{MONTHS[month].slice(0, 3)} {year}</div>
            <button onClick={() => step(1)} aria-label="Next month" className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-500 hover:bg-slate-50"><ChevronRight className="w-5 h-5" /></button>
          </div>
          <button
            onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}
            className="min-h-[40px] px-3 border border-gray-300 rounded-lg text-[11px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50"
          >
            Today
          </button>
          <button
            onClick={() => setEditing(blank(ymd(today)))}
            className="min-h-[40px] px-3 bg-fuchsia-600 hover:bg-fuchsia-700 text-white rounded-lg text-[11px] font-black uppercase tracking-widest shadow flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> New
          </button>
        </>
      )}
    >
      {/* Grid + scan-list. Side by side from xl; below that the list drops
          under the grid. Both are live at once — no toggle to discover. */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 overflow-x-auto border-b xl:border-b-0 xl:border-r border-gray-200">
          <div className="grid grid-cols-7 border-b border-gray-200 bg-slate-50">
            {WEEKDAYS.map(w => (
              <div key={w} className="py-2 text-center text-[9px] md:text-[10px] font-black uppercase tracking-widest text-slate-400">
                <span className="md:hidden">{w[0]}</span><span className="hidden md:inline">{w}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((date, idx) => {
              if (!date) return <div key={`b-${idx}`} className="min-h-[72px] md:min-h-[112px] border-b border-r border-slate-100 bg-slate-50/50" />;
              const dayItems = byDate.get(date) || [];
              const isToday = date === ymd(today);
              return (
                <div
                  key={date}
                  onDragOver={e => { if (dragId) e.preventDefault(); }}
                  onDrop={() => dropOn(date)}
                  className={`min-h-[72px] md:min-h-[112px] border-b border-r border-slate-100 p-1 flex flex-col gap-1 ${isToday ? 'bg-fuchsia-50/60' : 'bg-white'}`}
                >
                  <button
                    onClick={() => setEditing(blank(date))}
                    title="Add content on this day"
                    className={`self-start text-[10px] md:text-xs font-black rounded px-1.5 py-0.5 ${isToday ? 'bg-fuchsia-600 text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}
                  >
                    {Number(date.slice(-2))}
                  </button>
                  {dayItems.map(item => (
                    <button
                      key={item.id}
                      draggable
                      // Firefox refuses to start a drag unless dataTransfer
                      // carries something; the payload itself is unused.
                      onDragStart={e => { e.dataTransfer.setData('text/plain', item.id); setDragId(item.id); }}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => setEditing(item)}
                      className={`text-left text-[10px] md:text-[11px] leading-tight font-bold px-1.5 py-1 rounded border truncate ${STATUS_CHIP[item.status]} ${dragId === item.id ? 'opacity-40' : ''}`}
                      title={`${item.title} · ${item.status}`}
                    >
                      {item.title || 'Untitled'}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Scan list — the same month, top to bottom, for anyone who'd rather
            read than look. Scrolls in its own column on a wide screen. */}
        <div className="min-w-0 xl:max-h-[640px] xl:overflow-y-auto divide-y divide-slate-100">
          {monthItems.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-400 font-bold">Nothing planned for {MONTHS[month]}.</div>
          )}
          {monthItems.map(item => {
            const clip = clipKey(item.clip || '');
            return (
              <div key={item.id} className="flex items-start hover:bg-slate-50">
                <button
                  onClick={() => setEditing(item)}
                  className="min-w-0 flex-1 text-left pl-4 pr-1 py-3 flex items-start gap-3 min-h-[56px]"
                >
                  <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_DOT[item.status]}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-800 truncate">{item.title || 'Untitled'}</span>
                    <span className="block text-[11px] font-bold uppercase tracking-widest text-slate-400">
                      {prettyDate(item.date)} · {item.status}
                      {item.links.length > 0 && ` · ${item.links.length} link${item.links.length === 1 ? '' : 's'}`}
                    </span>
                    {item.notes && <span className="block text-xs text-slate-500 mt-0.5 line-clamp-2">{item.notes}</span>}
                    <Byline created={item.createdBy} createdAt={item.createdAt} updated={item.updatedBy} updatedAt={item.updatedAt} />
                  </span>
                </button>
                {/* Straight back to the clip's feedback thread when this entry
                    was scheduled from the post queue. Outside the row button so
                    it stays a real link, not a nested (invalid) button. */}
                {clip && (
                  <a
                    href={`#clip-${clip}`}
                    title={`Feedback thread for ${clipLabel(clip)}`}
                    className="mt-3 shrink-0 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-fuchsia-700 bg-fuchsia-50 border border-fuchsia-200 rounded-full px-2 py-1 hover:bg-fuchsia-100"
                  >
                    <MessageSquare className="w-3 h-3" /> {clipLabel(clip)}
                  </a>
                )}
                <Pencil className="w-4 h-4 text-slate-300 shrink-0 mt-4 mx-3" />
              </div>
            );
          })}
        </div>
      </div>

      {editing && (
        <ContentEditor
          item={editing}
          links={links}
          isNew={!items.some(i => i.id === editing.id)}
          currentUser={currentUser}
          onClose={() => setEditing(null)}
          onSave={i => { onSave(i); setEditing(null); }}
          onDelete={id => { onDelete(id); setEditing(null); }}
          onSaveLink={onSaveLink}
        />
      )}
    </Panel>
  );
}

function ContentEditor({
  item, links, isNew, currentUser, onClose, onSave, onDelete, onSaveLink,
}: {
  item: MarketingContentItem;
  links: Record<string, MarketingLink>;
  isNew: boolean;
  currentUser: { email: string; name: string };
  onClose: () => void;
  onSave: (i: MarketingContentItem) => void;
  onDelete: (id: string) => void;
  onSaveLink: (l: MarketingLink) => void;
}) {
  const [draft, setDraft] = useState<MarketingContentItem>({ ...item });
  const [newUrl, setNewUrl] = useState('');

  // Attaching a link from here mints a MarketingLink (so it also lands on the
  // board) and records its id on the item — attachment lives in exactly one
  // place, on the item.
  const attachUrl = () => {
    const url = normalizeUrl(newUrl);
    if (!url) return;
    const link: MarketingLink = {
      id: newId('ml'),
      url,
      title: titleFromUrl(url) || hostOf(url),
      addedBy: currentUser,
      addedAt: Date.now(),
    };
    onSaveLink(link);
    setDraft(d => ({ ...d, links: [...d.links, link.id] }));
    setNewUrl('');
  };

  const save = () => {
    const title = draft.title.trim();
    if (!title) return;
    onSave({ ...draft, title, notes: (draft.notes || '').trim() });
  };

  return (
    <Sheet title={isNew ? 'New content' : 'Edit content'} onClose={onClose}>
      <div className="space-y-4">
        {/* Scheduled from the post queue. The clip key is the whole link: it
            reaches the review conversation, and it is how the queue row finds
            this entry's date. Closing the sheet first so the jump lands on a
            visible thread. */}
        {clipKey(draft.clip || '') && (
          <div className="rounded-lg border border-fuchsia-200 bg-fuchsia-50 px-3 py-2.5">
            <a
              href={`#clip-${clipKey(draft.clip!)}`}
              onClick={onClose}
              className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-fuchsia-700 hover:underline"
            >
              <MessageSquare className="w-4 h-4" /> {clipLabel(clipKey(draft.clip!))} · feedback thread
            </a>
            <p className="text-[11px] font-bold text-fuchsia-700/70 mt-1">
              Scheduled from the post queue. The date here is the one the queue shows;
              deleting this entry returns the clip to the queue undated.
            </p>
          </div>
        )}

        <Field label="Title">
          <input
            autoFocus
            value={draft.title}
            onChange={e => setDraft({ ...draft, title: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
            placeholder="Before / after — Riverside patio"
            className="w-full border border-gray-300 rounded-lg p-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Date">
            <input
              type="date"
              value={draft.date}
              onChange={e => setDraft({ ...draft, date: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400"
            />
          </Field>
          <Field label="Status">
            <div className="grid grid-cols-2 gap-1.5">
              {STATUSES.map(s => (
                <button
                  key={s}
                  onClick={() => setDraft({ ...draft, status: s })}
                  className={`min-h-[44px] rounded-lg border text-[11px] font-black uppercase tracking-widest ${
                    draft.status === s ? STATUS_CHIP[s] + ' ring-2 ring-offset-1 ring-fuchsia-400' : 'bg-white border-gray-300 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            rows={3}
            value={draft.notes || ''}
            onChange={e => setDraft({ ...draft, notes: e.target.value })}
            placeholder="Caption ideas, angle, who to tag…"
            className="w-full border border-gray-300 rounded-lg p-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400"
          />
        </Field>

        <Field label="Links">
          <div className="space-y-2">
            {draft.links.map(lid => {
              const l = links[lid];
              return (
                <div key={lid} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  {l ? (
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 text-xs font-bold text-fuchsia-700 hover:underline truncate">
                      {l.title || l.url}
                    </a>
                  ) : (
                    <span className="min-w-0 flex-1 text-xs font-bold text-slate-400 italic">Link removed</span>
                  )}
                  <button
                    onClick={() => setDraft({ ...draft, links: draft.links.filter(x => x !== lid) })}
                    aria-label="Detach link"
                    className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-slate-400 hover:text-rose-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
            <div className="flex gap-2">
              <input
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); attachUrl(); } }}
                placeholder="Paste a URL to attach…"
                className="flex-1 min-w-0 border border-gray-300 rounded-lg p-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400"
              />
              <button
                onClick={attachUrl}
                disabled={!newUrl.trim()}
                className="min-h-[44px] px-3 bg-slate-800 hover:bg-slate-900 disabled:opacity-40 text-white rounded-lg text-xs font-black uppercase tracking-widest inline-flex items-center gap-1.5"
              >
                <Paperclip className="w-4 h-4" /> Attach
              </button>
            </div>
          </div>
        </Field>
      </div>

      <div className="flex items-center gap-2 pt-5">
        {!isNew && (
          <button
            onClick={() => onDelete(draft.id)}
            className="min-h-[44px] px-3 text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg text-xs font-black uppercase tracking-widest inline-flex items-center gap-1.5"
          >
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        )}
        <button onClick={onClose} className="ml-auto min-h-[44px] px-4 text-slate-600 hover:bg-slate-100 rounded-lg text-xs font-black uppercase tracking-widest">Cancel</button>
        <button
          onClick={save}
          disabled={!draft.title.trim()}
          className="min-h-[44px] px-5 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-40 text-white rounded-lg text-xs font-black uppercase tracking-widest shadow"
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}

/* ══════════════════════ SHOTS ═════════════════════════════════════════ */

// THE shot queue. Deliberately still one list: an item typed straight in and
// an item promoted from a reference link are the same kind of work (something
// that needs filming), so they share a panel, a status and a subcollection.
function ShotsPanel({
  shots, links, onSave, onDelete,
}: {
  shots: Record<string, MarketingShot>;
  links: Record<string, MarketingLink>;
  onSave: (s: MarketingShot) => void;
  onDelete: (id: string) => void;
}) {
  const [desc, setDesc] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showCaptured, setShowCaptured] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);

  const all = useMemo(() => Object.values(shots), [shots]);
  const needed = useMemo(
    () => all.filter(s => s.status !== 'captured').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [all],
  );
  const captured = useMemo(
    () => all.filter(s => s.status === 'captured').sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0)),
    [all],
  );

  // Two taps: focus the field (tap 1 — it's already on screen), type, hit Add
  // or Enter (tap 2). Everything else about a shot is optional and edited later.
  const add = () => {
    const description = desc.trim();
    if (!description) return;
    // createdBy / createdAt are stamped by the save handler from the
    // signed-in identity — never from anything the panel could get wrong.
    onSave({ id: newId('ms'), description, status: 'needed' });
    setDesc('');
    addRef.current?.focus();
  };

  const toggle = (s: MarketingShot) => onSave(
    s.status === 'captured'
      ? { ...s, status: 'needed', capturedAt: undefined }
      : { ...s, status: 'captured', capturedAt: Date.now() },
  );

  return (
    <Panel title="Shot queue" Icon={Camera} count={needed.length}>
      {/* Two taps: the field is already on screen — type, then Add (or Enter). */}
      <div className="p-3 border-b border-slate-100 flex gap-2">
        <input
          ref={addRef}
          value={desc}
          onChange={e => setDesc(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add(); }}
          placeholder="Shot we still need…"
          className="flex-1 min-w-0 border border-gray-300 rounded-lg p-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400"
        />
        <button
          onClick={add}
          disabled={!desc.trim()}
          className="min-h-[44px] px-4 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-40 text-white rounded-lg text-xs font-black uppercase tracking-widest shadow inline-flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>

      <div className="divide-y divide-slate-100">
        {needed.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-400 font-bold">No shots on the list.</div>
        )}
        {needed.map(s => (
          <ShotRow key={s.id} shot={s} sourceLink={s.sourceLinkId ? links[s.sourceLinkId] : undefined} open={openId === s.id} onToggleOpen={() => setOpenId(openId === s.id ? null : s.id)} onCheck={() => toggle(s)} onSave={onSave} onDelete={onDelete} />
        ))}
      </div>

      {captured.length > 0 && (
        <div className="border-t border-slate-200 bg-slate-50/60">
          <button
            onClick={() => setShowCaptured(o => !o)}
            className="w-full px-4 min-h-[52px] flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400 hover:bg-slate-100"
          >
            <Check className="w-4 h-4" /> Captured
            <span className="bg-slate-200 text-slate-500 rounded-full px-2 py-0.5 text-[10px]">{captured.length}</span>
            <ChevronRight className={`w-4 h-4 ml-auto transition-transform ${showCaptured ? 'rotate-90' : ''}`} />
          </button>
          {showCaptured && (
            <div className="divide-y divide-slate-100 border-t border-slate-200 bg-white">
              {captured.map(s => (
                <ShotRow key={s.id} shot={s} sourceLink={s.sourceLinkId ? links[s.sourceLinkId] : undefined} open={openId === s.id} onToggleOpen={() => setOpenId(openId === s.id ? null : s.id)} onCheck={() => toggle(s)} onSave={onSave} onDelete={onDelete} />
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function ShotRow({
  shot, sourceLink, open, onToggleOpen, onCheck, onSave, onDelete,
}: {
  shot: MarketingShot;
  // Resolved from shot.sourceLinkId. Undefined when the shot was typed in by
  // hand OR when the originating link has since been deleted — both render as
  // simply no chip, which is why a dangling id is harmless.
  sourceLink?: MarketingLink;
  open: boolean;
  onToggleOpen: () => void;
  onCheck: () => void;
  onSave: (s: MarketingShot) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState<MarketingShot>(shot);
  const done = shot.status === 'captured';

  // Re-seed the draft each time the row is opened so it never shows a stale
  // edit from a previous open (or another device's write).
  const openRow = () => {
    if (!open) setDraft(shot);
    onToggleOpen();
  };

  return (
    <div className={done ? 'opacity-55' : ''}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={onCheck}
          aria-label={done ? 'Mark as still needed' : 'Mark as captured'}
          className={`min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg ${done ? 'text-lime-600 hover:bg-lime-50' : 'text-slate-300 hover:text-lime-600 hover:bg-slate-50'}`}
        >
          <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center ${done ? 'bg-lime-500 border-lime-500 text-white' : 'border-slate-300'}`}>
            {done && <Check className="w-4 h-4" />}
          </span>
        </button>
        <button onClick={openRow} className="min-w-0 flex-1 text-left py-1">
          <span className={`block text-sm font-bold text-slate-800 ${done ? 'line-through' : ''}`}>{shot.description}</span>
          {(shot.reference || shot.targetDate) && (
            <span className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">
              {[shot.reference, shot.targetDate ? prettyDate(shot.targetDate) : null].filter(Boolean).join(' · ')}
            </span>
          )}
          <Byline created={shot.createdBy} createdAt={shot.createdAt} updated={shot.updatedBy} updatedAt={shot.updatedAt} />
        </button>
        {/* Source reference, when this shot came from the links board. Outside
            the row's open/edit button so it stays a real link, not a nested
            (invalid) button-inside-button. */}
        {sourceLink && (
          <a
            href={sourceLink.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            title={sourceLink.title || sourceLink.url}
            className="shrink-0 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-fuchsia-700 bg-fuchsia-50 border border-fuchsia-200 rounded-full px-2 py-1 hover:bg-fuchsia-100"
          >
            <Link2 className="w-3 h-3" /> Ref
          </a>
        )}
        <button onClick={openRow} aria-label="Edit shot" className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center text-slate-300 hover:text-slate-600">
          <Pencil className="w-4 h-4" />
        </button>
      </div>

      {open && (
        <div className="px-3 pb-3 pl-[52px] space-y-2 bg-slate-50/60 border-t border-slate-100 pt-3">
          <input
            value={draft.description}
            onChange={e => setDraft({ ...draft, description: e.target.value })}
            placeholder="Description"
            className="w-full border border-gray-300 rounded-lg p-2.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              value={draft.reference || ''}
              onChange={e => setDraft({ ...draft, reference: e.target.value })}
              placeholder="Job / client (optional)"
              className="w-full border border-gray-300 rounded-lg p-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400"
            />
            <input
              type="date"
              value={draft.targetDate || ''}
              onChange={e => setDraft({ ...draft, targetDate: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400"
            />
          </div>
          <textarea
            rows={2}
            value={draft.notes || ''}
            onChange={e => setDraft({ ...draft, notes: e.target.value })}
            placeholder="Notes (optional)"
            className="w-full border border-gray-300 rounded-lg p-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => onDelete(shot.id)}
              className="min-h-[40px] px-3 text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg text-[11px] font-black uppercase tracking-widest inline-flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
            <button onClick={onToggleOpen} className="ml-auto min-h-[40px] px-3 text-slate-600 hover:bg-slate-200 rounded-lg text-[11px] font-black uppercase tracking-widest">Cancel</button>
            <button
              onClick={() => {
                const description = draft.description.trim();
                if (!description) return;
                onSave({
                  ...draft,
                  description,
                  reference: (draft.reference || '').trim() || undefined,
                  targetDate: draft.targetDate || undefined,
                  notes: (draft.notes || '').trim() || undefined,
                });
                onToggleOpen();
              }}
              className="min-h-[40px] px-4 bg-fuchsia-600 hover:bg-fuchsia-700 text-white rounded-lg text-[11px] font-black uppercase tracking-widest shadow"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════ LINKS ═════════════════════════════════════════ */

function LinksPanel({
  links, items, shots, threads, currentUser, onSaveLink, onDeleteLink, onSaveContent,
  onSaveShot, onAddComment, onDeleteComment,
}: {
  links: MarketingLink[];
  items: MarketingContentItem[];
  shots: Record<string, MarketingShot>;
  threads: Map<string, MarketingFeedbackEntry[]>;
  currentUser: { email: string; name: string };
  onSaveLink: (l: MarketingLink) => void;
  onDeleteLink: (id: string) => void;
  onSaveContent: (i: MarketingContentItem) => void;
  onSaveShot: (s: MarketingShot) => void;
  onAddComment: (s: MarketingSubject, text: string) => void;
  onDeleteComment: (id: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  // Which card's discussion is open — one at a time, as on the to-do list.
  const [openThread, setOpenThread] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  // Reverse map: link id → the content item it's attached to. Attachment is
  // stored on the item, so this is derived, never stored.
  const attachedTo = useMemo(() => {
    const map = new Map<string, MarketingContentItem>();
    for (const i of items) for (const lid of i.links) map.set(lid, i);
    return map;
  }, [items]);

  // Reverse map: link id → the shot(s) it was promoted into. Derived from the
  // shots, the same way attachment is derived from the items — a link never
  // stores a pointer to a shot, so there is nothing to keep in sync.
  const shotFor = useMemo(() => {
    const map = new Map<string, MarketingShot>();
    for (const s of Object.values(shots)) {
      if (!s.sourceLinkId) continue;
      // A still-needed shot wins over a captured one, so re-promoting a link
      // whose earlier shot is already filmed is still offered.
      const prev = map.get(s.sourceLinkId);
      if (!prev || (prev.status === 'captured' && s.status !== 'captured')) {
        map.set(s.sourceLinkId, s);
      }
    }
    return map;
  }, [shots]);

  const save = () => {
    const clean = normalizeUrl(url);
    if (!clean) return;
    onSaveLink({
      id: newId('ml'),
      url: clean,
      title: titleFromUrl(clean) || hostOf(clean),
      note: note.trim() || undefined,
      addedBy: currentUser,
      addedAt: Date.now(),
    });
    setUrl('');
    setNote('');
    urlRef.current?.focus();
  };

  // Promote a reference to the shot queue. The LINK IS KEPT — this is a
  // "make something like this" pointer, not a move that consumes the source,
  // so the link's title, note and byline stay on the board and it gains a
  // badge. The shot seeds its description from the link's note (the human
  // sentence) and falls back to the derived title.
  const toShotQueue = (l: MarketingLink) => {
    onSaveShot({
      id: newId('ms'),
      description: (l.note || '').trim() || l.title || hostOf(l.url),
      sourceLinkId: l.id,
      status: 'needed',
    });
  };

  // Attach / detach from here writes the ITEM (the source of truth), removing
  // the link from any other item it was on so it lives in one place.
  const setAttachment = (link: MarketingLink, itemId: string) => {
    const current = attachedTo.get(link.id);
    if (current && current.id !== itemId) {
      onSaveContent({ ...current, links: current.links.filter(x => x !== link.id) });
    }
    if (!itemId) return;
    const target = items.find(i => i.id === itemId);
    if (!target || target.links.includes(link.id)) return;
    onSaveContent({ ...target, links: [...target.links, link.id] });
  };

  const guessed = url.trim() ? titleFromUrl(url) : '';

  return (
    <Panel title="Reference links" Icon={Link2} count={links.length}>
      {/* Paste-and-save is the whole interaction. The note field is optional
          and only there for when the derived title isn't good enough. */}
      <div className="p-3 border-b border-slate-100 space-y-2">
        <div className="flex gap-2">
          <input
            ref={urlRef}
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
            placeholder="Paste a link — Instagram, article, anything"
            inputMode="url"
            className="flex-1 min-w-0 border border-gray-300 rounded-lg p-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400"
          />
          <button
            onClick={save}
            disabled={!url.trim()}
            className="min-h-[44px] px-4 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-40 text-white rounded-lg text-xs font-black uppercase tracking-widest shadow inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Save
          </button>
        </div>
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); }}
          placeholder={guessed ? `Note (optional) — saves as "${guessed}"` : 'Note (optional)'}
          className="w-full border border-gray-200 rounded-lg p-2.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-fuchsia-400"
        />
      </div>

      {links.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-400 font-bold">
          Nothing saved yet. Paste a link above.
        </div>
      ) : (
        <div className="p-3 grid grid-cols-1 xl:grid-cols-2 gap-3 max-h-[560px] overflow-y-auto">
          {links.map(l => {
            const attached = attachedTo.get(l.id);
            const queuedShot = shotFor.get(l.id);
            const queuedNeeded = queuedShot?.status !== 'captured';
            const subject: MarketingSubject = { subjectType: 'link', subjectId: l.id };
            const entries = threads.get(subjectKey(subject)) || [];
            const threadOpen = openThread === l.id;
            return (
              // Anchor target for a comment notification tap-through.
              <div key={l.id} id={`link-${l.id}`} className="scroll-mt-24 bg-white rounded-xl border border-gray-200 p-3 flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  {editingId === l.id ? (
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { onSaveLink({ ...l, title: editTitle.trim() || l.title }); setEditingId(null); }
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onBlur={() => { onSaveLink({ ...l, title: editTitle.trim() || l.title }); setEditingId(null); }}
                      className="min-w-0 flex-1 border border-gray-300 rounded-lg p-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400"
                    />
                  ) : (
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 flex-1 text-sm font-bold text-fuchsia-700 hover:underline flex items-start gap-1.5"
                    >
                      <span className="min-w-0 break-words">{l.title || l.url}</span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-60" />
                    </a>
                  )}
                  <button
                    onClick={() => { setEditingId(l.id); setEditTitle(l.title); }}
                    aria-label="Rename link"
                    className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-slate-300 hover:text-slate-600 shrink-0"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
                {l.note && <div className="text-xs text-slate-600">{l.note}</div>}
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {hostOf(l.url)} · {l.addedBy?.name || 'Someone'} · {new Date(l.addedAt).toLocaleDateString()}
                </div>
                {/* Promote to the shot queue, or say it's already there. The
                    link is never removed by this — see toShotQueue. */}
                {queuedShot ? (
                  <div className={`inline-flex items-center gap-1.5 self-start text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full border ${
                    queuedNeeded
                      ? 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200'
                      : 'bg-lime-50 text-lime-700 border-lime-200'
                  }`}
                  >
                    <Camera className="w-3 h-3" />
                    {queuedNeeded ? 'In shot queue' : 'Shot captured'}
                  </div>
                ) : (
                  <button
                    onClick={() => toShotQueue(l)}
                    title="Add a shot to the queue that references this link"
                    className="inline-flex items-center gap-1.5 self-start min-h-[36px] px-2.5 rounded-lg border border-fuchsia-200 text-fuchsia-700 hover:bg-fuchsia-50 text-[10px] font-black uppercase tracking-widest"
                  >
                    <Camera className="w-3.5 h-3.5" /> To shot queue
                  </button>
                )}
                <div className="flex items-center gap-2 mt-auto pt-1">
                  <select
                    value={attached?.id || ''}
                    onChange={e => setAttachment(l, e.target.value)}
                    className="min-w-0 flex-1 min-h-[40px] bg-slate-50 border border-gray-200 rounded-lg px-2 text-[11px] font-bold text-slate-600 outline-none focus:ring-2 focus:ring-fuchsia-400"
                  >
                    <option value="">Not attached</option>
                    {items.map(i => (
                      <option key={i.id} value={i.id}>{prettyDate(i.date)} — {i.title || 'Untitled'}</option>
                    ))}
                  </select>
                  {/* Discuss this reference. A card has an action bar already,
                      so unlike a to-do row the way in is always visible; the
                      count appears once there is something to count. */}
                  <button
                    onClick={() => setOpenThread(threadOpen ? null : l.id)}
                    aria-label={threadOpen ? 'Hide comments' : 'Comments'}
                    title={entries.length ? `${entries.length} comment${entries.length === 1 ? '' : 's'}` : 'Add a comment'}
                    className={`min-w-[40px] min-h-[40px] inline-flex items-center justify-center gap-1 rounded-lg shrink-0 text-[10px] font-black ${
                      threadOpen ? 'text-fuchsia-700 bg-fuchsia-50' : 'text-slate-300 hover:text-fuchsia-700'
                    }`}
                  >
                    <MessageSquare className="w-4 h-4" />
                    {entries.length > 0 && entries.length}
                  </button>
                  <button
                    onClick={() => onDeleteLink(l.id)}
                    aria-label="Delete link"
                    className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center text-slate-300 hover:text-rose-600 shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* The same thread component as the clip feedback and to-do
                    surfaces, on a link subject. */}
                {threadOpen && (
                  <div className="border-t border-slate-100 pt-2">
                    <CommentThread
                      entries={entries}
                      onAdd={text => onAddComment(subject, text)}
                      onDelete={onDeleteComment}
                      composer="always"
                      placeholder={`Comment on "${l.title || hostOf(l.url)}"`}
                      replyLabel="Comment"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/* ══════════════════════ CLIP FEEDBACK ═════════════════════════════════ */

// Marco reviews the numbered footage in Drive and writes here. Threading is
// DERIVED, not stored: every entry carries a normalized clip key and grouping
// on it is what turns rows into conversations. Nothing points at a parent, so
// there is no thread pointer to corrupt and a reply is just another row.
function FeedbackPanel({
  threads: allThreads, clips, postQueue, onAddComment, onDeleteComment, onSaveClip, onSavePostQueue,
}: {
  threads: Map<string, MarketingFeedbackEntry[]>;
  clips: Record<string, MarketingClipThread>;
  postQueue: Record<string, MarketingPostQueueEntry>;
  onAddComment: (s: MarketingSubject, text: string) => void;
  onDeleteComment: (id: string) => void;
  onSaveClip: (t: MarketingClipThread) => void;
  onSavePostQueue: (e: MarketingPostQueueEntry) => void;
}) {
  const [newClip, setNewClip] = useState('');
  const [newText, setNewText] = useState('');
  const [query, setQuery] = useState('');
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState('');
  const [showAddressed, setShowAddressed] = useState(false);
  const clipRef = useRef<HTMLInputElement>(null);

  // Threads are built from MESSAGES (the page-wide grouping, filtered to the
  // clip subjects), so a clip doc left behind by a delete race can never show
  // up as an empty thread.
  const threads = useMemo(() => {
    const out = [...allThreads.entries()]
      .filter(([k]) => k.startsWith('clip:'))
      .map(([k, entries]) => {
        const clip = k.slice('clip:'.length);
        const latest = entries.reduce((m, e) => Math.max(m, e.createdAt || 0), 0);
        const thread = clips[clip];
        return {
          clip,
          entries,
          latest,
          status: (thread?.status === 'addressed' ? 'addressed' : 'open') as MarketingClipStatus,
          url: thread?.url || '',
          thread,
        };
      });
    // Threads themselves are newest-first, by most recent activity.
    return out.sort((a, b) => b.latest - a.latest);
  }, [allThreads, clips]);

  // Filter on the PADDED label so "58", "0058" and "005" all find #0058.
  const filtered = useMemo(() => {
    const q = query.trim().replace(/^#+/, '').toUpperCase();
    if (!q) return threads;
    return threads.filter(t => clipLabel(t.clip).slice(1).includes(q) || t.clip.includes(q));
  }, [threads, query]);

  const open = filtered.filter(t => t.status === 'open');
  const addressed = filtered.filter(t => t.status === 'addressed');

  const add = () => {
    const clip = clipKey(newClip);
    const text = newText.trim();
    if (!clip || !text) return;
    // createdBy / createdAt are stamped by the save handler from the
    // signed-in identity — never from anything this panel could get wrong.
    onAddComment({ subjectType: 'clip', subjectId: clip }, text);
    setNewClip('');
    setNewText('');
    clipRef.current?.focus();
  };

  // Status and url live on the same doc, so every write sends both — passing
  // one without the other would blank the other field.
  const setStatus = (t: typeof threads[number], status: MarketingClipStatus) =>
    onSaveClip({ id: t.clip, status, url: t.url || undefined });

  const saveLink = (t: typeof threads[number]) => {
    const url = linkDraft.trim();
    onSaveClip({ id: t.clip, status: t.status, url: url ? normalizeUrl(url) : undefined });
    setLinkFor(null);
    setLinkDraft('');
  };

  // Send a reviewed clip to the post queue. Keyed by clip, so this is
  // idempotent — a second press updates the existing row rather than adding a
  // duplicate. New rows land at the BACK of the queue (max order + 10), which
  // is what "ready to go out" means when order is deliberate.
  const sendToPostQueue = (clip: string) => {
    const existing = postQueue[clip];
    // Already waiting to go out — nothing to do. An ALREADY-POSTED clip is
    // allowed through: that re-queues it (a re-post), and the save handler
    // clears the stale postedBy/postedAt on the way.
    if (existing && existing.status !== 'posted') return;
    const maxOrder = Object.values(postQueue)
      .reduce((m, e) => Math.max(m, e.order || 0), 0);
    onSavePostQueue({ ...(existing || {}), id: clip, order: maxOrder + 10, status: 'queued' });
  };

  return (
    <Panel
      title="Clip feedback"
      Icon={MessageSquare}
      count={open.length}
      action={(
        <div className="relative w-full sm:w-56">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Find a clip…"
            aria-label="Search feedback by clip number"
            className="w-full border border-gray-300 rounded-lg pl-8 pr-8 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[28px] min-h-[28px] inline-flex items-center justify-center text-slate-300 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    >
      {/* Add: clip number + the note. The number field is deliberately narrow
          and the note is a real textarea — feedback is prose, not a label. */}
      <div className="p-3 border-b border-slate-100 space-y-2 bg-slate-50/60">
        <div className="flex gap-2">
          <input
            ref={clipRef}
            value={newClip}
            onChange={e => setNewClip(e.target.value)}
            placeholder="#0058"
            aria-label="Clip number"
            className="w-28 shrink-0 border border-gray-300 rounded-lg p-3 text-sm font-black text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400"
          />
          <span className="self-center text-[11px] font-bold uppercase tracking-widest text-slate-400 hidden sm:block">
            {clipKey(newClip) ? `→ ${clipLabel(clipKey(newClip))}` : 'with or without the #'}
          </span>
        </div>
        <textarea
          value={newText}
          onChange={e => setNewText(e.target.value)}
          placeholder="What needs changing on this clip…"
          rows={3}
          aria-label="Feedback"
          className="w-full border border-gray-300 rounded-lg p-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400 resize-y min-h-[84px]"
        />
        <div className="flex justify-end">
          <button
            onClick={add}
            disabled={!clipKey(newClip) || !newText.trim()}
            className="min-h-[44px] px-4 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-40 text-white rounded-lg text-xs font-black uppercase tracking-widest shadow inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Add feedback
          </button>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {open.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-400 font-bold">
            {query ? `Nothing open matching "${query}".` : 'No open clip feedback.'}
          </div>
        )}
        {open.map(t => (
          <ClipThread
            key={t.clip}
            t={t}
            onAddComment={onAddComment}
            editingLink={linkFor === t.clip}
            linkDraft={linkDraft}
            onLinkDraft={setLinkDraft}
            onStartLink={() => { setLinkFor(t.clip); setLinkDraft(t.url); }}
            onCancelLink={() => { setLinkFor(null); setLinkDraft(''); }}
            onSaveLink={() => saveLink(t)}
            onStatus={s => setStatus(t, s)}
            onDeleteComment={onDeleteComment}
            queued={postQueue[t.clip]?.status === 'queued'}
            onSendToPostQueue={() => sendToPostQueue(t.clip)}
          />
        ))}
      </div>

      {addressed.length > 0 && (
        <div className="border-t border-slate-200 bg-slate-50/60">
          <button
            onClick={() => setShowAddressed(o => !o)}
            className="w-full px-4 min-h-[52px] flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400 hover:bg-slate-100"
          >
            <Check className="w-4 h-4" /> Addressed
            <span className="bg-slate-200 text-slate-500 rounded-full px-2 py-0.5 text-[10px]">{addressed.length}</span>
            <ChevronRight className={`w-4 h-4 ml-auto transition-transform ${showAddressed ? 'rotate-90' : ''}`} />
          </button>
          {showAddressed && (
            <div className="divide-y divide-slate-100 border-t border-slate-200 bg-white">
              {addressed.map(t => (
                <ClipThread
                  key={t.clip}
                  t={t}
                  onAddComment={onAddComment}
                  editingLink={linkFor === t.clip}
                  linkDraft={linkDraft}
                  onLinkDraft={setLinkDraft}
                  onStartLink={() => { setLinkFor(t.clip); setLinkDraft(t.url); }}
                  onCancelLink={() => { setLinkFor(null); setLinkDraft(''); }}
                  onSaveLink={() => saveLink(t)}
                  onStatus={s => setStatus(t, s)}
                  onDeleteComment={onDeleteComment}
                  queued={postQueue[t.clip]?.status === 'queued'}
                  onSendToPostQueue={() => sendToPostQueue(t.clip)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function ClipThread({
  t, onAddComment, onDeleteComment,
  editingLink, linkDraft, onLinkDraft, onStartLink, onCancelLink, onSaveLink,
  onStatus, queued, onSendToPostQueue,
}: {
  t: {
    clip: string;
    entries: MarketingFeedbackEntry[];
    status: MarketingClipStatus;
    url: string;
  };
  // Already on the post queue. The action becomes a static badge rather than
  // disappearing, so "is this queued?" is answerable from the thread itself.
  queued: boolean;
  onSendToPostQueue: () => void;
  onAddComment: (s: MarketingSubject, text: string) => void;
  editingLink: boolean;
  linkDraft: string;
  onLinkDraft: (v: string) => void;
  onStartLink: () => void;
  onCancelLink: () => void;
  onSaveLink: () => void;
  onStatus: (s: MarketingClipStatus) => void;
  onDeleteComment: (id: string) => void;
}) {
  const done = t.status === 'addressed';
  return (
    // Anchor target for the post queue's "Thread" link. scroll-mt keeps the
    // clip header clear of the sticky app header after the jump.
    <div id={`clip-${t.clip}`} className={`scroll-mt-24 ${done ? 'opacity-60' : ''}`}>
      <div className="px-3 py-3">
        {/* Clip header — the number is the identity, so it leads. */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-black tracking-widest text-slate-800">{clipLabel(t.clip)}</span>
          <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${
            done
              ? 'bg-lime-100 text-lime-800 border-lime-300'
              : 'bg-amber-100 text-amber-800 border-amber-300'
          }`}
          >
            {done ? 'Addressed' : 'Open'}
          </span>
          <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
            {t.entries.length}
          </span>
          {t.url && (
            <a
              href={t.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-bold text-fuchsia-700 hover:underline"
            >
              <ExternalLink className="w-3 h-3" /> {hostOf(t.url)}
            </a>
          )}
          <div className="ml-auto flex items-center gap-1">
            {queued ? (
              <span
                title="This clip is on the post queue"
                className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full border bg-sky-50 text-sky-700 border-sky-200"
              >
                <Send className="w-3 h-3" /> Queued
              </span>
            ) : (
              <button
                onClick={onSendToPostQueue}
                title="Reviewed and ready — add this clip to the post queue"
                className="min-h-[40px] px-3 rounded-lg border border-sky-200 text-sky-700 hover:bg-sky-50 text-[11px] font-black uppercase tracking-widest inline-flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" /> Post queue
              </button>
            )}
            <button
              onClick={onStartLink}
              aria-label={t.url ? 'Edit clip link' : 'Add clip link'}
              className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center text-slate-300 hover:text-fuchsia-600"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <button
              onClick={() => onStatus(done ? 'open' : 'addressed')}
              className={`min-h-[40px] px-3 rounded-lg text-[11px] font-black uppercase tracking-widest inline-flex items-center gap-1.5 ${
                done
                  ? 'text-slate-500 hover:bg-slate-100'
                  : 'bg-lime-600 hover:bg-lime-700 text-white shadow'
              }`}
            >
              {done ? <><RotateCcw className="w-3.5 h-3.5" /> Reopen</> : <><Check className="w-3.5 h-3.5" /> Mark addressed</>}
            </button>
          </div>
        </div>

        {editingLink && (
          <div className="mt-2 flex gap-2">
            <input
              value={linkDraft}
              onChange={e => onLinkDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onSaveLink(); }}
              placeholder="Drive link for this clip (optional)"
              className="flex-1 min-w-0 border border-gray-300 rounded-lg p-2.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400"
            />
            <button onClick={onSaveLink} className="min-h-[40px] px-3 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-[11px] font-black uppercase tracking-widest">Save</button>
            <button onClick={onCancelLink} aria-label="Cancel" className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* The conversation — the SAME component the links board and the to-do
            list use. A reply carries the clip subject, so it joins this thread
            rather than starting one. */}
        <div className="mt-2">
          <CommentThread
            entries={t.entries}
            onAdd={text => onAddComment({ subjectType: 'clip', subjectId: t.clip }, text)}
            onDelete={onDeleteComment}
            placeholder={`Reply on ${clipLabel(t.clip)}…`}
          />
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════ SHARED TO-DO ══════════════════════════════════ */

// One shared list. No owner, no assignee, no per-item permission — anyone on
// the board can add, edit, tick and delete anything, which is what "shared
// working list" actually means. addedBy is a byline, not an access check.
function TodoPanel({
  todos, threads, onSave, onDelete, onAddComment, onDeleteComment,
}: {
  todos: Record<string, MarketingTodo>;
  threads: Map<string, MarketingFeedbackEntry[]>;
  onSave: (t: MarketingTodo) => void;
  onDelete: (id: string) => void;
  onAddComment: (s: MarketingSubject, text: string) => void;
  onDeleteComment: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const [priority, setPriority] = useState<MarketingTodoPriority>('normal');
  const [showDone, setShowDone] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MarketingTodo | null>(null);
  // Which item's discussion is open. One at a time: the list is the point, and
  // several expanded threads would bury it.
  const [openThread, setOpenThread] = useState<string | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  // Local calendar day, so "overdue" matches the user's date rather than UTC.
  const today = ymd(new Date());

  const all = useMemo(() => Object.values(todos), [todos]);

  // Sort: high priority first, then dated ascending, then undated in the
  // order they were entered. Dated always outranks undated WITHIN a priority
  // band — a normal-priority item with a date never jumps a high-priority one.
  const openItems = useMemo(() => {
    const rank = (t: MarketingTodo) => (t.priority === 'high' ? 0 : 1);
    return all.filter(t => !t.done).sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r) return r;
      const ad = a.dueDate || '';
      const bd = b.dueDate || '';
      if (ad && bd) return ad.localeCompare(bd) || (a.addedAt || 0) - (b.addedAt || 0);
      if (ad) return -1;
      if (bd) return 1;
      return (a.addedAt || 0) - (b.addedAt || 0);
    });
  }, [all]);

  const doneItems = useMemo(
    () => all.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)),
    [all],
  );

  const highOpen = openItems.filter(t => t.priority === 'high').length;

  // Two taps: type, then Add (or Enter). Priority is an optional tap in
  // between and stays sticky for the next item, which is what you want when
  // adding several urgent things in a row.
  const add = () => {
    const clean = text.trim();
    if (!clean) return;
    onSave({ id: newId('mt'), text: clean, priority, done: false });
    setText('');
    addRef.current?.focus();
  };

  const toggleDone = (t: MarketingTodo) => onSave({ ...t, done: !t.done });
  const togglePriority = (t: MarketingTodo) =>
    onSave({ ...t, priority: t.priority === 'high' ? 'normal' : 'high' });

  const saveEdit = () => {
    if (!draft) return;
    if (!draft.text.trim()) return;
    onSave({ ...draft, text: draft.text.trim(), dueDate: draft.dueDate || undefined });
    setEditingId(null);
    setDraft(null);
  };

  const row = (t: MarketingTodo) => {
    const high = t.priority === 'high';
    // Quiet amber, and only for items still open — a finished item being
    // "late" is noise, not information.
    const overdue = !t.done && !!t.dueDate && t.dueDate < today;
    const editing = editingId === t.id;
    const subject: MarketingSubject = { subjectType: 'todo', subjectId: t.id };
    const entries = threads.get(subjectKey(subject)) || [];
    const threadOpen = openThread === t.id;
    return (
      // Anchor target for a comment / new-item notification tap-through.
      <div key={t.id} id={`todo-${t.id}`} className={`scroll-mt-24 ${t.done ? 'opacity-55' : ''}`}>
        <div className="flex items-start gap-2 px-3 py-2">
          <button
            onClick={() => toggleDone(t)}
            aria-label={t.done ? 'Mark as not done' : 'Mark as done'}
            className={`min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg ${t.done ? 'text-lime-600 hover:bg-lime-50' : 'text-slate-300 hover:text-lime-600 hover:bg-slate-50'}`}
          >
            <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center ${t.done ? 'bg-lime-500 border-lime-500 text-white' : 'border-slate-300'}`}>
              {t.done && <Check className="w-4 h-4" />}
            </span>
          </button>

          <div className="min-w-0 flex-1 py-1">
            {editing && draft ? (
              <div className="space-y-2">
                <input
                  autoFocus
                  value={draft.text}
                  onChange={e => setDraft({ ...draft, text: e.target.value })}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveEdit();
                    if (e.key === 'Escape') { setEditingId(null); setDraft(null); }
                  }}
                  className="w-full border border-gray-300 rounded-lg p-2.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="date"
                    value={draft.dueDate || ''}
                    onChange={e => setDraft({ ...draft, dueDate: e.target.value })}
                    className="border border-gray-300 rounded-lg p-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400"
                  />
                  {draft.dueDate && (
                    <button
                      onClick={() => setDraft({ ...draft, dueDate: undefined })}
                      className="min-h-[36px] px-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100 rounded-lg"
                    >
                      Clear date
                    </button>
                  )}
                  {/* Where a FIRST comment starts. An item nobody has
                      discussed shows nothing extra on the row itself, so the
                      way in is the same tap that already opens the item; once
                      there is a comment, the count chip on the row takes over. */}
                  <button
                    onClick={() => { setOpenThread(t.id); setEditingId(null); setDraft(null); }}
                    className="min-h-[36px] px-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-fuchsia-700 hover:bg-fuchsia-50 rounded-lg inline-flex items-center gap-1"
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> Comment
                  </button>
                  <button onClick={saveEdit} className="ml-auto min-h-[36px] px-3 bg-fuchsia-600 hover:bg-fuchsia-700 text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow">Save</button>
                  <button
                    onClick={() => { setEditingId(null); setDraft(null); }}
                    className="min-h-[36px] px-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100 rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => { setEditingId(t.id); setDraft(t); }} className="block w-full text-left">
                <span className={`block text-sm font-bold text-slate-800 break-words ${t.done ? 'line-through' : ''}`}>
                  {t.text}
                </span>
                <span className="flex items-center gap-2 flex-wrap mt-1">
                  {high && !t.done && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200">
                      <Flag className="w-3 h-3" /> High
                    </span>
                  )}
                  {t.dueDate && (
                    <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${
                      overdue
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-slate-50 text-slate-500 border-slate-200'
                    }`}
                    >
                      <CalendarDays className="w-3 h-3" />
                      {prettyDate(t.dueDate)}{overdue ? ' · overdue' : ''}
                    </span>
                  )}
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    {t.addedBy?.name || 'Someone'}
                    {t.addedAt ? ` · ${prettyStamp(t.addedAt)}` : ''}
                  </span>
                </span>
              </button>
            )}
          </div>

          {!editing && (
            <div className="flex items-center shrink-0">
              {/* Comment count — nothing at all until someone has said
                  something, so a quiet list stays quiet. */}
              <CommentCount
                n={entries.length}
                open={threadOpen}
                onClick={() => setOpenThread(threadOpen ? null : t.id)}
              />
              {/* Priority is a toggle, not a menu — two states means a tap. */}
              <button
                onClick={() => togglePriority(t)}
                aria-label={high ? 'Set normal priority' : 'Set high priority'}
                aria-pressed={high}
                title={high ? 'High priority — tap for normal' : 'Normal priority — tap for high'}
                className={`min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg ${high ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-300 hover:text-rose-500 hover:bg-slate-50'}`}
              >
                <Flag className={`w-4 h-4 ${high ? 'fill-rose-500' : ''}`} />
              </button>
              <button
                onClick={() => onDelete(t.id)}
                aria-label="Delete to-do"
                className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center text-slate-300 hover:text-rose-600"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* The discussion — the same thread component the clip feedback and
            the links board use, on a to-do subject. Indented under the item so
            it reads as belonging to it. */}
        {threadOpen && (
          <div className="px-3 pb-3 pl-[52px] bg-slate-50/60 border-t border-slate-100 pt-3">
            <CommentThread
              entries={entries}
              onAdd={text => onAddComment(subject, text)}
              onDelete={onDeleteComment}
              composer="always"
              placeholder={`Comment on "${t.text.slice(0, 40)}${t.text.length > 40 ? '…' : ''}"`}
              replyLabel="Comment"
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <Panel
      title="To-do"
      Icon={ListChecks}
      count={openItems.length}
      action={highOpen > 0 ? (
        <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full border bg-rose-50 text-rose-700 border-rose-200">
          <Flag className="w-3 h-3" /> {highOpen} high
        </span>
      ) : undefined}
    >
      {/* Add row: text, an optional priority tap, save. Nothing else. */}
      <div className="p-3 border-b border-slate-100 flex gap-2">
        <input
          ref={addRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add(); }}
          placeholder="Something to do…"
          className="flex-1 min-w-0 border border-gray-300 rounded-lg p-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400"
        />
        <button
          onClick={() => setPriority(p => (p === 'high' ? 'normal' : 'high'))}
          aria-pressed={priority === 'high'}
          aria-label={priority === 'high' ? 'New item: high priority' : 'New item: normal priority'}
          title={priority === 'high' ? 'New items go in as HIGH — tap for normal' : 'Tap to add as high priority'}
          className={`min-w-[44px] min-h-[44px] shrink-0 inline-flex items-center justify-center rounded-lg border ${
            priority === 'high'
              ? 'bg-rose-50 text-rose-600 border-rose-200'
              : 'text-slate-300 border-gray-300 hover:text-rose-500'
          }`}
        >
          <Flag className={`w-4 h-4 ${priority === 'high' ? 'fill-rose-500' : ''}`} />
        </button>
        <button
          onClick={add}
          disabled={!text.trim()}
          className="min-h-[44px] px-4 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-40 text-white rounded-lg text-xs font-black uppercase tracking-widest shadow inline-flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>

      <div className="divide-y divide-slate-100">
        {openItems.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-400 font-bold">Nothing on the list.</div>
        )}
        {openItems.map(row)}
      </div>

      {doneItems.length > 0 && (
        <div className="border-t border-slate-200 bg-slate-50/60">
          <button
            onClick={() => setShowDone(o => !o)}
            className="w-full px-4 min-h-[52px] flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400 hover:bg-slate-100"
          >
            <Check className="w-4 h-4" /> Done
            <span className="bg-slate-200 text-slate-500 rounded-full px-2 py-0.5 text-[10px]">{doneItems.length}</span>
            <ChevronRight className={`w-4 h-4 ml-auto transition-transform ${showDone ? 'rotate-90' : ''}`} />
          </button>
          {showDone && (
            <div className="divide-y divide-slate-100 border-t border-slate-200 bg-white">
              {doneItems.map(row)}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ══════════════════════ POST QUEUE ════════════════════════════════════ */

// Reviewed clips, in the order they go out. Every row is keyed by clip number,
// so the feedback thread is reachable by that key alone — nothing is copied
// out of the thread and no pointer into it is stored, which is what makes
// queueing (and un-queueing) unable to orphan the conversation.
//
// A row can also be SCHEDULED, which writes a calendar entry for the clip. The
// row does NOT leave the queue on scheduling: the queue is the single view of
// what is ready and what is committed, so a scheduled clip stays put with its
// date shown, and marking POSTED is the one thing that clears it. The row
// stores no date of its own — the calendar entry owns it, and this panel reads
// it back through the clip key.
function PostQueuePanel({
  postQueue, threads, content, onSave, onDelete, onSaveContent, onDeleteContent,
}: {
  postQueue: Record<string, MarketingPostQueueEntry>;
  threads: Map<string, MarketingFeedbackEntry[]>;
  content: MarketingContentItem[];
  onSave: (e: MarketingPostQueueEntry) => void;
  onDelete: (id: string) => void;
  onSaveContent: (i: MarketingContentItem) => void;
  onDeleteContent: (id: string) => void;
}) {
  const [showPosted, setShowPosted] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [schedFor, setSchedFor] = useState<string | null>(null);
  const [dateDraft, setDateDraft] = useState('');

  // Message count per clip, read out of the page-wide grouping — the same
  // thread the feedback panel shows, counted once.
  const countFor = (clip: string) =>
    (threads.get(subjectKey({ subjectType: 'clip', subjectId: clip })) || []).length;

  // clip key → its calendar entry. DERIVED by matching MarketingContentItem
  // .clip, exactly the way a feedback thread is derived by grouping on the
  // same key — no pointer is stored on the queue row, so nothing here can
  // dangle. Delete the entry on the calendar and the row simply reads as
  // undated again; re-send a clip to the queue and it finds its entry back.
  const scheduledByClip = useMemo(() => {
    const m = new Map<string, MarketingContentItem>();
    for (const i of content) {
      const k = clipKey(i.clip || '');
      if (!k) continue;
      const prev = m.get(k);
      // Two entries for one clip is only reachable by two people scheduling
      // the same clip at once; take the earliest date so every device picks
      // the same one rather than whichever happened to be first in the map.
      if (!prev || (i.date || '').localeCompare(prev.date || '') < 0) m.set(k, i);
    }
    return m;
  }, [content]);

  const all = useMemo(() => Object.values(postQueue), [postQueue]);
  // Sorted by (order, queuedAt): the tiebreak keeps the list stable if two
  // rows ever share an order, rather than letting object order decide.
  const queued = useMemo(
    () => all.filter(e => e.status !== 'posted')
      .sort((a, b) => (a.order || 0) - (b.order || 0) || (a.queuedAt || 0) - (b.queuedAt || 0)),
    [all],
  );
  const posted = useMemo(
    () => all.filter(e => e.status === 'posted').sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0)),
    [all],
  );

  // Reorder by renumbering the WHOLE queued list from the reordered array
  // (10, 20, 30…). Swapping two order values would preserve any pre-existing
  // ties or gaps; renumbering removes them, and only changed rows are written.
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= queued.length) return;
    const next = [...queued];
    [next[idx], next[j]] = [next[j], next[idx]];
    next.forEach((e, i) => {
      const order = (i + 1) * 10;
      if (e.order !== order) onSave({ ...e, order });
    });
  };

  const saveNote = (e: MarketingPostQueueEntry) => {
    onSave({ ...e, note: noteDraft.trim() || undefined });
    setEditingId(null);
    setNoteDraft('');
  };

  const closeSched = () => { setSchedFor(null); setDateDraft(''); };

  // Open the date picker on the row. Pre-filled with the date it already has,
  // so "reschedule" starts from where it is rather than from today.
  const openSched = (e: MarketingPostQueueEntry) => {
    setEditingId(null);
    setNoteDraft('');
    setSchedFor(e.id);
    setDateDraft(scheduledByClip.get(e.id)?.date || ymd(new Date()));
  };

  // Schedule / reschedule. ONE write either way, and always to the calendar
  // entry's `date` — the queue has no date field to fall out of step with it.
  const saveSched = (e: MarketingPostQueueEntry) => {
    const date = dateDraft;
    if (!date) return;
    const entry = scheduledByClip.get(e.id);
    if (entry) {
      if (entry.date !== date) onSaveContent({ ...entry, date });
    } else {
      onSaveContent({
        id: newId('mc'),
        // Title from the clip: its number, plus the posting note when there is
        // one. Written ONCE, at creation — the calendar entry's title stays
        // editable there, and a later note edit must not overwrite it.
        title: [clipLabel(e.id), (e.note || '').trim()].filter(Boolean).join(' — '),
        date,
        status: 'scheduled',
        links: [],
        // The back-link to the clip, and the only thing tying the two sides
        // together.
        clip: e.id,
      });
    }
    closeSched();
  };

  // Unschedule = delete the calendar entry, which is the same act as deleting
  // it on the calendar. Nothing else to undo: with no stored date and no
  // stored id, the row is undated again the moment the entry is gone. The
  // clip, its feedback thread and its place in the queue are untouched.
  const unschedule = (e: MarketingPostQueueEntry) => {
    const entry = scheduledByClip.get(e.id);
    if (entry) onDeleteContent(entry.id);
    closeSched();
  };

  // Marking posted is what clears a clip from the queue. It carries the
  // calendar entry with it — a clip that has gone out reading "scheduled" on
  // the calendar is exactly the kind of disagreement the single date field
  // exists to prevent. Requeueing puts the entry back to scheduled.
  const setPosted = (e: MarketingPostQueueEntry, posted: boolean) => {
    if (schedFor === e.id) closeSched();
    onSave({ ...e, status: posted ? 'posted' : 'queued' });
    const entry = scheduledByClip.get(e.id);
    const want: MarketingContentStatus = posted ? 'posted' : 'scheduled';
    if (entry && entry.status !== want) onSaveContent({ ...entry, status: want });
  };

  const row = (e: MarketingPostQueueEntry, idx: number | null) => {
    const done = e.status === 'posted';
    const count = countFor(e.id);
    const sched = scheduledByClip.get(e.id);
    return (
      // Anchor target for a "sent to the post queue" notification tap-through.
      <div key={e.id} id={`pq-${e.id}`} className={`scroll-mt-24 px-3 py-2.5 ${done ? 'opacity-55' : ''}`}>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Order controls — up/down rather than drag: this board is used on
              a phone, where a 44px target beats a drag handle. */}
          {!done && idx !== null && (
            <div className="flex flex-col shrink-0">
              <button
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                aria-label={`Move ${clipLabel(e.id)} earlier`}
                className="min-w-[36px] h-[26px] inline-flex items-center justify-center rounded-t-md border border-slate-200 text-slate-400 hover:text-sky-700 hover:bg-sky-50 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => move(idx, 1)}
                disabled={idx === queued.length - 1}
                aria-label={`Move ${clipLabel(e.id)} later`}
                className="min-w-[36px] h-[26px] inline-flex items-center justify-center rounded-b-md border border-t-0 border-slate-200 text-slate-400 hover:text-sky-700 hover:bg-sky-50 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {!done && idx !== null && (
            <span className="text-[10px] font-black text-slate-300 w-4 shrink-0 text-right">{idx + 1}</span>
          )}
          <span className={`text-sm font-black tracking-widest text-slate-800 ${done ? 'line-through' : ''}`}>
            {clipLabel(e.id)}
          </span>
          {/* Back to the thread. Same page, so this is an anchor — the thread
              is never duplicated here. */}
          <a
            href={`#clip-${e.id}`}
            title="Jump to this clip's feedback thread"
            className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-fuchsia-700 bg-fuchsia-50 border border-fuchsia-200 rounded-full px-2 py-1 hover:bg-fuchsia-100"
          >
            <MessageSquare className="w-3 h-3" /> Thread
            {count > 0 && <span className="text-fuchsia-500">{count}</span>}
          </a>
          {/* Scheduled or not — the row says which, in place, rather than
              leaving a committed clip looking the same as an undated one. Both
              states open the same date picker below. A POSTED row shows the
              date it went out as a plain chip: scheduling something that has
              already gone out is not a thing, and its calendar entry has
              followed it to `posted`. */}
          {sched ? (
            done ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-500 bg-slate-100 border border-slate-300 rounded-full px-2 py-1">
                <CalendarDays className="w-3 h-3" /> {shortDate(sched.date)}
              </span>
            ) : (
              <button
                onClick={() => openSched(e)}
                title={`On the content calendar for ${prettyDate(sched.date)} — tap to change`}
                className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-amber-800 bg-amber-100 border border-amber-300 rounded-full px-2 py-1 hover:bg-amber-200"
              >
                <CalendarDays className="w-3 h-3" /> Scheduled {shortDate(sched.date)}
              </button>
            )
          ) : !done && (
            <button
              onClick={() => openSched(e)}
              title="Put this clip on the content calendar"
              className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 text-slate-500 hover:text-fuchsia-700 hover:bg-fuchsia-50 text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-1.5"
            >
              <CalendarDays className="w-3.5 h-3.5" /> Schedule
            </button>
          )}
          <div className="ml-auto flex items-center gap-1 shrink-0">
            <button
              onClick={() => setPosted(e, !done)}
              className={`min-h-[40px] px-3 rounded-lg text-[11px] font-black uppercase tracking-widest inline-flex items-center gap-1.5 ${
                done ? 'text-slate-500 hover:bg-slate-100' : 'bg-sky-600 hover:bg-sky-700 text-white shadow'
              }`}
            >
              {done ? <><RotateCcw className="w-3.5 h-3.5" /> Requeue</> : <><Check className="w-3.5 h-3.5" /> Mark posted</>}
            </button>
            <button
              onClick={() => onDelete(e.id)}
              aria-label="Remove from post queue"
              title="Remove from the queue — the clip's feedback thread is kept"
              className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center text-slate-300 hover:text-rose-600"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Pick a date. Scheduling and rescheduling are the same control and
            the same write; Unschedule is only offered once there's an entry
            to remove. */}
        {schedFor === e.id && (
          <div className="mt-2 flex gap-2 flex-wrap items-center">
            <input
              type="date"
              autoFocus
              value={dateDraft}
              onChange={ev => setDateDraft(ev.target.value)}
              onKeyDown={ev => {
                if (ev.key === 'Enter') saveSched(e);
                if (ev.key === 'Escape') closeSched();
              }}
              aria-label={`Date for ${clipLabel(e.id)}`}
              className="min-w-0 border border-gray-300 rounded-lg p-2.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-400"
            />
            <button
              onClick={() => saveSched(e)}
              disabled={!dateDraft}
              className="min-h-[40px] px-3 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-40 text-white rounded-lg text-[11px] font-black uppercase tracking-widest"
            >
              {sched ? 'Reschedule' : 'Schedule'}
            </button>
            {sched && (
              <button
                onClick={() => unschedule(e)}
                title="Remove the calendar entry — this clip stays in the queue, undated"
                className="min-h-[40px] px-3 text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg text-[11px] font-black uppercase tracking-widest"
              >
                Unschedule
              </button>
            )}
            <button
              onClick={closeSched}
              aria-label="Cancel"
              className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* The posting note — short, and separate from the review thread. */}
        {editingId === e.id ? (
          <div className="mt-2 flex gap-2">
            <input
              autoFocus
              value={noteDraft}
              onChange={ev => setNoteDraft(ev.target.value)}
              onKeyDown={ev => {
                if (ev.key === 'Enter') saveNote(e);
                if (ev.key === 'Escape') { setEditingId(null); setNoteDraft(''); }
              }}
              placeholder="Caption angle, hashtag, where it goes…"
              className="flex-1 min-w-0 border border-gray-300 rounded-lg p-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-sky-400"
            />
            <button onClick={() => saveNote(e)} className="min-h-[40px] px-3 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-[11px] font-black uppercase tracking-widest">Save</button>
            <button
              onClick={() => { setEditingId(null); setNoteDraft(''); }}
              aria-label="Cancel"
              className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => { closeSched(); setEditingId(e.id); setNoteDraft(e.note || ''); }}
            className="mt-1 block text-left w-full min-h-[32px]"
          >
            <span className={`text-sm ${e.note ? 'text-slate-700 font-bold' : 'text-slate-300 italic font-bold'}`}>
              {e.note || 'Add a note…'}
            </span>
          </button>
        )}

        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">
          Queued by {e.queuedBy?.name || 'Someone'}
          {e.queuedAt ? ` · ${prettyStamp(e.queuedAt)}` : ''}
          {done && e.postedAt ? ` · posted ${prettyStamp(e.postedAt)}${e.postedBy?.name ? ` by ${e.postedBy.name}` : ''}` : ''}
        </div>
      </div>
    );
  };

  return (
    <Panel title="Post queue" Icon={Send} count={queued.length}>
      <div className="divide-y divide-slate-100">
        {queued.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-400 font-bold">
            Nothing queued. Send a reviewed clip here from Clip feedback.
          </div>
        )}
        {queued.map((e, i) => row(e, i))}
      </div>

      {posted.length > 0 && (
        <div className="border-t border-slate-200 bg-slate-50/60">
          <button
            onClick={() => setShowPosted(o => !o)}
            className="w-full px-4 min-h-[52px] flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400 hover:bg-slate-100"
          >
            <Check className="w-4 h-4" /> Posted
            <span className="bg-slate-200 text-slate-500 rounded-full px-2 py-0.5 text-[10px]">{posted.length}</span>
            <ChevronRight className={`w-4 h-4 ml-auto transition-transform ${showPosted ? 'rotate-90' : ''}`} />
          </button>
          {showPosted && (
            <div className="divide-y divide-slate-100 border-t border-slate-200 bg-white">
              {posted.map(e => row(e, null))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ══════════════════════ shared bits ═══════════════════════════════════ */

// Who touched this, and when. Every marketing user signs in as themselves
// (named Personnel accounts, never a shared login), so these stamps are
// attributable the same way the rest of the app's are.
function Byline({
  created, createdAt, updated, updatedAt,
}: {
  created?: { email: string; name: string };
  createdAt?: number;
  updated?: { email: string; name: string };
  updatedAt?: number;
}) {
  if (!created?.name && !updated?.name) return null;
  const edited = updated?.name && updatedAt && createdAt && updatedAt - createdAt > 60_000;
  return (
    <span className="block text-[10px] font-bold text-slate-400 mt-1">
      {created?.name && `Added by ${created.name}${createdAt > 1_577_836_800_000 ? ` · ${new Date(createdAt).toLocaleDateString()}` : ''}`}
      {edited && ` · edited by ${updated!.name}`}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

// Full-screen on a phone, centred card on desktop — the same modal shape the
// rest of the app uses.
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-[95] flex md:items-center md:justify-center md:p-4" onClick={onClose}>
      <div
        className="bg-white md:rounded-2xl shadow-2xl w-full md:max-w-lg h-full md:h-auto md:max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-800">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

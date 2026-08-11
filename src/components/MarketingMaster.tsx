// MarketingMaster (v1) — one module, three tabs: CALENDAR · SHOTS · LINKS.
//
// Built for a marketer who is just starting, so it stays deliberately thin:
//   • Calendar — a month of planned content. No platform split (everything is
//     cross-posted), no approval chain, no recurrence.
//   • Shots — a working checklist of shots still to capture. No assignment,
//     no approvals, no notifications.
//   • Links — a board of saved references. Paste a URL, hit save, done.
//
// Nothing here reads or writes any other surface: no crews, no schedule, no
// performance, no pay. The three subcollections are the whole data footprint.
import { useMemo, useRef, useState } from 'react';
import {
  CalendarDays, Camera, Link2, ChevronLeft, ChevronRight, Plus, X, Trash2,
  ExternalLink, Check, Paperclip, Pencil, Megaphone,
} from 'lucide-react';
import type {
  MarketingContentItem, MarketingContentStatus, MarketingLink, MarketingShot,
} from '../types';

interface Props {
  content: Record<string, MarketingContentItem>;
  shots: Record<string, MarketingShot>;
  links: Record<string, MarketingLink>;
  currentUser: { email: string; name: string };
  onSaveContent: (item: MarketingContentItem) => void;
  onDeleteContent: (id: string) => void;
  onSaveShot: (shot: MarketingShot) => void;
  onDeleteShot: (id: string) => void;
  onSaveLink: (link: MarketingLink) => void;
  onDeleteLink: (id: string) => void;
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

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
  content, shots, links, currentUser,
  onSaveContent, onDeleteContent,
  onSaveShot, onDeleteShot,
  onSaveLink, onDeleteLink,
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

        {/* (b) SHOTS and (c) LINKS — compact panels side by side on desktop,
            stacked in that order on a phone. No tabs, no navigation: the
            whole surface is this one scroll. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <ShotsPanel shots={shots} onSave={onSaveShot} onDelete={onDeleteShot} />
          <LinksPanel
            links={linkList}
            items={contentList}
            currentUser={currentUser}
            onSaveLink={onSaveLink}
            onDeleteLink={onDeleteLink}
            onSaveContent={onSaveContent}
          />
        </div>
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
          {monthItems.map(item => (
            <button
              key={item.id}
              onClick={() => setEditing(item)}
              className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-50 min-h-[56px]"
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
              <Pencil className="w-4 h-4 text-slate-300 shrink-0 mt-1" />
            </button>
          ))}
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

function ShotsPanel({
  shots, onSave, onDelete,
}: {
  shots: Record<string, MarketingShot>;
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
    <Panel title="Shots to follow up" Icon={Camera} count={needed.length}>
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
          <ShotRow key={s.id} shot={s} open={openId === s.id} onToggleOpen={() => setOpenId(openId === s.id ? null : s.id)} onCheck={() => toggle(s)} onSave={onSave} onDelete={onDelete} />
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
                <ShotRow key={s.id} shot={s} open={openId === s.id} onToggleOpen={() => setOpenId(openId === s.id ? null : s.id)} onCheck={() => toggle(s)} onSave={onSave} onDelete={onDelete} />
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function ShotRow({
  shot, open, onToggleOpen, onCheck, onSave, onDelete,
}: {
  shot: MarketingShot;
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
  links, items, currentUser, onSaveLink, onDeleteLink, onSaveContent,
}: {
  links: MarketingLink[];
  items: MarketingContentItem[];
  currentUser: { email: string; name: string };
  onSaveLink: (l: MarketingLink) => void;
  onDeleteLink: (id: string) => void;
  onSaveContent: (i: MarketingContentItem) => void;
}) {
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const urlRef = useRef<HTMLInputElement>(null);

  // Reverse map: link id → the content item it's attached to. Attachment is
  // stored on the item, so this is derived, never stored.
  const attachedTo = useMemo(() => {
    const map = new Map<string, MarketingContentItem>();
    for (const i of items) for (const lid of i.links) map.set(lid, i);
    return map;
  }, [items]);

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
            return (
              <div key={l.id} className="bg-white rounded-xl border border-gray-200 p-3 flex flex-col gap-2">
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
                  <button
                    onClick={() => onDeleteLink(l.id)}
                    aria-label="Delete link"
                    className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center text-slate-300 hover:text-rose-600 shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
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

import type { Dispatch, SetStateAction } from 'react';
import { Megaphone, PenTool, Users, Trash2, Calendar as CalendarIcon, Bell, Clock } from 'lucide-react';
import type { BulletinAudienceRole, BulletinPost, Employee, UserRole } from '../types';
import {
  canSeeBulletin, describeAudience, isForEveryone, pickableRecipients,
} from '../lib/bulletinAudience';
import { localHourOf, quietHoursNotice, splitBulletins } from '../lib/scheduledBulletins';

// A ms timestamp as a <input type="datetime-local"> value, in the viewer's own
// clock — the same clock they picked it in.
const toLocalInput = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const ROLE_OPTIONS: { value: BulletinAudienceRole; label: string }[] = [
  { value: 'admin', label: 'Admins' },
  { value: 'manager', label: 'Managers' },
  { value: 'foreman', label: 'Foremen' },
  { value: 'mechanic', label: 'Mechanics' },
  { value: 'worker', label: 'Workers' },
];

interface BulletinBoardProps {
  bulletins: any[];
  isAdmin: boolean;
  canPost: boolean;
  canDelete: boolean;
  effectiveRole: UserRole;
  newTitle: string;
  setNewTitle: Dispatch<SetStateAction<string>>;
  newContent: string;
  setNewContent: Dispatch<SetStateAction<string>>;
  audience: BulletinAudienceRole[];
  setAudience: Dispatch<SetStateAction<BulletinAudienceRole[]>>;
  // Named recipients (employee ids). Combines with `audience` by union.
  recipientIds: string[];
  setRecipientIds: Dispatch<SetStateAction<string[]>>;
  employees: Employee[];
  viewerEmployeeId: string | null;
  sendPush: boolean;
  setSendPush: Dispatch<SetStateAction<boolean>>;
  // Scheduled posting. Empty string = post now, which is the default and the
  // behaviour the board has always had.
  postAt: string;
  setPostAt: Dispatch<SetStateAction<string>>;
  viewerEmail: string;
  onPost: () => void;
  onDelete: (id: string) => void;
  /** Reschedule a queued bulletin (datetime-local string). */
  onReschedule: (id: string, postAt: string) => void;
}

export default function BulletinBoard({
  bulletins,
  isAdmin,
  canPost,
  canDelete,
  effectiveRole,
  newTitle,
  setNewTitle,
  newContent,
  setNewContent,
  audience,
  setAudience,
  recipientIds,
  setRecipientIds,
  employees,
  viewerEmployeeId,
  sendPush,
  setSendPush,
  postAt,
  setPostAt,
  viewerEmail,
  onPost,
  onDelete,
  onReschedule,
}: BulletinBoardProps) {
  // Re-derived each render so a queued bulletin flips to live on the next
  // render after its moment, without waiting for the server. Visibility is
  // the clock's business, not a flag's — see lib/scheduledBulletins.
  const nowMs = Date.now();
  // Warned at compose time, not discovered at 6am: a push scheduled inside
  // quiet hours still holds to 8:00 AM, and the poster should know before they
  // rely on it.
  const quietNotice = postAt
    ? quietHoursNotice({
      publishAt: new Date(postAt).getTime(),
      notify: sendPush,
      hour: localHourOf(new Date(postAt).getTime()),
    })
    : null;
  const { live: publishedBulletins, scheduled } =
    splitBulletins(bulletins as BulletinPost[], nowMs, viewerEmail, isAdmin);
  const visibleBulletins = publishedBulletins.filter(b =>
    canSeeBulletin(b, { role: effectiveRole, employeeId: viewerEmployeeId }, isAdmin));
  const pickable = pickableRecipients(employees);

  const everyoneSelected = audience.length === 0;
  const toggleRole = (role: BulletinAudienceRole) => {
    setAudience(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-slate-100 p-6 print:bg-white">
      <div className="max-w-4xl mx-auto w-full space-y-6">
        <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div>
            <h2 className="text-3xl font-black text-slate-800 flex items-center gap-3"><Megaphone className="w-8 h-8 text-lime-500" /> Company Bulletin Board</h2>
            <p className="text-slate-500 font-medium mt-1">Announcements, policy updates, and team messages.</p>
          </div>
        </div>

        {canPost && (
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col gap-3">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 border-b pb-2"><PenTool className="w-4 h-4" /> Post New Bulletin</h3>
            <input type="text" placeholder="Bulletin Title" value={newTitle} onChange={e => setNewTitle(e.target.value)} className="font-bold text-lg border-none bg-slate-50 p-3 rounded-xl outline-none focus:ring-2 focus:ring-lime-400" />
            <textarea placeholder="Write your message here..." rows={3} value={newContent} onChange={e => setNewContent(e.target.value)} className="border-none bg-slate-50 p-3 rounded-xl outline-none resize-none focus:ring-2 focus:ring-lime-400 text-sm" />

            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Send to:</div>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={everyoneSelected} onChange={() => setAudience([])} className="w-4 h-4 text-lime-500 rounded focus:ring-lime-500" />
                  Everyone
                </label>
                <span className="text-slate-300">|</span>
                {ROLE_OPTIONS.map(opt => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm font-medium cursor-pointer text-slate-700">
                    <input
                      type="checkbox"
                      checked={audience.includes(opt.value)}
                      onChange={() => toggleRole(opt.value)}
                      className="w-4 h-4 text-lime-500 rounded focus:ring-lime-500"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                …and / or specific people
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {pickable.map(e => {
                  const on = recipientIds.includes(e.id);
                  return (
                    <button
                      key={e.id} type="button"
                      onClick={() => setRecipientIds(prev =>
                        prev.includes(e.id) ? prev.filter(x => x !== e.id) : [...prev, e.id])}
                      className={`text-xs font-bold px-2.5 py-1 rounded-lg border transition-colors ${on
                        ? 'bg-slate-800 text-white border-slate-800'
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'}`}
                    >
                      {e.name}
                    </button>
                  );
                })}
                {pickable.length === 0 && (
                  <span className="text-xs text-slate-400">No employees with an address to send to.</span>
                )}
              </div>
              {recipientIds.length > 0 && (
                <div className="text-[11px] text-slate-500 mt-1.5">
                  {audience.length > 0
                    ? 'Goes to the selected roles AND these people.'
                    : 'Goes to these people only — nobody else will see it.'}
                  <button onClick={() => setRecipientIds([])} className="ml-1.5 underline decoration-dotted font-bold">clear</button>
                </div>
              )}
            </div>

            <label className="flex items-center gap-2.5 text-sm font-bold text-slate-700 cursor-pointer bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
              <input type="checkbox" checked={sendPush} onChange={e => setSendPush(e.target.checked)} className="w-4 h-4 text-amber-500 rounded focus:ring-amber-500" />
              <Bell className="w-4 h-4 text-amber-500" />
              Also send a push notification {recipientIds.length > 0
                ? (audience.length > 0 ? 'to the selected roles and people' : 'to the selected people')
                : (audience.length > 0 ? 'to the selected roles' : 'to everyone')}
            </label>

            <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
              <label className="flex items-center gap-2.5 text-sm font-bold text-slate-700">
                <Clock className="w-4 h-4 text-slate-500" />
                Post at
                <input
                  type="datetime-local" value={postAt}
                  onChange={e => setPostAt(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2 py-1 text-sm font-normal"
                />
                {postAt && (
                  <button onClick={() => setPostAt('')} className="text-xs font-bold text-slate-500 underline decoration-dotted">
                    clear
                  </button>
                )}
              </label>
              <div className="text-[11px] text-slate-500 mt-1">
                {postAt
                  ? 'Held until then. Only you and admins can see it before it goes.'
                  : 'Leave blank to post now.'}
              </div>
              {postAt && quietNotice && (
                <div className="text-[11px] mt-1.5 px-2 py-1 rounded bg-amber-50 border border-amber-200 text-amber-800">
                  ⚠ {quietNotice}
                </div>
              )}
            </div>

            <div className="flex justify-end items-center mt-2">
              <button onClick={onPost} disabled={!newTitle || !newContent} className="bg-lime-500 hover:bg-lime-600 text-slate-900 px-6 py-2 rounded-xl font-bold transition-colors shadow-sm disabled:opacity-50">Post Bulletin</button>
            </div>
          </div>
        )}

        {scheduled.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-indigo-500" />
              <span className="text-[11px] font-black uppercase tracking-widest text-indigo-600">
                Scheduled · {scheduled.length}
              </span>
              <span className="text-[11px] text-slate-400">
                not visible to anyone else yet
              </span>
            </div>
            <div className="space-y-2">
              {scheduled.map(b => (
                <div key={b.id} className="bg-indigo-50/60 rounded-2xl border border-indigo-200 p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <h3 className="font-bold text-slate-800">{b.title}</h3>
                      <div className="text-xs text-indigo-700 font-semibold mt-0.5">
                        Posts {new Date(b.publishAt!).toLocaleString()}
                        {b.notifyOnPublish ? ' · will notify' : ' · no notification'}
                        {isForEveryone(b) ? '' : ` · To: ${describeAudience(b, employees)}`}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">By {b.author}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="datetime-local"
                        value={toLocalInput(b.publishAt!)}
                        onChange={e => onReschedule(b.id, e.target.value)}
                        className="border border-indigo-300 rounded-lg px-2 py-1 text-xs bg-white"
                        title="Change when this posts"
                      />
                      <button
                        onClick={() => onDelete(b.id)}
                        className="text-xs font-bold text-rose-500 hover:text-rose-700 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-rose-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Cancel
                      </button>
                    </div>
                  </div>
                  <div className="text-slate-700 text-sm whitespace-pre-wrap leading-relaxed mt-2">{b.content}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {visibleBulletins.length === 0 ? <div className="text-center p-10 text-slate-400 font-medium">No bulletins to display.</div> :
            visibleBulletins.map(b => (
              <div key={b.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative">
                {!isForEveryone(b) ? (
                  <div className="absolute top-0 right-0 bg-slate-700 text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-bl-lg flex items-center gap-1 shadow-sm max-w-[60%]" title={`To: ${describeAudience(b, employees)}`}>
                    <Users className="w-3 h-3 shrink-0" />
                    <span className="truncate">To: {describeAudience(b, employees)}</span>
                  </div>
                ) : b.isAdminOnly ? (
                  <div className="absolute top-0 right-0 bg-rose-500 text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-bl-lg flex items-center gap-1 shadow-sm"><Users className="w-3 h-3" /> Admin Only</div>
                ) : null}
                <div className="p-5">
                  <h3 className="text-xl font-bold text-slate-800 mb-1 pr-24">{b.title}</h3>
                  <div className="text-xs text-slate-400 font-medium mb-4 flex items-center gap-2">
                    <CalendarIcon className="w-3.5 h-3.5" /> {b.date} • By {b.author}
                  </div>
                  <div className="text-slate-700 text-sm whitespace-pre-wrap leading-relaxed">{b.content}</div>
                </div>
                {canDelete && (
                  <div className="bg-slate-50 border-t border-slate-100 p-2 flex justify-end">
                    <button onClick={() => onDelete(b.id)} className="text-xs font-bold text-rose-500 hover:text-rose-700 flex items-center gap-1 px-3 py-1 rounded-lg hover:bg-rose-50 transition-colors"><Trash2 className="w-3.5 h-3.5" /> Delete Post</button>
                  </div>
                )}
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}

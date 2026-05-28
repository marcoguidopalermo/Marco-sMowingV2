import type { Dispatch, SetStateAction } from 'react';
import { Megaphone, PenTool, Users, Trash2, Calendar as CalendarIcon } from 'lucide-react';
import type { BulletinAudienceRole, UserRole } from '../types';

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
  onPost: () => void;
  onDelete: (id: string) => void;
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
  onPost,
  onDelete,
}: BulletinBoardProps) {
  const visibleBulletins = bulletins.filter(b => {
    // Legacy posts with no audience field: respect admin-only flag, otherwise visible to all.
    if (!b.audience || b.audience.length === 0) return isAdmin ? true : !b.isAdminOnly;
    // New audience-targeted posts: visible only if user's role is in the audience array.
    return (b.audience as BulletinAudienceRole[]).includes(effectiveRole as BulletinAudienceRole);
  });

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

            <div className="flex justify-end items-center mt-2">
              <button onClick={onPost} disabled={!newTitle || !newContent} className="bg-lime-500 hover:bg-lime-600 text-slate-900 px-6 py-2 rounded-xl font-bold transition-colors shadow-sm disabled:opacity-50">Post Bulletin</button>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {visibleBulletins.length === 0 ? <div className="text-center p-10 text-slate-400 font-medium">No bulletins to display.</div> :
            visibleBulletins.map(b => (
              <div key={b.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative">
                {b.audience && b.audience.length > 0 ? (
                  <div className="absolute top-0 right-0 bg-slate-700 text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-bl-lg flex items-center gap-1 shadow-sm"><Users className="w-3 h-3" /> {b.audience.join(' · ')}</div>
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

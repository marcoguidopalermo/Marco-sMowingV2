import { useEffect, useRef, useState } from 'react';
import { UserCircle, Check, RotateCcw, X } from 'lucide-react';
import { MechanicTask } from '../types';

const PALETTE = [
  'bg-emerald-500',
  'bg-sky-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-violet-500',
  'bg-cyan-500',
  'bg-pink-500',
  'bg-orange-500'
];

function hashColor(email: string): string {
  if (!email) return 'bg-slate-400';
  let h = 0;
  for (let i = 0; i < email.length; i++) {
    h = (h * 31 + email.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function initialsOf(name: string, email: string): string {
  const source = name?.trim() || email?.split('@')[0] || '';
  if (!source) return '?';
  if (source.includes('@')) {
    return source.split('@')[0].slice(0, 2).toUpperCase();
  }
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function firstNameOf(name: string, email: string): string {
  const source = name?.trim() || email || '';
  if (!source) return 'Unknown';
  if (source.includes('@')) {
    const local = source.split('@')[0];
    return local.charAt(0).toUpperCase() + local.slice(1);
  }
  const parts = source.split(/\s+/).filter(Boolean);
  return parts[0] || 'Unknown';
}

interface UserOption {
  userEmail: string;
  userName: string;
}

interface AssigneeBadgeProps {
  task: MechanicTask;
  userOptions: UserOption[];
  currentUserEmail: string;
  currentUserName: string;
  onAssign: (taskId: string, assignedTo: { userEmail: string; userName: string } | null) => void;
}

export default function AssigneeBadge({
  task,
  userOptions,
  currentUserEmail,
  currentUserName,
  onAssign
}: AssigneeBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showUserList, setShowUserList] = useState(false);
  // Viewport-anchored menu position. Set when the menu opens (from the
  // avatar button's bounding rect) and used to render the dropdown with
  // `position: fixed`, so the menu can never extend past the viewport
  // edges regardless of how narrow the card or column it lives in is.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Resolve effective assignee
  const resolved = (() => {
    if (task.assignedTo) return { ...task.assignedTo, manual: true };
    const acts = task.activity || [];
    for (let i = acts.length - 1; i >= 0; i--) {
      const a = acts[i];
      if (a.userEmail) return { userEmail: a.userEmail, userName: a.userName || a.userEmail, manual: false };
    }
    return null;
  })();

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
        setShowUserList(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const email = resolved?.userEmail || '';
  const name = resolved?.userName || '';
  const color = resolved ? hashColor(email) : 'bg-slate-300';
  const initials = resolved ? initialsOf(name, email) : '?';
  const firstName = resolved ? firstNameOf(name, email) : '';

  const handleAssignSelf = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAssign(task.id, { userEmail: currentUserEmail, userName: currentUserName });
    setIsOpen(false);
    setShowUserList(false);
  };

  const handleAssignOther = (e: React.MouseEvent, opt: UserOption) => {
    e.stopPropagation();
    onAssign(task.id, opt);
    setIsOpen(false);
    setShowUserList(false);
  };

  const handleReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAssign(task.id, null);
    setIsOpen(false);
    setShowUserList(false);
  };

  return (
    <div ref={ref} className="relative inline-flex flex-col items-center print:hidden" onMouseDown={e => e.stopPropagation()}>
      <button
        type="button"
        title={resolved ? `${name || email}${resolved.manual ? ' (manually assigned)' : ' (auto from activity)'}` : 'Unassigned'}
        onClick={(e) => {
          e.stopPropagation();
          if (isOpen) { setIsOpen(false); setShowUserList(false); return; }
          // Compute a viewport-safe position for the menu before opening.
          // Anchor the menu's right edge to the button's right edge by
          // default (looks correct on desktop / wide screens), then clamp
          // both ends to stay inside the viewport with an 8px margin. On a
          // 375px viewport the menu is also allowed to shrink down to
          // viewport-minus-16px width, so the option text is never clipped.
          const rect = e.currentTarget.getBoundingClientRect();
          const PREFERRED_W = 224; // matches w-56
          const MARGIN = 8;
          const maxW = Math.max(160, window.innerWidth - MARGIN * 2);
          const width = Math.min(PREFERRED_W, maxW);
          let left = rect.right - width;
          if (left < MARGIN) left = MARGIN;
          if (left + width > window.innerWidth - MARGIN) {
            left = Math.max(MARGIN, window.innerWidth - width - MARGIN);
          }
          const top = rect.bottom + 4;
          setMenuPos({ top, left, width });
          setIsOpen(true);
          setShowUserList(false);
        }}
        onMouseDown={e => e.stopPropagation()}
        draggable={false}
        onDragStart={e => e.preventDefault()}
        className={`relative w-7 h-7 rounded-full ${color} text-white text-[10px] font-black uppercase tracking-tight flex items-center justify-center shadow-sm ring-2 ring-white hover:ring-slate-200 cursor-pointer`}
      >
        {resolved ? initials : <UserCircle className="w-4 h-4" />}
        {resolved?.manual && (
          <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-slate-800 border border-white" title="Manually assigned" />
        )}
      </button>
      {firstName && (
        <span className="text-[9px] font-bold text-slate-500 mt-0.5 leading-none truncate max-w-[60px]">{firstName}</span>
      )}

      {isOpen && menuPos && (
        <div
          className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden"
          style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width, maxHeight: 'calc(100vh - 16px)' }}
        >
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
            <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Assignee</div>
            <div className="text-xs font-bold text-slate-700 truncate">{resolved ? (name || email) : 'Unassigned'}</div>
            {resolved && (
              <div className="text-[9px] font-bold text-slate-400 mt-0.5">{resolved.manual ? 'Manual override' : 'Auto from activity'}</div>
            )}
          </div>

          {!showUserList ? (
            <div className="py-1">
              <button onClick={handleAssignSelf} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700">
                <Check className="w-3.5 h-3.5" /> Assign to me
              </button>
              <button onClick={(e) => { e.stopPropagation(); setShowUserList(true); }} className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                <span className="flex items-center gap-2">
                  <UserCircle className="w-3.5 h-3.5" /> Assign to…
                </span>
                <span className="text-slate-300">›</span>
              </button>
              {task.assignedTo && (
                <button onClick={handleReset} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-amber-50 hover:text-amber-700">
                  <RotateCcw className="w-3.5 h-3.5" /> Reset (auto-derive)
                </button>
              )}
              <button onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-slate-400 hover:bg-slate-50 border-t border-slate-100">
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto py-1">
              {userOptions.length === 0 ? (
                <div className="px-3 py-3 text-xs italic text-slate-400">No users found in activity log.</div>
              ) : userOptions.map(opt => {
                const isSelf = opt.userEmail === currentUserEmail;
                const c = hashColor(opt.userEmail);
                const init = initialsOf(opt.userName, opt.userEmail);
                return (
                  <button key={opt.userEmail} onClick={(e) => handleAssignOther(e, opt)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                    <span className={`w-5 h-5 rounded-full ${c} text-white text-[9px] font-black flex items-center justify-center shrink-0`}>{init}</span>
                    <span className="flex-1 text-left truncate">{opt.userName || opt.userEmail}</span>
                    {isSelf && <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600">You</span>}
                  </button>
                );
              })}
              <button onClick={(e) => { e.stopPropagation(); setShowUserList(false); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-slate-400 hover:bg-slate-50 border-t border-slate-100">
                ‹ Back
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Clock, MapPin, LogOut } from 'lucide-react';
import { AppData } from '../types';

type Loc = { lat: number; lng: number } | undefined;

interface TimeMasterWidgetProps {
  appData: AppData;
  userEmail: string;
  userName: string;
  // App's honest punch path (savePunch): resolves true once the punch is saved
  // or safely held on the device, false if it was refused. The widget used to
  // fire a whole-appData save and move on without knowing whether it landed.
  onClockIn: (loc: Loc) => Promise<boolean>;
  onClockOut: (loc: Loc) => Promise<boolean>;
}

const formatElapsed = (fromIso: string, now: Date) => {
  const diffMs = now.getTime() - new Date(fromIso).getTime();
  if (diffMs < 0) return '0m';
  const totalMin = Math.floor(diffMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const formatClockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function TimeMasterWidget({ appData, userEmail, onClockIn, onClockOut }: TimeMasterWidgetProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Tick every 60s to update elapsed time display
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  // Check if TimeMaster is enabled for this user. The lookup must
  // match App.tsx:275's linkage convention — by `linkedUserEmail`,
  // normalized (trim + lowercase) on both sides — so the
  // enable/disable gate is consistent with the rest of the app.
  // Defaults to enabled when no employee link is found.
  const normalizedUserEmail = (userEmail || '').trim().toLowerCase();
  const linkedEmployee = appData.employees.find(
    e => (e.linkedUserEmail || '').trim().toLowerCase() === normalizedUserEmail,
  );
  const enabled = linkedEmployee?.timeMasterEnabled !== false;
  if (!enabled) return null;

  const activeEntry = appData.timeEntries.find(e => e.userEmail === userEmail && !e.clockOut) || null;

  const getLocation = (cb: (loc: Loc) => void) => {
    if (!navigator.geolocation) { cb(undefined); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => cb({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => cb(undefined),
      { timeout: 5000, maximumAge: 60000 }
    );
  };

  const handleClockIn = () => {
    if (saving) return;
    setSaving(true);
    getLocation(async (loc) => {
      try { await onClockIn(loc); } finally { setSaving(false); }
    });
  };

  const handleClockOut = () => {
    if (!activeEntry || saving) return;
    setSaving(true);
    getLocation(async (loc) => {
      try {
        // Close the popover only on success; on a refusal the person is still
        // clocked in and the button is right there to try again.
        if (await onClockOut(loc)) setPopoverOpen(false);
      } finally { setSaving(false); }
    });
  };

  if (!activeEntry) {
    return (
      <button
        onClick={handleClockIn}
        disabled={saving}
        className="disabled:opacity-70 w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2.5 rounded-lg font-black text-xs uppercase tracking-widest shadow-sm shadow-emerald-600/20 transition-colors"
      >
        <Clock className="w-4 h-4" /> {saving ? 'Saving…' : 'Clock In'}
      </button>
    );
  }

  const elapsed = formatElapsed(activeEntry.clockIn, now);
  return (
    <div className="relative">
      <button
        onClick={() => setPopoverOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 px-3 py-2.5 rounded-lg font-black text-xs uppercase tracking-widest transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          Clocked In
        </span>
        <span className="font-mono text-[11px]">{elapsed}</span>
      </button>

      {popoverOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setPopoverOpen(false)} />
          <div className="absolute left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-2xl z-40 overflow-hidden">
            <div className="p-3 bg-slate-50 border-b border-slate-200">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Clocked In At</div>
              <div className="text-lg font-bold text-slate-800">{formatClockTime(activeEntry.clockIn)}</div>
            </div>
            <div className="p-3 border-b border-slate-100">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Elapsed</div>
              <div className="text-lg font-mono font-bold text-emerald-700">{elapsed}</div>
            </div>
            {activeEntry.inLocation && (
              <div className="p-3 border-b border-slate-100 flex items-center gap-2 text-[11px] text-slate-500">
                <MapPin className="w-3.5 h-3.5" />
                Location captured
              </div>
            )}
            <div className="p-3">
              <button
                onClick={handleClockOut}
                disabled={saving}
                className="disabled:opacity-70 w-full flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-3 py-2.5 rounded-lg font-black text-xs uppercase tracking-widest shadow-sm transition-colors"
              >
                <LogOut className="w-4 h-4" /> {saving ? 'Saving…' : 'Clock Out'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

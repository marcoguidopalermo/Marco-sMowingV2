import { useEffect, useMemo, useState } from 'react';
import {
  Clock, MapPin, Edit, Plus, Download, Users, AlertTriangle,
  ChevronDown, ChevronUp, X, Save, ArrowLeft, Calendar as CalendarIcon,
  Plane, RotateCcw
} from 'lucide-react';
import { AppData, TimeEntry, TimeEntryNote, TimeOffRequest } from '../types';
import { formatDate, addDays, getStartOfWeek, formatTodayInToronto } from '../lib/dateUtils';
import TimeOffApprovalPage from './TimeOffApprovalPage';

interface TimeMasterProps {
  appData: AppData;
  syncToCloud: (data: AppData) => Promise<boolean | undefined>;
  userEmail: string;
  userName: string;
  isAdmin: boolean;
  canViewAll: boolean;
  canEditAny: boolean;
  canExportCSV: boolean;
  showToastMsg: (msg: string) => void;
  // Time-off request flow — opened from a button on this page,
  // status section listed below the timesheet.
  onOpenTimeOffRequest: () => void;
  onEditTimeOffRequest: (requestId: string) => void;
  onCancelTimeOffRequest: (requestId: string) => void;
  onRevertTimeOffRequest: (requestId: string) => void;
  // Approver-side: when canApproveTimeOff is true a third tab
  // ("Approvals") surfaces with the pending queue + history.
  canApproveTimeOff: boolean;
  timeOffPendingCount: number;
  onApproveTimeOff: (requestId: string) => void;
  onDenyTimeOff: (requestId: string, reason: string) => void;
}

const UNCLOSED_THRESHOLD_MS = 12 * 60 * 60 * 1000;

const formatClockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const formatHM = (hours: number) => {
  if (!isFinite(hours) || hours < 0) return '0h 0m';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
};

const toLocalInputValue = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const csvEscape = (cell: any) => {
  const s = String(cell ?? '');
  return `"${s.replace(/"/g, '""')}"`;
};

export default function TimeMaster({
  appData,
  syncToCloud,
  userEmail,
  userName,
  isAdmin,
  canViewAll,
  canEditAny,
  canExportCSV,
  showToastMsg,
  onOpenTimeOffRequest,
  onEditTimeOffRequest,
  onCancelTimeOffRequest,
  onRevertTimeOffRequest,
  canApproveTimeOff,
  timeOffPendingCount,
  onApproveTimeOff,
  onDenyTimeOff,
}: TimeMasterProps) {
  // Tick every 60s so live "elapsed" updates
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const [viewMode, setViewMode] = useState<'mine' | 'all' | 'approvals'>('mine');
  const [drilledUserEmail, setDrilledUserEmail] = useState<string | null>(null);

  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'month' | 'custom'>('today');
  const [customStart, setCustomStart] = useState(formatTodayInToronto());
  const [customEnd, setCustomEnd] = useState(formatTodayInToronto());

  const [selectedDate, setSelectedDate] = useState(formatTodayInToronto());

  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [editForm, setEditForm] = useState({ clockIn: '', clockOut: '', reason: '' });

  // CSV export popup — replaces the inline export bar that used to
  // sit beneath the All Users list. Icon in the card header opens
  // this; date range + Export button live inside.
  const [isExportOpen, setIsExportOpen] = useState(false);

  // Manual entry modal — for missed punches. Admin / manager can
  // file one against any employee; everyone else is locked to
  // themselves (employeeEmail / Name pre-populated with the caller).
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false);
  const [manualForm, setManualForm] = useState({
    employeeEmail: '',
    employeeName: '',
    date: formatTodayInToronto(),
    clockInTime: '',
    clockOutTime: '',
    note: '',
  });

  const [exportStart, setExportStart] = useState(formatDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [exportEnd, setExportEnd] = useState(formatDate(new Date()));

  // Helpers tied to current `now`
  const isUnclosed = (entry: TimeEntry) =>
    !entry.clockOut && (now.getTime() - new Date(entry.clockIn).getTime() > UNCLOSED_THRESHOLD_MS);

  const entryDurationHours = (entry: TimeEntry) => {
    const end = entry.clockOut ? new Date(entry.clockOut).getTime() : now.getTime();
    const ms = end - new Date(entry.clockIn).getTime();
    return ms / (1000 * 60 * 60);
  };

  const sumHours = (entries: TimeEntry[]) => entries.reduce((s, e) => s + entryDurationHours(e), 0);

  const filterRange = (entries: TimeEntry[], startTs: number, endTs: number) =>
    entries.filter(e => {
      const t = new Date(e.clockIn).getTime();
      return t >= startTs && t <= endTs;
    });

  const todayRange = (): [number, number] => {
    const s = new Date(); s.setHours(0, 0, 0, 0);
    const e = new Date(); e.setHours(23, 59, 59, 999);
    return [s.getTime(), e.getTime()];
  };
  const weekRange = (): [number, number] => {
    const s = getStartOfWeek(new Date()); s.setHours(0, 0, 0, 0);
    const e = addDays(s, 6); e.setHours(23, 59, 59, 999);
    return [s.getTime(), e.getTime()];
  };
  const monthRange = (): [number, number] => {
    const d = new Date();
    const s = new Date(d.getFullYear(), d.getMonth(), 1); s.setHours(0, 0, 0, 0);
    const e = new Date(d.getFullYear(), d.getMonth() + 1, 0); e.setHours(23, 59, 59, 999);
    return [s.getTime(), e.getTime()];
  };

  const filterByDateFilter = (entries: TimeEntry[]) => {
    let range: [number, number];
    if (dateFilter === 'today') range = todayRange();
    else if (dateFilter === 'week') range = weekRange();
    else if (dateFilter === 'month') range = monthRange();
    else {
      const s = new Date(customStart + 'T00:00:00');
      const e = new Date(customEnd + 'T23:59:59');
      range = [s.getTime(), e.getTime()];
    }
    return filterRange(entries, range[0], range[1]);
  };

  // Owner of currently visible log
  const effectiveOwnerEmail = drilledUserEmail || userEmail;
  const effectiveOwnerName = useMemo(() => {
    if (!drilledUserEmail) return userName;
    const match = appData.timeEntries.find(e => e.userEmail === drilledUserEmail);
    return match?.userName || drilledUserEmail;
  }, [drilledUserEmail, userName, appData.timeEntries]);

  const ownerEntries = useMemo(
    () => appData.timeEntries.filter(e => e.userEmail === effectiveOwnerEmail).sort((a, b) => new Date(b.clockIn).getTime() - new Date(a.clockIn).getTime()),
    [appData.timeEntries, effectiveOwnerEmail]
  );

  const todayHours = sumHours(filterRange(ownerEntries, ...todayRange()));
  const weekHours = sumHours(filterRange(ownerEntries, ...weekRange()));
  const monthHours = sumHours(filterRange(ownerEntries, ...monthRange()));
  const filteredOwnerEntries = filterByDateFilter(ownerEntries);

  // All users (for admin overview)
  const allUsers = useMemo(() => {
    const map = new Map<string, string>();
    appData.timeEntries.forEach(e => { if (!map.has(e.userEmail)) map.set(e.userEmail, e.userName); });
    return Array.from(map.entries()).map(([email, name]) => ({ email, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [appData.timeEntries]);

  const userSummaries = useMemo(() => {
    const [tS, tE] = todayRange();
    const [wS, wE] = weekRange();
    const [mS, mE] = monthRange();
    return allUsers.map(u => {
      const entries = appData.timeEntries.filter(e => e.userEmail === u.email);
      const today = sumHours(filterRange(entries, tS, tE));
      const week = sumHours(filterRange(entries, wS, wE));
      const month = sumHours(filterRange(entries, mS, mE));
      const lastPunchTs = entries.reduce((latest, e) => {
        const t = new Date(e.clockOut || e.clockIn).getTime();
        return t > latest ? t : latest;
      }, 0);
      const active = entries.some(e => !e.clockOut && !isUnclosed(e));
      const hasUnclosed = entries.some(e => isUnclosed(e));
      return { ...u, today, week, month, lastPunchTs, active, hasUnclosed };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allUsers, appData.timeEntries, now]);

  // Timeline computation: 6 AM (360 min) to 10 PM (1320 min) = 960 min span
  const TL_START_MIN = 6 * 60;
  const TL_END_MIN = 22 * 60;
  const TL_SPAN_MIN = TL_END_MIN - TL_START_MIN;
  const minutesOfDay = (iso: string) => {
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
  };
  const isSameLocalDate = (iso: string, dateStr: string) => formatDate(new Date(iso)) === dateStr;

  // Note add
  const canAddNoteToEntry = (entry: TimeEntry) => entry.userEmail === userEmail || canEditAny;

  const addNote = (entry: TimeEntry) => {
    const text = (noteInputs[entry.id] || '').trim();
    if (!text) return;
    if (!canAddNoteToEntry(entry)) return;
    const newNote: TimeEntryNote = {
      author: userEmail,
      authorName: userName,
      timestamp: new Date().toISOString(),
      text,
    };
    const updated: TimeEntry = { ...entry, notes: [...entry.notes, newNote] };
    syncToCloud({
      ...appData,
      timeEntries: appData.timeEntries.map(e => e.id === entry.id ? updated : e),
    });
    setNoteInputs(p => ({ ...p, [entry.id]: '' }));
  };

  // Admin edit
  const openEdit = (entry: TimeEntry) => {
    setEditingEntry(entry);
    setEditForm({
      clockIn: toLocalInputValue(entry.clockIn),
      clockOut: entry.clockOut ? toLocalInputValue(entry.clockOut) : '',
      reason: '',
    });
  };

  // Open the manual-entry modal. Non-admin/manager callers get
  // their own identity locked in — they can only file for themselves.
  const openManualEntry = () => {
    setManualForm({
      employeeEmail: canEditAny ? '' : userEmail,
      employeeName: canEditAny ? '' : userName,
      date: formatTodayInToronto(),
      clockInTime: '',
      clockOutTime: '',
      note: '',
    });
    setIsManualEntryOpen(true);
  };

  // Submit a manual entry. Builds a normal TimeEntry (same shape as
  // a clocked entry; clockIn / clockOut are ISO timestamps) plus the
  // manualEntry flag + enteredBy stamp. The syncToCloud wrapper at
  // the App layer fans into processPayChunksOnTimeUpdate, so hours
  // count toward pay chunks identically to a real punch.
  const submitManualEntry = () => {
    const { employeeEmail, employeeName, date, clockInTime, clockOutTime, note } = manualForm;
    if (!employeeEmail) { showToastMsg('Pick an employee.'); return; }
    if (!date) { showToastMsg('Date is required.'); return; }
    if (!clockInTime || !clockOutTime) { showToastMsg('Both clock-in and clock-out times are required.'); return; }
    const clockIn = new Date(`${date}T${clockInTime}:00`);
    const clockOut = new Date(`${date}T${clockOutTime}:00`);
    if (!Number.isFinite(clockIn.getTime()) || !Number.isFinite(clockOut.getTime())) {
      showToastMsg('Invalid date or time.');
      return;
    }
    if (clockOut.getTime() <= clockIn.getTime()) {
      showToastMsg('Clock-out must be after clock-in.');
      return;
    }
    const trimmedNote = note.trim();
    const newEntry: TimeEntry = {
      id: `te-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userEmail: employeeEmail.toLowerCase(),
      userName: employeeName,
      clockIn: clockIn.toISOString(),
      clockOut: clockOut.toISOString(),
      notes: trimmedNote ? [{
        author: userEmail,
        authorName: userName,
        timestamp: new Date().toISOString(),
        text: `[Manual entry] ${trimmedNote}`,
      }] : [],
      manualEntry: true,
      enteredBy: { email: userEmail, name: userName },
    };
    syncToCloud({
      ...appData,
      timeEntries: [...appData.timeEntries, newEntry],
    });
    setIsManualEntryOpen(false);
    showToastMsg('Manual entry added.');
  };

  const saveEdit = () => {
    if (!editingEntry) return;
    if (!editForm.reason.trim()) { showToastMsg('Reason is required for edits.'); return; }
    if (!editForm.clockIn) { showToastMsg('Clock In time is required.'); return; }
    const newNote: TimeEntryNote = {
      author: userEmail,
      authorName: userName,
      timestamp: new Date().toISOString(),
      text: `[Edit] ${editForm.reason}`,
    };
    const updated: TimeEntry = {
      ...editingEntry,
      clockIn: new Date(editForm.clockIn).toISOString(),
      clockOut: editForm.clockOut ? new Date(editForm.clockOut).toISOString() : undefined,
      editedBy: userEmail,
      editedAt: new Date().toISOString(),
      notes: [...editingEntry.notes, newNote],
    };
    syncToCloud({
      ...appData,
      timeEntries: appData.timeEntries.map(e => e.id === editingEntry.id ? updated : e),
    });
    setEditingEntry(null);
    showToastMsg('Entry updated.');
  };

  // CSV export
  const exportCsv = () => {
    const sTs = new Date(exportStart + 'T00:00:00').getTime();
    const eTs = new Date(exportEnd + 'T23:59:59').getTime();
    const rows = appData.timeEntries
      .filter(e => {
        const t = new Date(e.clockIn).getTime();
        return t >= sTs && t <= eTs;
      })
      .sort((a, b) => new Date(a.clockIn).getTime() - new Date(b.clockIn).getTime())
      .map(e => [
        e.userName,
        e.userEmail,
        formatDate(new Date(e.clockIn)),
        formatClockTime(e.clockIn),
        e.clockOut ? formatClockTime(e.clockOut) : '',
        entryDurationHours(e).toFixed(2),
        e.inLocation?.lat ?? '',
        e.inLocation?.lng ?? '',
        e.outLocation?.lat ?? '',
        e.outLocation?.lng ?? '',
        e.notes.length,
        isUnclosed(e) ? 'Unclosed' : (e.clockOut ? 'Closed' : 'Active'),
      ]);
    const header = ['User', 'Email', 'Date', 'Clock In', 'Clock Out', 'Total Hours', 'In Lat', 'In Lng', 'Out Lat', 'Out Lng', 'Notes Count', 'Status'];
    const csv = [header, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timemaster-export-${exportStart}-to-${exportEnd}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ---------- RENDER HELPERS ----------

  const renderStatCards = () => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col items-center">
        <div className="text-gray-500 font-bold uppercase tracking-wider text-[10px] mb-1">Today</div>
        <div className="text-3xl font-black text-emerald-600">{formatHM(todayHours)}</div>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col items-center">
        <div className="text-gray-500 font-bold uppercase tracking-wider text-[10px] mb-1">This Week (Mon–Sun)</div>
        <div className="text-3xl font-black text-emerald-600">{formatHM(weekHours)}</div>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col items-center">
        <div className="text-gray-500 font-bold uppercase tracking-wider text-[10px] mb-1">This Month</div>
        <div className="text-3xl font-black text-emerald-600">{formatHM(monthHours)}</div>
      </div>
    </div>
  );

  const renderDateFilter = () => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 mb-4 flex flex-wrap items-center gap-2">
      {(['today', 'week', 'month', 'custom'] as const).map(f => (
        <button
          key={f}
          onClick={() => setDateFilter(f)}
          className={`px-3 py-1.5 text-xs font-black uppercase tracking-widest rounded transition-colors ${dateFilter === f ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          {f === 'today' ? 'Today' : f === 'week' ? 'This Week' : f === 'month' ? 'This Month' : 'Custom'}
        </button>
      ))}
      {dateFilter === 'custom' && (
        <div className="flex items-center gap-2 ml-2">
          <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="border border-gray-300 rounded p-1.5 text-sm" />
          <span className="text-gray-400 text-sm">to</span>
          <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="border border-gray-300 rounded p-1.5 text-sm" />
        </div>
      )}
    </div>
  );

  const renderEntryRow = (entry: TimeEntry) => {
    const unclosed = isUnclosed(entry);
    const status = unclosed ? 'Unclosed' : (entry.clockOut ? 'Closed' : 'Active');
    const statusClass = unclosed
      ? 'bg-rose-100 text-rose-700 border-rose-200'
      : entry.clockOut
        ? 'bg-slate-100 text-slate-600 border-slate-200'
        : 'bg-emerald-100 text-emerald-700 border-emerald-200';
    const expanded = expandedEntryId === entry.id;
    const inMapsUrl = entry.inLocation ? `https://www.google.com/maps?q=${entry.inLocation.lat},${entry.inLocation.lng}` : null;
    const outMapsUrl = entry.outLocation ? `https://www.google.com/maps?q=${entry.outLocation.lat},${entry.outLocation.lng}` : null;
    const canEdit = canEditAny;
    const canNote = canAddNoteToEntry(entry);

    return (
      <div key={entry.id} className={`bg-white rounded-xl border ${unclosed ? 'border-rose-200 ring-1 ring-rose-100' : 'border-gray-200'} shadow-sm overflow-hidden`}>
        <div className="grid grid-cols-12 gap-3 p-3 items-center text-sm">
          <div className="col-span-2 font-bold text-slate-700">{formatDate(new Date(entry.clockIn))}</div>
          <div className="col-span-2 flex items-center gap-1.5">
            <span className="font-mono font-bold text-slate-800">{formatClockTime(entry.clockIn)}</span>
            {inMapsUrl && <a href={inMapsUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-black text-emerald-600 hover:underline flex items-center gap-0.5"><MapPin className="w-3 h-3" /> Map</a>}
          </div>
          <div className="col-span-2 flex items-center gap-1.5">
            {entry.clockOut ? (
              <>
                <span className="font-mono font-bold text-slate-800">{formatClockTime(entry.clockOut)}</span>
                {outMapsUrl && <a href={outMapsUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-black text-emerald-600 hover:underline flex items-center gap-0.5"><MapPin className="w-3 h-3" /> Map</a>}
              </>
            ) : (
              <span className="text-slate-400 italic">—</span>
            )}
          </div>
          <div className="col-span-2 font-mono font-bold text-emerald-700">{formatHM(entryDurationHours(entry))}</div>
          <div className="col-span-1">
            <button
              onClick={() => setExpandedEntryId(expanded ? null : entry.id)}
              className="text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded flex items-center gap-1"
            >
              {entry.notes.length} {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
          <div className="col-span-2 flex items-center gap-2 justify-end flex-wrap">
            {entry.manualEntry && (
              <span
                className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded border bg-amber-50 text-amber-700 border-amber-200"
                title={entry.enteredBy ? `Manual entry by ${entry.enteredBy.name}` : 'Manual entry'}
              >
                Manual{entry.enteredBy ? ` · ${entry.enteredBy.name}` : ''}
              </span>
            )}
            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded border ${statusClass}`}>{status}</span>
            {canEdit && (
              <button onClick={() => openEdit(entry)} title="Edit entry (admin)" className="p-1.5 bg-slate-50 border border-slate-200 rounded hover:bg-slate-100 text-slate-600">
                <Edit className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="col-span-1" />
        </div>

        {expanded && (
          <div className="border-t border-slate-100 bg-slate-50 p-3 space-y-2">
            {entry.editedBy && (
              <div className="text-[10px] text-slate-500 italic">Edited by {entry.editedBy} at {entry.editedAt ? new Date(entry.editedAt).toLocaleString() : ''}</div>
            )}
            {entry.notes.length === 0 ? (
              <div className="text-xs italic text-slate-400">No notes yet.</div>
            ) : (
              entry.notes.map((n, i) => (
                <div key={i} className="bg-white border border-slate-200 rounded-lg p-2">
                  <div className="text-[10px] font-bold text-slate-500 mb-0.5">{n.authorName} • {new Date(n.timestamp).toLocaleString()}</div>
                  <div className="text-sm text-slate-800 whitespace-pre-wrap">{n.text}</div>
                </div>
              ))
            )}
            {canNote && (
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="text"
                  placeholder="Add a note..."
                  value={noteInputs[entry.id] || ''}
                  onChange={e => setNoteInputs(p => ({ ...p, [entry.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') addNote(entry); }}
                  className="flex-1 border border-slate-300 rounded p-1.5 text-sm outline-none focus:ring-2 focus:ring-emerald-400"
                />
                <button
                  onClick={() => addNote(entry)}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-black uppercase tracking-widest"
                >
                  <Plus className="w-3.5 h-3.5 inline" /> Add
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderLog = (title: string) => (
    <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
      <div className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3">{title}</div>
      <div className="grid grid-cols-12 gap-3 px-3 pb-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
        <div className="col-span-2">Date</div>
        <div className="col-span-2">Clock In</div>
        <div className="col-span-2">Clock Out</div>
        <div className="col-span-2">Total</div>
        <div className="col-span-1">Notes</div>
        <div className="col-span-2 text-right">Status</div>
        <div className="col-span-1" />
      </div>
      <div className="space-y-2">
        {filteredOwnerEntries.length === 0 ? (
          <div className="text-center text-slate-400 italic py-10">No time entries in this range.</div>
        ) : (
          filteredOwnerEntries.map(renderEntryRow)
        )}
      </div>
    </div>
  );

  const renderTimeline = () => {
    const dateEntries = appData.timeEntries.filter(e => isSameLocalDate(e.clockIn, selectedDate));
    const usersOnDate = Array.from(new Set(dateEntries.map(e => e.userEmail)))
      .map(email => ({ email, name: dateEntries.find(d => d.userEmail === email)?.userName || email }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const hourMarkers = [];
    for (let h = 6; h <= 22; h += 2) hourMarkers.push(h);

    const isToday = selectedDate === formatTodayInToronto();

    const renderBar = (entry: TimeEntry) => {
      const inMin = minutesOfDay(entry.clockIn);
      let outMin: number;
      let isOngoing = false;
      let isUncl = false;

      if (entry.clockOut && isSameLocalDate(entry.clockOut, selectedDate)) {
        outMin = minutesOfDay(entry.clockOut);
      } else if (entry.clockOut) {
        outMin = TL_END_MIN;
      } else if (isToday) {
        outMin = minutesOfDay(now.toISOString());
        isOngoing = true;
        isUncl = isUnclosed(entry);
      } else {
        outMin = TL_END_MIN;
        isUncl = true;
      }

      const leftPct = Math.max(0, ((inMin - TL_START_MIN) / TL_SPAN_MIN) * 100);
      const rightEdge = Math.min(100, ((outMin - TL_START_MIN) / TL_SPAN_MIN) * 100);
      const widthPct = Math.max(1, rightEdge - leftPct);

      const colorClass = isUncl
        ? 'bg-rose-500'
        : isOngoing
          ? 'bg-amber-500'
          : 'bg-emerald-500';

      const tooltip = `${formatClockTime(entry.clockIn)} – ${entry.clockOut ? formatClockTime(entry.clockOut) : (isUncl ? 'Unclosed' : 'Ongoing')} (${formatHM(entryDurationHours(entry))})`;

      return (
        <div
          key={entry.id}
          title={tooltip}
          className={`absolute top-1 bottom-1 ${colorClass} rounded shadow-sm hover:opacity-80 cursor-pointer`}
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        />
      );
    };

    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-gray-800 flex items-center gap-2"><Clock className="w-4 h-4 text-emerald-600" /> Daily Timeline</h3>
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-4 h-4 text-gray-500" />
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="border border-gray-300 rounded p-1.5 text-sm" />
          </div>
        </div>

        {/* Hour scale */}
        <div className="ml-32 relative h-5 mb-1 border-b border-gray-200">
          {hourMarkers.map(h => {
            const pct = ((h * 60 - TL_START_MIN) / TL_SPAN_MIN) * 100;
            const label = h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`;
            return (
              <div key={h} className="absolute text-[10px] font-bold text-gray-400" style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}>
                {label}
              </div>
            );
          })}
        </div>

        {/* Rows */}
        {usersOnDate.length === 0 ? (
          <div className="text-center text-slate-400 italic py-8">No entries on this date.</div>
        ) : (
          <div className="space-y-1">
            {usersOnDate.map(u => {
              const entries = dateEntries.filter(e => e.userEmail === u.email);
              return (
                <div key={u.email} className="flex items-center">
                  <div className="w-32 text-xs font-bold text-slate-700 truncate pr-2">{u.name}</div>
                  <div className="relative flex-1 h-7 bg-slate-50 border border-slate-100 rounded">
                    {hourMarkers.map(h => {
                      const pct = ((h * 60 - TL_START_MIN) / TL_SPAN_MIN) * 100;
                      return <div key={h} className="absolute top-0 bottom-0 border-l border-slate-100" style={{ left: `${pct}%` }} />;
                    })}
                    {entries.map(renderBar)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] font-bold text-slate-500">
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded bg-emerald-500" /> Closed</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded bg-amber-500" /> Active</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded bg-rose-500" /> Unclosed (&gt;12h)</span>
          <span className="ml-auto italic">Window: 6am – 10pm</span>
        </div>
      </div>
    );
  };

  const renderUsersTable = () => (
    // Self-contained scroll surface for the All Users list. The card
    // bounds itself to 70vh and the table body has its own
    // overflow-y-auto + min-h-0, so the full list renders and
    // scrolls inside the card regardless of how the outer flex
    // chain behaves on the current viewport. Sticky thead keeps the
    // column titles in view while scrolling, and overflow-x-auto
    // saves the layout if the columns ever overflow on a phone.
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6 flex flex-col max-h-[70vh]">
      <div className="bg-gray-50 border-b border-gray-200 px-3 py-2 shrink-0 flex items-center justify-between gap-2">
        <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm"><Users className="w-4 h-4 text-gray-500" /> All Users</h3>
        {canExportCSV && (
          <button
            onClick={() => setIsExportOpen(true)}
            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 transition-colors"
            title="Export to CSV"
            aria-label="Export to CSV"
          >
            <Download className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-gray-50 z-10">
            <tr className="border-b border-gray-200 text-[10px] text-gray-500 uppercase"><th className="px-2 py-1.5">User</th><th className="px-2 py-1.5 text-right">Today</th><th className="px-2 py-1.5 text-right">Week</th><th className="px-2 py-1.5 text-right">Month</th><th className="px-2 py-1.5">Last Punch</th><th className="px-2 py-1.5 text-right">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {userSummaries.length === 0 ? (
              <tr><td colSpan={6} className="p-4 text-center text-slate-400 italic text-xs">No time entries recorded yet.</td></tr>
            ) : (
              userSummaries.map(u => (
                <tr key={u.email} className="hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => setDrilledUserEmail(u.email)}>
                  <td className="px-2 py-1.5">
                    <div className="font-bold text-slate-800 text-xs leading-tight">{u.name}</div>
                    <div className="text-[9px] text-slate-400 font-medium leading-tight truncate max-w-[180px]" title={u.email}>{u.email}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono font-bold text-emerald-700 text-xs">{formatHM(u.today)}</td>
                  <td className="px-2 py-1.5 text-right font-mono font-bold text-emerald-700 text-xs">{formatHM(u.week)}</td>
                  <td className="px-2 py-1.5 text-right font-mono font-bold text-emerald-700 text-xs">{formatHM(u.month)}</td>
                  <td className="px-2 py-1.5 text-[11px] text-slate-600 whitespace-nowrap">{u.lastPunchTs ? new Date(u.lastPunchTs).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</td>
                  <td className="px-2 py-1.5 text-right">
                    {u.hasUnclosed ? (
                      <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border bg-rose-100 text-rose-700 border-rose-200 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Unclosed</span>
                    ) : u.active ? (
                      <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border bg-emerald-100 text-emerald-700 border-emerald-200">Active</span>
                    ) : (
                      <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-200">Off</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  // Export bar is now a popup launched from the All Users card
  // header icon (modal rendered at the bottom of TimeMaster).
  // The export logic itself stays in exportCsv() above.

  // ---------- MAIN RENDER ----------

  const showAdminAllUsers = canViewAll && viewMode === 'all' && !drilledUserEmail;

  // Acknowledge pending requests as seen by THIS approver when the
  // Approvals tab opens. TaskMaster per-record pattern — bumps
  // acknowledgedByAdmin[me] = now for every still-pending request,
  // clearing the approver-side badge on the TimeMaster nav icon.
  useEffect(() => {
    if (viewMode !== 'approvals') return;
    if (!canApproveTimeOff) return;
    const me = (userEmail || '').trim().toLowerCase();
    if (!me) return;
    const map = appData.timeOffRequests || {};
    const stale = Object.values(map).filter(r => {
      if (!r || r.status !== 'pending') return false;
      const ack = (r.acknowledgedByAdmin || {})[me] || 0;
      return ack < (r.createdAt || 0);
    });
    if (stale.length === 0) return;
    const nowMs = Date.now();
    const next = { ...map };
    for (const r of stale) {
      next[r.id] = { ...r, acknowledgedByAdmin: { ...(r.acknowledgedByAdmin || {}), [me]: nowMs } };
    }
    syncToCloud({ ...appData, timeOffRequests: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, appData.timeOffRequests, canApproveTimeOff]);

  // --- MY TIME OFF SECTION ----------------------------------------
  // Lists the signed-in user's own time-off requests with status
  // chips + status-appropriate actions. Always keyed off
  // userEmail (NOT drilledUserEmail) so admin-drill-into-other-user
  // doesn't accidentally show the wrong person's requests; the
  // section is hidden in drill view anyway.
  const myRequests = useMemo(() => {
    const me = (userEmail || '').toLowerCase();
    return Object.values(appData.timeOffRequests || {})
      .filter(r => (r.employeeEmail || '').toLowerCase() === me)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [appData.timeOffRequests, userEmail]);

  const formatRangeShort = (r: TimeOffRequest): string => {
    if (r.type === 'full_day') {
      if (r.startDate && r.endDate && r.startDate === r.endDate) return r.startDate;
      if (r.startDate && r.endDate) return `${r.startDate} – ${r.endDate}`;
      return '—';
    }
    return `${r.partialDate || ''} · ${r.partialStart || ''}–${r.partialEnd || ''}`;
  };

  const statusChipCls = (s: TimeOffRequest['status']) =>
    s === 'pending' ? 'bg-amber-100 text-amber-700 border-amber-300'
    : s === 'approved' ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
    : s === 'denied' ? 'bg-rose-100 text-rose-700 border-rose-300'
    : 'bg-slate-100 text-slate-600 border-slate-200';
  const statusLabelMap: Record<TimeOffRequest['status'], string> = {
    pending: 'Pending', approved: 'Approved', denied: 'Denied', cancelled: 'Cancelled', reverted: 'Reverted',
  };

  const renderMyTimeOff = () => (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="text-xs font-black uppercase tracking-widest text-sky-700 inline-flex items-center gap-2">
          <Plane className="w-3.5 h-3.5" /> My Time Off
          <span className="text-[10px] font-bold text-slate-400">{myRequests.length}</span>
        </div>
      </div>
      <div className="p-3 space-y-2">
        {myRequests.length === 0 ? (
          <div className="text-xs text-slate-400 italic text-center py-3">No time-off requests yet. Tap <strong>Request Time Off</strong> to submit one.</div>
        ) : myRequests.slice(0, 8).map(r => (
          <div key={r.id} className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/40">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${statusChipCls(r.status)}`}>{statusLabelMap[r.status]}</span>
                  <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border bg-white text-slate-500 border-slate-200">{r.type === 'full_day' ? 'Full' : 'Partial'}</span>
                  <span className="text-sm font-bold text-slate-800">{formatRangeShort(r)}</span>
                </div>
                {r.note && <div className="text-[11px] text-slate-500 mt-1">{r.note}</div>}
                {r.denialReason && <div className="text-[11px] text-rose-600 mt-1">Denied: {r.denialReason}</div>}
                {r.reviewedBy?.name && r.status !== 'pending' && (
                  <div className="text-[10px] text-slate-400 mt-1">by {r.reviewedBy.name}</div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {r.status === 'pending' && (
                  <>
                    <button onClick={() => onEditTimeOffRequest(r.id)} className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-200 px-2 py-1 rounded">
                      <Edit className="w-3 h-3" /> Edit
                    </button>
                    <button onClick={() => { if (window.confirm('Cancel this request?')) onCancelTimeOffRequest(r.id); }} className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-rose-600 hover:bg-rose-50 px-2 py-1 rounded">
                      <X className="w-3 h-3" /> Cancel
                    </button>
                  </>
                )}
                {r.status === 'approved' && (
                  <button onClick={() => { if (window.confirm('Revert this approved time-off? The blocked-off dates will be removed from your record. You won\'t be re-added to any crews you were taken off.')) onRevertTimeOffRequest(r.id); }} className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-rose-600 hover:bg-rose-50 border border-rose-200 px-2 py-1 rounded">
                    <RotateCcw className="w-3 h-3" /> Revert
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-y-auto bg-gray-100 p-6">
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Clock className="w-6 h-6 text-emerald-600" /> TimeMaster
          {drilledUserEmail && (
            <>
              <span className="text-gray-400 font-light">·</span>
              <span className="text-base font-bold text-slate-700">{effectiveOwnerName}</span>
            </>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenTimeOffRequest}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-white bg-sky-600 hover:bg-sky-700 rounded-lg shadow-sm"
            title="Request time off"
          >
            <Plane className="w-3.5 h-3.5" /> Request Time Off
          </button>
          <button
            onClick={openManualEntry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm"
            title={canEditAny ? 'Add a manual time entry for any employee' : 'Add a manual time entry for yourself (missed punch)'}
          >
            <Plus className="w-3.5 h-3.5" /> Add Manual Entry
          </button>
          {drilledUserEmail && (
            <button onClick={() => setDrilledUserEmail(null)} className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-xs font-black uppercase tracking-widest">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to All Users
            </button>
          )}
          {(canViewAll || canApproveTimeOff) && !drilledUserEmail && (
            <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
              <button onClick={() => setViewMode('mine')} className={`px-4 py-1.5 text-xs font-black uppercase tracking-widest rounded-md ${viewMode === 'mine' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500 hover:text-gray-700'}`}>My Logs</button>
              {canViewAll && (
                <button onClick={() => setViewMode('all')} className={`px-4 py-1.5 text-xs font-black uppercase tracking-widest rounded-md ${viewMode === 'all' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500 hover:text-gray-700'}`}>All Users</button>
              )}
              {canApproveTimeOff && (
                <button onClick={() => setViewMode('approvals')} className={`relative px-4 py-1.5 text-xs font-black uppercase tracking-widest rounded-md inline-flex items-center gap-1.5 ${viewMode === 'approvals' ? 'bg-sky-50 text-sky-700' : 'text-gray-500 hover:text-gray-700'}`}>
                  <Plane className="w-3.5 h-3.5" />
                  Approvals
                  {timeOffPendingCount > 0 && (
                    <span className="min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center" aria-label={`${timeOffPendingCount} pending`}>
                      {timeOffPendingCount > 99 ? '99+' : timeOffPendingCount}
                    </span>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {viewMode === 'approvals' ? (
        <TimeOffApprovalPage
          requests={appData.timeOffRequests || {}}
          employees={appData.employees || []}
          onApprove={onApproveTimeOff}
          onDeny={onDenyTimeOff}
        />
      ) : (
        <>
          {!drilledUserEmail && renderMyTimeOff()}
          {showAdminAllUsers ? (
            <>
              {renderTimeline()}
              {renderUsersTable()}
            </>
          ) : (
            <>
              {renderStatCards()}
              {renderDateFilter()}
              {renderLog(drilledUserEmail ? `${effectiveOwnerName}'s Time Log` : 'My Time Log')}
            </>
          )}
        </>
      )}

      {/* EDIT MODAL */}
      {editingEntry && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex md:items-center md:justify-center md:p-4">
          <div className="bg-white md:rounded-2xl shadow-2xl h-full md:h-auto w-full md:max-w-md overflow-hidden flex flex-col animate-in zoom-in-95">
            <div className="p-5 border-b border-gray-200 bg-slate-900 text-white flex justify-between items-center">
              <div className="flex items-center gap-3">
                <Edit className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-bold">Edit Time Entry</h3>
              </div>
              <button onClick={() => setEditingEntry(null)} className="text-white/60 hover:text-white min-w-[44px] min-h-[44px] inline-flex items-center justify-center"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">User</span>
                <p className="font-bold text-slate-800 text-sm">{editingEntry.userName} ({editingEntry.userEmail})</p>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Clock In</label>
                <input
                  type="datetime-local"
                  value={editForm.clockIn}
                  onChange={e => setEditForm(p => ({ ...p, clockIn: e.target.value }))}
                  className="w-full border border-slate-300 rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Clock Out (leave empty for active)</label>
                <input
                  type="datetime-local"
                  value={editForm.clockOut}
                  onChange={e => setEditForm(p => ({ ...p, clockOut: e.target.value }))}
                  className="w-full border border-slate-300 rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Reason for Edit *</label>
                <textarea
                  value={editForm.reason}
                  onChange={e => setEditForm(p => ({ ...p, reason: e.target.value }))}
                  rows={3}
                  placeholder="Why is this entry being edited?"
                  className="w-full border border-slate-300 rounded-xl p-3 text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-400 resize-none"
                />
              </div>
            </div>
            <div className="p-5 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setEditingEntry(null)} className="px-6 py-2.5 font-bold text-slate-500 hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
              <button onClick={saveEdit} className="px-6 py-2.5 font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow uppercase tracking-widest text-xs flex items-center gap-2"><Save className="w-4 h-4" /> Save</button>
            </div>
          </div>
        </div>
      )}

      {/* EXPORT POPUP — launched from the Download icon in the All
          Users card header. Same date range + CSV launch as the old
          inline bar; just moved off the page so the user list owns
          the vertical space. */}
      {isExportOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-[100] flex md:items-center md:justify-center md:p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setIsExportOpen(false); }}
        >
          <div className="bg-white md:rounded-2xl shadow-2xl h-full md:h-auto w-full md:max-w-md overflow-hidden flex flex-col animate-in zoom-in-95">
            <div className="p-5 border-b border-gray-200 bg-slate-900 text-white flex justify-between items-center">
              <div className="flex items-center gap-3">
                <Download className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-bold">Export to CSV</h3>
              </div>
              <button onClick={() => setIsExportOpen(false)} className="text-white/60 hover:text-white min-w-[44px] min-h-[44px] inline-flex items-center justify-center"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">From</label>
                  <input
                    type="date"
                    value={exportStart}
                    onChange={e => setExportStart(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">To</label>
                  <input
                    type="date"
                    value={exportEnd}
                    onChange={e => setExportEnd(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>
              </div>
              <div className="text-[11px] text-slate-500">
                Exports every TimeEntry whose clock-in falls in this range. Manual entries are included with their full row.
              </div>
            </div>
            <div className="p-5 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setIsExportOpen(false)} className="px-6 py-2.5 font-bold text-slate-500 hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
              <button
                onClick={() => { exportCsv(); setIsExportOpen(false); }}
                className="px-6 py-2.5 font-black text-white bg-slate-800 hover:bg-slate-900 rounded-lg shadow uppercase tracking-widest text-xs flex items-center gap-2"
              >
                <Download className="w-4 h-4" /> Export to CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MANUAL ENTRY MODAL — for missed punches. Admin / manager see
          an employee dropdown; everyone else sees their identity
          locked. Submit routes through syncToCloud (App-side wrapper
          recomputes pay chunks). */}
      {isManualEntryOpen && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex md:items-center md:justify-center md:p-4">
          <div className="bg-white md:rounded-2xl shadow-2xl h-full md:h-auto w-full md:max-w-md overflow-hidden flex flex-col animate-in zoom-in-95">
            <div className="p-5 border-b border-gray-200 bg-slate-900 text-white flex justify-between items-center">
              <div className="flex items-center gap-3">
                <Plus className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-bold">Add Manual Entry</h3>
              </div>
              <button onClick={() => setIsManualEntryOpen(false)} className="text-white/60 hover:text-white min-w-[44px] min-h-[44px] inline-flex items-center justify-center"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Employee</label>
                {canEditAny ? (
                  <select
                    value={manualForm.employeeEmail}
                    onChange={ev => {
                      const em = ev.target.value;
                      const match = appData.employees.find(e => (e.linkedUserEmail || e.email || '').toLowerCase() === em);
                      setManualForm(p => ({ ...p, employeeEmail: em, employeeName: match?.name || '' }));
                    }}
                    className="w-full border border-slate-300 rounded-xl p-3 text-sm font-bold bg-white outline-none focus:ring-2 focus:ring-emerald-400"
                  >
                    <option value="">— pick an employee —</option>
                    {appData.employees
                      .filter(e => e.status === 'Active' && (e.linkedUserEmail || e.email))
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(e => {
                        const em = (e.linkedUserEmail || e.email || '').toLowerCase();
                        return <option key={e.id} value={em}>{e.name} — {em}</option>;
                      })}
                  </select>
                ) : (
                  <div className="w-full border border-slate-200 rounded-xl p-3 text-sm font-bold bg-slate-50 text-slate-800">
                    {userName} <span className="text-slate-400 font-medium">({userEmail})</span>
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Date</label>
                <input
                  type="date"
                  value={manualForm.date}
                  onChange={e => setManualForm(p => ({ ...p, date: e.target.value }))}
                  className="w-full border border-slate-300 rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Clock In</label>
                  <input
                    type="time"
                    value={manualForm.clockInTime}
                    onChange={e => setManualForm(p => ({ ...p, clockInTime: e.target.value }))}
                    className="w-full border border-slate-300 rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Clock Out</label>
                  <input
                    type="time"
                    value={manualForm.clockOutTime}
                    onChange={e => setManualForm(p => ({ ...p, clockOutTime: e.target.value }))}
                    className="w-full border border-slate-300 rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Note (optional)</label>
                <textarea
                  rows={3}
                  value={manualForm.note}
                  onChange={e => setManualForm(p => ({ ...p, note: e.target.value }))}
                  placeholder="e.g. forgot to clock in this morning"
                  className="w-full border border-slate-300 rounded-xl p-3 text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-400 resize-none"
                />
              </div>
            </div>
            <div className="p-5 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setIsManualEntryOpen(false)} className="px-6 py-2.5 font-bold text-slate-500 hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
              <button onClick={submitManualEntry} className="px-6 py-2.5 font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow uppercase tracking-widest text-xs flex items-center gap-2"><Save className="w-4 h-4" /> Submit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

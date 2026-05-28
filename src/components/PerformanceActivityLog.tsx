import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, orderBy, limit, where } from 'firebase/firestore';
import { Filter, Clock as ClockIcon, ExternalLink } from 'lucide-react';
import { db, appId } from '../lib/firebase';
import { PerfActivityEntry } from '../types';
import { ACTIVITY_TYPE_LABELS, ACTIVITY_CATEGORY } from '../lib/perfAudit';

interface PerformanceActivityLogProps {
  setPerfTab: (t: string) => void;
  setPerfDate: (d: string) => void;
  showToastMsg: (msg: string) => void;
}

const formatDateLabel = (d: string): string => {
  try {
    return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return d; }
};

const formatTime = (ms: number): string => {
  try {
    const d = new Date(ms);
    const now = Date.now();
    const diff = now - ms;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
};

const formatAbsolute = (ms: number): string => {
  try {
    return new Date(ms).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return ''; }
};

const categoryClass = (cat: 'green' | 'amber' | 'rose' | 'slate'): string => {
  switch (cat) {
    case 'green': return 'bg-emerald-50 border-l-emerald-400';
    case 'amber': return 'bg-amber-50 border-l-amber-400';
    case 'rose': return 'bg-rose-50 border-l-rose-400';
    case 'slate': return 'bg-slate-50 border-l-slate-400';
  }
};

const todayISO = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const daysAgoISO = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export default function PerformanceActivityLog({ setPerfTab, setPerfDate, showToastMsg }: PerformanceActivityLogProps) {
  const [entries, setEntries] = useState<PerfActivityEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterFrom, setFilterFrom] = useState<string>(daysAgoISO(7));
  const [filterTo, setFilterTo] = useState<string>(todayISO());
  const [filterCrew, setFilterCrew] = useState<string>('all');
  const [filterUser, setFilterUser] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');

  useEffect(() => {
    const colRef = collection(db, 'artifacts', appId, 'private', 'data', 'performanceActivityLog');
    const fromMs = new Date(`${filterFrom}T00:00:00`).getTime();
    const toMs = new Date(`${filterTo}T23:59:59`).getTime();
    const q = query(
      colRef,
      where('timestamp', '>=', fromMs),
      where('timestamp', '<=', toMs),
      orderBy('timestamp', 'desc'),
      limit(500),
    );
    const unsub = onSnapshot(
      q,
      snap => {
        const rows: PerfActivityEntry[] = snap.docs.map(d => ({
          ...(d.data() as Omit<PerfActivityEntry, 'id'>),
          id: d.id,
        }));
        setEntries(rows);
        setLoadError(null);
      },
      err => {
        setLoadError(err.message);
        showToastMsg(`Activity log load failed: ${err.message}`);
      },
    );
    return unsub;
  }, [filterFrom, filterTo, showToastMsg]);

  const crewOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entries) m.set(e.crewId, e.crewLabel);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries]);

  const userOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entries) m.set(e.userId, e.userName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries]);

  const typeOptions = useMemo(() => {
    const s = new Set<PerfActivityEntry['type']>();
    for (const e of entries) s.add(e.type);
    return [...s].sort();
  }, [entries]);

  const filtered = useMemo(() => entries.filter(e => {
    if (filterCrew !== 'all' && e.crewId !== filterCrew) return false;
    if (filterUser !== 'all' && e.userId !== filterUser) return false;
    if (filterType !== 'all' && e.type !== filterType) return false;
    return true;
  }), [entries, filterCrew, filterUser, filterType]);

  const openSource = (e: PerfActivityEntry) => {
    setPerfDate(e.targetDate);
    setPerfTab('entry');
  };

  return (
    <div className="max-w-6xl mx-auto w-full space-y-4 pb-20">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 grid grid-cols-2 md:flex md:flex-wrap gap-3 md:items-end">
        <Filter className="w-4 h-4 text-slate-400 mb-2 hidden md:block" />
        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">From</label>
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} max={filterTo} className="w-full min-h-[44px] border border-gray-300 rounded p-2 text-sm" />
        </div>
        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">To</label>
          <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} min={filterFrom} className="w-full min-h-[44px] border border-gray-300 rounded p-2 text-sm" />
        </div>
        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Crew</label>
          <select value={filterCrew} onChange={e => setFilterCrew(e.target.value)} className="w-full min-h-[44px] border border-gray-300 rounded p-2 text-sm font-medium md:min-w-[140px]">
            <option value="all">All crews</option>
            {crewOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">User</label>
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)} className="w-full min-h-[44px] border border-gray-300 rounded p-2 text-sm font-medium md:min-w-[140px]">
            <option value="all">All users</option>
            {userOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Action</label>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="w-full min-h-[44px] border border-gray-300 rounded p-2 text-sm font-medium md:min-w-[180px]">
            <option value="all">All actions</option>
            {typeOptions.map(t => <option key={t} value={t}>{ACTIVITY_TYPE_LABELS[t] || t}</option>)}
          </select>
        </div>
        <div className="col-span-2 text-xs text-slate-500 md:ml-auto">
          Showing <span className="font-bold text-slate-700">{filtered.length}</span> of {entries.length} entries
        </div>
      </div>

      {loadError && (
        <div className="bg-rose-50 border border-rose-200 rounded p-3 text-sm text-rose-800">
          Failed to load activity: {loadError}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-slate-400 italic">No activity in the selected range.</div>
        ) : (
          <ul>
            {filtered.map(e => {
              const cat = ACTIVITY_CATEGORY[e.type] || 'slate';
              const valueDelta = e.valueBefore != null && e.valueAfter != null
                ? `${e.valueBefore} → ${e.valueAfter}${e.valueLabel ? ` ${e.valueLabel}` : ''}`
                : e.valueAfter != null
                  ? `${e.valueAfter}${e.valueLabel ? ` ${e.valueLabel}` : ''}`
                  : e.valueBefore != null
                    ? `was ${e.valueBefore}${e.valueLabel ? ` ${e.valueLabel}` : ''}`
                    : '';
              return (
                <li
                  key={e.id}
                  onClick={() => openSource(e)}
                  className={`border-l-4 ${categoryClass(cat)} px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-white cursor-pointer text-sm min-h-[44px]
                    flex flex-col gap-1.5
                    md:flex-row md:items-center md:gap-3 md:py-2.5`}
                >
                  <span title={formatAbsolute(e.timestamp)} className="text-[11px] text-slate-400 font-mono md:w-16 shrink-0 flex items-center gap-1">
                    <ClockIcon className="w-3 h-3" /> {formatTime(e.timestamp)}
                  </span>
                  <div className="flex items-center gap-2 md:contents">
                    <span className="text-slate-700 font-bold md:w-28 md:truncate shrink-0">{e.userName}</span>
                    <span className="font-medium text-slate-800 md:w-40 md:truncate shrink-0">{ACTIVITY_TYPE_LABELS[e.type] || e.type}</span>
                  </div>
                  <span className="text-slate-600 md:w-48 md:truncate shrink-0">
                    {e.crewLabel} · {formatDateLabel(e.targetDate)}
                  </span>
                  <span className="text-slate-500 text-xs md:flex-1 md:truncate break-words">
                    {e.workerName && <span>{e.workerName}</span>}
                    {e.jobTitle && <span>{e.workerName ? ' · ' : ''}{e.jobTitle}</span>}
                    {valueDelta && <span className="ml-2 font-mono text-slate-700">{valueDelta}</span>}
                    {e.reason && <span className="ml-2 italic">[{e.reason}]</span>}
                    {e.reasonNote && <span className="ml-2 italic">{e.reasonNote}</span>}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-300 shrink-0 hidden md:block" />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

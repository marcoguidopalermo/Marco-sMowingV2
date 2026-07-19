// In-app notification centre (bell + inbox) + enable-push card + per-user
// settings + (admin) dashboard. Self-subscribes to per-user Firestore docs.
// The inbox works without push permission; push is the delivery bonus.
import { useEffect, useMemo, useState } from 'react';
import { Bell } from 'lucide-react';
import { collection, doc, onSnapshot, setDoc, query, orderBy, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, appId, functions } from '../lib/firebase';
import { pushSupport, enablePush, PushSupport } from '../lib/messaging';

const norm = (e: string) => (e || '').trim().toLowerCase();
const K = (email: string) => encodeURIComponent(norm(email));
const PUB = (name: string) => collection(db, 'artifacts', appId, 'public', 'data', name);

export type NCategory = 'announcements' | 'repairs' | 'workorders' | 'leases' | 'fleet' | 'policies' | 'storage';
export const NOTIF_CATEGORIES: { key: NCategory; label: string; dormant?: boolean; audience?: string }[] = [
  { key: 'announcements', label: 'Announcements' },
  { key: 'repairs', label: 'Repairs' },
  { key: 'workorders', label: 'Work Orders' },
  { key: 'leases', label: 'Leases / Move-outs' },
  { key: 'fleet', label: 'Fleet documents' },
  { key: 'storage', label: 'Storage (super admin)', audience: 'Super admin only' },
  { key: 'policies', label: 'Policy sign-off', dormant: true },
];
interface CentreItem { id: string; category: NCategory; title: string; body: string; url: string; at: number; read?: boolean }
interface Prefs { master?: boolean; categories?: Partial<Record<NCategory, boolean>> }

const ago = (ms: number) => { const s = (Date.now() - ms) / 1000; if (s < 60) return 'now'; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`; return `${Math.floor(s / 86400)}d`; };
const CHIP: Record<NCategory, string> = { announcements: '#B7950B', repairs: '#C0392B', workorders: '#2E4053', leases: '#8E44AD', fleet: '#E67E22', policies: '#7F8C8D', storage: '#34495E' };

export default function NotificationCenter({ userEmail, isAdmin, onNavigate, showToast, employees = [] }: { userEmail: string; isAdmin: boolean; onNavigate: (url: string) => void; showToast: (m: string) => void; employees?: any[] }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'inbox' | 'settings' | 'dashboard'>('inbox');
  const [items, setItems] = useState<CentreItem[]>([]);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [support, setSupport] = useState<PushSupport>('unsupported');
  const emailKey = K(userEmail);

  useEffect(() => { pushSupport().then(setSupport); }, []);
  // Esc closes the panel (tap-out is handled by the backdrop below).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => {
    if (!userEmail) return;
    const u1 = onSnapshot(doc(PUB('notificationCentre'), emailKey), s => setItems(((s.data() as any)?.items || []) as CentreItem[]));
    const u2 = onSnapshot(doc(PUB('notificationPrefs'), emailKey), s => setPrefs((s.data() as any) || {}));
    return () => { u1(); u2(); };
  }, [userEmail, emailKey]);

  const unread = items.filter(i => !i.read).length;
  const savePrefs = (p: Prefs) => setDoc(doc(PUB('notificationPrefs'), emailKey), { userId: norm(userEmail), ...p }, { merge: true });
  const markAllRead = () => setDoc(doc(PUB('notificationCentre'), emailKey), { userId: norm(userEmail), items: items.map(i => ({ ...i, read: true })) }, { merge: true });
  const openItem = (i: CentreItem) => {
    setDoc(doc(PUB('notificationCentre'), emailKey), { userId: norm(userEmail), items: items.map(x => x.id === i.id ? { ...x, read: true } : x) }, { merge: true });
    setOpen(false); onNavigate(i.url || '/');
  };
  const doEnable = async () => {
    const t = await enablePush();
    setSupport(await pushSupport());
    showToast(t ? 'Notifications enabled on this device.' : 'Not enabled — check browser permissions.');
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} aria-label="Notifications" className="relative min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded-lg">
        <Bell className="w-5 h-5" />
        {unread > 0 && <span className="absolute top-1 right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center ring-1 ring-white">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Phone: near-full-width fixed sheet (always on-screen wherever the
              bell sits). Desktop: dropdown anchored to the bell's LEFT edge,
              width clamped to the viewport so it never runs off either edge. */}
          <div className="fixed inset-x-2 top-16 z-50 flex flex-col max-h-[75vh] bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden md:absolute md:inset-x-auto md:left-0 md:top-full md:mt-1 md:w-[min(360px,calc(100vw-16px))] md:max-h-[80vh]">
            <div className="flex items-center border-b bg-gray-50 shrink-0">
              {(['inbox', 'settings', ...(isAdmin ? ['dashboard'] as const : [])] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} className={`flex-1 px-3 py-2 text-xs font-black uppercase tracking-widest ${tab === t ? 'text-slate-800 bg-white' : 'text-gray-400'}`}>{t}</button>
              ))}
            </div>

            {tab === 'inbox' && (
              <div className="flex-1 min-h-0 overflow-y-auto">
                {support !== 'granted' && <EnableCard support={support} onEnable={doEnable} />}
                {items.length > 0 && <div className="flex justify-end px-3 py-1"><button onClick={markAllRead} className="text-[11px] text-slate-500 underline">Mark all read</button></div>}
                {items.length === 0 && <div className="p-6 text-center text-sm text-gray-400">No notifications yet.</div>}
                {items.map(i => (
                  <button key={i.id} onClick={() => openItem(i)} className={`w-full text-left px-3 py-2.5 border-b hover:bg-slate-50 ${i.read ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: CHIP[i.category] }}>{i.category}</span>
                      <span className="font-bold text-sm text-slate-800 flex-1 truncate">{i.title}</span>
                      {!i.read && <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />}
                      <span className="text-[10px] text-gray-400">{ago(i.at)}</span>
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">{i.body}</div>
                  </button>
                ))}
              </div>
            )}

            {tab === 'settings' && (
              <div className="flex-1 min-h-0 overflow-y-auto p-3">
                <label className="flex items-center justify-between py-2 border-b">
                  <span className="font-bold text-sm text-slate-800">All notifications</span>
                  <input type="checkbox" checked={prefs.master !== false} onChange={e => savePrefs({ ...prefs, master: e.target.checked })} />
                </label>
                {NOTIF_CATEGORIES.map(c => (
                  <label key={c.key} className={`flex items-center justify-between py-2 border-b ${c.dormant ? 'opacity-50' : ''}`}>
                    <span className="text-sm text-slate-700">{c.label}{c.dormant ? ' (not yet active)' : ''}</span>
                    <input type="checkbox" disabled={prefs.master === false || c.dormant} checked={(prefs.categories?.[c.key] !== false)} onChange={e => savePrefs({ ...prefs, categories: { ...(prefs.categories || {}), [c.key]: e.target.checked } })} />
                  </label>
                ))}
                <div className="text-[11px] text-gray-400 mt-2">The in-app inbox always works. Push delivery needs "Enable notifications" on each device.</div>
              </div>
            )}

            {tab === 'dashboard' && isAdmin && <NotificationDashboard showToast={showToast} employees={employees} />}
          </div>
        </>
      )}
    </div>
  );
}

function EnableCard({ support, onEnable }: { support: PushSupport; onEnable: () => void }) {
  if (support === 'ios-not-installed') return (
    <div className="m-3 p-3 rounded-lg border" style={{ borderColor: '#F5CBA7', backgroundColor: '#FEF9E7' }}>
      <div className="font-bold text-sm text-slate-800">Turn on notifications</div>
      <div className="text-xs text-gray-600 mt-1">On iPhone/iPad, first add CrewMaster to your Home Screen: tap <b>Share</b> → <b>Add to Home Screen</b>, then open it from there and enable notifications.</div>
    </div>
  );
  if (support === 'denied') return (
    <div className="m-3 p-3 rounded-lg border bg-rose-50 border-rose-200 text-xs text-rose-700">Notifications are blocked in your browser settings. Re-allow them for this site to receive push.</div>
  );
  if (support === 'unsupported') return null;
  return (
    <div className="m-3 p-3 rounded-lg border" style={{ borderColor: '#AED6F1', backgroundColor: '#EBF5FB' }}>
      <div className="font-bold text-sm text-slate-800">Enable notifications</div>
      <div className="text-xs text-gray-600 mt-1">Get pushed for announcements, repairs assigned to you, work orders, and lease/fleet warnings — even when CrewMaster is closed.</div>
      <button onClick={onEnable} className="mt-2 px-3 py-1.5 rounded-lg text-white text-xs font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700">Enable on this device</button>
    </div>
  );
}

// ── Editable audiences ──────────────────────────────────────────────────────
interface AudSpec { roles?: string[]; divisions?: string[]; people?: string[] }
const ROLE_OPTS: { v: string; l: string }[] = [
  { v: 'admin', l: 'Admins' }, { v: 'manager', l: 'Managers' },
  { v: 'mechanic', l: 'Mechanics' }, { v: 'property_manager', l: 'Property mgrs' },
];
const ROLE_LABEL = (v: string) => ROLE_OPTS.find(o => o.v === v)?.l || v;
// Audience-editable trigger types. mode 'override' = the stored audience replaces
// the structural default; mode 'extra' = ADDS on top of a locked structural set.
const AUDIENCE_TYPES: { key: string; cat: NCategory; label: string; mode: 'override' | 'extra'; structural?: string }[] = [
  { key: 'workorders_created', cat: 'workorders', label: 'Work order · created', mode: 'override' },
  { key: 'workorders_assigned_extra', cat: 'workorders', label: 'Work order · assigned', mode: 'extra', structural: 'New assignee(s)' },
  { key: 'repairs_extra', cat: 'repairs', label: 'Repair · assigned', mode: 'extra', structural: 'Assigned mechanic(s)' },
  { key: 'leases', cat: 'leases', label: 'Lease / move-out', mode: 'override' },
  { key: 'fleet', cat: 'fleet', label: 'Fleet doc expiry', mode: 'override' },
];

function AudienceEditor({ spec, onChange, structural, employees }:
  { spec: AudSpec; onChange: (s: AudSpec) => void; structural?: string; employees: any[] }) {
  const emailOf = (e: any) => (e.linkedUserEmail || e.email || '').toLowerCase();
  const nameOf = (email: string) => employees.find(e => emailOf(e) === email)?.name || email;
  const divisions = useMemo(() => {
    const s = new Set<string>();
    employees.forEach(e => { if (e.managedDivision) s.add(e.managedDivision); });
    return [...s];
  }, [employees]);
  const roles = spec.roles || [], divs = spec.divisions || [], people = spec.people || [];
  const set = (patch: Partial<AudSpec>) => onChange({ roles, divisions: divs, people, ...patch });
  const chip = (label: string, onX?: () => void, locked?: boolean) => (
    <span key={label} className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full ${locked ? 'bg-slate-200 text-slate-500' : 'bg-emerald-100 text-emerald-800'}`}>
      {locked && <span className="text-[8px]">🔒</span>}{label}
      {onX && <button onClick={onX} className="ml-0.5 text-emerald-600 hover:text-emerald-900 font-black">×</button>}
    </span>
  );
  const availRoles = ROLE_OPTS.filter(o => !roles.includes(o.v));
  const availDivs = divisions.filter(d => !divs.includes(d));
  const availPeople = employees.filter(e => emailOf(e) && !people.includes(emailOf(e)));
  return (
    <div className="mt-1.5 pl-2 border-l-2 border-emerald-100">
      <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
        Recipients{structural ? ' (added on top of structural)' : ''}
      </div>
      <div className="flex flex-wrap gap-1 items-center">
        {structural && chip(structural, undefined, true)}
        {roles.map(r => chip(ROLE_LABEL(r), () => set({ roles: roles.filter(x => x !== r) })))}
        {divs.map(d => chip(`Div: ${d}`, () => set({ divisions: divs.filter(x => x !== d) })))}
        {people.map(p => chip(nameOf(p), () => set({ people: people.filter(x => x !== p) })))}
        {(roles.length + divs.length + people.length === 0 && !structural) && <span className="text-[11px] text-gray-400 italic">No recipients</span>}
      </div>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {availRoles.length > 0 && (
          <select value="" onChange={e => e.target.value && set({ roles: [...roles, e.target.value] })} className="text-[10px] border rounded px-1 py-0.5 bg-white text-slate-600">
            <option value="">+ role</option>
            {availRoles.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        )}
        {availDivs.length > 0 && (
          <select value="" onChange={e => e.target.value && set({ divisions: [...divs, e.target.value] })} className="text-[10px] border rounded px-1 py-0.5 bg-white text-slate-600">
            <option value="">+ division</option>
            {availDivs.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        {availPeople.length > 0 && (
          <select value="" onChange={e => e.target.value && set({ people: [...people, e.target.value] })} className="text-[10px] border rounded px-1 py-0.5 bg-white text-slate-600">
            <option value="">+ person</option>
            {availPeople.map(e => <option key={emailOf(e)} value={emailOf(e)}>{e.name || emailOf(e)}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

// ── Admin dashboard: per-type row (kill switch, counts, last-sent) + adoption.
interface LogEntry { category: NCategory; title: string; recipientCount: number; delivered: number; at: number }
function NotificationDashboard({ showToast, employees }: { showToast: (m: string) => void; employees: any[] }) {
  const [config, setConfig] = useState<any>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [tokenUsers, setTokenUsers] = useState(0);
  const [testing, setTesting] = useState<string | null>(null);
  const sendTest = async (cat: NCategory) => {
    setTesting(cat);
    try {
      const res: any = await httpsCallable(functions, 'sendTestNotification')({ category: cat });
      const d = res?.data || {};
      showToast(d.delivered ? `Test sent — ${d.delivered} device(s)` : 'Test logged — no device registered yet (enable push first)');
    } catch {
      showToast('Test could not be sent.');
    } finally {
      setTesting(null);
    }
  };
  useEffect(() => {
    // Global config is a single doc at .../notificationConfig.
    const uC = onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'notificationConfig', 'globals'), s => setConfig((s.data() as any) || {}));
    const uL = onSnapshot(query(PUB('notificationLog'), orderBy('at', 'desc'), limit(200)), s => setLog(s.docs.map(d => d.data() as LogEntry)));
    const uT = onSnapshot(PUB('pushTokens'), s => setTokenUsers(s.docs.filter(d => ((d.data() as any)?.tokens || []).length > 0).length));
    return () => { uC(); uL(); uT(); };
  }, []);
  const globals = config.globals || {};
  const subToggles = config.subToggles || {};
  const setGlobal = (k: string, v: boolean) => setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'notificationConfig', 'globals'), { globals: { ...(config.globals || {}), [k]: v } }, { merge: true });
  const setSub = (k: string, v: boolean) => setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'notificationConfig', 'globals'), { subToggles: { ...(config.subToggles || {}), [k]: v } }, { merge: true });
  const now = Date.now();
  const countIn = (cat: NCategory, days: number) => log.filter(l => l.category === cat && l.at > now - days * 86400000).length;
  const lastOf = (cat: NCategory) => log.find(l => l.category === cat);

  // Structural defaults, mirrored here so admins see the current recipients as
  // editable chips. Matches the server fallbacks in notifications.ts.
  const contractingMgrs = useMemo(() => {
    const out = new Set<string>(['marcoguidopalermo@gmail.com']);
    employees.forEach(e => { if (e.contractingManager || e.systemRole === 'property_manager') { const em = (e.linkedUserEmail || e.email || '').toLowerCase(); if (em) out.add(em); } });
    return [...out];
  }, [employees]);
  const seedSpec = (key: string): AudSpec => {
    if (key === 'workorders_created' || key === 'leases') return { people: contractingMgrs };
    if (key === 'fleet') return { roles: ['admin', 'manager'] };
    return {}; // *_extra types start empty (structural set is implicit)
  };
  const specFor = (key: string): AudSpec => (config.audiences?.[key]) ?? seedSpec(key);
  const setAudienceSpec = (key: string, s: AudSpec) => setDoc(
    doc(db, 'artifacts', appId, 'public', 'data', 'notificationConfig', 'globals'),
    { audiences: { [key]: { roles: s.roles || [], divisions: s.divisions || [], people: s.people || [] } } },
    { merge: true },
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3">
      <div className="text-[11px] text-gray-500 mb-2">Push adoption: <b>{tokenUsers}</b> device-registered user(s). Kill switches enforced server-side.</div>
      {NOTIF_CATEGORIES.map(c => {
        const on = globals[c.key] !== false && !c.dormant;
        const last = lastOf(c.key);
        return (
          <div key={c.key} className={`border rounded-lg p-2 mb-2 ${c.dormant ? 'opacity-50' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-sm text-slate-800">{c.label}{c.dormant ? ' · not yet active' : ''}</span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={c.dormant || testing === c.key}
                  onClick={() => sendTest(c.key)}
                  className="text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-40"
                >{testing === c.key ? '…' : 'Test to me'}</button>
                <label className="text-[10px] font-black uppercase flex items-center gap-1">{on ? 'on' : 'off'}<input type="checkbox" disabled={c.dormant} checked={on} onChange={e => setGlobal(c.key, e.target.checked)} /></label>
              </div>
            </div>
            {!c.dormant && (
              <div className="text-[11px] text-gray-500 mt-1">
                Sent 7d: <b>{countIn(c.key, 7)}</b> · 30d: <b>{countIn(c.key, 30)}</b>
                {last ? <> · last {ago(last.at)} ago → {last.recipientCount} recip ({last.delivered} pushed)</> : ' · never sent'}
              </div>
            )}
            {c.key === 'workorders' && !c.dormant && (
              <div className="mt-1.5 pl-2 border-l-2 border-slate-200 flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-600 flex items-center justify-between">Created → managers<input type="checkbox" checked={subToggles.workorders_created !== false} onChange={e => setSub('workorders_created', e.target.checked)} /></label>
                <label className="text-[10px] font-bold text-slate-600 flex items-center justify-between">Assigned → assignee<input type="checkbox" checked={subToggles.workorders_assigned !== false} onChange={e => setSub('workorders_assigned', e.target.checked)} /></label>
              </div>
            )}
            {!c.dormant && AUDIENCE_TYPES.filter(t => t.cat === c.key).map(t => (
              <div key={t.key} className="mt-1">
                {AUDIENCE_TYPES.filter(x => x.cat === c.key).length > 1 && <div className="text-[10px] font-black text-slate-500 mt-1">{t.label}</div>}
                <AudienceEditor
                  spec={specFor(t.key)}
                  onChange={s => setAudienceSpec(t.key, s)}
                  structural={t.mode === 'extra' ? t.structural : undefined}
                  employees={employees}
                />
              </div>
            ))}
          </div>
        );
      })}
      <div className="text-[10px] text-gray-400">Recent sends (capped log):</div>
      {log.slice(0, 15).map((l, i) => <div key={i} className="text-[11px] text-gray-500">{ago(l.at)} · {l.category} · "{l.title}" → {l.recipientCount}</div>)}
    </div>
  );
}

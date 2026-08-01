// LawnRateSheet — SUPER-ADMIN ONLY editor for the lawn pricing numbers. Mirrors
// SnowRateSheet.tsx exactly (immutable versions, audit, preview-before-commit,
// revert, historical resolution, four-way access enforcement); the only real
// difference is the surface — lawn's core is a wide, add/remove-row tier×package
// grid rather than a handful of fields. Access is hard-guarded here AND in the
// write handlers (App.tsx) AND in firestore.rules (lawnRateConfigs).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, ShieldAlert, History, RotateCcw, Check, X, AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { LawnRateConfigVersion } from '../types';
import {
  LawnConfig, LAWN_CONFIG_V1, validateLawnConfig, diffLawnConfig, RateAuditChange, lawnVersionNum,
  seasonEndDate, isValidYmd,
} from '../lib/lawnPricing';

const GREEN = '#1c4634';
const GOLD = '#cdbd8f';
const fmtWhen = (ms?: number) => ms ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const num = (v: string): number => v === '' ? 0 : Number(v);

interface Props {
  isSuperAdmin: boolean;
  config: LawnConfig;
  activeVersion: string;
  versions: Record<string, LawnRateConfigVersion>;
  onSave: (next: LawnConfig) => Promise<boolean>;
  onRevert: (versionId: string) => Promise<boolean>;
  initial?: { draft?: LawnConfig; preview?: boolean };  // preview/deep-link seed only
}

export default function LawnRateSheet({ isSuperAdmin, config, activeVersion, versions, onSave, onRevert, initial }: Props) {
  if (!isSuperAdmin) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center">
        <div className="w-14 h-14 rounded-full bg-rose-50 flex items-center justify-center mx-auto"><Lock className="w-7 h-7 text-rose-500" /></div>
        <div className="text-lg font-black text-slate-800 mt-3">Rate sheet is restricted</div>
        <div className="text-sm font-bold text-slate-400 mt-1">Super-admin only.</div>
      </div>
    );
  }
  return <Editor config={config} activeVersion={activeVersion} versions={versions} onSave={onSave} onRevert={onRevert} initial={initial} />;
}

function Editor({ config, activeVersion, versions, onSave, onRevert, initial }: Omit<Props, 'isSuperAdmin'>) {
  const [draft, setDraft] = useState<LawnConfig>(() => structuredClone(initial?.draft || config));
  const [previewing, setPreviewing] = useState(!!initial?.preview);
  const [busy, setBusy] = useState(false);

  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setDraft(structuredClone(config)); setPreviewing(false);
  }, [activeVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Immutable edit helper — clone, mutate, set.
  const edit = (fn: (d: LawnConfig) => void) => setDraft(d => { const n = structuredClone(d); fn(n); return n; });

  const changes: RateAuditChange[] = useMemo(() => diffLawnConfig(config, draft), [config, draft]);
  const errors = useMemo(() => validateLawnConfig(draft), [draft]);
  const dirty = changes.length > 0;

  const commit = async () => {
    if (errors.length || !dirty) return;
    setBusy(true);
    const ok = await onSave(draft);
    setBusy(false);
    if (ok) setPreviewing(false);
  };

  const pkgKeys = draft.PACKAGES;
  const lastTier = draft.TIERS.length - 1;
  const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

  const addTier = () => edit(n => {
    const openIdx = n.TIERS.length - 1;
    const prevMax = openIdx > 0 ? (n.TIERS[openIdx - 1].maxSqFt ?? 0) : 0;
    n.TIERS.splice(openIdx, 0, { maxSqFt: prevMax + 1, weekly: 0 });
    const row: Record<string, number> = {}; n.PACKAGES.forEach(p => (row[p.key] = 0));
    n.PACKAGE_PRICES.splice(openIdx, 0, row);
  });
  const removeTier = (i: number) => edit(n => {
    if (n.TIERS.length <= 1 || i === n.TIERS.length - 1) return; // keep >=1, never remove the open tier
    n.TIERS.splice(i, 1); n.PACKAGE_PRICES.splice(i, 1);
  });

  const cell = 'border border-slate-200 rounded px-2 py-1.5 text-right font-mono text-sm w-full';

  return (
    <div className="space-y-4">
      {/* Warning banner — same as the snow rate sheet. */}
      <div className="rounded-2xl border-2 p-4 flex items-start gap-3" style={{ backgroundColor: '#fffbeb', borderColor: '#f59e0b' }}>
        <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-black text-amber-900">Lawn pricing — super-admin rate sheet</div>
          <div className="text-[12px] text-amber-800">This screen moves every lawn price in the company. Changes save as a new version ({activeVersion} is live now); existing quotes keep the version they were quoted under.</div>
        </div>
      </div>

      {/* ── THE GRID ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Mowing tiers &amp; package prices</div>
          <button onClick={addTier} className="text-[11px] font-bold text-emerald-700 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add tier</button>
        </div>
        <div className="overflow-x-auto">
          <table className="text-sm border-separate" style={{ borderSpacing: 0 }}>
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                <th className="text-left font-sans py-1 px-2 sticky left-0 bg-white z-10 min-w-[120px]">Sq ft up to</th>
                <th className="text-right font-sans py-1 px-2 min-w-[90px]">Weekly</th>
                <th className="text-right font-sans py-1 px-2 min-w-[90px]">Biweekly</th>
                {pkgKeys.map(p => <th key={p.key} className="text-right font-sans py-1 px-2 min-w-[80px]">{p.label}</th>)}
                <th className="py-1 px-1" />
              </tr>
            </thead>
            <tbody>
              {draft.TIERS.map((t, i) => {
                const isOpen = i === lastTier;
                return (
                  <tr key={i} className="border-t border-slate-50">
                    <td className="py-1 px-2 sticky left-0 bg-white z-10">
                      {isOpen ? (
                        <div className="text-slate-400 font-bold text-[12px] italic px-2">open (22,501+)</div>
                      ) : (
                        <input type="number" value={t.maxSqFt ?? ''} onChange={e => edit(n => { n.TIERS[i].maxSqFt = num(e.target.value); })} className={cell} />
                      )}
                    </td>
                    <td className="py-1 px-1"><input type="number" value={t.weekly || ''} onChange={e => edit(n => { n.TIERS[i].weekly = num(e.target.value); })} className={cell} /></td>
                    <td className="py-1 px-1"><div className="text-right font-mono text-sm text-slate-400 px-2 py-1.5" title={`Weekly × ${draft.BIWEEKLY_RATIO}`}>{money((t.weekly || 0) * draft.BIWEEKLY_RATIO)}</div></td>
                    {pkgKeys.map(p => {
                      const v = Number(draft.PACKAGE_PRICES[i]?.[p.key]) || 0;
                      return <td key={p.key} className="py-1 px-1"><input type="number" value={v || ''} placeholder="0" title={v === 0 ? 'Not yet priced' : undefined} onChange={e => edit(n => { (n.PACKAGE_PRICES[i] = n.PACKAGE_PRICES[i] || {}), (n.PACKAGE_PRICES[i][p.key] = num(e.target.value)); })} className={`${cell} ${v === 0 ? 'text-slate-300' : ''}`} /></td>;
                    })}
                    <td className="py-1 px-1 text-center">
                      {!isOpen && <button onClick={() => removeTier(i)} title="Remove tier" className="text-slate-300 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="text-[10px] text-slate-400 mt-2">Biweekly is derived (weekly × ratio) and read-only. Package 0 shows as “Not yet priced” in LawnMaster. Weekly must be &gt; 0.</div>
      </div>

      {/* ── Global ratio + groups ────────────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-4">
        <Group title="Biweekly ratio">
          <Field label="Weekly × ratio = biweekly (0–1)"><input type="number" step="0.01" value={draft.BIWEEKLY_RATIO} onChange={e => edit(n => { n.BIWEEKLY_RATIO = num(e.target.value); })} className={cell} /></Field>
        </Group>

        <Group title="Season">
          <Field label="Weekly cuts"><input type="number" value={draft.WEEKLY_CUTS} onChange={e => edit(n => { n.WEEKLY_CUTS = num(e.target.value); })} className={cell} /></Field>
          <Field label="Biweekly cuts"><input type="number" value={draft.BIWEEKLY_CUTS} onChange={e => edit(n => { n.BIWEEKLY_CUTS = num(e.target.value); })} className={cell} /></Field>
          <Field label="Months"><input type="number" value={draft.MONTHS} onChange={e => edit(n => { n.MONTHS = num(e.target.value); })} className={cell} /></Field>
        </Group>

        <Group title="Mowing extras (flat annual · weekly basis)">
          <Field label="Push mow only"><input type="number" value={draft.MOWING_EXTRAS.PUSH_MOW_ONLY} onChange={e => edit(n => { n.MOWING_EXTRAS.PUSH_MOW_ONLY = num(e.target.value); })} className={cell} /></Field>
          <Field label="Very hilly"><input type="number" value={draft.MOWING_EXTRAS.VERY_HILLY} onChange={e => edit(n => { n.MOWING_EXTRAS.VERY_HILLY = num(e.target.value); })} className={cell} /></Field>
          <Field label="Clutter"><input type="number" value={draft.MOWING_EXTRAS.CLUTTER} onChange={e => edit(n => { n.MOWING_EXTRAS.CLUTTER = num(e.target.value); })} className={cell} /></Field>
        </Group>

        <Group title="Package extras (flat · per package)">
          <Field label="Very hilly"><input type="number" value={draft.PACKAGE_EXTRAS.VERY_HILLY} onChange={e => edit(n => { n.PACKAGE_EXTRAS.VERY_HILLY = num(e.target.value); })} className={cell} /></Field>
          <Field label="Clutter"><input type="number" value={draft.PACKAGE_EXTRAS.CLUTTER} onChange={e => edit(n => { n.PACKAGE_EXTRAS.CLUTTER = num(e.target.value); })} className={cell} /></Field>
        </Group>

        <Group title="Zone thresholds">
          <Field label="Minimum clients"><input type="number" value={draft.ZONE_MIN_CLIENTS} onChange={e => edit(n => { n.ZONE_MIN_CLIENTS = num(e.target.value); })} className={cell} /></Field>
          <Field label="Break-even clients"><input type="number" value={draft.ZONE_BREAKEVEN_CLIENTS} onChange={e => edit(n => { n.ZONE_BREAKEVEN_CLIENTS = num(e.target.value); })} className={cell} /></Field>
        </Group>

        <Group title="Package visit counts (multiply per-visit travel)">
          {draft.PACKAGES.map((p, i) => (
            <Field key={p.key} label={`${p.label} visits`}><input type="number" value={p.visits} onChange={e => edit(n => { n.PACKAGES[i].visits = num(e.target.value); })} className={cell} /></Field>
          ))}
        </Group>

        {/* Mowing travel zones — addable/removable */}
        <Group title="Mowing travel zones (from city limits)" onAdd={() => edit(n => n.TRAVEL_ZONES.push({ key: `zone_${n.TRAVEL_ZONES.length}_${n.TRAVEL_ZONES.reduce((a, z) => a + z.label.length, 0)}`, label: 'New zone', weekly: 0 }))}>
          {draft.TRAVEL_ZONES.map((z, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={z.label} onChange={e => edit(n => { n.TRAVEL_ZONES[i].label = e.target.value; })} className="flex-1 border border-slate-200 rounded px-2 py-1.5 text-sm" />
              <input type="number" value={z.weekly} onChange={e => edit(n => { n.TRAVEL_ZONES[i].weekly = num(e.target.value); })} className="w-24 border border-slate-200 rounded px-2 py-1.5 text-right font-mono text-sm" />
              <button onClick={() => edit(n => { n.TRAVEL_ZONES.splice(i, 1); })} className="text-slate-300 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </Group>

        {/* Package travel ladder — addable/removable */}
        <Group title="Package travel per visit (ladder)" onAdd={() => edit(n => n.PACKAGE_TRAVEL_PER_VISIT.push(0))}>
          <div className="flex flex-wrap gap-2">
            {draft.PACKAGE_TRAVEL_PER_VISIT.map((v, i) => (
              <div key={i} className="flex items-center gap-1 border border-slate-200 rounded-lg pl-2 pr-1 py-1">
                <span className="text-slate-400 font-bold text-sm">$</span>
                <input type="number" value={v} onChange={e => edit(n => { n.PACKAGE_TRAVEL_PER_VISIT[i] = num(e.target.value); })} className="w-14 text-right font-mono font-bold outline-none" />
                <button onClick={() => edit(n => { n.PACKAGE_TRAVEL_PER_VISIT.splice(i, 1); })} className="text-slate-300 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        </Group>

        {/* Season & proration (mowing only) */}
        <Group title="Season & proration (mowing only)">
          <label className="flex items-center justify-between gap-3">
            <span className="text-[12px] font-bold text-slate-600">Season start</span>
            <input type="date" value={draft.SEASON_START} onChange={e => edit(n => { n.SEASON_START = e.target.value; })} className="border border-slate-200 rounded px-2 py-1.5 text-sm font-mono" />
          </label>
          <div className="text-[11px] text-slate-500 text-right">End (derived, +{draft.WEEKS_IN_SEASON} wks): <span className="font-mono font-bold text-slate-700">{isValidYmd(draft.SEASON_START) ? seasonEndDate(draft) : '—'}</span></div>
          <Field label="Weeks in season"><input type="number" value={draft.WEEKS_IN_SEASON} onChange={e => edit(n => { n.WEEKS_IN_SEASON = num(e.target.value); })} className={cell} /></Field>
          <Field label="Discount per week (%)"><input type="number" value={draft.DISCOUNT_PER_WEEK} onChange={e => edit(n => { n.DISCOUNT_PER_WEEK = num(e.target.value); })} className={cell} /></Field>
          <Field label="Mowing allocation rate ($/hr)"><input type="number" value={draft.MOWING_ALLOCATION_RATE} onChange={e => edit(n => { n.MOWING_ALLOCATION_RATE = num(e.target.value); })} className={cell} /></Field>
        </Group>

        {/* Overgrown catch-up ladder — first-visit BH multiplier per option */}
        <Group title="Overgrown ladder (first-visit BH ×)" onAdd={() => edit(n => n.OVERGROWN.push({ key: `og_${n.OVERGROWN.length}`, label: 'New option', multiplier: (n.OVERGROWN[n.OVERGROWN.length - 1]?.multiplier || 0) + 1 }))}>
          {draft.OVERGROWN.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={o.label} onChange={e => edit(n => { n.OVERGROWN[i].label = e.target.value; })} className="flex-1 border border-slate-200 rounded px-2 py-1.5 text-sm" />
              <div className="flex items-center gap-1"><input type="number" step="0.5" value={o.multiplier} onChange={e => edit(n => { n.OVERGROWN[i].multiplier = num(e.target.value); })} className="w-16 border border-slate-200 rounded px-2 py-1.5 text-right font-mono text-sm" /><span className="text-slate-400 text-sm">×</span></div>
              <button onClick={() => edit(n => { n.OVERGROWN.splice(i, 1); })} className="text-slate-300 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </Group>
      </div>

      {/* Validation errors */}
      {errors.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-1">
          {errors.map((e, i) => <div key={i} className="text-[12px] font-bold text-rose-700 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {e}</div>)}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <button onClick={() => setDraft(structuredClone(config))} disabled={!dirty} className="min-h-[44px] px-4 rounded-xl border border-slate-300 text-slate-700 text-xs font-black uppercase tracking-widest hover:bg-slate-50 disabled:opacity-40">Discard</button>
        <button onClick={() => setPreviewing(true)} disabled={!dirty || errors.length > 0} className="min-h-[44px] px-5 rounded-xl text-white text-xs font-black uppercase tracking-widest disabled:opacity-40" style={{ backgroundColor: GREEN }}>
          Review {changes.length} change{changes.length === 1 ? '' : 's'}
        </button>
      </div>

      {/* Preview-before-commit — same as snow. */}
      {previewing && (
        <div className="fixed inset-0 z-[130] bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setPreviewing(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-slate-800 font-black"><AlertTriangle className="w-5 h-5 text-amber-500" /> Confirm rate change</div>
            <div className="text-[12px] text-slate-500 mt-1">Saving creates a new version after {activeVersion}. Existing quotes are not affected.</div>
            <div className="mt-3 border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[50vh] overflow-y-auto">
              {changes.map((c) => (
                <div key={c.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="font-bold text-slate-700">{c.field}</span>
                  <span className="font-mono"><span className="text-rose-600 line-through">{c.from}</span> <span className="text-slate-400">→</span> <span className="text-emerald-700 font-black">{c.to}</span></span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button onClick={() => setPreviewing(false)} disabled={busy} className="min-h-[44px] px-4 rounded-xl border border-slate-300 text-slate-700 text-xs font-black uppercase tracking-widest hover:bg-slate-50 disabled:opacity-40 inline-flex items-center gap-1.5"><X className="w-4 h-4" /> Cancel</button>
              <button onClick={commit} disabled={busy} className="min-h-[44px] px-5 rounded-xl text-white text-xs font-black uppercase tracking-widest disabled:opacity-50 inline-flex items-center gap-1.5" style={{ backgroundColor: GREEN }}><Check className="w-4 h-4" /> {busy ? 'Saving…' : 'Confirm & save version'}</button>
            </div>
          </div>
        </div>
      )}

      <AuditHistory versions={versions} activeVersion={activeVersion} onRevert={onRevert} />
    </div>
  );
}

// ── Small layout helpers ─────────────────────────────────────────────────────
function Group({ title, children, onAdd }: { title: string; children: React.ReactNode; onAdd?: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">{title}</div>
        {onAdd && <button onClick={onAdd} className="text-[11px] font-bold text-emerald-700 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add</button>}
      </div>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-[12px] font-bold text-slate-600">{label}</span>
      <span className="w-28">{children}</span>
    </label>
  );
}

// ── Audit history — newest first, with revert (mirrors the snow one). ────────
function AuditHistory({ versions, activeVersion, onRevert }: { versions: Record<string, LawnRateConfigVersion>; activeVersion: string; onRevert: (id: string) => Promise<boolean> }) {
  const list = useMemo(() => {
    const stored = Object.values(versions);
    const v1: LawnRateConfigVersion = {
      id: 'lawn-v1', version: 'lawn-v1', config: LAWN_CONFIG_V1, changes: [],
      note: 'Initial hard-coded defaults', createdBy: { email: '', name: 'System (shipped in code)' }, createdAt: undefined,
    };
    const all = stored.some(v => v.id === 'lawn-v1') ? stored : [...stored, v1];
    return all.sort((a, b) => lawnVersionNum(b.version) - lawnVersionNum(a.version));
  }, [versions]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5 mb-3"><History className="w-3.5 h-3.5" /> Change history</div>
      <div className="space-y-2">
        {list.map((v) => {
          const isActive = v.id === activeVersion;
          return (
            <div key={v.id} className="border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black text-slate-800 font-mono">{v.version}</span>
                  {isActive && <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: GREEN }}>Live</span>}
                  {v.revertedFrom && <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Revert</span>}
                </div>
                {!isActive && <button onClick={() => { if (window.confirm(`Revert lawn rates to ${v.version}? This creates a new version.`)) onRevert(v.id); }} className="text-[11px] font-bold text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" /> Revert to this</button>}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">{v.createdBy?.name || '—'} · {fmtWhen(v.createdAt)}{v.note ? ` · ${v.note}` : ''}</div>
              {v.changes.length > 0 ? (
                <div className="mt-2 space-y-0.5">
                  {v.changes.map(c => (
                    <div key={c.key} className="text-[12px] flex items-center justify-between gap-3">
                      <span className="text-slate-600">{c.field}</span>
                      <span className="font-mono"><span className="text-rose-500 line-through">{c.from}</span> <span className="text-slate-300">→</span> <span className="text-emerald-700 font-bold">{c.to}</span></span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-slate-400 mt-1 italic">Baseline — no prior version.</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-slate-400 mt-2 flex items-center gap-1"><span style={{ color: GOLD }}>●</span> Every version is immutable. Reverting adds a new version; nothing is deleted.</div>
    </div>
  );
}

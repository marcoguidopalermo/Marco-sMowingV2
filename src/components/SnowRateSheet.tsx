// SnowRateSheet — SUPER-ADMIN ONLY editor for the Snow pricing numbers.
// Mirrors ProjectMaster's rate sheet as a sub-tab, but with the safety this
// build requires (ProjectMaster live-saves a single settings object; here every
// save is an immutable new version with an audit trail and a preview gate):
//   • edit a DRAFT (no live-saving on keystroke)
//   • Review → validate + show old→new for every changed field → confirm
//   • save appends a new snow-v{N} version; quotes keep resolving to theirs
//   • audit history, newest first; revert any version (creates a new version)
// Access is hard-guarded here AND in the write handlers AND in firestore.rules.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, ShieldAlert, History, RotateCcw, Check, X, AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { SnowRateConfigVersion } from '../types';
import {
  SnowConfig, SNOW_CONFIG_V1, validateSnowConfig, diffSnowConfig, RateAuditChange, snowVersionNum,
} from '../lib/snowPricing';

const GREEN = '#1c4634';
const GOLD = '#cdbd8f';
const fmtWhen = (ms?: number) => ms ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

// The editable numeric price fields, in display order.
const PRICE_FIELDS: { key: keyof SnowConfig; label: string; note?: string }[] = [
  { key: 'TIER_1', label: 'Tier 1' },
  { key: 'TIER_2', label: 'Tier 2' },
  { key: 'TIER_3', label: 'Tier 3' },
  { key: 'CUSTOM_FLOOR', label: 'Custom floor' },
  { key: 'PREMIUM', label: 'Premium' },
  { key: 'BUSY_ROAD', label: 'Busy road' },
  { key: 'DRAG_RATE', label: 'Drag rate', note: 'per dragged spot · under active review' },
];

interface Props {
  isSuperAdmin: boolean;
  config: SnowConfig;                                  // active config
  activeVersion: string;
  versions: Record<string, SnowRateConfigVersion>;
  onSave: (next: SnowConfig) => Promise<boolean>;
  onRevert: (versionId: string) => Promise<boolean>;
  // Optional seed for previews/deep-links: start with a pending draft and/or the
  // confirm dialog open. Never used in normal operation.
  initial?: { draft?: SnowConfig; preview?: boolean };
}

export default function SnowRateSheet({ isSuperAdmin, config, activeVersion, versions, onSave, onRevert, initial }: Props) {
  // Hard read-guard: even if this ever rendered for a non-super-admin (URL,
  // stale nav), it shows nothing but an access notice.
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
  const [draft, setDraft] = useState<SnowConfig>(() => structuredClone(initial?.draft || config));
  const [previewing, setPreviewing] = useState(!!initial?.preview);
  const [busy, setBusy] = useState(false);

  // When a save lands, the active version/config updates from props — resync the
  // draft to the new baseline and drop any preview. Skip the first run so a
  // seeded initial draft/preview survives mount.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setDraft(structuredClone(config)); setPreviewing(false);
  }, [activeVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const setNum = (key: keyof SnowConfig, v: string) =>
    setDraft(d => ({ ...d, [key]: v === '' ? 0 : Number(v) }));

  const changes: RateAuditChange[] = useMemo(() => diffSnowConfig(config, draft), [config, draft]);
  const errors = useMemo(() => validateSnowConfig(draft), [draft]);
  const dirty = changes.length > 0;

  const commit = async () => {
    if (errors.length || !dirty) return;
    setBusy(true);
    const ok = await onSave(draft);
    setBusy(false);
    if (ok) setPreviewing(false); // props will refresh the baseline via the effect
  };

  return (
    <div className="space-y-4">
      {/* Warning banner — this screen can move every price in the company. */}
      <div className="rounded-2xl border-2 p-4 flex items-start gap-3" style={{ backgroundColor: '#fffbeb', borderColor: '#f59e0b' }}>
        <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-black text-amber-900">Snow pricing — super-admin rate sheet</div>
          <div className="text-[12px] text-amber-800">This screen moves every snow price in the company. Changes save as a new version ({activeVersion} is live now); existing quotes keep the version they were quoted under.</div>
        </div>
      </div>

      {/* ── Editable numbers ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-4">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Prices &amp; add-ons</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {PRICE_FIELDS.map(({ key, label, note }) => (
            <label key={key} className="block">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">{label}</div>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-slate-400 font-bold">$</span>
                <input type="number" value={String(draft[key] as number)} onChange={e => setNum(key, e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2 py-2 text-right font-mono font-bold" />
              </div>
              {note && <div className="text-[10px] text-amber-600 font-bold mt-0.5">{note}</div>}
            </label>
          ))}
        </div>

        {/* Drag-counts-toward-size — boolean, under review */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
          <div>
            <div className="text-sm font-black text-slate-700">Drag counts toward size</div>
            <div className="text-[11px] text-amber-600 font-bold">affects lane/depth measurement · under review</div>
          </div>
          <button onClick={() => setDraft(d => ({ ...d, DRAG_COUNTS_TOWARD_SIZE: !d.DRAG_COUNTS_TOWARD_SIZE }))}
            className="w-14 h-8 rounded-full p-1 transition-colors shrink-0" style={{ backgroundColor: draft.DRAG_COUNTS_TOWARD_SIZE ? GREEN : '#cbd5e1' }}>
            <div className="w-6 h-6 rounded-full bg-white transition-transform" style={{ transform: draft.DRAG_COUNTS_TOWARD_SIZE ? 'translateX(24px)' : 'none' }} />
          </button>
        </div>

        {/* Danger options — editable ladder */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Danger options ($)</div>
            <button onClick={() => setDraft(d => ({ ...d, DANGER_OPTIONS: [...d.DANGER_OPTIONS, 0] }))} className="text-[11px] font-bold text-emerald-700 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {draft.DANGER_OPTIONS.map((v, i) => (
              <div key={i} className="flex items-center gap-1 border border-slate-200 rounded-lg pl-2 pr-1 py-1">
                <span className="text-slate-400 font-bold text-sm">$</span>
                <input type="number" value={String(v)} onChange={e => setDraft(d => ({ ...d, DANGER_OPTIONS: d.DANGER_OPTIONS.map((x, j) => j === i ? (e.target.value === '' ? 0 : Number(e.target.value)) : x) }))}
                  className="w-16 text-right font-mono font-bold outline-none" />
                <button onClick={() => setDraft(d => ({ ...d, DANGER_OPTIONS: d.DANGER_OPTIONS.filter((_, j) => j !== i) }))} className="text-slate-300 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        </div>

        {/* Validation errors (live) */}
        {errors.length > 0 && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-1">
            {errors.map((e, i) => <div key={i} className="text-[12px] font-bold text-rose-700 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {e}</div>)}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          <button onClick={() => setDraft(structuredClone(config))} disabled={!dirty} className="min-h-[44px] px-4 rounded-xl border border-slate-300 text-slate-700 text-xs font-black uppercase tracking-widest hover:bg-slate-50 disabled:opacity-40">Discard</button>
          <button onClick={() => setPreviewing(true)} disabled={!dirty || errors.length > 0}
            className="min-h-[44px] px-5 rounded-xl text-white text-xs font-black uppercase tracking-widest disabled:opacity-40" style={{ backgroundColor: GREEN }}>
            Review {changes.length} change{changes.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>

      {/* ── Preview-before-commit ────────────────────────────────────────── */}
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

// ── Audit history — newest first, with revert ───────────────────────────────
function AuditHistory({ versions, activeVersion, onRevert }: { versions: Record<string, SnowRateConfigVersion>; activeVersion: string; onRevert: (id: string) => Promise<boolean> }) {
  // Stored versions (v2+) plus the implicit v1 baseline (never a stored doc).
  const list = useMemo(() => {
    const stored = Object.values(versions);
    const v1: SnowRateConfigVersion = {
      id: 'snow-v1', version: 'snow-v1', config: SNOW_CONFIG_V1, changes: [],
      note: 'Initial hard-coded defaults', createdBy: { email: '', name: 'System (shipped in code)' }, createdAt: undefined,
    };
    const all = stored.some(v => v.id === 'snow-v1') ? stored : [...stored, v1];
    return all.sort((a, b) => snowVersionNum(b.version) - snowVersionNum(a.version));
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
                {!isActive && <button onClick={() => { if (window.confirm(`Revert snow rates to ${v.version}? This creates a new version.`)) onRevert(v.id); }} className="text-[11px] font-bold text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" /> Revert to this</button>}
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

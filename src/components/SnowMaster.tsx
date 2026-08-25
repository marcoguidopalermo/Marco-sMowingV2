import { useMemo, useState } from 'react';
import { Snowflake, RotateCcw, Save, FolderOpen, Trash2, Search, AlertTriangle, BarChart3, Car, SlidersHorizontal, FileText } from 'lucide-react';
import { SnowQuote, SnowRateConfigVersion, SnowContract } from '../types';
import { encodeGrid, gridOf } from '../lib/snowGrid';
import {
  priceSnow, SnowConfig, SNOW_CONFIG_V1, SnowPrice, resolveSnowConfig,
} from '../lib/snowPricing';
import SnowRateSheet from './SnowRateSheet';
import SnowContractsModule from './SnowContractsModule';

// House style.
const GREEN = '#1c4634';
const GOLD = '#cdbd8f';

const ROWS = 6;
const COLS = 4;
const emptyGrid = (): number[][] => Array.from({ length: ROWS }, () => Array(COLS).fill(0));
const money = (n: number) => `$${(Number(n) || 0).toLocaleString('en-US')}`;
const fmtWhen = (ms?: number) => ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
// Effective quoted price: the season total, or — for a custom quote whose total
// is null — the floor (base + add-ons), so the report can count it. Add-ons are
// resolved against the QUOTE'S OWN config version, never the current one, so a
// historical quote never reprices.
const addsOf = (q: SnowQuote, cfg: SnowConfig): number =>
  (q.dragCount || 0) * cfg.DRAG_RATE +
  (q.premium ? cfg.PREMIUM : 0) +
  (q.busyRoad ? cfg.BUSY_ROAD : 0) +
  (q.danger || 0);
const priceOf = (q: SnowQuote, cfg: SnowConfig): number => q.total ?? (q.basePrice + addsOf(q, cfg));
// Label an unnamed quote by its shape + price, e.g. "1×3 · 3 car · Tier 1 · $599".
const shapeLabel = (q: SnowQuote, cfg: SnowConfig): string =>
  `${q.lanes}×${q.depth} · ${q.cars} car · ${q.isCustom ? 'Custom' : 'Tier ' + q.tier} · ${q.isCustom ? 'min ' : ''}${money(priceOf(q, cfg))}`;

interface Props {
  quotes: Record<string, SnowQuote>;
  currentUser: { email: string; name: string };
  isAdmin: boolean;
  onSave: (q: SnowQuote) => void;
  onDelete: (id: string) => void;
  // Pricing config (super-admin editable, versioned). Defaults keep the preview
  // harness and any un-wired caller working against the v1 hard-coded numbers.
  isSuperAdmin?: boolean;
  config?: SnowConfig;                                 // active config
  activeVersion?: string;                              // active version id
  configs?: Record<string, SnowRateConfigVersion>;     // all stored versions
  onSaveConfig?: (next: SnowConfig) => Promise<boolean>;
  onRevertConfig?: (versionId: string) => Promise<boolean>;
  // Optional initial seed for the tracer (used by previews / future deep-links).
  initial?: { grid?: number[][]; premium?: boolean; busyRoad?: boolean; danger?: number };
  // Commercial contract builder — its own sub-tab.
  snowContracts?: Record<string, SnowContract>;
  onSaveSnowContract?: (c: SnowContract) => Promise<void>;
  onCreateSnowContract?: () => Promise<string | null>;
  onDuplicateSnowContract?: (id: string) => Promise<string | null>;
  onUploadSnowContractMap?: (contractId: string, file: File) => Promise<string | null>;
  onUploadSnowContractDoc?: (contractId: string, file: File, onProgress: (pct: number) => void) => Promise<import('../types').StoredFile | null>;
  onDeleteSnowContractDoc?: (path: string) => Promise<void>;
  onDeleteSnowContract?: (id: string) => Promise<boolean>;
  onArchiveSnowContract?: (id: string, archived: boolean) => Promise<void>;
  canDeleteSnowContracts?: boolean;
  canEditSnowContracts?: boolean;
}

export default function SnowMaster({
  quotes, currentUser, isAdmin, onSave, onDelete, initial,
  isSuperAdmin = false, config = SNOW_CONFIG_V1, activeVersion = 'snow-v1', configs = {},
  snowContracts = {}, onSaveSnowContract, onCreateSnowContract, onDuplicateSnowContract,
  onUploadSnowContractMap, onUploadSnowContractDoc, onDeleteSnowContractDoc,
  onDeleteSnowContract, onArchiveSnowContract, canDeleteSnowContracts = false, canEditSnowContracts = false,
  onSaveConfig, onRevertConfig,
}: Props) {
  const [sub, setSub] = useState<'quote' | 'saved' | 'report' | 'contracts' | 'rates'>('quote');

  // Config version map for resolving any quote's original prices.
  const versionMap = useMemo(() => {
    const m: Record<string, { version: string; config: SnowConfig }> = {};
    for (const v of Object.values(configs)) m[v.id] = { version: v.version, config: v.config as SnowConfig };
    return m;
  }, [configs]);

  // ── Traced shape + inputs ────────────────────────────────────────────────
  // Premium is no longer a toggle — Standard and Premium are shown side by side,
  // always. Premium = Standard + config.PREMIUM. So the live price is computed
  // WITHOUT premium; the Premium column derives from it.
  const [grid, setGrid] = useState<number[][]>(() => {
    const g = gridOf(initial);
    return g.length ? g.map(r => [...r]) : emptyGrid();
  });
  const [busyRoad, setBusyRoad] = useState(!!initial?.busyRoad);
  const [danger, setDanger] = useState(initial?.danger || 0);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  // The saved quote currently open, so re-saving preserves who first quoted it.
  const loaded = loadedId ? quotes[loadedId] : undefined;
  // Version-safe display: a freshly-loaded, UN-edited quote resolves against the
  // version it was quoted under (loadedVersion); a fresh trace or any edit uses
  // the ACTIVE version (re-quoting at current rates). This is what stops a saved
  // quote from silently repricing when rates change.
  const [loadedVersion, setLoadedVersion] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const viewVersion = (loadedVersion && !dirty) ? loadedVersion : activeVersion;
  const viewConfig = resolveSnowConfig(viewVersion, versionMap);
  // Optional label. The Snow tab only FINDS a price — the real quote is written
  // in Jobber. A saved record exists to feed the report, so the name is never
  // required; it's just there for anyone who wants to find a shape at renewal.
  const [name, setName] = useState('');

  // Standard price (no premium). The Premium column adds config.PREMIUM on top.
  const price = useMemo<SnowPrice | null>(
    () => priceSnow(grid, { premium: false, busyRoad, danger }, viewConfig, viewVersion),
    [grid, busyRoad, danger, viewConfig, viewVersion],
  );
  const premiumAdd = viewConfig.PREMIUM;
  // Standard vs Premium totals (non-custom) / floors (custom). Derived from the
  // one Standard price + the version's PREMIUM value, so both respect the
  // loaded quote's stamped config.
  const stdTotal = price && !price.isCustom ? price.total! : null;
  const premTotal = stdTotal != null ? stdTotal + premiumAdd : null;
  const stdFloor = price && price.isCustom ? price.floor! : null;
  const premFloor = stdFloor != null ? stdFloor + premiumAdd : null;

  // Tap cycles a cell: empty → open → drag → empty. (Tap-cycle, not double-tap.)
  // Any edit marks the trace dirty → prices at the ACTIVE (current) version.
  const cycle = (r: number, c: number) => {
    setDirty(true);
    setGrid(g => g.map((row, i) => i === r ? row.map((v, j) => j === c ? (v + 1) % 3 : v) : row));
  };
  const editBusyRoad = () => { setDirty(true); setBusyRoad(b => !b); };
  const editDanger = (d: number) => { setDirty(true); setDanger(d); };

  const clearAll = () => {
    if (price && !window.confirm('Clear the driveway and all inputs?')) return;
    setGrid(emptyGrid()); setBusyRoad(false); setDanger(0);
    setLoadedId(null); setName(''); setLoadedVersion(null); setDirty(false);
  };

  // One tap, no blocking dialog — the report is only useful if estimators
  // actually save, so there's zero friction. Name is optional. The quote stamps
  // the version it was priced under (viewVersion).
  const save = () => {
    if (!price) return;
    const label = name.trim();
    const id = loadedId || `snow-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const q: SnowQuote = {
      id, name: label, client: label || undefined,
      // Encoded to strings: Firestore refuses an array inside an array, which
      // is why nothing saved before. See lib/snowGrid.
      gridRows: encodeGrid(grid),
      lanes: price.lanes, depth: price.depth, cars: price.cars, dragCount: price.dragCount,
      tier: price.tier, basePrice: price.basePrice,
      // Premium is no longer a toggle: the Standard price is the base, and BOTH
      // totals are recorded. `total` keeps its meaning (Standard total / null for
      // custom); `premiumTotal` is new. `premium: false` since Standard is base.
      premium: false, busyRoad, danger,
      total: stdTotal, premiumTotal: premTotal, isCustom: price.isCustom,
      pricingConfigVersion: viewVersion,
      // The ORIGINAL quoter is preserved when re-saving a loaded quote; App
      // stamps updatedBy/updatedAt. With several people quoting residential
      // snow, a quote nobody can attribute is a quote nobody can ask about.
      quotedBy: loaded?.quotedBy || currentUser,
      quotedAt: loaded?.quotedAt || Date.now(),
    };
    onSave(q);
    setLoadedId(id); setLoadedVersion(viewVersion); setDirty(false);
  };

  const load = (q: SnowQuote) => {
    // gridOf() reads the string form and the legacy number[][] alike, so a
    // quote restored by hand still opens.
    const g = gridOf(q);
    setGrid(g.length ? g.map(r => [...r]) : emptyGrid());
    setBusyRoad(!!q.busyRoad); setDanger(q.danger || 0);
    setLoadedId(q.id); setName(q.name || '');
    setLoadedVersion(q.pricingConfigVersion || 'snow-v1'); setDirty(false);
    setSub('quote');
  };

  const chip = (label: string, value: number | string) => (
    <div className="flex-1 min-w-[64px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-center">
      <div className="text-2xl font-black text-slate-900 leading-none">{value}</div>
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">{label}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Sub-tabs — Rate sheet is super-admin only (also hard-guarded in the
          component + write handlers + firestore.rules). */}
      <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm w-fit">
        {(['quote', 'saved', 'report', 'contracts', ...(isSuperAdmin ? ['rates'] as const : [])] as const).map(t => (
          <button key={t} onClick={() => setSub(t)}
            className={`px-3 py-1.5 text-sm font-bold rounded-md inline-flex items-center gap-1 ${sub === t ? 'text-white' : 'text-gray-500'}`}
            style={sub === t ? { backgroundColor: GREEN } : undefined}>
            {t === 'quote' ? 'Quote' : t === 'saved' ? 'Saved' : t === 'report' ? 'Report'
              : t === 'contracts' ? <><FileText className="w-3.5 h-3.5" /> Contracts</>
                : <><SlidersHorizontal className="w-3.5 h-3.5" /> Rate sheet</>}
          </button>
        ))}
      </div>

      {sub === 'contracts' && (
        <SnowContractsModule
          contracts={snowContracts}
          onSave={onSaveSnowContract || (async () => {})}
          onCreate={onCreateSnowContract || (async () => null)}
          onUploadDocument={onUploadSnowContractDoc || (async () => null)}
          onDeleteDocument={onDeleteSnowContractDoc || (async () => {})}
          onDeleteContract={onDeleteSnowContract || (async () => false)}
          onArchiveContract={onArchiveSnowContract || (async () => {})}
          canDelete={canDeleteSnowContracts}
          canEdit={canEditSnowContracts}
          currentUser={currentUser}
          today={new Date().toISOString().slice(0, 10)}
        />
      )}

      {sub === 'quote' && (
        <div className="grid md:grid-cols-2 gap-4 items-start">
          {/* ── LEFT: tracer + inputs ─────────────────────────────────────── */}
          <div className="space-y-4">
            {loadedId && (
              <div className="rounded-lg px-3 py-1.5"
                style={{ backgroundColor: '#eef4f0', color: GREEN }}>
                <div className="text-[12px] font-bold flex items-center gap-1.5">
                  <FolderOpen className="w-3.5 h-3.5" /> Editing saved shape{name.trim() ? `: ${name.trim()}` : ''}
                </div>
                {/* On the quote itself, not only in the list — the person
                    looking at a price is the one who needs to know whose it is. */}
                {loaded && (
                  <div className="text-[10px] font-medium opacity-80 mt-0.5">
                    Quoted by {loaded.quotedBy?.name || '—'} · {fmtWhen(loaded.quotedAt)}
                    {loaded.updatedAt && loaded.updatedAt !== loaded.quotedAt && (
                      <> · last updated by {loaded.updatedBy?.name || '—'} · {fmtWhen(loaded.updatedAt)}</>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* Historical view: an un-edited loaded quote is priced at ITS
                version, not today's. Editing re-quotes at current rates. */}
            {loadedVersion && !dirty && loadedVersion !== activeVersion && (
              <div className="rounded-lg px-3 py-1.5 text-[12px] font-bold flex items-center gap-1.5 bg-amber-50 text-amber-800 border border-amber-200">
                <AlertTriangle className="w-3.5 h-3.5" /> Showing prices as quoted ({loadedVersion}). Current rates are {activeVersion} — edit to re-quote.
              </div>
            )}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Trace the driveway</div>
                <div className="text-[10px] font-bold text-slate-400">Tap: empty → spot → DRAG</div>
              </div>
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
                {grid.map((row, r) => row.map((v, c) => (
                  <button key={`${r}-${c}`} onClick={() => cycle(r, c)}
                    aria-label={`Cell row ${r + 1} column ${c + 1}: ${v === 0 ? 'empty' : v === 1 ? 'spot' : 'drag'}`}
                    className="aspect-square rounded-xl flex flex-col items-center justify-center transition-colors select-none"
                    style={
                      v === 1 ? { backgroundColor: GREEN, color: 'white' }
                        : v === 2 ? { backgroundColor: '#c9d8cf', color: GREEN, border: `2px dashed ${GREEN}` }
                          : { backgroundColor: '#f1f5f9', border: '2px dashed #cbd5e1', color: '#94a3b8' }
                    }>
                    {v === 1 && <Car className="w-6 h-6" />}
                    {v === 2 && <span className="text-[11px] font-black uppercase tracking-widest">Drag</span>}
                  </button>
                )))}
              </div>
              {/* Gold street bar at the street (bottom) end */}
              <div className="mt-2 rounded-full h-3" style={{ backgroundColor: GOLD }} />
              <div className="text-center text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">Street</div>
            </div>

            {/* Inputs — Premium is no longer here; it's shown as its own column
                in the readout, always, so it can be quoted without a tap. */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
              <Toggle label="Busy road" sub="Main-road frontage" on={busyRoad} onClick={editBusyRoad} />
              <div>
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Danger charge</div>
                <div className="grid grid-cols-4 gap-2">
                  {viewConfig.DANGER_OPTIONS.map(d => (
                    <button key={d} onClick={() => editDanger(d)}
                      className="min-h-[44px] rounded-xl text-sm font-black border transition-colors"
                      style={danger === d
                        ? { backgroundColor: GREEN, color: 'white', borderColor: GREEN }
                        : { backgroundColor: 'white', color: '#334155', borderColor: '#e2e8f0' }}>
                      {d === 0 ? 'None' : `$${d}`}
                    </button>
                  ))}
                </div>
                <div className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                  Retaining walls, drop-offs, steep grade, tight turns, posts or structures close to the blower.
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT: live price + breakdown ─────────────────────────────── */}
          <div className="space-y-4">
            <PriceReadout price={price} premiumAdd={premiumAdd}
              stdTotal={stdTotal} premTotal={premTotal} stdFloor={stdFloor} premFloor={premFloor} />

            {price && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Shape</div>
                <div className="flex gap-2">
                  {chip('Lanes', price.lanes)}
                  {chip('Depth', price.depth)}
                  {chip('Cars', price.cars)}
                  {chip('Drag', price.dragCount)}
                </div>

                {/* Breakdown: shared lines once, then Standard + Premium totals. */}
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 pt-1">Breakdown</div>
                <div className="space-y-1 text-sm">
                  <Row label={price.isCustom ? `Custom floor` : `Tier ${price.tier} base`} value={money(price.basePrice)} />
                  {price.addBreakdown.drag > 0 && <Row label={`Drag × ${price.dragCount} @ $${viewConfig.DRAG_RATE}`} value={money(price.addBreakdown.drag)} />}
                  {price.addBreakdown.busyRoad > 0 && <Row label="Busy road" value={money(price.addBreakdown.busyRoad)} />}
                  {price.addBreakdown.danger > 0 && <Row label="Danger" value={money(price.addBreakdown.danger)} />}
                  <div className="flex justify-between border-t-2 border-slate-200 pt-1.5 mt-1 font-bold text-slate-700">
                    <span className="uppercase tracking-widest text-[12px] text-slate-500 self-center">{price.isCustom ? 'Standard floor' : 'Standard total'}</span>
                    <span className="text-base font-mono">{money(price.isCustom ? stdFloor! : stdTotal!)}</span>
                  </div>
                  <div className="flex justify-between font-black text-slate-900">
                    <span className="uppercase tracking-widest text-[12px] self-center" style={{ color: GREEN }}>{price.isCustom ? 'Premium floor' : 'Premium total'} <span className="text-slate-400 font-bold normal-case tracking-normal">(+{money(premiumAdd)})</span></span>
                    <span className="text-lg font-mono">{money(price.isCustom ? premFloor! : premTotal!)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Optional label — for finding a shape again at renewal. Saving
                never requires it; the quote itself is written in Jobber. */}
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="Client / address (optional)"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-slate-400" />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={clearAll}
                className="min-h-[48px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-black uppercase tracking-widest">
                <RotateCcw className="w-4 h-4" /> Clear
              </button>
              <button onClick={save} disabled={!price}
                className="min-h-[48px] inline-flex items-center justify-center gap-1.5 rounded-xl text-white text-xs font-black uppercase tracking-widest disabled:opacity-40"
                style={{ backgroundColor: GREEN }}>
                <Save className="w-4 h-4" /> {loadedId ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {sub === 'saved' && (
        <SavedSnowQuotes quotes={quotes} currentUser={currentUser} isAdmin={isAdmin} versionMap={versionMap} onOpen={load} onDelete={onDelete} />
      )}

      {sub === 'report' && <SnowReport quotes={quotes} versionMap={versionMap} />}

      {sub === 'rates' && (
        <SnowRateSheet
          isSuperAdmin={isSuperAdmin}
          config={config}
          activeVersion={activeVersion}
          versions={configs}
          onSave={onSaveConfig || (async () => false)}
          onRevert={onRevertConfig || (async () => false)}
        />
      )}
    </div>
  );
}

// ── Live price readout — Standard + Premium always shown side by side ────────
function PriceReadout({ price, premiumAdd, stdTotal, premTotal, stdFloor, premFloor }: {
  price: SnowPrice | null; premiumAdd: number;
  stdTotal: number | null; premTotal: number | null; stdFloor: number | null; premFloor: number | null;
}) {
  if (!price) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-6 text-center">
        <Snowflake className="w-8 h-8 mx-auto text-slate-300" />
        <div className="text-sm font-bold text-slate-400 mt-2">Trace a driveway to price it</div>
      </div>
    );
  }

  if (price.isCustom) {
    // Both floors, adds applied to each. Two compact columns, never stacked.
    // The floors are peers (equal weight) — size BOTH by the longer (premium)
    // so a 3-digit / 4-digit pair steps down together and stays aligned.
    const floorCls = (premFloor ?? 0) >= 1000 ? 'text-xl md:text-2xl' : 'text-2xl md:text-3xl';
    return (
      <div className="rounded-2xl border-2 p-4 shadow-sm" style={{ backgroundColor: '#fffbeb', borderColor: '#f59e0b' }}>
        <div className="flex items-center gap-2 text-amber-800 font-black uppercase tracking-widest text-[12px]">
          <AlertTriangle className="w-4 h-4" /> Custom — James quotes
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div className="rounded-xl bg-white/70 border border-amber-200 p-3 min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-amber-700">Standard floor</div>
            <div className={`${floorCls} font-black text-amber-900 font-mono leading-tight whitespace-nowrap`}>{money(stdFloor!)}<span className="text-xs font-bold text-amber-600"> min</span></div>
          </div>
          <div className="rounded-xl p-3 text-white shadow-sm min-w-0" style={{ backgroundColor: '#92400e', border: `2px solid ${GOLD}` }}>
            <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: GOLD }}>Premium floor</div>
            <div className={`${floorCls} font-black font-mono leading-tight whitespace-nowrap`}>{money(premFloor!)}<span className="text-xs font-bold text-amber-200"> min</span></div>
            <div className="text-[10px] font-bold text-amber-200">+{money(premiumAdd)} premium</div>
          </div>
        </div>
        <div className="text-[12px] font-black text-amber-900 mt-2">Do not quote below the floor without Marco.</div>
      </div>
    );
  }

  // Standard vs Premium — two columns. Premium reads as the upsell (solid green,
  // gold accent, larger), Standard lighter. Each price sizes by its OWN digit
  // count: three-digit stays large; four-digit ($1,000–$9,999) steps down one
  // notch so it never runs past the rounded card edge — on desktop AND mobile,
  // never clipped, never wrapped. Premium's step-down lands it at Standard's
  // un-stepped size, so a $949 / $1,149 pair reads level, not ragged.
  const stdCls = (stdTotal ?? 0) >= 1000 ? 'text-2xl md:text-3xl' : 'text-3xl md:text-4xl';
  const premCls = (premTotal ?? 0) >= 1000 ? 'text-3xl md:text-4xl' : 'text-4xl md:text-5xl';
  return (
    <div className="grid grid-cols-2 gap-2 items-stretch">
      <div className="rounded-2xl p-4 shadow-sm border min-w-0" style={{ backgroundColor: '#eef4f0', borderColor: '#d5e2da' }}>
        <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: GREEN }}>Standard · Tier {price.tier}</div>
        <div className={`${stdCls} font-black font-mono mt-1 leading-none whitespace-nowrap`} style={{ color: GREEN }}>{money(stdTotal!)}</div>
      </div>
      <div className="rounded-2xl p-4 shadow-sm text-white min-w-0" style={{ backgroundColor: GREEN, border: `2px solid ${GOLD}` }}>
        <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: GOLD }}>Premium · Tier {price.tier}</div>
        <div className={`${premCls} font-black font-mono mt-1 leading-none whitespace-nowrap`}>{money(premTotal!)}</div>
        <div className="text-[10px] font-bold mt-0.5" style={{ color: GOLD }}>+{money(premiumAdd)} vs standard</div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-slate-600"><span>{label}</span><span className="font-mono">{value}</span></div>;
}

function Toggle({ label, sub, on, onClick }: { label: string; sub: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center justify-between gap-3 min-h-[48px] rounded-xl border px-3 transition-colors"
      style={on ? { backgroundColor: '#eef4f0', borderColor: GREEN } : { backgroundColor: 'white', borderColor: '#e2e8f0' }}>
      <div className="text-left">
        <div className="text-sm font-black" style={{ color: on ? GREEN : '#334155' }}>{label}</div>
        <div className="text-[11px] text-slate-400">{sub}</div>
      </div>
      <div className="w-12 h-7 rounded-full p-1 transition-colors shrink-0" style={{ backgroundColor: on ? GREEN : '#cbd5e1' }}>
        <div className="w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: on ? 'translateX(20px)' : 'none' }} />
      </div>
    </button>
  );
}

// ── Saved snow quotes ───────────────────────────────────────────────────────
function SavedSnowQuotes({ quotes, currentUser, isAdmin, versionMap, onOpen, onDelete }: {
  quotes: Record<string, SnowQuote>; currentUser: { email: string; name: string }; isAdmin: boolean;
  versionMap: Record<string, { version: string; config: SnowConfig }>;
  onOpen: (q: SnowQuote) => void; onDelete: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return Object.values(quotes)
      .filter(x => !s || `${x.name} ${x.client || ''}`.toLowerCase().includes(s))
      .sort((a, b) => (b.updatedAt || b.quotedAt || 0) - (a.updatedAt || a.quotedAt || 0));
  }, [quotes, search]);
  const canDelete = (x: SnowQuote) => isAdmin || (x.quotedBy?.email || '').toLowerCase() === currentUser.email.toLowerCase();

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by client / address…"
          className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm outline-none" />
      </div>
      {list.length === 0 ? (
        <div className="text-center text-slate-400 py-8">{Object.keys(quotes).length === 0 ? 'No snow quotes yet — trace a driveway and hit Save.' : 'No quotes match.'}</div>
      ) : (
        <div className="space-y-2">
          {list.map(x => {
            const named = (x.name || '').trim();
            const cfg = resolveSnowConfig(x.pricingConfigVersion, versionMap);
            const title = named || shapeLabel(x, cfg);
            return (
            <div key={x.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex items-center justify-between gap-3">
              <button onClick={() => onOpen(x)} className="min-w-0 text-left flex-1">
                <div className="font-bold text-slate-800 truncate">{title}</div>
                {/* When unnamed the title already carries shape + price, so only
                    named quotes repeat the detail line. */}
                {named && (
                  <div className="text-[12px] text-slate-500">
                    {x.isCustom
                      ? <span className="font-mono font-bold text-amber-700">Custom · min {money(priceOf(x, cfg))}</span>
                      : <><span className="font-mono font-bold text-slate-700">{money(x.total || 0)}</span> · Tier {x.tier}</>}
                    {' '}· {x.lanes}×{x.depth} · {x.cars} cars{x.dragCount ? ` · ${x.dragCount} drag` : ''}
                  </div>
                )}
                {/* WHO QUOTED IT, and who last changed it when that is somebody
                    else. With several people quoting residential snow, a quote
                    nobody can attribute is a quote nobody can ask about. */}
                <div className="text-[10px] text-slate-400">
                  Quoted by {x.quotedBy?.name || '—'} · {fmtWhen(x.quotedAt)}
                  {x.updatedAt && x.updatedAt !== x.quotedAt && (
                    <> · updated by {x.updatedBy?.name || '—'} · {fmtWhen(x.updatedAt)}</>
                  )}
                  {x.dragCount && !named ? ` · ${x.dragCount} drag` : ''}
                </div>
              </button>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => onOpen(x)} title="Open the traced shape" className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><FolderOpen className="w-4 h-4" /></button>
                {canDelete(x) && <button onClick={() => { if (window.confirm(`Delete snow quote "${title}"?`)) onDelete(x.id); }} title="Delete" className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Report — the numbers the season model currently guesses at ──────────────
function SnowReport({ quotes, versionMap }: { quotes: Record<string, SnowQuote>; versionMap: Record<string, { version: string; config: SnowConfig }> }) {
  const stats = useMemo(() => {
    const all = Object.values(quotes);
    const n = all.length;
    if (!n) return null;
    const tiers: Record<string, number> = { '1': 0, '2': 0, '3': 0, custom: 0 };
    let dragTotal = 0, withDrag = 0, busy = 0, danger = 0, priceTotal = 0;
    for (const q of all) {
      tiers[String(q.tier)] = (tiers[String(q.tier)] || 0) + 1;
      dragTotal += q.dragCount || 0;
      if ((q.dragCount || 0) > 0) withDrag++;
      if (q.busyRoad) busy++;
      if ((q.danger || 0) > 0) danger++;
      priceTotal += priceOf(q, resolveSnowConfig(q.pricingConfigVersion, versionMap));
    }
    return {
      n, tiers,
      avgDrag: dragTotal / n,
      pctWithDrag: (withDrag / n) * 100,
      pctBusy: (busy / n) * 100,
      pctDanger: (danger / n) * 100,
      customCount: tiers.custom,
      avgPrice: priceTotal / n,
    };
  }, [quotes, versionMap]);

  if (!stats) return <div className="text-center text-slate-400 py-8">No snow quotes yet — the report fills in as quotes are saved.</div>;

  const pct = (part: number) => `${Math.round((part / stats.n) * 100)}%`;
  const Stat = ({ label, value, note }: { label: string; value: string; note?: string }) => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">{label}</div>
      <div className="text-3xl font-black text-slate-900 mt-1">{value}</div>
      {note && <div className="text-[11px] text-slate-500 mt-0.5">{note}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="text-[12px] text-slate-500 flex items-center gap-1.5"><BarChart3 className="w-4 h-4" /> {stats.n} saved snow quote{stats.n === 1 ? '' : 's'}</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(['1', '2', '3', 'custom'] as const).map(t => (
          <Stat key={t} label={t === 'custom' ? 'Custom' : `Tier ${t}`} value={String(stats.tiers[t] || 0)} note={pct(stats.tiers[t] || 0) + ' of quotes'} />
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Avg drag spots" value={stats.avgDrag.toFixed(1)} note={`${Math.round(stats.pctWithDrag)}% have any drag`} />
        <Stat label="On busy roads" value={`${Math.round(stats.pctBusy)}%`} />
        <Stat label="With danger charge" value={`${Math.round(stats.pctDanger)}%`} />
        <Stat label="Custom quotes" value={String(stats.customCount)} />
        <Stat label="Avg quoted price" value={money(Math.round(stats.avgPrice))} note="custom counted at floor" />
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Sprout, RotateCcw, Save, FolderOpen, Trash2, Search, BarChart3, AlertTriangle, SlidersHorizontal } from 'lucide-react';
import { LawnQuote, LawnRateConfigVersion } from '../types';
import {
  LawnConfig, LAWN_CONFIG_V1, resolveLawnConfig,
  resolveTierIndex, tierLabel, priceLawn, priceMowingBase, LawnPrice, MowingPrice, PackagePrice,
  computeSeasonPlanFC, SeasonPlan, overgrownReductionPct, firstCutSeasonWeek, seasonEndDate, mondayOfNextWeek, migrateFirstCutDate,
} from '../lib/lawnPricing';
import LawnRateSheet from './LawnRateSheet';

const todayYmd = () => new Date().toISOString().slice(0, 10);
const defaultFirstCut = () => mondayOfNextWeek(todayYmd());

// House style.
const GREEN = '#1c4634';
const GOLD = '#cdbd8f';
const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const fmtWhen = (ms?: number) => ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

type PriceMode = 'sqft' | 'seasonal' | 'percut';
const MODE_LABEL: Record<PriceMode, string> = { sqft: 'Sq ft', seasonal: 'Seasonal price', percut: 'Per-cut price' };

interface Props {
  quotes: Record<string, LawnQuote>;
  currentUser: { email: string; name: string };
  isAdmin: boolean;
  onSave: (q: LawnQuote) => void;
  onDelete: (id: string) => void;
  // Pricing config (super-admin editable, versioned). Defaults to the v1
  // hard-coded numbers; version-safe display resolves historical quotes to
  // their stamped version.
  isSuperAdmin?: boolean;
  config?: LawnConfig;
  activeVersion?: string;
  configs?: Record<string, LawnRateConfigVersion>;
  onSaveConfig?: (next: LawnConfig) => Promise<boolean>;
  onRevertConfig?: (versionId: string) => Promise<boolean>;
  // Optional seed for previews/deep-links only. Never used in normal operation.
  initial?: { sqft?: number; firstCutDate?: string; overgrownKey?: string };
}

export default function LawnMaster({
  quotes, currentUser, isAdmin, onSave, onDelete,
  isSuperAdmin = false, config = LAWN_CONFIG_V1, activeVersion = 'lawn-v1', configs = {},
  onSaveConfig, onRevertConfig, initial,
}: Props) {
  const [sub, setSub] = useState<'quote' | 'saved' | 'report' | 'rates'>('quote');

  // ── Inputs ───────────────────────────────────────────────────────────────
  const [priceMode, setPriceMode] = useState<PriceMode>('sqft');
  const [sqft, setSqft] = useState(initial?.sqft || 0);       // mode A
  const [baseInput, setBaseInput] = useState(0);              // modes B (seasonal) / C (per-cut) weekly figure
  const [veryHilly, setVeryHilly] = useState(false);
  const [pushMow, setPushMow] = useState(false);
  const [clutter, setClutter] = useState(false);
  const [travelZone, setTravelZone] = useState('in_town');   // ONE zone → mowing + package travel
  const [firstCutDate, setFirstCutDate] = useState(initial?.firstCutDate || defaultFirstCut()); // Monday of next week
  const [overgrownKey, setOvergrownKey] = useState(initial?.overgrownKey || 'normal');
  const [frequency, setFrequency] = useState<'weekly' | 'biweekly' | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [loadedVersion, setLoadedVersion] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Version-safe: an un-edited loaded quote resolves against ITS version; a fresh
  // trace or any edit uses the active version.
  const viewVersion = (loadedVersion && !dirty) ? loadedVersion : activeVersion;
  const viewConfig = resolveLawnConfig(viewVersion, configs);

  const zone = useMemo(
    () => viewConfig.TRAVEL_ZONES.find(z => z.key === travelZone) || viewConfig.TRAVEL_ZONES[0],
    [viewConfig, travelZone],
  );

  // Mode A: sq ft → tier → mowing + packages. Modes B/C: a typed weekly base →
  // mowing only (no tier, no packages). Package travel = the mowing zone's
  // per-visit rate (one travel rate for everything).
  const flags = { pushMow, veryHilly, clutter, travelZone };
  const price = useMemo<LawnPrice | null>(
    () => priceMode === 'sqft' ? priceLawn(sqft, flags, zone.perVisit, viewConfig) : null,
    [priceMode, sqft, pushMow, veryHilly, clutter, travelZone, zone.perVisit, viewConfig],
  );
  const mowing = useMemo<MowingPrice | null>(() => {
    if (priceMode === 'sqft') return price ? price.mowing : null;
    const weeklyBase = priceMode === 'percut' ? (Number(baseInput) || 0) * viewConfig.WEEKLY_CUTS : (Number(baseInput) || 0);
    return weeklyBase > 0 ? priceMowingBase(weeklyBase, flags, viewConfig) : null;
  }, [priceMode, price, baseInput, pushMow, veryHilly, clutter, travelZone, viewConfig]);

  const tierIdx = resolveTierIndex(sqft, viewConfig);
  // Mid-season plan (mowing only). The first-cut-date model never blocks —
  // a date past the last cutting week clamps to one cut at max discount.
  const plan = useMemo<SeasonPlan | null>(
    () => mowing ? computeSeasonPlanFC(mowing, firstCutDate, overgrownKey, viewConfig) : null,
    [mowing, firstCutDate, overgrownKey, viewConfig],
  );
  const firstCutWeek = useMemo(() => firstCutSeasonWeek(firstCutDate, viewConfig), [firstCutDate, viewConfig]);
  const weeksServiced = viewConfig.WEEKS_IN_SEASON - firstCutWeek + 1;
  const weeklyCutsPreview = Math.round(viewConfig.WEEKLY_CUTS * weeksServiced / viewConfig.WEEKS_IN_SEASON);
  // Full weekly season price drives the overgrown catch-up dollar amounts.
  const fullSeasonPrice = mowing ? mowing.weeklyTotal : 0;

  const touch = () => setDirty(true);
  const pickTier = (i: number) => {
    touch();
    const t = viewConfig.TIERS[i];
    setSqft(t.maxSqFt ?? ((viewConfig.TIERS[i - 1]?.maxSqFt ?? 0) + 1));
  };

  const clearAll = () => {
    if (mowing && !window.confirm('Clear the lawn quote and all inputs?')) return;
    setPriceMode('sqft'); setSqft(0); setBaseInput(0);
    setVeryHilly(false); setPushMow(false); setClutter(false);
    setTravelZone('in_town'); setFirstCutDate(defaultFirstCut()); setOvergrownKey('normal');
    setFrequency(null); setSelectedPackage(null);
    setName(''); setLoadedId(null); setLoadedVersion(null); setDirty(false);
  };

  const save = () => {
    if (!mowing) return;
    const sel = selectedPackage && price ? price.packages.find(p => p.key === selectedPackage) : null;
    const label = name.trim();
    const id = loadedId || `lawn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const q: LawnQuote = {
      id, client: label || undefined,
      priceMode,
      basePriceInput: priceMode === 'sqft' ? undefined : (Number(baseInput) || 0),
      sqft: priceMode === 'sqft' ? sqft : 0,
      tierIndex: priceMode === 'sqft' ? mowing.tierIndex : -1,
      tierLabel: priceMode === 'sqft' ? mowing.tierLabel : MODE_LABEL[priceMode],
      mowingBase: mowing.weeklyBase, veryHilly, pushMow, clutter, travelZone,
      frequency,
      weeklyAnnual: mowing.weekly.annual, weeklyMonthly: mowing.weekly.monthly, weeklyPerCut: mowing.weekly.perCut,
      biweeklyAnnual: mowing.biweekly.annual, biweeklyMonthly: mowing.biweekly.monthly, biweeklyPerCut: mowing.biweekly.perCut,
      selectedPackage: sel && sel.priced ? sel.key : null,
      packageTotal: sel && sel.priced ? sel.total : null,
      // First-cut-date model (mowing only). Restores state exactly on reload.
      firstCutDate, firstCutWeek, overgrownKey,
      ...(plan ? {
        seasonDiscountPct: plan.discount.seasonDiscountPct, overgrownMultiplier: plan.discount.overgrownMultiplier, catchUpPct: plan.discount.catchUpPct,
        weeklyProrated: plan.weekly.proratedTotal, weeklyInstalments: plan.weekly.instalments,
        weeklyDeposit: plan.weekly.deposit, weeklyCatchUp: plan.weekly.catchUpCharge, weeklyFirstInvoice: plan.weekly.firstInvoice,
        weeklyCutsLeft: plan.weekly.cutsLeft, weeklyBhPerVisit: plan.weekly.bhPerVisit, weeklyFirstVisitBH: plan.weekly.firstVisitBH,
        biweeklyProrated: plan.biweekly.proratedTotal, biweeklyInstalments: plan.biweekly.instalments,
        biweeklyDeposit: plan.biweekly.deposit, biweeklyCatchUp: plan.biweekly.catchUpCharge, biweeklyFirstInvoice: plan.biweekly.firstInvoice,
        biweeklyCutsLeft: plan.biweekly.cutsLeft, biweeklyBhPerVisit: plan.biweekly.bhPerVisit, biweeklyFirstVisitBH: plan.biweekly.firstVisitBH,
      } : {}),
      pricingConfigVersion: viewVersion,
      quotedBy: currentUser, quotedAt: Date.now(),
    };
    onSave(q);
    setLoadedId(id); setLoadedVersion(viewVersion); setDirty(false);
  };

  const load = (q: LawnQuote) => {
    const mode: PriceMode = q.priceMode || 'sqft';
    setPriceMode(mode);
    setSqft(q.sqft || 0);
    setBaseInput(q.basePriceInput || 0);
    setVeryHilly(!!q.veryHilly); setPushMow(!!q.pushMow); setClutter(!!q.clutter);
    setTravelZone(q.travelZone || 'in_town');
    // Migrate old quotes (startDate + firstCut) → firstCutDate; prices identically.
    setFirstCutDate(q.firstCutDate || (q.startDate ? migrateFirstCutDate(q.startDate, q.firstCut) : defaultFirstCut()));
    setOvergrownKey(q.overgrownKey || 'normal');
    setFrequency(q.frequency || null); setSelectedPackage(q.selectedPackage || null);
    setName(q.client || ''); setLoadedId(q.id); setLoadedVersion(q.pricingConfigVersion || 'lawn-v1'); setDirty(false);
    setSub('quote');
  };

  return (
    <div className="space-y-4">
      {/* Sub-tabs — Rate sheet is super-admin only (also hard-guarded in the
          component + write handlers + firestore.rules). */}
      <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm w-fit">
        {(['quote', 'saved', 'report', ...(isSuperAdmin ? ['rates'] as const : [])] as const).map(t => (
          <button key={t} onClick={() => setSub(t)}
            className={`px-3 py-1.5 text-sm font-bold rounded-md inline-flex items-center gap-1 ${sub === t ? 'text-white' : 'text-gray-500'}`}
            style={sub === t ? { backgroundColor: GREEN } : undefined}>
            {t === 'rates' ? <><SlidersHorizontal className="w-3.5 h-3.5" /> Rate sheet</> : <span className="capitalize">{t}</span>}
          </button>
        ))}
      </div>

      {sub === 'quote' && (
        <div className="grid md:grid-cols-2 gap-4 items-start">
          {/* ── LEFT: inputs ────────────────────────────────────────────── */}
          <div className="space-y-4">
            {loadedId && (
              <div className="rounded-lg px-3 py-1.5 text-[12px] font-bold flex items-center gap-1.5" style={{ backgroundColor: '#eef4f0', color: GREEN }}>
                <FolderOpen className="w-3.5 h-3.5" /> Editing saved quote{name.trim() ? `: ${name.trim()}` : ''}
              </div>
            )}
            {loadedVersion && !dirty && loadedVersion !== activeVersion && (
              <div className="rounded-lg px-3 py-1.5 text-[12px] font-bold flex items-center gap-1.5 bg-amber-50 text-amber-800 border border-amber-200">
                <AlertTriangle className="w-3.5 h-3.5" /> Prices as quoted ({loadedVersion}); current rates are {activeVersion} — edit to re-quote.
              </div>
            )}

            {/* Price entry mode — how the base price is set */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Price by</div>
              <div className="grid grid-cols-3 gap-2">
                {(['sqft', 'seasonal', 'percut'] as const).map(mode => (
                  <button key={mode} onClick={() => { touch(); setPriceMode(mode); }}
                    className="min-h-[44px] rounded-xl text-[12px] font-black border transition-colors px-2 leading-tight"
                    style={priceMode === mode ? { backgroundColor: GREEN, color: 'white', borderColor: GREEN } : { backgroundColor: 'white', color: '#334155', borderColor: '#e2e8f0' }}>
                    {MODE_LABEL[mode]}
                  </button>
                ))}
              </div>

              {priceMode === 'sqft' ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {viewConfig.TIERS.map((_, i) => (
                      <button key={i} onClick={() => pickTier(i)}
                        className="min-h-[44px] rounded-xl text-[12px] font-black border transition-colors px-2 text-left leading-tight"
                        style={tierIdx === i ? { backgroundColor: GREEN, color: 'white', borderColor: GREEN } : { backgroundColor: 'white', color: '#334155', borderColor: '#e2e8f0' }}>
                        {tierLabel(i, viewConfig)}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Custom</span>
                    <input type="number" value={sqft || ''} onChange={e => { touch(); setSqft(Number(e.target.value) || 0); }}
                      placeholder="sq ft" className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-right font-mono font-bold" />
                    <span className="text-[11px] text-slate-400">sq ft</span>
                  </div>
                </>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex-1">
                      {priceMode === 'seasonal' ? 'Weekly seasonal price' : 'Weekly per-cut price'}
                    </span>
                    <span className="text-slate-400 font-bold">$</span>
                    <input type="number" value={baseInput || ''} onChange={e => { touch(); setBaseInput(Number(e.target.value) || 0); }}
                      placeholder="0" className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-right font-mono font-bold" />
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {priceMode === 'seasonal'
                      ? 'Full weekly season price. Biweekly derives at ×0.75. No tier or packages.'
                      : `Per-cut × ${viewConfig.WEEKLY_CUTS} cuts = ${money((Number(baseInput) || 0) * viewConfig.WEEKLY_CUTS)} weekly season. No tier or packages.`}
                  </div>
                </div>
              )}
            </div>

            {/* Terrain / extras */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
              <Toggle label="Very hilly" sub="Terrain — normal vs very hilly" on={veryHilly} onClick={() => { touch(); setVeryHilly(v => !v); }} />
              <Toggle label="Push mow only" sub="Small equipment" on={pushMow} onClick={() => { touch(); setPushMow(v => !v); }} />
              <Toggle label="Clutter" sub="Obstacles to work around" on={clutter} onClick={() => { touch(); setClutter(v => !v); }} />
            </div>

            {/* First cut date + overgrown catch-up (mowing only) */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">First cut date</span>
                <input type="date" value={firstCutDate} onChange={e => { touch(); setFirstCutDate(e.target.value); }}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold" />
              </div>
              <div className="text-[12px] text-slate-600 font-bold">
                Cutting week {firstCutWeek} of {viewConfig.WEEKS_IN_SEASON} · {weeklyCutsPreview} cut{weeklyCutsPreview === 1 ? '' : 's'} · last cutting week {fmtMD(seasonEndDate(viewConfig))}
              </div>
              <div className="text-[11px] text-slate-500">Defaults to the Monday of next week — a new client rarely fits this week’s route. Pull it earlier only when the route allows.</div>

              <div>
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Overgrown catch-up</div>
                <div className="grid grid-cols-5 gap-1.5">
                  {viewConfig.OVERGROWN.map(o => {
                    const on = overgrownKey === o.key;
                    // Actual one-time dollar amount for THIS quote, not a stale % label.
                    const amt = (o.multiplier - 1) * viewConfig.DISCOUNT_PER_WEEK / 100 * fullSeasonPrice;
                    return (
                      <button key={o.key} onClick={() => { touch(); setOvergrownKey(o.key); }}
                        className="min-h-[52px] rounded-xl text-[11px] font-black border transition-colors px-1 flex flex-col items-center justify-center leading-tight"
                        style={on ? { backgroundColor: GREEN, color: 'white', borderColor: GREEN } : { backgroundColor: 'white', color: '#334155', borderColor: '#e2e8f0' }}>
                        <span>{o.multiplier}×</span>
                        <span className="opacity-70 text-[10px] font-bold">{o.multiplier === 1 ? '—' : (fullSeasonPrice > 0 ? money(amt) : `+${overgrownReductionPct(o.multiplier, viewConfig)}%`)}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="text-[11px] text-slate-500 mt-1.5">A separate one-time charge on the first invoice — the season discount is unaffected.</div>
              </div>
            </div>

            {/* Travel zone — ONE rate for mowing AND packages. Max serviced = 20 km. */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-2">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Travel — from city limits</div>
              <div className="grid grid-cols-2 gap-2">
                {viewConfig.TRAVEL_ZONES.map(z => {
                  const on = travelZone === z.key;
                  return (
                    <button key={z.key} onClick={() => { touch(); setTravelZone(z.key); }}
                      className="min-h-[48px] rounded-xl text-sm font-black border transition-colors px-3 text-left leading-tight"
                      style={on ? { backgroundColor: GREEN, color: 'white', borderColor: GREEN } : { backgroundColor: 'white', color: '#334155', borderColor: '#e2e8f0' }}>
                      {z.label}
                      <span className="block text-[10px] font-bold opacity-70">{z.perVisit ? `$${z.perVisit}/visit` : 'no travel'}</span>
                    </button>
                  );
                })}
              </div>
              <div className="text-[11px] text-slate-500">Per visit × the visit count — {viewConfig.WEEKLY_CUTS} weekly, {viewConfig.BIWEEKLY_CUTS} biweekly, or the package’s visits. 20 km is the maximum serviced distance.</div>
            </div>
          </div>

          {/* ── RIGHT: output ───────────────────────────────────────────── */}
          <div className="space-y-4">
            {!mowing ? (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-6 text-center">
                <Sprout className="w-8 h-8 mx-auto text-slate-300" />
                <div className="text-sm font-bold text-slate-400 mt-2">
                  {priceMode === 'sqft' ? 'Pick a lawn size to price it' : 'Enter a price to build the quote'}
                </div>
              </div>
            ) : (
              <>
                {plan && <MowingComparison mowing={mowing} plan={plan} config={viewConfig} frequency={frequency} onFrequency={f => { touch(); setFrequency(cur => cur === f ? null : f); }} />}
                {plan && <BillingSchedule plan={plan} />}
                {price && <PackageBlock packages={price.packages} selected={selectedPackage} onSelect={k => { touch(); setSelectedPackage(cur => cur === k ? null : k); }} />}
              </>
            )}

            <input value={name} onChange={e => setName(e.target.value)} placeholder="Client / address (optional)"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-slate-400" />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={clearAll} className="min-h-[48px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-black uppercase tracking-widest">
                <RotateCcw className="w-4 h-4" /> Clear
              </button>
              <button onClick={save} disabled={!mowing} className="min-h-[48px] inline-flex items-center justify-center gap-1.5 rounded-xl text-white text-xs font-black uppercase tracking-widest disabled:opacity-40" style={{ backgroundColor: GREEN }}>
                <Save className="w-4 h-4" /> {loadedId ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {sub === 'saved' && <SavedLawnQuotes quotes={quotes} currentUser={currentUser} isAdmin={isAdmin} onOpen={load} onDelete={onDelete} />}
      {sub === 'report' && <LawnReport quotes={quotes} config={config} />}
      {sub === 'rates' && (
        <LawnRateSheet
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

const MONTHS3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMD = (ymd: string) => { const [, m, d] = ymd.split('-').map(Number); return `${MONTHS3[(m || 1) - 1]} ${d}`; };
const bn = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); // BH number, 2dp

// ── Mowing comparison — the single at-a-glance table (no cards, no popup) ─────
// Metrics as rows, Weekly / Biweekly as columns. Season total is the largest
// figure; discount + BH the next largest. Grouped with whitespace, not boxes.
function MowingComparison({ mowing, plan, config, frequency, onFrequency }: {
  mowing: MowingPrice; plan: SeasonPlan; config: LawnConfig;
  frequency: 'weekly' | 'biweekly' | null; onFrequency: (f: 'weekly' | 'biweekly') => void;
}) {
  const d = plan.discount;
  const overgrown = d.overgrownMultiplier > 1;
  const w = plan.weekly, b = plan.biweekly;
  const selW = frequency === 'weekly', selB = frequency === 'biweekly';

  const colHead = (f: 'weekly' | 'biweekly', label: string, sel: boolean) => (
    <button onClick={() => onFrequency(f)}
      className="text-right rounded-lg px-2 py-1 transition-colors"
      style={sel ? { backgroundColor: GREEN, color: 'white' } : { color: GREEN }}>
      <span className="text-[11px] font-black uppercase tracking-widest">{label}</span>
      {sel && <span className="block text-[9px] font-bold" style={{ color: GOLD }}>going with</span>}
    </button>
  );

  // A metric row: label + two right-aligned value cells. `size` scales the row.
  const row = (label: string, wv: string, bv: string, opts?: { size?: 'xl' | 'lg' | 'md'; internal?: boolean; note?: string; mt?: boolean }) => {
    const size = opts?.size;
    const valCls = size === 'xl' ? 'text-2xl md:text-3xl font-black' : size === 'lg' ? 'text-lg font-black' : size === 'md' ? 'text-base font-black' : 'text-sm font-bold';
    const labelCls = size === 'xl' ? 'text-[13px] font-black text-slate-700' : opts?.internal ? 'text-[11px] font-bold text-slate-400' : 'text-[12px] font-bold text-slate-500';
    return (
      <>
        <div className={`self-center ${labelCls} ${opts?.mt ? 'mt-2' : ''}`}>
          {label}
          {opts?.internal && <span className="block text-[9px] uppercase tracking-widest -mt-0.5">internal · do not quote</span>}
          {opts?.note && <span className="block text-[10px] font-medium text-slate-400 -mt-0.5">{opts.note}</span>}
        </div>
        <div className={`text-right font-mono self-center ${valCls} ${opts?.mt ? 'mt-2' : ''}`} style={{ color: selW ? GREEN : (size ? GREEN : '#334155') }}>{wv}</div>
        <div className={`text-right font-mono self-center ${valCls} ${opts?.mt ? 'mt-2' : ''}`} style={{ color: selB ? GREEN : (size ? GREEN : '#334155') }}>{bv}</div>
      </>
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">Mowing · {mowing.tierLabel}</div>
      <div className="grid grid-cols-[1.15fr_1fr_1fr] gap-x-3 gap-y-1">
        {/* column headers */}
        <div />
        {colHead('weekly', 'Weekly', selW)}
        {colHead('biweekly', 'Biweekly', selB)}

        {row('Season total', money(w.proratedTotal), money(b.proratedTotal), { size: 'xl' })}
        {row('Full price', money(w.fullPrice), money(b.fullPrice), { note: 'renewal anchor' })}

        {/* Discount spans both columns — same figure for either frequency. */}
        <div className="self-center text-[12px] font-bold text-slate-500 mt-2">Discount</div>
        <div className="col-span-2 text-right self-center mt-2">
          <span className="text-lg font-black" style={{ color: GREEN }}>{d.seasonDiscountPct}%</span>
          <span className="text-[11px] font-bold text-slate-400"> · cutting week {d.firstCutWeek} of {config.WEEKS_IN_SEASON}</span>
        </div>

        {row('Cuts left', String(w.cutsLeft), String(b.cutsLeft))}
        {row('BH per visit', bn(w.bhPerVisit), bn(b.bhPerVisit), { size: 'md', mt: true })}
        {overgrown && row('First-visit BH', bn(w.firstVisitBH), bn(b.firstVisitBH), { note: `overgrown ${d.overgrownMultiplier}×` })}

        {row('Monthly', money(w.monthly), money(b.monthly), { mt: true })}
        {row('Instalments', String(w.instalments), String(b.instalments))}
        {row('Deposit', money(w.deposit), money(b.deposit))}
        {row('Internal PPC', money(w.internalPPC), money(b.internalPPC), { internal: true })}
      </div>

      {/* Shared breakdown of what built the base — compact, once. */}
      <div className="space-y-0.5 text-[12px] text-slate-600 border-t border-slate-100 mt-3 pt-2">
        <Row label={mowing.tierIndex >= 0 ? 'Tier base (weekly)' : 'Base price (weekly)'} value={money(mowing.weeklyBase)} />
        {mowing.extras.pushMow > 0 && <Row label="Push mow only" value={money(mowing.extras.pushMow)} />}
        {mowing.extras.veryHilly > 0 && <Row label="Very hilly" value={money(mowing.extras.veryHilly)} />}
        {mowing.extras.clutter > 0 && <Row label="Clutter" value={money(mowing.extras.clutter)} />}
        {mowing.travel.perVisit > 0 && <Row label={`Travel · ${mowing.travel.label}`} value={`$${mowing.travel.perVisit}/visit · ${money(mowing.travel.weeklySeason)} wk / ${money(mowing.travel.biweeklySeason)} bw`} />}
        {overgrown && <Row label={`Overgrown catch-up (${d.overgrownLabel})`} value={`${money(w.catchUpCharge)} wk / ${money(b.catchUpCharge)} bw`} />}
      </div>
    </div>
  );
}

// ── Billing schedule — dated, per frequency. Deposit row hidden at $0. ────────
function BillingSchedule({ plan }: { plan: SeasonPlan }) {
  const overgrown = plan.discount.overgrownMultiplier > 1;
  const billCol = (title: string, fp: typeof plan.weekly) => (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Billing · {fp.instalments} cycle{fp.instalments === 1 ? '' : 's'} left · {title}</div>
      <div className="mt-1.5 space-y-0.5 text-[12px]">
        {fp.deposit > 0 && <Row label="Initial deposit (on approval)" value={money(fp.deposit)} />}
        {overgrown && <Row label={`Overgrown catch-up (${plan.discount.overgrownLabel})`} value={money(fp.catchUpCharge)} />}
        {fp.billingDates.map(bd => <Row key={bd} label={fmtMD(bd)} value={money(fp.monthly)} />)}
        <div className="flex justify-between border-t border-slate-200 pt-1 mt-1 font-black text-slate-800"><span>Total</span><span className="font-mono">{money(fp.deposit + fp.catchUpCharge + fp.instalments * fp.monthly)}</span></div>
      </div>
    </div>
  );
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">Billing schedule</div>
      <div className="grid grid-cols-2 gap-2">
        {billCol('Weekly', plan.weekly)}
        {billCol('Biweekly', plan.biweekly)}
      </div>
    </div>
  );
}

// ── Package block — all packages shown together (mode A only) ────────────────
function PackageBlock({ packages, selected, onSelect }: { packages: PackagePrice[]; selected: string | null; onSelect: (k: string) => void }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Lawn care packages</div>
        <div className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full" style={{ backgroundColor: '#eef4f0', color: GREEN }}>Full season rate</div>
      </div>
      <div className="text-[11px] font-bold text-slate-500">Packages are not prorated — full season rate.</div>
      <div className="grid grid-cols-2 gap-2">
        {packages.map(p => {
          const sel = selected === p.key;
          if (!p.priced) return (
            <div key={p.key} className="rounded-xl border border-slate-200 bg-slate-50 p-3 opacity-70">
              <div className="text-sm font-black text-slate-600">{p.label}</div>
              <div className="text-[12px] font-bold text-slate-400 mt-1">Not yet priced</div>
            </div>
          );
          return (
            <button key={p.key} onClick={() => onSelect(p.key)}
              className="text-left rounded-xl border-2 p-3 transition-colors"
              style={sel ? { backgroundColor: GREEN, color: 'white', borderColor: GOLD } : { backgroundColor: 'white', borderColor: '#e2e8f0' }}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-black" style={{ color: sel ? 'white' : '#1e293b' }}>{p.label}</div>
                <div className="text-[10px] font-bold opacity-70">{p.visits} visit{p.visits === 1 ? '' : 's'}</div>
              </div>
              <div className="text-2xl font-black font-mono mt-0.5" style={{ color: sel ? 'white' : GREEN }}>{money(p.total)}</div>
              {(p.extras > 0 || p.travel > 0) && (
                <div className={`text-[10px] font-bold ${sel ? 'text-white/70' : 'text-slate-400'}`}>
                  {money(p.base)} base{p.extras ? ` · +${money(p.extras)} extras` : ''}{p.travel ? ` · +${money(p.travel)} travel` : ''}
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div className="text-[10px] text-slate-400">Packages price independently of mowing frequency. Tap to attach one to this quote.</div>
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

// ── Saved lawn quotes ───────────────────────────────────────────────────────
function SavedLawnQuotes({ quotes, currentUser, isAdmin, onOpen, onDelete }: {
  quotes: Record<string, LawnQuote>; currentUser: { email: string; name: string }; isAdmin: boolean;
  onOpen: (q: LawnQuote) => void; onDelete: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return Object.values(quotes)
      .filter(x => !s || `${x.client || ''} ${x.tierLabel}`.toLowerCase().includes(s))
      .sort((a, b) => (b.updatedAt || b.quotedAt || 0) - (a.updatedAt || a.quotedAt || 0));
  }, [quotes, search]);
  const canDelete = (x: LawnQuote) => isAdmin || (x.quotedBy?.email || '').toLowerCase() === currentUser.email.toLowerCase();
  const shape = (x: LawnQuote) => `${x.sqft > 0 ? `${(x.sqft).toLocaleString('en-US')} sq ft` : x.tierLabel} · ${money(x.weeklyAnnual)} / ${money(x.biweeklyAnnual)}`;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by client / size…" className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm outline-none" />
      </div>
      {list.length === 0 ? (
        <div className="text-center text-slate-400 py-8">{Object.keys(quotes).length === 0 ? 'No lawn quotes yet — price one and hit Save.' : 'No quotes match.'}</div>
      ) : (
        <div className="space-y-2">
          {list.map(x => {
            const named = (x.client || '').trim();
            return (
              <div key={x.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex items-center justify-between gap-3">
                <button onClick={() => onOpen(x)} className="min-w-0 text-left flex-1">
                  <div className="font-bold text-slate-800 truncate">{named || shape(x)}</div>
                  {named && <div className="text-[12px] text-slate-500">{shape(x)}</div>}
                  <div className="text-[10px] text-slate-400">
                    {x.priceMode && x.priceMode !== 'sqft' ? `${MODE_LABEL[x.priceMode]} · ` : ''}{x.selectedPackage ? `${x.selectedPackage} · ` : ''}{(x.updatedBy || x.quotedBy)?.name || '—'} · {fmtWhen(x.updatedAt || x.quotedAt)}
                  </div>
                </button>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => onOpen(x)} title="Open" className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><FolderOpen className="w-4 h-4" /></button>
                  {canDelete(x) && <button onClick={() => { if (window.confirm('Delete this lawn quote?')) onDelete(x.id); }} title="Delete" className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Report ──────────────────────────────────────────────────────────────────
function LawnReport({ quotes, config }: { quotes: Record<string, LawnQuote>; config: LawnConfig }) {
  const stats = useMemo(() => {
    const all = Object.values(quotes);
    const n = all.length;
    if (!n) return null;
    const tierCounts: Record<number, number> = {};
    const zoneCounts: Record<string, number> = {};
    let weekly = 0, biweekly = 0, hilly = 0, push = 0, clutter = 0, annualSum = 0;
    const pkg: Record<string, number> = { bronze: 0, silver: 0, gold: 0, dethatch: 0 };
    for (const q of all) {
      if (q.tierIndex >= 0) tierCounts[q.tierIndex] = (tierCounts[q.tierIndex] || 0) + 1;
      zoneCounts[q.travelZone] = (zoneCounts[q.travelZone] || 0) + 1;
      if (q.frequency === 'weekly') weekly++; else if (q.frequency === 'biweekly') biweekly++;
      if (q.veryHilly) hilly++; if (q.pushMow) push++; if (q.clutter) clutter++;
      if (q.selectedPackage && pkg[q.selectedPackage] !== undefined) pkg[q.selectedPackage]++;
      annualSum += q.weeklyAnnual || 0;
    }
    return { n, tierCounts, zoneCounts, weekly, biweekly, hilly, push, clutter, pkg, avgAnnual: annualSum / n };
  }, [quotes]);

  if (!stats) return <div className="text-center text-slate-400 py-8">No lawn quotes yet — the report fills in as quotes are saved.</div>;
  const pct = (x: number) => `${Math.round((x / stats.n) * 100)}%`;
  const Stat = ({ label, value, note }: { label: string; value: string; note?: string }) => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">{label}</div>
      <div className="text-3xl font-black text-slate-900 mt-1">{value}</div>
      {note && <div className="text-[11px] text-slate-500 mt-0.5">{note}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="text-[12px] text-slate-500 flex items-center gap-1.5"><BarChart3 className="w-4 h-4" /> {stats.n} saved lawn quote{stats.n === 1 ? '' : 's'}</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Weekly" value={String(stats.weekly)} note={`${pct(stats.weekly)} of quotes`} />
        <Stat label="Biweekly" value={String(stats.biweekly)} note={`${pct(stats.biweekly)} of quotes`} />
        <Stat label="Avg mowing / yr" value={money(stats.avgAnnual)} note="weekly basis" />
        <Stat label="Very hilly" value={pct(stats.hilly)} note={`push ${pct(stats.push)} · clutter ${pct(stats.clutter)}`} />
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">By lawn size tier</div>
        <div className="space-y-1">
          {config.TIERS.map((_, i) => (stats.tierCounts[i] ? (
            <div key={i} className="flex justify-between text-sm"><span className="text-slate-600">{tierLabel(i, config)}</span><span className="font-mono font-bold">{stats.tierCounts[i]} · {pct(stats.tierCounts[i])}</span></div>
          ) : null))}
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">Quotes by travel zone</div>
        <div className="space-y-1">
          {config.TRAVEL_ZONES.map(z => {
            const c = stats.zoneCounts[z.key] || 0;
            return <div key={z.key} className="flex justify-between text-sm"><span className="text-slate-600">{z.label}</span><span className="font-mono font-bold">{c}</span></div>;
          })}
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">Package attach rate</div>
        <div className="grid grid-cols-4 gap-2">
          {(['bronze', 'silver', 'gold', 'dethatch'] as const).map(k => (
            <div key={k} className="text-center"><div className="text-2xl font-black text-slate-900">{pct(stats.pkg[k])}</div><div className="text-[10px] font-black uppercase tracking-widest text-slate-400 capitalize">{k}</div></div>
          ))}
        </div>
      </div>
    </div>
  );
}

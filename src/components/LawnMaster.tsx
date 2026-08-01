import { useMemo, useState } from 'react';
import { Sprout, RotateCcw, Save, FolderOpen, Trash2, Search, BarChart3, AlertTriangle, SlidersHorizontal } from 'lucide-react';
import { LawnQuote, LawnRateConfigVersion } from '../types';
import {
  LawnConfig, LAWN_CONFIG_V1, resolveLawnConfig,
  resolveTierIndex, tierLabel, priceLawn, LawnPrice, PackagePrice,
  computeSeasonPlan, SeasonPlan, overgrownReductionPct,
} from '../lib/lawnPricing';
import LawnRateSheet from './LawnRateSheet';

const todayYmd = () => new Date().toISOString().slice(0, 10);

// House style.
const GREEN = '#1c4634';
const GOLD = '#cdbd8f';
const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const fmtWhen = (ms?: number) => ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

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
  initial?: { sqft?: number; startDate?: string; overgrownKey?: string };
}

export default function LawnMaster({
  quotes, currentUser, isAdmin, onSave, onDelete,
  isSuperAdmin = false, config = LAWN_CONFIG_V1, activeVersion = 'lawn-v1', configs = {},
  onSaveConfig, onRevertConfig, initial,
}: Props) {
  const [sub, setSub] = useState<'quote' | 'saved' | 'report' | 'rates'>('quote');

  // ── Inputs ───────────────────────────────────────────────────────────────
  const [sqft, setSqft] = useState(initial?.sqft || 0);
  const [veryHilly, setVeryHilly] = useState(false);
  const [pushMow, setPushMow] = useState(false);
  const [clutter, setClutter] = useState(false);
  const [travelZone, setTravelZone] = useState('in_town');
  const [pkgTravel, setPkgTravel] = useState(0);
  const [startDate, setStartDate] = useState(initial?.startDate || todayYmd());  // mid-season start, defaults today
  const [overgrownKey, setOvergrownKey] = useState(initial?.overgrownKey || 'normal'); // catch-up selector
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

  const price = useMemo<LawnPrice | null>(
    () => priceLawn(sqft, { pushMow, veryHilly, clutter, travelZone }, pkgTravel, viewConfig),
    [sqft, pushMow, veryHilly, clutter, travelZone, pkgTravel, viewConfig],
  );
  const tierIdx = resolveTierIndex(sqft, viewConfig);
  // Mid-season plan (mowing only). Discount + proration + deposit + BH.
  const plan = useMemo<SeasonPlan | null>(
    () => price ? computeSeasonPlan(price.mowing, startDate, overgrownKey, viewConfig) : null,
    [price, startDate, overgrownKey, viewConfig],
  );

  const touch = () => setDirty(true);
  const pickTier = (i: number) => {
    touch();
    const t = viewConfig.TIERS[i];
    // Set a sq ft that resolves back to this tier (its upper bound, or one past
    // the previous bound for the open-ended last tier).
    setSqft(t.maxSqFt ?? ((viewConfig.TIERS[i - 1]?.maxSqFt ?? 0) + 1));
  };

  // Travel-zone density — saved quotes per mowing zone.
  const zoneCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const q of Object.values(quotes)) c[q.travelZone] = (c[q.travelZone] || 0) + 1;
    return c;
  }, [quotes]);
  const selectedZoneCount = zoneCounts[travelZone] || 0;
  const zoneWarn = !!price && selectedZoneCount < viewConfig.ZONE_MIN_CLIENTS;

  const clearAll = () => {
    if (price && !window.confirm('Clear the lawn quote and all inputs?')) return;
    setSqft(0); setVeryHilly(false); setPushMow(false); setClutter(false);
    setTravelZone('in_town'); setPkgTravel(0); setStartDate(todayYmd()); setOvergrownKey('normal');
    setFrequency(null); setSelectedPackage(null);
    setName(''); setLoadedId(null); setLoadedVersion(null); setDirty(false);
  };

  const save = () => {
    if (!price || !plan) return;
    const m = price.mowing;
    const sel = selectedPackage ? price.packages.find(p => p.key === selectedPackage) : null;
    const label = name.trim();
    const id = loadedId || `lawn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const q: LawnQuote = {
      id, client: label || undefined,
      sqft, tierIndex: price.tierIndex, tierLabel: m.tierLabel,
      mowingBase: m.weeklyBase, veryHilly, pushMow, clutter, travelZone,
      frequency,
      weeklyAnnual: m.weekly.annual, weeklyMonthly: m.weekly.monthly, weeklyPerCut: m.weekly.perCut,
      biweeklyAnnual: m.biweekly.annual, biweeklyMonthly: m.biweekly.monthly, biweeklyPerCut: m.biweekly.perCut,
      selectedPackage: sel && sel.priced ? sel.key : null,
      packageTravelPerVisit: pkgTravel,
      packageTotal: sel && sel.priced ? sel.total : null,
      // Mid-season plan (mowing only). Season discount + separate catch-up.
      startDate, elapsedWeeks: plan.discount.elapsedWeeks, seasonDiscountPct: plan.discount.seasonDiscountPct,
      overgrownKey, overgrownMultiplier: plan.discount.overgrownMultiplier, catchUpPct: plan.discount.catchUpPct,
      weeklyProrated: plan.weekly.proratedTotal, weeklyInstalments: plan.weekly.instalments,
      weeklyDeposit: plan.weekly.deposit, weeklyCatchUp: plan.weekly.catchUpCharge, weeklyFirstInvoice: plan.weekly.firstInvoice,
      weeklyCutsLeft: plan.weekly.cutsLeft, weeklyBhPerVisit: plan.weekly.bhPerVisit, weeklyFirstVisitBH: plan.weekly.firstVisitBH,
      biweeklyProrated: plan.biweekly.proratedTotal, biweeklyInstalments: plan.biweekly.instalments,
      biweeklyDeposit: plan.biweekly.deposit, biweeklyCatchUp: plan.biweekly.catchUpCharge, biweeklyFirstInvoice: plan.biweekly.firstInvoice,
      biweeklyCutsLeft: plan.biweekly.cutsLeft, biweeklyBhPerVisit: plan.biweekly.bhPerVisit, biweeklyFirstVisitBH: plan.biweekly.firstVisitBH,
      pricingConfigVersion: viewVersion,
      quotedBy: currentUser, quotedAt: Date.now(),
    };
    onSave(q);
    setLoadedId(id); setLoadedVersion(viewVersion); setDirty(false);
  };

  const load = (q: LawnQuote) => {
    setSqft(q.sqft || 0); setVeryHilly(!!q.veryHilly); setPushMow(!!q.pushMow); setClutter(!!q.clutter);
    setTravelZone(q.travelZone || 'in_town'); setPkgTravel(q.packageTravelPerVisit || 0);
    setStartDate(q.startDate || todayYmd()); setOvergrownKey(q.overgrownKey || 'normal');
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

            {/* Lawn size */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Lawn size</div>
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
            </div>

            {/* Terrain / extras */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
              <Toggle label="Very hilly" sub="Terrain — normal vs very hilly" on={veryHilly} onClick={() => { touch(); setVeryHilly(v => !v); }} />
              <Toggle label="Push mow only" sub="Small equipment" on={pushMow} onClick={() => { touch(); setPushMow(v => !v); }} />
              <Toggle label="Clutter" sub="Obstacles to work around" on={clutter} onClick={() => { touch(); setClutter(v => !v); }} />
            </div>

            {/* Mid-season start date + overgrown catch-up (mowing only) */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Start date</span>
                <input type="date" value={startDate} onChange={e => { touch(); setStartDate(e.target.value); }}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold" />
              </div>
              {plan && (
                <div className="text-[11px] text-slate-500">
                  Season {viewConfig.SEASON_START} → {plan.seasonEnd} · week {plan.discount.elapsedWeeks} of {viewConfig.WEEKS_IN_SEASON}
                </div>
              )}
              <div>
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Overgrown catch-up</div>
                <div className="grid grid-cols-5 gap-1.5">
                  {viewConfig.OVERGROWN.map(o => {
                    const on = overgrownKey === o.key;
                    const red = overgrownReductionPct(o.multiplier, viewConfig);
                    return (
                      <button key={o.key} onClick={() => { touch(); setOvergrownKey(o.key); }}
                        className="min-h-[52px] rounded-xl text-[11px] font-black border transition-colors px-1 flex flex-col items-center justify-center leading-tight"
                        style={on ? { backgroundColor: GREEN, color: 'white', borderColor: GREEN } : { backgroundColor: 'white', color: '#334155', borderColor: '#e2e8f0' }}>
                        <span>{o.multiplier}×</span>
                        <span className="opacity-70 text-[9px] font-bold">{red ? `−${red}%` : '—'}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="text-[11px] text-slate-500 mt-1.5">Reduces the season discount to recover catch-up work — the price isn’t adjusted directly.</div>
              </div>
            </div>

            {/* Mowing travel zone + density */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-2">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Mowing travel — from city limits</div>
              <div className="grid grid-cols-2 gap-2">
                {viewConfig.TRAVEL_ZONES.map(z => {
                  const on = travelZone === z.key;
                  const n = zoneCounts[z.key] || 0;
                  return (
                    <button key={z.key} onClick={() => { touch(); setTravelZone(z.key); }}
                      className="min-h-[48px] rounded-xl text-sm font-black border transition-colors px-2 flex items-center justify-between gap-1"
                      style={on ? { backgroundColor: GREEN, color: 'white', borderColor: GREEN } : { backgroundColor: 'white', color: '#334155', borderColor: '#e2e8f0' }}>
                      <span className="text-left leading-tight">{z.label}<span className="block text-[10px] font-bold opacity-70">{z.perVisit ? `$${z.perVisit}/visit` : 'no travel'}</span></span>
                      <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${on ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{n}</span>
                    </button>
                  );
                })}
              </div>
              {zoneWarn && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-[12px] font-bold text-amber-800 flex items-start gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Only {selectedZoneCount} client{selectedZoneCount === 1 ? '' : 's'} in this zone. Travel pricing assumes {viewConfig.ZONE_BREAKEVEN_CLIENTS}. Under {viewConfig.ZONE_MIN_CLIENTS}, decline or quote the true isolated cost — confirm with James.</span>
                </div>
              )}
            </div>

            {/* Package travel per visit */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-2">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Package travel — per visit</div>
              <div className="grid grid-cols-5 gap-1.5">
                {viewConfig.PACKAGE_TRAVEL_PER_VISIT.map(v => (
                  <button key={v} onClick={() => { touch(); setPkgTravel(v); }}
                    className="min-h-[44px] rounded-xl text-sm font-black border transition-colors"
                    style={pkgTravel === v ? { backgroundColor: GREEN, color: 'white', borderColor: GREEN } : { backgroundColor: 'white', color: '#334155', borderColor: '#e2e8f0' }}>
                    {v === 0 ? '$0' : `$${v}`}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-slate-500">$25 in town · $50 within 5 km · $75 within 10 km · $100 beyond</div>
            </div>
          </div>

          {/* ── RIGHT: output ───────────────────────────────────────────── */}
          <div className="space-y-4">
            {!price ? (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-6 text-center">
                <Sprout className="w-8 h-8 mx-auto text-slate-300" />
                <div className="text-sm font-bold text-slate-400 mt-2">Pick a lawn size to price it</div>
              </div>
            ) : (
              <>
                <MowingBlock price={price} config={viewConfig} plan={plan!} frequency={frequency} onFrequency={f => { touch(); setFrequency(cur => cur === f ? null : f); }} />
                <PackageBlock packages={price.packages} selected={selectedPackage} onSelect={k => { touch(); setSelectedPackage(cur => cur === k ? null : k); }} />
              </>
            )}

            <input value={name} onChange={e => setName(e.target.value)} placeholder="Client / address (optional)"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-slate-400" />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={clearAll} className="min-h-[48px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-black uppercase tracking-widest">
                <RotateCcw className="w-4 h-4" /> Clear
              </button>
              <button onClick={save} disabled={!price} className="min-h-[48px] inline-flex items-center justify-center gap-1.5 rounded-xl text-white text-xs font-black uppercase tracking-widest disabled:opacity-40" style={{ backgroundColor: GREEN }}>
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

// ── Mowing block — compact quote cards + shared breakdown + billing + ops ────
function MowingBlock({ price, config, plan, frequency, onFrequency }: {
  price: LawnPrice; config: LawnConfig; plan: SeasonPlan; frequency: 'weekly' | 'biweekly' | null; onFrequency: (f: 'weekly' | 'biweekly') => void;
}) {
  const m = price.mowing;
  const d = plan.discount;
  const overgrown = d.overgrownMultiplier > 1;
  const both = <T,>(w: T, b: T) => `${w} wk / ${b} bw`;

  const cardRow = (sel: boolean, label: string, value: string, internal?: boolean) => (
    <div className={`flex justify-between ${internal ? (sel ? 'text-white/60' : 'text-slate-400') : ''}`}>
      <span>{label}{internal && <span className="block text-[9px] uppercase tracking-widest -mt-0.5">internal · do not quote</span>}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
  const card = (title: string, sel: boolean, f: 'weekly' | 'biweekly', fp: typeof plan.weekly) => (
    <button onClick={() => onFrequency(f)} className="text-left rounded-2xl p-3 shadow-sm border-2 transition-colors w-full"
      style={sel ? { backgroundColor: GREEN, color: 'white', borderColor: GOLD } : { backgroundColor: '#eef4f0', borderColor: '#d5e2da' }}>
      <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: sel ? GOLD : GREEN }}>{title}{sel ? ' · going with' : ''}</div>
      <div className="text-3xl md:text-4xl font-black font-mono leading-none mt-0.5" style={{ color: sel ? 'white' : GREEN }}>{money(fp.proratedTotal)}</div>
      <div className={`text-[11px] font-bold ${sel ? 'text-white/70' : 'text-slate-500'}`}>full {money(fp.fullPrice)} · renewal anchor</div>
      <div className="mt-2 space-y-0.5 text-[12px]">
        {cardRow(sel, 'Monthly', money(fp.monthly))}
        {cardRow(sel, 'Instalments left', String(fp.instalments))}
        {cardRow(sel, 'Cuts left', String(fp.cutsLeft))}
        {cardRow(sel, 'Deposit', money(fp.deposit))}
        {cardRow(sel, 'Internal PPC', money(fp.internalPPC), true)}
      </div>
    </button>
  );
  const billCol = (title: string, fp: typeof plan.weekly) => (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Billing · {fp.instalments} cycle{fp.instalments === 1 ? '' : 's'} left · {title}</div>
      <div className="mt-1.5 space-y-0.5 text-[12px]">
        <Row label="Initial deposit (on approval)" value={money(fp.deposit)} />
        {overgrown && <Row label={`Overgrown catch-up (${d.overgrownLabel})`} value={money(fp.catchUpCharge)} />}
        {fp.billingDates.map(bd => <Row key={bd} label={fmtMD(bd)} value={money(fp.monthly)} />)}
        <div className="flex justify-between border-t border-slate-200 pt-1 mt-1 font-black text-slate-800"><span>Total</span><span className="font-mono">{money(fp.deposit + fp.catchUpCharge + fp.instalments * fp.monthly)}</span></div>
      </div>
    </div>
  );

  return (
    <>
      {/* Quote cards + shared breakdown */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Mowing · {m.tierLabel}</div>
        <div className="grid grid-cols-2 gap-2">
          {card('Weekly', frequency === 'weekly', 'weekly', plan.weekly)}
          {card('Biweekly', frequency === 'biweekly', 'biweekly', plan.biweekly)}
        </div>
        {/* Shared breakdown — once, not per card. */}
        <div className="space-y-0.5 text-[12px] text-slate-600 border-t border-slate-100 pt-2">
          <Row label="Tier base (weekly)" value={money(m.weeklyBase)} />
          {m.extras.pushMow > 0 && <Row label="Push mow only" value={money(m.extras.pushMow)} />}
          {m.extras.veryHilly > 0 && <Row label="Very hilly" value={money(m.extras.veryHilly)} />}
          {m.extras.clutter > 0 && <Row label="Clutter" value={money(m.extras.clutter)} />}
          {m.travel.perVisit > 0 && <Row label={`Travel · ${m.travel.label}`} value={`$${m.travel.perVisit}/visit · ${both(money(m.travel.weeklySeason), money(m.travel.biweeklySeason))}`} />}
          <Row label={`Season discount (week ${d.elapsedWeeks})`} value={`${d.seasonDiscountPct}%`} />
          {overgrown && <Row label={`Overgrown catch-up (${d.overgrownLabel})`} value={both(money(plan.weekly.catchUpCharge), money(plan.biweekly.catchUpCharge))} />}
          <Row label="BH per visit" value={both(bn(plan.weekly.bhPerVisit), bn(plan.biweekly.bhPerVisit))} />
          {overgrown && <Row label="First-visit BH" value={both(bn(plan.weekly.firstVisitBH), bn(plan.biweekly.firstVisitBH))} />}
        </div>
      </div>

      {/* Billing — dated schedule, per frequency side by side */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">Billing schedule</div>
        <div className="grid grid-cols-2 gap-2">
          {billCol('Weekly', plan.weekly)}
          {billCol('Biweekly', plan.biweekly)}
        </div>
      </div>

      {/* Operations — crew-facing */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Operations</div>
        <div className="space-y-0.5 text-[12px] text-slate-600">
          <Row label="Cuts left" value={both(plan.weekly.cutsLeft, plan.biweekly.cutsLeft)} />
          <Row label="BH per visit" value={both(bn(plan.weekly.bhPerVisit), bn(plan.biweekly.bhPerVisit))} />
          {overgrown && <Row label="First-visit BH" value={both(bn(plan.weekly.firstVisitBH), bn(plan.biweekly.firstVisitBH))} />}
        </div>
      </div>
    </>
  );
}

// ── Package block — all packages shown together ─────────────────────────────
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
  const shape = (x: LawnQuote) => `${(x.sqft || 0).toLocaleString('en-US')} sq ft · ${money(x.weeklyAnnual)} / ${money(x.biweeklyAnnual)}`;

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
                    {x.selectedPackage ? `${x.selectedPackage} · ` : ''}{(x.updatedBy || x.quotedBy)?.name || '—'} · {fmtWhen(x.updatedAt || x.quotedAt)}
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
      tierCounts[q.tierIndex] = (tierCounts[q.tierIndex] || 0) + 1;
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
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">Clients by travel zone</div>
        <div className="space-y-1">
          {config.TRAVEL_ZONES.map(z => {
            const c = stats.zoneCounts[z.key] || 0;
            const under = c > 0 && c < config.ZONE_MIN_CLIENTS;
            return <div key={z.key} className="flex justify-between text-sm"><span className="text-slate-600">{z.label}</span><span className={`font-mono font-bold ${under ? 'text-amber-600' : ''}`}>{c}{under ? ` ⚠ under ${config.ZONE_MIN_CLIENTS}` : ''}</span></div>;
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

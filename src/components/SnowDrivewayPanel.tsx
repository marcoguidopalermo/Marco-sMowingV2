// ONE DRIVEWAY'S INPUTS AND PRICE.
//
// Used for the SECOND driveway in both shapes: the other side of a shared
// driveway (two clients, one driveway) and the second driveway on a property
// (one client, two driveways). Each carries its OWN tier, lanes and modifiers,
// because the two genuinely differ — one side may have a boulevard, the other
// may front a busy road.
//
// What it deliberately does NOT own: the map, the measurement or the pin.
// Those belong to the quote, because in both shapes there is one property (or
// one physical driveway) being looked at.
import { Car } from 'lucide-react';
import type { SnowConfig, SnowPrice } from '../lib/snowPricing';
import { activeModifiers, noBoulevardRate } from '../lib/snowPricing';
import AddressAutocompleteInput from './AddressAutocompleteInput';

const GREEN = '#1c4634';
const GOLD = '#cdbd8f';
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export interface DrivewayPanelProps {
  title: string;
  subtitle?: string;
  // Shared driveways have an address per side; a second driveway on one
  // property does not. Pass `address` ALONE to show it read-only, which is
  // what shared mode does now that both addresses are entered at the top of
  // the quote — one editable field per property, and this panel names which
  // property it is pricing without being a second place to change it.
  address?: string;
  onAddress?: (v: string) => void;
  onPickAddress?: (p: { address: string; lat: number; lng: number }) => void;
  grid: number[][];
  onCycle: (r: number, c: number) => void;
  busyRoad: boolean; onBusyRoad: () => void;
  noBoulevard: boolean; onNoBoulevard: () => void;
  danger: number; onDanger: (d: number) => void;
  price: SnowPrice | null;
  config: SnowConfig;
  /** THIS driveway's share of the visit's one premium charge — not the charge.
   *  Premium is priority response on the VISIT, so two driveways split it. */
  premiumAdd: number;
  /** Why that share is not the whole charge, e.g. "half of $200, shared driveway". */
  premiumNote?: string;
  /** Shared driveways trace ONE slab above, so the per-side panel omits a
   *  tracer — two tracers would contradict the single physical driveway. */
  hideTracer?: boolean;
  /** Pricing lives in the quote's pricing column, one card per driveway, so a
   *  panel used purely for INPUT does not repeat it. Two prices for the same
   *  driveway in two places is how they end up disagreeing. */
  hidePricing?: boolean;
}

export default function SnowDrivewayPanel(p: DrivewayPanelProps) {
  const mods = p.price ? activeModifiers(p.price.addBreakdown, p.price, p.config) : [];
  const std = p.price && !p.price.isCustom ? p.price.total! : null;
  const prem = std != null ? std + p.premiumAdd : null;
  const floorStd = p.price && p.price.isCustom ? p.price.floor! : null;

  return (
    <div className="bg-white rounded-2xl border-2 border-slate-200 p-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="text-[11px] font-black uppercase tracking-widest" style={{ color: GREEN }}>{p.title}</div>
        {p.subtitle && <div className="text-[10px] text-slate-400">{p.subtitle}</div>}
      </div>

      {p.onAddress ? (
        <AddressAutocompleteInput
          value={p.address || ''}
          onChange={p.onAddress}
          onPick={(x) => { p.onAddress?.(x.address); p.onPickAddress?.(x); }}
          placeholder="Address for this side"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-semibold outline-none mb-2"
        />
      ) : p.address !== undefined ? (
        /* READ-ONLY. The address is edited once, at the top of the quote, so
           this says WHICH property is being priced without becoming a second
           input bound to the same value. */
        <div className="text-[12px] font-bold text-slate-700 truncate mb-2" title={p.address || undefined}>
          {p.address.trim() || <span className="text-slate-400 italic font-semibold">No address yet</span>}
        </div>
      ) : null}

      {!p.hideTracer && (
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Trace the driveway</div>
      )}
      {!p.hideTracer && (
      <div className="grid grid-cols-4 gap-1.5">
        {p.grid.map((row, r) => row.map((v, c) => (
          <button key={`${r}-${c}`} onClick={() => p.onCycle(r, c)}
            aria-label={`Cell row ${r + 1} column ${c + 1}: ${v === 0 ? 'empty' : v === 1 ? 'spot' : 'drag'}`}
            className="aspect-square rounded-lg flex items-center justify-center transition-colors select-none"
            style={
              v === 1 ? { backgroundColor: GREEN, color: 'white' }
                : v === 2 ? { backgroundColor: '#c9d8cf', color: GREEN, border: `2px dashed ${GREEN}` }
                  : { backgroundColor: '#f1f5f9', border: '2px dashed #cbd5e1', color: '#94a3b8' }
            }>
            {v === 1 && <Car className="w-5 h-5" />}
            {v === 2 && <span className="text-[9px] font-black uppercase tracking-widest">Drag</span>}
          </button>
        )))}
      </div>
      )}
      {!p.hideTracer && <div className="mt-1.5 rounded-full h-2" style={{ backgroundColor: GOLD }} />}
      {!p.hideTracer && <div className="text-center text-[9px] font-black uppercase tracking-widest text-slate-400 mt-1 mb-2">Street</div>}

      <div className="flex flex-wrap gap-1.5 mb-2">
        <button onClick={p.onBusyRoad}
          className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg border ${p.busyRoad ? 'text-white' : 'text-slate-600 border-slate-300'}`}
          style={p.busyRoad ? { backgroundColor: GREEN, borderColor: GREEN } : undefined}>
          Busy road
        </button>
        <button onClick={p.onNoBoulevard}
          title={`−$${noBoulevardRate(p.config)} per lane`}
          className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg border ${p.noBoulevard ? 'text-white' : 'text-slate-600 border-slate-300'}`}
          style={p.noBoulevard ? { backgroundColor: GREEN, borderColor: GREEN } : undefined}>
          No boulevard
        </button>
        {(p.config.DANGER_OPTIONS || []).map(d => (
          <button key={d} onClick={() => p.onDanger(d)}
            className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg border ${p.danger === d ? 'text-white' : 'text-slate-600 border-slate-300'}`}
            style={p.danger === d ? { backgroundColor: GREEN, borderColor: GREEN } : undefined}>
            {d === 0 ? 'No danger' : `+$${d}`}
          </button>
        ))}
      </div>

      {p.hidePricing ? null : p.price ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-slate-200 p-2 text-center">
              <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Standard</div>
              <div className="text-xl font-black" style={{ color: GREEN }}>
                {std != null ? money(std) : `${money(floorStd || 0)}+`}
              </div>
            </div>
            <div className="rounded-xl border-2 p-2 text-center" style={{ borderColor: GOLD }}>
              <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Premium</div>
              <div className="text-xl font-black" style={{ color: GREEN }}>
                {prem != null ? money(prem) : `${money((floorStd || 0) + p.premiumAdd)}+`}
              </div>
              {/* A SHARE, not a charge of its own. Without this the figure is
                  indistinguishable from the full premium. */}
              {p.premiumNote && (
                <div className="text-[9px] font-bold text-slate-400 leading-tight mt-0.5">
                  +{money(p.premiumAdd)} — {p.premiumNote}
                </div>
              )}
            </div>
          </div>
          {/* EVERY modifier, from the price's own breakdown — including the
              driveway discounts, which must never be applied silently. The
              amounts come off the breakdown, so they follow the rate sheet. */}
          {mods.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {mods.map(m => (
                <div key={m.key} className="flex justify-between text-[11px]">
                  <span className="text-slate-600">{m.label}</span>
                  <span className="font-mono font-bold" style={{ color: m.amount < 0 ? '#15803d' : '#b45309' }}>
                    {m.amount < 0 ? '−' : '+'}{money(Math.abs(m.amount))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="text-center text-xs text-slate-400 italic py-2">Trace this driveway to price it</div>
      )}
    </div>
  );
}

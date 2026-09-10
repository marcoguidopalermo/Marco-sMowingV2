import { useMemo, useState } from 'react';
import { Snowflake, RotateCcw, Save, FolderOpen, Trash2, Search, AlertTriangle, BarChart3, Car, SlidersHorizontal, FileText, Map, Eye } from 'lucide-react';
import { SnowQuote, SnowRateConfigVersion, SnowContract } from '../types';
import { encodeGrid, gridOf } from '../lib/snowGrid';
import PropertyMeasureTool from './PropertyMeasureTool';
import StreetViewPanel from './StreetViewPanel';
import AddressAutocompleteInput from './AddressAutocompleteInput';
import SnowDrivewayPanel from './SnowDrivewayPanel';
import SnowSplitTracer from './SnowSplitTracer';
import {
  sharedPairing, sharedDrivewayClause, unpairedSignings, type DrivewayMode,
} from '../lib/snowDriveways';
import type { PropertyMeasurement } from '../types';
import {
  priceSnow, SnowConfig, SNOW_CONFIG_V1, SnowPrice, resolveSnowConfig,
  noBoulevardRate, activeModifiers, breakdownOfSaved,
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
  (q.danger || 0) +
  // The discount is part of the adds, so a saved quote's derived price matches
  // what the estimator saw. Per lane, against the QUOTE'S OWN config version.
  (q.noBoulevard ? -((q.lanes || 0) * noBoulevardRate(cfg)) : 0);
const priceOf = (q: SnowQuote, cfg: SnowConfig): number =>
  q.total ?? Math.max(0, q.basePrice + addsOf(q, cfg));
// THE ADDRESS OF A QUOTE, from whichever field a record actually carries.
//
// There used to be two inputs: `address` at the top, and an older free-text
// label saved as both `name` and `client`. They could disagree — one saved
// record holds name "396 Ray" and address "396 ray boulevard" — so a single
// resolver decides, and every display, search and lookup goes through it.
//
// `address` wins because it is the field the map and Street View resolved
// against, and therefore the one that was checked. Records written before the
// address field existed have none, and fall back to what they do have; nothing
// is lost and nothing on the server had to be rewritten.
export const addressOf = (q: Pick<SnowQuote, 'address' | 'client' | 'name'>): string =>
  (q.address || '').trim() || (q.client || '').trim() || (q.name || '').trim();

// One rendering of the active modifiers, used on the quote and on the saved
// list. Signed and coloured by direction, so a discount never reads as a
// surcharge at a glance.
function ModifierChips({ mods, compact }: {
  mods: { key: string; label: string; amount: number }[]; compact?: boolean;
}) {
  if (mods.length === 0) return null;
  return (
    <div className={`flex flex-wrap ${compact ? 'gap-1' : 'gap-1.5'}`}>
      {mods.map(m => {
        const down = m.amount < 0;
        return (
          <span
            key={m.key}
            className={`inline-flex items-center gap-1 rounded-md border font-bold ${compact ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-1'}`}
            style={down
              ? { backgroundColor: '#eef4f0', borderColor: '#cfe3d8', color: GREEN }
              : { backgroundColor: '#FEF9E7', borderColor: '#F5E6B8', color: '#8A6D1F' }}
          >
            {m.label}
            <span className="font-mono">{down ? '−' : '+'}{money(Math.abs(m.amount))}</span>
          </span>
        );
      })}
    </div>
  );
}

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
  initial?: { grid?: number[][]; premium?: boolean; busyRoad?: boolean; danger?: number; noBoulevard?: boolean };
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
  const [noBoulevard, setNoBoulevard] = useState(!!initial?.noBoulevard);
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
  // THE ADDRESS identifies which driveway this is, so it sits at the top of the
  // quote rather than among the pricing inputs — and seeds the map.
  const [address, setAddress] = useState('');
  // ONE SURFACE, TWO VIEWS. The point the estimator is looking at, handed
  // between the satellite map and Street View so switching keeps the property
  // and the zoom instead of making them back out and re-enter.
  const [mapFocus, setMapFocus] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  // A focus belongs to ONE property. Changing the address abandons it, so the
  // next open resolves the new address rather than reopening the old spot —
  // the same trap as the stale outline below.
  // Coordinates from a PICKED suggestion. Distinct from mapFocus, which the
  // satellite/Street View toggle also writes: this one means "the address
  // resolved to here", and it is what earns a pin.
  const [addressPoint, setAddressPoint] = useState<{ lat: number; lng: number } | null>(null);
  const setAddressAndDropFocus = (v: string) => {
    setAddress(v); setMapFocus(null);
    // Editing the address abandons the point it resolved to — otherwise the
    // pin would sit on the previous property.
    setAddressPoint(null);
  };
  // ── DRIVEWAY SHAPE ───────────────────────────────────────────────────────
  // 'single'  one driveway, one client — the ordinary quote.
  // 'shared'  two clients, ONE physical driveway. Saves TWO linked records.
  // 'multi'   one client, TWO driveways on one property. Saves ONE record.
  // See lib/snowDriveways for why those two are modelled apart.
  const [mode, setMode] = useState<DrivewayMode>('single');
  // The SECOND driveway's own configuration. It carries its own tier, lanes and
  // modifiers because the two sides genuinely differ; it does NOT carry its own
  // map or measurement, because it is one property (multi) or one physical
  // driveway (shared).
  const [grid2, setGrid2] = useState<number[][]>(emptyGrid());
  const [busyRoad2, setBusyRoad2] = useState(false);
  const [danger2, setDanger2] = useState(0);
  const [noBoulevard2, setNoBoulevard2] = useState(false);
  const [address2, setAddress2] = useState('');
  // A POINTER at this quote's SnowContract. Whether it is under contract is
  // read from that contract's status, never stored here — see lib/snowDriveways.
  const [contractId, setContractId] = useState<string | undefined>(undefined);
  // Where the line falls on a shared driveway: columns [0, splitCol) belong to
  // Driveway 1, the rest to Driveway 2. One slab, two owners.
  const [splitCol, setSplitCol] = useState(Math.floor(COLS / 2));
  const [pairedQuoteId, setPairedQuoteId] = useState<string | null>(null);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [streetOpen, setStreetOpen] = useState(false);
  const [measurement, setMeasurement] = useState<PropertyMeasurement | undefined>(undefined);
  // Does the saved outline belong to the address currently typed? Loose
  // comparison, so reformatting an address does not discard a good outline.
  const outlineMatchesAddress = (() => {
    const norm = (v?: string) => (v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const a = norm(measurement?.address); const b = norm(address);
    if (!a || !b) return true;            // nothing to contradict
    return a === b || a.startsWith(b) || b.startsWith(a);
  })();


  // THE PAIRING decides whether the shared discount is real. Derived live from
  // BOTH records on every render, so a partner signing later applies it with no
  // back-dating, no reissue and nothing to remember. `quotes` is a map keyed by
  // id, not a list.
  const pairedQuote = pairedQuoteId ? (quotes[pairedQuoteId] || null) : null;
  const pairing = useMemo(() => sharedPairing(
    {
      id: loadedId || 'draft', contractId,
      sharedDrivewayWith: pairedQuoteId
        ? { quoteId: pairedQuoteId, address: address2.trim(), pairId: '' }
        : undefined,
    } as unknown as SnowQuote,
    pairedQuote,
    snowContracts,
  ), [loadedId, contractId, pairedQuoteId, address2, pairedQuote, snowContracts]);
  const pairingApplies = mode === 'shared' && pairing.discountApplies;
  // ONE SLAB, TWO OWNERS. In shared mode the single traced grid IS the
  // driveway; each side is the columns on its own side of the line, and each is
  // tiered and priced from those cells alone.
  const sliceCols = (g: number[][], from: number, to: number) => g.map(r => r.slice(from, to));
  const gridLeft = mode === 'shared' ? sliceCols(grid, 0, splitCol) : grid;
  const gridRight = mode === 'shared' ? sliceCols(grid, splitCol, COLS) : grid2;

  // Standard price (no premium). The Premium column adds config.PREMIUM on top.
  const price = useMemo<SnowPrice | null>(
    () => priceSnow(
      gridLeft,
      {
        premium: false, busyRoad, danger, noBoulevard,
        // Driveway 1 takes the discount on the same terms as driveway 2.
        sharedDriveway: mode === 'shared' && pairingApplies,
        secondDriveway: mode === 'multi',
      },
      viewConfig, viewVersion,
    ),
    [gridLeft, busyRoad, danger, noBoulevard, mode, pairingApplies, viewConfig, viewVersion],
  );
  // Shared: conditional. Multi: unconditional — one payer, one trip.
  const sharedOn = pairingApplies;
  const secondOn = mode === 'multi';
  const price2 = useMemo<SnowPrice | null>(
    () => (mode === 'single' ? null : priceSnow(
      gridRight,
      {
        premium: false, busyRoad: busyRoad2, danger: danger2, noBoulevard: noBoulevard2,
        sharedDriveway: sharedOn, secondDriveway: secondOn,
      },
      viewConfig, viewVersion,
    )),
    [mode, gridRight, busyRoad2, danger2, noBoulevard2, sharedOn, secondOn, viewConfig, viewVersion],
  );
  // From the price's own breakdown — never a separate reading of the toggles.
  const liveMods = price ? activeModifiers(price.addBreakdown, price, viewConfig) : [];
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
  const editNoBoulevard = () => { setDirty(true); setNoBoulevard(v => !v); };
  const editDanger = (d: number) => { setDirty(true); setDanger(d); };

  // A FRESH QUOTE — grid, every modifier, address and outline. Modifiers are
  // reset explicitly because a surcharge inherited from the last driveway is
  // worse than one forgotten: it prices work nobody agreed to, and it looks
  // deliberate.
  const clearAll = (opts?: { silent?: boolean }) => {
    if (!opts?.silent && price && !window.confirm('Start a new quote? The traced driveway and all modifiers are cleared.')) return;
    setGrid(emptyGrid()); setBusyRoad(false); setDanger(0); setNoBoulevard(false);
    setAddress(''); setMapFocus(null); setAddressPoint(null); setMeasurement(undefined);
    setMode('single'); setGrid2(emptyGrid()); setBusyRoad2(false); setDanger2(0);
    setNoBoulevard2(false); setAddress2(''); setContractId(undefined); setPairedQuoteId(null);
    setSplitCol(Math.floor(COLS / 2));
    setLoadedId(null); setLoadedVersion(null); setDirty(false);
  };

  // One tap, no blocking dialog — the report is only useful if estimators
  // actually save, so there's zero friction. Name is optional. The quote stamps
  // the version it was priced under (viewVersion).
  const save = () => {
    if (!price) return;
    // ONE SOURCE. name and client are still written so the saved list, the
    // search and every existing reader keep working — they are derived from
    // the address field, not entered separately.
    const label = address.trim();
    const wasNew = !loadedId;
    const id = loadedId || `snow-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const q: SnowQuote = {
      id, name: label, client: label || undefined,
      // Encoded to strings: Firestore refuses an array inside an array, which
      // is why nothing saved before. See lib/snowGrid.
      gridRows: encodeGrid(gridLeft),
      lanes: price.lanes, depth: price.depth, cars: price.cars, dragCount: price.dragCount,
      tier: price.tier, basePrice: price.basePrice,
      // Premium is no longer a toggle: the Standard price is the base, and BOTH
      // totals are recorded. `total` keeps its meaning (Standard total / null for
      // custom); `premiumTotal` is new. `premium: false` since Standard is base.
      premium: false, busyRoad, danger, noBoulevard,
      sharedDriveway: pairingApplies || undefined,
      address: label || undefined,
      measurement,
      total: stdTotal, premiumTotal: premTotal, isCustom: price.isCustom,
      pricingConfigVersion: viewVersion,
      // The ORIGINAL quoter is preserved when re-saving a loaded quote; App
      // stamps updatedBy/updatedAt. With several people quoting residential
      // snow, a quote nobody can attribute is a quote nobody can ask about.
      quotedBy: loaded?.quotedBy || currentUser,
      quotedAt: loaded?.quotedAt || Date.now(),
    };
    // ── MULTI: ONE record, both driveways ────────────────────────────────
    // One client, one contract, one payer — so one record. The second
    // driveway's own tier and modifiers ride along in `driveways`.
    if (mode === 'multi' && price2) {
      q.driveways = [
        {
          id: `${id}-d1`, label: 'Driveway 1', gridRows: encodeGrid(grid),
          busyRoad, danger, noBoulevard, measurement,
        },
        {
          id: `${id}-d2`, label: 'Driveway 2', gridRows: encodeGrid(grid2),
          busyRoad: busyRoad2, danger: danger2, noBoulevard: noBoulevard2,
        },
      ];
      q.secondDriveway = true;
      // The record's headline totals cover BOTH driveways, because that is what
      // this client pays.
      q.total = stdTotal != null && price2.total != null ? stdTotal + price2.total : null;
      q.premiumTotal = q.total != null ? q.total + premiumAdd * 2 : null;
      onSave(q);
      if (wasNew) { clearAll({ silent: true }); return; }
      setLoadedId(id); setLoadedVersion(viewVersion); setDirty(false);
      return;
    }

    // ── SHARED: TWO records, linked ──────────────────────────────────────
    // Two clients, two contracts, two properties, two sets of liability.
    // Merging them would model a relationship that does not exist: neither
    // client is party to the other's contract, and either can leave without
    // the other. The pairing is a LINK, and the discount is derived from both
    // records' signed state rather than stored on either.
    if (mode === 'shared' && price2) {
      const pairId = loaded?.sharedDrivewayWith?.pairId
        || `pair-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const otherId = pairedQuoteId
        || `snow-${Date.now() + 1}-${Math.random().toString(36).slice(2, 6)}`;
      const addr2 = address2.trim();
      q.sharedDrivewayWith = { quoteId: otherId, address: addr2, pairId };
      q.sharedDriveway = pairingApplies;
      q.contractId = contractId;
      // The split is a property of the SLAB, so both records carry it.
      q.splitCol = splitCol;
      const side2: SnowQuote = {
        id: otherId, name: addr2, client: addr2 || undefined,
        gridRows: encodeGrid(gridRight),
        lanes: price2.lanes, depth: price2.depth, cars: price2.cars, dragCount: price2.dragCount,
        tier: price2.tier, basePrice: price2.basePrice,
        premium: false, busyRoad: busyRoad2, danger: danger2, noBoulevard: noBoulevard2,
        address: addr2 || undefined,
        // ONE physical driveway — the measurement and the pin are shared, so
        // both records carry the same outline.
        measurement,
        total: price2.isCustom ? null : price2.total,
        premiumTotal: price2.isCustom || price2.total == null ? null : price2.total + premiumAdd,
        isCustom: price2.isCustom,
        pricingConfigVersion: viewVersion,
        sharedDrivewayWith: { quoteId: id, address: label, pairId },
        sharedDriveway: pairingApplies,
        contractId: pairedQuote?.contractId,
        splitCol,
        quotedBy: pairedQuote?.quotedBy || currentUser,
        quotedAt: pairedQuote?.quotedAt || Date.now(),
      };
      onSave(q);
      onSave(side2);
      setPairedQuoteId(otherId);
      if (wasNew) { clearAll({ silent: true }); return; }
      setLoadedId(id); setLoadedVersion(viewVersion); setDirty(false);
      return;
    }

    onSave(q);
    // A NEW quote resets to a blank canvas: nothing is inherited by the next
    // driveway, and a second Save cannot silently overwrite the one just made.
    // EDITING a loaded quote stays loaded, so an immediate correction updates
    // the same record rather than creating a duplicate.
    if (wasNew) { clearAll({ silent: true }); return; }
    setLoadedId(id); setLoadedVersion(viewVersion); setDirty(false);
  };

  const load = (q: SnowQuote) => {
    // gridOf() reads the string form and the legacy number[][] alike, so a
    // quote restored by hand still opens.
    const g = gridOf(q);
    setGrid(g.length ? g.map(r => [...r]) : emptyGrid());
    setBusyRoad(!!q.busyRoad); setDanger(q.danger || 0);
    setNoBoulevard(!!q.noBoulevard);
    setAddress(addressOf(q)); setMapFocus(null); setAddressPoint(null);
    // Restore the driveway SHAPE. A shared quote reopens with its partner's
    // side loaded from the partner RECORD, not from a copy on this one — the
    // link is the only thing stored, so the two can never disagree.
    setContractId(q.contractId);
    if (q.sharedDrivewayWith?.quoteId) {
      const other = quotes[q.sharedDrivewayWith.quoteId];
      setMode('shared');
      setPairedQuoteId(q.sharedDrivewayWith.quoteId);
      setAddress2(q.sharedDrivewayWith.address || other?.address || '');
      const og = other ? gridOf(other) : [];
      setGrid2(og.length ? og.map(r => [...r]) : emptyGrid());
      setBusyRoad2(!!other?.busyRoad); setDanger2(other?.danger || 0);
      setNoBoulevard2(!!other?.noBoulevard);
    } else if ((q.driveways?.length || 0) > 1) {
      const d2 = q.driveways![1];
      setMode('multi'); setPairedQuoteId(null); setAddress2('');
      const g2 = gridOf({ gridRows: d2.gridRows } as SnowQuote);
      setGrid2(g2.length ? g2.map(r => [...r]) : emptyGrid());
      setBusyRoad2(!!d2.busyRoad); setDanger2(d2.danger || 0); setNoBoulevard2(!!d2.noBoulevard);
    } else {
      setMode('single'); setPairedQuoteId(null); setAddress2(''); setGrid2(emptyGrid());
      setBusyRoad2(false); setDanger2(0); setNoBoulevard2(false);
    }
    setMeasurement(q.measurement);
    setLoadedId(q.id);
    setLoadedVersion(q.pricingConfigVersion || 'snow-v1'); setDirty(false);
    setSub('quote');
  };

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
        <div className="space-y-4">
          {/* ── DRIVEWAY SHAPE ─────────────────────────────────────────────
                Two cases that both take $100 off per driveway and are
                otherwise nothing alike. SHARED saves two linked records;
                TWO DRIVEWAYS saves one. See lib/snowDriveways. ───────── */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
            <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">
              Driveway shape
            </div>
            <div className="flex flex-wrap gap-1.5">
              {([
                ['single', 'One driveway', 'A single driveway for one client.'],
                ['shared', 'Shared driveway', 'Two clients, ONE physical driveway. Saves two linked quotes; $100 off each once BOTH sign.'],
                ['multi', 'Two driveways', 'One client, two driveways on the property. One quote; $100 off each, unconditionally.'],
              ] as const).map(([m, lbl, tip]) => (
                <button key={m} title={tip}
                  onClick={() => { setDirty(true); setMode(m); }}
                  className={`text-xs font-bold px-3 py-2 rounded-lg border ${mode === m ? 'text-white' : 'text-slate-600 border-slate-300'}`}
                  style={mode === m ? { backgroundColor: GREEN, borderColor: GREEN } : undefined}>
                  {lbl}
                </button>
              ))}
            </div>
            {mode === 'shared' && (
              <div className="mt-2 text-[11px] text-slate-600">
                Two clients, one driveway. <b>Two separate quote records</b> are saved and linked —
                two contracts, two properties, two sets of liability. The $100 discount applies to
                each side only while <b>both</b> are under contract.
              </div>
            )}
            {mode === 'multi' && (
              <div className="mt-2 text-[11px] text-slate-600">
                One client, two driveways, one trip. <b>One quote record.</b> $100 off each
                driveway, unconditionally — there is only one payer.
              </div>
            )}
          </div>

          {/* ── ADDRESS — first, and full width. It is what identifies WHICH
                driveway this is; a price with no address is a price nobody can
                match to a property. The map opens from it. ─────────────── */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
            <label className="block text-[11px] font-black uppercase tracking-widest text-slate-500 mb-1">
              Property address
            </label>
            <div className="flex gap-2">
              <AddressAutocompleteInput
                value={address}
                onChange={(t) => { setDirty(true); setAddressAndDropFocus(t); }}
                // A CHOSEN suggestion carries its coordinates, so the map opens
                // on them directly — no second lookup, and nothing for the
                // un-geocodable path to catch. Typed text still falls through
                // to resolveAddressPoint and its banner.
                onPick={(p) => {
                  setDirty(true);
                  setAddress(p.address);
                  setMapFocus({ lat: p.lat, lng: p.lng, zoom: 19 });
                  setAddressPoint({ lat: p.lat, lng: p.lng });
                }}
                placeholder="123 Example St, Thunder Bay"
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-base font-semibold outline-none"
              />
              <button
                onClick={() => { setMapFocus(null); setMeasureOpen(true); }}
                title="Open the satellite view on this property"
                className="min-h-[44px] px-3 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1.5 text-sm font-bold"
              >
                <Map className="w-4 h-4" /> Satellite
              </button>
              {/* Two views of the same address, one button each. For snow the
                  kerbside view is usually the more useful: it shows the
                  approach, whether there is a boulevard, the clearance and the
                  slope — the things the price actually turns on. */}
              <button
                onClick={() => { setMapFocus(null); setStreetOpen(true); }}
                disabled={!address.trim() && !measurement}
                title="Open Street View on this property"
                className="min-h-[44px] px-3 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1.5 text-sm font-bold disabled:opacity-40"
              >
                <Eye className="w-4 h-4" /> Street
              </button>
            </div>
            {measurement && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {measurement.totalSqft > 0 && (
                  // REFERENCE ONLY, and labelled so nobody later reads it as an
                  // input. Stored so that after a season we can put measured
                  // area against actual service time on the same properties and
                  // find out whether the lane/tier model prices big driveways
                  // correctly. That analysis is impossible on unmeasured work.
                  <span
                    className="text-[11px] font-bold px-2 py-1 rounded border border-slate-200 bg-slate-50 text-slate-600"
                    title="Measured from the satellite outline. Reference only — snow pricing uses lanes and depth from the traced grid, never area."
                  >
                    {Math.round(measurement.totalSqft).toLocaleString()} sq ft
                    <span className="ml-1 font-medium text-slate-400 uppercase tracking-wide">reference only · not priced</span>
                  </span>
                )}
                {measurement.address && (
                  <span className="text-[11px] text-slate-400">
                    Outline saved for {measurement.address}
                    {measurement.polygons?.length ? ` · ${measurement.polygons.length} shape${measurement.polygons.length === 1 ? '' : 's'}` : ''}
                  </span>
                )}
              </div>
            )}
          </div>

        <div className="grid md:grid-cols-2 gap-4 items-start">
          {/* ── LEFT: tracer + inputs ─────────────────────────────────────── */}
          <div className="space-y-4">
            {loadedId && (
              <div className="rounded-lg px-3 py-1.5"
                style={{ backgroundColor: '#eef4f0', color: GREEN }}>
                <div className="text-[12px] font-bold flex items-center gap-1.5">
                  <FolderOpen className="w-3.5 h-3.5" /> Editing saved shape{address.trim() ? `: ${address.trim()}` : ''}
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
            {/* ONE DRIVEWAY — the ordinary tracer. The shared and two-driveway
                shapes replace it below with layouts that match what is on the
                ground, rather than stacking a small box under a larger one. */}
            {mode === 'single' && (
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
            )}

            {/* SHARED — ONE tracer with a line down it. Left of the line is
                Driveway 1, right is Driveway 2. See SnowSplitTracer. */}
            {mode === 'shared' && (
              <SnowSplitTracer
                grid={grid} cols={COLS} splitCol={splitCol}
                onSplit={(c) => { setDirty(true); setSplitCol(c); }}
                onCycle={cycle}
                label1={address.trim() || 'Driveway 1'}
                label2={address2.trim() || 'Driveway 2'}
              />
            )}

            {/* TWO DRIVEWAYS — two tracers SIDE BY SIDE, equal size, as peers.
                Two separate driveways on one lot are two equal things. */}
            {mode === 'multi' && (
              <div className="grid grid-cols-2 gap-3">
                <SnowDrivewayPanel
                  hidePricing
                  title="Driveway 1" subtitle="same quote"
                  grid={grid} onCycle={cycle}
                  busyRoad={busyRoad} onBusyRoad={editBusyRoad}
                  noBoulevard={noBoulevard} onNoBoulevard={editNoBoulevard}
                  danger={danger} onDanger={editDanger}
                  price={price} config={viewConfig} premiumAdd={premiumAdd}
                />
                <SnowDrivewayPanel
                  hidePricing
                  title="Driveway 2" subtitle="same quote"
                  grid={grid2}
                  onCycle={(r, c) => {
                    setDirty(true);
                    setGrid2(g => g.map((row, i) => i === r ? row.map((v, j) => j === c ? (v + 1) % 3 : v) : row));
                  }}
                  busyRoad={busyRoad2} onBusyRoad={() => { setDirty(true); setBusyRoad2(b => !b); }}
                  noBoulevard={noBoulevard2} onNoBoulevard={() => { setDirty(true); setNoBoulevard2(v => !v); }}
                  danger={danger2} onDanger={(d) => { setDirty(true); setDanger2(d); }}
                  price={price2} config={viewConfig} premiumAdd={premiumAdd}
                />
              </div>
            )}

            {/* Inputs — Premium is no longer here; it's shown as its own column
                in the readout, always, so it can be quoted without a tap. */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
              <Toggle label="Busy road" sub="Main-road frontage" on={busyRoad} onClick={editBusyRoad} />
              <Toggle
                label="No boulevard"
                sub={price ? `−$${noBoulevardRate(viewConfig)} × ${price.lanes} lane${price.lanes === 1 ? '' : 's'}` : `−$${noBoulevardRate(viewConfig)} per lane`}
                on={noBoulevard}
                onClick={editNoBoulevard}
              />
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
            {/* ── PRICING, PER DRIVEWAY ────────────────────────────────────
                Every driveway on this quote prices HERE, one under the other,
                each with its own address, tier, Standard/Premium and its own
                discount lines. The prices used to sit apart from each other —
                one here and the others at the bottom — which meant comparing
                two sides of a shared driveway involved scrolling between them
                and doing the arithmetic yourself. */}
            <DrivewayPricingCard
              title={mode === 'single' ? null
                : (address.trim() || (mode === 'shared' ? 'Driveway 1 — left of the line' : 'Driveway 1'))}
              subtitle={mode === 'shared' ? 'own quote record' : mode === 'multi' ? 'same quote' : null}
              price={price} config={viewConfig} premiumAdd={premiumAdd}
              mods={liveMods}
            />
            {mode !== 'single' && (
              <DrivewayPricingCard
                title={address2.trim() || (mode === 'shared' ? 'Driveway 2 — right of the line' : 'Driveway 2')}
                subtitle={mode === 'shared' ? 'own quote record' : 'same quote'}
                price={price2} config={viewConfig} premiumAdd={premiumAdd}
                mods={price2 ? activeModifiers(price2.addBreakdown, price2, viewConfig) : []}
                pendingNote={mode === 'shared' && !pairing.discountApplies
                  ? `$100 shared-driveway discount not applied — ${pairing.state === 'one-sided' ? 'only one side is under contract.' : 'pending both contracts.'}`
                  : null}
              />
            )}

            {/* COMBINED — the figure for the phone call, directly under the two
                it is made of. The records saved are still two (shared) or one
                (multi); this is a talking total, not a third price. */}
            {mode !== 'single' && price && price2 && !price.isCustom && !price2.isCustom && (
              <div className="rounded-2xl p-4 text-white" style={{ backgroundColor: GREEN }}>
                <div className="text-[10px] font-black uppercase tracking-widest opacity-70">
                  {mode === 'shared' ? 'Both properties combined' : 'Both driveways combined'}
                </div>
                <div className="flex justify-between items-baseline mt-1">
                  <span className="text-sm">Standard</span>
                  <span className="text-2xl font-black">{money((price.total || 0) + (price2.total || 0))}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-sm opacity-80">Premium</span>
                  <span className="text-lg font-black" style={{ color: GOLD }}>
                    {money((price.total || 0) + (price2.total || 0) + premiumAdd * 2)}
                  </span>
                </div>
                <div className="text-[10px] mt-1 opacity-70">
                  {mode === 'shared'
                    ? 'Two separate quotes will be saved — one per client.'
                    : 'One quote record covering both driveways.'}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => clearAll()}
                className="min-h-[48px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-black uppercase tracking-widest">
                <RotateCcw className="w-4 h-4" /> New quote
              </button>
              <button onClick={save} disabled={!price}
                className="min-h-[48px] inline-flex items-center justify-center gap-1.5 rounded-xl text-white text-xs font-black uppercase tracking-widest disabled:opacity-40"
                style={{ backgroundColor: GREEN }}>
                <Save className="w-4 h-4" /> {loadedId ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* ── THE SECOND DRIVEWAY ────────────────────────────────────────────
            Its own tier, lanes and modifiers — the two sides genuinely differ.
            NOT its own map: shared is one physical driveway, multi is one
            property, so the measurement and the pin are shared either way. */}
      {mode !== 'single' && (
        <div className="max-w-3xl mx-auto w-full px-3 pb-3 space-y-3">
          {mode === 'shared' && (
            <div className={`rounded-xl border-2 px-3 py-2 text-[12px] ${
              pairing.needsAttention
                ? 'bg-amber-50 border-amber-400 text-amber-900'
                : pairing.discountApplies
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : 'bg-slate-50 border-slate-300 text-slate-700'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                {pairing.needsAttention && <AlertTriangle className="w-4 h-4 shrink-0" />}
                <b className="uppercase tracking-widest text-[10px]">
                  {pairing.state === 'active' ? 'Discount active'
                    : pairing.state === 'one-sided' ? 'Only one side signed'
                      : 'Discount pending'}
                </b>
                <span>{pairing.message}</span>
              </div>
              {/* LINK THE CONTRACT, do not restate its status. Whether this
                  side is under contract is read from the contract itself, so
                  moving a contract to booked (or back out) changes the discount
                  with no second field to keep in step. */}
              <div className="mt-2 flex flex-wrap gap-2 items-center">
                <label className="text-[11px] font-bold text-slate-600">This side's contract</label>
                <select
                  value={contractId || ''}
                  onChange={e => { setDirty(true); setContractId(e.target.value || undefined); }}
                  className="text-[11px] border border-slate-300 rounded-lg px-2 py-1.5 bg-white max-w-[16rem]">
                  <option value="">— none linked —</option>
                  {Object.values(snowContracts || {}).map(c => (
                    <option key={c.id} value={c.id}>
                      {c.client?.serviceAddress || c.client?.businessName || c.id} · {c.status}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-slate-500">
                  Other side: {pairing.partnerSigned ? 'under contract' : 'not under contract'}
                </span>
              </div>
              {address2.trim() && (
                <div className="mt-2 text-[11px] italic text-slate-600">
                  Contract wording: “{sharedDrivewayClause(address2.trim())}”
                </div>
              )}
            </div>
          )}

          {/* THE TWO SIDES, as equal peers. No tracer here: the slab is traced
              once above, and two tracers would contradict the one driveway
              that is actually there. Each side keeps its own address, its own
              modifiers and its own price. */}
          {mode === 'shared' && (
            <div className="grid grid-cols-2 gap-3">
              <SnowDrivewayPanel
                hideTracer hidePricing
                title="Driveway 1 — left of the line"
                subtitle="own quote record"
                address={address}
                onAddress={(v) => { setDirty(true); setAddressAndDropFocus(v); }}
                grid={gridLeft} onCycle={() => {}}
                busyRoad={busyRoad} onBusyRoad={editBusyRoad}
                noBoulevard={noBoulevard} onNoBoulevard={editNoBoulevard}
                danger={danger} onDanger={editDanger}
                price={price} config={viewConfig} premiumAdd={premiumAdd}
                pendingNote={!pairing.discountApplies
                  ? `$100 shared-driveway discount not applied — ${pairing.state === 'one-sided' ? 'only one side is under contract.' : 'pending both contracts.'}`
                  : null}
              />
              <SnowDrivewayPanel
                hideTracer hidePricing
                title="Driveway 2 — right of the line"
                subtitle="own quote record"
                address={address2}
                onAddress={(v) => { setDirty(true); setAddress2(v); }}
                grid={gridRight} onCycle={() => {}}
                busyRoad={busyRoad2} onBusyRoad={() => { setDirty(true); setBusyRoad2(b => !b); }}
                noBoulevard={noBoulevard2} onNoBoulevard={() => { setDirty(true); setNoBoulevard2(v => !v); }}
                danger={danger2} onDanger={(d) => { setDirty(true); setDanger2(d); }}
                price={price2} config={viewConfig} premiumAdd={premiumAdd}
                pendingNote={!pairing.discountApplies
                  ? `$100 shared-driveway discount not applied — ${pairing.state === 'one-sided' ? 'only one side is under contract.' : 'pending both contracts.'}`
                  : null}
              />
            </div>
          )}

          {/* The combined total moved UP, into the pricing column directly
              under the two prices it is made of. It used to sit here, three
              screens away from one of them. */}
        </div>
      )}

      {/* THE SHARED TOOL, not a second one. Same component LawnMaster and the
          snow contract builder use, with the snow palette. Interactive Maps
          JavaScript API — no Static API needed here, that is only the printed
          contract map. */}
      {measureOpen && (
        <PropertyMeasureTool
          palette="snow"
          currentUser={currentUser}
          focus={mapFocus}
          addressPoint={addressPoint}
          onSwitchToStreet={(f) => { setMapFocus(f); setMeasureOpen(false); setStreetOpen(true); }}
          // The saved outline is only re-rendered when it belongs to the
          // address currently in the field. Change the address and the tool
          // opens on the NEW property rather than the old outline.
          initial={outlineMatchesAddress ? (measurement || null) : null}
          initialAddress={address.trim() || undefined}
          onClose={() => setMeasureOpen(false)}
          onUse={(m) => {
            setDirty(true);
            setMeasurement(m);
            // The tool resolves the address it actually landed on — take it, so
            // a typo corrected on the map corrects the quote too.
            if (m.address) setAddress(m.address);
            setMeasureOpen(false);
          }}
        />
      )}

      {streetOpen && (
        <StreetViewPanel
          address={address}
          measurement={measurement}
          focus={mapFocus}
          onSwitchToMap={(f) => { setMapFocus(f); setStreetOpen(false); setMeasureOpen(true); }}
          onClose={() => setStreetOpen(false)}
        />
      )}

      {sub === 'saved' && (
        <SavedSnowQuotes quotes={quotes} contracts={snowContracts} currentUser={currentUser} isAdmin={isAdmin} versionMap={versionMap} onOpen={load} onDelete={onDelete} />
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

// Shared by the quote body and every per-driveway pricing card.
const chip = (label: string, value: number | string) => (
  <div className="flex-1 min-w-[64px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-center">
    <div className="text-2xl font-black text-slate-900 leading-none">{value}</div>
    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">{label}</div>
  </div>
);

// ── ONE DRIVEWAY'S PRICE, IN FULL ───────────────────────────────────────────
// Standard + Premium, the shape, every applied modifier, and a line-by-line
// breakdown. Rendered once per driveway on the quote, stacked, so two sides of
// a shared driveway can be read against each other without scrolling between
// them.
//
// EVERY REDUCTION GETS A LABELLED LINE — no-boulevard with its per-lane
// arithmetic, and the flat $100 shared / second-driveway discounts. A price
// reduction that is not on a line is one applied silently, and the whole point
// of this panel is that nobody has to do the arithmetic to find it.
function DrivewayPricingCard({
  title, subtitle, price, config, premiumAdd, mods, pendingNote,
}: {
  title: string | null;
  subtitle?: string | null;
  price: SnowPrice | null;
  config: SnowConfig;
  premiumAdd: number;
  mods: { key: string; label: string; amount: number }[];
  pendingNote?: string | null;
}) {
  const std = price && !price.isCustom ? price.total! : null;
  const prem = std != null ? std + premiumAdd : null;
  const floorStd = price && price.isCustom ? price.floor! : null;
  const floorPrem = floorStd != null ? floorStd + premiumAdd : null;
  return (
    <div className="space-y-3">
      {title && (
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[11px] font-black uppercase tracking-widest truncate" style={{ color: GREEN }}>{title}</div>
          {subtitle && <div className="text-[10px] text-slate-400 shrink-0">{subtitle}</div>}
        </div>
      )}
      <PriceReadout price={price} premiumAdd={premiumAdd}
        stdTotal={std} premTotal={prem} stdFloor={floorStd} premFloor={floorPrem} />
      {price && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Shape</div>
          <div className="flex gap-2">
            {chip('Lanes', price.lanes)}
            {chip('Depth', price.depth)}
            {chip('Cars', price.cars)}
            {chip('Drag', price.dragCount)}
          </div>

          {/* Derived from the SAME breakdown the total is computed from, so the
              two cannot disagree. Nothing that is off appears at all. */}
          {mods.length > 0 && (
            <div className="pt-1">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Applied · {mods.length}
              </div>
              <ModifierChips mods={mods} />
            </div>
          )}

          <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 pt-1">Breakdown</div>
          <div className="space-y-1 text-sm">
            <Row label={price.isCustom ? 'Custom floor' : `Tier ${price.tier} base`} value={money(price.basePrice)} />
            {price.addBreakdown.drag > 0 && <Row label={`Drag × ${price.dragCount} @ $${config.DRAG_RATE}`} value={money(price.addBreakdown.drag)} />}
            {price.addBreakdown.busyRoad > 0 && <Row label="Busy road" value={money(price.addBreakdown.busyRoad)} />}
            {price.addBreakdown.danger > 0 && <Row label="Danger" value={money(price.addBreakdown.danger)} />}
            {price.addBreakdown.noBoulevard !== 0 && (
              <div className="flex justify-between" style={{ color: GREEN }}>
                <span>No boulevard — {price.addBreakdown.noBoulevardLanes} lane{price.addBreakdown.noBoulevardLanes === 1 ? '' : 's'} × ${noBoulevardRate(config)}</span>
                <span className="font-mono font-bold">−{money(Math.abs(price.addBreakdown.noBoulevard))}</span>
              </div>
            )}
            {price.addBreakdown.sharedDriveway !== 0 && (
              <div className="flex justify-between" style={{ color: GREEN }}>
                <span>Shared driveway — both properties under contract</span>
                <span className="font-mono font-bold">−{money(Math.abs(price.addBreakdown.sharedDriveway))}</span>
              </div>
            )}
            {price.addBreakdown.secondDriveway !== 0 && (
              <div className="flex justify-between" style={{ color: GREEN }}>
                <span>Second driveway on the property</span>
                <span className="font-mono font-bold">−{money(Math.abs(price.addBreakdown.secondDriveway))}</span>
              </div>
            )}
            <div className="flex justify-between border-t-2 border-slate-200 pt-1.5 mt-1 font-bold text-slate-700">
              <span className="uppercase tracking-widest text-[12px] text-slate-500 self-center">{price.isCustom ? 'Standard floor' : 'Standard total'}</span>
              <span className="text-base font-mono">{money(price.isCustom ? floorStd! : std!)}</span>
            </div>
            <div className="flex justify-between font-black text-slate-900">
              <span className="uppercase tracking-widest text-[12px] self-center" style={{ color: GREEN }}>{price.isCustom ? 'Premium floor' : 'Premium total'} <span className="text-slate-400 font-bold normal-case tracking-normal">(+{money(premiumAdd)})</span></span>
              <span className="text-lg font-mono">{money(price.isCustom ? floorPrem! : prem!)}</span>
            </div>
          </div>
          {/* Why a discount is NOT on the lines above, when one is pending. */}
          {pendingNote && (
            <div className="text-[11px] rounded-lg px-2.5 py-1.5 bg-amber-50 text-amber-900 border border-amber-200">
              {pendingNote}
            </div>
          )}
        </div>
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
function SavedSnowQuotes({ quotes, contracts, currentUser, isAdmin, versionMap, onOpen, onDelete }: {
  quotes: Record<string, SnowQuote>; currentUser: { email: string; name: string }; isAdmin: boolean;
  /** The source of truth for "under contract". Never copied onto a quote. */
  contracts: Record<string, SnowContract>;
  versionMap: Record<string, { version: string; config: SnowConfig }>;
  onOpen: (q: SnowQuote) => void; onDelete: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return Object.values(quotes)
      // Search the RESOLVED address plus the legacy fields, so a record that
      // predates the address field is still findable by what it does carry.
      .filter(x => !s || `${addressOf(x)} ${x.name || ''} ${x.client || ''}`.toLowerCase().includes(s))
      .sort((a, b) => (b.updatedAt || b.quotedAt || 0) - (a.updatedAt || a.quotedAt || 0));
  }, [quotes, search]);
  const canDelete = (x: SnowQuote) => isAdmin || (x.quotedBy?.email || '').toLowerCase() === currentUser.email.toLowerCase();

  // ONE SIDE SIGNED, THE OTHER NOT. The case that costs money if nobody
  // notices: we clear the whole driveway for one payer, and if the discount
  // were applied they would be paying $100 LESS for it. It is withheld
  // automatically, so this surface exists to get the second signature — and to
  // say plainly that the discount lands the moment it arrives.
  const flagged = useMemo(() => unpairedSignings(Object.values(quotes), contracts), [quotes, contracts]);

  return (
    <div className="space-y-3">
      {flagged.length > 0 && (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-amber-900 mb-1">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <b className="text-[11px] uppercase tracking-widest">
              {flagged.length} shared driveway{flagged.length === 1 ? '' : 's'} with only one side signed
            </b>
          </div>
          <div className="text-[12px] text-amber-900 mb-2">
            The $100 discount is withheld on these until both properties are under contract.
            It applies automatically as soon as the second one signs — nothing to re-issue.
          </div>
          <div className="space-y-1">
            {flagged.map(f => (
              <button key={f.quote.id} onClick={() => onOpen(f.quote)}
                className="w-full text-left text-[12px] bg-white border border-amber-200 rounded-lg px-2.5 py-1.5 hover:bg-amber-100">
                <b>{addressOf(f.quote) || 'Unnamed quote'}</b>
                <span className="text-amber-800"> — {f.pairing.thisSigned ? 'signed' : 'not signed'};
                  {' '}paired with {f.pairing.partnerAddress || 'a property'} which
                  {' '}{f.pairing.partnerSigned ? 'has signed' : 'has not signed'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
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
            const named = addressOf(x);
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
                {/* The same modifiers, compact, so a set of quotes can be
                    scanned for outliers. Rebuilt through the SAME computeAdds
                    the estimator's price used, against the quote's OWN config
                    version — so a row can never claim a modifier the quote did
                    not actually price with. */}
                <div className="mt-1">
                  <ModifierChips compact mods={activeModifiers(breakdownOfSaved(x, cfg), x, cfg)} />
                </div>

                {/* Measured area on the list too, so the set is scannable —
                    the whole point of recording it is comparing across
                    properties later. Always labelled, never bare. */}
                {x.measurement?.totalSqft ? (
                  <div className="text-[10px] text-slate-500">
                    {Math.round(x.measurement.totalSqft).toLocaleString()} sq ft
                    <span className="text-slate-400"> · reference only</span>
                  </div>
                ) : null}
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

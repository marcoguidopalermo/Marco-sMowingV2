// SNOWMASTER · COMMERCIAL CONTRACT — defaults and derived values.
//
// Pure functions. Everything here is either a stated default for a new
// contract or a figure DERIVED from what the user typed. Derived values are
// never stored as free input: the editor shows them live and recomputes on
// every keystroke, so a contract can't be saved with an instalment amount
// that doesn't match its total.
import type {
  SnowContract, SnowContractService, SnowContractOptionBLine, SnowContractStatus,
} from '../types';

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

// ── SEASON ─────────────────────────────────────────────────────────────────
// August onward belongs to the UPCOMING season: quoting starts in late summer,
// so in Aug 2026 a new contract is for 2026/2027, and in Feb 2027 it is still
// 2026/2027 (the season in progress).
export function seasonFor(date: Date): string {
  const y = date.getFullYear();
  const startYear = date.getMonth() >= 7 ? y : y - 1;   // month 7 = August
  return `${startYear}/${startYear + 1}`;
}

export const seasonStartYear = (season: string): number =>
  Number(season.split('/')[0]) || new Date().getFullYear();

// ── DERIVED ────────────────────────────────────────────────────────────────
export const OPTION_A_INSTALMENTS = 6;
export const PREPAY_DISCOUNT_PCT = 5;

export const instalmentAmount = (totalPrice: number): number =>
  round2((Number(totalPrice) || 0) / OPTION_A_INSTALMENTS);

export const prepayTotal = (totalPrice: number): number =>
  round2((Number(totalPrice) || 0) * (1 - PREPAY_DISCOUNT_PCT / 100));

export const optionBTotal = (lines: SnowContractOptionBLine[] | undefined): number =>
  round2((lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0));

// Recomputes every derived figure from the inputs around it. Called on each
// edit so the three derived numbers can never drift from what they describe.
export function withDerived(c: SnowContract): SnowContract {
  return {
    ...c,
    pricing: {
      ...c.pricing,
      optionA: {
        ...c.pricing.optionA,
        instalments: OPTION_A_INSTALMENTS,
        prepayDiscountPct: PREPAY_DISCOUNT_PCT,
        instalmentAmount: instalmentAmount(c.pricing.optionA.totalPrice),
        prepayTotal: prepayTotal(c.pricing.optionA.totalPrice),
      },
      optionB: {
        ...c.pricing.optionB,
        totalPerVisit: optionBTotal(c.pricing.optionB.lines),
      },
    },
  };
}

// ── DEFAULTS ───────────────────────────────────────────────────────────────
// The seven standard rows, all EXCLUDED until someone includes them —
// a contract should never imply a service nobody agreed to.
// Labels and details are VERBATIM from the reference document — these print
// on a client-facing agreement, so "Sanding — 95/5 winter sand/salt mix" is
// the wording, not a tidier paraphrase of it.
export const STANDARD_SERVICES: SnowContractService[] = [
  { key: 'plowing', label: 'Plowing', detail: 'lot and driving areas', status: 'blank', notes: '', custom: false },
  { key: 'shovelling', label: 'Shovelling / Blowing', detail: 'walkways, entrances', status: 'blank', notes: '', custom: false },
  { key: 'sanding', label: 'Sanding', detail: '95/5 winter sand/salt mix', status: 'blank', notes: '', custom: false },
  { key: 'salting', label: 'Salting', detail: 'walkways and entrances', status: 'blank', notes: '', custom: false },
  { key: 'iceManagement', label: 'Ice Management', detail: 'between clearings', status: 'blank', notes: '', custom: false },
  { key: 'relocation', label: 'On-Site Snow Relocation', detail: 'stacking / pushback', status: 'blank', notes: '', custom: false },
  { key: 'haulAway', label: 'Off-Site Haul-Away', detail: 'loading and removal', status: 'blank', notes: '', custom: false },
];

// Option B starts with the four rate lines the reference seeds, amounts blank.
export const DEFAULT_OPTION_B_LINES: SnowContractOptionBLine[] = [
  { label: 'Plowing (per visit)', amount: 0 },
  { label: 'Shovelling / Blowing (per visit)', amount: 0 },
  { label: 'Sanding (per application)', amount: 0, note: 'includes up to ___ tons' },
  { label: 'Salting (per application)', amount: 0 },
];

export const DEFAULT_ADDONS = {
  sandPerTon: 120,
  sandLoadingFee: 200,
  relocation: 'Quoted and agreed when called — not included in either pricing option.',
  haulAway: 'Quoted and agreed when called — not included in either pricing option.',
  afterHours: '',
};

export const DEFAULT_SERVICE_TERMS = {
  triggerDepth: '2" accumulation',
  priorityTier: 'standard' as const,
  clearedBefore: '6:00',
  snowfallEndsBy: '4:00',
  otherwiseWithinHours: '6',
};

// Term runs November 1 to April 15 of the following year.
export const termFor = (season: string): { start: string; end: string } => {
  const y = seasonStartYear(season);
  return { start: `${y}-11-01`, end: `${y + 1}-04-15` };
};

// Prepay deadline is October 15 of the term START year.
export const prepayDeadlineFor = (season: string): string =>
  `${seasonStartYear(season)}-10-15`;

export function newContract(args: {
  id: string;
  createdBy: string;
  now?: number;
  season?: string;
}): SnowContract {
  const now = args.now ?? Date.now();
  const season = args.season || seasonFor(new Date(now));
  return withDerived({
    id: args.id,
    season,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    createdBy: args.createdBy,
    client: { businessName: '', siteContact: '', serviceAddress: '', billingEmail: '', phone: '' },
    term: termFor(season),
    scope: {
      totalArea: '', lotAreas: '', walkwaysEntrances: '', snowStorage: '',
      markedHazards: '', accessNotes: '', description: '',
      showMap: true, mapImages: [],
    },
    services: STANDARD_SERVICES.map(s => ({ ...s })),
    pricing: {
      selectedOption: null,
      optionA: {
        enabled: true,
        totalPrice: 0,
        instalments: OPTION_A_INSTALMENTS,
        instalmentAmount: 0,
        prepayDiscountEnabled: true,
        prepayDeadline: prepayDeadlineFor(season),
        prepayDiscountPct: PREPAY_DISCOUNT_PCT,
        prepayTotal: 0,
      },
      optionB: { enabled: true, lines: DEFAULT_OPTION_B_LINES.map(l => ({ ...l })), totalPerVisit: 0 },
      addOns: { ...DEFAULT_ADDONS },
    },
    serviceTerms: { ...DEFAULT_SERVICE_TERMS },
    hiddenSections: [],
  });
}

// ── RENEWAL ────────────────────────────────────────────────────────────────
// Carries the parts that describe the PROPERTY and the work; clears everything
// that describes a deal — prices, status, and the timestamps that recorded it.
// Re-quoting is the point of a renewal, so last year's numbers must not ride
// along and be mistaken for this year's.
export function duplicateForNextSeason(
  src: SnowContract,
  args: { id: string; createdBy: string; now?: number },
): SnowContract {
  const now = args.now ?? Date.now();
  const startYear = seasonStartYear(src.season) + 1;
  const season = `${startYear}/${startYear + 1}`;
  return withDerived({
    ...src,
    id: args.id,
    season,
    status: 'draft',
    sentAt: undefined,
    signedAt: undefined,
    signedBy: undefined,
    createdAt: now,
    updatedAt: now,
    createdBy: args.createdBy,
    term: termFor(season),
    // Scope carries over wholesale — same property, same map, same measurement.
    scope: { ...src.scope, mapImages: [...(src.scope.mapImages || [])] },
    services: src.services.map(s => ({ ...s })),
    serviceTerms: { ...src.serviceTerms },
    pricing: {
      selectedOption: null,
      optionA: {
        ...src.pricing.optionA,
        totalPrice: 0,
        instalmentAmount: 0,
        prepayTotal: 0,
        prepayDeadline: prepayDeadlineFor(season),
      },
      // Line LABELS are kept (the shape of the deal) but amounts are cleared.
      optionB: {
        ...src.pricing.optionB,
        lines: (src.pricing.optionB.lines || []).map(l => ({ ...l, amount: 0 })),
        totalPerVisit: 0,
      },
      addOns: { ...src.pricing.addOns },
    },
    hiddenSections: [...(src.hiddenSections || [])],
  });
}

// ── LIST HELPERS ───────────────────────────────────────────────────────────
// What the list column shows: Option A's total, or Option B's per-visit total,
// following whichever option is selected — falling back to whichever is
// enabled when the choice hasn't been made yet.
export function headlinePrice(c: SnowContract): { amount: number; kind: 'seasonal' | 'perVisit' | null } {
  const sel = c.pricing.selectedOption;
  if (sel === 'A') return { amount: c.pricing.optionA.totalPrice, kind: 'seasonal' };
  if (sel === 'B') return { amount: c.pricing.optionB.totalPerVisit, kind: 'perVisit' };
  if (c.pricing.optionA.enabled && c.pricing.optionA.totalPrice > 0) {
    return { amount: c.pricing.optionA.totalPrice, kind: 'seasonal' };
  }
  if (c.pricing.optionB.enabled && c.pricing.optionB.totalPerVisit > 0) {
    return { amount: c.pricing.optionB.totalPerVisit, kind: 'perVisit' };
  }
  return { amount: 0, kind: null };
}

export const STATUS_LABEL: Record<SnowContractStatus, string> = {
  draft: 'Draft', sent: 'Sent', signed: 'Signed', declined: 'Declined', expired: 'Expired',
};

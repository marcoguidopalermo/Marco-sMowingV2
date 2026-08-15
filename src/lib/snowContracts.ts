// SNOWMASTER · COMMERCIAL CONTRACT — defaults, derived values and migration.
//
// Pure functions. Everything here is either a stated default for a new
// contract or a figure DERIVED from what the user typed. Derived values are
// never stored as free input: the editor shows them live and recomputes on
// every keystroke, so a contract can't be saved with an instalment amount
// that doesn't match its total.
import type {
  SnowContract, SnowContractStatus, SnowLevelPrice, SnowServiceLevel, SnowPhotoView,
} from '../types';

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

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

export const LEVELS: SnowServiceLevel[] = [1, 2, 3];

// ── DERIVED ────────────────────────────────────────────────────────────────
// NOTE none of these three print any more. The new document states the rule
// ("6 equal monthly instalments", "5% discount", "50% of the Level 2 per-visit
// rate") rather than the arithmetic, so these exist for the EDITOR: they show
// the person quoting what the rule works out to before they commit to a price.
export const OPTION_A_INSTALMENTS = 6;
export const PREPAY_DISCOUNT_PCT = 5;
export const CALLED_IN_PCT = 50;

export const instalmentAmount = (seasonal: number): number =>
  round2(num(seasonal) / OPTION_A_INSTALMENTS);

export const prepayTotal = (seasonal: number): number =>
  round2(num(seasonal) * (1 - PREPAY_DISCOUNT_PCT / 100));

// Sanding/salting called in on its own — 50% of the LEVEL 2 per-visit rate,
// whichever level the Client is on. Level 1 has no ice control at all, so
// there is no called-in rate to quote.
export const calledInRate = (c: SnowContract): number | null =>
  c.serviceLevel === 1 ? null : round2(num(c.pricing.levels[2]?.perVisit) * (CALLED_IN_PCT / 100));

// The selected level's prices, or null before a level is chosen.
export const selectedPrice = (c: SnowContract): SnowLevelPrice | null =>
  c.serviceLevel ? c.pricing.levels[c.serviceLevel] || null : null;

// Normalizes the stored numbers. There is nothing left to compute into the
// record — the derived figures above are display-only — so this only rounds,
// which keeps a pasted "1200.005" from being saved as a price no one typed.
export function withDerived(c: SnowContract): SnowContract {
  const levels = { ...c.pricing.levels } as Record<SnowServiceLevel, SnowLevelPrice>;
  for (const n of LEVELS) {
    const l = levels[n] || { seasonal: 0, perVisit: 0 };
    levels[n] = { seasonal: round2(l.seasonal), perVisit: round2(l.perVisit) };
  }
  return { ...c, pricing: { ...c.pricing, levels } };
}

// ── DEFAULTS ───────────────────────────────────────────────────────────────
export const emptyLevels = (): Record<SnowServiceLevel, SnowLevelPrice> => ({
  1: { seasonal: 0, perVisit: 0 },
  2: { seasonal: 0, perVisit: 0 },
  3: { seasonal: 0, perVisit: 0 },
});

// Defaults are the reference document's own printed defaults.
export const DEFAULT_SERVICE_TERMS = {
  triggerDepth: '2" accumulation',
  serviceWindow: null,
  overnightCutoff: '2:00',
  overnightClearBy: '8:00',
  daytimeHours: '24',
  nonPriorityHours: '48',
} as const;

export const DEFAULT_CGL = '5,000,000';

// A freshly uploaded photo fills the banner, centred — the reference's own
// starting point. Everything else is the user moving it.
export const DEFAULT_PHOTO_VIEW = { zoom: 1, x: 0, y: 0, fit: false } as const;
export const photoView = (c: SnowContract): SnowPhotoView =>
  ({ ...DEFAULT_PHOTO_VIEW, ...(c.scope.sitePhotoView || {}) });

// THE FRAMING STYLE, applied identically by the printed banner and by the
// editor's framing box. One function, so what is framed is what prints.
//
// NOT THE REFERENCE'S ARITHMETIC, deliberately. The reference translates the
// <img> element and clamps the drag against the photo's NATURAL size — but the
// element is only as big as the banner (object-fit does the covering inside
// it), so translating it by the natural overflow drags the element itself off
// the frame and leaves empty background behind. Ported as written, the banner
// printed blank. Panning here is object-position instead: it chooses which
// part of a covering image shows, and a covering image cannot be positioned to
// reveal background — the model makes the failure unrepresentable rather than
// clamping against it.
//
// x and y are offsets from centre in the range ±50, where ±50 is the photo's
// own edge. Zoom scales the whole frame about its centre.
export const PHOTO_PAN_LIMIT = 50;
export const PHOTO_ZOOM_MIN = 1;      // below 1 a cover image stops covering
export const PHOTO_ZOOM_MAX = 4;

export const photoStyle = (v: SnowPhotoView): {
  objectFit: 'cover' | 'contain'; objectPosition: string; transform: string;
} => ({
  objectFit: v.fit ? 'contain' : 'cover',
  objectPosition: `${50 + (Number(v.x) || 0)}% ${50 + (Number(v.y) || 0)}%`,
  transform: `scale(${Number(v.zoom) || 1})`,
});

// How much of the photo is hidden outside the banner, in PIXELS of the drawn
// image. A drag of n screen pixels moves the crop by n/slack of its range, so
// a photo with no overflow on an axis simply does not pan on that axis — which
// is the truth, not a restriction.
export const photoSlackPx = (
  box: { w: number; h: number },
  nat: { w: number; h: number },
): { x: number; y: number } => {
  if (!box.w || !box.h || !nat.w || !nat.h) return { x: 0, y: 0 };
  const cover = Math.max(box.w / nat.w, box.h / nat.h);
  return { x: Math.max(0, nat.w * cover - box.w), y: Math.max(0, nat.h * cover - box.h) };
};

export const clampPhotoView = (v: SnowPhotoView): SnowPhotoView => {
  const cl = (n: number) => Math.round(
    Math.min(PHOTO_PAN_LIMIT, Math.max(-PHOTO_PAN_LIMIT, Number(n) || 0)) * 10,
  ) / 10;
  const zoom = Math.min(PHOTO_ZOOM_MAX, Math.max(PHOTO_ZOOM_MIN, Number(v.zoom) || 1));
  return { zoom: Math.round(zoom * 100) / 100, x: cl(v.x), y: cl(v.y), fit: !!v.fit };
};

// Term runs November 1 to April 30 of the following year.
export const termFor = (season: string): { start: string; end: string } => {
  const y = seasonStartYear(season);
  return { start: `${y}-11-01`, end: `${y + 1}-04-30` };
};

// Prepay deadline is October 15 of the term START year.
export const prepayDeadlineFor = (season: string): string =>
  `${seasonStartYear(season)}-10-15`;

const ymd = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
// A quote holds for 30 days unless someone changes it — long enough to be
// considered, short enough that a price cannot be accepted a season later.
export const VALID_FOR_DAYS = 30;
export const validUntilFrom = (quoteYmd: string): string => {
  const d = new Date(`${quoteYmd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + VALID_FOR_DAYS);
  return ymd(d.getTime());
};

export function newContract(args: {
  id: string;
  createdBy: string;
  now?: number;
  season?: string;
}): SnowContract {
  const now = args.now ?? Date.now();
  const season = args.season || seasonFor(new Date(now));
  const quoteDate = ymd(now);
  return withDerived({
    id: args.id,
    season,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    createdBy: args.createdBy,
    quoteDate,
    validUntil: validUntilFrom(quoteDate),
    client: {
      businessName: '', siteContact: '', billingContact: '',
      billingEmail: '', billingAddress: '', serviceAddress: '',
    },
    term: termFor(season),
    scope: { plowArea: '', shovelArea: '', showMap: true, mapImages: [] },
    // NOT a level — nobody has chosen one yet.
    serviceLevel: null,
    pricing: {
      selectedOption: null,
      levels: emptyLevels(),
      optionAPayment: null,
      prepayDeadline: prepayDeadlineFor(season),
    },
    serviceTerms: { ...DEFAULT_SERVICE_TERMS },
    insurance: { cglAmount: DEFAULT_CGL },
    hiddenSections: [],
  });
}

// ── MIGRATION ──────────────────────────────────────────────────────────────
// Reads a contract saved under EITHER shape and returns the current one. Run
// on every load, so a stored record is never trusted to have the fields this
// build expects.
//
// WHAT IS DELIBERATELY NOT INFERRED:
//   · serviceLevel. The old matrix ticked services individually, and no
//     combination of those ticks is the same statement as "the Client selected
//     Level 2". Guessing would put a level on a signed contract that nobody
//     agreed to, so a migrated contract has NO level and the editor says so.
//   · prices. The old seasonal total priced whatever that matrix said; it is
//     not this level's price. The figures are kept in legacyPricing so a
//     renewal can see last season's numbers, and are never printed.
// WHAT IS mapped, because the meaning carries over cleanly:
//   · priority tier → service window (priority is the overnight route).
//   · lot / walkway descriptions → the plow and shovel area fields.
//   · the old phone field → appended to the site contact, which is now one
//     "name + phone" field.
export function migrateContract(raw: any): SnowContract {
  if (!raw || typeof raw !== 'object') throw new Error('not a contract');
  // Already current: the level field only exists on the new shape.
  const isNew = 'serviceLevel' in raw && raw.pricing && 'levels' in raw.pricing;

  const season = str(raw.season) || seasonFor(new Date(num(raw.createdAt) || Date.now()));
  const oldClient = raw.client || {};
  const oldScope = raw.scope || {};
  const oldPricing = raw.pricing || {};
  const oldTerms = raw.serviceTerms || {};

  if (isNew) {
    // Fill anything a newer field added after this record was written.
    const quoteDate = str(raw.quoteDate) || ymd(num(raw.createdAt) || Date.now());
    return withDerived({
      ...raw,
      quoteDate,
      validUntil: str(raw.validUntil) || validUntilFrom(quoteDate),
      scope: { plowArea: '', shovelArea: '', showMap: true, mapImages: [], ...oldScope },
      serviceTerms: { ...DEFAULT_SERVICE_TERMS, ...oldTerms },
      insurance: { cglAmount: str(raw.insurance?.cglAmount) || DEFAULT_CGL },
      pricing: { ...oldPricing, levels: { ...emptyLevels(), ...(oldPricing.levels || {}) } },
      hiddenSections: Array.isArray(raw.hiddenSections) ? raw.hiddenSections : [],
    } as SnowContract);
  }

  const phone = str(oldClient.phone).trim();
  const siteContact = str(oldClient.siteContact).trim();
  const quoteDate = ymd(num(raw.createdAt) || Date.now());
  const seasonalTotal = num(oldPricing.optionA?.totalPrice);
  const perVisitTotal = num(oldPricing.optionB?.totalPerVisit);

  return withDerived({
    id: str(raw.id),
    season,
    status: (str(raw.status) || 'draft') as SnowContractStatus,
    sentAt: raw.sentAt,
    signedAt: raw.signedAt,
    signedBy: raw.signedBy,
    createdAt: num(raw.createdAt) || Date.now(),
    updatedAt: num(raw.updatedAt) || Date.now(),
    createdBy: str(raw.createdBy),
    clientId: raw.clientId,
    quoteDate,
    validUntil: validUntilFrom(quoteDate),
    client: {
      businessName: str(oldClient.businessName),
      // One field now: keep the number rather than dropping it, but never
      // duplicate it if whoever typed the contact already included it.
      siteContact: phone && !siteContact.includes(phone)
        ? [siteContact, phone].filter(Boolean).join(' · ')
        : siteContact,
      billingContact: '',
      billingEmail: str(oldClient.billingEmail),
      billingAddress: '',
      serviceAddress: str(oldClient.serviceAddress),
      phone: phone || undefined,
    },
    term: {
      start: str(raw.term?.start) || termFor(season).start,
      end: str(raw.term?.end) || termFor(season).end,
    },
    scope: {
      plowArea: str(oldScope.lotAreas),
      shovelArea: str(oldScope.walkwaysEntrances),
      showMap: oldScope.showMap !== false,
      mapImages: Array.isArray(oldScope.mapImages) ? oldScope.mapImages : [],
      measuredSqft: oldScope.measuredSqft,
      measurement: oldScope.measurement,
      totalArea: str(oldScope.totalArea) || undefined,
      snowStorage: str(oldScope.snowStorage) || undefined,
      markedHazards: str(oldScope.markedHazards) || undefined,
      accessNotes: str(oldScope.accessNotes) || undefined,
      description: str(oldScope.description) || undefined,
    },
    serviceLevel: null,
    pricing: {
      selectedOption: null,
      levels: emptyLevels(),
      optionAPayment: null,
      prepayDeadline: str(oldPricing.optionA?.prepayDeadline) || prepayDeadlineFor(season),
    },
    serviceTerms: {
      triggerDepth: str(oldTerms.triggerDepth) || DEFAULT_SERVICE_TERMS.triggerDepth,
      serviceWindow: oldTerms.priorityTier === 'priority' ? 'overnight'
        : oldTerms.priorityTier === 'standard' ? 'daytime' : null,
      overnightCutoff: DEFAULT_SERVICE_TERMS.overnightCutoff,
      overnightClearBy: DEFAULT_SERVICE_TERMS.overnightClearBy,
      daytimeHours: DEFAULT_SERVICE_TERMS.daytimeHours,
      nonPriorityHours: DEFAULT_SERVICE_TERMS.nonPriorityHours,
    },
    insurance: { cglAmount: DEFAULT_CGL },
    legacyPricing: (seasonalTotal || perVisitTotal) ? { seasonalTotal, perVisitTotal } : undefined,
    // Ids are stable across the rewrite, so a section someone removed stays
    // removed. 'addons' no longer exists as a section and is dropped.
    hiddenSections: (Array.isArray(raw.hiddenSections) ? raw.hiddenSections : []).filter((x: string) => x !== 'addons'),
  });
}

// True when a contract still needs the two things migration refuses to guess.
export const needsRequote = (c: SnowContract): boolean =>
  c.serviceLevel === null && !!c.legacyPricing;

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
  const quoteDate = ymd(now);
  const prev = selectedPrice(src);
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
    quoteDate,
    validUntil: validUntilFrom(quoteDate),
    term: termFor(season),
    // Scope carries over wholesale — same property, same map, same measurement.
    scope: { ...src.scope, mapImages: [...(src.scope.mapImages || [])] },
    // The LEVEL carries over: it describes what this property needs, and it
    // was agreed last season. The PRICES do not.
    serviceLevel: src.serviceLevel,
    serviceTerms: { ...src.serviceTerms },
    insurance: { ...src.insurance },
    pricing: {
      selectedOption: null,
      levels: emptyLevels(),
      optionAPayment: null,
      prepayDeadline: prepayDeadlineFor(season),
    },
    // Last season's figures, for reference while re-quoting.
    legacyPricing: prev && (prev.seasonal || prev.perVisit)
      ? { seasonalTotal: prev.seasonal, perVisitTotal: prev.perVisit }
      : undefined,
    hiddenSections: [...(src.hiddenSections || [])],
  });
}

// ── LIST HELPERS ───────────────────────────────────────────────────────────
// What the list column shows: the SELECTED level's price under the selected
// option. Without both selections there is no headline — a price for a level
// nobody chose is not this contract's price.
export function headlinePrice(c: SnowContract): { amount: number; kind: 'seasonal' | 'perVisit' | null } {
  const p = selectedPrice(c);
  if (!p) return { amount: 0, kind: null };
  if (c.pricing.selectedOption === 'A') return { amount: p.seasonal, kind: 'seasonal' };
  if (c.pricing.selectedOption === 'B') return { amount: p.perVisit, kind: 'perVisit' };
  // Level chosen, option not: show whichever side has been quoted, seasonal
  // first — it is the headline number in every conversation about a season.
  if (p.seasonal > 0) return { amount: p.seasonal, kind: 'seasonal' };
  if (p.perVisit > 0) return { amount: p.perVisit, kind: 'perVisit' };
  return { amount: 0, kind: null };
}

export const STATUS_LABEL: Record<SnowContractStatus, string> = {
  draft: 'Draft', sent: 'Sent', signed: 'Signed', declined: 'Declined', expired: 'Expired',
};

/* eslint-disable max-len, require-jsdoc, valid-jsdoc */
// SERVICE CATEGORIES — the one implementation, shared by the app
// (src/lib/sales/categories.ts imports this file) and the Cloud Functions.
// Spec: docs/service-category-mapping.md (Marco's decisions, 2026-10-20).
// Pure: no imports, no I/O.

export const CATEGORIES = [
  "Lawn mowing", "Lawn care", "Hedges & shrubs", "Sod", "Cleanups",
  "Garden beds & landscaping", "Hardscape & gravel", "Tree & stump", "Snow", "Sweeping", "Other",
] as const;
export type Category = typeof CATEGORIES[number];

/** Admin overrides (serviceCategoryMap/overrides): catalog item name → category, and normalised freehand name → category. */
export interface CategoryOverrides { catalog?: Record<string, Category>; names?: Record<string, Category> }

export const normName = (s: unknown): string =>
  String(s || "").toLowerCase().replace(/[^a-z0-9$% ]+/g, " ").replace(/\s+/g, " ").trim();

const ASSET = /\b(tractor|l6060|kubota l\d|sale of (19|20)\d\d|sale of \d{4}|vehicle sale|equipment sale)/;
const DISCOUNT = /(discount|\d+ ?% off|\$ ?\d+ off|price difference|\bcredit\b(?! card))/;
const TRIMMING = /^(extra |additional |additional requested )?trimming( in (the )?backyard)?$/;
const LANDSCAPING_PROJECT = /^landscaping project\b/;

// Ordered keyword rules — first match wins.
const RULES: [Category, RegExp][] = [
  ["Sweeping", /\bsweep/],
  ["Snow", /\b(snow|plow|plough|sanding|salt|shovel|ice\b)/],
  ["Tree & stump", /\b(stump|tree|arborist|brush ?cut)/],
  ["Sod", /\bsod\b/],
  ["Hardscape & gravel", /\b(crusher|gravel|river rock|rock\b|stone|paver|patio|retaining|wall\b|hardscape|grading|drainage|interlock|asphalt|levell?ing)/],
  ["Cleanups", /\b(clean ?up|leaf|leaves|brush removal|brush and)/],
  ["Hedges & shrubs", /\b(hedge|shrub|prun|cedar)/],
  ["Lawn care", /\b(lawn care|turf care|fertili|weed control|weed spray|aerat|dethatch|thatch|overseed|seeding|seed\b|lime\b|grub|pest|bronze|silver|gold)/],
  ["Lawn mowing", /\b(mow|lawn maintenance|per cut|cutting|weekly|biweekly|bi weekly|seasonal (lawn )?maintenance)/],
  ["Garden beds & landscaping", /\b(garden|beds?\b|mulch|plant|landscap|edging|de ?weed|weeding|rototill|soil|topsoil|flower)/],
  ["Other", /\b(gutter|eavestrough|general maintenance|hours?\b|installation\b|start ?up|repair|disposal|fee\b|fees\b|travel|hauling|additional work|follow up)/],
];

/** Catalog items (Jobber Products & Services) → category, from the agreed spec. */
export const CATALOG_DEFAULTS: Record<string, Category> = {
  "Mowing (Biweekly)": "Lawn mowing", "Mowing (Weekly)": "Lawn mowing", "Lawn mowing - biweekly": "Lawn mowing", "Seasonal Lawn Maintenance": "Lawn mowing",
  "Gold Lawn Care Package": "Lawn care", "Silver Lawn Care Package": "Lawn care", "Bronze Lawn Care Package": "Lawn care", "Lawn Care": "Lawn care",
  "Aeration": "Lawn care", "Core Aeration": "Lawn care", "Dethatching": "Lawn care", "Dethatch, Aeration, Over-seeding": "Lawn care", "Disposal of thatch": "Lawn care",
  "Overseeding": "Lawn care", "Seeding": "Lawn care", "Soil + Seed (New lawn seeding) ": "Lawn care", "Soil + Seed (New lawn seeding)": "Lawn care",
  "Fertilizing": "Lawn care", "Weed Control": "Lawn care", "Weed spray": "Lawn care", "Pest Control": "Lawn care",
  "Hedge trimming": "Hedges & shrubs", "Hedge trimming + de-weeding": "Hedges & shrubs", "De-weeding + Shrub trimming": "Hedges & shrubs", "Pruning": "Hedges & shrubs", "Shrub Removal": "Hedges & shrubs",
  "Sod Installation": "Sod", "Sod Installation (Hydra bucket)": "Sod", "Sod Cutting & Disposal": "Sod",
  "Spring Cleanup": "Cleanups", "Spring Clean-up": "Cleanups", "Fall Cleanup": "Cleanups", "Yard Cleanup": "Cleanups", "Leaf cleanup": "Cleanups", "Leaf Removal": "Cleanups",
  "Garden prep/cleanup": "Cleanups", "Brush Removal": "Cleanups", "Brush and door disposal": "Cleanups",
  "Flower Bed": "Garden beds & landscaping", "Flower Bed De-weeding": "Garden beds & landscaping", "De-weeding gardens": "Garden beds & landscaping", "bed maintenance": "Garden beds & landscaping",
  "Edging": "Garden beds & landscaping", "Mulching": "Garden beds & landscaping", "Fresh mulch + new edging installation": "Garden beds & landscaping",
  "Rototill + soil application": "Garden beds & landscaping", "Soil application": "Garden beds & landscaping", "Soil Delivery": "Garden beds & landscaping", "Soil 20 Cubic Yard": "Garden beds & landscaping",
  "Top Soil | Delivery & Installation (per yard)": "Garden beds & landscaping", "Top Soil | Supply & Spreading (per yard)": "Garden beds & landscaping",
  "River Rock + Delivery": "Hardscape & gravel",
  "Stump Grinding": "Tree & stump", "Stump grinding + sod ": "Tree & stump", "Stump grinding + sod": "Tree & stump", "Stump Removal": "Tree & stump", "Tree Removal & Dispsoal": "Tree & stump", "tree trimming": "Tree & stump",
  "Plowing": "Snow", "Snow Removal": "Snow", "Snow Blowing": "Snow", "Monthly Plow Return": "Snow",
  "Driveway Sweeping": "Sweeping",
  "General Maintenance (Hourly)": "Other", "Hours": "Other", "Installation": "Other", "Mid-Season Start-up (July 1st)": "Other",
  "Pine hole leak - lawn repair": "Other", "Gutter cleaning": "Other", "Disposal fee ($100)": "Other",
  // "Trimming" / "extra trimming in backyard": waiting on Marco → Other, listed.
  "Trimming": "Other", "extra trimming in backyard": "Other",
};

export type LineFlag = "trimming" | "unmapped" | "landscaping-project";
export interface LineIn { name: string; linked?: string | null; amount: number; optional?: boolean; selected?: boolean | null }
export interface LineOut extends LineIn {
  kind: "service" | "discount" | "asset";
  split: { category: Category; amount: number }[]; // a line can split (landscaping project 50/50)
  flag?: LineFlag;
  tie?: "own words" | "invoice" | "largest service" | "untied";
}

/** Category for a single name (no discount / asset handling). */
export function categoryForName(name: string, linked: string | null | undefined, o: CategoryOverrides = {}): { split: { category: Category; share: number }[]; flag?: LineFlag } {
  if (linked) {
    const c = (o.catalog && o.catalog[linked]) || CATALOG_DEFAULTS[linked] || CATALOG_DEFAULTS[linked.trim()];
    if (c) return {split: [{category: c, share: 1}], flag: TRIMMING.test(normName(linked)) && !(o.catalog && o.catalog[linked]) ? "trimming" : undefined};
  }
  const n = normName(linked || name);
  const named = o.names && (o.names[normName(name)] || o.names[n]);
  if (named) return {split: [{category: named, share: 1}]};
  if (LANDSCAPING_PROJECT.test(normName(name))) return {split: [{category: "Hardscape & gravel", share: 0.5}, {category: "Garden beds & landscaping", share: 0.5}], flag: "landscaping-project"};
  if (TRIMMING.test(normName(name))) return {split: [{category: "Other", share: 1}], flag: "trimming"};
  for (const [c, re] of RULES) if (re.test(n)) return {split: [{category: c, share: 1}]};
  return {split: [{category: "Other", share: 1}], flag: "unmapped"};
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * One invoice's (or quote's) lines → categories. Asset sales separated;
 * discounts subtracted from the service they belong to (own words → the
 * invoice's only service → its largest service → Other, "untied").
 */
export function categorizeLines(lines: LineIn[], o: CategoryOverrides = {}): LineOut[] {
  const out: LineOut[] = lines.map((l) => {
    const words = normName(l.name) + " " + normName(l.linked || "");
    if (ASSET.test(words)) return {...l, kind: "asset" as const, split: []};
    if (DISCOUNT.test(words) || l.amount < 0) return {...l, kind: "discount" as const, split: []};
    const c = categoryForName(l.name, l.linked, o);
    return {...l, kind: "service" as const, split: c.split.map((s) => ({category: s.category, amount: r2(l.amount * s.share)})), flag: c.flag};
  });
  const byCat: Partial<Record<Category, number>> = {};
  for (const x of out) if (x.kind === "service") for (const s of x.split) byCat[s.category] = (byCat[s.category] || 0) + s.amount;
  const services = (Object.keys(byCat) as Category[]).filter((c) => c !== "Other");
  for (const x of out) {
    if (x.kind !== "discount") continue;
    const stripped = normName(x.linked || x.name).replace(DISCOUNT, " ").replace(/\b(spring|program|late start|pre ?payment|off|\$ ?\d+|\d+ ?%)\b/g, " ").trim();
    let own: Category | null = null;
    for (const [c, re] of RULES) {
      if (c !== "Other" && re.test(stripped)) {
        own = c; break;
      }
    }
    let cat: Category; let tie: LineOut["tie"];
    if (own) {
      cat = own; tie = "own words";
    } else if (services.length === 1) {
      cat = services[0]; tie = "invoice";
    } else if (services.length > 1) {
      cat = services.sort((a, b) => (byCat[b] || 0) - (byCat[a] || 0))[0]; tie = "largest service";
    } else {
      cat = "Other"; tie = "untied";
    }
    x.split = [{category: cat, amount: r2(x.amount)}];
    x.tie = tie;
  }
  return out;
}

/** Sum a categorised invoice by category (assets excluded). */
export function totalsByCategory(lines: LineOut[]): Partial<Record<Category, number>> {
  const t: Partial<Record<Category, number>> = {};
  for (const x of lines) for (const s of x.split) t[s.category] = r2((t[s.category] || 0) + s.amount);
  return t;
}

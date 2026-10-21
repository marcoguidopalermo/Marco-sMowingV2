// SERVICE MAP (2026-10-21) — the categories the scoreboard shows, and the ONE
// division each belongs to. A division's revenue is the sum of its categories
// (not which crew did the work; $ per BH stays crew-based — categories.ts).
//
// Two layers: the agreed line rules (functions/src/shared/serviceCategories.ts)
// give each line a BASE category, keeping every per-invoice override and
// decision (trimming overrides, the 50/50 landscaping-project split, discounts
// to the largest service); serviceCategory() below turns that into the
// category shown here, using the line's words where a base category splits.
// An override or assigned name may also use these categories directly.

export const SERVICE_DIVISIONS = ['Lawn', 'Small Projects', 'Large Projects', 'Commercial snow'] as const;
export type ServiceDivision = typeof SERVICE_DIVISIONS[number];

export const SERVICE_CATEGORIES = [
  'Lawn mowing', 'Lawn care',
  'Dethatching', 'Cleanups & gardens', 'Arborist', 'Stump grinding',
  'Sod', 'Hardscape', 'Driveways', 'Gravel & rock', 'Grading & drainage', 'Soil & prep', 'Dump runs', 'Sweeping',
  'Commercial snow',
  'Fees & adjustments', 'Unassigned',
] as const;
export type ServiceCategory = typeof SERVICE_CATEGORIES[number];

/** Each category's division; Fees & adjustments and Unassigned are in none. */
export const DIVISION_OF: Partial<Record<ServiceCategory, ServiceDivision>> = {
  'Lawn mowing': 'Lawn', 'Lawn care': 'Lawn',
  'Dethatching': 'Small Projects', 'Cleanups & gardens': 'Small Projects', 'Arborist': 'Small Projects', 'Stump grinding': 'Small Projects',
  'Sod': 'Large Projects', 'Hardscape': 'Large Projects', 'Driveways': 'Large Projects', 'Gravel & rock': 'Large Projects',
  'Grading & drainage': 'Large Projects', 'Soil & prep': 'Large Projects', 'Dump runs': 'Large Projects', 'Sweeping': 'Large Projects',
  'Commercial snow': 'Commercial snow',
};
/** Categories in no division — shown as their own small lines. */
export const OUTSIDE_DIVISIONS: ServiceCategory[] = ['Fees & adjustments', 'Unassigned'];

const IS_SERVICE = new Set<string>(SERVICE_CATEGORIES);

const HARDSCAPE = /\b(pav(er|ers|ing)|patio|retaining|wall|steps?|interlock|hardscape|landscaping project|fire ?pit|walkway|stone edging)\b/;
const GRAVEL = /\b(gravel|rock|stones?|crusher|river|pebble)/;
const GRADING = /\b(grading|grade|drain|drainage|levell?ing|re ?levell?ing|asphalt|lawn ripped|field repair)/;
const SOIL = /\b(soil|topsoil|top soil|black earth|rototill)/;
const DUMP = /\b(dump|disposal|dispoal|hauling)/;
const LAWN_TREATMENT = /\b(lawn (restoration )?treatment|weed management|condo 54)/;
const FEES = /\b(fees?|deposit|credit card|follow ?up)\b/;

/**
 * The shown category for a line, from its base category and its words.
 * `base` may already be a shown category (an override or assigned name).
 */
export function serviceCategory(base: string, text: string, linked?: string | null): ServiceCategory {
  const t = `${text || ''} ${linked || ''}`.toLowerCase().replace(/[^a-z0-9$% ]+/g, ' ');
  // An explicit choice in the new categories wins — except the two names both
  // maps share, which still split by their words below.
  if (IS_SERVICE.has(base) && base !== 'Lawn care' && base !== 'Lawn mowing') return base as ServiceCategory;
  if (base === 'Snow') return 'Commercial snow';
  if (base === 'Sweeping') return 'Sweeping';
  if (base === 'Dump runs') return 'Dump runs';
  // Driveway weed spraying is garden work; any other driveway line is a driveway.
  if (/driveway/.test(t)) return /\bweed/.test(t) ? 'Cleanups & gardens' : 'Driveways';
  switch (base) {
    case 'Lawn mowing': return 'Lawn mowing';
    case 'Lawn care': return /thatch/.test(t) ? 'Dethatching' : 'Lawn care';
    case 'Hedges & shrubs': return 'Arborist';
    case 'Tree & stump': return /stump/.test(t) ? 'Stump grinding' : 'Arborist';
    case 'Cleanups': return 'Cleanups & gardens';
    case 'Garden beds & landscaping': return SOIL.test(t) ? 'Soil & prep' : 'Cleanups & gardens';
    case 'Sod': return 'Sod';
    case 'Hardscape & gravel':
      // The hardscape half of a "landscaping project" line stays Hardscape.
      if (HARDSCAPE.test(t)) return 'Hardscape';
      if (GRAVEL.test(t)) return 'Gravel & rock';
      if (GRADING.test(t)) return 'Grading & drainage';
      return 'Unassigned';
    default: // "Other" — fees, unplaced names, trimming waiting on a decision
      if (DUMP.test(t)) return 'Dump runs';
      if (GRADING.test(t)) return 'Grading & drainage';
      if (LAWN_TREATMENT.test(t)) return 'Lawn care';
      if (SOIL.test(t)) return 'Soil & prep';
      if (FEES.test(t)) return 'Fees & adjustments';
      return 'Unassigned';
  }
}

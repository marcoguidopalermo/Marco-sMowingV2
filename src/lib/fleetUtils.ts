import { FleetItem, EquipmentSubtypeDefinition } from '../types';

const TYPE_ORDER: Record<string, number> = {
  truck: 0,
  trailer: 1,
  tractor: 2,
  equipment: 3,
};

/**
 * Sorts fleet items by (type → equipmentSubtype.sortOrder → unitNumber).
 * Equipment items reference subtype IDs in appData.equipmentSubtypes;
 * orphaned items (subtype ID no longer exists) sort to the bottom of
 * the Equipment section. Items with no unitNumber sort last within group.
 */
export function sortFleetGrouped(
  items: FleetItem[],
  subtypes: EquipmentSubtypeDefinition[] = [],
): FleetItem[] {
  const subtypeOrderById = new Map<string, number>();
  for (const s of subtypes) subtypeOrderById.set(s.id, s.sortOrder);

  return [...items].sort((a, b) => {
    const ta = TYPE_ORDER[a.type] ?? 99;
    const tb = TYPE_ORDER[b.type] ?? 99;
    if (ta !== tb) return ta - tb;
    if (a.type === 'equipment' && b.type === 'equipment') {
      // Subtype sort order from admin data. Orphans (no subtype or unknown
      // id) sort after all known subtypes.
      const sa = a.equipmentSubtype && subtypeOrderById.has(a.equipmentSubtype)
        ? subtypeOrderById.get(a.equipmentSubtype) as number
        : Number.POSITIVE_INFINITY;
      const sb = b.equipmentSubtype && subtypeOrderById.has(b.equipmentSubtype)
        ? subtypeOrderById.get(b.equipmentSubtype) as number
        : Number.POSITIVE_INFINITY;
      if (sa !== sb) return sa - sb;
    }
    const ua = typeof a.unitNumber === 'number' ? a.unitNumber : Number.POSITIVE_INFINITY;
    const ub = typeof b.unitNumber === 'number' ? b.unitNumber : Number.POSITIVE_INFINITY;
    if (ua !== ub) return ua - ub;
    return (a.name || '').localeCompare(b.name || '');
  });
}

/**
 * Returns the user-facing label for a fleet item: "#<unitNumber> <name>"
 * (unit number first, then the make/model the user entered). Crews know
 * the physical units by make/model, so the name carries the weight here.
 *  - unit # + name  → "#1 2012 F-150"
 *  - unit # only    → "#1"
 *  - name only (legacy item, no unit #) → the name alone, no "#"
 *  - neither set    → the capitalized type, so the row is never blank
 * Applies uniformly to truck / trailer / tractor / equipment.
 */
export function fleetItemLabel(item: FleetItem): string {
  const name = (item.name || '').trim();
  const hasUnit = typeof item.unitNumber === 'number';
  if (hasUnit && name) return `#${item.unitNumber} ${name}`;
  if (hasUnit) return `#${item.unitNumber}`;
  if (name) return name;
  return item.type.charAt(0).toUpperCase() + item.type.slice(1);
}

export function isFleetOutOfService(item: FleetItem): boolean {
  if (!item.status) return false;
  return item.status.toLowerCase().includes('out of service') ||
    item.status.toLowerCase().includes('oos');
}

/**
 * Generates a stable, slug-style id from a subtype name. Used when admin
 * adds a new subtype. Falls back to a timestamp suffix if the slug is empty
 * (e.g., name with only special chars).
 */
export function makeSubtypeId(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || `subtype_${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Weight-band helpers — single source of truth for renewal gating.
//
// The unit's band is derived from `registeredGrossWeight` (kg) when set;
// otherwise we fall back to mapping the legacy `weightClass` string so
// existing Firestore records keep behaving the same until an admin enters
// an RGW value. Every site that previously branched on a literal
// weightClass string routes through these helpers instead.
// ---------------------------------------------------------------------------

export type WeightBand = 'under_3000' | '3000_4500' | '4501_10999' | '10999_plus';

export const WEIGHT_BAND_LABELS: Record<WeightBand, string> = {
  under_3000: 'Under 3000 kg',
  '3000_4500': '3000–4500 kg',
  '4501_10999': '4501–10999 kg',
  '10999_plus': '10999+ kg (Class A)',
};

// RGW boundaries (kg).
//   rgw < 3000               → under_3000
//   3000 <= rgw <= 4500      → 3000_4500
//   4500 < rgw <= 10999      → 4501_10999
//   rgw > 10999              → 10999_plus
export function bandFromRgw(rgw: number): WeightBand {
  if (rgw < 3000) return 'under_3000';
  if (rgw <= 4500) return '3000_4500';
  if (rgw <= 10999) return '4501_10999';
  return '10999_plus';
}

// Legacy string → band. 'Under 4500kg' maps to 3000_4500 by spec so
// legacy light trucks keep their existing plate-renewal ping until an
// admin enters their actual RGW. 'N/A' / unknown → undefined.
export function bandFromLegacyWeightClass(weightClass: string | undefined): WeightBand | undefined {
  switch (weightClass) {
    case 'Under 4500kg': return '3000_4500';
    case 'Up to 10999kg (Yellow)': return '4501_10999';
    case '10999kg+ (Class A)': return '10999_plus';
    default: return undefined;
  }
}

export function resolveWeightBand(unit: FleetItem | undefined | null): WeightBand | undefined {
  if (!unit) return undefined;
  if (typeof unit.registeredGrossWeight === 'number' && Number.isFinite(unit.registeredGrossWeight) && unit.registeredGrossWeight >= 0) {
    return bandFromRgw(unit.registeredGrossWeight);
  }
  return bandFromLegacyWeightClass(unit.weightClass);
}

// True when a legacy weightClass is set but no RGW number is — drives
// the "Enter registered gross weight to update classification" hint
// on the Fleet edit form.
export function hasLegacyWeightClassOnly(unit: FleetItem | undefined | null): boolean {
  if (!unit) return false;
  if (typeof unit.registeredGrossWeight === 'number') return false;
  return !!bandFromLegacyWeightClass(unit.weightClass);
}

// Renewal predicates — single source of truth for every gating site
// (banner, fleet-list inline display, edit-form field visibility,
// inspection-type derivation). Trailers never renew plates. Trucks
// under 3000 kg are exempt from both plate renewal and commercial
// safety; trucks 4501 kg+ need both.
export function needsPlateRenewal(unit: FleetItem | undefined | null): boolean {
  if (!unit) return false;
  if (unit.type !== 'truck') return false;
  const band = resolveWeightBand(unit);
  return band === '3000_4500' || band === '4501_10999' || band === '10999_plus';
}

export function needsCommercialSafety(unit: FleetItem | undefined | null): boolean {
  if (!unit) return false;
  if (unit.type === 'trailer') return !!unit.isYellowSticker;
  if (unit.type !== 'truck') return false;
  const band = resolveWeightBand(unit);
  return band === '4501_10999' || band === '10999_plus';
}

// Human-readable band label with a legacy fallback when neither RGW
// nor a recognized legacy string is present.
export function weightBandLabel(unit: FleetItem | undefined | null): string {
  const band = resolveWeightBand(unit);
  if (band) return WEIGHT_BAND_LABELS[band];
  if (unit?.weightClass && unit.weightClass !== 'N/A') return unit.weightClass;
  return '';
}

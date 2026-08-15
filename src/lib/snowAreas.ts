// SNOW SERVICE AREAS — the four things a drawn area on a snow contract can be,
// and the one place their colours are defined.
//
// THREE surfaces have to agree on these: the drawing tool (what you see while
// marking the property), the Static Maps URL (what prints), and the legend
// beside the printed map. Three copies of four hex codes is three chances for
// the printed legend to disagree with the printed map about what green means,
// so they are defined once, here.
//
// The hexes and the legend labels are the reference document's own, verbatim.
import type { SnowAreaPurpose, MeasureRing } from '../types';

export interface SnowAreaSpec {
  key: SnowAreaPurpose;
  label: string;        // legend wording, verbatim from the reference
  short: string;        // the drawing tool's button
  hex: string;          // reference hex
  // Whether this area is SERVICED and therefore counts toward the measured
  // square footage the price is built on. Storage and hazards do not.
  counts: boolean;
  // Whether a single click may drop a point instead of an area.
  marker: boolean;
}

export const SNOW_AREAS: SnowAreaSpec[] = [
  { key: 'plow', label: 'Plow area', short: 'Plow area', hex: '#2f7fd4', counts: true, marker: false },
  { key: 'shovel', label: 'Shovel area', short: 'Shovel area', hex: '#2fa855', counts: true, marker: false },
  { key: 'storage', label: 'Proposed snow storage', short: 'Proposed storage', hex: '#e0a52a', counts: false, marker: false },
  { key: 'hazard', label: 'Marked hazard', short: 'Hazard', hex: '#cc3b34', counts: false, marker: true },
];

export const areaSpec = (p: SnowAreaPurpose | undefined): SnowAreaSpec | undefined =>
  SNOW_AREAS.find(a => a.key === p);

// A ring with NO purpose is a lawn-tool ring: serviced by default, which is
// exactly how the measuring tool behaved before purposes existed.
export const ringCounts = (r: MeasureRing): boolean => {
  const spec = areaSpec(r.purpose);
  return spec ? spec.counts : true;
};

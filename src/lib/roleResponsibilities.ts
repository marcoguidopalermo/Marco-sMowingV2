// RoleMaster v1.7 — "Belongs to" resolution. A duty's display chip resolves
// from whichever is set: its responsibility (name + color) if linked, else its
// plain category tag, else nothing. Single place so every chip surface (task
// list, Duties chart, Directory, RoleInstance modal) resolves identically.
import { RoleMasterDuty, RoleMasterResponsibility } from '../types';
import { CATEGORY_PALETTE, categoryColor, CatColor } from './roleCategories';

const BY_KEY: Record<string, CatColor> = Object.fromEntries(CATEGORY_PALETTE.map(c => [c.key, c]));

// A responsibility's palette color — its stored key if valid, else a stable
// deterministic fallback from its name (so it always has a color).
export function responsibilityColor(resp: Pick<RoleMasterResponsibility, 'color' | 'name'>): CatColor {
  if (resp.color && BY_KEY[resp.color]) return BY_KEY[resp.color];
  return categoryColor(resp.name || '');
}

export interface DutyChip { label: string; color: CatColor; kind: 'responsibility' | 'category'; }

// Resolve the belongs-to chip for a duty. Responsibility wins (and its
// category is ignored, per the XOR rule); if the linked responsibility is
// missing (e.g. deleted) we fall back to the category tag so nothing vanishes;
// if neither, null (no chip).
export function dutyChip(
  duty: Pick<RoleMasterDuty, 'responsibilityId' | 'category'>,
  responsibilities: Record<string, RoleMasterResponsibility> | undefined,
  categoryColors: Record<string, string> | undefined,
): DutyChip | null {
  if (duty.responsibilityId) {
    const r = responsibilities?.[duty.responsibilityId];
    if (r) return { label: r.name, color: responsibilityColor(r), kind: 'responsibility' };
    // linked responsibility gone → fall through to category
  }
  const cat = (duty.category || '').trim();
  if (cat) return { label: cat, color: categoryColor(cat, categoryColors), kind: 'category' };
  return null;
}

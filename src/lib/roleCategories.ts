// RoleMaster category colors. A fixed palette (app-consistent tokens), an
// admin-editable category→colorKey map (stored compactly in AppSettings),
// and a deterministic fallback so any category always has a color. Amber and
// red are DELIBERATELY excluded — those belong to the task-row urgency
// gradient, which must stay the dominant signal; category color is a chip.
export interface CatColor { key: string; label: string; chip: string; dot: string; }

export const CATEGORY_PALETTE: CatColor[] = [
  { key: 'indigo', label: 'Indigo', chip: 'bg-indigo-100 text-indigo-700 border-indigo-200', dot: 'bg-indigo-500' },
  { key: 'emerald', label: 'Emerald', chip: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  { key: 'sky', label: 'Sky', chip: 'bg-sky-100 text-sky-700 border-sky-200', dot: 'bg-sky-500' },
  { key: 'violet', label: 'Violet', chip: 'bg-violet-100 text-violet-700 border-violet-200', dot: 'bg-violet-500' },
  { key: 'teal', label: 'Teal', chip: 'bg-teal-100 text-teal-700 border-teal-200', dot: 'bg-teal-500' },
  { key: 'fuchsia', label: 'Fuchsia', chip: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200', dot: 'bg-fuchsia-500' },
  { key: 'cyan', label: 'Cyan', chip: 'bg-cyan-100 text-cyan-700 border-cyan-200', dot: 'bg-cyan-500' },
  { key: 'slate', label: 'Slate', chip: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-500' },
];

const BY_KEY: Record<string, CatColor> = Object.fromEntries(CATEGORY_PALETTE.map(c => [c.key, c]));

function hashIdx(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % CATEGORY_PALETTE.length;
}

// The palette entry for a category — the stored assignment if present, else a
// deterministic default (so unmapped/legacy categories still get a stable color).
export function categoryColor(category: string, map?: Record<string, string>): CatColor {
  const key = map?.[category];
  if (key && BY_KEY[key]) return BY_KEY[key];
  return CATEGORY_PALETTE[hashIdx(category || '')];
}

// The explicit palette entry for a stored key, or null when the key is
// absent/unknown. Unlike categoryColor(), this never hash-falls-back — used
// where "no colour" must stay meaningfully empty (e.g. optional task colour).
export function paletteEntry(key: string | null | undefined): CatColor | null {
  return key && BY_KEY[key] ? BY_KEY[key] : null;
}

// The least-used palette colour across the given assignments — the colour
// to hand a brand-new PERSON so identity colours stay evenly distributed
// (new people cycle rather than piling onto the same colour). Ties break in
// palette order. Unknown/empty keys are ignored.
export function nextPersonColorKey(usedKeys: (string | null | undefined)[]): string {
  const counts = new Map(CATEGORY_PALETTE.map(c => [c.key, 0]));
  for (const k of usedKeys) if (k && counts.has(k)) counts.set(k, (counts.get(k) || 0) + 1);
  let best = CATEGORY_PALETTE[0].key;
  let bestN = Infinity;
  for (const c of CATEGORY_PALETTE) {
    const n = counts.get(c.key) ?? 0;
    if (n < bestN) { bestN = n; best = c.key; }
  }
  return best;
}

// The next palette color not already assigned to another category — the
// default for a brand-new category. Falls back to round-robin if all used.
export function nextUnusedColorKey(map: Record<string, string>): string {
  const used = new Set(Object.values(map || {}));
  const free = CATEGORY_PALETTE.find(c => !used.has(c.key));
  return (free || CATEGORY_PALETTE[Object.keys(map || {}).length % CATEGORY_PALETTE.length]).key;
}

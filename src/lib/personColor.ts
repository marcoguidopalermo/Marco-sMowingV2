// Consistent per-person color. Hashes a stable key (email or id) to one
// of 8 Tailwind `bg-*-500` classes so the same person always gets the
// same color — used for assignee avatars/chips across the app.
//
// This is the single source of truth for the hash-to-color logic that
// previously lived duplicated in AssigneeBadge (hashColor) and
// MechanicBoard (hashColorFor). The palette + algorithm are identical to
// those, so existing colors do not change.

export const PERSON_COLOR_PALETTE = [
  'bg-emerald-500',
  'bg-sky-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-violet-500',
  'bg-cyan-500',
  'bg-pink-500',
  'bg-orange-500',
];

// Returns a stable `bg-*-500` class for the given key (email/id), or
// `bg-slate-400` when the key is empty.
export function personColor(key: string | null | undefined): string {
  if (!key) return 'bg-slate-400';
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return PERSON_COLOR_PALETTE[Math.abs(h) % PERSON_COLOR_PALETTE.length];
}

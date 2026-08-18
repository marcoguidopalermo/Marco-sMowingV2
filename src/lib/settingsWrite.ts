// SETTINGS WRITES — turning an intended settings object into a per-key change.
//
// settings is a flat map of eight independent sub-settings that share nothing
// but the field name: the capacity calendar, the SalesMaster rate sheet, the
// ContractingMaster rate card and its audit trail, the RoleMaster category
// colours, the end-of-day reminder. Twelve call sites write it and every one
// of them touches exactly ONE key, spreading the rest of the map from memory:
//
//     syncToCloud({ ...appData, settings: { ...appData.settings, capacity } })
//
// So editing the capacity calendar rewrites the rate card too, from whatever
// the editing client happened to be holding. Two admins on two screens revert
// each other, and any client with a stale map reverts both. It also carries
// crewSizeAllowance, an input to the efficiency and bonus calculation, which
// makes this a pay surface.
//
// A map of independent keys wants a per-key delta rather than the whole-object
// delta the roster gets: only the keys this edit actually changed are written,
// as dotted field paths ('settings.capacity'), so Firestore merges them into
// the server's map and leaves every other key alone.

export interface SettingsUpdate {
  /** Dotted field paths → value, ready for updateDoc. Empty when noop/refused. */
  patch: Record<string, unknown>;
  /** Keys this edit adds or modifies. */
  changed: string[];
  /** Keys this edit intends to delete. Reported even when the update is refused. */
  removed: string[];
  /** Set when the update was refused outright; patch is then empty. */
  refused?: 'mass-removal' | 'unsafe-key';
  /** Keys whose names cannot be expressed as a field path. */
  unsafeKeys: string[];
  /** True when nothing would change on the server — the caller can skip the write. */
  noop: boolean;
}

// A settings key reaches Firestore as part of a dotted path, so a key
// containing '.' or '`' would silently address a DIFFERENT field. Every real
// key is a plain identifier; anything else is a bug or an injection and the
// whole update is refused rather than partially applied.
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Deleting most of settings at once is the shape of a client that fell back to
// its coded default (`{ endOfDayReminder }`), not of an admin changing a
// setting. Real edits add or change keys; they almost never remove one.
const MASS_REMOVAL_FRACTION = 0.5;
const MASS_REMOVAL_FLOOR = 4;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const keysOf = (o: Record<string, unknown> | null | undefined): string[] =>
  (o && typeof o === 'object' ? Object.keys(o) : []).filter((k) => o![k] !== undefined);

export function computeSettingsUpdate(input: {
  /** settings as the server last reported it. */
  server: Record<string, unknown> | null | undefined;
  /** settings as it was when the editor opened the screen. */
  baseline: Record<string, unknown> | null | undefined;
  /** settings the editor now intends. */
  next: Record<string, unknown> | null | undefined;
  /** Field name the map lives under. */
  fieldName?: string;
}): SettingsUpdate {
  const field = input.fieldName || 'settings';
  const server = (input.server || {}) as Record<string, unknown>;
  const base = (input.baseline || {}) as Record<string, unknown>;
  const next = (input.next || {}) as Record<string, unknown>;

  // CHANGED AGAINST THE BASELINE, not against the server: a key the editor
  // never touched is not part of this edit, so a concurrent change to it
  // survives. A key that matches the baseline but differs on the server is
  // somebody else's newer value — leave it be.
  const changed = keysOf(next).filter((k) => !same(base[k], next[k]));
  const removed = keysOf(base).filter((k) => next[k] === undefined);

  const unsafeKeys = [...changed, ...removed].filter((k) => !SAFE_KEY.test(k));
  if (unsafeKeys.length > 0) {
    return { patch: {}, changed, removed, refused: 'unsafe-key', unsafeKeys, noop: false };
  }

  // Only removals that would actually take something off the server count.
  const serverKeys = keysOf(server);
  const actuallyRemoved = removed.filter((k) => server[k] !== undefined);
  if (
    serverKeys.length >= MASS_REMOVAL_FLOOR
    && actuallyRemoved.length > Math.floor(serverKeys.length * MASS_REMOVAL_FRACTION)
  ) {
    return { patch: {}, changed, removed, refused: 'mass-removal', unsafeKeys, noop: false };
  }

  const patch: Record<string, unknown> = {};
  for (const k of changed) patch[`${field}.${k}`] = next[k];
  // Removals are reported as paths with an undefined value; the caller
  // substitutes deleteField(), which this module cannot import.
  for (const k of actuallyRemoved) patch[`${field}.${k}`] = undefined;

  const noop = changed.length === 0 && actuallyRemoved.length === 0;
  return { patch, changed, removed, unsafeKeys, noop };
}

// KEYED-MAP WRITES — turning an intended map into a per-KEY change.
//
// Several fields on the main document are maps whose keys are independent of
// one another and whose values are whole records:
//
//   settings            8 keys   the capacity calendar, the SalesMaster rate
//                                sheet, the ContractingMaster rate card and its
//                                audit trail, crewSizeAllowance (a pay input)
//   visitBHSplits      34 keys   per-visit BH attribution across crews — PAY
//   mechanicPayChunks   9 keys   mechanic payouts — PAY
//
// Every call site that writes one of these changes exactly ONE key and spreads
// the rest from memory:
//
//     syncToCloud({ ...appData, settings: { ...appData.settings, capacity } })
//
// So editing the capacity calendar rewrites the rate card too, from whatever
// that client happened to be holding; splitting one visit's hours rewrites the
// other thirty-three. Two people on two screens revert each other, and any
// client holding a stale map reverts both.
//
// The fix is a per-key delta: only the keys this edit actually changed get
// written, each as its own field path, so Firestore merges them into the
// server's map and leaves every other key alone.
//
// KEYS COME BACK AS LITERAL STRINGS, never as dotted paths. Two of these maps
// are keyed by ids that are NOT valid unquoted path segments — Jobber visit
// gids are base64 and end in '=' ('Z2lkOi8vSm9iYmVyL1Zpc2l0LzIxODIwNTI5Mzg='),
// and chunk ids contain hyphens ('chunk-1780585036648-k2bxi-0'). The caller
// pairs each key with its field name through Firestore's FieldPath, which takes
// literal segments and parses nothing, so any key is safe.

export interface KeyedMapUpdate {
  /** Keys this edit adds or modifies, with the values to write. */
  changed: string[];
  /** Keys this edit intends to delete. Reported even when the update is refused. */
  removed: string[];
  /** Of `removed`, the ones actually still present on the server. */
  removedOnServer: string[];
  /** Set when the update was refused outright; the caller must write nothing. */
  refused?: 'mass-removal' | 'unusable-key';
  /** Keys that cannot be addressed at all. */
  unusableKeys: string[];
  /** True when nothing would change on the server — the caller can skip the write. */
  noop: boolean;
}

// FieldPath makes almost any key safe, but an empty segment is rejected by
// Firestore itself and would fail the whole write. Catch it here, where the
// refusal can be explained, rather than as an opaque SDK error.
const usableKey = (k: string): boolean => typeof k === 'string' && k.length > 0;

// Deleting most of a map at once is the shape of a client that fell back to a
// coded default, not of somebody changing a setting or splitting a visit. Real
// edits add or change keys; they rarely remove one, and never most.
const MASS_REMOVAL_FRACTION = 0.5;
const MASS_REMOVAL_FLOOR = 4;   // below this, "over half" is noise

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const presentKeys = (o: Record<string, unknown> | null | undefined): string[] =>
  (o && typeof o === 'object' ? Object.keys(o) : []).filter((k) => o![k] !== undefined);

export function computeKeyedMapUpdate(input: {
  /** The map as the server last reported it. */
  server: Record<string, unknown> | null | undefined;
  /** The map as it was when the editor opened the screen. */
  baseline: Record<string, unknown> | null | undefined;
  /** The map the editor now intends. */
  next: Record<string, unknown> | null | undefined;
  /** Skip the mass-removal refusal. Only for a map whose writer legitimately rebuilds it. */
  allowBulkRemoval?: boolean;
}): KeyedMapUpdate {
  const server = (input.server || {}) as Record<string, unknown>;
  const base = (input.baseline || {}) as Record<string, unknown>;
  const next = (input.next || {}) as Record<string, unknown>;

  // CHANGED AGAINST THE BASELINE, not against the server: a key the editor
  // never touched is not part of this edit, so a concurrent change to it
  // survives. A key matching the baseline but differing on the server is
  // somebody else's newer value — leave it alone.
  const changed = presentKeys(next).filter((k) => !same(base[k], next[k]));
  const removed = presentKeys(base).filter((k) => next[k] === undefined);

  const unusableKeys = [...changed, ...removed].filter((k) => !usableKey(k));
  if (unusableKeys.length > 0) {
    return {
      changed, removed, removedOnServer: [],
      refused: 'unusable-key', unusableKeys, noop: false,
    };
  }

  // Only removals that would actually take something off the server count.
  const serverKeys = presentKeys(server);
  const removedOnServer = removed.filter((k) => server[k] !== undefined);
  if (
    !input.allowBulkRemoval
    && serverKeys.length >= MASS_REMOVAL_FLOOR
    && removedOnServer.length > Math.floor(serverKeys.length * MASS_REMOVAL_FRACTION)
  ) {
    return {
      changed, removed, removedOnServer,
      refused: 'mass-removal', unusableKeys, noop: false,
    };
  }

  return {
    changed, removed, removedOnServer, unusableKeys,
    noop: changed.length === 0 && removedOnServer.length === 0,
  };
}

// Apply an update to the map the server last reported, so the caller can keep
// its tracking ref in step without waiting for the snapshot. Only the changed
// keys move; everything else stays exactly as the server reported it.
export function applyKeyedMapUpdate(
  server: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
  update: KeyedMapUpdate,
): Record<string, unknown> {
  const merged = { ...(server || {}) };
  for (const k of update.changed) merged[k] = (next || {})[k];
  for (const k of update.removedOnServer) delete merged[k];
  return merged;
}

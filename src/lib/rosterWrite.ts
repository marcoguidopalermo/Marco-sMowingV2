// EMPLOYEE ROSTER WRITES — turning an editor's intended roster into a safe,
// minimal change against whatever the server currently holds.
//
// The roster is the highest-consequence field on the main document. It carries
// payMode and hourlyRate (what somebody is paid) and linkedUserEmail (which
// auth account is which person). It is also read by nearly every screen, so it
// rides along in the ~80 call sites that save with `...appData` — none of which
// intend to touch it. A client holding a roster from ten minutes ago silently
// reverts a pay-rate change by logging a repair.
//
// The fix has two halves, and this module is the second:
//   1. Incidental saves stop carrying the roster at all. The doc payload takes
//      the roster the SERVER last reported, so a save that didn't mean to touch
//      it writes back what is already there.
//   2. Deliberate edits come through here: a per-record delta against the
//      baseline the editor started from, applied to the server's current array.
//      Two admins editing different people therefore both land.
//
// Same shape as computeAllowlistUpdate in authGate — see there for the
// reasoning about deltas over "write what's on my screen".

export interface RosterRecord {
  id: string;
}

export interface RosterUpdate<T extends RosterRecord> {
  finalList: T[];
  /** Records created or modified by this edit, by id. */
  upserted: string[];
  /** Ids this edit intends to remove. Reported even when the removal is refused. */
  removed: string[];
  /** Set when the whole update was refused; finalList is then the server's, unchanged. */
  refused?: 'empty-result' | 'mass-removal';
  /** Ids the edit tried to remove that were already gone from the server. */
  alreadyGone: string[];
  /** True when nothing would change on the server — the caller can skip the write. */
  noop: boolean;
}

// Refuse an edit that removes most of the roster in one go. Real removals are
// one or two people at a time (someone leaves); anything wholesale is a stale
// or defaulted client, which is the failure mode this module exists for.
const MASS_REMOVAL_FRACTION = 0.5;
const MASS_REMOVAL_FLOOR = 4;   // below this a "half the roster" test is noise

const byId = <T extends RosterRecord>(list: T[]): Map<string, T> => {
  const m = new Map<string, T>();
  for (const r of list) if (r && typeof r.id === 'string' && r.id) m.set(r.id, r);
  return m;
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function computeRosterUpdate<T extends RosterRecord>(input: {
  /** The roster as the server last reported it. */
  serverList: T[];
  /** The roster as it was when the editor opened the screen. */
  baseline: T[];
  /** The roster the editor now intends. */
  next: T[];
}): RosterUpdate<T> {
  const server = byId(input.serverList);
  const base = byId(input.baseline);
  const next = byId(input.next);

  // CHANGED, not "everything on screen": a record identical to the baseline is
  // not part of this edit, so it can't overwrite a concurrent change to it.
  const upserted: string[] = [];
  for (const [id, rec] of next) if (!same(base.get(id), rec)) upserted.push(id);
  const removed = [...base.keys()].filter((id) => !next.has(id));

  const alreadyGone = removed.filter((id) => !server.has(id));

  // Apply to the SERVER's array, preserving its order. Existing records are
  // replaced in place so the directory doesn't reshuffle under an edit; genuinely
  // new ones append, which is what "+ Add employee" has always done.
  const merged = new Map(server);
  for (const id of upserted) {
    const rec = next.get(id);
    if (rec) merged.set(id, rec);       // Map.set keeps an existing key's position
  }
  for (const id of removed) merged.delete(id);
  const finalList = [...merged.values()];

  // An empty roster is nobody employed: no pay, no crews, no linked accounts.
  // Never a legitimate edit.
  if (finalList.length === 0) {
    return {
      finalList: input.serverList, upserted, removed,
      refused: 'empty-result', alreadyGone, noop: false,
    };
  }
  const serverSize = server.size;
  const actuallyRemoved = removed.length - alreadyGone.length;
  if (
    serverSize >= MASS_REMOVAL_FLOOR
    && actuallyRemoved > Math.floor(serverSize * MASS_REMOVAL_FRACTION)
  ) {
    return {
      finalList: input.serverList, upserted, removed,
      refused: 'mass-removal', alreadyGone, noop: false,
    };
  }

  const noop = upserted.length === 0 && actuallyRemoved === 0;
  return { finalList, upserted, removed, alreadyGone, noop };
}

// ── ADMIN EMAILS ───────────────────────────────────────────────────────────
// Derived from the roster and written with it, because a Firestore rule cannot
// search an array of employee maps for systemRole === 'admin' — and the rule
// protecting efficiency adjustments (which feed bonus) needs to identify an
// admin without the app's help.
//
// It lives here, next to the only path that changes the roster, so the two are
// written in one update and cannot drift. A stale admin list is not a cosmetic
// problem: it is either a lockout or an unintended grant.
export function adminEmailsFrom(
  employees: { systemRole?: string; linkedUserEmail?: string; email?: string }[] | undefined,
): string[] {
  const out = new Set<string>();
  for (const e of employees || []) {
    if (!e || e.systemRole !== 'admin') continue;
    const addr = (e.linkedUserEmail || e.email || '').trim().toLowerCase();
    if (addr) out.add(addr);
  }
  return [...out].sort();
}

// PUNCH OUTBOX — a self-punch is kept on the device until the server has it.
//
// Why this exists. Firestore's web SDK here runs with its default MEMORY cache:
// a write that has not reached the server lives only in the page's memory. A
// phone that suspends or kills the app in that window loses the punch with no
// trace anywhere — and the clock buttons used to say "Clocked in." before the
// write had landed at all. That is the likeliest shape of Kris Leupen's
// "I clocked in, and at clock-out it said I never was".
//
// The rule now:
//   1. The punch is written to localStorage BEFORE the network write starts.
//      localStorage is synchronous, so once the tap handler has run the punch
//      survives the app being killed.
//   2. The network write is awaited, with a deadline.
//        acknowledged   -> 'saved'   (removed from the outbox)
//        refused        -> 'failed'  (removed; the caller rolls back and the
//                                     person is told — a rejection is the
//                                     server saying no, and retrying the same
//                                     write will not change its mind)
//        still waiting  -> 'pending' (KEPT; the write carries on, and anything
//                                     left over is replayed on the next launch,
//                                     reconnect or foregrounding)
//   3. Replay never overwrites somebody else's correction: see reconcileQueued.
//
// Writes are by punch id, so replaying one that did land is idempotent.
import type { TimeEntry } from '../types';

export const PUNCH_OUTBOX_KEY = 'crewmaster.punchOutbox.v1';
export const PUNCH_ACK_TIMEOUT_MS = 10_000;

export type PunchSaveResult = 'saved' | 'pending' | 'failed';

export interface QueuedPunch {
  entry: TimeEntry;
  queuedAt: number;
  lastError?: string;
}

export interface OutboxStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function readOutbox(storage: OutboxStorage | null): Record<string, QueuedPunch> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(PUNCH_OUTBOX_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function writeOutbox(storage: OutboxStorage | null, box: Record<string, QueuedPunch>): boolean {
  if (!storage) return false;
  try { storage.setItem(PUNCH_OUTBOX_KEY, JSON.stringify(box)); return true; } catch { return false; }
}

// What to do with a queued punch, given what the server holds for that id.
//   deleted on purpose        -> drop (never resurrect a removed punch)
//   server has nothing        -> write the queued punch
//   server already matches    -> drop (it landed)
//   server has it OPEN and the queued copy is closed
//                             -> write the server copy plus the clock-out
//   anything else             -> drop; the server copy was changed by somebody
//                                (an edit, a manager correction) and wins
export function reconcileQueued(
  queued: TimeEntry, server: TimeEntry | null, deleted: boolean,
): { action: 'write'; entry: TimeEntry } | { action: 'drop'; why: string } {
  if (deleted) return { action: 'drop', why: 'deleted' };
  if (!server) return { action: 'write', entry: queued };
  if (same(server, queued)) return { action: 'drop', why: 'already saved' };
  // The server's copy is kept (a manager may have corrected the start while
  // this phone was offline); only the stop is carried over.
  if (!server.clockOut && queued.clockOut) {
    const stop: Partial<TimeEntry> = { clockOut: queued.clockOut };
    if (queued.outLocation) stop.outLocation = queued.outLocation;
    if (queued.workNote) stop.workNote = queued.workNote;
    return { action: 'write', entry: { ...server, ...stop } };
  }
  return { action: 'drop', why: 'changed on the server' };
}

// Overlay what is still queued on this device onto the server's list, so an
// unsent clock-in still shows as clocked in after a reload — otherwise the app
// would say "not clocked in" about a punch it is holding.
export function overlayQueued(
  serverList: TimeEntry[], box: Record<string, QueuedPunch>, deletedIds: Set<string>,
): TimeEntry[] {
  const items = Object.values(box);
  if (items.length === 0) return serverList;
  const byId = new Map(serverList.map(e => [e.id, e] as const));
  for (const q of items) {
    const r = reconcileQueued(q.entry, byId.get(q.entry.id) || null, deletedIds.has(q.entry.id));
    if (r.action === 'write') byId.set(q.entry.id, r.entry);
  }
  return [...byId.values()].sort((a, b) => String(b.clockIn || '').localeCompare(String(a.clockIn || '')));
}

async function withDeadline(p: Promise<void>, ms: number): Promise<'done' | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p.then(() => 'done' as const),
      new Promise<'timeout'>(res => { timer = setTimeout(() => res('timeout'), ms); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

export interface PunchOutbox {
  save(entry: TimeEntry): Promise<PunchSaveResult>;
  replay(opts: {
    readServer: (id: string) => Promise<TimeEntry | null>;
    isDeleted: (id: string) => boolean;
  }): Promise<{ written: number; dropped: number; stillQueued: number }>;
  queued(): QueuedPunch[];
}

export function createPunchOutbox(deps: {
  storage: OutboxStorage | null;
  write: (entry: TimeEntry) => Promise<void>;
  onChange?: (queued: QueuedPunch[]) => void;
  timeoutMs?: number;
  now?: () => number;
}): PunchOutbox {
  const timeoutMs = deps.timeoutMs ?? PUNCH_ACK_TIMEOUT_MS;
  const now = deps.now ?? (() => Date.now());
  // In-memory mirror for when storage is unavailable (private mode). Worse —
  // it does not survive a kill — but the banner still tells the truth.
  let memory: Record<string, QueuedPunch> = readOutbox(deps.storage);
  let storageWorks = !!deps.storage;
  const load = () => (storageWorks ? readOutbox(deps.storage) : { ...memory });
  const store = (box: Record<string, QueuedPunch>) => {
    memory = box;
    // A failed setItem (quota, private mode) must not leave load() reading a
    // stale copy: from then on this session trusts memory.
    if (storageWorks && !writeOutbox(deps.storage, box)) storageWorks = false;
    deps.onChange?.(Object.values(box));
  };
  // Remove only if what is queued is still the version this write carried; a
  // clock-out queued while the clock-in was in flight must not be discarded
  // when the clock-in's acknowledgement arrives.
  const settle = (entry: TimeEntry) => {
    const box = load();
    if (box[entry.id] && same(box[entry.id].entry, entry)) { delete box[entry.id]; store(box); }
  };
  const put = (entry: TimeEntry, lastError?: string) => {
    const box = load();
    box[entry.id] = { entry, queuedAt: box[entry.id]?.queuedAt ?? now(), ...(lastError ? { lastError } : {}) };
    store(box);
  };

  const save = async (entry: TimeEntry): Promise<PunchSaveResult> => {
    const prior = load()[entry.id];
    put(entry);
    const write = deps.write(entry);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      write.then(() => 'saved' as const, (err: unknown) => ({ err })),
      new Promise<'pending'>(res => { timer = setTimeout(() => res('pending'), timeoutMs); }),
    ]);
    if (timer) clearTimeout(timer);
    if (outcome === 'saved') { settle(entry); return 'saved'; }
    if (outcome === 'pending') {
      // The write is still in flight; clear the queue if it lands later, keep
      // the queue (with the reason) if it is eventually refused.
      write.then(() => settle(entry), (err: unknown) => {
        const box = load();
        if (box[entry.id] && same(box[entry.id].entry, entry)) put(entry, String((err as any)?.message || err));
      });
      return 'pending';
    }
    // Refused. Put back whatever was queued for this punch before (a clock-in
    // still waiting to send must survive its clock-out being refused).
    const box = load();
    if (box[entry.id] && same(box[entry.id].entry, entry)) {
      if (prior) box[entry.id] = prior; else delete box[entry.id];
      store(box);
    }
    return 'failed';
  };

  let replaying = false;
  const replay: PunchOutbox['replay'] = async ({ readServer, isDeleted }) => {
    let written = 0, dropped = 0;
    if (replaying) return { written, dropped, stillQueued: Object.keys(load()).length };
    replaying = true;
    try {
      for (const q of Object.values(load())) {
        try {
          const r = reconcileQueued(q.entry, await readServer(q.entry.id), isDeleted(q.entry.id));
          // Bounded: offline, a write never settles, and one stuck replay
          // must not block every later one. The SDK keeps sending it; the
          // next replay reads the server, sees it landed and drops it.
          if (r.action === 'write' && await withDeadline(deps.write(r.entry), timeoutMs) === 'timeout') continue;
          if (r.action === 'write') written++; else dropped++;
          settle(q.entry);
        } catch (err) {
          // Offline or refused: leave it queued, record why, try next time —
          // unless a newer version of this punch was queued meanwhile.
          const box = load();
          if (box[q.entry.id] && same(box[q.entry.id].entry, q.entry)) put(q.entry, String((err as any)?.message || err));
        }
      }
    } finally { replaying = false; }
    return { written, dropped, stillQueued: Object.keys(load()).length };
  };

  return { save, replay, queued: () => Object.values(load()) };
}

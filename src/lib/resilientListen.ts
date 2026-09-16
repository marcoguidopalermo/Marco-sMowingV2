// A live listener that comes back.
//
// Firestore's onSnapshot is TERMINAL on error: the error callback fires once
// and the listener is gone for good. Every listener in App used to answer that
// with console.error and nothing else, so the screen kept showing whatever
// arrived last — stale punches, stale reports — with nothing to say so and
// nothing to recover it short of a reload.
//
// resilientListen resubscribes with capped backoff and reports the stream's
// state, so the UI can say "not updating" while it is true and stop saying it
// the moment data flows again.
export type StreamStatus = 'live' | 'retrying';

export const RETRY_BACKOFF_MS = [2_000, 5_000, 10_000, 30_000, 60_000];

export function resilientListen(opts: {
  name: string;
  // Start one listener. Call markLive() from its snapshot handler and
  // onError(err) from its error handler; return its unsubscribe.
  subscribe: (markLive: () => void, onError: (err: unknown) => void) => () => void;
  onStatus?: (name: string, status: StreamStatus, err?: unknown) => void;
  backoffMs?: number[];
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): () => void {
  const backoff = opts.backoffMs ?? RETRY_BACKOFF_MS;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let stopped = false;
  let failures = 0;
  let unsub: (() => void) | null = null;
  let timer: unknown = null;
  let generation = 0;

  const start = () => {
    if (stopped) return;
    const gen = ++generation;
    const markLive = () => {
      if (stopped || gen !== generation) return;
      if (failures > 0) { failures = 0; opts.onStatus?.(opts.name, 'live'); }
    };
    const onError = (err: unknown) => {
      if (stopped || gen !== generation) return;   // one report per listener
      console.error(`${opts.name} listen error — reconnecting:`, err);
      try { unsub?.(); } catch { /* already dead */ }
      unsub = null;
      const delay = backoff[Math.min(failures, backoff.length - 1)];
      failures++;
      opts.onStatus?.(opts.name, 'retrying', err);
      timer = setTimer(() => { timer = null; start(); }, delay);
    };
    try {
      unsub = opts.subscribe(markLive, onError);
    } catch (err) {
      onError(err);
    }
  };

  start();
  return () => {
    stopped = true;
    if (timer != null) clearTimer(timer);
    try { unsub?.(); } catch { /* ignore */ }
  };
}

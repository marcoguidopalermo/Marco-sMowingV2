// Tests for resilientListen.
//   npm test -- resilientListen
//
// The failure being guarded is a listener that dies and leaves the screen
// showing old data as if it were current.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { resilientListen, type StreamStatus } from './resilientListen';

// A fake onSnapshot we can drive, and a manual timer queue.
function harness(backoffMs = [10, 20, 40]) {
  const subs: Array<{ live: () => void; fail: (e: unknown) => void; unsubbed: boolean }> = [];
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const statuses: Array<[StreamStatus, unknown]> = [];
  const stop = resilientListen({
    name: 'timeEntries',
    backoffMs,
    subscribe: (live, fail) => {
      const s = { live, fail, unsubbed: false };
      subs.push(s);
      return () => { s.unsubbed = true; };
    },
    onStatus: (_n, st, err) => statuses.push([st, err]),
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (h) => { (h as { cleared: boolean }).cleared = true; },
  });
  const fire = () => { const t = timers.shift(); if (t && !t.cleared) t.fn(); };
  return { subs, timers, statuses, stop, fire };
}

const quiet = () => { const e = console.error; console.error = () => {}; return () => { console.error = e; }; };

test('a dropped listener resubscribes instead of going quiet', () => {
  const restore = quiet();
  const h = harness();
  h.subs[0].fail(new Error('permission-denied'));
  assert.equal(h.statuses[0][0], 'retrying');
  assert.equal(h.subs.length, 1, 'waits for the backoff first');
  h.fire();
  assert.equal(h.subs.length, 2);
  restore();
});

test('it reports live again only when data actually flows', () => {
  const restore = quiet();
  const h = harness();
  h.subs[0].fail(new Error('x'));
  h.fire();
  assert.deepEqual(h.statuses.map(s => s[0]), ['retrying']);
  h.subs[1].live();
  assert.deepEqual(h.statuses.map(s => s[0]), ['retrying', 'live']);
  restore();
});

test('backoff grows and caps', () => {
  const restore = quiet();
  const h = harness([10, 20, 40]);
  const delays: number[] = [];
  for (let i = 0; i < 5; i++) {
    h.subs[h.subs.length - 1].fail(new Error('x'));
    delays.push(h.timers[0].ms);
    h.fire();
  }
  assert.deepEqual(delays, [10, 20, 40, 40, 40]);
  restore();
});

test('a healthy stream never reports anything', () => {
  const h = harness();
  h.subs[0].live(); h.subs[0].live();
  assert.deepEqual(h.statuses, []);
});

test('stopping cancels a pending retry and unsubscribes', () => {
  const restore = quiet();
  const h = harness();
  h.subs[0].fail(new Error('x'));
  h.stop();
  assert.equal(h.timers[0].cleared, true);
  h.fire();
  assert.equal(h.subs.length, 1);
  restore();
});

test('a late error from a replaced listener is ignored', () => {
  const restore = quiet();
  const h = harness();
  h.subs[0].fail(new Error('x'));
  h.fire();
  h.subs[0].fail(new Error('late'));
  assert.equal(h.statuses.length, 1);
  assert.equal(h.timers.length, 0);
  restore();
});

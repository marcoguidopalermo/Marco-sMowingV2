// Tests for the punch outbox.
//   npm test -- punchOutbox
//
// A punch is pay. These are about the ways one used to vanish without a word:
// the app killed before the write landed, a write refused while the button
// said "Clocked in.", and a replay that would quietly undo somebody's fix.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  createPunchOutbox, overlayQueued, readOutbox, reconcileQueued, PUNCH_OUTBOX_KEY,
  type OutboxStorage,
} from './punchOutbox';
import type { TimeEntry } from '../types';

const punch = (o: Partial<TimeEntry> = {}): TimeEntry => ({
  id: 't1', userEmail: 'kris@x.test', userName: 'Kris',
  clockIn: '2026-09-14T12:45:00.000Z', notes: [], ...o,
} as TimeEntry);

const memStorage = (): OutboxStorage & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
};
const never = () => new Promise<void>(() => {});
const tick = () => new Promise(r => setTimeout(r, 0));

console.log('\nSaving');
test('an acknowledged write is saved and leaves nothing queued', async () => {
  const s = memStorage();
  const box = createPunchOutbox({ storage: s, write: async () => {} });
  assert.equal(await box.save(punch()), 'saved');
  assert.deepEqual(box.queued(), []);
});

test('the punch is on the device BEFORE the network write starts', async () => {
  const s = memStorage();
  let seenAtWrite: unknown = null;
  const box = createPunchOutbox({
    storage: s,
    write: async () => { seenAtWrite = readOutbox(s)['t1']?.entry; },
  });
  await box.save(punch());
  assert.equal((seenAtWrite as TimeEntry)?.id, 't1');
});

test('no acknowledgement in time -> pending, and the punch STAYS queued (survives a kill)', async () => {
  const s = memStorage();
  const box = createPunchOutbox({ storage: s, write: never, timeoutMs: 5 });
  assert.equal(await box.save(punch()), 'pending');
  // A fresh outbox over the same storage is what a relaunched app sees.
  const relaunched = createPunchOutbox({ storage: s, write: async () => {} });
  assert.deepEqual(relaunched.queued().map(q => q.entry.id), ['t1']);
});

test('a pending write that lands later clears itself', async () => {
  const s = memStorage();
  let land!: () => void;
  const box = createPunchOutbox({ storage: s, write: () => new Promise<void>(r => { land = r; }), timeoutMs: 5 });
  assert.equal(await box.save(punch()), 'pending');
  land(); await tick();
  assert.deepEqual(box.queued(), []);
});

test('a refused write is reported as failed and not left queued', async () => {
  const s = memStorage();
  const box = createPunchOutbox({ storage: s, write: async () => { throw new Error('permission-denied'); } });
  assert.equal(await box.save(punch()), 'failed');
  assert.deepEqual(box.queued(), []);
});

test('a refused clock-out does not throw away the clock-in still waiting to send', async () => {
  const s = memStorage();
  let n = 0;
  const box = createPunchOutbox({
    storage: s, timeoutMs: 5,
    write: () => (++n === 1 ? never() : Promise.reject(new Error('refused'))),
  });
  assert.equal(await box.save(punch()), 'pending');
  assert.equal(await box.save(punch({ clockOut: '2026-09-14T20:55:00.000Z' })), 'failed');
  const q = box.queued();
  assert.equal(q.length, 1);
  assert.equal(q[0].entry.clockOut, undefined);
});

test('the clock-in acknowledgement does not discard a clock-out queued meanwhile', async () => {
  const s = memStorage();
  const lands: Array<() => void> = [];
  const box = createPunchOutbox({ storage: s, timeoutMs: 5, write: () => new Promise<void>(r => { lands.push(r); }) });
  assert.equal(await box.save(punch()), 'pending');
  assert.equal(await box.save(punch({ clockOut: '2026-09-14T20:55:00.000Z' })), 'pending');
  lands[0](); await tick();                      // the clock-in lands
  assert.equal(box.queued()[0]?.entry.clockOut, '2026-09-14T20:55:00.000Z');
});

test('storage that throws on write falls back to memory rather than a stale read', async () => {
  const s = memStorage();
  s.setItem = () => { throw new Error('quota'); };
  const box = createPunchOutbox({ storage: s, write: never, timeoutMs: 5 });
  assert.equal(await box.save(punch()), 'pending');
  assert.deepEqual(box.queued().map(q => q.entry.id), ['t1']);
});

console.log('\nReplaying');
test('replay writes a punch the server never got', async () => {
  const s = memStorage();
  s.setItem(PUNCH_OUTBOX_KEY, JSON.stringify({ t1: { entry: punch(), queuedAt: 1 } }));
  const written: TimeEntry[] = [];
  const box = createPunchOutbox({ storage: s, write: async e => { written.push(e); } });
  const r = await box.replay({ readServer: async () => null, isDeleted: () => false });
  assert.equal(r.written, 1);
  assert.equal(written[0].id, 't1');
  assert.deepEqual(box.queued(), []);
});

test('replay while offline keeps the punch queued', async () => {
  const s = memStorage();
  s.setItem(PUNCH_OUTBOX_KEY, JSON.stringify({ t1: { entry: punch(), queuedAt: 1 } }));
  const box = createPunchOutbox({ storage: s, write: async () => {} });
  const r = await box.replay({ readServer: async () => { throw new Error('client is offline'); }, isDeleted: () => false });
  assert.equal(r.stillQueued, 1);
  assert.match(box.queued()[0].lastError || '', /offline/);
});

test('a replay write that never settles does not block the next replay', async () => {
  const s = memStorage();
  s.setItem(PUNCH_OUTBOX_KEY, JSON.stringify({ t1: { entry: punch(), queuedAt: 1 } }));
  const box = createPunchOutbox({ storage: s, write: never, timeoutMs: 5 });
  const first = await box.replay({ readServer: async () => null, isDeleted: () => false });
  assert.equal(first.stillQueued, 1);
  const second = await box.replay({ readServer: async () => punch(), isDeleted: () => false });
  assert.equal(second.stillQueued, 0);
});

console.log('\nNever undoing somebody else');
test('a deleted punch is never resurrected', () => {
  assert.equal(reconcileQueued(punch(), null, true).action, 'drop');
});
test('a server copy that already matches is dropped', () => {
  assert.equal(reconcileQueued(punch(), punch(), false).action, 'drop');
});
test('a queued clock-out lands on the server copy, keeping a corrected start', () => {
  const server = punch({ clockIn: '2026-09-14T12:30:00.000Z', editedBy: 'tony@x.test' });
  const r = reconcileQueued(punch({ clockOut: '2026-09-14T20:55:00.000Z', workNote: 'roof' }), server, false);
  assert.equal(r.action, 'write');
  if (r.action !== 'write') return;
  assert.equal(r.entry.clockIn, '2026-09-14T12:30:00.000Z');
  assert.equal(r.entry.editedBy, 'tony@x.test');
  assert.equal(r.entry.clockOut, '2026-09-14T20:55:00.000Z');
  assert.equal(r.entry.workNote, 'roof');
});
test('a server copy that was closed or edited wins over the queued one', () => {
  const server = punch({ clockOut: '2026-09-14T20:00:00.000Z', editedBy: 'tony@x.test' });
  assert.equal(reconcileQueued(punch({ clockOut: '2026-09-14T20:55:00.000Z' }), server, false).action, 'drop');
});

console.log('\nShowing it');
test('an unsent clock-in still shows as clocked in after a reload', () => {
  const list = overlayQueued([], { t1: { entry: punch(), queuedAt: 1 } }, new Set());
  assert.equal(list.length, 1);
  assert.equal(list[0].clockOut, undefined);
});
test('an unsent clock-out closes the open punch on screen', () => {
  const list = overlayQueued([punch()], { t1: { entry: punch({ clockOut: '2026-09-14T20:55:00.000Z' }), queuedAt: 1 } }, new Set());
  assert.equal(list[0].clockOut, '2026-09-14T20:55:00.000Z');
});
test('a queued punch that was deleted is not shown', () => {
  assert.deepEqual(overlayQueued([], { t1: { entry: punch(), queuedAt: 1 } }, new Set(['t1'])), []);
});

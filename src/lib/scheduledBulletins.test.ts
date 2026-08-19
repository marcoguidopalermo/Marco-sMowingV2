// Tests for scheduled bulletins.
//   npm test -- scheduledBulletins
//
// The failure this must not have: a queued bulletin that silently never
// appears. So visibility is derived from the clock, and the tests below check
// that no stored flag can suppress it.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  canEditScheduled, canSeeScheduled, hourIsQuiet, isPublished, isScheduled,
  quietHoursNotice, splitBulletins,
} from './scheduledBulletins';
import type { BulletinPost } from '../types';

const NOW = Date.parse('2026-08-19T14:00:00Z');
const H = 3_600_000;

const b = (o: Partial<BulletinPost> & { id: string }): BulletinPost => ({
  title: 'T', content: 'C', date: '2026-08-19', author: 'marco@x.test', ...o,
} as BulletinPost);

console.log('\nQueued vs live');
test('a future post time means queued; a past one means live', () => {
  assert.equal(isScheduled(b({ id: '1', publishAt: NOW + H }), NOW), true);
  assert.equal(isScheduled(b({ id: '2', publishAt: NOW - H }), NOW), false);
  assert.equal(isPublished(b({ id: '2', publishAt: NOW - H }), NOW), true);
});
test('a bulletin with no post time is live, as bulletins always were', () => {
  assert.equal(isScheduled(b({ id: '3' }), NOW), false);
  assert.equal(isPublished(b({ id: '3' }), NOW), true);
});
test('the exact moment counts as published, not still queued', () => {
  assert.equal(isScheduled(b({ id: '4', publishAt: NOW }), NOW), false);
});
test('a nonsense post time is treated as live rather than hiding forever', () => {
  for (const v of [NaN, Infinity, undefined, null as any, 'soon' as any]) {
    assert.equal(isScheduled(b({ id: 'x', publishAt: v }), NOW), false,
      `publishAt=${String(v)} must not hide the bulletin`);
  }
});
test('THE INVARIANT: no stored flag can suppress a bulletin whose time has come', () => {
  // published:false is a lie a stale whole-document save could reintroduce.
  // Visibility ignores it entirely.
  const stale = b({ id: '5', publishAt: NOW - H, published: false });
  assert.equal(isPublished(stale, NOW), true);
  assert.equal(splitBulletins([stale], NOW, 'nobody@x.test', false).live.length, 1);
});

console.log('\nWho sees a queued bulletin');
test('the author sees their own', () => {
  assert.equal(canSeeScheduled(b({ id: '1' }), 'marco@x.test', false), true);
  assert.equal(canSeeScheduled(b({ id: '1' }), ' MARCO@X.TEST ', false), true);
});
test('an admin sees everybody’s', () => {
  assert.equal(canSeeScheduled(b({ id: '1', author: 'tony@x.test' }), 'someone@x.test', true), true);
});
test('nobody else sees it at all', () => {
  assert.equal(canSeeScheduled(b({ id: '1' }), 'worker@x.test', false), false);
  assert.equal(canSeeScheduled(b({ id: '1' }), '', false), false);
  assert.equal(canSeeScheduled(b({ id: '1' }), null, false), false);
});
test('an author-less bulletin is not claimable by a blank viewer', () => {
  assert.equal(canSeeScheduled(b({ id: '1', author: '' }), '', false), false);
});

console.log('\nSplitting the board');
const LIST = [
  b({ id: 'live1', publishAt: NOW - 2 * H }),
  b({ id: 'plain' }),
  b({ id: 'mine', publishAt: NOW + 2 * H }),
  b({ id: 'soon', publishAt: NOW + H }),
  b({ id: 'theirs', publishAt: NOW + 3 * H, author: 'tony@x.test' }),
];
test('the author sees their queued ones, soonest first, and not other people’s', () => {
  const s = splitBulletins(LIST, NOW, 'marco@x.test', false);
  assert.deepEqual(s.scheduled.map(x => x.id), ['soon', 'mine']);
  assert.deepEqual(s.live.map(x => x.id), ['live1', 'plain']);
});
test('an admin sees every queued bulletin', () => {
  const s = splitBulletins(LIST, NOW, 'admin@x.test', true);
  assert.deepEqual(s.scheduled.map(x => x.id), ['soon', 'mine', 'theirs']);
});
test('a worker sees only the live board — queued ones vanish entirely', () => {
  const s = splitBulletins(LIST, NOW, 'worker@x.test', false);
  assert.deepEqual(s.scheduled, []);
  assert.deepEqual(s.live.map(x => x.id), ['live1', 'plain']);
});
test('a queued bulletin a viewer may not see never leaks into the live list', () => {
  const s = splitBulletins(LIST, NOW, 'worker@x.test', false);
  assert.ok(!s.live.some(x => ['mine', 'soon', 'theirs'].includes(x.id)));
});
test('an empty or missing list is handled', () => {
  assert.deepEqual(splitBulletins([], NOW, 'a@x.test', true), { live: [], scheduled: [] });
  assert.deepEqual(splitBulletins(undefined, NOW, 'a@x.test', true), { live: [], scheduled: [] });
});

console.log('\nEditable until it goes');
test('a queued bulletin is editable by its author and by an admin', () => {
  const q = b({ id: '1', publishAt: NOW + H });
  assert.equal(canEditScheduled(q, NOW, 'marco@x.test', false), true);
  assert.equal(canEditScheduled(q, NOW, 'other@x.test', true), true);
});
test('once published it is an ordinary bulletin — this path no longer applies', () => {
  const gone = b({ id: '1', publishAt: NOW - 1 });
  assert.equal(canEditScheduled(gone, NOW, 'marco@x.test', false), false);
  assert.equal(canEditScheduled(gone, NOW, 'admin@x.test', true), false);
});
test('a non-author non-admin cannot edit a queued bulletin', () => {
  assert.equal(canEditScheduled(b({ id: '1', publishAt: NOW + H }), NOW, 'worker@x.test', false), false);
});

console.log('\nQuiet hours');
test('8pm through 7am are quiet; the working day is not', () => {
  for (const h of [20, 21, 23, 0, 3, 6, 7]) assert.equal(hourIsQuiet(h), true, `${h}:00`);
  for (const h of [8, 9, 12, 17, 19]) assert.equal(hourIsQuiet(h), false, `${h}:00`);
});
test('scheduling FOR 6am with notify on warns that the push lands at 8', () => {
  const n = quietHoursNotice({ publishAt: NOW, notify: true, hour: 6 });
  assert.ok(n);
  assert.match(n!, /appear on the board exactly when you scheduled it/);
  assert.match(n!, /8:00 AM/);
});
test('no warning when the time is inside working hours', () => {
  assert.equal(quietHoursNotice({ publishAt: NOW, notify: true, hour: 9 }), null);
});
test('no warning when no notification was asked for — nothing is held', () => {
  assert.equal(quietHoursNotice({ publishAt: NOW, notify: false, hour: 3 }), null);
});
test('an unusable time produces no warning rather than a misleading one', () => {
  assert.equal(quietHoursNotice({ publishAt: NaN, notify: true, hour: 3 }), null);
});

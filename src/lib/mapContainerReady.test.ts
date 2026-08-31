// Guarding map creation against a zero-size container.
//   npm test -- mapContainerReady
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { hasSize, waitForSize } from './mapContainerReady';

const el = (w: number, h: number) => ({ offsetWidth: w, offsetHeight: h } as HTMLElement);

console.log('\nTHE BUG: a container with no dimensions renders no tiles');
test('a zero-height box does not count as ready', () => {
  assert.equal(hasSize(el(800, 0)), false, 'flex-1 min-h-0 can compute to exactly this');
  assert.equal(hasSize(el(0, 600)), false);
  assert.equal(hasSize(el(0, 0)), false);
});
test('a laid-out box counts as ready', () => {
  assert.equal(hasSize(el(800, 600)), true);
});
test('a missing element is never ready', () => {
  assert.equal(hasSize(null), false);
  assert.equal(hasSize(undefined), false);
});

console.log('\nwaitForSize resolves rather than hanging');
test('an element that already has size resolves immediately, and true', async () => {
  assert.equal(await waitForSize(el(800, 600)), true);
});
test('a null element resolves false instead of hanging the open', async () => {
  assert.equal(await waitForSize(null, 10), false);
});
test('a box that never gains size resolves FALSE on the deadline', async () => {
  // The caller then builds the map anyway and relies on the ResizeObserver —
  // strictly better than never showing a map.
  const started = Date.now();
  assert.equal(await waitForSize(el(0, 0), 40), false);
  assert.ok(Date.now() - started >= 30, 'it waited rather than giving up at once');
});

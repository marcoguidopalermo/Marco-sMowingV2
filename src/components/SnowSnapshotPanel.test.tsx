import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SnowSales from './SnowSales';
import type { SnowSnapshot } from '../lib/sales/snapshots';

const S = (date: string, contracts: number, totalValue: number, extra: Partial<SnowSnapshot> = {}): SnowSnapshot => ({ date, season: '2026/2027', contracts, totalValue, enteredBy: 'Marco Palermo', source: 'manual', savedAt: Date.parse(`${date}T11:30:00Z`), ...extra });
const html = (snaps: SnowSnapshot[], now: number) => renderToStaticMarkup(createElement('div', null, createElement(SnowSales, { snapshots: snaps, entries: [], season: '2026/2027', today: '2026-10-21', who: 'James', goal: { contracts: 650, by: '2027-01-01' }, canEditGoal: true, onSaveGoal: async () => true, onSaveSnapshot: async () => null, now, startOpen: 'snapshot' })));

test('form: plain labels, one Save button, the direct-link id', () => {
  const h = html([], Date.now());
  assert.match(h, /id="follosoft-snapshot"/);       // the popup, opened by the direct link
  for (const l of ['>Date<', '>Contracts<', '>Total value<', '>Source<', '>Manual<', '>Agent<']) assert.ok(h.includes(l), l);
  assert.equal(h.match(/type="submit"/g)!.length, 1);
  assert.match(h, />Save snapshot</);
  assert.match(h, /No FolloSoft snapshot yet/);
});
test('card: latest totals, average ticket, change since yesterday, trend', () => {
  const snaps = [S('2026-10-20', 353, 253534), S('2026-10-21', 357, 256404)];
  const h = html(snaps, Date.parse('2026-10-21T15:00:00Z'));
  assert.ok(h.includes('>357<') && h.includes('$256,404') && h.includes('$718.22'));
  assert.ok(h.includes('+4 contracts, +$2,870 since yesterday'));
  assert.match(h, /Trend — recent snapshots/);
  assert.doesNotMatch(h, /h old/);
});
test('stale over 26 hours, and flagged snapshots shown', () => {
  const snaps = [S('2026-10-19', 357, 256404), S('2026-10-20', 350, 256404, { flags: ['Contracts went DOWN: 357 → 350 (-7).'] })];
  const h = html(snaps, Date.parse('2026-10-20T11:30:00Z') + 27 * 3_600_000);
  assert.match(h, /27 h old — today&#x27;s snapshot not entered/);
  assert.match(h, /Contracts went DOWN/);
});

test('snow section: big total against the goal, still needed and per week; form only in the popup', () => {
  const snaps = [S('2026-10-19', 353, 253534), S('2026-10-20', 357, 256404)];
  const h = renderToStaticMarkup(createElement(SnowSales, { snapshots: snaps, entries: [], season: '2026/2027', today: '2026-10-20', who: 'James', goal: { contracts: 650, by: '2027-01-01' }, canEditGoal: true, onSaveGoal: async () => true, onSaveSnapshot: async () => null, now: Date.parse('2026-10-20T15:00:00Z') }));
  assert.match(h, /Total contracts/);
  assert.match(h, /357 of 650 · goal by Jan 1/);
  assert.match(h, /293 still needed · about 29 a week \(10 weeks left\)/);
  assert.match(h, /Average ticket<\/div><div class="text-2xl font-black">\$718\.22/);
  assert.match(h, /Total value<\/div><div class="text-2xl font-black">\$256,404/);
  assert.match(h, /aria-label="FolloSoft snapshot"/);
  assert.match(h, /aria-label="Change the goal"/);
  assert.doesNotMatch(h, /follosoft-snapshot"/);                 // the form isn't on the page until the popup opens
});

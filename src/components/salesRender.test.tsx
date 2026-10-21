// Sales scoreboard page — made-up data.
//   npm test -- salesRender
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SalesScoreboard, { ChaseList, type SalesMeta } from './SalesScoreboard';
import type { QuoteRow, SnowEntry } from '../lib/sales/metrics';
import { formatTodayInToronto, addDaysToronto } from '../lib/dateUtils';

const T = formatTodayInToronto();
const iso = (ymd: string) => `${ymd}T16:00:00Z`;
const Q = (n: string, s: string, sentDaysAgo: number, sub: number, x: Partial<QuoteRow> = {}): QuoteRow => ({
  id: 'q' + n, n, s, t: 'Spring cleanup', c: iso(addDaysToronto(T, -sentDaysAgo)), sent: iso(addDaysToronto(T, -sentDaysAgo)), viewed: null, appr: null, conv: null,
  sub, tot: Math.round(sub * 113) / 100, cl: 'Client ' + n, sp: 'James Example', url: 'https://secure.getjobber.com/quotes/' + n, ...x,
});
const quotes = [
  Q('1', 'approved', 0, 1000, { appr: iso(T) }),
  Q('2', 'awaiting_response', 0, 2500, { viewed: iso(T) }),
  Q('3', 'awaiting_response', 0, 900),
];
const snow: SnowEntry[] = [{ id: 's1', date: T, season: '2026/2027', contracts: 12, dollars: 8208, source: 'manual', createdBy: 'James' }];
const meta: SalesMeta = { status: 'ok', lastSuccessAt: Date.now() - 120000, lastAttemptAt: Date.now() - 120000, since: '2026-01-01T05:00:00Z' };
const page = (o: object = {}) => renderToStaticMarkup(h(SalesScoreboard, {
  quotes, meta, snowEntries: snow, snapshots: [], onSaveSnapshot: async () => null,
  snowGoal: { contracts: 650, by: '2027-01-01' }, canEditGoal: true, onSaveSnowGoal: async () => true,
  invoices: [], categoryOverrides: {}, serviceNames: { freehand: [{ key: 'lawn ripped', label: 'Lawn Ripped', count: 1, amount: 2200, sample: '1', unmapped: true, trimming: false }, { key: 'return visit', label: 'Return Visit', count: 1, amount: 100, sample: '2', unmapped: true, trimming: false }, { key: 'fence repair', label: 'Fence Repair', count: 1, amount: 480, sample: '3', unmapped: true, trimming: false }] },
  canEditMapping: true, onSaveOverrides: async () => true,
  today: T, currentUser: { email: '', name: '' }, onRefresh: async () => ({ status: 'ok' }), ...o,
}));
const snap = { date: '2026-10-20', season: '2026/2027', contracts: 357, totalValue: 256404, enteredBy: 'Marco', source: 'manual' as const, savedAt: Date.now() };

test('snow sales first, then summer work; the snow goal is the only goal', () => {
  const html = page({ snapshots: [snap] });
  const first = html.indexOf('data-testid="snapshot-latest"');
  assert.ok(first > -1 && first < html.indexOf('Summer work') && first < html.indexOf('aria-label="Period"'));
  assert.ok(html.includes('$256,404') && html.includes('$718.22'));
  assert.match(html, /357 of 650 · goal by Jan 1/);
  for (const gone of ['target', 'Commercial —', 'Week by week', 'Win rate', 'Leads', 'Residential — add sales', 'Targets']) assert.doesNotMatch(html, new RegExp(gone), gone);
});
test('the period defaults to the season', () => {
  assert.match(page(), /aria-pressed="true"[^>]*>Season</);
});
test('chase list and names to assign are buttons with counts (popups), not sections', () => {
  const html = page();
  assert.match(html, /2 quotes waiting/);
  assert.match(html, /1 name to assign/);            // "Return Visit" and "Lawn Ripped" are placed by the map now
  assert.doesNotMatch(html, /NOT OPENED/);
  assert.doesNotMatch(html, /Fence Repair/);
});
test('chase popup: unopened flagged, opened shown, link to Jobber', () => {
  const html = renderToStaticMarkup(h(ChaseList, { quotes, today: T }));
  assert.match(html, /2 waiting/);
  assert.match(html, /1 not opened/);
  assert.match(html, /NOT OPENED — check it didn&#x27;t go to spam/);
  assert.match(html, /href="https:\/\/secure\.getjobber\.com\/quotes\/3"/);
});
test('never a confident 0: loading, never pulled, failed pull', () => {
  assert.match(page({ meta: undefined }), /Loading…/);
  assert.match(page({ meta: null }), /Data unavailable — no successful pull yet/);
  const f = page({ meta: { ...meta, status: 'error', lastError: 'hidden due to permissions' } });
  assert.match(f, /Data unavailable<\/b> — last pull failed/);
  assert.match(f, /Figures below are from the last successful pull/);
});

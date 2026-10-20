// Sales scoreboard page — made-up data.
//   npm test -- salesRender
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SalesScoreboard, { type SalesMeta } from './SalesScoreboard';
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
  quotes, requests: [{ id: 'r', c: iso(T), st: 'converted', src: 'embedded_inline', q: 1 }], meta, snowEntries: snow, commercial: [],
  targets: { resSnow: { contracts: 300, avgTicket: 650 } }, today: T, currentUser: { email: '', name: '' }, canEditSnow: true,
  onSaveSnowEntry: async () => true, onSaveTargets: async () => true, onRefresh: async () => ({ status: 'ok' }), ...o,
}));

test('headline cards: average ticket large, before tax, tax on hover', () => {
  const html = page();
  assert.match(html, /Average ticket \(won\)/);
  assert.match(html, /\$1,000/);
  assert.match(html, /title="Incl\. tax: \$1,130\.00"/);
  assert.match(html, /before tax/);
  assert.match(html, /Win rate/);
});
test('chase list: unopened flagged, opened shown, link to Jobber', () => {
  const html = page();
  assert.match(html, /2 waiting/);
  assert.match(html, /1 not opened/);
  assert.match(html, /NOT OPENED — check it didn&#x27;t go to spam/);
  assert.match(html, /opened [A-Z][a-z]{2} \d+/);
  assert.match(html, /href="https:\/\/secure\.getjobber\.com\/quotes\/3"/);
});
test('leads and snow with target progress', () => {
  const html = page();
  assert.match(html, /<b>1<\/b> lead · <b>1<\/b> became quotes/);
  assert.match(html, /Website form: <b>1<\/b>/);
  assert.match(html, /12 of 300 contracts · avg \$684 vs \$650 target/);
  assert.match(html, /entered by hand · James/);
});
test('never a confident 0: loading, never pulled, failed pull', () => {
  assert.match(page({ meta: undefined }), /Loading…/);
  assert.match(page({ meta: null }), /Data unavailable — no successful pull yet/);
  const f = page({ meta: { ...meta, status: 'error', lastError: 'hidden due to permissions' } });
  assert.match(f, /Data unavailable<\/b> — last pull failed/);
  assert.match(f, /Figures below are from the last successful pull/);
  assert.match(page({ meta: null }), /Landscaping &amp; projects<\/div><div class="mt-2 text-sm font-bold text-slate-600">Data unavailable/);
});
test('period and salesperson filters are buttons', () => {
  const html = page({ quotes: [...quotes, Q('9', 'approved', 1, 50, { sp: 'Marco Example', appr: iso(T) })] });
  assert.match(html, /aria-label="Period"/);
  for (const l of ['This week', 'This month', 'Season', 'Year', 'Custom', 'Everyone', 'Marco Example']) assert.match(html, new RegExp(l));
});

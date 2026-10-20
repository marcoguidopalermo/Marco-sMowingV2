// Sales by category and division — made-up invoices.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SalesBreakdown from './SalesBreakdown';
import type { InvoiceRow } from '../lib/sales/categories';

const inv = (n: string, d: string, li: InvoiceRow['li'], m: 1 | 2 | 3, w: Record<string, number>): InvoiceRow => {
  const sub = li.reduce((s, l) => s + (Number((l as any)[2]) || 0), 0);
  return { id: n, n, d: `${d}T16:00:00Z`, st: 'paid', sub, tot: Math.round(sub * 113) / 100, cl: 'Client ' + n, url: '#' + n, li, m, w };
};
const invoices = [
  inv('1', '2026-07-10', [['Mowing (Weekly)', 'Mowing (Weekly)', 1000]], 1, { 'Lawn Division': 1 }),
  inv('2', '2026-08-12', [['Sod Installation', 'Sod Installation', 3000]], 2, { 'Large Projects': 1 }),
  inv('3', '2026-08-01', [['Snow Plowing', 0, 800], ['Extra trimming in backyard', 0, 150]], 3, {}),
  inv('4', '2026-08-03', [['Sale of 2007 F-150', 0, 1000]], 3, {}),
];
const page = (o: object = {}) => renderToStaticMarkup(h(SalesBreakdown, {
  invoices, quotes: [], range: { from: '2026-01-01', to: '2026-12-31' }, hasData: true, overrides: {},
  names: { freehand: [{ key: 'lawn ripped', label: 'lawn ripped', count: 1, amount: 2200, sample: '7000', unmapped: true, trimming: false }], catalog: [{ name: 'Mowing (Weekly)', count: 1, amount: 1000 }] },
  bhByMonth: { '2026-07': { 'Lawn Division': 20 } }, canEditMapping: true, onSaveOverrides: async () => true,
  wonCount: 3, wonPre: 4200, wonIncl: 4746, waitingCount: 5, avgTicketPre: 1400, ...o,
}));

test('headlines: total invoiced, quotes won, open pipeline; average ticket small', () => {
  const html = page();
  assert.match(html, /Total invoiced<\/div><div class="text-2xl[^"]*">\$4,950/);
  assert.match(html, /Quotes won<\/div><div[^>]*>3 · \$4,200/);
  assert.match(html, /Open pipeline/);
  assert.match(html, /Average won quote \$1,400 before tax/);
  assert.match(html, /title="With tax: \$5,593\.50"/);
});
test('ranked by category and by division; snow is Commercial snow; unattributed kept', () => {
  const html = page();
  for (const k of ['Sod', 'Lawn mowing', 'Snow', 'Other', 'Lawn Division', 'Large Projects', 'Commercial snow', 'Unattributed']) assert.match(html, new RegExp(`>${k}<`), k);
  assert.match(html, /\$1,000 from crew records · \$0 from Jobber assignees · 20 BH · \$50 invoiced per BH/);
  assert.match(html, /no BH on record for Aug 26/);
});
test('lists: asset sale excluded, trimming listed, names to assign, mapping table', () => {
  const html = page();
  assert.match(html, /Asset sales — not counted as sales \(1\)/);
  assert.match(html, /Trimming — in Other until you choose hedges or string trimming \(1\)/);
  assert.match(html, /#3<\/b> <span class="text-slate-700">Client 3<\/span> <span class="text-xs text-slate-500">· 2026-08-01 · Extra trimming in backyard/);
  assert.match(html, /lawn ripped/);
  assert.match(html, /Category mapping — Jobber catalog/);
});
test('data unavailable, never a confident 0', () => {
  assert.match(page({ hasData: false }), /Data unavailable — no successful pull yet/);
  assert.match(page({ invoices: [] }), /Data unavailable — invoices arrive with the next sales pull/);
});

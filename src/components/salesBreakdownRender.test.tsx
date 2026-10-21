// Sales by category and division — made-up invoices.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SalesBreakdown, { Details, MappingTable } from './SalesBreakdown';
import { invoiceBreakdown } from '../lib/sales/categories';
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
  invoices, range: { from: '2026-01-01', to: '2026-12-31' }, hasData: true, overrides: {},
  bhByMonth: { '2026-07': { 'Lawn Division': 20 } }, ...o,
}));
const details = (overrides = {}) => renderToStaticMarkup(h(Details, { b: invoiceBreakdown(invoices, { from: '2026-01-01', to: '2026-12-31' }, overrides), bhByMonth: { '2026-07': { 'Lawn Division': 20 } } }));
const mapping = (overrides = {}) => renderToStaticMarkup(h(MappingTable, { names: { catalog: [{ name: 'Mowing (Weekly)', count: 1, amount: 1000 }] }, overrides, canEdit: true, onSave: async () => true, invoices }));

test('big and simple: total invoiced, by category, by division — nothing else on the page', () => {
  const html = page();
  assert.match(html, /Total invoiced<\/div><div class="text-4xl[^"]*">\$4,950/);
  assert.match(html, /title="With tax: \$5,593\.50"/);
  assert.match(html, /equipment sales not included/);
  for (const k of ['Sod', 'Lawn mowing', 'Snow', 'Other', 'Lawn Division', 'Large Projects', 'Commercial snow', 'Unattributed']) assert.match(html, new RegExp(`>${k}<`), k);
  for (const gone of ['Quotes won', 'Open pipeline', 'Month by month', 'Quotes by service category', 'Category mapping']) assert.doesNotMatch(html, new RegExp(gone), gone);
  assert.match(html, /Details — equipment sales, unattributed, \$ per BH/);
});
test('details popup: equipment sales excluded, trimming listed, divisions with provisional $ per BH, fallback table', () => {
  const html = details();
  assert.match(html, /Equipment sales — not counted as sales \(1\)/);
  assert.match(html, /Sale of 2007 F-150/);
  assert.match(html, /Trimming — in Other until you choose hedges or string trimming \(1\)/);
  assert.match(html, /\$1,000 from crew records · \$0 from Jobber assignees · 20 BH · \$50 invoiced per BH \(provisional\)/);
  assert.match(html, /<b>Provisional<\/b>/);
  assert.match(html, /Service category → division \(4th fallback\)/);
});
test('data unavailable, never a confident 0', () => {
  assert.match(page({ hasData: false }), /Data unavailable — no successful pull yet/);
  assert.match(page({ invoices: [] }), /Data unavailable — invoices arrive with the next sales pull/);
});
test('mapping popup: per-invoice overrides listed with who / when / note', () => {
  const html = mapping({ lines: { '3|extra trimming in backyard': { category: 'Lawn mowing', by: 'Marco', at: Date.UTC(2026, 9, 20, 23), note: 'mowing trimming' } } });
  assert.match(html, /Per-invoice overrides \(1\)/);
  assert.match(html, /<b>#3<\/b> Client 3 · &quot;extra trimming in backyard&quot; → <b>Lawn mowing<\/b>/);
  assert.match(html, /Marco · Oct 20[^<]*· mowing trimming/);
});

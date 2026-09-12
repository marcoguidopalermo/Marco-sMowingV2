// Two things you can only see by rendering the real quote:
//   npm test -- snowQuoteRender
//
// 1. ORDER. Whether the address fields come before the map, the tracers and
//    the pricing is a property of the rendered document, not of any helper. A
//    unit test cannot tell you that driveway 2's address was three screens
//    down inside a per-side panel — which is where it was, so the second
//    property of a shared quote got entered after the driveway had been traced
//    and priced, and was the easiest field on the quote to leave blank.
//
// 2. DOUBLED PREMIUM. Premium is priority response on the VISIT — one trip,
//    one upgrade — and it was being added once per driveway, so a two-driveway
//    quote showed $400 for one visit. Every unit test passed, because the unit
//    doing the doubling was the VIEW adding a correct per-driveway number twice.
//    The only place that is visible is the rendered total.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SnowMaster from './SnowMaster';
import { SNOW_CONFIG_V1, SnowConfig, premiumSplit } from '../lib/snowPricing';
import type { DrivewayMode } from '../lib/snowDriveways';

// One traced spot = Tier 1 ($599).
const ONE_SPOT = [[1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
// SHARED traces ONE slab and splits it at the middle column, so a fixture needs
// a spot on EACH side of the line or driveway 2 prices to nothing and the
// combined card never renders. One spot per side → Tier 1 each, identical, so
// any difference in the output is the thing under test.
const BOTH_SIDES = [[1, 0, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];

// A non-default config has to arrive as a STORED VERSION, not as the `config`
// prop: the quote prices against resolveSnowConfig(activeVersion, configs), so
// that is the path a rate change actually takes and the path worth testing.
const render = (o: {
  mode?: DrivewayMode; address?: string; address2?: string; config?: SnowConfig;
} = {}) => renderToStaticMarkup(h(SnowMaster, {
  quotes: {},
  currentUser: { email: 'a@b.c', name: 'Tester' },
  isAdmin: true,
  onSave: () => {},
  onDelete: () => {},
  ...(o.config ? {
    activeVersion: 'snow-v2',
    configs: {
      'snow-v2': {
        id: 'snow-v2', version: 'snow-v2', config: o.config, changes: [],
        createdBy: { email: '', name: 'test' }, createdAt: 0,
      },
    },
  } : {}),
  initial: {
    mode: o.mode, address: o.address, address2: o.address2,
    grid: o.mode === 'shared' ? BOTH_SIDES : ONE_SPOT, grid2: ONE_SPOT,
  },
} as Parameters<typeof SnowMaster>[0]));

// Strip tags AND decode the entities renderToStaticMarkup emits, so assertions
// read against the visible text rather than the markup. Without the decode,
// every assertion touching an apostrophe fails on "&#x27;" and looks like a
// missing string.
const text = (html: string) => html
  .replace(/<[^>]*>/g, ' ')
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');
const at = (html: string, needle: string) => html.indexOf(needle);

// ── 1. THE ADDRESS FIELDS COME FIRST ────────────────────────────────────────

test('SHARED: both address fields render, labelled to match the panels below', () => {
  const html = render({ mode: 'shared', address: '10 Elm St', address2: '12 Elm St' });
  assert.ok(html.includes('Driveway 1 — left of the line'), 'driveway 1 is labelled');
  assert.ok(html.includes('Driveway 2 — right of the line'), 'driveway 2 is labelled');
  // Both values are actually bound into inputs, not merely printed somewhere.
  assert.ok(/value="10 Elm St"/.test(html), 'driveway 1 address is in a field');
  assert.ok(/value="12 Elm St"/.test(html), 'driveway 2 address is in a field');
});

test('THE ADDRESSES ARE THE FIRST THING — above the shape picker, map, tracer, pricing', () => {
  const html = render({ mode: 'shared', address: '10 Elm St', address2: '12 Elm St' });
  const addr1 = at(html, 'value="10 Elm St"');
  const addr2 = at(html, 'value="12 Elm St"');
  assert.ok(addr1 > -1 && addr2 > -1);
  for (const later of ['Driveway shape', 'Satellite', 'Trace the driveway', 'Standard total']) {
    const pos = at(html, later);
    if (pos < 0) continue;                       // not on screen in this state
    assert.ok(addr1 < pos, `driveway 1's address must precede "${later}"`);
    assert.ok(addr2 < pos, `driveway 2's address must precede "${later}"`);
  }
});

test('driveway 2 has no SECOND address input further down the page', () => {
  // It used to be edited inside the per-side panel as well. Two inputs bound to
  // one value is a thing to keep in step for nothing, and the panel's job is to
  // say WHICH property it prices.
  const html = render({ mode: 'shared', address: '10 Elm St', address2: '12 Elm St' });
  assert.ok(!html.includes('Address for this side'), 'the per-side address input is gone');
  assert.equal((html.match(/value="12 Elm St"/g) || []).length, 1, 'exactly one field for it');
});

test('ONE DRIVEWAY and TWO DRIVEWAYS keep a single address field — one property', () => {
  for (const mode of ['single', 'multi'] as const) {
    const html = render({ mode, address: '10 Elm St' });
    assert.ok(html.includes('Property address'), `${mode}: one labelled field`);
    assert.ok(!html.includes('Driveway 2 — right of the line'),
      `${mode}: no second address field`);
  }
});

test('a shared quote never shows only one property', () => {
  const html = text(render({ mode: 'shared', address: '10 Elm St', address2: '12 Elm St' }));
  assert.ok(/both appear on the\s+saved-quote list|both appear on the saved-quote list/.test(html)
    || html.includes('a shared quote never shows just one of them'));
});

// ── 2. PREMIUM IS $200 TOTAL, NOT PER DRIVEWAY ──────────────────────────────

test('TWO DRIVEWAYS, ONE PROPERTY: the combined premium is $200 over standard', () => {
  const html = text(render({ mode: 'multi' }));
  // Two Tier 1 driveways, each with the second-driveway discount: 499 + 499.
  assert.ok(html.includes('$998'), 'combined standard');
  // ONE premium on top → 1,198. The bug rendered 1,398 (two premiums).
  assert.ok(html.includes('$1,198'), 'combined premium = standard + ONE $200');
  assert.ok(!html.includes('$1,398'), 'must NOT charge premium per driveway');
});

test('SHARED DRIVEWAY: $200 for the driveway, split $100 each', () => {
  const html = text(render({ mode: 'shared', address: '10 Elm St', address2: '12 Elm St' }));
  // Each side: Tier 1 less the shared discount = 499. Combined standard 998.
  assert.ok(html.includes('$998'), 'combined standard');
  assert.ok(html.includes('$1,198'), 'combined premium = standard + ONE $200');
  assert.ok(!html.includes('$1,398'), 'the pair must not carry two premiums');
  // And each side's own premium total is its standard plus its $100 share.
  assert.ok(html.includes('$599'), "a side's premium total = 499 + 100");
});

test('THE LINE SAYS IT IS A SHARE, so the halved figure is not read as a bug', () => {
  const shared = text(render({ mode: 'shared', address: '10 Elm St', address2: '12 Elm St' }));
  assert.ok(shared.includes('half of $200, shared driveway'),
    'the premium line names what it is half OF');
  const multi = text(render({ mode: 'multi' }));
  assert.ok(multi.includes('half of $200, one visit'));
  // A single driveway takes the whole charge, so there is no share to explain.
  const single = text(render({ mode: 'single', address: '10 Elm St' }));
  assert.ok(!single.includes('half of $200'), 'nothing is split on a single driveway');
});

test('ALL-OR-NOTHING is on screen, not just in the arithmetic', () => {
  // There is no per-side premium toggle to couple — every driveway always shows
  // Standard and Premium, and the shared premium is ONE charge the sides
  // divide, so no state exists where one side is premium and the other is not.
  // What was missing was saying so: two cards each showing a premium figure
  // look exactly like two independent premiums.
  const html = text(render({ mode: 'shared', address: '10 Elm St', address2: '12 Elm St' }));
  assert.ok(html.includes('Both properties take premium or neither does'));
  assert.ok(/\$200 for the driveway/.test(html), 'names the one charge');
  assert.ok(/\$100 \+ \$100/.test(html), 'and shows the split explicitly');
});

test('THE CONTRACT WORDING states the share and that it is half', () => {
  const html = text(render({ mode: 'shared', address: '10 Elm St', address2: '12 Elm St' }));
  assert.ok(html.includes('Premium service is $200 for the shared driveway'));
  assert.ok(html.includes("This property's share is $100, which is half of that"));
  assert.ok(html.includes('whole driveway or to neither property'));
  // The discount clause is still there, still naming its rate.
  assert.ok(html.includes('$100 shared-driveway discount applies'));
});

test('BOTH clauses follow the rate sheet, not a literal', () => {
  // Premium 300, shared discount 150: the wording must move with them.
  const cfg: SnowConfig = { ...SNOW_CONFIG_V1, PREMIUM: 300, SHARED_DRIVEWAY: 150 };
  const html = text(render({ mode: 'shared', address: '10 Elm St', address2: '12 Elm St', config: cfg }));
  assert.ok(html.includes('Premium service is $300 for the shared driveway'));
  assert.ok(html.includes("This property's share is $150"));
  assert.ok(html.includes('$150 shared-driveway discount applies'));
  assert.ok(!html.includes('Premium service is $200'), 'no stale premium survives');
  // And the split matches what the lib says for that config.
  assert.deepEqual(premiumSplit(cfg, 2).shares, [150, 150]);
});

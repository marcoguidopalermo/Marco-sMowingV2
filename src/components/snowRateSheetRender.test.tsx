// Are the driveway discounts actually REACHABLE in the rate sheet?
//   npm test -- snowRateSheetRender
//
// This is the regression that mattered, and it is the crewNote bug again in a
// different place. SHARED_DRIVEWAY and SECOND_DRIVEWAY already existed on
// SnowConfig, were seeded in v1, were read by the pricer through
// sharedDrivewayRate/secondDrivewayRate, and were labelled for the audit diff.
// Every unit test passed. They were still hardcoded in practice, because the
// only screen that can change a rate — SnowRateSheet — never rendered an input
// for them: PRICE_FIELDS listed seven keys and none of the three discounts.
// "The field exists on the config" and "somebody can change the rate without a
// code change" are different claims, and only rendering the real screen and
// reading the output can tell them apart.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SnowRateSheet from './SnowRateSheet';
import { SNOW_CONFIG_V1, SnowConfig } from '../lib/snowPricing';
import type { SnowRateConfigVersion } from '../types';

const render = (o: {
  isSuperAdmin?: boolean;
  config?: SnowConfig;
  versions?: Record<string, SnowRateConfigVersion>;
  initial?: { draft?: SnowConfig; preview?: boolean };
} = {}) => renderToStaticMarkup(h(SnowRateSheet, {
  isSuperAdmin: o.isSuperAdmin ?? true,
  config: o.config || SNOW_CONFIG_V1,
  activeVersion: 'snow-v1',
  versions: o.versions || {},
  onSave: async () => true,
  onRevert: async () => true,
  initial: o.initial,
}));

// Inputs render as <input ... value="100" ...>; find the value next to a label
// by slicing the markup from the label to the following input.
const valueAfter = (html: string, label: string): string | null => {
  const at = html.indexOf(label);
  if (at < 0) return null;
  const m = /value="([^"]*)"/.exec(html.slice(at));
  return m ? m[1] : null;
};

test('BOTH driveway discounts have an input in the sheet', () => {
  const html = render();
  assert.ok(html.includes('Shared driveway'), 'shared-driveway rate is on the screen');
  assert.ok(html.includes('Second driveway'), 'second-driveway rate is on the screen');
  // Seeded at $100 each, and each is its OWN input — not one shared control.
  assert.equal(valueAfter(html, 'Shared driveway'), '100');
  assert.equal(valueAfter(html, 'Second driveway'), '100');
});

test('they are SEPARATE inputs — editing one cannot move the other', () => {
  // Two clients on one driveway, versus one client with two driveways. Same
  // number today; a single control would make them the same number forever.
  const html = render({ config: { ...SNOW_CONFIG_V1, SHARED_DRIVEWAY: 150, SECOND_DRIVEWAY: 75 } });
  assert.equal(valueAfter(html, 'Shared driveway'), '150');
  assert.equal(valueAfter(html, 'Second driveway'), '75');
});

test('no-boulevard is editable too, and is marked PER LANE', () => {
  // It was missing from the edit surface for the same reason the discounts
  // were. It is the one discount that scales with width, so the sheet has to
  // say so — the number alone reads like the flat ones above it.
  const html = render();
  assert.ok(html.includes('No boulevard'));
  assert.equal(valueAfter(html, 'No boulevard'), '50');
  assert.ok(/per LANE/.test(html), 'says which way it scales');
});

test('the discounts are shown as SUBTRACTING, not as more add-ons', () => {
  // Entered positive, taken off the total. In an undifferentiated grid of money
  // inputs, "100" gives no clue which direction it moves the price.
  const html = render();
  assert.ok(/taken OFF the price/.test(html), 'the group says which way it goes');
  assert.ok(html.includes('−$'), 'and each input is prefixed with a minus');
});

test('A CONFIG PREDATING THE DISCOUNTS shows the rate being charged, not "undefined"', () => {
  // The keys are optional, so a version stored before they existed has none.
  // String(undefined) renders the literal "undefined" into a number input, and
  // saving from that screen would commit whatever it coerced to.
  const ancient = { ...SNOW_CONFIG_V1 } as SnowConfig;
  delete ancient.SHARED_DRIVEWAY; delete ancient.SECOND_DRIVEWAY; delete ancient.NO_BOULEVARD_PER_LANE;
  const html = render({ config: ancient });
  assert.ok(!html.includes('undefined'), 'never the string "undefined" in an input');
  // Seeded from the same helpers the PRICER falls back to, so the sheet opens
  // showing what quotes are actually being charged.
  assert.equal(valueAfter(html, 'Shared driveway'), '100');
  assert.equal(valueAfter(html, 'Second driveway'), '100');
  assert.equal(valueAfter(html, 'No boulevard'), '50');
});

test('a discount change reaches the confirm dialog as its own audited row', () => {
  // The preview is the gate before a new version is written; a rate that moves
  // silently past it is a rate nobody approved.
  const html = render({
    initial: { draft: { ...SNOW_CONFIG_V1, SHARED_DRIVEWAY: 150 }, preview: true },
  });
  assert.ok(html.includes('Confirm rate change'));
  assert.ok(html.includes('Shared driveway (flat)'), 'named by its audit label');
  assert.ok(html.includes('100') && html.includes('150'), 'old → new');
  assert.ok(!html.includes('Second driveway (flat)'), 'the untouched rate is not in the diff');
});

test('still super-admin only — the discounts do not widen access', () => {
  const html = render({ isSuperAdmin: false });
  assert.ok(html.includes('Rate sheet is restricted'));
  assert.ok(!html.includes('Shared driveway'), 'no rate is rendered at all');
});

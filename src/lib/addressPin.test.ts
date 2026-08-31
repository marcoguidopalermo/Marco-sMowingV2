// The address pin's label.
//   npm test -- addressPin
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { pinLabel, PIN_LABEL_MAX, PIN_HEX } from './addressPin';

console.log('\nThe label says which property, briefly');
test('the street line only — the rest is noise under a pin', () => {
  assert.equal(pinLabel('396 Ray Blvd, Thunder Bay, ON P7B 4E6')?.text, '396 Ray Blvd');
});
test('an address with no comma is used as-is', () => {
  assert.equal(pinLabel('396 Ray Blvd')?.text, '396 Ray Blvd');
});
test('a long street line is truncated, not left to sprawl', () => {
  const t = pinLabel('1234 Extraordinarily Long Boulevard Name West')!.text;
  assert.equal(t.length, PIN_LABEL_MAX);
  assert.ok(t.endsWith('…'));
});
test('a line exactly at the limit is NOT truncated', () => {
  const exact = 'x'.repeat(PIN_LABEL_MAX);
  assert.equal(pinLabel(exact)?.text, exact);
});

console.log('\nNothing to say means no label, not an empty box');
test('empty, blank and missing all yield undefined', () => {
  for (const a of ['', '   ', ',', ' , ', null, undefined]) {
    assert.equal(pinLabel(a), undefined, JSON.stringify(a));
  }
});

console.log('\nIt must not read as part of the measurement');
test('the pin colour is none of the drawing colours', () => {
  for (const drawing of ['#16a34a', '#dc2626', '#1c4634']) {
    assert.notEqual(PIN_HEX.toLowerCase(), drawing);
  }
});
test('the label carries the class the outline style hangs off', () => {
  assert.equal(pinLabel('1 Main St')?.className, 'sm-pin-label');
});

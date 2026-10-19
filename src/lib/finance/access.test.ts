// The finance viewer list lives in three places that must stay identical:
// FINANCE_VIEWERS (client gate), isFinanceViewer() in firestore.rules and in
// storage.rules. This fails if they drift.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FINANCE_VIEWERS, canSeeFinance } from './access';

function listIn(file: string): string[] {
  const src = readFileSync(resolve(__dirname, '../../..', file), 'utf8');
  const fn = src.match(/function isFinanceViewer\(\)\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(fn, `isFinanceViewer() not found in ${file}`);
  const list = fn![1].match(/in \[([\s\S]*?)\]/);
  assert.ok(list, `no address list in ${file} isFinanceViewer()`);
  return [...list![1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
}

test('firestore.rules, storage.rules and FINANCE_VIEWERS list the same accounts', () => {
  const client = [...FINANCE_VIEWERS].sort();
  assert.deepEqual(listIn('firestore.rules'), client);
  assert.deepEqual(listIn('storage.rules'), client);
});
test('one account for now; nobody else', () => {
  assert.deepEqual([...FINANCE_VIEWERS], ['marcoguidopalermo@gmail.com']);
  assert.equal(canSeeFinance('MarcoGuidoPalermo@gmail.com'), true);
  for (const e of ['office@marcosmowing.com', 'marco@marcosmowing.com', 'anthonypalermo23@hotmail.com', '', null, undefined]) {
    assert.equal(canSeeFinance(e), false, String(e));
  }
});
test('lists are lowercase (rules compare against the lowered token email)', () => {
  assert.ok(FINANCE_VIEWERS.every(e => e === e.toLowerCase()));
});

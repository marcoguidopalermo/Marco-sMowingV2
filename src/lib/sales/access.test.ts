import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SALES_VIEWERS, canSeeSales } from './access';

const root = resolve(__dirname, '../../..');
test('client gate, firestore.rules and the functions list match', () => {
  const client = [...SALES_VIEWERS].sort();
  const rules = readFileSync(resolve(root, 'firestore.rules'), 'utf8').match(/function isSalesViewer\(\)\s*\{([\s\S]*?)\n\s*\}/)![1];
  assert.deepEqual([...rules.match(/in \[([\s\S]*?)\]/)![1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort(), client);
  const fsrc = readFileSync(resolve(root, 'functions/src/jobber/salesPull.ts'), 'utf8').match(/export const SALES_VIEWERS = \[([^\]]*)\]/)![1];
  assert.deepEqual([...fsrc.matchAll(/"([^"]+)"/g)].map(m => m[1]).sort(), client);
});
test('James and Marco only', () => {
  assert.equal(canSeeSales('Sales@MarcosMowing.com'), true);
  assert.equal(canSeeSales('marcoguidopalermo@gmail.com'), true);
  for (const e of ['office@marcosmowing.com', 'marco@marcosmowing.com', 'eojames@lakeheadu.ca', '', null]) assert.equal(canSeeSales(e), false, String(e));
});

// The office list lives in four places that must stay identical: the client
// gate, isOfficeViewer() in firestore.rules and storage.rules, and the
// functions' OFFICE_VIEWERS (alerts + Refresh now).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OFFICE_VIEWERS, canSeeOffice } from './access';

const root = resolve(__dirname, '../../..');
function rulesList(file: string): string[] {
  const src = readFileSync(resolve(root, file), 'utf8');
  const fn = src.match(/function isOfficeViewer\(\)\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(fn, `isOfficeViewer() not found in ${file}`);
  return [...fn![1].match(/in \[([\s\S]*?)\]/)![1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
}
test('client gate, both rules files and the functions list match', () => {
  const client = [...OFFICE_VIEWERS].sort();
  assert.deepEqual(rulesList('firestore.rules'), client);
  assert.deepEqual(rulesList('storage.rules'), client);
  const fsrc = readFileSync(resolve(root, 'functions/src/jobber/officeAR.ts'), 'utf8');
  const fl = fsrc.match(/export const OFFICE_VIEWERS = \[([^\]]*)\]/)![1];
  assert.deepEqual([...fl.matchAll(/"([^"]+)"/g)].map(m => m[1]).sort(), client);
});
test('Dave and Marco only', () => {
  assert.equal(canSeeOffice('Office@MarcosMowing.com'), true);
  assert.equal(canSeeOffice('marcoguidopalermo@gmail.com'), true);
  for (const e of ['marco@marcosmowing.com', 'anthonypalermo23@hotmail.com', 'crew@x.test', '', null]) assert.equal(canSeeOffice(e), false, String(e));
});

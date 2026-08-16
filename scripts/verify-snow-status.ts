// Read the LIVE snowContracts and run each through the real migrateContract,
// confirming the stored status normalizes to the new pipeline.
import { execFileSync } from 'node:child_process';
import { migrateContract, STATUS_LABEL } from '../src/lib/snowContracts';

const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
const r = await fetch(
  'https://firestore.googleapis.com/v1/projects/crewmaster-73f31/databases/(default)/documents/snowContracts?pageSize=100',
  { headers: { Authorization: `Bearer ${token}` } },
);
const body: any = await r.json();

function fromValue(v: any): any {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) {
    const o: any = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) o[k] = fromValue(val);
    return o;
  }
  return null;
}

console.log(`${'ID'.padEnd(30)}${'STORED'.padEnd(12)}${'AFTER MIGRATE'.padEnd(15)}LABEL`);
console.log('-'.repeat(72));
let ok = true;
for (const d of body.documents || []) {
  const raw: any = {};
  for (const [k, v] of Object.entries(d.fields || {})) raw[k] = fromValue(v);
  const id = d.name.split('/').pop();
  let after = '(threw)';
  let label = '';
  try {
    const c = migrateContract(raw);
    after = c.status;
    label = STATUS_LABEL[c.status] || '(no label!)';
    if (!STATUS_LABEL[c.status]) ok = false;
  } catch (e) {
    ok = false;
    after = `ERROR ${String(e).slice(0, 30)}`;
  }
  console.log(`${String(id).padEnd(30)}${String(raw.status).padEnd(12)}${after.padEnd(15)}${label}`);
}
console.log(ok ? '\nAll live records normalize to a valid pipeline status.' : '\nPROBLEM — see above.');
process.exit(ok ? 0 : 1);

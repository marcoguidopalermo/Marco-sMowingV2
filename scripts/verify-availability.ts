// Runs the availability model against the LIVE appData for a given date, so
// the numbers can be checked against reality before trusting the UI.
//   npx tsx scripts/verify-availability.ts [YYYY-MM-DD]
import { execFileSync } from 'node:child_process';
import { buildAvailabilityDay, typicalCrewSizes, isEmployed } from '../src/lib/availabilityView';
import type { AppData } from '../src/types';

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
const res = await fetch(
  'https://firestore.googleapis.com/v1/projects/crewmaster-73f31/databases/(default)/documents/artifacts/crewmaster/public/data/appData/main',
  { headers: { Authorization: `Bearer ${token}` } },
);
const raw: any = await res.json();

function pv(v: any): any {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(pv);
  if ('mapValue' in v) {
    const o: any = {};
    for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = pv(x);
    return o;
  }
  return null;
}
const appData: any = {};
for (const [k, v] of Object.entries(raw.fields || {})) appData[k] = pv(v);
appData.dailyAbsences = appData.dailyAbsences || {};
appData.fleet = appData.fleet || [];

const roster = (appData.employees || []).filter(isEmployed);
console.log(`=== AVAILABILITY · ${date} ===`);
console.log(`roster (employed, non-test): ${roster.length} of ${(appData.employees || []).length} employee records\n`);

for (const division of ['All', 'Lawn Division', 'Small Projects', 'Large Projects']) {
  const d = buildAvailabilityDay(appData as AppData, date, division);
  console.log(`── ${division} — ${d.totals.employed} employed · ${d.totals.assigned} on a crew · ${d.totals.unassigned} unassigned · ${d.totals.away} away`);
  if (division !== 'All') { console.log(''); continue; }

  console.log(`\n  UNASSIGNED (${d.unassigned.length}):`);
  for (const p of d.unassigned) console.log(`    ${p.name.padEnd(24)} ${p.division || '—'}`);

  console.log(`\n  CREWS (${d.crews.length}):`);
  console.log(`    ${'CREW'.padEnd(22)}${'TODAY'.padStart(6)}${'TYPICAL'.padStart(9)}${'DELTA'.padStart(7)}  BASIS`);
  for (const c of d.crews) {
    const t = c.typical;
    const delta = c.delta === null ? '—' : (c.delta > 0 ? `+${c.delta}` : String(c.delta));
    console.log(`    ${c.key.padEnd(22)}${String(c.today).padStart(6)}${(t ? String(t.size) : '—').padStart(9)}${delta.padStart(7)}  ${t ? `median of ${t.days} past day(s)` : 'no past days in window'}`);
  }

  console.log(`\n  AWAY (${d.away.length}):`);
  if (d.away.length === 0) console.log('    nobody');
  for (const a of d.away) console.log(`    ${a.name.padEnd(24)} ${a.kind}${a.reason ? ` (${a.reason})` : ''}`);

  // Cross-check: every employed person in the division lands in exactly one bucket.
  const total = d.totals.assigned + d.totals.unassigned + d.totals.away;
  console.log(`\n  reconciliation: ${d.totals.assigned} + ${d.totals.unassigned} + ${d.totals.away} = ${total} vs ${d.totals.employed} employed  ${total === d.totals.employed ? 'OK' : 'MISMATCH'}`);
  console.log('');
}

// Show the raw typical-size inputs so the median is auditable.
const testIds = new Set((appData.employees || []).filter((e: any) => e.isTestUser).map((e: any) => e.id));
const t = typicalCrewSizes(appData.schedules || {}, testIds, date);
console.log('=== TYPICAL SIZE INPUTS (28-day strictly-past window, median) ===');
for (const [key, v] of [...t.entries()].sort()) {
  const sizes: number[] = [];
  for (const [dt, crews] of Object.entries(appData.schedules || {}) as [string, any[]][]) {
    if (!(dt < date)) continue;
    for (const c of crews || []) {
      if (!c?.division || !c?.crewNumber) continue;
      if (`${c.division} #${c.crewNumber}` !== key) continue;
      const n = (c.employees || []).filter((id: string) => !testIds.has(id)).length;
      if (n > 0) sizes.push(n);
    }
  }
  console.log(`  ${key.padEnd(22)} median ${v.size} from ${v.days} day(s): [${sizes.join(', ')}]`);
}

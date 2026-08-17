// Runs the availability model against the LIVE appData for a given date, so
// the numbers can be checked against reality before trusting the UI.
//   npx tsx scripts/verify-availability.ts [YYYY-MM-DD]
import { execFileSync } from 'node:child_process';
import { buildAvailabilityDay, isEmployed, LENDABLE_MIN_HEADCOUNT } from '../src/lib/availabilityView';
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

  console.log(`\n  CREWS (${d.crews.length}) — today's actual headcount; ${LENDABLE_MIN_HEADCOUNT}+ can lend:`);
  console.log(`    ${'CREW'.padEnd(22)}${'TODAY'.padStart(6)}  ${'LENDABLE'.padEnd(9)}PEOPLE`);
  for (const c of d.crews) {
    console.log(`    ${c.key.padEnd(22)}${String(c.today).padStart(6)}  ${(c.canLend ? 'yes' : '—').padEnd(9)}${c.people.map(p => p.name).join(', ')}`);
  }

  console.log(`\n  AWAY (${d.away.length}):`);
  if (d.away.length === 0) console.log('    nobody');
  for (const a of d.away) console.log(`    ${a.name.padEnd(24)} ${a.kind}${a.reason ? ` (${a.reason})` : ''}`);

  // Cross-check: every employed person in the division lands in exactly one bucket.
  const total = d.totals.assigned + d.totals.unassigned + d.totals.away;
  console.log(`\n  reconciliation: ${d.totals.assigned} + ${d.totals.unassigned} + ${d.totals.away} = ${total} vs ${d.totals.employed} employed  ${total === d.totals.employed ? 'OK' : 'MISMATCH'}`);
  console.log('');
}

// MONTH view — built vs unbuilt across the month containing `date`.
const { buildAvailabilityMonth } = await import('../src/lib/availabilityView');
const first = `${date.slice(0, 7)}-01`;
const lastDay = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate();
const last = `${date.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`;
const month = buildAvailabilityMonth(appData as AppData, first, last, 'All');
const built = month.filter(m => m.built);
console.log(`=== MONTH ${date.slice(0, 7)} — ${built.length} of ${month.length} days built ===`);
for (const m of month) {
  const dow = new Date(`${m.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
  console.log(`  ${m.date} ${dow}  ${m.built
    ? `${String(m.crewCount).padStart(2)} crew(s), ${String(m.count).padStart(2)} free: ${m.unassigned.slice(0, 4).map(p => p.name).join(', ')}${m.count > 4 ? ` +${m.count - 4}` : ''}`
    : 'not scheduled yet'}`);
}

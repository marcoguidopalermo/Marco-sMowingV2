// Phase 6 migration — relocate timeEntries from the appData main doc into its
// own timeEntries/{id} subcollection.
//
// These are PUNCHES: they are pay. So this follows the month-sheet protocol —
// COPY -> READ BACK -> VERIFY -> only then CLEAR — and the verification is not
// a row count. It recomputes hours-worked per employee using
// computeHoursWorkedBetween from src/lib/payChunkUtils (the SAME function the
// pay-chunk math calls) from the doc copy and from the subcollection read back
// out of Firestore, and requires them to match to the minute. If anything
// differs, nothing is cleared.
//
// USAGE
//   Dry run (copies + verifies, clears NOTHING):
//     npx tsx scripts/migrate-timeentries.ts
//   Apply:
//     npx tsx scripts/migrate-timeentries.ts --apply
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { computeHoursWorkedBetween } from '../src/lib/payChunkUtils';
import type { TimeEntry } from '../src/types';

const APPLY = process.argv.includes('--apply');
const PROJECT = 'crewmaster-73f31';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const PUB = `${BASE}/artifacts/crewmaster/public/data`;
const DOC = `${PUB}/appData/main`;
const COL = `${PUB}/timeEntries`;

const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
async function api(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${url}\n${JSON.stringify(body).slice(0, 400)}`);
  return body;
}
function toValue(v: any): any {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toValue(val);
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}
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
const stable = (v: any): string => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
};

// THE AGGREGATE THAT MUST SURVIVE: hours worked per employee, using the real
// pay helper (mechanicEmail, from, to, entries) with epoch-ms bounds.
//
// `to` is PINNED to one timestamp captured at start. computeHoursWorkedBetween
// treats a punch with no clockOut as running until Date.now(), so an open punch
// would otherwise accrue hours between the baseline call and the read-back call
// and the two would never match. Clamping both to the same instant makes the
// comparison deterministic — and still exercises the open-punch path.
const WINDOW_FROM = 0;
const WINDOW_TO = Date.now();
function hoursByUser(entries: TimeEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  const users = [...new Set(entries.map(e => (e.userEmail || '').toLowerCase()).filter(Boolean))];
  for (const u of users) {
    out[u] = Math.round(computeHoursWorkedBetween(u, WINDOW_FROM, WINDOW_TO, entries) * 1000) / 1000;
  }
  return out;
}

// ── 1. Read the doc-base ──────────────────────────────────────────────────
const before = await api(DOC);
const docEntries: TimeEntry[] = (before.fields?.timeEntries
  ? fromValue(before.fields.timeEntries) : []) as TimeEntry[];
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(`appData-backup-timeentries-${stamp}.json`, JSON.stringify(before, null, 2));
console.log(`Backup written: appData-backup-timeentries-${stamp}.json`);
console.log(`Doc timeEntries: ${docEntries.length} punches`);

const noId = docEntries.filter(e => !e?.id);
if (noId.length) { console.error(`ABORT — ${noId.length} punch(es) have no id.`); process.exit(1); }

const baseline = hoursByUser(docEntries);
const baselineFmt = JSON.stringify(baseline, Object.keys(baseline).sort());
const open = docEntries.filter(e => !e.clockOut).length;
console.log(`Baseline: ${Object.keys(baseline).length} employee(s), ${open} still clocked in`);

// ── 2. Copy ───────────────────────────────────────────────────────────────
const docName = (id: string) =>
  `projects/${PROJECT}/databases/(default)/documents/artifacts/crewmaster/public/data/timeEntries/${encodeURIComponent(id)}`;
if (docEntries.length) {
  const BATCH = 150;
  let written = 0;
  for (let i = 0; i < docEntries.length; i += BATCH) {
    const slice = docEntries.slice(i, i + BATCH);
    await api(`${BASE}:commit`, {
      method: 'POST',
      body: JSON.stringify({ writes: slice.map(e => ({ update: { name: docName(e.id), fields: toValue(e).mapValue.fields } })) }),
    });
    written += slice.length;
    console.log(`  copied ${written}/${docEntries.length}`);
  }
}

// ── 3. Read back ──────────────────────────────────────────────────────────
const subEntries: TimeEntry[] = [];
let page: string | undefined;
do {
  const q = new URLSearchParams({ pageSize: '300', ...(page ? { pageToken: page } : {}) });
  const r = await api(`${COL}?${q}`);
  for (const d of r.documents || []) subEntries.push(fromValue({ mapValue: { fields: d.fields || {} } }) as TimeEntry);
  page = r.nextPageToken;
} while (page);
console.log(`Read back from subcollection: ${subEntries.length} punches`);

// ── 4. Verify ─────────────────────────────────────────────────────────────
const subById = new Map(subEntries.map(e => [e.id, e]));
const missing = docEntries.filter(e => !subById.has(e.id)).map(e => e.id);
const changed = docEntries.filter(e => subById.has(e.id) && stable(subById.get(e.id)) !== stable(e)).map(e => e.id);
const subHours = hoursByUser(subEntries);
const subFmt = JSON.stringify(subHours, Object.keys(subHours).sort());
const openSub = subEntries.filter(e => !e.clockOut).length;

const checks: [string, boolean, string][] = [
  ['every punch id present', missing.length === 0, `${missing.length} missing`],
  ['every punch byte-identical', changed.length === 0, `${changed.length} changed`],
  ['hours-per-employee identical', subFmt === baselineFmt, subFmt === baselineFmt ? 'exact match' : 'MISMATCH'],
  ['open (un-clocked-out) punches preserved', open === openSub, `doc ${open} -> sub ${openSub}`],
];
console.log('\nVERIFY');
for (const [l, ok, d] of checks) console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l.padEnd(42)} ${d}`);
if (missing.length) console.log(`  missing: ${missing.slice(0, 5).join(', ')}`);
if (changed.length) console.log(`  changed: ${changed.slice(0, 5).join(', ')}`);

if (!checks.every(c => c[1])) {
  console.log('\n--- baseline ---\n' + baselineFmt);
  console.log('\n--- subcollection ---\n' + subFmt);
  console.error('\nVERIFICATION FAILED — the doc field has NOT been touched.');
  process.exit(1);
}
console.log('\nVerified: the subcollection reproduces every punch and every hours total.');
for (const [u, h] of Object.entries(baseline).sort()) console.log(`   ${u.padEnd(34)} ${h.toFixed(2)} h`);

if (!APPLY) { console.log('\nDRY RUN — doc field left in place. Re-run with --apply to clear it.'); process.exit(0); }

// ── 5. Clear ──────────────────────────────────────────────────────────────
await api(`${DOC}?updateMask.fieldPaths=timeEntries`, { method: 'PATCH', body: JSON.stringify({ fields: {} }) });
const after = await api(DOC);
const still = after.fields?.timeEntries !== undefined;
console.log(`\nCleared timeEntries from the doc. Field still present: ${still}`);
if (still) { console.error('WARNING — field did not clear.'); process.exit(1); }
console.log(`Top-level fields: ${Object.keys(after.fields || {}).length} (was ${Object.keys(before.fields || {}).length})`);

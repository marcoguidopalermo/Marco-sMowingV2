// Step 3 migration — relocate deletionAuditLog from the appData main doc into
// its own deletionAuditLog/{id} subcollection.
//
// Same protocol as the month-sheet and activityLog work:
//
//   COPY -> READ BACK -> VERIFY -> only then CLEAR
//
// The verification is aimed at the read path that actually matters. TimeMaster
// rebuilds DELETED time entries from these snapshots (TimeMaster.tsx
// deletedOwnerRows: filter recordType === 'time_entry', take d.snapshot as the
// TimeEntry, match on snapshot.userEmail, filter by snapshot.clockIn). For a
// deleted punch this trail is the ONLY surviving record — the TimeEntry is
// gone from timeEntries and from pay — so every `time_entry` snapshot is
// compared field-for-field after the round trip, not merely counted.
//
// USAGE
//   Dry run (copies + verifies, clears NOTHING):
//     npx tsx scripts/migrate-deletionaudit.ts
//   Apply (same, then clears the doc field):
//     npx tsx scripts/migrate-deletionaudit.ts --apply
//
// Idempotent. Auth: gcloud user credential.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import type { DeletionAuditEntry } from '../src/types';

const APPLY = process.argv.includes('--apply');
const PROJECT = 'crewmaster-73f31';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const PUB = `${BASE}/artifacts/crewmaster/public/data`;
const DOC = `${PUB}/appData/main`;
const COL = `${PUB}/deletionAuditLog`;

const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
async function api(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${url}\n${JSON.stringify(body).slice(0, 500)}`);
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
    const o: Record<string, any> = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) o[k] = fromValue(val);
    return o;
  }
  return null;
}
// Stable stringify so key order can't cause a false mismatch.
function stable(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
}

// ── 1. Read the doc-base ──────────────────────────────────────────────────
const before = await api(DOC);
const docLog: DeletionAuditEntry[] = (before.fields?.deletionAuditLog
  ? fromValue(before.fields.deletionAuditLog)
  : []) as DeletionAuditEntry[];

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(`appData-backup-deletionaudit-${stamp}.json`, JSON.stringify(before, null, 2));
console.log(`Backup written: appData-backup-deletionaudit-${stamp}.json`);
console.log(`Doc deletionAuditLog: ${docLog.length} entries`);

const noId = docLog.filter(d => !d?.id);
if (noId.length) { console.error(`ABORT — ${noId.length} entr(ies) have no id.`); process.exit(1); }

const byType: Record<string, number> = {};
for (const d of docLog) byType[d.recordType || '(none)'] = (byType[d.recordType || '(none)'] || 0) + 1;
console.log('By recordType: ' + Object.entries(byType).map(([k, v]) => `${k}=${v}`).join('  '));

// The TimeMaster reconstruction inputs, keyed by audit id.
const timeEntrySnapshots: Record<string, string> = {};
for (const d of docLog) {
  if (d.recordType === 'time_entry') timeEntrySnapshots[d.id] = stable(d.snapshot);
}
console.log(`time_entry snapshots to preserve exactly: ${Object.keys(timeEntrySnapshots).length}`);

// Full-entry fingerprint for every entry (who/when/what + snapshot).
const docFingerprint: Record<string, string> = {};
for (const d of docLog) docFingerprint[d.id] = stable(d);

// ── 2. Copy into the subcollection ────────────────────────────────────────
const docName = (id: string) =>
  `projects/${PROJECT}/databases/(default)/documents/artifacts/crewmaster/public/data/deletionAuditLog/${encodeURIComponent(id)}`;
if (docLog.length) {
  const BATCH = 200;
  let written = 0;
  for (let i = 0; i < docLog.length; i += BATCH) {
    const slice = docLog.slice(i, i + BATCH);
    await api(`${BASE}:commit`, {
      method: 'POST',
      body: JSON.stringify({ writes: slice.map(d => ({ update: { name: docName(d.id), fields: toValue(d).mapValue.fields } })) }),
    });
    written += slice.length;
    console.log(`  copied ${written}/${docLog.length}`);
  }
}

// ── 3. Read back ──────────────────────────────────────────────────────────
const subLog: DeletionAuditEntry[] = [];
let page: string | undefined;
do {
  const q = new URLSearchParams({ pageSize: '300', ...(page ? { pageToken: page } : {}) });
  const r = await api(`${COL}?${q}`);
  for (const d of r.documents || []) subLog.push(fromValue({ mapValue: { fields: d.fields || {} } }) as DeletionAuditEntry);
  page = r.nextPageToken;
} while (page);
console.log(`Read back from subcollection: ${subLog.length} entries`);

// ── 4. Verify ─────────────────────────────────────────────────────────────
const subById: Record<string, DeletionAuditEntry> = {};
for (const d of subLog) if (d?.id) subById[d.id] = d;

const missing = Object.keys(docFingerprint).filter(id => !subById[id]);
const changed = Object.keys(docFingerprint).filter(id => subById[id] && stable(subById[id]) !== docFingerprint[id]);
const teMismatch = Object.keys(timeEntrySnapshots).filter(
  id => !subById[id] || stable(subById[id].snapshot) !== timeEntrySnapshots[id],
);
// Reproduce TimeMaster's filter end-to-end on the round-tripped data.
const reconstructable = subLog
  .filter(d => d.recordType === 'time_entry')
  .map(d => d.snapshot as any)
  .filter(e => e && typeof e.userEmail === 'string' && e.clockIn);
const docReconstructable = docLog
  .filter(d => d.recordType === 'time_entry')
  .map(d => d.snapshot as any)
  .filter(e => e && typeof e.userEmail === 'string' && e.clockIn);

const checks: [string, boolean, string][] = [
  ['every doc id present in the subcollection', missing.length === 0, `${missing.length} missing`],
  ['every entry identical after round trip', changed.length === 0, `${changed.length} changed`],
  ['time_entry snapshots byte-identical', teMismatch.length === 0, `${teMismatch.length} differ`],
  ['TimeMaster can reconstruct the same set', reconstructable.length === docReconstructable.length,
    `doc ${docReconstructable.length} -> sub ${reconstructable.length}`],
];
console.log('\nVERIFY');
for (const [label, ok, detail] of checks) console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(44)} ${detail}`);
if (missing.length) console.log(`  missing: ${missing.slice(0, 5).join(', ')}`);
if (changed.length) console.log(`  changed: ${changed.slice(0, 5).join(', ')}`);

if (docReconstructable.length) {
  console.log('\nDeleted time entries recoverable from the trail:');
  for (const e of reconstructable) {
    console.log(`   ${String(e.userEmail).padEnd(32)} clockIn ${e.clockIn}  ${e.clockOut ? `clockOut ${e.clockOut}` : '(open)'}`);
  }
}

if (!checks.every(c => c[1])) {
  console.error('\nVERIFICATION FAILED — the doc field has NOT been touched.');
  process.exit(1);
}
console.log('\nVerified: the subcollection reproduces the trail exactly.');

if (!APPLY) { console.log('\nDRY RUN — doc field left in place. Re-run with --apply to clear it.'); process.exit(0); }

// ── 5. Clear ──────────────────────────────────────────────────────────────
await api(`${DOC}?updateMask.fieldPaths=deletionAuditLog`, { method: 'PATCH', body: JSON.stringify({ fields: {} }) });
const after = await api(DOC);
const stillThere = after.fields?.deletionAuditLog !== undefined;
console.log(`\nCleared deletionAuditLog from the doc. Field still present: ${stillThere}`);
if (stillThere) { console.error('WARNING — field did not clear.'); process.exit(1); }
console.log(`Top-level fields: ${Object.keys(after.fields || {}).length} (was ${Object.keys(before.fields || {}).length})`);

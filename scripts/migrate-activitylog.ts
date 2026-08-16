// Step 2 migration — relocate activityLog from the appData main doc into its
// own activityLog/{id} subcollection.
//
// The log feeds pay-adjacent readouts (MechanicPerformance labor/cost totals,
// MyMechanic's completed-repair list, pay-chunk completion counts), so this
// follows the same protocol as the month-sheet work:
//
//   COPY -> READ BACK -> VERIFY -> only then CLEAR
//
// The verification is not a row count. It recomputes the actual per-mechanic
// aggregates using workersForCompletion / shareForMechanic imported from
// src/lib/workCredit.ts — the SAME functions MechanicPerformance and
// MyMechanic call — from the doc copy and from the subcollection read back out
// of Firestore, and requires them to be identical to the cent and to 6 decimal
// places of share. If anything differs, nothing is cleared.
//
// USAGE
//   Dry run (copies + verifies, clears NOTHING):
//     npx tsx scripts/migrate-activitylog.ts
//   Apply (same, then clears the doc field):
//     npx tsx scripts/migrate-activitylog.ts --apply
//
// Idempotent: re-running re-copies (overwriting identical docs) and re-verifies.
// Auth: gcloud user credential (gcloud auth print-access-token).

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { workersForCompletion } from '../src/lib/workCredit';
import type { TaskActivity } from '../src/types';

const APPLY = process.argv.includes('--apply');
const PROJECT = 'crewmaster-73f31';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const PUB = `${BASE}/artifacts/crewmaster/public/data`;
const DOC = `${PUB}/appData/main`;
const COL = `${PUB}/activityLog`;

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

// ── Firestore REST typed-value codec ──────────────────────────────────────
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

// ── The aggregate that must survive the move ──────────────────────────────
// Mirrors MechanicPerformance's rows[] computation exactly: every 'completed'
// entry, split among its credited workers by share, accumulating repair count,
// severity split, labor hours and cost per mechanic.
interface Agg { total: number; minor: number; major: number; laborHours: number; cost: number }
function aggregate(log: TaskActivity[]): Record<string, Agg> {
  const out: Record<string, Agg> = {};
  for (const a of log) {
    if (a?.type !== 'completed') continue;
    const sev = a.taskSeverity || 'minor';
    const labor = Number(a.payload?.laborHours) || 0;
    const cost = Number(a.payload?.cost) || 0;
    for (const w of workersForCompletion(a)) {
      const key = (w.userEmail || 'unknown').toLowerCase();
      const row = out[key] || (out[key] = { total: 0, minor: 0, major: 0, laborHours: 0, cost: 0 });
      row.total += w.share;
      if (sev === 'major') row.major += w.share; else row.minor += w.share;
      row.laborHours += labor * w.share;
      row.cost += cost * w.share;
    }
  }
  return out;
}
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const fmtAgg = (a: Record<string, Agg>) =>
  Object.keys(a).sort().map(k =>
    `${k}|${r6(a[k].total)}|${r6(a[k].minor)}|${r6(a[k].major)}|${r6(a[k].laborHours)}|${r6(a[k].cost)}`
  ).join('\n');

// ── 1. Read the doc-base ──────────────────────────────────────────────────
const before = await api(DOC);
const docLog: TaskActivity[] = (before.fields?.activityLog
  ? fromValue(before.fields.activityLog)
  : []) as TaskActivity[];

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(`appData-backup-activitylog-${stamp}.json`, JSON.stringify(before, null, 2));
console.log(`Backup written: appData-backup-activitylog-${stamp}.json`);
console.log(`Doc activityLog: ${docLog.length} entries`);
if (docLog.length === 0) {
  console.log('Nothing in the doc to migrate. (Already cleared?)');
}
const withoutId = docLog.filter(a => !a?.id);
if (withoutId.length) {
  console.error(`ABORT — ${withoutId.length} entr(ies) have no id and cannot be keyed into a subcollection.`);
  process.exit(1);
}
const dupes = docLog.length - new Set(docLog.map(a => a.id)).size;
if (dupes > 0) console.log(`NOTE: ${dupes} duplicate id(s) in the doc array — the subcollection will hold one doc per id.`);

const baselineAgg = aggregate(docLog);
const baseline = fmtAgg(baselineAgg);
const baseCompleted = docLog.filter(a => a?.type === 'completed').length;
console.log(`Baseline from DOC: ${baseCompleted} completed entries across ${Object.keys(baselineAgg).length} mechanic(s)`);

// ── 2. Copy into the subcollection (batched commits) ──────────────────────
const docName = (id: string) =>
  `projects/${PROJECT}/databases/(default)/documents/artifacts/crewmaster/public/data/activityLog/${encodeURIComponent(id)}`;
if (docLog.length) {
  const BATCH = 200;
  let written = 0;
  for (let i = 0; i < docLog.length; i += BATCH) {
    const slice = docLog.slice(i, i + BATCH);
    const writes = slice.map(a => ({
      update: { name: docName(a.id), fields: toValue(a).mapValue.fields },
    }));
    await api(`${BASE}:commit`, { method: 'POST', body: JSON.stringify({ writes }) });
    written += slice.length;
    console.log(`  copied ${written}/${docLog.length}`);
  }
}

// ── 3. Read the subcollection BACK out of Firestore ───────────────────────
const subLog: TaskActivity[] = [];
let page: string | undefined;
do {
  const q = new URLSearchParams({ pageSize: '300', ...(page ? { pageToken: page } : {}) });
  const r = await api(`${COL}?${q}`);
  for (const d of r.documents || []) subLog.push(fromValue({ mapValue: { fields: d.fields || {} } }) as TaskActivity);
  page = r.nextPageToken;
} while (page);
console.log(`Read back from subcollection: ${subLog.length} entries`);

// ── 4. Verify ─────────────────────────────────────────────────────────────
const docIds = new Set(docLog.map(a => a.id));
const subIds = new Set(subLog.map(a => a.id));
const missing = [...docIds].filter(id => !subIds.has(id));
const subAgg = aggregate(subLog);
const subFmt = fmtAgg(subAgg);
const subCompleted = subLog.filter(a => a?.type === 'completed').length;

const checks: [string, boolean, string][] = [
  ['every doc id present in the subcollection', missing.length === 0, `${missing.length} missing${missing.length ? ': ' + missing.slice(0, 5).join(', ') : ''}`],
  ['completed-entry count matches', subCompleted >= baseCompleted, `doc ${baseCompleted} -> sub ${subCompleted}`],
  ['per-mechanic aggregates identical', subFmt === baseline, subFmt === baseline ? 'exact match' : 'MISMATCH'],
];
console.log('\nVERIFY');
for (const [label, ok, detail] of checks) console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(44)} ${detail}`);

if (subFmt !== baseline) {
  console.log('\n--- baseline (doc) ---\n' + baseline);
  console.log('\n--- subcollection ---\n' + subFmt);
}
const allOk = checks.every(c => c[1]);
if (!allOk) {
  console.error('\nVERIFICATION FAILED — the doc field has NOT been touched.');
  process.exit(1);
}
console.log('\nVerified: the subcollection reproduces the doc aggregates exactly.');
Object.entries(baselineAgg).sort().forEach(([k, v]) =>
  console.log(`   ${k.padEnd(34)} ${r6(v.total).toString().padStart(6)} repairs  ${r6(v.laborHours).toFixed(2).padStart(8)} h  $${r6(v.cost).toFixed(2)}`));

if (!APPLY) { console.log('\nDRY RUN — doc field left in place. Re-run with --apply to clear it.'); process.exit(0); }

// ── 5. Clear the doc field ────────────────────────────────────────────────
await api(`${DOC}?updateMask.fieldPaths=activityLog`, { method: 'PATCH', body: JSON.stringify({ fields: {} }) });
const after = await api(DOC);
const stillThere = after.fields?.activityLog !== undefined;
console.log(`\nCleared activityLog from the doc. Field still present: ${stillThere}`);
if (stillThere) { console.error('WARNING — field did not clear.'); process.exit(1); }
console.log(`Top-level fields: ${Object.keys(after.fields || {}).length} (was ${Object.keys(before.fields || {}).length})`);

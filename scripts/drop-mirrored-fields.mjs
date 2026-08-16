// Step 1 cleanup — remove the subcollection-mirrored fields from the appData
// main doc. These fields are READ from their own subcollections (the overlay
// block in App.tsx assigns each from its sub*Ref); the copy in the doc is
// unread duplicate data that syncToCloud used to rewrite on every save. The
// matching code change (SUBCOLLECTION_ONLY_FIELDS in App.tsx) stops the
// rewrite; this removes what has already accumulated.
//
// SAFETY MODEL (verify → back up → delete):
//   1. Read the live doc and write a full JSON backup BEFORE touching it.
//   2. For EVERY field, read its collection and prove the collection is a
//      superset of the doc's copy — every key in the doc must exist as a
//      document id in the collection. A field that fails this gate is SKIPPED
//      (never deleted), and its keys are reported.
//   3. Delete only the fields that passed, in one PATCH with an updateMask.
//   4. Re-read and confirm the fields are gone and the doc shrank.
//
// Nothing here writes to a collection — only the doc loses fields, and only
// fields whose data is provably already stored elsewhere.
//
// USAGE
//   Dry run (default — reports the gate result, writes nothing):
//     node scripts/drop-mirrored-fields.mjs
//   Apply:
//     node scripts/drop-mirrored-fields.mjs --apply
//
// Auth: uses the gcloud user credential (gcloud auth print-access-token).

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const PROJECT = 'crewmaster-73f31';
const APP = 'crewmaster';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const PUB = `${BASE}/artifacts/${APP}/public/data`;
const DOC = `${PUB}/appData/main`;

// field → collection URL holding its real data. Most live under public/data;
// the two rate-config collections are TOP-LEVEL (a dedicated firestore rule
// restricts writes to the super admin — see App.tsx).
const ROOT_LEVEL = new Set(['snowRateConfigs', 'lawnRateConfigs']);
const FIELDS = [
  'monthlySummaries',
  'roleMasterRoles', 'roleMasterDuties', 'roleMasterResponsibilities',
  'roleMasterTemplates', 'roleMasterPolicies', 'roleMasterPolicyRequests',
  'roleTaskInstances',
  'salesMasterQuotes',
  'snowQuotes', 'snowRateConfigs', 'lawnQuotes', 'lawnRateConfigs',
  'contractingProjects', 'contractingTimeEntries', 'contractingProgressReports',
  'contractingInvoices', 'contractingWorkOrders', 'contractingShoppingList',
  'contractingPersonalItems', 'contractingPropertyDocs',
  'marketingContent', 'marketingShots', 'marketingLinks', 'marketingFeedback',
  'marketingClips', 'marketingPostQueue', 'marketingTodos',
  'hoursBank',
];

const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
const api = async (url, init) => {
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${url}\n${JSON.stringify(body).slice(0, 400)}`);
  return body;
};

const u8 = s => Buffer.byteLength(String(s), 'utf8');
// Firestore's documented per-type sizing (NOT JSON length).
function fsBytes(v) {
  if ('nullValue' in v || 'booleanValue' in v) return 1;
  if ('integerValue' in v || 'doubleValue' in v || 'timestampValue' in v) return 8;
  if ('geoPointValue' in v) return 16;
  if ('stringValue' in v) return u8(v.stringValue) + 1;
  if ('bytesValue' in v) return Buffer.from(v.bytesValue, 'base64').length;
  if ('referenceValue' in v) return u8(v.referenceValue.split('/documents/')[1] || v.referenceValue) + 16;
  if ('arrayValue' in v) return (v.arrayValue.values || []).reduce((s, e) => s + fsBytes(e), 0);
  if ('mapValue' in v) {
    let s = 0;
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) s += u8(k) + 1 + fsBytes(val);
    return s;
  }
  return 0;
}
const docSize = d =>
  Object.entries(d.fields || {}).reduce((s, [k, v]) => s + u8(k) + 1 + fsBytes(v), 0) + 32 + u8(d.name) + 1;
const kb = b => `${(b / 1024).toFixed(1)} KB`;

// ── 1. Read live doc + back it up ─────────────────────────────────────────
const before = await api(DOC);
const beforeBytes = docSize(before);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `appData-backup-dropmirror-${stamp}.json`;
writeFileSync(backup, JSON.stringify(before, null, 2));
console.log(`Backup written: ${backup}`);
console.log(`Doc before: ${beforeBytes.toLocaleString()} B  ${kb(beforeBytes)}  ${((beforeBytes / 1048576) * 100).toFixed(1)}% of 1 MiB\n`);

// ── 2. Gate each field against its collection ─────────────────────────────
const pass = [], skip = [];
for (const f of FIELDS) {
  const v = before.fields?.[f];
  if (v === undefined) { console.log(`${f.padEnd(30)} absent from doc — nothing to do`); continue; }
  const keys = 'mapValue' in v ? Object.keys(v.mapValue.fields || {}) : null;
  if (keys === null) { skip.push(f); console.log(`${f.padEnd(30)} SKIP — not a map (unexpected shape)`); continue; }
  const bytes = u8(f) + 1 + fsBytes(v);

  if (keys.length === 0) {
    pass.push({ f, bytes, note: 'empty map — no data to lose' });
    console.log(`${f.padEnd(30)} ${kb(bytes).padStart(9)}  OK  empty map`);
    continue;
  }
  const colUrl = ROOT_LEVEL.has(f) ? `${BASE}/${f}` : `${PUB}/${f}`;
  let ids = new Set();
  try {
    let page;
    do {
      const q = new URLSearchParams({ pageSize: '300', ...(page ? { pageToken: page } : {}) });
      // No field mask: Firestore rejects reserved-looking paths (a `__x__`
      // mask 400s), and every legitimate mask still returns the doc name,
      // so there is nothing to gain. We only read `name` off each result.
      const r = await api(`${colUrl}?${q}`);
      for (const d of r.documents || []) ids.add(decodeURIComponent(d.name.split('/').pop()));
      page = r.nextPageToken;
    } while (page);
  } catch (e) {
    skip.push(f);
    console.log(`${f.padEnd(30)} SKIP — could not read ${colUrl}: ${String(e).slice(0, 80)}`);
    continue;
  }
  const missing = keys.filter(k => !ids.has(k));
  if (missing.length) {
    skip.push(f);
    console.log(`${f.padEnd(30)} ${kb(bytes).padStart(9)}  SKIP — ${missing.length} key(s) NOT in collection: ${missing.slice(0, 5).join(', ')}`);
  } else {
    pass.push({ f, bytes, note: `${keys.length} key(s) all present in collection (${ids.size} docs)` });
    console.log(`${f.padEnd(30)} ${kb(bytes).padStart(9)}  OK  ${keys.length} key(s) verified in collection (${ids.size} docs)`);
  }
}

const reclaim = pass.reduce((s, p) => s + p.bytes, 0);
console.log(`\n${pass.length} field(s) pass the gate — ${kb(reclaim)} to reclaim`);
if (skip.length) console.log(`${skip.length} field(s) SKIPPED (left untouched): ${skip.join(', ')}`);
console.log(`Projected: ${kb(beforeBytes)} -> ${kb(beforeBytes - reclaim)}  (${(((beforeBytes - reclaim) / 1048576) * 100).toFixed(1)}% of 1 MiB)`);

if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply to delete.'); process.exit(0); }
if (!pass.length) { console.log('\nNothing to delete.'); process.exit(0); }

// ── 3. Delete the passing fields (updateMask + empty body = field delete) ──
const mask = pass.map(p => `updateMask.fieldPaths=${encodeURIComponent(p.f)}`).join('&');
await api(`${DOC}?${mask}`, { method: 'PATCH', body: JSON.stringify({ fields: {} }) });
console.log(`\nDeleted ${pass.length} field(s).`);

// ── 4. Verify ─────────────────────────────────────────────────────────────
const after = await api(DOC);
const afterBytes = docSize(after);
const stillThere = pass.filter(p => after.fields?.[p.f] !== undefined).map(p => p.f);
console.log(`Doc after : ${afterBytes.toLocaleString()} B  ${kb(afterBytes)}  ${((afterBytes / 1048576) * 100).toFixed(1)}% of 1 MiB`);
console.log(`Reclaimed : ${kb(beforeBytes - afterBytes)}`);
console.log(stillThere.length ? `WARNING — still present: ${stillThere.join(', ')}` : 'Verified — every deleted field is gone.');
console.log(`Remaining top-level fields: ${Object.keys(after.fields || {}).length} (was ${Object.keys(before.fields || {}).length})`);

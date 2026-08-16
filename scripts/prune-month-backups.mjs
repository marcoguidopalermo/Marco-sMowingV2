// Housekeeping — prune the month-sheet backup collections.
//
// performanceMonthsBackup and scheduleMonthsBackup accumulate one doc per
// archive pass ({YYYY-MM}-{epochMs}), so a month gains a new full-size backup
// every time a day is archived into it. Nothing ever removed them. They carry
// NO document-limit risk (each is its own doc, and none is near 1 MiB) — this
// is purely reclaiming storage.
//
// SAFETY GATE — a backup is only ever deleted when the LIVE sheet it backs up
// is present and at least as complete. For each month we compare dayCount:
//
//     live sheet dayCount  >=  max dayCount across that month's backups
//
// If the live sheet is missing, unreadable, or has FEWER days than any backup,
// that month is skipped entirely and nothing of its is deleted — because in
// that case a backup may be the only copy of a day. The newest KEEP backups
// per month are always retained regardless.
//
// USAGE
//   Dry run (default — reports the plan, deletes nothing):
//     node scripts/prune-month-backups.mjs
//   Apply:
//     node scripts/prune-month-backups.mjs --apply
//   Retention (default 3):
//     KEEP=5 node scripts/prune-month-backups.mjs
//
// Auth: gcloud user credential.

import { execFileSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');
const KEEP = Number(process.env.KEEP || 3);
const PROJECT = 'crewmaster-73f31';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const PUB = `${BASE}/artifacts/crewmaster/public/data`;

const PAIRS = [
  { backup: 'performanceMonthsBackup', live: 'performanceMonths' },
  { backup: 'scheduleMonthsBackup', live: 'scheduleMonths' },
];

const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
async function api(url, init) {
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (r.status === 404) return null;
  const body = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${url}\n${JSON.stringify(body).slice(0, 300)}`);
  return body;
}
async function listAll(path) {
  const out = [];
  let page;
  do {
    const q = new URLSearchParams({ pageSize: '300', ...(page ? { pageToken: page } : {}) });
    const r = await api(`${path}?${q}`);
    for (const d of r?.documents || []) out.push(d);
    page = r?.nextPageToken;
  } while (page);
  return out;
}
// dayCount is authoritative when present; fall back to counting the days map.
const dayCountOf = d => {
  const f = d.fields || {};
  const explicit = f.dayCount?.integerValue;
  if (explicit !== undefined) return Number(explicit);
  return Object.keys(f.days?.mapValue?.fields || {}).length;
};
const sizeOf = d => JSON.stringify(d.fields || {}).length;
const kb = b => `${(b / 1024).toFixed(1)} KB`;
const mb = b => `${(b / 1048576).toFixed(2)} MB`;

let totalFreed = 0, totalDeleted = 0, totalSkipped = 0;

for (const { backup, live } of PAIRS) {
  console.log(`\n=== ${backup} ===`);
  const backups = await listAll(`${PUB}/${backup}`);
  const lives = await listAll(`${PUB}/${live}`);
  const liveByMonth = {};
  for (const d of lives) liveByMonth[d.name.split('/').pop()] = d;

  // Group backups by their {YYYY-MM} prefix, newest timestamp first.
  const groups = {};
  for (const d of backups) {
    const id = d.name.split('/').pop();
    const m = /^(\d{4}-\d{2})-(\d+)$/.exec(id);
    if (!m) { console.log(`  ?? ${id} — unrecognised id shape, SKIPPED`); totalSkipped++; continue; }
    (groups[m[1]] = groups[m[1]] || []).push({ id, ts: Number(m[2]), doc: d });
  }

  for (const month of Object.keys(groups).sort()) {
    const list = groups[month].sort((a, b) => b.ts - a.ts);
    const maxBackupDays = Math.max(...list.map(x => dayCountOf(x.doc)));
    const liveDoc = liveByMonth[month];
    const liveDays = liveDoc ? dayCountOf(liveDoc) : -1;

    if (!liveDoc) {
      console.log(`  ${month}: SKIP — no live ${live}/${month} sheet; backups may be the only copy (${list.length} kept)`);
      totalSkipped += list.length;
      continue;
    }
    if (liveDays < maxBackupDays) {
      console.log(`  ${month}: SKIP — live sheet has ${liveDays} days but a backup has ${maxBackupDays} (${list.length} kept)`);
      totalSkipped += list.length;
      continue;
    }

    const keep = list.slice(0, KEEP);
    const drop = list.slice(KEEP);
    const freed = drop.reduce((s, x) => s + sizeOf(x.doc), 0);
    console.log(`  ${month}: live sheet ${liveDays} days >= max backup ${maxBackupDays} days — safe`);
    console.log(`     keep ${keep.length} newest: ${keep.map(k => `${k.id.split('-').pop()}(${dayCountOf(k.doc)}d)`).join(', ')}`);
    console.log(`     delete ${drop.length}: ${kb(freed)}`);
    totalFreed += freed;
    totalDeleted += drop.length;

    if (APPLY && drop.length) {
      // One DELETE per document rather than a batched :commit. A commit is
      // atomic and its transaction has a size limit that these sheets blow
      // through — 18 backups totalling ~6 MB returns "Transaction too big".
      // Deletes are independent here (each backup stands alone), so there is
      // nothing to gain from atomicity and the per-doc form always fits.
      let n = 0;
      for (const x of drop) {
        await api(`${BASE}/${x.doc.name.split('/documents/')[1]}`, { method: 'DELETE' });
        n++;
        if (n % 5 === 0 || n === drop.length) console.log(`     deleted ${n}/${drop.length}`);
      }
    }
  }
}

console.log(`\n${APPLY ? 'DELETED' : 'WOULD DELETE'} ${totalDeleted} backup doc(s), reclaiming ${mb(totalFreed)} (${kb(totalFreed)})`);
if (totalSkipped) console.log(`${totalSkipped} doc(s) skipped by the safety gate.`);
if (!APPLY) console.log('\nDRY RUN — nothing deleted. Re-run with --apply.');
else {
  console.log('\nVerifying remaining counts:');
  for (const { backup } of PAIRS) {
    const left = await listAll(`${PUB}/${backup}`);
    console.log(`  ${backup}: ${left.length} docs, ${kb(left.reduce((s, d) => s + sizeOf(d), 0))}`);
  }
}

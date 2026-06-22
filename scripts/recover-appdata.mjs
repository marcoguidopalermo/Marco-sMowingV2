// One-time recovery for an appData doc sitting at Firestore's 1 MiB cap.
//
// WHY THIS EXISTS
//   The whole app stores state in ONE document:
//     artifacts/crewmaster/public/data/appData/main
//   Firestore never stores a doc > 1,048,576 bytes, so the saved doc is
//   already <= 1 MiB and reads fine. Only GROW-the-doc writes fail (a delete
//   appends a full-record snapshot to deletionAuditLog). A net-REDUCING write
//   is under the cap and succeeds — that is exactly what --apply does here.
//
// THE BLOAT (measured from the dry-run backup, 2026-06-10)
//   multiDayJobs     496.7 KB  (720 completed = 439.9 KB, 73 in_progress)
//   performance      345.1 KB  (May 14–31 = 125.9 KB; June = 218.8 KB)
//   inspections       95.2 KB  (101 pre-June = 38.8 KB)
//   deletionAuditLog  20.5 KB  (minor)
//   TOTAL          1,161.4 KB  → ~123 KB over the cap.
//
// SCOPED, TEST-ERA-ONLY TRIMS (CUTOFF = 2026-06-01)
//   1. multiDayJobs: drop COMPLETED jobs whose work finished before June
//      (latest completionHistory.targetDate < CUTOFF, or — if no history —
//      firstSeenAt < CUTOFF). KEEPS every in_progress ledger (carry-forward)
//      and every June+ completed ledger (review UI). ~194 KB.
//      The credited BH already lives in performance[date][crew].jobs[].bh —
//      the ledger is tracking metadata, not the bonus source of truth.
//   2. performance: drop date keys < CUTOFF (pre-June test data, excluded
//      from bonus; reads are per-selected-date, no cross-date aggregation).
//      ~126 KB.
//   3. inspections: drop entries with date < CUTOFF. ~39 KB.
//   4. deletionAuditLog: cap 500 + strip non-time_entry snapshots (minor;
//      matches the deployed syncToCloud normalization).
//   Projected total after 1–4: ~795 KB (well under 1024, ~229 KB headroom).
//   KEEP: June+ performance, in_progress + June completed multiDayJobs,
//         June inspections, time_entry audit snapshots (TimeMaster reads).
//
// USAGE
//   SUPERADMIN_EMAIL=you@example.com SUPERADMIN_PASSWORD='...' \
//     node scripts/recover-appdata.mjs            # backup + report only
//   ... node scripts/recover-appdata.mjs --apply  # also shrink the doc
//   Optional: MDJ_MODE=allCompleted removes ALL completed ledgers (frees an
//   extra ~245 KB by also dropping June completed) — more headroom, but the
//   June completion-review UI for those visits goes blank. Default: preJune.

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { writeFileSync } from 'node:fs';

const firebaseConfig = {
  apiKey: 'AIzaSyCQjueOGMf4CtjHOJ2xLCdmZ2leyeEBctU',
  authDomain: 'crewmaster-73f31.firebaseapp.com',
  projectId: 'crewmaster-73f31',
  storageBucket: 'crewmaster-73f31.firebasestorage.app',
  messagingSenderId: '831920078849',
  appId: '1:831920078849:web:8d72204b58c48bb21f0000',
};

const DOC_PATH = ['artifacts', 'crewmaster', 'public', 'data', 'appData', 'main'];
const CUTOFF = '2026-06-01';                 // keep >= this date; drop test era
const MAX_AUDIT_ENTRIES = 500;
const APPLY = process.argv.includes('--apply');
const MDJ_MODE = process.env.MDJ_MODE === 'allCompleted' ? 'allCompleted' : 'preJune';

const bytes = (v) => Buffer.byteLength(JSON.stringify(v ?? null), 'utf8');
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const epochToYmd = (ms) =>
  Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;

// Age of a multi-day ledger: the last day work was credited, else firstSeen.
function mdjAgeDate(j) {
  const h = Array.isArray(j.completionHistory) ? j.completionHistory : [];
  if (h.length) return h.map((x) => x.targetDate).filter(Boolean).sort().slice(-1)[0] || null;
  return epochToYmd(j.firstSeenAt);
}

// --- pure trims (return NEW shrunken values; never mutate input) ----------
function trimMultiDayJobs(mdj) {
  const out = {};
  let dropped = 0;
  for (const [k, j] of Object.entries(mdj || {})) {
    const isComplete = j?.status === 'complete';
    const old = MDJ_MODE === 'allCompleted'
      ? isComplete
      : isComplete && (() => { const a = mdjAgeDate(j); return a != null && a < CUTOFF; })();
    if (old) { dropped++; continue; }   // drop finished/test-era ledger
    out[k] = j;                         // KEEP in_progress + (scoped) completed
  }
  return { out, dropped };
}
function trimPerformance(perf) {
  const out = {};
  let dropped = 0;
  for (const [date, day] of Object.entries(perf || {})) {
    if (date < CUTOFF) { dropped++; continue; }
    out[date] = day;
  }
  return { out, dropped };
}
function trimInspections(insp) {
  const kept = (insp || []).filter((i) => !((i?.date || '') < CUTOFF));
  return { out: kept, dropped: (insp || []).length - kept.length };
}
function trimAuditLog(audit) {
  return (audit || []).slice(0, MAX_AUDIT_ENTRIES).map((e) => {
    if (!e || e.recordType === 'time_entry' || e.snapshot == null) return e;
    return { ...e, snapshot: { trimmed: true } };
  });
}

async function main() {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!email || !password) {
    console.error('Set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD env vars.');
    process.exit(1);
  }

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  await signInWithEmailAndPassword(auth, email, password);
  console.log(`Signed in as ${email}  (MDJ_MODE=${MDJ_MODE})`);

  const ref = doc(db, ...DOC_PATH);
  const snap = await getDoc(ref);              // reads are NOT size-limited
  if (!snap.exists()) { console.error('appData doc does not exist.'); process.exit(1); }
  const data = snap.data();

  // 1) BACKUP first, always — full doc to a timestamped local file.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `appData-backup-${stamp}.json`;
  writeFileSync(backupFile, JSON.stringify(data, null, 2));
  const total = bytes(data);
  console.log(`\nBackup written: ${backupFile}`);
  console.log(`Total doc size: ${kb(total)} (cap = 1024.0 KB)`);

  // 2) Compute each trim + projected savings (no writes yet).
  const mdjT = trimMultiDayJobs(data.multiDayJobs || {});
  const perfT = trimPerformance(data.performance || {});
  const inspT = trimInspections(data.inspections || []);
  const auditT = trimAuditLog(data.deletionAuditLog || []);

  const steps = [
    { field: 'multiDayJobs',     value: mdjT.out,   was: data.multiDayJobs || {},   dropped: `${mdjT.dropped} ledgers` },
    { field: 'performance',      value: perfT.out,  was: data.performance || {},    dropped: `${perfT.dropped} dates` },
    { field: 'inspections',      value: inspT.out,  was: data.inspections || [],    dropped: `${inspT.dropped} items` },
    { field: 'deletionAuditLog', value: auditT,     was: data.deletionAuditLog || [], dropped: 'snapshots stripped/capped' },
  ];

  console.log('\nPlanned reducing writes (each shrinks the doc):');
  let projected = total;
  for (const s of steps) {
    const saved = bytes(s.was) - bytes(s.value);
    projected -= saved;
    console.log(`  ${s.field.padEnd(18)} -${kb(saved).padStart(9)}  (drop ${s.dropped})  → running total ${kb(projected)}`);
  }
  console.log(`\nProjected final: ${kb(projected)}  (headroom ${kb(1048576 - projected)})`);
  if (projected >= 1048576) console.log('WARNING: projection still >= cap. Consider MDJ_MODE=allCompleted.');

  if (!APPLY) {
    console.log('\nDRY RUN — no write performed. Re-run with --apply to shrink the doc.');
    process.exit(0);
  }

  // 3) APPLY — sequential field-level REDUCING writes, biggest first. Each
  //    updateDoc replaces one field with its smaller value; the 1 MiB cap is
  //    checked against the resulting document, which strictly shrinks, so
  //    every write passes even though a normal delete (a growth write) does
  //    not. Sequential (not one batch) so a failure leaves prior progress.
  for (const s of steps) {
    process.stdout.write(`Writing ${s.field}... `);
    await updateDoc(ref, { [s.field]: s.value });
    console.log('ok');
  }

  const after = await getDoc(ref);
  console.log(`\nApplied. Doc is now ${kb(bytes(after.data()))} (cap 1024.0 KB).`);
  console.log('Next: open the app and run Settings → Clean Up Duplicate Repairs.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Recovery failed:', err?.code || '', err?.message || err);
  process.exit(1);
});

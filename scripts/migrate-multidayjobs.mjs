// Phase 1 migration: move appData.multiDayJobs OUT of the single appData
// doc and into its own subcollection (one doc per jobberVisitId).
//
// WHY
//   multiDayJobs was the largest field (~half) of the 1 MiB-capped appData
//   doc and its fastest grower. As a subcollection it grows without limit.
//   The app + cloud sync already read/write the subcollection (with a
//   doc-base overlay merge) so this migration is deploy-order-independent:
//   run it any time after the Phase 1 code is live; the removal pass is the
//   only step that actually shrinks the appData doc.
//
// SAFETY MODEL (staged — backup, fan-out, validate, THEN remove)
//   1. Always backs up the full appData doc first.
//   2. --apply fans every ledger out into multiDayJobs/{encodeURIComponent
//      (visitId)} (completed ledgers are slimmed identically to the app's
//      syncToCloud). The in-doc copy is LEFT IN PLACE.
//   3. Validate in the live app (PerformanceBoard / completion review look
//      correct; sync carry-forward works).
//   4. --remove deletes appData.multiDayJobs ONLY after confirming the
//      subcollection doc count >= the in-doc ledger count. The Phase 1 app
//      code then writes an empty base and the doc shrinks ~half.
//
// USAGE
//   SUPERADMIN_EMAIL=you@example.com SUPERADMIN_PASSWORD='...' \
//     node scripts/migrate-multidayjobs.mjs              # backup + report only
//   ... node scripts/migrate-multidayjobs.mjs --apply    # fan out to subcollection
//   ... node scripts/migrate-multidayjobs.mjs --remove   # delete field from appData (after validate)

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore, doc, getDoc, updateDoc, deleteField,
  collection, getDocs, writeBatch,
} from 'firebase/firestore';
import { writeFileSync } from 'node:fs';

const firebaseConfig = {
  apiKey: 'AIzaSyCQjueOGMf4CtjHOJ2xLCdmZ2leyeEBctU',
  authDomain: 'crewmaster-73f31.firebaseapp.com',
  projectId: 'crewmaster-73f31',
  storageBucket: 'crewmaster-73f31.firebasestorage.app',
  messagingSenderId: '831920078849',
  appId: '1:831920078849:web:8d72204b58c48bb21f0000',
};

const APP_ID = 'crewmaster';
const DOC_PATH = ['artifacts', APP_ID, 'public', 'data', 'appData', 'main'];
const MDJ_PATH = ['artifacts', APP_ID, 'public', 'data', 'multiDayJobs'];
const APPLY = process.argv.includes('--apply');
const REMOVE = process.argv.includes('--remove');

const bytes = (v) => Buffer.byteLength(JSON.stringify(v ?? null), 'utf8');
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const encId = (visitId) => encodeURIComponent(visitId);

// Mirror the app's Phase 0 slim so the subcollection matches what
// syncToCloud would write: strip write/display-only strings from each
// completed ledger's history + drop the dead firstSeenAt field. Keeps every
// entry and all structural fields (the 3 defensive reads stay intact).
function slimLedger(j) {
  if (!j || j.status !== 'complete') return j;
  const { firstSeenAt, ...rest } = j;
  return {
    ...rest,
    completionHistory: (j.completionHistory || []).map((e) => {
      const { reasonNote, markedBy, markedByName, ...keep } = e;
      return keep;
    }),
  };
}

async function main() {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!email || !password) {
    console.error('Set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD env vars.');
    process.exit(1);
  }
  if (APPLY && REMOVE) {
    console.error('Run --apply and --remove in SEPARATE passes (validate in between).');
    process.exit(1);
  }

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  await signInWithEmailAndPassword(auth, email, password);
  console.log(`Signed in as ${email}`);

  const ref = doc(db, ...DOC_PATH);
  const snap = await getDoc(ref);
  if (!snap.exists()) { console.error('appData doc does not exist.'); process.exit(1); }
  const data = snap.data();

  // 1) BACKUP first, always.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `appData-backup-${stamp}.json`;
  writeFileSync(backupFile, JSON.stringify(data, null, 2));
  console.log(`\nBackup written: ${backupFile}`);
  console.log(`appData doc size: ${kb(bytes(data))} (cap 1024.0 KB)`);

  const mdj = data.multiDayJobs || {};
  const keys = Object.keys(mdj);
  const inProg = keys.filter((k) => mdj[k]?.status === 'in_progress').length;
  const complete = keys.filter((k) => mdj[k]?.status === 'complete').length;
  console.log(`\nmultiDayJobs in appData doc: ${keys.length} ledgers (${inProg} in-progress, ${complete} complete), ${kb(bytes(mdj))}`);

  // Current subcollection state (for validation / idempotency).
  const colRef = collection(db, ...MDJ_PATH);
  const existing = await getDocs(colRef);
  console.log(`multiDayJobs subcollection currently holds: ${existing.size} docs`);

  // --- REMOVE pass -------------------------------------------------------
  if (REMOVE) {
    if (existing.size < keys.length) {
      console.error(
        `\nABORT: subcollection has ${existing.size} docs but the appData ` +
        `doc still lists ${keys.length} ledgers. Run --apply and validate ` +
        `BEFORE --remove (we never delete the in-doc copy until every ledger ` +
        `is confirmed in the subcollection).`,
      );
      process.exit(1);
    }
    await updateDoc(ref, { multiDayJobs: deleteField() });
    const after = await getDoc(ref);
    console.log(`\nRemoved multiDayJobs from appData doc.`);
    console.log(`appData doc size now: ${kb(bytes(after.data()))} (was ${kb(bytes(data))}).`);
    console.log('Done. The Phase 1 app code now sources ledgers solely from the subcollection.');
    process.exit(0);
  }

  // --- APPLY (fan-out) ---------------------------------------------------
  if (!APPLY) {
    let saved = 0;
    for (const k of keys) saved += bytes(mdj[k]) - bytes(slimLedger(mdj[k]));
    console.log(`\nDRY RUN — would fan ${keys.length} ledgers into the subcollection (slim saves ~${kb(saved)} on completed ones).`);
    console.log('Re-run with --apply to write them, then --remove (after validating) to shrink the doc.');
    process.exit(0);
  }

  let written = 0;
  for (let i = 0; i < keys.length; i += 400) {
    const batch = writeBatch(db);
    for (const k of keys.slice(i, i + 400)) {
      const ledger = slimLedger(mdj[k]);
      const clean = JSON.parse(JSON.stringify(ledger, (_key, val) => val === undefined ? null : val));
      batch.set(doc(colRef, encId(k)), clean);
      written++;
    }
    await batch.commit();
    console.log(`  fanned ${Math.min(i + 400, keys.length)}/${keys.length}...`);
  }
  const afterCol = await getDocs(colRef);
  console.log(`\nFan-out complete: wrote ${written} ledgers. Subcollection now holds ${afterCol.size} docs.`);
  console.log('The in-doc copy is LEFT IN PLACE. Validate the app, then run --remove to delete it and shrink the doc.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err?.code || '', err?.message || err);
  process.exit(1);
});

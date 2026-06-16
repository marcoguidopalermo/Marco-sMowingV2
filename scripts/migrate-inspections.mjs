// Phase 3 migration: move appData.inspections OUT of the single appData doc
// into its own subcollection (one doc per inspection id).
//
// WHY
//   inspections were ~95 KB and growing ~39 KB/week inside the 1 MiB-capped
//   appData doc. As a subcollection they grow without limit and DOT
//   retention history is preserved (every inspection is kept, just
//   relocated). Same pattern as the deployed Phase 1 multiDayJobs move.
//
// SAFETY MODEL (staged — backup, fan-out, validate, THEN remove)
//   1. Always backs up the full appData doc first.
//   2. --apply fans every inspection out into inspections/{encodeURIComponent
//      (id)}. The in-doc array is LEFT IN PLACE.
//   3. Validate in the app (UnitHistoryModal / InspectionLog look correct).
//   4. --remove deletes appData.inspections ONLY after confirming the
//      subcollection doc count >= the in-doc inspection count. The Phase 3
//      app code then writes an empty base and the doc shrinks.
//   Deploy-order-independent: the app/sync overlay the subcollection on the
//   doc copy, so this can run any time after the Phase 3 code is live.
//
// USAGE
//   SUPERADMIN_EMAIL=you@example.com SUPERADMIN_PASSWORD='...' \
//     node scripts/migrate-inspections.mjs              # backup + report only
//   ... node scripts/migrate-inspections.mjs --apply     # fan out to subcollection
//   ... node scripts/migrate-inspections.mjs --remove    # delete field from appData (after validate)

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
const INSP_PATH = ['artifacts', APP_ID, 'public', 'data', 'inspections'];
const APPLY = process.argv.includes('--apply');
const REMOVE = process.argv.includes('--remove');

const bytes = (v) => Buffer.byteLength(JSON.stringify(v ?? null), 'utf8');
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const encId = (id) => encodeURIComponent(id);

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

  const inspections = Array.isArray(data.inspections) ? data.inspections : [];
  const withId = inspections.filter((i) => i && i.id);
  console.log(`\ninspections in appData doc: ${inspections.length} (${withId.length} with id), ${kb(bytes(inspections))}`);
  if (withId.length !== inspections.length) {
    console.log(`  WARNING: ${inspections.length - withId.length} inspection(s) have no id and will be skipped.`);
  }

  const colRef = collection(db, ...INSP_PATH);
  const existing = await getDocs(colRef);
  console.log(`inspections subcollection currently holds: ${existing.size} docs`);

  // --- REMOVE pass -------------------------------------------------------
  if (REMOVE) {
    if (existing.size < withId.length) {
      console.error(
        `\nABORT: subcollection has ${existing.size} docs but the appData doc ` +
        `still lists ${withId.length} inspections. Run --apply and validate ` +
        `BEFORE --remove (we never delete the in-doc copy until every ` +
        `inspection is confirmed in the subcollection).`,
      );
      process.exit(1);
    }
    await updateDoc(ref, { inspections: deleteField() });
    const after = await getDoc(ref);
    console.log(`\nRemoved inspections from appData doc.`);
    console.log(`appData doc size now: ${kb(bytes(after.data()))} (was ${kb(bytes(data))}).`);
    console.log('Done. The Phase 3 app code now sources inspections solely from the subcollection.');
    process.exit(0);
  }

  // --- APPLY (fan-out) ---------------------------------------------------
  if (!APPLY) {
    console.log(`\nDRY RUN — would fan ${withId.length} inspections into the subcollection.`);
    console.log('Re-run with --apply to write them, then --remove (after validating) to shrink the doc.');
    process.exit(0);
  }

  let written = 0;
  for (let i = 0; i < withId.length; i += 400) {
    const batch = writeBatch(db);
    for (const insp of withId.slice(i, i + 400)) {
      const clean = JSON.parse(JSON.stringify(insp, (_k, val) => val === undefined ? null : val));
      batch.set(doc(colRef, encId(insp.id)), clean);
      written++;
    }
    await batch.commit();
    console.log(`  fanned ${Math.min(i + 400, withId.length)}/${withId.length}...`);
  }
  const afterCol = await getDocs(colRef);
  console.log(`\nFan-out complete: wrote ${written} inspections. Subcollection now holds ${afterCol.size} docs.`);
  console.log('The in-doc copy is LEFT IN PLACE. Validate the app, then run --remove to delete it and shrink the doc.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err?.code || '', err?.message || err);
  process.exit(1);
});

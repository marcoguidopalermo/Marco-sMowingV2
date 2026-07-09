// One-time first pass: relocate PAST-month schedules to scheduleMonths/{YYYY-MM}
// sheets (copy → verify → backup → remove), mirroring the server runArchivePass
// logic. Idempotent with the server pass. Current + future months stay in the doc.
//
// USAGE
//   dry-run:  SUPERADMIN_EMAIL=.. SUPERADMIN_PASSWORD='..' node scripts/archive-schedules.mjs
//   apply:    ... node scripts/archive-schedules.mjs --apply
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteField } from 'firebase/firestore';
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
const APPLY = process.argv.includes('--apply');
const kb = (o) => (JSON.stringify(o).length / 1024).toFixed(1);
const monthOf = (d) => (d || '').slice(0, 7);
const clean = (o) => JSON.parse(JSON.stringify(o, (_k, v) => (v === undefined ? null : v)));

function torontoToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function main() {
  const app = initializeApp(firebaseConfig);
  await signInWithEmailAndPassword(getAuth(app), process.env.SUPERADMIN_EMAIL, process.env.SUPERADMIN_PASSWORD);
  const dbx = getFirestore(app);
  const ref = doc(dbx, 'artifacts', APP_ID, 'public', 'data', 'appData', 'main');
  const snap = await getDoc(ref);
  const data = snap.data() || {};
  const schedules = data.schedules || {};
  const already = new Set(data.archivedScheduleMonths || []);
  const thisMonth = monthOf(torontoToday());
  console.log(`Signed in. ${APPLY ? 'APPLY' : 'DRY RUN'} | today-month=${thisMonth}`);
  console.log(`Doc size: ${kb(data)} KB | schedules field: ${kb(schedules)} KB (${Object.keys(schedules).length} dates)`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `appData-backup-schedarch-${stamp}.json`;
  writeFileSync(backupFile, JSON.stringify(data));
  console.log(`Backup written: ${backupFile}`);

  // Group PAST-month schedule dates.
  const byMonth = {};
  for (const date of Object.keys(schedules)) {
    const m = monthOf(date);
    if (m < thisMonth && !already.has(m)) (byMonth[m] = byMonth[m] || []).push(date);
  }
  const months = Object.keys(byMonth).sort();
  if (months.length === 0) { console.log('No past-month schedules to archive.'); process.exit(0); }
  for (const ym of months) {
    const days = {}; for (const d of byMonth[ym]) days[d] = schedules[d];
    console.log(`  ${ym}: ${byMonth[ym].length} dates, ${kb(days)} KB`);
  }
  if (!APPLY) { console.log('\nDRY RUN — no writes. Re-run with --apply.'); process.exit(0); }

  const update = {};
  const nextArchived = [...(data.archivedScheduleMonths || [])];
  const now = Date.now();
  for (const ym of months) {
    const days = {}; for (const d of byMonth[ym]) days[d] = schedules[d];
    const sheetRef = doc(dbx, 'artifacts', APP_ID, 'public', 'data', 'scheduleMonths', ym);
    // merge with any existing sheet
    const existSnap = await getDoc(sheetRef);
    const existDays = existSnap.exists() ? (existSnap.data()?.days || {}) : {};
    const merged = { ...existDays, ...days };
    const expected = Object.keys(existDays).length + Object.keys(days).filter(d => !(d in existDays)).length;
    await setDoc(sheetRef, clean({ month: ym, days: merged, dayCount: Object.keys(merged).length, archivedAt: now, archivedBy: process.env.SUPERADMIN_EMAIL }));
    const check = await getDoc(sheetRef);
    const got = Object.keys(check.data()?.days || {}).length;
    if (got !== expected) { console.error(`  ${ym}: VERIFY FAILED ${got}/${expected} — aborting.`); process.exit(1); }
    await setDoc(doc(dbx, 'artifacts', APP_ID, 'public', 'data', 'scheduleMonthsBackup', `${ym}-${now}`), clean({ month: ym, days: merged }));
    for (const d of byMonth[ym]) update[`schedules.${d}`] = deleteField();
    nextArchived.push(ym);
    console.log(`  ${ym}: sheet written + verified (${got} days) + backed up.`);
  }
  update.archivedScheduleMonths = [...new Set(nextArchived)].sort();
  await updateDoc(ref, update);

  const after = await getDoc(ref);
  console.log(`\nApplied. archivedScheduleMonths = ${JSON.stringify(update.archivedScheduleMonths)}`);
  console.log(`Doc is now ${kb(after.data() || {})} KB.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

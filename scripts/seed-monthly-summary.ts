// Seed a monthlySummaries/{YYYY-MM} doc from a backup JSON, using the SAME
// shared bonus logic (buildMtd / buildDivisionMtd via buildMonthlySummary)
// that the Trends page + auto-finalize use. Read-only w.r.t. live data — the
// ONLY write is the monthlySummaries doc (and only with --apply).
//
// USAGE
//   Dry-run (prints the computed summary):
//     SUPERADMIN_EMAIL=you@ex.com SUPERADMIN_PASSWORD='...' \
//       MONTH=2026-06 BACKUP=appData-backup-2026-07-08T17-03-01-932Z.json \
//       npx tsx scripts/seed-monthly-summary.ts
//   Apply (also writes monthlySummaries/2026-06):
//     ... npx tsx scripts/seed-monthly-summary.ts --apply
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { buildMonthlySummary } from '../src/lib/monthlySummary';

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
const MONTH = process.env.MONTH || '2026-06';
const BACKUP = process.env.BACKUP || 'appData-backup-2026-07-08T17-03-01-932Z.json';
const clean = (o: unknown) => JSON.parse(JSON.stringify(o, (_k, v) => (v === undefined ? null : v)));

async function main() {
  const data = JSON.parse(readFileSync(BACKUP, 'utf8'));
  const performance = data.performance || {};
  const schedules = data.schedules || {};
  const employees = data.employees || [];
  const settings = data.settings || null;

  const summary = buildMonthlySummary(MONTH, performance, schedules, employees, settings, {
    generatedBy: process.env.SUPERADMIN_EMAIL || 'seed-script',
    finalized: true,
    now: Date.now(),
  });

  console.log(`\n=== monthlySummaries/${MONTH}  (source: ${BACKUP}) ===`);
  console.log(`basis: ${summary.basis}   cutoff: ${summary.cutoff}`);
  console.log(`crew-day mix: ${summary.crewDayCounts.approved} approved · ${summary.crewDayCounts.pending} pending (excluded) · ${summary.crewDayCounts.waived} waived (excluded)`);
  console.log('\nCOMPANY');
  console.log(`  BH=${summary.company.bh}  AH=${summary.company.ah}  raw=${summary.company.rawEff ?? '—'}%  adjusted=${summary.company.adjustedEff ?? '—'}%  jobs=${summary.company.jobs}  employees=${summary.company.employees}`);
  console.log('\nDIVISIONS');
  for (const d of summary.divisions) {
    console.log(`  ${d.division}: BH=${d.bh}  AH=${d.ah}  raw=${d.rawEff ?? '—'}%  adjusted=${d.adjustedEff ?? '—'}%  jobs=${d.jobs}  crews=${d.perCrew.length}`);
    for (const c of d.perCrew) {
      console.log(`     ${c.crewLabel}: BH=${c.bh} AH=${c.ah} adj=${c.adjustedEff ?? '—'}%`);
    }
  }
  console.log(`\nper-employee rows: ${summary.perEmployee.length} (top 3 by BH: ${summary.perEmployee.slice(0, 3).map(e => `${e.name} ${e.bh}`).join(', ')})`);

  if (!APPLY) {
    console.log('\nDRY RUN — no write. Re-run with --apply to write the summary doc.');
    process.exit(0);
  }

  const app = initializeApp(firebaseConfig);
  await signInWithEmailAndPassword(getAuth(app), process.env.SUPERADMIN_EMAIL!, process.env.SUPERADMIN_PASSWORD!);
  await setDoc(doc(getFirestore(app), 'artifacts', APP_ID, 'public', 'data', 'monthlySummaries', MONTH), clean(summary));
  console.log(`\n✅ Wrote monthlySummaries/${MONTH}.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

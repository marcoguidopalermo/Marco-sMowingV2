// Seed RoleMaster v1.7 Responsibilities — coarse starter areas (placeholders
// for Marco to retarget/fill in-app). IDEMPOTENT (fixed ids). Writes ONLY the
// roleMasterResponsibilities subcollection; touches nothing else (no duties,
// no generation, master toggle untouched).
//   dry-run:  SUPERADMIN_EMAIL=.. SUPERADMIN_PASSWORD='..' npx tsx scripts/seed-responsibilities.ts
//   apply:    ... npx tsx scripts/seed-responsibilities.ts --apply
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc, collection, getDocs } from 'firebase/firestore';

const cfg = { apiKey: 'AIzaSyCQjueOGMf4CtjHOJ2xLCdmZ2leyeEBctU', authDomain: 'crewmaster-73f31.firebaseapp.com', projectId: 'crewmaster-73f31', storageBucket: 'crewmaster-73f31.firebasestorage.app', messagingSenderId: '831920078849', appId: '1:831920078849:web:8d72204b58c48bb21f0000' };
const APP_ID = 'crewmaster';
const APPLY = process.argv.includes('--apply');
const clean = (o: unknown) => JSON.parse(JSON.stringify(o, (_k, v) => (v === undefined ? null : v)));

const app = initializeApp(cfg);
await signInWithEmailAndPassword(getAuth(app), process.env.SUPERADMIN_EMAIL!, process.env.SUPERADMIN_PASSWORD!);
const dbx = getFirestore(app);

// Owning role: no "GM" role exists — the least-wrong existing role is the
// Office Manager (role-office-manager). Marco retargets in-app via the
// responsibility editor's owning-role picker.
const OFFICE = 'role-office-manager';
const sop = (n: string) => `## ${n}\n\nAdd registrar / access / how-to details — Scribe or Doc link. _(Placeholder — replace in RoleMaster admin.)_`;

const resps = [
  { id: 'resp-website', name: 'Website & Domain', color: 'indigo', division: 'all', roleId: OFFICE, description: 'Website updates, domain renewal, registrar access.' },
  { id: 'resp-dns-hosting', name: 'DNS & Hosting', color: 'sky', division: 'all', roleId: OFFICE, description: 'DNS records, hosting account.' },
  { id: 'resp-crewmaster', name: 'CrewMaster (this app)', color: 'violet', division: 'all', roleId: OFFICE, description: 'Firebase, deploys, admin.' },
  { id: 'resp-jobber', name: 'Jobber Account', color: 'teal', division: 'all', roleId: OFFICE, description: 'Billing, users, API connection.' },
  { id: 'resp-insurance', name: 'Company Insurance', color: 'cyan', division: 'all', roleId: OFFICE, description: 'Policies, renewals, claims.' },
  { id: 'resp-vehicle-licensing', name: 'Vehicle Licensing & Registration', color: 'slate', division: 'all', roleId: OFFICE, description: 'Plates, renewals (pairs with fleet documents).' },
];

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${resps.length} responsibilities → owning role ${OFFICE} (Office Manager):`);
for (const r of resps) console.log(`  • ${r.name.padEnd(34)} color=${r.color}`);

if (!APPLY) { console.log('\nDRY RUN — no writes. Re-run with --apply to seed.'); process.exit(0); }

const col = collection(dbx, 'artifacts', APP_ID, 'public', 'data', 'roleMasterResponsibilities');
const existing = new Set((await getDocs(col)).docs.map(d => d.id));
let created = 0, skipped = 0;
for (const r of resps) {
  if (existing.has(r.id)) { console.log(`  = exists, skip: ${r.id}`); skipped++; continue; }
  await setDoc(doc(col, r.id), clean({
    ...r, sop: sop(r.name), tier: 'admin', active: true,
    createdBy: { email: 'seed', name: 'seed script' }, updatedAt: Date.now(),
  }));
  console.log(`  + created: ${r.id}`);
  created++;
}
console.log(`\nDone. created=${created} skipped=${skipped}`);
process.exit(0);

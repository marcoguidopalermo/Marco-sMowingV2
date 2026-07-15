// Seed RoleMaster Library — ONE template ("Lawn Mowing Quote — Mid-Season")
// so the Templates section launches non-empty. IDEMPOTENT (fixed id).
//
// ⚠️ BODY BELOW IS A DRAFT — replace the `BODY` string with Marco's EXACT
// verbatim email text before applying (or just edit it in-app after seeding).
// The signature block is verbatim as provided.
//
//   dry-run:  SUPERADMIN_EMAIL=.. SUPERADMIN_PASSWORD='..' npx tsx scripts/seed-templates.ts
//   apply:    ... npx tsx scripts/seed-templates.ts --apply
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc, collection, getDocs } from 'firebase/firestore';

const cfg = { apiKey: 'AIzaSyCQjueOGMf4CtjHOJ2xLCdmZ2leyeEBctU', authDomain: 'crewmaster-73f31.firebaseapp.com', projectId: 'crewmaster-73f31', storageBucket: 'crewmaster-73f31.firebasestorage.app', messagingSenderId: '831920078849', appId: '1:831920078849:web:8d72204b58c48bb21f0000' };
const APP_ID = 'crewmaster';
const APPLY = process.argv.includes('--apply');

// ── DRAFT — replace with the exact text Marco provided. Line breaks are
// preserved verbatim (the UI renders with whitespace-pre-wrap).
const BODY = `Hi [Customer Name],

Attached is your lawn mowing quote for the remainder of the season. The price covers weekly service through the end of the season — mowing, trimming, and blowing off all hard surfaces each visit.

If everything looks good, just reply to this email to confirm and we'll get you added to the route. If you have any questions or would like to adjust the service, let me know and I'm happy to help.

Thanks, and we look forward to keeping your lawn looking great!

Marco's Mowing
(807) 630-4027
marcosmowing.com`;

const template = {
  id: 'tpl-lawn-quote-midseason',
  title: 'Lawn Mowing Quote — Mid-Season',
  category: 'Quotes',
  body: BODY,
  notes: 'Send with the attached quote PDF for mid-season sign-ups. Fill in [Customer Name].',
  active: true,
  createdBy: { email: 'seed', name: 'seed script' },
  updatedAt: Date.now(),
};

const app = initializeApp(cfg);
await signInWithEmailAndPassword(getAuth(app), process.env.SUPERADMIN_EMAIL!, process.env.SUPERADMIN_PASSWORD!);
const dbx = getFirestore(app);

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — template "${template.title}" (${template.body.split('\n').length} lines):\n`);
console.log(template.body.split('\n').map(l => `  | ${l}`).join('\n'));

if (!APPLY) { console.log('\nDRY RUN — no writes. Re-run with --apply to seed.'); process.exit(0); }

const col = collection(dbx, 'artifacts', APP_ID, 'public', 'data', 'roleMasterTemplates');
const existing = new Set((await getDocs(col)).docs.map(d => d.id));
if (existing.has(template.id)) { console.log(`\n= exists, skip: ${template.id}`); process.exit(0); }
await setDoc(doc(col, template.id), template);
console.log(`\n+ created: ${template.id}`);
process.exit(0);

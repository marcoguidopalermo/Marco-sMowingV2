// READ-ONLY diagnostic: find duplicate repairLog entries and measure the
// time gap between same-content submits (double-tap vs deliberate resubmit).
// No writes.
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCQjueOGMf4CtjHOJ2xLCdmZ2leyeEBctU',
  authDomain: 'crewmaster-73f31.firebaseapp.com',
  projectId: 'crewmaster-73f31',
  storageBucket: 'crewmaster-73f31.firebasestorage.app',
  messagingSenderId: '831920078849',
  appId: '1:831920078849:web:8d72204b58c48bb21f0000',
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
await signInWithEmailAndPassword(auth, process.env.SUPERADMIN_EMAIL, process.env.SUPERADMIN_PASSWORD);
const snap = await getDoc(doc(db, 'artifacts', 'crewmaster', 'public', 'data', 'appData', 'main'));
const log = (snap.data().repairLog) || [];
console.log('repairLog entries:', log.length);

const tsOf = (id) => { const m = String(id || '').match(/^rep-(\d+)/); return m ? Number(m[1]) : NaN; };
const fmtGap = (g) => g >= 60 ? `${(g / 60).toFixed(1)}min` : `${g}s`;
const gapsFor = (a) => {
  const ts = a.map((r) => tsOf(r.id)).filter(Number.isFinite).sort((x, y) => x - y);
  const out = []; for (let i = 1; i < ts.length; i++) out.push(Math.round((ts[i] - ts[i - 1]) / 1000));
  return out;
};
const groupBy = (keyFn, label) => {
  const g = {};
  for (const r of log) { const k = keyFn(r); (g[k] = g[k] || []).push(r); }
  const dups = Object.entries(g).filter(([, a]) => a.length > 1);
  console.log(`\n[${label}] duplicate groups: ${dups.length}`);
  return dups;
};

groupBy((r) => `${r.equipmentId}|${r.date}|${r.fixNotes || ''}|${Number(r.cost) || 0}`, 'EXACT: unit+date+notes+cost (current guard key)');
const byUnitDate = groupBy((r) => `${r.equipmentId}|${r.date}`, 'LOOSE: unit+date only');
groupBy((r) => `${r.equipmentId}|${r.date}|${(r.fixNotes || '').trim().toLowerCase()}`, 'unit+date+notes(normalized, ignore cost)');

// Detail every same-unit-same-day group: show what field differs.
console.log('\n=== same unit + same day — field-by-field ===');
let lt12 = 0, ge12 = 0;
for (const [k, a] of byUnitDate) {
  const gaps = gapsFor(a);
  for (const g of gaps) { if (g < 12) lt12++; else ge12++; }
  console.log(`\n  ${a[0].equipmentName}  ${a[0].date}   (count ${a.length}, gaps ${gaps.map(fmtGap).join(', ') || 'n/a'})`);
  for (const r of a) {
    console.log(`    id=${r.id}  cost=${JSON.stringify(r.cost)}  notes=${JSON.stringify(r.fixNotes)}`);
  }
}
console.log('\n=== CLASSIFICATION (same unit+day pairs) ===');
console.log(`pairs <12s  (double-tap): ${lt12}`);
console.log(`pairs >=12s (deliberate resubmit, >12s window): ${ge12}`);
process.exit(0);

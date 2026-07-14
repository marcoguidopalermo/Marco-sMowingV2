// READ-ONLY sweep: find duplicate mechanicTasks (the Repair Board tasks the
// double-submit bug created — id `task-<ms>`). A duplicate group = same
// reporter + unitName + category + description, created within a 2-minute
// window (measured from the ms baked into the id). Reports open (todo/doing)
// vs completed (done) so completed dupes — which feed MechanicPerformance /
// MyMechanic / pay-chunk repair counts — can be decided on deliberately.
// NO WRITES.
//   SUPERADMIN_EMAIL=.. SUPERADMIN_PASSWORD='..' node scripts/audit-mechanictask-dupes.mjs
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
const tasks = (snap.data()?.mechanicTasks) || [];
console.log('mechanicTasks total:', tasks.length);

const WINDOW_MS = 2 * 60 * 1000;
const tsOf = (id) => { const m = String(id || '').match(/^task-(\d+)/); return m ? Number(m[1]) : NaN; };
const norm = (s) => String(s ?? '').trim().toLowerCase();
const creatorOf = (t) => {
  if (t.reportedBy?.employeeId) return t.reportedBy.employeeId;
  const created = (t.activity || []).find((a) => a.type === 'created');
  return created?.userName || t.reportedBy?.name || '?';
};
const isDone = (t) => t.status === 'done';

const buckets = new Map();
for (const t of tasks) {
  const key = [creatorOf(t), norm(t.unitName), norm(t.category), norm(t.description)].join('|');
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(t);
}

const dupGroups = [];
for (const [, arr] of buckets) {
  if (arr.length < 2) continue;
  const sorted = arr.slice().sort((a, b) => (tsOf(a.id) || 0) - (tsOf(b.id) || 0));
  let cluster = [sorted[0]];
  const flush = () => { if (cluster.length > 1) dupGroups.push(cluster); };
  for (let i = 1; i < sorted.length; i++) {
    const prev = tsOf(cluster[cluster.length - 1].id);
    const cur = tsOf(sorted[i].id);
    if (Number.isFinite(prev) && Number.isFinite(cur) && (cur - prev) <= WINDOW_MS) cluster.push(sorted[i]);
    else { flush(); cluster = [sorted[i]]; }
  }
  flush();
}

console.log(`\nduplicate groups (same reporter+unit+category+desc, within 2 min): ${dupGroups.length}`);
let openDupes = 0, doneDupes = 0, groupsWithDone = 0;
const iso = (ms) => Number.isFinite(ms) ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '??';

for (const g of dupGroups) {
  const keep = g[0];
  const doneInGroup = g.filter(isDone);
  if (doneInGroup.length) groupsWithDone++;
  console.log(`\n  "${keep.unitName}" / ${keep.category}  — reporter ${creatorOf(keep)}  (count ${g.length})`);
  for (const t of g) {
    const tag = t.id === keep.id ? 'KEEP(earliest)' : 'DUP';
    console.log(`    [${tag}] id=${t.id}  ${iso(tsOf(t.id))}  status=${t.status}${isDone(t) ? '  ⚠ COMPLETED' : ''}`);
  }
  for (const t of g.slice(1)) { if (isDone(t)) doneDupes++; else openDupes++; }
}

console.log('\n=== SUMMARY ===');
console.log(`duplicate groups: ${dupGroups.length}`);
console.log(`extra (non-earliest) OPEN dupes  [safe to remove]: ${openDupes}`);
console.log(`extra (non-earliest) COMPLETED dupes [NEED DECISION — feed pay/stats]: ${doneDupes}`);
console.log(`groups containing >=1 completed entry: ${groupsWithDone}`);
process.exit(0);

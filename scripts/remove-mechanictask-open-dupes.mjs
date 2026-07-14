// Remove OPEN duplicate mechanicTasks created by the double-submit bug.
// Keeps the EARLIEST of each group; removes only status todo/doing extras;
// NEVER touches status 'done' (completed dupes feed pay/stats — reported
// separately for a deliberate decision). Mirrors the app's own delete path:
// the task is filtered out of mechanicTasks AND a 'deleted' audit activity
// is prepended to activityLog in the same write. The activityLog trim/cap
// policy is NOT modified. A full pre-write backup of mechanicTasks is saved
// locally first.
//   DRY RUN:  SUPERADMIN_EMAIL=.. SUPERADMIN_PASSWORD='..' node scripts/remove-mechanictask-open-dupes.mjs
//   APPLY:    (same) ... node scripts/remove-mechanictask-open-dupes.mjs --apply
import { writeFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';

const APPLY = process.argv.includes('--apply');
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
const cred = await signInWithEmailAndPassword(auth, process.env.SUPERADMIN_EMAIL, process.env.SUPERADMIN_PASSWORD);
const ref = doc(db, 'artifacts', 'crewmaster', 'public', 'data', 'appData', 'main');
const snap = await getDoc(ref);
const data = snap.data() || {};
const tasks = data.mechanicTasks || [];

const WINDOW_MS = 2 * 60 * 1000;
const tsOf = (id) => { const m = String(id || '').match(/^task-(\d+)/); return m ? Number(m[1]) : NaN; };
const norm = (s) => String(s ?? '').trim().toLowerCase();
const creatorOf = (t) => t.reportedBy?.employeeId || (t.activity || []).find((a) => a.type === 'created')?.userName || t.reportedBy?.name || '?';
const isOpen = (t) => t.status === 'todo' || t.status === 'doing';

const buckets = new Map();
for (const t of tasks) {
  const key = [creatorOf(t), norm(t.unitName), norm(t.category), norm(t.description)].join('|');
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(t);
}

const toRemove = []; // open extras only (never earliest, never done)
for (const [, arr] of buckets) {
  if (arr.length < 2) continue;
  const sorted = arr.slice().sort((a, b) => (tsOf(a.id) || 0) - (tsOf(b.id) || 0));
  let cluster = [sorted[0]];
  const consider = (grp) => { for (const t of grp.slice(1)) if (isOpen(t)) toRemove.push(t); };
  for (let i = 1; i < sorted.length; i++) {
    const prev = tsOf(cluster[cluster.length - 1].id);
    const cur = tsOf(sorted[i].id);
    if (Number.isFinite(prev) && Number.isFinite(cur) && (cur - prev) <= WINDOW_MS) cluster.push(sorted[i]);
    else { if (cluster.length > 1) consider(cluster); cluster = [sorted[i]]; }
  }
  if (cluster.length > 1) consider(cluster);
}

const removeIds = new Set(toRemove.map((t) => t.id));
console.log(`mechanicTasks total: ${tasks.length}`);
console.log(`OPEN duplicate tasks to remove (earliest of each group kept, completed never touched): ${removeIds.size}`);
for (const t of toRemove) console.log(`  - ${t.id}  "${t.unitName}" / ${t.category}  status=${t.status}  reporter=${creatorOf(t)}`);

if (!removeIds.size) { console.log('\nNothing to remove.'); process.exit(0); }
if (!APPLY) { console.log('\nDRY RUN — no writes. Re-run with --apply to remove the above.'); process.exit(0); }

// Backup before writing.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `scripts/backup-mechanicTasks-${stamp}.json`;
writeFileSync(backup, JSON.stringify(tasks, null, 2));
console.log(`\nBackup written: ${backup}`);

// Mirror the app's delete: prepend a 'deleted' audit activity per removed
// task. activityLog trim/cap policy is untouched (we only prepend).
const nowIso = new Date().toISOString();
const audits = toRemove.map((t, i) => ({
  id: `act-dupclean-${Date.now()}-${i}`,
  type: 'deleted',
  userEmail: cred.user.email || 'script',
  userName: 'dup-cleanup (script)',
  timestamp: nowIso,
  taskId: t.id,
  unitId: t.unitId,
  unitName: t.unitName,
  taskCategory: t.category,
  taskSeverity: t.severity,
  reportedBy: t.reportedBy,
  payload: { reason: 'double-submit open duplicate removed; earliest kept' },
}));

const nextTasks = tasks.filter((t) => !removeIds.has(t.id));
const nextLog = [...audits, ...(data.activityLog || [])];
await updateDoc(ref, { mechanicTasks: nextTasks, activityLog: nextLog });
console.log(`\nAPPLIED. mechanicTasks ${tasks.length} → ${nextTasks.length}; ${audits.length} audit entries prepended.`);
process.exit(0);

// READ-ONLY diagnosis of the PerformanceMaster "outstanding crew-day" flag.
// For every flagged crew-day (approvalStatus not approved/waived, on/after
// 2026-07-01, before today) it reports whether the day had ANY actual work
// and classifies the EMPTY ones as (a) genuine false-positive vs (b) a real
// data gap (crew scheduled / clocked in, but the perf log is empty).
// NO WRITES.
//   SUPERADMIN_EMAIL=.. SUPERADMIN_PASSWORD='..' node scripts/diagnose-outstanding-flag.mjs
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, collection, getDocs } from 'firebase/firestore';

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

const APPID = 'crewmaster';
const main = (await getDoc(doc(db, 'artifacts', APPID, 'public', 'data', 'appData', 'main'))).data() || {};

// Merge main-doc performance (current/future months) with the archived
// performanceMonths subcollection — exactly what the app's flag scans.
const performance = { ...(main.performance || {}) };
const monthsSnap = await getDocs(collection(db, 'artifacts', APPID, 'public', 'data', 'performanceMonths'));
monthsSnap.forEach(m => {
  const days = m.data()?.days || m.data() || {};
  for (const [date, logs] of Object.entries(days)) {
    if (typeof logs !== 'object') continue;
    performance[date] = { ...(performance[date] || {}), ...logs };
  }
});

const schedules = main.schedules || {};
const timeEntries = main.timeEntries || [];
const employees = main.employees || [];
const empEmail = new Map(employees.map(e => [e.id, (e.linkedUserEmail || e.email || '').toLowerCase()]));

const TRACK_START = '2026-07-01';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const isOutstanding = (l) => l && l.approvalStatus !== 'approved' && l.approvalStatus !== 'waived';
const sumAH = (log) => Object.values(log.employeeAH || {}).reduce((s, v) => s + (Number(v) || 0), 0);

// TimeMaster clock-ins bucketed by Toronto date + email (mirrors the sync's
// attribution bucket — the available "did someone actually work" signal;
// live Jobber timesheets are NOT in appData, noted below).
const clockDate = (iso) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); } catch { return ''; } };
const teByDateEmail = new Map();
for (const te of timeEntries) {
  const email = (te.userEmail || '').toLowerCase();
  if (!email || !te.clockIn) continue;
  const d = clockDate(te.clockIn);
  teByDateEmail.set(`${d}|${email}`, (teByDateEmail.get(`${d}|${email}`) || 0) + 1);
}

const rows = [];
for (const [date, dayLogs] of Object.entries(performance)) {
  if (date >= today || date < TRACK_START) continue;
  const daySched = schedules[date] || [];
  const nonEmptyCrewsToday = Object.values(dayLogs).filter(l => (l.jobs?.length || 0) > 0 || sumAH(l) > 0).length;
  for (const [crewId, log] of Object.entries(dayLogs)) {
    if (!isOutstanding(log)) continue;
    const jobs = log.jobs?.length || 0;
    const ah = sumAH(log);
    const empty = jobs === 0 && ah === 0;
    const sched = daySched.find(c => c.division === log.division && c.crewNumber === log.crewNumber);
    const schedEmployees = sched?.employees?.length || 0;
    // How many of this crew's scheduled employees clocked in that day.
    let clockedIn = 0;
    for (const id of (sched?.employees || [])) {
      const em = empEmail.get(id);
      if (em && teByDateEmail.get(`${date}|${em}`)) clockedIn++;
    }
    rows.push({ date, crewId, label: `${log.division || 'Unassigned'} #${log.crewNumber ?? 0}`, status: log.approvalStatus || '(undefined)', jobs, ah: Math.round(ah * 10) / 10, empty, onSchedule: !!sched, schedEmployees, clockedIn, nonEmptyCrewsToday, lastSync: log.lastJobberSyncAt ? new Date(log.lastJobberSyncAt).toISOString().slice(0, 10) : '—' });
  }
}
rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

const empties = rows.filter(r => r.empty);
console.log(`today=${today}  total outstanding crew-days flagged: ${rows.length}  (empty: ${empties.length}, with work: ${rows.length - empties.length})\n`);

const classify = (r) => {
  if (!r.onSchedule) return '(a) ORPHAN — no schedule crew that day (client-seeded ghost?)';
  if (r.clockedIn > 0) return '(b) DATA GAP — employees clocked in but log empty';
  if (r.schedEmployees > 0 && r.nonEmptyCrewsToday > 0) return '(b?) POSSIBLE GAP — crew staffed + other crews worked; verify Jobber';
  return '(a) EMPTY — scheduled but nobody clocked in / no work';
};

console.log('=== EMPTY FLAGGED CREW-DAYS (the subject of Issue 2) ===');
for (const r of empties) {
  console.log(`${r.date}  ${r.label}  status=${r.status}  onSched=${r.onSchedule} staffed=${r.schedEmployees} clockedIn=${r.clockedIn} otherCrewsWorked=${r.nonEmptyCrewsToday} lastSync=${r.lastSync}`);
  console.log(`    → ${classify(r)}`);
}

const byClass = {};
for (const r of empties) { const k = classify(r).split(' ')[0]; byClass[k] = (byClass[k] || 0) + 1; }
console.log('\n=== CLASSIFICATION SUMMARY (empty flagged days) ===');
for (const [k, n] of Object.entries(byClass)) console.log(`  ${k}: ${n}`);
console.log('\nNote: live Jobber visit/timesheet data is NOT in appData, so (b?) rows need a Jobber cross-check; TimeMaster clock-ins ARE checked.');
process.exit(0);

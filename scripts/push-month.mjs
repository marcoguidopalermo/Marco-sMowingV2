// Push Month — one-time / repeatable script to MOVE completed months of
// performance out of the single 1 MiB-capped appData doc into their own
// performanceMonths/{YYYY-MM} sheets. NOTHING IS DELETED — each month's
// FULL data is copied to its sheet, verified, backed up, and only THEN
// removed from the appData doc (a net-reducing update, allowed even when
// the doc is over the cap).
//
// SAFETY MODEL (gated copy → verify → backup → remove):
//   1. Full backup of the live appData doc is written first (JSON file).
//   2. For each month: write performanceMonths/{ym} (the sheet) AND
//      performanceMonthsBackup/{ym}-{ts}, then RE-READ the sheet and
//      confirm the day count matches. If verify fails, nothing is removed.
//   3. Only after every requested month verifies do we update the appData
//      doc: set pushedMonths (union) and deleteField each pushed date that
//      still lives in the doc. Months sourced from a backup (already gone
//      from the doc, e.g. June after the recover-appdata run) set the
//      marker + write the sheet, with nothing to remove.
//
// USAGE
//   Dry run (report only, no writes):
//     SUPERADMIN_EMAIL=you@ex.com SUPERADMIN_PASSWORD='...' \
//       MONTHS=2026-06 FROM_BACKUP=appData-backup-...T17-03-01-932Z.json \
//       node scripts/push-month.mjs
//   Apply:
//     ... node scripts/push-month.mjs --apply
//
//   MONTHS   comma-separated YYYY-MM to push. Default: every month older
//            than the current month that is present in the live doc and
//            not already pushed.
//   FROM_BACKUP  optional path to an appData backup JSON. A requested
//            month NOT present in the live doc is sourced from here
//            (nothing to remove from the doc — it's already out).

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteField,
} from 'firebase/firestore';
import { readFileSync, writeFileSync } from 'node:fs';

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
const APPLY = process.argv.includes('--apply');
const FROM_BACKUP = process.env.FROM_BACKUP || '';
const kb = (o) => (JSON.stringify(o).length / 1024).toFixed(1);
const monthOf = (d) => (d || '').slice(0, 7);
const clean = (o) => JSON.parse(JSON.stringify(o, (_k, v) => (v === undefined ? null : v)));

function datesInMonth(perf, ym) {
  return Object.keys(perf || {}).filter((d) => monthOf(d) === ym).sort();
}
function isSettled(log) {
  return log?.approvalStatus === 'approved' || log?.approvalStatus === 'waived';
}
function settlement(perf, ym) {
  const blocking = [];
  let crewDays = 0;
  for (const date of datesInMonth(perf, ym)) {
    for (const [, log] of Object.entries(perf[date] || {})) {
      crewDays++;
      if (!isSettled(log)) {
        blocking.push(`${date} ${log.division ?? '?'}#${log.crewNumber ?? '?'}(${log.approvalStatus || 'pending'})`);
      }
    }
  }
  return { blocking, crewDays };
}

async function main() {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!email || !password) {
    console.error('Set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD.');
    process.exit(1);
  }
  const app = initializeApp(firebaseConfig);
  await signInWithEmailAndPassword(getAuth(app), email, password);
  const dbx = getFirestore(app);
  console.log(`Signed in as ${email}  (${APPLY ? 'APPLY' : 'DRY RUN'})`);

  const ref = doc(dbx, ...DOC_PATH);
  const snap = await getDoc(ref);
  const data = snap.data() || {};
  const livePerf = data.performance || {};
  const already = new Set(data.pushedMonths || []);
  console.log(`Live doc: ${kb(data)} KB (cap 1024.0)`);

  // Belt-and-suspenders full backup of the live doc.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `appData-backup-pushmonth-${stamp}.json`;
  writeFileSync(backupFile, JSON.stringify(data));
  console.log(`Backup written: ${backupFile}`);

  // Optional backup source for months already removed from the doc.
  let backupPerf = {};
  if (FROM_BACKUP) {
    backupPerf = (JSON.parse(readFileSync(FROM_BACKUP, 'utf8')).performance) || {};
    console.log(`Backup source: ${FROM_BACKUP} (months: ${[...new Set(Object.keys(backupPerf).map(monthOf))].sort().join(', ')})`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = monthOf(today);

  // Which months to push.
  let months;
  if (process.env.MONTHS) {
    months = process.env.MONTHS.split(',').map((s) => s.trim()).filter(Boolean);
  } else {
    const present = new Set(Object.keys(livePerf).map(monthOf));
    months = [...present].filter((m) => m < thisMonth && !already.has(m)).sort();
  }
  if (months.length === 0) {
    console.log('No months to push.');
    process.exit(0);
  }

  // Plan each month: source (doc | backup), day map, settlement.
  const plan = [];
  for (const ym of months) {
    if (already.has(ym)) { console.log(`  ${ym}: already pushed — skipping.`); continue; }
    if (ym >= thisMonth) { console.log(`  ${ym}: current/future month — refusing.`); continue; }
    let source = null; let perf = null;
    if (datesInMonth(livePerf, ym).length > 0) { source = 'doc'; perf = livePerf; }
    else if (datesInMonth(backupPerf, ym).length > 0) { source = 'backup'; perf = backupPerf; }
    else { console.log(`  ${ym}: no data in doc or backup — skipping.`); continue; }

    const dates = datesInMonth(perf, ym);
    const days = {}; for (const d of dates) days[d] = perf[d];
    const s = settlement(perf, ym);
    if (s.blocking.length > 0) {
      console.log(`  ${ym}: ${s.blocking.length} UNSETTLED crew-day(s) — REFUSING. e.g. ${s.blocking.slice(0, 4).join(', ')}`);
      continue;
    }
    plan.push({ ym, source, days, dayCount: dates.length, crewDays: s.crewDays });
    console.log(`  ${ym}: ${dates.length} days, ${s.crewDays} crew-days, ${kb(days)} KB  [source=${source}, ${source === 'doc' ? 'will remove from doc' : 'already out of doc'}]`);
  }

  if (plan.length === 0) { console.log('\nNothing to push after guards.'); process.exit(0); }
  if (!APPLY) {
    console.log('\nDRY RUN — no writes. Re-run with --apply to push.');
    process.exit(0);
  }

  // APPLY. 1+2: write + verify + backup each sheet.
  const pushedNow = [];
  const datesToRemove = [];
  for (const p of plan) {
    const payload = {
      month: p.ym, days: p.days, dayCount: p.dayCount,
      pushedAt: Date.now(), pushedBy: email, pushedByName: 'push-month script', pushedVia: 'script',
    };
    const sheetRef = doc(dbx, 'artifacts', APP_ID, 'public', 'data', 'performanceMonths', p.ym);
    await setDoc(sheetRef, clean(payload));
    const check = await getDoc(sheetRef);
    const got = check.exists() ? Object.keys(check.data()?.days || {}).length : -1;
    if (got !== p.dayCount) {
      console.error(`  ${p.ym}: VERIFY FAILED (${got}/${p.dayCount} days). Aborting before any removal.`);
      process.exit(1);
    }
    await setDoc(doc(dbx, 'artifacts', APP_ID, 'public', 'data', 'performanceMonthsBackup', `${p.ym}-${payload.pushedAt}`), clean(payload));
    console.log(`  ${p.ym}: sheet written + verified (${got} days) + backed up.`);
    pushedNow.push(p.ym);
    if (p.source === 'doc') for (const d of Object.keys(p.days)) datesToRemove.push(d);
  }

  // 3: single net-reducing doc update — set marker + remove pushed dates.
  const update = {
    pushedMonths: [...new Set([...(data.pushedMonths || []), ...pushedNow])].sort(),
  };
  for (const d of datesToRemove) update[`performance.${d}`] = deleteField();
  await updateDoc(ref, update);

  // Audit (best-effort).
  try {
    for (const p of plan) {
      await setDoc(
        doc(dbx, 'artifacts', APP_ID, 'private', 'data', 'performanceActivityLog', `pushmonth-${p.ym}-${Date.now()}`),
        {
          type: 'performance_month_pushed', timestamp: Date.now(),
          targetDate: today, crewId: 'performance-month', crewLabel: p.ym,
          userId: email, userName: 'push-month script', userRole: 'admin',
          valueLabel: 'crew-days', valueAfter: p.crewDays,
          reasonNote: `Pushed ${p.ym} → sheet (${p.dayCount} days, ${p.crewDays} crew-days) via script. Locked; full detail on performanceMonths/${p.ym}.`,
        },
      );
    }
  } catch (e) { console.warn('audit write skipped:', e?.message || e); }

  const after = await getDoc(ref);
  console.log(`\nApplied. pushedMonths = ${JSON.stringify(update.pushedMonths)}`);
  console.log(`Doc is now ${kb(after.data() || {})} KB (cap 1024.0).`);
  console.log('Pushed months remain fully viewable in-app via the month-sheet overlay.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

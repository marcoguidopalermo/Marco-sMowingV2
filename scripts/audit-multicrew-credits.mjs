// Audit (and optionally FIX) the frozen multi-crew BH credit bug.
//
// THE BUG: on a multi-crew visit the per-crew credit was frozen at the
// headcount split from first completion. The bonus reads
// performance[date][crew].jobs[].bh; that value (and the ledger's
// completionHistory.creditedBH) stayed frozen when the roster later changed,
// while the live auto split (visitBHSplits / row.totalBH) recomputed — so
// credits diverged from the current split and could stop summing to the job
// total. The deployed sync fix re-derives on the next re-sync of that date;
// --fix corrects it directly so you don't have to wait.
//
// MODES
//   node scripts/audit-multicrew-credits.mjs [backup.json]   # offline report
//   SUPERADMIN_EMAIL=.. SUPERADMIN_PASSWORD=.. node scripts/audit-multicrew-credits.mjs
//                                                            # LIVE dry-run (no writes)
//   ... --fix         (or --apply)                           # LIVE apply (backup-first)
//
// WHAT --fix WRITES (AUTO splits only; manual overrides skipped):
//   1. performance[date][crewId].jobs[i].bh = corrected, .totalBH = current
//      share  — in the appData doc (this is what the bonus math reads).
//   2. multiDayJobs/{visitId} completionHistory[crew entry].creditedBH =
//      corrected — in the Phase 1 SUBCOLLECTION (ledger consistency).
//   Corrected value = round(percentComplete/100 * current auto share) —
//   identical to what a re-sync would produce.
//
// SAFETY: backup-first, dry-run by default. Only fixes crews that are 100%
// complete with exactly one credited row (an unambiguous same-day credit);
// multi-day-spread crews are skipped with a warning (fix those via re-sync).

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore, doc, getDoc, updateDoc, collection, getDocs, setDoc,
} from 'firebase/firestore';

const APPLY = process.argv.includes('--fix') || process.argv.includes('--apply');
const round1 = (n) => Math.round(n * 10) / 10;
const stableCrewKey = (c) =>
  `${(c.division || '').trim().toLowerCase()}-${c.crewNumber}`;

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
const MDJ_PATH = ['artifacts', APP_ID, 'public', 'data', 'multiDayJobs'];
const encId = (visitId) => encodeURIComponent(visitId);

// ---- load data (live when creds present, else offline backup) ----
async function load() {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  if (email && password) {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);
    await signInWithEmailAndPassword(auth, email, password);
    console.log(`Signed in as ${email} — reading LIVE data`);
    const ref = doc(db, ...DOC_PATH);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('appData doc missing');
    const docData = snap.data();
    const mdjCol = collection(db, ...MDJ_PATH);
    const mdjSnap = await getDocs(mdjCol);
    const mdj = {};
    mdjSnap.forEach((d) => {
      const v = d.data();
      if (v && v.jobberVisitId) mdj[v.jobberVisitId] = v;
    });
    console.log(`Loaded ${mdjSnap.size} ledgers from subcollection.\n`);
    return {
      live: true, db, ref, mdjCol, docData,
      performance: docData.performance || {},
      schedules: docData.schedules || {},
      splits: docData.visitBHSplits || {},
      mdj,
    };
  }
  if (APPLY) throw new Error('--fix needs SUPERADMIN_EMAIL/PASSWORD (live write).');
  const file = process.argv.find((a) => /\.json$/.test(a)) ||
    readdirSync('.').filter((f) => /^appData-backup-.*\.json$/.test(f)).sort().slice(-1)[0];
  if (!file) throw new Error('No backup file found.');
  console.log(`Offline report from: ${file}\n`);
  const d = JSON.parse(readFileSync(file, 'utf8'));
  return {
    live: false,
    performance: d.performance || {},
    schedules: d.schedules || {},
    splits: d.visitBHSplits || {},
    mdj: d.multiDayJobs || {},
  };
}

async function main() {
  const ctx = await load();
  const { performance, schedules, splits, mdj } = ctx;

  const crewKeyById = {}; const crewLabelById = {};
  for (const date of Object.keys(schedules)) {
    for (const c of schedules[date] || []) {
      crewKeyById[c.id] = stableCrewKey(c);
      crewLabelById[c.id] = `${c.division} #${c.crewNumber}`;
    }
  }
  const keyOf = (crewId) => crewKeyById[crewId] || `crewid:${crewId}`;

  // visitId -> credited Jobber rows {date, crewId, jobIdx, bh, totalBH}
  const rowsByVisit = {};
  for (const date of Object.keys(performance)) {
    for (const [crewId, log] of Object.entries(performance[date] || {})) {
      (log.jobs || []).forEach((job, jobIdx) => {
        if (job.source !== 'jobber' || !job.jobberVisitId || job.movedToDate) return;
        const vid = job.jobberVisitId;
        (rowsByVisit[vid] = rowsByVisit[vid] || []).push({
          date, crewId, jobIdx,
          bh: Number(job.bh) || 0,
          totalBH: Number(job.totalBH ?? job.bh) || 0,
        });
      });
    }
  }

  function cumPctByKey(visitId) {
    const out = {};
    for (const h of (mdj[visitId]?.completionHistory || [])) {
      const k = h.crewKey || keyOf(h.crewId);
      out[k] = (k in out) ? Math.max(out[k], h.percentComplete) : h.percentComplete;
    }
    return out;
  }

  const flagged = []; const manualSkipped = []; const uncredited = [];
  const corrections = [];          // {visitId,title,date,crewId,jobIdx,label,oldBH,newBH,newTotalBH,key,pct}
  let totalAbsDelta = 0; let netDelta = 0;

  for (const visitId of Object.keys(splits)) {
    const split = splits[visitId];
    if (!split || !split.splits || split.splits.length <= 1) continue;
    const rows = rowsByVisit[visitId] || [];
    const method = split.splitMethod;
    const title = mdj[visitId]?.title || '(unknown job)';
    if (method === 'manual') { manualSkipped.push({ visitId, title }); continue; }

    const jobTotal = split.totalBH;
    const shareByKey = {};
    for (const s of split.splits) shareByKey[keyOf(s.crewId)] = s.bh;
    const pctByKey = cumPctByKey(visitId);

    const frozenByKey = {}; const labelByKey = {}; const rowsForKey = {};
    for (const r of rows) {
      const k = keyOf(r.crewId);
      frozenByKey[k] = round1((frozenByKey[k] || 0) + r.bh);
      labelByKey[k] = crewLabelById[r.crewId] || r.crewId;
      (rowsForKey[k] = rowsForKey[k] || []).push(r);
    }

    const allKeys = [...new Set([...Object.keys(frozenByKey), ...Object.keys(shareByKey)])];
    const perCrew = []; let sumFrozen = 0; let anyMis = false;
    for (const k of allKeys) {
      const share = shareByKey[k] ?? 0;
      const pct = pctByKey[k] ?? 100;
      const expected = round1((pct / 100) * share);
      const frozen = round1(frozenByKey[k] ?? 0);
      const delta = round1(frozen - expected);
      sumFrozen = round1(sumFrozen + frozen);
      if (Math.abs(delta) >= 0.05) anyMis = true;
      perCrew.push({ key: k, label: labelByKey[k] || k, pct, share, frozen, expected, delta, rows: rowsForKey[k] || [] });
    }
    const reconDelta = round1(sumFrozen - jobTotal);
    const allComplete = perCrew.every((c) => c.pct >= 100);
    const reconOff = allComplete && Math.abs(reconDelta) >= 0.05;

    if (sumFrozen < 0.05) {
      const sumExpected = round1(perCrew.reduce((a, c) => a + c.expected, 0));
      if (sumExpected >= 0.05) uncredited.push({ visitId, title, jobTotal, sumExpected });
      continue;
    }
    if (!(anyMis || reconOff)) continue;

    flagged.push({ visitId, title, jobTotal, method, perCrew, sumFrozen, reconDelta, allComplete });
    for (const c of perCrew) {
      if (Math.abs(c.delta) < 0.05) continue;
      totalAbsDelta = round1(totalAbsDelta + Math.abs(c.delta));
      netDelta = round1(netDelta + c.delta);
      // Only auto-correct unambiguous credits: 100% complete, exactly one row.
      if (c.pct >= 100 && c.rows.length === 1) {
        const r = c.rows[0];
        corrections.push({
          visitId, title, date: r.date, crewId: r.crewId, jobIdx: r.jobIdx,
          label: c.label, key: c.key, pct: c.pct,
          oldBH: r.bh, newBH: c.expected, newTotalBH: c.share,
        });
      } else {
        c.skipFix = `pct=${c.pct} rows=${c.rows.length} (multi-day spread — fix via re-sync)`;
      }
    }
  }

  // ---- report ----
  console.log(`Multi-crew visits flagged: ${flagged.length}`);
  console.log(`Manual-split visits skipped (overrides): ${manualSkipped.length}`);
  console.log('');
  for (const v of flagged) {
    console.log(`■ ${v.title}  (visit=${v.visitId}, jobTotal=${v.jobTotal} BH, ${v.method})`);
    for (const c of v.perCrew) {
      const tag = Math.abs(c.delta) >= 0.05
        ? `  <-- MIS-CREDIT ${c.delta > 0 ? '+' : ''}${c.delta}${c.skipFix ? `  [SKIP: ${c.skipFix}]` : '  [will fix]'}`
        : '';
      console.log(`    ${c.label.padEnd(16)} ${c.pct}%  frozen=${c.frozen}  current-share=${c.share}  corrected=${c.expected}${tag}`);
    }
    const recon = v.allComplete
      ? (Math.abs(v.reconDelta) >= 0.05 ? `MISMATCH ${v.reconDelta > 0 ? 'OVER' : 'UNDER'} by ${v.reconDelta}` : 'OK (sums to job total)')
      : 'n/a (not all 100%)';
    console.log(`    Reconcile: sum=${v.sumFrozen} vs jobTotal=${v.jobTotal} -> ${recon}\n`);
  }
  if (uncredited.length) {
    console.log('Multi-crew splits set but NOT credited yet (incomplete/awaiting — not the bug):');
    for (const u of uncredited) console.log(`  - ${u.title} (visit=${u.visitId}, jobTotal=${u.jobTotal})`);
    console.log('');
  }
  console.log('─── SUMMARY ───');
  console.log(`Visits mis-credited:    ${flagged.length}`);
  console.log(`Crew-rows mis-credited: ${flagged.reduce((a, v) => a + v.perCrew.filter((c) => Math.abs(c.delta) >= 0.05).length, 0)}`);
  console.log(`Total ABS BH error:     ${totalAbsDelta} BH   Net: ${netDelta > 0 ? '+' : ''}${netDelta} BH`);
  console.log(`Auto-fixable rows:      ${corrections.length}`);
  console.log('');

  // ---- apply ----
  if (!APPLY) {
    console.log(ctx.live
      ? 'DRY RUN (live, no writes). Re-run with --fix to apply the corrections above.'
      : 'OFFLINE REPORT. Set SUPERADMIN creds + --fix to apply against live data.');
    return;
  }
  if (corrections.length === 0) { console.log('Nothing to fix.'); return; }

  // Backup-first: the appData doc + every ledger we will touch.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const affectedVisitIds = [...new Set(corrections.map((c) => c.visitId))];
  const backup = {
    appDataDoc: ctx.docData,
    affectedLedgers: Object.fromEntries(affectedVisitIds.map((v) => [v, mdj[v] ?? null])),
  };
  const backupFile = `multicrew-fix-backup-${stamp}.json`;
  writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  console.log(`Backup written: ${backupFile}\n`);

  // 1) performance row updates — group by date, rewrite that date's map.
  const datesTouched = new Set(corrections.map((c) => c.date));
  for (const c of corrections) {
    const row = performance[c.date][c.crewId].jobs[c.jobIdx];
    console.log(`  perf  ${c.label}  ${c.title}: bh ${row.bh} -> ${c.newBH}, totalBH ${row.totalBH ?? '-'} -> ${c.newTotalBH}`);
    row.bh = c.newBH;
    row.totalBH = c.newTotalBH;
  }
  for (const date of datesTouched) {
    // date (YYYY-MM-DD) has no dots, so a one-level dotted path is safe.
    await updateDoc(ctx.ref, { [`performance.${date}`]: performance[date] });
    console.log(`  wrote performance.${date}`);
  }

  // 2) ledger restamp — set the matching crew's completionHistory entry.
  for (const visitId of affectedVisitIds) {
    const ledger = mdj[visitId];
    if (!ledger) continue;
    const visitCorrections = corrections.filter((c) => c.visitId === visitId);
    for (const c of visitCorrections) {
      for (const h of (ledger.completionHistory || [])) {
        if ((h.crewKey || keyOf(h.crewId)) === c.key && h.percentComplete >= 100) {
          console.log(`  ledger ${c.label}  ${c.title}: creditedBH ${h.creditedBH} -> ${c.newBH}`);
          h.creditedBH = c.newBH;
        }
      }
    }
    await setDoc(doc(ctx.mdjCol, encId(visitId)), ledger);
    console.log(`  wrote multiDayJobs/${encId(visitId)}`);
  }

  console.log(`\nApplied ${corrections.length} corrections. Re-open the app / run the audit again to confirm.`);
}

main().catch((err) => { console.error('Error:', err?.code || '', err?.message || err); process.exit(1); });

// READ-ONLY audit of the frozen multi-crew BH credit bug.
//
// Finds every completed MULTI-CREW visit whose credited BH (what the bonus
// math actually reads: performance[date][crew].jobs[].bh) no longer matches
// the CURRENT auto headcount split — i.e. credit frozen at the split that
// existed at first completion while the roster later changed. Reports two
// failure modes:
//   (1) mis-DISTRIBUTION — a crew's frozen credit != its current auto share
//       (sum may still equal the job total, e.g. 19.8/13.2 vs 16.5/16.5).
//   (2) over/under-CREDIT — the crews' credits don't sum to the job total
//       (e.g. 13.2/19.8/11 = 44 on a 33 BH job after a 3rd crew joined).
//
// Offline + read-only: reads a backup JSON (which still carries multiDayJobs,
// performance, visitBHSplits, schedules). Manual splits are listed but NOT
// audited (manager overrides are intentional). Pass a backup filename as
// arg; defaults to the most recent migration backup.
//
// USAGE
//   node scripts/audit-multicrew-credits.mjs [appData-backup-....json]

import { readFileSync, readdirSync } from 'node:fs';

const round1 = (n) => Math.round(n * 10) / 10;
const stableCrewKey = (c) =>
  `${(c.division || '').trim().toLowerCase()}-${c.crewNumber}`;

const file = process.argv[2] ||
  readdirSync('.')
    .filter((f) => /^appData-backup-.*\.json$/.test(f))
    .sort()
    .slice(-1)[0];
if (!file) { console.error('No backup file found.'); process.exit(1); }
console.log(`Auditing snapshot: ${file}\n`);

const d = JSON.parse(readFileSync(file, 'utf8'));
const performance = d.performance || {};
const schedules = d.schedules || {};
const splits = d.visitBHSplits || {};
const mdj = d.multiDayJobs || {};

// crewId (per-day) -> stable cross-day crew key, across every scheduled day.
const crewKeyById = {};
const crewLabelById = {};
for (const date of Object.keys(schedules)) {
  for (const c of schedules[date] || []) {
    crewKeyById[c.id] = stableCrewKey(c);
    crewLabelById[c.id] = `${c.division} #${c.crewNumber}`;
  }
}
const keyOf = (crewId) => crewKeyById[crewId] || `crewid:${crewId}`;

// Gather credited Jobber rows per visit: visitId -> [{date, crewId, bh, totalBH}]
const rowsByVisit = {};
for (const date of Object.keys(performance)) {
  for (const [crewId, log] of Object.entries(performance[date] || {})) {
    for (const job of (log.jobs || [])) {
      if (job.source !== 'jobber' || !job.jobberVisitId) continue;
      // Skip pure uncredited ghosts (incomplete/awaiting) — no bonus impact.
      if (job.movedToDate) continue;
      const vid = job.jobberVisitId;
      (rowsByVisit[vid] = rowsByVisit[vid] || []).push({
        date, crewId,
        bh: Number(job.bh) || 0,
        totalBH: Number(job.totalBH ?? job.bh) || 0,
      });
    }
  }
}

// Latest cumulative % a crew (by key) completed on a visit, from the ledger.
function cumPctByKey(visitId) {
  const out = {};
  const hist = mdj[visitId]?.completionHistory || [];
  for (const h of hist) {
    const k = h.crewKey || keyOf(h.crewId);
    // keep the latest entry's percent (history is per-crew cumulative)
    if (!(k in out)) out[k] = h.percentComplete;
    else out[k] = Math.max(out[k], h.percentComplete);
  }
  return out;
}

const flagged = [];
const manualSkipped = [];
const uncredited = [];
let totalAbsDelta = 0;
let netDelta = 0;

// ONLY true SIMULTANEOUS multi-crew visits have a visitBHSplits record with
// >1 crew. A visitId credited to different crews on different DATES is a
// multi-DAY carry-forward (legitimate, sequential) — NOT this bug — and is
// correctly excluded because it has no >1-crew split record.
for (const visitId of Object.keys(splits)) {
  const split = splits[visitId];
  if (!split || !split.splits || split.splits.length <= 1) continue;
  const rows = rowsByVisit[visitId] || [];
  const crewIds = [...new Set(rows.map((r) => r.crewId))];

  const method = split.splitMethod;
  const title = mdj[visitId]?.title || '(unknown job)';
  if (method === 'manual') {
    manualSkipped.push({ visitId, title, crews: split.splits.length });
    continue;
  }

  const jobTotal = split ? split.totalBH : (mdj[visitId]?.totalBH ?? 0);
  // Current auto share keyed by stable crew key.
  const shareByKey = {};
  if (split) {
    for (const s of split.splits) shareByKey[keyOf(s.crewId)] = s.bh;
  }
  const pctByKey = cumPctByKey(visitId);

  // Credited (frozen) BH per crew key = sum of its row.bh on this visit.
  const frozenByKey = {};
  const labelByKey = {};
  for (const r of rows) {
    const k = keyOf(r.crewId);
    frozenByKey[k] = (frozenByKey[k] || 0) + r.bh;
    labelByKey[k] = crewLabelById[r.crewId] || r.crewId;
  }

  const allKeys = [...new Set([...Object.keys(frozenByKey), ...Object.keys(shareByKey)])];
  const perCrew = [];
  let sumFrozen = 0, sumExpected = 0, anyMis = false;
  for (const k of allKeys) {
    const share = shareByKey[k] ?? 0;          // current auto share (0 if crew no longer on visit)
    const pct = pctByKey[k] ?? 100;            // 100 when completed with no partial history
    const expected = round1((pct / 100) * share);
    const frozen = round1(frozenByKey[k] ?? 0);
    const delta = round1(frozen - expected);
    sumFrozen = round1(sumFrozen + frozen);
    sumExpected = round1(sumExpected + expected);
    if (Math.abs(delta) >= 0.05) anyMis = true;
    perCrew.push({ key: k, label: labelByKey[k] || k, pct, share, frozen, expected, delta });
  }
  const reconDelta = round1(sumFrozen - jobTotal);
  // Reconciliation only meaningful when every crew is 100% complete.
  const allComplete = perCrew.every((c) => c.pct >= 100);
  const reconOff = allComplete && Math.abs(reconDelta) >= 0.05;

  // Nothing credited yet (visit incomplete / awaiting review) → not a
  // frozen-credit bug; the credit simply hasn't been written. Report
  // separately so it isn't counted as BH error.
  if (sumFrozen < 0.05) {
    if (sumExpected >= 0.05) uncredited.push({ visitId, title, jobTotal, sumExpected });
    continue;
  }

  if (anyMis || reconOff) {
    flagged.push({ visitId, title, jobTotal, method, perCrew, sumFrozen, sumExpected, reconDelta, allComplete });
    for (const c of perCrew) { totalAbsDelta = round1(totalAbsDelta + Math.abs(c.delta)); netDelta = round1(netDelta + c.delta); }
  }
}

// ---- report ----
console.log(`Multi-crew visits flagged: ${flagged.length}`);
console.log(`Manual-split visits skipped (overrides — not audited): ${manualSkipped.length}`);
console.log('');
for (const v of flagged) {
  console.log(`■ ${v.title}`);
  console.log(`  visit=${v.visitId}  jobTotal=${v.jobTotal} BH  split=${v.method}`);
  for (const c of v.perCrew) {
    const tag = Math.abs(c.delta) >= 0.05 ? `  <-- MIS-CREDIT ${c.delta > 0 ? '+' : ''}${c.delta}` : '';
    console.log(`    ${c.label.padEnd(16)} ${c.pct}%  frozen=${c.frozen}  current-share=${c.share}  corrected=${c.expected}${tag}`);
  }
  const reconNote = v.allComplete
    ? (Math.abs(v.reconDelta) >= 0.05
        ? `MISMATCH ${v.reconDelta > 0 ? 'OVER' : 'UNDER'}-credit by ${v.reconDelta}`
        : 'OK (sums to job total)')
    : 'n/a (not all crews 100%)';
  console.log(`    Reconcile: credited sum=${v.sumFrozen} vs jobTotal=${v.jobTotal}  ->  ${reconNote}`);
  console.log('');
}
if (manualSkipped.length) {
  console.log('Manual splits (not audited — verify intentional):');
  for (const m of manualSkipped) console.log(`  - ${m.title} (visit=${m.visitId}, ${m.crews} crews)`);
  console.log('');
}
if (uncredited.length) {
  console.log('Multi-crew splits set but NOT yet credited (incomplete/awaiting — not a frozen-credit bug):');
  for (const u of uncredited) console.log(`  - ${u.title} (visit=${u.visitId}, jobTotal=${u.jobTotal}, would credit ${u.sumExpected})`);
  console.log('');
}
console.log('─── SUMMARY ───');
console.log(`Visits mis-credited:        ${flagged.length}`);
console.log(`Crew-rows mis-credited:     ${flagged.reduce((a, v) => a + v.perCrew.filter((c) => Math.abs(c.delta) >= 0.05).length, 0)}`);
console.log(`Jobs over/under job-total:  ${flagged.filter((v) => v.allComplete && Math.abs(v.reconDelta) >= 0.05).length}`);
console.log(`Total ABS BH error:         ${totalAbsDelta} BH`);
console.log(`Net BH error (signed):      ${netDelta > 0 ? '+' : ''}${netDelta} BH`);

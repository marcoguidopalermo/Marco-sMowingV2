// Month-end resolution of BLOCKING PARTIAL JOBS — pure helpers. A partial
// multi-day job blocks a month when a crew-day in that month carries a
// `awaitingCompletionReview` visit row (that day can't be approved). These
// helpers surface such jobs per month and produce the ledger updates for the
// three resolution actions. They NEVER recompute completionHistory or any
// already-credited BH — 'void' closes only the uncredited remainder.
import { MultiDayJob, PerformanceLog } from '../types';

export type PerfMap = Record<string, Record<string, PerformanceLog>>;
const round1 = (n: number) => Math.round((Number(n) || 0) * 10) / 10;
const monthOf = (d: string) => (d || '').slice(0, 7);

// A visit row blocks approval when it needs completion review and is NOT an
// opt-in incomplete-visit continuation (mirrors PerformanceBoard's gate).
export function rowBlocksApproval(r: { awaitingCompletionReview?: boolean; isIncompleteVisit?: boolean }): boolean {
  return !!r.awaitingCompletionReview && !r.isIncompleteVisit;
}

// Raw (unrounded) BH credited to a visit ledger — used internally so remaining
// is rounded exactly once.
function rawCredited(ledger: MultiDayJob | undefined): number {
  let sum = 0;
  for (const h of ledger?.completionHistory || []) sum += Number(h.creditedBH) || 0;
  return sum;
}
// BH already credited to a visit ledger across all its completion entries.
export function creditedBHOf(ledger: MultiDayJob | undefined): number {
  return round1(rawCredited(ledger));
}
// Uncredited remainder of a visit ledger (never negative), rounded once.
// remaining = max(0, totalBH − credited). Credited is NEVER recomputed, so when
// Jobber lowers the total below what's already credited this clamps to 0 — use
// totalBelowCredited() to detect and surface that case rather than hiding it.
export function remainingBHOf(ledger: MultiDayJob | undefined): number {
  const total = Number(ledger?.totalBH) || 0;
  return round1(Math.max(0, total - rawCredited(ledger)));
}
// True when the (possibly Jobber-lowered) total is below the BH already credited
// — remaining would be negative, so it's clamped to 0 and this flags it.
export function totalBelowCredited(ledger: MultiDayJob | undefined): boolean {
  if (!ledger) return false;
  if (ledger.totalBelowCredited) return true; // stamped by the sync
  return (Number(ledger.totalBH) || 0) + 1e-6 < rawCredited(ledger);
}
export function creditedPctOf(ledger: MultiDayJob | undefined): number {
  const total = Number(ledger?.totalBH) || 0;
  return total > 0 ? Math.round((creditedBHOf(ledger) / total) * 100) : 0;
}

export interface BlockingDayRef { date: string; crewId: string; crewLabel: string }
export interface BlockingPartialJob {
  jobberVisitId: string;
  jobberJobId: string;
  title: string;
  totalBH: number;
  creditedBH: number;
  remainingBH: number;
  creditedPct: number;
  priorDate: string;                 // most recent already-credited day (for the "Prior X%…" label)
  blockingDays: BlockingDayRef[];     // crew-days in `ym` whose approval this visit gates
  defaultTarget: BlockingDayRef | null; // last crew-day that worked this visit (COMPLETE default)
}

// Blocking partial jobs for month `ym`: open visit ledgers with an
// awaiting-completion-review row on a crew-day in the month. Already-resolved
// ledgers (voided / completed / carried) are excluded.
export function scanBlockingPartialJobs(
  performance: PerfMap, multiDayJobs: Record<string, MultiDayJob> | undefined, ym: string,
): BlockingPartialJob[] {
  const mdj = multiDayJobs || {};
  const byVisit = new Map<string, { blocking: BlockingDayRef[]; title: string; jobberJobId: string; totalBH: number }>();

  for (const [date, dayMap] of Object.entries(performance || {})) {
    if (monthOf(date) !== ym) continue;
    for (const [crewId, log] of Object.entries(dayMap || {})) {
      if (log?.approvalStatus === 'approved' || log?.approvalStatus === 'waived') continue;
      const crewLabel = `${log.division ?? '?'} #${log.crewNumber ?? '?'}`;
      for (const r of log.jobs || []) {
        if (!r.jobberVisitId || !rowBlocksApproval(r)) continue;
        const e = byVisit.get(r.jobberVisitId) || { blocking: [], title: r.desc || 'Job', jobberJobId: r.jobberJobId || '', totalBH: Number(r.totalBH) || 0 };
        e.blocking.push({ date, crewId, crewLabel });
        if (r.desc) e.title = r.desc;
        byVisit.set(r.jobberVisitId, e);
      }
    }
  }

  const out: BlockingPartialJob[] = [];
  for (const [visitId, e] of byVisit) {
    const ledger = mdj[visitId];
    if (ledger?.resolvedKind || ledger?.voidedRemainder || ledger?.dismissedCarryForward) continue; // already resolved
    const totalBH = Number(ledger?.totalBH) || e.totalBH || 0;
    const credited = ledger ? creditedBHOf(ledger) : 0;
    // Most recent already-credited day, and the last crew-day that worked it.
    let priorDate = '';
    for (const h of ledger?.completionHistory || []) if (h.targetDate > priorDate) priorDate = h.targetDate;
    let last: BlockingDayRef | null = null;
    for (const [date, dayMap] of Object.entries(performance || {})) {
      for (const [crewId, log] of Object.entries(dayMap || {})) {
        if ((log.jobs || []).some(r => r.jobberVisitId === visitId)) {
          if (!last || date > last.date) last = { date, crewId, crewLabel: `${log.division ?? '?'} #${log.crewNumber ?? '?'}` };
        }
      }
    }
    out.push({
      jobberVisitId: visitId, jobberJobId: e.jobberJobId, title: e.title,
      totalBH, creditedBH: credited, remainingBH: round1(Math.max(0, totalBH - credited)),
      creditedPct: totalBH > 0 ? Math.round((credited / totalBH) * 100) : 0,
      priorDate, blockingDays: e.blocking.sort((a, b) => a.date < b.date ? -1 : 1),
      defaultTarget: last || e.blocking[e.blocking.length - 1] || null,
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

// ── Ledger updates (pure). The performance-row edits are applied by the caller
// (App.tsx) using the same write shape as CompletionReviewModal. ──
export interface Actor { email: string; name: string }

// VOID: close the uncredited remainder. Credited BH untouched; ledger marked
// complete so the sync stops re-emitting it.
export function voidLedger(ledger: MultiDayJob, reason: string, by: Actor, ym: string, at: number): MultiDayJob {
  const bh = remainingBHOf(ledger);
  return {
    ...ledger, status: 'complete',
    resolvedKind: 'voided', resolvedMonth: ym, resolvedBH: bh, resolvedAt: at, resolvedBy: by,
    voidedRemainder: { bh, reason, byEmail: by.email, byName: by.name, at },
  };
}
// CARRY FORWARD: keep the visit open for a future day; only stop it gating THIS
// month (the caller converts the blocking rows to non-blocking continuations).
export function carryLedger(ledger: MultiDayJob, by: Actor, ym: string, at: number): MultiDayJob {
  return { ...ledger, resolvedKind: 'carried', resolvedMonth: ym, resolvedBH: remainingBHOf(ledger), resolvedAt: at, resolvedBy: by };
}
// COMPLETE: mark the ledger 100% (the BH credit itself is an ordinary
// completionHistory entry appended by the caller).
export function completeLedger(ledger: MultiDayJob, creditedBH: number, by: Actor, ym: string, at: number): MultiDayJob {
  return { ...ledger, status: 'complete', resolvedKind: 'completed', resolvedMonth: ym, resolvedBH: round1(creditedBH), resolvedAt: at, resolvedBy: by };
}

export interface ResolutionSummary { completed: { n: number; bh: number }; carried: { n: number; bh: number }; voided: { n: number; bh: number } }
// Post-finalize "resolutions" summary for a month (N each · BH each).
export function monthResolutionSummary(multiDayJobs: Record<string, MultiDayJob> | undefined, ym: string): ResolutionSummary {
  const s: ResolutionSummary = { completed: { n: 0, bh: 0 }, carried: { n: 0, bh: 0 }, voided: { n: 0, bh: 0 } };
  for (const l of Object.values(multiDayJobs || {})) {
    if (l.resolvedMonth !== ym || !l.resolvedKind) continue;
    const k = l.resolvedKind;
    s[k].n += 1;
    s[k].bh = round1(s[k].bh + (Number(l.resolvedBH) || 0));
  }
  return s;
}

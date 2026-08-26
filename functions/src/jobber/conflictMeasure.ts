// WHAT COUNTS AS WITHHELD BH — the measure behind the approved-day conflict
// log, extracted so it is dependency-free and testable.
//
// The failure this exists to prevent, seen on 2026-08-25: the conflict log
// compared a crew-day's stored BH against `parseBh(visit.title)` — the QUOTED
// figure, which sits on a Jobber visit whether or not anyone has done the work
// — with no check that the visit was complete. Every incomplete visit on a
// locked day was therefore reported as `old=0 new=<quoted>`.
//
// The result read as alarming precisely when the LEAST work had happened. On a
// rain day it showed 51.1 BH "withheld", of which 36.9 was quoted BH for 47
// visits nobody ever completed — still open in Jobber the following day. The
// genuinely outstanding figure was 12.1 BH, a single multi-day job. A number
// that peaks when nothing is wrong is worse than no number: it gets acted on.
//
// Both surfaces now report only BH outstanding on work Jobber marks COMPLETE.

const round2 = (n: number): number => Math.round(n * 100) / 100;
const EPS = 1e-6;

/**
 * BH to report for a matched visit on a locked crew-day. 0 means "say nothing".
 * @param {object} input The visit's completion state and the two BH figures.
 * @param {boolean} input.isComplete Whether Jobber marks the visit complete.
 * @param {number} input.storedBH BH recorded on the crew-day row.
 * @param {number} input.jobberShareBH This crew's share of the title BH.
 * @return {number} Signed BH difference to report, or 0 when not reportable.
 */
export function conflictReportableBH(input: {
  isComplete: boolean;
  storedBH: number;
  jobberShareBH: number;
}): number {
  // Quoted BH on work nobody did is not withheld BH.
  if (!input.isComplete) return 0;
  const delta = round2((input.jobberShareBH || 0) - (input.storedBH || 0));
  return Math.abs(delta) > EPS ? delta : 0;
}

/**
 * BH still uncredited on a multi-day ledger. Credited history is never
 * recomputed, so remaining = max(0, total - credited).
 * @param {number} totalBH The ledger's current scope.
 * @param {Array} history Completion entries so far.
 * @return {number} Outstanding BH, never negative.
 */
export function ledgerOutstandingBH(
  totalBH: number,
  history: Array<{ creditedBH?: number }> | null | undefined,
): number {
  const credited = (history || [])
    .reduce((sum, h) => sum + (Number(h.creditedBH) || 0), 0);
  return Math.max(0, round2((Number(totalBH) || 0) - credited));
}

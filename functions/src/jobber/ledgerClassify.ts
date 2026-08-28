// IS THIS VISIT A RECURRING MAINTENANCE CUT, OR A JOB THAT CAN SPAN DAYS?
//
// Every Jobber visit carrying a job id and a parsed BH gets a multiDayJobs
// ledger on first sight, before anything is known about whether it will run
// past one day. That is unavoidable — you cannot tell on day one. What WAS
// avoidable is the classification: `isLawnJob` was hardcoded false at both
// creation sites, and never set afterwards.
//
// It is not a cosmetic field. CompletionReviewModal offers "single-day,
// auto-credit at 100%" when it is true and "multi-day, require % review" when
// it is false, so hardcoding false asked for a percentage review on every
// weekly lawn cut in the business.
//
// Measured over the collection as it stood: 3,248 of 3,469 ledgers (93.6%)
// carried a recurring title, and 31 of those (0.95%) ever spanned more than
// one day. A recurring title is about as clean a discriminator as this data
// offers, and it describes the JOB rather than the crew — a lawn crew doing a
// sod install is still doing multi-day work.
const RECURRING = /\b(weekly|bi-?weekly|monthly|bi-?monthly|semi-?monthly)\b/i;

/**
 * True when the visit title reads as a recurring maintenance cut.
 * @param {string|null|undefined} title The Jobber visit or job title.
 * @return {boolean} Whether it recurs on a schedule.
 */
export function isRecurringVisitTitle(
  title: string | null | undefined,
): boolean {
  return RECURRING.test(String(title || ""));
}

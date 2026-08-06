// THE [BH] tag parser — single source of truth.
//
// Lifted VERBATIM out of syncPerformance.ts (regexes, precedence, rejection
// rules and all) so a second reader — the forward CAPACITY FORECAST — parses
// job titles identically to the performance sync. No second implementation,
// no drift: if the tag convention ever changes it changes here, once.
//
// Nothing in this module touches performance / pay / efficiency math. It is
// pure string → number.

// Accepts both [3BH] (explicit suffix, original convention) and [3]
// (implicit — bare number, used informally by office staff). Whitespace
// inside the brackets around the optional BH suffix is tolerated.
// Capture group 2 ("BH") is used to distinguish the two formats for
// audit reporting.
// The value pattern is \d*\.?\d+ — the integer part is OPTIONAL so
// fractional-under-1 tags parse in both forms: [0.5] AND bare [.5].
// (The old \d+\.?\d* required a leading digit, so crews typing [.5] /
// [.9] fell through to "Awaiting BH tag".) Requires at least one digit
// overall, so [] / [.] / [bh] still don't match.
export const BH_REGEX = /\[(\d*\.?\d+)\s*(BH)?\s*\]/i;
// [hourly] takes precedence over [XBH] / [N]. T&M jobs where the
// manager calculates BH manually (workers × hours).
export const HOURLY_REGEX = /\[\s*hourly\s*\]/i;

export interface ParsedBh {
  bh: number;
  format: "explicit" | "implicit" | "hourly";
  isHourly: boolean;
}

/**
 * Parses a job/visit title for either a BH tag or the [hourly] marker.
 * [hourly] takes precedence — if both are present, the row is treated
 * as hourly (manager-entered BH) and the BH tag is ignored (caller
 * may log a warning).
 * @param {string | null | undefined} title The text to scan.
 * @return {ParsedBh | null} Parsed tag, or null if no recognized tag.
 */
export function parseBh(title: string | null | undefined): ParsedBh | null {
  if (!title) return null;
  if (HOURLY_REGEX.test(title)) {
    return {bh: 0, format: "hourly", isHourly: true};
  }
  const m = BH_REGEX.exec(title);
  if (!m) return null;
  // parseFloat (not parseInt) so [.5] / [0.5] keep their decimal.
  const n = parseFloat(m[1]);
  // A valid BH tag must be a positive number. Reject 0 / negative /
  // non-finite — those fall through to "Awaiting BH tag" rather than
  // crediting 0 BH. (Negatives also can't reach the regex, but guard
  // anyway.)
  if (!Number.isFinite(n) || n <= 0) return null;
  return {bh: n, format: m[2] ? "explicit" : "implicit", isHourly: false};
}

/**
 * Strips any recognized job tag ([hourly], [XBH], [N]) from a title.
 * @param {string} title The raw title.
 * @return {string} Title without tag markers.
 */
export function stripBhTag(title: string): string {
  return title
    .replace(HOURLY_REGEX, "")
    .replace(BH_REGEX, "")
    .trim()
    .replace(/\s{2,}/g, " ");
}

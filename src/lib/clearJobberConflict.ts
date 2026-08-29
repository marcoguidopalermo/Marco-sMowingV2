// RESOLVING A JOBBER BH CONFLICT REMOVES THE KEYS, IT DOES NOT WRITE false.
//
// hasJobberConflict was being stored as `false` on every row whose conflict had
// been answered. Measured on the live document: present on 588 of 803 job rows
// and false on all 588 — 10.9 KB, 2% of appData/main, recording the absence of
// a problem. Every reader tests it as `!!row.hasJobberConflict`, so an absent
// key and `false` are indistinguishable to them; only the byte count differs.
//
// The same applies to jobberSuggestedValue, which was being set to `undefined`
// beside it — harmless in memory, but it depends on the write path stripping
// undefined rather than persisting a null, and deleting the key is not
// conditional on that.
//
// Left deliberately narrow: this clears the conflict pair and nothing else, so
// a caller that also wants to change bh does that itself.
import type { PerformanceJobRow } from '../types';

export function clearJobberConflict(row: PerformanceJobRow): PerformanceJobRow {
  // Destructured out rather than assigned undefined, so the key is genuinely
  // gone from the object that gets written.
  const {
    hasJobberConflict: _conflict,
    jobberSuggestedValue: _suggested,
    ...rest
  } = row;
  return rest;
}

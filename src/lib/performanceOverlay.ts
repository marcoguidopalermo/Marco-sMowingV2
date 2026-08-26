// WHICH performanceMonths SHEETS MUST BE OVERLAID — extracted as a pure
// function so the thing that can silently halve every monthly total is
// testable.
//
// The failure this exists to prevent, seen in production on 2026-08-26:
// the server-side rolling archive (functions/src/jobber/archive.ts) moves
// every settled day older than ARCHIVE_WINDOW_DAYS onto its month sheet
// WITHOUT waiting for the month to close. The app loaded a month sheet only
// when the whole month had been PUSHED, so from mid-month onward the open
// month was split between the doc and a sheet nobody read. At 06:01 that
// morning the archiver reached August 1–12 and every live monthly total —
// MTD widgets, division standings, the bonus projection — dropped by 49%
// (782.7 BH) with nothing on screen to say why.
//
// The invariant, which performanceOverlay.test.ts asserts directly:
//   ARCHIVING A DAY MUST NEVER CHANGE A MONTHLY TOTAL.
// Archiving is a storage decision. It must be invisible to every reader.
import type { PerformanceLog } from '../types';

export type PerfMap = Record<string, Record<string, PerformanceLog>>;

const monthOf = (date: string): string => date.slice(0, 7);

// Sheets are overlaid UNDER the doc: a day is only ever in one place, but if
// an unlocked day is being edited the doc's copy is the newer one and wins.
export const mergePerformance = (docPerf: PerfMap, monthOverlay: PerfMap): PerfMap =>
  ({ ...monthOverlay, ...docPerf });

export function monthsNeedingSheet(input: {
  /** Real today, YYYY-MM-DD. Its month is the open month. */
  today: string;
  /** The date currently being viewed, if any. */
  viewedDate?: string | null;
  /** Months finalized to their sheet. */
  pushedMonths?: string[] | null;
  /** date → archivedAt ms, as the archiver records it on the doc. */
  archivedDays?: Record<string, number> | null;
}): string[] {
  const need = new Set<string>();
  const archived = Object.keys(input.archivedDays || {});

  // THE OPEN MONTH. Any day of it that has been rolling-archived is absent
  // from the doc, so without its sheet every month-to-date total is computed
  // over a partial day set. This is the case that was missed.
  const openYm = monthOf(input.today);
  if (archived.some((d) => monthOf(d) === openYm)) need.add(openYm);

  // The viewed date's month, when that month was pushed whole...
  const pushed = new Set(input.pushedMonths || []);
  const viewedYm = input.viewedDate ? monthOf(input.viewedDate) : null;
  if (viewedYm && pushed.has(viewedYm)) need.add(viewedYm);
  // ...or when it merely has archived days in it. A past month that was never
  // pushed still had its days drained by the same rolling archive.
  if (viewedYm && archived.some((d) => monthOf(d) === viewedYm)) need.add(viewedYm);

  return [...need].sort();
}

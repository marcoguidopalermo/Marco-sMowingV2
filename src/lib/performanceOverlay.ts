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

// THE RULE, once, for every loader.
//
// A month's days can be on a sheet for TWO different reasons, and only one of
// them is `pushedMonths`:
//
//   pushedMonths   the whole month was finalised and moved
//   archivedDays   the ROLLING archive moved individual days as they aged
//
// A reader that tests `pushedMonths` alone silently misses every
// rolling-archived day, and has now done so three times: the MTD widgets, the
// open-partial scan, and the date-range report. August 2026 is the case that
// keeps catching people out — it was never pushed, yet 15 of its 31 days sit
// on performanceMonths/2026-08, so `pushedMonths.includes('2026-08')` is FALSE
// and the sheet never loads.
//
// Every loader routes through here. If you are about to write
// `pushedMonths.includes(...)` to decide whether to FETCH something, you want
// this function instead. (Deciding whether a day is READ-ONLY is a different
// question, and there `pushedMonths || archivedDays[date]` is correct.)
// A month that the RULE below says needs its sheet. Branded, so it cannot be
// produced by writing a string: the only way to obtain one is to ask
// monthsNeedingSheet. ensureMonthLoaded takes this type, which makes
// "gated the fetch on pushedMonths alone" a COMPILE error rather than a
// convention a fourth reader can quietly break.
//
// A guard test over source text was tried first and was worthless — its context
// window picked up an `archivedDays` from a neighbouring lock check and excused
// the very defect it was meant to catch. The type system does not have that
// failure mode.
export type SheetMonth = string & { readonly __sheetMonth: unique symbol };

/** Escape hatch: loading a month for a reason the rule does not model. */
export const asSheetMonth = (ym: string, _why: string): SheetMonth => ym as SheetMonth;

export function monthsNeedingSheet(input: {
  /** Real today, YYYY-MM-DD. Its month is the open month. */
  today: string;
  /** The date currently being viewed, if any. */
  viewedDate?: string | null;
  /** Months finalized to their sheet. */
  pushedMonths?: string[] | null;
  /** date → archivedAt ms, as the archiver records it on the doc. */
  archivedDays?: Record<string, number> | null;
  /** An inclusive reported range, YYYY-MM-DD. */
  rangeFrom?: string | null;
  rangeTo?: string | null;
}): SheetMonth[] {
  const need = new Set<SheetMonth>();
  const archived = Object.keys(input.archivedDays || {});

  // THE OPEN MONTH. Any day of it that has been rolling-archived is absent
  // from the doc, so without its sheet every month-to-date total is computed
  // over a partial day set. This is the case that was missed.
  const openYm = monthOf(input.today);
  if (archived.some((d) => monthOf(d) === openYm)) need.add(openYm as SheetMonth);

  // The viewed date's month, when that month was pushed whole...
  const pushed = new Set(input.pushedMonths || []);
  const viewedYm = input.viewedDate ? monthOf(input.viewedDate) : null;
  if (viewedYm && pushed.has(viewedYm)) need.add(viewedYm as SheetMonth);
  // ...or when it merely has archived days in it. A past month that was never
  // pushed still had its days drained by the same rolling archive.
  if (viewedYm && archived.some((d) => monthOf(d) === viewedYm)) need.add(viewedYm as SheetMonth);

  // A REPORTED RANGE, on the same terms. Every month the range touches that
  // has data on a sheet, whether the month was pushed or merely drained.
  if (input.rangeFrom && input.rangeTo && input.rangeFrom <= input.rangeTo) {
    for (const ym of monthsBetween(input.rangeFrom, input.rangeTo)) {
      if (pushed.has(ym)) need.add(ym as SheetMonth);
      else if (archived.some((d) => monthOf(d) === ym)) need.add(ym as SheetMonth);
    }
  }

  return [...need].sort();
}

/** Every YYYY-MM the inclusive date range touches. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endYm = monthOf(to);
  for (let i = 0; i < 600; i++) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    out.push(ym);
    if (ym >= endYm) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

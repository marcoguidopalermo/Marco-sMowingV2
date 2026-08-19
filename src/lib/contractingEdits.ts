// CONTRACTINGMASTER — the two things a real invoice run needs to correct after
// the fact: the invoice NUMBER, and the DATE on an hours line.
//
// Both are overrides on top of machinery that is otherwise automatic, and both
// are things Dave reconciles against, so the rules here are about making a
// correction possible without making a mistake silent.
import { ContractingInvoice, ContractingProgressReport } from '../types';

// ── INVOICE NUMBER ─────────────────────────────────────────────────────────
// The sequence (nextProgNumber) stays the default for every new report. This
// is an override for the cases the sequence cannot know about: matching a
// number already sent to a client on paper, or repairing a mis-sequence.

/** Trim and upper-case. Numbers are compared and displayed in one shape. */
export const normalizeInvoiceNumber = (v: string | null | undefined): string =>
  (typeof v === 'string' ? v.trim().toUpperCase() : '');

export const invoiceNumberIsUsable = (v: string | null | undefined): boolean =>
  normalizeInvoiceNumber(v).length > 0;

/**
 * The live invoice already carrying this number, if any.
 *
 * VOIDED invoices are still counted. A void is kept deliberately as an
 * accounted stub so numbering stays sequential — reusing its number would
 * defeat that and put two records in the books under one reference.
 *
 * `exceptInvoiceId` excludes the invoice being edited, so re-saving its own
 * number is not a clash with itself.
 */
export function duplicateInvoiceNumber(
  candidate: string,
  invoices: ContractingInvoice[],
  exceptInvoiceId?: string,
): ContractingInvoice | null {
  const want = normalizeInvoiceNumber(candidate);
  if (!want) return null;
  return (invoices || []).find(inv =>
    inv.id !== exceptInvoiceId && normalizeInvoiceNumber(inv.number) === want) || null;
}

/**
 * The number a report will mint with: its override when set, otherwise the
 * sequence. One place, so the preview on the open report and the number the
 * invoice is actually created with can never disagree.
 */
export function reportMintNumber(
  report: Pick<ContractingProgressReport, 'numberOverride'>,
  sequential: string,
): string {
  const o = normalizeInvoiceNumber(report.numberOverride);
  return o || sequential;
}

// ── HOURS-LINE DATE ────────────────────────────────────────────────────────
// A batch "+ Add hours" line carries the day it applies to. Tony enters a day
// late or on the wrong date and needs to correct it in place rather than
// deleting and re-entering, which would lose the line's audit trail.

export interface PeriodCheck {
  outside: boolean;
  /** 'before' the period opened, or 'after' it closed. */
  side?: 'before' | 'after';
  /** Ready to show verbatim. A warning, never a block — see below. */
  message?: string;
}

const ymd = (ms: number): string =>
  Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : '';

/**
 * Is a corrected date outside the period the line is being billed in?
 *
 * WARN, never block. A period's boundaries are themselves editable (the start
 * date has an edit control, and the end is set at invoicing), and there are
 * legitimate reasons to bill a day just outside — work that ran past midnight,
 * or a period opened a day late. Refusing would send Tony to delete and
 * re-enter the line, losing its history, to do the same thing. Saying so out
 * loud is what stops it being silent.
 *
 * Compared by CALENDAR DAY, not by timestamp: an hours line is a day, and a
 * period that opened at 09:00 still owns that whole day's work.
 */
export function dateOutsidePeriod(input: {
  dateMs: number;
  startAt: number;
  /** Absent on an open report — the period runs to today. */
  endAt?: number;
}): PeriodCheck {
  const d = ymd(input.dateMs);
  if (!d) return { outside: false };
  const start = ymd(input.startAt);
  if (start && d < start) {
    return {
      outside: true, side: 'before',
      message: `That date is before this period opened (${start}). The line would be `
        + 'billed in a period it falls outside.',
    };
  }
  if (input.endAt) {
    const end = ymd(input.endAt);
    if (end && d > end) {
      return {
        outside: true, side: 'after',
        message: `That date is after this period ended (${end}). The line would be `
          + 'billed in a period it falls outside.',
      };
    }
  }
  return { outside: false };
}

// ── AUDIT TEXT ─────────────────────────────────────────────────────────────
// One phrasing for each change, so the trail reads consistently and always
// carries old → new. A trail that records only "edited" answers nothing.

export const describeNumberChange = (
  from: string, to: string, context: string,
): string => `Invoice number ${normalizeInvoiceNumber(from) || '(none)'} → `
  + `${normalizeInvoiceNumber(to)} on ${context}`;

export const describeDateChange = (
  who: string, fromMs: number, toMs: number, reportNumber: number,
): string => `Hours line date for ${who} ${ymd(fromMs) || '(none)'} → ${ymd(toMs)} `
  + `on report #${reportNumber}`;

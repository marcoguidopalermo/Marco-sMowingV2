// Payroll dates for OfficeMaster, from the existing pay-period model
// (lib/payPeriods). Two dates per period:
//   SUBMISSION — the Monday right after the period ends (end + 1). The date
//                Dave works to: payroll must be in by then.
//   PAY DATE   — the Friday, end + payLagDays (5).
// The server reminders compute the same thing (functions/src/officeDeadlinesCore
// payrollSubmissionDue); payroll.test.ts checks they always agree.
// Holidays: not handled yet — see SUBMISSION_LAG_DAYS.
import type { PayPeriodSettings } from '../payPeriods';
import { daysUntilDate } from '../dateUtils';

/** Submission is due the day after the period ends. (A stat-holiday Monday would move it — not modelled yet.) */
export const SUBMISSION_LAG_DAYS = 1;

// Calendar arithmetic on YYYY-MM-DD (UTC days), so daylight-saving changes
// can't shift a date. Same settings as lib/payPeriods (anchor, length, lag).
// NOTE: lib/payPeriods.periodForDate adds 24-hour steps in local time and
// drifts a day across DST (from the Oct 26 2026 period) — reported to Marco,
// not changed here because TimeMaster's pay ranges use it.
const day = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; };
const ymd = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

export interface PayrollPeriod { start: string; end: string; payDate: string; submission: string }
export function payrollPeriodContaining(cfg: PayPeriodSettings, date: string): PayrollPeriod {
  const len = cfg.lengthDays || 14, anchor = day(cfg.anchorStart);
  const start = anchor + Math.floor((day(date) - anchor) / len) * len;
  const end = start + len - 1;
  return { start: ymd(start), end: ymd(end), payDate: ymd(end + (cfg.payLagDays ?? 5)), submission: ymd(end + SUBMISSION_LAG_DAYS) };
}
const shift = (cfg: PayPeriodSettings, p: PayrollPeriod, n: number) => payrollPeriodContaining(cfg, ymd(day(p.start) + n * (cfg.lengthDays || 14)));

export interface PayrollDates {
  submission: { date: string; days: number; period: PayrollPeriod };
  pay: { date: string; days: number; period: PayrollPeriod };
}

/** The next submission and the next pay date on or after today (each from whichever period they belong to). */
export function payrollDates(cfg: PayPeriodSettings, today: string): PayrollDates {
  const cur = payrollPeriodContaining(cfg, today);
  const prev = shift(cfg, cur, -1);
  const subPeriod = prev.submission >= today ? prev : cur;
  const payPeriod = prev.payDate >= today ? prev : cur;
  return {
    submission: { date: subPeriod.submission, days: daysUntilDate(subPeriod.submission), period: subPeriod },
    pay: { date: payPeriod.payDate, days: daysUntilDate(payPeriod.payDate), period: payPeriod },
  };
}

/** Red on the day, amber within 2 days. (Nothing records "submitted", so it never shows overdue.) */
export function submissionTone(days: number): 'red' | 'amber' | 'none' {
  return days <= 0 ? 'red' : days <= 2 ? 'amber' : 'none';
}

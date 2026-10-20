// Payroll dates for OfficeMaster — from lib/payPeriods (one calculation for
// TimeMaster, the hours bank and this line). Two dates per period:
//   SUBMISSION — the Monday right after the period ends (end + 1). The date
//                Dave works to: payroll must be in by then.
//   PAY DATE   — the Friday, end + payLagDays (5).
// The server reminders compute the same thing (functions/src/officeDeadlinesCore
// payrollSubmissionDue); payroll.test.ts checks they always agree.
// Holidays: not handled yet — see SUBMISSION_LAG_DAYS in lib/payPeriods.
import { nextPayrollDates, type PayPeriod, type PayPeriodSettings } from '../payPeriods';
import { daysUntilDate } from '../dateUtils';

export { SUBMISSION_LAG_DAYS } from '../payPeriods';

export interface PayrollDates {
  submission: { date: string; days: number; period: PayPeriod };
  pay: { date: string; days: number; period: PayPeriod };
}

/** The next submission and the next pay date on or after today (each from whichever period they belong to). */
export function payrollDates(cfg: PayPeriodSettings, today: string): PayrollDates {
  const { submission, pay } = nextPayrollDates(cfg, today);
  return {
    submission: { date: submission.submissionDate, days: daysUntilDate(submission.submissionDate), period: submission },
    pay: { date: pay.payDate, days: daysUntilDate(pay.payDate), period: pay },
  };
}

/** Red on the day, amber within 2 days. (Nothing records "submitted", so it never shows overdue.) */
export function submissionTone(days: number): 'red' | 'amber' | 'none' {
  return days <= 0 ? 'red' : days <= 2 ? 'amber' : 'none';
}

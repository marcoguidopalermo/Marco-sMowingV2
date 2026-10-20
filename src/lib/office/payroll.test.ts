// Payroll dates — page and server reminders must agree.
//   npx vitest run src/lib/office/payroll
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { payrollDates, submissionTone } from './payroll';
import { DEFAULT_PAY_PERIOD } from '../payPeriods';
import { addDaysToronto } from '../dateUtils';
import { payrollSubmissionDue, payrollAlertsDue } from '../../../functions/src/officeDeadlinesCore';

// Days are counted from the real "today", so check the dates, not the counts, for fixed days.
test('Tue Oct 20: submission Mon Oct 26 for Oct 12–25; pay Fri Oct 30', () => {
  const p = payrollDates(DEFAULT_PAY_PERIOD, '2026-10-20');
  assert.equal(p.submission.date, '2026-10-26');
  assert.equal(p.submission.period.start, '2026-10-12');
  assert.equal(p.submission.period.end, '2026-10-25');
  assert.equal(p.pay.date, '2026-10-30');
  assert.equal(p.pay.period.end, '2026-10-25');
});
test('Mon Oct 26: submission due today; Tue Oct 27: next submission Nov 9, but pay Oct 30 still shows', () => {
  assert.equal(payrollDates(DEFAULT_PAY_PERIOD, '2026-10-26').submission.date, '2026-10-26');
  const tue = payrollDates(DEFAULT_PAY_PERIOD, '2026-10-27');
  assert.equal(tue.submission.date, '2026-11-09');
  assert.equal(tue.pay.date, '2026-10-30');
  assert.equal(tue.pay.period.start, '2026-10-12');
  assert.equal(payrollDates(DEFAULT_PAY_PERIOD, '2026-10-31').pay.date, '2026-11-13');
});
test('submission is always a Monday and the pay date a Friday', () => {
  for (let i = 0; i < 60; i++) {
    const day = addDaysToronto('2026-10-01', i);
    const p = payrollDates(DEFAULT_PAY_PERIOD, day);
    assert.equal(new Date(p.submission.date + 'T12:00:00Z').getUTCDay(), 1, day);
    assert.equal(new Date(p.pay.date + 'T12:00:00Z').getUTCDay(), 5, day);
  }
});
test('the server reminder computes the same submission date, every day for a year', () => {
  for (let i = 0; i < 366; i++) {
    const day = addDaysToronto('2026-07-06', i);
    const c = payrollDates(DEFAULT_PAY_PERIOD, day).submission;
    const s = payrollSubmissionDue(DEFAULT_PAY_PERIOD, day);
    assert.equal(s.date, c.date, day);
    assert.equal(s.periodEnd, c.period.end, day);
  }
});
test('reminders: the morning before and the morning of — nothing else', () => {
  assert.deepEqual(payrollAlertsDue(DEFAULT_PAY_PERIOD, '2026-10-24'), []);
  const before = payrollAlertsDue(DEFAULT_PAY_PERIOD, '2026-10-25');
  assert.equal(before[0].title, 'Payroll submission due tomorrow (Monday, Oct 26)');
  assert.equal(before[0].marker, 'payroll-submit-2026-10-26-daybefore');
  const dayOf = payrollAlertsDue(DEFAULT_PAY_PERIOD, '2026-10-26');
  assert.equal(dayOf[0].title, 'Payroll submission due today (Monday, Oct 26)');
  assert.equal(dayOf[0].body, 'For 2026-10-12 – 2026-10-25. Pay date Friday, Oct 30.');
  assert.deepEqual(payrollAlertsDue(DEFAULT_PAY_PERIOD, '2026-10-27'), []);
});
test('across the November clock change: Oct 26 – Nov 8, submit Mon Nov 9, pay Fri Nov 13', () => {
  const p = payrollDates(DEFAULT_PAY_PERIOD, '2026-11-02');
  assert.deepEqual([p.submission.period.start, p.submission.period.end, p.submission.date, p.pay.date], ['2026-10-26', '2026-11-08', '2026-11-09', '2026-11-13']);
  const w = payrollDates(DEFAULT_PAY_PERIOD, '2027-01-12');
  assert.deepEqual([w.submission.period.start, w.submission.period.end], ['2027-01-04', '2027-01-17']);
});
test('colours: red on the day, amber within 2 days', () => {
  assert.deepEqual([0, 1, 2, 3].map(submissionTone), ['red', 'amber', 'amber', 'none']);
});

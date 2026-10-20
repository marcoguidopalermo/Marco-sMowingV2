// Pay periods across daylight-saving changes (the bug fixed 2026-10-20).
//   npx vitest run src/lib/payPeriods
import { test } from 'vitest';
import assert from 'node:assert/strict';

// The bug only shows on a clock with DST; run on Toronto's whatever the machine.
process.env.TZ = 'America/Toronto';

import { periodOfYmd, periodAt, periodForDate, currentPayPeriod, previousPayPeriod, stepPeriod, periodRangeLabel, payDateLabel, DEFAULT_PAY_PERIOD as C } from './payPeriods';
import { payrollDates } from './office/payroll';
import { payrollSubmissionDue } from '../../functions/src/officeDeadlinesCore';

const wd = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const at = (ymd: string, h: number, m = 0) => { const [y, mo, d] = ymd.split('-').map(Number); return new Date(y, mo - 1, d, h, m).getTime(); };

test('runs on a DST clock', () => {
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, 'America/Toronto');
  assert.notEqual(new Date(2026, 6, 1).getTimezoneOffset(), new Date(2026, 11, 1).getTimezoneOffset());
});

test('the current period is unchanged: Oct 12–25, submit Mon Oct 26, pay Fri Oct 30', () => {
  const p = periodOfYmd('2026-10-20', C);
  assert.deepEqual([p.start, p.end, p.submissionDate, p.payDate], ['2026-10-12', '2026-10-25', '2026-10-26', '2026-10-30']);
  assert.equal(p.startMs, at('2026-10-12', 0));
  assert.equal(p.endMs, at('2026-10-25', 23, 59) + 59_999);
  assert.equal(periodRangeLabel(p), 'Oct 12 – Oct 25');
  assert.equal(payDateLabel(p), 'Oct 30');
});

test('the next three periods: Monday to Sunday, submit Monday, pay Friday', () => {
  const got = ['2026-10-26', '2026-11-09', '2026-11-23'].map(d => { const p = periodOfYmd(d, C); return [p.start, p.end, p.submissionDate, p.payDate]; });
  assert.deepEqual(got, [
    ['2026-10-26', '2026-11-08', '2026-11-09', '2026-11-13'],
    ['2026-11-09', '2026-11-22', '2026-11-23', '2026-11-27'],
    ['2026-11-23', '2026-12-06', '2026-12-07', '2026-12-11'],
  ]);
});

test('every period 2026–2028: Mon→Sun, submit Mon, pay Fri; back to back, no gaps or overlaps', () => {
  const first = periodOfYmd('2026-01-01', C).index, last = periodOfYmd('2028-12-31', C).index;
  for (let i = first; i <= last; i++) {
    const p = periodAt(i, C), n = periodAt(i + 1, C);
    assert.equal(wd(p.start), 1, p.start); assert.equal(wd(p.end), 0, p.end);
    assert.equal(wd(p.submissionDate), 1, p.submissionDate); assert.equal(wd(p.payDate), 5, p.payDate);
    assert.equal(n.startMs, p.endMs + 1, `${p.end} → ${n.start}`);            // the next starts 1 ms after this ends
    assert.equal(new Date(p.startMs).getHours(), 0); assert.equal(new Date(p.endMs).getHours(), 23);
  }
});

test('Sun Nov 8 2026 and Sun Mar 14 2027 each land in exactly one period — at any hour', () => {
  for (const day of ['2026-11-01', '2026-11-08', '2027-03-14', '2027-03-15']) {
    for (const [h, m] of [[0, 0], [1, 30], [3, 30], [12, 0], [23, 59]]) {
      const t = at(day, h, m);
      const holders = [-2, -1, 0, 1].map(k => periodAt(periodOfYmd(day, C).index + k, C)).filter(p => t >= p.startMs && t <= p.endMs);
      assert.equal(holders.length, 1, `${day} ${h}:${m}`);
      assert.equal(periodForDate(t, C).start, holders[0].start);
    }
  }
  assert.equal(periodOfYmd('2026-11-08', C).start, '2026-10-26');
  assert.equal(periodOfYmd('2027-03-14', C).end, '2027-03-14');
});

test('hours totals across Nov 1 and Mar 14 count every punch exactly once', () => {
  // A punch every 30 minutes from Oct 1 2026 to Apr 1 2027, summed the way
  // TimeMaster does (clock-in within startMs..endMs) over consecutive periods.
  const from = at('2026-10-01', 0), to = at('2027-04-01', 0);
  const punches: number[] = [];
  for (let t = from; t < to; t += 30 * 60_000) punches.push(t);
  const periods = [];
  for (let i = periodOfYmd('2026-10-01', C).index; i <= periodOfYmd('2027-03-31', C).index; i++) periods.push(periodAt(i, C));
  const counts = new Map<number, number>();
  for (const p of periods) for (const t of punches) if (t >= p.startMs && t <= p.endMs) counts.set(t, (counts.get(t) || 0) + 1);
  assert.equal(counts.size, punches.length, 'every punch counted');
  assert.ok([...counts.values()].every(c => c === 1), 'none counted twice');
});

test('next / previous arrows step through November and March without sticking', () => {
  let p = periodOfYmd('2026-10-12', C); const fwd = [p.start];
  for (let i = 0; i < 12; i++) { p = stepPeriod(p, C, 1); fwd.push(p.start); }
  assert.deepEqual(fwd.slice(0, 4), ['2026-10-12', '2026-10-26', '2026-11-09', '2026-11-23']);
  assert.equal(new Set(fwd).size, fwd.length);
  assert.ok(fwd.includes('2027-03-01') && fwd.includes('2027-03-15'));
  let b = periodOfYmd('2027-03-20', C); const back = [b.start];
  for (let i = 0; i < 12; i++) { b = stepPeriod(b, C, -1); back.push(b.start); }
  assert.deepEqual(back.slice(0, 3), ['2027-03-15', '2027-03-01', '2027-02-15']);
  assert.ok(back.includes('2026-10-26'));
  assert.equal(stepPeriod(stepPeriod(periodOfYmd('2026-11-01', C), C, 1), C, -1).start, '2026-10-26');
});

test("TimeMaster's Payroll and Current periods on sample mornings", () => {
  const lens = (d: string) => { const t = at(d, 9); const v = previousPayPeriod(C, t), c = currentPayPeriod(C, t); return `${v.start}..${v.end}|${c.start}..${c.end}`; };
  assert.equal(lens('2026-10-20'), '2026-09-28..2026-10-11|2026-10-12..2026-10-25');
  assert.equal(lens('2026-10-26'), '2026-10-12..2026-10-25|2026-10-26..2026-11-08');
  assert.equal(lens('2026-11-09'), '2026-10-26..2026-11-08|2026-11-09..2026-11-22');
  assert.equal(lens('2026-11-23'), '2026-11-09..2026-11-22|2026-11-23..2026-12-06');
  assert.equal(lens('2027-03-15'), '2027-03-01..2027-03-14|2027-03-15..2027-03-28');
});

test('OfficeMaster, TimeMaster and the server reminder agree, every day for a year', () => {
  for (let i = 0; i < 366; i++) {
    const day = periodAt(0, C).start; // 2026-07-06
    const d = new Date(at(day, 9)); d.setDate(d.getDate() + i);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const office = payrollDates(C, ymd).submission.period;
    const t = d.getTime();
    const tm = [previousPayPeriod(C, t), currentPayPeriod(C, t)];
    // Office's submission period is exactly TimeMaster's Payroll or Current period that morning.
    assert.ok(tm.some(p => p.start === office.start && p.end === office.end && p.payDate === office.payDate), ymd);
    const srv = payrollSubmissionDue(C, ymd);
    assert.equal(srv.date, office.submissionDate, ymd);
    assert.equal(srv.payDate, office.payDate, ymd);
  }
});

test('a custom anchor / length keeps working', () => {
  const cfg = { anchorStart: '2026-01-05', lengthDays: 7, payLagDays: 3 };
  const p = periodOfYmd('2026-11-04', cfg);
  assert.deepEqual([p.start, p.end, p.payDate], ['2026-11-02', '2026-11-08', '2026-11-11']);
});

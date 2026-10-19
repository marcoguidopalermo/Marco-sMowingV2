// A dealer equipment loan (made-up figures — see mowerLoan.fixture.ts) and
// the "what's left" bars it produces.
//   npx vitest run src/lib/finance/mowerLoan
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildSchedule } from './schedule';
import { agreementFigures, validateAgreement, whatsLeft, unitWhatsLeft } from './calc';
import { MOWER_LOAN } from './mowerLoan.fixture';
import { dollars as $ } from './money';

const TODAY = '2026-10-19';

test('36 payments of $2,366, Jun 2 2025 – May 2 2028, no HST, no residual', () => {
  const s = buildSchedule(MOWER_LOAN);
  assert.equal(s.length, 36);
  assert.equal(s[0].date, '2025-06-02');
  assert.equal(s[35].date, '2028-05-02');
  assert.ok(s.every(p => p.kind === 'regular' && p.total === $(2_366) && p.tax === 0));
});
test('on Oct 19 2026: 17 of 36 made, $40,222 paid, $44,954 owing', () => {
  const f = agreementFigures(MOWER_LOAN, TODAY);
  assert.equal(f.displayStatus, 'financed');
  assert.equal(f.paymentsMade, 17);
  assert.equal(f.paymentsRemaining, 19);
  assert.equal(f.paidTotal, $(40_222));
  assert.equal(f.remainingTotal, $(44_954));
  assert.equal(f.balance, $(44_954));
  assert.equal(f.balanceSource, 'remaining_payments');
  assert.equal(f.costOfBorrowing, 0);
  assert.equal(f.nextPayment?.date, '2026-11-02');
});
test('the bar: trade-ins $24,000 · paid $40,222 · owing $44,954 · $26.01 not scheduled', () => {
  const f = agreementFigures(MOWER_LOAN, TODAY);
  const bar = whatsLeft(MOWER_LOAN, f, TODAY);
  assert.deepEqual(
    [bar.down, bar.paid, bar.owing, bar.residual, bar.unscheduled, bar.total, bar.made, bar.count],
    [$(24_000), $(40_222), $(44_954), 0, $(26.01), $(109_202.01), 17, 36],
  );
});
test('allocations follow purchase price and add up to the financed amount exactly', () => {
  const alloc = MOWER_LOAN.assets.map(x => x.allocatedValue);
  assert.equal(alloc.reduce((s, x) => s + x, 0), $(85_202.01));
  assert.ok(Math.abs(alloc[4] - alloc[5]) <= 1); // the identical pair (rounding cent)
});
test('per-unit bars add up close to the agreement bar; the sold unit keeps its share', () => {
  const f = agreementFigures(MOWER_LOAN, TODAY);
  const bar = whatsLeft(MOWER_LOAN, f, TODAY);
  const units = MOWER_LOAN.assets.map(x => unitWhatsLeft(MOWER_LOAN, bar, x));
  const sum = units.reduce((s, u) => s + u.total, 0);
  assert.ok(Math.abs(sum - bar.total) <= 7, `${sum} vs ${bar.total}`);
  assert.ok(units[6].owing > 0); // sold, still on the agreement, still being paid for
});
test('checks: the 1¢ gap and the unknown sale date are flagged; nothing blocks the save', () => {
  const issues = validateAgreement(MOWER_LOAN);
  assert.equal(issues.filter(i => i.level === 'error').length, 0);
  assert.ok(issues.some(i => /financed amount is 85202.01/.test(i.message)));
  assert.ok(issues.some(i => /Front loader.*date not entered/.test(i.message)));
});

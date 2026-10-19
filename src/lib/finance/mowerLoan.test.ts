// The April 2025 Kubota mower loan (quote #2001190, Apr 9 2025 + bank
// payments) — the agreement as proposed to Marco on 2026-10-19, and the
// "what's left" bars it produces.
//   npx vitest run src/lib/finance/mowerLoan
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildSchedule } from './schedule';
import { agreementFigures, validateAgreement, whatsLeft, unitWhatsLeft } from './calc';
import { MOWER_LOAN } from './mowerLoan.fixture';
import { dollars as $ } from './money';

const TODAY = '2026-10-19';

test('36 payments of $2,805.54, Jun 2 2025 – May 2 2028, no HST, no residual', () => {
  const s = buildSchedule(MOWER_LOAN);
  assert.equal(s.length, 36);
  assert.equal(s[0].date, '2025-06-02');
  assert.equal(s[35].date, '2028-05-02');
  assert.ok(s.every(p => p.kind === 'regular' && p.total === $(2_805.54) && p.tax === 0));
});
test('on Oct 19 2026: 17 of 36 made, $47,694.18 paid, $53,305.26 owing', () => {
  const f = agreementFigures(MOWER_LOAN, TODAY);
  assert.equal(f.displayStatus, 'financed');
  assert.equal(f.paymentsMade, 17);
  assert.equal(f.paymentsRemaining, 19);
  assert.equal(f.paidTotal, $(47_694.18));
  assert.equal(f.remainingTotal, $(53_305.26));
  assert.equal(f.balance, $(53_305.26));
  assert.equal(f.balanceSource, 'remaining_payments');
  assert.equal(f.costOfBorrowing, 0);
  assert.equal(f.nextPayment?.date, '2026-11-02');
});
test('the bar: trade-ins $30,500 · paid $47,694.18 · owing $53,305.26 · $35.55 not scheduled', () => {
  const f = agreementFigures(MOWER_LOAN, TODAY);
  const bar = whatsLeft(MOWER_LOAN, f, TODAY);
  assert.deepEqual(
    [bar.down, bar.paid, bar.owing, bar.residual, bar.unscheduled, bar.total, bar.made, bar.count],
    [$(30_500), $(47_694.18), $(53_305.26), 0, $(35.55), $(131_534.99), 17, 36],
  );
});
test('allocations follow purchase price and add up to the financed amount exactly', () => {
  assert.equal(MOWER_LOAN.assets.map(x => x.allocatedValue).reduce((s, x) => s + x, 0), $(101_034.99));
  assert.ok(Math.abs(MOWER_LOAN.assets[4].allocatedValue - MOWER_LOAN.assets[5].allocatedValue) <= 1); // the identical SZ22-48s (rounding cent)
});
test('per-unit bars add up close to the agreement bar', () => {
  const f = agreementFigures(MOWER_LOAN, TODAY);
  const bar = whatsLeft(MOWER_LOAN, f, TODAY);
  const units = MOWER_LOAN.assets.map(x => unitWhatsLeft(MOWER_LOAN, bar, x));
  const sum = units.reduce((s, u) => s + u.total, 0);
  assert.ok(Math.abs(sum - bar.total) <= 7, `${sum} vs ${bar.total}`);
  if (process.env.SHOW) for (const [i, u] of units.entries()) console.log(MOWER_LOAN.assets[i].labelSnapshot, MOWER_LOAN.assets[i].allocatedValue / 100, u.down / 100, u.paid / 100, u.owing / 100, u.total / 100);
});
test('checks: the 1¢ quote gap and the unknown sale date are flagged; nothing blocks the save', () => {
  const issues = validateAgreement(MOWER_LOAN);
  assert.equal(issues.filter(i => i.level === 'error').length, 0);
  assert.ok(issues.some(i => /financed amount is 101034.99/.test(i.message)));
  assert.ok(issues.some(i => /LA1055.*date not entered/.test(i.message)));
});

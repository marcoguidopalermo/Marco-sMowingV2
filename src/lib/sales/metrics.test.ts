// Sales scoreboard figures — made-up quotes.
//   npx vitest run src/lib/sales
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { quoteMetrics, chaseList, leadMetrics, residentialSnow, commercialSnow, weeklyTrend, quoteTrendPoints, progressLine, salespeople, type QuoteRow, type SnowEntry } from './metrics';
import { rangeFor, weeksOf, snowSeasonFor, snowSeasonLabel, torontoYmd } from './periods';

const Q = (n: string, s: string, sent: string | null, sub: number, extra: Partial<QuoteRow> = {}): QuoteRow => ({
  id: 'q' + n, n, s, t: 'Job ' + n, c: sent || '2026-10-01T14:00:00Z', sent, viewed: null, appr: null, conv: null,
  sub, tot: Math.round(sub * 1.13 * 100) / 100, cl: 'Client ' + n, sp: 'James', url: '', ...extra,
});
const OCT = { from: '2026-10-01', to: '2026-10-31' };
const rows: QuoteRow[] = [
  Q('1', 'converted', '2026-10-02T15:00:00Z', 1000, { appr: '2026-10-04T15:00:00Z' }),
  Q('2', 'approved', '2026-10-05T15:00:00Z', 3000, { appr: '2026-10-06T15:00:00Z' }),
  Q('3', 'archived', '2026-10-06T15:00:00Z', 500),
  Q('4', 'awaiting_response', '2026-10-07T15:00:00Z', 2000, { viewed: '2026-10-08T12:00:00Z' }),
  Q('5', 'awaiting_response', '2026-10-15T15:00:00Z', 9000),
  Q('6', 'changes_requested', '2026-10-16T15:00:00Z', 700, { sp: 'Marco' }),
  Q('7', 'draft', null, 400),                                                     // never sent
  Q('8', 'approved', '2026-09-20T15:00:00Z', 800, { appr: '2026-10-02T15:00:00Z' }), // sent Sept, approved Oct
  Q('9', 'awaiting_response', '2026-08-01T15:00:00Z', 150),                       // old, still waiting
  Q('10', 'converted', '2026-10-01T03:30:00Z', 600, { appr: '2026-10-03T15:00:00Z' }), // Sept 30 evening in Toronto
];

test('cohort = quotes SENT in the period (date read off each quote, Toronto)', () => {
  const m = quoteMetrics(rows, OCT);
  assert.equal(torontoYmd('2026-10-01T03:30:00Z'), '2026-09-30');
  assert.equal(m.sent.count, 6);                       // 1–6; not the draft, not Sept sends
  assert.deepEqual([m.won.count, m.won.pre, m.won.incl], [2, 4000, 4520]);
  assert.deepEqual([m.lost.count, m.waiting.count, m.waiting.pre], [1, 3, 11700]);
});
test('average ticket (pre-tax, with tax alongside), win rate on decided quotes, median days', () => {
  const m = quoteMetrics(rows, OCT);
  assert.deepEqual(m.avgTicket, { pre: 2000, incl: 2260 });
  assert.equal(m.winRate, 2 / 3);
  assert.equal(m.medianDaysToApprove, 1.5);           // 2 days and 1 day
});
test('approved in the period by approval date, whatever the send date', () => {
  assert.equal(quoteMetrics(rows, OCT).approvedInPeriod.count, 4); // #1, #2, #8, #10
});
test('salesperson filter', () => {
  assert.equal(quoteMetrics(rows, OCT, 'Marco').sent.count, 1);
  assert.deepEqual(salespeople(rows), ['James', 'Marco']);
});
test('chase list: every waiting quote, oldest first; opened flag; amount sort', () => {
  const c = chaseList(rows, '2026-10-20');
  assert.deepEqual(c.map(x => [x.n, x.daysSinceSent, x.opened]), [['9', 80, false], ['4', 13, true], ['5', 5, false], ['6', 4, false]]);
  assert.deepEqual(chaseList(rows, '2026-10-20', 'amountDesc').map(x => x.n), ['5', '4', '6', '9']);
});
test('leads: count, how many became quotes, by source', () => {
  const L = leadMetrics([
    { id: 'a', c: '2026-10-03T15:00:00Z', st: 'converted', src: 'internal', q: 1 },
    { id: 'b', c: '2026-10-04T15:00:00Z', st: 'new', src: 'embedded_inline', q: 0 },
    { id: 'c', c: '2026-10-05T15:00:00Z', st: 'converted', src: 'embedded_inline', q: 2 },
    { id: 'd', c: '2026-09-05T15:00:00Z', st: 'new', src: 'internal', q: 0 },
  ], OCT);
  assert.deepEqual([L.count, L.quoted], [3, 2]);
  assert.deepEqual(L.bySource, [{ source: 'Website form', count: 2, quoted: 1 }, { source: 'Entered in Jobber', count: 1, quoted: 1 }]);
});
test('residential snow: contracts, dollars, average; deleted rows ignored', () => {
  const e = (date: string, contracts: number, dollars: number, x: Partial<SnowEntry> = {}): SnowEntry => ({ id: date + contracts, date, season: '2026/2027', contracts, dollars, source: 'manual', ...x });
  const f = residentialSnow([e('2026-10-05', 10, 6500), e('2026-10-06', 5, 3750), e('2026-10-07', 3, 1, { deletedAt: 1 })], OCT, '2026/2027');
  assert.deepEqual(f, { contracts: 15, dollars: 10250, avgTicket: 683.33 });
});
test('commercial snow: approved/booked only, valued at the chosen level', () => {
  const c = (status: string, level: number | null, seasonal: number, at = '2026-10-10T15:00:00Z') => ({ status, season: '2026/2027', serviceLevel: level, pricing: { levels: { [String(level || 1)]: { seasonal } } }, approvedAt: at });
  const f = commercialSnow([c('booked', 2, 12000), c('approved', 1, 8000), c('sent', 1, 5000), c('approved', null, 9000)], OCT, '2026/2027');
  assert.deepEqual(f, { contracts: 3, dollars: 20000, avgTicket: 6666.67, noLevel: 1 });
});
test('weekly trend: Monday weeks, contracts and average ticket', () => {
  const t = weeklyTrend(quoteTrendPoints(rows), { from: '2026-09-28', to: '2026-10-11' }, 2);
  assert.deepEqual(t.map(w => [w.from, w.contracts, w.avgTicket]), [['2026-09-28', 3, 800], ['2026-10-05', 1, 3000]]);
});
test('periods and progress line', () => {
  assert.deepEqual(rangeFor('week', '2026-10-20'), { from: '2026-10-19', to: '2026-10-25' });
  assert.deepEqual(rangeFor('month', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(rangeFor('season', '2026-10-20'), { from: '2026-04-01', to: '2026-11-30' });
  assert.equal(weeksOf({ from: '2026-10-20', to: '2026-10-20' }, 8).length, 8);
  assert.equal(snowSeasonFor('2026-10-20'), '2026/2027');
  assert.equal(snowSeasonFor('2027-02-01'), '2026/2027');
  assert.equal(snowSeasonLabel('2026/2027'), 'Snow 2026–27');
  assert.equal(progressLine({ contracts: 212, dollars: 145008, avgTicket: 684 }, { contracts: 300, avgTicket: 650 }), '212 of 300 contracts · avg $684 vs $650 target');
});

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildSnapshot, sanityFlags, changeLine, staleness, residentialFigures, snapshotTrendPoints, avgTicket, latestSnapshot, type SnowSnapshot } from './snapshots';
import type { SnowEntry } from './metrics';

const S = (date: string, contracts: number, totalValue: number, savedAt = Date.parse(`${date}T11:30:00Z`)): SnowSnapshot => ({ date, season: '2026/2027', contracts, totalValue, enteredBy: 'Agent', source: 'agent', savedAt });
const all = [S('2026-10-18', 340, 244000), S('2026-10-19', 353, 253534), S('2026-10-20', 357, 256404)];

test('average ticket and change since yesterday', () => {
  assert.equal(avgTicket(all[2]), 718.22);
  assert.equal(changeLine(all[2], all), '+4 contracts, +$2,870 since yesterday');
  assert.equal(changeLine(all[2], [all[0], all[2]]), '+17 contracts, +$12,404 since Oct 18');
  assert.equal(changeLine(all[0], all), null);
});
test('sanity check: drops and implausible jumps flagged; ordinary growth not', () => {
  assert.deepEqual(sanityFlags({ contracts: 361, totalValue: 259000 }, all[2]), []);
  assert.match(sanityFlags({ contracts: 350, totalValue: 256404 }, all[2])[0], /Contracts went DOWN: 357 → 350/);
  assert.match(sanityFlags({ contracts: 357, totalValue: 250000 }, all[2])[0], /Total value went DOWN/);
  assert.ok(sanityFlags({ contracts: 460, totalValue: 330000 }, all[2]).some(f => /Unusual jump: \+103 contracts/.test(f)));
  assert.ok(sanityFlags({ contracts: 360, totalValue: 300000 }, all[2]).some(f => /Unusual jump: \+\$43,596/.test(f)));
  assert.deepEqual(sanityFlags({ contracts: 30, totalValue: 30000 }, null), []);
});
test('one per day: a second entry the same day replaces the first, kept in history', () => {
  const again = buildSnapshot({ date: '2026-10-20', season: '2026/2027', contracts: 358, totalValue: 257000, enteredBy: 'Marco', source: 'manual' }, all, 5);
  assert.deepEqual([again.contracts, again.totalValue, again.source], [358, 257000, 'manual']);
  assert.deepEqual(again.history, [{ contracts: 357, totalValue: 256404, enteredBy: 'Agent', source: 'agent', at: all[2].savedAt }]);
  assert.deepEqual(again.flags, []);                                        // compared with Oct 19, not with itself
});
test('staleness: over 26 hours is stale', () => {
  assert.deepEqual(staleness(all[2], all[2].savedAt + 25 * 3_600_000), { hours: 25, stale: false });
  assert.deepEqual(staleness(all[2], all[2].savedAt + 27 * 3_600_000), { hours: 27, stale: true });
});
test('residential figures come from snapshots when they exist — never added to daily entries', () => {
  const entries: SnowEntry[] = [{ id: 'e', date: '2026-10-20', season: '2026/2027', contracts: 5, dollars: 3000, source: 'manual' }];
  assert.deepEqual(residentialFigures(all, entries, null, '2026/2027'), { contracts: 357, dollars: 256404, avgTicket: 718.22, source: 'snapshots' });
  assert.deepEqual(residentialFigures([], entries, null, '2026/2027'), { contracts: 5, dollars: 3000, avgTicket: 600, source: 'entries' });
  // in a range: last snapshot in the range minus the one before it
  assert.deepEqual(residentialFigures(all, entries, { from: '2026-10-19', to: '2026-10-20' }, '2026/2027'), { contracts: 17, dollars: 12404, avgTicket: 729.65, source: 'snapshots' });
  assert.deepEqual(residentialFigures(all, entries, { from: '2026-10-01', to: '2026-10-31' }, '2026/2027'), { contracts: 357, dollars: 256404, avgTicket: 718.22, source: 'snapshots' });
});
test('trend points are day-to-day differences; the first snapshot is the baseline', () => {
  assert.deepEqual(snapshotTrendPoints(all, '2026/2027'), [{ date: '2026-10-19', contracts: 13, dollars: 9534 }, { date: '2026-10-20', contracts: 4, dollars: 2870 }]);
  assert.equal(latestSnapshot(all)!.date, '2026-10-20');
});

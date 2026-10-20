// OfficeMaster: fleet compliance rows and company deadlines.
//   npx vitest run src/lib/office
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { FleetItem } from '../../types';
import { fleetCompliance, requiredChecks } from './compliance';
import { addToYmd, completeDeadline, dueTone, dueLabel, sortDeadlines, SEED_DEADLINES, type OfficeDeadline } from './deadlines';
import { formatTodayInToronto, addDaysToronto } from '../dateUtils';

const T = formatTodayInToronto();
const plus = (n: number) => addDaysToronto(T, n);
const unit = (o: Partial<FleetItem> & { id: string }): FleetItem => ({ name: o.id, type: 'truck', status: 'Active', weightClass: '', repairTags: [], ...o } as FleetItem);

test('compliance: soonest first, same thresholds as the renewals strip', () => {
  const fleet = [
    unit({ id: 'a', regExpiry: plus(40) }),
    unit({ id: 'b', regExpiry: plus(-3) }),
    unit({ id: 'c', type: 'trailer', regExpiry: plus(10) }),
  ];
  const { rows } = fleetCompliance(fleet);
  assert.deepEqual(rows.map(r => [r.unit.id, r.state]), [['b', 'expired'], ['c', 'expiring'], ['a', 'ok']]);
  assert.equal(rows[1].countdown, 'expires in 10 days');
});
test('compliance: units with no date are listed, retired units are not', () => {
  const fleet = [
    unit({ id: 'nodate' }),
    unit({ id: 'sold', disposal: { kind: 'sold', date: '2026-10-01' } }),
    unit({ id: 'mower', type: 'equipment' }),
  ];
  const { rows, missing } = fleetCompliance(fleet);
  assert.equal(rows.length, 0);
  assert.deepEqual(missing.map(m => [m.unit.id, m.key]), [['nodate', 'registration']]);
});
test('compliance: safety required for heavy trucks and yellow-sticker trailers; read from commercialSafetyExpire', () => {
  const heavy = unit({ id: 'h', registeredGrossWeight: 8000 });
  assert.deepEqual(requiredChecks(heavy), ['registration', 'safety']);
  assert.deepEqual(requiredChecks(unit({ id: 't', type: 'trailer', isYellowSticker: true })), ['registration', 'safety']);
  assert.deepEqual(requiredChecks(unit({ id: 'l', registeredGrossWeight: 2500 })), ['registration']);
  const { rows, missing } = fleetCompliance([{ ...heavy, regExpiry: plus(100), commercialSafetyExpire: plus(5) } as FleetItem]);
  assert.deepEqual(rows.map(r => r.key), ['safety', 'registration']);
  assert.equal(missing.length, 0);
});

const item = (o: Partial<OfficeDeadline> = {}): OfficeDeadline => ({ id: 'od-1', kind: 'deadline', title: 'CVOR renewal', category: 'cvor', dueDate: '2026-11-30', status: 'open', ...o });
test('recurring: done creates the next occurrence; one-offs do not', () => {
  const { done, next } = completeDeadline(item({ recurrence: { every: 1, unit: 'year' }, reference: 'CVOR-1', documents: [{} as never] }), 'Dave', 1000);
  assert.equal(done.status, 'done');
  assert.equal(done.nextId, next!.id);
  assert.equal(next!.dueDate, '2027-11-30');
  assert.equal(next!.reference, 'CVOR-1');
  assert.deepEqual(next!.documents, []);
  assert.equal(next!.seriesId, 'od-1');
  assert.equal(completeDeadline(item(), 'Dave').next, null);
  assert.equal(completeDeadline(item({ recurrence: { every: 1, unit: 'month' }, dueDate: null }), 'Dave').next, null);
});
test('monthly remittance on the 31st clamps; yearly over a leap day clamps', () => {
  assert.equal(addToYmd('2026-01-31', { every: 1, unit: 'month' }), '2026-02-28');
  assert.equal(addToYmd('2028-02-29', { every: 1, unit: 'year' }), '2029-02-28');
  assert.equal(addToYmd('2026-12-15', { every: 1, unit: 'month' }), '2027-01-15');
});
test('colours and labels match the renewals strip', () => {
  assert.equal(dueTone(-1), 'red'); assert.equal(dueTone(0), 'amber'); assert.equal(dueTone(30), 'amber'); assert.equal(dueTone(31), 'none'); assert.equal(dueTone(null), 'none');
  assert.equal(dueLabel(-2), '2 days overdue'); assert.equal(dueLabel(1), 'Due in 1 day'); assert.equal(dueLabel(null), 'No date yet');
});
test('sorting: dated open soonest first, undated separately, done collapse, deleted hidden', () => {
  const s = sortDeadlines([item({ id: 'b', dueDate: '2027-01-01' }), item({ id: 'a' }), item({ id: 'n', dueDate: null }), item({ id: 'd', status: 'done', doneAt: 5 }), item({ id: 'x', deletedAt: 1 })]);
  assert.deepEqual([s.open.map(x => x.id), s.noDate.map(x => x.id), s.done.map(x => x.id)], [['a', 'b'], ['n'], ['d']]);
});
test('seeds: four suggestions, no dates', () => {
  assert.deepEqual(SEED_DEADLINES.map(s => s.title), ['CVOR renewal', 'Commercial insurance renewal', 'WSIB clearance certificate', 'Payroll tax remittance']);
});

// Tests for multiple tenancies per unit, and for mortgages.
//   npm test -- propertyMultiTenancy
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  allTenancyRows, leasesNeedingAttention, splitTenancy, unitHeadlineCountdown,
  unitIsVacant, unitStatus, unitTenancies,
} from './propertyMgmt';
import {
  canSeeMortgages, mortgageAuditDiff, mortgageRollup, mortgagesForProperty,
  renewalCountdown, RENEWAL_AMBER_DAYS,
} from './mortgages';
import type { ContractingMortgage, ContractingTenancy, ContractingUnit } from '../types';

const NOW = new Date('2026-08-24T12:00:00').getTime();
const inDays = (n: number) => {
  const d = new Date(NOW + n * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ten = (o: Partial<ContractingTenancy> & { id: string }): ContractingTenancy => ({
  status: 'fixed_term', tenants: [{ name: 'A' }], ...o,
} as ContractingTenancy);
const unit = (o: Partial<ContractingUnit> = {}): ContractingUnit =>
  ({ id: 'u1', name: 'Main Floor', ...o } as ContractingUnit);

console.log('\nThe legacy singular field still reads');
test('a unit written with tenancy? reads as one tenancy', () => {
  const u = unit({ tenancy: ten({ id: 't1' }) });
  assert.equal(unitTenancies(u).length, 1);
  assert.equal(unitTenancies(u)[0].id, 't1');
  assert.equal(unitIsVacant(u), false);
});
test('a unit with tenancies[] reads those, and the array wins', () => {
  const u = unit({ tenancies: [ten({ id: 'a' }), ten({ id: 'b' })], tenancy: ten({ id: 'old' }) });
  assert.deepEqual(unitTenancies(u).map(t => t.id), ['a', 'b']);
});
test('empty array and no field alike are vacant', () => {
  assert.equal(unitIsVacant(unit({ tenancies: [] })), true);
  assert.equal(unitIsVacant(unit()), true);
});

console.log('\nThree status states');
test('no tenancies is vacant', () => {
  assert.equal(unitStatus(unit(), NOW), 'vacant');
});
test('all running and none near the end is let', () => {
  const u = unit({ tenancies: [ten({ id: 'a', leaseEnd: inDays(300) }), ten({ id: 'b', leaseEnd: inDays(200) })] });
  assert.equal(unitStatus(u, NOW), 'let');
});
test('one expiring while another continues is partly turning over', () => {
  const u = unit({ tenancies: [ten({ id: 'a', leaseEnd: inDays(30) }), ten({ id: 'b', leaseEnd: inDays(300) })] });
  assert.equal(unitStatus(u, NOW), 'turning');
});
test('an expired lease alongside a running one is still turning, not vacant', () => {
  const u = unit({ tenancies: [ten({ id: 'a', leaseEnd: inDays(-10) }), ten({ id: 'b', leaseEnd: inDays(300) })] });
  assert.equal(unitStatus(u, NOW), 'turning');
  assert.equal(unitIsVacant(u), false);
});
test('a scheduled move-out turns the unit even when far off', () => {
  const u = unit({ tenancies: [ten({ id: 'a', moveOutAt: inDays(200) }), ten({ id: 'b', leaseEnd: inDays(300) })] });
  assert.equal(unitStatus(u, NOW), 'turning');
});
test('month-to-month alone is let — no end date, nothing pending', () => {
  assert.equal(unitStatus(unit({ tenancies: [ten({ id: 'a', status: 'month_to_month' })] }), NOW), 'let');
});

console.log('\nThe headline countdown is the SOONEST expiry');
test('the earliest end wins', () => {
  const u = unit({ tenancies: [ten({ id: 'a', leaseEnd: inDays(300) }), ten({ id: 'b', leaseEnd: inDays(30) })] });
  assert.equal(unitHeadlineCountdown(u, NOW)?.daysLeft, 30);
});
test('a month-to-month tenancy never becomes the headline', () => {
  const u = unit({ tenancies: [ten({ id: 'm', status: 'month_to_month' }), ten({ id: 'f', leaseEnd: inDays(90) })] });
  assert.equal(unitHeadlineCountdown(u, NOW)?.daysLeft, 90);
});
test('a unit with no dated tenancy has no headline rather than a wrong one', () => {
  assert.equal(unitHeadlineCountdown(unit({ tenancies: [ten({ id: 'm', status: 'month_to_month' })] }), NOW), undefined);
  assert.equal(unitHeadlineCountdown(unit(), NOW), undefined);
});

console.log('\nAttention rows name the LEASE, not just the unit');
const PROPS = [{
  id: 'p1', name: '1391 Balmoral',
  units: [unit({
    id: 'lower', name: 'Lower Unit',
    tenancies: [
      ten({ id: 't-maaz', leaseEnd: inDays(12), tenants: [{ name: 'Maaz', main: true }] }),
      ten({ id: 't-berkay', leaseEnd: inDays(300), tenants: [{ name: 'Berkay Ersim' }] }),
    ],
  })],
}] as any;

test('one row per tenancy, carrying who the lease is with', () => {
  const rows = leasesNeedingAttention(PROPS, NOW);
  assert.equal(rows.length, 1, 'only the one inside the window');
  assert.equal(rows[0].who, 'Maaz');
  assert.equal(rows[0].tenancy.id, 't-maaz');
  assert.equal(rows[0].unit.name, 'Lower Unit');
  assert.equal(rows[0].countdown.daysLeft, 12);
});
test('the continuing lease on the same unit is NOT flagged', () => {
  assert.ok(!leasesNeedingAttention(PROPS, NOW).some(r => r.tenancy.id === 't-berkay'));
});
test('every tenancy appears in allTenancyRows, flagged or not', () => {
  assert.equal(allTenancyRows(PROPS, NOW).length, 2);
});
test('rows sort soonest-first across properties', () => {
  const two = [...PROPS, {
    id: 'p2', name: '333 Ambrose',
    units: [unit({ id: 'main', tenancies: [ten({ id: 'x', leaseEnd: inDays(3), tenants: [{ name: 'Abdel' }] })] })],
  }] as any;
  assert.deepEqual(leasesNeedingAttention(two, NOW).map(r => r.who), ['Abdel', 'Maaz']);
});

console.log('\nSplitting a tenancy');
const THREE = unit({
  id: 'lower', name: 'Lower Unit',
  tenancies: [ten({
    id: 't-shared', leaseEnd: inDays(200),
    tenants: [{ name: 'Maaz' }, { name: 'Berkay Ersim' }, { name: 'Himanshu Sharma' }],
  })],
});
test('the chosen tenants move to a new tenancy, the rest stay', () => {
  const { unit: u, error } = splitTenancy({
    unit: THREE, tenancyId: 't-shared', moveNames: ['Berkay Ersim'],
    newTenancyId: 't-new', nowMs: NOW, by: 'Tony',
  });
  assert.equal(error, undefined);
  const ts = unitTenancies(u);
  assert.equal(ts.length, 2);
  assert.deepEqual(ts[0].tenants.map(t => t.name), ['Maaz', 'Himanshu Sharma']);
  assert.deepEqual(ts[1].tenants.map(t => t.name), ['Berkay Ersim']);
});
test('the new lease carries NO dates — the terms differ, that is why it split', () => {
  const { unit: u } = splitTenancy({
    unit: THREE, tenancyId: 't-shared', moveNames: ['Berkay Ersim'],
    newTenancyId: 't-new', nowMs: NOW, by: 'Tony',
  });
  const created = unitTenancies(u).find(t => t.id === 't-new')!;
  assert.equal(created.leaseEnd, undefined, 'a copied date would assert a term nobody entered');
  assert.equal(created.leaseStart, undefined);
  assert.equal(created.status, 'fixed_term', 'the status is inherited');
});
test('the original keeps its own dates untouched', () => {
  const { unit: u } = splitTenancy({
    unit: THREE, tenancyId: 't-shared', moveNames: ['Berkay Ersim'],
    newTenancyId: 't-new', nowMs: NOW, by: 'Tony',
  });
  assert.equal(unitTenancies(u)[0].leaseEnd, inDays(200));
});
test('both sides are audited with what happened', () => {
  const { unit: u } = splitTenancy({
    unit: THREE, tenancyId: 't-shared', moveNames: ['Berkay Ersim'],
    newTenancyId: 't-new', nowMs: NOW, by: 'Tony',
  });
  const ts = unitTenancies(u);
  assert.match(ts[0].audit!.at(-1)!.action, /split out Berkay Ersim/);
  assert.match(ts[1].audit!.at(-1)!.action, /split from tenancy t-shared/);
});
test('splitting out everybody is refused — a lease needs somebody on it', () => {
  const r = splitTenancy({
    unit: THREE, tenancyId: 't-shared',
    moveNames: ['Maaz', 'Berkay Ersim', 'Himanshu Sharma'],
    newTenancyId: 't-new', nowMs: NOW, by: 'Tony',
  });
  assert.match(r.error!, /must stay on the original/);
});
test('splitting out nobody is refused', () => {
  const r = splitTenancy({ unit: THREE, tenancyId: 't-shared', moveNames: [], newTenancyId: 'x', nowMs: NOW, by: 'T' });
  assert.match(r.error!, /at least one tenant/i);
});
test('an unknown tenancy is refused rather than silently doing nothing', () => {
  const r = splitTenancy({ unit: THREE, tenancyId: 'nope', moveNames: ['Maaz'], newTenancyId: 'x', nowMs: NOW, by: 'T' });
  assert.match(r.error!, /not found/);
});

console.log('\nOne move-out does not disturb the others');
test('setting a move-out on one tenancy leaves the other’s dates alone', () => {
  const u = unit({
    tenancies: [
      ten({ id: 'a', leaseEnd: inDays(100), tenants: [{ name: 'A' }] }),
      ten({ id: 'b', leaseEnd: inDays(300), tenants: [{ name: 'B' }] }),
    ],
  });
  // The move-out edit is a per-tenancy field write; modelled here as the map
  // the UI performs.
  const after: ContractingUnit = {
    ...u,
    tenancies: unitTenancies(u).map(t => (t.id === 'a' ? { ...t, moveOutAt: inDays(30) } : t)),
  };
  const b = unitTenancies(after).find(t => t.id === 'b')!;
  assert.equal(b.leaseEnd, inDays(300));
  assert.equal(b.moveOutAt, undefined);
  assert.equal(unitStatus(after, NOW), 'turning', 'the unit reflects the one that is going');
  assert.equal(unitHeadlineCountdown(after, NOW)?.daysLeft, 30);
});

console.log('\nMortgage access');
test('only Marco and Tony may see mortgages', () => {
  assert.equal(canSeeMortgages('marcoguidopalermo@gmail.com'), true);
  assert.equal(canSeeMortgages('anthonypalermo23@hotmail.com'), true);
  assert.equal(canSeeMortgages(' ANTHONYPALERMO23@HOTMAIL.COM '), true);
});
test('the property manager and the contractor may not — nor other admins', () => {
  for (const e of [
    'palermo@shaw.ca', 'linda@palermoscontracting.com',   // Linda (property manager)
    'kcleupen@lakeheadu.ca',                              // Kris (contractor)
    'office@marcosmowing.com', 'sales@marcosmowing.com',  // Dave and James — admins
    '', null, undefined,
  ]) {
    assert.equal(canSeeMortgages(e as any), false, String(e));
  }
});

console.log('\nRenewal countdown');
const mtg = (o: Partial<ContractingMortgage> = {}): ContractingMortgage =>
  ({ id: 'm1', propertyId: 'p1', lender: 'TD', ...o } as ContractingMortgage);

test(`amber at ${RENEWAL_AMBER_DAYS} days — longer lead than a lease`, () => {
  assert.equal(renewalCountdown(mtg({ termEnd: inDays(RENEWAL_AMBER_DAYS) }), NOW).level, 'amber');
  assert.equal(renewalCountdown(mtg({ termEnd: inDays(RENEWAL_AMBER_DAYS + 1) }), NOW).level, 'neutral');
});
test('red once the term has rolled', () => {
  const c = renewalCountdown(mtg({ termEnd: inDays(-1) }), NOW);
  assert.equal(c.level, 'red');
  assert.match(c.label, /past renewal/);
});
test('no renewal date says so rather than counting from nothing', () => {
  const c = renewalCountdown(mtg(), NOW);
  assert.equal(c.level, 'neutral');
  assert.equal(c.endMs, Infinity);
  assert.match(c.label, /no renewal date/);
});

console.log('\nThe rollup');
const BOOK = [
  mtg({ id: 'a', propertyId: 'p1', currentBalance: 800_000, principal: 900_000, rate: 7, termEnd: inDays(60) }),
  mtg({ id: 'b', propertyId: 'p1', currentBalance: 80_000, principal: 100_000, rate: 2, termEnd: inDays(400) }),
  mtg({ id: 'c', propertyId: 'p2', currentBalance: 200_000, principal: 200_000, rate: 5, termEnd: inDays(200) }),
];
test('totals add up', () => {
  const r = mortgageRollup(BOOK, NOW);
  assert.equal(r.count, 3);
  assert.equal(r.totalBalance, 1_080_000);
  assert.equal(r.totalPrincipal, 1_200_000);
});
test('the rate is weighted BY BALANCE, not a plain mean', () => {
  // (800k×7 + 80k×2 + 200k×5) / 1.08M = 6,760,000 / 1,080,000 = 6.26%.
  // A plain mean would say 4.67%, understating what the debt actually costs.
  const r = mortgageRollup(BOOK, NOW);
  assert.equal(r.weightedRate, 6.26);
  assert.equal(r.ratedBalance, 1_080_000);
});
test('a mortgage with no rate is excluded from the weighting, not counted as zero', () => {
  const r = mortgageRollup([...BOOK, mtg({ id: 'd', currentBalance: 500_000 })], NOW);
  assert.equal(r.weightedRate, 6.26, 'unchanged — it cannot drag the average down');
  assert.equal(r.ratedBalance, 1_080_000, 'and the gap is reported');
  assert.equal(r.totalBalance, 1_580_000);
});
test('renewals inside 12 months only, soonest first', () => {
  const r = mortgageRollup(BOOK, NOW);
  assert.deepEqual(r.renewals.map(x => x.mortgage.id), ['a', 'c']);
});
test('an empty book gives zeroes and a null rate rather than NaN', () => {
  const r = mortgageRollup([], NOW);
  assert.equal(r.totalBalance, 0);
  assert.equal(r.weightedRate, null);
  assert.deepEqual(r.renewals, []);
});
test('per-property lookup sorts by renewal date', () => {
  assert.deepEqual(mortgagesForProperty(BOOK, 'p1').map(m => m.id), ['a', 'b']);
  assert.deepEqual(mortgagesForProperty(BOOK, 'p2').map(m => m.id), ['c']);
});

console.log('\nMortgage audit is field-level');
test('only changed fields are recorded, with from → to', () => {
  const before = mtg({ rate: 4.89, currentBalance: 500_000 });
  const after = mtg({ rate: 5.24, currentBalance: 500_000 });
  const d = mortgageAuditDiff(before, after, 1, 'Tony');
  assert.equal(d.length, 1);
  assert.equal(d[0].field, 'rate');
  assert.equal(d[0].from, '4.89');
  assert.equal(d[0].to, '5.24');
});
test('a new mortgage records its fields as (new)', () => {
  const d = mortgageAuditDiff(undefined, mtg({ rate: 5 }), 1, 'Tony');
  assert.ok(d.every(x => x.from === '(new)'));
  assert.ok(d.some(x => x.field === 'lender' && x.to === 'TD'));
});
test('an unchanged save records nothing', () => {
  const m = mtg({ rate: 5 });
  assert.deepEqual(mortgageAuditDiff(m, m, 1, 'Tony'), []);
});

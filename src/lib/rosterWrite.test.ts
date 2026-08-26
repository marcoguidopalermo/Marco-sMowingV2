// Tests for employee-roster deltas.
//   npm test -- rosterWrite
//
// The roster carries pay rates and the email→person binding, and it rides along
// in ~80 saves that never meant to touch it. These cases are about what a stale
// or incidental save must NOT be able to do to it.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { adminEmailsFrom, computeRosterUpdate } from './rosterWrite';

type E = { id: string; name: string; hourlyRate?: number; linkedUserEmail?: string };

const ROSTER: E[] = [
  { id: 'a', name: 'Al', hourlyRate: 25 },
  { id: 'b', name: 'Bev', hourlyRate: 30 },
  { id: 'c', name: 'Cal', hourlyRate: 28 },
  { id: 'd', name: 'Dee', hourlyRate: 32 },
];
const plan = (o: Partial<Parameters<typeof computeRosterUpdate<E>>[0]> = {}) =>
  computeRosterUpdate<E>({ serverList: ROSTER, baseline: ROSTER, next: ROSTER, ...o });

console.log('\nOrdinary edits');
test('a pay-rate change touches exactly one record', () => {
  const p = plan({ next: ROSTER.map(e => e.id === 'b' ? { ...e, hourlyRate: 35 } : e) });
  assert.deepEqual(p.upserted, ['b']);
  assert.deepEqual(p.removed, []);
  assert.equal(p.finalList.find(e => e.id === 'b')?.hourlyRate, 35);
  assert.equal(p.finalList.length, 4);
});
test('a new hire appends to the end, as "+ Add employee" has always done', () => {
  const p = plan({ next: [...ROSTER, { id: 'e', name: 'Eve' }] });
  assert.deepEqual(p.upserted, ['e']);
  assert.equal(p.finalList.at(-1)?.id, 'e');
});
test('one person leaving removes only them', () => {
  const p = plan({ next: ROSTER.filter(e => e.id !== 'c') });
  assert.deepEqual(p.removed, ['c']);
  assert.ok(!p.finalList.some(e => e.id === 'c'));
  assert.equal(p.finalList.length, 3);
});
test('an edit never reshuffles the directory', () => {
  const p = plan({ next: ROSTER.map(e => e.id === 'a' ? { ...e, name: 'Alan' } : e) });
  assert.deepEqual(p.finalList.map(e => e.id), ['a', 'b', 'c', 'd']);
});
test('a no-op edit reports noop, so the caller can skip the write entirely', () => {
  const p = plan();
  assert.equal(p.noop, true);
  assert.deepEqual(p.upserted, []);
  assert.deepEqual(p.removed, []);
});

console.log('\nWhat a stale screen must not be able to do');
test('THE BUG: a stale screen cannot revert a pay rate it never touched', () => {
  // The admin opened Personnel when Bev was on $30. Meanwhile someone raised
  // her to $40. The admin edits Cal's name and saves.
  const p = plan({
    baseline: ROSTER,
    next: ROSTER.map(e => e.id === 'c' ? { ...e, name: 'Calvin' } : e),
    serverList: ROSTER.map(e => e.id === 'b' ? { ...e, hourlyRate: 40 } : e),
  });
  assert.deepEqual(p.upserted, ['c'], 'only Cal is part of this edit');
  assert.equal(p.finalList.find(e => e.id === 'b')?.hourlyRate, 40, "Bev's raise survives");
  assert.equal(p.finalList.find(e => e.id === 'c')?.name, 'Calvin');
});
test('a stale screen cannot delete somebody hired since it loaded', () => {
  const p = plan({
    baseline: ROSTER,
    next: ROSTER,                                       // unchanged on screen
    serverList: [...ROSTER, { id: 'e', name: 'Eve' }],  // hired meanwhile
  });
  assert.ok(p.finalList.some(e => e.id === 'e'), 'the new hire must survive');
  assert.equal(p.finalList.length, 5);
});
test('two admins editing different people both land', () => {
  const p = plan({
    baseline: ROSTER,
    next: ROSTER.map(e => e.id === 'a' ? { ...e, hourlyRate: 26 } : e),
    serverList: ROSTER.map(e => e.id === 'd' ? { ...e, hourlyRate: 33 } : e),
  });
  assert.equal(p.finalList.find(e => e.id === 'a')?.hourlyRate, 26);
  assert.equal(p.finalList.find(e => e.id === 'd')?.hourlyRate, 33);
});
test('a stale screen cannot unbind an auth account it never edited', () => {
  // linkedUserEmail decides which person a signed-in user IS. Reverting it
  // shows somebody else's pay and time.
  const p = plan({
    baseline: ROSTER,
    next: ROSTER,
    serverList: ROSTER.map(e => e.id === 'a' ? { ...e, linkedUserEmail: 'al@x.test' } : e),
  });
  assert.equal(p.finalList.find(e => e.id === 'a')?.linkedUserEmail, 'al@x.test');
  assert.equal(p.noop, true);
});

console.log('\nRefusals');
test('an edit that empties the roster is refused, server list returned unchanged', () => {
  const p = plan({ next: [] });
  assert.equal(p.refused, 'empty-result');
  assert.deepEqual(p.finalList, ROSTER);
});
test('an edit removing MOST of the roster is refused — that is a defaulted client', () => {
  const p = plan({ next: [ROSTER[0]] });   // 3 of 4 gone
  assert.equal(p.refused, 'mass-removal');
  assert.deepEqual(p.finalList, ROSTER);
  assert.deepEqual(p.removed, ['b', 'c', 'd'], 'the intent is still reported honestly');
});
test('a legitimate layoff of half a small roster is NOT refused', () => {
  // The threshold is "more than half", so two of four still goes through. The
  // guard is for wholesale replacement, not for a bad week.
  const p = plan({ next: [ROSTER[0], ROSTER[1]] });
  assert.equal(p.refused, undefined);
  assert.equal(p.finalList.length, 2);
});
test('the mass-removal test does not fire on a tiny roster', () => {
  // With three employees, removing two is over half but is plainly a real edit.
  const tiny = ROSTER.slice(0, 3);
  const p = computeRosterUpdate<E>({ serverList: tiny, baseline: tiny, next: [tiny[0]] });
  assert.equal(p.refused, undefined);
  assert.equal(p.finalList.length, 1);
});
test('removals already applied on the server do not count toward mass-removal', () => {
  // Two admins each removed somebody; this one is re-sending a removal that
  // already landed. It must not be double-counted into a refusal.
  const p = plan({
    baseline: ROSTER,
    next: [ROSTER[0]],
    serverList: [ROSTER[0], ROSTER[1]],   // c and d are already gone
  });
  assert.deepEqual(p.alreadyGone.sort(), ['c', 'd']);
  assert.equal(p.refused, undefined, 'only b is actually being removed');
  assert.deepEqual(p.finalList.map(e => e.id), ['a']);
});

console.log('\nMalformed input');
test('records without a usable id are ignored rather than corrupting the roster', () => {
  const junk = [{ id: '', name: 'X' }, { name: 'Y' } as any, null as any];
  const p = plan({ next: [...ROSTER, ...junk] });
  assert.deepEqual(p.upserted, []);
  assert.equal(p.finalList.length, 4);
});

console.log('\nThe admin list the Firestore rule reads');
test('only admins, by their sign-in address, lowercased and sorted', () => {
  assert.deepEqual(adminEmailsFrom([
    { systemRole: 'admin', linkedUserEmail: '  Marco@X.test ' },
    { systemRole: 'manager', linkedUserEmail: 'jonah@x.test' },
    { systemRole: 'admin', linkedUserEmail: 'anthony@x.test' },
    { systemRole: 'worker', linkedUserEmail: 'w@x.test' },
  ]), ['anthony@x.test', 'marco@x.test']);
});
test('falls back to `email` when there is no linked account', () => {
  assert.deepEqual(adminEmailsFrom([{ systemRole: 'admin', email: 'dave@x.test' }]), ['dave@x.test']);
});
test('an admin with no address at all is skipped rather than adding a blank', () => {
  // A blank in the list would be compared against a token email and could
  // never match — but it would also make the list look populated when it is not.
  assert.deepEqual(adminEmailsFrom([
    { systemRole: 'admin' },
    { systemRole: 'admin', linkedUserEmail: '   ' },
    { systemRole: 'admin', email: 'real@x.test' },
  ]), ['real@x.test']);
});
test('duplicates collapse', () => {
  assert.deepEqual(adminEmailsFrom([
    { systemRole: 'admin', linkedUserEmail: 'a@x.test' },
    { systemRole: 'admin', linkedUserEmail: 'A@X.TEST' },
  ]), ['a@x.test']);
});
test('a roster with no admins yields an empty list, not a wrong one', () => {
  assert.deepEqual(adminEmailsFrom([{ systemRole: 'manager', email: 'm@x.test' }]), []);
  assert.deepEqual(adminEmailsFrom(undefined), []);
});

console.log('\nThe mirror is DERIVED, never carried');
test('THE WIPE: the list is rebuilt from whatever roster is being written', () => {
  // appData.adminEmails was absent from the document for an unknown period.
  // saveEmployees wrote it in a targeted update, but the field was in no
  // client's appData, and syncToCloud replaces the whole document — so every
  // ordinary save deleted it. Verified against the live rules: with the field
  // absent, isContentAdmin() denied Dave (a real admin); with it present, he
  // was allowed. A missing mirror is a lockout, exactly as this file warns.
  //
  // The fix derives it inside the write from the same roster being persisted,
  // so any save restores it and it cannot drift from the roster.
  const roster = [
    { systemRole: 'admin', linkedUserEmail: 'Office@Marcosmowing.com ' },
    { systemRole: 'admin', email: 'anthonypalermo23@hotmail.com' },
    { systemRole: 'manager', email: 'liamroberta@gmail.com' },
    { systemRole: 'worker', email: 'nobody@x.test' },
  ];
  assert.deepEqual(adminEmailsFrom(roster), [
    'anthonypalermo23@hotmail.com', 'office@marcosmowing.com',
  ]);
});
test('an empty or missing roster yields an empty list, not a crash', () => {
  assert.deepEqual(adminEmailsFrom([]), []);
  assert.deepEqual(adminEmailsFrom(undefined), []);
});

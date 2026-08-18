// Renders the crew-day flag strip — the control on the daily entry board.
//   npm test -- crewDayFlagStripRender
//
// This is where flagging now happens, so the authority rules have to hold here:
// only an admin sees the flag control, and only the OWNING division's manager
// sees the sign-off. It must also say what flagging will cost, before it happens.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CrewDayFlagStrip from './CrewDayFlagStrip';
import type { CrewDayFlag } from '../types';

const openFlag: CrewDayFlag = {
  id: 'f1', date: '2026-08-17', crewId: 'crew-1', crewLabel: 'Lawn Division #3',
  division: 'Lawn Division', reason: 'Kyle has hours but is on no crew.',
  raisedBy: { email: 'james@x.test', name: 'James' }, raisedAt: Date.now(),
  status: 'open', previousApprovalStatus: 'approved',
};

const render = (o: Partial<Parameters<typeof CrewDayFlagStrip>[0]> = {}) =>
  renderToStaticMarkup(h(CrewDayFlagStrip, {
    crewId: 'crew-1', division: 'Lawn Division',
    flagCount: 0, canFlag: true, canResolveThis: false,
    onFlag: async () => true, onResolve: async () => true,
    ...o,
  } as any));

console.log('\nWho sees what');
test('an admin sees the flag control', () => {
  assert.ok(render({ canFlag: true }).includes('Flag for review'));
});
test('somebody who may not flag sees no control at all', () => {
  assert.equal(render({ canFlag: false }), '');
});
test('the strip stays out of the way when there is nothing to say', () => {
  // No flag, cannot flag, no history — the card renders as it always did.
  assert.equal(render({ canFlag: false, flagCount: 0, openFlag: undefined }), '');
});

console.log('\nAn open flag');
test('the question, who asked it, and the consequence are all shown', () => {
  const html = render({ openFlag });
  assert.ok(html.includes('Flagged for review'));
  assert.ok(html.includes('Kyle has hours but is on no crew.'));
  assert.ok(html.includes('James'));
  assert.ok(html.includes('not counting toward efficiency or bonus until signed off'));
});
test("the owning division's manager sees Sign off", () => {
  assert.ok(render({ openFlag, canResolveThis: true }).includes('Sign off'));
});
test("another division's manager is told whose job it is, not given the button", () => {
  const html = render({ openFlag, canResolveThis: false });
  assert.ok(!html.includes('Sign off'));
  assert.ok(html.includes('Lawn Division manager to sign off.'));
});

console.log('\nA read-only day explains itself');
test('a pushed month replaces the control with the reason', () => {
  const html = render({
    canFlag: true,
    blockedMessage: 'This month has been pushed to its sheet, so the day is archived and read-only.',
  });
  assert.ok(!html.includes('Flag for review'));
  assert.ok(html.includes('read-only'));
});

console.log('\nHistory on a clean crew-day');
test('past reviews are noted even when nothing is open now', () => {
  const html = render({ flagCount: 2 });
  assert.ok(html.includes('2 reviews on record'));
});
test('one past review reads in the singular', () => {
  assert.ok(render({ flagCount: 1 }).includes('1 review on record'));
});

console.log('\nLanguage stays neutral');
test('nothing calls this an error or a violation', () => {
  const html = render({ openFlag });
  for (const word of ['violation', 'offence', 'guilty', 'blame', 'fault', 'error']) {
    assert.ok(!new RegExp(word, 'i').test(html), `"${word}" must not appear`);
  }
});

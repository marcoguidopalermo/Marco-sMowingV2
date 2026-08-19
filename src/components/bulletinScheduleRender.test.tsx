// Renders the bulletin board and asserts what each viewer actually sees.
//   npm test -- bulletinScheduleRender
//
// The thing that must hold: a queued bulletin is invisible to everyone but its
// author and admins, and it never leaks into the live board.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BulletinBoard from './BulletinBoard';

const H = 3_600_000;
const now = () => Date.now();

const emp = (id: string, name: string, o: Record<string, unknown> = {}) => ({
  id, name, status: 'Active', hasLicense: false, hasClassA: false,
  hasHeavyMachinery: false, awayDates: [], linkedUserEmail: `${id}@x.test`, ...o,
});
const ROSTER = [emp('e-marco', 'Marco'), emp('e-cody', 'Cody Hubert'), emp('e-diego', 'Diego Galvez')];

const b = (o: Record<string, unknown>) => ({
  title: 'T', content: 'C', date: '2026-08-19', author: 'marco@x.test', ...o,
});

const render = (o: Record<string, unknown> = {}) => renderToStaticMarkup(h(BulletinBoard, {
  bulletins: (o.bulletins as any[]) || [],
  isAdmin: (o.isAdmin as boolean) ?? false,
  canPost: (o.canPost as boolean) ?? true,
  canDelete: true,
  effectiveRole: 'admin',
  newTitle: '', setNewTitle: () => {},
  newContent: '', setNewContent: () => {},
  audience: [], setAudience: () => {},
  recipientIds: (o.recipientIds as string[]) || [], setRecipientIds: () => {},
  employees: (o.employees as any[]) || ROSTER,
  viewerEmployeeId: (o.viewerEmployeeId as string) ?? 'e-marco',
  sendPush: (o.sendPush as boolean) ?? false, setSendPush: () => {},
  postAt: (o.postAt as string) ?? '', setPostAt: () => {},
  viewerEmail: (o.viewerEmail as string) ?? 'marco@x.test',
  onPost: () => {}, onDelete: () => {}, onReschedule: () => {},
} as any));

console.log('\nThe Scheduled section');
test('the author sees their queued bulletin, with when it posts', () => {
  const html = render({ bulletins: [b({ id: 'q1', title: 'Truck window repair', publishAt: now() + 2 * H })] });
  assert.ok(html.includes('Scheduled · 1'));
  assert.ok(html.includes('Truck window repair'));
  assert.ok(html.includes('Posts '));
  assert.ok(html.includes('not visible to anyone else yet'));
});
test('it says whether it will notify', () => {
  const on = render({ bulletins: [b({ id: 'q', publishAt: now() + H, notifyOnPublish: true })] });
  assert.ok(on.includes('will notify'));
  const off = render({ bulletins: [b({ id: 'q', publishAt: now() + H })] });
  assert.ok(off.includes('no notification'));
});
test('another worker sees no Scheduled section at all', () => {
  const html = render({
    bulletins: [b({ id: 'q1', title: 'Truck window repair', publishAt: now() + 2 * H })],
    viewerEmail: 'worker@x.test', isAdmin: false,
  });
  assert.ok(!html.includes('Scheduled ·'));
  assert.ok(!html.includes('Truck window repair'), 'the content must not leak');
});
test("an admin sees somebody else's queued bulletin", () => {
  const html = render({
    bulletins: [b({ id: 'q1', title: 'Truck window repair', publishAt: now() + 2 * H, author: 'tony@x.test' })],
    viewerEmail: 'admin@x.test', isAdmin: true,
  });
  assert.ok(html.includes('Scheduled · 1'));
});
test('cancel is offered on a queued bulletin', () => {
  const html = render({ bulletins: [b({ id: 'q', publishAt: now() + H })] });
  assert.ok(html.includes('Cancel'));
});

console.log('\nQueued bulletins never reach the live board');
test('a queued bulletin is absent from the published list', () => {
  const html = render({
    bulletins: [b({ id: 'q', title: 'Queued one', publishAt: now() + H })],
    viewerEmail: 'worker@x.test', isAdmin: false,
  });
  assert.ok(html.includes('No bulletins to display.'));
});
test('once its time passes it is an ordinary bulletin for everyone', () => {
  const html = render({
    bulletins: [b({ id: 'p', title: 'Landed one', publishAt: now() - H })],
    viewerEmail: 'worker@x.test', isAdmin: false,
  });
  assert.ok(html.includes('Landed one'));
  assert.ok(!html.includes('Scheduled ·'));
});
test('THE INVARIANT: published:false cannot hide a bulletin whose time has come', () => {
  const html = render({
    bulletins: [b({ id: 'p', title: 'Landed anyway', publishAt: now() - H, published: false })],
    viewerEmail: 'worker@x.test', isAdmin: false,
  });
  assert.ok(html.includes('Landed anyway'));
});
test('an ordinary bulletin with no post time is unaffected', () => {
  const html = render({
    bulletins: [b({ id: 'plain', title: 'Always been here' })],
    viewerEmail: 'worker@x.test', isAdmin: false,
  });
  assert.ok(html.includes('Always been here'));
});

console.log('\nThe composer');
test('the post-time picker is offered, and says blank means now', () => {
  const html = render();
  assert.ok(html.includes('Post at'));
  assert.ok(html.includes('Leave blank to post now.'));
});
test('choosing a time explains who can see it before it goes', () => {
  const html = render({ postAt: '2026-08-21T09:00' });
  assert.ok(html.includes('Only you and admins can see it before it goes.'));
});
test('a quiet-hours time with notify on warns at compose time', () => {
  const html = render({ postAt: '2026-08-21T06:00', sendPush: true });
  assert.ok(html.includes('quiet hours'));
  assert.ok(html.includes('8:00 AM'));
});
test('no quiet-hours warning without a notification — nothing would be held', () => {
  const html = render({ postAt: '2026-08-21T06:00', sendPush: false });
  assert.ok(!html.includes('held and delivered'));
});
test('no warning for a daytime post time', () => {
  const html = render({ postAt: '2026-08-21T09:00', sendPush: true });
  assert.ok(!html.includes('quiet hours'));
});

console.log('\nTargeting specific people');
test('a named recipient sees the bulletin on their board', () => {
  const html = render({
    bulletins: [b({ id: 't1', title: 'Truck window repair', recipientIds: ['e-cody'] })],
    viewerEmployeeId: 'e-cody', viewerEmail: 'cody@x.test',
  });
  assert.ok(html.includes('Truck window repair'));
});
test('somebody not named sees nothing — including an admin', () => {
  const forCody = [b({ id: 't1', title: 'Truck window repair', recipientIds: ['e-cody'] })];
  const other = render({ bulletins: forCody, viewerEmployeeId: 'e-diego', viewerEmail: 'd@x.test' });
  assert.ok(!other.includes('Truck window repair'));
  const admin = render({ bulletins: forCody, viewerEmployeeId: 'e-marco', isAdmin: true });
  assert.ok(!admin.includes('Truck window repair'), 'admins get no blanket pass');
});
test('the bulletin shows WHO it went to', () => {
  const html = render({
    bulletins: [b({ id: 't1', recipientIds: ['e-cody', 'e-diego'] })],
    viewerEmployeeId: 'e-cody',
  });
  assert.ok(html.includes('To: Cody Hubert · Diego Galvez'));
});
test('an untargeted bulletin shows no To: line', () => {
  const html = render({ bulletins: [b({ id: 'plain', title: 'General notice' })] });
  assert.ok(html.includes('General notice'));
  assert.ok(!html.includes('To:'));
});
test('roles and people together are both shown', () => {
  const html = render({
    bulletins: [b({ id: 'mix', audience: ['manager'], recipientIds: ['e-cody'] })],
    viewerEmployeeId: 'e-cody',
  });
  assert.ok(html.includes('To: Managers · Cody Hubert'));
});

console.log('\nTargeted AND scheduled');
test('a queued targeted bulletin shows its recipients in the Scheduled section', () => {
  const html = render({
    bulletins: [b({ id: 'q', title: 'Truck window repair', publishAt: now() + 2 * H, recipientIds: ['e-cody'], notifyOnPublish: true })],
    viewerEmail: 'marco@x.test', viewerEmployeeId: 'e-marco',
  });
  assert.ok(html.includes('Scheduled · 1'));
  assert.ok(html.includes('To: Cody Hubert'));
  assert.ok(html.includes('will notify'));
});
test('the named recipient does NOT see it before it lands', () => {
  const html = render({
    bulletins: [b({ id: 'q', title: 'Truck window repair', publishAt: now() + 2 * H, recipientIds: ['e-cody'] })],
    viewerEmail: 'cody@x.test', viewerEmployeeId: 'e-cody', isAdmin: false,
  });
  assert.ok(!html.includes('Truck window repair'));
});
test('once it lands the named recipient sees it and others still do not', () => {
  const landed = [b({ id: 'q', title: 'Truck window repair', publishAt: now() - H, recipientIds: ['e-cody'] })];
  assert.ok(render({ bulletins: landed, viewerEmployeeId: 'e-cody', viewerEmail: 'cody@x.test' }).includes('Truck window repair'));
  assert.ok(!render({ bulletins: landed, viewerEmployeeId: 'e-diego', viewerEmail: 'd@x.test' }).includes('Truck window repair'));
});

console.log('\nThe person picker');
test('the picker offers employees by name', () => {
  const html = render();
  assert.ok(html.includes('specific people'));
  assert.ok(html.includes('Cody Hubert'));
  assert.ok(html.includes('Diego Galvez'));
});
test('selecting people says nobody else will see it', () => {
  const html = render({ recipientIds: ['e-cody'] });
  assert.ok(html.includes('Goes to these people only'));
});

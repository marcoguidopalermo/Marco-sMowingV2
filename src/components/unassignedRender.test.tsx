// MyCrewToday when the viewer is on NO crew today.
//   npm test -- unassignedRender
//
// Two things are asserted here, and the second matters as much as the first:
// the person is told they're not on a crew and given a way to say they're
// available — and there is NO way for them to put themselves on a crew. Crew
// composition is the manager's morning decision; a self-assign control would
// let people pick easy jobs, let two of them pile onto the same crew while a
// short one stays short, and leave managers discovering their crews rather than
// setting them. If somebody ever adds that button, this test should fail.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MyCrewToday from './MyCrewToday';
import type { Crew, Employee } from '../types';

const TODAY = '2026-08-17';

const emp = (o: Partial<Employee> & { id: string; name: string }): Employee => ({
  status: 'Active', hasLicense: false, hasClassA: false, hasHeavyMachinery: false,
  awayDates: [], ...o,
} as Employee);
const crew = (division: string, crewNumber: number, employees: string[]): Crew => ({
  id: `${division}-${crewNumber}`, division, crewNumber, employees, fleet: [], inventory: [],
});

const me = emp({ id: 'me', name: 'Al Anderson', primaryCrew: 'Lawn' });
const lawnMgr = emp({
  id: 'mgr', name: 'Jonah Lahtinen', primaryCrew: 'Lawn',
  managedDivision: 'lawn', linkedUserEmail: 'jonah@x.test',
});
const allMgr = emp({
  id: 'all', name: 'Marco Palermo', managedDivision: 'all', linkedUserEmail: 'marco@x.test',
});

function render(opts: { notify?: boolean; employees?: Employee[]; schedules?: Record<string, Crew[]> } = {}) {
  return renderToStaticMarkup(h(MyCrewToday, {
    today: TODAY,
    currentUserEmployee: me,
    schedules: opts.schedules ?? { [TODAY]: [crew('Lawn Division', 1, ['someone-else'])] },
    performance: {},
    employees: opts.employees ?? [me, lawnMgr, allMgr],
    fleet: [],
    equipmentSubtypes: [],
    partialTimeOff: {},
    jobberConnected: false,
    ...(opts.notify === false ? {} : { onNotifyAvailable: async () => {} }),
  } as any));
}

const html = render();

test('the person is told plainly that they are not on a crew', () => {
  assert.match(html, /You&#x27;re not on a crew today\.|You’re not on a crew today\./);
});

test('their OWN DIVISION manager is named — not every manager', () => {
  assert.match(html, /Your manager/);
  assert.match(html, /Jonah Lahtinen/);
  // The admin/all-division manager is NOT copied when a division manager
  // exists: a lawn worker's message goes to whoever runs the lawn roster.
  assert.doesNotMatch(html, /Marco Palermo/);
});

test('with no division manager, it names the admin fallback instead', () => {
  // Somebody stranded must always reach a human, so a division with no manager
  // set falls through to admin rather than showing nobody.
  const noDivMgr = render({ employees: [me, allMgr] });
  assert.match(noDivMgr, /Marco Palermo/);
  assert.match(noDivMgr, /Notify my manager/);
});

test('the notify button is offered', () => {
  assert.match(html, /Notify my manager I&#x27;m available|Notify my manager I’m available/);
});

test('NO self-assignment control exists anywhere on the unassigned state', () => {
  for (const forbidden of [
    /join a crew/i, /add me to/i, /assign myself/i, /self.assign/i,
    /pick a crew/i, /choose a crew/i, /put me on/i,
  ]) {
    assert.doesNotMatch(html, forbidden, `a self-assignment affordance appeared: ${forbidden}`);
  }
});

test('it says who sets the crews, so the absence of a button is explained', () => {
  assert.match(html, /manager sets the crews/i);
});

test('with no manager configured, it says so instead of offering a dead button', () => {
  const orphan = render({ employees: [me] });
  assert.match(orphan, /No manager is set up for your division/);
  assert.doesNotMatch(orphan, /Notify my manager/);
});

test('without a notify handler the button is hidden, not broken', () => {
  const noHandler = render({ notify: false });
  assert.match(noHandler, /You&#x27;re not on a crew today\.|You’re not on a crew today\./);
  assert.doesNotMatch(noHandler, /Notify my manager/);
});

test('somebody who IS on a crew never sees this state', () => {
  const onCrew = render({ schedules: { [TODAY]: [crew('Lawn Division', 1, ['me'])] } });
  assert.doesNotMatch(onCrew, /not on a crew today/);
  assert.doesNotMatch(onCrew, /Notify my manager/);
});

test('the tomorrow hint replaces the crews-are-set line when scheduled tomorrow', () => {
  const tomorrow = render({
    schedules: {
      [TODAY]: [crew('Lawn Division', 1, ['someone-else'])],
      '2026-08-18': [crew('Lawn Division', 1, ['me'])],
    },
  });
  assert.match(tomorrow, /scheduled on a crew tomorrow/);
});

test('the button is a thumb-sized target', () => {
  assert.match(html, /min-h-\[48px\]/);
});

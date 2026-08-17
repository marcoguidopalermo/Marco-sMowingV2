// Renders the availability view and asserts what a manager actually reads.
//   npm test -- availabilityRender
//
// Beyond "it doesn't crash": the two judgements this view exists to make —
// who is free, and which crew can lend or is short — have to appear in the
// output, and a crew with no history must NOT read as sitting at its usual
// size.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AvailabilityView from './AvailabilityView';
import type { AppData, Crew, Employee } from '../types';

const TODAY = new Date().toISOString().slice(0, 10);
const daysBefore = (n: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

const emp = (o: Partial<Employee> & { id: string; name: string }): Employee => ({
  status: 'Active', hasLicense: false, hasClassA: false, hasHeavyMachinery: false,
  awayDates: [], ...o,
} as Employee);
const crew = (division: string, crewNumber: number, employees: string[]): Crew => ({
  id: `${division}-${crewNumber}-${employees.join()}`, division, crewNumber,
  employees, fleet: [], inventory: [],
});

const employees: Employee[] = [
  emp({ id: 'a', name: 'Al Anderson', primaryCrew: 'Lawn' }),
  emp({ id: 'b', name: 'Bo Baker', primaryCrew: 'Lawn' }),
  emp({ id: 'c', name: 'Cy Carter', primaryCrew: 'Lawn' }),
  emp({ id: 'd', name: 'Di Dawson', primaryCrew: 'Lawn' }),
  emp({ id: 'e', name: 'Ed Ellis', primaryCrew: 'Small Project' }),
  emp({ id: 'f', name: 'Fay Foster', primaryCrew: 'Small Project' }),
  emp({ id: 'off', name: 'Office Olive', primaryCrew: 'Office' }),
  emp({ id: 'vac', name: 'Vic Vance', primaryCrew: 'Lawn', awayDates: [{ start: daysBefore(1), end: TODAY }] }),
];

// Lawn #1 normally runs 2; today it has 3 (can lend one).
// Small #1 normally runs 2; today it has 1 (short one).
// Lawn #9 has no history at all (new crew).
const schedules: Record<string, Crew[]> = {
  [daysBefore(3)]: [crew('Lawn Division', 1, ['a', 'b']), crew('Small Projects', 1, ['e', 'f'])],
  [daysBefore(2)]: [crew('Lawn Division', 1, ['a', 'b']), crew('Small Projects', 1, ['e', 'f'])],
  [TODAY]: [
    crew('Lawn Division', 1, ['a', 'b', 'c']),
    crew('Small Projects', 1, ['e']),
    crew('Lawn Division', 9, ['d']),
  ],
};

const appData = {
  employees, schedules, dailyAbsences: {}, fleet: [],
} as unknown as AppData;

const html = renderToStaticMarkup(h(AvailabilityView, { appData, defaultDivision: 'All' }));

test('the three sections render', () => {
  assert.match(html, /Not on a crew today/);
  assert.match(html, /Crews today/);
  assert.match(html, /Away today/);
});

test('a crew above its norm reads as able to lend', () => {
  assert.match(html, /Can lend someone/);
  assert.match(html, /Lawn Division #1 \(\+1\)/);
  assert.match(html, /can lend one/);
});

test('a crew below its norm reads as short', () => {
  assert.match(html, /Running short/);
  assert.match(html, /Small Projects #1 \(-1\)/);
  assert.match(html, /short 1/);
});

test('a crew with no history reads as new, never as "usual size"', () => {
  assert.match(html, /new crew/);
  // Lawn #9 must not be listed in either headline strip.
  assert.ok(!/Lawn Division #9 \(/.test(html), 'a crew with no norm must not appear as lend/short');
});

test('the headcount is shown against the usual size', () => {
  // "3 / 2" for Lawn #1 — today over usual.
  assert.match(html, /3\s*<\/?[^>]*>?\s*\/\s*2/);
  assert.match(html, /usual 2/);
});

test('unassigned people are grouped, and no-division staff sit in their own group', () => {
  // In this fixture every Lawn/Small person IS on a crew (a,b,c on Lawn #1,
  // d on Lawn #9, e on Small #1) and Vic is away — so the ONLY unassigned
  // person is Office Olive, who has no division. Fay is unassigned too.
  assert.match(html, /Small Projects · 1/);      // Fay Foster, unassigned
  assert.match(html, /No division · 1/);         // Office Olive, own group
  // Collapsed by default: the count shows but the name does not.
  assert.doesNotMatch(html, /Office Olive/);
});

test('the away list names who is booked off, and they are not offered as free', () => {
  assert.match(html, /Vic Vance/);
  assert.match(html, /booked off/);
  // The free-count in the header must exclude them.
  assert.doesNotMatch(html, /Vic Vance<\/span>\s*<\/span>\s*<\/div>\s*<div[^>]*>\s*<div[^>]*>Lawn Division ·/);
});

test('read-only is stated, so nobody looks for a control that is not there', () => {
  assert.match(html, /Read-only/);
  assert.match(html, /median crew size/i);
});

test('mobile-first layout: single column by default, wider only at sm and up', () => {
  // Section grids must not be multi-column without a breakpoint prefix.
  // Require NO prefix before grid-cols-2 — note '\b' alone is not enough,
  // since ':' is a word boundary and would match inside 'sm:grid-cols-2'.
  assert.doesNotMatch(html, /(?<![:\w-])grid-cols-2/, 'a grid goes multi-column before the sm breakpoint');
  assert.match(html, /sm:grid-cols-2/);
  // Date steppers are thumb-sized (44px).
  assert.match(html, /h-11 w-11/);
});

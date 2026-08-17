// Renders the availability view and asserts what a manager actually reads.
//   npm test -- availabilityRender
//
// Beyond "it doesn't crash": the two things this view exists to say — who is
// free, and which crews have somebody who could move — have to appear in the
// output, and no inferred "usual size" may reappear anywhere in it.
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

// Today: Lawn #1 has 3 (lendable), Small #1 has 1 (not lendable), Lawn #9 has
// 1 (not lendable). The past days exist purely to prove they are ignored.
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

test('a crew of 2+ is flagged as able to lend, and named in the headline', () => {
  assert.match(html, /Could lend someone/);
  assert.match(html, /Lawn Division #1 \(3\)/);
  assert.match(html, /could lend someone/);
});

test('crews of 1 are shown but never flagged as lendable', () => {
  // Both one-person crews render...
  assert.match(html, /Small Projects #1/);
  assert.match(html, /Lawn Division #9/);
  // ...but neither appears in the lendable headline, which lists "key (count)".
  assert.doesNotMatch(html, /Small Projects #1 \(1\)/);
  assert.doesNotMatch(html, /Lawn Division #9 \(1\)/);
});

test('the headcount is today’s actual count, labelled in people', () => {
  assert.match(html, /people|person/);
  assert.match(html, /3\s*<[^>]*>\s*people/);
});

test('NO inferred norm appears anywhere in the output', () => {
  // The whole point of the change: today's count is a fact, a norm is a
  // statistic that can be wrong. None of its vocabulary may come back.
  for (const word of [/usual/i, /typical/i, /median/i, /norm\b/i, /running short/i, /new crew/i]) {
    assert.doesNotMatch(html, word, `removed usual-size vocabulary reappeared: ${word}`);
  }
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
  assert.match(html, /today&#x27;s actual crew assignments|today’s actual crew assignments/);
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

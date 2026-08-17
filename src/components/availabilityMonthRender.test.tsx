// Renders the availability MONTH grid.
//   npm test -- availabilityMonthRender
//
// The assertion that matters: an unbuilt day must render grey and say "not
// scheduled yet", NOT a count. Without that every future day in the month
// lights up as fully available — nobody is on a crew that hasn't been built —
// and the grid stops carrying information.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AvailabilityMonth from './AvailabilityMonth';
import type { AppData, Crew, Employee } from '../types';

const emp = (o: Partial<Employee> & { id: string; name: string }): Employee => ({
  status: 'Active', hasLicense: false, hasClassA: false, hasHeavyMachinery: false,
  awayDates: [], ...o,
} as Employee);
const crew = (division: string, crewNumber: number, employees: string[]): Crew => ({
  id: `${division}-${crewNumber}`, division, crewNumber, employees, fleet: [], inventory: [],
});

const people: Employee[] = [
  emp({ id: 'a', name: 'Al Anderson', primaryCrew: 'Lawn' }),
  emp({ id: 'b', name: 'Bo Baker', primaryCrew: 'Lawn' }),
  emp({ id: 'c', name: 'Cy Carter', primaryCrew: 'Lawn' }),
  emp({ id: 'd', name: 'Di Dawson', primaryCrew: 'Lawn' }),
];

// August 2026: only the 18th is built (Al on a crew ⇒ Bo, Cy, Di free).
// Every other day of the month is unbuilt.
const appData = {
  employees: people,
  schedules: { '2026-08-18': [crew('Lawn Division', 1, ['a'])] },
  dailyAbsences: {},
  fleet: [],
} as unknown as AppData;

const html = renderToStaticMarkup(h(AvailabilityMonth, {
  appData,
  division: 'All',
  setDivision: () => {},
  onOpenDay: () => {},
  initialMonth: new Date('2026-08-15T12:00:00'),
}));

test('the month grid renders with a weekday header and the month label', () => {
  assert.match(html, /August 2026/);
  for (const w of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
    assert.match(html, new RegExp(`>${w}<`));
  }
});

test('UNBUILT days say "not scheduled yet" and show no count', () => {
  assert.match(html, /not scheduled yet/);
  // August 2026 has 31 days; exactly one is built, so 30 are unbuilt.
  const unbuilt = (html.match(/not scheduled yet/g) || []).length;
  assert.equal(unbuilt, 30, `expected 30 unbuilt day cells, found ${unbuilt}`);
});

test('unbuilt days are visually neutral — dashed grey, not green', () => {
  assert.match(html, /border-dashed border-slate-300 bg-slate-50/);
});

test('the ONE built day shows its genuine unassigned names and count', () => {
  // Bo, Cy and Di are free on the 18th.
  assert.match(html, /Bo Baker/);
  assert.match(html, /Cy Carter/);
  assert.match(html, /Di Dawson/);
  // Al is on the crew, so he is not offered as free.
  assert.doesNotMatch(html, /Al Anderson/);
  // Green density for a real count.
  assert.match(html, /bg-emerald-1\d\d border-emerald-\d\d\d/);
});

test('the header counts scheduled days separately from unscheduled ones', () => {
  assert.match(html, /1<\/span> day scheduled/);
  assert.match(html, /30 not yet/);
});

test('the week edge total counts only built days', () => {
  // Only one built day all month (3 free), so exactly one week row can show a
  // non-zero total; every other row must show 0 rather than a full roster.
  const totals = [...html.matchAll(/text-lg font-black text-slate-700">(\d+)</g)].map(m => Number(m[1]));
  assert.ok(totals.length >= 5, 'expected a per-week total for each week row');
  assert.equal(totals.filter(n => n > 0).length, 1, 'more than one week reported free people');
  assert.ok(totals.includes(3), 'the built week should total the 3 genuinely free people');
});

test('a division filter control is present', () => {
  assert.match(html, /All Divisions/);
  assert.match(html, /Lawn Division/);
});

test('mobile-legible: 7 columns on a phone, the 8th total column only at sm+', () => {
  assert.match(html, /grid-cols-7 sm:grid-cols-8/);
  // Name tags are hidden at the narrowest widths — the badge carries the read.
  assert.match(html, /hidden sm:flex flex-col/);
  // Day cells stay tappable at phone size.
  assert.match(html, /min-h-\[64px\] sm:min-h-\[92px\]/);
});

test('month navigation is present', () => {
  assert.match(html, /Previous month/);
  assert.match(html, /Next month/);
  assert.match(html, />Today</);
});

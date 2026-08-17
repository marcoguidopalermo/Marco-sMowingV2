// Does the manager's note actually REACH the crew?
//   npm test -- crewNoteRender
//
// This is the regression that mattered: crew.notes was written on the schedule
// board and MyCrewToday never read it, so a note like "start at the Rosslyn job
// first, gate code 4471" reached nobody and the field looked broken rather than
// unwired. A unit test on a helper would not have caught it — the bug was that
// nothing rendered — so this renders the real screen and reads the output.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MyCrewToday from './MyCrewToday';
import type { Crew, Employee } from '../types';

const TODAY = '2026-08-17';
const YESTERDAY = '2026-08-16';
const NOTE = 'Start at the Rosslyn job first, gate code 4471.';

const me: Employee = {
  id: 'me', name: 'Al Anderson', status: 'Active', primaryCrew: 'Lawn',
  hasLicense: true, hasClassA: false, hasHeavyMachinery: false, awayDates: [],
} as Employee;

const crew = (o: Partial<Crew> = {}): Crew => ({
  id: 'crew-1', division: 'Lawn Division', crewNumber: 1,
  employees: ['me'], fleet: [], inventory: [], ...o,
});

function render(schedules: Record<string, Crew[]>) {
  return renderToStaticMarkup(h(MyCrewToday, {
    today: TODAY,
    currentUserEmployee: me,
    schedules,
    performance: {},
    employees: [me],
    fleet: [],
    equipmentSubtypes: [],
    partialTimeOff: {},
    jobberConnected: false,
  } as any));
}

test('a note written for the crew TODAY is rendered on My Crew Today', () => {
  const html = render({ [TODAY]: [crew({ notes: NOTE })] });
  assert.match(html, /Start at the Rosslyn job first, gate code 4471\./);
  // And it is unmistakably from the manager, not just loose text.
  assert.match(html, /Note from your manager/);
});

test('the byline names who wrote it and when', () => {
  const html = render({
    [TODAY]: [crew({
      notes: NOTE,
      notesByName: 'Tony Palermo',
      notesAt: `${TODAY}T07:15:00.000`,
    })],
  });
  assert.match(html, /Tony Palermo/);
  // Written before noon on the day itself reads as "this morning" — freshness
  // is the point, not a raw timestamp.
  assert.match(html, /this morning/);
});

test('a note stamped yesterday reads as yesterday, not as this morning', () => {
  const html = render({
    [TODAY]: [crew({ notes: NOTE, notesByName: 'Tony Palermo', notesAt: `${YESTERDAY}T16:40:00.000` })],
  });
  assert.match(html, /yesterday/);
  assert.doesNotMatch(html, /this morning/);
});

test('PER CREW-DAY: a note on yesterday does not leak onto today', () => {
  const html = render({
    [YESTERDAY]: [crew({ notes: 'Yesterday only — do not show today.' })],
    [TODAY]: [crew({ notes: '' })],
  });
  assert.doesNotMatch(html, /Yesterday only/);
  assert.doesNotMatch(html, /Note from your manager/);
});

test('PER CREW-DAY: a note on tomorrow does not appear today either', () => {
  const html = render({
    [TODAY]: [crew()],
    '2026-08-18': [crew({ notes: 'Tomorrow only.' })],
  });
  assert.doesNotMatch(html, /Tomorrow only/);
});

test('a note on a crew the viewer is NOT on is not shown to them', () => {
  const html = render({
    [TODAY]: [
      crew({ id: 'mine', notes: 'For my crew.' }),
      crew({ id: 'theirs', crewNumber: 2, employees: ['someone-else'], notes: 'For the other crew.' }),
    ],
  });
  assert.match(html, /For my crew\./);
  assert.doesNotMatch(html, /For the other crew\./);
});

test('an empty or whitespace-only note renders nothing at all', () => {
  for (const notes of ['', '   ', '\n\n']) {
    const html = render({ [TODAY]: [crew({ notes })] });
    assert.doesNotMatch(html, /Note from your manager/, `blank note (${JSON.stringify(notes)}) rendered a banner`);
  }
});

test('line breaks the manager typed survive — a note is often a short list', () => {
  const html = render({ [TODAY]: [crew({ notes: 'Rosslyn first\nGate 4471\nCall Dave' })] });
  assert.match(html, /whitespace-pre-wrap/);
  assert.match(html, /Gate 4471/);
});

test('a note with no stamps still shows, carrying just its author', () => {
  // Notes written before notesAt/notesByName existed must not vanish.
  const html = render({ [TODAY]: [crew({ notes: NOTE })] });
  assert.match(html, /Start at the Rosslyn job/);
});

test('the note sits ABOVE the Today/Yesterday tabs, so it cannot be tabbed away from', () => {
  const html = render({ [TODAY]: [crew({ notes: NOTE })] });
  const note = html.indexOf('Note from your manager');
  const tabs = html.indexOf('role="tablist"');
  assert.ok(note >= 0 && tabs >= 0, 'expected both the note and the tab list to render');
  assert.ok(note < tabs, 'the note must render before the tab toggle');
});

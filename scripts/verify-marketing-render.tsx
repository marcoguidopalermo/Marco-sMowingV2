// Renders the Marketing page to a string with representative data. Two jobs:
//   1. Catch runtime crashes the type checker can't (bad field access, a
//      legacy doc missing `links`, an empty board).
//   2. Assert the page is ONE screen — all three sections present in a single
//      render, with no tab to click. Same spirit as verify-snow-contract-print.
//
// Run: npx tsx scripts/verify-marketing-render.tsx
import { renderToString } from 'react-dom/server';
import React from 'react';
import MarketingMaster from '../src/components/MarketingMaster';

const user = { email: 'sales@marcosmowing.com', name: 'James Serediuk' };
const noop = () => {};
const handlers = {
  currentUser: user,
  onSaveContent: noop, onDeleteContent: noop,
  onSaveShot: noop, onDeleteShot: noop,
  onSaveLink: noop, onDeleteLink: noop,
};

let failures = 0;
const expect = (html: string, needle: string) => {
  if (html.includes(needle)) { console.log(`  ✓ ${needle}`); return; }
  failures++;
  console.log(`  ✗ MISSING ${needle}`);
};

console.log('\nPopulated board');
const populated = renderToString(
  React.createElement(MarketingMaster as any, {
    ...handlers,
    content: {
      c1: { id: 'c1', title: 'Patio before/after', date: '2026-08-12', status: 'planned', notes: 'tag the client', links: ['l1'], createdBy: user, createdAt: 1 },
      // Deliberately missing `links` and `notes` — a legacy-shaped doc.
      c2: { id: 'c2', title: 'Fall cleanup teaser', date: '2026-08-20', status: 'idea' },
    },
    shots: {
      s1: { id: 's1', description: 'Drone over Riverside', status: 'needed', createdAt: 1 },
      s2: { id: 's2', description: 'Crew loading truck', status: 'captured', capturedAt: 2 },
    },
    links: {
      l1: { id: 'l1', url: 'https://www.instagram.com/reel/abc123', title: 'Instagram reel', addedBy: user, addedAt: 1 },
      l2: { id: 'l2', url: 'https://example.com/blog/great-lawn-tips', addedBy: user, addedAt: 2, title: 'Great lawn tips' },
    },
  }),
);
expect(populated, 'Marketing');
// All three sections in ONE render — the single-page requirement.
expect(populated, 'Content calendar');
expect(populated, 'Shots to follow up');
expect(populated, 'Reference links');
// Calendar content: a chip in the grid AND a row in the scan list beside it,
// so the same item renders twice — both views are live at once.
expect(populated, 'Patio before/after');
expect(populated, 'Fall cleanup teaser');
// Shots and links render their own rows on the same screen.
expect(populated, 'Drone over Riverside');
expect(populated, 'Instagram reel');
// Named-account audit trail is visible on the page, not just stored.
expect(populated, 'Added by James Serediuk');

console.log('\nEmpty board (first run)');
const empty = renderToString(
  React.createElement(MarketingMaster as any, { ...handlers, content: {}, shots: {}, links: {} }),
);
expect(empty, 'Marketing');
expect(empty, 'Content calendar');
expect(empty, 'Shots to follow up');
expect(empty, 'Reference links');
expect(empty, 'No shots on the list.');
expect(empty, 'Nothing saved yet.');

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);

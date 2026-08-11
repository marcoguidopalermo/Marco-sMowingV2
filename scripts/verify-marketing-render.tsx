// Renders MarketingMaster to a string with representative data — catches
// runtime crashes the type checker can't (bad field access, a legacy doc
// missing `links`, an empty board). Same spirit as verify-snow-contract-print.
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
      c1: { id: 'c1', title: 'Patio before/after', date: '2026-08-12', status: 'planned', notes: 'tag the client', links: ['l1'] },
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
expect(populated, 'MarketingMaster');
expect(populated, 'Calendar');
expect(populated, 'Shots');
expect(populated, 'Links');
expect(populated, 'Patio before/after');
expect(populated, 'Fall cleanup teaser');

console.log('\nEmpty board (first run)');
const empty = renderToString(
  React.createElement(MarketingMaster as any, { ...handlers, content: {}, shots: {}, links: {} }),
);
expect(empty, 'MarketingMaster');
expect(empty, 'Calendar');

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);

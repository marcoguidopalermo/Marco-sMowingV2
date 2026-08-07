// PRINT VERIFICATION for the commercial snow contract.
//   npx tsx scripts/verify-snow-contract-print.tsx
//
// Renders the REAL SnowContractDocument to HTML, applies the document's own
// print CSS unconditionally, and measures the result in headless Chrome at
// true print width. Then it checks the two things that actually matter:
//
//   1. THREE PAGES.
//   2. NO SECTION SPLITS. Under `break-inside: avoid`, a section can only be
//      broken if it is TALLER THAN A PAGE — so the check is whether any
//      section exceeds the page content height, plus a simulation of where
//      the breaks fall.
//
// Run at BOTH EXTREMES: an empty scope description and a full page of one.
import { renderToStaticMarkup } from 'react-dom/server';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import SnowContractDocument from '../src/components/SnowContractDocument';
import { newContract, withDerived } from '../src/lib/snowContracts';
import { PAGE_CONTENT_PX, fitMapHeightIn, MAP_MAX_IN, MAP_MIN_IN } from '../src/lib/snowContractMap';
import type { SnowContract } from '../src/types';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowprint-'));

const LOREM = `The serviced area comprises the main customer lot fronting Rosslyn Road, the rear loading dock and turnaround, the north-side employee parking strip, and the connecting drive aisle between them. Walkways include the front entrance apron, the accessible ramp on the south elevation, the side fire exit landing, and the path linking the rear dock to the employee door. Snow is to be stacked at the north-west corner of the rear lot and along the east fence line only; the south berm is not available this season because of the new transformer pad. Fire hydrants on the north boundary and the two bollards flanking the dock are to be kept clear at all times. Access is through the Rosslyn Road entrance; the rear gate is locked outside business hours and a key is held at the office. Overnight trailer parking regularly occupies the eastern third of the rear lot between November and February, and those bays are serviced only when clear. `;

function fixture(kind: 'empty' | 'full'): SnowContract {
  const c = newContract({ id: `verify-${kind}`, createdBy: 'verify', now: Date.parse('2026-08-07T12:00:00Z') });
  c.client = {
    businessName: 'Northbridge Commercial Properties Inc.',
    siteContact: 'Pat Lindgren, Facilities',
    serviceAddress: '1175 Rosslyn Road, Thunder Bay, ON P7E 6X5',
    billingEmail: 'ap@northbridge.example.ca',
    phone: '(807) 555-0142',
  };
  c.scope.totalArea = '41,200 sq ft';
  c.scope.lotAreas = 'Main customer lot, rear dock, drive aisle';
  c.scope.walkwaysEntrances = 'Front apron, accessible ramp, dock path';
  c.scope.snowStorage = 'North-west corner, east fence line';
  c.scope.markedHazards = 'Hydrants (north), dock bollards';
  c.scope.accessNotes = 'Rosslyn Rd entrance; rear gate keyed';
  c.scope.description = kind === 'full' ? LOREM.repeat(3).trim() : '';
  c.services[0].status = 'included';
  c.services[1].status = 'included';
  c.services[2].status = 'onCall';
  c.pricing.selectedOption = 'A';
  c.pricing.optionA.totalPrice = 24000;
  c.pricing.optionB.lines = c.pricing.optionB.lines.map((l, i) => ({ ...l, amount: [300, 120, 210, 95][i] || 0 }));
  c.pricing.addOns.afterHours = '250 per call-out';
  return withDerived(c);
}

// The document's CSS lives inside the component's <style> block; the markup
// carries it. For measurement we force the @media print rules on.
function harness(html: string, mapIn: number): string {
  const forced = html.replace(/@media print \{/, '@media all {');
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:#fff}
  /* True printed content width: Letter less the 0.5in side margins. */
  #page{width:${(8.5 - 1) * 96}px}
</style></head><body><div id="page">${forced}</div>
<script>
  (function(){
    // Apply the fitted map height the component computes at runtime.
    var mw = document.querySelector('.mapwrap');
    if (mw) mw.style.height = '${mapIn}in';
    var PAGE = ${PAGE_CONTENT_PX};
    var out = { sections: [], pages: 1, tallest: 0, overflowing: [], page1RawPx: 0, mapPx: 0 };
    // Everything BEFORE the first forced break is page 1's content, whether or
    // not it currently fits — that is what the fit has to work with.
    var firstPb = document.querySelector('.snowdoc .pb');
    var beforePb = [];
    var walk = document.querySelectorAll('.snowdoc section');
    for (var i = 0; i < walk.length; i++) {
      if (firstPb && (walk[i].compareDocumentPosition(firstPb) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        beforePb.push(walk[i]);
      }
    }
    // TRUE bottom of the last page-1 section, measured from the document top —
    // this includes every margin between the sections, which summing rects
    // silently drops.
    var docTop = document.querySelector('.snowdoc').getBoundingClientRect().top;
    var lastP1 = beforePb[beforePb.length - 1];
    out.page1RawPx = lastP1 ? Math.ceil(lastP1.getBoundingClientRect().bottom - docTop) : 0;
    out.mapPx = mw ? mw.getBoundingClientRect().height : 0;
    // Paginate from REAL OFFSETS, not summed heights: offsets include margins
    // and collapse exactly as laid out, and avoid rounding each section.
    var origin = document.querySelector('.snowdoc').getBoundingClientRect().top;
    var nodes = Array.prototype.slice.call(document.querySelectorAll('.snowdoc section, .snowdoc .pb'));
    var pageStart = 0, page = 1;
    nodes.forEach(function(n){
      var r = n.getBoundingClientRect();
      var top = r.top - origin, bottom = r.bottom - origin;
      if (n.classList.contains('pb')) { page++; pageStart = bottom; return; }
      // break-inside:avoid — if the whole section does not fit in what is left
      // of this page, it moves to the next one intact.
      if (bottom - pageStart > PAGE) {
        out.spills = out.spills || [];
        out.spills.push({ title: (n.querySelector('h2')||{textContent:'?'}).textContent.trim(),
                          overBy: Math.round((bottom - pageStart) - PAGE) });
        page++; pageStart = top;
      }
      var head = n.querySelector('h2');
      var title = head ? head.textContent.trim() : '(untitled)';
      out.sections.push({ title: title, page: page, height: Math.round(r.height) });
      if (r.height > out.tallest) out.tallest = Math.round(r.height);
      if (r.height > PAGE) out.overflowing.push(title);
      out.pages = Math.max(out.pages, page);
    });
    out.spills = out.spills || [];
    document.title = JSON.stringify(out);
    var pre = document.createElement('pre'); pre.id='result';
    pre.textContent = JSON.stringify(out);
    document.body.appendChild(pre);
  })();
</script></body></html>`;
}

function measure(kind: 'empty' | 'full') {
  const c = fixture(kind);
  // Pass 1: render with the max map to measure everything else on page 1.
  const html1 = renderToStaticMarkup(React.createElement(SnowContractDocument, { contract: c, mode: 'print' }));
  const f1 = path.join(tmp, `${kind}-pass1.html`);
  fs.writeFileSync(f1, harness(html1, MAP_MAX_IN));
  const r1 = run(f1);
  // Everything that must share page 1, minus the map box itself — measured,
  // not inferred from where the sections happened to land.
  const withoutMap = r1.page1RawPx - r1.mapPx;
  const fitted = fitMapHeightIn(withoutMap);

  // Pass 2: re-measure with the fitted map — this is what actually prints.
  const f2 = path.join(tmp, `${kind}-pass2.html`);
  fs.writeFileSync(f2, harness(html1, fitted));
  const r2 = run(f2);
  return { fitted, result: r2, withoutMap: Math.round(withoutMap) };
}

function run(file: string) {
  const out = execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=4000',
    '--dump-dom', `file://${file}`,
  ], { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const m = out.match(/<pre id="result">(.*?)<\/pre>/s);
  if (!m) throw new Error('measurement script did not run');
  return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
}

let fail = 0;
for (const kind of ['empty', 'full'] as const) {
  console.log(`\n${'='.repeat(64)}\nSCOPE TEXT: ${kind.toUpperCase()}\n${'='.repeat(64)}`);
  const { fitted, result, withoutMap } = measure(kind);
  console.log(`page-1 content excluding the map: ${withoutMap}px of ${Math.round(PAGE_CONTENT_PX)}px`);
  console.log(`map fitted to: ${fitted}in  (max ${MAP_MAX_IN}in, floor ${MAP_MIN_IN}in)`);
  console.log(`pages: ${result.pages}`);
  for (const s of result.sections) console.log(`   p${s.page}  ${String(s.height).padStart(4)}px  ${s.title}`);

  if (result.pages !== 3) { console.error(`   ✗ expected 3 pages, got ${result.pages}`); fail++; }
  else console.log('   ✓ three pages');

  if ((result.spills || []).length > 0) {
    for (const sp of result.spills) console.log(`   … ${sp.title} pushed to a new page, over by ${sp.overBy}px`);
  }
  if (result.overflowing.length > 0) {
    console.error(`   ✗ SECTION TALLER THAN A PAGE (would split): ${result.overflowing.join(', ')}`);
    fail++;
  } else console.log('   ✓ no section exceeds a page — break-inside:avoid cannot be violated');

  const scopePage = result.sections.find((s: any) => /Property Scope/.test(s.title))?.page;
  if (scopePage !== 1) { console.error(`   ✗ Property Scope landed on page ${scopePage}, not page 1`); fail++; }
  else console.log('   ✓ Property Scope finishes on page 1');
}

console.log(`\n${fail === 0 ? 'ALL PRINT CHECKS PASSED' : `${fail} PRINT CHECK(S) FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);

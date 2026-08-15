// PRINT VERIFICATION for the commercial snow contract.
//   npx tsx scripts/verify-snow-contract-print.tsx
//
// ── WHY THIS SCRIPT WAS REWRITTEN ────────────────────────────────────────────
// The previous version reported "3 pages, no splits" while real Chrome printed
// four pages, with no margins and a missing header band. It failed because it
// never let Chrome print. It rewrote `@media print {` to `@media all {`, laid
// the document out as ONE CONTINUOUS COLUMN, and then re-implemented CSS
// fragmentation in JavaScript. Everything it asserted came from that model,
// not from the printer. Three consequences, each of which hid a real defect:
//
//   · @page was moved somewhere it cannot apply, and the harness then
//     hard-coded the content width itself — so it was measuring margins it
//     supplied rather than margins the document sets. Item 2 was unfindable.
//   · Page count came from a JS loop over <section> heights. Chrome disagreed
//     by a whole page.
//   · It set the map height by hand instead of letting the component's
//     useLayoutEffect run, so the measured fit was bypassed by construction.
//   · It measured geometry only. A colour could not fail it.
//
// This version:
//   1. BUNDLES AND MOUNTS THE REAL COMPONENT in the browser, so the real
//      layout effects run and what gets printed is what the app renders.
//   2. Gets the page count from `--print-to-pdf`. That is Chrome's own
//      fragmentation engine — the same one the print dialog uses.
//   3. RASTERISES page 1 and reads pixels, so the header band's colour, the
//      side margins and the running footer are checked in the printed artefact
//      rather than inferred from the stylesheet.
//   4. Cross-checks its own DOM-side prediction against the PDF's real page
//      count and FAILS ON DISAGREEMENT. That guard is the point: it is the
//      check that would have caught the previous version lying.
//
// What is still inferred rather than observed: "no section splits" is proven
// by the geometric precondition — under break-inside:avoid a section can only
// be broken if it is taller than the content area — measured in the real print
// layout, plus the page-count agreement above. Chrome exposes no per-page
// element map, so that precondition is the strongest available check.
//
// Run at BOTH EXTREMES: an empty contract and a fully filled one. Page 1 is
// composed to a fixed height, so the pair now proves it CANNOT be grown.
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { PAGE_BUDGET_PX, FOOTER_RESERVE_PX, PAGE_MARGIN_IN, PAGE_SIDE_IN, MAP_BOX_IN } from '../src/lib/snowContractMap';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// PROJECT-LOCAL scratch: the generated entry imports ../src/… and needs the
// repo's node_modules on its resolution path, so it cannot live in /tmp.
const tmp = path.join(process.cwd(), 'scripts', '.print-verify');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
// PER-FIXTURE EXPECTATIONS, with the reason stated. The two fixtures are not
// the same document at different sizes — they are the two ends of how much
// the estimator can type, and they legitimately paginate differently.
// Page count of the rebuilt document, asserted so a clause edit that spills
// onto another page is visible rather than silent.
const PAGES = 5;
const EXPECT: Record<string, { pages: number; mapOnPage1: boolean; why: string }> = {
  // Page 1 is COMPOSED now — a fixed-height column that always ends with the
  // service-area map — so the map landing on page 1 is the check, not whether
  // a section flowed there. The page count is what the clause text comes to
  // once page 1 is fixed; both fixtures share it because nothing the estimator
  // types can grow page 1 any more.
  empty: { pages: PAGES, mapOnPage1: true, why: 'the composed page 1 plus the fixed clause text' },
  full: { pages: PAGES, mapOnPage1: true, why: 'a filled contract paginates the same — page 1 cannot grow' },
};

// NO --user-data-dir. It was added on a guess — one run died with SIGKILL and
// contention with the developer's own running Chrome seemed plausible — and it
// was measured afterwards rather than before: with an explicit profile
// directory this exact print hangs indefinitely on macOS (>150s, killed), and
// without one it completes in 1.8s. The guess was worse than the thing it was
// meant to fix, and the original SIGKILL was never actually explained. The
// timeout below is what bounds a recurrence now, which is the honest tool for
// an unexplained hang; the retries cover genuine startup flakiness.
//
// A print check that can hang forever is worse than one that fails. SIGKILL
// rather than SIGTERM because a wedged renderer will not honour the polite one.
const CHROME_TIMEOUT_MS = 90_000;
function chrome(args: string[]): string {
  const base = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    // Startup work that is pure latency for a one-shot render, and one source
    // of the nondeterminism this script was suffering from.
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  ];
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return execFileSync(CHROME, [...base, ...args], {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
        timeout: CHROME_TIMEOUT_MS, killSignal: 'SIGKILL',
      });
    } catch (e) { last = e; }
  }
  throw last;
}

// ── THE FIXTURE, as a module the bundle can import ───────────────────────────
const FIXTURE_SRC = `
import { newContract, withDerived } from '../../src/lib/snowContracts';
const LONG = ${JSON.stringify(
  'The serviced area comprises the main customer lot fronting Rosslyn Road, the rear loading dock and turnaround, the north-side employee parking strip, and the connecting drive aisle between them. Snow is stacked at the north-west corner of the rear lot and along the east fence line only. ',
)};
export function fixture(kind) {
  const c = newContract({ id: 'verify-' + kind, createdBy: 'verify', now: Date.parse('2026-08-07T12:00:00Z') });
  if (kind === 'empty') return c;
  c.client = {
    businessName: 'Northbridge Commercial Properties Inc.',
    siteContact: 'Pat Lindgren, Facilities · (807) 555-0142',
    billingContact: 'Dana Okonkwo, Accounts Payable · (807) 555-0198',
    billingEmail: 'ap@northbridge.example.ca',
    billingAddress: 'PO Box 4120, Thunder Bay, ON P7B 6T8',
    serviceAddress: '1175 Rosslyn Road, Thunder Bay, ON P7E 6X5',
  };
  // The two fields that print, at the longest anyone would reasonably type.
  c.scope.plowArea = LONG;
  c.scope.shovelArea = 'Front entrance apron, the accessible ramp on the south elevation, the side fire exit landing, and the path linking the rear dock to the employee door.';
  c.serviceLevel = 3;
  c.pricing.levels = {
    1: { seasonal: 18500, perVisit: 265 },
    2: { seasonal: 24000, perVisit: 340 },
    3: { seasonal: 31200, perVisit: 425 },
  };
  c.pricing.selectedOption = 'A';
  c.pricing.optionAPayment = 'instalments';
  c.serviceTerms.serviceWindow = 'overnight';
  // A photo, FRAMED: the crop is pinned to the TOP of the picture, so the Proves the
  // banner shows the top band and nothing else. Proves the stored crop
  // reaches the printed page rather than living only in the editor.
  c.scope.sitePhoto = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPScxMjAwJyBoZWlnaHQ9JzkwMCc+PHJlY3QgeT0nMCcgd2lkdGg9JzEyMDAnIGhlaWdodD0nMzAwJyBmaWxsPScjZGZlNmVjJy8+PHJlY3QgeT0nMzAwJyB3aWR0aD0nMTIwMCcgaGVpZ2h0PSczMDAnIGZpbGw9JyNjZmQ4ZTAnLz48cmVjdCB5PSc2MDAnIHdpZHRoPScxMjAwJyBoZWlnaHQ9JzMwMCcgZmlsbD0nI2JmYzlkNCcvPjwvc3ZnPg==';
  c.scope.sitePhotoView = { zoom: 1, x: 0, y: -50, fit: false };
  return withDerived(c);
}
`;

// THE REAL COMPONENT, mounted the way SnowContractsModule mounts it for print.
// Nothing here re-implements the document; the effects that size the map run
// exactly as they do in the app.
const ENTRY_SRC = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import SnowContractDocument from '../../src/components/SnowContractDocument';
import { fixture } from './fixture';
const kind = document.documentElement.getAttribute('data-kind');
createRoot(document.getElementById('root')).render(
  React.createElement(SnowContractDocument, { contract: fixture(kind), mode: 'print' }),
);
`;

function bundle(): string {
  fs.writeFileSync(path.join(tmp, 'fixture.ts'), FIXTURE_SRC);
  fs.writeFileSync(path.join(tmp, 'entry.tsx'), ENTRY_SRC);
  const out = path.join(tmp, 'bundle.js');
  esbuild.buildSync({
    entryPoints: [path.join(tmp, 'entry.tsx')],
    bundle: true, outfile: out, format: 'iife', platform: 'browser', target: 'chrome110',
    absWorkingDir: process.cwd(), logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  });
  return fs.readFileSync(out, 'utf8');
}

function pageHtml(js: string, kind: string, extraScript = ''): string {
  return `<!doctype html><html data-kind="${kind}"><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#fff}</style></head>
<body><div id="root"></div><script>${js}</script><script>${extraScript}</script></body></html>`;
}

// ── 1. REAL PAGINATION ───────────────────────────────────────────────────────
function printToPdf(js: string, kind: string): { pages: number; pdf: string; mediaBox: string } {
  const html = path.join(tmp, `${kind}.html`);
  const pdf = path.join(tmp, `${kind}.pdf`);
  fs.writeFileSync(html, pageHtml(js, kind));
  chrome(['--virtual-time-budget=8000', `--print-to-pdf=${pdf}`, '--no-pdf-header-footer', `file://${html}`]);
  const s = fs.readFileSync(pdf).toString('latin1');
  const counts = [...s.matchAll(/\/Count\s+(\d+)/g)].map(m => Number(m[1]));
  const media = [...new Set([...s.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map(m => m[1].trim()))];
  if (!counts.length) throw new Error('could not read a page count from the PDF');
  return { pages: Math.max(...counts), pdf, mediaBox: media.join(' | ') };
}

// ── 2. PIXELS OF THE PRINTED PAGE ────────────────────────────────────────────
// qlmanage rasterises page 1. Chrome then reads the pixels back, which avoids
// hand-rolling a PNG decoder for the sake of four samples.
function rasterProbe(pdf: string, kind: string) {
  const dir = path.join(tmp, `raster-${kind}`);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('qlmanage', ['-t', '-s', '1700', '-o', dir, pdf], { stdio: 'ignore' });
  const png = path.join(dir, fs.readdirSync(dir)[0]);
  const probe = path.join(tmp, `probe-${kind}.html`);
  fs.writeFileSync(probe, `<!doctype html><meta charset=utf-8><body><pre id=o></pre><script>
var i=new Image();i.onload=function(){
  var cv=document.createElement('canvas');cv.width=i.width;cv.height=i.height;
  var x=cv.getContext('2d');x.drawImage(i,0,0);
  var S=i.width/8.5;                                  // px per inch of paper
  function at(xi,yi){var d=x.getImageData(Math.round(xi*S),Math.round(yi*S),1,1).data;return [d[0],d[1],d[2]];}
  // A horizontal run: is any pixel non-white across this strip?
  function ink(y0,y1,x0,x1){
    var d=x.getImageData(Math.round(x0*S),Math.round(y0*S),Math.round((x1-x0)*S),Math.max(1,Math.round((y1-y0)*S))).data;
    for(var k=0;k<d.length;k+=4){ if(d[k]<245||d[k+1]<245||d[k+2]<245) return true; }
    return false;
  }
  document.getElementById('o').textContent=JSON.stringify({
    w:i.width, h:i.height,
    band: at(4.25, ${PAGE_MARGIN_IN} + 0.30),            // middle of the header band
    leftGutterInk: ink(0, 11, 0, ${PAGE_SIDE_IN} - 0.10),   // must stay clean
    rightGutterInk: ink(0, 11, 8.5 - ${PAGE_SIDE_IN} + 0.10, 8.5),
    // The footer is the last thing INSIDE the content area, not something in
    // the bottom margin: the content box ends at 11in less the bottom @page
    // margin, so sample the strip just above that line.
    footerInk: ink(11 - ${PAGE_MARGIN_IN} - 0.30, 11 - ${PAGE_MARGIN_IN} - 0.02, ${PAGE_SIDE_IN}, 8.5 - ${PAGE_SIDE_IN}),
    // THE MAP ROW, READ OFF THE PAPER. Page 1 is a fixed column that always
    // ends with the service-area map, so this strip is map box and legend or
    // it is nothing. It exists because the DOM-side check passed while the
    // printed page had a 3.75in hole in it: the row sat at exactly the page
    // boundary, and break-inside:avoid moved it to page 2 where no geometry
    // measured on the staging layout could see it.
    mapRowInk: ink(9.0, 9.8, ${PAGE_SIDE_IN}, 8.5 - ${PAGE_SIDE_IN}),
    // The site photo banner, sampled in its middle. The fixture pans a
    // three-band image so that ONE known band fills the banner — if the
    // stored framing were ignored, a different band would be here.
    banner: at(4.25, 2.4),
  });
};i.src='file://${png}';
</script>`);
  const dom = chrome(['--allow-file-access-from-files', '--virtual-time-budget=6000', '--dump-dom', `file://${probe}`]);
  const m = dom.match(/<pre id="o">(\{.*?\})<\/pre>/s);
  if (!m) throw new Error('pixel probe did not run');
  return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
}

// ── 3. LAYOUT GEOMETRY, in the real print layout ─────────────────────────────
// .snowdoc-print carries the print rules on screen (same 8.6pt, same 7.5in
// content width, same break rules), so these are print measurements — not a
// screen layout with the stylesheet swapped underneath it.
const MEASURE = `
  requestAnimationFrame(function(){ requestAnimationFrame(function(){
    var doc = document.querySelector('.snowdoc');
    var origin = doc.getBoundingClientRect().top;
    var out = { sections: [], overflowing: [], predictedPages: 1, mapIn: 0, contentWidthPx: 0 };
    // The running footer is a <tfoot>: it reserves its own height on EVERY
    // page, so the usable content height is the page less that footer.
    var footEl = doc.querySelector('.foot');
    out.footerPx = footEl ? Math.ceil(footEl.getBoundingClientRect().height) : 0;
    var PAGE = ${PAGE_BUDGET_PX};
    out.pageBudgetPx = Math.round(PAGE);
    var firstSec = doc.querySelector('section');
    out.contentWidthPx = firstSec ? Math.round(firstSec.getBoundingClientRect().width) : 0;
    var mw = doc.querySelector('.mapwrap');
    out.mapIn = mw ? Math.round(mw.getBoundingClientRect().height / 96 * 100) / 100 : 0;
    // The composed page 1 has to END inside one page. Measured from the top
    // of the document to the bottom of the map row — the last thing on it.
    out.mapBottomPx = mw ? Math.round(mw.getBoundingClientRect().bottom - origin) : 0;
    out.mapOnPage1 = !!mw && out.mapBottomPx <= PAGE;
    // A .pagegrid.brk starts a new page BEFORE itself; .pb (unused by the
    // current structure, kept so the model still covers it) breaks after.
    var nodes = [].slice.call(doc.querySelectorAll('section, .pb, .pagegrid.brk'));
    var pageStart = 0, page = 1;
    nodes.forEach(function(n){
      var r = n.getBoundingClientRect(), top = r.top - origin, bottom = r.bottom - origin;
      if (n.classList.contains('pb')) { page++; pageStart = bottom; return; }
      if (n.classList.contains('pagegrid')) { page++; pageStart = top; return; }
      if (bottom - pageStart > PAGE) { page++; pageStart = top; }
      var h = n.querySelector('h2');
      out.sections.push({ title: h ? h.textContent.trim() : '(untitled)', page: page, height: Math.round(r.height) });
      if (r.height > PAGE) out.overflowing.push(h ? h.textContent.trim() : '(untitled)');
      out.predictedPages = Math.max(out.predictedPages, page);
    });
    var pre = document.createElement('pre'); pre.id = 'result';
    pre.textContent = JSON.stringify(out); document.body.appendChild(pre);
  })});
`;

function measureLayout(js: string, kind: string) {
  const f = path.join(tmp, `${kind}-measure.html`);
  fs.writeFileSync(f, pageHtml(js, kind, MEASURE));
  // Retried: the measurement runs off requestAnimationFrame and occasionally
  // loses the race with --virtual-time-budget. That is a flaky harness rather
  // than a failing document, and a check people learn to re-run twice is a
  // check people learn to ignore.
  let m: RegExpMatchArray | null = null;
  for (let attempt = 0; attempt < 3 && !m; attempt++) {
    const dom = chrome(['--virtual-time-budget=20000', '--dump-dom', `file://${f}`]);
    m = dom.match(/<pre id="result">(.*?)<\/pre>/s);
  }
  if (!m) throw new Error('layout measurement did not run after 3 attempts');
  return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
}

// ── RUN ──────────────────────────────────────────────────────────────────────
const js = bundle();
let fail = 0;
const bad = (msg: string) => { console.error(`   ✗ ${msg}`); fail++; };
const ok = (msg: string) => console.log(`   ✓ ${msg}`);
const mapHeights: Record<string, number> = {};

for (const kind of ['empty', 'full'] as const) {
  console.log(`\n${'='.repeat(66)}\nFIXTURE: ${kind.toUpperCase()}\n${'='.repeat(66)}`);
  const { pages, pdf, mediaBox } = printToPdf(js, kind);
  const layout = measureLayout(js, kind);
  const px = rasterProbe(pdf, kind);

  console.log(`real Chrome pagination: ${pages} page(s)   MediaBox ${mediaBox}`);
  console.log(`content width: ${layout.contentWidthPx}px   map box ${layout.mapIn}in   running footer ${layout.footerPx}px → page budget ${layout.pageBudgetPx}px`);
  for (const s of layout.sections) console.log(`   p${s.page}  ${String(s.height).padStart(4)}px  ${s.title}`);

  // COVERAGE, ASSERTED. Every claim below is worth exactly nothing if the
  // thing it inspects was never rendered. That is the failure mode that made
  // the previous version of this script dangerous — it passed while measuring
  // something the printer never saw — so the pieces each check depends on are
  // now themselves checks, and a refactor that removes one FAILS here rather
  // than quietly turning its check into a tautology.
  if (!layout.sections.length) bad('no <section> elements rendered — every layout check below is vacuous');
  if (!layout.mapIn) bad('no map box rendered — the page-1 checks below are vacuous');
  if (!layout.footerPx) bad('no footer element rendered — the running-footer check below is vacuous');
  else if (layout.footerPx > FOOTER_RESERVE_PX) {
    bad(`the running footer measures ${layout.footerPx}px but the page budget reserves only ${FOOTER_RESERVE_PX}px `
      + 'per page — FOOTER_RESERVE_PX is stale and every page budget below is over-optimistic');
  }
  if (!layout.contentWidthPx) bad('content width measured as 0 — the margin checks below are vacuous');
  mapHeights[kind] = layout.mapIn;

  // THE GUARD. If the cheap DOM-side model and Chrome's printer disagree, the
  // model is wrong and every other geometric claim here is worthless.
  if (layout.predictedPages !== pages) {
    bad(`MODEL DISAGREES WITH THE PRINTER: layout predicts ${layout.predictedPages} pages, `
      + `Chrome printed ${pages}. Trust the PDF and fix the model before trusting anything below.`);
  } else ok(`layout model agrees with Chrome (${pages} pages)`);

  const expect = EXPECT[kind];
  if (pages !== expect.pages) bad(`expected ${expect.pages} pages (${expect.why}), Chrome printed ${pages}`);
  else ok(`${expect.pages} pages — ${expect.why}`);

  if (mediaBox !== '0 0 612 792') bad(`paper is not Letter: MediaBox ${mediaBox}`);
  else ok('Letter paper');

  if (layout.overflowing.length) bad(`section taller than a page — WILL split: ${layout.overflowing.join(', ')}`);
  else ok('no section exceeds the content height — break-inside:avoid cannot be violated');

  // The whole composed block — band through map — has to land on page 1.
  // TWO checks on purpose: the model says it fits, the PAPER says it printed.
  if (expect.mapOnPage1 && !layout.mapOnPage1) bad('layout puts the service-area map past the end of page 1');
  else if (expect.mapOnPage1) ok('layout: the composed page 1 (header, photo, Sections 1–2, map) fits');
  if (expect.mapOnPage1 && !px.mapRowInk) {
    bad('NOTHING PRINTED where the service-area map belongs — the row was pushed off page 1 '
      + 'and page 1 has a hole in it, whatever the layout model says');
  } else if (expect.mapOnPage1) ok('the map row printed on page 1');

  // Printed-artefact checks. These read the paper, not the stylesheet.
  const [r, g, b] = px.band;
  const isBlue = b > 120 && b - r > 60;
  if (!isBlue) bad(`header band did not print — pixel at the band centre is rgb(${r},${g},${b}), not the #0d6cb5 blue`);
  else ok(`header band printed blue rgb(${r},${g},${b})`);

  if (px.leftGutterInk) bad(`content runs into the left margin (inside ${PAGE_SIDE_IN}in)`);
  else ok(`left margin clear to ${PAGE_SIDE_IN}in`);
  if (px.rightGutterInk) bad(`content runs into the right margin (inside ${PAGE_SIDE_IN}in)`);
  else ok(`right margin clear to ${PAGE_SIDE_IN}in`);

  // The framed photo, read off the paper. 'empty' has no photo, so only the
  // filled fixture can make this claim.
  if (kind === 'full') {
    // The fixture's photo is three flat bands and its crop is pinned to the
    // TOP one, so the banner's centre pixel is a known colour. Any other value
    // means the framing was ignored (a different band), or the photo did not
    // print at all (the empty box's #fbfdfe).
    const TOP_BAND = [223, 230, 236];
    const [br, bg, bb] = px.banner;
    const framed = TOP_BAND.every((c, i) => Math.abs(c - px.banner[i]) <= 6);
    if (!framed) {
      bad(`the site photo did not print with its stored framing — banner centre is `
        + `rgb(${br},${bg},${bb}), expected the top band rgb(${TOP_BAND.join(',')})`);
    } else ok(`site photo printed, cropped to the band it was framed on rgb(${br},${bg},${bb})`);
  }
  if (!px.footerInk) bad('no running footer on page 1 — the footer is printing on the last page only');
  else ok('running footer present on page 1');
}

// The two fixtures exist to prove page 1 CANNOT be grown by anything typed
// into it. The old pair drove a measured map fit to opposite ends; there is
// no fit any more, so the invariant inverts — an empty contract and a fully
// filled one must paginate identically and hold the map at its fixed size.
// If these ever differ, something above the fold has started to flex again
// and the "composed page" is a fiction.
console.log(`\n${'─'.repeat(66)}`);
if (mapHeights.empty !== mapHeights.full) {
  console.error(`   ✗ the map printed at ${mapHeights.empty}in empty but ${mapHeights.full}in full — `
    + 'page 1 is flexing with its content again');
  fail++;
} else if (Math.abs(mapHeights.full - MAP_BOX_IN) > 0.02) {
  console.error(`   ✗ the map printed at ${mapHeights.full}in, not the fixed ${MAP_BOX_IN}in box`);
  fail++;
} else {
  console.log(`   ✓ page 1 is fixed: the map held ${mapHeights.full}in on both fixtures`);
}

console.log(`\n${fail === 0 ? 'ALL PRINT CHECKS PASSED' : `${fail} PRINT CHECK(S) FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);

// SNOWMASTER · COMMERCIAL CONTRACT — THE RENDERED DOCUMENT.
//
// ONE COMPONENT, TWO CONTEXTS: the editor's live preview and the print view
// are the same render. There is no second implementation to drift — what the
// estimator sees while typing is what the client receives.
//
// The CSS below is transcribed from reference/Marcos_Snow_Contract_Builder.html
// (fonts, sizes, colours, rules, spacing, page breaks) and scoped under
// .snowdoc so it cannot leak into the app's Tailwind styling. Values are the
// reference's own — 8.2pt body rising to 8.6pt in print, #0d6cb5 blue, the
// 1.5px section rule, the 3.75in square map box — not approximations of them.
import type { ReactNode } from 'react';
import type { SnowContract } from '../types';
import { SNOW_LOGO_DATA_URI, SNOW_LOGO_DARK_DATA_URI } from '../assets/snowLogo';
import {
  staticMapUrl, PAGE_MARGIN_IN, PAGE_SIDE_IN, PAGE_CONTENT_PX, PAGE1_HEIGHT_PX,
  MAP_BOX_IN, PHOTO_MIN_IN,
} from '../lib/snowContractMap';
import { GOOGLE_MAPS_API_KEY } from '../lib/googleMaps';
import {
  DOC_TITLE, CONTRACTOR_FOOTER_NAME, CONTRACTOR_ADDRESS, OFFICE_PHONE, OFFICE_EMAIL,
  SERVICE_LINE, CLIENT_INTRO, CLIENT_FIELD_LABELS, SCOPE_INTRO,
  HEAD_QUOTE_DATE, HEAD_VALID_UNTIL, HEAD_TERM, PHOTO_PLACEHOLDER,
  MAP_HEAD_TITLE, MAP_HEAD_NOTE, MAP_PLACEHOLDER, MAP_LEGEND, MAP_STORAGE_NOTE,
  SCOPE_FIELD_PLOW, SCOPE_FIELD_SHOVEL,
  LEVEL_INTRO, LEVEL_TABLE_HEAD, SERVICE_LEVELS, LEVEL_NOTES,
  PRICING_INTRO, PRICING_TABLE_HEAD, PRICING_ROW_SUFFIX, PRICING_HST_SUFFIX,
  PRICING_PER_VISIT_SUFFIX, OPTION_A_TITLE, OPTION_A_SUB, OPTION_A_PAY_LABEL,
  OPTION_A_PAY_INSTALMENTS, OPTION_A_PAY_PREPAY_PARTS, OPTION_A_EXTRAS_LABEL,
  OPTION_A_EXTRAS, OPTION_B_TITLE, OPTION_B_SUB, OPTION_B_PAY, OPTION_B_EXTRAS,
  ADDITIONAL_SERVICES_TITLE, ADDITIONAL_SERVICES, ADDITIONAL_SERVICES_NOTE,
  TRIGGER_LABELS, WINDOW_OVERNIGHT_PARTS, WINDOW_DAYTIME_PARTS, WINDOW_NON_PRIORITY_PARTS,
  TRIGGER_BULLETS, PAYMENT_BULLETS, PROPERTY_DAMAGE, LIABILITY, ICE_CONDITIONS, DELAYS,
  INSURANCE_PARTS, TERMINATION, CONTACT_NOTE, ACCEPTANCE_PARAS, SIGNATURE_LABELS,
  SECTIONS,
} from '../lib/snowContractText';
import type { Run } from '../lib/snowContractText';

// Renders one transcribed run list. Bold spans sit mid-sentence in the new
// clause text, so the text is held as runs and joined here rather than being
// split across constants — see the Run type.
const Rich = ({ runs }: { runs: Run[] }) => (
  <>{runs.map((r, i) => (typeof r === 'string' ? r : <b key={i}>{r.b}</b>))}</>
);
// A transcribed multi-paragraph clause, in the legal type style.
const Legal = ({ paras }: { paras: Run[][] }) => (
  <>{paras.map((p, i) => <p key={i} className="legal"><Rich runs={p} /></p>)}</>
);

const money = (n: number) =>
  (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// An amount nobody has entered prints as a BLANK RULE to write on, not as
// "$ 0.00". A contract that states a price of zero is a different document
// from one with the price left open, and printing the first when you meant
// the second is the expensive direction of that mistake.
const Money = ({ v }: { v?: number | null }) => <F v={v ? money(v) : ''} />;

const dateLong = (ymd: string) => {
  if (!ymd) return '';
  const d = new Date(`${ymd}T12:00:00`);
  return Number.isNaN(d.getTime()) ? ymd
    : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

// The reference's CSS, verbatim in its values, scoped under .snowdoc.
//
// LIST SPACING follows the new reference: 5px between items, down from the old
// 9px. Section 5 alone now carries twelve bullets, and at 9px it ran a page
// longer for nothing — the reference tightened the same value for the same
// reason. Verified by scripts/verify-snow-contract-print.tsx on both fixtures.
//
// THE PRINT RULES ARE EMITTED TWICE, under @media print and under
// .snowdoc-print. The print window renders this component to the SCREEN first
// and only then calls print(); if that staging render uses the screen metrics
// (8.2pt, a window-width sheet) the composed page 1 is laid out against a
// geometry that never prints. Emitting the same rules for the staging class
// makes what is staged and what Chrome paginates the same layout.
const PRINT_RULES = (p: string) => `
${p} { font-size:8.6pt; }
/* SIDE MARGINS AS PADDING — see snowContractMap.ts. @page carries top/bottom
   only, so a dialog set to "Margins: None" cannot run the rules to the edge. */
${p} .sheet { max-width:none; margin:0; padding:0 ${PAGE_SIDE_IN}in; }
/* HARD REQUIREMENT: no section splits across a page. The row-level rules
   matter as much as the section-level one — a section that genuinely cannot
   fit will still break, and it must break BETWEEN rows, never through one. */
${p} section, ${p} .opt, ${p} .keep,
${p} .svc tr, ${p} .rate tr, ${p} .kv tr, ${p} .sig tr { page-break-inside:avoid; break-inside:avoid; }
${p} h2 { page-break-after:avoid; break-after:avoid; }
${p} li { page-break-inside:avoid; break-inside:avoid; }
${p} .pb { page-break-after:always; break-after:page; }
${p} .pagegrid.brk { page-break-before:always; break-before:page; }
/* RUNNING FOOTER — see the .pagegrid note below. Chrome supports neither
   @bottom-center nor repeating a position:fixed element (both were tried and
   print once, on the last page and the first respectively); a <tfoot> is the
   one mechanism it actually repeats. */
${p} .foot { margin:0; padding:3px 0 0; }
/* A <tfoot> sits directly UNDER its table's content, so a page group shorter
   than a page would print its footer floating mid-page. Giving every group a
   full page of height pushes the footer to the foot of the paper; content
   stays top-aligned, and a group with more than a page of content simply
   fragments and repeats the footer on each page as intended. */
/* The FULL page height, not the content budget: the table carries its own
   footer, so the tbody is left with exactly PAGE_BUDGET_PX. Sizing it to the
   budget instead cost the tbody a second footer-height and fragmented the
   last group onto an extra page. */
${p} .pagegrid { height:${PAGE_CONTENT_PX - 1}px; }
${p} .pagegrid > tbody > tr > td { vertical-align:top; }
/* The first heading on a page needs no space above it — the page margin is
   already that space. Seven pixels per group, reclaimed from nothing. */
${p} .pagegrid > tbody > tr > td > section:first-child h2 { margin-top:0; }
/* Signing gap trimmed from the reference's 44px. This is whitespace inside the
   signature block, not type, and 36px is still a generous line to sign on —
   preferred over shaving the reference's typography to win the same 8px. */
${p} .sig td { padding-top:36px; }
`;

const DOC_CSS = `
.snowdoc, .snowdoc * { box-sizing: border-box; }
/* PRINT COLOUR IS NOT OPTIONAL. Chrome's print dialog ships with "Background
   graphics" UNTICKED, and that drops every background colour and image while
   keeping text colours — the blue band paints white, and the white title and
   light logo vanish into it. This overrides that setting; the header does not
   depend on the operator finding a checkbox. */
.snowdoc, .snowdoc * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.snowdoc { font-family: "DejaVu Sans", Arial, Helvetica, sans-serif; font-size: 8.2pt;
  color: #16232e; line-height: 1.32; }
.snowdoc .sheet { background:#fff; max-width: 8.5in; margin: 0 auto; padding: 0.42in 0.5in; }
.snowdoc .band { background:#0d6cb5; color:#fff; padding:11px 16px; margin-bottom:10px;
  display:flex; align-items:center; justify-content:space-between; }
.snowdoc .band .lock { display:flex; align-items:center; gap:13px; }
/* TWO-LAYER MARK — the belt-and-braces half of the header fix. The DARK mark
   is a plain <img>, so it always prints. Over it sits a layer carrying the
   band colour and the light mark as BACKGROUNDS; when backgrounds render, that
   layer hides the dark one and the header looks exactly as designed. If a
   print path drops backgrounds anyway, the cover disappears with them and the
   dark mark is left on the white band — legible either way, no JS, no query. */
.snowdoc .band .mark { position:relative; display:block; width:38px; height:38px; flex:none; }
.snowdoc .band .mark img.dk { display:block; width:100%; height:100%; object-fit:contain; }
.snowdoc .band .mark .lt { position:absolute; inset:0;
  background:#0d6cb5 url("${SNOW_LOGO_DATA_URI}") center/contain no-repeat; }
.snowdoc .band .t { text-align:right; }
.snowdoc .band .t .a { font-size:13.5pt; font-weight:bold; letter-spacing:.3px; }
.snowdoc .band .t .b { font-size:7.5pt; opacity:.9; letter-spacing:1.3px; text-transform:uppercase; margin-top:2px; }
.snowdoc h2 { font-size:8.8pt; text-transform:uppercase; letter-spacing:1.1px; color:#0d6cb5;
  border-bottom:1.5px solid #0d6cb5; padding-bottom:2px; margin:7px 0 4px; display:flex; align-items:baseline; }
.snowdoc h2 .n { color:#9fb6c8; margin-right:6px; }
.snowdoc p { margin:0 0 8px; }
.snowdoc ul { margin:0 0 9px; padding-left:14px; }
.snowdoc li { margin-bottom:5px; }   /* the reference's own value */
.snowdoc table { width:100%; border-collapse:collapse; }
.snowdoc .kv td { padding:5px 6px; border-bottom:1px solid #cfdce7; vertical-align:bottom; }
.snowdoc .kv td.l { width:26%; font-weight:bold; font-size:7.5pt; color:#45596b;
  text-transform:uppercase; letter-spacing:.4px; }
.snowdoc .svc th { background:#eaf2f9; color:#14486f; font-size:7pt; text-transform:uppercase;
  letter-spacing:.5px; padding:7px 6px; text-align:left; border:1px solid #cfdce7; }
.snowdoc .svc td { border:1px solid #cfdce7; padding:3.6px 6px; font-size:8.1pt; }
.snowdoc .svc td.c { text-align:center; width:8%; }
.snowdoc .opt { border:1.5px solid #0d6cb5; padding:9px 11px; margin-bottom:9px; }
.snowdoc .opt .h { font-weight:bold; font-size:9.5pt; color:#0d6cb5; margin-bottom:3px; }
.snowdoc .opt .sub { font-size:7.8pt; color:#45596b; margin-bottom:5px; }
.snowdoc .rate td { padding:2.6px 6px; border-bottom:1px dotted #c3d1dd; font-size:8.4pt; }
.snowdoc .rate td.f { width:34%; }
.snowdoc .small { font-size:7.8pt; color:#45596b; }
.snowdoc .legal { font-size:7.4pt; line-height:1.45; margin-bottom:9px; text-align:justify; color:#33434f; }
.snowdoc .sig td { padding-top:44px; font-size:8.2pt; }
.snowdoc .sigline { border-bottom:1px solid #16232e; height:1px; margin-bottom:2px; }
.snowdoc .foot { margin-top:6px; border-top:1px solid #cfdce7; padding-top:6px;
  font-size:7pt; color:#7a8794; display:flex; justify-content:space-between; }
.snowdoc .f { display:inline-block; min-width:70px; border-bottom:1px solid #b9c7d3; padding:0 3px; }
.snowdoc .f.blk { display:block; min-height:14px; }
.snowdoc .cb { font-size:11.5pt; line-height:1; color:#5d7185; }
.snowdoc .cb.on { color:#0d6cb5; }
/* ── PAGE 1, COMPOSED ──────────────────────────────────────────────────────
   A fixed-height flex column. Everything in it is intrinsically sized except
   the photo banner, which is flex:1 and therefore absorbs whatever height is
   left. That is what replaced the measure-and-shrink pass: there is nothing
   left above the fold that can grow without bound. */
.snowdoc .page1 { display:flex; flex-direction:column; height:${PAGE1_HEIGHT_PX}px; }
.snowdoc .prophead { display:flex; align-items:flex-end; justify-content:space-between;
  gap:14px; margin-bottom:6px; }
.snowdoc .prophead .addr { font-size:12pt; font-weight:bold; color:#16232e; line-height:1.2; }
.snowdoc .prophead .meta { font-size:7.5pt; color:#45596b; text-align:right; line-height:1.5;
  white-space:nowrap; }
.snowdoc .photowrap { border:1px solid #cfdce7; background:#fbfdfe; position:relative;
  margin:0 0 11px; flex:1 1 auto; min-height:${PHOTO_MIN_IN}in; display:flex;
  align-items:center; justify-content:center; overflow:hidden; }
.snowdoc .photowrap img { width:100%; height:100%; object-fit:cover; display:block; }
.snowdoc .photowrap .ph { color:#a8b8c6; font-size:8pt; letter-spacing:.6px; text-transform:uppercase; }
.snowdoc .maphead { display:flex; align-items:baseline; justify-content:space-between;
  gap:14px; margin-top:9px; }
.snowdoc .maphead .t { font-size:10.5pt; font-weight:bold; color:#16232e; }
.snowdoc .maphead .n { font-size:7.5pt; color:#45596b; text-align:right; }
/* The map is a fixed square with the legend filling the rest of the row. */
.snowdoc .maprow { display:flex; gap:8px; margin-top:5px; flex:0 0 auto; height:${MAP_BOX_IN}in; }
.snowdoc .mapwrap { flex:0 0 auto; width:${MAP_BOX_IN}in; height:${MAP_BOX_IN}in;
  border:1px solid #cfdce7; position:relative; background:#fbfdfe;
  display:flex; align-items:center; justify-content:center; overflow:hidden; }
.snowdoc .mapwrap img { width:100%; height:100%; object-fit:contain; }
.snowdoc .mapwrap .ph { color:#a8b8c6; font-size:8pt; letter-spacing:.6px; text-transform:uppercase; }
.snowdoc .legcol { flex:1 1 auto; border:1px solid #cfdce7; background:#fbfdfe; padding:13px 14px; }
.snowdoc .legcol .r { display:flex; align-items:flex-start; gap:9px; font-size:8.6pt;
  margin-bottom:13px; line-height:1.35; }
.snowdoc .legcol .k { width:15px; height:15px; border-radius:2px; flex:none; margin-top:1px; }
.snowdoc .legcol .legnote { font-size:7.4pt; color:#8fa3b4; line-height:1.5; margin-top:15px;
  border-top:1px solid #cfdce7; padding-top:11px; }
.snowdoc .legcol .scopef { margin-top:13px; border-top:1px solid #cfdce7; padding-top:11px; }
.snowdoc .legcol .scopef .l { font-size:7.5pt; font-weight:bold; color:#45596b;
  text-transform:uppercase; letter-spacing:.5px; margin-bottom:2px; }
.snowdoc .legcol .scopef .v { border-bottom:1px solid #b9c7d3; min-height:38px; margin-bottom:11px;
  font-size:8.4pt; padding:1px 2px; }
.snowdoc .legcol .scopef .v:last-child { margin-bottom:0; }
.snowdoc .pb { break-after:page; page-break-after:always; }
/* THE PAGE GRID. A repeating <tfoot> is the only running-footer mechanism
   Chrome honours — @bottom-center is unsupported and position:fixed prints
   once — and it reserves its own height on every page, so nothing has to guess
   at a bottom margin.
   ONE TABLE PER PAGE GROUP, not one table for the document: a forced break
   INSIDE a table cell is not honoured cleanly (it cost two spurious pages when
   tried), so the group breaks live BETWEEN the tables where they are ordinary
   block-level breaks. Layout scaffolding only — no borders, no padding, no
   visual presence of its own. */
.snowdoc .pagegrid { width:100%; border-collapse:collapse; }
.snowdoc .pagegrid > tbody > tr > td, .snowdoc .pagegrid > tfoot > tr > td { padding:0; border:0; }

/* Screen staging for the print window: the page box at true printed width, so
   the measured fit runs against printed geometry. */
.snowdoc-print { width:8.5in; margin:0 auto; background:#fff; }
${PRINT_RULES('.snowdoc-print')}
.snowdoc-print .foot { position:static; padding:3px 0 0; }

@media print {
  @page { size: Letter; margin: ${PAGE_MARGIN_IN}in 0 ${PAGE_MARGIN_IN}in 0; }
  .snowdoc-print { width:auto; margin:0; }
${PRINT_RULES('.snowdoc')}
}
`;

const CB = ({ on }: { on: boolean }) => <span className={`cb${on ? ' on' : ''}`}>{on ? '☑' : '☐'}</span>;

// A value that may be empty — the reference draws a ruled blank either way, so
// an unfilled field prints as a line to write on rather than collapsing.
const F = ({ v, blk }: { v?: string | number; blk?: boolean }) => (
  <span className={`f${blk ? ' blk' : ''}`}>{v === '' || v == null ? ' ' : String(v)}</span>
);

export interface SnowContractDocumentProps {
  contract: SnowContract;
  // 'print' drops the on-screen page framing; 'preview' keeps a light shadow so
  // the sheet reads as a page inside the editor.
  mode?: 'preview' | 'print';
}

export default function SnowContractDocument({ contract: c, mode = 'preview' }: SnowContractDocumentProps) {
  const hidden = new Set(c.hiddenSections || []);
  const show = (id: string) => !hidden.has(id);

  // NO MEASURED FIT ANY MORE — page 1 is a fixed-height flex column and the
  // photo banner absorbs the slack. See PAGE1_HEIGHT_PX in snowContractMap.ts.
  const sec = (id: string) => SECTIONS.find(s => s.id === id)!;
  const H = ({ id }: { id: string }) => {
    const s = sec(id);
    return <h2><span className="n">{s.n}</span>{s.title}</h2>;
  };
  const Foot = () => (
    <div className="foot">
      <span>{CONTRACTOR_FOOTER_NAME} &nbsp;|&nbsp; {CONTRACTOR_ADDRESS}</span>
      <span>{OFFICE_PHONE} &nbsp;|&nbsp; {OFFICE_EMAIL}</span>
    </div>
  );

  // One page group = one table with its own repeating footer. `brk` forces the
  // group to start a new page; the first group does not carry it.
  const Page = ({ brk, children }: { brk?: boolean; children: ReactNode }) => (
    <table className={`pagegrid${brk ? ' brk' : ''}`}>
      {/* Declared before the body — that is the order <tfoot> requires; it
          still renders at the foot of every page the group occupies. */}
      <tfoot><tr><td><Foot /></td></tr></tfoot>
      <tbody><tr><td>{children}</td></tr></tbody>
    </table>
  );

  return (
    <div className={`snowdoc${mode === 'preview' ? ' snowdoc-preview' : ' snowdoc-print'}`}>
      <style>{DOC_CSS}</style>
      <div className="sheet">
       <Page>
        {/* PAGE 1 IS COMPOSED. Band, property head, photo banner, Sections 1
            and 2, then the service-area map — one fixed-height column, with
            the photo taking whatever height the rest leaves. */}
        <div className="page1">
        {/* HEADER BAND */}
        <div className="band">
          <div className="lock">
            <span className="mark">
              <img className="dk" src={SNOW_LOGO_DARK_DATA_URI} alt="Marco's Snow" />
              <span className="lt" aria-hidden="true" />
            </span>
          </div>
          <div className="t">
            <div className="a">{DOC_TITLE}</div>
            <div className="b">
              Season <span className="f">{c.season.replace('/', ' / ')}</span> &nbsp;&nbsp;{CONTRACTOR_FOOTER_NAME}
            </div>
          </div>
        </div>

        {/* PROPERTY HEAD — the address is the page's title; the dates that
            govern the quote sit beside it. The validity date lives HERE, not
            inside a section, which is what Acceptance points at. */}
        <div className="prophead">
          <div className="addr"><F v={c.client.serviceAddress} /></div>
          <div className="meta">
            {HEAD_QUOTE_DATE} <F v={dateLong(c.quoteDate)} /> &nbsp;·&nbsp;
            {HEAD_VALID_UNTIL} <F v={dateLong(c.validUntil)} /><br />
            {HEAD_TERM} <F v={dateLong(c.term.start)} /> – <F v={dateLong(c.term.end)} />
          </div>
        </div>

        {/* SITE PHOTO — the flexible element on this page: it takes whatever
            height the fixed parts above and below it leave. */}
        <div className={`photowrap${c.scope.sitePhoto ? ' has' : ''}`}>
          {c.scope.sitePhoto
            ? <img src={c.scope.sitePhoto} alt="Site" />
            : <span className="ph">{PHOTO_PLACEHOLDER}</span>}
        </div>

        <div>
          {/* 1 · CLIENT DETAILS */}
          {show('client') && (
            <section>
              <H id="client" />
              <p className="small"><Rich runs={CLIENT_INTRO} /></p>
              <table className="kv"><tbody>
                <tr><td className="l">{CLIENT_FIELD_LABELS.businessName}</td><td><F v={c.client.businessName} blk /></td></tr>
                <tr><td className="l">{CLIENT_FIELD_LABELS.siteContact}</td><td><F v={c.client.siteContact} blk /></td></tr>
                <tr><td className="l">{CLIENT_FIELD_LABELS.billingContact}</td><td><F v={c.client.billingContact} blk /></td></tr>
                <tr><td className="l">{CLIENT_FIELD_LABELS.billingEmail}</td><td><F v={c.client.billingEmail} blk /></td></tr>
                <tr>
                  <td className="l">
                    {CLIENT_FIELD_LABELS.billingAddress}{' '}
                    <span style={{ fontWeight: 'normal', textTransform: 'none', letterSpacing: 0 }}>
                      {CLIENT_FIELD_LABELS.billingAddressQualifier}
                    </span>
                  </td>
                  <td><F v={c.client.billingAddress} blk /></td>
                </tr>
              </tbody></table>
            </section>
          )}

          {/* 2 · PROPERTY SCOPE — the intro only. WHERE service happens is
              the map below; WHAT happens there is Section 3. */}
          {show('scope') && (
            <section>
              <H id="scope" />
              <p className="small"><Rich runs={SCOPE_INTRO} /></p>
            </section>
          )}
        </div>

        {/* SERVICE AREA MAP + LEGEND. Outside the Scope section, exactly as
            the reference has it: removing Section 2 drops its heading and
            intro and leaves the map — the thing this page is built around —
            in place. */}
        {c.scope.showMap && (() => {
          // The measured outline wins: it regenerates from the polygons, so
          // re-measuring updates the printed map. An uploaded image is the
          // fallback for a property nobody has measured.
          const measured = staticMapUrl(c.scope.measurement, {
            width: 640, height: 640, scale: 2, apiKey: GOOGLE_MAPS_API_KEY,
          });
          const upload = (c.scope.mapImages || [])[0];
          return (
            <div className="keep">
              <div className="maphead">
                <div className="t">{MAP_HEAD_TITLE}</div>
                <div className="n">{MAP_HEAD_NOTE}</div>
              </div>
              <div className="maprow">
                <div className="mapwrap">
                  {measured
                    ? <img src={measured} alt="Service area" />
                    : upload
                      ? <img src={upload} alt="Service area" />
                      : <span className="ph">{MAP_PLACEHOLDER}</span>}
                </div>
                <div className="legcol">
                  {MAP_LEGEND.map(l => (
                    <div key={l.key} className="r">
                      <span className="k" style={{ background: l.hex }} />
                      <span>{l.label}</span>
                    </div>
                  ))}
                  <div className="legnote">{MAP_STORAGE_NOTE}</div>
                  <div className="scopef">
                    <div className="l">{SCOPE_FIELD_PLOW}</div>
                    <div className="v">{c.scope.plowArea || ' '}</div>
                    <div className="l">{SCOPE_FIELD_SHOVEL}</div>
                    <div className="v">{c.scope.shovelArea || ' '}</div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
        </div>
        </Page>

        <Page brk>

        {/* 3 · SERVICE LEVEL — three cumulative levels, one of them ticked.
            The contents are fixed legal text, so nothing here reads from the
            contract except which row is selected. */}
        {show('services') && (
          <section>
            <H id="services" />
            <p className="small">{LEVEL_INTRO}</p>
            <table className="svc"><tbody>
              <tr>
                <th style={{ width: '28%' }}>{LEVEL_TABLE_HEAD.level}</th>
                <th>{LEVEL_TABLE_HEAD.included}</th>
              </tr>
              {SERVICE_LEVELS.map(l => (
                <tr key={l.n}>
                  <td>
                    <CB on={c.serviceLevel === l.n} /> <b>Level {l.n}</b>
                    <br /><span className="small">{l.short}</span>
                  </td>
                  <td><Rich runs={l.body} /></td>
                </tr>
              ))}
            </tbody></table>
            {LEVEL_NOTES.map((n, i) => (
              <p key={i} className="small" style={i === 0 ? { marginTop: 5 } : undefined}>
                <Rich runs={n} />
              </p>
            ))}
          </section>
        )}

        {/* 4 · PRICING — every level priced both ways, side by side. TWO
            independent ticks: the level (in the matrix) and the option (on the
            boxes below it), plus Option A's own payment tick. */}
        {show('pricing') && (
          <section>
            <H id="pricing" />
            <p className="small"><Rich runs={PRICING_INTRO} /></p>

            <table className="svc" style={{ marginBottom: 8 }}><tbody>
              <tr>
                <th className="c" style={{ width: '7%', textAlign: 'center' }}>{PRICING_TABLE_HEAD.select}</th>
                <th style={{ width: '29%' }}>{PRICING_TABLE_HEAD.level}</th>
                <th style={{ width: '31%' }}>{PRICING_TABLE_HEAD.optionA}</th>
                <th>{PRICING_TABLE_HEAD.optionB}</th>
              </tr>
              {SERVICE_LEVELS.map(l => (
                <tr key={l.n}>
                  <td className="c"><CB on={c.serviceLevel === l.n} /></td>
                  <td><b>Level {l.n}</b> {PRICING_ROW_SUFFIX[l.n]}</td>
                  <td>$ <Money v={c.pricing.levels[l.n]?.seasonal} /> {PRICING_HST_SUFFIX}</td>
                  <td>$ <Money v={c.pricing.levels[l.n]?.perVisit} /> {PRICING_PER_VISIT_SUFFIX}</td>
                </tr>
              ))}
            </tbody></table>

            <div className="opt">
              <div className="h"><CB on={c.pricing.selectedOption === 'A'} /> &nbsp;{OPTION_A_TITLE}</div>
              <div className="sub">{OPTION_A_SUB}</div>
              <table className="rate"><tbody>
                <tr>
                  <td style={{ width: '34%' }}>{OPTION_A_PAY_LABEL}</td>
                  <td>
                    <CB on={c.pricing.optionAPayment === 'instalments'} />{' '}
                    <Rich runs={OPTION_A_PAY_INSTALMENTS} />
                    <br />
                    <CB on={c.pricing.optionAPayment === 'prepay'} />{' '}
                    <b>
                      {OPTION_A_PAY_PREPAY_PARTS[0]}
                      <F v={dateLong(c.pricing.prepayDeadline)} />
                      {OPTION_A_PAY_PREPAY_PARTS[1]}
                    </b>
                  </td>
                </tr>
                <tr><td>{OPTION_A_EXTRAS_LABEL}</td><td>{OPTION_A_EXTRAS}</td></tr>
              </tbody></table>
            </div>

            <div className="opt">
              <div className="h"><CB on={c.pricing.selectedOption === 'B'} /> &nbsp;{OPTION_B_TITLE}</div>
              <div className="sub">{OPTION_B_SUB}</div>
              <table className="rate"><tbody>
                <tr><td style={{ width: '34%' }}>{OPTION_A_PAY_LABEL}</td><td>{OPTION_B_PAY}</td></tr>
                <tr><td>{OPTION_A_EXTRAS_LABEL}</td><td>{OPTION_B_EXTRAS}</td></tr>
              </tbody></table>
            </div>

            {/* ADDITIONAL SERVICES — rules, not rates: each row states how the
                charge is derived from the pricing above, so the table cannot
                fall out of step with the quoted numbers. */}
            <div className="keep">
              <p style={{ marginTop: 7 }}><b>{ADDITIONAL_SERVICES_TITLE}</b></p>
              <table className="rate"><tbody>
                {ADDITIONAL_SERVICES.map((r, i) => (
                  <tr key={i}>
                    <td style={{ width: '40%' }}>
                      {r.label}
                      {r.sub && <><br /><span className="small">{r.sub}</span></>}
                    </td>
                    <td><Rich runs={r.body} /></td>
                  </tr>
                ))}
              </tbody></table>
              <p className="small" style={{ marginTop: 4 }}>{ADDITIONAL_SERVICES_NOTE}</p>
            </div>
          </section>
        )}

        {/* 5 · SERVICE TRIGGER & RESPONSE */}
        {show('trigger') && (
          <section>
            <H id="trigger" />
            {/* ALL THREE windows print, with the assigned one ticked above
                them: the Client is being told what each window means as well
                as which one this property is on. */}
            <table className="kv"><tbody>
              <tr>
                <td className="l" style={{ width: '19%' }}>{TRIGGER_LABELS.depth}</td>
                <td style={{ width: '29%' }}><F v={c.serviceTerms.triggerDepth} /></td>
                <td className="l" style={{ width: '20%' }}>{TRIGGER_LABELS.window}</td>
                <td>
                  <CB on={c.serviceTerms.serviceWindow === 'overnight'} /> {TRIGGER_LABELS.overnight} &nbsp;&nbsp;
                  <CB on={c.serviceTerms.serviceWindow === 'daytime'} /> {TRIGGER_LABELS.daytime} &nbsp;&nbsp;
                  <CB on={c.serviceTerms.serviceWindow === 'nonPriority'} /> {TRIGGER_LABELS.nonPriority}
                </td>
              </tr>
              <tr>
                <td className="l">{TRIGGER_LABELS.overnight}</td>
                <td colSpan={3}>
                  {WINDOW_OVERNIGHT_PARTS[0]}<F v={c.serviceTerms.overnightCutoff} />
                  {WINDOW_OVERNIGHT_PARTS[1]}<F v={c.serviceTerms.overnightClearBy} />
                  {WINDOW_OVERNIGHT_PARTS[2]}
                </td>
              </tr>
              <tr>
                <td className="l">{TRIGGER_LABELS.daytime}</td>
                <td colSpan={3}>
                  {WINDOW_DAYTIME_PARTS[0]}<F v={c.serviceTerms.daytimeHours} />{WINDOW_DAYTIME_PARTS[1]}
                </td>
              </tr>
              <tr>
                <td className="l">{TRIGGER_LABELS.nonPriority}</td>
                <td colSpan={3}>
                  {WINDOW_NON_PRIORITY_PARTS[0]}<F v={c.serviceTerms.nonPriorityHours} />{WINDOW_NON_PRIORITY_PARTS[1]}
                </td>
              </tr>
            </tbody></table>
            <ul style={{ marginTop: 6 }}>
              {TRIGGER_BULLETS.map((b, i) => <li key={i}><Rich runs={b} /></li>)}
            </ul>
          </section>
        )}

        {/* 6 · PAYMENT & BILLING */}
        {show('payment') && (
          <section>
            <H id="payment" />
            <ul>
              {PAYMENT_BULLETS.map((b, i) => <li key={i}><Rich runs={b} /></li>)}
            </ul>
          </section>
        )}

        {/* 7 · PROPERTY DAMAGE */}
        {show('damage') && (
          <section><H id="damage" /><Legal paras={PROPERTY_DAMAGE} /></section>
        )}

        {/* 8 · LIABILITY & INDEMNITY */}
        {show('indemnity') && (
          <section><H id="indemnity" /><Legal paras={LIABILITY} /></section>
        )}

        {/* 9 · ICE CONDITIONS */}
        {show('ice') && (
          <section><H id="ice" /><Legal paras={ICE_CONDITIONS} /></section>
        )}

        {/* 10 · DELAYS & OBSTRUCTIONS */}
        {show('delays') && (
          <section><H id="delays" /><Legal paras={DELAYS} /></section>
        )}

        {/* 11 · INSURANCE — the CGL amount is the one editable field in the
            clause. It reads from the contract once the model carries it; until
            then it prints the standard figure. */}
        {show('insurance') && (
          <section>
            <H id="insurance" />
            <p className="legal">
              {INSURANCE_PARTS[0]}
              <F v={c.insurance.cglAmount} />
              {INSURANCE_PARTS[1]}
            </p>
          </section>
        )}

        {/* 12 · TERM & TERMINATION — the one section drafted for this build
            rather than transcribed. See snowContractText. */}
        {show('termination') && (
          <section><H id="termination" /><Legal paras={TERMINATION} /></section>
        )}

        {/* 13 · CONTACT */}
        {show('contact') && (
          <section>
            <H id="contact" />
            <table className="kv"><tbody>
              <tr><td className="l">Office</td><td>{OFFICE_PHONE} &nbsp;|&nbsp; {OFFICE_EMAIL}</td></tr>
              <tr><td className="l">Service Call-In Line</td><td>{SERVICE_LINE}</td></tr>
            </tbody></table>
            <p className="small" style={{ marginTop: 4 }}>{CONTACT_NOTE}</p>
          </section>
        )}

        {/* 14 · ACCEPTANCE — client signature only. */}
        {show('acceptance') && (
          <section>
            <H id="acceptance" />
            {ACCEPTANCE_PARAS.map((p, i) => (
              <p key={i} className="small"><Rich runs={p} /></p>
            ))}
            <table className="sig"><tbody>
              <tr>
                <td style={{ width: '40%' }}><div className="sigline" />{SIGNATURE_LABELS.name}</td>
                <td style={{ width: '5%' }} />
                <td style={{ width: '33%' }}><div className="sigline" />{SIGNATURE_LABELS.signature}</td>
                <td style={{ width: '5%' }} />
                <td style={{ width: '17%' }}><div className="sigline" />{SIGNATURE_LABELS.date}</td>
              </tr>
            </tbody></table>
          </section>
        )}

        </Page>
      </div>
    </div>
  );
}

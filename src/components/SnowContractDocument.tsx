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
// 1.5px section rule, 4.2in map box — not approximations of them.
import { useLayoutEffect, useRef, useState } from 'react';
import type { SnowContract } from '../types';
import { SNOW_LOGO_DATA_URI } from '../assets/snowLogo';
import { staticMapUrl, fitMapHeightIn, MAP_MAX_IN } from '../lib/snowContractMap';
import { GOOGLE_MAPS_API_KEY } from '../lib/googleMaps';
import {
  DOC_TITLE, CONTRACTOR_FOOTER_NAME, CONTRACTOR_ADDRESS, OFFICE_PHONE, OFFICE_EMAIL,
  SERVICE_LINE, INTRO_LINE, SCOPE_INTRO, SERVICES_LEGEND_ON_CALL, SERVICES_LEGEND_EXCL,
  PRICING_INTRO, OPTION_A_SUB, OPTION_B_SUB, ADDONS_NOTE, OPTION_A_RATES_ON_REQUEST,
  TRIGGER_BULLETS, PAYMENT_BULLETS, PROPERTY_DAMAGE, INDEMNITY, INSURANCE,
  CONTACT_NOTE, ACCEPTANCE_NOTE, SECTIONS, PAGE_BREAK_AFTER,
} from '../lib/snowContractText';

const money = (n: number) =>
  (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dateLong = (ymd: string) => {
  if (!ymd) return '';
  const d = new Date(`${ymd}T12:00:00`);
  return Number.isNaN(d.getTime()) ? ymd
    : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

// The reference's CSS, verbatim in its values, scoped under .snowdoc.
//
// ONE DELIBERATE DEVIATION: list items are 8px apart, not the reference's 9px.
// The Insurance section and the extra Payment bullet that this build adds cost
// page 3 about 72px, which left it ONE PIXEL over a page and pushed Acceptance
// onto a fourth page. Ten bullets at 1px each buys 10px — enough to restore the
// three-page contract with headroom, and invisible at this size. Verified by
// scripts/verify-snow-contract-print.tsx at both scope-text extremes.
const DOC_CSS = `
.snowdoc, .snowdoc * { box-sizing: border-box; }
.snowdoc { font-family: "DejaVu Sans", Arial, Helvetica, sans-serif; font-size: 8.2pt;
  color: #16232e; line-height: 1.32; }
.snowdoc .sheet { background:#fff; max-width: 8.5in; margin: 0 auto; padding: 0.5in 0.55in 0.6in; }
.snowdoc .band { background:#0d6cb5; color:#fff; padding:11px 16px; margin-bottom:10px;
  display:flex; align-items:center; justify-content:space-between; }
.snowdoc .band .lock { display:flex; align-items:center; gap:13px; }
.snowdoc .band .lock img.sn { height:38px; }
.snowdoc .band .t { text-align:right; }
.snowdoc .band .t .a { font-size:13.5pt; font-weight:bold; letter-spacing:.3px; }
.snowdoc .band .t .b { font-size:7.5pt; opacity:.9; letter-spacing:1.3px; text-transform:uppercase; margin-top:2px; }
.snowdoc h2 { font-size:8.8pt; text-transform:uppercase; letter-spacing:1.1px; color:#0d6cb5;
  border-bottom:1.5px solid #0d6cb5; padding-bottom:2px; margin:7px 0 4px; display:flex; align-items:baseline; }
.snowdoc h2 .n { color:#9fb6c8; margin-right:6px; }
.snowdoc p { margin:0 0 8px; }
.snowdoc ul { margin:0 0 9px; padding-left:14px; }
.snowdoc li { margin-bottom:8px; }   /* reference is 9px — see note below */
.snowdoc table { width:100%; border-collapse:collapse; }
.snowdoc .kv td { padding:5px 6px; border-bottom:1px solid #cfdce7; vertical-align:bottom; }
.snowdoc .kv td.l { width:26%; font-weight:bold; font-size:7.5pt; color:#45596b;
  text-transform:uppercase; letter-spacing:.4px; }
.snowdoc .svc th { background:#eaf2f9; color:#14486f; font-size:7pt; text-transform:uppercase;
  letter-spacing:.5px; padding:7px 6px; text-align:left; border:1px solid #cfdce7; }
.snowdoc .svc td { border:1px solid #cfdce7; padding:5.5px 6px; font-size:8.1pt; }
.snowdoc .svc td.c { text-align:center; width:8%; }
.snowdoc .opt { border:1.5px solid #0d6cb5; padding:11px 11px; margin-bottom:10px; }
.snowdoc .opt .h { font-weight:bold; font-size:9.5pt; color:#0d6cb5; margin-bottom:3px; }
.snowdoc .opt .sub { font-size:7.8pt; color:#45596b; margin-bottom:5px; }
.snowdoc .rate td { padding:4.2px 6px; border-bottom:1px dotted #c3d1dd; font-size:8.4pt; }
.snowdoc .rate td.f { width:34%; }
.snowdoc .small { font-size:7.8pt; color:#45596b; }
.snowdoc .legal { font-size:7.3pt; line-height:1.85; text-align:justify; color:#33434f; }
.snowdoc .sig td { padding-top:44px; font-size:8.2pt; }
.snowdoc .sigline { border-bottom:1px solid #16232e; height:1px; margin-bottom:2px; }
.snowdoc .foot { margin-top:6px; border-top:1px solid #cfdce7; padding-top:6px;
  font-size:7pt; color:#7a8794; display:flex; justify-content:space-between; }
.snowdoc .f { display:inline-block; min-width:70px; border-bottom:1px solid #b9c7d3; padding:0 3px; }
.snowdoc .f.blk { display:block; min-height:14px; }
.snowdoc .cb { font-size:11.5pt; line-height:1; color:#5d7185; }
.snowdoc .cb.on { color:#0d6cb5; }
.snowdoc .mapwrap { border:1px solid #cfdce7; margin-top:6px; position:relative; background:#fbfdfe;
  display:flex; align-items:center; justify-content:center; overflow:hidden; gap:6px; }
.snowdoc .mapwrap img { max-width:100%; max-height:100%; object-fit:contain; }
.snowdoc .mapwrap .ph { color:#8fa3b4; font-size:8pt; }
.snowdoc .pb { break-after:page; page-break-after:always; }

@media print {
  @page { size: Letter; margin: 0.42in 0.5in 0.42in 0.5in; }
  .snowdoc { font-size:8.6pt; }
  .snowdoc .sheet { max-width:none; margin:0; padding:0; }
  /* HARD REQUIREMENT: no section splits across a page. */
  .snowdoc section, .snowdoc .opt, .snowdoc .svc tr, .snowdoc .sig tr { page-break-inside:avoid; break-inside:avoid; }
  .snowdoc h2 { page-break-after:avoid; }
  .snowdoc .pb { page-break-after:always; }
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
  const page1Ref = useRef<HTMLDivElement>(null);
  const [mapIn, setMapIn] = useState(MAP_MAX_IN);

  // MEASURED FIT. Render, measure, shrink the map until page 1 holds Property
  // Scope; stop at the floor and let it overflow rather than squeezing the map
  // into a strip. Runs against the live content, so it re-fits as scope text is
  // typed — the preview and the print view reach the same height.
  useLayoutEffect(() => {
    const el = page1Ref.current;
    if (!el || !c.scope.showMap) { setMapIn(MAP_MAX_IN); return; }
    // Height of everything on page 1 except the map box.
    const mapEl = el.querySelector('.mapwrap') as HTMLElement | null;
    const mapH = mapEl ? mapEl.getBoundingClientRect().height : 0;
    const withoutMap = el.getBoundingClientRect().height - mapH;
    // Same pure function the print verification exercises.
    const rounded = fitMapHeightIn(withoutMap);
    setMapIn(prev => (Math.abs(prev - rounded) > 0.02 ? rounded : prev));
  }, [c.scope, c.client, c.term, c.season, mode]);

  const sec = (id: string) => SECTIONS.find(s => s.id === id)!;
  const H = ({ id }: { id: string }) => {
    const s = sec(id);
    return <h2><span className="n">{s.n}</span>{s.title}</h2>;
  };
  const Break = ({ id }: { id: string }) =>
    (PAGE_BREAK_AFTER as readonly string[]).includes(id) ? <div className="pb" /> : null;

  const Foot = () => (
    <div className="foot">
      <span>{CONTRACTOR_FOOTER_NAME} &nbsp;|&nbsp; {CONTRACTOR_ADDRESS}</span>
      <span>{OFFICE_PHONE} &nbsp;|&nbsp; {OFFICE_EMAIL}</span>
    </div>
  );

  return (
    <div className={`snowdoc${mode === 'preview' ? ' snowdoc-preview' : ''}`}>
      <style>{DOC_CSS}</style>
      <div className="sheet">
        {/* HEADER BAND */}
        <div className="band">
          <div className="lock"><img className="sn" src={SNOW_LOGO_DATA_URI} alt="Marco's Snow" /></div>
          <div className="t">
            <div className="a">{DOC_TITLE}</div>
            <div className="b">
              Season <span className="f">{c.season.replace('/', ' / ')}</span> &nbsp;&nbsp;{CONTRACTOR_FOOTER_NAME}
            </div>
          </div>
        </div>

        <div ref={page1Ref}>
          {/* 1 · CLIENT & PROPERTY */}
          {show('client') && (
            <section>
              <H id="client" />
              <p className="small">{INTRO_LINE}</p>
              <table className="kv"><tbody>
                <tr>
                  <td className="l">Client / Business</td><td><F v={c.client.businessName} blk /></td>
                  <td className="l">Site Contact</td><td><F v={c.client.siteContact} blk /></td>
                </tr>
                <tr><td className="l">Service Address</td><td colSpan={3}><F v={c.client.serviceAddress} blk /></td></tr>
                <tr>
                  <td className="l">Billing Email</td><td><F v={c.client.billingEmail} blk /></td>
                  <td className="l">Phone</td><td><F v={c.client.phone} blk /></td>
                </tr>
                <tr>
                  <td className="l">Term</td>
                  <td colSpan={3}>{dateLong(c.term.start)} &nbsp;—&nbsp; {dateLong(c.term.end)}</td>
                </tr>
              </tbody></table>
            </section>
          )}

          {/* 2 · PROPERTY SCOPE */}
          {show('scope') && (
            <section>
              <H id="scope" />
              <p className="small">{SCOPE_INTRO}</p>
              <table className="kv"><tbody>
                <tr><td className="l">Total Serviced Area</td><td><F v={c.scope.totalArea} blk /></td></tr>
                <tr><td className="l">Lot / Driving Areas</td><td><F v={c.scope.lotAreas} blk /></td></tr>
                <tr><td className="l">Walkways &amp; Entrances</td><td><F v={c.scope.walkwaysEntrances} blk /></td></tr>
                <tr><td className="l">Snow Storage Locations</td><td><F v={c.scope.snowStorage} blk /></td></tr>
                <tr><td className="l">Marked Hazards / Obstacles</td><td><F v={c.scope.markedHazards} blk /></td></tr>
                <tr><td className="l">Access Notes</td><td><F v={c.scope.accessNotes} blk /></td></tr>
              </tbody></table>
              <p style={{ marginTop: 8 }}><b>Scope Description</b></p>
              <div className="f" style={{ display: 'block', minHeight: 80, border: '1px solid #cfdce7', padding: '5px 7px' }}>
                {c.scope.description || ' '}
              </div>
              {c.scope.showMap && (() => {
                // The measured outline wins: it regenerates from the polygon,
                // so re-measuring updates the printed map. Uploaded images are
                // the fallback for a property nobody has measured.
                const measured = staticMapUrl(c.scope.measurement, {
                  width: 640, height: Math.round(640 * (mapIn / 6.5)),
                  scale: 2, apiKey: GOOGLE_MAPS_API_KEY,
                });
                const uploads = c.scope.mapImages || [];
                return (
                  <div className="mapwrap" style={{ height: `${mapIn}in` }}>
                    {measured
                      ? <img src={measured} alt="Serviced area" />
                      : uploads.length > 0
                        ? uploads.map((src, i) => <img key={i} src={src} alt={`Site map ${i + 1}`} />)
                        : <span className="ph">Site map / property sketch</span>}
                  </div>
                );
              })()}
            </section>
          )}
        </div>
        <Break id="scope" />

        {/* 3 · SERVICES */}
        {show('services') && (
          <section>
            <H id="services" />
            <table className="svc"><tbody>
              <tr>
                <th style={{ width: '31%' }}>Service</th>
                <th className="c" style={{ textAlign: 'center' }}>Incl.</th>
                <th className="c" style={{ textAlign: 'center' }}>On Call</th>
                <th className="c" style={{ textAlign: 'center' }}>Excl.</th>
                <th>Scope / Notes</th>
              </tr>
              {c.services.map(s => (
                <tr key={s.key}>
                  <td><b>{s.label}</b>{s.detail ? <> — {s.detail}</> : null}</td>
                  <td className="c"><CB on={s.status === 'included'} /></td>
                  <td className="c"><CB on={s.status === 'onCall'} /></td>
                  <td className="c"><CB on={s.status === 'excluded'} /></td>
                  <td className={s.notes ? 'small' : ''}><span className="blk">{s.notes || ' '}</span></td>
                </tr>
              ))}
            </tbody></table>
            <p className="small" style={{ marginTop: 3 }}>
              <b>On Call</b>{SERVICES_LEGEND_ON_CALL.replace('On Call', '')} <b>Excl.</b>{SERVICES_LEGEND_EXCL.replace('Excl.', '')}
            </p>
          </section>
        )}

        {/* 4 · PRICING */}
        {show('pricing') && (
          <section>
            <H id="pricing" />
            <p className="small">{PRICING_INTRO}</p>

            {c.pricing.optionA.enabled && (
              <div className="opt">
                <div className="h"><CB on={c.pricing.selectedOption === 'A'} /> &nbsp;Option A — Seasonal Contract</div>
                <div className="sub">{OPTION_A_SUB}</div>
                <table className="rate"><tbody>
                  <tr><td style={{ width: '34%' }}>Total Contract Price</td>
                    <td>$ <F v={money(c.pricing.optionA.totalPrice)} /> + HST</td></tr>
                  <tr><td style={{ width: '34%' }}>Billed In</td>
                    <td><b>6 equal monthly instalments</b> of $ <F v={money(c.pricing.optionA.instalmentAmount)} /> + HST</td></tr>
                  <tr><td style={{ width: '34%' }}>Instalment Schedule</td>
                    <td>1st of each month, November through April</td></tr>
                  {c.pricing.optionA.prepayDiscountEnabled && (
                    <tr><td style={{ width: '34%' }}>Pre-Season Discount</td>
                      <td><b>5% off</b> the total contract price if paid in full on or before{' '}
                        <F v={dateLong(c.pricing.optionA.prepayDeadline)} />. Discounted total: ${' '}
                        <F v={money(c.pricing.optionA.prepayTotal)} /> + HST.</td></tr>
                  )}
                  {/* PRICING VISIBILITY: the per-service rates behind a seasonal
                      price are not printed. */}
                  <tr><td style={{ width: '34%' }}>Per-Service Rates</td>
                    <td className="small">{OPTION_A_RATES_ON_REQUEST}</td></tr>
                </tbody></table>
              </div>
            )}

            {c.pricing.optionB.enabled && (
              <div className="opt">
                <div className="h"><CB on={c.pricing.selectedOption === 'B'} /> &nbsp;Option B — Per-Service Rates</div>
                <div className="sub">{OPTION_B_SUB}</div>
                <table className="rate"><tbody>
                  {c.pricing.optionB.lines.map((l, i) => (
                    <tr key={i}>
                      <td style={{ width: '34%' }}>{l.label}</td>
                      <td>$ <F v={money(l.amount)} />{l.note ? <> {l.note}</> : null}</td>
                    </tr>
                  ))}
                  <tr style={{ background: '#eaf2f9' }}>
                    <td style={{ fontWeight: 'bold' }}>TOTAL PER VISIT</td>
                    <td><b>$ <F v={money(c.pricing.optionB.totalPerVisit)} /> + HST</b> &nbsp;
                      <span className="small">— all services above, performed together after each event</span></td>
                  </tr>
                </tbody></table>
              </div>
            )}

            {show('addons') && (
              <div>
                <p style={{ marginTop: 7 }}><b>Add-On Rates</b> <span className="small">{ADDONS_NOTE}</span></p>
                <table className="rate"><tbody>
                  <tr><td style={{ width: '34%' }}>Additional Sand</td>
                    <td>$ <F v={money(c.pricing.addOns.sandPerTon)} /> / ton &nbsp;+&nbsp; ${' '}
                      <F v={money(c.pricing.addOns.sandLoadingFee)} /> loading &amp; hauling fee per application</td></tr>
                  <tr><td>On-Site Snow Relocation</td><td>{c.pricing.addOns.relocation}</td></tr>
                  <tr><td>Off-Site Haul-Away</td><td>{c.pricing.addOns.haulAway}</td></tr>
                  <tr><td>After-Hours / Emergency Call-Out</td>
                    <td>{c.pricing.addOns.afterHours ? <>$ <F v={c.pricing.addOns.afterHours} /></> : <>$ <F v="" /></>}</td></tr>
                </tbody></table>
              </div>
            )}
          </section>
        )}
        <Break id="pricing" />

        {/* 5 · SERVICE TRIGGER & RESPONSE */}
        {show('trigger') && (
          <section>
            <H id="trigger" />
            <table className="kv"><tbody>
              <tr>
                <td className="l" style={{ width: '19%' }}>Trigger Depth</td>
                <td style={{ width: '29%' }}><F v={c.serviceTerms.triggerDepth} /></td>
                <td className="l" style={{ width: '16%' }}>Priority Tier</td>
                <td><CB on={c.serviceTerms.priorityTier === 'standard'} /> Standard &nbsp;&nbsp;
                  <CB on={c.serviceTerms.priorityTier === 'priority'} /> Priority</td>
              </tr>
              <tr><td className="l">Response Window</td>
                <td colSpan={3}>Cleared before <F v={c.serviceTerms.clearedBefore} /> a.m. if snowfall ends by{' '}
                  <F v={c.serviceTerms.snowfallEndsBy} /> a.m.; otherwise within{' '}
                  <F v={c.serviceTerms.otherwiseWithinHours} /> hours of the end of the event.</td></tr>
            </tbody></table>
            <ul style={{ marginTop: 6 }}>
              {TRIGGER_BULLETS.map((b, i) => (
                <li key={i}>{b.text}{b.bold ? <b>{b.bold}</b> : null}{b.boldTail || ''}</li>
              ))}
            </ul>
          </section>
        )}

        {/* 6 · PAYMENT & BILLING */}
        {show('payment') && (
          <section>
            <H id="payment" />
            <ul>
              {PAYMENT_BULLETS.map((b, i) => (
                <li key={i}>{b.text}{b.bold ? <b>{b.bold}</b> : null}{b.boldTail || ''}</li>
              ))}
            </ul>
          </section>
        )}

        {/* 7 · PROPERTY DAMAGE */}
        {show('damage') && (
          <section><H id="damage" /><p className="legal">{PROPERTY_DAMAGE}</p></section>
        )}

        {/* 8 · INDEMNITY */}
        {show('indemnity') && (
          <section><H id="indemnity" /><p className="legal">{INDEMNITY}</p></section>
        )}

        {/* 9 · INSURANCE */}
        {show('insurance') && (
          <section><H id="insurance" /><p className="legal">{INSURANCE}</p></section>
        )}

        {/* 10 · CONTACT */}
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

        {/* 11 · ACCEPTANCE — client signature only. */}
        {show('acceptance') && (
          <section>
            <H id="acceptance" />
            <p className="small">{ACCEPTANCE_NOTE}</p>
            <table className="sig"><tbody>
              <tr>
                <td style={{ width: '40%' }}><div className="sigline" />Client Name (print)</td>
                <td style={{ width: '5%' }} />
                <td style={{ width: '33%' }}><div className="sigline" />Client Signature</td>
                <td style={{ width: '5%' }} />
                <td style={{ width: '17%' }}><div className="sigline" />Date</td>
              </tr>
            </tbody></table>
          </section>
        )}

        <Foot />
      </div>
    </div>
  );
}

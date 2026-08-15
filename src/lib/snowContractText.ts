// SNOWMASTER · COMMERCIAL CONTRACT — FIXED CONTENT.
//
// This is the contract's LEGAL TEXT, not user input. Every string below is
// transcribed verbatim from reference/Marcos_Snow_Contract_Builder.html —
// paraphrasing an indemnity, liability or payment clause would change what the
// Client is agreeing to, so nothing here is tidied, shortened or reworded.
//
// CHARACTERS ARE PRESERVED AS THE REFERENCE WRITES THEM: straight apostrophes
// (Contractor's, 24 hours', 12', 4'), em dashes, and the degree sign in 0°C.
// HTML entities are decoded (&mdash; → —, &deg; → °, &amp; → &) and nothing
// else is touched. An earlier build curled the apostrophes; that has been
// undone so a diff against the reference is clean.
//
// TWO DELIBERATE DEPARTURES from the reference, both flagged at their site:
//   1. Section 14 (Acceptance) — the reference cross-references "the date shown
//      in Section 1", but the validity date lives in the header block ABOVE
//      Section 1. Corrected to "at the top of this Agreement", which also
//      cannot break if sections are renumbered again.
//   2. Section 12 (Term & Termination) — NEW. The reference has no termination
//      clause at all while Section 8 states it survives termination. Drafted
//      for this build; marked ADDED below.

// A rich-text run: a plain string, or { b } for a bold span. Legal text here
// bolds mid-sentence (". . . define WHERE service is performed"), which the old
// leading/trailing-bold shape could not express without splitting the sentence
// across constants — and a clause split across constants is a clause waiting to
// be edited in one half only.
export type Run = string | { b: string };

export const CONTRACTOR_LEGAL_NAME = "2849409 Ontario Inc., operating as Marco's";
export const CONTRACTOR_FOOTER_NAME = "2849409 Ontario Inc. operating as Marco's";
export const CONTRACTOR_ADDRESS = '1175 Rosslyn Road, Thunder Bay, ON';
export const OFFICE_PHONE = '(807) 630-4027';
export const OFFICE_EMAIL = 'office@marcosmowing.com';
export const SERVICE_LINE = 'Tony — (807) 630-8904';

export const DOC_TITLE = 'Commercial Snow Removal Agreement';

// ── Header band + property head ────────────────────────────────────────────
// The identity fields moved OUT of Section 1 and into the block above it: the
// service address is the page's title, with the quote date, validity date and
// term beside it.
export const BAND_SEASON_SUFFIX = "2849409 Ontario Inc. operating as Marco's";
export const HEAD_QUOTE_DATE = 'Quote date';
export const HEAD_VALID_UNTIL = 'Valid until';
export const HEAD_TERM = 'Term';
export const PHOTO_PLACEHOLDER = 'Site photo';

// ── Section 1 · Client Details ─────────────────────────────────────────────
export const CLIENT_INTRO: Run[] = [
  'This Agreement is between ',
  { b: "2849409 Ontario Inc., operating as Marco's" },
  ' (the "Contractor") and the Client named below. ',
  { b: 'To be completed by the Client.' },
];
export const CLIENT_FIELD_LABELS = {
  businessName: 'Client / Business Name',
  siteContact: 'Site Contact + Phone',
  billingContact: 'Billing Contact + Phone',
  billingEmail: 'Billing Email',
  billingAddress: 'Billing Address',
  billingAddressQualifier: '(if different)',
} as const;

// ── Section 2 · Property Scope ─────────────────────────────────────────────
export const SCOPE_INTRO: Run[] = [
  'The areas below define ',
  { b: 'where' },
  ' service is performed. ',
  { b: 'What' },
  ' is performed in those areas is set by the service level selected in Section 3. Areas not listed are not serviced. Shovel area applies at Level 3 only.',
];
export const MAP_HEAD_TITLE = 'Service Area Map';
export const MAP_HEAD_NOTE = 'Marked areas define the extent of service at the selected level.';
export const MAP_PLACEHOLDER = 'Service area map';

// Legend rows, in the reference's order, with its exact hexes — re-exported
// from the one definition the drawing tool and the printed map also use, so
// the legend cannot come to disagree with what is drawn.
export { SNOW_AREAS as MAP_LEGEND } from './snowAreas';
export const MAP_STORAGE_NOTE =
  'Snow storage locations are proposed and may be adjusted on site as conditions require.';
// The two free-text fields that survive from the old six-row scope table.
export const SCOPE_FIELD_PLOW = 'Plow Area';
export const SCOPE_FIELD_SHOVEL = 'Shovel Area';

// ── Section 3 · Service Level ──────────────────────────────────────────────
export const LEVEL_INTRO =
  'The Client selects one service level. Pricing for each level is shown in Section 4.';
export const LEVEL_TABLE_HEAD = { level: 'Level', included: 'What is included' } as const;

export const SERVICE_LEVELS: { n: 1 | 2 | 3; short: string; body: Run[] }[] = [
  {
    n: 1,
    short: 'Plow only',
    body: [
      'Plowing of the lot and driving areas only. ',
      { b: 'No sanding, salting or other ice control is provided at this level, and none is available on call.' },
      ' The Client is responsible for arranging its own ice control.',
    ],
  },
  {
    n: 2,
    short: 'Plow + sand/salt',
    body: ['Everything in Level 1, plus sanding and salting of the lot and driving areas following each clearing.'],
  },
  {
    n: 3,
    short: 'Plow + sand/salt + shovel',
    body: ['Everything in Level 2, plus shovelling of walkways and pathways only, salted after clearing.'],
  },
];

export const LEVEL_NOTES: Run[][] = [
  [
    { b: 'Sanding and salting' },
    ' at Levels 2 and 3 is applied after every clearing — it is not optional and is not requested visit by visit. It is charged per application, not by tonnage. During a continuous snowfall, application is made at the final clearing pass, as material applied mid-storm is buried by further accumulation.',
  ],
  [
    { b: 'On-site snow relocation and off-site haul-away are not included' },
    ' in any level. Either is provided as an extra service, priced and agreed when requested, where the Client requests it or where there is no remaining on-site storage.',
  ],
];

// ── Section 4 · Pricing ────────────────────────────────────────────────────
export const PRICING_INTRO: Run[] = [
  'Pricing is shown for all three service levels. The Client selects ',
  { b: 'one pricing option' },
  ' below, applied to the service level chosen in Section 3. The selection is locked for the full term and cannot be changed mid-season. All rates are quoted ',
  { b: 'plus HST (13%)' },
  '.',
];
export const PRICING_TABLE_HEAD = {
  select: 'Select',
  level: 'Service Level',
  optionA: 'Option A — Seasonal Contract Pricing',
  optionB: 'Option B — Per Visit Pricing',
} as const;
// Row labels in the price matrix: "Level 1 — Plow only".
export const PRICING_ROW_SUFFIX = { 1: '— Plow only', 2: '— Plow + sand/salt', 3: '— Plow + sand/salt + shovel' } as const;
export const PRICING_HST_SUFFIX = '+ HST';
export const PRICING_PER_VISIT_SUFFIX = 'per visit + HST';

export const OPTION_A_TITLE = 'Option A — Seasonal Contract Pricing';
export const OPTION_A_SUB =
  'Covers unlimited service on every event over the trigger depth, at the selected service level, for the full term. The price is fixed and does not change with the number of snowfalls — it buys guaranteed coverage at a set cost.';
export const OPTION_A_PAY_LABEL = 'Payment';
// Two selectable payment methods — the reference makes this a radio group, so
// it is a stored choice, not prose.
export const OPTION_A_PAY_INSTALMENTS: Run[] = [
  { b: '6 equal monthly instalments' },
  ' — last day of each month, November through April',
];
// Wraps the prepay deadline field: PREPAY_[0] {date field} PREPAY_[1].
export const OPTION_A_PAY_PREPAY_PARTS = ['Paid in full on or before ', ' — 5% discount'] as const;
export const OPTION_A_EXTRAS_LABEL = 'Additional Services';
export const OPTION_A_EXTRAS =
  'See Additional Services below. Called-in plowing and sanding/salting are not covered by the contract price.';

export const OPTION_B_TITLE = 'Option B — Per Visit Pricing';
export const OPTION_B_SUB =
  'Billed per visit as service is performed, at the selected service level. Every service in that level is performed on each visit and billed as one per-visit charge.';
export const OPTION_B_PAY = 'Invoiced monthly for visits performed in the prior month, net 30.';
export const OPTION_B_EXTRAS = 'See Additional Services below.';

export const ADDITIONAL_SERVICES_TITLE = 'Additional Services';
export const ADDITIONAL_SERVICES: { label: string; sub?: string; body: Run[] }[] = [
  {
    label: 'Sanding / salting called in on its own',
    sub: 'Levels 2 and 3 only — subject to route capacity',
    body: [
      { b: '50% of the Level 2 per-visit rate.' },
      ' Applies to any sanding or salting requested between snowfall events, when no clearing is performed.',
    ],
  },
  {
    label: 'Plowing called in below the trigger depth',
    body: [
      { b: 'See Option B per-visit pricing.' },
      ' The same work is performed regardless of accumulation, so the full per-visit rate for the selected level applies.',
    ],
  },
  {
    label: 'On-site relocation / off-site haul-away',
    body: ['Not included at any level. Quoted and agreed when requested.'],
  },
];
export const ADDITIONAL_SERVICES_NOTE =
  'Called-in work is a dedicated trip outside the storm route and is subject to route capacity.';

// ── Section 5 · Service Trigger & Response ─────────────────────────────────
export const TRIGGER_LABELS = {
  depth: 'Trigger Depth',
  window: 'Assigned Service Window',
  overnight: 'Overnight',
  daytime: 'Daytime',
  nonPriority: 'Non-Priority',
} as const;

// All three window descriptions PRINT; the assigned one is ticked in the header
// row above them. Each wraps editable numbers, so the text is held as the parts
// around those fields, in order.
export const WINDOW_OVERNIGHT_PARTS = [
  'Where snowfall concludes, or accumulation reaches the trigger depth, by ',
  ' a.m., the property is cleared by ',
  ' a.m. Where it concludes after that time, the property is cleared during the following daytime window.',
] as const;
export const WINDOW_DAYTIME_PARTS = [
  'The property is cleared within ',
  ' hours of the conclusion of the snowfall.',
] as const;
export const WINDOW_NON_PRIORITY_PARTS = [
  'The property is cleared within ',
  ' hours of the conclusion of the snowfall.',
] as const;

export const TRIGGER_BULLETS: Run[][] = [
  ['The service window is assigned by the Contractor based on the property and available route capacity. It may be changed on request where capacity allows. Service hours are 24/7 — crews may attend at any time, day or night.'],
  [
    { b: 'Continuous snow events:' },
    ' where snow continues to accumulate across more than one day, plowing is performed once per day for the duration of the event.',
  ],
  ['Times stated above are for clearing. Where sanding and salting are included, they follow clearing and may be applied later than the clearing itself.'],
  ['Where reasonably possible the property will be cleared before opening even where snowfall concludes after the overnight cutoff, but this is not a commitment.'],
  [
    { b: 'Occupied areas:' },
    ' areas occupied by vehicles at the time of service are not cleared and are addressed on the next scheduled visit, at no additional charge.',
  ],
  [
    { b: 'Service cannot be cancelled once accumulation exceeds the trigger depth. The visit will be billed.' },
    ' Route capacity is committed in advance.',
  ],
  [
    { b: 'Sanding and salting' },
    ' at Levels 2 and 3 is applied once clearing is complete. During a continuous snowfall it is applied at the final clearing pass, since material applied mid-storm is buried by further accumulation.',
  ],
  [
    { b: 'Deferred service in mild conditions:' },
    ' where accumulation over the trigger depth is expected to melt naturally within 24 hours because ambient temperature is above 0°C and forecast conditions support it, the Contractor may defer clearing. Deferred service does not reduce the contract price, and the Client may request clearing at any time.',
  ],
  [
    { b: 'Notice for extras:' },
    " non-urgent additional work — additional plowing under the trigger depth, relocation, haul-away — requires 24 hours' notice. Requests relating to icy conditions are responded to as soon as route conditions reasonably allow.",
  ],
  ['Where snow volume exceeds available on-site storage, relocation or haul-away is required to continue service. Neither is included in any service level — both are quoted and agreed when requested.'],
  [
    { b: 'Parked vehicles:' },
    " we will not plow between vehicles unless there is 12' of clearance, to limit damage risk.",
  ],
  [
    { b: 'Marking:' },
    " all curbing and obstructions must be pre-marked with 4' snow markers. Unmarked areas are serviced at the Client's risk and we are not liable for damage to them. We can supply and install markers on request.",
  ],
];

// ── Section 6 · Payment & Billing ──────────────────────────────────────────
export const PAYMENT_BULLETS: Run[][] = [
  [
    'Invoices are issued monthly by email within one week of month end, listing every service date and service rendered. Payment is due ',
    { b: 'net 30 days' },
    ' from the invoice date; a receipt is emailed once payment is received.',
  ],
  ['Credit card payments over $1,000 carry a 3% processing fee.'],
  ['Seasonal contract instalments are billed on the last day of each month, November through April, regardless of snowfall in that month.'],
  ['Accounts more than 30 days past due may have service suspended until the balance is cleared.'],
  // Was an ADDED bullet in the previous build; the reference now carries it, so
  // this is a transcription like the rest and the flag is gone.
  ['A service log is kept for every visit — date, time, services performed and conditions — and is available to the Client on request.'],
];

// ── Section 7 · Property Damage ────────────────────────────────────────────
export const PROPERTY_DAMAGE: Run[][] = [
  [
    "Damage caused by our crew must be reported to us in writing within 48 hours of the Client becoming aware of it. We will send a manager to document the damage and determine what action is to be taken. If the Client arranges repairs before contacting us, we cannot provide compensation for that repair. We will repair, at our expense, damage to the Client's property caused by our performance of the Services that was not reasonably foreseeable.",
  ],
  [
    'The Client acknowledges that some damage is reasonably foreseeable in the course of snow and ice maintenance and is not compensable. Foreseeable damage includes, without limitation: damage to concrete, asphalt, sod, grass and planting material caused by the application of sand, salt or other ice melting products; surface damage to curbs and asphalt caused by clearing and chipping snow and ice; damage to landscaping caused by piling snow; and damage to items that are snow-covered, unmarked or not visible.',
  ],
];

// ── Section 8 · Liability & Indemnity ──────────────────────────────────────
export const LIABILITY: Run[][] = [
  [
    { b: "Contractor's responsibility." },
    " The Contractor shall indemnify and hold harmless the Client, its agents and employees from and against any claim for damages arising from bodily injury or damage to tangible property, provided the damages are caused by the negligence of the Contractor or by the Contractor's breach of this Agreement, or by anyone for whom the Contractor is responsible in law, and provided the Contractor is given notice of the claim within a reasonable time following the occurrence and in any event within 48 hours of the Client first acquiring knowledge of the circumstances of the claim.",
  ],
  [
    { b: "Client's responsibility." },
    " The Client waives the right to claim against the Contractor for any other damages, and agrees to indemnify and hold harmless the Contractor, its officers, employees, agents and representatives from and against any claim, loss, liability, cost or expense that is not caused by the negligence of the Contractor or the Contractor's breach of this Agreement. The Client expressly acknowledges that it has physical possession of, is responsible for, and has control over the condition of the property.",
  ],
  ['This section survives the termination of this Agreement.'],
];

// ── Section 9 · Ice Conditions ─────────────────────────────────────────────
export const ICE_CONDITIONS: Run[][] = [
  [
    'The Client acknowledges that applying sand, salt or other ice melting products to snow or ice will not and cannot result in the immediate or complete removal of ice. The Contractor gives no guarantee or warranty that any application will eliminate ice in any particular circumstance, and is not obliged to apply products that are not commercially and reasonably available.',
  ],
  [
    { b: 'Between events.' },
    ' Sanding and salting included at Levels 2 and 3 is applied following clearing after a snowfall event. It does not extend to conditions arising between events — freeze-thaw, freezing rain, drifting or refreeze. At every service level, the decision of if, when and where ice melting products are applied between events rests solely with the Client. The Client is responsible for monitoring the property and requesting service, and the Contractor is not liable for any claim arising in whole or in part from a failure to apply ice melting products. Between-event applications are available to Level 2 and Level 3 clients only, are billed at the Additional Services rates in Section 4, and are subject to route capacity. ',
    { b: 'At Level 1 no ice control of any kind is provided and none is available on call; the Client arranges its own.' },
  ],
  [
    { b: 'Discretionary attendance.' },
    ' The Contractor may, at its sole discretion, attend the property and apply ice melting products where it observes icy conditions, without a request from the Client. Any such application is billed at the Additional Services rates in Section 4. The Contractor assumes no obligation to inspect or monitor the property, and no liability for failing to attend, observe or apply in any circumstance. This does not relieve the Client of the monitoring responsibility described above, and no past attendance creates an obligation to attend again.',
  ],
];

// ── Section 10 · Delays & Obstructions ─────────────────────────────────────
export const DELAYS: Run[][] = [
  [
    "Where the Contractor is delayed by vehicles, structures or equipment on the property, by an act or omission of the Client, by a municipal by-law or stop work order, by labour disruption, fire, or by any other circumstance reasonably beyond the Contractor's control including severe winter conditions, the time for performance is extended until the delay ends, and the Contractor is not responsible for damages or losses caused by that delay. Where the parties cannot agree whether a snowfall event has occurred, Environment Canada records for the station nearest the property will govern.",
  ],
];

// ── Section 11 · Insurance ─────────────────────────────────────────────────
// Wraps the editable CGL amount: PARTS[0] $ {amount} PARTS[1].
export const INSURANCE_PARTS = [
  'The Contractor maintains Commercial General Liability insurance of not less than $ ',
  ' per occurrence for bodily injury, death and property damage, and maintains WSIB coverage in good standing. Certificates of insurance and evidence of WSIB compliance are provided on request. Clients requiring additional-insured status must request it before the season begins.',
] as const;
// The default figure itself lives with the other contract defaults, in
// snowContracts.ts — one definition, so the clause and a new contract cannot
// disagree about what the standard cover is.

// ── Section 12 · Term & Termination — ADDED for this build ─────────────────
// NOT a transcription. The reference has no termination clause at all, while
// Section 8 states that it survives termination — so the document defined a
// consequence for an event it never defined. Drafted to close that:
//   · the Client's exit from a fixed seasonal price, which is the expensive
//     ambiguity (Option A bills six instalments "regardless of snowfall");
//   · the Contractor's exit for non-payment, which Section 6 left at
//     suspension with no way out;
//   · notice, both ways.
//
// THE EARLY-TERMINATION AMOUNT IS TIERED (50% before January 1, 100% after)
// rather than flat. A clause that accelerates the whole remaining price at any
// date invites the argument that it is a penalty rather than liquidated
// damages — and a penalty clause is struck out entirely, leaving actual loss
// to be proven from scratch. Tiering tracks the real difficulty of reselling
// committed route capacity as the season runs down, which is what makes it a
// genuine pre-estimate.
//
// Deliberately NOT covered: termination for convenience by the Contractor,
// termination for breaches other than non-payment, and termination on force
// majeure (Section 10 extends time for performance; it does not end the
// Agreement).
export const TERMINATION: Run[][] = [
  [
    { b: 'Term.' },
    ' This Agreement runs for the term shown at the top of this Agreement and ends on the last day of that term. It does not renew automatically.',
  ],
  [
    { b: 'Termination by the Client.' },
    ' The Client may terminate this Agreement at any time on thirty (30) days’ written notice. Where Option B is selected, the Client pays for visits performed up to the effective date of termination and nothing further. Where Option A is selected, the seasonal price buys committed route capacity for the full term rather than a set number of visits, and the Client pays (a) all instalments due on or before the effective date, together with any Additional Services performed, and (b) an early-termination amount equal to fifty percent (50%) of the unpaid balance of the seasonal price where notice is given on or before December 31, or one hundred percent (100%) of the unpaid balance where notice is given after that date. The parties agree that the amount in (b) is a genuine pre-estimate of the Contractor’s loss — capacity reserved for this property and withheld from other clients for the season, together with pre-season costs already incurred — and is not a penalty. Where the Client has paid the seasonal price in full, the same calculation applies and the Contractor refunds any excess within thirty (30) days of the effective date.',
  ],
  [
    { b: 'Termination by the Contractor.' },
    ' Where an account remains unpaid thirty (30) days after service is suspended under Section 6, the Contractor may terminate this Agreement on ten (10) days’ written notice, which the Client may avoid by clearing the balance in full within that period. On termination under this paragraph the Client owes the amounts set out in the paragraph above, calculated as if the Client had terminated on the same date. Suspension under Section 6 does not by itself end this Agreement, and nothing in this section limits the Contractor’s right to suspend.',
  ],
  [
    { b: 'Notice.' },
    ' Notice under this section is given in writing by email — to the Client at the billing email in Section 1, and to the Contractor at the office email in Section 13 — and takes effect on the next business day after it is sent. Termination does not affect any right or obligation that accrued before the effective date, or any section stated to survive termination.',
  ],
];

// ── Section 13 · Contact ───────────────────────────────────────────────────
export const CONTACT_NOTE =
  'Voicemails are returned within 24 hours. If there is ever an issue with our service, contact the office immediately and we will find a solution.';

// ── Section 14 · Acceptance ────────────────────────────────────────────────
// CLIENT SIGNATURE ONLY — contracts are signed on paper and returned. There is
// deliberately no contractor signature line and no e-signature path.
//
// FIRST SENTENCE CORRECTED: the reference reads "valid until the date shown in
// Section 1", but Section 1 is Client Details and holds no dates — the validity
// date is in the header block above it. Rewritten to point at the top of the
// Agreement so it cannot break on renumbering again.
export const ACCEPTANCE_PARAS: Run[][] = [
  ['This quotation is valid until the date shown at the top of this Agreement. Pricing and availability are subject to route capacity at the time of acceptance.'],
  ['This Agreement, including the scope, services and pricing option selected above, is the whole agreement between the parties and supersedes all prior discussions and quotations. By signing below, the Client accepts its terms.'],
];
export const SIGNATURE_LABELS = {
  name: 'Client Name (print)',
  signature: 'Client Signature',
  date: 'Date',
} as const;

// Section order and numbering as printed.
//
// IDS ARE STABLE ACROSS THIS REWRITE even where the title changed: `services`
// now prints as "Service Level" and `indemnity` as "Liability & Indemnity".
// hiddenSections stores these ids on saved contracts, so renaming them would
// silently un-hide a section someone had removed. New ids: ice, delays and
// termination.
export const SECTIONS = [
  { id: 'client', n: 1, title: 'Client Details' },
  { id: 'scope', n: 2, title: 'Property Scope' },
  { id: 'services', n: 3, title: 'Service Level' },
  { id: 'pricing', n: 4, title: 'Pricing' },
  { id: 'trigger', n: 5, title: 'Service Trigger & Response' },
  { id: 'payment', n: 6, title: 'Payment & Billing' },
  { id: 'damage', n: 7, title: 'Property Damage' },
  { id: 'indemnity', n: 8, title: 'Liability & Indemnity' },
  { id: 'ice', n: 9, title: 'Ice Conditions' },
  { id: 'delays', n: 10, title: 'Delays & Obstructions' },
  { id: 'insurance', n: 11, title: 'Insurance' },
  { id: 'termination', n: 12, title: 'Term & Termination' },
  { id: 'contact', n: 13, title: 'Contact' },
  { id: 'acceptance', n: 14, title: 'Acceptance' },
] as const;

export type SnowContractSectionId = typeof SECTIONS[number]['id'];

// One hard page break, matching the reference: page 1 is a composed
// fixed-height block ending after the service-area map, and everything from
// Service Level on flows.
export const PAGE_BREAK_AFTER: SnowContractSectionId[] = ['scope'];


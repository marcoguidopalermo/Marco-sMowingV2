// SNOWMASTER · COMMERCIAL CONTRACT — FIXED CONTENT.
//
// This is the contract's LEGAL TEXT, not user input. Every string below is
// transcribed verbatim from reference/Marcos_Snow_Contract_Builder.html —
// paraphrasing an indemnity, liability or payment clause would change what the
// Client is agreeing to, so nothing here is tidied, shortened or reworded.
//
// Two additions were specified for this build and are marked ADDED:
//   1. a service-log bullet in Payment & Billing;
//   2. a new Insurance section before Contact.
// Both are new text rather than transcriptions, so they are flagged as such.

export const CONTRACTOR_LEGAL_NAME = "2849409 Ontario Inc., operating as Marco's";
export const CONTRACTOR_FOOTER_NAME = "2849409 Ontario Inc. operating as Marco's";
export const CONTRACTOR_ADDRESS = '1175 Rosslyn Road, Thunder Bay, ON';
export const OFFICE_PHONE = '(807) 630-4027';
export const OFFICE_EMAIL = 'office@marcosmowing.com';
export const SERVICE_LINE = 'Tony — (807) 630-8904';

export const DOC_TITLE = 'Commercial Snow Removal Agreement';

export const INTRO_LINE =
  'This Agreement is between 2849409 Ontario Inc., operating as Marco’s (the "Contractor") and the Client named below.';

export const SCOPE_INTRO =
  'Defines exactly what is serviced. Anything not listed here is not included.';

export const SERVICES_LEGEND_ON_CALL =
  'On Call = not part of the base price; performed only when the Client requests it, billed at the rate in Section 4.';
export const SERVICES_LEGEND_EXCL =
  'Excl. = the Client is responsible for this work.';

export const PRICING_INTRO =
  'The Client selects one pricing option below. The selected option is locked for the full term and cannot be switched mid-season. All rates are quoted plus HST (13%).';

export const OPTION_A_SUB =
  'Covers unlimited service on every event over the trigger depth, for all services marked Included in Section 3, for the full contract term. The price is fixed and does not change with the number of snowfalls — it buys guaranteed coverage at a set cost.';

export const OPTION_B_SUB =
  'Services are performed together after each event — the Total Per Visit applies when all listed services are completed. Individual rates apply when a service is performed on its own or on call.';

export const ADDONS_NOTE =
  '— apply under either option unless marked Included in Section 3.';

// PRICING VISIBILITY: Option A prints the total and the instalment only. The
// per-service rates behind a seasonal price are commercially sensitive and are
// not disclosed on the printed agreement.
export const OPTION_A_RATES_ON_REQUEST = 'Per-service rates available on request.';

// ── Section 5 · Service Trigger & Response ─────────────────────────────────
export const TRIGGER_BULLETS: { text: string; bold?: string; boldTail?: string }[] = [
  {
    text: 'Service hours are 24/7 — crews may attend at any time, day or night. Continuous snowfall spanning multiple days receives multiple visits throughout the event.',
  },
  {
    text: 'Sanding or salting requested outside a scheduled visit requires 24 hours’ notice. ',
    bold: 'Service cannot be cancelled once accumulation exceeds the trigger depth. The visit will be billed.',
    boldTail: ' Route capacity is committed in advance.',
  },
  {
    text: 'Where snow volume exceeds available on-site storage, relocation or haul-away is required to continue service. Neither is included — both are quoted and agreed when called.',
  },
  {
    text: '',
    bold: 'Parked vehicles:',
    boldTail: ' we will not plow between vehicles unless there is 12’ of clearance, to limit damage risk.',
  },
  {
    text: '',
    bold: 'Marking:',
    boldTail: ' all curbing and obstructions must be pre-marked with 4’ snow markers. Unmarked areas are serviced at the Client’s risk and we are not liable for damage to them. We can supply and install markers on request.',
  },
];

// ── Section 6 · Payment & Billing ──────────────────────────────────────────
export const PAYMENT_BULLETS: { text: string; bold?: string; boldTail?: string; added?: boolean }[] = [
  {
    text: 'Invoices are issued monthly by email within one week of month end, listing every service date and service rendered. Payment is due ',
    bold: 'net 30 days',
    boldTail: ' from the invoice date; a receipt is emailed once payment is received.',
  },
  { text: 'Credit card payments over $1,000 carry a 3% processing fee.' },
  { text: 'Seasonal contract instalments are billed on the schedule in Section 4 regardless of snowfall in that month.' },
  { text: 'Accounts more than 30 days past due may have service suspended until the balance is cleared.' },
  // ADDED for this build — not present in the reference document.
  {
    text: 'A service log is maintained for every visit — date, time, services performed, and conditions — available to the Client on request.',
    added: true,
  },
];

// ── Section 7 · Property Damage ────────────────────────────────────────────
export const PROPERTY_DAMAGE =
  'Damage caused by our crew must be reported to us immediately. We will send a manager to document the damage and determine what action is to be taken. If the Client arranges repairs before contacting us, we cannot provide compensation for that repair. We exercise reasonable care to avoid damage to pavement, grass, trees, and shrubs. We are not responsible for damage to landscaping caused by piling snow, or damage to items that are snow-covered, unmarked, or not visible — including curbing. The Client is responsible for staking or marking hazards before the season begins.';

// ── Section 8 · Indemnity & Hold Harmless ──────────────────────────────────
export const INDEMNITY =
  'The Client agrees to indemnify and hold harmless the Contractor from any claim or liability arising from the following activity: snow plowing, shovelling, sanding, salting, and snow removal, and any and all areas surrounding said areas to be serviced. Client agrees to indemnify, defend and hold harmless Contractor, and its officers, employees, directors, representatives and agents (each, an "Indemnified Party"), from and against any and all claims, losses, settlements, fines, liabilities, damages, deficiencies, costs or expenses (including interest, penalties and attorneys’ fees and disbursements) ("Damages") suffered, sustained, incurred or required to be paid by any such Indemnified Party due to, based upon, arising out of, in connection with, or otherwise in respect of: (i) the performance of the Services contemplated hereby or otherwise as a result of any acts or omissions by Client, its employees, agents, representatives and clients, (ii) failure by Client to perform its obligations under this Agreement, or (iii) enforcement of this paragraph. This paragraph shall survive the termination of this Agreement.';

// ── Section 9 · Insurance — ADDED for this build ───────────────────────────
// Not a transcription. Drafted to the brief: carriage of CGL and WSIB,
// certificates on request, additional-insured requests before season start.
export const INSURANCE =
  'Marco’s carries commercial general liability insurance and WSIB coverage. Certificates of insurance are provided on request. Clients requiring additional-insured status should request it before the season begins.';

// ── Section 10 · Contact ───────────────────────────────────────────────────
export const CONTACT_NOTE =
  'Voicemails are returned within 24 hours. If there is ever an issue with our service, contact the office immediately and we will find a solution.';

// ── Section 11 · Acceptance ────────────────────────────────────────────────
// CLIENT SIGNATURE ONLY — contracts are signed on paper and returned. There is
// deliberately no contractor signature line and no e-signature path.
export const ACCEPTANCE_NOTE =
  'By signing below, the Client accepts the scope, services, pricing option, and terms set out in this Agreement.';

// Section order and numbering as printed. Insurance is inserted before
// Contact, which pushes Contact and Acceptance to 10 and 11.
export const SECTIONS = [
  { id: 'client', n: 1, title: 'Client & Property' },
  { id: 'scope', n: 2, title: 'Property Scope' },
  { id: 'services', n: 3, title: 'Services' },
  { id: 'pricing', n: 4, title: 'Pricing' },
  { id: 'trigger', n: 5, title: 'Service Trigger & Response' },
  { id: 'payment', n: 6, title: 'Payment & Billing' },
  { id: 'damage', n: 7, title: 'Property Damage' },
  { id: 'indemnity', n: 8, title: 'Indemnity & Hold Harmless' },
  { id: 'insurance', n: 9, title: 'Insurance' },
  { id: 'contact', n: 10, title: 'Contact' },
  { id: 'acceptance', n: 11, title: 'Acceptance' },
] as const;

export type SnowContractSectionId = typeof SECTIONS[number]['id'];

// Page boundaries, matching the reference: a break after Property Scope and
// after Pricing.
export const PAGE_BREAK_AFTER: SnowContractSectionId[] = ['scope', 'pricing'];

# FinanceMaster — spec (architecture review, 2026-10-19)

Equipment financing attached to the **existing fleet records**. No second
equipment database: each fleet unit stays the record of the asset; finance
agreements point at units by their fleet `id`.

Status: **agreed approach, not built.** Access: **marcoguidopalermo@gmail.com only.** Order of work: roles step 4 and the
Jobber hardening deploy first; then the registration-alert fix; then this, in
the phase order below.

## Decisions (Marco, 2026-10-19)

| Question | Decision |
|---|---|
| Placement | A restricted **Finance** nav item — not a "Master", not a tab in the Manage Resources modal (draft/whole-save model, too narrow for timelines), not MechanicMaster. Plus a Finance panel on each fleet unit. |
| **Access list** | **ONE account, for now: `marcoguidopalermo@gmail.com`.** Nobody else — not Dave (`office@`), not Tony, not other admins. Hard-coded in the Firestore rule, the Storage rule and the client gate, exactly like mortgages. |
| Adding someone later | **A one-line change in each of three places**, which must stay identical: `FINANCE_VIEWERS` in `src/lib/finance.ts` (client gate), the list in `isFinanceViewer()` in `firestore.rules`, and the same list in `storage.rules`. A test asserts the three lists match. |
| "Financed" badge | Visible **only to the finance viewer** (fleet list, Manage Resources, MechanicMaster). |
| Alerts | Sent **only to the finance viewer(s)** — the same hard-coded list, never the editable notification audience. Pushes carry **no amounts**; details (residual, options) live in the restricted Finance area. |
| Tony | **No.** |

## What the code has today (facts the design rests on)

- Fleet: 86 units in `appData.fleet` (array on `appData/main`, readable and
  writable by every signed-in user, saved whole). Ids `f1…` / `f-<timestamp>`.
- **The Kubota L6070 tractors and the snow blowers are not in the fleet.** No
  unit uses the `tractor` type; the only Kubota is an SCL1000 skid steer.
- **Unit numbers are not unique** (46 collisions within a type) and are freely
  editable → key on `id`, never `unitNumber`.
- **Delete is a hard delete** from the array. Statuses: Active / Out of
  Service / In Repair. No Sold / Retired.
- No cost, price, value, company or year/make/model fields (all in `name`).
- Mortgages already implement the access pattern: root `contractingMortgages`,
  `isMortgageViewer()` email-list rule, listener only for viewers, audit diff.
- Notifications: scan runs inside the 15-min Jobber sync; dedupe markers in
  `notificationDedupe`; the in-app inbox and the send log sit under
  `artifacts/**` (readable by every signed-in user).
- Storage: allowlisted paths only; nothing restricted to named people yet.
- No charting library (CSS bars); no amortization or `addMonths` code.

## Data model

One document per agreement, root collection **`equipmentFinance/{agreementId}`**
(rule: the finance viewer list). Asset links are **embedded** (an agreement covers ≤ ~15
assets: one document, atomic edits, one rule), with `assetIds: string[]`
alongside for server-side `array-contains` queries. The app loads all
agreements (tens) and builds the per-unit view in memory.

| Group | Fields |
|---|---|
| Status | `status`: `proposed` / `active` / `ended`; when ended: `endedAt`, `endReason` (paid_off · bought_out · refinanced · traded · sold · returned · written_off) |
| Parties | `lender`, `agreementNumber`, **`borrower`** (which company holds it) |
| Type | loan · equipment_financing · lease_residual · lease_1_buyout · loc_purchase |
| Dates | `startDate`, **`firstPaymentDate`** (often deferred to spring), `maturityDate`, `termMonths` |
| Money in | `acquisitionCost`, `downPayment`, `tradeInCredit`, `financedAmount`, `aprPct` (optional — often unknown on leases) |
| Payment plan | `frequency` (monthly / quarterly / semi_annual / annual), `amount`, `skipMonths` (seasonal), `paymentCount`, `tax`: `{mode: included \| added \| none, ratePct}` |
| One-offs | `extraPayments: [{date, amount, kind: balloon \| residual_buyout \| fee \| other, taxable}]` |
| Changes | `paymentChanges: [{from, amount}]` (e.g. after one unit is paid out) |
| Residual | `residual`, `residualTaxable` |
| Lender balance | `balanceOverride: {amount, asOf}` — the only stored balance |
| Plan | `endOfTermPlan`: undecided · keep_buyout · trade · sell · return · refinance |
| Chain | `refinancedFromId`, `refinancedById` (old agreement kept, never overwritten) |
| Assets | `assets: [{fleetUnitId \| null, labelSnapshot, serialSnapshot, description, allocatedValue, residualShare, paymentShare?, removedAt?, removedReason?}]` |
| Other | `documents: StoredFile[]` with a type, `notes`, `audit[]`, `createdAt/By`, `updatedAt/By` |

**Changes from the original proposal:**
- No separate `FinanceAgreementAsset` collection — embedded.
- **Derived, never stored:** monthly payment total, remaining payments,
  payments made, estimated balance, cost of borrowing, "Financed" status.
- **Payment plan instead of a flat amount** (seasonal skips, annual, deferred
  first payment, mid-term changes).
- **`borrower`** for agreements held by another company.
- Asset lines may have **no fleet unit** (implements not tracked as fleet).
- **Label and serial snapshots** so a renumbered or deleted unit still reads
  correctly.

Balances: loans — estimated from APR + schedule (or payments-remaining if no
APR); leases — remaining payments + residual, not a "balance"; a lender
balance with an as-of date overrides the estimate.

Restricted collections: `equipmentFinance/*`, `equipmentFinanceAlerts/*`
(rule: `isFinanceViewer()`, read + write; View-As must not read or write — the
client gate checks the REAL sign-in email, as mortgages do). Storage:
`financing/{agreementId}/{file}` with the same email check.

## Reuse

Mortgage access pattern (rule, viewer-only listener, View-As guard,
`mortgageAuditDiff`, `renewalCountdown`/`CountdownLevel`); `uploadFile` /
`deleteFile` / `StoredFile` and the document list from `UnitDocumentsModal`;
`FleetGroupedList` `renderSummary` (badge next to `DocRenewalChip`),
`fleetItemLabel`, `groupFleet`; notification send + dedupe; Toronto date
helpers (`dateUtils.ts`, `propertyMgmt.ts`); the whole-cents branded money
types from the Renewals branch (move to a shared module); the pure-core +
tests + thin UI pattern.

## Defer

V2: lease PDF reading; market value / equity; total cost of ownership; cost
per operating hour; revenue per asset; replacement targets; bank / QuickBooks
payment reconciliation; variable rates; line-of-credit interest modelling; a
separate what-if calculator (Proposed agreements cover it). V1 assumes every
scheduled payment was made. Out of V1: owned-outright purchases, rentals.

## Maturity alerts

- **Own daily schedule (07:00 Toronto)**, not inside the Jobber sync (which
  has gone down twice).
- One per **agreement** per threshold: 180 / 90 / 60 / 30 days.
- Marker includes the maturity date: `fin-<agreementId>-<maturityYmd>-<threshold>`
  (a changed date re-alerts).
- On entry, only the most urgent current threshold fires (no backlog).
- Proposed and ended agreements never alert.
- Recipients: the finance viewer list only (today just Marco), hard-coded —
  never the editable notification audience.
- **Push:** no amounts, e.g. "Kubota Credit agreement (7 units) matures in 60
  days — decision required. Open Finance." Not written to `notificationLog`.
- **Restricted alert record** (`equipmentFinanceAlerts`) carries the residual
  and the options (Buyout / Refinance / Trade / Return), shown in Finance.

## Timeline and cash flow

One tested pure function turns each agreement into dated payments (regular,
one-offs, residual/balloon, each with tax). From it:
- monthly cash flow (12 / 24 / 36 / 60 months) — what actually leaves the
  account, HST included;
- per-year totals: residuals by year, maturities by year with unit counts;
- residual exposure buckets 0–12 / 12–24 / 24–36 / 36+ months, separate from
  debt;
- per-category totals (Tractors, Trucks, Trailers, Other) and a company-wide
  total.

Views: a maturity timeline (one lane per agreement, 2026–2031, marker sized by
residual, grouped by category) with **Proposed agreements dashed and
toggleable**; stacked monthly cash-flow bars with spike months labelled; a
yearly table under it. CSS/SVG, no chart library. Tested against the real
7-tractor agreement and the 4 + 7 tractor clash before any screen.

## Edge cases

Assets not yet in the fleet; implements that never will be; hard deletes →
Sold / Retired / Written off statuses with a date, Delete becomes Retire for
units with history; one unit paid out of a group mid-term (removal + payment
change); allocations must sum to the financed amount and residual (warn);
deferred first payments; trade-ins as down payment; HST on lease payments and
on lease buyouts; leases running past maturity undecided ("Past maturity",
keep alerting); early buyout / payoff; a different borrowing company; View-As
leakage; mortgages are Marco + Tony while finance is Marco only — two
separate lists on purpose.

## Implementation plan (each phase behind the single-account gate)

0. **Prerequisites:** add the L6070 tractors and the snow blowers to the
   fleet; add Sold / Retired / Written off statuses with a date and turn
   Delete into Retire.
1. **Calculation + rules (no UI):** types, schedule generator, cash flow,
   maturity and residual buckets, balance estimates — tested against real
   agreements; Firestore + Storage rules tested in the emulator.
2. **Agreements:** Finance page with list and editor (fleet asset picker,
   documents, audit); fleet unit Finance panel and badge.
3. **Overview:** dashboard, maturity timeline, cash flow, residual exposure,
   Proposed overlay.
4. **Alerts:** daily check, restricted alert records, amount-free pushes,
   date-stamped markers.

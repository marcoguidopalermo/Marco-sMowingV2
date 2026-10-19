// FINANCEMASTER — equipment finance agreements (docs/financemaster-spec.md).
//
// Stored at the ROOT collection equipmentFinance/{agreementId}, readable and
// writable only by FINANCE_VIEWERS (firestore.rules isFinanceViewer). Never
// on appData/main. Each agreement points at fleet units by their fleet `id`
// (never the unit number, which isn't unique and can change), and keeps a
// copy of the unit's label/serial so it still reads correctly if the unit is
// renumbered or deleted.
//
// TERMS are stored; SCHEDULES, balances, remaining payments and cost of
// borrowing are DERIVED (schedule.ts / calc.ts). The only stored balance is a
// lender-statement override with an as-of date.
import type { StoredFile } from '../../types';

/** YYYY-MM-DD */
export type Ymd = string;
/** Whole cents. Stored as plain numbers in Firestore. */
export type CentsNum = number;

export type AgreementStatus = 'proposed' | 'active' | 'ended';
export type EndReason = 'paid_off' | 'bought_out' | 'refinanced' | 'traded' | 'sold' | 'returned' | 'written_off';
export type AgreementType = 'loan' | 'equipment_financing' | 'lease_residual' | 'lease_1_buyout' | 'loc_purchase';
export type Frequency = 'monthly' | 'quarterly' | 'semi_annual' | 'annual';
export type TaxMode = 'included' | 'added' | 'none';
export type ExtraKind = 'balloon' | 'residual_buyout' | 'payoff' | 'fee' | 'other';
export type EndOfTermPlan = 'undecided' | 'keep_buyout' | 'trade' | 'sell' | 'return' | 'refinance';
export type FinanceDocType = 'lease_contract' | 'financing_contract' | 'purchase_agreement' | 'quote' | 'bill_of_sale' | 'payment_schedule' | 'invoice' | 'buyout_quote' | 'warranty' | 'insurance' | 'registration' | 'other';
/** The documents that count as "the contract" for the missing-contract list. */
export const CONTRACT_DOC_TYPES: FinanceDocType[] = ['lease_contract', 'financing_contract', 'purchase_agreement'];

export interface PaymentPlan {
  frequency: Frequency;
  amount: CentsNum;                 // per payment, before tax unless tax.mode === 'included'
  firstPaymentDate: Ymd;            // often deferred (e.g. "no payments until spring")
  paymentCount: number;             // number of regular payments actually made
  skipMonths?: number[];            // 1–12: seasonal plans skip these months (don't count)
}

export interface TaxSpec { mode: TaxMode; ratePct: number }

export interface ExtraPayment { date: Ymd; amount: CentsNum; kind: ExtraKind; taxable?: boolean; note?: string }

/** From `from` onward, each regular payment is `amount` (e.g. after one unit is paid out). */
export interface PaymentChange { from: Ymd; amount: CentsNum; note?: string }

export interface AgreementAsset {
  fleetUnitId: string | null;       // null = an item not tracked in the fleet (e.g. an implement)
  labelSnapshot: string;            // unit label when linked — survives renumber/delete
  serialSnapshot?: string;
  description?: string;             // for items without a fleet unit
  purchasePrice?: CentsNum;         // the unit's price on the quote / bill of sale
  allocatedValue: CentsNum;         // share of the financed amount / acquisition
  residualShare?: CentsNum;         // share of the residual
  paymentShare?: CentsNum;          // optional explicit share of the regular payment
  removedAt?: Ymd;                  // left the agreement mid-term (paid out) — no longer financed
  removedReason?: string;
  // Sold / gone but STILL on the agreement: still part of the financed
  // amount and the payments (the sale did not pay down the loan).
  // date null = sold, date not known yet.
  disposal?: { kind: 'sold' | 'traded' | 'written_off'; date: Ymd | null; note?: string } | null;
}

/** A unit traded in as (part of) the down payment. */
export interface TradeIn { description: string; serial?: string; value: CentsNum; fleetUnitId?: string | null }

export interface FinanceDocument extends StoredFile { docType: FinanceDocType; label?: string }

export interface AuditEntry { at: number; by: string; changes: string[] }

export interface FinanceAgreement {
  id: string;
  status: AgreementStatus;
  endedAt?: Ymd;
  endReason?: EndReason;
  lender: string;
  agreementNumber?: string;
  borrower?: string;                // which company holds it
  type: AgreementType;
  startDate: Ymd;
  maturityDate: Ymd;
  termMonths: number;
  acquisitionCost: CentsNum;
  downPayment?: CentsNum;
  tradeInCredit?: CentsNum;         // = sum of tradeIns when they are listed
  tradeIns?: TradeIn[];
  taxFinanced?: CentsNum;           // HST charged on the purchase and rolled into the loan
  financedAmount: CentsNum;
  aprPct?: number | null;           // often unknown on leases
  plan: PaymentPlan;
  tax: TaxSpec;
  extraPayments?: ExtraPayment[];
  paymentChanges?: PaymentChange[];
  residual?: CentsNum;              // lease residual / buyout (lease_1_buyout: $1)
  residualTaxable?: boolean;
  balanceOverride?: { amount: CentsNum; asOf: Ymd } | null;
  endOfTermPlan: EndOfTermPlan;
  refinancedFromId?: string;
  refinancedById?: string;
  assets: AgreementAsset[];
  assetIds: string[];               // = assets' fleetUnitIds (for queries)
  documents?: FinanceDocument[];
  notes?: string;
  /** Open questions to settle ("sale date unknown", "agreement # unknown"). */
  flags?: string[];
  audit?: AuditEntry[];
  createdAt?: number;
  createdBy?: string;
  updatedAt?: number;
  updatedBy?: string;
  deletedAt?: number;               // soft delete — hidden, kept
}

export const AGREEMENT_TYPE_LABEL: Record<AgreementType, string> = {
  loan: 'Loan',
  equipment_financing: 'Equipment financing',
  lease_residual: 'Lease with residual',
  lease_1_buyout: 'Lease, $1 buyout',
  loc_purchase: 'Line-of-credit purchase',
};
export const FREQUENCY_LABEL: Record<Frequency, string> = {
  monthly: 'Monthly', quarterly: 'Quarterly', semi_annual: 'Semi-annual', annual: 'Annual',
};
export const FREQUENCY_MONTHS: Record<Frequency, number> = { monthly: 1, quarterly: 3, semi_annual: 6, annual: 12 };
export const END_PLAN_LABEL: Record<EndOfTermPlan, string> = {
  undecided: 'Undecided', keep_buyout: 'Keep / buy out', trade: 'Trade', sell: 'Sell', return: 'Return', refinance: 'Refinance',
};
export const END_REASON_LABEL: Record<EndReason, string> = {
  paid_off: 'Paid off', bought_out: 'Bought out', refinanced: 'Refinanced', traded: 'Traded', sold: 'Sold', returned: 'Returned', written_off: 'Written off',
};
export const DOC_TYPE_LABEL: Record<FinanceDocType, string> = {
  lease_contract: 'Lease contract', financing_contract: 'Financing contract', purchase_agreement: 'Purchase agreement',
  quote: 'Quote', bill_of_sale: 'Bill of sale', payment_schedule: 'Payment schedule', invoice: 'Invoice', buyout_quote: 'Buyout quote',
  warranty: 'Warranty', insurance: 'Insurance', registration: 'Registration', other: 'Other',
};
export const isLease = (t: AgreementType) => t === 'lease_residual' || t === 'lease_1_buyout';

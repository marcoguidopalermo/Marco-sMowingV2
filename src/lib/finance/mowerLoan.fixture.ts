// A made-up equipment loan shaped like a real dealer deal — invented
// figures only (real loan and lease terms don't live in the repo). It
// exercises: a trade-in-only down payment, HST financed into the loan, a
// 0% loan whose payments fall short of the financed amount, a unit sold
// but still on the agreement, and allocation by purchase price.
import type { FinanceAgreement } from './types';
import { allocateByWeight } from './portfolio';
import { dollars as $ } from './money';

export const MOWER_LINES = [
  { fleetUnitId: 'f-mower-60', label: '#2 60" Rider', serial: 'SN-0060', price: $(20_000) },
  { fleetUnitId: 'f-mower-72', label: '#1 72" Rider', serial: 'SN-0072', price: $(22_000) },
  { fleetUnitId: 'f-stand-36a', label: '#7 36" Stand On', serial: 'SN-3601', price: $(12_000) },
  { fleetUnitId: 'f-stand-36b', label: '#8 36" Stand On', serial: 'SN-3602', price: $(11_000) },
  { fleetUnitId: 'f-stand-48a', label: '#4 48" Stand On', serial: 'SN-4801', price: $(13_000) },
  { fleetUnitId: 'f-stand-48b', label: '#5 48" Stand On', serial: 'SN-4802', price: $(13_000) },
  { fleetUnitId: null, label: 'Front loader + bucket', serial: '', price: $(8_000) },
];
// Unit prices add up to $99,000; the selling price is $99,400 (a $400 fee
// gap). $99,400 − $24,000 trades + $9,802 HST = $85,202.00; the "contract"
// says $85,202.01 (a 1¢ gap). 36 × $2,366 = $85,176 — $26.01 short.
const FINANCED = $(85_202.01);
const ALLOC = allocateByWeight(FINANCED, MOWER_LINES.map(l => l.price));

export const MOWER_LOAN: FinanceAgreement = {
  id: 'fin-example-mowers',
  status: 'active',
  lender: 'Example Credit (via Example Dealer)',
  borrower: 'Example Holdings Inc.',
  type: 'loan',
  startDate: '2025-04-09',
  maturityDate: '2028-05-02',
  termMonths: 36,
  acquisitionCost: $(99_400),
  downPayment: 0,
  tradeInCredit: $(24_000),
  tradeIns: [
    { description: 'Old bagging mower', serial: 'TR-1', value: $(14_000), fleetUnitId: null },
    { description: 'Old zero-turn with steering wheel', value: $(6_000), fleetUnitId: null },
    { description: 'Old 52" zero-turn', value: $(4_000), fleetUnitId: null },
  ],
  taxFinanced: $(9_802),
  financedAmount: FINANCED,
  aprPct: 0,
  plan: { frequency: 'monthly', amount: $(2_366), firstPaymentDate: '2025-06-02', paymentCount: 36 },
  tax: { mode: 'none', ratePct: 0 },
  residual: 0,
  endOfTermPlan: 'keep_buyout',
  assets: MOWER_LINES.map((l, i) => ({
    fleetUnitId: l.fleetUnitId,
    labelSnapshot: l.label,
    ...(l.serial ? { serialSnapshot: l.serial } : {}),
    ...(l.fleetUnitId ? {} : { description: l.label }),
    purchasePrice: l.price,
    allocatedValue: ALLOC[i],
    ...(i === 6 ? { disposal: { kind: 'sold' as const, date: null, note: 'Sold; the sale did not pay down the loan — payment unchanged.' } } : {}),
  })),
  assetIds: [],
  flags: ['Agreement number unknown.', 'Loader: sale date unknown.'],
  documents: [],
};

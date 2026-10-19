// The April 2025 Kubota mower loan (Kubota Thunder Bay quote #2001190,
// Apr 9 2025, plus the actual bank payments) — the agreement exactly as
// proposed to Marco on 2026-10-19. Used by the tests and, once Marco
// confirms the match table, as the record to write.
import type { FinanceAgreement } from './types';
import { allocateByWeight } from './portfolio';
import { dollars as $ } from './money';

export const MOWER_LINES = [
  { fleetUnitId: 'f-1779209237541', label: '#2 60" Rider (Kubota ZD1211 60")', serial: '19776', price: $(24_430.43) },
  { fleetUnitId: null, label: 'Kubota ZD1211L 72" diesel zero-turn', serial: '', price: $(25_660.87) },
  { fleetUnitId: 'f-1779209415006', label: '#7 36" Stand On (SZ19-36)', serial: '12401', price: $(15_133.04) },
  { fleetUnitId: 'f-1779209421839', label: '#8 36" Stand On (SZ19-36)', serial: '16394', price: $(13_398.04) },
  { fleetUnitId: 'f-1779209397523', label: '#4 48" Stand On (SZ22-48)', serial: '14174', price: $(15_556.04) },
  { fleetUnitId: 'f-1779209410506', label: '#5 48" Stand On (SZ22-48)', serial: '14175', price: $(15_556.04) },
  { fleetUnitId: null, label: 'Kubota LA1055 front loader + 72" bucket', serial: '', price: $(9_752.03) },
];
const FINANCED = $(101_034.99);
const ALLOC = allocateByWeight(FINANCED, MOWER_LINES.map(l => l.price));

export const MOWER_LOAN: FinanceAgreement = {
  id: 'fin-kubota-mowers-2025',
  status: 'active',
  lender: 'Kubota Credit (via Kubota Thunder Bay)',
  borrower: '2849409 Ontario Inc.',
  type: 'loan',
  startDate: '2025-04-09',
  maturityDate: '2028-05-02',
  termMonths: 36,
  acquisitionCost: $(119_911.49),
  downPayment: 0,
  tradeInCredit: $(30_500),
  tradeIns: [
    { description: '2008 Kubota F2880 bagging mower', serial: '11160', value: $(17_500), fleetUnitId: null },
    { description: '2019 Pro Z 760 zero-turn with steering wheel', value: $(8_000), fleetUnitId: null },
    { description: '2018 700Z 52" zero-turn', value: $(5_000), fleetUnitId: null },
  ],
  taxFinanced: $(11_623.49),
  financedAmount: FINANCED,
  aprPct: 0,
  plan: { frequency: 'monthly', amount: $(2_805.54), firstPaymentDate: '2025-06-02', paymentCount: 36 },
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
  flags: [
    'Agreement number unknown.',
    'LA1055 loader: sale date unknown.',
    'Borrower: quote shows "28494094" — taken as 2849409 Ontario Inc. (typo).',
    '36 × $2,805.54 = $100,999.44 — $35.55 under the financed $101,034.99 (different final payment or contract figure?). Not adjusted.',
    'Unit prices add up to $119,486.49; the selling price is $119,911.49 — $425.00 not in any unit line (fees?).',
    'Quote arithmetic: $119,911.49 − $30,500.00 + $11,623.49 = $101,034.98, quote says $101,034.99 (1¢).',
  ],
  notes: 'Kubota Thunder Bay quote #2001190, Apr 9 2025. Payments from the bank: $2,805.54 on the 2nd, Jun 2 2025 – May 2 2028 (quote said $2,807.72). HST charged on the purchase and financed; the payments carry no HST. Down payment = trade-ins only, no cash.',
  documents: [],
};

// WHO CAN SEE FINANCEMASTER — one account, for now (Marco, 2026-10-19).
//
// Hard-coded like the mortgage viewers, and the SAME list must appear in
// firestore.rules (isFinanceViewer) and storage.rules (isFinanceViewer).
// Adding someone = one line here + the same line in each rules file;
// access.test.ts fails if the three lists ever differ.
//
// Gate on the REAL sign-in email, never the View-As identity.
export const FINANCE_VIEWERS: readonly string[] = [
  'marcoguidopalermo@gmail.com',
];

export function canSeeFinance(email: string | null | undefined): boolean {
  const e = (email || '').trim().toLowerCase();
  return !!e && FINANCE_VIEWERS.includes(e);
}

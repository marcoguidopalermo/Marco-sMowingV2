// WHO SEES THE SALES SCOREBOARD — James (sales@) and Marco (2026-10-20).
// The SAME list is in firestore.rules (isSalesViewer) and the functions'
// SALES_VIEWERS (salesPull.ts); access.test.ts checks they match.
// Gate on the REAL sign-in email, never the View-As identity.
export const SALES_VIEWERS: readonly string[] = [
  'sales@marcosmowing.com',
  'marcoguidopalermo@gmail.com',
];
export function canSeeSales(email: string | null | undefined): boolean {
  const e = (email || '').trim().toLowerCase();
  return !!e && SALES_VIEWERS.includes(e);
}

// WHO CAN SEE OFFICEMASTER — Dave (office@) and Marco (Marco, 2026-10-20).
//
// The SAME list must appear in firestore.rules and storage.rules
// (isOfficeViewer); access.test.ts fails if the three lists ever differ.
// Adding someone = one line here + the same line in each rules file.
// Gate on the REAL sign-in email, never the View-As identity.
export const OFFICE_VIEWERS: readonly string[] = [
  'office@marcosmowing.com',
  'marcoguidopalermo@gmail.com',
];

export function canSeeOffice(email: string | null | undefined): boolean {
  const e = (email || '').trim().toLowerCase();
  return !!e && OFFICE_VIEWERS.includes(e);
}

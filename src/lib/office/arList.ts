// OfficeMaster A/R list: age-bucket filter + sort, applied together.
export type AgeKey = 'notDue' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus';
export const AGE_KEYS: AgeKey[] = ['notDue', 'd1_30', 'd31_60', 'd61_90', 'd90plus'];
export type ARFilter = 'all' | AgeKey;
export type ARSort = 'overdue' | 'amountDesc' | 'amountAsc' | 'client';
export const SORT_LABEL: Record<ARSort, string> = { overdue: 'Oldest first', amountDesc: 'Amount ↓', amountAsc: 'Amount ↑', client: 'Client A–Z' };

export interface ARRow { age?: AgeKey; client: string; balance: number; daysOverdue: number; dueDate: string | null; invoiceNumber: string }

/** Age bucket from days past due (rows from older pulls carry no `age`). */
export function ageOf(r: ARRow): AgeKey {
  if (r.age) return r.age;
  const d = r.daysOverdue;
  return d <= 0 ? 'notDue' : d <= 30 ? 'd1_30' : d <= 60 ? 'd31_60' : d <= 90 ? 'd61_90' : 'd90plus';
}

export function sortAmount<T extends { balance: number }>(rows: T[], dir: 'desc' | 'asc'): T[] {
  return [...rows].sort((a, b) => (dir === 'desc' ? b.balance - a.balance : a.balance - b.balance));
}

export function filterSortAR<T extends ARRow>(rows: T[], filter: ARFilter, sort: ARSort): T[] {
  const out = filter === 'all' ? [...rows] : rows.filter(r => ageOf(r) === filter);
  const byNumber = (a: T, b: T) => a.invoiceNumber.localeCompare(b.invoiceNumber, undefined, { numeric: true });
  switch (sort) {
    case 'amountDesc': return out.sort((a, b) => b.balance - a.balance || byNumber(a, b));
    case 'amountAsc': return out.sort((a, b) => a.balance - b.balance || byNumber(a, b));
    case 'client': return out.sort((a, b) => a.client.localeCompare(b.client, 'en', { sensitivity: 'base' }) || b.balance - a.balance);
    default: // oldest first; not-yet-due ones by soonest due date
      return out.sort((a, b) => b.daysOverdue - a.daysOverdue || (a.dueDate || '').localeCompare(b.dueDate || '') || b.balance - a.balance);
  }
}

export const totalOf = (rows: { balance: number }[]) => Math.round(rows.reduce((s, r) => s + r.balance, 0) * 100) / 100;

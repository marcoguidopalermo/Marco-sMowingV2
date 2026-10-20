// Company deadlines & notices (OfficeMaster section 2). Root collection
// officeDeadlines/{id}, office viewers only (firestore.rules).
import type { StoredFile } from '../../types';

export type DeadlineCategory = 'cvor' | 'insurance' | 'wsib' | 'licence' | 'government' | 'lender' | 'tax' | 'other';
export const CATEGORY_LABEL: Record<DeadlineCategory, string> = {
  cvor: 'CVOR', insurance: 'Insurance', wsib: 'WSIB', licence: 'Licence', government: 'Government notice',
  lender: 'Lender', tax: 'Tax', other: 'Other',
};
export type RecurrenceUnit = 'month' | 'year';
export interface Recurrence { every: number; unit: RecurrenceUnit }
export const RECURRENCE_OPTIONS: { label: string; value: Recurrence | null }[] = [
  { label: 'Does not repeat', value: null },
  { label: 'Monthly', value: { every: 1, unit: 'month' } },
  { label: 'Every 3 months', value: { every: 3, unit: 'month' } },
  { label: 'Every 6 months', value: { every: 6, unit: 'month' } },
  { label: 'Yearly', value: { every: 1, unit: 'year' } },
];
export const recurrenceLabel = (r: Recurrence | null | undefined) =>
  !r ? 'Does not repeat' : RECURRENCE_OPTIONS.find(o => o.value && o.value.every === r.every && o.value.unit === r.unit)?.label || `Every ${r.every} ${r.unit}s`;

export interface OfficeDeadline {
  id: string;
  kind: 'deadline' | 'notice';       // notice = a one-off letter that needs a response
  title: string;
  category: DeadlineCategory;
  dueDate: string | null;            // YYYY-MM-DD; null = not entered yet
  reference?: string;
  notes?: string;
  documents?: StoredFile[];
  recurrence?: Recurrence | null;
  seriesId?: string;                 // all occurrences of a recurring item share it
  status: 'open' | 'done';
  doneAt?: number;
  doneBy?: string;
  nextId?: string;                   // the occurrence created when this one was done
  createdAt?: number;
  createdBy?: string;
  updatedAt?: number;
  updatedBy?: string;
  deletedAt?: number;                // soft delete
}

export function newDeadlineId(now = Date.now()) { return `od-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`; }

/** Calendar add (clamping the day: Jan 31 + 1 month → Feb 28/29). */
export function addToYmd(ymd: string, r: Recurrence): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const months = r.unit === 'year' ? 12 * r.every : r.every;
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12), nm = total % 12 + 1;
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`;
}

/**
 * Marking an item done. Returns the updated item and, for a recurring item
 * with a date, the next occurrence (same title/category/reference/notes,
 * next due date, no documents, open).
 */
export function completeDeadline(item: OfficeDeadline, by: string, now = Date.now()): { done: OfficeDeadline; next: OfficeDeadline | null } {
  const next = item.recurrence && item.dueDate ? {
    id: newDeadlineId(now + 1), kind: item.kind, title: item.title, category: item.category,
    dueDate: addToYmd(item.dueDate, item.recurrence), reference: item.reference, notes: item.notes,
    documents: [], recurrence: item.recurrence, seriesId: item.seriesId || item.id, status: 'open' as const,
    createdAt: now, createdBy: by, updatedAt: now, updatedBy: by,
  } : null;
  const done: OfficeDeadline = { ...item, status: 'done', doneAt: now, doneBy: by, seriesId: item.seriesId || item.id, ...(next ? { nextId: next.id } : {}), updatedAt: now, updatedBy: by };
  return { done, next };
}

export type Tone = 'red' | 'amber' | 'none';
/** Same thresholds as the fleet renewals strip: red once past, amber within 30 days. */
export function dueTone(daysLeft: number | null): Tone {
  if (daysLeft == null) return 'none';
  if (daysLeft < 0) return 'red';
  return daysLeft <= 30 ? 'amber' : 'none';
}
export function dueLabel(daysLeft: number | null): string {
  if (daysLeft == null) return 'No date yet';
  if (daysLeft < 0) return `${-daysLeft} day${daysLeft === -1 ? '' : 's'} overdue`;
  if (daysLeft === 0) return 'Due today';
  return `Due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
}

/** Open items: dated soonest first, then the ones waiting for a date. Done items separate. */
export function sortDeadlines(items: OfficeDeadline[]): { open: OfficeDeadline[]; noDate: OfficeDeadline[]; done: OfficeDeadline[] } {
  const live = items.filter(x => !x.deletedAt);
  return {
    open: live.filter(x => x.status === 'open' && x.dueDate).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!)),
    noDate: live.filter(x => x.status === 'open' && !x.dueDate).sort((a, b) => a.title.localeCompare(b.title)),
    done: live.filter(x => x.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)),
  };
}

/** Suggested items, seeded once with blank dates (Marco, 2026-10-20). */
export const SEED_DEADLINES: Pick<OfficeDeadline, 'title' | 'category' | 'recurrence' | 'notes'>[] = [
  { title: 'CVOR renewal', category: 'cvor', recurrence: { every: 1, unit: 'year' }, notes: '' },
  { title: 'Commercial insurance renewal', category: 'insurance', recurrence: { every: 1, unit: 'year' }, notes: '' },
  { title: 'WSIB clearance certificate', category: 'wsib', recurrence: null, notes: 'Set how often it needs renewing once the date is in.' },
  { title: 'Payroll tax remittance', category: 'tax', recurrence: { every: 1, unit: 'month' }, notes: '' },
];

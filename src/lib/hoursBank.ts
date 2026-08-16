// HOURS BANK — the ledger's arithmetic and its rules.
//
// Pure functions over HoursBankEntry[]. Everything the UI shows — a balance, a
// running balance, who is owed what, the company total — is derived here and
// recomputed from the entries every time. NOTHING IS STORED AS A TOTAL: a
// cached balance is a second source of truth for money owed, and the first
// time it disagrees with the entries nobody can say which one is right.
import type { Employee, HoursBankEntry, HoursBankEntryType } from '../types';
import type { PayPeriod } from './payPeriods';

// Hours are recorded to a tenth. Payroll rounds somewhere; it may as well be
// somewhere visible, and 0.1h is 6 minutes.
export const roundHours = (n: number): number => Math.round((Number(n) || 0) * 10) / 10;

export const isBankEntry = (e: unknown): e is HoursBankEntry =>
  !!e && typeof e === 'object' && typeof (e as HoursBankEntry).id === 'string'
  && typeof (e as HoursBankEntry).employeeId === 'string';

// ── ORDER ──────────────────────────────────────────────────────────────────
// Oldest first, which is the order a running balance has to be computed in.
// recordedAt is the ledger's clock; the id breaks a tie so two entries written
// in the same millisecond still order deterministically on every device.
export const chronological = (entries: HoursBankEntry[]): HoursBankEntry[] =>
  [...entries].sort((a, b) => (a.recordedAt || 0) - (b.recordedAt || 0) || a.id.localeCompare(b.id));

export const entriesFor = (
  all: Record<string, HoursBankEntry> | HoursBankEntry[],
  employeeId: string,
): HoursBankEntry[] => {
  const list = Array.isArray(all) ? all : Object.values(all || {});
  return chronological(list.filter(e => isBankEntry(e) && e.employeeId === employeeId));
};

// ── BALANCE ────────────────────────────────────────────────────────────────
export const balanceOf = (entries: HoursBankEntry[]): number =>
  roundHours(entries.reduce((s, e) => s + (Number(e.hours) || 0), 0));

// Each entry with the balance AS AT that entry, oldest first. This is what
// makes the history reconcile at a glance: every row shows what the ledger
// stood at once that row had happened.
export interface LedgerRow { entry: HoursBankEntry; balance: number }
export function ledgerRows(entries: HoursBankEntry[]): LedgerRow[] {
  let running = 0;
  return chronological(entries).map(entry => {
    running = roundHours(running + (Number(entry.hours) || 0));
    return { entry, balance: running };
  });
}
// Newest first — how a ledger is read.
export const ledgerRowsNewestFirst = (entries: HoursBankEntry[]): LedgerRow[] =>
  ledgerRows(entries).reverse();

// ── THE ROLL-UP ────────────────────────────────────────────────────────────
export interface BankSummary {
  employeeId: string;
  employeeName: string;
  balance: number;
  entryCount: number;
  lastActivityAt: number;
}

// Every ledger with anything in it, biggest balance first. Employees are
// matched by id; an entry whose employee has since been removed still appears,
// under the name recorded on it — the hours are owed to a person, not to a row
// in the roster.
export function summaries(
  all: Record<string, HoursBankEntry> | HoursBankEntry[],
  employees: Employee[] = [],
): BankSummary[] {
  const list = (Array.isArray(all) ? all : Object.values(all || {})).filter(isBankEntry);
  const byId = new Map<string, HoursBankEntry[]>();
  for (const e of list) {
    const arr = byId.get(e.employeeId);
    if (arr) arr.push(e); else byId.set(e.employeeId, [e]);
  }
  const nameOf = (id: string, fallback: string) =>
    employees.find(emp => emp.id === id)?.name || fallback;
  return [...byId.entries()]
    .map(([employeeId, entries]) => {
      const ordered = chronological(entries);
      const last = ordered[ordered.length - 1];
      return {
        employeeId,
        employeeName: nameOf(employeeId, last?.employeeName || 'Unknown'),
        balance: balanceOf(ordered),
        entryCount: ordered.length,
        lastActivityAt: last?.recordedAt || 0,
      };
    })
    .sort((a, b) => b.balance - a.balance || a.employeeName.localeCompare(b.employeeName));
}

// The overview only lists people the company is actually carrying hours for.
// A ledger that has netted to zero is history, not an outstanding position —
// it stays reachable through that employee's own ledger.
export const outstanding = (rows: BankSummary[]): BankSummary[] =>
  rows.filter(r => Math.abs(r.balance) > 0.001);

export const companyTotal = (rows: BankSummary[]): number =>
  roundHours(rows.reduce((s, r) => s + r.balance, 0));

// ── WRITING ────────────────────────────────────────────────────────────────
// Builders, not writers: they return the entry and the caller saves it. The
// SIGN is applied here, in one place, so "banked" can never be stored as a
// negative or "paid out" as a positive.
const newId = (): string =>
  `hb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export interface BankedInput {
  employee: { id: string; name: string };
  hours: number;              // magnitude, as typed
  period: Pick<PayPeriod, 'start' | 'end'>;
  note?: string;
}
export function bankedEntry(input: BankedInput): Omit<HoursBankEntry, 'recordedAt' | 'recordedBy'> {
  return {
    id: newId(),
    employeeId: input.employee.id,
    employeeName: input.employee.name,
    type: 'banked',
    hours: Math.abs(roundHours(input.hours)),
    periodStart: input.period.start,
    periodEnd: input.period.end,
    note: (input.note || '').trim() || undefined,
  };
}

export interface PayoutInput {
  employee: { id: string; name: string };
  hours: number;              // magnitude, as typed
  paidOn: string;             // YYYY-MM-DD
  note?: string;
}
export function payoutEntry(input: PayoutInput): Omit<HoursBankEntry, 'recordedAt' | 'recordedBy'> {
  return {
    id: newId(),
    employeeId: input.employee.id,
    employeeName: input.employee.name,
    type: 'paid_out',
    hours: -Math.abs(roundHours(input.hours)),
    paidOn: input.paidOn,
    note: (input.note || '').trim() || undefined,
  };
}

// THE CORRECTION. Exactly negates the target, so the pair nets to nothing and
// both halves stay visible — which is the point. It carries the reversed
// entry's own details forward (the period, the payout date) so the history
// still reads as a statement about that week rather than an unexplained
// adjustment floating on its own.
export function reversalEntry(
  target: HoursBankEntry,
  reason: string,
): Omit<HoursBankEntry, 'recordedAt' | 'recordedBy'> {
  return {
    id: newId(),
    employeeId: target.employeeId,
    employeeName: target.employeeName,
    type: 'reversal',
    hours: -(Number(target.hours) || 0),
    periodStart: target.periodStart,
    periodEnd: target.periodEnd,
    paidOn: target.paidOn,
    reversesId: target.id,
    reversalReason: reason.trim(),
  };
}

// An entry that has already been reversed cannot be reversed again — the
// second reversal would put the hours back and read as a correction.
export const reversedIds = (entries: HoursBankEntry[]): Set<string> =>
  new Set(entries.map(e => e.reversesId).filter(Boolean) as string[]);

export const canReverse = (e: HoursBankEntry, already: Set<string>): boolean =>
  e.type !== 'reversal' && !already.has(e.id);

// ── VALIDATION ─────────────────────────────────────────────────────────────
// What the form must satisfy before anything is written. Returns the reason it
// cannot be saved, or null.
export function validateHours(raw: string | number): string | null {
  const n = Number(raw);
  if (!raw && raw !== 0) return 'Enter the hours.';
  if (!Number.isFinite(n)) return 'Hours must be a number.';
  if (n <= 0) return 'Hours must be more than zero.';
  if (n > 2000) return 'That looks like a typo — 2,000 hours is the limit on a single entry.';
  return null;
}

// A payout for more than the balance is allowed to be FLAGGED but not blocked:
// the ledger records what happened, and if someone was paid out more than the
// bank held, the honest record says so and the balance goes negative.
export const overdrawnBy = (balance: number, payoutHours: number): number =>
  roundHours(Math.max(0, Math.abs(payoutHours) - balance));

// ── DISPLAY ────────────────────────────────────────────────────────────────
export const fmtHours = (n: number): string => {
  const v = roundHours(Math.abs(n));
  return `${v.toFixed(1)} hr${v === 1 ? '' : 's'}`;
};
export const signedHours = (n: number): string =>
  `${(Number(n) || 0) >= 0 ? '+' : '−'}${fmtHours(n)}`;

export const ENTRY_LABEL: Record<HoursBankEntryType, string> = {
  banked: 'Banked',
  paid_out: 'Paid out',
  reversal: 'Reversal',
};

const mdy = (ymd?: string): string => {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
export const periodLabel = (e: HoursBankEntry): string =>
  e.periodStart ? `week of ${mdy(e.periodStart)}` : '';
export const paidOnLabel = (e: HoursBankEntry): string => (e.paidOn ? mdy(e.paidOn) : '');

// "Banked 8.0 hrs — week of Aug 4 — recorded Aug 12 by Marco"
export function entryLine(e: HoursBankEntry): string {
  const when = e.recordedAt
    ? new Date(e.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
  const parts = [`${ENTRY_LABEL[e.type]} ${fmtHours(e.hours)}`];
  if (e.type === 'banked' && e.periodStart) parts.push(periodLabel(e));
  if (e.type === 'paid_out' && e.paidOn) parts.push(paidOnLabel(e));
  if (when) parts.push(`recorded ${when}${e.recordedBy?.name ? ` by ${e.recordedBy.name}` : ''}`);
  return parts.join(' — ');
}

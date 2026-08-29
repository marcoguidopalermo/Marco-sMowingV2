// "A JOBBER VISIT FOR THIS CLIENT ALREADY HAS A LEDGER."
//
// The warning that would have caught the Kyla Francis phantom. On 2026-07-14
// somebody keyed a manual crew-day row reading "Kyla Francis" for 1.5 BH,
// while the Jobber visit for the same weekly cut quietly opened its own
// multi-day ledger titled "Kyla Francis - Weekly [1.5]". Two records of one
// cut: the crew-day carried the credit, the ledger carried none, and it read
// as 1.5 BH owed for two months.
//
// WARN, NEVER ACT — the same shape as the over-hours punch check. This
// deliberately does NOT reconcile the row to the ledger. Manual rows carry
// neither a jobberVisitId nor a job number (all 14 in July and August had
// neither), so the only key available is free text, and fuzzy string matching
// is not something that should decide what gets credited. A person seeing
// "there is already a ledger for this client" can make that call in a second;
// a matcher guessing at it cannot.
//
// A false positive costs a glance. A missed duplicate costs a phantom that
// takes two months and a data audit to find.
import type { MultiDayJob } from '../types';

/**
 * The client segment of a title: everything before the first " - ",
 * lowercased, punctuation and runs of whitespace collapsed. Jobber titles read
 * "Kyla Francis - Weekly [1.5]"; the hand-typed row reads "Kyla Francis".
 */
export function clientKey(title: string | null | undefined): string {
  const raw = String(title || '');
  const head = raw.split(' - ')[0] || raw;
  return head
    .replace(/\[[^\]]*\]/g, ' ')       // drop a [1.5] BH tag
    .replace(/\*+/g, ' ')              // drop **NOTE** markers
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

/** Too short to be a name — "sod", "hourly", a bare number. Never match on it. */
const MIN_KEY_LEN = 5;

export interface LedgerMatch {
  jobberVisitId: string;
  title: string;
  totalBH: number;
  status: MultiDayJob['status'];
}

/**
 * Ledgers whose client segment matches a hand-typed row description.
 * @param {string} desc The manual row's description as typed.
 * @param {MultiDayJob[]} ledgers Ledgers in memory (open ones, plus any
 *   loaded for the date being viewed).
 * @return {LedgerMatch[]} Matches, most recently scoped first. Empty when the
 *   description is too short to be a name.
 */
export function ledgersMatchingManualRow(
  desc: string | null | undefined,
  ledgers: MultiDayJob[] | undefined | null,
): LedgerMatch[] {
  const key = clientKey(desc);
  if (key.length < MIN_KEY_LEN) return [];
  const out: LedgerMatch[] = [];
  for (const l of (ledgers || [])) {
    if (!l || !l.jobberVisitId) continue;
    // A ledger somebody has already answered for is not a warning.
    if (l.resolvedKind || l.voidedRemainder || l.dismissedCarryForward) continue;
    if (clientKey(l.title) !== key) continue;
    out.push({
      jobberVisitId: l.jobberVisitId,
      title: String(l.title || ''),
      totalBH: Number(l.totalBH) || 0,
      status: l.status,
    });
  }
  return out;
}

/** Ready to show verbatim. Null when there is nothing to say. */
export function manualRowLedgerWarning(
  desc: string | null | undefined,
  ledgers: MultiDayJob[] | undefined | null,
): string | null {
  const m = ledgersMatchingManualRow(desc, ledgers);
  if (m.length === 0) return null;
  const first = m[0];
  const more = m.length > 1 ? ` (and ${m.length - 1} more)` : '';
  return `A Jobber visit for this client already has a ledger: "${first.title}"`
    + `${more}. If this row is the same work, it will be credited twice — `
    + 'once here and once from Jobber.';
}

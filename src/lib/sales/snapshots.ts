// FolloSoft SNAPSHOTS — residential snow, season-to-date totals read off
// FolloSoft ("___ contracts, for a total value of $___") once a day, by a
// person or the 7:30 browser agent. Pure, tested (snapshots.test.ts).
//
// One snapshot per day: the document id IS the date (YYYY-MM-DD); a second
// entry the same day replaces the first and the replaced values go into the
// snapshot's history. Snapshots are SEASON TOTALS — never added to the daily
// "add sales" entries: when a season has snapshots, its residential figures
// come only from snapshots (residentialFigures below).
import { inRange, addDays, type Range } from './periods';
import { residentialSnow, type SnowEntry, type StreamFigures } from './metrics';

export interface SnapshotVersion { contracts: number; totalValue: number; enteredBy: string; source: 'agent' | 'manual'; at: number }
export interface SnowSnapshot {
  date: string;                 // YYYY-MM-DD (Toronto) — also the document id
  season: string;               // "2026/2027"
  contracts: number;            // season total
  totalValue: number;           // season total, dollars
  enteredBy: string;
  source: 'agent' | 'manual';
  savedAt: number;
  flags?: string[];             // sanity check against the previous snapshot
  history?: SnapshotVersion[];  // earlier entries for the same day (replaced)
}

/** Unusual-jump thresholds: a day-on-day rise above BOTH the absolute and the relative limit is flagged. */
export const JUMP_CONTRACTS = { abs: 25, pct: 0.15 };
export const JUMP_VALUE = { abs: 20000, pct: 0.15 };
export const STALE_HOURS = 26;

const money = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`;

/** The snapshot before `date` in the same season. */
export function previousSnapshot(all: SnowSnapshot[], date: string, season: string): SnowSnapshot | null {
  return all.filter(s => s.season === season && s.date < date).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

/** Sanity check: totals should only grow, and not implausibly fast. */
export function sanityFlags(next: { contracts: number; totalValue: number }, prev: SnowSnapshot | null): string[] {
  const flags: string[] = [];
  if (!(next.contracts >= 0) || !(next.totalValue >= 0)) flags.push('Negative or missing number.');
  if (next.contracts > 0 && next.totalValue <= 0) flags.push('Contracts but no total value.');
  if (!prev) return flags;
  const dc = next.contracts - prev.contracts, dv = next.totalValue - prev.totalValue;
  if (dc < 0) flags.push(`Contracts went DOWN: ${prev.contracts} → ${next.contracts} (${dc}).`);
  if (dv < 0) flags.push(`Total value went DOWN: ${money(prev.totalValue)} → ${money(next.totalValue)} (−${money(-dv)}).`);
  if (dc > JUMP_CONTRACTS.abs && dc > prev.contracts * JUMP_CONTRACTS.pct) flags.push(`Unusual jump: +${dc} contracts since ${prev.date}.`);
  if (dv > JUMP_VALUE.abs && dv > prev.totalValue * JUMP_VALUE.pct) flags.push(`Unusual jump: +${money(dv)} since ${prev.date}.`);
  return flags;
}

/** What the form sends (the app adds who entered it). */
export interface SnapshotInput { date: string; season: string; contracts: number; totalValue: number; source: 'agent' | 'manual' }

/** The saved snapshot for a day: replaces any earlier one that day, keeping it in history. */
export function buildSnapshot(input: SnapshotInput & { enteredBy: string }, all: SnowSnapshot[], now = Date.now()): SnowSnapshot {
  const existing = all.find(s => s.date === input.date);
  const prev = previousSnapshot(all, input.date, input.season);
  const contracts = Math.round(Number(input.contracts));
  const totalValue = Math.round(Number(input.totalValue) * 100) / 100;
  return {
    date: input.date, season: input.season, contracts, totalValue,
    enteredBy: input.enteredBy, source: input.source, savedAt: now,
    flags: sanityFlags({ contracts, totalValue }, prev),
    history: existing ? [...(existing.history || []), { contracts: existing.contracts, totalValue: existing.totalValue, enteredBy: existing.enteredBy, source: existing.source, at: existing.savedAt }] : [],
  };
}

export const avgTicket = (s: { contracts: number; totalValue: number }) => (s.contracts > 0 ? Math.round((s.totalValue / s.contracts) * 100) / 100 : null);

export function latestSnapshot(all: SnowSnapshot[], season?: string): SnowSnapshot | null {
  return all.filter(s => !season || s.season === season).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

/** "+4 contracts, +$2,870 since yesterday" (or "since Oct 18"). */
export function changeLine(latest: SnowSnapshot, all: SnowSnapshot[]): string | null {
  const prev = previousSnapshot(all, latest.date, latest.season);
  if (!prev) return null;
  const dc = latest.contracts - prev.contracts, dv = latest.totalValue - prev.totalValue;
  const sign = (n: number) => (n >= 0 ? '+' : '−');
  const when = prev.date === addDays(latest.date, -1) ? 'yesterday' : `${new Date(`${prev.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
  return `${sign(dc)}${Math.abs(dc)} contract${Math.abs(dc) === 1 ? '' : 's'}, ${sign(dv)}${money(Math.abs(dv))} since ${when}`;
}

/** Hours since the latest snapshot was saved, and whether that is stale (> 26 h). */
export function staleness(latest: SnowSnapshot | null, now = Date.now()): { hours: number | null; stale: boolean } {
  if (!latest) return { hours: null, stale: false };
  const hours = Math.floor((now - latest.savedAt) / 3_600_000);
  return { hours, stale: hours > STALE_HOURS };
}

/**
 * Residential snow figures — from SNAPSHOTS when the season has any, else
 * from the daily "add sales" entries. Never both added together.
 *   range = null → the season total (latest snapshot);
 *   range → sold within the range = latest snapshot in the range minus the
 *           last snapshot before it (0 before the first).
 */
export function residentialFigures(snaps: SnowSnapshot[], entries: SnowEntry[], r: Range | null, season: string): StreamFigures & { source: 'snapshots' | 'entries' } {
  const ss = snaps.filter(s => s.season === season).sort((a, b) => a.date.localeCompare(b.date));
  if (!ss.length) return { ...residentialSnow(entries, r, season), source: 'entries' };
  const fig = (c: number, v: number): StreamFigures => ({ contracts: c, dollars: Math.round(v * 100) / 100, avgTicket: c > 0 ? Math.round((v / c) * 100) / 100 : null });
  if (!r) { const l = ss[ss.length - 1]; return { ...fig(l.contracts, l.totalValue), source: 'snapshots' }; }
  const inR = ss.filter(s => inRange(s.date, r));
  if (!inR.length) return { ...fig(0, 0), source: 'snapshots' };
  const end = inR[inR.length - 1];
  const before = ss.filter(s => s.date < r.from).pop();
  return { ...fig(end.contracts - (before ? before.contracts : 0), end.totalValue - (before ? before.totalValue : 0)), source: 'snapshots' };
}

/** Day-to-day sales implied by consecutive snapshots — for the week-by-week trend (the first snapshot is the baseline). */
export function snapshotTrendPoints(snaps: SnowSnapshot[], season: string): { date: string; contracts: number; dollars: number }[] {
  const ss = snaps.filter(s => s.season === season).sort((a, b) => a.date.localeCompare(b.date));
  const out: { date: string; contracts: number; dollars: number }[] = [];
  for (let i = 1; i < ss.length; i++) out.push({ date: ss[i].date, contracts: ss[i].contracts - ss[i - 1].contracts, dollars: ss[i].totalValue - ss[i - 1].totalValue });
  return out;
}

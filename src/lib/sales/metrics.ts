// Sales scoreboard figures — pure, tested (metrics.test.ts).
//
// Jobber quotes are selected by the pull with createdAt/updatedAt, and every
// date here is read off the quote itself (sentAt, lastTransitioned) — never
// Jobber's sentAt filter or its sort by sent/approved date, which return
// wrong answers (verified 2026-10-20).
import { inRange, torontoYmd, daysBetween, weeksOf, type Range } from './periods';

// One quote as stored by the pull (salesData/q* rows; compact keys).
export interface QuoteRow {
  id: string; n: string; s: string; t: string;   // id, number, status, title
  c: string; sent: string | null; viewed: string | null;   // ISO instants
  appr: string | null; conv: string | null;
  sub: number; tot: number;                       // pre-tax subtotal, total incl. tax
  cl: string; sp: string | null; url: string;     // client name, salesperson name
}
export interface RequestRow { id: string; c: string; st: string; src: string; q: number } // q = quotes made from it

const WON = new Set(['approved', 'converted']);
const LOST = new Set(['archived']);
const WAITING = new Set(['awaiting_response', 'changes_requested']);
const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => r2(xs.reduce((a, b) => a + b, 0));
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface Money { pre: number; incl: number }
export interface QuoteMetrics {
  sent: { count: number } & Money;
  won: { count: number } & Money;
  lost: { count: number } & Money;
  waiting: { count: number } & Money;
  avgTicket: Money | null;            // won only
  winRate: number | null;             // won ÷ (won + lost), 0–1
  medianDaysToApprove: number | null;
  approvedInPeriod: { count: number } & Money;   // by approval date, any send date
}

/**
 * The period's cohort is the quotes SENT in it (sent date read off each
 * quote); won / lost / waiting are those quotes' current status.
 */
export function quoteMetrics(rows: QuoteRow[], r: Range, salesperson?: string | null): QuoteMetrics {
  const mine = salesperson ? rows.filter(q => (q.sp || '') === salesperson) : rows;
  const cohort = mine.filter(q => inRange(torontoYmd(q.sent), r));
  const money = (xs: QuoteRow[]) => ({ count: xs.length, pre: sum(xs.map(q => q.sub)), incl: sum(xs.map(q => q.tot)) });
  const won = cohort.filter(q => WON.has(q.s));
  const lost = cohort.filter(q => LOST.has(q.s));
  const waiting = cohort.filter(q => WAITING.has(q.s));
  const days = won.filter(q => q.sent && q.appr).map(q => (Date.parse(q.appr!) - Date.parse(q.sent!)) / 86_400_000);
  const approved = mine.filter(q => inRange(torontoYmd(q.appr), r));
  return {
    sent: money(cohort), won: money(won), lost: money(lost), waiting: money(waiting),
    avgTicket: won.length ? { pre: r2(sum(won.map(q => q.sub)) / won.length), incl: r2(sum(won.map(q => q.tot)) / won.length) } : null,
    winRate: won.length + lost.length ? won.length / (won.length + lost.length) : null,
    medianDaysToApprove: median(days) == null ? null : Math.round(median(days)! * 10) / 10,
    approvedInPeriod: money(approved),
  };
}

export interface ChaseQuote extends QuoteRow { daysSinceSent: number | null; opened: boolean }
/** Every quote waiting on the client, any period. */
export function chaseList(rows: QuoteRow[], today: string, sort: 'age' | 'amountDesc' | 'amountAsc' = 'age', salesperson?: string | null): ChaseQuote[] {
  const out = rows
    .filter(q => WAITING.has(q.s) && (!salesperson || (q.sp || '') === salesperson))
    .map(q => { const sent = torontoYmd(q.sent); return { ...q, daysSinceSent: sent ? daysBetween(sent, today) : null, opened: !!q.viewed }; });
  if (sort === 'amountDesc') return out.sort((a, b) => b.sub - a.sub);
  if (sort === 'amountAsc') return out.sort((a, b) => a.sub - b.sub);
  return out.sort((a, b) => (b.daysSinceSent ?? -1) - (a.daysSinceSent ?? -1) || b.sub - a.sub);
}

export const SOURCE_LABEL: Record<string, string> = {
  internal: 'Entered in Jobber', embedded_inline: 'Website form', external_client_hub: 'Client hub', 'Quo ': 'Quo',
};
export const sourceLabel = (s: string) => SOURCE_LABEL[s] || (s ? s.trim() : 'Unknown');

export function leadMetrics(rows: RequestRow[], r: Range): { count: number; quoted: number; bySource: { source: string; count: number; quoted: number }[] } {
  const inP = rows.filter(x => inRange(torontoYmd(x.c), r));
  const by = new Map<string, { count: number; quoted: number }>();
  for (const x of inP) { const k = sourceLabel(x.src); const e = by.get(k) || { count: 0, quoted: 0 }; e.count++; if (x.q > 0) e.quoted++; by.set(k, e); }
  return {
    count: inP.length, quoted: inP.filter(x => x.q > 0).length,
    bySource: [...by.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.count - a.count),
  };
}

export function salespeople(rows: QuoteRow[]): string[] {
  return [...new Set(rows.map(q => q.sp).filter((x): x is string => !!x))].sort();
}

// ── Snow ────────────────────────────────────────────────────────────────────
export interface SnowEntry {
  id: string; date: string; season: string; contracts: number; dollars: number; note?: string;
  source: 'manual' | 'follosoft'; createdAt?: number; createdBy?: string; updatedAt?: number; updatedBy?: string; deletedAt?: number;
}
export interface StreamFigures { contracts: number; dollars: number; avgTicket: number | null }
const fig = (contracts: number, dollars: number): StreamFigures => ({ contracts, dollars: r2(dollars), avgTicket: contracts ? r2(dollars / contracts) : null });

export function residentialSnow(entries: SnowEntry[], r: Range | null, season?: string): StreamFigures {
  const xs = entries.filter(e => !e.deletedAt && (!r || inRange(e.date, r)) && (!season || e.season === season));
  return fig(xs.reduce((s, e) => s + (Number(e.contracts) || 0), 0), xs.reduce((s, e) => s + (Number(e.dollars) || 0), 0));
}

// Commercial: the existing snow contracts, booked or approved, valued at the
// chosen level's seasonal price.
export interface CommercialLike { status: string; season?: string; serviceLevel?: number | null; pricing?: { levels?: Record<string, { seasonal?: number | string }> }; approvedAt?: unknown; bookedAt?: unknown; archived?: boolean; client?: { businessName?: string } }
export const SOLD_STATUSES = new Set(['approved', 'booked']);
export const commercialValue = (c: CommercialLike): number | null => {
  if (!c.serviceLevel) return null;
  const v = Number(c.pricing?.levels?.[String(c.serviceLevel)]?.seasonal);
  return Number.isFinite(v) ? v : null;
};
const tsYmd = (v: unknown): string | null => (typeof v === 'number' || typeof v === 'string') ? torontoYmd(v as any) : (v && typeof (v as any).toMillis === 'function') ? torontoYmd((v as any).toMillis()) : null;
export const commercialSoldDate = (c: CommercialLike) => tsYmd(c.approvedAt) || tsYmd(c.bookedAt);

export function commercialSnow(contracts: CommercialLike[], r: Range | null, season?: string): StreamFigures & { noLevel: number } {
  const sold = contracts.filter(c => SOLD_STATUSES.has(c.status) && !c.archived && (!season || c.season === season) && (!r || inRange(commercialSoldDate(c), r)));
  const priced = sold.filter(c => commercialValue(c) != null);
  return { ...fig(sold.length, priced.reduce((s, c) => s + (commercialValue(c) || 0), 0)), noLevel: sold.length - priced.length };
}

// ── Trend ───────────────────────────────────────────────────────────────────
export interface WeekPoint { from: string; to: string; contracts: number; avgTicket: number | null }
export function weeklyTrend(points: { date: string | null; contracts: number; dollars: number }[], r: Range, minWeeks = 8): WeekPoint[] {
  return weeksOf(r, minWeeks).map(w => {
    const xs = points.filter(p => inRange(p.date, w));
    const n = xs.reduce((s, p) => s + p.contracts, 0), d = xs.reduce((s, p) => s + p.dollars, 0);
    return { from: w.from, to: w.to, contracts: n, avgTicket: n ? r2(d / n) : null };
  });
}
/** Won quotes as trend points (by approval date — when the sale happened). */
export const quoteTrendPoints = (rows: QuoteRow[], salesperson?: string | null) =>
  rows.filter(q => WON.has(q.s) && (!salesperson || (q.sp || '') === salesperson)).map(q => ({ date: torontoYmd(q.appr || q.conv), contracts: 1, dollars: q.sub }));

// ── Targets ─────────────────────────────────────────────────────────────────
export type StreamKey = 'jobber' | 'resSnow' | 'comSnow';
export const STREAM_LABEL: Record<StreamKey, string> = { jobber: 'Landscaping & projects', resSnow: 'Residential snow', comSnow: 'Commercial snow' };
export interface Target { contracts?: number | null; avgTicket?: number | null }
export function progressLine(f: StreamFigures, t: Target | undefined): string {
  const money = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`;
  const parts: string[] = [];
  parts.push(t?.contracts ? `${f.contracts} of ${t.contracts} contracts` : `${f.contracts} contracts`);
  if (f.avgTicket != null) parts.push(`avg ${money(f.avgTicket)}${t?.avgTicket ? ` vs ${money(t.avgTicket)} target` : ''}`);
  else if (t?.avgTicket) parts.push(`avg — vs ${money(t.avgTicket)} target`);
  return parts.join(' · ');
}

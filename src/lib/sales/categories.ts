// Sales by SERVICE CATEGORY and by DIVISION — pure, tested (categories.test.ts).
// The category rules live in ONE place, shared with the Cloud Functions:
// functions/src/shared/serviceCategories.ts (spec: docs/service-category-mapping.md).
// Division attribution is computed by the sales pull (functions/src/shared/divisionCore.ts)
// and stored on each invoice row as m (method 1/2/3) + w (division weights).
import { categorizeLines, CATEGORIES, type Category, type CategoryOverrides, type LineOut } from '../../../functions/src/shared/serviceCategories';
import { inRange, torontoYmd, type Range } from './periods';

export { CATEGORIES, type Category, type CategoryOverrides };

/** Line tuple from the pull: [text, catalog item | 0, amount pre-tax, optional 0/1, selected 1/0/-1]. */
export type LineTuple = [string, string | 0, number, number?, number?];
export interface InvoiceRow {
  id: string; n: string; d: string; st: string; sub: number; tot: number; cl: string; url: string;
  li: LineTuple[]; m: 1 | 2 | 3; w: Record<string, number>;
}

export const COMMERCIAL_SNOW = 'Commercial snow';
export const UNATTRIBUTED = 'Unattributed';
export const DIVISION_ORDER = ['Lawn Division', 'Small Projects', 'Large Projects', COMMERCIAL_SNOW, UNATTRIBUTED];

const r2 = (n: number) => Math.round(n * 100) / 100;
const toLines = (li: LineTuple[], quote = false) => (li || [])
  .filter(l => !quote || !l[3] || l[4] === 1)              // quotes: optional lines count only when selected
  .map(l => ({ name: l[0], linked: l[1] || null, amount: Number(l[2]) || 0 }));

export interface Amount { pre: number; incl: number }
export interface Ranked<K extends string = string> { key: K; pre: number; incl: number; share: number }
export interface DivisionRanked extends Ranked { method1: number; method2: number }
export interface ListedLine { n: string; d: string; cl: string; text: string; amount: number; url: string }

export interface InvoiceBreakdown {
  total: Amount;
  invoices: number;
  byCategory: Ranked<Category>[];
  byDivision: DivisionRanked[];
  months: string[];
  monthly: { month: string; total: number; byCategory: Partial<Record<Category, number>>; byDivision: Record<string, number> }[];
  assets: ListedLine[];               // excluded from sales
  untiedDiscounts: ListedLine[];
  trimming: ListedLine[];             // left in Other, listed for Marco
  unmapped: ListedLine[];             // in Other until someone assigns the name
  unattributed: (ListedLine & { reason: string })[];
}

const rank = <K extends string>(m: Record<string, Amount>, total: number): Ranked<K>[] =>
  Object.entries(m).filter(([, v]) => Math.abs(v.pre) > 0.004)
    .map(([key, v]) => ({ key: key as K, pre: r2(v.pre), incl: r2(v.incl), share: total ? v.pre / total : 0 }))
    .sort((a, b) => b.pre - a.pre);

/** Everything invoiced in the range (issued date, Toronto), split by category and division. */
export function invoiceBreakdown(rows: InvoiceRow[], r: Range, o: CategoryOverrides = {}): InvoiceBreakdown {
  const cat: Record<string, Amount> = {}, div: Record<string, Amount & { m1: number; m2: number }> = {};
  const monthly = new Map<string, { total: number; byCategory: Partial<Record<Category, number>>; byDivision: Record<string, number> }>();
  const assets: ListedLine[] = [], untied: ListedLine[] = [], trimming: ListedLine[] = [], unmapped: ListedLine[] = [], unattributed: InvoiceBreakdown['unattributed'] = [];
  let total = 0, totalIncl = 0, count = 0;
  for (const inv of rows) {
    const day = torontoYmd(inv.d);
    if (!inRange(day, r)) continue;
    count++;
    const lines: LineOut[] = categorizeLines(toLines(inv.li), o);
    const factor = inv.sub > 0 ? inv.tot / inv.sub : 1;            // tax-inclusive, pro rata
    const mo = day!.slice(0, 7);
    const mrow = monthly.get(mo) || { total: 0, byCategory: {}, byDivision: {} };
    const base = { n: inv.n, d: day!, cl: inv.cl, url: inv.url };
    let snow = 0, rest = 0;
    for (const l of lines) {
      if (l.kind === 'asset') { assets.push({ ...base, text: l.name, amount: l.amount }); continue; }
      if (l.tie === 'untied') untied.push({ ...base, text: l.name, amount: l.amount });
      if (l.flag === 'trimming') trimming.push({ ...base, text: l.name, amount: l.amount });
      if (l.flag === 'unmapped') unmapped.push({ ...base, text: l.name, amount: l.amount });
      for (const s of l.split) {
        const c = (cat[s.category] = cat[s.category] || { pre: 0, incl: 0 });
        c.pre += s.amount; c.incl += s.amount * factor;
        mrow.byCategory[s.category] = r2((mrow.byCategory[s.category] || 0) + s.amount);
        mrow.total = r2(mrow.total + s.amount);
        total += s.amount; totalIncl += s.amount * factor;
        if (s.category === 'Snow') snow += s.amount; else rest += s.amount;
      }
    }
    // Divisions: snow → Commercial snow; the rest by the pull's attribution.
    const add = (k: string, amt: number, m?: 1 | 2) => {
      if (!amt) return;
      const d = (div[k] = div[k] || { pre: 0, incl: 0, m1: 0, m2: 0 });
      d.pre += amt; d.incl += amt * factor;
      if (m === 1) d.m1 += amt; if (m === 2) d.m2 += amt;
      mrow.byDivision[k] = r2((mrow.byDivision[k] || 0) + amt);
    };
    add(COMMERCIAL_SNOW, snow);
    if (inv.m === 3 || !Object.keys(inv.w || {}).length) {
      add(UNATTRIBUTED, rest);
      if (Math.abs(rest) > 0.004) unattributed.push({ ...base, text: lines.filter(l => l.kind === 'service').map(l => l.name).join(' + ').slice(0, 140), amount: r2(rest), reason: 'no CrewMaster crew-day and no mapped Jobber assignee' });
    } else {
      for (const [k, w] of Object.entries(inv.w)) add(k, rest * w, inv.m as 1 | 2);
    }
    monthly.set(mo, mrow);
  }
  const months = [...monthly.keys()].sort();
  return {
    total: { pre: r2(total), incl: r2(totalIncl) }, invoices: count,
    byCategory: rank<Category>(cat, total),
    byDivision: rank(div, total).map(d => ({ ...d, method1: r2(div[d.key].m1), method2: r2(div[d.key].m2) })),
    months, monthly: months.map(m => ({ month: m, ...monthly.get(m)! })),
    assets, untiedDiscounts: untied, trimming, unmapped: unmapped.sort((a, b) => b.amount - a.amount),
    unattributed: unattributed.sort((a, b) => b.amount - a.amount),
  };
}

// ── Quotes by category ──────────────────────────────────────────────────────
export interface QuoteLike { s: string; sent: string | null; sub: number; tot: number; li?: LineTuple[] }
const WON = new Set(['approved', 'converted']);
const WAITING = new Set(['awaiting_response', 'changes_requested']);
function quoteCats(qs: QuoteLike[], o: CategoryOverrides): { total: number; ranked: Ranked<Category>[] } {
  const m: Record<string, Amount> = {}; let total = 0;
  for (const q of qs) {
    const factor = q.sub > 0 ? q.tot / q.sub : 1;
    for (const l of categorizeLines(toLines(q.li || [], true), o)) for (const s of l.split) {
      const e = (m[s.category] = m[s.category] || { pre: 0, incl: 0 }); e.pre += s.amount; e.incl += s.amount * factor; total += s.amount;
    }
  }
  return { total: r2(total), ranked: rank<Category>(m, total) };
}
/** Won = quotes SENT in the range now approved/converted. Pipeline = every quote waiting on the client now. */
export function quoteCategoryBreakdown(rows: QuoteLike[], r: Range, o: CategoryOverrides = {}) {
  return {
    won: quoteCats(rows.filter(q => WON.has(q.s) && inRange(torontoYmd(q.sent), r)), o),
    pipeline: quoteCats(rows.filter(q => WAITING.has(q.s)), o),
  };
}

// ── BH per division ─────────────────────────────────────────────────────────
/** Months of the range that have BH, each division's BH in them, and the months that don't. */
export function divisionBH(bhByMonth: Record<string, Record<string, number>> | undefined, months: string[]) {
  const withBH = months.filter(m => bhByMonth && bhByMonth[m] && Object.values(bhByMonth[m]).some(v => v > 0));
  const bh: Record<string, number> = {};
  for (const m of withBH) for (const [d, v] of Object.entries(bhByMonth![m])) bh[d] = Math.round(((bh[d] || 0) + v) * 10) / 10;
  return { withBH, without: months.filter(m => !withBH.includes(m)), bh };
}
/** A division's invoiced $ per BH, over only the months that have BH. */
export function dollarsPerBH(b: InvoiceBreakdown, division: string, bhInfo: ReturnType<typeof divisionBH>): number | null {
  const hours = bhInfo.bh[division];
  if (!hours) return null;
  const dollars = b.monthly.filter(m => bhInfo.withBH.includes(m.month)).reduce((s, m) => s + (m.byDivision[division] || 0), 0);
  return r2(dollars / hours);
}

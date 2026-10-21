// Sales by SERVICE CATEGORY and by DIVISION — pure, tested (categories.test.ts).
// The category rules live in ONE place, shared with the Cloud Functions:
// functions/src/shared/serviceCategories.ts (spec: docs/service-category-mapping.md).
// Division attribution is computed by the sales pull (functions/src/shared/divisionCore.ts)
// and stored on each invoice row as m (method 1/2/3) + w (division weights).
import { categorizeLines, CATEGORIES, type Category, type CategoryOverrides, type LineOut } from '../../../functions/src/shared/serviceCategories';
import { inRange, torontoYmd, type Range } from './periods';
import { serviceCategory, DIVISION_OF, OUTSIDE_DIVISIONS, SERVICE_DIVISIONS, type ServiceCategory, type ServiceDivision } from './serviceMap';

export { CATEGORIES, type Category, type CategoryOverrides };

/** A line as stored by the pull: t text, k catalog item, a amount (pre-tax), o optional 1, s selected 1/0/-1.
 *  (Firestore can't store arrays of arrays.) A compact tuple is also accepted — used by tests. */
export interface LineObj { t: string; k?: string; a: number; o?: number; s?: number }
export type LineTuple = [string, string | 0, number, number?, number?];
export type LineIn = LineObj | LineTuple;
const asTuple = (l: LineIn): LineTuple => (Array.isArray(l) ? l : [l.t, l.k || 0, l.a, l.o, l.s]);
export interface InvoiceRow {
  id: string; n: string; d: string; st: string; sub: number; tot: number; cl: string; url: string;
  li: LineIn[]; m: 1 | 2 | 3; w: Record<string, number>;
}

export const COMMERCIAL_SNOW = 'Commercial snow';
export const UNATTRIBUTED = 'Unattributed';
/** Categories that decide their division outright, whoever did the work. */
export const FIXED_DIVISION: Record<string, string> = { 'Snow': COMMERCIAL_SNOW, 'Dump runs': 'Large Projects' };
export const DIVISION_ORDER = ['Lawn Division', 'Small Projects', 'Large Projects', COMMERCIAL_SNOW, UNATTRIBUTED];

const r2 = (n: number) => Math.round(n * 100) / 100;
const toLines = (li: LineIn[], quote = false) => (li || []).map(asTuple)
  .filter(l => !quote || !l[3] || l[4] === 1)              // quotes: optional lines count only when selected
  .map(l => ({ name: l[0], linked: l[1] || null, amount: Number(l[2]) || 0 }));

export interface Amount { pre: number; incl: number }
export interface Ranked<K extends string = string> { key: K; pre: number; incl: number; share: number }
export interface DivisionRanked extends Ranked { method1: number; method2: number; method4: number }

/**
 * Method 4 — SERVICE CATEGORY fallback for invoices neither crew records nor
 * Jobber assignees can place: a category goes to the division that crew
 * records (method 1) put it in, but only where that's clear — at least
 * MIN_SHARE of the category's crew-record dollars, on at least MIN_BASIS — and
 * never "Other", which is a catch-all rather than a service.
 * Derived from the year's own data, so it follows how the work is really done.
 */
export const FALLBACK_MIN_SHARE = 0.6;
export const FALLBACK_MIN_BASIS = 5000;
export interface CategoryDivision { category: string; division: string; share: number; basis: number; used: boolean }
export function categoryDivisionMap(rows: InvoiceRow[], o: CategoryOverrides = {}): CategoryDivision[] {
  const m: Record<string, Record<string, number>> = {};
  for (const inv of rows) {
    if (inv.m !== 1) continue;
    for (const l of categorizeLines(toLines(inv.li), o, inv.n)) for (const sp of l.split) {
      if (FIXED_DIVISION[sp.category]) continue;
      for (const [d, w] of Object.entries(inv.w || {})) { m[sp.category] = m[sp.category] || {}; m[sp.category][d] = (m[sp.category][d] || 0) + sp.amount * w; }
    }
  }
  return Object.entries(m).map(([category, ds]) => {
    const basis = Object.values(ds).reduce((a, b) => a + b, 0);
    const [division, amt] = Object.entries(ds).sort((a, b) => b[1] - a[1])[0];
    const share = basis > 0 ? amt / basis : 0;
    // "Other" is a catch-all (fees, unassigned names), not a service — it never decides a division.
    return { category, division, share, basis: r2(basis), used: category !== 'Other' && share >= FALLBACK_MIN_SHARE && basis >= FALLBACK_MIN_BASIS };
  }).sort((a, b) => b.basis - a.basis);
}
export interface ListedLine { n: string; d: string; cl: string; text: string; amount: number; url: string }

export interface InvoiceBreakdown {
  categoryDivisions: CategoryDivision[];
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
  const catDiv = categoryDivisionMap(rows, o);
  const fallback = new Map(catDiv.filter(c => c.used).map(c => [c.category, c.division]));
  const cat: Record<string, Amount> = {}, div: Record<string, Amount & { m1: number; m2: number; m4: number }> = {};
  const monthly = new Map<string, { total: number; byCategory: Partial<Record<Category, number>>; byDivision: Record<string, number> }>();
  const assets: ListedLine[] = [], untied: ListedLine[] = [], trimming: ListedLine[] = [], unmapped: ListedLine[] = [], unattributed: InvoiceBreakdown['unattributed'] = [];
  let total = 0, totalIncl = 0, count = 0;
  for (const inv of rows) {
    const day = torontoYmd(inv.d);
    if (!inRange(day, r)) continue;
    count++;
    const lines: LineOut[] = categorizeLines(toLines(inv.li), o, inv.n);
    const factor = inv.sub > 0 ? inv.tot / inv.sub : 1;            // tax-inclusive, pro rata
    const mo = day!.slice(0, 7);
    const mrow = monthly.get(mo) || { total: 0, byCategory: {}, byDivision: {} };
    const base = { n: inv.n, d: day!, cl: inv.cl, url: inv.url };
    const fixed: Record<string, number> = {}; let rest = 0;
    const restByCat: Record<string, number> = {};
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
        const fd = FIXED_DIVISION[s.category];
        if (fd) fixed[fd] = (fixed[fd] || 0) + s.amount; else { rest += s.amount; restByCat[s.category] = (restByCat[s.category] || 0) + s.amount; }
      }
    }
    // Divisions: snow → Commercial snow, dump runs → Large Projects; the rest by the pull's attribution.
    const add = (k: string, amt: number, m?: 1 | 2 | 4) => {
      if (!amt) return;
      const d = (div[k] = div[k] || { pre: 0, incl: 0, m1: 0, m2: 0, m4: 0 });
      d.pre += amt; d.incl += amt * factor;
      if (m === 1) d.m1 += amt; if (m === 2) d.m2 += amt; if (m === 4) d.m4 += amt;
      mrow.byDivision[k] = r2((mrow.byDivision[k] || 0) + amt);
    };
    for (const [d, a] of Object.entries(fixed)) add(d, a);
    if (inv.m === 3 || !Object.keys(inv.w || {}).length) {
      // Method 4: by service category where crew records make the division clear.
      let left = 0;
      for (const [c, a] of Object.entries(restByCat)) { const d = fallback.get(c); if (d) add(d, a, 4); else left += a; }
      add(UNATTRIBUTED, left);
      if (Math.abs(left) > 0.004) unattributed.push({ ...base, text: lines.filter(l => l.kind === 'service').map(l => l.name).join(' + ').slice(0, 140), amount: r2(left), reason: 'no crew-day, no mapped Jobber assignee, and its service category has no clear division' });
    } else {
      for (const [k, w] of Object.entries(inv.w)) add(k, rest * w, inv.m as 1 | 2);
    }
    monthly.set(mo, mrow);
  }
  const months = [...monthly.keys()].sort();
  return {
    total: { pre: r2(total), incl: r2(totalIncl) }, invoices: count,
    byCategory: rank<Category>(cat, total),
    byDivision: rank(div, total).map(d => ({ ...d, method1: r2(div[d.key].m1), method2: r2(div[d.key].m2), method4: r2(div[d.key].m4) })),
    categoryDivisions: catDiv,
    months, monthly: months.map(m => ({ month: m, ...monthly.get(m)! })),
    assets, untiedDiscounts: untied, trimming, unmapped: unmapped.sort((a, b) => b.amount - a.amount),
    unattributed: unattributed.sort((a, b) => b.amount - a.amount),
  };
}

// ── Quotes by category ──────────────────────────────────────────────────────
export interface QuoteLike { s: string; sent: string | null; sub: number; tot: number; li?: LineIn[] }
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
/**
 * Months of the range that have BH, each division's BH in them, and the months
 * that don't. The month in progress is left out: its work is on record but much
 * of it isn't invoiced yet (lawn bills at month end), so $ per BH would read low.
 */
export function divisionBH(bhByMonth: Record<string, Record<string, number>> | undefined, months: string[], currentMonth?: string) {
  const has = (m: string) => !!(bhByMonth && bhByMonth[m] && Object.values(bhByMonth[m]).some(v => v > 0));
  const withBH = months.filter(m => has(m) && m !== currentMonth);
  const bh: Record<string, number> = {};
  for (const m of withBH) for (const [d, v] of Object.entries(bhByMonth![m])) bh[d] = Math.round(((bh[d] || 0) + v) * 10) / 10;
  return { withBH, without: months.filter(m => !has(m)), inProgress: currentMonth && months.includes(currentMonth) && has(currentMonth) ? currentMonth : null, bh };
}
/** A division's invoiced $ per BH, over only the months that have BH. */
export function dollarsPerBH(b: InvoiceBreakdown, division: string, bhInfo: ReturnType<typeof divisionBH>): number | null {
  const hours = bhInfo.bh[division];
  if (!hours) return null;
  const dollars = b.monthly.filter(m => bhInfo.withBH.includes(m.month)).reduce((s, m) => s + (m.byDivision[division] || 0), 0);
  return r2(dollars / hours);
}

// ── The service map (2026-10-21): shown categories and their divisions ───────
/**
 * Revenue by the categories the scoreboard shows, and by division = the sum of
 * its categories (src/lib/sales/serviceMap.ts). Categories and divisions come
 * from the SAME lines in the SAME range, so they share one total. The checks
 * add up the divisions line by line, independently of the category totals,
 * and report any difference (none expected — shown if there is one).
 */
export interface ServiceBreakdown {
  total: Amount; invoices: number;
  byCategory: Ranked<ServiceCategory>[];          // every category incl. Fees & adjustments and Unassigned
  byDivision: Ranked<ServiceDivision>[];
  categoriesOf: Record<string, ServiceCategory[]>; // division → its categories with money in the range
  outside: Ranked<ServiceCategory>[];             // Fees & adjustments, Unassigned
  assets: ListedLine[];                           // equipment sales — excluded
  unassigned: ListedLine[];
  checks: string[];                               // empty when everything adds up
}
export function serviceBreakdown(rows: InvoiceRow[], r: Range, o: CategoryOverrides = {}): ServiceBreakdown {
  const cat: Record<string, Amount> = {}, div: Record<string, Amount> = {};
  const assets: ListedLine[] = [], unassigned: ListedLine[] = [];
  let total = 0, totalIncl = 0, count = 0;
  const put = (c: ServiceCategory, amt: number, factor: number) => {
    const e = (cat[c] = cat[c] || { pre: 0, incl: 0 }); e.pre += amt; e.incl += amt * factor;
    const d = DIVISION_OF[c];
    if (d) { const x = (div[d] = div[d] || { pre: 0, incl: 0 }); x.pre += amt; x.incl += amt * factor; }
    total += amt; totalIncl += amt * factor;
  };
  for (const inv of rows) {
    const day = torontoYmd(inv.d);
    if (!inRange(day, r)) continue;
    count++;
    const factor = inv.sub > 0 ? inv.tot / inv.sub : 1;
    const base = { n: inv.n, d: day!, cl: inv.cl, url: inv.url };
    const lines = categorizeLines(toLines(inv.li), o, inv.n);
    // Services first: each split → its shown category.
    const svc: { base: string; sc: ServiceCategory; amount: number }[] = [];
    for (const l of lines) {
      if (l.kind === 'asset') { assets.push({ ...base, text: l.name, amount: l.amount }); continue; }
      if (l.kind !== 'service') continue;
      for (const s of l.split) {
        const sc = serviceCategory(s.category, l.name, l.linked);
        svc.push({ base: s.category, sc, amount: s.amount });
        if (sc === 'Unassigned') unassigned.push({ ...base, text: l.name, amount: s.amount });
        put(sc, s.amount, factor);
      }
    }
    // Discounts: to the largest shown category among the services they were tied to.
    const largest = (xs: typeof svc): ServiceCategory | null => {
      const m: Record<string, number> = {};
      for (const x of xs) if (!OUTSIDE_DIVISIONS.includes(x.sc)) m[x.sc] = (m[x.sc] || 0) + x.amount;
      const best = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
      return best ? (best[0] as ServiceCategory) : null;
    };
    for (const l of lines) {
      if (l.kind !== 'discount') continue;
      for (const s of l.split) {
        const own = serviceCategory(s.category, l.name, l.linked);
        const sc = largest(svc.filter(x => x.base === s.category)) || (own !== 'Unassigned' ? own : null) || largest(svc) || 'Fees & adjustments';
        put(sc, s.amount, factor);
      }
    }
  }
  const byCategory = rank<ServiceCategory>(cat, total);
  const byDivision = SERVICE_DIVISIONS.filter(d => div[d] && Math.abs(div[d].pre) > 0.004)
    .map(d => ({ key: d, pre: r2(div[d].pre), incl: r2(div[d].incl), share: total ? div[d].pre / total : 0 })).sort((a, b) => b.pre - a.pre);
  const categoriesOf: Record<string, ServiceCategory[]> = {};
  for (const c of byCategory) { const d = DIVISION_OF[c.key]; if (d) (categoriesOf[d] = categoriesOf[d] || []).push(c.key); }
  // Built-in checks.
  const checks: string[] = [];
  const money = (n: number) => `$${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  for (const d of SERVICE_DIVISIONS) {
    const fromCats = r2(byCategory.filter(c => DIVISION_OF[c.key] === d).reduce((s, c) => s + c.pre, 0));
    const shown = r2(div[d]?.pre || 0);
    if (Math.abs(fromCats - shown) > 0.01) checks.push(`${d} is ${money(shown)} but its categories add up to ${money(fromCats)}.`);
  }
  const catSum = r2(byCategory.reduce((s, c) => s + c.pre, 0));
  const divPlusOutside = r2(byDivision.reduce((s, d) => s + d.pre, 0) + byCategory.filter(c => !DIVISION_OF[c.key]).reduce((s, c) => s + c.pre, 0));
  if (Math.abs(catSum - r2(total)) > 0.01) checks.push(`Categories add up to ${money(catSum)}, not the total ${money(r2(total))}.`);
  if (Math.abs(divPlusOutside - r2(total)) > 0.01) checks.push(`Divisions plus fees and unassigned add up to ${money(divPlusOutside)}, not the total ${money(r2(total))}.`);
  return {
    total: { pre: r2(total), incl: r2(totalIncl) }, invoices: count, byCategory, byDivision, categoriesOf,
    outside: byCategory.filter(c => !DIVISION_OF[c.key]), assets, unassigned: unassigned.sort((a, b) => b.amount - a.amount), checks,
  };
}

/* eslint-disable max-len, require-jsdoc, valid-jsdoc, no-multi-spaces */
// Sales scoreboard pull: Jobber quotes and requests. READ-ONLY — no mutations.
//
// Weekdays 07:03 / 12:03 / 16:03 Toronto (after the :00 sync; ~5 minutes, done
// before the :07 office pull and the :15 sync) plus a "Refresh now" for the
// sales viewers. Never inside the performance sync; paced to keep Jobber's bucket
// near PACE_TARGET and stops (keeping the last good data) under BUDGET_FLOOR.
//
// Jobber quirks (memory: jobber-sales-api-quirks): quotes are selected by
// updatedAt (which covers every quote created this year) and their sent /
// approved dates are read off each quote — never Jobber's sentAt filter or
// its sort by sent/approved date.
//
// Output (server-written, sales viewers read): salesData/meta plus row chunks
// salesData/q* (quotes, with lines), salesData/r* (requests) and salesData/i*
// (invoices with lines and their division attribution), ≤ 250 rows each; and
// serviceCategoryMap/names (distinct service names for the mapping editor).
import {onSchedule} from "firebase-functions/v2/scheduler";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET} from "./oauth.js";
import {getJobberAccessToken} from "./token.js";
import {makeJobberClient, JobberClient} from "./client.js";
import {assigneeDivisionIndex, attributeInvoice, bhByMonth, jobDivisionIndex, Attribution} from "../shared/divisionCore.js";
import {categoryForName, normName} from "../shared/serviceCategories.js";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Same list as isSalesViewer() in firestore.rules and SALES_VIEWERS in src/lib/sales/access.ts.
export const SALES_VIEWERS = ["sales@marcosmowing.com", "marcoguidopalermo@gmail.com"];
const META = "salesData/meta";
const LOCK = "salesData/lock";
const BUDGET_FLOOR = 5000;
const PACE_TARGET = 9000;
const PAGE_DELAY_MS = 400;
const LOCK_MS = 9 * 60_000;
const CHUNK = 250;
const APP = "artifacts/crewmaster/public/data";

/** CrewMaster's crew-days (performance) and rosters (schedules) for the year, plus the capacity assignee map. */
async function loadCrewData(year: string) {
  const main = (await db.doc(`${APP}/appData/main`).get()).data() || {};
  const perf: Record<string, any> = {};
  const sch: Record<string, any> = {};
  for (const [d, v] of Object.entries(main.performance || {})) if (d.startsWith(year)) perf[d] = v;
  for (const [d, v] of Object.entries(main.schedules || {})) if (d.startsWith(year)) sch[d] = v;
  const pm = await db.collection(`${APP}/performanceMonths`).get();
  for (const doc of pm.docs) if (doc.id.startsWith(year)) for (const [d, v] of Object.entries((doc.data().days || {}) as Record<string, unknown>)) if (!perf[d]) perf[d] = v;
  const sm = await db.collection(`${APP}/scheduleMonths`).get();
  for (const doc of sm.docs) if (doc.id.startsWith(year)) for (const [d, v] of Object.entries((doc.data().days || {}) as Record<string, unknown>)) if (!sch[d]) sch[d] = v;
  return {perf, sch, assigneeMap: (main.settings?.capacity?.assigneeMap || {}) as Record<string, {division?: string}>};
}

/** Distinct service names on this year's lines, for the mapping editor and the unmapped list (defaults only — overrides apply in the app). */
function serviceNames(rows: {n: string; li: any[]}[]) {
  const free = new Map<string, {label: string; count: number; amount: number; sample: string; unmapped: boolean; trimming: boolean}>();
  const cat = new Map<string, {count: number; amount: number}>();
  for (const r of rows) {
    for (const [text, linked, amount] of r.li) {
      if (amount < 0) continue;
      if (linked) {
        const e = cat.get(linked) || {count: 0, amount: 0}; e.count++; e.amount += amount; cat.set(linked, e); continue;
      }
      const k = normName(text); if (!k) continue;
      const c = categoryForName(text, null, {});
      const e = free.get(k) || {label: String(text).trim(), count: 0, amount: 0, sample: r.n, unmapped: c.flag === "unmapped", trimming: c.flag === "trimming"};
      e.count++; e.amount = Math.round((e.amount + amount) * 100) / 100; free.set(k, e);
    }
  }
  return {
    freehand: [...free.entries()].map(([key, v]) => ({key, ...v})).sort((a, b) => b.amount - a.amount).slice(0, 800),
    catalog: [...cat.entries()].map(([name, v]) => ({name, count: v.count, amount: Math.round(v.amount * 100) / 100})).sort((a, b) => b.amount - a.amount),
  };
}

class BudgetLow extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
interface Cost { queries: number; requestedMax: number; actualTotal: number; minAvailable: number }

const Q_QUOTES = `query SalesQuotes($after: String, $since: ISO8601DateTime!) {
  quotes(first: 25, after: $after, filter: {updatedAt: {after: $since}}) {
    nodes { id quoteNumber quoteStatus title createdAt sentAt clientHubViewedAt
      lastTransitioned { approvedAt convertedAt } amounts { subtotal total }
      client { name } salesperson { name { full } } jobberWebUri
      lineItems(first: 30) { totalCount nodes { name totalPrice optional selected linkedProductOrService { name } } } }
    pageInfo { hasNextPage endCursor } } }`;
// Invoices issued this year, with lines (categories) and jobs + visit
// assignees (divisions). The status filters are NOT used (they overlap).
const Q_INVOICES = `query SalesInvoices($after: String, $since: ISO8601DateTime!) {
  invoices(first: 20, after: $after, filter: {issuedDate: {after: $since}}) {
    nodes { id invoiceNumber invoiceStatus issuedDate jobberWebUri amounts { subtotal total } client { name }
      lineItems(first: 30) { totalCount nodes { name totalPrice linkedProductOrService { name } } }
      jobs(first: 3) { nodes { id } }
      visits(first: 10) { nodes { assignedUsers(first: 5) { nodes { id } } } } }
    pageInfo { hasNextPage endCursor } } }`;
const Q_INVOICE_LINES = "query SalesInvoiceLines($id: EncodedId!) { invoice(id: $id) { lineItems(first: 100) { totalCount nodes { name totalPrice linkedProductOrService { name } } } } }";
const Q_QUOTE_LINES = "query SalesQuoteLines($id: EncodedId!) { quote(id: $id) { lineItems(first: 100) { totalCount nodes { name totalPrice optional selected linkedProductOrService { name } } } } }";
const Q_REQUESTS = `query SalesRequests($after: String, $since: ISO8601DateTime!) {
  requests(first: 50, after: $after, filter: {createdAt: {after: $since}}) {
    nodes { id createdAt requestStatus source quotes(first: 1) { totalCount } }
    pageInfo { hasNextPage endCursor } } }`;

async function call(client: JobberClient, cost: Cost, query: string, vars: Record<string, unknown>): Promise<any> {
  const data = await client.fetch(query, vars);
  const c = client.getLastCost(); const t = client.getLastThrottleStatus();
  cost.queries++;
  cost.requestedMax = Math.max(cost.requestedMax, c?.requested || 0);
  cost.actualTotal += c?.actual || 0;
  const avail = t?.currentlyAvailable ?? Number.POSITIVE_INFINITY;
  cost.minAvailable = Math.min(cost.minAvailable, avail);
  if (avail < BUDGET_FLOOR) throw new BudgetLow(`Jobber budget ${Math.round(avail)} < ${BUDGET_FLOOR}`);
  const restore = t?.restoreRate && t.restoreRate > 0 ? t.restoreRate : 500;
  const refillMs = Number.isFinite(avail) ? Math.max(0, (PACE_TARGET - avail) / restore) * 1000 : 0;
  await sleep(Math.min(15_000, Math.max(PAGE_DELAY_MS, refillMs)));
  return data;
}
async function pages<T>(client: JobberClient, cost: Cost, query: string, field: string, vars: Record<string, unknown>, max = 80): Promise<T[]> {
  const out: T[] = []; let after: string | null = null; let n = 0;
  do {
    const data: any = await call(client, cost, query, {...vars, after});
    const conn: {nodes: T[]; pageInfo: {hasNextPage: boolean; endCursor: string}} = data[field];
    out.push(...conn.nodes);
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after && ++n < max);
  return out;
}

async function takeLock(holder: string): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = db.doc(LOCK); const cur = await tx.get(ref);
    if (cur.exists && (Number(cur.get("until")) || 0) > Date.now()) return false;
    tx.set(ref, {holder, until: Date.now() + LOCK_MS});
    return true;
  });
}
async function dropLock(holder: string) {
  await db.runTransaction(async (tx) => {
    const ref = db.doc(LOCK); const cur = await tx.get(ref);
    if (cur.exists && cur.get("holder") === holder) tx.delete(ref);
  });
}

/** Jan 1 of this year, Toronto midnight, as an instant. */
export function yearStartIso(nowMs: number): string {
  const y = Number(new Intl.DateTimeFormat("en-CA", {timeZone: "America/Toronto", year: "numeric"}).format(new Date(nowMs)));
  return `${y}-01-01T05:00:00Z`;
}

// Line tuple: [text, catalog item | 0, amount (pre-tax), optional 0/1, selected 1/0/-1 (unknown)]
const compactLines = (li: any) => ((li && li.nodes) || []).map((l: any) => [
  String(l.name || "").slice(0, 120), l.linkedProductOrService?.name || 0, Number(l.totalPrice) || 0,
  l.optional ? 1 : 0, l.selected === true ? 1 : l.selected === false ? 0 : -1,
]);
export function compactInvoice(i: any, att: Attribution) {
  return {
    id: i.id, n: String(i.invoiceNumber ?? ""), d: i.issuedDate, st: i.invoiceStatus,
    sub: Number(i.amounts?.subtotal) || 0, tot: Number(i.amounts?.total) || 0,
    cl: String(i.client?.name || "—").slice(0, 60), url: i.jobberWebUri || "",
    li: compactLines(i.lineItems), m: att.m, w: att.w,
  };
}
export function compactQuote(q: any) {
  return {
    li: compactLines(q.lineItems),
    id: q.id, n: String(q.quoteNumber ?? ""), s: q.quoteStatus, t: String(q.title || "").slice(0, 80),
    c: q.createdAt, sent: q.sentAt || null, viewed: q.clientHubViewedAt || null,
    appr: q.lastTransitioned?.approvedAt || null, conv: q.lastTransitioned?.convertedAt || null,
    sub: Number(q.amounts?.subtotal) || 0, tot: Number(q.amounts?.total) || 0,
    cl: String(q.client?.name || "—").slice(0, 60), sp: q.salesperson?.name?.full || null, url: q.jobberWebUri || "",
  };
}
export function compactRequest(r: any) {
  return {id: r.id, c: r.createdAt, st: r.requestStatus, src: r.source || "", q: Number(r.quotes?.totalCount) || 0};
}

export async function runSalesPull(kind: "scheduled" | "manual", by: string | null = null): Promise<{status: string; message?: string}> {
  const holder = `${kind}-${Date.now()}`;
  const startedAt = Date.now();
  if (!(await takeLock(holder))) return {status: "busy", message: "A pull is already running."};
  const cost: Cost = {queries: 0, requestedMax: 0, actualTotal: 0, minAvailable: Number.POSITIVE_INFINITY};
  const attempt = {lastAttemptAt: startedAt, lastAttemptKind: kind, lastAttemptBy: by};
  try {
    const since = yearStartIso(startedAt);
    const client = makeJobberClient(await getJobberAccessToken({service: "salesPull"}));
    await call(client, cost, "query SalesPreflight { account { id } }", {});
    const rawQuotes = await pages<any>(client, cost, Q_QUOTES, "quotes", {since});
    for (const q of rawQuotes.filter((x) => (x.lineItems?.totalCount || 0) > 30)) q.lineItems = (await call(client, cost, Q_QUOTE_LINES, {id: q.id})).quote.lineItems;
    const quotes = rawQuotes.map(compactQuote);
    const requests = (await pages<any>(client, cost, Q_REQUESTS, "requests", {since})).map(compactRequest);
    const rawInvoices = (await pages<any>(client, cost, Q_INVOICES, "invoices", {since}, 150)).filter((i) => i.invoiceStatus !== "draft");
    for (const i of rawInvoices.filter((x) => (x.lineItems?.totalCount || 0) > 30)) i.lineItems = (await call(client, cost, Q_INVOICE_LINES, {id: i.id})).invoice.lineItems;
    // Divisions, from CrewMaster's own records (read-only).
    const year = since.slice(0, 4);
    const crew = await loadCrewData(year);
    const jobIdx = jobDivisionIndex(crew.perf);
    const aIdx = assigneeDivisionIndex(crew.sch, crew.assigneeMap);
    const invoices = rawInvoices.map((i) => compactInvoice(i, attributeInvoice(
      (i.jobs?.nodes || []).map((j: any) => j.id),
      (i.visits?.nodes || []).map((v: any) => (v.assignedUsers?.nodes || []).map((u: any) => u.id)),
      jobIdx, aIdx)));
    const bh = bhByMonth(crew.perf);
    const names = serviceNames([...invoices, ...quotes]);
    const prev = (await db.doc(META).get()).data() || {};
    const batch = db.batch();
    const qChunks = Math.ceil(quotes.length / CHUNK); const rChunks = Math.ceil(requests.length / CHUNK); const iChunks = Math.ceil(invoices.length / CHUNK);
    for (let i = 0; i < iChunks; i++) batch.set(db.doc(`salesData/i${i}`), {rows: invoices.slice(i * CHUNK, (i + 1) * CHUNK)});
    for (let i = iChunks; i < (Number(prev.invoiceChunks) || 0); i++) batch.delete(db.doc(`salesData/i${i}`));
    batch.set(db.doc("serviceCategoryMap/names"), {...names, updatedAt: Date.now()});
    for (let i = 0; i < qChunks; i++) batch.set(db.doc(`salesData/q${i}`), {rows: quotes.slice(i * CHUNK, (i + 1) * CHUNK)});
    for (let i = 0; i < rChunks; i++) batch.set(db.doc(`salesData/r${i}`), {rows: requests.slice(i * CHUNK, (i + 1) * CHUNK)});
    for (let i = qChunks; i < (Number(prev.quoteChunks) || 0); i++) batch.delete(db.doc(`salesData/q${i}`));
    for (let i = rChunks; i < (Number(prev.requestChunks) || 0); i++) batch.delete(db.doc(`salesData/r${i}`));
    const costOut = {...cost, minAvailable: Number.isFinite(cost.minAvailable) ? cost.minAvailable : null, ms: Date.now() - startedAt};
    batch.set(db.doc(META), {
      ...attempt, status: "ok", lastError: null, lastSuccessAt: Date.now(), since,
      quoteChunks: qChunks, requestChunks: rChunks, invoiceChunks: iChunks,
      quoteCount: quotes.length, requestCount: requests.length, invoiceCount: invoices.length,
      bhByMonth: bh, bhMonths: Object.keys(bh).sort(), cost: costOut,
    });
    await batch.commit();
    logger.info("Sales pulled", {kind, quotes: quotes.length, requests: requests.length, invoices: invoices.length, cost: costOut});
    return {status: "ok"};
  } catch (e) {
    const skipped = e instanceof BudgetLow;
    const msg = e instanceof Error ? e.message : String(e);
    await db.doc(META).set({...attempt, status: skipped ? "skipped" : "error", lastError: msg.slice(0, 300)}, {merge: true});
    if (skipped) logger.warn("Sales pull skipped — Jobber budget low", {kind, msg});
    else logger.error("Sales pull failed", {kind, msg});
    return {status: skipped ? "skipped" : "error", message: msg.slice(0, 300)};
  } finally {
    await dropLock(holder).catch(() => undefined);
  }
}

export const salesPull = onSchedule({region: "us-central1", timeZone: "America/Toronto", schedule: "3 7,12,16 * * 1-5", secrets: [JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET], timeoutSeconds: 540, retryCount: 0}, async () => {
  await runSalesPull("scheduled");
});

/** "Refresh now" — sales viewers only; not in a sync slot or just before one; at most every 2 minutes. */
export const salesRefresh = onCall({region: "us-central1", secrets: [JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET], timeoutSeconds: 540}, async (request) => {
  const email = (request.auth?.token?.email || "").trim().toLowerCase();
  if (!email || request.auth?.token?.email_verified !== true || !SALES_VIEWERS.includes(email)) {
    throw new HttpsError("permission-denied", "Sales only.");
  }
  const m = new Date().getUTCMinutes() % 15;
  // The pull takes ~5 minutes, so it must start early enough to finish before the next sync.
  if (m < 2 || m > 9) throw new HttpsError("failed-precondition", "The performance sync is about to run or running — try again in a few minutes.");
  const last = Number((await db.doc(META).get()).get("lastAttemptAt")) || 0;
  if (Date.now() - last < 2 * 60_000) throw new HttpsError("resource-exhausted", "Just refreshed — try again in a couple of minutes.");
  return runSalesPull("manual", email);
});

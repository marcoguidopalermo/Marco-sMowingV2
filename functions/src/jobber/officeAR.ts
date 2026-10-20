/* eslint-disable max-len, require-jsdoc, valid-jsdoc, no-multi-spaces */
// OfficeMaster A/R pull. READ-ONLY against Jobber — no mutations.
//
// Runs on its own schedule (weekdays 07:07 / 12:07 / 16:07 Toronto, a full
// re-read at 03:07 nightly) plus an office-only "Refresh now". Never inside
// the performance sync, and it yields to it: the pull starts 7 minutes after
// a sync slot, checks Jobber's budget first and after every page, and stops
// (keeping the last good data) if fewer than BUDGET_FLOOR points remain.
//
// Result: officeAR/latest — readable by office viewers only (firestore.rules),
// written only here. A failed or skipped pull records why and KEEPS the last
// good data, so the page can say "data unavailable" instead of showing 0.
import {onSchedule} from "firebase-functions/v2/scheduler";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET} from "./oauth.js";
import {getJobberAccessToken} from "./token.js";
import {makeJobberClient, JobberClient} from "./client.js";
import {summarizeAR, RawClient, RawInvoice} from "./officeARCore.js";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const OFFICE_AR_DOC = "officeAR/latest";
const LOCK_DOC = "officeAR/lock";
const BUDGET_FLOOR = 5000;
// Pace to keep Jobber's bucket near full: after each page, wait until it has
// refilled to PACE_TARGET (it restores ~500 points/s), so a long read never
// drains the budget the performance sync relies on.
const PACE_TARGET = 9000;
const PAGE_DELAY_MS = 400;
const LOCK_MS = 9 * 60_000;
// Same list as isOfficeViewer() in firestore.rules / storage.rules and
// OFFICE_VIEWERS in src/lib/office/access.ts.
export const OFFICE_VIEWERS = ["office@marcosmowing.com", "marcoguidopalermo@gmail.com"];

type Kind = "scheduled" | "nightly" | "manual";
class BudgetLow extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const OPEN_STATUSES = ["awaiting_payment", "past_due", "sent_not_due", "bad_debt"];
const Q_OPEN = `query OfficeOpen($after: String, $status: InvoiceStatusTypeEnum!) {
  invoices(first: 50, after: $after, filter: {status: $status}) {
    nodes { id invoiceNumber invoiceStatus issuedDate dueDate jobberWebUri
      amounts { total invoiceBalance } client { id name }
      paymentRecords(first: 10) { nodes { entryDate amount adjustmentType } } }
    pageInfo { hasNextPage endCursor } } }`;
// Nightly: every invoice, minimal fields.
const Q_ALL = `query OfficeAll($after: String) {
  invoices(first: 100, after: $after) {
    nodes { id invoiceNumber invoiceStatus issuedDate receivedDate jobberWebUri amounts { total invoiceBalance } client { id name } }
    pageInfo { hasNextPage endCursor } } }`;
const Q_CLIENTS = `query OfficeClients($after: String) {
  clients(first: 100, after: $after) {
    nodes { id name balance jobberWebUri }
    pageInfo { hasNextPage endCursor } } }`;

interface Cost { queries: number; requestedMax: number; actualTotal: number; minAvailable: number }

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
async function pages<T>(client: JobberClient, cost: Cost, query: string, field: string, vars: Record<string, unknown> = {}, max = 120): Promise<T[]> {
  const out: T[] = []; let after: string | null = null; let n = 0;
  do {
    const data = await call(client, cost, query, {...vars, after});
    const conn = data[field];
    out.push(...conn.nodes);
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after && ++n < max);
  return out;
}

async function takeLock(holder: string): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = db.doc(LOCK_DOC); const cur = await tx.get(ref);
    if (cur.exists && (Number(cur.get("until")) || 0) > Date.now()) return false;
    tx.set(ref, {holder, until: Date.now() + LOCK_MS});
    return true;
  });
}
async function dropLock(holder: string) {
  await db.runTransaction(async (tx) => {
    const ref = db.doc(LOCK_DOC); const cur = await tx.get(ref);
    if (cur.exists && cur.get("holder") === holder) tx.delete(ref);
  });
}

/** One pull. Never throws; records the outcome on officeAR/latest. */
export async function runOfficeARPull(kind: Kind, by: string | null = null): Promise<{status: string; message?: string}> {
  const holder = `${kind}-${Date.now()}`;
  const startedAt = Date.now();
  if (!(await takeLock(holder))) return {status: "busy", message: "A pull is already running."};
  const cost: Cost = {queries: 0, requestedMax: 0, actualTotal: 0, minAvailable: Number.POSITIVE_INFINITY};
  const attempt = {lastAttemptAt: startedAt, lastAttemptKind: kind, lastAttemptBy: by};
  try {
    const client = makeJobberClient(await getJobberAccessToken({service: "officeAR"}));
    await call(client, cost, "query OfficePreflight { account { id } }", {});
    const open: RawInvoice[] = [];
    for (const status of OPEN_STATUSES) open.push(...await pages<RawInvoice>(client, cost, Q_OPEN, "invoices", {status}));
    // Paid-but-unrecorded needs every invoice: read in full overnight only;
    // daytime pulls carry the overnight result forward.
    let paidWithBalance: RawInvoice[] = [];
    let paidCheckAt: number | null = null;
    if (kind === "nightly") {
      const all = await pages<RawInvoice>(client, cost, Q_ALL, "invoices");
      paidWithBalance = all.filter((r) => r.invoiceStatus === "paid" && r.amounts.invoiceBalance > 0.004);
      paidCheckAt = Date.now();
    }
    const clients = (await pages<RawClient>(client, cost, Q_CLIENTS, "clients")).filter((x) => Math.abs(x.balance) > 0.004);
    const summary = summarizeAR({open, paidWithBalance, clients, nowMs: Date.now()});
    if (kind !== "nightly") {
      const prev = (await db.doc(OFFICE_AR_DOC).get()).data() as {data?: typeof summary; paidCheckAt?: number} | undefined;
      if (prev?.data?.paidUnrecorded) {
        summary.mismatches = [...(prev.data.mismatches || []).filter((m) => m.kind === "paid_with_balance"), ...summary.mismatches];
        summary.paidUnrecorded = prev.data.paidUnrecorded;
        paidCheckAt = prev.paidCheckAt ?? null;
      }
    }
    const paidCheck = paidCheckAt ? "full" : "none";
    const costOut = {...cost, minAvailable: Number.isFinite(cost.minAvailable) ? cost.minAvailable : null, ms: Date.now() - startedAt};
    await db.doc(OFFICE_AR_DOC).set({
      ...attempt, status: "ok", lastError: null,
      lastSuccessAt: Date.now(), lastSuccessKind: kind, paidCheck, paidCheckAt,
      data: summary, cost: costOut,
    }, {merge: false});
    logger.info("Office A/R pulled", {kind, owed: summary.owed, invoices: summary.invoiceCount, cost: costOut});
    return {status: "ok"};
  } catch (e) {
    const skipped = e instanceof BudgetLow;
    const msg = e instanceof Error ? e.message : String(e);
    // Keep the last good data; record what went wrong.
    await db.doc(OFFICE_AR_DOC).set({...attempt, status: skipped ? "skipped" : "error", lastError: msg.slice(0, 300)}, {merge: true});
    if (skipped) logger.warn("Office A/R pull skipped — Jobber budget low", {kind, msg});
    else logger.error("Office A/R pull failed", {kind, msg});
    return {status: skipped ? "skipped" : "error", message: msg.slice(0, 300)};
  } finally {
    await dropLock(holder).catch(() => undefined);
  }
}

const OPTS = {region: "us-central1", timeZone: "America/Toronto", secrets: [JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET], timeoutSeconds: 540, retryCount: 0};

export const officeARPull = onSchedule({...OPTS, schedule: "7 7,12,16 * * 1-5"}, async () => {
  await runOfficeARPull("scheduled");
});
export const officeARNightly = onSchedule({...OPTS, schedule: "7 3 * * *"}, async () => {
  await runOfficeARPull("nightly");
});

/** "Refresh now" — office viewers only; not during a sync slot; at most every 2 minutes. */
export const officeARRefresh = onCall({region: "us-central1", secrets: [JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET], timeoutSeconds: 540}, async (request) => {
  const email = (request.auth?.token?.email || "").trim().toLowerCase();
  if (!email || request.auth?.token?.email_verified !== true || !OFFICE_VIEWERS.includes(email)) {
    throw new HttpsError("permission-denied", "Office only.");
  }
  const m = new Date().getUTCMinutes() % 15;
  if (m < 2) throw new HttpsError("failed-precondition", "The performance sync is running — try again in a minute or two.");
  const cur = await db.doc(OFFICE_AR_DOC).get();
  const last = Number(cur.get("lastAttemptAt")) || 0;
  if (Date.now() - last < 2 * 60_000) throw new HttpsError("resource-exhausted", "Just refreshed — try again in a couple of minutes.");
  return runOfficeARPull("manual", email);
});

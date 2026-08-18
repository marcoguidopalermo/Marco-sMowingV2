/* eslint-disable require-jsdoc, valid-jsdoc, max-len */
// Server-side RoleMaster duty→task generator. Runs in the scheduled sync as a
// SIBLING to runArchivePass, isolated so a failure never fails the sync.
// Gated by the master toggle (settings.roleMasterGenerationEnabled, DEFAULT
// OFF) plus per-role/per-duty `active`. The recurrence math MIRRORS
// src/lib/roleMaster.ts exactly (the functions codebase can't import src/).
import type {firestore} from "firebase-admin";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

const MS_DAY = 86_400_000;
const HORIZON_DAYS = 31;
const MISSED_AFTER_DAYS = 14;

type Recurrence = {
  kind: "weekdays" | "weekly" | "biweekly" | "monthly" | "yearly";
  dayOfWeek?: number;
  anchorDate?: string;
  dayOfMonth?: number | "last";
  month?: number;
  day?: number;
};
type Duty = {
  id: string; name: string; category?: string; roleId: string;
  recurrence: Recurrence; dueSoonDays?: number; active?: boolean;
  activeFrom?: string; activeUntil?: string;
  seasonWindow?: { fromMonthDay: string; toMonthDay: string };
};

const dateToMs = (d: string): number => Date.parse(`${d}T12:00:00Z`);
const msToDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDaysStr = (d: string, n: number): string => msToDate(dateToMs(d) + n * MS_DAY);
const dowOf = (d: string): number => new Date(`${d}T12:00:00Z`).getUTCDay();
const daysAgo = (d: string, today: string): number => Math.floor((dateToMs(today) - dateToMs(d)) / MS_DAY);
const lastDayOfMonth = (y: number, m0: number): number => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

function computeOccurrences(rec: Recurrence, fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  const fromMs = dateToMs(fromDate);
  const toMs = dateToMs(toDate);
  if (!(fromMs <= toMs)) return out;
  if (rec.kind === "weekdays") {
    // Mon-Fri. Mirrors the 'weekdays' branch in src/lib/roleMaster.ts.
    for (let ms = fromMs; ms <= toMs; ms += MS_DAY) {
      const d = msToDate(ms);
      const dow = dowOf(d);
      if (dow >= 1 && dow <= 5) out.push(d);
    }
  } else if (rec.kind === "weekly") {
    const target = rec.dayOfWeek ?? 1;
    for (let ms = fromMs; ms <= toMs; ms += MS_DAY) {
      const d = msToDate(ms);
      if (dowOf(d) === target) out.push(d);
    }
  } else if (rec.kind === "biweekly") {
    const anchorMs = dateToMs(rec.anchorDate || fromDate);
    const period = 14 * MS_DAY;
    const k = Math.ceil((fromMs - anchorMs) / period);
    let ms = anchorMs + k * period;
    while (ms < fromMs) ms += period;
    for (; ms <= toMs; ms += period) out.push(msToDate(ms));
  } else if (rec.kind === "monthly") {
    let cur = new Date(`${fromDate.slice(0, 7)}-01T12:00:00Z`);
    const end = new Date(`${toDate.slice(0, 7)}-01T12:00:00Z`);
    while (cur.getTime() <= end.getTime()) {
      const y = cur.getUTCFullYear();
      const m = cur.getUTCMonth();
      const last = lastDayOfMonth(y, m);
      const day = rec.dayOfMonth === "last" ? last : Math.min(Number(rec.dayOfMonth ?? 1) || 1, last);
      const d = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dMs = dateToMs(d);
      if (dMs >= fromMs && dMs <= toMs) out.push(d);
      cur = new Date(Date.UTC(y, m + 1, 1, 12));
    }
  } else if (rec.kind === "yearly") {
    const mo = Math.min(12, Math.max(1, Number(rec.month ?? 1) || 1));
    const fromY = Number(fromDate.slice(0, 4));
    const toY = Number(toDate.slice(0, 4));
    for (let y = fromY; y <= toY; y++) {
      const last = lastDayOfMonth(y, mo - 1);
      const day = Math.min(Number(rec.day ?? 1) || 1, last);
      const d = `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dMs = dateToMs(d);
      if (dMs >= fromMs && dMs <= toMs) out.push(d);
    }
  }
  return out.sort();
}

// MM-DD band membership, year-wrap aware (mirror of src/lib/roleMaster.ts).
function inSeasonWindow(date: string, sw?: { fromMonthDay: string; toMonthDay: string }): boolean {
  if (!sw || !sw.fromMonthDay || !sw.toMonthDay) return true;
  const md = date.slice(5);
  const from = sw.fromMonthDay;
  const to = sw.toMonthDay;
  if (from <= to) return md >= from && md <= to;
  return md >= from || md <= to;
}
function inActiveWindow(date: string, from?: string, until?: string): boolean {
  if (from && date < from) return false;
  if (until && date > until) return false;
  return true;
}
function dateGenerable(date: string, duty: Duty): boolean {
  return inActiveWindow(date, duty.activeFrom, duty.activeUntil) &&
    inSeasonWindow(date, duty.seasonWindow);
}

const clean = (o: unknown): unknown => JSON.parse(JSON.stringify(o, (_k, v) => (v === undefined ? null : v)));

/**
 * Materialize missing role-duty task instances over the (today, today+31]
 * window and age overdue instances into 'missed'. No-op unless the master
 * toggle is on. Idempotent (instance id = dutyId-date). Self-contained.
 */
export async function runRoleGeneration(
  db: firestore.Firestore,
  appId: string,
  todayStr: string,
  nowMs: number,
  warnings: string[],
): Promise<{ generated: number; missed: number }> {
  const settings = ((await db.doc(`artifacts/${appId}/public/data/appData/main`).get()).data() as Record<string, unknown>)?.settings as Record<string, unknown> | undefined;
  if (!settings?.roleMasterGenerationEnabled) return {generated: 0, missed: 0};

  const roleSnap = await db.collection(`artifacts/${appId}/public/data/roleMasterRoles`).get();
  const dutySnap = await db.collection(`artifacts/${appId}/public/data/roleMasterDuties`).get();
  const roles = new Map<string, any>();
  roleSnap.forEach((d) => roles.set(d.id, d.data()));
  const duties = dutySnap.docs.map((d) => d.data() as any);

  // Existing instance ids + open instances (for the missed sweep). Bounded for
  // beta; revisit with a per-duty query if history grows large.
  const instCol = db.collection(`artifacts/${appId}/public/data/roleTaskInstances`);
  const instSnap = await instCol.get();
  const existing = new Set<string>();
  const openInstances: any[] = [];
  instSnap.forEach((d) => {
    existing.add(d.id);
    const v = d.data() as any;
    if (v.status === "open") openInstances.push(v);
  });

  const from = addDaysStr(todayStr, 1);
  const to = addDaysStr(todayStr, HORIZON_DAYS);
  // Pull employees once for assignee resolution.
  const emps = (((await db.doc(`artifacts/${appId}/public/data/appData/main`).get()).data() as Record<string, unknown>)?.employees as any[]) || [];
  const empById = new Map(emps.map((e) => [e.id, e]));

  let generated = 0;
  const dutyCursor: Record<string, string> = {};
  for (const duty of duties) {
    if (!duty.active) continue;
    const role = roles.get(duty.roleId);
    if (!role || !role.active || !role.assignedEmployeeId) continue;
    const emp = empById.get(role.assignedEmployeeId);
    const assignedTo = emp ?
      {employeeId: emp.id, email: (emp.linkedUserEmail || emp.email || "").toLowerCase(), name: emp.name || emp.id} :
      {employeeId: role.assignedEmployeeId, email: "", name: role.assignedEmployeeId};
    const occ = computeOccurrences(duty.recurrence, from, to);
    for (const date of occ) {
      // season + duration gates
      if (!dateGenerable(date, duty as Duty)) continue;
      const id = `${duty.id}-${date}`;
      if (existing.has(id)) continue;
      const inst = {
        id, title: duty.name, assignedTo, createdAt: nowMs,
        dueDate: dateToMs(date), status: "open",
        dutyId: duty.id, roleId: role.id, category: duty.category,
        occurrenceDate: date, generated: true, dueSoonDays: duty.dueSoonDays ?? 2,
      };
      // eslint-disable-next-line no-await-in-loop
      await instCol.doc(id).set(clean(inst) as admin.firestore.DocumentData);
      existing.add(id);
      generated++;
    }
    dutyCursor[duty.id] = to;
  }

  // Missed sweep: open instances aged past the window become permanent.
  let missed = 0;
  for (const inst of openInstances) {
    if (daysAgo(inst.occurrenceDate, todayStr) > MISSED_AFTER_DAYS) {
      // eslint-disable-next-line no-await-in-loop
      await instCol.doc(inst.id).set({status: "missed", resolvedAt: nowMs}, {merge: true});
      missed++;
    }
  }

  // Advance each generated duty's cursor (best-effort).
  for (const [dutyId, through] of Object.entries(dutyCursor)) {
    // eslint-disable-next-line no-await-in-loop
    await db.doc(`artifacts/${appId}/public/data/roleMasterDuties/${dutyId}`).set({lastGeneratedThrough: through}, {merge: true});
  }

  if (generated > 0 || missed > 0) {
    logger.info("role generation complete", {generated, missed});
  }
  warnings.push(`role_generation generated=${generated} missed=${missed}`);
  return {generated, missed};
}

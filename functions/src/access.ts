// ROLES — the only way admin/manager status changes (roles rollout step 3).
//
// access/roles is the source of truth; no client can write it (rules). The
// roster's systemRole and the old appData.adminEmails mirror are kept equal
// to it here, in the SAME transaction, so they can't drift — and so a
// demoted admin can't stay in through the old list while rules still read
// both (dual-read, until step 4).
//
// Logic lives in accessRolesCore.ts (pure, tested); this file is the
// Firestore wrapper.
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {
  AccessRoles, driftReport, employeeEmail, normEmail, planRoleChange,
  RosterEmployee,
} from "./accessRolesCore.js";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = "us-central1";
const APP_DATA_DOC = "artifacts/crewmaster/public/data/appData/main";
const ROLES_DOC = "access/roles";
const CHANGES = "accessRoleChanges";

const readAccess = (d: admin.firestore.DocumentSnapshot): AccessRoles | null =>
  d.exists ? {
    admins: (d.get("admins") as string[]) || [],
    managers: (d.get("managers") as string[]) || [],
  } : null;

export const setUserRole = onCall({region: REGION}, async (req) => {
  const callerEmail = normEmail(req.auth?.token?.email);
  if (!callerEmail) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const {employeeId, role} =
    (req.data || {}) as {employeeId?: string; role?: string};
  if (typeof employeeId !== "string" || !employeeId ||
      typeof role !== "string" || !role) {
    throw new HttpsError(
      "invalid-argument", "employeeId and role are required.");
  }

  const result = await db.runTransaction(async (tx) => {
    const rolesRef = db.doc(ROLES_DOC);
    const mainRef = db.doc(APP_DATA_DOC);
    const [rolesSnap, mainSnap] =
      await Promise.all([tx.get(rolesRef), tx.get(mainRef)]);
    const access = readAccess(rolesSnap);
    if (!access) {
      throw new HttpsError("failed-precondition", "access/roles is missing.");
    }
    const employees = (mainSnap.get("employees") as RosterEmployee[]) || [];
    const plan = planRoleChange({
      access, employees, employeeId, newRole: role, callerEmail,
    });
    if (!plan.ok) throw new HttpsError(plan.code, plan.message);
    if (plan.noop) {
      return {changed: false, from: plan.from, to: plan.to,
        adminEmails: plan.nextAdminEmails};
    }

    const caller = employees.find((e) => employeeEmail(e) === callerEmail);
    const byName = String(caller?.name || req.auth?.token?.name || callerEmail);
    const now = admin.firestore.FieldValue.serverTimestamp();
    tx.set(rolesRef, {
      admins: plan.nextAccess.admins,
      managers: plan.nextAccess.managers,
      version: admin.firestore.FieldValue.increment(1),
      updatedAt: now,
      updatedBy: callerEmail,
    }, {merge: true});
    // Targeted: only the roster and the old mirror. Never a whole-doc write.
    tx.update(mainRef, {
      employees: plan.nextEmployees,
      adminEmails: plan.nextAdminEmails,
    });
    tx.create(db.collection(CHANGES).doc(), {
      at: now,
      action: "setRole",
      employeeId,
      employeeName: plan.targetName,
      email: plan.targetEmail || null,
      from: plan.from,
      to: plan.to,
      byEmail: callerEmail,
      byName,
      adminsAfter: plan.nextAccess.admins,
      managersAfter: plan.nextAccess.managers,
    });
    // adminEmails returned so the caller's app can update its copy at once.
    return {changed: true, from: plan.from, to: plan.to,
      adminEmails: plan.nextAdminEmails};
  });
  logger.info("setUserRole", {employeeId, ...result, by: callerEmail});
  return result;
});

/**
 * Read-only comparison of access/roles, the old mirror and the roster.
 * @return {Promise<{inSync: boolean, issues: string[]}>} The report.
 */
export async function runAccessDriftCheck():
  Promise<{inSync: boolean; issues: string[]}> {
  const [rolesSnap, mainSnap] = await Promise.all([
    db.doc(ROLES_DOC).get(), db.doc(APP_DATA_DOC).get(),
  ]);
  const report = driftReport({
    access: readAccess(rolesSnap),
    adminEmails: (mainSnap.get("adminEmails") as string[] | undefined) ?? null,
    employees: (mainSnap.get("employees") as RosterEmployee[]) || [],
  });
  if (report.inSync) logger.info("Access roles in sync");
  else logger.warn("Access roles drift", {issues: report.issues});
  return report;
}

// Daily, before the work day. Run it on demand from Cloud Scheduler
// ("Force run") — it only reads.
export const accessDriftCheck = onSchedule(
  {region: REGION, schedule: "5 6 * * *", timeZone: "America/Toronto"},
  async () => {
    await runAccessDriftCheck();
  },
);

import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const REGION = "us-central1";
const TIMEZONE = "America/Toronto";
const APP_ID = "crewmaster";
const SYNC_LOG_COLLECTION = `artifacts/${APP_ID}/private/data/syncLog`;

// A sync is considered stalled once the newest *successful* run is older than
// this. Matches the 60-minute threshold the previous metric-absence alert
// policy used, so the alerting semantics don't change.
const STALE_AFTER_MS = 60 * 60 * 1000;

// Syncs run every 15 minutes, so the newest success is normally <15 min old.
// Scanning 20 entries covers ~5 hours of history — far past the staleness
// threshold even if several consecutive runs failed.
const SCAN_LIMIT = 20;

/**
 * Staleness watchdog for the Jobber performance sync.
 *
 * This replaces a Cloud Monitoring metric-absence policy that evaluated 24/7.
 * The sync only runs 06:00–23:45 America/Toronto, so absence of a completion
 * was indistinguishable from the expected overnight gap and the policy fired
 * a false positive every night at ~00:45.
 *
 * Emitting the stall signal from a Cloud Scheduler job instead means the
 * operating-hours window is expressed once, in the schedule below, and Cloud
 * Scheduler resolves it in America/Toronto — so it tracks DST on its own
 * rather than drifting like a UTC hour filter would.
 *
 * The first check of the day is at 07:12 rather than just after the 06:00
 * sync: by then four sync attempts (06:00/06:15/06:30/06:45) have had time to
 * land, so a 60-minute staleness threshold still means several consecutive
 * failures, exactly as it does mid-day. Checking at 06:10 would instead have
 * alerted on a single missed 06:00 run.
 *
 * Alerting is driven off the "Jobber performance sync stalled" log line via a
 * log-based counter metric; the alert policy fires on that metric being
 * present, not on the completion metric being absent.
 */
export const jobberSyncStaleCheck = onSchedule(
  {
    region: REGION,
    // :12/:27/:42/:57 — offset past each sync slot (:00/:15/:30/:45) so a run
    // still in flight isn't mistaken for a stall. The sync's timeout is 540s,
    // but a run that overruns its own slot by 12 minutes is itself a stall.
    schedule: "12,27,42,57 7-23 * * *",
    timeZone: TIMEZONE,
  },
  async () => {
    const now = Date.now();

    let snap;
    try {
      snap = await db
        .collection(SYNC_LOG_COLLECTION)
        .orderBy("triggeredAt", "desc")
        .limit(SCAN_LIMIT)
        .get();
    } catch (e) {
      // A read failure is a fault in the watchdog, not evidence of a stall.
      // Log it as an error and stay silent so we don't alert on ourselves.
      logger.error("Jobber sync stale check failed to read syncLog", {
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    // Newest run that actually completed clean. A run that recorded errors
    // doesn't count as a successful sync no matter how recent it is.
    let lastSuccessAt: number | null = null;
    for (const doc of snap.docs) {
      const errors: unknown = doc.get("errors");
      const failed = Array.isArray(errors) && errors.length > 0;
      if (failed) continue;
      const at: unknown = doc.get("triggeredAt");
      if (typeof at === "number") {
        lastSuccessAt = at;
        break;
      }
    }

    // No successful run anywhere in the scanned window — that is at least
    // SCAN_LIMIT consecutive failures, well past the staleness threshold.
    if (lastSuccessAt === null) {
      logger.info("Jobber performance sync stalled", {
        reason: "no_successful_sync_in_window",
        scanned: snap.size,
        thresholdMinutes: STALE_AFTER_MS / 60000,
      });
      return;
    }

    const ageMs = now - lastSuccessAt;
    if (ageMs > STALE_AFTER_MS) {
      logger.info("Jobber performance sync stalled", {
        reason: "last_success_too_old",
        ageMinutes: Math.round(ageMs / 60000),
        thresholdMinutes: STALE_AFTER_MS / 60000,
        lastSuccessAt: new Date(lastSuccessAt).toISOString(),
      });
      return;
    }

    logger.info("Jobber performance sync healthy", {
      ageMinutes: Math.round(ageMs / 60000),
    });
  },
);

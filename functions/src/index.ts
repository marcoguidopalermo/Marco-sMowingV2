import {setGlobalOptions} from "firebase-functions";
import {onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

// Cost-control default carried over from `firebase init`.
setGlobalOptions({maxInstances: 10});

export const helloJobber = onCall(
  {region: "us-central1"},
  async (_request) => {
    logger.info("helloJobber called");
    return {
      message: "Hello from CrewMaster Functions!",
      timestamp: new Date().toISOString(),
    };
  },
);

export {checkEmailAuthorized} from "./authGate.js";
export {
  registerPushToken,
  pushAnnouncement,
  pushRepairAssigned,
  sendTestNotification,
  onWorkOrderWrite,
} from "./notifications.js";
export {jobberOAuthStart, jobberOAuthCallback} from "./jobber/oauth.js";
export {jobberSyncUsers} from "./jobber/syncUsers.js";
export {
  jobberSyncPerformance,
  jobberSyncPerformanceScheduled,
} from "./jobber/syncPerformance.js";
// Staleness watchdog for the performance sync. Runs only inside operating
// hours so the expected overnight gap can't be read as a stall.
export {jobberSyncStaleCheck} from "./jobber/syncHealth.js";
// Forward capacity forecast — read-only snapshot of scheduled, uncompleted
// work. Independent of the performance sync (own schedule, own document).
export {
  jobberSyncCapacity,
  jobberSyncCapacityScheduled,
  jobberSyncCapacityLawnScheduled,
} from "./jobber/capacityForecast.js";

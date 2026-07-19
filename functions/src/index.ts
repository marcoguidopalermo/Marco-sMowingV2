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
  onWorkOrderWrite,
} from "./notifications.js";
export {jobberOAuthStart, jobberOAuthCallback} from "./jobber/oauth.js";
export {jobberSyncUsers} from "./jobber/syncUsers.js";
export {
  jobberSyncPerformance,
  jobberSyncPerformanceScheduled,
} from "./jobber/syncPerformance.js";

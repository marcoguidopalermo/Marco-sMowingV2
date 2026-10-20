/* eslint-disable max-len */
// OfficeMaster deadline reminders — daily 07:20 Toronto, to the office list
// only (never the editable notification audience). Same send layer, quiet
// hours and dedupe markers as every other push.
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {alreadySent, markSent, sendNotification} from "./notifications.js";
import {deadlineAlertsDue, DeadlineLike} from "./officeDeadlinesCore.js";
import {OFFICE_VIEWERS} from "./jobber/officeAR.js";
import {torontoYmd} from "./jobber/officeARCore.js";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const officeDeadlineAlerts = onSchedule(
  {region: "us-central1", timeZone: "America/Toronto", schedule: "20 7 * * *", retryCount: 0},
  async () => {
    const today = torontoYmd(Date.now());
    const snap = await db.collection("officeDeadlines").where("status", "==", "open").get();
    let sent = 0;
    for (const doc of snap.docs) {
      const item = {id: doc.id, ...doc.data()} as DeadlineLike;
      for (const a of deadlineAlertsDue(item, today)) {
        if (await alreadySent(a.marker)) continue;
        await sendNotification([...OFFICE_VIEWERS], "office", {title: a.title, body: a.body, url: "/#office"});
        await markSent(a.marker);
        sent++;
      }
    }
    logger.info("Office deadline reminders", {open: snap.size, sent});
  },
);

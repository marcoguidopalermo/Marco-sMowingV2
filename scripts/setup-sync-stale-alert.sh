#!/usr/bin/env bash
#
# Cloud Monitoring setup for the Jobber performance-sync staleness alert.
#
# WHY THIS FILE EXISTS
# --------------------
# The previous alert was created ad hoc against the Monitoring REST API and
# never committed, so nothing in the repo recorded that it existed or how it
# was configured. This script is the checked-in definition. Edit it here and
# re-run it rather than clicking through the console.
#
# WHAT CHANGED
# ------------
# The old policy (5342079805094293590, "Jobber performance sync stalled (no
# completion in 60 min)") used a metric-ABSENCE condition on
# jobber_perf_sync_complete with duration 3600s. It evaluated 24/7, but the
# sync only runs 06:00-23:45 America/Toronto, so the expected overnight gap
# looked identical to a stall and it fired every night at ~00:45.
#
# The replacement inverts the signal: functions/src/jobber/syncHealth.ts runs
# on a Cloud Scheduler job pinned to America/Toronto during operating hours
# only, and logs "Jobber performance sync stalled" when the newest successful
# sync is over 60 minutes old. The policy fires on the PRESENCE of that log
# line. Outside operating hours the job doesn't run, so there is nothing to
# evaluate and nothing to suppress. DST is handled by Cloud Scheduler.
#
# NOTE: these gcloud invocations were written without a local gcloud install
# to test against. Read them before running; flag names may need adjusting.
#
# Usage:  bash scripts/setup-sync-stale-alert.sh
set -euo pipefail

PROJECT="crewmaster-73f31"
METRIC="jobber_perf_sync_stalled"
OLD_POLICY_ID="5342079805094293590"
# Existing "Marco — CrewMaster ops" email channel.
CHANNEL="projects/${PROJECT}/notificationChannels/11717820778982685290"

# ---------------------------------------------------------------------------
# Step 1 — create the log-based metric.
#
# Do this BEFORE deploying syncHealth.ts. Log-based metrics are not
# retroactive: they only count log entries written after the metric exists.
# ---------------------------------------------------------------------------
gcloud logging metrics create "${METRIC}" \
  --project="${PROJECT}" \
  --description="Counts stall reports from jobberSyncStaleCheck. Emitted only during operating hours (06:00-23:45 America/Toronto)." \
  --log-filter='resource.type="cloud_run_revision"
resource.labels.service_name="jobbersyncstalecheck"
jsonPayload.message="Jobber performance sync stalled"'

# ---------------------------------------------------------------------------
# Step 2 — deploy the watchdog, then confirm the metric sees traffic.
#
#   firebase deploy --only functions:jobberSyncStaleCheck
#
# The healthy path logs "Jobber performance sync healthy", which the metric
# deliberately does NOT match. To prove the alerting path end to end, either
# wait for a real stall or temporarily lower STALE_AFTER_MS in syncHealth.ts.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Step 3 — create the replacement policy.
#
# evaluationMissingData is set to INACTIVE on purpose. This metric has no data
# at all while the sync is healthy, and the default missing-data behaviour
# would treat that silence as a reason to fire — reintroducing exactly the
# false positive this change removes.
# ---------------------------------------------------------------------------
POLICY_FILE="$(mktemp)"
trap 'rm -f "${POLICY_FILE}"' EXIT

cat > "${POLICY_FILE}" <<JSON
{
  "displayName": "Jobber performance sync stalled (operating hours)",
  "documentation": {
    "content": "jobberSyncStaleCheck reported that the newest successful Jobber performance sync is more than 60 minutes old.\n\nThe watchdog runs :12/:27/:42/:57 during 07:00-23:59 America/Toronto (functions/src/jobber/syncHealth.ts). It does not run overnight, because the sync itself only runs 06:00-23:45 — so unlike the policy this replaced, this one cannot fire on the expected overnight gap.\n\nFirst check of the day is 07:12, by which point four sync attempts have had time to land, so a stall report means several consecutive failures rather than one missed run.\n\nKnown gap: a stall beginning after ~23:00 is not reported until 07:12 the next morning. Nothing is syncing overnight, so no data is lost.\n\nDefined in scripts/setup-sync-stale-alert.sh.",
    "mimeType": "text/markdown"
  },
  "combiner": "OR",
  "enabled": true,
  "conditions": [
    {
      "displayName": "Stall reported during operating hours",
      "conditionThreshold": {
        "filter": "resource.type=\"cloud_run_revision\" AND metric.type=\"logging.googleapis.com/user/${METRIC}\"",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_SUM",
            "crossSeriesReducer": "REDUCE_SUM"
          }
        ],
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0,
        "duration": "0s",
        "trigger": { "count": 1 },
        "evaluationMissingData": "EVALUATION_MISSING_DATA_INACTIVE"
      }
    }
  ],
  "alertStrategy": { "autoClose": "86400s" },
  "notificationChannels": ["${CHANNEL}"]
}
JSON

gcloud alpha monitoring policies create \
  --project="${PROJECT}" \
  --policy-from-file="${POLICY_FILE}"

# ---------------------------------------------------------------------------
# Step 4 — retire the old 24/7 absence policy.
#
# Left as a separate, deliberate step: verify the new policy is live and has
# evaluated at least once before removing the old coverage. Deleting is
# destructive and cannot be undone, so confirm the ID first.
#
#   gcloud alpha monitoring policies describe "${OLD_POLICY_ID}" --project="${PROJECT}"
#   gcloud alpha monitoring policies delete   "${OLD_POLICY_ID}" --project="${PROJECT}"
#
# The old jobber_perf_sync_complete log metric can stay; it is still a useful
# signal to graph even with no policy attached to it.
# ---------------------------------------------------------------------------
echo "Created metric ${METRIC} and the replacement policy."
echo "Old policy ${OLD_POLICY_ID} is still active — retire it manually (step 4)."

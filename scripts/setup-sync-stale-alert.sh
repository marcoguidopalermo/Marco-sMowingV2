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
# IDEMPOTENT: re-running this script converges the metric and the policy to the
# definitions below. It creates them if absent and updates them in place if
# present, so it is safe to run repeatedly while iterating.
#
# Usage:  bash scripts/setup-sync-stale-alert.sh
set -euo pipefail

PROJECT="crewmaster-73f31"
METRIC="jobber_perf_sync_stalled"
OLD_POLICY_ID="5342079805094293590"
# Existing "Marco — CrewMaster ops" email channel.
CHANNEL="projects/${PROJECT}/notificationChannels/11717820778982685290"

# ---------------------------------------------------------------------------
# Step 1 — create (or update) the log-based metric.
#
# Do this BEFORE deploying syncHealth.ts. Log-based metrics are not
# retroactive: they only count log entries written after the metric exists.
#
# `create` fails if the metric already exists, so branch on a describe. Do NOT
# delete-and-recreate to get a clean slate: that discards the metric's history
# and starts the counter from empty again.
# ---------------------------------------------------------------------------
METRIC_DESCRIPTION="Counts stall reports from jobberSyncStaleCheck. Emitted only during operating hours (06:00-23:45 America/Toronto)."
METRIC_FILTER='resource.type="cloud_run_revision"
resource.labels.service_name="jobbersyncstalecheck"
jsonPayload.message="Jobber performance sync stalled"'

if gcloud logging metrics describe "${METRIC}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "Metric ${METRIC} exists — updating in place."
  gcloud logging metrics update "${METRIC}" \
    --project="${PROJECT}" \
    --description="${METRIC_DESCRIPTION}" \
    --log-filter="${METRIC_FILTER}"
else
  echo "Metric ${METRIC} not found — creating."
  gcloud logging metrics create "${METRIC}" \
    --project="${PROJECT}" \
    --description="${METRIC_DESCRIPTION}" \
    --log-filter="${METRIC_FILTER}"
fi

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
# Step 3 — create (or update) the replacement policy.
#
# ON evaluationMissingData AND duration
# ------------------------------------
# An earlier revision of this file set evaluationMissingData to INACTIVE
# alongside duration "0s". The API rejects that combination outright:
#
#   INVALID_ARGUMENT: Field
#   alert_policy.conditions[0].condition_threshold.evaluation_missing_data
#   had an invalid value of "EVALUATION_MISSING_DATA_INACTIVE": Conditions
#   setting evaluation_missing_data must have a non-zero duration.
#
# The field is now omitted, and duration stays "0s". Two reasons that is the
# right resolution rather than raising the duration:
#
#  1. evaluationMissingData is DOCUMENTED AS IGNORED when duration is zero, so
#     it was inert even before the API started rejecting it. Removing it
#     changes no behaviour. The comment it carried was also wrong: the default
#     (EVALUATION_MISSING_DATA_UNSPECIFIED) is "open incidents stay open, new
#     incidents aren't opened", so silence cannot fire this policy. That is
#     exactly the property we wanted; we get it by default.
#
#  2. Raising the duration to satisfy the field would BREAK the alert. A
#     non-zero retest window requires the threshold to be violated across the
#     whole window, and this metric is deliberately sparse: the watchdog runs
#     :12/:27/:42/:57, so a sustained stall produces one point every 15
#     minutes against a 300s alignment period — two of every three aligned
#     windows are empty. The gaps would clear the pending state before any
#     retest window elapsed and the policy would never fire at all.
#
# So: duration "0s" and no evaluationMissingData. One stall report opens an
# incident, which is the intended semantics — the watchdog has already applied
# the 60-minute threshold before it logs anything.
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
        "trigger": { "count": 1 }
      }
    }
  ],
  "alertStrategy": { "autoClose": "86400s" },
  "notificationChannels": ["${CHANNEL}"]
}
JSON

# Look the policy up by display name. `policies create` does not dedupe, so
# without this a second run would leave two identical policies both paging the
# same channel — and the duplicate is easy to miss because the console groups
# them under the same name.
POLICY_DISPLAY_NAME="Jobber performance sync stalled (operating hours)"
EXISTING_POLICY="$(
  gcloud alpha monitoring policies list \
    --project="${PROJECT}" \
    --filter="displayName=\"${POLICY_DISPLAY_NAME}\"" \
    --format="value(name)" | head -n 1
)"

if [[ -n "${EXISTING_POLICY}" ]]; then
  echo "Policy already exists (${EXISTING_POLICY##*/}) — replacing its definition."
  gcloud alpha monitoring policies update "${EXISTING_POLICY}" \
    --project="${PROJECT}" \
    --policy-from-file="${POLICY_FILE}"
else
  echo "Policy not found — creating."
  gcloud alpha monitoring policies create \
    --project="${PROJECT}" \
    --policy-from-file="${POLICY_FILE}"
fi

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
echo
echo "Metric ${METRIC} and policy \"${POLICY_DISPLAY_NAME}\" are in place."
echo
echo "Verify the policy is evaluating (expect state=OK, not 'no data'):"
echo "  gcloud alpha monitoring policies list --project=${PROJECT} \\"
echo "    --filter='displayName=\"${POLICY_DISPLAY_NAME}\"' \\"
echo "    --format='yaml(name,enabled,conditions)'"
echo
if gcloud alpha monitoring policies describe "${OLD_POLICY_ID}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "Old policy ${OLD_POLICY_ID} is STILL ACTIVE — retire it manually (step 4)."
else
  echo "Old policy ${OLD_POLICY_ID} is already gone."
fi

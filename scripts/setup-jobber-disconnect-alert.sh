#!/usr/bin/env bash
#
# Cloud Monitoring setup for the "Jobber disconnected" alert.
#
# WHY: on 2026-10-14 Jobber rejected our saved refresh token at 11:00 and the
# only signal was the stale-sync alert at 11:57 — an hour of failed syncs
# before anyone knew. The shared token helper (functions/src/jobber/token*.ts)
# now logs ONE structured line the moment Jobber refuses the refresh token:
#
#   "Jobber disconnected - an admin must reconnect in CrewMaster"
#   (severity ERROR, jsonPayload.event = "jobber_refresh_rejected")
#
# This script points a log-based metric and an alert policy at that line, so
# an email goes out within a few minutes of the first refusal. Network errors
# and 5xx from Jobber do NOT log it (transient); the stale check covers those.
#
# IDEMPOTENT, same shape as scripts/setup-sync-stale-alert.sh: creates the
# metric and policy if absent, updates them in place if present.
#
# ORDER: run this BEFORE deploying the functions that emit the line
# (log-based metrics only count entries written after they exist).
#
# Usage:  bash scripts/setup-jobber-disconnect-alert.sh
set -euo pipefail

PROJECT="crewmaster-73f31"
METRIC="jobber_token_refresh_rejected"
# Existing "Marco — CrewMaster ops" email channel (same as the stale alert).
CHANNEL="projects/${PROJECT}/notificationChannels/11717820778982685290"
POLICY_DISPLAY_NAME="Jobber disconnected — reconnect in CrewMaster"

METRIC_DESCRIPTION="Jobber refused CrewMaster's refresh token: the connection is gone until an admin reconnects."
METRIC_FILTER='resource.type="cloud_run_revision"
severity>=ERROR
jsonPayload.message="Jobber disconnected - an admin must reconnect in CrewMaster"'

if gcloud logging metrics describe "${METRIC}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "Metric ${METRIC} exists — updating in place."
  gcloud logging metrics update "${METRIC}" --project="${PROJECT}" \
    --description="${METRIC_DESCRIPTION}" --log-filter="${METRIC_FILTER}"
else
  echo "Metric ${METRIC} not found — creating."
  gcloud logging metrics create "${METRIC}" --project="${PROJECT}" \
    --description="${METRIC_DESCRIPTION}" --log-filter="${METRIC_FILTER}"
fi

POLICY_FILE="$(mktemp)"
trap 'rm -f "${POLICY_FILE}"' EXIT
# duration "0s": one refusal opens an incident (see the stale-alert script for
# why a non-zero duration would stop a sparse metric from ever firing).
cat > "${POLICY_FILE}" <<JSON
{
  "displayName": "${POLICY_DISPLAY_NAME}",
  "documentation": {
    "content": "**Jobber disconnected — an admin must reconnect in CrewMaster.**\n\nJobber refused CrewMaster's saved refresh token, so every Jobber sync (performance/BH every 15 min, job timing, capacity) stops until someone reconnects.\n\n**Fix:** sign in to CrewMaster as an admin → Manage Resources → Jobber → Connect, and finish on the 'connected' page. Do NOT connect from Jobber's Developer Center or Connected Apps — that does not give CrewMaster new tokens.\n\nIf the outage crossed midnight Toronto, run a manual Sync for the missed day (the button syncs yesterday by default).\n\nKnown cause: opening GraphiQL on the production app in the Jobber Developer Center (incident 2026-10-14, probable). Use the CrewMaster Dev app for GraphiQL.\n\nDefined in scripts/setup-jobber-disconnect-alert.sh.",
    "mimeType": "text/markdown"
  },
  "combiner": "OR",
  "enabled": true,
  "conditions": [
    {
      "displayName": "Refresh token refused",
      "conditionThreshold": {
        "filter": "resource.type=\"cloud_run_revision\" AND metric.type=\"logging.googleapis.com/user/${METRIC}\"",
        "aggregations": [
          { "alignmentPeriod": "60s", "perSeriesAligner": "ALIGN_SUM", "crossSeriesReducer": "REDUCE_SUM" }
        ],
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0,
        "duration": "0s",
        "trigger": { "count": 1 }
      }
    }
  ],
  "alertStrategy": { "autoClose": "3600s" },
  "notificationChannels": ["${CHANNEL}"]
}
JSON

EXISTING_POLICY="$(
  gcloud alpha monitoring policies list --project="${PROJECT}" \
    --filter="displayName=\"${POLICY_DISPLAY_NAME}\"" --format="value(name)" | head -n 1
)"
if [[ -n "${EXISTING_POLICY}" ]]; then
  echo "Policy exists (${EXISTING_POLICY##*/}) — replacing its definition."
  gcloud alpha monitoring policies update "${EXISTING_POLICY}" --project="${PROJECT}" \
    --policy-from-file="${POLICY_FILE}"
else
  echo "Policy not found — creating."
  gcloud alpha monitoring policies create --project="${PROJECT}" --policy-from-file="${POLICY_FILE}"
fi
echo "Metric ${METRIC} and policy \"${POLICY_DISPLAY_NAME}\" are in place."

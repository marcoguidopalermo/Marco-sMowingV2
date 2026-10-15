# Incident 2026-10-14 — Jobber token rejected, Jobber syncs down 3h 17m

**Status:** resolved 14:30 EDT. Cause **probable, not confirmed** (see
"Probable cause"). All times America/Toronto (EDT).

## Summary

At 11:00 Jobber rejected CrewMaster's saved refresh token, so no Jobber
function could get an access token. Every 15-minute performance sync from
11:00 to 14:15 failed (14 runs), as did the manual capacity sync. An admin
reconnected Jobber through CrewMaster at 14:17. The 14:30 sync succeeded
and rebuilt the whole day; no visit data is missing.

## Timeline

| Time | Event | Source |
|---|---|---|
| 09:30–10:45 | 15-minute syncs run clean (16–18 visits each) | `syncLog` |
| ~10:00 | Last good token refresh; access token valid until 10:59 | token doc `updateTime` 14:00:33Z, expiry 15:00:33Z |
| ~10:51 | Developer Center GraphiQL session on the production CrewMaster app — read-only queries, no changes | reported by Marco |
| ~10:51 | Claude's schema check: one read-only `__schema` introspection query, using the saved **access** token (no refresh). Query cost 52,785 points | this session |
| 10:57 | Stale check: healthy | Cloud Logging |
| **11:00** | First failure: `Jobber refresh 401: The provided refresh token is not valid.` | Cloud Logging |
| 11:00–14:15 | Every 15-minute sync fails the same way (14 runs, 0 visits processed, nothing written) | `syncLog`, Cloud Logging |
| from ~11:57 | Stale check reports "Jobber performance sync stalled" every 15 minutes | Cloud Logging |
| 12:48, 12:49 | Manual capacity sync fails the same way | Cloud Logging |
| 14:13 | `helloJobber` test call | Cloud Logging |
| **14:17** | Admin connect flow in CrewMaster: `jobberOAuthStart` → `jobberOAuthCallback` "Jobber connected"; new token pair saved | Cloud Logging; token doc `connectedAt` 18:17:55Z |
| **14:30** | First good sync: 33 visits processed, 30 credited, 5 crew-days updated, no errors | `syncLog` |
| 14:42 | Stale check: "Jobber performance sync healthy" — the last "stalled" report was 14:27, so the stale alert has cleared | Cloud Logging |
| 14:39–14:40 | Manual capacity sync (Lawn) succeeds: called 14:39:27, forecast written 14:40:09, covers to Nov 4, no budget stop. Projects forecast not re-run (last refreshed Aug 15; auto-refresh off) | Cloud Logging; `capacityForecast/lawn` |

## Impact

**Missed syncs:**
- 14 scheduled performance syncs (11:00–14:15).
- The per-cycle job-timing pass that runs inside each of them.
- Two manual capacity syncs (12:48, 12:49).
- Capacity auto-refresh is off, so no scheduled capacity runs were missed.
- The 02:40 nightly job timing wasn't affected; it ran before the outage.

**Bad writes:** none. Each failed run stopped at the token step, before
reading or writing anything else, so no partial or corrupted data was
written.

**Backfill: complete for visits. Nothing was backfilled by hand.** Each
scheduled sync rebuilds the whole day, re-reading 7 days of visits and the
whole day's timesheets, so the 14:30 run covered the outage.

**Visits.** Checked at 14:31 against Jobber (read-only):
- Jobber lists 24 visits completed today, 12 of them during the outage.
  All 24 are in CrewMaster's `performance.2026-10-14`. **0 missing.**
- Today's 3 incomplete visits: #4827 and #5027 are in CrewMaster.
- #4502 (Wallaceburg Lawn Care, weekly mowing) is assigned only to Dave
  Pineau, who isn't on any of today's 5 crews. It has no crew-day to
  attach to. That's existing behaviour, not the outage.

**Timesheets.** The 14:30 run re-read all 50 of today's Jobber timesheet
entries, including the 22 that started during the outage. Today's 8
`employeeAH` entries were written by that run.

**Still missing:** nothing found.

**Recovery checks (all passed):** 14:30 sync clean; 14:42 stale check healthy; today's visits and timesheets complete (above); manual Lawn capacity sync succeeded at 14:40; the 02:40 nightly job timing reads the token from Firestore at run time, so it will use the new one.

**Who noticed, and how fast:** the stale alert first reported at ~11:57,
about an hour after the first failure. That delay is what item 2 below removes.

## Probable cause — NOT CONFIRMED

Jobber has refresh-token rotation on. Each refresh returns a new refresh
token, and Jobber rejects a refresh token that "expired, was revoked, or has
already been replaced". At 11:00 CrewMaster presented the refresh token it
had saved at ~10:00, and Jobber said it was no longer valid. In the hour
between, something made Jobber stop accepting it. Our own logs show no
second refresh by CrewMaster: one sync every 15 minutes, each completed
cleanly, and the token doc was last written at 10:00.

**Candidate 1 (more likely): Developer Center GraphiQL, ~10:51.**
GraphiQL in the Developer Center runs queries as the app it is opened from,
against the Jobber account that app is connected to. To do that, it gets
its own token by signing that app in to our account. If Jobber keeps one
authorization per app per account, that sign-in replaces CrewMaster's, and
CrewMaster's saved refresh token stops working at its next use. That's
consistent with:
- the 9-minute gap to the first refresh attempt;
- the queries being read-only, which doesn't matter: it's the
  authorization that's replaced, not the data.

**Candidate 2 (less likely): Claude's schema check, ~10:51.** One
introspection query with CrewMaster's saved **access** token. It didn't
use or change the refresh token, and querying with an access token isn't a
documented way to revoke a refresh token. But it ran in the same window and
was unusually expensive (52,785 points against a 10,000-point bucket), so
it can't be ruled out without Jobber confirming.

**Neither is confirmed.** To confirm: ask Jobber API support whether
opening GraphiQL from an app's Developer Center page re-authorizes that app
on the connected account and invalidates its existing refresh tokens. A
controlled test (open GraphiQL on a dev app, then refresh that app's earlier
token) would settle it too, but only on the dev app of item 4, never on
production.

**Also found during the incident (not the cause):** Jobber's OAuth tokens
are readable and writable by every signed-in CrewMaster user. They live
under `artifacts/…` (`firestore.rules:27`), and `App.tsx:1627` subscribes
to that doc in every session. Fix is in item 3.

## Prevention

### Status (2026-10-15)

| Item | State |
|---|---|
| 2. Immediate "Jobber disconnected" alert | **Built, not deployed.** The log line is emitted by the shared token helper; `scripts/setup-jobber-disconnect-alert.sh` creates the metric + policy (run it *before* deploying the functions). |
| 3. Shared token helper with a refresh lease | **Built, not deployed** (branch `jobber-token-hardening`). `functions/src/jobber/tokenCore.ts` (rules, 13 tests incl. "8 concurrent callers → one refresh" and a control proving the race kills the connection without the lease) + `token.ts` (Firestore wrapper; lease transaction verified in the emulator). All four token paths + the 401 retry use it; `jobberDisconnect` replaces the client-side delete. Tokens move to server-only `jobberAuthSecrets/main` (dual-write to the old doc this release). |
| 4. Separate "CrewMaster Dev" app | **Skipped** (2026-10-15). Rule instead: never use "Test in GraphiQL" on the production app, renamed "CrewMaster — PRODUCTION (no GraphiQL)" on 2026-10-15 (`docs/jobber-dev-app.md`). |
| Tokens readable by every signed-in user | Release 1 adds the server-only home; **release 2** strips the tokens from `artifacts/.../jobberAuth/main`. Exposure ends with release 2. |


Proposals only. Nothing below has been built, deployed or changed.

### 2. Immediate "Jobber disconnected" alert

**Goal:** an email within ~5 minutes of the first rejected refresh, not
after 60 minutes of stale-check failures.

**Code (one line of behaviour, in the shared helper of item 3, or in
`refreshJobberAccessToken` if this ships first):** when Jobber's token endpoint
rejects the refresh token (HTTP 400/401, `invalid_grant` / "refresh token is
not valid"), log one structured line before throwing:

```ts
logger.error("Jobber disconnected - an admin must reconnect in CrewMaster", {
  event: "jobber_refresh_rejected",
  service: process.env.K_SERVICE,     // which function hit it
  status: resp.status,
});
```

Only the *rejected refresh token* case logs this. Network errors, 5xx and
throttling don't — those are transient and the stale check already covers
them.

**Monitoring:** `scripts/setup-jobber-disconnect-alert.sh`, same shape as
`scripts/setup-sync-stale-alert.sh` (idempotent describe → create/update):

- Log-based metric `jobber_token_refresh_rejected`, filter:
  ```
  resource.type="cloud_run_revision"
  jsonPayload.message="Jobber disconnected - an admin must reconnect in CrewMaster"
  ```
  No `service_name` restriction — any Jobber function can hit it (today it
  was the performance sync first, then the capacity button).
- Alert policy "Jobber disconnected — reconnect in CrewMaster": threshold
  `> 0`, `ALIGN_SUM` over 60s, `duration: "0s"` (one line opens an incident;
  same reasoning as the stale alert), `autoClose: 3600s`.
- Documentation field (shows in the email): the message, plus "Sign in to
  CrewMaster as an admin → Manage Resources → Jobber → Connect, and finish
  on the 'connected' page. Don't connect from Jobber's Developer Center or
  Connected Apps — that doesn't give CrewMaster new tokens."
- Create the metric **before** deploying the code (log metrics aren't
  retroactive).

**Who receives it:** the existing "Marco — CrewMaster ops" email channel
(`notificationChannels/11717820778982685290`). Recommended additions,
your call: a second admin's email so it isn't single-point; an SMS channel,
because this one stops payroll data syncing. Optionally also a push to the
super admin through the existing `notifications.ts` path the storage alert
uses, so it shows in the app.

**Expected latency:** first failed refresh → log ingestion and metric
(~1–3 min) → incident and email. Today that would have been ~11:03
instead of the 11:57 stale alert.

**Stale check follow-up (small):** when the newest `syncLog` entry's error
is a rejected refresh, have `jobberSyncStaleCheck` say "stalled — Jobber
disconnected" so the hourly alert points at the same fix.

### 3. One shared token helper, with a refresh lock

**Today:** five places refresh independently — `getValidAccessToken()` in
`syncPerformance.ts:704`, `capacityForecast.ts:438`, `jobTiming.ts:225`,
inline in `syncUsers.ts:91-116`, and the 401-retry in `client.ts:107-116`.
None coordinates. With Jobber's refresh-token rotation ON, if two refresh at
once, the second sends a refresh token the first already spent → Jobber
rejects it → the same outage as today.

**New `functions/src/jobber/token.ts`** — the only module allowed to call
Jobber's token endpoint:

```ts
export async function getJobberAccessToken(opts?: {
  rejectedToken?: string;   // pass the token that just got a 401
}): Promise<string>
export class JobberDisconnectedError extends Error {}
```

Flow:

1. Read the token doc. If the access token is valid for more than 5 minutes
   and isn't `rejectedToken`, return it. (Most calls stop here; no lock.)
2. If `rejectedToken` is set and the stored token is already different,
   someone else refreshed — return the stored one.
3. **Take the lock** — a Firestore transaction on a separate doc
   `jobberTokenLock/main`: if it's free or its lease has expired, write
   `{holder: <uuid>, service: K_SERVICE, acquiredAt, leaseUntil: now+30s}`.
4. **Lock busy:** don't refresh. Poll the token doc every 1s for up to 30s
   until the access token changes, then return the new one. If the lease
   expires with no change (holder crashed), go back to step 3.
5. **Lock held:** re-read the token doc (double-check — it may have just
   been refreshed). If still stale, POST the refresh, then save with a
   **targeted `update()`** of only `accessToken`, `refreshToken`,
   `accessTokenExpiresAt`, `lastRefreshedAt`, `lastRefreshedBy` (retry the
   save 3× — losing a rotated refresh token is itself a disconnect). Release
   the lock in a transaction that deletes it only if `holder` is still us.
6. **Refresh rejected:** re-read the doc first. If the refresh token changed
   while we were working (an admin just reconnected), return the new access
   token. Otherwise log the item 2 line, set `status: "disconnected"` with a
   targeted update, and throw `JobberDisconnectedError` so every caller fails
   fast instead of retrying.

Why not do the HTTP refresh *inside* a Firestore transaction: transactions
retry on contention, and a retried refresh spends the rotated token twice —
the exact failure we're preventing. The lease takes ~1s; 30s is only the
crash bound.

**Write safety (APPDATA-WRITE-SAFETY.md):** nothing on `appData/main`;
every token write is a targeted `update()`; the lock is its own doc; only
the OAuth callback ever does a whole-doc `set()` (a fresh connection
legitimately replaces everything).

**Move the tokens off the client-readable path (security fix, same
rollout).** Today `artifacts/crewmaster/private/data/jobberAuth/main` falls
under `match /artifacts/{document=**} { allow read, write: if
isAuthorized() }`, and `App.tsx:1627` subscribes to it for every signed-in
user to show "connected" — every browser session downloads the live access
and refresh tokens, and any user could overwrite or delete them. Split it:

| Doc | Contents | Rule |
|---|---|---|
| root `jobberAuthSecrets/main` | accessToken, refreshToken, expiresAt, lastRefreshed* | `allow read, write: if false` (Admin SDK only) |
| root `jobberTokenLock/main` | lease | `allow read, write: if false` |
| `artifacts/.../jobberAuth/main` (existing) | connected, status, connectedAt, connectedBy, accountName, lastRefreshedAt — **no tokens** | unchanged; the app keeps reading it |

The Disconnect button (`ManageResourcesModal.tsx:2125`, a client
`deleteDoc`) becomes a small admin-checked callable that deletes both.

**Files that change:**

| File | Change |
|---|---|
| `functions/src/jobber/token.ts` (new) | the helper above |
| `functions/src/jobber/token.test.ts` (new) | two concurrent callers → exactly one refresh POST; lease expiry; rejected refresh → disconnected + error; rejected-but-reconnected → new token; `rejectedToken` path |
| `functions/src/jobber/oauth.ts` | `refreshJobberAccessToken` becomes internal to `token.ts`; callback writes secrets + status docs and clears the lock; new `jobberDisconnect` callable |
| `functions/src/jobber/client.ts` | 401 path calls `getJobberAccessToken({rejectedToken})`, no direct refresh |
| `functions/src/jobber/syncPerformance.ts` | delete `getValidAccessToken` (704-728), import the helper |
| `functions/src/jobber/capacityForecast.ts` | delete `getValidAccessToken` (438-458) |
| `functions/src/jobber/jobTiming.ts` | delete `getValidAccessToken` (225-242) |
| `functions/src/jobber/syncUsers.ts` | replace inline refresh (91-116) |
| `functions/src/index.ts` | export `jobberDisconnect` |
| `firestore.rules` | the two root `if false` matches |
| `src/App.tsx`, `src/components/ManageResourcesModal.tsx` | no token reads; Disconnect → callable |
| a test that fails if anything but `token.ts` imports the refresh function | keeps it the only path |

Deployed functions affected: `jobberSyncPerformance`,
`jobberSyncPerformanceScheduled`, `jobberSyncCapacity`,
`jobberSyncCapacityLawnScheduled`, `jobberSyncCapacityScheduled`,
`jobberJobTimingNightly`, `jobberSyncUsers`, `jobberOAuthCallback`, new
`jobberDisconnect`. Not affected: `jobberOAuthStart`, `helloJobber`,
`jobberSyncStaleCheck`. The future renewals import uses the helper from day
one.

**Rollout, without interrupting the 15-minute sync:**

1. Ship item 2 first (metric, policy, log line), so any regression in steps 3–5
   alerts within minutes.
2. Build and test in the emulator; no production writes.
3. **Migration, fully backward compatible:** deploy the new code reading
   from `jobberAuthSecrets/main`, **falling back** to the old doc if it
   doesn't exist, and writing refreshed tokens to **both** for one release.
   No manual copy step, no window where a function has no token.
4. **Deploy at night**, between 00:00 and 02:30 Toronto — the 15-minute
   sync runs 06:00–23:45 and job timing at 02:40, so nothing scheduled is
   running. Deploy all Jobber functions in one command so no old/new mix
   lasts more than the deploy itself; even if one does, old and new code
   write the same token fields, so a mixed state is no worse than today.
5. Watch the 02:40 job-timing run, then the 06:00 / 06:15 syncs: expect one
   refresh per hour, `lastRefreshedBy` set, no lock waits over a few
   seconds.
6. Next release (after a week clean): stop writing tokens to the old doc,
   strip them from it (targeted `FieldValue.delete()`), deploy the client
   change and the new rules.

**Rollback:** `git revert` and redeploy the same function list. Old code
reads the old doc, which step 3 kept current, so rollback needs no data
change. The extra fields and the lock doc are ignored by old code. For an
instant rollback of one function, route its Cloud Run service to the
previous revision in the console (a later `firebase deploy` overrides it).
After step 6, rollback means re-adding the tokens to the old doc, so don't
do step 6 until the new path has run clean for a week.

### 4. A separate "CrewMaster Dev" app for GraphiQL and testing

Why: GraphiQL in the Developer Center runs as the app you open it from,
against the Jobber account that app is connected to ("queries and mutations
run here will make changes in the connected Jobber account since it's a
live playground"). Opening it on the production CrewMaster app means using
the production app's authorization on our live account.

1. **Get a developer test account** (recommended): use Jobber's
   "developer testing" signup link from the Developer Center docs to create
   a separate Jobber account for testing. It's a 90-day trial by default,
   extendable through Jobber's API support email. Use a different email
   from the live account owner's (e.g. a `+dev` alias).
2. Sign in to the Developer Center → **Apps** → **NEW**.
3. Fill in:
   - **App name:** `CrewMaster Dev`
   - **Developer name / description:** "Internal testing only — not for
     production."
   - **OAuth Callback URL:** leave blank unless we build a dev callback. It
     must NOT be the production
     `https://us-central1-crewmaster-73f31.cloudfunctions.net/jobberOAuthCallback`,
     or a dev authorization could overwrite production tokens.
   - **Refresh Token Rotation:** leave ON (the default).
4. **Scopes — read only.** Schema checks need no data scope at all
   (introspection works for any scope). For realistic read tests, enable
   only the read scopes CrewMaster uses: read clients, read requests,
   read quotes, read jobs, read scheduled items (visits), read invoices,
   read time sheets, read users (and read Jobber Payments if offered, for
   the renewals payment checks). Enable no write scopes.
5. Save. Note the new client ID and secret; don't put them in Firebase
   secrets.
6. **Connect it to the test account**, not the live one. Then "Test in
   GraphiQL" from **CrewMaster Dev** only.
7. If you need live-data reads (e.g. counting real jobs), connect
   **CrewMaster Dev** to the live account — that's a separate app with its
   own authorization, so it can't replace production's. Still read scopes
   only.
8. Label production in the Developer Center (rename to
   "CrewMaster — PRODUCTION, do not use GraphiQL") so it's obvious which is
   which.
9. Optional: if the Developer Center lists several team members, limit
   production app access to whoever administers it.

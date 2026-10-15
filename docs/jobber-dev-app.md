# The Jobber production app — hands off

**Never edit, save, or use "Test in GraphiQL" on the production app in the
Jobber Developer Center.** Any change there requires an **immediate reconnect
in CrewMaster** (sign in as an admin → Manage Resources → Jobber → **Connect**,
finish on the "connected" page).

The production app is named **"CrewMaster — PRODUCTION (no GraphiQL)"**.

## Why

Both Jobber disconnections came from the Developer Center
(docs/incidents/2026-10-14-jobber-token.md):

- **2026-10-15 — confirmed.** Renaming the production app (~13:50 Toronto,
  name only) invalidated CrewMaster's refresh token; the next refresh, at
  14:00:44, was refused and every Jobber sync stopped until an admin
  reconnected.
- **2026-10-14 — most likely the same mechanism.** A "Test in GraphiQL"
  session on the production app at ~10:51 preceded the refused 11:00 refresh;
  syncs were down for about 3 hours.

GraphiQL also runs as the app you open it from, against the Jobber account that
app is connected to.

A separate "CrewMaster Dev" app was considered and **not set up** (decision
2026-10-15). If GraphiQL is ever needed, create that app first — read scopes
only, no callback URL pointing at production, connected to a Jobber developer
test account — rather than touching the production app.

## If production gets disconnected anyway

The "Jobber disconnected — reconnect in CrewMaster" alert emails within a few
minutes. Reconnect as above. Reconnecting from the Developer Center or Jobber's
Connected Apps does **not** give CrewMaster new tokens. If the outage crossed
midnight Toronto, run a manual Sync for the missed day.

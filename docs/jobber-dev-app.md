# Jobber GraphiQL — the rule

**Never use "Test in GraphiQL" on the production Jobber app.**

The production app was renamed **"CrewMaster — PRODUCTION (no GraphiQL)"** in
the Jobber Developer Center on 2026-10-15 so it's obvious.

**Why:** GraphiQL runs as the app you open it from, against the Jobber account
that app is connected to. On 2026-10-14 opening it on the production app most
likely re-authorized that app on our live account and replaced the
authorization CrewMaster's syncs depended on — every Jobber sync stopped for
about 3 hours (docs/incidents/2026-10-14-jobber-token.md, cause probable, not
confirmed).

A separate "CrewMaster Dev" app was considered and **not set up** (decision
2026-10-15). If GraphiQL is ever needed, create that app first — read scopes
only, no callback URL pointing at production, connected to a Jobber developer
test account — rather than using the production app.

## If production gets disconnected anyway

The "Jobber disconnected — reconnect in CrewMaster" alert emails within a few
minutes. Fix: sign in to CrewMaster as an admin → Manage Resources → Jobber →
**Connect**, and finish on the "connected" page. Reconnecting from the
Developer Center or Jobber's Connected Apps does **not** give CrewMaster new
tokens.

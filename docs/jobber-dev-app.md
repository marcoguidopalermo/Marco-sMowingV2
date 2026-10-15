# CrewMaster Dev — a separate Jobber app for GraphiQL and testing

**Why:** on 2026-10-14 opening GraphiQL on the *production* CrewMaster app in
the Jobber Developer Center most likely re-authorized that app on our live
account and replaced the authorization CrewMaster's syncs depended on — every
Jobber sync stopped for 3 hours (docs/incidents/2026-10-14-jobber-token.md).
GraphiQL runs as the app you open it from, against the account that app is
connected to. So: **never open GraphiQL on the production app.** Use this one.

## 1. Get a Jobber test account (recommended)

1. In the Jobber Developer Center docs, use the **developer testing sign-up
   link** to create a separate Jobber account for testing. It's a 90-day trial
   by default; Jobber's API support email can extend it.
2. Use an address that isn't the live account owner's, e.g. a `+dev` alias
   (`marco+jobberdev@marcosmowing.com`).
3. Add a few made-up clients, a recurring job and a visit, so read queries
   return something.

## 2. Create the app

1. Sign in to the **Jobber Developer Center** → **Apps** → **NEW**.
2. Fill in:
   - **App name:** `CrewMaster Dev`
   - **Developer name / description:** "Internal testing only — not for
     production."
   - **OAuth Callback URL:** leave blank for GraphiQL-only use. **Never** set
     it to the production callback
     `https://us-central1-crewmaster-73f31.cloudfunctions.net/jobberOAuthCallback`
     — a dev authorization could then overwrite CrewMaster's live tokens.
   - **Refresh Token Rotation:** leave **ON** (the default).
3. **Scopes — read only.**
   - Schema checks (introspection) need **no data scopes at all**.
   - For realistic read tests, tick only the **read** scopes CrewMaster itself
     uses: clients, requests, quotes, jobs, scheduled items (visits), invoices,
     time sheets, users — plus Jobber Payments (read) for the renewals payment
     checks. **Tick no write scopes.**
4. **Save.** Note the new client ID and secret. Don't add them to Firebase
   secrets — production keeps using the production app.

## 3. Connect it — to the test account

1. Sign in to Jobber **as the test account**.
2. Connect **CrewMaster Dev** to it, then use **Test in GraphiQL** from the
   **CrewMaster Dev** app page only.
3. If you ever need to read *live* data (e.g. counting real jobs), connect
   **CrewMaster Dev** to the live account instead. It's a separate app with its
   own authorization, so it can't replace production's. Still read scopes only.

## 4. Make production hard to click by mistake

1. Rename the production app in the Developer Center to
   **"CrewMaster — PRODUCTION (no GraphiQL)"**.
2. If several people have Developer Center access, limit the production app to
   whoever administers it.

## If production does get disconnected anyway

The "Jobber disconnected — reconnect in CrewMaster" alert emails within a few
minutes. Fix: sign in to CrewMaster as an admin → Manage Resources → Jobber →
**Connect**, and finish on the "connected" page. Reconnecting from the
Developer Center or Jobber's Connected Apps does **not** give CrewMaster new
tokens.

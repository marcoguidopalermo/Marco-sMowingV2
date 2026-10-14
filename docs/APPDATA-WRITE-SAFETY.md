# appData/main — write safety status

**Which fields are protected from stale whole-document writes, and which are not.**

Keep this current. A half-migrated model that nobody has written down is worse
than either end state, because the next person has to rediscover which fields
are safe by reading 96 call sites.

**Size is a different question and lives in its own file.** How big the
document is, why it grows, and the ranked levers if the storage warning ever
fires: [APPDATA-SIZE.md](./APPDATA-SIZE.md).

## The problem this tracks

`syncToCloud` writes the **entire** `appData/main` document with `setDoc`, built
from in-memory `appData`. There are ~96 call sites, ~80 of which spread
`...appData`. Every one writes all fields — including the ones it never touched.
So any client holding stale or default state overwrites everyone else's work,
last-writer-wins, across the whole document.

Four incidents in one week came from this single pattern:

| Date | What happened |
|---|---|
| 2026-08-16 | 28 subcollection-mirrored fields rewritten into the doc on every save (~74 KB of unread duplicates) |
| 2026-08-17 | `authorizedEmails` reverted by stale saves, intermittently locking users out |
| 2026-08-18 | **A client replaced the whole document with demo seed data** — 477 KB, 38 employees, a 36-address access list → seed roster + 1 address. Everyone locked out. Recovered via point-in-time recovery. |
| (ongoing) | `timeEntries`: four writers replacing the punch array wholesale — concurrent clock-ins silently overwriting each other |

## Interim net (covers everything at once)

- **`src/lib/docWriteGuard.ts`** — `checkDocWrite` runs inside `syncToCloud`, in
  front of every call site. Refuses a payload that discards >80% of the
  document, that carries the demo roster (`e1`–`e6`) into a populated database,
  or that empties / collapses the access list. Loud console error + toast; the
  write never leaves the browser. Deliberately biased toward allowing — it
  stops catastrophes, not subtle errors.
- **`src/lib/seedGuard.ts`** — `seedRefusalReason` gates the "no remote data
  found" branch that caused 2026-08-18. Seeding now requires a server-confirmed
  absence, a session that has never seen the document, no known access list, and
  the super admin.
- **`src/lib/authGate.ts`** — the sign-in gate never rejects on an unsettled
  snapshot, an empty list, or a missing credential email.

These are nets, not the fix. The fix is moving fields to targeted writes.

## Field status

`syncToCloud` substitutes a frozen doc-base ref for migrated fields, so a stale
client can no longer carry them.

### Protected

| Field | How | Notes |
|---|---|---|
| `performance` | derived + filtered on write | pushed months / archived days stripped |
| `schedules` | derived + filtered on write | archived months stripped |
| `multiDayJobs` | subcollection + doc-base ref | Phase 1 |
| `inspections` | subcollection + doc-base ref | Phase 3 |
| `activityLog` | subcollection + doc-base ref | Phase 4 |
| `deletionAuditLog` | subcollection + doc-base ref | Phase 5 |
| `timeEntries` | subcollection + doc-base ref | Phase 6 — creates/updates/deletes diffed; **pay** |
| `authorizedEmails` | server-tracking ref + targeted `updateDoc` | edits go through `saveAuthorizedEmails`, audited to `authorizedEmailAudit` |
| `employees` | server-tracking ref + targeted `updateDoc` | edits go through `saveEmployees` (`lib/rosterWrite`); refuses an empty roster or removing >half at once |
| `settings` | server-tracking ref + **per-key** targeted `updateDoc` | `saveSettings` → `saveKeyedMapField` (`lib/keyedMapWrite`) |
| `visitBHSplits` | server-tracking ref + **per-key** targeted `updateDoc` | `saveVisitBHSplits`; one visit per write. The nightly `syncPerformance` rebuild writes the whole map server-side from fresh data — it does not route through this module |
| `mechanicPayChunks` | server-tracking ref + **per-key** targeted `updateDoc` | `saveMechanicPayChunks`; one chunk per write |
| 28 marketing / contracting / RoleMaster / SalesMaster / rate-config fields | `SUBCOLLECTION_ONLY_FIELDS` — stripped from the doc payload entirely | read from their own subcollections |

### NOT yet protected

Ordered by consequence. Planned next in this order.

*(`employees`, `settings`, `visitBHSplits` and `mechanicPayChunks` moved to
Protected on 2026-08-18. **Every pay-critical field is now protected.** What
remains is the operational tier and the archive markers.)*

| Field | Risk | Why it matters |
|---|---|---|
| `tasks`, `partsOrders`, `repairLog`, `mechanicTasks`, `timeOffRequests`, `dailyAbsences`, `partialTimeOff`, `fleet` | operational | recoverable; worst case is a confusing afternoon |
| `pushedMonths`, `archivedDays`, `archivedScheduleMonths`, `unlockedDays` | markers | reverting one makes the archiver reprocess a month |
| `bulletins`, `bulletinReads`, `supplies`, `inventory`, `equipmentSubtypes`, `routes`, `overrides`, `rolePermissions`, `cvorExpiry` | negligible | small, rarely edited concurrently |

## The two recipes

1. **Subcollection + frozen doc-base** — for collections of records with ids.
   Overlay on read (`mergeX(docXRef.current, subXRef.current)`), diff on write,
   migrate with copy → read back → verify → clear; the doc-base then empties and
   the doc payload carries `[]`. See `scripts/migrate-timeentries.ts` for the
   pay-grade version: verification recomputes the real aggregate (hours per
   employee via `computeHoursWorkedBetween`), not a row count.
2. **Server-tracking ref + targeted `updateDoc`** — for a field whose order
   matters, or a map of independent keys. The doc payload takes the server's
   last-reported value, so incidental saves are no-ops; deliberate edits compute
   a delta against the baseline the editor started from and apply it to the
   server's current value, so two editors don't revert each other. Three
   variants exist: `saveAuthorizedEmails` (whole list), `saveEmployees`
   (per-record, `lib/rosterWrite`), and `saveKeyedMapField` (per-key,
   `lib/keyedMapWrite`) which serves `settings`, `visitBHSplits` and
   `mechanicPayChunks`.

   Per-key writes address each key with `FieldPath(field, key)`, not a dotted
   string. Two of these maps are keyed by ids that are **not valid unquoted path
   segments** — Jobber visit gids are base64 and end in `=`, chunk ids contain
   hyphens. `FieldPath` takes literal segments and parses nothing.

   **When you protect a field this way, sweep `src/components/` too.** A
   component still calling `syncToCloud({ ...appData, <field>: … })` becomes a
   silent no-op — it saves nothing and reports success. TimeMaster's pay-period
   inputs were exactly this. `syncToCloud` now `console.warn`s by name when a
   payload carries a protected field that differs from the server's, so the next
   one is found in seconds rather than by a bug report.

## Deliberately NOT done

- **`setDoc(..., { merge: true })`** would fix staleness in one edit, but Push
  Month and the day-archiver rely on replace semantics to REMOVE data (stripping
  pushed months and archived days). Under merge the document would silently stop
  shrinking and grow back toward the 1 MiB cap.
- **Rewriting all 96 call sites in one pass** — touches every write in the app at
  once, with no incremental verification, on the surfaces where a mistake costs
  pay.

## The rule of thumb: pay and bonus data belongs in a ROOT collection

**Anything that feeds PAY or BONUS should be created in a top-level collection
with its own Firestore rule, from the start.**

This has now been learned four separate times, always the same way — the data
was put where everything else lives, and the protection had to be retrofitted:

| Collection | Why it had to move |
|---|---|
| `hoursBank` | ledger of hours owed; needed genuine append-only |
| `authorizedEmailAudit` | log of who changed system access |
| `crewDayFlags` / `crewDayAudits` | a flag unapproves a day, so it gates bonus |
| `contractingMortgages` | lender and balance must not reach the property manager |
| `efficiencyAdjustments` | moves what counts toward efficiency and bonus |

### Why a rule underneath cannot fix it

```
match /artifacts/{document=**} {
  allow read, write: if isAuthorized() || isSuperAdmin();
}
```

Firestore rules are **OR-semantics**: if *any* matching rule allows the request,
it is allowed. A narrower rule on a path beneath `artifacts/**` cannot take away
what that rule grants — it can only add. So every authorized user can write
every document under it, and no amount of app-layer checking changes that. A
signed-in employee with the browser console open can write directly.

That is fine for operational data. It is not fine for anything somebody has a
financial reason to alter.

### The test to apply

> If a signed-in employee wrote this document by hand, could it change what
> anybody gets paid, or who can get in?

If yes, it goes at the root with a rule. Retrofitting means a migration, a
rules deploy, and a window where it was exposed — the four rows above each cost
all three.

### Still guarded only in the app layer

Known gaps, listed so they are known rather than discovered. None is
hypothetical: each is a real write that a crafted request could make today.

| What | Where it lives | What a crafted write could do |
|---|---|---|
| **`timeEntries`** | `artifacts/…/public/data/timeEntries` | invent or alter a punch — this IS payroll's source. It moved to a subcollection for concurrency, which did nothing for authorization. |
| **Trainee credit** (`Employee.training`) | `appData/main.employees` | grant a crew a standing efficiency percentage |
| **Crew-day approval** (`approvalStatus`) | `appData/main.performance` | approve their own crew-day, which is the bonus gate |
| **Crew-day numbers** (BH / AH / deductions) | `appData/main.performance` | edit the hours efficiency and bonus are computed from |

The last three sit on `appData/main`, so moving them is a larger job than
`efficiencyAdjustments` was — the field-level protections in this document
(server-tracking refs, targeted writes) stop a *stale client* from clobbering
them, but they do not stop a *deliberate* write. Different threat, different
mechanism; worth being clear which one is in place.

## Who is an admin or manager — `access/roles` (roles rollout, Oct 2026)

**`access/roles` is the single source of truth** for the two privileged
roles: `{ admins: [], managers: [] }`, lowercased sign-in addresses. It is a
root document **no client can write** (`firestore.rules`: `allow write: if
false`); authorized users can read it.

### Why it moved

`appData/main` is writable by every authorized user (the `artifacts/**`
rule), so anything on it — `employees[].systemRole`, `adminEmails`,
`authorizedEmails` — could be edited by any signed-in employee with a direct
Firestore call. The rules trusted `adminEmails` to decide who may write
bonus-feeding efficiency adjustments and read job timings, and the app
trusted `systemRole` to decide who is an admin.

### How a role changes

**Only through the `setUserRole` Cloud Function** (`functions/src/access.ts`,
logic in `accessRolesCore.ts`). It checks the caller is an admin in
`access/roles` (or the super admin) and, in one transaction, writes:

- `access/roles` (admins/managers),
- that employee's `systemRole` on the roster,
- `appData.adminEmails` (the old mirror, kept equal to `access/roles.admins`
  until step 4),
- an `accessRoleChanges` entry with who changed what, from and to.

It refuses to leave no admins and never demotes the super admin.
**A roster save can't change a role**: `saveEmployees` runs
`preserveServerRoles()` (`src/lib/accessRoles.ts`) so every existing
employee keeps the server's role, and new employees can't be created as
admin/manager. The role dropdown in Manage Resources calls `setUserRole`.

### How a role is read

- **App:** `effectiveRoleFromAccess()` — admin/manager only if listed in
  `access/roles`; a roster saying admin/manager for anyone else counts as
  worker. Other roles come from the roster.
- **Functions:** `effectiveRole()` in `accessRolesCore.ts`, applied once in
  `notifications.ts` `loadEmployees()`.
- **Rules:** `isContentAdmin()` — during the rollout, `access/roles.admins`
  **or** `appData.adminEmails` (dual-read); from step 4, `access/roles` only.

### The old `adminEmails` mirror (until step 5)

Clients **cannot change it at all**: the `artifacts/**` rule refuses an update
to `appData/main` that changes `adminEmails`, a create of `appData/main` that
carries it, and any client delete of `appData/main`. Ordinary saves that
carry it back unchanged still pass. `syncToCloud` carries the server's value
back verbatim (`serverAdminEmailsRef`); `saveEmployees` no longer writes it.
This is what stops an old, stale copy of the app from re-adding a demoted
admin.

### Drift

`accessDriftCheck` (daily 06:05 Toronto, or "Force run" in Cloud Scheduler)
compares `access/roles`, `adminEmails` and the roster's roles and logs
"Access roles in sync" or every disagreement ("Access roles drift").

### Do not

- Write `access/**` from a client, or add a client path that changes roles
  other than `setUserRole`.
- Read admin/manager from `employees[].systemRole` for anything that grants
  access.
- Introduce another list of admins. One source of truth.

### Rollout

1. Seed `access/roles` (done 2026-10-14). 2. Dual-read rules (done). 3. Switch
writers — this section. 4. Rules read `access/roles` only (pre-flight: every
current admin present, super admin present, non-empty). 5. After a clean
week: remove `adminEmails` and its guard; turn off Firestore write audit
logging.

## Not on the main document at all

Some surfaces were deliberately built outside `appData/main`, so they never
enter this problem in the first place:

| Collection | Why it is top-level |
|---|---|
| `hoursBank` | append-only ledger; rules forbid update and delete |
| `authorizedEmailAudit` | append-only; rules forbid update and delete |
| `crewDayFlags` | daily-audit flags. Rules forbid delete and make the *raised* half immutable — a resolution can add an answer, never rewrite the question |
| `crewDayAudits` | one marker per audited date; rules forbid delete, so a missed day stays visible |
| `contractingMortgages` | lender, balance, rate; read and write restricted to two addresses |
| `efficiencyAdjustments` | feeds efficiency and bonus; admin-only create/update via `isContentAdmin()` (`access/roles`), delete forbidden |

The `artifacts/**` rule grants full write to every authorized user and its
OR-semantics cannot be narrowed, which is why anything needing a real
append-only or no-delete guarantee lives at the root instead.

## Database-level protections

- Point-in-time recovery: **enabled**, 7-day window. This is what recovered
  2026-08-18.
- Delete protection: **enabled** (2026-08-18).

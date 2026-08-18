# appData/main — write safety status

**Which fields are protected from stale whole-document writes, and which are not.**

Keep this current. A half-migrated model that nobody has written down is worse
than either end state, because the next person has to rediscover which fields
are safe by reading 96 call sites.

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

## Not on the main document at all

Some surfaces were deliberately built outside `appData/main`, so they never
enter this problem in the first place:

| Collection | Why it is top-level |
|---|---|
| `hoursBank` | append-only ledger; rules forbid update and delete |
| `authorizedEmailAudit` | append-only; rules forbid update and delete |
| `crewDayFlags` | daily-audit flags. Rules forbid delete and make the *raised* half immutable — a resolution can add an answer, never rewrite the question |
| `crewDayAudits` | one marker per audited date; rules forbid delete, so a missed day stays visible |

The `artifacts/**` rule grants full write to every authorized user and its
OR-semantics cannot be narrowed, which is why anything needing a real
append-only or no-delete guarantee lives at the root instead.

## Database-level protections

- Point-in-time recovery: **enabled**, 7-day window. This is what recovered
  2026-08-18.
- Delete protection: **enabled** (2026-08-18).

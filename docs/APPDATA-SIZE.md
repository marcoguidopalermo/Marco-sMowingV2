# appData/main — size, growth, and the levers if it gets tight

**What the document is made of, why it grows, and — ranked — what to do if the
storage warning ever fires.**

Read this when `appStats/storage` goes amber (80% of the 1 MiB cap). The point
of writing it down now, while there is headroom, is that the decision gets made
calmly and once, instead of mid-season with the warning already up.

Companion to [APPDATA-WRITE-SAFETY.md](./APPDATA-WRITE-SAFETY.md), which covers
a different question: not how big the document is, but who can overwrite it.

## Where it stood, 2026-08-29

**548,397 B — 52.3% of the 1,048,576 B cap.**

| field | size | share |
|---|---|---|
| `performance` | 323.5 KB | 59% |
| `schedules` | 62.0 KB | 11% |
| `fleet` | 58.3 KB | 11% |
| `tasks` | 17.8 KB | 3% |
| `repairLog` | 12.8 KB | 2% |
| `partsOrders` | 12.1 KB | 2% |
| everything else | ~62 KB | 11% |

Inside `performance`: `jobs` 63%, `crewSizeAllowance` 14%, `employeeTimesheets`
13%. Inside `jobs`, two base64 Jobber gids — `jobberVisitId` and `jobberJobId` —
are **41% of the payload**, 81 KB, 15% of the whole document.

## It is BOUNDED, and that matters more than the number

The document does not grow with time. It grows with **daily volume**, and old
days fall off the back:

- `performance` holds a rolling window — `ARCHIVE_WINDOW_DAYS = 14` in
  `functions/src/jobber/archive.ts`. Settled days older than that move to their
  `performanceMonths/{YYYY-MM}` sheet.
- `schedules` holds the current month plus a few future days; past months live
  on `scheduleMonths` sheets.

So the ceiling is `~10 working days × jobs-per-day × ~400 B`:

```
 70 jobs/day  →  performance ~280 KB  →  document ~510 KB  (49%)
138 jobs/day  →  performance ~550 KB  →  document ~790 KB  (75%)
```

Bytes-per-job-row is stable at 340–470 B and has not drifted. A jump in the
document size is a jump in **work done**, not a leak — in late August it was the
rain-day backlog on the 25th clearing across the 26th–28th at 138/134/104 jobs
against a 40–82 baseline.

**Before reaching for a lever, check that first.** Compare bytes-per-job-row
across the window. If it is flat, nothing is wrong with the model and the
window will roll the heavy days off on its own.

---

# The levers, ranked

## 1. Archive settled days aggressively — ~250 KB, low risk, half a day

**The lever. Do this one first; it reclaims more than everything else combined.**

`performance` is 59% of the document only because the window keeps a fortnight
of settled days in it. Every one already has a home on its `performanceMonths`
sheet, and the client merges the open month's sheet back through
`ensureMonthLoaded` + `mergePerformance` (`App.tsx`). That overlay is live and
tested. The only days that MUST stay in the document are unsettled ones — today
plus anything pending — because that is what the sync writes.

- **Saves:** at 2–3 days instead of 14, `performance` falls to ~60–90 KB and the
  document to roughly **300 KB / 29%**.
- **Change:** `ARCHIVE_WINDOW_DAYS`, plus keeping the existing settled check.

### The staged rollout: 14 → 10 → 7

Do not jump straight to the floor. At each step, run for a few days and watch
the sync log before going further:

| step | watch for | if it appears |
|---|---|---|
| **14 → 10** | `jobber_bh_conflict_*` and `auto_credit_blocked_approved` counts rising | stop; late Jobber completions need the longer runway |
| **10 → 7** | the same, plus anyone reaching for `unlockDay` | stop at 10 |
| **below 7** | — | **don't.** See the floor below. |

### Why there is a floor at about 3 days

The window is the runway for **late Jobber completions**. Visits starting
2026-08-24 completed on the 25th and 26th; a visit completed an hour after its
crew-day was approved is the whole reason the conflict log exists. Freeze a day
before Jobber has finished reporting and you recreate the 2026-08-25 failure,
where 51 conflicts were logged against a day nobody could still credit.

Anything that ages off early is recoverable — `unlockDay` (`App.tsx`) lifts a
day back off its sheet, downgrades the month out of `pushedMonths`, and sets a
72-hour re-archive guard. Audited and reversible. But needing it routinely means
the window is too short.

## 2. Cap `crewSizeAllowance.segments` — ~30 KB, low risk, 2–3 hours

`segments` is **37.8 KB, 87% of the allowance field** — averaging 10.9 entries
per crew-day, peaking at 52. It is written, passed through, and **never read**:
not for a decision, not for display. `types.ts` calls it "the per-window
breakdown kept for audit".

- **Saves:** ~30 KB by capping to the largest few segments plus a count, or by
  rounding `durationMs` to minutes.
- **Cap it, never delete it.** It is the audit trail for a **pay input**, and
  the fortnight that produced this document was spent answering "why did this
  number change". Losing the ability to reconstruct an allowance would be a
  poor trade for 30 KB.

## 3. Drop `fleet.documents[].url` — ~15 KB, low risk, 2–3 hours

`fleet` is 57 KB, of which `documents` is 25.4 KB across 24 of 86 vehicles.
Each entry stores **both** `path` (~71 B) and `url` (~213 B), and the url is a
Firebase Storage download link derivable from the path.

- **Saves:** ~15 KB by storing `path` only and calling `getDownloadURL` on open.
- **Worth more than its size:** `fleet` is not volume-driven and **never rolls
  off**. Every other lever here trims a rolling window; this is the only one
  that removes weight that would otherwise sit in the document forever.
- **Costs:** one network call when a document is opened. No data loss.

## 4. Archive schedule DAYS, not months — ~40 KB, medium-low risk, half a day

`schedules` is 62 KB across 29 days and 181 crew entries, spread thin —
`jobberAssigneeIds` 9.1 KB, `fleet` 8.7, `employees` 7.6, `notes` 6.4,
`supplies` 5.6. No dominant sub-field, so there is nothing to trim inside it.

Rather than a subcollection, mirror `performance`: archive schedule *days* past
a window instead of whole months. `scheduleMonths` and the `mergeSchedules`
overlay already exist. This is lever 1 applied to schedules, reusing the same
machinery.

Floor: ~10 KB. Future days can never archive while they are still future.

## 5. `employeeTimesheets` to a subcollection — 42 KB. **DO NOT.**

This one looks attractive at 13% of `performance` and it should still be
refused.

`employeeTimesheets` is read by `accumulateEmployeeEff` — the
concurrency-weighted per-employee BH split, i.e. the function that decides how
much BH each person gets — and by `recalcAHAfterPunchDelete` and the crew-size
allowance. **All pay-affecting.**

Putting those behind an async overlay is precisely the failure mode that has
already cost twice:

- **2026-08-26** — the rolling archive reached the open month and every live
  monthly total dropped 49% (782.7 BH), because the MTD readers took
  `appData.performance` raw and nobody had taught them to merge the sheet.
- **2026-08-28** — scoping the `multiDayJobs` listener would have made
  `capacity.forwardSlices` stop skipping completed ledgers, over-counting 391 of
  1,416 forecast visits. Caught only by going looking for it.

42 KB is not worth putting a pay path behind a load that might not have
arrived. If the document is tight enough that this looks necessary, do levers
1–4 first; together they reclaim seven times as much.

## Deliberately NOT done: re-encoding the Jobber gids

`jobberVisitId` + `jobberJobId` are 81 KB, 15% of the document. Each is a
40-character base64 string decoding to `gid://Jobber/Visit/2172832706` — 40
bytes to carry a ten-digit number, twice per row.

Storing the numeric id would reclaim ~50 KB, and it is still not worth it: the
encoded gid is the **document id** in `multiDayJobs`, the key in every ledger
lookup, and the join key between crew-day rows, ledgers and the conflict log.
`jobberJobId` is not redundant beside `jobberJobNumber` either — carry-forward,
partial resolution and the audit log all read it.

A migration touching every id in the system, for 5% of a document that is not
in trouble, is the wrong trade.

## If you only read one line

Levers **1 + 2 + 3** take the document from 548 KB to roughly **250 KB (24%)**,
and none of them touches a pay path or a document id. Lever 1 alone is a
same-day fix that reclaims more than the rest combined, using code that is
already running in production.

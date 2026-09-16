// Toronto calendar-day arithmetic for the performance sync. No Firebase
// imports, so the day windows can be tested exactly as the sync uses them.
//
// Every crew-day window in the sync comes from torontoBoundariesIso: the
// Jobber visit fetch (via torontoWindow7DayBackIso), the Jobber timesheet
// fetch, and the TimeMaster punch attribution (creditPunchesToDay). The
// windows for consecutive days must TILE — each instant in exactly one day —
// or an hour of work is credited twice or not at all.
//
// They did not tile on DST changeover days. The offset was read at NOON and
// applied to MIDNIGHT, which are on different sides of the 2am change:
//   fall back  (Nov 1 2026)  day started at 01:00 EDT, not 00:00 — a clock-in
//                            between midnight and 1am landed in NO day
//   spring fwd (Mar 14 2027) day started at 23:00 EST on the 13th — a
//                            clock-in in that hour landed in BOTH days
// Each midnight is now computed with the offset in force at that midnight.

export const TIMEZONE = "America/Toronto";

/**
 * UTC offset in minutes for America/Toronto at an instant.
 * @param {Date} probe The instant.
 * @return {number} Offset in minutes (negative west of UTC).
 */
export function torontoOffsetMinutes(probe: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    timeZoneName: "shortOffset",
  });
  const parts = fmt.formatToParts(probe);
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value || "";
  const m = tzPart.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!m) return 0;
  const hours = parseInt(m[1], 10);
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  return hours * 60 + (hours < 0 ? -minutes : minutes);
}

/**
 * Toronto calendar date (YYYY-MM-DD) of an instant.
 * @param {Date} d The instant.
 * @return {string} The Toronto date.
 */
export function torontoYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * The UTC instant of Toronto midnight at the START of a calendar date,
 * using the offset in force AT that midnight. Toronto changes offset at
 * 02:00 local, never at midnight, so the offset one step either side of
 * the first guess settles it.
 * @param {string} dateStr YYYY-MM-DD.
 * @return {number} Epoch milliseconds.
 */
export function torontoMidnightMs(dateStr: string): number {
  const utcMidnight = Date.parse(`${dateStr}T00:00:00Z`);
  let ms = utcMidnight - torontoOffsetMinutes(new Date(utcMidnight)) * 60_000;
  const settled = torontoOffsetMinutes(new Date(ms));
  ms = utcMidnight - settled * 60_000;
  return ms;
}

/**
 * Returns YYYY-MM-DD (Toronto) shifted by `offsetDays` from `dateStr`.
 * @param {string} dateStr Anchor YYYY-MM-DD.
 * @param {number} offsetDays Negative or positive day delta.
 * @return {string} Shifted YYYY-MM-DD.
 */
export function shiftYmd(dateStr: string, offsetDays: number): string {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  probe.setUTCDate(probe.getUTCDate() + offsetDays);
  return torontoYmd(probe);
}

/**
 * UTC ISO bounds of a Toronto calendar day, [after, before). `before` is
 * the NEXT day's own midnight, so the day is 23 or 25 hours long on a
 * changeover and consecutive days tile with no gap and no overlap.
 * @param {string} dateStr A YYYY-MM-DD date string.
 * @return {object} Object with `after` and `before` ISO strings.
 */
export function torontoBoundariesIso(
  dateStr: string,
): {after: string; before: string} {
  return {
    after: new Date(torontoMidnightMs(dateStr)).toISOString(),
    before: new Date(torontoMidnightMs(shiftYmd(dateStr, 1))).toISOString(),
  };
}

/**
 * Returns a UTC window spanning [targetDate-7, targetDate+1] in Toronto.
 * Catches visits whose startAt was up to a week ago but completedAt is in
 * the current sync's attribution range (rain-day catch-up, late
 * completions). Trade-off: ~9× the page count vs a 1-day window — usually
 * still well under throttle limits for a single crew-day sync.
 * @param {string} targetDate Anchor YYYY-MM-DD.
 * @return {object} `after` (Toronto midnight of -7 day) and `before`
 *                  (Toronto midnight after next day), both UTC ISO.
 */
export function torontoWindow7DayBackIso(
  targetDate: string,
): {after: string; before: string} {
  const prev = torontoBoundariesIso(shiftYmd(targetDate, -7));
  const next = torontoBoundariesIso(shiftYmd(targetDate, 1));
  return {after: prev.after, before: next.before};
}

// TimeMaster clock record. Only the fields the sync needs to source
// hours for a non-Jobber crew member. userEmail keys to an employee's
// linkedUserEmail/email; clockOut is absent on an open (unclosed)
// shift, in which case duration runs to "now".
export interface TimeEntryDoc {
  userEmail: string;
  clockIn: string;
  clockOut?: string;
}

/**
 * Credit TimeMaster punches to ONE Toronto crew-day: every punch whose
 * clock-in falls in the day's window, with its full duration (a shift
 * past midnight belongs to the day it started). Open shifts run to
 * `nowMs` and keep endAt null. Below-noise punches are dropped from both
 * maps.
 * @param {TimeEntryDoc[]} punches Candidate punches (may be a wide query).
 * @param {string} targetDate The Toronto day being synced.
 * @param {number} nowMs "Now", for open shifts.
 * @param {number} minSeconds Noise floor.
 * @return {object} Seconds and intervals by lowercased email.
 */
export function creditPunchesToDay(
  punches: TimeEntryDoc[],
  targetDate: string,
  nowMs: number,
  minSeconds: number,
): {
  secondsByEmail: Map<string, number>;
  intervalsByEmail: Map<string, Array<{startAt: string; endAt: string | null}>>;
} {
  const {after, before} = torontoBoundariesIso(targetDate);
  const dayAfterMs = Date.parse(after);
  const dayBeforeMs = Date.parse(before);
  const secondsByEmail = new Map<string, number>();
  const intervalsByEmail = new Map<
    string,
    Array<{startAt: string; endAt: string | null}>
  >();
  for (const te of punches) {
    const email = (te.userEmail || "").toLowerCase();
    if (!email) continue;
    const inMs = Date.parse(te.clockIn);
    if (!Number.isFinite(inMs)) continue;
    if (inMs < dayAfterMs || inMs >= dayBeforeMs) continue;
    const outMs = te.clockOut ? Date.parse(te.clockOut) : nowMs;
    if (!Number.isFinite(outMs) || outMs <= inMs) continue;
    const sec = (outMs - inMs) / 1000;
    if (sec < minSeconds) continue;
    secondsByEmail.set(email, (secondsByEmail.get(email) || 0) + sec);
    const list = intervalsByEmail.get(email) || [];
    list.push({startAt: te.clockIn, endAt: te.clockOut ?? null});
    intervalsByEmail.set(email, list);
  }
  return {secondsByEmail, intervalsByEmail};
}

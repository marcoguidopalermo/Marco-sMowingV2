// FLEET DOCUMENT EXPIRY ALERTS — which dates on a unit should alert, and the
// marker that stops each alert repeating. Pure; tested in
// fleetExpiryCore.test.ts.
//
// Bug fixed 2026-10-19: the scan read `registrationExpiry`, but the fleet form
// saves `regExpiry` (and `commercialSafetyExpire`), so registration alerts
// never fired. Markers also had no date, so a renewed document's next expiry
// would never alert. Both fixed here.

export interface ExpiryDate {
  field: string;
  label: string;
  ymd: string;
}

export interface ExpiryAlert extends ExpiryDate {
  kind: "30d" | "exp";
  days: number;
  /** New marker — includes the date, so a renewal alerts again. */
  marker: string;
  /** Pre-2026-10-19 marker (no date). Honoured only for the same window. */
  legacyMarker: string;
}

// The fields the fleet form actually writes, plus the legacy names the scan
// used to read (kept so nothing that relied on them goes quiet).
const FIELDS: {field: string; label: string}[] = [
  {field: "regExpiry", label: "Registration"},
  {field: "registrationExpiry", label: "Registration"},
  {field: "insuranceExpiry", label: "Insurance"},
  {field: "safetyExpiry", label: "Safety"},
  {field: "commercialSafetyExpire", label: "Commercial safety"},
  {field: "plateExpiry", label: "Plate"},
  {field: "cvorExpiry", label: "CVOR"},
];

/**
 * Every expiry date carried on a unit (YYYY-MM-DD prefix).
 * @param {object} unit A fleet record.
 * @return {ExpiryDate[]} One entry per field holding a date; the same
 *   label + date from two fields is listed once.
 */
export function fleetExpiryDates(unit: Record<string, unknown>): ExpiryDate[] {
  const out: ExpiryDate[] = [];
  const seen = new Set<string>();
  for (const {field, label} of FIELDS) {
    const v = unit[field];
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) continue;
    const ymd = v.slice(0, 10);
    const key = `${label}|${ymd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({field, label, ymd});
  }
  return out;
}

/**
 * Alerts due for a unit today: 30 days before (1–30 days out) and at expiry.
 * @param {object} unit A fleet record (needs `id`).
 * @param {function} daysUntil Days from today to a YYYY-MM-DD date.
 * @return {ExpiryAlert[]} The alerts whose window is open.
 */
export function fleetExpiryAlertsDue(
  unit: Record<string, unknown>,
  daysUntil: (ymd: string) => number,
): ExpiryAlert[] {
  const id = String(unit.id || "");
  const out: ExpiryAlert[] = [];
  // Retired / sold / written off: no renewals to chase.
  const disposal = unit.disposal as {kind?: string} | undefined;
  if (disposal && disposal.kind) return out;
  for (const e of fleetExpiryDates(unit)) {
    const days = daysUntil(e.ymd);
    const kind = days <= 0 ? "exp" : days <= 30 ? "30d" : null;
    if (!kind) continue;
    out.push({
      ...e, kind, days,
      marker: `fleetdoc-${id}-${e.field}-${e.ymd}-${kind}`,
      legacyMarker: `fleetdoc-${id}-${e.field}-${kind}`,
    });
  }
  return out;
}

/**
 * Whether an old, date-less marker was recorded for THIS window (so the alert
 * already went out) rather than for a previous expiry that has since been
 * renewed. 30-day window: sent no earlier than 31 days before the date.
 * At-expiry: sent on or after the day before.
 * @param {ExpiryAlert} a The alert.
 * @param {number|null} legacyAtMs When the legacy marker was written.
 * @param {function} ymdToMs Local-midnight ms for a YYYY-MM-DD date.
 * @return {boolean} True when the legacy marker covers this alert.
 */
export function legacyMarkerCovers(
  a: ExpiryAlert, legacyAtMs: number | null, ymdToMs: (ymd: string) => number,
): boolean {
  if (legacyAtMs == null) return false;
  const day = 86_400_000;
  const dateMs = ymdToMs(a.ymd);
  return a.kind === "30d" ?
    legacyAtMs >= dateMs - 31 * day && legacyAtMs < dateMs :
    legacyAtMs >= dateMs - day;
}

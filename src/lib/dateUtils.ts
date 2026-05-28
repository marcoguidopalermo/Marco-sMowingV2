export const getStartOfWeek = (date: Date | string) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
};

export const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Returns YYYY-MM-DD for any Date instance, formatted in America/Toronto,
// regardless of the browser's local timezone. Uses formatToParts to avoid
// locale-specific separators or bidi marks that can appear in some
// browsers' `format()` output for the en-CA short date.
const formatYmdInToronto = (d: Date): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

// Returns YYYY-MM-DD for "today" in America/Toronto. Use this anywhere
// the user expects "today" to match Marco's Mowing's operational day
// (Thunder Bay / Toronto) rather than the device's local clock.
export const formatTodayInToronto = (): string => formatYmdInToronto(new Date());

// Returns YYYY-MM-DD for `dateString + offsetDays` in America/Toronto.
// Safe against UTC drift around midnight Eastern.
export const addDaysToronto = (dateString: string, offsetDays: number): string => {
  // Anchor the input at noon Toronto so DST transitions can't push us into
  // the wrong day.
  const probe = new Date(`${dateString}T12:00:00Z`);
  probe.setUTCDate(probe.getUTCDate() + offsetDays);
  return formatYmdInToronto(probe);
};

export const addDays = (date: Date, days: number) => { const result = new Date(date); result.setDate(result.getDate() + days); return result; };

// Formats a pair of "HH:MM" 24-hour times into a compact 12-hour range label:
//   ("13:00","15:00") → "1:00-3:00 PM"
//   ("11:00","13:00") → "11:00 AM-1:00 PM"
// Display-only — used for the partial time-off badge, never in hour math.
export const formatTimeRange = (start: string, end: string): string => {
  if (!start || !end) return '';
  const to12h = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    const mer = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return { label: `${h12}:${String(m || 0).padStart(2, '0')}`, mer };
  };
  const s = to12h(start);
  const e = to12h(end);
  return s.mer === e.mer
    ? `${s.label}-${e.label} ${e.mer}`
    : `${s.label} ${s.mer}-${e.label} ${e.mer}`;
};
export const isExpiringSoon = (dateStr: string | undefined) => {
  if (!dateStr) return false;
  const diffDays = Math.ceil((new Date(dateStr).getTime() - new Date().setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24));
  return diffDays <= 30 && diffDays >= 0;
};
export const isExpired = (dateStr: string | undefined) => {
  if (!dateStr) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return new Date(dateStr) < today;
};
export const isOdoStale = (dateStr: string | undefined) => !dateStr || Math.ceil((new Date().setHours(0, 0, 0, 0) - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)) >= 30;
export const needsAudit = (dateStr: string | undefined) => !dateStr || Math.ceil((new Date().setHours(0, 0, 0, 0) - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)) > 14;

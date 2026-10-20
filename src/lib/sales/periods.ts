// Date ranges for the scoreboard, as Toronto calendar dates (YYYY-MM-DD,
// inclusive). Calendar arithmetic only — no 24-hour steps.
export type PeriodKey = 'week' | 'month' | 'season' | 'year' | 'custom';
export const PERIOD_LABEL: Record<PeriodKey, string> = { week: 'This week', month: 'This month', season: 'Season', year: 'Year', custom: 'Custom' };
export interface Range { from: string; to: string }

const day = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; };
export const ymdOf = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
export const addDays = (ymd: string, n: number) => ymdOf(day(ymd) + n);
export const daysBetween = (a: string, b: string) => day(b) - day(a);
const weekday = (ymd: string) => new Date(day(ymd) * 86_400_000).getUTCDay(); // 0 Sun

/** Landscaping season: April 1 – November 30. */
export const LANDSCAPE_SEASON = { startMonth: 4, endMonth: 11 };

export function rangeFor(p: PeriodKey, today: string, custom?: Range): Range {
  const y = today.slice(0, 4);
  switch (p) {
    case 'week': { const back = (weekday(today) + 6) % 7; const from = addDays(today, -back); return { from, to: addDays(from, 6) }; } // Mon–Sun
    case 'month': { const from = `${today.slice(0, 7)}-01`; const [yy, mm] = from.split('-').map(Number); return { from, to: ymdOf(Date.UTC(yy, mm, 0) / 86_400_000) }; }
    case 'season': return { from: `${y}-04-01`, to: `${y}-11-30` };
    case 'year': return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'custom': return custom && custom.from && custom.to ? (custom.from <= custom.to ? custom : { from: custom.to, to: custom.from }) : { from: today, to: today };
  }
}
export const inRange = (ymd: string | null | undefined, r: Range) => !!ymd && ymd >= r.from && ymd <= r.to;

/** Toronto calendar date of an ISO instant. */
export function torontoYmd(iso: string | number | null | undefined): string | null {
  if (iso == null || iso === '') return null;
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

/** Monday-start weeks covering a range (at least `minWeeks`, ending with the range's last week). */
export function weeksOf(r: Range, minWeeks = 8): Range[] {
  const endMon = addDays(r.to, -((weekday(r.to) + 6) % 7));
  let startMon = addDays(r.from, -((weekday(r.from) + 6) % 7));
  const n = Math.max(minWeeks, Math.floor(daysBetween(startMon, endMon) / 7) + 1);
  startMon = addDays(endMon, -7 * (n - 1));
  return Array.from({ length: n }, (_, i) => { const from = addDays(startMon, 7 * i); return { from, to: addDays(from, 6) }; });
}

/** Snow seasons run Nov–Apr: "2026/2027" (the format snow contracts use). */
export function snowSeasonFor(today: string): string {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const start = m >= 7 ? y : y - 1;
  return `${start}/${start + 1}`;
}
export const snowSeasonLabel = (s: string) => { const [a, b] = s.split('/'); return `Snow ${a}–${String(b).slice(2)}`; };

// Bi-weekly Monday–Sunday pay periods, anchored + editable via settings.
// Range-selection + display only — no hours/pay math lives here.
//
// CALENDAR DAYS, NOT 24-HOUR STEPS (fixed 2026-10-20). Periods are counted in
// whole calendar days from the anchor (YYYY-MM-DD arithmetic), and only then
// turned into local-clock instants: start = 00:00 on the first day, end =
// 23:59:59.999 on the last. The old version added n × 24 h in local time, so
// across a DST change it slipped a day: from the Oct 26 2026 period it showed
// Oct 26 – Sat Nov 7 (pay Thu Nov 12), the next-period arrow got stuck, and
// Sun Mar 14 2027 fell into no period. payPeriods.test.ts covers both changes.
export interface PayPeriodSettings { anchorStart: string; lengthDays: number; payLagDays: number; }

// Anchor: the current period is Mon Jul 6 – Sun Jul 19, 2026; pay date = period
// end (Sunday) + 5 days = the following Friday.
export const DEFAULT_PAY_PERIOD: PayPeriodSettings = { anchorStart: '2026-07-06', lengthDays: 14, payLagDays: 5 };

/** Payroll submission is due the day after a period ends (the Monday). Holidays not modelled yet. */
export const SUBMISSION_LAG_DAYS = 1;

export function payPeriodSettings(settings?: { payPeriod?: PayPeriodSettings } | null): PayPeriodSettings {
  const p = settings?.payPeriod;
  if (!p || !p.anchorStart) return DEFAULT_PAY_PERIOD;
  return { anchorStart: p.anchorStart, lengthDays: Number(p.lengthDays) || 14, payLagDays: p.payLagDays == null ? 5 : Number(p.payLagDays) };
}

const pad = (n: number) => String(n).padStart(2, '0');
export function toYmd(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// Day numbers: whole calendar days since 1970-01-01 (UTC arithmetic on the
// Y-M-D only — no clock, so no DST).
const dayNum = (ymd: string): number => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000; };
const ymdOf = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);
// Local-clock instants for a calendar date.
const localStartMs = (ymd: string): number => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d, 0, 0, 0, 0).getTime(); };
const localEndMs = (ymd: string): number => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d, 23, 59, 59, 999).getTime(); };

export interface PayPeriod {
  start: string; end: string;        // YYYY-MM-DD (Mon .. Sun)
  startMs: number; endMs: number;    // 00:00 of start .. 23:59:59.999 of end, local clock
  payDate: string; payDateMs: number;
  submissionDate: string;            // day after end (the Monday payroll is due)
  index: number;                     // 0 = the anchor period; ±n steps of lengthDays
}

/** The period with a given index on the anchor's grid. */
export function periodAt(index: number, cfg: PayPeriodSettings): PayPeriod {
  const len = cfg.lengthDays || 14;
  const startN = dayNum(cfg.anchorStart) + index * len;
  const start = ymdOf(startN), end = ymdOf(startN + len - 1);
  const payDate = ymdOf(startN + len - 1 + (cfg.payLagDays ?? 5));
  return {
    start, end, startMs: localStartMs(start), endMs: localEndMs(end),
    payDate, payDateMs: localStartMs(payDate), submissionDate: ymdOf(startN + len - 1 + SUBMISSION_LAG_DAYS), index,
  };
}

/** The pay period containing a calendar date. */
export function periodOfYmd(s: string, cfg: PayPeriodSettings): PayPeriod {
  const len = cfg.lengthDays || 14;
  return periodAt(Math.floor((dayNum(s) - dayNum(cfg.anchorStart)) / len), cfg);
}
// The pay period that contains `dateMs` (its local calendar date).
export function periodForDate(dateMs: number, cfg: PayPeriodSettings): PayPeriod {
  return periodOfYmd(toYmd(new Date(dateMs)), cfg);
}
export function currentPayPeriod(cfg: PayPeriodSettings, nowMs: number): PayPeriod { return periodForDate(nowMs, cfg); }
// The period being paid now — the one BEFORE the current period ("Payroll period").
export function previousPayPeriod(cfg: PayPeriodSettings, nowMs: number): PayPeriod { return periodAt(currentPayPeriod(cfg, nowMs).index - 1, cfg); }
// Step from a given period by ±1 period (by index — can't stick on a DST week).
export function stepPeriod(period: PayPeriod, cfg: PayPeriodSettings, dir: 1 | -1): PayPeriod {
  return periodAt(periodOfYmd(period.start, cfg).index + dir, cfg);
}

const md = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export function periodRangeLabel(p: PayPeriod): string { return `${md(p.start)} – ${md(p.end)}`; }
export function payDateLabel(p: PayPeriod): string { return md(p.payDate); }

// ── Payroll dates (OfficeMaster) ────────────────────────────────────────────
/** The next submission and the next pay date on or after `today` (each from whichever period it belongs to). */
export function nextPayrollDates(cfg: PayPeriodSettings, today: string): { submission: PayPeriod; pay: PayPeriod } {
  const cur = periodOfYmd(today, cfg);
  const prev = periodAt(cur.index - 1, cfg);
  return { submission: prev.submissionDate >= today ? prev : cur, pay: prev.payDate >= today ? prev : cur };
}

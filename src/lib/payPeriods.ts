// Bi-weekly Monday–Sunday pay periods, anchored + editable via settings.
// Range-selection + display only — no hours/pay math lives here.
export interface PayPeriodSettings { anchorStart: string; lengthDays: number; payLagDays: number; }

// Anchor: the current period is Mon Jul 6 – Sun Jul 19, 2026; pay date = period
// end (Sunday) + 5 days = the following Friday.
export const DEFAULT_PAY_PERIOD: PayPeriodSettings = { anchorStart: '2026-07-06', lengthDays: 14, payLagDays: 5 };

export function payPeriodSettings(settings?: { payPeriod?: PayPeriodSettings } | null): PayPeriodSettings {
  const p = settings?.payPeriod;
  if (!p || !p.anchorStart) return DEFAULT_PAY_PERIOD;
  return { anchorStart: p.anchorStart, lengthDays: Number(p.lengthDays) || 14, payLagDays: p.payLagDays == null ? 5 : Number(p.payLagDays) };
}

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
function ymd(s: string): Date { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
export function toYmd(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function startOfDayMs(ms: number): number { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
function endOfDayMs(ms: number): number { const d = new Date(ms); d.setHours(23, 59, 59, 999); return d.getTime(); }

export interface PayPeriod {
  start: string; end: string;        // YYYY-MM-DD (Mon .. Sun)
  startMs: number; endMs: number;    // 00:00 of start .. 23:59 of end
  payDate: string; payDateMs: number;
  index: number;                     // 0 = the anchor period; ±n steps of lengthDays
}

// The pay period that contains `dateMs`, aligned to the anchor bi-weekly grid.
export function periodForDate(dateMs: number, cfg: PayPeriodSettings): PayPeriod {
  const anchor = startOfDayMs(ymd(cfg.anchorStart).getTime());
  const len = cfg.lengthDays;
  const daysSince = Math.floor((startOfDayMs(dateMs) - anchor) / DAY);
  const index = Math.floor(daysSince / len);
  const startD = new Date(anchor + index * len * DAY);
  const endD = new Date(startD.getTime() + (len - 1) * DAY);
  const payD = new Date(endD.getTime() + cfg.payLagDays * DAY);
  return { start: toYmd(startD), end: toYmd(endD), startMs: startD.getTime(), endMs: endOfDayMs(endD.getTime()), payDate: toYmd(payD), payDateMs: payD.getTime(), index };
}
export function currentPayPeriod(cfg: PayPeriodSettings, nowMs: number): PayPeriod { return periodForDate(nowMs, cfg); }
// The period being paid now — the one BEFORE the current period ("Payroll period").
export function previousPayPeriod(cfg: PayPeriodSettings, nowMs: number): PayPeriod { return periodForDate(currentPayPeriod(cfg, nowMs).startMs - DAY, cfg); }
// Step from a given period by ±1 period.
export function stepPeriod(period: PayPeriod, cfg: PayPeriodSettings, dir: 1 | -1): PayPeriod {
  return periodForDate(dir > 0 ? period.endMs + DAY : period.startMs - DAY, cfg);
}
export function periodOfYmd(s: string, cfg: PayPeriodSettings): PayPeriod { return periodForDate(ymd(s).getTime(), cfg); }

const md = (s: string) => ymd(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
export function periodRangeLabel(p: PayPeriod): string { return `${md(p.start)} – ${md(p.end)}`; }
export function payDateLabel(p: PayPeriod): string { return md(p.payDate); }

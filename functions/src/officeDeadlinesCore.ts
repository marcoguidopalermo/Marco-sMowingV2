/* eslint-disable max-len, require-jsdoc, valid-jsdoc, no-multi-spaces */
// OfficeMaster deadline reminders — pure. 30 and 7 days before each due date.
// Marker carries the due date, so a moved date alerts again. On entry, only
// the most urgent current threshold fires (no backlog).
export interface DeadlineLike {
  id: string; title: string; category?: string; dueDate?: string | null;
  status?: string; deletedAt?: number | null; kind?: string;
}
export interface DeadlineAlert { kind: "30d" | "7d" | "payroll"; marker: string; days: number; title: string; body: string }

const ymdDays = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86_400_000;
};

export function deadlineAlertsDue(item: DeadlineLike, todayYmd: string): DeadlineAlert[] {
  if (!item.dueDate || item.status !== "open" || item.deletedAt) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)) return [];
  const days = ymdDays(item.dueDate) - ymdDays(todayYmd);
  if (days < 0) return [];
  const kind = days <= 7 ? "7d" : days <= 30 ? "30d" : null;
  if (!kind) return [];
  const when = days === 0 ? "due today" : `due in ${days} day${days === 1 ? "" : "s"}`;
  return [{
    kind, days,
    marker: `office-${item.id}-${item.dueDate}-${kind}`,
    // No amounts, no document contents — just what and when.
    title: `${item.title} — ${when}`,
    body: item.kind === "notice" ? "Response due. Open Office for details." : "Open Office for details.",
  }];
}

// ── Payroll submission (same rule as src/lib/office/payroll.ts) ─────────────
// Bi-weekly periods anchored at anchorStart; submission due the day after a
// period ends (= the next period's first day, a Monday). Pure YMD arithmetic.
export interface PayPeriodCfg { anchorStart: string; lengthDays: number; payLagDays: number }
export const DEFAULT_PAY_PERIOD: PayPeriodCfg = {anchorStart: "2026-07-06", lengthDays: 14, payLagDays: 5};
const toYmd = (days: number) => new Date(days * 86_400_000).toISOString().slice(0, 10);

export function payrollSubmissionDue(cfg: PayPeriodCfg, todayYmd: string): {date: string; days: number; periodStart: string; periodEnd: string; payDate: string} {
  const len = cfg.lengthDays || 14;
  const anchor = ymdDays(cfg.anchorStart);
  const today = ymdDays(todayYmd);
  const curStart = anchor + Math.floor((today - anchor) / len) * len;
  // The previous period's submission is curStart itself; if that's today it's due today.
  const subDay = today === curStart ? curStart : curStart + len;
  const periodEnd = subDay - 1;
  return {date: toYmd(subDay), days: subDay - today, periodStart: toYmd(periodEnd - len + 1), periodEnd: toYmd(periodEnd), payDate: toYmd(periodEnd + (cfg.payLagDays ?? 5))};
}

const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nice = (ymd: string) => {
  const dt = new Date(ymd + "T12:00:00Z"); return `${WD[dt.getUTCDay()]}, ${MO[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
};

/** The morning before and the morning of the submission date. */
export function payrollAlertsDue(cfg: PayPeriodCfg, todayYmd: string): DeadlineAlert[] {
  const s = payrollSubmissionDue(cfg, todayYmd);
  if (s.days !== 0 && s.days !== 1) return [];
  return [{
    kind: "payroll", days: s.days,
    marker: `payroll-submit-${s.date}-${s.days === 0 ? "dayof" : "daybefore"}`,
    title: s.days === 0 ? `Payroll submission due today (${nice(s.date)})` : `Payroll submission due tomorrow (${nice(s.date)})`,
    body: `For ${s.periodStart} – ${s.periodEnd}. Pay date ${nice(s.payDate)}.`,
  }];
}

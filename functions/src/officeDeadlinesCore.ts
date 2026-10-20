/* eslint-disable max-len, require-jsdoc, valid-jsdoc, no-multi-spaces */
// OfficeMaster deadline reminders — pure. 30 and 7 days before each due date.
// Marker carries the due date, so a moved date alerts again. On entry, only
// the most urgent current threshold fires (no backlog).
export interface DeadlineLike {
  id: string; title: string; category?: string; dueDate?: string | null;
  status?: string; deletedAt?: number | null; kind?: string;
}
export interface DeadlineAlert { kind: "30d" | "7d"; marker: string; days: number; title: string; body: string }

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

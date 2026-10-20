/* eslint-disable max-len, require-jsdoc, valid-jsdoc */
// DIVISION ATTRIBUTION for invoiced sales — pure; used by the sales pull.
// Spec: Marco 2026-10-20 (division diagnosis). Fallback chain:
//   1. CrewMaster crew — the invoice's Jobber job matched to crew-day rows in
//      the performance data, weighted by the BH each crew was credited. Rows
//      on multi-crew visits already carry each crew's split share
//      (visitBHSplits / headcount), so the split is reused as-is.
//   2. Jobber visit assignee → the EXISTING capacity mapping (an explicit
//      settings.capacity.assigneeMap entry wins; otherwise the division the
//      assignee was rostered under on the most crew-days, ties → most recent).
//      Same as src/lib/capacity.assigneeDivisionIndex — a test checks.
//   3. Unattributed — kept and listed, never dropped.

interface CrewLike { division?: string; jobberAssigneeIds?: string[] }
interface PerfRow { jobberJobId?: string; bh?: number | string }
interface PerfLog { division?: string; jobs?: PerfRow[] }

export function assigneeDivisionIndex(
  schedules: Record<string, CrewLike[] | undefined>,
  assigneeMap: Record<string, {division?: string} | undefined> = {},
): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  const lastSeen = new Map<string, string>();
  for (const date of Object.keys(schedules || {}).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()) {
    for (const crew of schedules[date] || []) {
      if (!crew || !crew.division) continue;
      for (const aid of crew.jobberAssigneeIds || []) {
        const m = counts.get(aid) || new Map<string, number>();
        m.set(crew.division, (m.get(crew.division) || 0) + 1);
        counts.set(aid, m);
        lastSeen.set(aid, crew.division);
      }
    }
  }
  const out = new Map<string, string>();
  for (const [aid, m] of counts) {
    let best: string | null = null; let bestN = 0;
    for (const [div, n] of m) {
      if (n > bestN) {
        best = div; bestN = n;
      } else if (n === bestN && lastSeen.get(aid) === div) best = div;
    }
    if (best) out.set(aid, best);
  }
  for (const [aid, m] of Object.entries(assigneeMap || {})) if (m && m.division) out.set(aid, m.division);
  return out;
}

/** jobberJobId → division → credited BH (all crew-days on record). */
export function jobDivisionIndex(perf: Record<string, Record<string, PerfLog | undefined> | undefined>): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const day of Object.values(perf || {})) {
    for (const log of Object.values(day || {})) {
      if (!log || !log.division || !Array.isArray(log.jobs)) continue;
      for (const r of log.jobs) {
        if (!r || !r.jobberJobId) continue;
        const w = out.get(r.jobberJobId) || {};
        // A tiny floor so a zero-BH row (e.g. hourly) still counts as "this crew worked it".
        w[log.division] = (w[log.division] || 0) + Math.max(0, Number(r.bh) || 0) + 1e-6;
        out.set(r.jobberJobId, w);
      }
    }
  }
  return out;
}

/** Division BH by month ("YYYY-MM" → division → BH), from the performance data. */
export function bhByMonth(perf: Record<string, Record<string, PerfLog | undefined> | undefined>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [date, day] of Object.entries(perf || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const ym = date.slice(0, 7);
    for (const log of Object.values(day || {})) {
      if (!log || !log.division || !Array.isArray(log.jobs)) continue;
      const bh = log.jobs.reduce((s, r) => s + (Number(r && r.bh) || 0), 0);
      out[ym] = out[ym] || {};
      out[ym][log.division] = Math.round(((out[ym][log.division] || 0) + bh) * 10) / 10;
    }
  }
  return out;
}

export interface Attribution { m: 1 | 2 | 3; w: Record<string, number> } // weights sum to 1 (empty when m = 3)

export function attributeInvoice(
  jobIds: string[], visitAssignees: string[][],
  jobIdx: Map<string, Record<string, number>>, assigneeIdx: Map<string, string>,
): Attribution {
  const norm = (w: Record<string, number>) => {
    const t = Object.values(w).reduce((a, b) => a + b, 0);
    const o: Record<string, number> = {};
    for (const [k, v] of Object.entries(w)) o[k] = Math.round((v / t) * 10000) / 10000;
    return o;
  };
  const w1: Record<string, number> = {};
  for (const j of jobIds) {
    const w = jobIdx.get(j); if (w) for (const [d, x] of Object.entries(w)) w1[d] = (w1[d] || 0) + x;
  }
  if (Object.keys(w1).length) return {m: 1, w: norm(w1)};
  // Method 2: each visit's assignees → divisions; a visit split evenly across its divisions.
  const w2: Record<string, number> = {};
  for (const ids of visitAssignees) {
    const ds = [...new Set(ids.map((a) => assigneeIdx.get(a)).filter((d): d is string => !!d))];
    for (const d of ds) w2[d] = (w2[d] || 0) + 1 / ds.length;
  }
  if (Object.keys(w2).length) return {m: 2, w: norm(w2)};
  return {m: 3, w: {}};
}

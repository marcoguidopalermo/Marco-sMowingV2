// JOB TIMING — admin trends over the per-visit timing records the server
// writes to the root `jobTimings` collection (functions/src/jobber/jobTiming).
//
// Repricing data only. Nothing here touches pay, bonus or crew-day
// BH/AH/efficiency — it reads its own collection and nothing else reads it.

export type TimingQuality = 'full' | 'estimate';

export interface JobTimingPerson {
  userId: string; name: string; hours: number; start: string; end: string; onCrew: boolean;
}
export interface JobTimingDay {
  date: string; crewKeys: string[]; crewLabel: string; division: string;
  crewSize: number; headcount: number; labourHours: number; method: string;
  quality: TimingQuality; spanHours: number; people: JobTimingPerson[];
  crewSource: 'assignee' | 'timer' | 'none';
  multiCrew?: {
    assigned: number; timed: number; splitSource: 'sync' | 'headcount'; bhShare: number; offCrewHours: number;
    crews: Array<{ key: string; label: string; shareBh: number; timed: boolean; labourHours: number | null;
      method: string | null; quality: TimingQuality | null; crewSize: number }>;
  };
}
export interface JobTimingRecord {
  visitId: string; jobId: string | null; jobNumber: string | null; title: string;
  // bh = BH compared against labour (for a multi-crew visit, only the shares
  // of the crews that timed it); visitBh = the visit's whole BH.
  bh: number | null; visitBh?: number | null; multiCrew?: { assigned: number; timed: number } | null; hourly: boolean; recurring: boolean; lineItems: string[];
  propertyId: string; propertyLabel: string; clientId: string | null; clientName: string;
  lush: boolean; date: string; lastDate: string; month: string; dayList: string[];
  division: string; crewKey: string; crewLabel: string; crewSize: number; headcount: number;
  labourHours: number; method: string; quality: TimingQuality; efficiency: number | null;
  timedPeople: number; days: Record<string, JobTimingDay>; updatedAt: number;
  details?: { property?: { address?: { street?: string | null; city?: string | null } | null } | null };
}
export interface CoverageDoc {
  since: string; computedAt: number;
  byCrew: Record<string, { label: string; division: string; days: Record<string, [number, number]> }>;
}

// Fewer timed visits than this and a property's average is noise.
export const MIN_RELIABLE_VISITS = 3;

// ── Service type ─────────────────────────────────────────────────────────
// Read from the visit title + Jobber line items, first match wins. Kept on
// the client so the buckets can be tuned without re-syncing anything.
const SERVICE_RULES: Array<[string, RegExp]> = [
  ['Install / project', /\b(sod|mulch|install|rock|edging|seed(ing)?|patio|interlock|planting)\b/i],
  ['Cleanup', /clean\s*-?\s*up/i],
  ['Garden maintenance', /\b(garden|bed maint|weed|de-?weed)/i],
  ['Hedge / shrub', /\b(hedge|shrub|prun)/i],
  ['Mowing', /\b(mow|mowing|weekly|bi-?weekly|monthly cut|lawn maintenance)\b/i],
  ['Lawn care', /\b(bronze|silver|gold|dethatch|aerat|fertili|treat|lawn care)/i],
];
export const SERVICE_TYPES = [...SERVICE_RULES.map(([n]) => n), 'Other'];

export function serviceTypeOf(r: Pick<JobTimingRecord, 'title' | 'lineItems'>): string {
  const text = [r.title, ...(r.lineItems || [])].join(' | ');
  for (const [name, re] of SERVICE_RULES) if (re.test(text)) return name;
  return 'Other';
}

// ── Filtering ────────────────────────────────────────────────────────────
export interface TimingFilters {
  from: string; to: string;
  division: string;          // '' = all
  crewKey: string;           // '' = all
  serviceType: string;       // '' = all
  lush: 'all' | 'only' | 'exclude';
  includeNoCrew: boolean;    // visits with no crew on that day's schedule
}

export function filterRecords(recs: JobTimingRecord[], f: TimingFilters): JobTimingRecord[] {
  return recs.filter(r => {
    if (r.date < f.from || r.date > f.to) return false;
    if (!f.includeNoCrew && !r.crewKey) return false;
    if (f.division && r.division !== f.division) return false;
    if (f.crewKey && !r.crewKey.split('+').includes(f.crewKey)) return false;
    if (f.serviceType && serviceTypeOf(r) !== f.serviceType) return false;
    if (f.lush === 'only' && !r.lush) return false;
    if (f.lush === 'exclude' && r.lush) return false;
    return true;
  });
}

// ── Aggregation ──────────────────────────────────────────────────────────
// Rows are Jobber JOBS, not properties: a weekly mowing job and a one-off
// cleanup at the same address are different work and must not be averaged
// together. A property with several jobs shows them as separate rows.
//
// Efficiency = BH ÷ labour hours. The AVERAGE is summed (ΣBH ÷ Σlabour); the
// MEDIAN is the middle per-visit figure, which a timer left running or one
// started late can't drag around — so ranking uses the median by default.
const hasBh = (r: JobTimingRecord) => r.bh != null && r.bh > 0 && r.labourHours > 0;
const visitEff = (r: JobTimingRecord) => (r.bh as number) / r.labourHours;
const effOf = (rs: JobTimingRecord[]): number | null => {
  const b = rs.filter(hasBh);
  const lab = b.reduce((a, r) => a + r.labourHours, 0);
  return lab > 0 ? b.reduce((a, r) => a + (r.bh as number), 0) / lab : null;
};
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface DivisionStat { avg: number | null; median: number | null }
export function divisionStats(recs: JobTimingRecord[]): Record<string, DivisionStat> {
  const by: Record<string, JobTimingRecord[]> = {};
  for (const r of recs) (by[r.division || '—'] ||= []).push(r);
  const out: Record<string, DivisionStat> = {};
  for (const [d, rs] of Object.entries(by)) out[d] = { avg: effOf(rs), median: median(rs.filter(hasBh).map(visitEff)) };
  return out;
}

// Average and median disagreeing by more than this usually means a timing
// problem (a runaway or late-started timer), not a pricing one.
export const SKEW_FLAG = 0.25;

export interface JobRow {
  jobKey: string; jobId: string | null; jobNumber: string | null; jobTitle: string;
  propertyId: string; clientName: string; address: string; lush: boolean;
  division: string; crews: string[]; serviceType: string;
  visits: number; bhVisits: number; fullVisits: number; fullBhVisits: number;
  avgLabour: number; medianLabour: number;
  avgBh: number | null;
  efficiency: number | null;        // Σ BH ÷ Σ labour
  medianEfficiency: number | null;  // middle per-visit BH ÷ labour
  fullEfficiency: number | null;    // fully-timed BH visits only
  measuredShare: number;            // share of labour hours measured, not estimated
  divisionMedian: number | null;
  divisionAvg: number | null;
  vsDivision: number | null;        // median efficiency ÷ division median − 1
  vsDivisionAvg: number | null;     // average efficiency ÷ division average − 1
  multiCrewVisits: number;          // visits assigned to 2+ crews
  multiCrewNote: string;            // "2 of 3 crews timed"
  skewed: boolean;                  // average and median disagree a lot
  skewNote: string;
  reliable: boolean;
  trend: Array<{ date: string; eff: number; full: boolean }>;
  trendDelta: number | null;        // later-half median − earlier-half median
  records: JobTimingRecord[];
}

const mode = (xs: string[]) => {
  const c: Record<string, number> = {};
  for (const x of xs) c[x] = (c[x] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
};

// "Heather Boyer - Weekly [.8]" → "Weekly": the client name is already on
// the row, and the BH tag is in its own column.
export function jobTitleOf(title: string, clientName: string): string {
  let t = (title || '').replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();
  const dash = t.indexOf(' - ');
  if (dash > 0 && dash < 60) {
    const head = t.slice(0, dash).replace(/\*/g, '').trim().toLowerCase();
    const first = (clientName || '').trim().toLowerCase().split(/\s+/)[0];
    if (first && head.includes(first)) t = t.slice(dash + 3);
    else if (!clientName) t = t.slice(dash + 3);
  }
  return t.replace(/^\*+\s*/, '').trim() || title;
}

export const addressOf = (r: JobTimingRecord): string => {
  const a = r.details?.property?.address;
  const street = a?.street || r.propertyLabel.split(' — ').slice(1).join(' — ');
  return [street, a?.city].filter(Boolean).join(', ');
};

export function aggregateJobs(recs: JobTimingRecord[], div: Record<string, DivisionStat>): JobRow[] {
  const by = new Map<string, JobTimingRecord[]>();
  for (const r of recs) {
    const k = r.jobId || `visit:${r.visitId}`;
    const l = by.get(k) || [];
    l.push(r);
    by.set(k, l);
  }
  const rows: JobRow[] = [];
  for (const [jobKey, rs0] of by) {
    const rs = [...rs0].sort((a, b) => a.date.localeCompare(b.date));
    const last = rs[rs.length - 1];
    const bhRs = rs.filter(hasBh);
    const full = rs.filter(r => r.quality === 'full');
    const labour = rs.reduce((a, r) => a + r.labourHours, 0);
    const measured = full.reduce((a, r) => a + r.labourHours, 0);
    const division = mode(rs.map(r => r.division || '—'));
    const efficiency = effOf(rs);
    const medianEfficiency = median(bhRs.map(visitEff));
    const avgLabour = labour / rs.length;
    const medianLabour = median(rs.map(r => r.labourHours)) as number;
    const trend = bhRs.map(r => ({ date: r.date, eff: visitEff(r), full: r.quality === 'full' }));
    let trendDelta: number | null = null;
    if (bhRs.length >= 4) {
      const h = Math.floor(bhRs.length / 2);
      const a = median(bhRs.slice(0, h).map(visitEff));
      const b = median(bhRs.slice(bhRs.length - h).map(visitEff));
      if (a != null && b != null) trendDelta = b - a;
    }
    const ds = div[division] || { avg: null, median: null };
    const effGap = efficiency != null && medianEfficiency ? Math.abs(efficiency - medianEfficiency) / medianEfficiency : 0;
    const labGap = medianLabour > 0 ? Math.abs(avgLabour - medianLabour) / medianLabour : 0;
    const skewed = rs.length >= 3 && (effGap > SKEW_FLAG || labGap > SKEW_FLAG);
    const multi = rs.filter(r => r.multiCrew);
    const multiCrewNote = multi.length
      ? mode(multi.map(r => `${r.multiCrew!.timed} of ${r.multiCrew!.assigned} crews timed`))
        + (new Set(multi.map(r => `${r.multiCrew!.timed}/${r.multiCrew!.assigned}`)).size > 1 ? ' (usually)' : '')
      : '';
    rows.push({
      jobKey,
      multiCrewVisits: multi.length,
      multiCrewNote,
      jobId: last.jobId,
      jobNumber: last.jobNumber,
      jobTitle: jobTitleOf(last.title, last.clientName),
      propertyId: last.propertyId,
      clientName: last.clientName || last.propertyLabel,
      address: addressOf(last),
      lush: rs.some(r => r.lush),
      division,
      crews: [...new Set(rs.map(r => r.crewLabel).filter(Boolean))],
      serviceType: mode(rs.map(serviceTypeOf)),
      visits: rs.length,
      bhVisits: bhRs.length,
      fullVisits: full.length,
      fullBhVisits: bhRs.filter(r => r.quality === 'full').length,
      avgLabour,
      medianLabour,
      avgBh: bhRs.length ? bhRs.reduce((a, r) => a + (r.bh as number), 0) / bhRs.length : null,
      efficiency,
      medianEfficiency,
      fullEfficiency: effOf(full),
      measuredShare: labour > 0 ? measured / labour : 0,
      divisionMedian: ds.median,
      divisionAvg: ds.avg,
      vsDivision: medianEfficiency != null && ds.median ? medianEfficiency / ds.median - 1 : null,
      vsDivisionAvg: efficiency != null && ds.avg ? efficiency / ds.avg - 1 : null,
      skewed,
      skewNote: skewed
        ? `Average and median disagree (efficiency ${Math.round((efficiency ?? 0) * 100)}% vs ${Math.round((medianEfficiency ?? 0) * 100)}%, labour ${avgLabour.toFixed(2)}h vs ${medianLabour.toFixed(2)}h) — likely a mistimed visit, check the timers before repricing`
        : '',
      reliable: bhRs.length >= MIN_RELIABLE_VISITS,
      trend,
      trendDelta,
      records: rs,
    });
  }
  return rows;
}

// Most UNDER-budgeted first = slowest against BH = lowest vs-division.
export function rankJobs(rows: JobRow[], dir: 'under' | 'over', by: 'median' | 'average' = 'median'): JobRow[] {
  const sign = dir === 'under' ? 1 : -1;
  const v = (r: JobRow) => (by === 'median' ? r.vsDivision : r.vsDivisionAvg);
  return [...rows].sort((a, b) => {
    const va = v(a), vb = v(b);
    if (va == null && vb == null) return b.visits - a.visits;
    if (va == null) return 1;
    if (vb == null) return -1;
    return sign * (va - vb);
  });
}

// ── Date presets ─────────────────────────────────────────────────────────
// Default is the last 8 weeks: spring visits (first cuts, overgrown lawns)
// run long and would skew a whole-season figure.
export const DATE_PRESETS = [
  { id: '8w', label: 'Last 8 weeks' },
  { id: '4w', label: 'Last 4 weeks' },
  { id: '12w', label: 'Last 12 weeks' },
  { id: 'month', label: 'This month' },
  { id: 'summer', label: 'Since July 1' },
  { id: 'season', label: 'Whole season' },
] as const;
export type DatePreset = typeof DATE_PRESETS[number]['id'] | 'custom';

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export function presetRange(p: Exclude<DatePreset, 'custom'>, today: string): { from: string; to: string } {
  const y = today.slice(0, 4);
  switch (p) {
    case '4w': return { from: addDays(today, -27), to: today };
    case '8w': return { from: addDays(today, -55), to: today };
    case '12w': return { from: addDays(today, -83), to: today };
    case 'month': return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'summer': return { from: `${y}-07-01`, to: today };
    case 'season': return { from: `${y}-04-01`, to: today };
  }
}

// ── Coverage by crew ─────────────────────────────────────────────────────
export interface CoverageRow { crewKey: string; label: string; division: string; visits: number; timed: number; pct: number }

export function coverageRows(cov: CoverageDoc | null, f: Pick<TimingFilters, 'from' | 'to' | 'division' | 'crewKey'>): CoverageRow[] {
  if (!cov) return [];
  const out: CoverageRow[] = [];
  for (const [crewKey, c] of Object.entries(cov.byCrew || {})) {
    if (f.division && c.division !== f.division) continue;
    if (f.crewKey && crewKey !== f.crewKey) continue;
    let visits = 0, timed = 0;
    for (const [d, [v, t]] of Object.entries(c.days || {})) {
      if (d < f.from || d > f.to) continue;
      visits += v; timed += t;
    }
    if (visits === 0) continue;
    out.push({ crewKey, label: c.label, division: c.division, visits, timed, pct: timed / visits });
  }
  return out.sort((a, b) => a.division.localeCompare(b.division) || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

// ── CSV ──────────────────────────────────────────────────────────────────
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: unknown[][]) => rows.map(r => r.map(csvCell).join(',')).join('\n');
const pct = (v: number | null) => (v == null ? '' : (v * 100).toFixed(1));
const n2 = (v: number | null) => (v == null ? '' : v.toFixed(2));

export function jobsCsv(rows: JobRow[]): string {
  return toCsv([
    ['Client', 'Address', 'Job #', 'Job', 'Service type', 'Division', 'Crews', 'Lush', 'Timed visits', 'Visits with BH',
      'Fully timed visits', 'Median labour hrs', 'Avg labour hrs', 'Avg BH', 'Median efficiency %', 'Avg efficiency %',
      'Fully-timed efficiency %', 'Division median %', 'Vs division (median) %', 'Division avg %', 'Vs division (avg) %',
      'Measured share of hours %', 'Trend (pts)', 'Avg/median disagree', 'Multi-crew', 'Reliable'],
    ...rows.map(r => [
      r.clientName, r.address, r.jobNumber, r.jobTitle, r.serviceType, r.division, r.crews.join(' / '), r.lush ? 'yes' : '',
      r.visits, r.bhVisits, r.fullVisits, n2(r.medianLabour), n2(r.avgLabour), n2(r.avgBh), pct(r.medianEfficiency),
      pct(r.efficiency), pct(r.fullEfficiency), pct(r.divisionMedian), pct(r.vsDivision), pct(r.divisionAvg),
      pct(r.vsDivisionAvg), pct(r.measuredShare), r.trendDelta == null ? '' : (r.trendDelta * 100).toFixed(1),
      r.skewed ? 'yes' : '', r.multiCrewVisits ? `${r.multiCrewVisits} visits, ${r.multiCrewNote}` : '', r.reliable ? 'yes' : 'not yet',
    ]),
  ]);
}

export function visitsCsv(recs: JobTimingRecord[]): string {
  return toCsv([
    ['Date', 'Address', 'Client', 'Title', 'Job #', 'Service type', 'Division', 'Crew', 'Crew size', 'Headcount',
      'Method', 'Measured', 'Labour hrs', 'BH compared', 'Visit BH', 'Multi-crew', 'Efficiency %', 'Timed by', 'Lush'],
    ...[...recs].sort((a, b) => a.date.localeCompare(b.date)).map(r => [
      r.date, addressOf(r), r.clientName, r.title, r.jobNumber, serviceTypeOf(r), r.division, r.crewLabel,
      r.crewSize, r.headcount, r.method, r.quality === 'full' ? 'yes' : 'estimate', n2(r.labourHours), r.bh ?? '', r.visitBh ?? r.bh ?? '',
      r.multiCrew ? `${r.multiCrew.timed} of ${r.multiCrew.assigned} crews timed` : '',
      pct(r.efficiency), Object.values(r.days).flatMap(d => d.people.map(p => `${p.name} ${p.hours.toFixed(2)}h`)).join('; '),
      r.lush ? 'yes' : '',
    ]),
  ]);
}

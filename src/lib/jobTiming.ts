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
}
export interface JobTimingRecord {
  visitId: string; jobId: string | null; jobNumber: string | null; title: string;
  bh: number | null; hourly: boolean; recurring: boolean; lineItems: string[];
  propertyId: string; propertyLabel: string; clientId: string | null; clientName: string;
  lush: boolean; date: string; lastDate: string; month: string; dayList: string[];
  division: string; crewKey: string; crewLabel: string; crewSize: number; headcount: number;
  labourHours: number; method: string; quality: TimingQuality; efficiency: number | null;
  timedPeople: number; days: Record<string, JobTimingDay>; updatedAt: number;
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
// Efficiency = BH ÷ labour hours, over visits that carry a BH. Summed, not
// averaged per visit, so a 10-minute visit can't swing a property.
const hasBh = (r: JobTimingRecord) => r.bh != null && r.bh > 0 && r.labourHours > 0;
const effOf = (rs: JobTimingRecord[]): number | null => {
  const b = rs.filter(hasBh);
  const lab = b.reduce((a, r) => a + r.labourHours, 0);
  return lab > 0 ? b.reduce((a, r) => a + (r.bh as number), 0) / lab : null;
};

export function divisionAverages(recs: JobTimingRecord[]): Record<string, number | null> {
  const by: Record<string, JobTimingRecord[]> = {};
  for (const r of recs) (by[r.division || '—'] ||= []).push(r);
  const out: Record<string, number | null> = {};
  for (const [d, rs] of Object.entries(by)) out[d] = effOf(rs);
  return out;
}

export interface PropertyRow {
  propertyId: string; label: string; clientName: string; lush: boolean;
  division: string; crews: string[]; serviceTypes: string[];
  visits: number; bhVisits: number; fullVisits: number; fullBhVisits: number;
  avgLabour: number; avgBh: number | null;
  efficiency: number | null;        // all BH visits
  fullEfficiency: number | null;    // fully-timed BH visits only
  measuredShare: number;            // share of labour hours that were measured, not estimated
  divisionAvg: number | null;
  vsDivision: number | null;        // efficiency ÷ division avg − 1
  reliable: boolean;
  trend: Array<{ date: string; eff: number; full: boolean }>;
  trendDelta: number | null;        // later-half eff − earlier-half eff
  records: JobTimingRecord[];
}

const mode = (xs: string[]) => {
  const c: Record<string, number> = {};
  for (const x of xs) c[x] = (c[x] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
};

export function aggregateProperties(recs: JobTimingRecord[], divAvg: Record<string, number | null>): PropertyRow[] {
  const by = new Map<string, JobTimingRecord[]>();
  for (const r of recs) {
    const l = by.get(r.propertyId) || [];
    l.push(r);
    by.set(r.propertyId, l);
  }
  const rows: PropertyRow[] = [];
  for (const [propertyId, rs0] of by) {
    const rs = [...rs0].sort((a, b) => a.date.localeCompare(b.date));
    const bhRs = rs.filter(hasBh);
    const full = rs.filter(r => r.quality === 'full');
    const labour = rs.reduce((a, r) => a + r.labourHours, 0);
    const measured = full.reduce((a, r) => a + r.labourHours, 0);
    const division = mode(rs.map(r => r.division || '—'));
    const efficiency = effOf(rs);
    const trend = bhRs.map(r => ({ date: r.date, eff: (r.bh as number) / r.labourHours, full: r.quality === 'full' }));
    let trendDelta: number | null = null;
    if (bhRs.length >= 4) {
      const h = Math.floor(bhRs.length / 2);
      const a = effOf(bhRs.slice(0, h));
      const b = effOf(bhRs.slice(bhRs.length - h));
      if (a != null && b != null) trendDelta = b - a;
    }
    const da = divAvg[division] ?? null;
    rows.push({
      propertyId,
      label: rs[rs.length - 1].propertyLabel,
      clientName: rs[rs.length - 1].clientName,
      lush: rs.some(r => r.lush),
      division,
      crews: [...new Set(rs.map(r => r.crewLabel).filter(Boolean))],
      serviceTypes: [...new Set(rs.map(serviceTypeOf))],
      visits: rs.length,
      bhVisits: bhRs.length,
      fullVisits: full.length,
      fullBhVisits: bhRs.filter(r => r.quality === 'full').length,
      avgLabour: labour / rs.length,
      avgBh: bhRs.length ? bhRs.reduce((a, r) => a + (r.bh as number), 0) / bhRs.length : null,
      efficiency,
      fullEfficiency: effOf(full),
      measuredShare: labour > 0 ? measured / labour : 0,
      divisionAvg: da,
      vsDivision: efficiency != null && da ? efficiency / da - 1 : null,
      reliable: bhRs.length >= MIN_RELIABLE_VISITS,
      trend,
      trendDelta,
      records: rs,
    });
  }
  return rows;
}

// Most UNDER-budgeted first = slowest against BH = lowest vs-division.
export function rankProperties(rows: PropertyRow[], dir: 'under' | 'over'): PropertyRow[] {
  const sign = dir === 'under' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (a.vsDivision == null && b.vsDivision == null) return b.visits - a.visits;
    if (a.vsDivision == null) return 1;
    if (b.vsDivision == null) return -1;
    return sign * (a.vsDivision - b.vsDivision);
  });
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

export function propertiesCsv(rows: PropertyRow[]): string {
  return toCsv([
    ['Property', 'Client', 'Division', 'Crews', 'Service types', 'Lush', 'Timed visits', 'Visits with BH',
      'Fully timed visits', 'Avg labour hrs', 'Avg BH', 'Efficiency %', 'Fully-timed efficiency %',
      'Division avg %', 'Vs division %', 'Measured share of hours %', 'Trend (pts)', 'Reliable'],
    ...rows.map(r => [
      r.label, r.clientName, r.division, r.crews.join(' / '), r.serviceTypes.join(' / '), r.lush ? 'yes' : '',
      r.visits, r.bhVisits, r.fullVisits, n2(r.avgLabour), n2(r.avgBh), pct(r.efficiency), pct(r.fullEfficiency),
      pct(r.divisionAvg), pct(r.vsDivision), pct(r.measuredShare), r.trendDelta == null ? '' : (r.trendDelta * 100).toFixed(1),
      r.reliable ? 'yes' : 'not yet',
    ]),
  ]);
}

export function visitsCsv(recs: JobTimingRecord[]): string {
  return toCsv([
    ['Date', 'Property', 'Client', 'Title', 'Job #', 'Service type', 'Division', 'Crew', 'Crew size', 'Headcount',
      'Method', 'Measured', 'Labour hrs', 'BH', 'Efficiency %', 'Timed by', 'Lush'],
    ...[...recs].sort((a, b) => a.date.localeCompare(b.date)).map(r => [
      r.date, r.propertyLabel, r.clientName, r.title, r.jobNumber, serviceTypeOf(r), r.division, r.crewLabel,
      r.crewSize, r.headcount, r.method, r.quality === 'full' ? 'yes' : 'estimate', n2(r.labourHours), r.bh ?? '',
      pct(r.efficiency), Object.values(r.days).flatMap(d => d.people.map(p => `${p.name} ${p.hours.toFixed(2)}h`)).join('; '),
      r.lush ? 'yes' : '',
    ]),
  ]);
}

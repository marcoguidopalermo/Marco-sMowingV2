// YESTERDAY'S CREW-DAYS, in one place, for the daily audit.
//
// James audits daily rather than weekly because whether a worker was actually
// on a crew is only verifiable while it is fresh. A week later there is nothing
// left to check against. This assembles everything he needs to scan for the
// four things that go wrong:
//
//   • a worker who isn't on any crew        → `unassigned`, with `worked` set
//                                              when they have hours anyway
//   • a crew that looks short               → `headcount` per crew
//   • hours that don't match the work       → cBH / cAH side by side
//   • efficiency that's implausible         → raw and adjusted, with the
//                                              allowance that produced it
//
// READ-ONLY and derived. Nothing here writes, and nothing here recomputes pay:
// the crew-day numbers come from crewTotals and getCrewAllowance, the same
// functions the performance board and the bonus calculator read, so the audit
// can never show a number that disagrees with the one that pays somebody.
import {
  AppData, CrewDayAudit, CrewDayFlag, Employee, PerformanceLog, TimeEntry,
} from '../types';
import { crewTotals } from './efficiency';
import { adjustedEfficiency, getCrewAllowance } from './crewAllowance';
import { logHasRealWork } from './performanceMonths';
import { flagHistoryFor, openFlagFor } from './crewDayFlags';
import { employeeDivisionName, isPlaceableOnCrew } from './availabilityView';

export interface AuditPerson {
  id: string;
  name: string;
  /** AH credited to them on this crew-day. */
  ah: number;
  /** True when they earned AH here but were not on the scheduled roster. */
  dropIn: boolean;
}

export interface AuditCrewRow {
  crewId: string;
  crewLabel: string;
  division: string;
  crewNumber: number;
  isAdHoc: boolean;
  people: AuditPerson[];
  headcount: number;
  jobCount: number;
  jobTitles: string[];
  cBH: number;
  cAH: number;
  /** cBH / cAH as a percentage. null when there are no hours to divide by. */
  rawEfficiency: number | null;
  /** rawEfficiency plus the crew-size and trainee allowance actually applied. */
  adjustedEfficiency: number | null;
  allowancePct: number;
  approvalStatus: 'pending' | 'approved' | 'waived';
  openFlag?: CrewDayFlag;
  /** Every flag ever raised here, open or resolved — the permanent record. */
  flagCount: number;
}

export interface AuditUnassignedPerson {
  id: string;
  name: string;
  division: string | null;
  /** Hours clocked on this date, from their linked account's punches. */
  hoursWorked: number;
  /**
   * THE error this view exists to catch: they clocked hours but appear on no
   * crew and in no crew-day's AH. A week later this is unverifiable.
   */
  worked: boolean;
}

export interface DailyAudit {
  date: string;
  crews: AuditCrewRow[];
  unassigned: AuditUnassignedPerson[];
  workedButUnassignedCount: number;
  totals: {
    crewDays: number;
    cBH: number;
    cAH: number;
    flagged: number;
    approved: number;
    unapproved: number;
  };
  /** Set once somebody has signed the date off. */
  audited?: CrewDayAudit;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Hours a punch contributed on `date`, ignoring open punches (no clock-out). */
function hoursOnDate(entries: TimeEntry[], email: string, date: string): number {
  const target = email.trim().toLowerCase();
  if (!target) return 0;
  let ms = 0;
  for (const e of entries) {
    if (!e || String(e.userEmail || '').trim().toLowerCase() !== target) continue;
    if (!e.clockIn || !e.clockOut) continue;      // open punch — no closed span yet
    const inMs = new Date(e.clockIn).getTime();
    const outMs = new Date(e.clockOut).getTime();
    if (!Number.isFinite(inMs) || !Number.isFinite(outMs) || outMs <= inMs) continue;
    // Attribute by the clock-IN date, matching how the day's sheet reads.
    if (new Date(inMs).toISOString().slice(0, 10) !== date) continue;
    ms += outMs - inMs;
  }
  return round1(ms / 3_600_000);
}

export function buildDailyAudit(input: {
  appData: Pick<AppData,
    'employees' | 'schedules' | 'performance' | 'settings' | 'timeEntries'>;
  date: string;
  flags: CrewDayFlag[];
  audits: Record<string, CrewDayAudit>;
}): DailyAudit {
  const { appData, date } = input;
  const employees = appData.employees || [];
  const testUserIds = new Set(employees.filter(e => e.isTestUser).map(e => e.id));
  // Names resolve from EVERY employee record, not a narrowed roster — a crew
  // can carry a working division manager, and resolving them from the placeable
  // roster alone renders them "Unknown". (Same trap as the availability view.)
  const byId = new Map(employees.map(e => [e.id, e]));
  const dayCrews = (appData.schedules || {})[date] || [];
  const crewById = new Map(dayCrews.map(c => [c.id, c]));
  const dayLogs = (appData.performance || {})[date] || {};

  const crews: AuditCrewRow[] = [];
  const creditedIds = new Set<string>();      // anyone a crew-day accounts for

  for (const [crewId, log] of Object.entries(dayLogs)) {
    if (!log) continue;
    // Placeholder crew-days with nothing on them are noise in an audit list.
    // Same definition the month-finalize gate and the outstanding scan use, so
    // a day can never be auditable by one rule and invisible to another.
    if (!logHasRealWork(log)) continue;

    const crew = crewById.get(crewId);
    const rosterIds = new Set((crew?.employees || []));
    const removed = new Set(log.removedEmployees || []);
    const ahIds = Object.keys(log.employeeAH || {});
    const present = new Set<string>([...rosterIds, ...ahIds]);

    const people: AuditPerson[] = [];
    for (const id of present) {
      if (removed.has(id) || testUserIds.has(id)) continue;
      creditedIds.add(id);
      const emp = byId.get(id);
      people.push({
        id,
        name: emp?.name || 'Unknown',
        ah: round1(Number((log.employeeAH || {})[id] || 0)),
        dropIn: !rosterIds.has(id),
      });
    }
    people.sort((a, b) => a.name.localeCompare(b.name));

    const { cBH, cAH } = crewTotals(log, testUserIds);
    const allowance = getCrewAllowance(
      crew, log, appData.settings, testUserIds, { date, employees },
    );
    const rawEff = cAH > 0 ? round1((cBH / cAH) * 100) : null;

    const openFlag = openFlagFor(input.flags, date, crewId);
    crews.push({
      crewId,
      crewLabel: `${log.division || 'Unassigned'} #${log.crewNumber ?? 0}`,
      division: log.division || 'Unassigned',
      crewNumber: log.crewNumber ?? 0,
      isAdHoc: !!log.isAdHoc,
      people,
      headcount: people.length,
      jobCount: (log.jobs || []).length,
      jobTitles: (log.jobs || [])
        .map(j => String((j as { title?: unknown }).title || '').trim())
        .filter(Boolean),
      cBH: round1(cBH),
      cAH: round1(cAH),
      rawEfficiency: rawEff,
      adjustedEfficiency: adjustedEfficiency(rawEff, allowance.totalPct),
      allowancePct: allowance.totalPct,
      approvalStatus: (log.approvalStatus || 'pending') as PerformanceLog['approvalStatus'] & string,
      openFlag,
      flagCount: flagHistoryFor(input.flags, date, crewId).length,
    });
  }

  crews.sort((a, b) => a.division.localeCompare(b.division) || a.crewNumber - b.crewNumber);

  // ── WHO ISN'T ACCOUNTED FOR ────────────────────────────────────────────
  // The placeable roster (crew members and foremen — admins and managers are
  // not expected on a crew) minus anyone a crew-day already credits. Then the
  // sharp part: which of them clocked hours anyway.
  const entries = appData.timeEntries || [];
  const unassigned: AuditUnassignedPerson[] = [];
  for (const e of employees) {
    if (!isPlaceableOnCrew(e) || creditedIds.has(e.id)) continue;
    const hours = hoursOnDate(entries, e.linkedUserEmail || '', date);
    unassigned.push({
      id: e.id,
      name: e.name,
      division: employeeDivisionName(e),
      hoursWorked: hours,
      worked: hours > 0,
    });
  }
  // Anyone who actually worked comes first — that is the error, not a list.
  unassigned.sort((a, b) =>
    Number(b.worked) - Number(a.worked)
    || b.hoursWorked - a.hoursWorked
    || a.name.localeCompare(b.name));

  return {
    date,
    crews,
    unassigned,
    workedButUnassignedCount: unassigned.filter(u => u.worked).length,
    totals: {
      crewDays: crews.length,
      cBH: round1(crews.reduce((s, c) => s + c.cBH, 0)),
      cAH: round1(crews.reduce((s, c) => s + c.cAH, 0)),
      flagged: crews.filter(c => c.openFlag).length,
      approved: crews.filter(c => c.approvalStatus === 'approved').length,
      unapproved: crews.filter(c => c.approvalStatus !== 'approved').length,
    },
    audited: input.audits[date],
  };
}

// ── HISTORY ────────────────────────────────────────────────────────────────
// A run of recent weekdays with their audited state, so a MISSED day is visible
// rather than silently skipped. Weekends are excluded: the duty is weekday, and
// a Sunday with no audit is not a gap.
export interface AuditHistoryDay {
  date: string;
  audited: boolean;
  auditedByName?: string;
  auditedAt?: number;
  crewDayCount?: number;
  flaggedCount?: number;
  /** No crew-days with real work — nothing to audit, so not a gap either. */
  noWork: boolean;
  /** Past, unaudited, and there WAS work: the thing this history exists to show. */
  missed: boolean;
}

const isWeekend = (date: string): boolean => {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};

export function buildAuditHistory(input: {
  performance: Record<string, Record<string, PerformanceLog>>;
  audits: Record<string, CrewDayAudit>;
  today: string;
  days: number;
}): AuditHistoryDay[] {
  const out: AuditHistoryDay[] = [];
  const start = new Date(`${input.today}T12:00:00Z`);
  for (let i = 1; i <= input.days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    if (isWeekend(date)) continue;
    const logs = input.performance[date] || {};
    const noWork = !Object.values(logs).some(l => l && logHasRealWork(l));
    const a = input.audits[date];
    out.push({
      date,
      audited: !!a,
      auditedByName: a?.auditedBy?.name,
      auditedAt: a?.auditedAt,
      crewDayCount: a?.crewDayCount,
      flaggedCount: a?.flaggedCount,
      noWork,
      missed: !a && !noWork,
    });
  }
  return out;
}

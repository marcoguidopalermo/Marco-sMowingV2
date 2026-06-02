import {
  AppSettings,
  Crew,
  Employee,
  PerformanceLog,
} from '../types';
import { accumulateEmployeeEff, crewTotals, EmpEffStat, flattenEmployeeIntervals } from './efficiency';
import { getCrewAllowance } from './crewAllowance';

// Bonus-eligibility gate. Only crew-days explicitly signed off via
// the "Approve & Sign Off" button count toward bonus inputs. Pending
// AND legacy undefined logs are excluded: bonus starts 2026-06-01,
// pre-June data is test, and shop-odd-jobs days are intentionally
// left unapproved so they don't pollute efficiency. Strict equality
// is the contract — `!== 'approved'` covers both pending and
// undefined.
export function isBonusEligible(
  log: Pick<PerformanceLog, 'approvalStatus'> | undefined | null,
): boolean {
  return !!log && log.approvalStatus === 'approved';
}

export interface MtdEmployeeStat {
  empId: string;
  name: string;
  bh: number;
  ah: number;
}

export interface MtdResult {
  monthStart: string;       // YYYY-MM-DD, 1st of the calendar month
  // YYYY-MM-DD of the last completed day < today with performance
  // data in the current month. null when nothing has settled yet
  // this month (first of the month before any data lands).
  cutoff: string | null;
  monthLabel: string;       // "JUNE — through Fri Jun 13"
  monthName: string;        // "JUNE" — bare month name for compact UI
  companyBH: number;
  companyAH: number;
  // Adjusted via the per-crew snapshotted allowance (the virtual-BH
  // aggregation method). null when companyAH === 0.
  companyAdjustedEfficiency: number | null;
  // Per-employee MTD BH/AH shares, sorted by BH desc. Sum of `bh`
  // across this array equals `companyBH` (to floating-point — round
  // at display only).
  perEmployee: MtdEmployeeStat[];
}

// Toronto YYYY-MM-DD anchor → month start + bare month name.
// Defensive: malformed `today` returns a degenerate result so
// callers render zeros instead of crashing.
export function getMonthRange(today: string): {
  start: string;
  monthName: string;
} {
  const [yStr, mStr] = (today || '').split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return { start: today, monthName: '' };
  }
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  // Noon UTC avoids the "month name shifts on a TZ edge" trap; we
  // only care about the month name, not the day-of-month rendering.
  const monthName = new Date(`${start}T12:00:00Z`)
    .toLocaleDateString('en-US', { month: 'long' })
    .toUpperCase();
  return { start, monthName };
}

// Latest date with performance data that is (a) strictly before
// today and (b) inside the current calendar month. Returns null
// when no completed day has landed yet this month — the widgets
// surface that as "no completed days yet" instead of showing
// stale prior-month data under the current month's header.
//
// Bonus integrity: this is the cutoff that drives every monthly
// total. Today is deliberately excluded because project crews
// don't report until end of day and including a partial day
// distorts the totals the bonus pool reads.
export function getMtdCutoff(
  today: string,
  performance: Record<string, Record<string, PerformanceLog>>,
  monthStart: string,
): string | null {
  let latest: string | null = null;
  for (const [date, dayLogs] of Object.entries(performance || {})) {
    if (date >= today) continue;
    if (date < monthStart) continue;
    // A date counts toward the cutoff only when at least one crew
    // on it is bonus-eligible. Otherwise the header would advertise
    // a "through" date whose data we just excluded from every total.
    const hasApproved = Object.values(dayLogs || {})
      .some(l => isBonusEligible(l));
    if (!hasApproved) continue;
    if (latest === null || date > latest) latest = date;
  }
  return latest;
}

// Human-readable cutoff suffix, e.g. "Fri Jun 13". Strips the
// comma toLocaleDateString inserts so the headers stay compact.
function formatCutoffSuffix(cutoff: string): string {
  const d = new Date(`${cutoff}T12:00:00`);
  if (Number.isNaN(d.getTime())) return cutoff;
  return d
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    .replace(',', '');
}

// Calendar-month aggregation across appData.performance. Composes
// existing helpers (accumulateEmployeeEff, getCrewAllowance) and
// adds the cAH===0 / cBH>0 even-split fallback so the per-employee
// totals still sum to companyBH (the invariant the spec calls out).
//
// Cost: 20-ish weekdays × O(crews) per day, each touching small
// jobs / employeeAH maps. Sub-millisecond on any device; no
// Firestore reads — AppData is already in memory.
export function buildMtd(
  today: string,
  performance: Record<string, Record<string, PerformanceLog>>,
  schedules: Record<string, Crew[]>,
  employees: Employee[],
  settings?: AppSettings | null,
): MtdResult {
  const { start, monthName } = getMonthRange(today);
  const cutoff = getMtdCutoff(today, performance, start);
  const empById = new Map(employees.map(e => [e.id, e]));
  // Test-user sentinel(s) are ghosts to every performance number.
  // Derive once and forward to every helper so crew size, crew AH,
  // and the per-employee BH share all stay consistent.
  const testUserIds = new Set(
    employees.filter(e => e.isTestUser).map(e => e.id),
  );
  const empStats: Record<string, EmpEffStat> = {};
  let companyBH = 0;
  let companyAH = 0;
  let companyAdjustedNumerator = 0;

  // No completed day yet this month → all totals stay at 0 and
  // perEmployee stays empty. The widgets render "no completed
  // days yet" rather than fabricating numbers.
  if (cutoff !== null) {
    for (const [date, dayLogs] of Object.entries(performance || {})) {
      if (date < start || date > cutoff) continue;
      const daySchedule = schedules[date] || [];
      for (const [crewId, log] of Object.entries(dayLogs || {})) {
        // Bonus gate: skip unapproved crew-days entirely. AH and BH
        // drop together by construction — cBH never accumulates,
        // employees on this log get no eAH/eBH, allowance from this
        // log doesn't apply. Pending + legacy undefined both drop.
        if (!isBonusEligible(log)) continue;
        const { cBH, cAH } = crewTotals(log, testUserIds);

        const crewObj = daySchedule.find(c => c.id === crewId);
        const allowance = getCrewAllowance(
          crewObj, log, settings || null, testUserIds,
        );

        companyBH += cBH;
        companyAH += cAH;
        // Virtual-BH method: per-crew adjusted eff = (cBH + cAH×pct/100) / cAH.
        // Summing the numerators and dividing by ΣcAH yields the AH-weighted
        // average of crew adjusted efficiencies — the mathematically correct
        // company-level adjusted number when each crew has its own snapshot.
        companyAdjustedNumerator += cBH + (cAH * allowance.pct) / 100;

        // Per-employee BH share — proportional to each member's eAH.
        // Drop-in helpers (employeeAH keys outside crew.employees) get a
        // proportional slice via the same identity (Σ eBH = cBH when cAH > 0).
        // Test users are gated inside accumulateEmployeeEff via testUserIds.
        if (cAH > 0) {
          accumulateEmployeeEff(log, empStats, testUserIds);
          continue;
        }

        // Edge case: BH credited but no AH yet. The default helper
        // would lose `cBH` from the per-employee sum and break the
        // invariant. Even-split across the scheduled roster
        // (crew.employees − removedEmployees − testUsers) so each
        // real member carries `cBH / size` and the totals still match.
        //
        // Solo-time hardening: when timesheet intervals exist for
        // this crew-day, narrow the even-split roster to workers
        // who actually had a clocked interval. This stops the
        // partial-departure case from over-attributing solo-window
        // BH to workers who'd already left — they had no interval
        // covering "now," so they get no share. Falls back to the
        // unfiltered roster when no intervals exist (today's
        // behavior preserved for legacy + manual-entry days).
        if (cBH > 0) {
          const removed = new Set(log.removedEmployees || []);
          let roster = (crewObj?.employees || []).filter(
            id => !removed.has(id) && !testUserIds.has(id),
          );
          if (log.employeeTimesheets) {
            const intervalIds = new Set(
              flattenEmployeeIntervals(
                log.employeeTimesheets, log.removedEmployees, testUserIds,
              ).map(i => i.empId),
            );
            const narrowed = roster.filter(id => intervalIds.has(id));
            // Only adopt the narrowed roster when at least one
            // member has intervals — otherwise fall back to the
            // unfiltered list so we don't lose the share entirely
            // when timesheets are present but mismatched.
            if (narrowed.length > 0) roster = narrowed;
          }
          if (roster.length === 0) {
            // Pathological — no real roster, no AH, but cBH credited.
            // Falling through here intentionally drops the share so
            // the company-sum invariant breaks loudly rather than
            // silently mis-attributing. In practice this never fires.
            continue;
          }
          const shareBH = cBH / roster.length;
          for (const empId of roster) {
            if (!empStats[empId]) empStats[empId] = { bh: 0, ah: 0 };
            empStats[empId].bh += shareBH;
          }
        }
      }
    }
  }

  const companyAdjustedEfficiency = companyAH > 0
    ? Number(((companyAdjustedNumerator / companyAH) * 100).toFixed(1))
    : null;

  const perEmployee: MtdEmployeeStat[] = Object.entries(empStats)
    .map(([empId, stat]) => ({
      empId,
      name: empById.get(empId)?.name || empId,
      bh: Number(stat.bh.toFixed(1)),
      ah: Number(stat.ah.toFixed(1)),
    }))
    .sort((a, b) => b.bh - a.bh);

  const monthLabel = cutoff
    ? `${monthName} — through ${formatCutoffSuffix(cutoff)}`
    : `${monthName} — no completed days yet`;

  return {
    monthStart: start,
    cutoff,
    monthLabel,
    monthName,
    companyBH: Number(companyBH.toFixed(1)),
    companyAH: Number(companyAH.toFixed(1)),
    companyAdjustedEfficiency,
    perEmployee,
  };
}

// Convenience: per-employee MTD BH for the logged-in user.
// Returns 0 when there's no signed-in Employee record or no MTD
// contribution this month.
export function selfMtdBH(
  result: MtdResult,
  currentEmpId: string | null | undefined,
): number {
  if (!currentEmpId) return 0;
  const row = result.perEmployee.find(e => e.empId === currentEmpId);
  return row?.bh ?? 0;
}

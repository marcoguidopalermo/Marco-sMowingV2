// Crew performance gamification — DISPLAY ONLY. A morale layer over the
// EXISTING approved crew-day numbers. It reads the single-source day math
// (crewTotals: cBH/cAH) and the approval gate (isBonusEligible). It never
// computes a parallel efficiency, never writes, never touches pay/bonus.
import { PerformanceLog } from '../types';
import { crewTotals } from './efficiency';
import { isBonusEligible } from './mtd';

export const FLAME_MIN_RATIO = 1.0;   // 🔥 ≥100% day efficiency
export const STREAK_MEETS_RATIO = 0.8; // 🔆 "meets" bar
export const STREAK_MIN_BH = 5;        // qualifying "real working day" floor

// Stable cross-day crew identity. Crew.id is regenerated per day, so a streak
// that must follow the SAME crew across dates keys on division + crewNumber
// (the same crewKey the rest of the app uses, e.g. MyCrewToday's myCrewKey and
// CompletionEntry.crewKey). LIMITATION: this groups by crew SLOT, not roster —
// if a division reuses a crew number for a different team, they share a streak.
export function crewKeyOf(log: Pick<PerformanceLog, 'division' | 'crewNumber'>): string {
  return `${(log.division || 'Unassigned').toLowerCase()}-${log.crewNumber ?? 0}`;
}

// Raw day efficiency ratio (cBH ÷ net cAH) from the single source of truth.
// null when cAH<=0 (no measurable actual hours → no ratio).
export function crewDayEffRatio(
  log: PerformanceLog,
  testUserIds?: Set<string> | null,
): number | null {
  const { cBH, cAH } = crewTotals(log, testUserIds || null);
  if (!(cAH > 0)) return null;
  return cBH / cAH;
}

// 🔥 flame — APPROVED crew-day whose raw day efficiency ≥ 100%.
export function crewDayHasFlame(
  log: PerformanceLog | undefined | null,
  testUserIds?: Set<string> | null,
): boolean {
  if (!isBonusEligible(log)) return false;   // approved-only — a pending day can't flame
  const r = crewDayEffRatio(log as PerformanceLog, testUserIds);
  return r != null && r >= FLAME_MIN_RATIO;
}

// Per-day classification for the streak walk.
//  qualifies = approved AND cBH ≥ 5 AND measurable (cAH>0) — a "real working day"
//  meets     = qualifies AND ratio ≥ 0.8
// Non-qualifying days (under 5 BH, pending/unapproved, waived/empty, no log at
// all) are SKIPPED — they neither extend nor break.
function classifyDay(log: PerformanceLog, testUserIds?: Set<string> | null): { qualifies: boolean; meets: boolean } {
  if (!isBonusEligible(log)) return { qualifies: false, meets: false };
  const { cBH, cAH } = crewTotals(log, testUserIds || null);
  if (cBH < STREAK_MIN_BH || !(cAH > 0)) return { qualifies: false, meets: false };
  return { qualifies: true, meets: (cBH / cAH) >= STREAK_MEETS_RATIO };
}

// Monthly consistency streaks for every crew, computed in ONE pass over the
// CURRENT MONTH's loaded performance (no archived-month reads). Returns
// { crewKey → streak } where streak = consecutive qualifying days (≥5 BH,
// approved) with eff ≥ 80%, counting back from the most recent qualifying day,
// skipping non-qualifying days, stopping at the first qualifying day < 80%.
// Resets naturally on the 1st (only current-month dates are scanned).
// `today` is 'YYYY-MM-DD' (Toronto). Future dates are ignored.
export function computeMonthlyStreaks(
  performance: Record<string, Record<string, PerformanceLog>> | undefined,
  today: string,
  testUserIds?: Set<string> | null,
): Record<string, number> {
  const month = today.slice(0, 7); // 'YYYY-MM'
  // One entry per (crewKey, date) — last write wins if a slot somehow repeats.
  const byCrew: Record<string, Map<string, { qualifies: boolean; meets: boolean }>> = {};
  for (const [date, dayLogs] of Object.entries(performance || {})) {
    if (date.slice(0, 7) !== month) continue; // current month only
    if (date > today) continue;               // never count the future
    for (const log of Object.values(dayLogs || {})) {
      if (!log) continue;
      const key = crewKeyOf(log);
      (byCrew[key] = byCrew[key] || new Map()).set(date, classifyDay(log, testUserIds));
    }
  }
  const out: Record<string, number> = {};
  for (const [key, dayMap] of Object.entries(byCrew)) {
    const days = [...dayMap.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)); // date DESC
    let streak = 0;
    for (const [, cls] of days) {
      if (!cls.qualifies) continue; // skip — pass-through
      if (cls.meets) streak++;      // extend
      else break;                   // qualifying but < 80% → run ends
    }
    out[key] = streak;
  }
  return out;
}

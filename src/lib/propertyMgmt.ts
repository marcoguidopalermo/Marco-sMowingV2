// Property management (v2): countdown / notice / occupancy logic. Reference
// layer only — no payment/ledger math. Dates are 'YYYY-MM-DD' (local).
import { ContractingProperty, ContractingUnit, ContractingTenancy, ContractingDeposit, ContractingTenant } from '../types';

export const NOTICE_DAYS_DEFAULT = 75;
export function noticeDaysOrDefault(settings?: { contractingNoticeDays?: number } | null): number {
  const n = settings?.contractingNoticeDays;
  return (typeof n === 'number' && n > 0) ? n : NOTICE_DAYS_DEFAULT;
}

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
export function ymdToMs(s: string): number { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1).getTime(); }
export function msToYmd(ms: number): string { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function addDaysYmd(s: string, days: number): string { return msToYmd(ymdToMs(s) + days * DAY); }
export function fmtYmd(s?: string): string { return s ? new Date(ymdToMs(s)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }

export function tenancyMonthlyTotal(t: ContractingTenancy): number {
  return (t.tenants || []).reduce((s, x) => s + (Number(x.rentAmount) || 0), 0);
}

// The ★ MAIN CONTACT for a tenancy: the explicitly-starred tenant, else (single
// tenant, or none marked) the first — so there's always an effective contact.
export function starredTenant(t?: ContractingTenancy | null): ContractingTenant | undefined {
  const list = t?.tenants || [];
  return list.find(x => x.main) || list[0] || undefined;
}
// Tenants ordered with the starred one first (for display).
export function tenantsStarredFirst(t?: ContractingTenancy | null): ContractingTenant[] {
  const list = [...(t?.tenants || [])];
  const star = starredTenant(t);
  if (!star) return list;
  return [star, ...list.filter(x => x !== star)];
}
export function unitIsVacant(u: ContractingUnit): boolean { return !u.tenancy; }

// The ACTUAL move-out date (read-migrates the legacy computedEnd).
export function tenancyMoveOut(t: ContractingTenancy): string | undefined { return t.moveOutAt || t.computedEnd; }
// The structured deposit (read-migrates legacy free-text depositNote → note).
export function tenancyDeposit(t: ContractingTenancy): ContractingDeposit { return t.deposit || (t.depositNote ? { note: t.depositNote } : {}); }
// Soft validation hint — the move-out is less than `noticeDays` days away.
export function moveOutIsShortNotice(moveOutYmd: string, noticeDays: number, nowMs: number): boolean {
  return daysUntilExport(moveOutYmd, nowMs) < noticeDays;
}
export function daysUntilExport(endYmd: string, nowMs: number): number { return daysUntil(endYmd, nowMs); }

export type CountdownKind = 'fixed' | 'moveout' | 'open';
export type CountdownLevel = 'neutral' | 'amber' | 'red';
export interface Countdown { kind: CountdownKind; endYmd?: string; endMs: number; daysLeft?: number; level: CountdownLevel; label: string; }

// Whole days from today (start-of-day) to the end date.
function daysUntil(endYmd: string, nowMs: number): number {
  const startToday = new Date(nowMs); startToday.setHours(0, 0, 0, 0);
  return Math.round((ymdToMs(endYmd) - startToday.getTime()) / DAY);
}
const level60 = (d: number): CountdownLevel => d <= 0 ? 'red' : d <= 60 ? 'amber' : 'neutral';

export function tenancyCountdown(t: ContractingTenancy, nowMs: number): Countdown {
  // A move-out date (either type) drives the countdown to the ACTUAL date.
  const moveOut = tenancyMoveOut(t);
  if (moveOut) {
    const d = daysUntil(moveOut, nowMs);
    return { kind: 'moveout', endYmd: moveOut, endMs: ymdToMs(moveOut), daysLeft: d, level: level60(d), label: d <= 0 ? 'past move-out — end tenancy' : `moving out in ${d} day${d === 1 ? '' : 's'}` };
  }
  if (t.status === 'fixed_term' && t.leaseEnd) {
    const d = daysUntil(t.leaseEnd, nowMs);
    return { kind: 'fixed', endYmd: t.leaseEnd, endMs: ymdToMs(t.leaseEnd), daysLeft: d, level: level60(d), label: d <= 0 ? 'expired — renew or convert' : `${d} day${d === 1 ? '' : 's'} until expiry` };
  }
  return { kind: 'open', endMs: Infinity, level: 'neutral', label: 'month-to-month' };
}

// Every unit across the properties, with its countdown — for occupancy views.
export interface UnitRow { property: ContractingProperty; unit: ContractingUnit; countdown?: Countdown; }
export function allUnitRows(properties: ContractingProperty[], nowMs: number): UnitRow[] {
  const rows: UnitRow[] = [];
  for (const p of properties) for (const u of (p.units || [])) {
    rows.push({ property: p, unit: u, countdown: u.tenancy ? tenancyCountdown(u.tenancy, nowMs) : undefined });
  }
  return rows;
}

// Leases needing attention — amber/red or a scheduled move-out, soonest-first.
export function leasesNeedingAttention(properties: ContractingProperty[], nowMs: number): UnitRow[] {
  return allUnitRows(properties, nowMs)
    .filter(r => r.countdown && (r.countdown.level === 'amber' || r.countdown.level === 'red' || r.countdown.kind === 'moveout'))
    .sort((a, b) => (a.countdown!.endMs) - (b.countdown!.endMs));
}

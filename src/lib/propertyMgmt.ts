// Property management (v2): countdown / notice / occupancy logic. Reference
// layer only — no payment/ledger math. Dates are 'YYYY-MM-DD' (local).
import { ContractingProperty, ContractingUnit, ContractingTenancy } from '../types';

export const NOTICE_DAYS_DEFAULT = 60;
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

// The M2M notice-end date = notice + noticeDays.
export function computeNoticeEnd(noticeYmd: string, noticeDays: number): string { return addDaysYmd(noticeYmd, noticeDays); }

export function tenancyMonthlyTotal(t: ContractingTenancy): number {
  return (t.tenants || []).reduce((s, x) => s + (Number(x.rentAmount) || 0), 0);
}
export function unitIsVacant(u: ContractingUnit): boolean { return !u.tenancy; }

export type CountdownKind = 'fixed' | 'm2m_open' | 'm2m_notice';
export type CountdownLevel = 'neutral' | 'amber' | 'red';
export interface Countdown { kind: CountdownKind; endYmd?: string; endMs: number; daysLeft?: number; level: CountdownLevel; label: string; }

// Whole days from today (start-of-day) to the end date.
function daysUntil(endYmd: string, nowMs: number): number {
  const startToday = new Date(nowMs); startToday.setHours(0, 0, 0, 0);
  return Math.round((ymdToMs(endYmd) - startToday.getTime()) / DAY);
}

export function tenancyCountdown(t: ContractingTenancy, nowMs: number): Countdown {
  if (t.status === 'fixed_term' && t.leaseEnd) {
    const d = daysUntil(t.leaseEnd, nowMs);
    const level: CountdownLevel = d <= 0 ? 'red' : d <= 60 ? 'amber' : 'neutral';
    return { kind: 'fixed', endYmd: t.leaseEnd, endMs: ymdToMs(t.leaseEnd), daysLeft: d, level, label: d <= 0 ? 'expired — renew or convert' : `${d} day${d === 1 ? '' : 's'} until expiry` };
  }
  // month-to-month
  if (t.noticeGivenAt && t.computedEnd) {
    const d = daysUntil(t.computedEnd, nowMs);
    const level: CountdownLevel = d <= 0 ? 'red' : 'amber';
    return { kind: 'm2m_notice', endYmd: t.computedEnd, endMs: ymdToMs(t.computedEnd), daysLeft: d, level, label: d <= 0 ? 'past notice — end tenancy' : `ending in ${d} day${d === 1 ? '' : 's'}` };
  }
  return { kind: 'm2m_open', endMs: Infinity, level: 'neutral', label: 'month-to-month' };
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

// Leases needing attention — amber/red/notice-given, soonest-first.
export function leasesNeedingAttention(properties: ContractingProperty[], nowMs: number): UnitRow[] {
  return allUnitRows(properties, nowMs)
    .filter(r => r.countdown && (r.countdown.level === 'amber' || r.countdown.level === 'red' || r.countdown.kind === 'm2m_notice'))
    .sort((a, b) => (a.countdown!.endMs) - (b.countdown!.endMs));
}

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
// EVERY read of a unit's active tenancies goes through here. It folds in the
// legacy singular `tenancy` field, so a unit written before multi-tenancy
// reads identically to one written after and no flag day was needed.
export function unitTenancies(u: ContractingUnit): ContractingTenancy[] {
  if (Array.isArray(u.tenancies)) return u.tenancies.filter(Boolean);
  return u.tenancy ? [u.tenancy] : [];
}

export function unitIsVacant(u: ContractingUnit): boolean {
  return unitTenancies(u).length === 0;
}

// ── UNIT STATUS ────────────────────────────────────────────────────────────
// Three states, because two stopped being enough once a unit could hold more
// than one lease. A unit with one tenancy ending and another running is
// neither vacant nor quietly fully let — somebody has a room to fill.
export type UnitStatus = 'vacant' | 'let' | 'turning';

export function unitStatus(u: ContractingUnit, nowMs: number): UnitStatus {
  const ts = unitTenancies(u);
  if (ts.length === 0) return 'vacant';
  const anyEnding = ts.some(t => {
    const c = tenancyCountdown(t, nowMs);
    return c.level === 'amber' || c.level === 'red' || c.kind === 'moveout';
  });
  return anyEnding ? 'turning' : 'let';
}

export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = {
  vacant: 'Vacant',
  let: 'Let',
  turning: 'Partly turning over',
};

/**
 * The unit's headline countdown: the SOONEST-ending tenancy, because that is
 * the one needing action first. Month-to-month tenancies have no end and never
 * win. Returns undefined for a vacant unit, or one where nothing has a date.
 */
export function unitHeadlineCountdown(
  u: ContractingUnit, nowMs: number,
): Countdown | undefined {
  let best: Countdown | undefined;
  for (const t of unitTenancies(u)) {
    const c = tenancyCountdown(t, nowMs);
    if (!Number.isFinite(c.endMs)) continue;          // open-ended
    if (!best || c.endMs < best.endMs) best = c;
  }
  return best;
}

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

// Every unit across the properties, with its HEADLINE countdown and status —
// for occupancy views that summarise a unit in one line.
export interface UnitRow {
  property: ContractingProperty;
  unit: ContractingUnit;
  countdown?: Countdown;
  status: UnitStatus;
  tenancyCount: number;
}
export function allUnitRows(properties: ContractingProperty[], nowMs: number): UnitRow[] {
  const rows: UnitRow[] = [];
  for (const p of properties || []) for (const u of (p.units || [])) {
    rows.push({
      property: p, unit: u,
      countdown: unitHeadlineCountdown(u, nowMs),
      status: unitStatus(u, nowMs),
      tenancyCount: unitTenancies(u).length,
    });
  }
  return rows;
}

// ── WHAT NEEDS ATTENTION ───────────────────────────────────────────────────
// A TENANCY, not a unit. "1391 Balmoral Lower — 12 days" cannot be acted on
// without knowing whose lease it is, and once a unit holds several the unit
// alone no longer identifies one.
export interface TenancyRow {
  property: ContractingProperty;
  unit: ContractingUnit;
  tenancy: ContractingTenancy;
  countdown: Countdown;
  /** The starred tenant, or the first — who this lease is with, in one name. */
  who: string;
}

export function allTenancyRows(
  properties: ContractingProperty[], nowMs: number,
): TenancyRow[] {
  const rows: TenancyRow[] = [];
  for (const p of properties || []) for (const u of (p.units || [])) {
    for (const t of unitTenancies(u)) {
      const lead = starredTenant(t) || t.tenants?.[0];
      rows.push({
        property: p, unit: u, tenancy: t,
        countdown: tenancyCountdown(t, nowMs),
        who: lead?.name || 'unnamed tenancy',
      });
    }
  }
  return rows;
}

/** Amber/red or a scheduled move-out, soonest-first. One row per LEASE. */
export function leasesNeedingAttention(
  properties: ContractingProperty[], nowMs: number,
): TenancyRow[] {
  return allTenancyRows(properties, nowMs)
    .filter(r => r.countdown.level === 'amber' || r.countdown.level === 'red'
      || r.countdown.kind === 'moveout')
    .sort((a, b) => a.countdown.endMs - b.countdown.endMs);
}

// ── SPLITTING A TENANCY ────────────────────────────────────────────────────
// Three people on one lease turn out to be on three. Which tenant belongs to
// which lease, and on what terms, is knowledge only Tony has — so this moves
// the CHOSEN tenants into a new tenancy and leaves the terms for him to enter.
// It never guesses a date.
export function splitTenancy(input: {
  unit: ContractingUnit;
  tenancyId: string;
  /** Tenant names to move out into a tenancy of their own. */
  moveNames: string[];
  newTenancyId: string;
  nowMs: number;
  by: string;
}): { unit: ContractingUnit; error?: string } {
  const ts = unitTenancies(input.unit);
  const src = ts.find(t => t.id === input.tenancyId);
  if (!src) return { unit: input.unit, error: 'Tenancy not found.' };
  const move = new Set(input.moveNames);
  const moving = (src.tenants || []).filter(t => move.has(t.name));
  const staying = (src.tenants || []).filter(t => !move.has(t.name));
  if (moving.length === 0) return { unit: input.unit, error: 'Pick at least one tenant to split out.' };
  if (staying.length === 0) {
    return { unit: input.unit, error: 'At least one tenant must stay on the original lease.' };
  }
  const stamp = { at: input.nowMs, by: input.by, action: '' };
  const updatedSrc: ContractingTenancy = {
    ...src,
    tenants: staying,
    audit: [...(src.audit || []), { ...stamp, action: `split out ${moving.map(m => m.name).join(', ')}` }],
  };
  // The new lease inherits only the STATUS, deliberately. Copying dates would
  // assert a term nobody entered, and the whole point of splitting is that the
  // terms differ — a blank end date reads as "needs entering", a wrong one does
  // not read as anything.
  const created: ContractingTenancy = {
    id: input.newTenancyId,
    status: src.status,
    tenants: moving,
    createdAt: input.nowMs,
    notes: `Split from the lease with ${staying.map(t => t.name).join(', ')}.`,
    audit: [{ ...stamp, action: `split from tenancy ${src.id}` }],
  };
  return {
    unit: {
      ...input.unit,
      tenancies: ts.map(t => (t.id === src.id ? updatedSrc : t)).concat([created]),
      tenancy: undefined,
    },
  };
}

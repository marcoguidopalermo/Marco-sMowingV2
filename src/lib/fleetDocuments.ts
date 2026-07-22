// Fleet document helpers: doc-type catalog, expiry state, current-doc
// resolution, and unit/fleet-level alert counts. Reuses the app's existing
// urgency conventions (isExpired / isExpiringSoon, 30-day amber window).
import type { FleetItem, FleetDocument, FleetDocType } from '../types';
import { isExpired, isExpiringSoon, daysUntilDate } from './dateUtils';

export const DOC_TYPES: { key: FleetDocType; label: string; expiryRelevant: boolean }[] = [
  { key: 'insurance', label: 'Insurance', expiryRelevant: true },
  { key: 'registration', label: 'Registration', expiryRelevant: true },
  { key: 'safety_inspection', label: 'Safety Inspection', expiryRelevant: true },
  { key: 'ownership', label: 'Ownership', expiryRelevant: false },
  { key: 'other', label: 'Other', expiryRelevant: false },
];

export function docTypeLabel(doc: FleetDocument): string {
  if (doc.docType === 'other') return doc.label?.trim() || 'Other';
  return DOC_TYPES.find(d => d.key === doc.docType)?.label || doc.docType;
}

export type DocExpiryState = 'expired' | 'expiring' | 'ok' | 'none';
export function docExpiryState(doc: Pick<FleetDocument, 'expiryDate'>): DocExpiryState {
  if (!doc.expiryDate) return 'none';
  if (isExpired(doc.expiryDate)) return 'expired';
  if (isExpiringSoon(doc.expiryDate)) return 'expiring';
  return 'ok';
}

// Sort newest-first by uploadedAt so the "current" copy of a type is first.
export function sortDocsCurrentFirst(docs: FleetDocument[]): FleetDocument[] {
  return [...docs].sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
}

// The "current" doc for a type = the most recent NON-expired one, else the
// most recent overall (so an all-expired type still surfaces something).
export function currentDocForType(docs: FleetDocument[], type: FleetDocType): FleetDocument | undefined {
  const ofType = sortDocsCurrentFirst(docs.filter(d => d.docType === type));
  return ofType.find(d => docExpiryState(d) !== 'expired') || ofType[0];
}

export function groupDocsByType(docs: FleetDocument[] = []): Record<FleetDocType, FleetDocument[]> {
  const out = { insurance: [], registration: [], safety_inspection: [], ownership: [], other: [] } as Record<FleetDocType, FleetDocument[]>;
  for (const d of docs) (out[d.docType] || out.other).push(d);
  for (const k of Object.keys(out) as FleetDocType[]) out[k] = sortDocsCurrentFirst(out[k]);
  return out;
}

// Per-unit alert counts. A type counts as expired/expiring based on its
// CURRENT doc (an old expired copy behind a fresh valid one is not an alert).
export function unitDocAlerts(unit: Pick<FleetItem, 'documents'>): { expired: number; expiring: number } {
  const docs = unit.documents || [];
  let expired = 0, expiring = 0;
  for (const t of DOC_TYPES) {
    if (!t.expiryRelevant) continue;
    const cur = currentDocForType(docs, t.key);
    const st = cur ? docExpiryState(cur) : 'none';
    if (st === 'expired') expired++;
    else if (st === 'expiring') expiring++;
  }
  return { expired, expiring };
}

// Fleet-wide rollup for a nav badge / list summary.
export function fleetDocAlertSummary(fleet: FleetItem[]): { expiredUnits: number; expiringUnits: number; total: number } {
  let expiredUnits = 0, expiringUnits = 0;
  for (const u of fleet) {
    const a = unitDocAlerts(u);
    if (a.expired > 0) expiredUnits++;
    else if (a.expiring > 0) expiringUnits++;
  }
  return { expiredUnits, expiringUnits, total: expiredUnits + expiringUnits };
}

// One row per affected DOCUMENT for the "renewals needing attention" strip.
// Same shape as the leases-needing-attention rows: each expiry-relevant type's
// CURRENT doc, kept only when it is expired or expiring (the 30-day window from
// docExpiryState — the same source the push scan uses), sorted soonest-first
// (most-overdue expired dates lead, then the nearest upcoming expiries).
export interface FleetDocRenewal {
  unit: FleetItem;
  docType: FleetDocType;
  typeLabel: string;
  expiryDate: string;
  state: 'expired' | 'expiring';
  daysLeft: number; // signed: negative once past
}
export function fleetDocRenewals(fleet: FleetItem[]): FleetDocRenewal[] {
  const rows: FleetDocRenewal[] = [];
  for (const unit of fleet) {
    const docs = unit.documents || [];
    for (const t of DOC_TYPES) {
      if (!t.expiryRelevant) continue;
      const cur = currentDocForType(docs, t.key);
      if (!cur || !cur.expiryDate) continue;
      const st = docExpiryState(cur);
      if (st !== 'expired' && st !== 'expiring') continue;
      rows.push({
        unit,
        docType: t.key,
        typeLabel: docTypeLabel(cur),
        expiryDate: cur.expiryDate,
        state: st,
        daysLeft: daysUntilDate(cur.expiryDate),
      });
    }
  }
  // YMD strings sort chronologically; earliest (most overdue) first.
  return rows.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
}

// Plain-language countdown beside a dated doc row. Neutral wording, no colour —
// the row/badge supplies the amber/red. Uses the same day-diff as the window.
export function expiryCountdownLabel(expiryDate: string | undefined): string {
  if (!expiryDate) return '';
  // Decide expired/not with the SAME classifier the badge uses (isExpired),
  // then use the day-diff only for the magnitude — so the words never
  // contradict the colour on the exact expiry day.
  if (isExpired(expiryDate)) {
    const n = Math.max(0, -daysUntilDate(expiryDate));
    return n === 0 ? 'expired today' : `expired ${n} day${n === 1 ? '' : 's'} ago`;
  }
  const d = daysUntilDate(expiryDate);
  return d === 0 ? 'expires today' : `expires in ${d} day${d === 1 ? '' : 's'}`;
}

// Compact list-level chip for a unit: worst affected doc + a "+N more" count.
// null when the unit's docs are all current. Tone drives colour at the call
// site (red = at least one expired, amber = only expiring).
export interface UnitDocChip { tone: 'red' | 'amber'; label: string; more: number }
export function unitDocChip(unit: Pick<FleetItem, 'documents'>): UnitDocChip | null {
  const rows = fleetDocRenewals([unit as FleetItem]); // already soonest/worst-first
  if (rows.length === 0) return null;
  const worst = rows[0];
  const more = rows.length - 1;
  const base = worst.state === 'expired'
    ? `${worst.typeLabel} expired`
    : `${worst.typeLabel} · ${worst.daysLeft}d`;
  return {
    tone: worst.state === 'expired' ? 'red' : 'amber',
    label: more > 0 ? `${base} +${more} more` : base,
    more,
  };
}

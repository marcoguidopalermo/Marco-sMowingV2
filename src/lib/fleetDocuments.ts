// Fleet document helpers: doc-type catalog, expiry state, current-doc
// resolution, and unit/fleet-level alert counts. Reuses the app's existing
// urgency conventions (isExpired / isExpiringSoon, 30-day amber window).
import type { FleetItem, FleetDocument, FleetDocType } from '../types';
import { isExpired, isExpiringSoon } from './dateUtils';

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

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

// Normalize any stored expiry value to a YYYY-MM-DD string (or undefined).
// Fleet renewals live in several shapes across records: the newer uploaded
// FleetDocument.expiryDate ("2026-08-15"), the flat per-unit fields the fleet
// edit form and the push scan use (regExpiry / safetyExpiry / …), and — very
// defensively — an ISO datetime, a Firestore Timestamp, or an epoch-ms number
// on legacy records. Anything unparseable reads as "no date" rather than
// throwing, so one odd record can't blank the whole strip.
export function normalizeExpiry(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/); // YMD or full ISO
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const t = new Date(v.trim());
    return Number.isNaN(t.getTime()) ? undefined : t.toISOString().slice(0, 10);
  }
  const a = v as { toDate?: () => Date; seconds?: number; _seconds?: number };
  let ms: number | undefined;
  if (typeof a.toDate === 'function') ms = a.toDate()?.getTime?.();
  else if (typeof a.seconds === 'number') ms = a.seconds * 1000;
  else if (typeof a._seconds === 'number') ms = a._seconds * 1000;
  else if (v instanceof Date) ms = v.getTime();
  else if (typeof v === 'number') ms = v;
  return ms == null || Number.isNaN(ms) ? undefined : new Date(ms).toISOString().slice(0, 10);
}

// A fleet unit's renewals come from TWO places that must stay in lock-step
// with what buzzes:
//   • flat per-unit fields — regExpiry / safetyExpiry / … — which the fleet
//     edit form writes and the shipped push scan (functions) reads; and
//   • uploaded FleetDocument.expiryDate rows.
// The push reads the flat fields, so those are the source of truth for "what
// buzzes"; a matching uploaded document is only a fallback when no flat field
// is set (e.g. insurance kept purely as a scan). One row per renewal CONCEPT,
// deduped, classified by the SAME docExpiryState the badges/push use.
interface RenewalConcept { key: string; label: string; docType?: FleetDocType; fields: string[] }
const RENEWAL_CONCEPTS: RenewalConcept[] = [
  { key: 'registration', label: 'Registration', docType: 'registration', fields: ['regExpiry', 'registrationExpiry', 'plateExpiry'] },
  { key: 'insurance', label: 'Insurance', docType: 'insurance', fields: ['insuranceExpiry'] },
  { key: 'safety', label: 'Safety', docType: 'safety_inspection', fields: ['safetyExpiry', 'commercialSafetyExpire'] },
  { key: 'cvor', label: 'CVOR', fields: ['cvorExpiry'] },
];

// One row per affected renewal for the "renewals needing attention" strip,
// sorted soonest-first (most-overdue expired dates lead, then nearest
// upcoming). Kept only when expired or expiring (the 30-day window).
export interface FleetDocRenewal {
  unit: FleetItem;
  key: string;
  typeLabel: string;
  expiryDate: string;
  state: 'expired' | 'expiring';
  daysLeft: number;              // signed: negative once past
  source: 'field' | 'document';
}

function unitRenewals(unit: FleetItem): FleetDocRenewal[] {
  const docs = unit.documents || [];
  const rec = unit as unknown as Record<string, unknown>;
  const rows: FleetDocRenewal[] = [];
  for (const c of RENEWAL_CONCEPTS) {
    // Flat field first (what buzzes), then the uploaded document as fallback.
    let expiry: string | undefined;
    let source: 'field' | 'document' = 'field';
    for (const f of c.fields) {
      const n = normalizeExpiry(rec[f]);
      if (n) { expiry = n; break; }
    }
    if (!expiry && c.docType) {
      const cur = currentDocForType(docs, c.docType);
      const n = normalizeExpiry(cur?.expiryDate);
      if (n) { expiry = n; source = 'document'; }
    }
    if (!expiry) continue;
    const st = docExpiryState({ expiryDate: expiry });
    if (st !== 'expired' && st !== 'expiring') continue;
    rows.push({ unit, key: c.key, typeLabel: c.label, expiryDate: expiry, state: st, daysLeft: daysUntilDate(expiry), source });
  }
  // Any other dated uploaded documents (e.g. docType 'other') not covered by a
  // concept above — so nothing with an expiry silently drops off the strip.
  const covered = new Set(RENEWAL_CONCEPTS.map(c => c.docType).filter(Boolean));
  for (const t of DOC_TYPES) {
    if (!t.expiryRelevant || covered.has(t.key)) continue;
    const cur = currentDocForType(docs, t.key);
    const n = normalizeExpiry(cur?.expiryDate);
    if (!n) continue;
    const st = docExpiryState({ expiryDate: n });
    if (st !== 'expired' && st !== 'expiring') continue;
    rows.push({ unit, key: t.key, typeLabel: cur ? docTypeLabel(cur) : t.label, expiryDate: n, state: st, daysLeft: daysUntilDate(n), source: 'document' });
  }
  return rows;
}

export function fleetDocRenewals(fleet: FleetItem[]): FleetDocRenewal[] {
  const rows: FleetDocRenewal[] = [];
  for (const unit of fleet) rows.push(...unitRenewals(unit));
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
export function unitDocChip(unit: FleetItem): UnitDocChip | null {
  const rows = fleetDocRenewals([unit]); // already soonest/worst-first
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

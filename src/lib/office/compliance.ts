// Fleet compliance for OfficeMaster: every active truck/trailer's
// registration and safety dates, soonest first, plus the ones with no date.
// Reads dates ONLY through fleetDocuments.resolveRenewal and classifies with
// the same docExpiryState as the renewals strip — no second version.
import type { FleetItem } from '../../types';
import { resolveRenewal, docExpiryState, expiryCountdownLabel } from '../fleetDocuments';
import { daysUntilDate } from '../dateUtils';
import { needsCommercialSafety } from '../fleetUtils';
import { isDisposed } from '../fleetDisposal';

export type ComplianceKey = 'registration' | 'safety';
export const COMPLIANCE_LABEL: Record<ComplianceKey, string> = { registration: 'Registration', safety: 'Safety' };

export interface ComplianceRow {
  unit: FleetItem;
  key: ComplianceKey;
  expiryDate: string;
  daysLeft: number;
  state: 'expired' | 'expiring' | 'ok';
  countdown: string;
}
export interface MissingRow { unit: FleetItem; key: ComplianceKey }

/** Which checks a unit needs: every truck/trailer is registered; safety per needsCommercialSafety. */
export function requiredChecks(unit: FleetItem): ComplianceKey[] {
  if (unit.type !== 'truck' && unit.type !== 'trailer') return [];
  return needsCommercialSafety(unit) ? ['registration', 'safety'] : ['registration'];
}

export function fleetCompliance(fleet: FleetItem[]): { rows: ComplianceRow[]; missing: MissingRow[] } {
  const rows: ComplianceRow[] = [], missing: MissingRow[] = [];
  for (const unit of fleet) {
    if (isDisposed(unit)) continue;
    const required = requiredChecks(unit);
    for (const key of ['registration', 'safety'] as ComplianceKey[]) {
      const r = resolveRenewal(unit, key);
      if (!r) { if (required.includes(key)) missing.push({ unit, key }); continue; }
      // A date on a unit that doesn't strictly need the check still shows.
      const st = docExpiryState({ expiryDate: r.expiryDate });
      rows.push({
        unit, key, expiryDate: r.expiryDate, daysLeft: daysUntilDate(r.expiryDate),
        state: st === 'expired' ? 'expired' : st === 'expiring' ? 'expiring' : 'ok',
        countdown: expiryCountdownLabel(r.expiryDate),
      });
    }
  }
  rows.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  return { rows, missing };
}

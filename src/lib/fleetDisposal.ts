// RETIRED / SOLD / WRITTEN-OFF FLEET UNITS (FinanceMaster prerequisite).
//
// A unit that leaves the fleet is no longer hard-deleted: it keeps its record
// (history, inspections, repairs and finance agreements still point at it)
// and carries `disposal`. Disposed units drop out of everything OPERATIONAL —
// schedule pickers, MechanicMaster lists, renewal reminders and expiry alerts
// — but the stored fleet array is never filtered: saves write it back whole,
// so a filtered copy would delete them.
import type { FleetItem } from '../types';

export type DisposalKind = 'sold' | 'retired' | 'written_off';

export const DISPOSAL_LABEL: Record<DisposalKind, string> = {
  sold: 'Sold',
  retired: 'Retired',
  written_off: 'Written off',
};

export const isDisposed = (u: Pick<FleetItem, 'disposal'> | null | undefined): boolean =>
  !!(u && u.disposal && u.disposal.kind);

/** Units still in service — for DISPLAY only. Never save this list. */
export const operationalFleet = <T extends Pick<FleetItem, 'disposal'>>(fleet: T[]): T[] =>
  fleet.filter(u => !isDisposed(u));

import { AppData, FleetItem } from '../types';
import { formatDate } from './dateUtils';
import { resolveWeightBand } from './fleetUtils';

export const getRequiredInspectionType = (unit: FleetItem): 'DVIR' | 'CircleCheck' | 'Trailer' => {
  if (unit.type === 'trailer') return 'Trailer';
  // "Heavy" via the canonical band — same semantic as the old
  // literal-string check, but now derived from registeredGrossWeight
  // when present (else mapped from the legacy weightClass string).
  const band = resolveWeightBand(unit);
  const isHeavy = band === '4501_10999' || band === '10999_plus';
  return (isHeavy || unit.cvorRequired) ? 'DVIR' : 'CircleCheck';
};

export const getUnitReadiness = (unitId: string, appData: AppData, contextDate?: string) => {
  const unit = appData.fleet.find(f => f.id === unitId);
  if (!unit) return 'missing';
  if (unit.status === 'Out of Service') return 'red';

  const targetDate = contextDate || formatDate(new Date());
  const todayInsp = appData.inspections.find(i => i.unitId === unitId && i.date === targetDate);

  if (!todayInsp) return 'missing';
  if (todayInsp.status === 'major') return 'red';
  if (todayInsp.status === 'minor') return 'yellow';
  return 'green';
};

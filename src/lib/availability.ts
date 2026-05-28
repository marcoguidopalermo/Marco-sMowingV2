import { AppData } from '../types';

export type ResourceType = 'employee' | 'fleet' | 'jobberAssignee';

export type AvailabilityStatus =
  | { status: 'available' }
  | { status: 'absent'; reason: 'sick' | 'other' }
  | { status: 'booked_off'; reason: string }
  | { status: 'assigned'; crewId: string; crewName: string }
  | { status: 'oos' };

// Single source of truth for whether a resource (employee, truck, equipment, trailer) is
// usable on a given calendar date. Precedence:
//   1. Employee marked Away (indefinite) → absent (other)
//   2. Employee in dailyAbsences[date] → absent (sick)
//   3. Employee with awayDates range covering date → booked_off (vacation)
//   4. Fleet item with status === 'Out of Service' → oos
//   5. Resource present on any crew's roster for the date → assigned
//   6. Otherwise → available
//
// Unavailability for the resource itself (absent / oos) wins over crew-assignment so the
// reason surfaced to the user matches the spec edge cases.
export function getResourceAvailability(
  resourceId: string,
  resourceType: ResourceType,
  dateString: string,
  appData: AppData,
): AvailabilityStatus {
  if (resourceType === 'employee') {
    const emp = appData.employees.find(e => e.id === resourceId);
    if (emp) {
      if (emp.status === 'Away') return { status: 'absent', reason: 'other' };
      if (appData.dailyAbsences[dateString]?.includes?.(resourceId)) {
        return { status: 'absent', reason: 'sick' };
      }
      const ranges = emp.awayDates || [];
      for (const r of ranges) {
        if (r.start && r.end && dateString >= r.start && dateString <= r.end) {
          return { status: 'booked_off', reason: 'vacation' };
        }
      }
    }
  } else if (resourceType === 'fleet') {
    const f = appData.fleet.find(x => x.id === resourceId);
    if (f && f.status === 'Out of Service') return { status: 'oos' };
  }
  // jobberAssignee has no "absent / oos" concept — only cross-crew uniqueness.

  const daySchedules = appData.schedules[dateString] || [];
  for (const c of daySchedules) {
    const list = resourceType === 'employee' ? c.employees
      : resourceType === 'fleet' ? c.fleet
      : (c.jobberAssigneeIds || []);
    if (list.includes(resourceId)) {
      return { status: 'assigned', crewId: c.id, crewName: `${c.division} #${c.crewNumber}` };
    }
  }

  return { status: 'available' };
}

// Convert a status into a short human-readable suffix for dropdown labels and toasts.
export function describeUnavailability(
  s: AvailabilityStatus,
  resourceName: string,
): string {
  switch (s.status) {
    case 'available': return '';
    case 'absent':    return s.reason === 'sick' ? `${resourceName} is marked absent today` : `${resourceName} is unavailable (away indefinitely)`;
    case 'booked_off': return `${resourceName} is booked off today`;
    case 'assigned':  return `${resourceName} is already on ${s.crewName} today`;
    case 'oos':       return `${resourceName} is out of service`;
  }
}

export function shortStatusLabel(s: AvailabilityStatus): string {
  switch (s.status) {
    case 'available': return '';
    case 'absent':    return s.reason === 'sick' ? 'Absent (sick)' : 'Away';
    case 'booked_off': return 'Booked off';
    case 'assigned':  return `On ${s.crewName}`;
    case 'oos':       return 'Out of service';
  }
}

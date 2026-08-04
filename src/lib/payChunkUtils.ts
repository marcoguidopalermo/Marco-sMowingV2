import { Employee, MechanicPayChunk, TimeEntry } from '../types';

const MS_PER_HOUR = 3600 * 1000;

// PAY MODE helpers. A mechanic is a CHUNK-pay mechanic unless explicitly set to
// 'hourly' — absent payMode means chunk, so existing mechanics are unchanged.
// An hourly mechanic reads pay/hours from clocked time; the chunk machinery and
// its UI don't apply to them.
export function isChunkMechanic(emp?: Pick<Employee, 'systemRole' | 'payMode'> | null): boolean {
  return !!emp && emp.systemRole === 'mechanic' && emp.payMode !== 'hourly';
}
export function isHourlyMechanic(emp?: Pick<Employee, 'systemRole' | 'payMode'> | null): boolean {
  return !!emp && emp.systemRole === 'mechanic' && emp.payMode === 'hourly';
}

// Sum mechanic-clocked hours between [from, to]. Clips entries that
// straddle the range. Unclosed shifts (no clockOut) are treated as
// ongoing to "now" — same convention the existing TimeMaster
// summary uses. Returns hours as a float.
export function computeHoursWorkedBetween(
  mechanicEmail: string,
  from: number,
  to: number,
  timeEntries: TimeEntry[],
): number {
  const me = (mechanicEmail || '').toLowerCase();
  if (!me) return 0;
  let totalMs = 0;
  for (const te of timeEntries) {
    if ((te.userEmail || '').toLowerCase() !== me) continue;
    const inMs = new Date(te.clockIn).getTime();
    if (Number.isNaN(inMs)) continue;
    const outMs = te.clockOut ? new Date(te.clockOut).getTime() : Date.now();
    if (Number.isNaN(outMs) || outMs <= inMs) continue;
    if (outMs <= from || inMs >= to) continue;
    const segStart = Math.max(inMs, from);
    const segEnd = Math.min(outMs, to);
    if (segEnd > segStart) totalMs += (segEnd - segStart);
  }
  return totalMs / MS_PER_HOUR;
}

export function getOpenChunk(
  mechanicEmail: string,
  chunks: Record<string, MechanicPayChunk>,
): MechanicPayChunk | undefined {
  const me = (mechanicEmail || '').toLowerCase();
  if (!me) return undefined;
  return Object.values(chunks || {}).find(c =>
    (c.mechanicEmail || '').toLowerCase() === me && c.status === 'open',
  );
}

// Walk the mechanic's time entries forward from `startMs` and return
// the wall-clock moment at which cumulative clocked hours hit
// `targetHours`. Used to interpolate the precise close timestamp of
// a chunk that just crossed its threshold (preferred over "now" so
// overflow attributes correctly to the new chunk).
//
// Fallbacks: if no entries yet account for `targetHours` (caller's
// math says otherwise — shouldn't happen, but defensive), returns
// Date.now() as a last resort.
function interpolateCloseTime(
  mechanicEmail: string,
  startMs: number,
  targetHours: number,
  timeEntries: TimeEntry[],
): number {
  const me = (mechanicEmail || '').toLowerCase();
  const entries = timeEntries
    .filter(te => (te.userEmail || '').toLowerCase() === me)
    .map(te => {
      const inMs = new Date(te.clockIn).getTime();
      const outMs = te.clockOut ? new Date(te.clockOut).getTime() : Date.now();
      return { inMs, outMs };
    })
    .filter(e => !Number.isNaN(e.inMs) && !Number.isNaN(e.outMs) && e.outMs > e.inMs)
    .sort((a, b) => a.inMs - b.inMs);
  let accumMs = 0;
  const targetMs = targetHours * MS_PER_HOUR;
  for (const e of entries) {
    if (e.outMs <= startMs) continue;
    const segStart = Math.max(e.inMs, startMs);
    const segDur = e.outMs - segStart;
    if (segDur <= 0) continue;
    if (accumMs + segDur >= targetMs) {
      return segStart + (targetMs - accumMs);
    }
    accumMs += segDur;
  }
  return Date.now();
}

// Drives the chunk state machine for one mechanic. Pure helper —
// returns the updated chunks map; caller wires it through
// syncToCloud. Safe to call from any save handler OR from a
// view-render safety-net effect.
//
// Behavior:
// - If the mechanic has no `hoursPer1000`, returns unchanged.
// - If no open chunk exists, returns unchanged. (Auto-opening on
//   first time entry is intentionally NOT done here — rollout
//   requires an admin-driven setup so the start timestamp +
//   manual-hours-offset are correct. See the Personnel form.)
// - If the open chunk's cumulative hours (manualHoursOffset +
//   computed-since-start) >= threshold, close it at the
//   interpolated boundary moment and open a new one starting at
//   that same moment, snapshotting the current employee's
//   hoursPer1000 as the new threshold.
// - Defensive loop with max 5 iterations to handle extreme
//   overflow (a single time entry pushing through several
//   thresholds) without risk of infinite chains on bad data.
// - If the open chunk's hours are below threshold, still update
//   `hoursWorked` to the freshly-computed value so the UI shows
//   live progress without requiring a close to refresh.
export function processPayChunksOnTimeUpdate(
  mechanicEmail: string,
  chunks: Record<string, MechanicPayChunk>,
  employees: Employee[],
  timeEntries: TimeEntry[],
): Record<string, MechanicPayChunk> {
  const me = (mechanicEmail || '').toLowerCase();
  if (!me) return chunks;
  const emp = employees.find(e => (e.linkedUserEmail || '').toLowerCase() === me);
  if (!emp || typeof emp.hoursPer1000 !== 'number' || emp.hoursPer1000 <= 0) {
    return chunks;
  }
  // Returns the same object reference when no chunk actually closes,
  // so the view-render safety-net effect can short-circuit on
  // reference equality and avoid an infinite snapshot loop. Live
  // progress on open chunks is computed on-demand by the views via
  // computeOpenChunkHours — it is NOT persisted continuously.
  let modified = false;
  let nextChunks: Record<string, MechanicPayChunk> = chunks;
  let openChunk = getOpenChunk(mechanicEmail, nextChunks);
  if (!openChunk) return chunks;
  for (let i = 0; i < 5; i++) {
    if (!openChunk) break;
    const offset = openChunk.manualHoursOffset || 0;
    const computed = computeHoursWorkedBetween(
      mechanicEmail,
      openChunk.startTimestamp,
      Date.now(),
      timeEntries,
    );
    const hoursWorked = offset + computed;
    if (hoursWorked < openChunk.hoursThreshold) {
      // Below threshold — nothing to persist. Views read live
      // progress via computeOpenChunkHours; stored hoursWorked is
      // only authoritative at close time.
      break;
    }
    // First close in this iteration: clone the map so we can mutate.
    if (!modified) {
      nextChunks = { ...chunks };
      modified = true;
    }
    // Close the chunk at the interpolated boundary moment.
    const remainingHoursForThisChunk = openChunk.hoursThreshold - offset;
    const closeAt = interpolateCloseTime(
      mechanicEmail,
      openChunk.startTimestamp,
      remainingHoursForThisChunk,
      timeEntries,
    );
    nextChunks[openChunk.id] = {
      ...openChunk,
      endTimestamp: closeAt,
      hoursWorked: openChunk.hoursThreshold,
      status: 'closed',
    };
    // Open a new chunk starting at the close moment, snapshotting
    // the current employee's hoursPer1000 (re-read in case it
    // changed between chunks).
    const newId = `chunk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${i}`;
    nextChunks[newId] = {
      id: newId,
      mechanicId: emp.id,
      mechanicEmail: me,
      startTimestamp: closeAt,
      hoursThreshold: emp.hoursPer1000,
      hoursWorked: 0,
      status: 'open',
    };
    openChunk = nextChunks[newId];
  }
  return modified ? nextChunks : chunks;
}

// Summary helper used by MyMechanic + PerformanceMaster. Returns
// the open chunk plus all closed chunks for a mechanic, sorted
// newest-first by startTimestamp.
export function chunksForMechanic(
  mechanicEmail: string,
  chunks: Record<string, MechanicPayChunk>,
): { open: MechanicPayChunk | undefined; closed: MechanicPayChunk[] } {
  const me = (mechanicEmail || '').toLowerCase();
  const mine = Object.values(chunks || {}).filter(
    c => (c.mechanicEmail || '').toLowerCase() === me,
  );
  const open = mine.find(c => c.status === 'open');
  const closed = mine
    .filter(c => c.status === 'closed')
    .sort((a, b) => (b.startTimestamp || 0) - (a.startTimestamp || 0));
  return { open, closed };
}

// Live hours-worked for an open chunk — used by views that want the
// progress reading without mutating data (PerformanceMaster's read
// pass, MyMechanic's progress bar). Returns the value the chunk's
// hoursWorked field WOULD hold if the state machine ran right now.
export function computeOpenChunkHours(
  chunk: MechanicPayChunk,
  timeEntries: TimeEntry[],
): number {
  const offset = chunk.manualHoursOffset || 0;
  const computed = computeHoursWorkedBetween(
    chunk.mechanicEmail,
    chunk.startTimestamp,
    Date.now(),
    timeEntries,
  );
  return offset + computed;
}

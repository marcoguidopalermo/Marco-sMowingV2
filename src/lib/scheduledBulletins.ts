// SCHEDULED BULLETINS — write it now, land it when it is actionable.
//
// "Bring the truck in for window repair, 8:00am Friday" written on Tuesday is
// forgettable by Friday. Written on Tuesday and delivered Thursday evening, it
// is a reminder. The bulletin is composed once and queued.
//
// VISIBILITY IS DERIVED FROM THE CLOCK, never from a stored flag. Bulletins
// live on the main appData doc, which every whole-document save rewrites, so a
// stale client could revert a `published: true`. It cannot revert the passage
// of time. A bulletin that silently never appeared would be the one failure
// this feature must not have; a duplicate push is a far smaller problem, and
// is separately guarded server-side by a dedupe marker.
import { BulletinPost } from '../types';

/** Queued: has a post time, and that time has not arrived. */
export const isScheduled = (b: Pick<BulletinPost, 'publishAt'>, nowMs: number): boolean =>
  typeof b.publishAt === 'number' && Number.isFinite(b.publishAt) && b.publishAt > nowMs;

/** Live on the board: either never scheduled, or its time has come. */
export const isPublished = (b: Pick<BulletinPost, 'publishAt'>, nowMs: number): boolean =>
  !isScheduled(b, nowMs);

/**
 * Who may see a bulletin that has not published yet: its author, and admins.
 * Everyone else sees nothing at all until it lands — the point of queueing is
 * that the message arrives once, when it is useful.
 */
export function canSeeScheduled(
  b: Pick<BulletinPost, 'author'>,
  viewerEmail: string | null | undefined,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  const a = (b.author || '').trim().toLowerCase();
  const v = (viewerEmail || '').trim().toLowerCase();
  return !!a && a === v;
}

export interface BulletinSplit {
  /** Published, newest first — the board as everyone knows it. */
  live: BulletinPost[];
  /** Queued and visible to this viewer, soonest first — what lands next. */
  scheduled: BulletinPost[];
}

/**
 * Split a bulletin list for one viewer. A queued bulletin they may not see is
 * dropped from BOTH lists rather than leaking into the live one.
 */
export function splitBulletins(
  bulletins: BulletinPost[] | undefined,
  nowMs: number,
  viewerEmail: string | null | undefined,
  isAdmin: boolean,
): BulletinSplit {
  const live: BulletinPost[] = [];
  const scheduled: BulletinPost[] = [];
  for (const b of bulletins || []) {
    if (!b) continue;
    if (isScheduled(b, nowMs)) {
      if (canSeeScheduled(b, viewerEmail, isAdmin)) scheduled.push(b);
      continue;
    }
    live.push(b);
  }
  // Soonest first: the next thing to land is the thing worth checking.
  scheduled.sort((a, b) => (a.publishAt || 0) - (b.publishAt || 0));
  return { live, scheduled };
}

/** Editable and deletable right up to the moment it goes. After that it is an ordinary bulletin. */
export const canEditScheduled = (
  b: Pick<BulletinPost, 'publishAt' | 'author'>,
  nowMs: number,
  viewerEmail: string | null | undefined,
  isAdmin: boolean,
): boolean => isScheduled(b, nowMs) && canSeeScheduled(b, viewerEmail, isAdmin);

// ── QUIET HOURS ────────────────────────────────────────────────────────────
// 20:00–08:00. The bulletin itself publishes exactly when scheduled; the PUSH
// obeys the existing quiet-hours rule and is held to the window's end. Someone
// scheduling for 6am gets what they asked for on the board, and is told at
// post time that the notification will arrive at 8.
export const QUIET_START_HOUR = 20;
export const QUIET_END_HOUR = 8;

export const hourIsQuiet = (hour: number): boolean =>
  hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;

/**
 * Warning to show at post time when the chosen moment falls in quiet hours and
 * a notification was requested. Null when there is nothing to say — no push,
 * or a time that will deliver immediately.
 */
export function quietHoursNotice(input: {
  publishAt: number;
  notify: boolean;
  /** Local hour of publishAt, injected so this stays pure and testable. */
  hour: number;
}): string | null {
  if (!input.notify) return null;
  if (!Number.isFinite(input.publishAt)) return null;
  if (!hourIsQuiet(input.hour)) return null;
  return 'That time is inside quiet hours (8:00 PM – 8:00 AM). The bulletin will '
    + 'appear on the board exactly when you scheduled it, but the notification '
    + 'will be held and delivered at 8:00 AM.';
}

/** The local hour of a timestamp — the caller's own clock, which is the one they picked in. */
export const localHourOf = (ms: number): number => new Date(ms).getHours();

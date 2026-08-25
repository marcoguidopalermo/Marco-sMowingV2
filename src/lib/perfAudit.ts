import { addDoc, collection } from 'firebase/firestore';
import { db, appId } from './firebase';
import { PerfActivityEntry } from '../types';

type PerfActivityInput = Omit<PerfActivityEntry, 'id' | 'timestamp'>;

function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export async function logPerfActivity(entry: PerfActivityInput): Promise<void> {
  console.info('[perf-activity]', entry.type, entry);
  try {
    const payload = stripUndefined({
      ...entry,
      timestamp: Date.now(),
    });
    await addDoc(
      collection(db, 'artifacts', appId, 'private', 'data', 'performanceActivityLog'),
      payload,
    );
  } catch (err) {
    console.error('[perfAudit] write failed — primary action still succeeded:', err);
  }
}

export const ACTIVITY_TYPE_LABELS: Record<PerfActivityEntry['type'], string> = {
  manual_job_added: 'Manual job added',
  manual_job_edited: 'Manual job edited',
  manual_job_removed: 'Manual job removed',
  jobber_bh_unlocked: 'Jobber BH unlocked',
  jobber_bh_edited: 'Jobber BH edited',
  jobber_bh_reverted: 'Jobber BH reverted',
  hourly_bh_entered: 'Hourly BH entered',
  hourly_bh_edited: 'Hourly BH edited',
  deduction_added: 'Deduction added',
  deduction_edited: 'Deduction edited',
  deduction_removed: 'Deduction removed',
  worker_removed: 'Worker removed',
  worker_unscheduled_added: 'Unscheduled worker added',
  ah_split: 'AH split',
  ah_manually_edited: 'AH manually edited',
  multiday_percent_marked: 'Multi-day % marked',
  multiday_split_added: 'Multi-day split added',
  multiday_percent_overridden: 'Multi-day forced to 100%',
  multiday_entry_edited: 'Multi-day entry edited',
  multiday_entry_deleted: 'Multi-day entry deleted',
  job_type_converted: 'Job type converted',
  entry_deleted: 'Entry deleted',
  entry_cleared: 'Entry cleared',
  approval_granted: 'Approval granted',
  approval_revoked: 'Approval revoked',
  multiday_auto_credited_on_completion: 'Multi-day auto-credit on completion',
  multiday_carried_forward: 'Multi-day carried forward',
  dispatch_issue_reported: 'Dispatch issue reported',
  bh_shifted_day: 'BH shifted to different day',
  visit_auto_moved_on_completion: 'Visit moved on completion',
  bh_filled_in_manually: 'BH filled in manually',
  approval_waived: 'Approval waived (no approval needed)',
  crew_day_flagged: 'Flagged for review',
  crew_day_flag_resolved: 'Flag resolved',
  crew_day_audited: 'Day audited',
  approval_note_saved: 'Approval note',
  efficiency_adjustment: 'Efficiency adjustment',
  efficiency_adjustment_voided: 'Efficiency adjustment voided',
  punch_removed_ah_recalculated: 'Punch removed · hours recalculated',
  chunk_marked_paid: 'Pay chunk marked paid',
  chunk_payment_reversed: 'Pay chunk payment reversed',
  partial_resolved_complete: 'Partial job completed (month-end)',
  partial_resolved_carry: 'Partial job carried forward (month-end)',
  partial_resolved_void: 'Partial job remainder voided (month-end)',
  performance_month_pushed: 'Month pushed to sheet',
  performance_day_archived: 'Day archived to sheet',
  performance_day_unlocked: 'Archived day unlocked',
  schedule_month_archived: 'Schedule month archived',
  trainee_credit_started: 'Trainee credit started',
  trainee_credit_extended: 'Trainee credit extended',
  trainee_credit_cleared: 'Trainee credit cleared',
};

export const ACTIVITY_CATEGORY: Record<PerfActivityEntry['type'], 'green' | 'amber' | 'rose' | 'slate'> = {
  manual_job_added: 'green',
  worker_unscheduled_added: 'green',
  hourly_bh_entered: 'green',
  approval_granted: 'slate',

  manual_job_edited: 'amber',
  jobber_bh_unlocked: 'amber',
  jobber_bh_edited: 'amber',
  jobber_bh_reverted: 'amber',
  hourly_bh_edited: 'amber',
  deduction_added: 'amber',
  deduction_edited: 'amber',
  ah_split: 'amber',
  ah_manually_edited: 'amber',
  multiday_percent_marked: 'amber',
  multiday_split_added: 'amber',
  multiday_percent_overridden: 'amber',
  multiday_entry_edited: 'amber',
  job_type_converted: 'amber',

  manual_job_removed: 'rose',
  deduction_removed: 'rose',
  worker_removed: 'rose',
  entry_deleted: 'rose',
  entry_cleared: 'rose',
  approval_revoked: 'rose',
  multiday_entry_deleted: 'rose',

  multiday_auto_credited_on_completion: 'green',
  multiday_carried_forward: 'amber',
  dispatch_issue_reported: 'amber',
  bh_shifted_day: 'amber',
  visit_auto_moved_on_completion: 'amber',
  bh_filled_in_manually: 'amber',
  approval_waived: 'slate',
  // Amber, not rose: a flag is a question about a crew-day, not a fault
  // finding. The resolution is green because the loop closed.
  crew_day_flagged: 'amber',
  crew_day_flag_resolved: 'green',
  crew_day_audited: 'slate',
  approval_note_saved: 'slate',
  efficiency_adjustment: 'amber',
  efficiency_adjustment_voided: 'slate',
  punch_removed_ah_recalculated: 'amber',
  chunk_marked_paid: 'green',
  chunk_payment_reversed: 'rose',
  performance_month_pushed: 'slate',
  performance_day_archived: 'slate',
  performance_day_unlocked: 'amber',
  schedule_month_archived: 'slate',
  partial_resolved_complete: 'green',
  partial_resolved_carry: 'slate',
  partial_resolved_void: 'rose',
  // Trainee credit is an efficiency-INFLATING admin action (it raises
  // adjusted eff), so start/extend are amber (worth auditing); clearing
  // it removes credit, so it's slate.
  trainee_credit_started: 'amber',
  trainee_credit_extended: 'amber',
  trainee_credit_cleared: 'slate',
};

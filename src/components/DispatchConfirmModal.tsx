import { useMemo, useState } from 'react';
import { X, Truck, Hammer, Users, Link2, AlertTriangle, CheckCircle } from 'lucide-react';
import { Crew, Employee, FleetItem, JobberUser, MechanicTask, TaskActivity, UserRole } from '../types';

interface DispatchConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  crew: Crew;
  dateString: string;
  employees: Employee[];
  fleet: FleetItem[];
  jobberUsers: JobberUser[];
  onConfirmDispatch: (newTask: MechanicTask | null) => void;
  currentUserEmail: string;
  currentUserName: string;
  currentUserRole: UserRole;
  showToastMsg: (msg: string) => void;
}

const ISSUE_CATEGORIES = ['Tire', 'Brakes', 'Engine', 'Body', 'Fluid Leaks', 'Body Damage', 'Other'];

export default function DispatchConfirmModal({
  isOpen, onClose, crew, dateString, employees, fleet, jobberUsers,
  onConfirmDispatch, currentUserEmail, currentUserName, showToastMsg,
}: DispatchConfirmModalProps) {
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueUnitId, setIssueUnitId] = useState('');
  const [issueCategory, setIssueCategory] = useState('');
  const [issueSeverity, setIssueSeverity] = useState<'minor' | 'major'>('minor');
  const [issueNotes, setIssueNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const vehicles = useMemo(
    () => crew.fleet.map(id => fleet.find(f => f.id === id)).filter((f): f is FleetItem => !!f && (f.type === 'truck' || f.type === 'trailer')),
    [crew.fleet, fleet],
  );
  const equipment = useMemo(
    () => crew.fleet.map(id => fleet.find(f => f.id === id)).filter((f): f is FleetItem => !!f && f.type === 'equipment'),
    [crew.fleet, fleet],
  );
  const crewMembers = useMemo(
    () => crew.employees.map(id => employees.find(e => e.id === id)).filter((e): e is Employee => !!e),
    [crew.employees, employees],
  );
  const jobberTags = useMemo(() => {
    const ids = crew.jobberAssigneeIds || [];
    return ids.map(id => jobberUsers.find(u => u.id === id) || { id, name: id, isAccountOwner: false });
  }, [crew.jobberAssigneeIds, jobberUsers]);

  const allFleetItems = useMemo(
    () => crew.fleet.map(id => fleet.find(f => f.id === id)).filter((f): f is FleetItem => !!f),
    [crew.fleet, fleet],
  );

  const totallyEmpty =
    vehicles.length === 0 && equipment.length === 0 &&
    crewMembers.length === 0 && jobberTags.length === 0;

  const submitIssueAndDispatch = () => {
    if (!issueUnitId) {
      showToastMsg('Pick the equipment with the issue.');
      return;
    }
    if (!issueCategory) {
      showToastMsg('Pick an issue category.');
      return;
    }
    const unit = fleet.find(f => f.id === issueUnitId);
    if (!unit) {
      showToastMsg('Selected unit not found.');
      return;
    }
    setBusy(true);
    const now = new Date().toISOString();
    const taskId = `mtask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const noteSuffix = issueNotes.trim() ? ` — ${issueNotes.trim()}` : '';
    const activityEntry: TaskActivity = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      type: 'created',
      userEmail: currentUserEmail,
      userName: currentUserName,
      timestamp: now,
      taskId,
      unitId: unit.id,
      unitName: unit.name,
      taskCategory: issueCategory,
      taskSeverity: issueSeverity,
      payload: {
        source: 'dispatch_report',
        sourceRefId: crew.id,
        taskCategory: issueCategory,
        taskSeverity: issueSeverity,
      },
    };
    const newTask: MechanicTask = {
      id: taskId,
      unitId: unit.id,
      unitName: unit.name,
      category: issueCategory,
      description: `Dispatch report: ${issueCategory}${noteSuffix}`,
      severity: issueSeverity,
      status: 'todo',
      dateReported: dateString,
      priority: false,
      activity: [activityEntry],
    };
    onConfirmDispatch(newTask);
    setBusy(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center md:p-4">
      <div className="bg-white md:rounded-xl shadow-2xl w-full md:max-w-lg h-full md:h-auto md:max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Dispatch confirmation</div>
            <h2 className="text-lg font-bold text-slate-800 truncate">
              {crew.division} #{crew.crewNumber}
            </h2>
            <div className="text-xs text-slate-500 mt-0.5">{dateString}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1.5 rounded" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {totallyEmpty && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
              Nothing assigned to this crew. Continue anyway?
            </div>
          )}

          {vehicles.length > 0 && (
            <section>
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5" /> Vehicles
              </h3>
              <ul className="space-y-1">
                {vehicles.map(v => (
                  <li key={v.id} className="flex items-center gap-2 text-sm text-slate-800">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                    <span className="font-bold">{v.name}</span>
                    <span className="text-slate-500 text-xs">({v.type})</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {equipment.length > 0 && (
            <section>
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                <Hammer className="w-3.5 h-3.5" /> Equipment
              </h3>
              <ul className="space-y-1">
                {equipment.map(e => (
                  <li key={e.id} className="flex items-center gap-2 text-sm text-slate-800">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                    <span className="font-bold">{e.name}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {crewMembers.length > 0 && (
            <section>
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Crew
              </h3>
              <ul className="space-y-1">
                {crewMembers.map(e => (
                  <li key={e.id} className="flex items-center gap-2 text-sm text-slate-800">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                    <span className="font-bold">{e.name}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {jobberTags.length > 0 && (
            <section>
              <h3 className="text-[10px] font-black uppercase tracking-widest text-lime-700 mb-2 flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5" /> Jobber
              </h3>
              <ul className="space-y-1">
                {jobberTags.map(j => (
                  <li key={j.id} className="flex items-center gap-2 text-sm text-slate-800">
                    <span className="w-1.5 h-1.5 rounded-full bg-lime-500" />
                    <span className="font-bold">{j.name}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {showIssueForm && (
            <section className="border-t border-slate-200 pt-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-amber-800">
                <AlertTriangle className="w-4 h-4" /> Report an equipment issue
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Which equipment?</label>
                <select
                  value={issueUnitId}
                  onChange={e => setIssueUnitId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm font-bold"
                >
                  <option value="">Pick a unit…</option>
                  {allFleetItems.map(f => (
                    <option key={f.id} value={f.id}>{f.name} ({f.type})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Issue category</label>
                <select
                  value={issueCategory}
                  onChange={e => setIssueCategory(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm font-bold"
                >
                  <option value="">Pick a category…</option>
                  {ISSUE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Severity</label>
                <div className="flex gap-2">
                  {(['minor', 'major'] as const).map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setIssueSeverity(s)}
                      className={`px-3 py-1.5 text-xs font-bold rounded border ${issueSeverity === s ? (s === 'major' ? 'bg-rose-600 text-white border-rose-600' : 'bg-amber-500 text-white border-amber-500') : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Notes (optional)</label>
                <textarea
                  value={issueNotes}
                  onChange={e => setIssueNotes(e.target.value)}
                  rows={2}
                  placeholder="What did you notice?"
                  className="w-full border border-slate-200 rounded p-2 text-sm outline-none focus:ring-2 focus:ring-amber-200"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowIssueForm(false); setIssueUnitId(''); setIssueCategory(''); setIssueSeverity('minor'); setIssueNotes(''); }}
                  className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitIssueAndDispatch}
                  disabled={busy || !issueUnitId || !issueCategory}
                  className="text-[10px] font-black uppercase tracking-widest bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded shadow disabled:bg-slate-300 disabled:cursor-not-allowed"
                >
                  Submit & Continue Dispatch
                </button>
              </div>
            </section>
          )}
        </div>

        {!showIssueForm && (
          <div className="px-5 py-3 border-t border-slate-200 flex flex-col-reverse md:flex-row md:items-center md:justify-end gap-2">
            {allFleetItems.length > 0 && (
              <button
                type="button"
                onClick={() => setShowIssueForm(true)}
                className="md:mr-auto text-xs font-black uppercase tracking-widest bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 rounded-lg shadow flex items-center justify-center gap-1.5"
              >
                <AlertTriangle className="w-4 h-4" /> Report Issue
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-sm font-bold text-slate-600 hover:bg-slate-100 px-4 py-2.5 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onConfirmDispatch(null)}
              className="text-xs font-black uppercase tracking-widest bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-lg shadow flex items-center justify-center gap-1.5"
            >
              <CheckCircle className="w-4 h-4" /> {totallyEmpty ? 'Dispatch Empty Crew' : 'All Good — Dispatch'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

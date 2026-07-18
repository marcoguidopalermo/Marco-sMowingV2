// ContractingMaster — Palermo's Contracting portal. A separate tenant inside
// CrewMaster: slate/gold branding, its own namespaced data, ZERO contact with
// Marco's performance/BH/bonus/pay. All billing math comes from lib/contracting.
import { useEffect, useMemo, useState } from 'react';
import {
  ContractingProject, ContractingPhase, ContractingChecklistItem, ContractingTimeEntry,
  ContractingProgressReport, ContractingReceipt, ContractingInvoice, ContractingWorkOrder,
  ContractingShoppingItem, ContractingRateCard, ContractingBillingRole, ContractingStatus,
  ContractingProperty, ContractingSupplier, ContractingPhaseType, Employee, StoredFile,
} from '../types';
import {
  HST_PCT, ratesOrDefault, ROLE_LABEL, rateFor, round2, money, receiptBilled,
  computeReportTotals, labourForReport, phaseBillables, phaseReadyToBill, withHst,
  PALERMO, reportDayN, phaseHasInvoicedBilling, phaseIsRemovable, rateMapFor, contractorRate,
  unbilledLabour, UnbilledEntry, projectIsRemovable, invoiceStage, invoiceDueAt, invoiceIsLate,
  projectBillables,
} from '../lib/contracting';
import { uploadFile } from '../lib/storage';
import PhotoViewer from './PhotoViewer';

interface Props {
  projects: Record<string, ContractingProject>;
  timeEntries: Record<string, ContractingTimeEntry>;
  reports: Record<string, ContractingProgressReport>;
  invoices: Record<string, ContractingInvoice>;
  workOrders: Record<string, ContractingWorkOrder>;
  shoppingList: Record<string, ContractingShoppingItem>;
  employees: Employee[];
  rates: ContractingRateCard;
  properties: ContractingProperty[];
  suppliers: ContractingSupplier[];
  currentUser: { id: string; name: string };
  isAdmin: boolean;
  canManage: boolean;
  uploadedBy: { email: string; name: string };
  onSaveRates: (r: ContractingRateCard) => void;
  onSaveProperties: (list: ContractingProperty[]) => void;
  onSaveSuppliers: (list: ContractingSupplier[]) => void;
  onAttachUnbilled: (reportId: string, entryIds: string[]) => void;
  onSaveProject: (p: ContractingProject) => void;
  onDeleteProject: (id: string) => void;
  onArchiveProject: (id: string, archived: boolean) => void;
  onMergePhases: (projectId: string, sourceId: string, targetId: string, mergedName?: string) => void;
  onSaveTimeEntry: (t: ContractingTimeEntry) => void;
  onOpenReport: (projectId: string, phaseId: string) => void;
  onEndReport: (reportId: string) => void;
  onSaveReport: (r: ContractingProgressReport) => void;
  onSaveInvoice: (inv: ContractingInvoice) => void;
  onDeleteInvoice: (id: string) => void;
  onSaveWorkOrder: (w: ContractingWorkOrder) => void;
  onSaveShoppingItem: (s: ContractingShoppingItem) => void;
}

// Cross-tab navigation actions threaded to tabs that link elsewhere.
interface Nav {
  openInvoice: (invoiceId: string) => void;
  goToPhase: (projectId: string, phaseId?: string) => void;
  goToReports: () => void;
  goToInvoices: (projectId?: string, phaseId?: string) => void;
}

// Base context (handlers + identity) minus the collection maps — inner
// components re-declare only the (array-shaped) collections they actually read.
type Ctx = Omit<Props, 'projects' | 'timeEntries' | 'reports' | 'invoices' | 'workOrders' | 'shoppingList'>;

const uid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const fmtDate = (ms?: number) => ms ? new Date(ms).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const STATUS_LABEL: Record<ContractingStatus, string> = { planned: 'Planned', in_progress: 'In Progress', on_hold: 'On Hold', complete: 'Complete', closed: 'Closed' };

type Tab = 'mytime' | 'projects' | 'reports' | 'invoices' | 'workorders' | 'shopping' | 'properties' | 'rates';

export default function ContractingMaster(props: Props) {
  const { canManage, isAdmin, currentUser } = props;
  const rates = ratesOrDefault(props.rates);
  // Contractors (no financials) open on My Time; managers open on Projects.
  const [tab, setTab] = useState<Tab>(canManage ? 'projects' : 'mytime');

  const projects = useMemo(() => Object.values(props.projects).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), [props.projects]);
  const invoices = useMemo(() => Object.values(props.invoices), [props.invoices]);
  const reports = useMemo(() => Object.values(props.reports), [props.reports]);
  const timeEntries = useMemo(() => Object.values(props.timeEntries), [props.timeEntries]);
  const contractors = useMemo(() => props.employees.filter(e => e.systemRole === 'contractor'), [props.employees]);
  // Per-contractor rate override map — honored by the live preview so it
  // matches what the invoice will freeze.
  const rateOverrides = useMemo(() => rateMapFor(props.employees, rates), [props.employees, rates]);

  // ── Cross-tab navigation (phase ↔ report ↔ invoice, both directions) ─────
  const [viewInvoiceId, setViewInvoiceId] = useState<string | null>(null);
  const [focusProjectId, setFocusProjectId] = useState<string | null>(null);
  const [invoiceFilter, setInvoiceFilter] = useState<{ projectId?: string; phaseId?: string }>({});
  const nav: Nav = {
    openInvoice: (id) => setViewInvoiceId(id),
    goToPhase: (projectId) => { setFocusProjectId(projectId); setTab('projects'); },
    goToReports: () => setTab('reports'),
    goToInvoices: (projectId, phaseId) => { setInvoiceFilter({ projectId, phaseId }); setTab('invoices'); },
  };
  const viewedInvoice = viewInvoiceId ? props.invoices[viewInvoiceId] : null;

  // FINANCIALS (projects, reports, invoices, billables, rate card) are
  // admin + contracting-manager ONLY — enforced by absence (not rendered).
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'mytime', label: 'My Time', show: true },
    { id: 'projects', label: 'Projects', show: canManage },
    { id: 'reports', label: 'Reports', show: canManage },
    { id: 'invoices', label: 'Invoices', show: canManage },
    { id: 'workorders', label: 'Work Orders', show: true },
    { id: 'shopping', label: 'Shopping', show: true },
    { id: 'properties', label: 'Properties', show: canManage },
    { id: 'rates', label: 'Rates', show: canManage },
  ];

  return (
    // Flex column that OWNS its scroll — the parent content area is
    // h-full overflow-hidden (each view must scroll internally), which is why
    // the old min-h-full root was clipped below the fold on mobile. Header +
    // tabs stay put (shrink-0); the body scrolls (flex-1 min-h-0 overflow-y).
    <div className="flex flex-col h-full" style={{ backgroundColor: '#F4F6F7' }}>
      {/* Palermo's brand header — slate with a gold accent */}
      <div className="px-4 py-3 shadow-sm shrink-0" style={{ backgroundColor: PALERMO.slate }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded flex items-center justify-center font-black text-lg" style={{ backgroundColor: PALERMO.gold, color: PALERMO.slate }}>P</div>
          <div>
            <div className="text-white font-bold text-lg leading-tight">Palermo's Contracting</div>
            <div className="text-xs" style={{ color: PALERMO.gold }}>{canManage ? 'ContractingMaster · T&M + fixed billing' : 'Time · Work Orders · Shopping'}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-2 pt-2 overflow-x-auto shrink-0" style={{ backgroundColor: PALERMO.slate }}>
        {tabs.filter(t => t.show).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="px-3 py-2 text-sm font-semibold rounded-t whitespace-nowrap"
            style={tab === t.id ? { backgroundColor: '#F4F6F7', color: PALERMO.slate } : { color: '#D5DBDB' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Scrolling body — extra bottom padding clears the mobile bottom nav
          and an open keyboard. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
      <div className="p-3 md:p-4 max-w-5xl mx-auto pb-24 md:pb-8">
        {tab === 'mytime' && <MyTimeTab {...props} rates={rates} timeEntries={timeEntries} projects={projects} />}
        {tab === 'projects' && canManage && <ProjectsTab {...props} rates={rates} invoices={invoices} projects={projects} reports={reports} timeEntries={timeEntries} rateOverrides={rateOverrides} nav={nav} focusProjectId={focusProjectId} onConsumeFocus={() => setFocusProjectId(null)} />}
        {tab === 'reports' && canManage && <ReportsTab {...props} rates={rates} reports={reports} timeEntries={timeEntries} contractors={contractors} projects={projects} invoices={invoices} rateOverrides={rateOverrides} nav={nav} />}
        {tab === 'invoices' && canManage && <InvoicesTab {...props} invoices={invoices} reports={reports} projects={projects} nav={nav} initialFilter={invoiceFilter} />}
        {tab === 'workorders' && <WorkOrdersTab {...props} />}
        {tab === 'shopping' && <ShoppingTab {...props} />}
        {tab === 'properties' && canManage && <PropertiesTab properties={props.properties} onSaveProperties={props.onSaveProperties} />}
        {tab === 'rates' && canManage && <RatesTab rates={rates} onSaveRates={props.onSaveRates} />}
      </div>
      <div className="text-center text-[11px] text-gray-400 pb-4">
        {isAdmin ? 'Admin' : canManage ? 'Contracting Manager' : 'Contractor'} · {currentUser.name}
      </div>
      </div>
      {/* Invoice viewer — opened from any tab (Invoices, a phase, a report). */}
      {viewedInvoice && canManage && (
        <InvoiceView
          invoice={viewedInvoice}
          project={props.projects[viewedInvoice.projectId]}
          report={viewedInvoice.reportId ? props.reports[viewedInvoice.reportId] : undefined}
          canSeeInternal={canManage}
          onClose={() => setViewInvoiceId(null)}
          onGoToPhase={viewedInvoice.phaseId ? () => { setViewInvoiceId(null); nav.goToPhase(viewedInvoice.projectId, viewedInvoice.phaseId); } : undefined}
          onGoToReports={viewedInvoice.reportId ? () => { setViewInvoiceId(null); nav.goToReports(); } : undefined}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────── MY TIME ──────
// Clock in/out against a project + T&M phase. Visible to ALL contracting
// users; shows NO dollar figures unless the viewer is a manager.
function MyTimeTab(p: Ctx & { rates: ContractingRateCard; timeEntries: ContractingTimeEntry[]; projects: ContractingProject[] }) {
  const me = p.currentUser;
  const mine = p.timeEntries.filter(t => t.contractorId === me.id).sort((a, b) => b.clockIn - a.clockIn).slice(0, 12);
  const projName = (id: string) => p.projects.find(x => x.id === id)?.name || '—';
  const phaseName = (pid: string, phid: string) => p.projects.find(x => x.id === pid)?.phases.find(ph => ph.id === phid)?.name || '—';
  return (
    <div>
      <h2 className="font-bold text-lg mb-2" style={{ color: PALERMO.slate }}>My time</h2>
      <ClockPanel {...p} timeEntries={p.timeEntries} />
      <div className="mt-4">
        <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Recent sessions</div>
        <div className="space-y-1">
          {mine.map(t => (
            <div key={t.id} className="bg-white rounded border p-2 text-sm flex items-center justify-between">
              <span>{projName(t.projectId)} · {phaseName(t.projectId, t.phaseId)}</span>
              <span className="text-gray-500">
                {new Date(t.clockIn).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                {t.clockOut ? ` · ${((t.clockOut - t.clockIn) / 3600000).toFixed(2)}h` : ' · open'}
                {t.status === 'invoiced' && <span className="ml-1 text-[10px] px-1 rounded bg-slate-100">billed</span>}
              </span>
            </div>
          ))}
          {mine.length === 0 && <div className="text-gray-400 text-sm">No sessions yet.</div>}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────── PROJECTS ──────
function ProjectsTab(p: Ctx & { rates: ContractingRateCard; invoices: ContractingInvoice[]; projects: ContractingProject[]; reports: ContractingProgressReport[]; timeEntries: ContractingTimeEntry[]; rateOverrides: Record<string, number>; nav: Nav; focusProjectId: string | null; onConsumeFocus: () => void }) {
  // Board opens to the only active client project (Feaver Rd) by default.
  const feaver = p.projects.find(x => /feaver/i.test(x.name)) || (p.projects.filter(x => x.status !== 'closed').length === 1 ? p.projects.find(x => x.status !== 'closed') : undefined);
  const [selId, setSelId] = useState<string | null>(p.focusProjectId || feaver?.id || null);
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  // A cross-tab jump (e.g. from an invoice's phase link) focuses a project.
  useEffect(() => { if (p.focusProjectId) { setSelId(p.focusProjectId); p.onConsumeFocus(); } }, [p.focusProjectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = selId ? p.projects.find(x => x.id === selId) : null;
  const activeProjects = p.projects.filter(x => !x.archived);
  const archivedProjects = p.projects.filter(x => x.archived);

  if (sel) return <ProjectDetail project={sel} {...p} onBack={() => setSelId(null)} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-lg" style={{ color: PALERMO.slate }}>Projects</h2>
        {p.canManage && <button onClick={() => setAdding(true)} className="px-3 py-1.5 rounded text-white text-sm font-semibold" style={{ backgroundColor: PALERMO.gold }}>+ New project</button>}
      </div>
      {activeProjects.length === 0 && <div className="text-gray-500 text-sm">No active projects.</div>}
      <div className="space-y-2">
        {activeProjects.map(proj => {
          const b = phaseBillables(proj.id, undefined, p.invoices);
          return (
            <button key={proj.id} onClick={() => setSelId(proj.id)} className="w-full text-left bg-white rounded-lg border p-3 hover:shadow">
              <div className="flex items-center justify-between">
                <div className="font-semibold" style={{ color: PALERMO.slate }}>{proj.name}</div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100">{STATUS_LABEL[proj.status]}</span>
              </div>
              {proj.client && <div className="text-sm text-gray-600">{proj.client.name}{proj.client.contact ? ` · ${proj.client.contact}` : ''}</div>}
              <div className="text-xs text-gray-500 mt-1">{proj.phases.length} phase{proj.phases.length === 1 ? '' : 's'} · Outstanding {money(b.outstandingPreHst)} pre-HST</div>
            </button>
          );
        })}
      </div>

      {/* Archived projects — hidden by default, restorable, data intact. */}
      {archivedProjects.length > 0 && (
        <div className="mt-4">
          <button onClick={() => setShowArchived(s => !s)} className="text-xs font-semibold text-gray-500 uppercase">{showArchived ? '▾' : '▸'} Archived ({archivedProjects.length})</button>
          {showArchived && (
            <div className="space-y-2 mt-2">
              {archivedProjects.map(proj => (
                <div key={proj.id} className="bg-white/60 rounded-lg border p-3 opacity-70">
                  <div className="flex items-center justify-between">
                    <button onClick={() => setSelId(proj.id)} className="font-semibold text-left" style={{ color: PALERMO.slate }}>{proj.name}</button>
                    <button onClick={() => p.onArchiveProject(proj.id, false)} className="text-xs px-2 py-1 rounded border font-semibold" style={{ color: PALERMO.slate }}>Restore</button>
                  </div>
                  <div className="text-[10px] text-gray-400">Archived{proj.archivedBy ? ` by ${proj.archivedBy}` : ''}{proj.archivedAt ? ` · ${fmtDate(proj.archivedAt)}` : ''}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {adding && <ProjectForm onClose={() => setAdding(false)} onSave={pr => { p.onSaveProject(pr); setAdding(false); }} currentUser={p.currentUser} />}
    </div>
  );
}

function ProjectForm({ onClose, onSave, currentUser }: { onClose: () => void; onSave: (p: ContractingProject) => void; currentUser: { id: string; name: string } }) {
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [contact, setContact] = useState('');
  const [status, setStatus] = useState<ContractingStatus>('planned');
  return (
    <Modal title="New project" onClose={onClose}>
      <Field label="Project name"><input className="inp" value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="Client name"><input className="inp" value={clientName} onChange={e => setClientName(e.target.value)} /></Field>
      <Field label="Client contact"><input className="inp" value={contact} onChange={e => setContact(e.target.value)} /></Field>
      <Field label="Status"><StatusSelect value={status} onChange={setStatus} /></Field>
      <ModalActions onClose={onClose} disabled={!name.trim()} onSave={() => onSave({
        id: uid('cproj'), name: name.trim(), status,
        client: clientName.trim() ? { name: clientName.trim(), contact: contact.trim() || undefined } : undefined,
        phases: [], createdBy: currentUser, createdAt: Date.now(), updatedAt: Date.now(),
      })} />
    </Modal>
  );
}

// Delete confirm — a project is not a casual swipe-away: type its exact name.
function DeleteProjectForm({ project, onClose, onDelete }: { project: ContractingProject; onClose: () => void; onDelete: () => void }) {
  const [typed, setTyped] = useState('');
  const match = typed.trim() === project.name;
  return (
    <Modal title="Delete project" onClose={onClose}>
      <div className="text-sm text-gray-700 mb-2">This permanently deletes <b>{project.name}</b>. Only empty projects can be deleted (no invoices, reports, or time). This can't be undone.</div>
      <Field label={`Type the project name to confirm`}><input className="inp" value={typed} onChange={e => setTyped(e.target.value)} placeholder={project.name} autoFocus /></Field>
      <div className="flex gap-2 mt-2">
        <button onClick={onClose} className="flex-1 py-2.5 rounded border font-semibold">Cancel</button>
        <button onClick={onDelete} disabled={!match} className="flex-1 py-2.5 rounded text-white font-bold disabled:opacity-40" style={{ backgroundColor: '#C0392B' }}>Delete permanently</button>
      </div>
    </Modal>
  );
}

function ProjectDetail(p: Ctx & { project: ContractingProject; rates: ContractingRateCard; invoices: ContractingInvoice[]; reports: ContractingProgressReport[]; timeEntries: ContractingTimeEntry[]; rateOverrides: Record<string, number>; nav: Nav; onBack: () => void }) {
  const { project, canManage } = p;
  const [addingPhase, setAddingPhase] = useState(false);
  const [editing, setEditing] = useState(false);
  const save = (updater: (proj: ContractingProject) => ContractingProject) => p.onSaveProject({ ...updater(project), updatedAt: Date.now() });
  const removePhase = (phaseId: string) => save(pr => ({ ...pr, phases: pr.phases.filter(x => x.id !== phaseId) }));
  const unbilled = unbilledLabour(project.id, p.timeEntries, p.reports, p.rates, Date.now(), p.rateOverrides);
  const phaseName = (id: string) => project.phases.find(ph => ph.id === id)?.name || '—';
  const [deleting, setDeleting] = useState(false);
  const [merging, setMerging] = useState(false);
  const removable = projectIsRemovable(project.id, p.invoices, p.reports, p.timeEntries);
  const rollup = projectBillables(project, p.invoices, p.reports);

  return (
    <div>
      <button onClick={p.onBack} className="text-sm mb-2" style={{ color: PALERMO.slate }}>← All projects</button>
      <div className="bg-white rounded-lg border p-3 mb-3">
        <div className="flex items-center justify-between">
          {editing
            ? <input className="inp font-bold text-lg flex-1 mr-2" defaultValue={project.name} onBlur={e => e.target.value.trim() && save(pr => ({ ...pr, name: e.target.value.trim() }))} />
            : <h2 className="font-bold text-lg" style={{ color: PALERMO.slate }}>{project.name}</h2>}
          <div className="flex items-center gap-2">
            {canManage && <StatusSelect value={project.status} onChange={s => save(pr => ({ ...pr, status: s }))} />}
            {canManage && <button onClick={() => setEditing(e => !e)} className="text-xs px-2 py-1 rounded border font-semibold" style={{ color: PALERMO.slate }}>{editing ? 'Done' : 'Edit'}</button>}
          </div>
        </div>
        {editing ? (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <input className="inp text-sm" placeholder="Client name" defaultValue={project.client?.name || ''} onBlur={e => save(pr => ({ ...pr, client: { name: e.target.value.trim(), contact: pr.client?.contact } }))} />
            <input className="inp text-sm" placeholder="Client contact" defaultValue={project.client?.contact || ''} onBlur={e => save(pr => ({ ...pr, client: { name: pr.client?.name || '', contact: e.target.value.trim() || undefined } }))} />
          </div>
        ) : (
          <>
            {project.client && <div className="text-sm text-gray-700">{project.client.name}{project.client.contact ? ` · ${project.client.contact}` : ''}</div>}
            {project.propertyRef && <div className="text-xs text-gray-500">Property: {project.propertyRef}</div>}
          </>
        )}
        {canManage && (
          <div className="mt-2">
            <label className="text-xs font-semibold text-gray-500">Internal notes (never client-facing)</label>
            <textarea className="inp mt-1" rows={2} defaultValue={project.notes || ''} onBlur={e => save(pr => ({ ...pr, notes: e.target.value }))} />
          </div>
        )}
        {/* Danger zone — archive (reversible) or delete (only when empty). */}
        {canManage && editing && (
          <div className="mt-3 pt-2 border-t flex items-center gap-2 flex-wrap">
            <button onClick={() => p.onArchiveProject(project.id, true)} className="text-xs px-2.5 py-1.5 rounded border font-semibold" style={{ color: PALERMO.slate }}>Archive</button>
            {removable
              ? <button onClick={() => setDeleting(true)} className="text-xs px-2.5 py-1.5 rounded border font-semibold text-red-600 border-red-300">Delete…</button>
              : <span className="text-[11px] text-gray-400">Has attached billing/time — archive instead of deleting.</span>}
          </div>
        )}
      </div>

      {deleting && <DeleteProjectForm project={project} onClose={() => setDeleting(false)} onDelete={() => { p.onDeleteProject(project.id); setDeleting(false); p.onBack(); }} />}

      {/* Project billables rollup — sums ALL phases. Pre-HST with incl-HST. */}
      <div className="rounded-lg border p-3 mb-3" style={{ backgroundColor: PALERMO.slate }}>
        <div className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: PALERMO.gold }}>Billables — whole project</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <RollupStat label="Invoiced" pre={rollup.invoicedPreHst} full={rollup.invoicedWithHst} />
          <RollupStat label="Collected" pre={rollup.collectedPreHst} full={rollup.collectedWithHst} />
          <RollupStat label="Outstanding" pre={rollup.outstandingPreHst} full={rollup.outstandingWithHst} accent />
        </div>
        <div className="mt-2 pt-2 border-t border-white/10 text-xs" style={{ color: '#D5DBDB' }}>
          Remaining expected: <b style={{ color: 'white' }}>{money(rollup.remainingFixedPreHst)}</b> pre-HST <span className="opacity-70">({money(rollup.remainingFixedWithHst)} incl.)</span> in fixed completion balances{rollup.hasOpenTm ? ' · open T&M accrues on top' : ''}.
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold" style={{ color: PALERMO.slate }}>Phases</h3>
        <div className="flex items-center gap-2">
          {canManage && project.phases.length >= 2 && <button onClick={() => setMerging(true)} className="text-sm px-2.5 py-1 rounded border font-semibold" style={{ color: PALERMO.slate }}>Merge phases</button>}
          {canManage && <button onClick={() => setAddingPhase(true)} className="text-sm px-2.5 py-1 rounded text-white font-semibold" style={{ backgroundColor: PALERMO.gold }}>+ Phase</button>}
        </div>
      </div>
      {merging && <MergePhasesForm project={project} onClose={() => setMerging(false)} onMerge={(s, t, name) => { p.onMergePhases(project.id, s, t, name); setMerging(false); }} />}
      <div className="space-y-3">
        {project.phases.map(phase => (
          <PhaseCard key={phase.id} phase={phase} project={project} {...p} onUpdatePhase={np => save(pr => ({ ...pr, phases: pr.phases.map(x => x.id === np.id ? np : x) }))} onRemovePhase={() => removePhase(phase.id)} />
        ))}
        {project.phases.length === 0 && <div className="text-gray-500 text-sm">No phases yet.</div>}
      </div>

      {/* Unbilled labour — completed sessions not captured by any invoiced or
          open report (clocked in a gap / on a phase with no open period). Pull
          them into an open report from the Reports tab. */}
      {unbilled.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-sm uppercase" style={{ color: '#C0392B' }}>Unbilled labour</h3>
            <span className="text-xs text-gray-500">{unbilled.length} entr{unbilled.length === 1 ? 'y' : 'ies'} · {round2(unbilled.reduce((s, u) => s + u.hours, 0))} hrs · {money(unbilled.reduce((s, u) => s + u.amount, 0))}</span>
          </div>
          <div className="bg-white rounded-lg border divide-y">
            {unbilled.map(u => (
              <div key={u.entry.id} className="p-2 flex items-center justify-between text-sm">
                <span>{u.entry.contractorName} <span className="text-gray-400">· {phaseName(u.entry.phaseId)} · {fmtDate(u.entry.clockIn)}</span></span>
                <span className="text-gray-600">{u.hours}h · <b style={{ color: PALERMO.slate }}>{money(u.amount)}</b></span>
              </div>
            ))}
          </div>
          <button onClick={() => p.nav.goToReports()} className="text-xs mt-1" style={{ color: PALERMO.slate }}>Attach from an open report →</button>
        </div>
      )}

      {addingPhase && <PhaseForm onClose={() => setAddingPhase(false)} onSave={ph => { save(pr => ({ ...pr, phases: [...pr.phases, ph] })); setAddingPhase(false); }} />}
    </div>
  );
}

function PhaseForm({ onClose, onSave }: { onClose: () => void; onSave: (p: ContractingPhase) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'fixed' | 'tm'>('fixed');
  const [fixedPrice, setFixedPrice] = useState('');
  const [description, setDescription] = useState('');
  return (
    <Modal title="New phase" onClose={onClose}>
      <Field label="Phase name"><input className="inp" value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="Type">
        <div className="flex gap-2">
          {(['fixed', 'tm'] as const).map(t => (
            <button key={t} onClick={() => setType(t)} className="flex-1 py-2 rounded border text-sm font-semibold" style={type === t ? { backgroundColor: PALERMO.slate, color: 'white' } : {}}>{t === 'fixed' ? 'Fixed price' : 'Time & Materials'}</button>
          ))}
        </div>
      </Field>
      {type === 'fixed' && <Field label="Fixed price (pre-HST)"><input className="inp" type="number" value={fixedPrice} onChange={e => setFixedPrice(e.target.value)} /></Field>}
      <Field label="Description"><textarea className="inp" rows={2} value={description} onChange={e => setDescription(e.target.value)} /></Field>
      <ModalActions onClose={onClose} disabled={!name.trim()} onSave={() => onSave({
        id: uid('cph'), name: name.trim(), type, status: 'planned',
        fixedPrice: type === 'fixed' ? Number(fixedPrice) || 0 : undefined,
        description: description.trim() || undefined,
        checklist: [], tmStartAt: type === 'tm' ? Date.now() : undefined,
      })} />
    </Modal>
  );
}

// Edit an existing phase. GUARDS: fixed↔T&M is locked once the phase has
// invoiced billing; a fixed-price change is audited (who/when/from→to);
// removal is offered only when nothing is attached (else deactivate via status).
function PhaseEditForm({ phase, hasBilling, removable, currentUser, onClose, onSave, onRemove }: {
  phase: ContractingPhase; hasBilling: boolean; removable: boolean; currentUser: { id: string; name: string };
  onClose: () => void; onSave: (p: ContractingPhase) => void; onRemove: () => void;
}) {
  const [name, setName] = useState(phase.name);
  const [type, setType] = useState<ContractingPhaseType>(phase.type);
  const [fixedPrice, setFixedPrice] = useState(phase.fixedPrice != null ? String(phase.fixedPrice) : '');
  const [description, setDescription] = useState(phase.description || '');
  const [note, setNote] = useState(phase.note || '');
  const commit = () => {
    const newPrice = type === 'fixed' ? (Number(fixedPrice) || 0) : undefined;
    let priceAudit = phase.priceAudit;
    // Audit a fixed-price change.
    if (phase.type === 'fixed' && type === 'fixed' && (phase.fixedPrice || 0) !== (newPrice || 0)) {
      priceAudit = [...(phase.priceAudit || []), { at: Date.now(), by: currentUser.name, from: phase.fixedPrice || 0, to: newPrice || 0 }];
    }
    onSave({
      ...phase, name: name.trim() || phase.name,
      type: hasBilling ? phase.type : type,   // locked when billed
      fixedPrice: (hasBilling ? phase.type : type) === 'fixed' ? newPrice : undefined,
      description: description.trim() || undefined, note: note.trim() || undefined, priceAudit,
    });
  };
  return (
    <Modal title={`Edit ${phase.name}`} onClose={onClose}>
      <Field label="Phase name"><input className="inp" value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="Type">
        {hasBilling ? (
          <div className="text-sm px-3 py-2 rounded bg-slate-50 border">
            <b>{phase.type === 'tm' ? 'Time & Materials' : 'Fixed price'}</b> — <span className="text-gray-500">locked (phase has invoiced billing)</span>
          </div>
        ) : (
          <div className="flex gap-2">
            {(['fixed', 'tm'] as const).map(t => (
              <button key={t} onClick={() => setType(t)} className="flex-1 py-2 rounded border text-sm font-semibold" style={type === t ? { backgroundColor: PALERMO.slate, color: 'white' } : {}}>{t === 'fixed' ? 'Fixed price' : 'Time & Materials'}</button>
            ))}
          </div>
        )}
      </Field>
      {(hasBilling ? phase.type : type) === 'fixed' && (
        <Field label="Fixed price (pre-HST) — edits audited"><input className="inp" type="number" value={fixedPrice} onChange={e => setFixedPrice(e.target.value)} /></Field>
      )}
      <Field label="Description"><textarea className="inp" rows={2} value={description} onChange={e => setDescription(e.target.value)} /></Field>
      <Field label="Note (e.g. approval)"><input className="inp" value={note} onChange={e => setNote(e.target.value)} /></Field>
      {phase.priceAudit && phase.priceAudit.length > 0 && (
        <div className="text-[11px] text-gray-400 mb-2">
          <div className="font-semibold uppercase tracking-wide">Price history</div>
          {phase.priceAudit.map((a, i) => <div key={i}>{money(a.from)} → {money(a.to)} · {a.by} · {fmtDate(a.at)}</div>)}
        </div>
      )}
      <div className="flex gap-2 mt-2">
        {removable
          ? <button onClick={() => confirm(`Remove phase "${phase.name}"?`) && onRemove()} className="px-3 py-2.5 rounded border font-semibold text-red-600">Remove</button>
          : <span className="text-[11px] text-gray-400 self-center flex-1">Has attached billing/time — can't remove; set status to On Hold/Closed instead.</span>}
        <button onClick={onClose} className="flex-1 py-2.5 rounded border font-semibold">Cancel</button>
        <button onClick={commit} disabled={!name.trim()} className="flex-1 py-2.5 rounded text-white font-bold disabled:opacity-40" style={{ backgroundColor: PALERMO.gold }}>Save</button>
      </div>
    </Modal>
  );
}

function PhaseCard(p: Ctx & { phase: ContractingPhase; project: ContractingProject; rates: ContractingRateCard; invoices: ContractingInvoice[]; reports: ContractingProgressReport[]; timeEntries: ContractingTimeEntry[]; nav: Nav; onUpdatePhase: (ph: ContractingPhase) => void; onRemovePhase: () => void }) {
  const { phase, project, canManage, currentUser, nav } = p;
  const b = phaseBillables(project.id, phase.id, p.invoices);
  const ready = phaseReadyToBill(phase);
  const [newItem, setNewItem] = useState('');
  const [editing, setEditing] = useState(false);
  const hasBilling = phaseHasInvoicedBilling(project.id, phase.id, p.invoices, p.reports);
  const removable = phaseIsRemovable(project.id, phase.id, p.invoices, p.reports, p.timeEntries);
  // This phase's invoices + reports, for two-way linkage.
  const phaseInvoices = p.invoices.filter(i => i.projectId === project.id && i.phaseId === phase.id).sort((a, b2) => (a.issuedAt || 0) - (b2.issuedAt || 0));
  const phaseReports = p.reports.filter(r => r.projectId === project.id && r.phaseId === phase.id).sort((a, b2) => a.reportNumber - b2.reportNumber);

  const toggleDone = (item: ContractingChecklistItem) => {
    if (!canManage) return;
    const done = !item.done;
    p.onUpdatePhase({ ...phase, checklist: phase.checklist.map(c => c.id === item.id ? { ...c, done, doneBy: done ? currentUser.name : undefined, doneAt: done ? Date.now() : undefined } : c) });
  };
  const toggleReq = (item: ContractingChecklistItem) => canManage && p.onUpdatePhase({ ...phase, checklist: phase.checklist.map(c => c.id === item.id ? { ...c, required: !c.required } : c) });
  const addItem = () => { if (!newItem.trim()) return; p.onUpdatePhase({ ...phase, checklist: [...phase.checklist, { id: uid('chk'), text: newItem.trim(), required: true, done: false }] }); setNewItem(''); };

  return (
    <div className="bg-white rounded-lg border p-3">
      <div className="flex items-center justify-between flex-wrap gap-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold" style={{ color: PALERMO.slate }}>{phase.name}</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: phase.type === 'tm' ? '#EBF5FB' : '#FEF9E7', color: phase.type === 'tm' ? '#2874A6' : PALERMO.gold }}>{phase.type === 'tm' ? 'T&M' : 'FIXED'}</span>
        </div>
        <div className="flex items-center gap-2">
          {canManage
            ? <StatusSelect value={phase.status} onChange={s => p.onUpdatePhase({ ...phase, status: s })} small />
            : <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100">{STATUS_LABEL[phase.status]}</span>}
          {canManage && <button onClick={() => setEditing(true)} className="text-xs px-2 py-0.5 rounded border font-semibold" style={{ color: PALERMO.slate }}>Edit</button>}
        </div>
      </div>
      {editing && <PhaseEditForm phase={phase} hasBilling={hasBilling} removable={removable} currentUser={currentUser}
        onClose={() => setEditing(false)}
        onSave={np => { p.onUpdatePhase(np); setEditing(false); }}
        onRemove={() => { p.onRemovePhase(); setEditing(false); }} />}
      {phase.description && <div className="text-sm text-gray-600 mt-1">{phase.description}</div>}
      {phase.note && <div className="text-xs mt-1 px-2 py-1 rounded" style={{ backgroundColor: '#FEF9E7', color: PALERMO.gold }}>⚑ {phase.note}</div>}

      {phase.type === 'fixed' && phase.fixedPrice != null && (
        <div className="text-sm mt-1 text-gray-700">
          Fixed: <b>{money(phase.fixedPrice)}</b> pre-HST · {money(withHst(phase.fixedPrice).total)} incl. HST
          {round2(phase.fixedPrice - b.invoicedPreHst) > 0 && (
            <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#FEF9E7', color: PALERMO.gold }}>
              Completion balance to bill: {money(round2(phase.fixedPrice - b.invoicedPreHst))}{ready ? '' : ' (checklist pending)'}
            </span>
          )}
        </div>
      )}

      {/* Billables */}
      <div className="grid grid-cols-3 gap-2 mt-2 text-center">
        <Billable label="Invoiced" pre={b.invoicedPreHst} full={b.invoicedWithHst} />
        <Billable label="Paid" pre={b.paidPreHst} full={b.paidWithHst} />
        <Billable label="Outstanding" pre={b.outstandingPreHst} full={b.outstandingWithHst} accent />
      </div>

      {/* Completion checklist */}
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-gray-500 uppercase">Completion checklist</div>
          {ready && <span className="text-[11px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: PALERMO.gold, color: 'white' }}>READY TO BILL</span>}
        </div>
        <div className="space-y-1 mt-1">
          {phase.checklist.map(item => (
            <div key={item.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={item.done} disabled={!canManage} onChange={() => toggleDone(item)} className="w-4 h-4" />
              <span className={item.done ? 'line-through text-gray-400' : ''}>{item.text}</span>
              <button onClick={() => toggleReq(item)} disabled={!canManage} className="text-[10px] px-1.5 rounded" style={item.required ? { backgroundColor: PALERMO.slate, color: 'white' } : { backgroundColor: '#eee', color: '#888' }}>{item.required ? 'required' : 'optional'}</button>
              {item.done && item.doneBy && <span className="text-[10px] text-gray-400 ml-auto">{item.doneBy} · {fmtDate(item.doneAt)}</span>}
            </div>
          ))}
          {phase.checklist.length === 0 && <div className="text-xs text-gray-400">No items.</div>}
        </div>
        {canManage && (
          <div className="flex gap-2 mt-2">
            <input className="inp flex-1" placeholder="Add checklist item" value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && addItem()} />
            <button onClick={addItem} className="px-2.5 rounded text-white text-sm" style={{ backgroundColor: PALERMO.slate }}>Add</button>
          </div>
        )}
      </div>

      {/* Linkage: this phase's invoices + reports, tap-through both ways. */}
      {(phaseInvoices.length > 0 || phaseReports.length > 0) && (
        <div className="mt-3 border-t pt-2">
          <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Invoices & reports</div>
          <div className="space-y-1">
            {phaseInvoices.map(inv => (
              <button key={inv.id} onClick={() => nav.openInvoice(inv.id)} className="w-full flex items-center justify-between text-sm px-2 py-1 rounded hover:bg-slate-50 text-left">
                <span><b style={{ color: PALERMO.slate }}>{inv.number}</b> <span className="text-[10px] px-1 rounded bg-slate-100 uppercase">{inv.kind}</span> {inv.paid ? <span className="text-[10px] text-green-600">paid</span> : <span className="text-[10px] text-amber-600">outstanding</span>}</span>
                <span>{money(inv.total)} →</span>
              </button>
            ))}
            {phaseReports.map(r => {
              const minted = r.status === 'invoiced' ? p.invoices.find(i => i.reportId === r.id) : undefined;
              return (
                <div key={r.id} className="flex items-center justify-between text-sm px-2 py-1">
                  <span className="text-gray-600">Report #{r.reportNumber} · {r.status === 'open' ? <button onClick={() => nav.goToReports()} className="underline decoration-dotted" style={{ color: '#2874A6' }}>OPEN →</button> : `${fmtDate(r.startAt)}–${fmtDate(r.endAt)}`}</span>
                  {minted && <button onClick={() => nav.openInvoice(minted.id)} className="text-xs underline decoration-dotted" style={{ color: PALERMO.slate }}>→ {minted.number}</button>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function RollupStat({ label, pre, full, accent }: { label: string; pre: number; full: number; accent?: boolean }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide" style={{ color: '#AEB6BF' }}>{label}</div>
      <div className="text-sm font-bold" style={{ color: accent ? PALERMO.gold : 'white' }}>{money(pre)}</div>
      <div className="text-[9px]" style={{ color: '#85929E' }}>{money(full)} w/HST</div>
    </div>
  );
}

// Merge one phase into another (target survives). Same billing type only.
function MergePhasesForm({ project, onClose, onMerge }: { project: ContractingProject; onClose: () => void; onMerge: (sourceId: string, targetId: string, mergedName?: string) => void }) {
  const phases = project.phases;
  const [target, setTarget] = useState(phases[0]?.id || '');
  const [source, setSource] = useState(phases.find(p => p.id !== phases[0]?.id)?.id || '');
  const [name, setName] = useState('');
  const t = phases.find(p => p.id === target);
  const s = phases.find(p => p.id === source);
  const sameType = !!t && !!s && t.type === s.type;
  const valid = sameType && source !== target;
  return (
    <Modal title="Merge phases" onClose={onClose}>
      <div className="text-xs text-gray-500 mb-2">The KEEP phase survives (its invoices, reports, and time stay put); the folded-in phase's records re-point to it, and it's removed. Checklists and notes combine. Same billing type only.</div>
      <Field label="Keep (target)">
        <select className="inp" value={target} onChange={e => { setTarget(e.target.value); if (e.target.value === source) setSource(phases.find(p => p.id !== e.target.value)?.id || ''); }}>
          {phases.map(ph => <option key={ph.id} value={ph.id}>{ph.name} ({ph.type === 'tm' ? 'T&M' : 'Fixed'})</option>)}
        </select>
      </Field>
      <Field label="Fold in (source)">
        <select className="inp" value={source} onChange={e => setSource(e.target.value)}>
          {phases.filter(ph => ph.id !== target).map(ph => <option key={ph.id} value={ph.id}>{ph.name} ({ph.type === 'tm' ? 'T&M' : 'Fixed'})</option>)}
        </select>
      </Field>
      {!sameType && s && t && <div className="text-xs text-red-600 mb-2">Phases must share a billing type (both Fixed or both T&M).</div>}
      <Field label="Merged phase name"><input className="inp" value={name} onChange={e => setName(e.target.value)} placeholder={t?.name} /></Field>
      <ModalActions onClose={onClose} disabled={!valid} onSave={() => onMerge(source, target, name.trim() || undefined)} />
    </Modal>
  );
}

function StageBadge({ stage }: { stage: 'minted' | 'sent' | 'paid' }) {
  const cfg = stage === 'paid' ? { bg: '#D5F5E3', fg: '#1E8449', t: 'PAID' }
    : stage === 'sent' ? { bg: '#EBF5FB', fg: '#2874A6', t: 'SENT' }
    : { bg: '#FEF9E7', fg: '#B7950B', t: 'MINTED' };
  return <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>{cfg.t}</span>;
}

function Billable({ label, pre, full, accent }: { label: string; pre: number; full: number; accent?: boolean }) {
  return (
    <div className="rounded p-1.5" style={{ backgroundColor: accent ? '#FEF9E7' : '#F8F9F9' }}>
      <div className="text-[10px] text-gray-500 uppercase">{label}</div>
      <div className="text-sm font-bold" style={{ color: accent ? PALERMO.gold : PALERMO.slate }}>{money(pre)}</div>
      <div className="text-[10px] text-gray-400">{money(full)} w/HST</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────── REPORTS ──────
function ReportsTab(p: Ctx & { rates: ContractingRateCard; reports: ContractingProgressReport[]; timeEntries: ContractingTimeEntry[]; contractors: Employee[]; projects: ContractingProject[]; invoices: ContractingInvoice[]; rateOverrides: Record<string, number>; nav: Nav }) {
  const { canManage } = p;
  // Minted invoice for a closed report (report → invoice linkage).
  const invoiceForReport = (reportId: string) => p.invoices.find(i => i.reportId === reportId);
  // T&M phases across projects, with their open report (if any).
  const tmPhases = p.projects.flatMap(proj => proj.phases.filter(ph => ph.type === 'tm').map(ph => ({ proj, ph })));
  const openReportFor = (projectId: string, phaseId: string) => p.reports.find(r => r.projectId === projectId && r.phaseId === phaseId && r.status === 'open');

  return (
    <div>
      <h2 className="font-bold text-lg mb-2" style={{ color: PALERMO.slate }}>Progress reports <span className="text-xs font-normal text-gray-500">(T&amp;M billing)</span></h2>
      {tmPhases.length === 0 && <div className="text-gray-500 text-sm mt-3">No T&M phases. Add a Time &amp; Materials phase to a project to start billing periods.</div>}
      <div className="space-y-3 mt-3">
        {tmPhases.map(({ proj, ph }) => {
          const open = openReportFor(proj.id, ph.id);
          return (
            <div key={ph.id} className="bg-white rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div><span className="font-semibold" style={{ color: PALERMO.slate }}>{proj.name}</span> <span className="text-gray-500">· {ph.name}</span></div>
                {!open && canManage && <button onClick={() => p.onOpenReport(proj.id, ph.id)} className="text-sm px-2.5 py-1 rounded text-white font-semibold" style={{ backgroundColor: PALERMO.gold }}>Open billing period</button>}
              </div>
              {open && <OpenReport report={open} project={proj} phase={ph} {...p} />}
              {!open && <div className="text-xs text-gray-400 mt-1">No open billing period.</div>}
            </div>
          );
        })}
      </div>

      {/* Historic (invoiced) reports */}
      {p.reports.some(r => r.status === 'invoiced') && (
        <div className="mt-5">
          <h3 className="font-semibold text-sm text-gray-500 uppercase mb-1">Closed reports</h3>
          <div className="space-y-1">
            {p.reports.filter(r => r.status === 'invoiced').sort((a, b) => (b.endAt || 0) - (a.endAt || 0)).map(r => {
              const proj = p.projects.find(x => x.id === r.projectId);
              const minted = invoiceForReport(r.id);
              return (
                <div key={r.id} className="bg-white rounded border p-2 text-sm flex items-center justify-between">
                  <span>{proj?.name} · Report #{r.reportNumber} · {fmtDate(r.startAt)}–{fmtDate(r.endAt)}{minted && <button onClick={() => p.nav.openInvoice(minted.id)} className="ml-2 text-xs underline decoration-dotted" style={{ color: PALERMO.slate }}>→ {minted.number}</button>}</span>
                  <b style={{ color: PALERMO.slate }}>{money(r.snapshot?.total || 0)}</b>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ClockPanel(p: Ctx & { projects: ContractingProject[]; timeEntries: ContractingTimeEntry[] }) {
  const me = p.currentUser;
  const myOpen = p.timeEntries.find(t => t.contractorId === me.id && !t.manual && !t.clockOut && t.status === 'open');
  const [projectId, setProjectId] = useState('');
  const [phaseId, setPhaseId] = useState('');
  const myEmp = p.employees.find(e => e.id === me.id);
  const myRole = (myEmp?.contractingBillingRole || 'general_labour') as ContractingBillingRole;
  const proj = p.projects.find(x => x.id === projectId);
  const tmPhases = proj?.phases.filter(ph => ph.type === 'tm') || [];

  if (myOpen) {
    const proj2 = p.projects.find(x => x.id === myOpen.projectId);
    const ph2 = proj2?.phases.find(x => x.id === myOpen.phaseId);
    return (
      <div className="rounded-lg p-3 text-white flex items-center justify-between" style={{ backgroundColor: PALERMO.slate }}>
        <div>
          <div className="text-xs" style={{ color: PALERMO.gold }}>Clocked in · {proj2?.name} · {ph2?.name}</div>
          <div className="text-sm">Since {new Date(myOpen.clockIn).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}</div>
        </div>
        <button onClick={() => p.onSaveTimeEntry({ ...myOpen, clockOut: Date.now() })} className="px-4 py-2 rounded font-bold" style={{ backgroundColor: PALERMO.gold, color: PALERMO.slate }}>Clock out</button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="text-xs font-semibold text-gray-500 uppercase mb-1">My clock · {ROLE_LABEL[myRole]}{p.canManage ? ` @ ${money(contractorRate(myEmp, ratesOrDefault(p.rates)))}/hr` : ''}</div>
      <div className="flex flex-wrap gap-2">
        <select className="inp flex-1 min-w-[130px]" value={projectId} onChange={e => { setProjectId(e.target.value); setPhaseId(''); }}>
          <option value="">Project…</option>
          {p.projects.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
        </select>
        <select className="inp flex-1 min-w-[130px]" value={phaseId} onChange={e => setPhaseId(e.target.value)} disabled={!projectId}>
          <option value="">T&M phase…</option>
          {tmPhases.map(ph => <option key={ph.id} value={ph.id}>{ph.name}</option>)}
        </select>
        <button disabled={!projectId || !phaseId} onClick={() => {
          p.onSaveTimeEntry({ id: uid('cte'), projectId, phaseId, contractorId: me.id, contractorName: me.name, billingRole: myRole, clockIn: Date.now(), status: 'open', createdBy: me, createdAt: Date.now() });
          setProjectId(''); setPhaseId('');
        }} className="px-4 py-2 rounded font-bold text-white disabled:opacity-40" style={{ backgroundColor: PALERMO.gold }}>Clock in</button>
      </div>
    </div>
  );
}

function OpenReport(p: Ctx & { report: ContractingProgressReport; project: ContractingProject; phase: ContractingPhase; rates: ContractingRateCard; timeEntries: ContractingTimeEntry[]; reports: ContractingProgressReport[]; contractors: Employee[]; rateOverrides: Record<string, number>; nav: Nav }) {
  const { report, canManage } = p;
  const now = Date.now();
  const labour = labourForReport(report, p.timeEntries, now);
  const snap = computeReportTotals(labour, report.receipts, p.rates, p.rateOverrides);
  const dayN = reportDayN(report.startAt, now);
  // Unbilled labour on THIS phase — the entries that can be pulled in.
  const unbilled = unbilledLabour(report.projectId, p.timeEntries, p.reports, p.rates, now, p.rateOverrides).filter(u => u.entry.phaseId === report.phaseId);
  const [addingReceipt, setAddingReceipt] = useState(false);
  const [addingTime, setAddingTime] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [viewPhotos, setViewPhotos] = useState<StoredFile[] | null>(null);

  const removeReceipt = (id: string) => p.onSaveReport({ ...report, receipts: report.receipts.filter(r => r.id !== id), updatedAt: Date.now() });
  const removeManual = (id: string) => p.onSaveReport({ ...report, manualTime: report.manualTime.filter(t => t.id !== id), updatedAt: Date.now() });

  return (
    <div className="mt-2 border-t pt-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">Report #{report.reportNumber} · since {fmtDate(report.startAt)}</span>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={dayN >= 14 ? { backgroundColor: '#F39C12', color: 'white' } : { backgroundColor: '#EBF5FB', color: '#2874A6' }}>Day {dayN} of 14{dayN >= 14 ? ' — time to bill' : ''}</span>
      </div>

      {/* Labour */}
      <div className="mt-2">
        <div className="text-[11px] font-semibold text-gray-500 uppercase">Labour</div>
        {snap.labourLines.length === 0 && <div className="text-xs text-gray-400">No time yet.</div>}
        {snap.labourLines.map(l => (
          <div key={l.contractorId + l.billingRole} className="flex justify-between text-sm">
            <span>{l.name} <span className="text-gray-400">· {l.hours}h × {money(l.rate)}</span></span>
            <b>{money(l.amount)}</b>
          </div>
        ))}
        {/* manual lines listing for removal */}
        {canManage && report.manualTime.map(t => (
          <div key={t.id} className="text-[11px] text-gray-400 flex justify-between"><span>manual: {t.contractorName} {t.hours}h</span><button onClick={() => removeManual(t.id)} className="text-red-400">remove</button></div>
        ))}
        {canManage && <div className="flex gap-3 mt-1"><button onClick={() => setAddingTime(true)} className="text-xs" style={{ color: PALERMO.slate }}>+ Manual time</button>{unbilled.length > 0 && <button onClick={() => setAttaching(true)} className="text-xs font-semibold" style={{ color: '#C0392B' }}>+ Add unbilled labour</button>}</div>}
        {/* Cadence nudge for unbilled labour sitting on this phase. */}
        {unbilled.length > 0 && (
          <div className="mt-1 text-[11px] px-2 py-1 rounded" style={{ backgroundColor: '#FDEDEC', color: '#C0392B' }}>
            {unbilled.length} unbilled entr{unbilled.length === 1 ? 'y' : 'ies'} · {round2(unbilled.reduce((s, u) => s + u.hours, 0))} hrs — <button onClick={() => setAttaching(true)} className="underline font-semibold">review</button>
          </div>
        )}
      </div>

      {/* Materials */}
      <div className="mt-2">
        <div className="text-[11px] font-semibold text-gray-500 uppercase">Materials (billed — cost/markup internal)</div>
        {report.receipts.length === 0 && <div className="text-xs text-gray-400">No receipts yet.</div>}
        {report.receipts.map(r => (
          <div key={r.id} className="flex justify-between text-sm items-center">
            <span>{r.description}
              {canManage && <span className="text-[10px] text-gray-400"> · cost {money(r.cost)} +{r.markupPct}%</span>}
              {r.photo && <button onClick={() => setViewPhotos([r.photo!])} className="text-[10px] ml-1" style={{ color: PALERMO.gold }}>📷</button>}
            </span>
            <span className="flex items-center gap-2"><b>{money(r.billed)}</b>{canManage && <button onClick={() => removeReceipt(r.id)} className="text-red-400 text-[11px]">×</button>}</span>
          </div>
        ))}
        {canManage && <button onClick={() => setAddingReceipt(true)} className="text-xs mt-1" style={{ color: PALERMO.slate }}>+ Receipt</button>}
      </div>

      {/* Live preview */}
      <div className="mt-3 rounded p-2" style={{ backgroundColor: '#F8F9F9' }}>
        <Row label="Labour subtotal" val={snap.labourSubtotal} />
        <Row label="Materials subtotal" val={snap.materialsSubtotal} />
        <Row label="Report total (pre-HST)" val={snap.subtotalPreHst} bold />
        <Row label={`HST (${(HST_PCT * 100).toFixed(0)}%)`} val={snap.hst} />
        <Row label="Total" val={snap.total} bold accent />
      </div>

      {canManage && (
        <button onClick={() => setReviewing(true)} disabled={snap.subtotalPreHst <= 0} className="w-full mt-2 py-2 rounded text-white font-bold disabled:opacity-40" style={{ backgroundColor: PALERMO.slate }}>
          End report &amp; bill →
        </button>
      )}

      {addingReceipt && <ReceiptForm project={p.project} uploadedBy={p.uploadedBy} currentUser={p.currentUser} onClose={() => setAddingReceipt(false)} onSave={rc => { p.onSaveReport({ ...report, receipts: [...report.receipts, rc], updatedAt: Date.now() }); setAddingReceipt(false); }} />}
      {addingTime && <ManualTimeForm report={report} contractors={p.contractors} rates={p.rates} currentUser={p.currentUser} onClose={() => setAddingTime(false)} onSave={t => { p.onSaveReport({ ...report, manualTime: [...report.manualTime, t], updatedAt: Date.now() }); setAddingTime(false); }} />}
      {attaching && <AttachUnbilledForm unbilled={unbilled} onClose={() => setAttaching(false)} onAttach={ids => { p.onAttachUnbilled(report.id, ids); setAttaching(false); }} />}
      {reviewing && <ReviewConfirm report={report} project={p.project} phase={p.phase} snap={snap} onClose={() => setReviewing(false)} onConfirm={() => { p.onEndReport(report.id); setReviewing(false); }} />}
      {viewPhotos && <PhotoViewer files={viewPhotos} onClose={() => setViewPhotos(null)} />}
    </div>
  );
}

function ReceiptForm({ project, uploadedBy, currentUser, onClose, onSave }: { project: ContractingProject; uploadedBy: { email: string; name: string }; currentUser: { id: string; name: string }; onClose: () => void; onSave: (r: ContractingReceipt) => void }) {
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [markup, setMarkup] = useState('0');
  const [ref, setRef] = useState('');
  const [photo, setPhoto] = useState<StoredFile | undefined>();
  const [uploading, setUploading] = useState(false);
  const billed = receiptBilled(Number(cost) || 0, Number(markup) || 0);
  return (
    <Modal title="Add receipt / material" onClose={onClose}>
      <Field label="Description"><input className="inp" value={description} onChange={e => setDescription(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Cost (internal, pre-HST)"><input className="inp" type="number" value={cost} onChange={e => setCost(e.target.value)} /></Field>
        <Field label="Markup %"><input className="inp" type="number" value={markup} onChange={e => setMarkup(e.target.value)} /></Field>
      </div>
      <div className="text-sm mb-2">Billed to client: <b style={{ color: PALERMO.gold }}>{money(billed)}</b> <span className="text-[10px] text-gray-400">(cost + markup never shown to client)</span></div>
      <Field label="Pre-approved ref (optional)"><input className="inp" value={ref} onChange={e => setRef(e.target.value)} /></Field>
      <Field label="Photo (optional)">
        <input type="file" accept="image/*,application/pdf" onChange={async e => {
          const f = e.target.files?.[0]; if (!f) return; setUploading(true);
          try { const sf = await uploadFile(`contracting/${project.id}`, f, { uploadedBy }); setPhoto(sf); } finally { setUploading(false); }
        }} />
        {uploading && <span className="text-xs text-gray-400">Uploading…</span>}
        {photo && <span className="text-xs text-green-600">✓ attached</span>}
      </Field>
      <ModalActions onClose={onClose} disabled={!description.trim() || uploading} onSave={() => onSave({
        id: uid('crc'), description: description.trim(), cost: Number(cost) || 0, markupPct: Number(markup) || 0, billed,
        photo, preApprovedRef: ref.trim() || undefined, addedBy: currentUser, addedAt: Date.now(),
      })} />
    </Modal>
  );
}

function ManualTimeForm({ report, contractors, rates, currentUser, onClose, onSave }: { report: ContractingProgressReport; contractors: Employee[]; rates: ContractingRateCard; currentUser: { id: string; name: string }; onClose: () => void; onSave: (t: ContractingTimeEntry) => void }) {
  const [contractorId, setContractorId] = useState(contractors[0]?.id || '');
  const [hours, setHours] = useState('');
  const emp = contractors.find(c => c.id === contractorId);
  const role = (emp?.contractingBillingRole || 'general_labour') as ContractingBillingRole;
  return (
    <Modal title="Add manual time" onClose={onClose}>
      <Field label="Contractor">
        <select className="inp" value={contractorId} onChange={e => setContractorId(e.target.value)}>
          {contractors.map(c => <option key={c.id} value={c.id}>{c.name} ({ROLE_LABEL[(c.contractingBillingRole || 'general_labour') as ContractingBillingRole]})</option>)}
        </select>
      </Field>
      <Field label="Hours"><input className="inp" type="number" step="0.25" value={hours} onChange={e => setHours(e.target.value)} /></Field>
      <div className="text-sm mb-2">{ROLE_LABEL[role]} @ {money(rateFor(role, ratesOrDefault(rates)))}/hr → <b>{money((Number(hours) || 0) * rateFor(role, ratesOrDefault(rates)))}</b></div>
      <ModalActions onClose={onClose} disabled={!emp || !(Number(hours) > 0)} onSave={() => onSave({
        id: uid('cmt'), projectId: report.projectId, phaseId: report.phaseId, contractorId: emp!.id, contractorName: emp!.name,
        billingRole: role, clockIn: Date.now(), manual: true, hours: Number(hours), reportId: report.id, status: 'open', createdBy: currentUser, createdAt: Date.now(),
      })} />
    </Modal>
  );
}

// Pick unbilled clock sessions to attach to the current open report. Attached
// entries flow into the preview/invoice; each can attach to ONE report ever.
function AttachUnbilledForm({ unbilled, onClose, onAttach }: { unbilled: UnbilledEntry[]; onClose: () => void; onAttach: (ids: string[]) => void }) {
  const [sel, setSel] = useState<Record<string, boolean>>(() => Object.fromEntries(unbilled.map(u => [u.entry.id, true])));
  const chosen = unbilled.filter(u => sel[u.entry.id]);
  const totalHours = round2(chosen.reduce((s, u) => s + u.hours, 0));
  const totalVal = round2(chosen.reduce((s, u) => s + u.amount, 0));
  return (
    <Modal title="Add unbilled labour" onClose={onClose}>
      <div className="text-xs text-gray-500 mb-2">These completed sessions weren't captured by any period. Selected entries attach to this report and bill with it.</div>
      <div className="border rounded divide-y">
        {unbilled.map(u => (
          <label key={u.entry.id} className="flex items-center gap-2 p-2 text-sm">
            <input type="checkbox" checked={!!sel[u.entry.id]} onChange={e => setSel(s => ({ ...s, [u.entry.id]: e.target.checked }))} />
            <span className="flex-1">{u.entry.contractorName} <span className="text-gray-400">· {fmtDate(u.entry.clockIn)}</span></span>
            <span>{u.hours}h · <b>{money(u.amount)}</b></span>
          </label>
        ))}
      </div>
      <div className="text-sm mt-2">Attaching <b>{chosen.length}</b> · {totalHours} hrs · <b style={{ color: PALERMO.gold }}>{money(totalVal)}</b></div>
      <div className="flex gap-2 mt-3">
        <button onClick={onClose} className="flex-1 py-2.5 rounded border font-semibold">Cancel</button>
        <button onClick={() => onAttach(chosen.map(u => u.entry.id))} disabled={chosen.length === 0} className="flex-1 py-2.5 rounded text-white font-bold disabled:opacity-40" style={{ backgroundColor: PALERMO.gold }}>Attach {chosen.length || ''}</button>
      </div>
    </Modal>
  );
}

function ReviewConfirm({ report, project, phase, snap, onClose, onConfirm }: { report: ContractingProgressReport; project: ContractingProject; phase: ContractingPhase; snap: ReturnType<typeof computeReportTotals>; onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal title="Review & confirm billing" onClose={onClose}>
      <div className="text-sm mb-1">{project.name} · {phase.name} · Report #{report.reportNumber}</div>
      <div className="text-xs text-gray-500 mb-2">Confirming freezes these lines, mints the invoice, and opens the next billing period.</div>
      <div className="rounded border divide-y text-sm">
        <div className="p-2 font-semibold" style={{ backgroundColor: '#F8F9F9' }}>Labour</div>
        {snap.labourLines.map(l => <div key={l.contractorId + l.billingRole} className="p-2 flex justify-between"><span>{l.name} · {l.hours}h × {money(l.rate)}</span><b>{money(l.amount)}</b></div>)}
        <div className="p-2 flex justify-between"><span>Labour subtotal</span><b>{money(snap.labourSubtotal)}</b></div>
        <div className="p-2 font-semibold" style={{ backgroundColor: '#F8F9F9' }}>Materials</div>
        {snap.materialLines.map((m, i) => <div key={i} className="p-2 flex justify-between"><span>{m.description}</span><b>{money(m.billed)}</b></div>)}
        <div className="p-2 flex justify-between"><span>Materials subtotal</span><b>{money(snap.materialsSubtotal)}</b></div>
        <div className="p-2 flex justify-between"><span>Subtotal (pre-HST)</span><b>{money(snap.subtotalPreHst)}</b></div>
        <div className="p-2 flex justify-between"><span>HST</span><b>{money(snap.hst)}</b></div>
        <div className="p-2 flex justify-between text-base" style={{ color: PALERMO.gold }}><span>Total</span><b>{money(snap.total)}</b></div>
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={onClose} className="flex-1 py-2 rounded border">Cancel</button>
        <button onClick={onConfirm} className="flex-1 py-2 rounded text-white font-bold" style={{ backgroundColor: PALERMO.slate }}>Confirm &amp; mint invoice</button>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────── INVOICES ──────
function InvoicesTab(p: Ctx & { invoices: ContractingInvoice[]; reports: ContractingProgressReport[]; projects: ContractingProject[]; nav: Nav; initialFilter: { projectId?: string; phaseId?: string } }) {
  const { canManage, isAdmin, nav } = p;
  const [adding, setAdding] = useState(false);
  const [projectId, setProjectId] = useState(p.initialFilter.projectId || '');
  const [phaseId, setPhaseId] = useState(p.initialFilter.phaseId || '');
  const proj = p.projects.find(x => x.id === projectId);
  const projName = (id: string) => p.projects.find(x => x.id === id)?.name || '—';
  const phaseName = (pid: string, phid?: string) => phid ? (p.projects.find(x => x.id === pid)?.phases.find(ph => ph.id === phid)?.name || '—') : 'Whole project';
  const list = [...p.invoices]
    .filter(inv => (!projectId || inv.projectId === projectId) && (!phaseId || inv.phaseId === phaseId))
    .sort((a, b) => (b.issuedAt || b.createdAt || 0) - (a.issuedAt || a.createdAt || 0));

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-lg" style={{ color: PALERMO.slate }}>Invoices</h2>
        {canManage && <button onClick={() => setAdding(true)} className="px-3 py-1.5 rounded text-white text-sm font-semibold" style={{ backgroundColor: PALERMO.gold }}>+ Historical invoice</button>}
      </div>
      {/* Filter by project + phase */}
      <div className="flex gap-2 mb-3">
        <select className="inp flex-1" value={projectId} onChange={e => { setProjectId(e.target.value); setPhaseId(''); }}>
          <option value="">All projects</option>
          {p.projects.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
        </select>
        <select className="inp flex-1" value={phaseId} onChange={e => setPhaseId(e.target.value)} disabled={!projectId}>
          <option value="">All phases</option>
          {proj?.phases.map(ph => <option key={ph.id} value={ph.id}>{ph.name}</option>)}
        </select>
      </div>
      <div className="space-y-2">
        {list.map(inv => {
          const late = invoiceIsLate(inv, Date.now());
          const stage = invoiceStage(inv);
          const due = invoiceDueAt(inv);
          return (
            <div key={inv.id} className="bg-white rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center flex-wrap gap-1">
                  <span className="font-bold" style={{ color: PALERMO.slate }}>{inv.number}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 uppercase">{inv.kind}</span>
                  <StageBadge stage={stage} />
                  {late && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">LATE</span>}
                </div>
                <b style={{ color: PALERMO.slate }}>{money(inv.total)}</b>
              </div>
              {/* Linkage: project · phase (tap → phase) · report/period (tap → reports) */}
              <div className="text-sm text-gray-600 flex flex-wrap items-center gap-x-1">
                <button onClick={() => nav.goToPhase(inv.projectId, inv.phaseId)} className="underline decoration-dotted" style={{ color: PALERMO.slate }}>{projName(inv.projectId)} › {phaseName(inv.projectId, inv.phaseId)}</button>
                {inv.reportId && <button onClick={() => nav.goToReports()} className="text-xs underline decoration-dotted text-gray-500">· report period {fmtDate(inv.periodStart)}–{fmtDate(inv.periodEnd)} →</button>}
              </div>
              {/* Lifecycle chain: Minted · Sent · Due (· Paid). */}
              <div className="text-xs text-gray-400">
                {money(inv.amountPreHst)} + {money(inv.hst)} HST · Minted {fmtDate(inv.issuedAt || inv.createdAt)}{inv.sentAt ? ` · Sent ${fmtDate(inv.sentAt)}` : (stage === 'sent' ? ' · Sent' : '')} · Net 14, due {fmtDate(due)}{inv.paid ? ` · Paid ${fmtDate(inv.paidAt)}` : ''}
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                <button onClick={() => nav.openInvoice(inv.id)} className="text-xs px-2 py-1 rounded border">View</button>
                {canManage && stage === 'minted' && <button onClick={() => p.onSaveInvoice({ ...inv, awaitingSend: false, sentAt: Date.now(), sentBy: p.currentUser.name, dueAt: Date.now() + 14 * 86400000 })} className="text-xs px-2 py-1 rounded text-white" style={{ backgroundColor: PALERMO.slate }}>Mark sent</button>}
                {canManage && !inv.paid && <button onClick={() => p.onSaveInvoice({ ...inv, paid: true, paidAt: Date.now(), paidBy: p.currentUser.name })} className="text-xs px-2 py-1 rounded text-white" style={{ backgroundColor: PALERMO.gold }}>Mark paid</button>}
                {isAdmin && <button onClick={() => confirm(`Delete ${inv.number}?`) && p.onDeleteInvoice(inv.id)} className="text-xs px-2 py-1 rounded text-red-500">Delete</button>}
              </div>
            </div>
          );
        })}
        {list.length === 0 && <div className="text-gray-500 text-sm">No invoices{projectId ? ' for this filter' : ''}.</div>}
      </div>
      {adding && <HistoricalInvoiceForm projects={p.projects} currentUser={p.currentUser} onClose={() => setAdding(false)} onSave={inv => { p.onSaveInvoice(inv); setAdding(false); }} />}
    </div>
  );
}

function HistoricalInvoiceForm({ projects, currentUser, onClose, onSave }: { projects: ContractingProject[]; currentUser: { id: string; name: string }; onClose: () => void; onSave: (i: ContractingInvoice) => void }) {
  const [number, setNumber] = useState('');
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const [phaseId, setPhaseId] = useState('');
  const [kind, setKind] = useState<ContractingInvoice['kind']>('historical');
  const [amount, setAmount] = useState('');
  const [scope, setScope] = useState('');
  const [paid, setPaid] = useState(false);
  const proj = projects.find(x => x.id === projectId);
  const pre = Number(amount) || 0;
  const w = withHst(pre);
  return (
    <Modal title="Enter historical invoice" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Invoice #"><input className="inp" value={number} onChange={e => setNumber(e.target.value)} placeholder="PROG-001" /></Field>
        <Field label="Kind">
          <select className="inp" value={kind} onChange={e => setKind(e.target.value as ContractingInvoice['kind'])}>
            {(['historical', 'retainer', 'completion', 'tm'] as const).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Project"><select className="inp" value={projectId} onChange={e => { setProjectId(e.target.value); setPhaseId(''); }}>{projects.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}</select></Field>
      <Field label="Phase (optional)"><select className="inp" value={phaseId} onChange={e => setPhaseId(e.target.value)}><option value="">— whole project —</option>{proj?.phases.map(ph => <option key={ph.id} value={ph.id}>{ph.name}</option>)}</select></Field>
      <Field label="Amount (pre-HST)"><input className="inp" type="number" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
      <div className="text-sm mb-2">{money(w.preHst)} + {money(w.hst)} HST = <b>{money(w.total)}</b></div>
      <Field label="Scope description (client-facing)"><textarea className="inp" rows={2} value={scope} onChange={e => setScope(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={paid} onChange={e => setPaid(e.target.checked)} /> Already paid</label>
      <ModalActions onClose={onClose} disabled={!number.trim() || !projectId || pre <= 0} onSave={() => onSave({
        id: uid('cinv'), number: number.trim(), projectId, phaseId: phaseId || undefined, kind,
        amountPreHst: w.preHst, hst: w.hst, total: w.total, scopeDescription: scope.trim() || undefined,
        issuedAt: Date.now(), dueAt: Date.now() + 14 * 86400000, paid, paidAt: paid ? Date.now() : undefined, paidBy: paid ? currentUser.name : undefined,
        createdBy: currentUser, createdAt: Date.now(),
      })} />
    </Modal>
  );
}

function InvoiceView({ invoice, project, report, canSeeInternal, onClose, onGoToPhase, onGoToReports }: { invoice: ContractingInvoice; project?: ContractingProject; report?: ContractingProgressReport; canSeeInternal: boolean; onClose: () => void; onGoToPhase?: () => void; onGoToReports?: () => void }) {
  const [mode, setMode] = useState<'client' | 'internal'>(canSeeInternal ? 'internal' : 'client');
  const snap = report?.snapshot;
  const phase = project?.phases.find(ph => ph.id === invoice.phaseId);
  const stage = invoiceStage(invoice);
  const due = invoiceDueAt(invoice);
  return (
    <Modal title={`Invoice ${invoice.number}`} onClose={onClose}>
      {/* Lifecycle: Minted → Sent → Due (→ Paid). Internal only. */}
      {canSeeInternal && (
        <div className="flex items-center gap-2 mb-3 text-xs flex-wrap">
          <StageBadge stage={stage} />
          <span className="text-gray-500">Minted {fmtDate(invoice.issuedAt || invoice.createdAt)}{invoice.sentAt ? ` · Sent ${fmtDate(invoice.sentAt)}${invoice.sentBy ? ` by ${invoice.sentBy}` : ''}` : (stage === 'sent' ? ' · Sent' : '')} · Due {fmtDate(due)}{invoice.paid ? ` · Paid ${fmtDate(invoice.paidAt)}` : ''}</span>
        </div>
      )}
      {/* Linkage (internal only): tap through to the phase or the report. */}
      {canSeeInternal && (onGoToPhase || onGoToReports) && (
        <div className="flex flex-wrap gap-2 mb-3">
          {onGoToPhase && phase && <button onClick={onGoToPhase} className="text-xs px-2.5 py-1.5 rounded border font-semibold" style={{ color: PALERMO.slate }}>→ {project?.name} · {phase.name}</button>}
          {onGoToReports && report && <button onClick={onGoToReports} className="text-xs px-2.5 py-1.5 rounded border font-semibold" style={{ color: PALERMO.slate }}>→ Report #{report.reportNumber}</button>}
        </div>
      )}
      {canSeeInternal && (
        <div className="flex gap-1 mb-3 rounded overflow-hidden border text-sm">
          {(['internal', 'client'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} className="flex-1 py-1.5 font-semibold" style={mode === m ? { backgroundColor: PALERMO.slate, color: 'white' } : {}}>{m === 'internal' ? 'Internal' : 'Client-facing'}</button>
          ))}
        </div>
      )}
      {/* Client-facing: totals + scope only. No per-person hours, no line pricing, no costs/markup, no sub names, no internal notes. */}
      {mode === 'client' ? (
        <div className="border rounded p-3 text-sm bg-white">
          <div className="font-bold text-base" style={{ color: PALERMO.slate }}>Palermo's Contracting</div>
          <div className="text-gray-600">{project?.name}{project?.client ? ` — ${project.client.name}` : ''}</div>
          <div className="mt-2">Invoice <b>{invoice.number}</b> · {fmtDate(invoice.issuedAt)}</div>
          {invoice.periodStart && <div className="text-gray-600">Period {fmtDate(invoice.periodStart)}–{fmtDate(invoice.periodEnd)}</div>}
          <div className="mt-2">
            <div className="font-semibold">Scope of work</div>
            <div className="text-gray-700">{invoice.scopeDescription || (snap ? 'Labour and materials per progress report.' : 'Per agreement.')}</div>
          </div>
          <div className="mt-3 border-t pt-2">
            <Row label="Subtotal" val={invoice.amountPreHst} />
            <Row label="HST" val={invoice.hst} />
            <Row label="Total due" val={invoice.total} bold accent />
          </div>
          <div className="text-xs text-gray-500 mt-2">Net 14 · due {fmtDate(due)} · 2%/mo on overdue balances</div>
        </div>
      ) : (
        <div className="border rounded p-3 text-sm bg-white">
          <div className="text-xs text-gray-500 mb-1">INTERNAL — full detail (never sent to client)</div>
          {snap ? (
            <>
              <div className="font-semibold mt-1">Labour</div>
              {snap.labourLines.map(l => <div key={l.contractorId + l.billingRole} className="flex justify-between"><span>{l.name} · {l.hours}h × {money(l.rate)}</span><b>{money(l.amount)}</b></div>)}
              <div className="flex justify-between border-t mt-1 pt-1"><span>Labour subtotal</span><b>{money(snap.labourSubtotal)}</b></div>
              <div className="font-semibold mt-2">Materials (billed)</div>
              {snap.materialLines.map((m, i) => <div key={i} className="flex justify-between"><span>{m.description}</span><b>{money(m.billed)}</b></div>)}
              <div className="flex justify-between border-t mt-1 pt-1"><span>Materials subtotal</span><b>{money(snap.materialsSubtotal)}</b></div>
            </>
          ) : <div className="text-gray-500">No line detail (historical / fixed invoice).</div>}
          <div className="mt-2 border-t pt-1">
            <Row label="Subtotal (pre-HST)" val={invoice.amountPreHst} />
            <Row label="HST" val={invoice.hst} />
            <Row label="Total" val={invoice.total} bold accent />
          </div>
        </div>
      )}
    </Modal>
  );
}

// ────────────────────────────────────────────────────────── WORK ORDERS ────
function WorkOrdersTab(p: Props) {
  const [filter, setFilter] = useState<string>('All');
  const [adding, setAdding] = useState(false);
  const activeProps = p.properties.filter(x => x.active !== false);
  const list = Object.values(p.workOrders).filter(w => filter === 'All' || w.property === filter).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-bold text-lg" style={{ color: PALERMO.slate }}>Work orders <span className="text-xs font-normal text-gray-500">(rentals · internal)</span></h2>
        <button onClick={() => setAdding(true)} className="px-3 py-1.5 rounded text-white text-sm font-semibold" style={{ backgroundColor: PALERMO.gold }}>+ Work order</button>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-2">
        {['All', ...activeProps.map(x => x.name)].map(name => {
          const corp = activeProps.find(x => x.name === name)?.corp;
          return <button key={name} onClick={() => setFilter(name)} className="px-2.5 py-1 rounded-full text-xs whitespace-nowrap font-semibold border" style={filter === name ? { backgroundColor: PALERMO.slate, color: 'white' } : corp ? { borderColor: PALERMO.gold, color: PALERMO.gold } : {}}>{corp ? '★ ' : ''}{name}</button>;
        })}
      </div>
      <div className="space-y-2">
        {list.map(w => <WorkOrderCard key={w.id} wo={w} {...p} />)}
        {list.length === 0 && <div className="text-gray-500 text-sm">No work orders{filter !== 'All' ? ` for ${filter}` : ''}.</div>}
      </div>
      {adding && <WorkOrderForm currentUser={p.currentUser} uploadedBy={p.uploadedBy} properties={activeProps} onClose={() => setAdding(false)} onSave={w => { p.onSaveWorkOrder(w); setAdding(false); }} defaultProperty={filter === 'All' ? (activeProps[0]?.name || '') : filter} />}
    </div>
  );
}

function WorkOrderCard(p: Props & { wo: ContractingWorkOrder }) {
  const { wo, canManage } = p;
  const [viewPhotos, setViewPhotos] = useState<StoredFile[] | null>(null);
  const corp = p.properties.find(x => x.name === wo.property)?.corp;
  const cycle: ContractingWorkOrder['status'][] = ['open', 'in_progress', 'done'];
  const nextStatus = () => cycle[(cycle.indexOf(wo.status) + 1) % 3];
  const promote = () => {
    p.onSaveProject({ id: uid('cproj'), name: wo.title, status: 'planned', propertyRef: wo.property, phases: [], notes: wo.description, createdBy: p.currentUser, createdAt: Date.now(), updatedAt: Date.now() });
    p.onSaveWorkOrder({ ...wo, status: 'done', completionNote: (wo.completionNote ? wo.completionNote + ' · ' : '') + 'Promoted to project', updatedAt: Date.now() });
  };
  return (
    <div className="bg-white rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold" style={{ color: PALERMO.slate }}>{wo.title}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={corp ? { backgroundColor: PALERMO.gold, color: 'white' } : { backgroundColor: '#eee' }}>{corp ? '★ ' : ''}{wo.property}</span>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: wo.priority === 'high' ? '#FADBD8' : wo.priority === 'normal' ? '#EBF5FB' : '#F8F9F9', color: wo.priority === 'high' ? '#C0392B' : '#555' }}>{wo.priority}</span>
      </div>
      {wo.description && <div className="text-sm text-gray-600 mt-1">{wo.description}</div>}
      {wo.completionNote && <div className="text-xs text-gray-500 mt-1 italic">✓ {wo.completionNote}</div>}
      {wo.photos && wo.photos.length > 0 && <button onClick={() => setViewPhotos(wo.photos!)} className="text-xs mt-1" style={{ color: PALERMO.gold }}>📷 {wo.photos.length} photo(s)</button>}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <button onClick={() => p.onSaveWorkOrder({ ...wo, status: nextStatus(), updatedAt: Date.now() })} className="text-xs px-2.5 py-1.5 rounded text-white font-semibold" style={{ backgroundColor: wo.status === 'done' ? '#27AE60' : PALERMO.slate }}>
          {wo.status === 'open' ? 'Start' : wo.status === 'in_progress' ? 'Mark done' : '✓ Done (reopen)'}
        </button>
        {canManage && wo.status !== 'done' && <button onClick={promote} className="text-xs px-2.5 py-1.5 rounded border font-semibold" style={{ color: PALERMO.slate }}>Promote to project</button>}
      </div>
      {viewPhotos && <PhotoViewer files={viewPhotos} onClose={() => setViewPhotos(null)} />}
    </div>
  );
}

function WorkOrderForm({ currentUser, uploadedBy, properties, onClose, onSave, defaultProperty }: { currentUser: { id: string; name: string }; uploadedBy: { email: string; name: string }; properties: ContractingProperty[]; onClose: () => void; onSave: (w: ContractingWorkOrder) => void; defaultProperty: string }) {
  const [property, setProperty] = useState(defaultProperty);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<ContractingWorkOrder['priority']>('normal');
  const [photos, setPhotos] = useState<StoredFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const woId = uid('cwo');
  return (
    <Modal title="New work order" onClose={onClose}>
      <Field label="Property"><select className="inp" value={property} onChange={e => setProperty(e.target.value)}>{properties.map(x => <option key={x.id} value={x.name}>{x.corp ? '★ ' : ''}{x.name}</option>)}</select></Field>
      <Field label="Title"><input className="inp" value={title} onChange={e => setTitle(e.target.value)} /></Field>
      <Field label="Description"><textarea className="inp" rows={2} value={description} onChange={e => setDescription(e.target.value)} /></Field>
      <Field label="Priority"><div className="flex gap-2">{(['low', 'normal', 'high'] as const).map(pr => <button key={pr} onClick={() => setPriority(pr)} className="flex-1 py-1.5 rounded border text-sm capitalize" style={priority === pr ? { backgroundColor: PALERMO.slate, color: 'white' } : {}}>{pr}</button>)}</div></Field>
      <Field label="Photos (optional)">
        <input type="file" accept="image/*,application/pdf" onChange={async e => {
          const f = e.target.files?.[0]; if (!f) return; setUploading(true);
          try { const sf = await uploadFile(`contracting/wo-${woId}`, f, { uploadedBy }); setPhotos(x => [...x, sf]); } finally { setUploading(false); }
        }} />
        {uploading && <span className="text-xs text-gray-400">Uploading…</span>}
        {photos.length > 0 && <span className="text-xs text-green-600">✓ {photos.length}</span>}
      </Field>
      <ModalActions onClose={onClose} disabled={!title.trim() || uploading} onSave={() => onSave({
        id: woId, property, title: title.trim(), description: description.trim() || undefined, priority, status: 'open',
        photos: photos.length ? photos : undefined, createdBy: currentUser, createdAt: Date.now(), updatedAt: Date.now(),
      })} />
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────── SHOPPING ──────
const GENERAL_GROUP = 'General';
function ShoppingTab(p: Props) {
  const activeSuppliers = p.suppliers.filter(s => s.active !== false);
  const [item, setItem] = useState('');
  const [qty, setQty] = useState('');
  const [supplier, setSupplier] = useState('');   // remembered last-used default
  const [newSupplier, setNewSupplier] = useState('');
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const items = Object.values(p.shoppingList);
  const active = items.filter(i => !i.purchased).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  const weekAgo = Date.now() - 7 * 86400000;
  const recent = items.filter(i => i.purchased && (i.purchasedAt || 0) > weekAgo).sort((a, b) => (b.purchasedAt || 0) - (a.purchasedAt || 0));

  const add = () => {
    if (!item.trim()) return;
    p.onSaveShoppingItem({ id: uid('csh'), item: item.trim(), qty: qty.trim() || undefined, supplier: supplier || undefined, addedBy: p.currentUser, addedAt: Date.now() });
    setItem(''); setQty('');   // keep supplier as the remembered default
  };
  const toggle = (i: ContractingShoppingItem) => p.onSaveShoppingItem({ ...i, purchased: !i.purchased, purchasedBy: !i.purchased ? p.currentUser.name : undefined, purchasedAt: !i.purchased ? Date.now() : undefined });
  const commitNewSupplier = () => {
    const name = newSupplier.trim(); if (!name) return;
    if (!p.suppliers.some(s => s.name.toLowerCase() === name.toLowerCase())) p.onSaveSuppliers([...p.suppliers, { id: uid('csup'), name, active: true }]);
    setSupplier(name); setNewSupplier(''); setAddingSupplier(false);
  };

  // Group active items by supplier (untagged → General). Suppliers in list
  // order first, then any ad-hoc supplier, then General last.
  const groupsMap = new Map<string, ContractingShoppingItem[]>();
  for (const i of active) { const k = i.supplier || GENERAL_GROUP; if (!groupsMap.has(k)) groupsMap.set(k, []); groupsMap.get(k)!.push(i); }
  const order = [...activeSuppliers.map(s => s.name), ...[...groupsMap.keys()].filter(k => k !== GENERAL_GROUP && !activeSuppliers.some(s => s.name === k)), GENERAL_GROUP];
  const groups = order.filter(k => groupsMap.has(k)).map(k => ({ supplier: k, items: groupsMap.get(k)! }));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-bold text-lg" style={{ color: PALERMO.slate }}>Shopping list</h2>
        {p.canManage && <button onClick={() => setManageOpen(o => !o)} className="text-xs px-2 py-1 rounded border font-semibold" style={{ color: PALERMO.slate }}>Suppliers</button>}
      </div>

      {/* Suppliers manager (Tony/admin) */}
      {p.canManage && manageOpen && (
        <div className="bg-white rounded-lg border p-3 mb-3">
          <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Suppliers</div>
          <div className="space-y-1">
            {p.suppliers.map(s => (
              <div key={s.id} className={`flex items-center gap-2 ${s.active === false ? 'opacity-50' : ''}`}>
                <input className="inp flex-1 text-sm" defaultValue={s.name} onBlur={e => e.target.value.trim() && e.target.value !== s.name && p.onSaveSuppliers(p.suppliers.map(x => x.id === s.id ? { ...x, name: e.target.value.trim() } : x))} />
                <button onClick={() => p.onSaveSuppliers(p.suppliers.map(x => x.id === s.id ? { ...x, active: x.active === false } : x))} className="text-xs px-2 py-1 rounded border">{s.active === false ? 'Reactivate' : 'Deactivate'}</button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <input className="inp flex-1 text-sm" placeholder="New supplier" value={newSupplier} onChange={e => setNewSupplier(e.target.value)} onKeyDown={e => e.key === 'Enter' && commitNewSupplier()} />
            <button onClick={commitNewSupplier} className="px-3 rounded text-white text-sm font-semibold" style={{ backgroundColor: PALERMO.slate }}>Add</button>
          </div>
        </div>
      )}

      {/* Two-tap add — item + Add. Supplier optional, remembers last used. */}
      <div className="bg-white rounded-lg border p-3 mb-3 sticky top-0">
        <input className="inp text-base" style={{ minHeight: 48 }} placeholder="Add an item…" value={item} onChange={e => setItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <div className="flex gap-2 mt-2">
          <input className="inp w-20" placeholder="Qty" value={qty} onChange={e => setQty(e.target.value)} />
          {addingSupplier ? (
            <div className="flex gap-1 flex-1">
              <input className="inp flex-1" placeholder="New supplier" value={newSupplier} onChange={e => setNewSupplier(e.target.value)} onKeyDown={e => e.key === 'Enter' && commitNewSupplier()} autoFocus />
              <button onClick={commitNewSupplier} className="px-2 rounded text-white text-sm" style={{ backgroundColor: PALERMO.slate }}>OK</button>
            </div>
          ) : (
            <select className="inp flex-1" value={supplier} onChange={e => { if (e.target.value === '__new') { setAddingSupplier(true); } else setSupplier(e.target.value); }}>
              <option value="">Store (optional)</option>
              {activeSuppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              <option value="__new">＋ New store…</option>
            </select>
          )}
          <button onClick={add} disabled={!item.trim()} className="px-5 rounded text-white font-bold disabled:opacity-40" style={{ backgroundColor: PALERMO.gold, minHeight: 48 }}>Add</button>
        </div>
      </div>

      {/* Grouped by store — open a group, get everything for that trip. */}
      {groups.map(g => (
        <div key={g.supplier} className="mb-4">
          <div className="text-xs font-black uppercase tracking-wide mb-1 flex items-center gap-2" style={{ color: PALERMO.slate }}>
            <span className="px-2 py-0.5 rounded" style={{ backgroundColor: g.supplier === GENERAL_GROUP ? '#E5E7E9' : '#FEF9E7', color: g.supplier === GENERAL_GROUP ? '#566573' : PALERMO.gold }}>{g.supplier}</span>
            <span className="text-gray-400 font-semibold">{g.items.length}</span>
          </div>
          <div className="space-y-1.5">
            {g.items.map(i => (
              <button key={i.id} onClick={() => toggle(i)} className="w-full flex items-center gap-3 bg-white rounded-lg border p-3 text-left" style={{ minHeight: 48 }}>
                <span className="w-6 h-6 rounded border-2 shrink-0" style={{ borderColor: PALERMO.slate }} />
                <span className="flex-1"><b>{i.item}</b>{i.qty ? ` · ${i.qty}` : ''}{i.projectTag ? <span className="text-xs text-gray-400"> · {i.projectTag}</span> : ''}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {active.length === 0 && <div className="text-gray-500 text-sm">Nothing to buy. 🎉</div>}

      {recent.length > 0 && (
        <div className="mt-5">
          <div className="text-xs font-semibold text-gray-400 uppercase mb-1">Recently purchased</div>
          <div className="space-y-1">
            {recent.map(i => (
              <button key={i.id} onClick={() => toggle(i)} className="w-full flex items-center gap-3 bg-white/60 rounded-lg border p-2.5 text-left opacity-60" style={{ minHeight: 44 }}>
                <span className="w-5 h-5 rounded flex items-center justify-center text-white shrink-0" style={{ backgroundColor: '#27AE60' }}>✓</span>
                <span className="flex-1 line-through text-gray-500">{i.item}{i.qty ? ` · ${i.qty}` : ''}{i.supplier ? <span className="text-[10px] text-gray-400"> · {i.supplier}</span> : ''}</span>
                <span className="text-[10px] text-gray-400">{i.purchasedBy}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────── PROPERTIES ────
function PropertiesTab({ properties, onSaveProperties }: { properties: ContractingProperty[]; onSaveProperties: (list: ContractingProperty[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [corp, setCorp] = useState(false);
  const [notes, setNotes] = useState('');
  const update = (id: string, patch: Partial<ContractingProperty>) => onSaveProperties(properties.map(x => x.id === id ? { ...x, ...patch } : x));
  const add = () => {
    if (!name.trim()) return;
    onSaveProperties([...properties, { id: uid('cprop'), name: name.trim(), corp, notes: notes.trim() || undefined, active: true }]);
    setName(''); setCorp(false); setNotes(''); setAdding(false);
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-lg" style={{ color: PALERMO.slate }}>Rental properties</h2>
        <button onClick={() => setAdding(true)} className="px-3 py-1.5 rounded text-white text-sm font-semibold" style={{ backgroundColor: PALERMO.gold }}>+ Add property</button>
      </div>
      <div className="space-y-2">
        {properties.map(pr => (
          <div key={pr.id} className={`bg-white rounded-lg border p-3 ${pr.active === false ? 'opacity-50' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <input className="inp flex-1 font-semibold" defaultValue={pr.name} onBlur={e => e.target.value.trim() && e.target.value !== pr.name && update(pr.id, { name: e.target.value.trim() })} />
              <label className="flex items-center gap-1 text-xs whitespace-nowrap"><input type="checkbox" checked={!!pr.corp} onChange={e => update(pr.id, { corp: e.target.checked })} /> ★ Corp</label>
              <button onClick={() => update(pr.id, { active: pr.active === false })} className="text-xs px-2 py-1 rounded border font-semibold" style={{ color: PALERMO.slate }}>{pr.active === false ? 'Reactivate' : 'Deactivate'}</button>
            </div>
            <input className="inp mt-2 text-sm" placeholder="Notes" defaultValue={pr.notes || ''} onBlur={e => update(pr.id, { notes: e.target.value.trim() || undefined })} />
          </div>
        ))}
      </div>
      {adding && (
        <Modal title="Add property" onClose={() => setAdding(false)}>
          <Field label="Name / address"><input className="inp" value={name} onChange={e => setName(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={corp} onChange={e => setCorp(e.target.checked)} /> Corporate property (★ badge)</label>
          <Field label="Notes"><textarea className="inp" rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
          <ModalActions onClose={() => setAdding(false)} disabled={!name.trim()} onSave={add} />
        </Modal>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────── RATES ──────
function RatesTab({ rates, onSaveRates }: { rates: ContractingRateCard; onSaveRates: (r: ContractingRateCard) => void }) {
  const rows: { key: keyof ContractingRateCard; label: string }[] = [
    { key: 'gc_pm', label: 'GC / PM' }, { key: 'skilled_carpenter', label: 'Skilled Carpenter' }, { key: 'general_labour', label: 'General Labour' },
  ];
  return (
    <div>
      <h2 className="font-bold text-lg mb-2" style={{ color: PALERMO.slate }}>T&amp;M rate card</h2>
      <div className="bg-white rounded-lg border divide-y">
        {rows.map(r => (
          <div key={r.key} className="flex items-center justify-between p-3">
            <span className="font-semibold" style={{ color: PALERMO.slate }}>{r.label}</span>
            <div className="flex items-center gap-1">
              <span>$</span>
              <input className="inp w-24 text-right" type="number" defaultValue={rates[r.key]} onBlur={e => onSaveRates({ ...rates, [r.key]: Number(e.target.value) || 0 })} />
              <span className="text-gray-400 text-sm">/hr</span>
            </div>
          </div>
        ))}
      </div>
      <div className="text-xs text-gray-400 mt-2">Applied to new billing lines. Snapshotted invoices keep their frozen rates.</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────── shared UI bits ────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div className="bg-white w-full md:max-w-lg rounded-t-2xl md:rounded-2xl h-[92dvh] md:h-auto md:max-h-[90dvh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b shrink-0 flex items-center justify-between" style={{ backgroundColor: PALERMO.slate }}>
          <span className="text-white font-bold">{title}</span>
          <button onClick={onClose} className="text-white/80 text-xl leading-none">×</button>
        </div>
        <div className="p-4 flex-1 min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mb-3"><label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>{children}</div>;
}
function ModalActions({ onClose, onSave, disabled }: { onClose: () => void; onSave: () => void; disabled?: boolean }) {
  return (
    <div className="flex gap-2 mt-2">
      <button onClick={onClose} className="flex-1 py-2.5 rounded border font-semibold">Cancel</button>
      <button onClick={onSave} disabled={disabled} className="flex-1 py-2.5 rounded text-white font-bold disabled:opacity-40" style={{ backgroundColor: PALERMO.gold }}>Save</button>
    </div>
  );
}
function StatusSelect({ value, onChange, small }: { value: ContractingStatus; onChange: (s: ContractingStatus) => void; small?: boolean }) {
  return (
    <select className={`inp ${small ? 'text-xs py-0.5' : ''}`} style={{ width: 'auto' }} value={value} onChange={e => onChange(e.target.value as ContractingStatus)}>
      {(Object.keys(STATUS_LABEL) as ContractingStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
    </select>
  );
}
function Row({ label, val, bold, accent }: { label: string; val: number; bold?: boolean; accent?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''}`} style={accent ? { color: PALERMO.gold } : {}}>
      <span>{label}</span><span>{money(val)}</span>
    </div>
  );
}

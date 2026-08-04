// ContractingMaster — Palermo's Contracting portal. A separate tenant inside
// CrewMaster: slate/gold branding, its own namespaced data, ZERO contact with
// Marco's performance/BH/bonus/pay. All billing math comes from lib/contracting.
import { useEffect, useMemo, useState } from 'react';
import {
  ContractingProject, ContractingPhase, ContractingChecklistItem, ContractingTimeEntry,
  ContractingProgressReport, ContractingReceipt, ContractingInvoice, ContractingWorkOrder,
  ContractingShoppingItem, ContractingRateCard, ContractingBillingRole, ContractingStatus,
  ContractingProperty, ContractingSupplier, ContractingPersonalItem, ContractingPhaseType, Employee, StoredFile, TimeEntry,
  ContractingUnit, ContractingTenancy, ContractingTenant, ContractingTenancyStatus,
} from '../types';
import {
  tenancyCountdown, tenancyMonthlyTotal, unitIsVacant, leasesNeedingAttention,
  tenancyMoveOut, tenancyDeposit, moveOutIsShortNotice,
  fmtYmd, msToYmd, Countdown, UnitRow, starredTenant, tenantsStarredFirst,
} from '../lib/propertyMgmt';
import type { ContractingDeposit } from '../types';
import {
  HST_PCT, ratesOrDefault, ROLE_LABEL, rateFor, round2, money, receiptBilled,
  computeReportTotals, labourForReport, phaseBillables, phaseReadyToBill, withHst,
  PALERMO, phaseHasInvoicedBilling, phaseIsRemovable, rateMapFor,
  projectIsRemovable, invoiceStage, invoiceDueAt, invoiceIsLate,
  projectBillables, projectCompletionPct, woAssignees, woIsAssignedTo,
  reportIsDeletable, woStatus, woIsOverdue, compareWorkOrders, woWeekStats,
  isContractingWorker,
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
  canManageProperties: boolean;   // admin + Tony + Linda (property manager)
  isPropertyManager: boolean;     // Linda — restricted surface
  noticeDays: number;
  uploadedBy: { email: string; name: string };
  onSaveRates: (r: ContractingRateCard) => void;
  onSavePropertyDoc: (p: ContractingProperty) => void;
  onDeletePropertyDoc: (id: string) => void;
  onSaveSuppliers: (list: ContractingSupplier[]) => void;
  onDiscardReport: (reportId: string) => void;
  onDeleteReport: (reportId: string) => void;
  // Payroll punched hours (read-only reference for the open-report panel).
  payrollTimeEntries: TimeEntry[];
  // Tony's contractor-scoped time management (guarded + audited in App).
  onSaveContractingTime: (e: TimeEntry, reason: string) => void;
  onDeleteContractingTime: (id: string) => void;
  // Contractor SELF-SERVICE own-entry edits (own-only guard + audit in App).
  onSaveOwnContractorTime: (e: TimeEntry, reason: string) => void;
  onLogEdit: (detail: string) => void;
  onSaveProject: (p: ContractingProject) => void;
  onDeleteProject: (id: string) => void;
  onArchiveProject: (id: string, archived: boolean) => void;
  onMergePhases: (projectId: string, sourceId: string, targetId: string, mergedName?: string) => void;
  onOpenReport: (projectId: string, phaseId: string, startAt?: number) => void;
  onEndReport: (reportId: string) => void;
  onSaveReport: (r: ContractingProgressReport) => void;
  onSaveInvoice: (inv: ContractingInvoice) => void;
  onVoidInvoice: (id: string, reason: string) => void;
  onSaveWorkOrder: (w: ContractingWorkOrder) => void;
  onDeleteWorkOrder: (id: string) => void;
  onSaveShoppingItem: (s: ContractingShoppingItem) => void;
  onDeleteShoppingItem: (id: string) => void;
  // Contractor clock-in/out (minimal surface; writes to payroll time data).
  myActivePunch: TimeEntry | null;
  myTodayPunches: TimeEntry[];
  onClockIn: () => void;
  onClockOut: (note?: string) => void;
  // Home screen: personal (private) lists + own-hours cards.
  personalItems: Record<string, ContractingPersonalItem>;
  onSavePersonalItem: (it: ContractingPersonalItem) => void;
  onDeletePersonalItem: (id: string) => void;
  hoursCards: { last: { rangeLabel: string; payDate: string; hours: number }; current: { rangeLabel: string; payDate: string; hours: number } };
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
const fmtShort = (ms?: number) => ms ? new Date(ms).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '—';
const dateInputVal = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dateFromInput = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0).getTime(); };
const timeInputVal = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const dateTimeFromInput = (s: string, t: string) => { const [y, m, d] = s.split('-').map(Number); const [hh, mm] = t.split(':').map(Number); return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0).getTime(); };
const STATUS_LABEL: Record<ContractingStatus, string> = { planned: 'Planned', in_progress: 'In Progress', on_hold: 'On Hold', complete: 'Complete', closed: 'Closed' };

type Tab = 'home' | 'projects' | 'reports' | 'invoices' | 'workorders' | 'shopping' | 'properties' | 'propertycontacts' | 'time' | 'rates';

export default function ContractingMaster(props: Props) {
  const { canManage, isAdmin, currentUser, isPropertyManager, canManageProperties } = props;
  const rates = ratesOrDefault(props.rates);
  // Contractors → Home; managers → Projects; property manager (Linda) →
  // Properties (restricted surface).
  const [tab, setTab] = useState<Tab>(canManage ? 'projects' : isPropertyManager ? 'properties' : 'home');

  const projects = useMemo(() => Object.values(props.projects).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), [props.projects]);
  const invoices = useMemo(() => Object.values(props.invoices), [props.invoices]);
  const reports = useMemo(() => Object.values(props.reports), [props.reports]);
  const timeEntries = useMemo(() => Object.values(props.timeEntries), [props.timeEntries]);
  // Contracting workers = billing-role holders (incl. Tony) + plain contractors.
  const contractors = useMemo(() => props.employees.filter(isContractingWorker), [props.employees]);
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

  // Work Orders filter state — LIFTED so the Home "My Work Orders" card can
  // pre-filter it on tap (same state the Work Orders tab reads).
  const [woMineOnly, setWoMineOnly] = useState(false);
  const [woProperty, setWoProperty] = useState('All');
  const [woPriority, setWoPriority] = useState<'all' | 'low' | 'normal' | 'high'>('all');
  const goToMyWorkOrders = (priority: 'all' | 'low' | 'normal' | 'high' = 'all') => { setWoMineOnly(true); setWoProperty('All'); setWoPriority(priority); setTab('workorders'); };

  // FINANCIALS (projects, reports, invoices, billables, rate card) are
  // admin + contracting-manager ONLY — enforced by absence (not rendered).
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'home', label: 'Home', show: !canManage && !isPropertyManager },
    { id: 'projects', label: 'Projects', show: canManage },
    { id: 'reports', label: 'Reports', show: canManage },
    { id: 'invoices', label: 'Invoices', show: canManage },
    { id: 'properties', label: 'Properties', show: canManageProperties },
    // Contractor pool (Kris et al.): read-only tenant CONTACTS only — no
    // financial/lease surface. Managers/Linda get the full Properties tab above.
    { id: 'propertycontacts', label: 'Properties', show: !canManageProperties },
    { id: 'workorders', label: 'Work Orders', show: true },
    { id: 'shopping', label: 'Material', show: true },
    { id: 'time', label: 'Time', show: canManage },
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
            <div className="text-xs" style={{ color: PALERMO.gold }}>{canManage ? 'ContractingMaster · T&M + fixed billing' : isPropertyManager ? 'Property Management' : 'Work Orders · Material'}</div>
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
        {tab === 'projects' && canManage && <ProjectsTab {...props} rates={rates} invoices={invoices} projects={projects} reports={reports} timeEntries={timeEntries} rateOverrides={rateOverrides} nav={nav} focusProjectId={focusProjectId} onConsumeFocus={() => setFocusProjectId(null)} />}
        {tab === 'reports' && canManage && <ReportsTab {...props} rates={rates} reports={reports} timeEntries={timeEntries} contractors={contractors} projects={projects} invoices={invoices} rateOverrides={rateOverrides} nav={nav} />}
        {tab === 'invoices' && canManage && <InvoicesTab {...props} invoices={invoices} reports={reports} projects={projects} nav={nav} initialFilter={invoiceFilter} />}
        {tab === 'home' && <HomeTab {...props} hoursCards={props.hoursCards} personalItems={props.personalItems} shoppingList={props.shoppingList} workOrders={props.workOrders} onGoToMyWorkOrders={goToMyWorkOrders} />}
        {tab === 'workorders' && <WorkOrdersTab {...props} mineOnly={woMineOnly} setMineOnly={setWoMineOnly} propFilter={woProperty} setPropFilter={setWoProperty} priorityFilter={woPriority} setPriorityFilter={setWoPriority} />}
        {tab === 'shopping' && <ShoppingTab {...props} />}
        {tab === 'properties' && canManageProperties && <PropertyManagementTab properties={props.properties} noticeDays={props.noticeDays} currentUser={currentUser} onSaveProperty={props.onSavePropertyDoc} onDeleteProperty={props.onDeletePropertyDoc} />}
        {tab === 'propertycontacts' && !canManageProperties && <PropertyContactsTab properties={props.properties} />}
        {tab === 'time' && canManage && <ContractingTimeTab employees={props.employees} payrollTimeEntries={props.payrollTimeEntries} currentUser={currentUser} onSave={props.onSaveContractingTime} onDelete={props.onDeleteContractingTime} />}
        {tab === 'rates' && canManage && <RatesTab rates={rates} onSaveRates={props.onSaveRates} />}
      </div>
      <div className="text-center text-[11px] text-gray-400 pb-4">
        {isAdmin ? 'Admin' : canManage ? 'Contracting Manager' : isPropertyManager ? 'Property Manager' : 'Contractor'} · {currentUser.name}
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

// ────────────────────────────────────────────────────────────── CLOCK ──────
// Minimal contractor clock in/out (top of Home) — full-width big button, live
// status, today's punches collapsible. Writes to payroll time data.
function ContractorClockTab({ active, today, onIn, onOut }: { active: TimeEntry | null; today: TimeEntry[]; onIn: () => void; onOut: (note?: string) => void }) {
  const [, force] = useState(0);
  const [showPunches, setShowPunches] = useState(false);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { const id = setInterval(() => force(n => n + 1), 30000); return () => clearInterval(id); }, []);
  const elapsed = active ? Math.max(0, (Date.now() - new Date(active.clockIn).getTime()) / 3600000) : 0;
  const hm = (h: number) => `${Math.floor(h)}h ${Math.round((h - Math.floor(h)) * 60)}m`;
  const t = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : '—';
  const finish = (n?: string) => { onOut(n); setNoting(false); setNote(''); };
  return (
    <div>
      {active ? (
        <div className="w-full rounded-2xl p-4 text-white" style={{ backgroundColor: PALERMO.slate }}>
          <div className="flex items-center justify-between">
            <span className="text-left">
              <span className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-widest" style={{ color: PALERMO.gold }}>
                <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: PALERMO.gold }} /><span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ backgroundColor: PALERMO.gold }} /></span>
                Clocked in · {hm(elapsed)}
              </span>
              <span className="block text-[11px] opacity-70">since {t(active.clockIn)}</span>
            </span>
            {!noting && <button onClick={() => setNoting(true)} className="px-4 py-3 rounded-xl font-black" style={{ backgroundColor: PALERMO.gold, color: PALERMO.slate }}>Clock out</button>}
          </div>
          {noting && (
            <div className="mt-3 bg-white rounded-xl p-3 text-slate-800">
              <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">What was worked on? (optional)</label>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="e.g. framed the bar wall · ~6 hrs billable" className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400 resize-none" autoFocus />
              <div className="flex gap-2 mt-2">
                <button onClick={() => finish(note.trim() || undefined)} className="flex-1 py-2 rounded-lg font-black text-white" style={{ backgroundColor: PALERMO.slate }}>Save</button>
                <button onClick={() => finish(undefined)} className="px-3 py-2 rounded-lg font-semibold border text-slate-600">Save without note</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <button onClick={onIn} className="w-full py-6 rounded-2xl font-black text-2xl text-white shadow" style={{ backgroundColor: PALERMO.gold }}>Clock in</button>
      )}
      {today.length > 0 && (
        <div className="mt-1.5 text-center">
          <button onClick={() => setShowPunches(s => !s)} className="text-[11px] font-semibold text-gray-400 uppercase">{showPunches ? '▾ hide' : '▸'} today's punches ({today.length})</button>
          {showPunches && (
            <div className="space-y-1 mt-1 text-left">
              {today.map(e => (
                <div key={e.id} className="bg-white rounded border p-2 text-sm">
                  <div>{t(e.clockIn)} → {e.clockOut ? t(e.clockOut) : <span className="text-emerald-600 font-semibold">active</span>}</div>
                  {e.workNote && <div className="text-xs text-gray-500 italic mt-0.5">“{e.workNote}”</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── HOME ──────
// Contractor landing page: own-hours cards (pay-period lens) + three simple
// lists (private To-do, private Follow-up, shared Material).
function HomeTab(p: Ctx & { hoursCards: Props['hoursCards']; personalItems: Record<string, ContractingPersonalItem>; shoppingList: Record<string, ContractingShoppingItem>; workOrders: Record<string, ContractingWorkOrder>; onGoToMyWorkOrders: (priority?: 'all' | 'low' | 'normal' | 'high') => void }) {
  const me = p.currentUser;
  const mine = Object.values(p.personalItems).filter(i => i.userId === me.id);
  // My assigned, non-completed, non-archived work orders — grouped by priority.
  const myWos = Object.values(p.workOrders).filter(w => woIsAssignedTo(w, me.id) && woStatus(w) !== 'done' && !w.archived);
  const woStats = woWeekStats(myWos, Date.now());
  const priMeta = { high: { label: 'high priority', dot: '#C0392B', color: '#C0392B' }, normal: { label: 'normal', dot: '#2874A6', color: '#2874A6' }, low: { label: 'low', dot: '#7F8C8D', color: '#566573' } };
  const priRows = (['high', 'normal', 'low'] as const).map(pri => ({ pri, count: myWos.filter(w => w.priority === pri).length, ...priMeta[pri] })).filter(r => r.count > 0);
  return (
    <div className="max-w-md mx-auto space-y-5">
      {/* CLOCK — big punch button on top (contractors) */}
      {!p.canManage && <ContractorClockTab active={p.myActivePunch} today={p.myTodayPunches} onIn={p.onClockIn} onOut={p.onClockOut} />}

      {/* MY HOURS — readable log first: days, totals, notes; tap to correct */}
      {!p.canManage && <MyHoursSection me={me} employees={p.employees} payrollTimeEntries={p.payrollTimeEntries} periodCard={p.hoursCards.current} onSaveOwn={p.onSaveOwnContractorTime} />}

      {/* HOURS — hours only, never rates or pay amounts */}
      <div>
        <div className="text-xs font-black uppercase tracking-widest mb-1" style={{ color: PALERMO.slate }}>Hours</div>
        <div className="grid grid-cols-2 gap-3">
          <HoursCard label="Last paycheque" data={p.hoursCards.last} verb="paid" />
          <HoursCard label="This paycheque" data={p.hoursCards.current} verb="pays" inProgress />
        </div>
      </div>

      {/* MY WORK ORDERS — counts by priority, tap-through to the pre-filtered list */}
      <div className="bg-white rounded-xl border">
        <button onClick={() => p.onGoToMyWorkOrders('all')} className="w-full flex items-center justify-between px-3 py-2 border-b text-left">
          <span>
            <span className="text-xs font-black uppercase tracking-widest block" style={{ color: PALERMO.slate }}>My work orders</span>
            {(woStats.overdue > 0 || woStats.scheduledThisWeek > 0) && (
              <span className="text-[11px] font-semibold" style={{ color: woStats.overdue > 0 ? '#C0392B' : '#566573' }}>
                {[woStats.overdue > 0 ? `${woStats.overdue} overdue` : null, woStats.scheduledThisWeek > 0 ? `${woStats.scheduledThisWeek} scheduled this week` : null].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
          <span className="text-xs text-gray-400">{myWos.length} open →</span>
        </button>
        <div className="divide-y">
          {priRows.map(r => (
            <button key={r.pri} onClick={() => p.onGoToMyWorkOrders(r.pri)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50" style={{ minHeight: 44 }}>
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.dot }} />
              <span className="font-black text-lg" style={{ color: r.color }}>{r.count}</span>
              <span className="text-sm text-gray-600 flex-1">{r.label}</span>
              <span className="text-gray-300">›</span>
            </button>
          ))}
          {priRows.length === 0 && <div className="px-3 py-3 text-sm text-gray-400">No open work orders</div>}
        </div>
      </div>

      {/* MY LISTS */}
      <PersonalList title="To-do" list="todo" items={mine.filter(i => i.list === 'todo')} me={me} onSave={p.onSavePersonalItem} onDelete={p.onDeletePersonalItem} />
      <PersonalList title="Follow-up" list="followup" items={mine.filter(i => i.list === 'followup')} me={me} onSave={p.onSavePersonalItem} onDelete={p.onDeletePersonalItem} />
      <MaterialMini items={Object.values(p.shoppingList)} me={me} canDeleteAny={p.canManage} onSave={p.onSaveShoppingItem} onDelete={p.onDeleteShoppingItem} />
    </div>
  );
}

function HoursCard({ label, data, verb, inProgress }: { label: string; data: { rangeLabel: string; payDate: string; hours: number }; verb: string; inProgress?: boolean }) {
  const hm = `${Math.floor(data.hours)}h ${Math.round((data.hours - Math.floor(data.hours)) * 60)}m`;
  return (
    <div className={`bg-white rounded-xl border p-3 ${inProgress ? 'border-emerald-200' : 'border-slate-200'}`}>
      <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: inProgress ? '#1E8449' : PALERMO.slate }}>{label} · {data.rangeLabel}</div>
      <div className="text-2xl font-black" style={{ color: inProgress ? '#1E8449' : PALERMO.slate }}>{hm}</div>
      <div className="text-[10px] text-gray-400">{inProgress ? 'in progress · ' : ''}{verb} {data.payDate}</div>
    </div>
  );
}

// Personal (private) list — two-tap add, check → Done (collapsed; ~14-day auto-hide).
function PersonalList({ title, list, items, me, onSave, onDelete }: { title: string; list: 'todo' | 'followup'; items: ContractingPersonalItem[]; me: { id: string; name: string }; onSave: (it: ContractingPersonalItem) => void; onDelete: (id: string) => void }) {
  const [text, setText] = useState('');
  const [showDone, setShowDone] = useState(false);
  const active = items.filter(i => !i.done).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const twoWeeks = Date.now() - 14 * 86400000;
  const done = items.filter(i => i.done && (i.doneAt || 0) > twoWeeks).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const add = () => { if (!text.trim()) return; onSave({ id: uid('cpi'), userId: me.id, list, text: text.trim(), createdBy: me, createdAt: Date.now() }); setText(''); };
  const toggle = (i: ContractingPersonalItem) => onSave({ ...i, done: !i.done, doneAt: !i.done ? Date.now() : undefined });
  // One-tap move between the two personal lists (keeps text + createdAt).
  const otherList: 'todo' | 'followup' = list === 'todo' ? 'followup' : 'todo';
  const otherLabel = list === 'todo' ? 'Follow-up' : 'To-do';
  const move = (i: ContractingPersonalItem) => onSave({ ...i, list: otherList, movedAt: Date.now() });
  return (
    <div>
      <div className="text-xs font-black uppercase tracking-widest mb-1" style={{ color: PALERMO.slate }}>{title} <span className="text-gray-400 font-semibold normal-case tracking-normal">· private</span></div>
      <div className="flex gap-2 mb-2">
        <input className="inp flex-1" style={{ minHeight: 44 }} placeholder={`Add ${title.toLowerCase()}…`} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <button onClick={add} disabled={!text.trim()} className="px-4 rounded text-white font-bold disabled:opacity-40" style={{ backgroundColor: PALERMO.gold, minHeight: 44 }}>Add</button>
      </div>
      <div className="space-y-1">
        {active.map(i => (
          <div key={i.id} className="flex items-center gap-3 bg-white rounded-lg border p-2.5" style={{ minHeight: 44 }}>
            <button onClick={() => toggle(i)} className="flex items-center gap-3 flex-1 text-left">
              <span className="w-5 h-5 rounded border-2 shrink-0" style={{ borderColor: PALERMO.slate }} />
              <span className="flex-1 text-sm">{i.text}</span>
            </button>
            <button onClick={() => move(i)} title={`Move to ${otherLabel}`} aria-label={`Move to ${otherLabel}`} className="text-lg px-1.5 shrink-0" style={{ color: PALERMO.slate }}>⇄</button>
            <button onClick={() => onDelete(i.id)} className="text-red-400 text-lg px-1 shrink-0">×</button>
          </div>
        ))}
        {active.length === 0 && <div className="text-gray-400 text-sm">Nothing here.</div>}
      </div>
      {done.length > 0 && (
        <div className="mt-1">
          <button onClick={() => setShowDone(s => !s)} className="text-[11px] font-semibold text-gray-400 uppercase">{showDone ? '▾' : '▸'} Done ({done.length})</button>
          {showDone && <div className="space-y-1 mt-1">{done.map(i => (
            <div key={i.id} className="flex items-center gap-3 bg-white/60 rounded-lg border p-2 opacity-60" style={{ minHeight: 40 }}>
              <button onClick={() => toggle(i)} className="flex items-center gap-3 flex-1 text-left">
                <span className="w-4 h-4 rounded flex items-center justify-center text-white text-[10px] shrink-0" style={{ backgroundColor: '#27AE60' }}>✓</span>
                <span className="flex-1 text-sm line-through text-gray-500">{i.text}</span>
              </button>
              <button onClick={() => onDelete(i.id)} className="text-red-400 text-lg px-1 shrink-0">×</button>
            </div>
          ))}</div>}
        </div>
      )}
    </div>
  );
}

// Shared company Material list, surfaced simply on Home (same data as the tab).
function MaterialMini({ items, me, canDeleteAny, onSave, onDelete }: { items: ContractingShoppingItem[]; me: { id: string; name: string }; canDeleteAny: boolean; onSave: (s: ContractingShoppingItem) => void; onDelete: (id: string) => void }) {
  const [text, setText] = useState('');
  const active = items.filter(i => !i.purchased).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  const add = () => { if (!text.trim()) return; onSave({ id: uid('csh'), item: text.trim(), addedBy: me, addedAt: Date.now() }); setText(''); };
  const toggle = (i: ContractingShoppingItem) => onSave({ ...i, purchased: !i.purchased, purchasedBy: !i.purchased ? me.name : undefined, purchasedAt: !i.purchased ? Date.now() : undefined });
  return (
    <div>
      <div className="text-xs font-black uppercase tracking-widest mb-1" style={{ color: PALERMO.slate }}>Material <span className="text-gray-400 font-semibold normal-case tracking-normal">· shared with the team</span></div>
      <div className="flex gap-2 mb-2">
        <input className="inp flex-1" style={{ minHeight: 44 }} placeholder="Add material, supply, or tool…" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <button onClick={add} disabled={!text.trim()} className="px-4 rounded text-white font-bold disabled:opacity-40" style={{ backgroundColor: PALERMO.gold, minHeight: 44 }}>Add</button>
      </div>
      <div className="space-y-1">
        {active.map(i => (
          <div key={i.id} className="flex items-center gap-3 bg-white rounded-lg border p-2.5" style={{ minHeight: 44 }}>
            <button onClick={() => toggle(i)} className="flex items-center gap-3 flex-1 text-left">
              <span className="w-5 h-5 rounded border-2 shrink-0" style={{ borderColor: PALERMO.slate }} />
              <span className="flex-1 text-sm"><b>{i.item}</b>{i.qty ? ` · ${i.qty}` : ''}{i.supplier ? <span className="text-xs text-gray-400"> · {i.supplier}</span> : ''}</span>
            </button>
            {(canDeleteAny || i.addedBy?.id === me.id) && <button onClick={() => confirm(`Delete "${i.item}"?`) && onDelete(i.id)} className="text-red-400 text-lg px-1 shrink-0">×</button>}
          </div>
        ))}
        {active.length === 0 && <div className="text-gray-400 text-sm">Nothing to buy. 🎉</div>}
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
  const [deleting, setDeleting] = useState(false);
  const [merging, setMerging] = useState(false);
  const removable = projectIsRemovable(project.id, p.invoices, p.reports, p.timeEntries);
  const rollup = projectBillables(project, p.invoices, p.reports);
  const blendedPct = projectCompletionPct(project);

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
        {/* Blended completion — simple average of the phases' manual %. */}
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide" style={{ color: '#AEB6BF' }}>Progress</span>
          <div className="flex-1 h-2 rounded-full overflow-hidden bg-black/25">
            <div className="h-full rounded-full" style={{ width: `${blendedPct}%`, backgroundColor: PALERMO.gold }} />
          </div>
          <span className="text-xs font-bold" style={{ color: PALERMO.gold }}>{blendedPct}%</span>
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

function PhaseCard(p: Ctx & { phase: ContractingPhase; project: ContractingProject; rates: ContractingRateCard; invoices: ContractingInvoice[]; reports: ContractingProgressReport[]; timeEntries: ContractingTimeEntry[]; rateOverrides: Record<string, number>; nav: Nav; onUpdatePhase: (ph: ContractingPhase) => void; onRemovePhase: () => void }) {
  const { phase, project, canManage, currentUser, nav } = p;
  const b = phaseBillables(project.id, phase.id, p.invoices);
  const ready = phaseReadyToBill(phase);
  const [newItem, setNewItem] = useState('');
  const [editing, setEditing] = useState(false);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const hasBilling = phaseHasInvoicedBilling(project.id, phase.id, p.invoices, p.reports);
  const removable = phaseIsRemovable(project.id, phase.id, p.invoices, p.reports, p.timeEntries);
  // This phase's invoices (non-voided) + reports, for two-way linkage.
  const phaseInvoices = p.invoices.filter(i => i.projectId === project.id && i.phaseId === phase.id && !i.voided).sort((a, b2) => (a.issuedAt || 0) - (b2.issuedAt || 0));
  const phaseReports = p.reports.filter(r => r.projectId === project.id && r.phaseId === phase.id).sort((a, b2) => a.reportNumber - b2.reportNumber);
  const pct = Math.max(0, Math.min(100, Number(phase.completionPct) || 0));

  const toggleDone = (item: ContractingChecklistItem) => {
    if (!canManage) return;
    const done = !item.done;
    p.onUpdatePhase({ ...phase, checklist: phase.checklist.map(c => c.id === item.id ? { ...c, done, doneBy: done ? currentUser.name : undefined, doneAt: done ? Date.now() : undefined } : c) });
  };
  const toggleReq = (item: ContractingChecklistItem) => canManage && p.onUpdatePhase({ ...phase, checklist: phase.checklist.map(c => c.id === item.id ? { ...c, required: !c.required } : c) });
  const addItem = () => { if (!newItem.trim()) return; p.onUpdatePhase({ ...phase, checklist: [...phase.checklist, { id: uid('chk'), text: newItem.trim(), required: true, done: false }] }); setNewItem(''); };
  const deleteItem = (item: ContractingChecklistItem) => { p.onUpdatePhase({ ...phase, checklist: phase.checklist.filter(c => c.id !== item.id) }); p.onLogEdit(`Deleted checklist item "${item.text}"${item.required ? ' (required)' : ''} on ${phase.name}`); };
  const setPct = (v: number) => p.onUpdatePhase({ ...phase, completionPct: Math.max(0, Math.min(100, Math.round(v))), completionPctBy: currentUser.name, completionPctAt: Date.now() });

  return (
    <div className="bg-white rounded-lg border p-3">
      <div className="flex items-center justify-between flex-wrap gap-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold" style={{ color: PALERMO.slate }}>{phase.name}</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: phase.type === 'tm' ? '#EBF5FB' : '#FEF9E7', color: phase.type === 'tm' ? '#2874A6' : PALERMO.gold }}>{phase.type === 'tm' ? 'T&M' : 'FIXED'}</span>
          <span className="text-xs font-bold" style={{ color: PALERMO.gold }}>{pct}%</span>
        </div>
        <div className="flex items-center gap-2">
          {canManage && <button onClick={() => setCreatingInvoice(true)} className="text-xs px-2 py-0.5 rounded text-white font-black" style={{ backgroundColor: PALERMO.gold }}>+ Invoice</button>}
          {canManage
            ? <StatusSelect value={phase.status} onChange={s => p.onUpdatePhase({ ...phase, status: s })} small />
            : <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100">{STATUS_LABEL[phase.status]}</span>}
          {canManage && <button onClick={() => setEditing(true)} className="text-xs px-2 py-0.5 rounded border font-semibold" style={{ color: PALERMO.slate }}>Edit</button>}
        </div>
      </div>
      {/* Completion progress bar (gold on slate) — informational, manual. */}
      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#2E4053' }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: PALERMO.gold }} />
        </div>
        {canManage && <input type="number" min={0} max={100} step={5} defaultValue={pct} onBlur={e => { const v = Number(e.target.value); if (v !== pct) setPct(v); }} className="inp w-14 text-xs py-0.5 text-right" />}
      </div>
      {editing && <PhaseEditForm phase={phase} hasBilling={hasBilling} removable={removable} currentUser={currentUser}
        onClose={() => setEditing(false)}
        onSave={np => { p.onUpdatePhase(np); setEditing(false); }}
        onRemove={() => { p.onRemovePhase(); setEditing(false); }} />}
      {creatingInvoice && <CreateInvoiceForm projects={[project]} presetProjectId={project.id} presetPhaseId={phase.id} currentUser={currentUser} onClose={() => setCreatingInvoice(false)} onSave={inv => { p.onSaveInvoice(inv); setCreatingInvoice(false); }} />}
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
              {item.done && item.doneBy && <span className="text-[10px] text-gray-400">{item.doneBy} · {fmtDate(item.doneAt)}</span>}
              {canManage && <button onClick={() => deleteItem(item)} title="Delete item" className="text-red-400 text-sm ml-auto">×</button>}
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
  const [openingFor, setOpeningFor] = useState<{ proj: ContractingProject; ph: ContractingPhase; lastEnd: number } | null>(null);
  // Minted invoice for a closed report (report → invoice linkage).
  const invoiceForReport = (reportId: string) => p.invoices.find(i => i.reportId === reportId);
  // T&M phases across projects, with their open report (if any).
  const tmPhases = p.projects.flatMap(proj => proj.phases.filter(ph => ph.type === 'tm').map(ph => ({ proj, ph })));
  const openReportFor = (projectId: string, phaseId: string) => p.reports.find(r => r.projectId === projectId && r.phaseId === phaseId && r.status === 'open');
  const lastEndFor = (projectId: string, phaseId: string) => p.reports.filter(r => r.projectId === projectId && r.phaseId === phaseId && r.endAt).reduce((m, r) => Math.max(m, r.endAt || 0), 0);

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
                {!open && canManage && <button onClick={() => setOpeningFor({ proj, ph, lastEnd: lastEndFor(proj.id, ph.id) })} className="text-sm px-2.5 py-1 rounded text-white font-semibold" style={{ backgroundColor: PALERMO.gold }}>Open billing period</button>}
              </div>
              {open && <OpenReport report={open} project={proj} phase={ph} {...p} />}
              {!open && <div className="text-xs text-gray-400 mt-1">No open billing period.</div>}
            </div>
          );
        })}
      </div>
      {openingFor && <OpenPeriodForm proj={openingFor.proj} ph={openingFor.ph} lastEnd={openingFor.lastEnd} onClose={() => setOpeningFor(null)} onOpen={startAt => { p.onOpenReport(openingFor.proj.id, openingFor.ph.id, startAt); setOpeningFor(null); }} />}

      {/* Historic (invoiced) reports */}
      {p.reports.some(r => r.status === 'invoiced') && (
        <div className="mt-5">
          <h3 className="font-semibold text-sm text-gray-500 uppercase mb-1">Closed reports</h3>
          <div className="space-y-1">
            {p.reports.filter(r => r.status === 'invoiced').sort((a, b) => (b.endAt || 0) - (a.endAt || 0)).map(r => {
              const proj = p.projects.find(x => x.id === r.projectId);
              const minted = invoiceForReport(r.id);
              const del = reportIsDeletable(r.id, p.invoices);
              return (
                <div key={r.id} className="bg-white rounded border p-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm">{proj?.name} · Report #{r.reportNumber}{minted && <button onClick={() => p.nav.openInvoice(minted.id)} className="ml-2 text-xs underline decoration-dotted" style={{ color: PALERMO.slate }}>→ {minted.number}</button>}</div>
                    {/* Billing-period range — prominent, readable at a glance. */}
                    <div className="text-base font-bold" style={{ color: PALERMO.slate }}>{fmtDate(r.startAt)} – {fmtDate(r.endAt)}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <b style={{ color: PALERMO.slate }}>{money(r.snapshot?.total || 0)}</b>
                    {canManage && (del.deletable
                      ? <button onClick={() => confirm(`Delete Report #${r.reportNumber} (${fmtDate(r.startAt)}–${fmtDate(r.endAt)})? This cannot be undone.`) && p.onDeleteReport(r.id)} className="text-red-500 text-sm font-semibold px-1" title="Delete report">Delete</button>
                      : <span className="text-[10px] text-gray-400 text-right leading-tight" title="A live invoice backs this report">void {del.blockedBy}<br />to delete</span>)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Reference-only punched-hours panel on the open report (Marco/Tony). READS
// payroll timeEntries; never writes them. Report math is unchanged by its
// presence. Shows each contractor's punched hours in the report's date range
// (per day + period total) beside the BILLED total, with a neutral delta.
function TimeMasterRefPanel({ report, contractors, payrollTimeEntries, onBreakdown }: { report: ContractingProgressReport; contractors: Employee[]; payrollTimeEntries: TimeEntry[]; onBreakdown: (contractorId: string) => void }) {
  const [open, setOpen] = useState(false);
  const startTs = report.startAt;
  const endTs = report.endAt || Date.now();
  const dur = (e: TimeEntry) => { const end = e.clockOut ? new Date(e.clockOut).getTime() : Date.now(); return Math.max(0, (end - new Date(e.clockIn).getTime()) / 3_600_000); };
  const emailOf = (c: Employee) => (c.linkedUserEmail || c.email || '').toLowerCase();
  const billedByC = new Map<string, number>();
  report.manualTime.forEach(t => billedByC.set(t.contractorId, (billedByC.get(t.contractorId) || 0) + (Number(t.hours) || 0)));
  const rows = contractors.map(c => {
    const email = emailOf(c);
    const entries = payrollTimeEntries.filter(e => (e.userEmail || '').toLowerCase() === email && (() => { const t = new Date(e.clockIn).getTime(); return t >= startTs && t <= endTs; })());
    // Per-punch rows (with any clock-out note) + the day/period rollup.
    const punches = entries.map(e => ({ day: new Date(e.clockIn).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }), hours: dur(e), note: e.workNote })).sort((a, b) => a.day.localeCompare(b.day));
    const punched = entries.reduce((s, e) => s + dur(e), 0);
    const billed = billedByC.get(c.id) || 0;
    return { c, punched, billed, punches };
  }).filter(r => r.punched > 0 || r.billed > 0);
  if (rows.length === 0) return null;
  return (
    <div className="mt-2 rounded border" style={{ borderColor: '#D5DBDB' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] font-black uppercase tracking-wide" style={{ color: PALERMO.slate }}>
        <span>⏱ TimeMaster hours this period</span><span>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-2">
          <div className="text-[10px] text-gray-400">Punched hours — reference only, never auto-billed. Deductions are your call.</div>
          {rows.map(r => {
            const delta = round2(r.punched - r.billed);
            return (
              <div key={r.c.id} className="border-t pt-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm" style={{ color: PALERMO.slate }}>{r.c.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-gray-600">punched <b>{round2(r.punched)}h</b> · billed <b>{round2(r.billed)}h</b> · <span style={{ color: '#7F8C8D' }}>{delta >= 0 ? '+' : ''}{delta}h</span></span>
                    {r.punched > 0 && <button onClick={() => onBreakdown(r.c.id)} className="text-[11px] px-2 py-0.5 rounded border font-semibold whitespace-nowrap" style={{ color: PALERMO.slate }}>use punched</button>}
                  </span>
                </div>
                {/* Per-punch rows — hours + the clock-out note when present. */}
                {r.punches.length > 0 && (
                  <div className="text-[11px] text-gray-500 mt-0.5 space-y-0.5">
                    {r.punches.map((pn, i) => (
                      <div key={i}><span className="text-gray-600">{pn.day}: {round2(pn.hours)}h</span>{pn.note && <span className="italic text-gray-500"> · “{pn.note}”</span>}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Per-day editable billing breakdown for ONE person, opened from "use punched".
// One row per punched day in the report window: date · punched hours · BILLABLE
// hours (editable, defaults to punched, 0 allowed) · that day's clock-out note
// (shown, editable, carried into the line description) · a checkbox (default
// checked). Days already billed on THIS report (a line already exists for this
// person+date) are shown separately and excluded from re-adding — no double-
// billing, same spirit as the one-report-ever guard. Saving emits one OWN
// manual-hours line per checked day (billable > 0), exactly like a manually-
// entered daily line. READS payroll timeEntries only — never writes a punch.
function PunchBreakdownForm({ report, contractor, rates, rateOverrides, currentUser, payrollTimeEntries, onClose, onSave }: { report: ContractingProgressReport; contractor: Employee; rates: ContractingRateCard; rateOverrides: Record<string, number>; currentUser: { id: string; name: string }; payrollTimeEntries: TimeEntry[]; onClose: () => void; onSave: (rows: ContractingTimeEntry[]) => void }) {
  const startTs = report.startAt;
  const endTs = report.endAt || Date.now();
  const dur = (e: TimeEntry) => { const end = e.clockOut ? new Date(e.clockOut).getTime() : Date.now(); return Math.max(0, (end - new Date(e.clockIn).getTime()) / 3_600_000); };
  const email = (contractor.linkedUserEmail || contractor.email || '').toLowerCase();
  const role = (contractor.contractingBillingRole || 'general_labour') as ContractingBillingRole;
  // The person's rate (override wins, else billing-role rate) — the same rate a
  // manual daily line resolves to; billable × this is the previewed amount.
  const rate = rateOverrides[contractor.id] ?? rateFor(role, rates);

  // Days already billed for this person on this report (person+date match).
  const billedDays = new Set(report.manualTime.filter(t => t.contractorId === contractor.id).map(t => dateInputVal(t.clockIn)));

  // Per-day punched rollup within the window: sum hours, join distinct notes.
  const days = useMemo(() => {
    const byDay = new Map<string, { ymd: string; dateMs: number; punched: number; notes: string[] }>();
    payrollTimeEntries
      .filter(e => (e.userEmail || '').toLowerCase() === email)
      .filter(e => { const t = new Date(e.clockIn).getTime(); return t >= startTs && t <= endTs; })
      .forEach(e => {
        const ymd = dateInputVal(new Date(e.clockIn).getTime());
        const cur = byDay.get(ymd) || { ymd, dateMs: dateFromInput(ymd), punched: 0, notes: [] };
        cur.punched += dur(e);
        const n = (e.workNote || '').trim(); if (n) cur.notes.push(n);
        byDay.set(ymd, cur);
      });
    return [...byDay.values()]
      .map(d => ({ ymd: d.ymd, dateMs: d.dateMs, punched: round2(d.punched), note: [...new Set(d.notes)].join(' · ') }))
      .sort((a, b) => a.ymd.localeCompare(b.ymd));
  }, [payrollTimeEntries, email, startTs, endTs]);

  const fresh = days.filter(d => !billedDays.has(d.ymd));      // editable rows
  const already = days.filter(d => billedDays.has(d.ymd));     // shown, excluded

  type St = { billable: string; note: string; checked: boolean };
  const seed = (): Record<string, St> => Object.fromEntries(fresh.map(d => [d.ymd, { billable: String(d.punched), note: d.note, checked: true }]));
  const [st, setSt] = useState<Record<string, St>>(seed);
  const setDay = (ymd: string, patch: Partial<St>) => setSt(s => ({ ...s, [ymd]: { ...s[ymd], ...patch } }));
  // Clean-week shortcut: check every fresh day, billable = punched, note = note.
  const billAllPunched = () => setSt(Object.fromEntries(fresh.map(d => [d.ymd, { billable: String(d.punched), note: d.note, checked: true }])));

  // A day bills only if checked AND billable > 0 (0 = "doesn't bill").
  const willBill = fresh.filter(d => st[d.ymd]?.checked && Number(st[d.ymd]?.billable) > 0);
  const total = willBill.reduce((s, d) => s + Number(st[d.ymd].billable) * rate, 0);

  const commit = () => {
    const out: ContractingTimeEntry[] = willBill.map(d => ({
      id: uid('cmt'), projectId: report.projectId, phaseId: report.phaseId,
      contractorId: contractor.id, contractorName: contractor.name, billingRole: role,
      clockIn: d.dateMs, manual: true, hours: round2(Number(st[d.ymd].billable)),
      // Breakdown bills at the person's role/override rate — no per-line odd rate.
      description: st[d.ymd].note.trim() || undefined,
      reportId: report.id, status: 'open', createdBy: currentUser, createdAt: Date.now(),
    }));
    onSave(out);
  };

  return (
    <Modal title={`Bill ${contractor.name}'s punched days`} onClose={onClose}>
      {fresh.length === 0 ? (
        <div className="text-sm text-gray-500 py-2">
          {days.length === 0 ? 'No punched days in this period.' : 'All punched days here are already billed on this report.'}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[11px] text-gray-500">Billable defaults to punched — reduce, zero out, or uncheck a day. Rate {money(rate)}/h.</div>
            <button onClick={billAllPunched} className="text-[11px] px-2 py-0.5 rounded border font-semibold whitespace-nowrap shrink-0" style={{ color: PALERMO.slate }}>bill all as punched</button>
          </div>
          <div className="space-y-2">
            {fresh.map(d => {
              const s = st[d.ymd]; const reduced = Number(s.billable) !== d.punched;
              return (
                <div key={d.ymd} className={`rounded border p-2 ${s.checked ? '' : 'opacity-50'}`} style={{ borderColor: '#D5DBDB' }}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={s.checked} onChange={e => setDay(d.ymd, { checked: e.target.checked })} className="w-4 h-4 shrink-0" />
                    <span className="font-semibold text-sm shrink-0" style={{ color: PALERMO.slate }}>{fmtShort(d.dateMs)}</span>
                    <span className="text-xs text-gray-500 shrink-0">punched <b>{round2(d.punched)}h</b></span>
                    <span className="text-xs text-gray-400">→</span>
                    <label className="text-xs text-gray-500 flex items-center gap-1 ml-auto shrink-0">billable
                      <input type="number" step="0.25" min="0" value={s.billable} onChange={e => setDay(d.ymd, { billable: e.target.value })} className="inp w-16" />h
                    </label>
                  </div>
                  <input className="inp text-sm mt-1.5" placeholder="Note / description (carried onto the line)" value={s.note} onChange={e => setDay(d.ymd, { note: e.target.value })} />
                  {reduced && s.checked && Number(s.billable) >= 0 && <div className="text-[10px] mt-0.5" style={{ color: '#7F8C8D' }}>{round2(d.punched - Number(s.billable))}h deducted from punched</div>}
                </div>
              );
            })}
          </div>
        </>
      )}
      {already.length > 0 && (
        <div className="mt-2 pt-2 border-t">
          <div className="text-[10px] font-black uppercase tracking-wide text-gray-400 mb-1">Already billed on this report</div>
          {already.map(d => (
            <div key={d.ymd} className="text-[11px] text-gray-400 flex items-center gap-2"><span>{fmtShort(d.dateMs)}</span><span>· punched {round2(d.punched)}h</span><span className="italic">· already billed</span></div>
          ))}
        </div>
      )}
      {fresh.length > 0 && (
        <>
          <div className="text-sm mt-2">{willBill.length} day line(s) · <b style={{ color: PALERMO.gold }}>{money(total)}</b></div>
          <ModalActions onClose={onClose} disabled={willBill.length === 0} onSave={commit} />
        </>
      )}
    </Modal>
  );
}

function OpenReport(p: Ctx & { report: ContractingProgressReport; project: ContractingProject; phase: ContractingPhase; rates: ContractingRateCard; timeEntries: ContractingTimeEntry[]; reports: ContractingProgressReport[]; contractors: Employee[]; rateOverrides: Record<string, number>; nav: Nav }) {
  const { report, canManage } = p;
  const rc = ratesOrDefault(p.rates);
  const labour = labourForReport(report);
  const snap = computeReportTotals(labour, report.receipts, p.rates, p.rateOverrides);
  const manualRate = (t: ContractingTimeEntry) => (t.rateOverride != null && t.rateOverride > 0) ? t.rateOverride : (p.rateOverrides[t.contractorId] ?? rateFor(t.billingRole, rc));

  const [batchOpen, setBatchOpen] = useState(false);
  // "use punched" → per-day breakdown for one person (their id).
  const [breakdownCid, setBreakdownCid] = useState<string | null>(null);
  const [editManual, setEditManual] = useState<ContractingTimeEntry | null>(null);
  const [addingMaterial, setAddingMaterial] = useState(false);
  const [editReceipt, setEditReceipt] = useState<ContractingReceipt | null>(null);
  const [editingStart, setEditingStart] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [viewPhotos, setViewPhotos] = useState<StoredFile[] | null>(null);
  // End of the previous invoiced period on this phase (for gap/overlap check).
  const prevEnd = p.reports.filter(r => r.id !== report.id && r.projectId === report.projectId && r.phaseId === report.phaseId && r.endAt).reduce((m, r) => Math.max(m, r.endAt || 0), 0);

  const saveReport = (patch: Partial<ContractingProgressReport>) => p.onSaveReport({ ...report, ...patch, updatedAt: Date.now() });
  const removeReceipt = (r: ContractingReceipt) => { saveReport({ receipts: report.receipts.filter(x => x.id !== r.id) }); p.onLogEdit(`Deleted material "${r.description}" (${money(r.billed)}) on report #${report.reportNumber}`); };
  const removeManual = (t: ContractingTimeEntry) => { saveReport({ manualTime: report.manualTime.filter(x => x.id !== t.id) }); p.onLogEdit(`Deleted ${t.contractorName} ${t.hours}h hours line on report #${report.reportNumber}`); };

  return (
    <div className="mt-2 border-t pt-2">
      <div className="flex items-end justify-between">
        <span className="text-xs text-gray-500">Report #{report.reportNumber}</span>
        {/* Billing-period start — prominent, readable at a glance on phone. */}
        <span className="text-right">
          <span className="block text-[10px] text-gray-400 uppercase tracking-wide leading-none">Open since</span>
          <span className="text-base font-bold" style={{ color: PALERMO.slate }}>{fmtDate(report.startAt)}{canManage && <button onClick={() => setEditingStart(true)} className="ml-1.5 text-xs font-normal underline decoration-dotted" style={{ color: PALERMO.slate }}>edit</button>}</span>
        </span>
      </div>

      {/* Labour — batch "+ Add hours" lines (editable workbench) */}
      <div className="mt-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold text-gray-500 uppercase">Labour</div>
          {canManage && <button onClick={() => setBatchOpen(true)} className="text-xs font-black px-2.5 py-1 rounded text-white" style={{ backgroundColor: PALERMO.gold }}>+ Add hours</button>}
        </div>
        {report.manualTime.length === 0 && <div className="text-xs text-gray-400">No hours yet.</div>}
        {/* "Jul 18 — Tony · 10 hr @ $150 = $1,500" */}
        {report.manualTime.map(t => { const r = manualRate(t); return (
          <div key={t.id} className="text-sm">
            <div className="flex justify-between items-center">
              <span>{fmtShort(t.clockIn)} — {t.contractorName} · {t.hours} hr @ {money(r)}{t.rateOverride != null ? <span className="text-[9px] ml-1 px-1 rounded bg-amber-100 text-amber-700">rate override</span> : ''}</span>
              <span className="flex items-center gap-2"><b>{money((Number(t.hours) || 0) * r)}</b>{canManage && <><button onClick={() => setEditManual(t)} className="text-[11px]" style={{ color: PALERMO.slate }}>edit</button><button onClick={() => removeManual(t)} className="text-red-400 text-sm">×</button></>}</span>
            </div>
            {t.description && <div className="text-[11px] text-gray-500 italic">“{t.description}”</div>}
          </div>
        ); })}
      </div>

      {/* TimeMaster punched-hours reference (Marco/Tony only) */}
      {canManage && <TimeMasterRefPanel report={report} contractors={p.contractors} payrollTimeEntries={p.payrollTimeEntries} onBreakdown={(cid) => setBreakdownCid(cid)} />}

      {/* Materials */}
      <div className="mt-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold text-gray-500 uppercase">Materials (billed — cost/markup internal)</div>
          {canManage && <button onClick={() => setAddingMaterial(true)} className="text-xs font-black px-2.5 py-1 rounded text-white" style={{ backgroundColor: PALERMO.gold }}>+ Add billable material</button>}
        </div>
        {report.receipts.length === 0 && <div className="text-xs text-gray-400">No materials yet.</div>}
        {report.receipts.map(r => (
          <div key={r.id} className="flex justify-between text-sm items-center">
            <span>{fmtShort(r.addedAt)} — {r.description}
              {canManage && <span className="text-[10px] text-gray-400"> · cost {money(r.cost)} +{r.markupPct}%</span>}
              {r.photo && <button onClick={() => setViewPhotos([r.photo!])} className="text-[10px] ml-1" style={{ color: PALERMO.gold }}>📷</button>}
            </span>
            <span className="flex items-center gap-2"><b>{money(r.billed)}</b>{canManage && <><button onClick={() => setEditReceipt(r)} className="text-[11px]" style={{ color: PALERMO.slate }}>edit</button><button onClick={() => removeReceipt(r)} className="text-red-400 text-sm">×</button></>}</span>
          </div>
        ))}
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
        <div className="flex gap-2 mt-2">
          <button onClick={() => setReviewing(true)} disabled={snap.subtotalPreHst <= 0} className="flex-1 py-2 rounded text-white font-bold disabled:opacity-40" style={{ backgroundColor: PALERMO.slate }}>End report &amp; bill →</button>
          <button onClick={() => confirm('Discard this open period without invoicing? (Only empty periods are removed.)') && p.onDiscardReport(report.id)} className="px-3 py-2 rounded border font-semibold text-red-600 border-red-200">Discard</button>
        </div>
      )}

      {batchOpen && <BatchHoursForm report={report} contractors={p.contractors} rates={rc} rateOverrides={p.rateOverrides} currentUser={p.currentUser} prefill={null} payrollTimeEntries={p.payrollTimeEntries} onClose={() => setBatchOpen(false)} onSave={rows => { saveReport({ manualTime: [...report.manualTime, ...rows] }); p.onLogEdit(`Added ${rows.length} hours line(s) to report #${report.reportNumber}`); setBatchOpen(false); }} />}
      {breakdownCid && (() => { const c = p.contractors.find(x => x.id === breakdownCid); if (!c) return null; return (
        <PunchBreakdownForm report={report} contractor={c} rates={rc} rateOverrides={p.rateOverrides} currentUser={p.currentUser} payrollTimeEntries={p.payrollTimeEntries} onClose={() => setBreakdownCid(null)} onSave={rows => { saveReport({ manualTime: [...report.manualTime, ...rows] }); p.onLogEdit(`Added ${rows.length} day line(s) for ${c.name} from punched hours to report #${report.reportNumber}`); setBreakdownCid(null); }} />
      ); })()}
      {editManual && <ManualLineEditForm line={editManual} rates={rc} rateOverrides={p.rateOverrides} onClose={() => setEditManual(null)} onSave={upd => { saveReport({ manualTime: report.manualTime.map(x => x.id === upd.id ? upd : x) }); p.onLogEdit(`Edited ${upd.contractorName} hours line on report #${report.reportNumber}`); setEditManual(null); }} />}
      {addingMaterial && <ReceiptForm project={p.project} uploadedBy={p.uploadedBy} currentUser={p.currentUser} addAnother onClose={() => setAddingMaterial(false)} onSave={rc2 => saveReport({ receipts: [...report.receipts, rc2] })} />}
      {editReceipt && <ReceiptForm project={p.project} uploadedBy={p.uploadedBy} currentUser={p.currentUser} initial={editReceipt} onClose={() => setEditReceipt(null)} onSave={rc2 => { saveReport({ receipts: report.receipts.map(x => x.id === rc2.id ? rc2 : x) }); p.onLogEdit(`Edited material "${rc2.description}" on report #${report.reportNumber}`); setEditReceipt(null); }} />}
      {reviewing && <ReviewConfirm report={report} project={p.project} phase={p.phase} snap={snap} onClose={() => setReviewing(false)} onConfirm={() => { p.onEndReport(report.id); setReviewing(false); }} />}
      {editingStart && <EditStartDateForm startAt={report.startAt} prevEnd={prevEnd} onClose={() => setEditingStart(false)} onSave={ms => { const from = fmtDate(report.startAt); saveReport({ startAt: ms }); p.onLogEdit(`Report #${report.reportNumber} start changed ${from} → ${fmtDate(ms)}`); setEditingStart(false); }} />}
      {viewPhotos && <PhotoViewer files={viewPhotos} onClose={() => setViewPhotos(null)} />}
    </div>
  );
}

// Edit an OPEN report's start date. Warns (doesn't block) on a gap or overlap
// against the previous invoiced period.
function EditStartDateForm({ startAt, prevEnd, onClose, onSave }: { startAt: number; prevEnd: number; onClose: () => void; onSave: (ms: number) => void }) {
  const [date, setDate] = useState(dateInputVal(startAt));
  const picked = dateFromInput(date);
  const gapDays = prevEnd ? Math.round((picked - prevEnd) / 86400000) : 0;
  return (
    <Modal title="Edit report start date" onClose={onClose}>
      <Field label="Start date"><input className="inp" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      {prevEnd ? <div className="text-xs text-gray-500 mb-2">Previous invoiced period ended {fmtDate(prevEnd)}.</div> : <div className="text-xs text-gray-500 mb-2">No previous invoiced period on this phase.</div>}
      {gapDays > 0 && <div className="text-xs px-2 py-1 rounded mb-2" style={{ backgroundColor: '#FEF9E7', color: PALERMO.gold }}>⚠ Leaves a {gapDays}-day gap after the last period.</div>}
      {gapDays < 0 && <div className="text-xs px-2 py-1 rounded mb-2" style={{ backgroundColor: '#FDEDEC', color: '#C0392B' }}>⚠ Starts before the last period ended — overlapping periods.</div>}
      <ModalActions onClose={onClose} disabled={false} onSave={() => onSave(picked)} />
    </Modal>
  );
}

function ReceiptForm({ project, uploadedBy, currentUser, initial, addAnother, onClose, onSave }: { project: ContractingProject; uploadedBy: { email: string; name: string }; currentUser: { id: string; name: string }; initial?: ContractingReceipt; addAnother?: boolean; onClose: () => void; onSave: (r: ContractingReceipt) => void }) {
  const [description, setDescription] = useState(initial?.description || '');
  const [cost, setCost] = useState(initial ? String(initial.cost) : '');
  const [markup, setMarkup] = useState(initial ? String(initial.markupPct) : '0');
  const [ref, setRef] = useState(initial?.preApprovedRef || '');
  const [photo, setPhoto] = useState<StoredFile | undefined>(initial?.photo);
  const [uploading, setUploading] = useState(false);
  const [added, setAdded] = useState(0);
  const billed = receiptBilled(Number(cost) || 0, Number(markup) || 0);
  const build = (): ContractingReceipt => ({ id: initial?.id || uid('crc'), description: description.trim(), cost: Number(cost) || 0, markupPct: Number(markup) || 0, billed, photo, preApprovedRef: ref.trim() || undefined, addedBy: initial?.addedBy || currentUser, addedAt: initial?.addedAt || Date.now() });
  const reset = () => { setDescription(''); setCost(''); setMarkup('0'); setRef(''); setPhoto(undefined); };
  const valid = !!description.trim() && !uploading;
  return (
    <Modal title={initial ? 'Edit billable material' : 'Add billable material'} onClose={onClose}>
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
      {addAnother && !initial ? (
        <div className="flex gap-2 mt-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded border font-semibold">Done{added ? ` (${added} added)` : ''}</button>
          <button onClick={() => { if (!valid) return; onSave(build()); setAdded(a => a + 1); reset(); }} disabled={!valid} className="flex-1 py-2.5 rounded text-white font-bold disabled:opacity-40" style={{ backgroundColor: PALERMO.gold }}>Add &amp; another</button>
        </div>
      ) : (
        <ModalActions onClose={onClose} disabled={!valid} onSave={() => onSave(build())} />
      )}
    </Modal>
  );
}

// Batch end-of-day hours entry: a date + rows of [contractor | hours | rate].
// Records each row as a manual time line on the open report.
function BatchHoursForm({ report, contractors, rates, rateOverrides, currentUser, prefill, payrollTimeEntries, onClose, onSave }: { report: ContractingProgressReport; contractors: Employee[]; rates: ContractingRateCard; rateOverrides: Record<string, number>; currentUser: { id: string; name: string }; prefill?: { contractorId: string; hours: number; note?: string } | null; payrollTimeEntries: TimeEntry[]; onClose: () => void; onSave: (rows: ContractingTimeEntry[]) => void }) {
  const [date, setDate] = useState(dateInputVal(Date.now()));
  const defaultRate = (emp?: Employee) => emp ? (rateOverrides[emp.id] ?? rateFor((emp.contractingBillingRole || 'general_labour') as ContractingBillingRole, rates)) : 0;
  type RowT = { key: string; contractorId: string; hours: string; rate: string; desc: string };
  const mkRow = (): RowT => { const c = contractors[0]; return { key: uid('row'), contractorId: c?.id || '', hours: '', rate: String(defaultRate(c) || ''), desc: '' }; };
  // One-tap assist: seed the first row with a contractor's punched total + note
  // (fully editable — Tony adjusts hours/rate/description before saving).
  const initRows = (): RowT[] => {
    if (prefill) { const c = contractors.find(x => x.id === prefill.contractorId) || contractors[0]; return [{ key: uid('row'), contractorId: c?.id || '', hours: prefill.hours ? String(prefill.hours) : '', rate: String(defaultRate(c) || ''), desc: prefill.note || '' }]; }
    return [mkRow()];
  };
  const [rows, setRows] = useState<RowT[]>(initRows);
  const setRow = (key: string, patch: Partial<RowT>) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r));
  const filled = rows.filter(r => r.contractorId && Number(r.hours) > 0);
  const total = filled.reduce((s, r) => s + Number(r.hours) * (Number(r.rate) || 0), 0);
  // Suggestion: a punch note for this person on the chosen date (informs, never auto-bills).
  const emailOf = (id: string) => (contractors.find(c => c.id === id)?.linkedUserEmail || contractors.find(c => c.id === id)?.email || '').toLowerCase();
  const noteFor = (contractorId: string): string | undefined => {
    const email = emailOf(contractorId); if (!email) return undefined;
    const hit = payrollTimeEntries.find(e => (e.userEmail || '').toLowerCase() === email && dateInputVal(new Date(e.clockIn).getTime()) === date && (e.workNote || '').trim());
    return hit?.workNote?.trim();
  };
  const commit = () => {
    const clockIn = dateFromInput(date);
    const out: ContractingTimeEntry[] = filled.map(r => {
      const emp = contractors.find(c => c.id === r.contractorId)!;
      const role = (emp.contractingBillingRole || 'general_labour') as ContractingBillingRole;
      const enteredRate = Number(r.rate) || 0;
      const def = defaultRate(emp);
      return {
        id: uid('cmt'), projectId: report.projectId, phaseId: report.phaseId, contractorId: emp.id, contractorName: emp.name,
        billingRole: role, clockIn, manual: true, hours: round2(Number(r.hours)),
        rateOverride: enteredRate !== def ? enteredRate : undefined,   // store only the odd exception
        description: r.desc.trim() || undefined,
        reportId: report.id, status: 'open', createdBy: currentUser, createdAt: Date.now(),
      };
    });
    onSave(out);
  };
  return (
    <Modal title="Add hours" onClose={onClose}>
      <Field label="Date"><input className="inp" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <div className="space-y-3">
        {rows.map(r => {
          const emp = contractors.find(c => c.id === r.contractorId);
          const suggestion = r.contractorId ? noteFor(r.contractorId) : undefined;
          return (
            <div key={r.key} className="space-y-1">
              <div className="flex gap-1.5 items-center">
                <select className="inp flex-1 min-w-0" value={r.contractorId} onChange={e => { const emp2 = contractors.find(c => c.id === e.target.value); setRow(r.key, { contractorId: e.target.value, rate: String(defaultRate(emp2) || '') }); }}>
                  {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input className="inp w-16" type="number" step="0.25" min="0" placeholder="hrs" value={r.hours} onChange={e => setRow(r.key, { hours: e.target.value })} />
                <span className="text-xs text-gray-400">@</span>
                <input className="inp w-20" type="number" step="5" value={r.rate} onChange={e => setRow(r.key, { rate: e.target.value })} title={emp ? `role rate ${money(defaultRate(emp))}` : ''} />
                {rows.length > 1 && <button onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))} className="text-red-400 text-sm px-1">×</button>}
              </div>
              <input className="inp text-sm" placeholder="Description (what the hours were for)" value={r.desc} onChange={e => setRow(r.key, { desc: e.target.value })} />
              {suggestion && suggestion !== r.desc && <button onClick={() => setRow(r.key, { desc: suggestion })} className="text-[11px] text-left" style={{ color: PALERMO.slate }}>use note: “{suggestion}”</button>}
            </div>
          );
        })}
      </div>
      <button onClick={() => setRows(rs => [...rs, mkRow()])} className="text-xs mt-2" style={{ color: PALERMO.slate }}>+ add row</button>
      <div className="text-[10px] text-gray-400 mt-1">15-min steps · rate auto-fills from billing role, editable for exceptions.</div>
      <div className="text-sm mt-2">{filled.length} line(s) · <b style={{ color: PALERMO.gold }}>{money(total)}</b></div>
      <ModalActions onClose={onClose} disabled={filled.length === 0} onSave={commit} />
    </Modal>
  );
}

// Edit one manual/batch time line (date, hours, rate).
function ManualLineEditForm({ line, rates, rateOverrides, onClose, onSave }: { line: ContractingTimeEntry; rates: ContractingRateCard; rateOverrides: Record<string, number>; onClose: () => void; onSave: (t: ContractingTimeEntry) => void }) {
  const def = rateOverrides[line.contractorId] ?? rateFor(line.billingRole, rates);
  const [date, setDate] = useState(dateInputVal(line.clockIn));
  const [hours, setHours] = useState(String(line.hours ?? ''));
  const [rate, setRate] = useState(String(line.rateOverride ?? def));
  const [desc, setDesc] = useState(line.description || '');
  const amt = (Number(hours) || 0) * (Number(rate) || 0);
  return (
    <Modal title={`Edit ${line.contractorName}'s hours`} onClose={onClose}>
      <Field label="Date"><input className="inp" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Hours"><input className="inp" type="number" step="0.25" min="0" value={hours} onChange={e => setHours(e.target.value)} /></Field>
        <Field label="Rate ($/hr)"><input className="inp" type="number" step="5" value={rate} onChange={e => setRate(e.target.value)} /></Field>
      </div>
      <Field label="Description"><input className="inp" value={desc} onChange={e => setDesc(e.target.value)} /></Field>
      <div className="text-sm mb-2">{ROLE_LABEL[line.billingRole]} · role rate {money(def)} → <b>{money(amt)}</b></div>
      <ModalActions onClose={onClose} disabled={!(Number(hours) > 0)} onSave={() => onSave({
        ...line, clockIn: dateFromInput(date), hours: round2(Number(hours)),
        rateOverride: Number(rate) !== def ? Number(rate) : undefined,
        description: desc.trim() || undefined,
      })} />
    </Modal>
  );
}

// Open a new billing period with a pickable start date (defaults to the day
// after the last invoiced period — a gap warning fires if a hole is left).
function OpenPeriodForm({ proj, ph, lastEnd, onClose, onOpen }: { proj: ContractingProject; ph: ContractingPhase; lastEnd: number; onClose: () => void; onOpen: (startAt: number) => void }) {
  const defaultStart = lastEnd || ph.tmStartAt || Date.now();
  const [date, setDate] = useState(dateInputVal(defaultStart));
  const picked = dateFromInput(date);
  // Contiguous start = the last period's end. Gap if picked is later; overlap if earlier.
  const gapDays = lastEnd ? Math.round((picked - lastEnd) / 86400000) : 0;
  return (
    <Modal title="Open billing period" onClose={onClose}>
      <div className="text-sm mb-2">{proj.name} · {ph.name}</div>
      <Field label="Start date"><input className="inp" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      {lastEnd ? <div className="text-xs text-gray-500 mb-2">Last invoiced period ended {fmtDate(lastEnd)}. Contiguous start keeps periods gap-free.</div>
        : <div className="text-xs text-gray-500 mb-2">First period on this phase.</div>}
      {gapDays > 0 && <div className="text-xs px-2 py-1 rounded mb-2" style={{ backgroundColor: '#FEF9E7', color: PALERMO.gold }}>⚠ Leaves a {gapDays}-day gap after the last invoiced period.</div>}
      {gapDays < 0 && <div className="text-xs px-2 py-1 rounded mb-2" style={{ backgroundColor: '#FDEDEC', color: '#C0392B' }}>⚠ Starts before the last period ended — overlapping periods.</div>}
      <ModalActions onClose={onClose} disabled={false} onSave={() => onOpen(picked)} />
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
  const { canManage, nav } = p;
  const [adding, setAdding] = useState(false);
  const [showVoided, setShowVoided] = useState(false);
  const [projectId, setProjectId] = useState(p.initialFilter.projectId || '');
  const [phaseId, setPhaseId] = useState(p.initialFilter.phaseId || '');
  const proj = p.projects.find(x => x.id === projectId);
  const projName = (id: string) => p.projects.find(x => x.id === id)?.name || '—';
  const phaseName = (pid: string, phid?: string) => phid ? (p.projects.find(x => x.id === pid)?.phases.find(ph => ph.id === phid)?.name || '—') : 'Whole project';
  const matches = (inv: ContractingInvoice) => (!projectId || inv.projectId === projectId) && (!phaseId || inv.phaseId === phaseId);
  const list = [...p.invoices].filter(inv => !inv.voided && matches(inv)).sort((a, b) => (b.issuedAt || b.createdAt || 0) - (a.issuedAt || a.createdAt || 0));
  const voidedList = [...p.invoices].filter(inv => inv.voided && matches(inv)).sort((a, b) => (b.voidedAt || 0) - (a.voidedAt || 0));
  const voidInvoice = (inv: ContractingInvoice) => { const reason = prompt(`Void ${inv.number}? This releases its work back to billable. Reason:`); if (reason && reason.trim()) p.onVoidInvoice(inv.id, reason.trim()); };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-lg" style={{ color: PALERMO.slate }}>Invoices</h2>
        {canManage && <button onClick={() => setAdding(true)} className="px-3 py-1.5 rounded text-white text-sm font-semibold" style={{ backgroundColor: PALERMO.gold }}>+ Create invoice</button>}
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
                {canManage && <button onClick={() => voidInvoice(inv)} className="text-xs px-2 py-1 rounded text-red-500">Void</button>}
              </div>
            </div>
          );
        })}
        {list.length === 0 && <div className="text-gray-500 text-sm">No invoices{projectId ? ' for this filter' : ''}.</div>}
      </div>

      {/* Voided — accounted stubs, zero to every total, collapsed by default. */}
      {voidedList.length > 0 && (
        <div className="mt-4">
          <button onClick={() => setShowVoided(s => !s)} className="text-xs font-semibold text-gray-500 uppercase">{showVoided ? '▾' : '▸'} Voided ({voidedList.length})</button>
          {showVoided && (
            <div className="space-y-1 mt-2">
              {voidedList.map(inv => (
                <div key={inv.id} className="bg-white/60 rounded border p-2 text-sm opacity-70">
                  <div className="flex items-center justify-between">
                    <span className="line-through" style={{ color: PALERMO.slate }}><b>{inv.number}</b> · {money(inv.total)}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">VOID</span>
                  </div>
                  <div className="text-[11px] text-gray-500">{projName(inv.projectId)} · voided{inv.voidedBy ? ` by ${inv.voidedBy}` : ''}{inv.voidedAt ? ` · ${fmtDate(inv.voidedAt)}` : ''} — {inv.voidReason}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {adding && <CreateInvoiceForm projects={p.projects} currentUser={p.currentUser} onClose={() => setAdding(false)} onSave={inv => { p.onSaveInvoice(inv); setAdding(false); }} />}
    </div>
  );
}

// One CREATE INVOICE flow — covers past and new invoices. Launchable from a
// phase card (phase pre-filled) or the Invoices tab (phase picked here).
function CreateInvoiceForm({ projects, presetProjectId, presetPhaseId, currentUser, onClose, onSave }: { projects: ContractingProject[]; presetProjectId?: string; presetPhaseId?: string; currentUser: { id: string; name: string }; onClose: () => void; onSave: (i: ContractingInvoice) => void }) {
  const [number, setNumber] = useState('');
  const [projectId, setProjectId] = useState(presetProjectId || projects[0]?.id || '');
  const [phaseId, setPhaseId] = useState(presetPhaseId || '');
  const [kind, setKind] = useState<ContractingInvoice['kind']>(presetPhaseId ? 'completion' : 'historical');
  const [dateStr, setDateStr] = useState(dateInputVal(Date.now()));
  const [amount, setAmount] = useState('');
  const [scope, setScope] = useState('');
  const [status, setStatus] = useState<'sent' | 'paid'>('sent');
  const proj = projects.find(x => x.id === projectId);
  const lockPhase = !!presetPhaseId;
  const pre = Number(amount) || 0;
  const w = withHst(pre);
  return (
    <Modal title="Create invoice" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Invoice #"><input className="inp" value={number} onChange={e => setNumber(e.target.value)} placeholder="e.g. INV-1004" /></Field>
        <Field label="Kind">
          <select className="inp" value={kind} onChange={e => setKind(e.target.value as ContractingInvoice['kind'])}>
            {(['historical', 'retainer', 'completion', 'tm'] as const).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
      </div>
      {!presetProjectId && <Field label="Project"><select className="inp" value={projectId} onChange={e => { setProjectId(e.target.value); setPhaseId(''); }}>{projects.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}</select></Field>}
      <Field label="Phase">
        {lockPhase
          ? <div className="inp bg-slate-50">{proj?.phases.find(ph => ph.id === phaseId)?.name || '—'}</div>
          : <select className="inp" value={phaseId} onChange={e => setPhaseId(e.target.value)}><option value="">— whole project —</option>{proj?.phases.map(ph => <option key={ph.id} value={ph.id}>{ph.name}</option>)}</select>}
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date"><input className="inp" type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} /></Field>
        <Field label="Amount (pre-HST)"><input className="inp" type="number" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
      </div>
      <div className="text-sm mb-2">{money(w.preHst)} + {money(w.hst)} HST = <b>{money(w.total)}</b></div>
      <Field label="Period / description (client-facing)"><textarea className="inp" rows={2} value={scope} onChange={e => setScope(e.target.value)} /></Field>
      <Field label="Status">
        <div className="flex gap-2">
          {(['sent', 'paid'] as const).map(s => <button key={s} onClick={() => setStatus(s)} className="flex-1 py-1.5 rounded border text-sm capitalize font-semibold" style={status === s ? { backgroundColor: PALERMO.slate, color: 'white' } : {}}>{s}</button>)}
        </div>
      </Field>
      <ModalActions onClose={onClose} disabled={!number.trim() || !projectId || pre <= 0} onSave={() => { const at = dateFromInput(dateStr); onSave({
        id: uid('cinv'), number: number.trim(), projectId, phaseId: phaseId || undefined, kind,
        amountPreHst: w.preHst, hst: w.hst, total: w.total, scopeDescription: scope.trim() || undefined,
        issuedAt: at, dueAt: at + 14 * 86400000, sentAt: at, paid: status === 'paid', paidAt: status === 'paid' ? at : undefined, paidBy: status === 'paid' ? currentUser.name : undefined,
        createdBy: currentUser, createdAt: Date.now(),
      }); }} />
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
          {invoice.periodStart && <div className="mt-0.5"><span className="text-[10px] text-gray-400 uppercase tracking-wide">Billing period</span><div className="text-base font-bold" style={{ color: PALERMO.slate }}>{fmtDate(invoice.periodStart)} – {fmtDate(invoice.periodEnd)}</div></div>}
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
function WorkOrdersTab(p: Props & { mineOnly: boolean; setMineOnly: (b: boolean) => void; propFilter: string; setPropFilter: (s: string) => void; priorityFilter: 'all' | 'low' | 'normal' | 'high'; setPriorityFilter: (v: 'all' | 'low' | 'normal' | 'high') => void }) {
  const { mineOnly, setMineOnly, priorityFilter, setPriorityFilter } = p;
  const filter = p.propFilter; const setFilter = p.setPropFilter;
  const [showCompleted, setShowCompleted] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const activeProps = p.properties.filter(x => x.active !== false);
  const contractors = p.employees.filter(isContractingWorker);
  const meId = p.currentUser.id;
  const now = Date.now();
  const newest = (a: ContractingWorkOrder, b: ContractingWorkOrder) => (b.createdAt || 0) - (a.createdAt || 0);
  const match = (w: ContractingWorkOrder) => (filter === 'All' || w.property === filter) && (!mineOnly || woIsAssignedTo(w, meId)) && (priorityFilter === 'all' || w.priority === priorityFilter);
  const live = Object.values(p.workOrders).filter(w => !w.archived && match(w));
  // In-progress sorted: overdue first, then soonest sched/due, undated last.
  const activeList = live.filter(w => woStatus(w) !== 'done').sort((a, b) => compareWorkOrders(a, b, now));
  const doneList = live.filter(w => woStatus(w) === 'done').sort(newest);
  const archivedList = Object.values(p.workOrders).filter(w => w.archived && match(w)).sort(newest);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-bold text-lg" style={{ color: PALERMO.slate }}>Work orders <span className="text-xs font-normal text-gray-500">(rentals · internal)</span></h2>
        <button onClick={() => setAdding(true)} className="px-3 py-1.5 rounded text-white text-sm font-semibold" style={{ backgroundColor: PALERMO.gold }}>+ Work order</button>
      </div>
      {/* Big segmented view toggle — the view that matters (default All). */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <button onClick={() => setMineOnly(false)} className="py-3 rounded-lg font-black text-sm uppercase tracking-wide border-2" style={!mineOnly ? { backgroundColor: PALERMO.slate, color: 'white', borderColor: PALERMO.slate } : { color: PALERMO.slate, borderColor: '#D5DBDB' }}>All</button>
        <button onClick={() => setMineOnly(true)} className="py-3 rounded-lg font-black text-sm uppercase tracking-wide border-2" style={mineOnly ? { backgroundColor: PALERMO.gold, color: 'white', borderColor: PALERMO.gold } : { color: PALERMO.slate, borderColor: '#D5DBDB' }}>Assigned to me</button>
      </div>
      {/* Property filter — compact dropdown (was a chip row). */}
      <div className="flex items-center gap-2 mb-3 text-sm flex-wrap">
        <span className="text-gray-500 font-semibold">Property:</span>
        <select className="inp" style={{ maxWidth: 220 }} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="All">All</option>
          {activeProps.map(x => <option key={x.id} value={x.name}>{x.corp ? '★ ' : ''}{x.name}</option>)}
        </select>
        {priorityFilter !== 'all' && (
          <button onClick={() => setPriorityFilter('all')} className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full" style={{ backgroundColor: priorityFilter === 'high' ? '#FADBD8' : priorityFilter === 'normal' ? '#EBF5FB' : '#F8F9F9', color: priorityFilter === 'high' ? '#C0392B' : '#555' }}>{priorityFilter} priority ✕</button>
        )}
      </div>
      <div className="space-y-2">
        {activeList.map(w => <WorkOrderCard key={w.id} wo={w} contractors={contractors} {...p} />)}
        {activeList.length === 0 && <div className="text-gray-500 text-sm">No open work orders{filter !== 'All' ? ` for ${filter}` : ''}{mineOnly ? ' assigned to you' : ''}.</div>}
      </div>

      {/* Completed — dimmed, collapsed. */}
      {doneList.length > 0 && (
        <div className="mt-4">
          <button onClick={() => setShowCompleted(s => !s)} className="text-xs font-semibold text-gray-500 uppercase">{showCompleted ? '▾' : '▸'} Completed ({doneList.length})</button>
          {showCompleted && <div className="space-y-2 mt-2 opacity-70">{doneList.map(w => <WorkOrderCard key={w.id} wo={w} contractors={contractors} {...p} />)}</div>}
        </div>
      )}
      {/* Archived — hidden by default. */}
      {archivedList.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowArchived(s => !s)} className="text-xs font-semibold text-gray-400 uppercase">{showArchived ? '▾' : '▸'} Archived ({archivedList.length})</button>
          {showArchived && <div className="space-y-2 mt-2 opacity-60">{archivedList.map(w => <WorkOrderCard key={w.id} wo={w} contractors={contractors} {...p} />)}</div>}
        </div>
      )}
      {adding && <WorkOrderForm currentUser={p.currentUser} uploadedBy={p.uploadedBy} properties={activeProps} contractors={contractors} onClose={() => setAdding(false)} onSave={w => { p.onSaveWorkOrder(w); setAdding(false); }} defaultProperty={filter === 'All' ? (activeProps[0]?.name || '') : filter} />}
    </div>
  );
}

function WorkOrderCard(p: Props & { wo: ContractingWorkOrder; contractors: Employee[] }) {
  const { wo, canManage } = p;
  const [viewPhotos, setViewPhotos] = useState<StoredFile[] | null>(null);
  const prop = p.properties.find(x => x.name === wo.property);
  const corp = prop?.corp;
  const unit = wo.unitId ? prop?.units?.find(u => u.id === wo.unitId) : undefined;
  // Tenant CONTACT reference for the tagged unit — Marco/Tony/Linda always, plus
  // any contractor this work order is assigned to (contacts only, tap-to-call).
  const canSeeTenant = p.canManageProperties || woIsAssignedTo(wo, p.currentUser.id);
  // ★ Main contact(s) for this order. Unit-tagged → that unit's star.
  // Property-level → each occupied unit's star (unit name shown when >1 unit).
  const woContacts: { unitName?: string; tenant: ContractingTenant }[] = [];
  if (canSeeTenant && prop) {
    if (wo.unitId) {
      const st = unit?.tenancy ? starredTenant(unit.tenancy) : undefined;
      if (st) woContacts.push({ unitName: unit!.name, tenant: st });
    } else {
      const us = prop.units || [];
      for (const u of us) { if (u.tenancy) { const st = starredTenant(u.tenancy); if (st) woContacts.push({ unitName: us.length > 1 ? u.name : undefined, tenant: st }); } }
    }
  }
  const done = woStatus(wo) === 'done';
  const save = (patch: Partial<ContractingWorkOrder>) => p.onSaveWorkOrder({ ...wo, ...patch, updatedAt: Date.now() });
  const [editing, setEditing] = useState(false);
  const { ids: assigneeIds, names: assigneeNames } = woAssignees(wo);
  const nameOf = (id: string) => p.contractors.find(x => x.id === id)?.name || assigneeNames[assigneeIds.indexOf(id)] || id;
  // Toggle one assignee on/off; write the array shape (migrates single → array).
  const toggleAssignee = (id: string) => {
    const has = assigneeIds.includes(id);
    const nextIds = has ? assigneeIds.filter(x => x !== id) : [...assigneeIds, id];
    save({ assigneeIds: nextIds, assigneeNames: nextIds.map(nameOf), assigneeId: undefined, assigneeName: undefined });
  };
  const [assignOpen, setAssignOpen] = useState(false);
  return (
    <div className="bg-white rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold" style={{ color: PALERMO.slate }}>{wo.title}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={corp ? { backgroundColor: PALERMO.gold, color: 'white' } : { backgroundColor: '#eee' }}>{corp ? '★ ' : ''}{wo.property}{unit ? ` · ${unit.name}` : ''}</span>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: wo.priority === 'high' ? '#FADBD8' : wo.priority === 'normal' ? '#EBF5FB' : '#F8F9F9', color: wo.priority === 'high' ? '#C0392B' : '#555' }}>{wo.priority}</span>
      </div>
      <WorkOrderDates wo={wo} done={done} />
      {woContacts.length > 0 && (
        <div className="mt-0.5 space-y-0.5">
          {woContacts.map((c, i) => (
            <div key={i} className="text-[11px] text-gray-600">
              <span style={{ color: PALERMO.gold }}>★</span> {c.unitName ? `${c.unitName}: ` : ''}<span className="font-semibold text-gray-700">{c.tenant.name}</span>
              {c.tenant.phone && <> · <a href={`tel:${c.tenant.phone}`} className="font-bold underline" style={{ color: '#1E7E45' }}>{c.tenant.phone} 📞</a></>}
            </div>
          ))}
        </div>
      )}
      {/* Assignees — clear chips (all shown), readable at a glance. */}
      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
        {assigneeIds.length === 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded-full" style={{ backgroundColor: '#F2F3F4', color: '#909497' }}>
            <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black text-white" style={{ backgroundColor: '#B2BABB' }}>?</span>Unassigned
          </span>
        )}
        {assigneeIds.map(id => (
          <span key={id} className="inline-flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded-full" style={{ backgroundColor: '#2E40531A', color: PALERMO.slate }}>
            <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black text-white" style={{ backgroundColor: PALERMO.gold }}>{nameOf(id).charAt(0).toUpperCase()}</span>
            {nameOf(id)}
          </span>
        ))}
        {canManage && (
          <div className="relative">
            <button onClick={() => setAssignOpen(o => !o)} className="text-xs px-2 py-1 rounded-full border font-semibold" style={{ color: PALERMO.slate }}>+ Assign</button>
            {assignOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setAssignOpen(false)} />
                <div className="absolute left-0 mt-1 bg-white border rounded-lg shadow-lg z-40 p-1 min-w-[160px]">
                  {p.contractors.length === 0 && <div className="text-xs text-gray-400 p-2">No contractors.</div>}
                  {p.contractors.map(c => (
                    <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-slate-50 cursor-pointer">
                      <input type="checkbox" checked={assigneeIds.includes(c.id)} onChange={() => toggleAssignee(c.id)} /> {c.name}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {wo.description && <div className="text-sm text-gray-600 mt-1">{wo.description}</div>}
      {wo.completionNote && <div className="text-xs text-gray-500 mt-1 italic">✓ {wo.completionNote}</div>}
      {wo.photos && wo.photos.length > 0 && <button onClick={() => setViewPhotos(wo.photos!)} className="text-xs mt-1" style={{ color: PALERMO.gold }}>📷 {wo.photos.length} photo(s)</button>}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {/* Two-state toggle: in progress ⇄ complete. */}
        <button onClick={() => save({ status: done ? 'in_progress' : 'done' })} className="text-xs px-2.5 py-1.5 rounded text-white font-semibold" style={{ backgroundColor: done ? '#27AE60' : PALERMO.slate }}>
          {done ? '✓ Complete · reopen' : 'Mark complete'}
        </button>
        {/* Full edit — Marco/Tony/Linda. */}
        {p.canManageProperties && <button onClick={() => setEditing(true)} className="text-xs px-2.5 py-1.5 rounded border font-semibold" style={{ color: PALERMO.slate }}>Edit</button>}
        {canManage && <button onClick={() => save({ archived: !wo.archived })} className="text-xs px-2.5 py-1.5 rounded border font-semibold" style={{ color: PALERMO.slate }}>{wo.archived ? 'Unarchive' : 'Archive'}</button>}
        {canManage && <button onClick={() => confirm(`Delete work order "${wo.title}"?`) && p.onDeleteWorkOrder(wo.id)} className="text-xs px-2.5 py-1.5 rounded text-red-500 font-semibold ml-auto">Delete</button>}
      </div>
      {wo.editedBy && <div className="text-[10px] text-gray-400 mt-1">edited by {wo.editedBy}{wo.editedAt ? ` · ${fmtShort(wo.editedAt)}` : ''}</div>}
      {editing && <WorkOrderForm initial={wo} currentUser={p.currentUser} uploadedBy={p.uploadedBy} properties={p.properties} contractors={p.contractors} onClose={() => setEditing(false)} onSave={w => { p.onSaveWorkOrder(w); setEditing(false); }} defaultProperty={wo.property} />}
      {viewPhotos && <PhotoViewer files={viewPhotos} onClose={() => setViewPhotos(null)} />}
    </div>
  );
}

// Compact optional date chips for a work order. States: scheduled today
// (highlighted), future scheduled ("Sched Thu Jul 23"), past scheduled + not
// complete (quiet grey "was scheduled" — plans slip), due upcoming ("Due Aug 1"),
// past due + not complete (red "overdue"). Undated → nothing.
function WorkOrderDates({ wo, done }: { wo: ContractingWorkOrder; done: boolean }) {
  const now = Date.now();
  const sod = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const day = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
  const tm = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const chips: JSX.Element[] = [];
  if (typeof wo.scheduledAt === 'number') {
    const s = sod(wo.scheduledAt), t = sod(now);
    const timeSuffix = wo.scheduledHasTime ? ` · ${tm(wo.scheduledAt)}` : '';
    if (s === t) chips.push(<span key="s" className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#D6EAF8', color: '#1F618D' }}>Sched today{timeSuffix}</span>);
    else if (s > t) chips.push(<span key="s" className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#F4F6F7', color: '#566573' }}>Sched {day(wo.scheduledAt)}{timeSuffix}</span>);
    else if (!done) chips.push(<span key="s" className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: '#F4F6F7', color: '#909497' }}>was scheduled {day(wo.scheduledAt)}{timeSuffix}</span>);
  }
  if (typeof wo.dueAt === 'number') {
    if (woIsOverdue(wo, now)) chips.push(<span key="d" className="text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ backgroundColor: '#FADBD8', color: '#C0392B' }}>overdue · due {day(wo.dueAt)}</span>);
    else chips.push(<span key="d" className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#FEF9E7', color: '#B7950B' }}>Due {day(wo.dueAt)}</span>);
  }
  if (chips.length === 0) return null;
  return <div className="mt-1 flex flex-wrap gap-1.5">{chips}</div>;
}

// Create OR edit a work order. With `initial` it's a full edit (title,
// description, property, unit tag, priority, dates, assignees) — Marco/Tony/
// Linda only; stamps a light edited-by/at audit. Notes/photos stay additive.
function WorkOrderForm({ initial, currentUser, uploadedBy, properties, contractors, onClose, onSave, defaultProperty }: { initial?: ContractingWorkOrder; currentUser: { id: string; name: string }; uploadedBy: { email: string; name: string }; properties: ContractingProperty[]; contractors: Employee[]; onClose: () => void; onSave: (w: ContractingWorkOrder) => void; defaultProperty: string }) {
  const isEdit = !!initial;
  const [property, setProperty] = useState(initial?.property || defaultProperty);
  const [unitId, setUnitId] = useState(initial?.unitId || '');
  const [title, setTitle] = useState(initial?.title || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [priority, setPriority] = useState<ContractingWorkOrder['priority']>(initial?.priority || 'normal');
  const [scheduled, setScheduled] = useState(initial?.scheduledAt ? dateInputVal(initial.scheduledAt) : '');
  const [schedTime, setSchedTime] = useState(initial?.scheduledHasTime && initial?.scheduledAt ? timeInputVal(initial.scheduledAt) : '');
  const [due, setDue] = useState(initial?.dueAt ? dateInputVal(initial.dueAt) : '');
  const [assigneeIds, setAssigneeIds] = useState<string[]>(initial ? woAssignees(initial).ids : []);
  const [photos, setPhotos] = useState<StoredFile[]>(initial?.photos || []);
  const [uploading, setUploading] = useState(false);
  const woId = initial?.id || uid('cwo');
  const propUnits = properties.find(x => x.name === property)?.units || [];
  return (
    <Modal title={isEdit ? 'Edit work order' : 'New work order'} onClose={onClose}>
      <Field label="Property"><select className="inp" value={property} onChange={e => { setProperty(e.target.value); setUnitId(''); }}>{properties.map(x => <option key={x.id} value={x.name}>{x.corp ? '★ ' : ''}{x.name}</option>)}</select></Field>
      {propUnits.length > 0 && <Field label="Unit (optional — leave blank for property-level)"><select className="inp" value={unitId} onChange={e => setUnitId(e.target.value)}><option value="">Whole property</option>{propUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>}
      <Field label="Title"><input className="inp" value={title} onChange={e => setTitle(e.target.value)} /></Field>
      <Field label="Description"><textarea className="inp" rows={2} value={description} onChange={e => setDescription(e.target.value)} /></Field>
      <Field label="Priority"><div className="flex gap-2">{(['low', 'normal', 'high'] as const).map(pr => <button key={pr} onClick={() => setPriority(pr)} className="flex-1 py-1.5 rounded border text-sm capitalize" style={priority === pr ? { backgroundColor: PALERMO.slate, color: 'white' } : {}}>{pr}</button>)}</div></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Scheduled (optional)"><input className="inp" type="date" value={scheduled} onChange={e => { setScheduled(e.target.value); if (!e.target.value) setSchedTime(''); }} /></Field>
        <Field label="Due (optional)"><input className="inp" type="date" value={due} onChange={e => setDue(e.target.value)} /></Field>
      </div>
      {scheduled && <Field label="Scheduled time (optional — for tenant appointments)"><input className="inp" type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)} /></Field>}
      <Field label="Assign to (optional)">
        <div className="flex flex-wrap gap-1.5">
          {contractors.map(c => { const on = assigneeIds.includes(c.id); return (
            <button key={c.id} onClick={() => setAssigneeIds(ids => on ? ids.filter(x => x !== c.id) : [...ids, c.id])} className="text-sm px-2.5 py-1.5 rounded-full border font-semibold" style={on ? { backgroundColor: PALERMO.slate, color: 'white', borderColor: PALERMO.slate } : {}}>{c.name}</button>
          ); })}
          {contractors.length === 0 && <span className="text-xs text-gray-400">No contractors.</span>}
        </div>
      </Field>
      <Field label="Photos (optional)">
        <input type="file" accept="image/*,application/pdf" onChange={async e => {
          const f = e.target.files?.[0]; if (!f) return; setUploading(true);
          try { const sf = await uploadFile(`contracting/wo-${woId}`, f, { uploadedBy }); setPhotos(x => [...x, sf]); } finally { setUploading(false); }
        }} />
        {uploading && <span className="text-xs text-gray-400">Uploading…</span>}
        {photos.length > 0 && <span className="text-xs text-green-600">✓ {photos.length}</span>}
      </Field>
      <ModalActions onClose={onClose} disabled={!title.trim() || uploading} onSave={() => onSave({
        ...(initial || {}),
        id: woId, property, unitId: unitId || undefined, title: title.trim(), description: description.trim() || undefined, priority,
        status: initial?.status || 'in_progress',
        scheduledAt: scheduled ? (schedTime ? dateTimeFromInput(scheduled, schedTime) : dateFromInput(scheduled)) : undefined,
        scheduledHasTime: scheduled && schedTime ? true : undefined,
        dueAt: due ? dateFromInput(due) : undefined,
        assigneeIds: assigneeIds.length ? assigneeIds : undefined, assigneeNames: assigneeIds.length ? assigneeIds.map(id => contractors.find(c => c.id === id)?.name || id) : undefined,
        assigneeId: undefined, assigneeName: undefined,
        photos: photos.length ? photos : undefined,
        createdBy: initial?.createdBy || currentUser, createdAt: initial?.createdAt || Date.now(), updatedAt: Date.now(),
        ...(isEdit ? { editedBy: currentUser.name, editedAt: Date.now() } : {}),
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
  // Anyone deletes their OWN added items; Marco/Tony delete any.
  const canDelete = (i: ContractingShoppingItem) => p.canManage || i.addedBy?.id === p.currentUser.id;
  const del = (i: ContractingShoppingItem) => { if (confirm(`Delete "${i.item}"?`)) p.onDeleteShoppingItem(i.id); };
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
        <h2 className="font-bold text-lg" style={{ color: PALERMO.slate }}>Material / Supply / Tool Order</h2>
        {p.canManage && <button onClick={() => setManageOpen(o => !o)} className="text-xs px-2 py-1 rounded border font-semibold shrink-0" style={{ color: PALERMO.slate }}>Suppliers</button>}
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
        <input className="inp text-base" style={{ minHeight: 48 }} placeholder="Add material, supply, or tool…" value={item} onChange={e => setItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
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
              <div key={i.id} className="w-full flex items-center gap-3 bg-white rounded-lg border p-3" style={{ minHeight: 48 }}>
                <button onClick={() => toggle(i)} className="flex items-center gap-3 flex-1 text-left">
                  <span className="w-6 h-6 rounded border-2 shrink-0" style={{ borderColor: PALERMO.slate }} />
                  <span className="flex-1"><b>{i.item}</b>{i.qty ? ` · ${i.qty}` : ''}{i.projectTag ? <span className="text-xs text-gray-400"> · {i.projectTag}</span> : ''}</span>
                </button>
                {canDelete(i) && <button onClick={() => del(i)} className="text-red-400 text-lg px-1 shrink-0" title="Delete">×</button>}
              </div>
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
              <div key={i.id} className="w-full flex items-center gap-3 bg-white/60 rounded-lg border p-2.5 opacity-60" style={{ minHeight: 44 }}>
                <button onClick={() => toggle(i)} className="flex items-center gap-3 flex-1 text-left">
                  <span className="w-5 h-5 rounded flex items-center justify-center text-white shrink-0" style={{ backgroundColor: '#27AE60' }}>✓</span>
                  <span className="flex-1 line-through text-gray-500">{i.item}{i.qty ? ` · ${i.qty}` : ''}{i.supplier ? <span className="text-[10px] text-gray-400"> · {i.supplier}</span> : ''}</span>
                  <span className="text-[10px] text-gray-400">{i.purchasedBy}</span>
                </button>
                {canDelete(i) && <button onClick={() => del(i)} className="text-red-400 text-lg px-1 shrink-0" title="Delete">×</button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────── PROPERTIES ────
// ───────────────────────────────────── PROPERTY MANAGEMENT (v2) ─────────────
function CountdownBadge({ cd }: { cd: Countdown }) {
  const style = cd.level === 'red' ? { bg: '#FADBD8', fg: '#C0392B' } : cd.level === 'amber' ? { bg: '#FEF9E7', fg: '#B7950B' } : { bg: '#EBF5FB', fg: '#2874A6' };
  return <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: style.bg, color: style.fg }}>{cd.label}</span>;
}

// Contractor-facing Properties — CONTACTS ONLY. Enforced by absence: this
// component renders no rent/deposit/lease-date/countdown/history/attention
// markup at all. Occupied unit → tenant name(s) + phone (tap-to-call) + email;
// vacant unit → "vacant" (contractors may need to know a unit is empty for
// access). No financial or lease context whatsoever.
function PropertyContactsTab({ properties }: { properties: ContractingProperty[] }) {
  const visible = properties.filter(p => p.active !== false);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-bold text-lg" style={{ color: PALERMO.slate }}>Properties</h2>
      </div>
      <p className="text-xs text-gray-500 mb-3">Tenant contacts for access &amp; coordination.</p>
      <div className="space-y-3">
        {visible.map(pr => {
          const units = pr.units || [];
          return (
            <div key={pr.id} className="bg-white rounded-lg border">
              <div className="p-3 border-b flex items-center gap-2 min-w-0">
                {pr.corp && <span className="text-[10px] font-black px-1.5 py-0.5 rounded" style={{ backgroundColor: PALERMO.gold, color: 'white' }}>★</span>}
                <span className="font-bold truncate" style={{ color: PALERMO.slate }}>{pr.name}</span>
                <span className="text-[10px] text-gray-400">{units.length} unit{units.length === 1 ? '' : 's'}</span>
              </div>
              <div className="divide-y">
                {units.map(u => <UnitContactRow key={u.id} unit={u} />)}
              </div>
            </div>
          );
        })}
        {visible.length === 0 && <div className="text-gray-500 text-sm">No properties.</div>}
      </div>
    </div>
  );
}

function UnitContactRow({ unit }: { unit: ContractingUnit }) {
  const ordered = tenantsStarredFirst(unit.tenancy).filter(t => t.name || t.phone || t.email);
  const star = starredTenant(unit.tenancy);
  return (
    <div className="p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold" style={{ color: PALERMO.slate }}>{unit.name}</span>
        {!unit.tenancy && <span className="text-[11px] font-black px-2 py-0.5 rounded" style={{ backgroundColor: '#EAECEE', color: '#7F8C8D' }}>vacant</span>}
      </div>
      {unit.tenancy && (
        <div className="mt-1 space-y-1.5">
          {ordered.length === 0 && <div className="text-xs text-gray-400">Occupied</div>}
          {ordered.map((t, i) => (
            <div key={i} className="text-sm">
              <div className="font-medium text-gray-800 flex items-center gap-1">{t === star && <span style={{ color: PALERMO.gold }}>★</span>}{t.name || <span className="text-gray-400">(tenant)</span>}{t === star && ordered.length > 1 && <span className="text-[9px] text-gray-400 uppercase font-bold">main</span>}</div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs mt-0.5">
                {t.phone && <a href={`tel:${t.phone}`} className="font-semibold underline" style={{ color: '#1E7E45' }}>📞 {t.phone}</a>}
                {t.email && <a href={`mailto:${t.email}`} className="underline" style={{ color: '#1E7E45' }}>✉️ {t.email}</a>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PropertyManagementTab({ properties, noticeDays, currentUser, onSaveProperty, onDeleteProperty }: { properties: ContractingProperty[]; noticeDays: number; currentUser: { id: string; name: string }; onSaveProperty: (p: ContractingProperty) => void; onDeleteProperty: (id: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const now = Date.now();
  const attention = leasesNeedingAttention(properties.filter(p => p.active !== false), now);
  const visible = properties.filter(p => showInactive || p.active !== false);
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-lg" style={{ color: PALERMO.slate }}>Properties</h2>
        <button onClick={() => setAdding(true)} className="px-3 py-1.5 rounded text-white text-sm font-semibold" style={{ backgroundColor: PALERMO.gold }}>+ Add property</button>
      </div>

      {/* Leases needing attention — unit rows, soonest first. */}
      {attention.length > 0 && (
        <div className="bg-white rounded-lg border p-3 mb-3" style={{ borderColor: '#F5B7B1' }}>
          <div className="text-xs font-black uppercase tracking-widest mb-1" style={{ color: '#C0392B' }}>Leases needing attention</div>
          <div className="space-y-1">
            {attention.map(r => (
              <div key={r.unit.id} className="flex items-center justify-between text-sm gap-2">
                <span className="truncate">{r.property.name} · {r.unit.name} <span className="text-gray-400">· {(r.unit.tenancy?.tenants || []).map(t => t.name).filter(Boolean).join(', ') || 'tenant'}</span></span>
                {r.countdown && <CountdownBadge cd={r.countdown} />}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {visible.map(pr => <PropertyCard key={pr.id} property={pr} noticeDays={noticeDays} currentUser={currentUser} onUpdate={onSaveProperty} onDelete={() => confirm(`Delete "${pr.name}" and all its units/tenancy history?`) && onDeleteProperty(pr.id)} />)}
      </div>
      {properties.some(p => p.active === false) && <button onClick={() => setShowInactive(s => !s)} className="text-xs mt-3 font-semibold text-gray-400 uppercase">{showInactive ? 'Hide' : 'Show'} inactive</button>}

      {adding && <AddPropertyForm onClose={() => setAdding(false)} onSave={p => { onSaveProperty(p); setAdding(false); }} />}
    </div>
  );
}

function AddPropertyForm({ onClose, onSave }: { onClose: () => void; onSave: (p: ContractingProperty) => void }) {
  const [name, setName] = useState(''); const [corp, setCorp] = useState(false); const [notes, setNotes] = useState('');
  return (
    <Modal title="Add property" onClose={onClose}>
      <Field label="Name / address"><input className="inp" value={name} onChange={e => setName(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={corp} onChange={e => setCorp(e.target.checked)} /> Corporate property (★ badge)</label>
      <Field label="Notes"><textarea className="inp" rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      {/* Single-unit houses get one default unit so the model is uniform. */}
      <ModalActions onClose={onClose} disabled={!name.trim()} onSave={() => onSave({ id: uid('cprop'), name: name.trim(), corp, notes: notes.trim() || undefined, active: true, units: [{ id: uid('cunit'), name: 'Whole property' }] })} />
    </Modal>
  );
}

function PropertyCard({ property, noticeDays, currentUser, onUpdate, onDelete }: { property: ContractingProperty; noticeDays: number; currentUser: { id: string; name: string }; onUpdate: (p: ContractingProperty) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const units = property.units || [];
  const updateUnit = (u: ContractingUnit) => onUpdate({ ...property, units: units.map(x => x.id === u.id ? u : x) });
  const addUnit = () => onUpdate({ ...property, units: [...units, { id: uid('cunit'), name: `Unit ${units.length + 1}` }] });
  const removeUnit = (id: string) => onUpdate({ ...property, units: units.filter(x => x.id !== id) });
  return (
    <div className={`bg-white rounded-lg border ${property.active === false ? 'opacity-60' : ''}`}>
      <div className="p-3 border-b">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {property.corp && <span className="text-[10px] font-black px-1.5 py-0.5 rounded" style={{ backgroundColor: PALERMO.gold, color: 'white' }}>★</span>}
            <span className="font-bold truncate" style={{ color: PALERMO.slate }}>{property.name}</span>
            <span className="text-[10px] text-gray-400">{units.length} unit{units.length === 1 ? '' : 's'}</span>
          </div>
          <button onClick={() => setEditing(e => !e)} className="text-xs px-2 py-0.5 rounded border font-semibold shrink-0" style={{ color: PALERMO.slate }}>{editing ? 'Done' : 'Edit'}</button>
        </div>
        {editing && (
          <div className="mt-2 space-y-2">
            <input className="inp text-sm" defaultValue={property.name} onBlur={e => e.target.value.trim() && e.target.value !== property.name && onUpdate({ ...property, name: e.target.value.trim() })} />
            <input className="inp text-sm" placeholder="Notes" defaultValue={property.notes || ''} onBlur={e => onUpdate({ ...property, notes: e.target.value.trim() || undefined })} />
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!property.corp} onChange={e => onUpdate({ ...property, corp: e.target.checked })} /> ★ Corp</label>
              <button onClick={() => onUpdate({ ...property, active: property.active === false })} className="text-xs px-2 py-1 rounded border">{property.active === false ? 'Reactivate' : 'Deactivate'}</button>
              <button onClick={addUnit} className="text-xs px-2 py-1 rounded text-white font-semibold" style={{ backgroundColor: PALERMO.slate }}>+ Unit</button>
              <button onClick={onDelete} className="text-xs px-2 py-1 rounded text-red-500 font-semibold ml-auto">Delete property</button>
            </div>
          </div>
        )}
      </div>
      <div className="divide-y">
        {units.map(u => <UnitRowCard key={u.id} unit={u} noticeDays={noticeDays} currentUser={currentUser} editing={editing} onUpdate={updateUnit} onRemove={() => (units.length > 1 ? removeUnit(u.id) : alert('A property keeps at least one unit.'))} />)}
      </div>
    </div>
  );
}

function UnitRowCard({ unit, noticeDays, currentUser, editing, onUpdate, onRemove }: { unit: ContractingUnit; noticeDays: number; currentUser: { id: string; name: string }; editing: boolean; onUpdate: (u: ContractingUnit) => void; onRemove: () => void }) {
  const [form, setForm] = useState<null | 'start' | 'edit' | 'renew' | 'moveout'>(null);
  const [showHistory, setShowHistory] = useState(false);
  const now = Date.now();
  const t = unit.tenancy;
  const cd = t ? tenancyCountdown(t, now) : undefined;
  const total = t ? tenancyMonthlyTotal(t) : 0;
  const stamp = (action: string, base?: ContractingTenancy) => [...((base || t)?.audit || []), { at: Date.now(), by: currentUser.name, action }];
  const setTenancy = (nt: ContractingTenancy | undefined) => onUpdate({ ...unit, tenancy: nt });
  // ★ Main contact — exactly one starred; tapping a different tenant moves it.
  const setMain = (tn: ContractingTenant) => t && setTenancy({ ...t, tenants: t.tenants.map(x => ({ ...x, main: x === tn })), audit: stamp(`main contact → ${tn.name || 'tenant'}`) });
  const endTenancy = () => { if (!t) return; onUpdate({ ...unit, tenancy: undefined, history: [...(unit.history || []), { ...t, endedAt: Date.now(), endedBy: currentUser.name, audit: stamp('ended tenancy') }] }); };
  const renew = (newEnd: string) => t && setTenancy({ ...t, status: 'fixed_term', leaseEnd: newEnd, moveOutAt: undefined, moveOutBy: undefined, computedEnd: undefined, noticeGivenAt: undefined, audit: stamp(`renewed → ${newEnd}`) });
  const convert = () => t && setTenancy({ ...t, status: 'month_to_month', leaseEnd: undefined, moveOutAt: undefined, moveOutBy: undefined, computedEnd: undefined, noticeGivenAt: undefined, audit: stamp('converted to month-to-month') });
  // MOVE OUT — the tenant's stated date (not computed). Works on both types.
  const setMoveOut = (date: string) => t && setTenancy({ ...t, moveOutAt: date, moveOutBy: currentUser.name, computedEnd: undefined, noticeGivenAt: undefined, audit: stamp(`move-out set ${date}`) });
  const cancelMoveOut = () => t && setTenancy({ ...t, moveOutAt: undefined, moveOutBy: undefined, computedEnd: undefined, noticeGivenAt: undefined, audit: stamp('move-out cancelled — tenant stays') });
  const moveOut = tenancyMoveOut(t || ({} as ContractingTenancy));
  const deposit = t ? tenancyDeposit(t) : {};
  const shortNotice = moveOut ? moveOutIsShortNotice(moveOut, noticeDays, now) : false;

  return (
    <div className="p-3">
      <div className="flex items-center justify-between gap-2">
        {editing
          ? <input className="inp text-sm flex-1 font-semibold" defaultValue={unit.name} onBlur={e => e.target.value.trim() && onUpdate({ ...unit, name: e.target.value.trim() })} />
          : <span className="font-semibold" style={{ color: PALERMO.slate }}>{unit.name}</span>}
        {t ? <CountdownBadge cd={cd!} /> : <span className="text-[11px] font-black px-2 py-0.5 rounded" style={{ backgroundColor: '#EAECEE', color: '#7F8C8D' }}>VACANT</span>}
      </div>

      {t ? (
        <div className="mt-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: t.status === 'fixed_term' ? '#FEF9E7' : '#EBF5FB', color: t.status === 'fixed_term' ? PALERMO.gold : '#2874A6' }}>{t.status === 'fixed_term' ? 'Fixed term' : 'Month-to-month'}</span>
            <span className="text-lg font-black" style={{ color: PALERMO.slate }}>{money(total)}<span className="text-xs font-normal text-gray-400">/mo</span></span>
          </div>
          <div className="text-sm text-gray-700 mt-1">
            {tenantsStarredFirst(t).map((tn, i) => {
              const isMain = starredTenant(t) === tn;
              return (
                <div key={i} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <button onClick={() => setMain(tn)} title="Set main contact" className="text-sm shrink-0" style={{ color: isMain ? PALERMO.gold : '#CACFD2' }}>{isMain ? '★' : '☆'}</button>
                    <span className="truncate">{tn.name || <span className="text-gray-400">(unnamed)</span>}{tn.phone ? <span className="text-xs text-gray-400"> · <a href={`tel:${tn.phone}`} className="underline" style={{ color: '#1E7E45' }}>{tn.phone}</a></span> : ''}</span>
                  </span>
                  <span className="text-gray-500 shrink-0">{tn.rentAmount ? money(tn.rentAmount) : <span className="text-[10px] text-gray-400">contact only</span>}</span>
                </div>
              );
            })}
          </div>
          {t.status === 'fixed_term' && t.leaseEnd && <div className="text-[11px] text-gray-400 mt-1">Lease {fmtYmd(t.leaseStart)} – {fmtYmd(t.leaseEnd)}</div>}
          {moveOut && <div className="text-[11px] mt-1" style={{ color: '#C0392B' }}>Move out · {fmtYmd(moveOut)}{t.moveOutBy ? ` (by ${t.moveOutBy})` : ''}{shortNotice ? ` · less than ${noticeDays} days’ notice` : ''}</div>}
          {/* Deposit — structured; quiet amber flag when not collected. */}
          {deposit.collected
            ? <div className="text-[11px] text-gray-400">Deposit {deposit.amount ? money(deposit.amount) : ''}{deposit.dateCollected ? ` · collected ${fmtYmd(deposit.dateCollected)}` : ''}{deposit.note ? ` · ${deposit.note}` : ''}</div>
            : <div className="text-[11px]" style={{ color: '#B7950B' }}>⚑ Deposit not collected{deposit.note ? ` · ${deposit.note}` : ''}</div>}

          {/* One-tap resolutions */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {t.status === 'fixed_term' && !moveOut && cd && cd.level !== 'neutral' && <>
              <button onClick={() => setForm('renew')} className="text-xs px-2.5 py-1 rounded text-white font-semibold" style={{ backgroundColor: PALERMO.gold }}>Renew</button>
              <button onClick={convert} className="text-xs px-2.5 py-1 rounded border font-semibold" style={{ color: PALERMO.slate }}>Convert to M2M</button>
            </>}
            {!moveOut && <button onClick={() => setForm('moveout')} className="text-xs px-2.5 py-1 rounded text-white font-semibold" style={{ backgroundColor: '#C0392B' }}>Move out</button>}
            {moveOut && <button onClick={cancelMoveOut} className="text-xs px-2.5 py-1 rounded border font-semibold" style={{ color: PALERMO.slate }}>Cancel move-out</button>}
            <button onClick={() => setForm('edit')} className="text-xs px-2.5 py-1 rounded border font-semibold" style={{ color: PALERMO.slate }}>Edit</button>
            <button onClick={() => confirm('End this tenancy? It moves to history and the unit becomes vacant.') && endTenancy()} className="text-xs px-2.5 py-1 rounded text-red-500 font-semibold ml-auto">End tenancy</button>
          </div>
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-2">
          <button onClick={() => setForm('start')} className="text-xs px-2.5 py-1 rounded text-white font-semibold" style={{ backgroundColor: PALERMO.slate }}>Start tenancy</button>
          {editing && <button onClick={onRemove} className="text-xs px-2.5 py-1 rounded text-red-500 font-semibold ml-auto">Remove unit</button>}
        </div>
      )}

      {(unit.history || []).length > 0 && (
        <div className="mt-2">
          <button onClick={() => setShowHistory(s => !s)} className="text-[11px] font-semibold text-gray-400 uppercase">{showHistory ? '▾' : '▸'} History ({(unit.history || []).length})</button>
          {showHistory && <div className="space-y-1 mt-1">{(unit.history || []).map(h => (
            <div key={h.id} className="text-[11px] text-gray-400">{h.tenants.map(x => x.name).filter(Boolean).join(', ') || 'tenant'} · {money(tenancyMonthlyTotal(h))}/mo · ended {fmtDate(h.endedAt)}</div>
          ))}</div>}
        </div>
      )}

      {(form === 'start' || form === 'edit') && <TenancyForm initial={form === 'edit' ? t! : undefined} noticeDays={noticeDays} onClose={() => setForm(null)} onSave={nt => { setTenancy(form === 'edit' ? { ...nt, audit: stamp('edited tenancy', nt) } : { ...nt, createdAt: Date.now(), audit: [{ at: Date.now(), by: currentUser.name, action: 'started tenancy' }] }); setForm(null); }} />}
      {form === 'renew' && <DatePickForm title="Renew lease" label="New lease end" initial={t?.leaseEnd} mustBeAfter={t?.leaseStart} onClose={() => setForm(null)} onSave={d => { renew(d); setForm(null); }} />}
      {form === 'moveout' && <MoveOutForm initial={t?.leaseEnd || msToYmd(now)} noticeDays={noticeDays} now={now} onClose={() => setForm(null)} onSave={d => { setMoveOut(d); setForm(null); }} />}
    </div>
  );
}

// Start/edit a tenancy: status, dates, deposit, tenants (rent per tenant).
function TenancyForm({ initial, noticeDays, onClose, onSave }: { initial?: ContractingTenancy; noticeDays: number; onClose: () => void; onSave: (t: ContractingTenancy) => void }) {
  const [status, setStatus] = useState<ContractingTenancyStatus>(initial?.status || 'fixed_term');
  const [leaseStart, setLeaseStart] = useState(initial?.leaseStart || '');
  const [leaseEnd, setLeaseEnd] = useState(initial?.leaseEnd || '');
  const initDep = tenancyDeposit(initial || ({} as ContractingTenancy));
  const [depCollected, setDepCollected] = useState(!!initDep.collected);
  const [depAmount, setDepAmount] = useState(initDep.amount != null ? String(initDep.amount) : '');
  const [depDate, setDepDate] = useState(initDep.dateCollected || '');
  const [depNote, setDepNote] = useState(initDep.note || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [tenants, setTenants] = useState<ContractingTenant[]>(initial?.tenants?.length ? initial.tenants : [{ name: '' }]);
  const setT = (i: number, patch: Partial<ContractingTenant>) => setTenants(ts => ts.map((t, j) => j === i ? { ...t, ...patch } : t));
  const total = tenants.reduce((s, t) => s + (Number(t.rentAmount) || 0), 0);
  void noticeDays;
  // Fixed-term lease end must be strictly after start (YMD strings sort by date).
  const dateError = (status === 'fixed_term' && leaseStart && leaseEnd && leaseEnd <= leaseStart)
    ? 'Lease end date is before the start date.' : '';
  return (
    <Modal title={initial ? 'Edit tenancy' : 'Start tenancy'} onClose={onClose}>
      <Field label="Type">
        <div className="flex gap-2">
          {(['fixed_term', 'month_to_month'] as const).map(s => <button key={s} onClick={() => setStatus(s)} className="flex-1 py-1.5 rounded border text-sm font-semibold" style={status === s ? { backgroundColor: PALERMO.slate, color: 'white' } : {}}>{s === 'fixed_term' ? 'Fixed term' : 'Month-to-month'}</button>)}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Lease start"><input className="inp" type="date" value={leaseStart} onChange={e => setLeaseStart(e.target.value)} /></Field>
        {status === 'fixed_term' && <Field label="Lease end"><input className="inp" type="date" value={leaseEnd} onChange={e => setLeaseEnd(e.target.value)} /></Field>}
      </div>
      {dateError && <div className="text-xs px-2 py-1 rounded mb-2" style={{ backgroundColor: '#FADBD8', color: '#C0392B' }}>{dateError}</div>}
      <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Tenants (rent per person; blank = contact only)</div>
      <div className="space-y-2 mb-2">
        {tenants.map((tn, i) => (
          <div key={i} className="border rounded p-2 space-y-1">
            <div className="flex gap-2">
              <input className="inp flex-1" placeholder="Name" value={tn.name} onChange={e => setT(i, { name: e.target.value })} />
              <input className="inp w-24" type="number" placeholder="$/mo" value={tn.rentAmount ?? ''} onChange={e => setT(i, { rentAmount: e.target.value === '' ? undefined : Number(e.target.value) })} />
              {tenants.length > 1 && <button onClick={() => setTenants(ts => ts.filter((_, j) => j !== i))} className="text-red-400 px-1">×</button>}
            </div>
            <div className="flex gap-2">
              <input className="inp flex-1" placeholder="Phone" value={tn.phone || ''} onChange={e => setT(i, { phone: e.target.value || undefined })} />
              <input className="inp flex-1" placeholder="Email" value={tn.email || ''} onChange={e => setT(i, { email: e.target.value || undefined })} />
            </div>
          </div>
        ))}
      </div>
      <button onClick={() => setTenants(ts => [...ts, { name: '' }])} className="text-xs mb-2" style={{ color: PALERMO.slate }}>+ add tenant</button>
      <div className="text-sm mb-2">Monthly total: <b style={{ color: PALERMO.gold }}>{money(total)}</b></div>
      {/* Deposit — structured */}
      <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Deposit</div>
      <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={depCollected} onChange={e => setDepCollected(e.target.checked)} /> Collected</label>
      {depCollected && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Amount"><input className="inp" type="number" value={depAmount} onChange={e => setDepAmount(e.target.value)} /></Field>
          <Field label="Date collected"><input className="inp" type="date" value={depDate} onChange={e => setDepDate(e.target.value)} /></Field>
        </div>
      )}
      <Field label="Deposit note (reference)"><input className="inp" value={depNote} onChange={e => setDepNote(e.target.value)} /></Field>
      <Field label="Notes"><textarea className="inp" rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      <ModalActions onClose={onClose} disabled={tenants.every(t => !t.name.trim()) || !!dateError} onSave={() => onSave({
        id: initial?.id || uid('cten'), status, leaseStart: leaseStart || undefined, leaseEnd: status === 'fixed_term' ? (leaseEnd || undefined) : undefined,
        moveOutAt: initial?.moveOutAt, moveOutBy: initial?.moveOutBy, createdAt: initial?.createdAt, audit: initial?.audit,
        deposit: { collected: depCollected, amount: depAmount === '' ? undefined : Number(depAmount), dateCollected: depDate || undefined, note: depNote.trim() || undefined },
        notes: notes.trim() || undefined,
        tenants: tenants.filter(t => t.name.trim() || t.rentAmount).map(t => ({ name: t.name.trim(), phone: t.phone, email: t.email, rentAmount: t.rentAmount, main: t.main })),
      })} />
    </Modal>
  );
}

// Move out — the tenant's ACTUAL stated date (not computed). Soft <Nd hint.
function MoveOutForm({ initial, noticeDays, now, onClose, onSave }: { initial?: string; noticeDays: number; now: number; onClose: () => void; onSave: (d: string) => void }) {
  const [date, setDate] = useState(initial || '');
  const short = date ? moveOutIsShortNotice(date, noticeDays, now) : false;
  return (
    <Modal title="Move out" onClose={onClose}>
      <div className="text-xs text-gray-500 mb-2">Enter the tenant's actual move-out date. The countdown runs to this date.</div>
      <Field label="Move-out date"><input className="inp" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      {short && <div className="text-xs px-2 py-1 rounded mb-2" style={{ backgroundColor: '#FEF9E7', color: '#B7950B' }}>Less than {noticeDays} days’ notice (informational only).</div>}
      <ModalActions onClose={onClose} disabled={!date} onSave={() => onSave(date)} />
    </Modal>
  );
}

function DatePickForm({ title, label, initial, hint, mustBeAfter, onClose, onSave }: { title: string; label: string; initial?: string; hint?: string; mustBeAfter?: string; onClose: () => void; onSave: (d: string) => void }) {
  const [date, setDate] = useState(initial || '');
  // Renew: the new end must be strictly after the lease start (YMD string sort).
  const err = (date && mustBeAfter && date <= mustBeAfter) ? 'New end date is before the lease start date.' : '';
  return (
    <Modal title={title} onClose={onClose}>
      <Field label={label}><input className="inp" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      {err && <div className="text-xs px-2 py-1 rounded mb-2" style={{ backgroundColor: '#FADBD8', color: '#C0392B' }}>{err}</div>}
      {hint && <div className="text-xs text-gray-500 mb-2">{hint}</div>}
      <ModalActions onClose={onClose} disabled={!date || !!err} onSave={() => onSave(date)} />
    </Modal>
  );
}

// ─────────────────────────────────────────── CONTRACTOR TIME (Tony) ────────
// Tony's contractor-scoped time management: view/edit/add manual entries for
// CONTRACTING people only (billing-role holders + contractors). Marco's-side
// employees never appear here. Hours only shown with in/out + note; edits are
// audited in App. Reads the same payroll timeEntries; contractors themselves
// only VIEW their own (Home), never edit — corrections come through here.
function ContractingTimeTab({ employees, payrollTimeEntries, currentUser, onSave, onDelete }: { employees: Employee[]; payrollTimeEntries: TimeEntry[]; currentUser: { id: string; name: string }; onSave: (e: TimeEntry, reason: string) => void; onDelete: (id: string) => void }) {
  const [form, setForm] = useState<{ mode: 'add' | 'edit'; worker: Employee; entry?: TimeEntry } | null>(null);
  const workers = employees.filter(isContractingWorker);
  const emailOf = (e: Employee) => (e.linkedUserEmail || e.email || '').toLowerCase();
  const dur = (e: TimeEntry) => { const end = e.clockOut ? new Date(e.clockOut).getTime() : Date.now(); return Math.max(0, (end - new Date(e.clockIn).getTime()) / 3_600_000); };
  const t = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : '—';
  const d = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  const since = Date.now() - 60 * 86400000;
  return (
    <div>
      <h2 className="font-bold text-lg mb-1" style={{ color: PALERMO.slate }}>Contractor time</h2>
      <p className="text-xs text-gray-500 mb-3">Contracting people only · last 60 days · hours (no rates here). Edits are audited.</p>
      <div className="space-y-3">
        {workers.map(w => {
          const email = emailOf(w);
          const entries = payrollTimeEntries.filter(e => (e.userEmail || '').toLowerCase() === email && new Date(e.clockIn).getTime() >= since).sort((a, b) => new Date(b.clockIn).getTime() - new Date(a.clockIn).getTime());
          const total = entries.reduce((s, e) => s + dur(e), 0);
          return (
            <div key={w.id} className="bg-white rounded-lg border">
              <div className="p-2 border-b flex items-center justify-between">
                <span className="font-semibold" style={{ color: PALERMO.slate }}>{w.name} <span className="text-xs font-normal text-gray-400">· {round2(total)}h</span></span>
                <button onClick={() => setForm({ mode: 'add', worker: w })} className="text-xs px-2 py-1 rounded text-white font-semibold" style={{ backgroundColor: PALERMO.gold }}>+ Add entry</button>
              </div>
              <div className="divide-y">
                {entries.length === 0 && <div className="p-2 text-xs text-gray-400">No entries in the last 60 days.</div>}
                {entries.map(e => (
                  <div key={e.id} className="p-2 text-sm flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div>{d(e.clockIn)} · {e.manualHoursOnly ? `${round2(dur(e))}h (hours)` : `${t(e.clockIn)} → ${e.clockOut ? t(e.clockOut) : <span className="text-emerald-600">active</span>}`} <b className="text-gray-500">{round2(dur(e))}h</b>{e.manualEntry && <span className="text-[9px] ml-1 px-1 rounded bg-slate-100 text-slate-500">manual</span>}</div>
                      {e.workNote && <div className="text-[11px] text-gray-500 italic">“{e.workNote}”</div>}
                      {e.editedBy && <div className="text-[10px] text-gray-300">edited by {e.editedBy}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => setForm({ mode: 'edit', worker: w, entry: e })} className="text-[11px]" style={{ color: PALERMO.slate }}>edit</button>
                      <button onClick={() => confirm('Delete this time entry?') && onDelete(e.id)} className="text-red-400 text-sm">×</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {workers.length === 0 && <div className="text-gray-500 text-sm">No contracting people.</div>}
      </div>
      {form && <ContractingTimeEditForm mode={form.mode} worker={form.worker} entry={form.entry} currentUser={currentUser} onClose={() => setForm(null)} onSave={(e, reason) => { onSave(e, reason); setForm(null); }} />}
    </div>
  );
}

// Contractor "My Hours" — a readable LOG first, editor second. Days listed
// (most recent first) with clock in/out, daily total, and clock-out notes;
// week + pay-period totals up top (own hours only, never rates). Tapping a day
// opens the existing fix-a-punch edit flow (reason-required, audited, own-only);
// "Add missed entry" covers days with no punch. Edits CORRECT the punch (an
// "edited" marker shows on corrected days — no duplicate rows).
// Shared self-service hours section (contractor + mechanic): own punches only,
// day log, "Add missed entry", tap-to-edit with the required-reason audit form.
export function MyHoursSection({ me, employees, payrollTimeEntries, periodCard, onSaveOwn }: { me: { id: string; name: string }; employees: Employee[]; payrollTimeEntries: TimeEntry[]; periodCard: { rangeLabel: string; payDate: string; hours: number }; onSaveOwn: (e: TimeEntry, reason: string) => void }) {
  const [form, setForm] = useState<{ mode: 'add' | 'edit'; entry?: TimeEntry } | null>(null);
  const meEmp = employees.find(e => e.id === me.id);
  const myEmail = (meEmp?.linkedUserEmail || meEmp?.email || '').toLowerCase();
  const dur = (e: TimeEntry) => { const end = e.clockOut ? new Date(e.clockOut).getTime() : Date.now(); return Math.max(0, (end - new Date(e.clockIn).getTime()) / 3_600_000); };
  const t = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : '—';
  const since = Date.now() - 30 * 86400000;
  const mine = payrollTimeEntries.filter(e => (e.userEmail || '').toLowerCase() === myEmail && new Date(e.clockIn).getTime() >= since);
  // This-week total (Monday 00:00 → now).
  const ws = new Date(); ws.setHours(0, 0, 0, 0); ws.setDate(ws.getDate() - ((ws.getDay() + 6) % 7));
  const weekTotal = mine.filter(e => new Date(e.clockIn).getTime() >= ws.getTime()).reduce((s, e) => s + dur(e), 0);
  // Group by day, most-recent day first.
  const byDay = new Map<string, TimeEntry[]>();
  mine.forEach(e => { const k = new Date(e.clockIn).toDateString(); (byDay.get(k) || byDay.set(k, []).get(k)!).push(e); });
  const days = [...byDay.entries()].map(([k, es]) => ({ k, ms: new Date(k).getTime(), es: es.sort((a, b) => new Date(a.clockIn).getTime() - new Date(b.clockIn).getTime()) })).sort((a, b) => b.ms - a.ms);
  const dayLabel = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
  if (!meEmp) return null;
  return (
    <div className="bg-white rounded-xl border">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs font-black uppercase tracking-widest" style={{ color: PALERMO.slate }}>My hours</span>
        <button onClick={() => setForm({ mode: 'add' })} className="text-xs px-2 py-1 rounded text-white font-semibold" style={{ backgroundColor: PALERMO.gold }}>+ Add missed entry</button>
      </div>
      {/* Totals — the record at a glance (reuses the pay-period lens). */}
      <div className="grid grid-cols-2 divide-x border-b">
        <div className="p-2.5 text-center">
          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">This week</div>
          <div className="text-xl font-black" style={{ color: PALERMO.slate }}>{round2(weekTotal)}h</div>
        </div>
        <div className="p-2.5 text-center">
          <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#1E8449' }}>This period · {periodCard.rangeLabel}</div>
          <div className="text-xl font-black" style={{ color: '#1E8449' }}>{periodCard.hours.toFixed(1)}h</div>
          <div className="text-[10px] text-gray-400">pays {periodCard.payDate}</div>
        </div>
      </div>
      {/* The log — days, times, daily totals, notes. Tap a day to correct it. */}
      <div className="divide-y">
        {days.length === 0 && <div className="p-3 text-xs text-gray-400 text-center">No punches in the last 30 days. Tap “Add missed entry” to log one.</div>}
        {days.map(day => {
          const dayTotal = day.es.reduce((s, e) => s + dur(e), 0);
          const edited = day.es.some(e => e.editedBy);
          return (
            <div key={day.k} className="px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-slate-700">{dayLabel(day.ms)}{edited && <span className="ml-1.5 text-[9px] font-black uppercase tracking-wider px-1 py-0.5 rounded bg-amber-100 text-amber-700">edited</span>}</span>
                <span className="font-mono font-black text-sm" style={{ color: PALERMO.slate }}>{round2(dayTotal)}h</span>
              </div>
              <div className="mt-1 space-y-1">
                {day.es.map(e => (
                  <button key={e.id} onClick={() => setForm({ mode: 'edit', entry: e })} className="w-full text-left flex items-start justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                    <span className="min-w-0">
                      <span className="text-sm text-slate-600">{e.manualHoursOnly ? `${round2(dur(e))}h entered` : <>{t(e.clockIn)} → {e.clockOut ? t(e.clockOut) : <span className="text-emerald-600 font-semibold">active</span>}</>}{e.manualEntry && <span className="text-[9px] ml-1 px-1 rounded bg-slate-100 text-slate-500">manual</span>}</span>
                      {e.workNote && <span className="block text-[11px] text-gray-500 italic">“{e.workNote}”</span>}
                    </span>
                    <span className="text-[11px] shrink-0 mt-0.5" style={{ color: PALERMO.slate }}>{e.editedBy ? 'edit ✎' : 'edit'}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-3 py-1.5 text-[10px] text-gray-400 border-t">Editing a punch corrects it in place (audited) — it never adds a duplicate.</div>
      {form && <ContractingTimeEditForm mode={form.mode} worker={meEmp} entry={form.entry} currentUser={me} onClose={() => setForm(null)} onSave={(e, reason) => { onSaveOwn(e, reason); setForm(null); }} />}
    </div>
  );
}

function ContractingTimeEditForm({ mode, worker, entry, currentUser, onClose, onSave }: { mode: 'add' | 'edit'; worker: Employee; entry?: TimeEntry; currentUser: { id: string; name: string }; onClose: () => void; onSave: (e: TimeEntry, reason: string) => void }) {
  const emailOf = (e: Employee) => (e.linkedUserEmail || e.email || '').toLowerCase();
  const [byHours, setByHours] = useState(!!entry?.manualHoursOnly || mode === 'add');
  const [date, setDate] = useState(entry ? dateInputVal(new Date(entry.clockIn).getTime()) : dateInputVal(Date.now()));
  const [start, setStart] = useState(entry && !entry.manualHoursOnly ? timeInputVal(new Date(entry.clockIn).getTime()) : '08:00');
  const [end, setEnd] = useState(entry?.clockOut && !entry.manualHoursOnly ? timeInputVal(new Date(entry.clockOut).getTime()) : '16:00');
  const durH = entry ? Math.max(0, ((entry.clockOut ? new Date(entry.clockOut).getTime() : Date.now()) - new Date(entry.clockIn).getTime()) / 3_600_000) : 0;
  const [hours, setHours] = useState(entry ? String(round2(durH)) : '');
  const [note, setNote] = useState(entry?.workNote || '');
  const [reason, setReason] = useState('');
  const isoAt = (dstr: string, tstr: string) => { const [y, m, dd] = dstr.split('-').map(Number); const [hh, mm] = tstr.split(':').map(Number); return new Date(y, (m || 1) - 1, dd || 1, hh || 0, mm || 0, 0).toISOString(); };
  const valid = (byHours ? Number(hours) > 0 : (start && end && end > start)) && !!reason.trim();
  const build = (): TimeEntry => {
    const base: TimeEntry = entry
      ? { ...entry }
      : { id: `time-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, userEmail: emailOf(worker), userName: worker.name, clockIn: '', notes: [], manualEntry: true, enteredBy: { email: '', name: currentUser.name } };
    if (byHours) {
      const startIso = isoAt(date, '08:00');
      const endIso = new Date(new Date(startIso).getTime() + Number(hours) * 3_600_000).toISOString();
      return { ...base, clockIn: startIso, clockOut: endIso, manualEntry: true, manualHoursOnly: true, workNote: note.trim() || undefined };
    }
    return { ...base, clockIn: isoAt(date, start), clockOut: isoAt(date, end), manualEntry: true, manualHoursOnly: false, workNote: note.trim() || undefined };
  };
  return (
    <Modal title={`${mode === 'add' ? 'Add' : 'Edit'} time · ${worker.name}`} onClose={onClose}>
      <Field label="Date"><input className="inp" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <div className="flex gap-2 mb-2">
        {(['hours', 'times'] as const).map(m => <button key={m} onClick={() => setByHours(m === 'hours')} className="flex-1 py-1.5 rounded border text-sm font-semibold capitalize" style={(byHours ? 'hours' : 'times') === m ? { backgroundColor: PALERMO.slate, color: 'white' } : {}}>{m === 'hours' ? 'Hours only' : 'In / out'}</button>)}
      </div>
      {byHours ? (
        <Field label="Hours"><input className="inp" type="number" step="0.25" min="0" value={hours} onChange={e => setHours(e.target.value)} /></Field>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Field label="In"><input className="inp" type="time" value={start} onChange={e => setStart(e.target.value)} /></Field>
          <Field label="Out"><input className="inp" type="time" value={end} onChange={e => setEnd(e.target.value)} /></Field>
        </div>
      )}
      <Field label="Note (what was worked on)"><input className="inp" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. framed the bar wall" /></Field>
      <Field label="Reason for change (audited)"><input className="inp" value={reason} onChange={e => setReason(e.target.value)} placeholder={mode === 'add' ? 'e.g. missed punch' : 'e.g. forgot to clock out'} /></Field>
      <ModalActions onClose={onClose} disabled={!valid} onSave={() => onSave(build(), reason.trim())} />
    </Modal>
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

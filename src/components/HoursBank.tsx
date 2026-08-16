// HOURS BANK — the ledger, the employee's own view, and the admin overview.
//
// THREE surfaces, one ledger component. What changes between them is who can
// see whose ledger and who may write to it; how a ledger READS is identical
// everywhere, because an employee checking their balance and an admin checking
// the same balance had better be looking at the same thing.
//
// Nothing here writes. Every action calls back to App.tsx, which stamps the
// audit fields from the signed-in identity and appends — see onAddEntry.
import { useMemo, useState } from 'react';
import {
  PiggyBank, Plus, ArrowDownCircle, ArrowUpCircle, RotateCcw, X, AlertTriangle,
  ChevronDown, ChevronRight, Users, Lock,
} from 'lucide-react';
import type { Employee, HoursBankEntry } from '../types';
import {
  balanceOf, canReverse, companyTotal, entriesFor, ENTRY_LABEL, fmtHours,
  ledgerRowsNewestFirst, outstanding, overdrawnBy, paidOnLabel, periodLabel, reversalEntry,
  reversedIds, signedHours, summaries, validateHours,
} from '../lib/hoursBank';
import {
  payPeriodSettings, currentPayPeriod, stepPeriod, periodRangeLabel, PayPeriod, PayPeriodSettings,
} from '../lib/payPeriods';

// What the caller has to supply to record anything. `entry` is everything the
// form knows; App.tsx adds recordedAt / recordedBy.
export type NewBankEntry = Omit<HoursBankEntry, 'recordedAt' | 'recordedBy'>;

const stampDate = (ms?: number) =>
  ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const todayYmd = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const inputCls = 'w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2.5 '
  + 'text-[15px] text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30';

// ── THE BALANCE ────────────────────────────────────────────────────────────
// Big, first, and never a derived-looking number in small type: the balance is
// what everyone opens this to see.
function BalanceHeader({ balance, name, compact }: { balance: number; name?: string; compact?: boolean }) {
  const negative = balance < -0.001;
  return (
    <div className={`rounded-xl border ${negative ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'} ${compact ? 'p-3' : 'p-4'}`}>
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
        {name ? `${name} — hours banked` : 'Hours banked'}
      </div>
      <div className={`font-black leading-none ${compact ? 'text-3xl' : 'text-4xl'} ${negative ? 'text-rose-700' : 'text-emerald-700'}`}>
        {fmtHours(balance)}
      </div>
      {negative && (
        <div className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-bold text-rose-700">
          <AlertTriangle className="w-3.5 h-3.5" /> Overdrawn — more has been paid out than was banked
        </div>
      )}
    </div>
  );
}

// ── THE LEDGER ─────────────────────────────────────────────────────────────
export function HoursBankLedger({
  entries, employeeName, canReverseEntries, onReverse, compact,
}: {
  entries: HoursBankEntry[];
  employeeName?: string;
  // Admin only. Everyone else reads.
  canReverseEntries?: boolean;
  onReverse?: (target: HoursBankEntry, reason: string) => void;
  compact?: boolean;
}) {
  const rows = useMemo(() => ledgerRowsNewestFirst(entries), [entries]);
  const already = useMemo(() => reversedIds(entries), [entries]);
  const [reversing, setReversing] = useState<HoursBankEntry | null>(null);
  const [reason, setReason] = useState('');

  return (
    <div className="space-y-3">
      <BalanceHeader balance={balanceOf(entries)} name={employeeName} compact={compact} />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm font-bold text-slate-400">
          No banked hours yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          {rows.map(({ entry, balance }) => {
            const isReversal = entry.type === 'reversal';
            const wasReversed = already.has(entry.id);
            const positive = entry.hours >= 0;
            return (
              <div key={entry.id} className={`p-3 ${wasReversed ? 'bg-slate-50' : ''}`}>
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 shrink-0 ${isReversal ? 'text-amber-600' : positive ? 'text-emerald-600' : 'text-sky-600'}`}>
                    {isReversal ? <RotateCcw className="w-5 h-5" />
                      : positive ? <ArrowDownCircle className="w-5 h-5" /> : <ArrowUpCircle className="w-5 h-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className={`text-[15px] font-black ${wasReversed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                        {ENTRY_LABEL[entry.type]} {fmtHours(entry.hours)}
                      </span>
                      {entry.type === 'banked' && entry.periodStart && (
                        <span className="text-[13px] font-bold text-slate-500">{periodLabel(entry)}</span>
                      )}
                      {entry.type === 'paid_out' && entry.paidOn && (
                        <span className="text-[13px] font-bold text-slate-500">{paidOnLabel(entry)}</span>
                      )}
                      {wasReversed && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-700">
                          reversed
                        </span>
                      )}
                    </div>
                    {/* THE AUDIT LINE. On every entry, always shown: who
                        recorded it and when is not an admin detail, it is the
                        reason the ledger can be trusted. */}
                    <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                      recorded {stampDate(entry.recordedAt)}
                      {entry.recordedBy?.name ? ` by ${entry.recordedBy.name}` : ''}
                    </div>
                    {isReversal && entry.reversalReason && (
                      <div className="mt-1 text-[13px] text-amber-800">
                        <b>Reason:</b> {entry.reversalReason}
                      </div>
                    )}
                    {entry.note && <div className="mt-1 text-[13px] text-slate-600">{entry.note}</div>}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`text-[15px] font-black ${positive ? 'text-emerald-700' : 'text-sky-700'}`}>
                      {signedHours(entry.hours)}
                    </div>
                    {/* The running balance is what makes the history
                        reconcile — the ledger's state once this row happened. */}
                    <div className="text-[11px] font-bold text-slate-400">bal {fmtHours(balance)}</div>
                  </div>
                </div>
                {canReverseEntries && canReverse(entry, already) && (
                  <div className="mt-2 pl-8">
                    <button
                      type="button"
                      onClick={() => { setReversing(entry); setReason(''); }}
                      className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:border-amber-300 hover:text-amber-700"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Reverse
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* CORRECTION, NOT DELETION. The reason is required — an unexplained
          adjustment in a ledger of money owed is worse than the mistake. */}
      {reversing && (
        <Sheet title={`Reverse ${ENTRY_LABEL[reversing.type].toLowerCase()} ${fmtHours(reversing.hours)}`} onClose={() => setReversing(null)}>
          <p className="text-[13px] text-slate-600">
            This writes a <b>new entry</b> that cancels out the original. Nothing is deleted, and both
            halves stay in the history — that is what makes this a record rather than a draft.
          </p>
          <div className="mt-4">
            <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-500">
              Reason (required)
            </label>
            <input
              autoFocus
              className={inputCls}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Banked to the wrong week"
            />
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setReversing(null)}
              className="min-h-[44px] rounded-lg px-4 text-xs font-black uppercase tracking-widest text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button
              type="button"
              disabled={!reason.trim()}
              onClick={() => { onReverse?.(reversing, reason.trim()); setReversing(null); }}
              className="min-h-[44px] rounded-lg bg-amber-600 px-5 text-xs font-black uppercase tracking-widest text-white shadow disabled:opacity-40"
            >
              Record reversal
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ── THE EMPLOYEE'S OWN VIEW ────────────────────────────────────────────────
// Read-only, and says so. Rendered wherever someone already sees their own
// hours; `collapsible` keeps it to a balance card until it is asked for.
export function MyHoursBank({
  entries, collapsible, defaultOpen,
}: {
  entries: HoursBankEntry[];
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen || !collapsible);
  const balance = balanceOf(entries);
  // Nothing banked and nothing ever banked: no card at all. A bank account
  // nobody opened is not information.
  if (!entries.length) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="rounded-lg bg-emerald-100 p-1.5"><PiggyBank className="h-4 w-4 text-emerald-700" /></span>
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-700">Hours bank</h3>
        <span className="ml-auto text-[10px] font-black uppercase tracking-widest text-slate-400 inline-flex items-center gap-1">
          <Lock className="w-3 h-3" /> view only
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="text-3xl font-black leading-none text-emerald-700">{fmtHours(balance)}</div>
        {collapsible && (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="ml-auto inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-[11px] font-black uppercase tracking-widest text-slate-500 hover:border-emerald-300 hover:text-emerald-700"
          >
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            {open ? 'Hide history' : `History (${entries.length})`}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3">
          <HoursBankLedger entries={entries} compact />
        </div>
      )}
    </div>
  );
}

// ── ADMIN / MANAGER OVERVIEW ───────────────────────────────────────────────
export function HoursBankAdmin({
  all, employees, canManage, onAddEntry, restrictToIds, restrictionNote,
  payPeriodCfg,
}: {
  all: Record<string, HoursBankEntry>;
  employees: Employee[];
  // ADMIN ONLY. A manager gets exactly this screen with every write path
  // absent — not disabled-looking buttons, absent.
  canManage: boolean;
  onAddEntry: (entry: NewBankEntry) => void;
  // When present, only these employees' ledgers are shown (a manager's own
  // division). Undefined = everyone.
  restrictToIds?: Set<string>;
  restrictionNote?: string;
  payPeriodCfg: PayPeriodSettings;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState<null | 'banked' | 'paid_out'>(null);
  const [presetEmployee, setPresetEmployee] = useState<string>('');

  const rows = useMemo(() => {
    const s = summaries(all, employees);
    return restrictToIds ? s.filter(r => restrictToIds.has(r.employeeId)) : s;
  }, [all, employees, restrictToIds]);
  const owing = outstanding(rows);
  const total = companyTotal(owing);

  const openLedger = openId ? entriesFor(all, openId) : [];
  const openName = rows.find(r => r.employeeId === openId)?.employeeName || '';

  const startAdd = (kind: 'banked' | 'paid_out', employeeId = '') => {
    setPresetEmployee(employeeId);
    setAdding(kind);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-emerald-100 p-1.5"><PiggyBank className="h-5 w-5 text-emerald-700" /></span>
          <h3 className="text-lg font-black text-slate-800">Hours Bank</h3>
        </div>
        {canManage && (
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" onClick={() => startAdd('banked')}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-black uppercase tracking-widest text-white shadow hover:bg-emerald-700">
              <Plus className="h-3.5 w-3.5" /> Add banked hours
            </button>
            <button type="button" onClick={() => startAdd('paid_out')}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-black uppercase tracking-widest text-white shadow hover:bg-sky-700">
              <ArrowUpCircle className="h-3.5 w-3.5" /> Record payout
            </button>
          </div>
        )}
      </div>

      {!canManage && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-bold text-slate-500 inline-flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" /> View only — banking and payouts are recorded by an admin.
          {restrictionNote ? ` ${restrictionNote}` : ''}
        </div>
      )}

      {/* WHO ARE WE CARRYING HOURS FOR, AND HOW MANY — one glance. */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <Users className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-black uppercase tracking-widest text-slate-600">
            Outstanding balances
          </span>
          <span className="ml-auto text-right">
            <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Company total</span>
            <span className="block text-lg font-black leading-none text-emerald-700">{fmtHours(total)}</span>
          </span>
        </div>
        {owing.length === 0 ? (
          <div className="p-8 text-center text-sm font-bold text-slate-400">
            No hours banked{restrictToIds ? ' in this division' : ''}.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {owing.map(r => (
              <div key={r.employeeId}>
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => setOpenId(openId === r.employeeId ? null : r.employeeId)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {openId === r.employeeId
                      ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                      : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
                    <span className="truncate text-[15px] font-bold text-slate-800">{r.employeeName}</span>
                    <span className="shrink-0 text-[11px] font-bold text-slate-400">
                      {r.entryCount} entr{r.entryCount === 1 ? 'y' : 'ies'} · last {stampDate(r.lastActivityAt)}
                    </span>
                  </button>
                  <span className={`shrink-0 text-[17px] font-black ${r.balance < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {fmtHours(r.balance)}
                  </span>
                  {canManage && (
                    <div className="flex shrink-0 gap-1">
                      <button type="button" title="Add banked hours" onClick={() => startAdd('banked', r.employeeId)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50">
                        <Plus className="h-4 w-4" />
                      </button>
                      <button type="button" title="Record a payout" onClick={() => startAdd('paid_out', r.employeeId)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-sky-600 hover:bg-sky-50">
                        <ArrowUpCircle className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
                {openId === r.employeeId && (
                  <div className="border-t border-slate-100 bg-slate-50/60 p-3">
                    <HoursBankLedger
                      entries={openLedger}
                      employeeName={openName}
                      canReverseEntries={canManage}
                      onReverse={(target, reason) => onAddEntry(reversalEntry(target, reason))}
                      compact
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {adding && (
        <EntryForm
          kind={adding}
          employees={employees}
          restrictToIds={restrictToIds}
          presetEmployeeId={presetEmployee}
          all={all}
          payPeriodCfg={payPeriodCfg}
          onClose={() => setAdding(null)}
          onSave={entry => { onAddEntry(entry); setAdding(null); }}
        />
      )}
    </div>
  );
}

// ── ADD BANKED / RECORD PAYOUT ─────────────────────────────────────────────
function EntryForm({
  kind, employees, restrictToIds, presetEmployeeId, all, payPeriodCfg, onClose, onSave,
}: {
  kind: 'banked' | 'paid_out';
  employees: Employee[];
  restrictToIds?: Set<string>;
  presetEmployeeId?: string;
  all: Record<string, HoursBankEntry>;
  payPeriodCfg: PayPeriodSettings;
  onClose: () => void;
  onSave: (entry: NewBankEntry) => void;
}) {
  const banking = kind === 'banked';
  const roster = useMemo(
    () => employees
      .filter(e => e.status !== 'Inactive')
      .filter(e => !restrictToIds || restrictToIds.has(e.id))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [employees, restrictToIds],
  );
  const [employeeId, setEmployeeId] = useState(presetEmployeeId || '');
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const [paidOn, setPaidOn] = useState(todayYmd());
  // THE PERIOD IS A PICKER, not free text: entries have to be comparable, and
  // "week of Aug 4" typed six different ways is six different weeks.
  const [period, setPeriod] = useState<PayPeriod>(() => currentPayPeriod(payPeriodCfg, Date.now()));

  const employee = roster.find(e => e.id === employeeId);
  const balance = employeeId ? balanceOf(entriesFor(all, employeeId)) : 0;
  const hoursError = validateHours(hours);
  const over = !banking && !hoursError ? overdrawnBy(balance, Number(hours)) : 0;
  const ready = !!employee && !hoursError;

  const save = () => {
    if (!employee || hoursError) return;
    const base = { id: '', employeeId: employee.id, employeeName: employee.name } as NewBankEntry;
    onSave(banking
      ? { ...base, type: 'banked', hours: Math.abs(Number(hours)), periodStart: period.start, periodEnd: period.end, note: note.trim() || undefined }
      : { ...base, type: 'paid_out', hours: -Math.abs(Number(hours)), paidOn, note: note.trim() || undefined });
  };

  return (
    <Sheet title={banking ? 'Add banked hours' : 'Record a payout'} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-500">Employee</label>
          <select className={inputCls} value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
            <option value="">Choose…</option>
            {roster.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          {employee && (
            <div className="mt-1 text-[12px] font-bold text-slate-500">
              Current balance {fmtHours(balance)}
            </div>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-500">Hours</label>
          <input
            className={inputCls}
            type="number" step="0.1" inputMode="decimal" min="0"
            value={hours}
            onChange={e => setHours(e.target.value)}
            placeholder={banking ? '8.0' : '20.0'}
          />
          {hours !== '' && hoursError && (
            <div className="mt-1 text-[12px] font-bold text-rose-600">{hoursError}</div>
          )}
        </div>

        {banking ? (
          <div>
            <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-500">
              Pay period being banked from
            </label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPeriod(p => stepPeriod(p, payPeriodCfg, -1))}
                className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm font-black text-slate-600 hover:bg-slate-50">‹</button>
              <div className="min-h-[44px] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-center text-[15px] font-bold text-slate-800">
                {periodRangeLabel(period)}
              </div>
              <button type="button" onClick={() => setPeriod(p => stepPeriod(p, payPeriodCfg, 1))}
                className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm font-black text-slate-600 hover:bg-slate-50">›</button>
            </div>
            <div className="mt-1 text-[12px] text-slate-500">
              The same pay periods TimeMaster uses — picked, not typed, so every entry lines up.
            </div>
          </div>
        ) : (
          <div>
            <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-500">Paid on</label>
            <input className={inputCls} type="date" value={paidOn} onChange={e => setPaidOn(e.target.value)} />
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-500">Note (optional)</label>
          <input className={inputCls} value={note} onChange={e => setNote(e.target.value)}
            placeholder={banking ? 'Held over at his request' : 'Paid with the Aug 14 run'} />
        </div>

        {/* A payout bigger than the balance is allowed — but not by accident. */}
        {over > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900">
            <b className="inline-flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> More than the balance.</b>
            {' '}This pays out {fmtHours(Number(hours))} against a balance of {fmtHours(balance)} and will
            leave the bank {fmtHours(over)} overdrawn. Recorded as entered — the ledger says what happened.
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[12px] text-slate-500">
          Entries are <b>never edited or deleted</b>. A mistake is corrected with a reversing entry that
          carries a reason, so the history stays a true record.
        </div>
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        <button type="button" onClick={onClose}
          className="min-h-[44px] rounded-lg px-4 text-xs font-black uppercase tracking-widest text-slate-600 hover:bg-slate-100">
          Cancel
        </button>
        <button
          type="button" disabled={!ready} onClick={save}
          className={`min-h-[44px] rounded-lg px-5 text-xs font-black uppercase tracking-widest text-white shadow disabled:opacity-40 ${
            banking ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-sky-600 hover:bg-sky-700'}`}
        >
          {banking ? 'Bank these hours' : 'Record payout'}
        </button>
      </div>
    </Sheet>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[120] flex bg-black/60 md:items-center md:justify-center md:p-4" onClick={onClose}>
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl md:h-auto md:max-h-[90vh] md:max-w-lg md:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-800">{title}</h3>
          <button onClick={onClose} aria-label="Close"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

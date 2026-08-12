// ── CAPACITY SETTINGS ───────────────────────────────────────────────────────
// Three things, all admin-editable, all VALUES only — this panel writes
// nothing but settings.capacity, and both capacity tools are read-only
// consumers of it.
//
//   1. DECLARED weekly BH per division  → the Booking view's yardstick.
//      A management decision, not a derivation: it deliberately sidesteps
//      crew attribution, which is the part that can't be trusted.
//   2. HEADCOUNT CEILINGS               → the Schedule Balance overbooking
//      check. Weekly BH a crew of N can deliver, non-linear by design.
//   3. COLOUR THRESHOLDS                → shared by both.
//   4. AUTO-REFRESH per scope           → whether the scheduled Jobber pull
//      runs at all. OFF by default; see CapacitySettings.autoRefresh.
//
// ONE editor, two hosts: Manage Resources → App Settings (saved with the rest
// of that modal) and the capacity view's own settings panel (saves itself).
import type { Dispatch, SetStateAction } from 'react';
import { Plus, X } from 'lucide-react';
import type { AppSettings, HeadcountCeiling } from '../types';
import { DIVISIONS, DEFAULT_CAPACITY_THRESHOLDS, DEFAULT_HEADCOUNT_CEILINGS } from '../constants';
import { capacityOrDefault, thresholdsOrDefault, declaredFor, autoRefreshEnabled } from '../lib/capacity';
import type { CapacityScope } from '../types';

// The two scopes, with the schedule each keeps when it is switched on. Times
// mirror functions/src/jobber/capacityForecast.ts — keep them in step.
const SCOPE_ROWS: { scope: CapacityScope; label: string; when: string }[] = [
  { scope: 'projects', label: 'Projects', when: '6:33 am' },
  { scope: 'lawn', label: 'Lawn', when: '6:18 am' },
];

export default function CapacitySettingsPanel({ settings, setSettings, isAdmin }: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  isAdmin: boolean;
}) {
  const cap = capacityOrDefault(settings.capacity);
  const thresholds = thresholdsOrDefault(cap);
  const ceilings = cap.headcountCeilings || DEFAULT_HEADCOUNT_CEILINGS;

  // Writes the CURRENT shape wholesale, which is also what retires the old
  // per-person settings: they simply aren't part of what gets written.
  const write = (next: Partial<typeof cap>) =>
    setSettings(s => ({ ...s, capacity: { ...cap, ...next } }));

  const numOrNull = (raw: string): number | null => {
    if (raw.trim() === '') return null;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  };

  const setDeclared = (division: string, field: 'crews' | 'peoplePerCrew' | 'bhPerPerson', value: number | null) => write({
    declared: {
      ...cap.declared,
      [division]: { ...(cap.declared?.[division] || {}), [field]: value, placeholder: false },
    },
  });

  const setCeiling = (idx: number, field: 'headcount' | 'weeklyBH', raw: string) => {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    const next = ceilings.map((r, i) => (i === idx ? { ...r, [field]: v, placeholder: false } : r));
    write({ headcountCeilings: next });
  };

  const inputCls = 'w-20 border border-slate-300 rounded p-1 text-sm font-mono font-bold bg-white outline-none disabled:opacity-60 disabled:cursor-not-allowed';
  const bandOrderBroken =
    !(thresholds.underPct <= thresholds.lightPct && thresholds.lightPct <= thresholds.healthyPct);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-6">
      {/* 1 — DECLARED CAPACITY */}
      <div className="space-y-3">
        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">
            Booking — declared weekly capacity
          </label>
          <p className="text-xs text-slate-500">
            <strong>Crews × people per crew × BH per person per week.</strong> Every one of
            these is typed in by management — <strong>none is read from the schedule or the
            roster</strong>. Stating the parts rather than one flat total means that when the
            number needs changing it is obvious what to change. A division with nothing entered
            shows raw booked BH with <strong>no bar and no percentage</strong> rather than a
            made-up one.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            <strong>[hourly] work is not estimated automatically.</strong> Every hourly job is
            different, so a default or duration-derived figure would be fiction. Capacity lists
            them unestimated on the Booking view and asks for a number per job instead.
            <strong> Untagged</strong> visits are a data error to fix in Jobber, not a job type
            — they stay at zero and are flagged.
          </p>
        </div>
        <div className="space-y-2">
          {DIVISIONS.map(division => {
            const rule = cap.declared?.[division] || {};
            const basis = declaredFor(cap, division);
            return (
              <div key={division} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-black text-slate-700 w-32">{division}</span>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="number" min={1} step={1} placeholder="1"
                      disabled={!isAdmin}
                      value={rule.crews ?? ''}
                      onChange={e => setDeclared(division, 'crews', numOrNull(e.target.value))}
                      className="w-14 border border-slate-300 rounded p-1 text-sm font-mono font-bold bg-white outline-none disabled:opacity-60 text-right"
                    />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">crews</span>
                  </label>
                  <span className="text-slate-300 font-black">×</span>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="number" min={0} step={1} placeholder="—"
                      disabled={!isAdmin}
                      value={rule.peoplePerCrew ?? ''}
                      onChange={e => setDeclared(division, 'peoplePerCrew', numOrNull(e.target.value))}
                      className="w-14 border border-slate-300 rounded p-1 text-sm font-mono font-bold bg-white outline-none disabled:opacity-60 text-right"
                    />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">people/crew</span>
                  </label>
                  <span className="text-slate-300 font-black">×</span>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="number" min={0} step={1} placeholder="—"
                      disabled={!isAdmin}
                      value={rule.bhPerPerson ?? ''}
                      onChange={e => setDeclared(division, 'bhPerPerson', numOrNull(e.target.value))}
                      className="w-16 border border-slate-300 rounded p-1 text-sm font-mono font-bold bg-white outline-none disabled:opacity-60 text-right"
                    />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">BH/person/wk</span>
                  </label>
                </div>
                <div className={`text-[11px] font-bold mt-1 ${basis.bh === null ? 'text-amber-700' : 'text-slate-500'}`}>
                  {basis.bh === null ? 'not set — this division shows raw booked BH with no percentage' : basis.basis}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2 — HEADCOUNT CEILINGS */}
      <div className="space-y-3 border-t border-slate-100 pt-4">
        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">
            Schedule Balance — weekly ceiling by crew headcount
          </label>
          <p className="text-xs text-slate-500">
            What a crew of N people can deliver in a <strong>week</strong>. Deliberately
            non-linear: travel and setup are per-crew, not per-head, so a solo crew delivers
            more than half of a pair. Read with floor semantics — the highest row at or below
            the crew&apos;s actual headcount, and the top row means &quot;that many or more&quot;.
            A crew booked above its ceiling is flagged OVER; under is normal and gets no colour.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ceilings.map((row: HeadcountCeiling, idx: number) => (
            <div key={idx} className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
              <input
                type="number" min={1} step={1}
                disabled={!isAdmin}
                value={row.headcount}
                onChange={e => setCeiling(idx, 'headcount', e.target.value)}
                className="w-12 border border-slate-300 rounded p-1 text-sm font-mono font-bold bg-white outline-none disabled:opacity-60"
              />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                {idx === ceilings.length - 1 ? 'or more →' : 'people →'}
              </span>
              <input
                type="number" min={0} step={5}
                disabled={!isAdmin}
                value={row.weeklyBH}
                onChange={e => setCeiling(idx, 'weeklyBH', e.target.value)}
                className="w-16 border border-slate-300 rounded p-1 text-sm font-mono font-bold bg-white outline-none disabled:opacity-60"
              />
              <span className="text-[10px] font-bold text-slate-400">BH/wk</span>
              {row.placeholder && (
                <span className="text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-800 border border-amber-300 px-1 py-0.5 rounded">
                  placeholder
                </span>
              )}
              {isAdmin && ceilings.length > 1 && (
                <button
                  type="button"
                  onClick={() => write({ headcountCeilings: ceilings.filter((_, i) => i !== idx) })}
                  className="text-rose-400 hover:text-rose-600 p-0.5"
                  title="Remove this row"
                ><X className="w-3.5 h-3.5" /></button>
              )}
            </div>
          ))}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => write({
                headcountCeilings: [...ceilings, {
                  headcount: (ceilings[ceilings.length - 1]?.headcount || 0) + 1,
                  weeklyBH: (ceilings[ceilings.length - 1]?.weeklyBH || 0) + 20,
                  placeholder: true,
                }],
              })}
              className="text-[10px] font-black uppercase tracking-widest text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 border border-slate-300 rounded px-2 py-1"
            ><Plus className="w-3 h-3" /> Add row</button>
            <button
              type="button"
              onClick={() => write({ headcountCeilings: DEFAULT_HEADCOUNT_CEILINGS.map(r => ({ ...r })) })}
              className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800"
            >Reset to 40 / 70 / 90 …</button>
          </div>
        )}
      </div>

      {/* 3 — THRESHOLDS */}
      <div className="border-t border-slate-100 pt-4 space-y-2">
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block">
          Colour thresholds (% of declared capacity)
        </label>
        <p className="text-xs text-slate-500">
          The same thresholds apply to every week shown. The two reds mean OPPOSITE things:
          below the first number a week is <strong>underbooked</strong> (sell into it, drawn as
          a hollow dashed block); above the last it is <strong>overbooked</strong> (can&apos;t
          deliver, drawn as a solid dark red block).
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-rose-700">Under &lt;</span>
            <input type="number" min={0} step={1} disabled={!isAdmin} value={thresholds.underPct}
              onChange={e => write({ thresholds: { ...thresholds, underPct: Number(e.target.value) || 0 } })}
              className={inputCls} />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">Light &lt;</span>
            <input type="number" min={0} step={1} disabled={!isAdmin} value={thresholds.lightPct}
              onChange={e => write({ thresholds: { ...thresholds, lightPct: Number(e.target.value) || 0 } })}
              className={inputCls} />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Healthy ≤</span>
            <input type="number" min={0} step={1} disabled={!isAdmin} value={thresholds.healthyPct}
              onChange={e => write({ thresholds: { ...thresholds, healthyPct: Number(e.target.value) || 0 } })}
              className={inputCls} />
          </label>
          <span className="text-[10px] font-black uppercase tracking-widest text-red-900">
            over &gt; {thresholds.healthyPct}%
          </span>
        </div>
        {bandOrderBroken && (
          <p className="text-[11px] font-bold text-rose-700">
            These need to climb: under ≤ light ≤ healthy. As entered, a band is unreachable.
          </p>
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={() => write({ thresholds: { ...DEFAULT_CAPACITY_THRESHOLDS } })}
            className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800"
          >Reset thresholds to 70 / 90 / 110</button>
        )}
      </div>

      {/* 4 — AUTO-REFRESH */}
      <div className="border-t border-slate-100 pt-4 space-y-2">
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block">
          Automatic refresh
        </label>
        <p className="text-xs text-slate-500">
          Off by default. Each scheduled pull spends from the same Jobber query budget the
          performance sync runs on, so it isn&apos;t worth a daily pull until this view is in
          real use. While a scope is off <strong>no scheduled Jobber call is made for it at
          all</strong> — the view simply shows how old its last snapshot is.
          {' '}<strong>Refresh works either way.</strong>
        </p>
        <div className="flex flex-wrap gap-2">
          {SCOPE_ROWS.map(({ scope, label, when }) => {
            const on = autoRefreshEnabled(cap, scope);
            return (
              <label
                key={scope}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer ${
                  on ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50'
                } ${isAdmin ? '' : 'opacity-60 cursor-not-allowed'}`}
              >
                <input
                  type="checkbox"
                  disabled={!isAdmin}
                  checked={on}
                  onChange={e => write({
                    autoRefresh: { ...(cap.autoRefresh || {}), [scope]: e.target.checked },
                  })}
                  className="w-4 h-4 accent-emerald-600"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-black uppercase tracking-widest text-slate-700">{label}</span>
                  <span className="block text-[10px] font-bold text-slate-400">
                    {on ? `on — pulls once daily, ${when}` : 'off — manual Refresh only'}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

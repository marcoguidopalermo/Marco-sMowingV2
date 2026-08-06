// ── CAPACITY CALENDAR SETTINGS ──────────────────────────────────────────────
// Weekly BH capacity per division (default) and per crew (override), plus the
// colour thresholds. Values only — this panel writes nothing but
// settings.capacity, and the calendar is a read-only reader of it.
//
// ONE editor, two hosts: Manage Resources → App Settings (saved with the rest
// of that modal) and the Capacity view's own settings panel (saves itself).
// The hosts differ only in how the draft is committed, which is why this
// takes a plain settings/setSettings pair rather than owning either flow.
import type { Dispatch, SetStateAction } from 'react';
import type { AppSettings, CapacityRule } from '../types';
import { DIVISIONS, CREW_NUMBERS, DEFAULT_CAPACITY_THRESHOLDS } from '../constants';
import { capacityOrDefault, thresholdsOrDefault, capacityCrewKey } from '../lib/capacity';

export default function CapacitySettingsPanel({ settings, setSettings, isAdmin }: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  isAdmin: boolean;
}) {
  const cap = capacityOrDefault(settings.capacity);
  const thresholds = thresholdsOrDefault(cap);

  const write = (next: Partial<typeof cap>) =>
    setSettings(s => ({ ...s, capacity: { ...cap, ...next } }));

  // A blank input clears the value — and an explicitly cleared division
  // entry sticks (the seeded placeholder does not come back).
  const numOrNull = (raw: string): number | null => {
    if (raw.trim() === '') return null;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const setDivision = (division: string, patch: Partial<CapacityRule>) => write({
    divisions: {
      ...cap.divisions,
      [division]: { ...(cap.divisions?.[division] || {}), ...patch, placeholder: false },
    },
  });
  const setCrew = (division: string, crewNumber: number, perPersonBH: number | null) => {
    const key = capacityCrewKey(division, crewNumber);
    const crews = { ...(cap.crews || {}) };
    if (perPersonBH === null) delete crews[key];
    else crews[key] = { ...(crews[key] || {}), perPersonBH };
    write({ crews });
  };

  const inputCls = 'w-20 border border-slate-300 rounded p-1 text-sm font-mono font-bold bg-white outline-none disabled:opacity-60 disabled:cursor-not-allowed';
  const bandOrderBroken =
    !(thresholds.underPct <= thresholds.lightPct && thresholds.lightPct <= thresholds.healthyPct);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-5">
      <div>
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">
          Capacity Calendar — Weekly BH
        </label>
        <p className="text-xs text-slate-500">
          <strong>BH one person delivers in a week.</strong> Capacity is DERIVED from this
          × the people actually scheduled that week, less approved time off — so it follows
          a crew that changes shape instead of assuming full strength every week. Set a
          DIVISION default; a crew value overrides it. <strong>Standard size</strong> is the
          crew at full strength: it projects weeks the schedule hasn&apos;t reached yet and
          is the faint reference that shows when a week is thin because nobody&apos;s
          scheduled rather than because nothing&apos;s sold. Leave the rate blank and that
          crew shows raw BH with <strong>no bar and no percentage</strong>.
          Nothing here touches performance, efficiency or pay.
        </p>
      </div>

      {DIVISIONS.map(division => {
        const rule = cap.divisions?.[division] || {};
        const isPlaceholder = !!rule.placeholder;
        return (
          <div key={division} className="border border-slate-200 rounded-lg p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-black text-slate-800 text-sm">{division}</span>
              {isPlaceholder && (
                <span className="text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded">
                  placeholder — confirm this
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">BH / person / week</span>
                <input
                  type="number" min={0} step={1} placeholder="blank"
                  disabled={!isAdmin}
                  value={rule.perPersonBH ?? ''}
                  onChange={e => setDivision(division, { perPersonBH: numOrNull(e.target.value) })}
                  className={inputCls}
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Standard crew size</span>
                <input
                  type="number" min={0} step={1} placeholder="auto"
                  disabled={!isAdmin}
                  value={rule.standardSize ?? ''}
                  onChange={e => setDivision(division, { standardSize: numOrNull(e.target.value) })}
                  className={inputCls}
                />
                <span className="text-[10px] text-slate-400">blank = most recent actual size</span>
              </label>
            </div>
            {rule.weeklyBH ? (
              <p className="text-[10px] font-bold text-amber-700">
                A flat {rule.weeklyBH} BH/week is pinned for this division — it OVERRIDES the
                derivation and ignores who is scheduled.{' '}
                {isAdmin && (
                  <button type="button" onClick={() => setDivision(division, { weeklyBH: null })}
                    className="underline font-black">Clear it</button>
                )}
              </p>
            ) : null}
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                Crew BH/person overrides (blank = use the division default)
              </div>
              <div className="flex flex-wrap gap-2">
                {CREW_NUMBERS.map(n => (
                  <label key={n} className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                    <span className="text-[10px] font-black text-slate-500">#{n}</span>
                    <input
                      type="number" min={0} step={1} placeholder="—"
                      disabled={!isAdmin}
                      value={cap.crews?.[capacityCrewKey(division, n)]?.perPersonBH ?? ''}
                      onChange={e => setCrew(division, n, numOrNull(e.target.value))}
                      className="w-14 bg-white border border-slate-300 rounded p-1 text-xs font-mono font-bold outline-none disabled:opacity-60"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        );
      })}

      <div className="border-t border-slate-100 pt-4 space-y-2">
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block">
          Colour thresholds (% of capacity)
        </label>
        <p className="text-xs text-slate-500">
          The same thresholds apply to every week shown — near weeks and far weeks alike.
          The two reds mean OPPOSITE things: below the first number a week is
          <strong> underbooked</strong> (sell into it, drawn as a hollow dashed block); above the
          last it is <strong>overbooked</strong> (can&apos;t deliver, drawn as a solid dark red block).
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-rose-700">Under &lt;</span>
            <input
              type="number" min={0} step={1} disabled={!isAdmin}
              value={thresholds.underPct}
              onChange={e => write({ thresholds: { ...thresholds, underPct: Number(e.target.value) || 0 } })}
              className={inputCls}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">Light &lt;</span>
            <input
              type="number" min={0} step={1} disabled={!isAdmin}
              value={thresholds.lightPct}
              onChange={e => write({ thresholds: { ...thresholds, lightPct: Number(e.target.value) || 0 } })}
              className={inputCls}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Healthy ≤</span>
            <input
              type="number" min={0} step={1} disabled={!isAdmin}
              value={thresholds.healthyPct}
              onChange={e => write({ thresholds: { ...thresholds, healthyPct: Number(e.target.value) || 0 } })}
              className={inputCls}
            />
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
          >
            Reset thresholds to 70 / 90 / 110
          </button>
        )}
      </div>
    </div>
  );
}

// ── JOBBER ASSIGNEE MAPPING ─────────────────────────────────────────────────
// Capacity attributes forward work by matching a visit's Jobber assignees to
// crews. Those assignees are route/crew SLOTS ("#1 (SOUTH)"), not people —
// one per crew-day, moving between crews over time — so deriving the mapping
// from the schedule is only ever as good as the schedule is filled in.
//
// This is where that mapping becomes visible and fixable: every slot, what it
// is carrying, where its work currently lands and why. An explicit mapping
// takes PRECEDENCE over the schedule match and persists independently of it,
// so a route moving between crews stops breaking attribution.
//
// Capacity only. Nothing here touches how the performance sync attributes
// work for pay.
import type { Dispatch, SetStateAction } from 'react';
import { AlertTriangle, Link2, X } from 'lucide-react';
import type { AppSettings, AssigneeMapping } from '../types';
import { DIVISIONS, CREW_NUMBERS } from '../constants';
import { capacityOrDefault, type AssigneeDiagnostics } from '../lib/capacity';

const bh = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

export default function AssigneeMappingPanel({
  diagnostics, settings, setSettings, isAdmin,
}: {
  diagnostics: AssigneeDiagnostics;
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  isAdmin: boolean;
}) {
  const cap = capacityOrDefault(settings.capacity);
  const map = cap.assigneeMap || {};

  const setMapping = (id: string, next: AssigneeMapping | null, label?: string) => {
    const assigneeMap = { ...map };
    if (next === null) delete assigneeMap[id];
    else assigneeMap[id] = { ...next, ...(label ? { label } : {}) };
    setSettings(s => ({ ...s, capacity: { ...cap, assigneeMap } }));
  };

  const { assignees, unmapped, unmappedBH, conflicts, unmappedCrewDays, totalForwardBH } = diagnostics;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div>
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">
          Jobber assignee mapping
        </label>
        <p className="text-xs text-slate-500">
          Jobber &quot;users&quot; here are route/crew <strong>slots</strong>, not people — one per
          crew-day, and they move between crews over time. Capacity matches forward work through
          them. Setting a division below is an <strong>explicit mapping that wins over the
          schedule</strong> and survives a route changing crews; anything left on
          &quot;from schedule&quot; keeps using the schedule match as before. A division can hold
          as many slots as it needs.
        </p>
      </div>

      {/* DIAGNOSTICS — what's actually wrong right now */}
      <div className="grid gap-2 sm:grid-cols-3">
        <div className={`rounded-lg border p-2 ${unmapped.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Unmapped slots</div>
          <div className={`text-xl font-black ${unmapped.length > 0 ? 'text-amber-800' : 'text-slate-700'}`}>
            {unmapped.length}
          </div>
          <div className="text-[10px] font-bold text-slate-500">
            {bh(unmappedBH)} BH → Unattributed
            {totalForwardBH > 0 && ` (${Math.round((unmappedBH / totalForwardBH) * 100)}% of forward work)`}
          </div>
        </div>
        <div className={`rounded-lg border p-2 ${unmappedCrewDays.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Crew-days with no slot</div>
          <div className={`text-xl font-black ${unmappedCrewDays.length > 0 ? 'text-amber-800' : 'text-slate-700'}`}>
            {unmappedCrewDays.length}
          </div>
          <div className="text-[10px] font-bold text-slate-500">work scheduled to them can&apos;t be matched</div>
        </div>
        <div className={`rounded-lg border p-2 ${conflicts.length > 0 ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Conflicts</div>
          <div className={`text-xl font-black ${conflicts.length > 0 ? 'text-rose-800' : 'text-slate-700'}`}>
            {conflicts.length}
          </div>
          <div className="text-[10px] font-bold text-slate-500">mapped one way, rostered another</div>
        </div>
      </div>

      {unmappedCrewDays.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer font-black uppercase tracking-widest text-amber-700">
            Crew-days missing a Jobber slot ({unmappedCrewDays.length})
          </summary>
          <div className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
            {unmappedCrewDays.slice(0, 60).map((d, i) => (
              <div key={i} className="text-slate-600">
                <span className="font-mono text-slate-400">{d.date}</span> {d.crew}
              </div>
            ))}
            {unmappedCrewDays.length > 60 && (
              <div className="font-bold text-slate-500">+{unmappedCrewDays.length - 60} more</div>
            )}
          </div>
        </details>
      )}

      {/* THE LIST */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
              <th className="py-1.5 pr-3 text-left">Jobber slot</th>
              <th className="py-1.5 px-2 text-right">Forward BH</th>
              <th className="py-1.5 px-2 text-left">On crews</th>
              <th className="py-1.5 px-2 text-left">Attributed to</th>
              <th className="py-1.5 pl-2 text-left">Map to division</th>
            </tr>
          </thead>
          <tbody>
            {assignees.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-sm text-slate-500">
                No Jobber assignees seen yet — pull the forecast first.
              </td></tr>
            )}
            {assignees.map(a => (
              <tr key={a.id} className={`border-b border-slate-50 ${a.conflict ? 'bg-rose-50/60' : a.source === 'none' ? 'bg-amber-50/50' : ''}`}>
                <td className="py-1.5 pr-3 text-left">
                  <div className="font-bold text-slate-800 flex items-center gap-1.5">
                    {a.label}
                    {a.archived && (
                      <span className="text-[9px] font-black uppercase tracking-widest bg-slate-200 text-slate-600 px-1 rounded">archived</span>
                    )}
                    {a.conflict && <AlertTriangle className="w-3 h-3 text-rose-600" />}
                  </div>
                  <div className="text-[9px] font-mono text-slate-300 truncate max-w-[14rem]">{a.id}</div>
                </td>
                <td className="py-1.5 px-2 text-right font-mono font-black text-slate-800">
                  {a.forwardBH > 0 ? bh(a.forwardBH) : '—'}
                  <div className="text-[9px] font-bold text-slate-400">{a.visits || 0} visits</div>
                </td>
                <td className="py-1.5 px-2 text-left text-[11px] text-slate-500">
                  {a.scheduleCrews.length > 0 ? a.scheduleCrews.join(', ') : <span className="text-slate-300">not on the schedule</span>}
                </td>
                <td className="py-1.5 px-2 text-left text-[11px]">
                  {a.resolvedDivision ? (
                    <>
                      <span className="font-bold text-slate-700">{a.resolvedDivision}</span>
                      <div className={`text-[9px] font-black uppercase tracking-widest ${a.source === 'mapped' ? 'text-emerald-700' : 'text-slate-400'}`}>
                        {a.source === 'mapped' ? 'explicitly mapped' : 'from schedule'}
                      </div>
                    </>
                  ) : (
                    <span className="font-black text-amber-700">Unattributed</span>
                  )}
                  {a.conflict && (
                    <div className="text-[9px] font-bold text-rose-700">
                      rostered on {a.scheduleDivision}
                    </div>
                  )}
                </td>
                <td className="py-1.5 pl-2 text-left">
                  <div className="flex items-center gap-1">
                    <select
                      disabled={!isAdmin}
                      value={a.mapped?.division || ''}
                      onChange={e => {
                        const v = e.target.value;
                        if (!v) setMapping(a.id, null);
                        else setMapping(a.id, { division: v, crewNumber: a.mapped?.crewNumber ?? null }, a.label);
                      }}
                      className="text-[11px] font-bold text-slate-700 bg-white border border-slate-300 rounded px-1 py-1 outline-none disabled:opacity-60"
                    >
                      <option value="">from schedule</option>
                      {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    {a.mapped && (
                      <>
                        <select
                          disabled={!isAdmin}
                          value={a.mapped.crewNumber ?? ''}
                          onChange={e => setMapping(a.id, {
                            division: a.mapped!.division,
                            crewNumber: e.target.value === '' ? null : Number(e.target.value),
                          }, a.label)}
                          className="text-[11px] font-bold text-slate-600 bg-white border border-slate-300 rounded px-1 py-1 outline-none disabled:opacity-60"
                          title="Optional — pin to a specific crew"
                        >
                          <option value="">any crew</option>
                          {CREW_NUMBERS.map(n => <option key={n} value={n}>#{n}</option>)}
                        </select>
                        {isAdmin && (
                          <button type="button" onClick={() => setMapping(a.id, null)}
                            className="p-0.5 text-slate-400 hover:text-rose-600" title="Clear mapping">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-slate-400 inline-flex items-start gap-1">
        <Link2 className="w-3 h-3 mt-0.5 shrink-0" />
        Capacity attribution only — this has no effect on how the performance sync attributes
        work for pay or efficiency.
      </p>
    </div>
  );
}

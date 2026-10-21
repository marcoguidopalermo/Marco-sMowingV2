// Assign service names the rules don't place — shared by SalesMaster (James,
// Marco) and OfficeMaster (Dave). Saves to serviceCategoryMap/overrides; the
// category rules (functions/src/shared/serviceCategories.ts) apply it at once.
import { useState } from 'react';
import { Tags } from 'lucide-react';
import { CATEGORIES, type Category, type CategoryOverrides } from '../lib/sales/categories';
import { normName, needsCategory } from '../../functions/src/shared/serviceCategories';

export interface ServiceNamesDoc {
  freehand?: { key: string; label: string; count: number; amount: number; sample: string; unmapped: boolean; trimming: boolean }[];
  catalog?: { name: string; count: number; amount: number }[];
  updatedAt?: number;
}

const $ = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`;

/**
 * The names still waiting for a category — re-checked against the CURRENT
 * rules (not the flags the last pull stored), minus the ones already assigned.
 * Equipment sales and discounts never need one.
 */
export function namesToAssign(names: ServiceNamesDoc | null | undefined, o: CategoryOverrides) {
  return (names?.freehand || [])
    .filter(f => !(o.names && o.names[f.key]))
    .map(f => { const flag = needsCategory(f.label, o); return flag ? { ...f, unmapped: flag === 'unmapped', trimming: flag === 'trimming' } : null; })
    .filter((f): f is NonNullable<typeof f> => !!f);
}

export default function ServiceNameAssign({ names, overrides, canEdit, onSave, compact }: {
  names: ServiceNamesDoc | null | undefined; overrides: CategoryOverrides; canEdit: boolean;
  onSave: (o: CategoryOverrides) => Promise<boolean>; compact?: boolean;
}) {
  const [all, setAll] = useState(false);
  const todo = namesToAssign(names, overrides);
  const shown = all ? todo : todo.slice(0, compact ? 8 : 15);
  const assign = (key: string, c: Category | '') => {
    const next: CategoryOverrides = { ...overrides, names: { ...(overrides.names || {}) } };
    if (c) next.names![key] = c; else delete next.names![key];
    return onSave(next);
  };
  if (!names) return <div className="text-sm text-slate-500">The list appears after the next sales pull.</div>;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-slate-600 mb-1.5">
        <Tags className="w-3.5 h-3.5" /> {todo.length} service name{todo.length === 1 ? '' : 's'} not in a category · {$(todo.reduce((s, f) => s + f.amount, 0))} this year — they count as Other until assigned.
      </div>
      {todo.length === 0 ? <div className="text-sm text-emerald-700">All service names are in a category.</div> : (
        <div className="divide-y divide-slate-100">
          {shown.map(f => (
            <div key={f.key} className="flex items-center gap-2 py-1.5 text-sm flex-wrap">
              <span className="flex-1 min-w-[160px]">
                <b className="text-slate-800">{f.label}</b>
                <span className="block text-[11px] text-slate-500">{f.count} line{f.count === 1 ? '' : 's'} · {$(f.amount)} · e.g. invoice/quote #{f.sample}{f.trimming ? ' · trimming: hedges or string trimming?' : ''}</span>
              </span>
              {canEdit ? (
                <select aria-label={`Category for ${f.label}`} className="border border-slate-300 rounded-md px-2 py-1 text-sm bg-white" value="" onChange={e => assign(f.key, e.target.value as Category)}>
                  <option value="">Assign…</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : <span className="text-[11px] text-slate-400">admin assigns</span>}
            </div>
          ))}
        </div>
      )}
      {todo.length > shown.length && <button type="button" onClick={() => setAll(true)} className="mt-1 text-xs font-bold text-sky-700">Show all {todo.length}</button>}
      {Object.keys(overrides.names || {}).length > 0 && (
        <details className="mt-2 text-xs text-slate-600">
          <summary className="cursor-pointer font-bold">Assigned names ({Object.keys(overrides.names || {}).length})</summary>
          <div className="mt-1 divide-y divide-slate-100">
            {Object.entries(overrides.names || {}).sort().map(([k, c]) => (
              <div key={k} className="flex items-center gap-2 py-1">
                <span className="flex-1">{(names.freehand || []).find(f => f.key === k)?.label || k}</span>
                {canEdit ? (
                  <select aria-label={`Category for ${k}`} className="border border-slate-300 rounded px-1.5 py-0.5 bg-white" value={c} onChange={e => assign(k, e.target.value as Category | '')}>
                    <option value="">(remove — back to the rules)</option>
                    {CATEGORIES.map(x => <option key={x} value={x}>{x}</option>)}
                  </select>
                ) : <b>{c}</b>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export { normName };

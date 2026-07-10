import { useMemo, useState } from 'react';
import { X, BookOpen, Check, SkipForward, Ban, UserCog, Layers } from 'lucide-react';
import { Employee, RoleTaskInstance, RoleMasterDuty } from '../types';
import SopText from './SopText';

interface Props {
  instance: RoleTaskInstance;
  duty?: RoleMasterDuty;
  roleName?: string;
  outstanding: RoleTaskInstance[];   // all open instances of the same duty
  employees: Employee[];
  isAdmin: boolean;
  onClose: () => void;
  onComplete: (note: string) => void;
  onSkip: (reason: string) => void;
  onVoid: (reason: string) => void;
  onReassign: (employeeId: string) => void;
  onBatchComplete: (ids: string[], note: string) => void;
}

export default function RoleInstanceModal({
  instance, duty, roleName, outstanding, employees, isAdmin,
  onClose, onComplete, onSkip, onVoid, onReassign, onBatchComplete,
}: Props) {
  const [mode, setMode] = useState<'complete' | 'skip' | 'void' | 'reassign' | 'batch'>('complete');
  const [note, setNote] = useState('');
  const [reassignId, setReassignId] = useState('');
  const [batchIds, setBatchIds] = useState<Set<string>>(new Set(outstanding.map(o => o.id)));

  const prompt = duty?.notePrompt || 'What was done?';
  const stackCount = outstanding.length;
  const assignable = useMemo(() => employees.filter(e => e.status === 'Active' && (e.linkedUserEmail || e.email)), [employees]);
  const toggleBatch = (id: string) => setBatchIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{roleName || 'Role duty'}{duty?.category ? ` · ${duty.category}` : ''}</div>
            <h2 className="text-lg font-bold text-slate-800">{instance.title}</h2>
            <div className="text-xs text-slate-500">Due {instance.occurrenceDate}{stackCount > 1 ? ` · ${stackCount} outstanding` : ''}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X className="w-5 h-5" /></button>
        </div>

        {/* SOP */}
        {duty?.sop && (
          <details className="px-5 py-3 border-b border-slate-100" open>
            <summary className="text-xs font-black uppercase tracking-widest text-slate-500 cursor-pointer flex items-center gap-1.5"><BookOpen className="w-3.5 h-3.5" /> How-to (SOP)</summary>
            <SopText text={duty.sop} className="mt-2 text-[12px] text-slate-700 bg-slate-50 border border-slate-100 rounded p-2" />
          </details>
        )}

        {/* Action tabs */}
        <div className="px-5 pt-3 flex flex-wrap gap-1.5 text-[11px] font-bold">
          {([['complete', 'Complete'], ['skip', 'Skip'], ...(stackCount > 1 ? [['batch', `Catch up (${stackCount})`]] : []), ...(isAdmin ? [['reassign', 'Reassign'], ['void', 'Void']] : [])] as [string, string][]).map(([k, lbl]) => (
            <button key={k} onClick={() => setMode(k as any)} className={`px-2.5 py-1 rounded ${mode === k ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>{lbl}</button>
          ))}
        </div>

        <div className="px-5 py-4">
          {mode === 'complete' && (<>
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-500 block mb-1">{prompt} <span className="text-rose-500">*required</span></label>
            <textarea value={note} onChange={e => setNote(e.target.value)} className="w-full border border-slate-300 rounded-lg p-2 text-sm h-24 outline-none focus:ring-2 focus:ring-emerald-400" autoFocus />
            <button disabled={!note.trim()} onClick={() => onComplete(note)} className="mt-3 w-full inline-flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-black uppercase tracking-widest text-xs py-2.5 rounded-lg"><Check className="w-4 h-4" /> Mark complete</button>
          </>)}

          {mode === 'skip' && (<>
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-500 block mb-1">Reason to skip <span className="text-rose-500">*required</span></label>
            <textarea value={note} onChange={e => setNote(e.target.value)} className="w-full border border-slate-300 rounded-lg p-2 text-sm h-20 outline-none" autoFocus />
            <button disabled={!note.trim()} onClick={() => onSkip(note)} className="mt-3 w-full inline-flex items-center justify-center gap-1.5 bg-slate-600 hover:bg-slate-700 disabled:bg-slate-300 text-white font-black uppercase tracking-widest text-xs py-2.5 rounded-lg"><SkipForward className="w-4 h-4" /> Skip this duty</button>
          </>)}

          {mode === 'batch' && (<>
            <div className="text-[11px] text-slate-500 mb-2">Select outstanding instances to resolve together with one note (all marked done-late):</div>
            <div className="space-y-1 max-h-40 overflow-y-auto mb-2">
              {outstanding.map(o => (
                <label key={o.id} className="flex items-center gap-2 text-sm border border-slate-100 rounded px-2 py-1">
                  <input type="checkbox" checked={batchIds.has(o.id)} onChange={() => toggleBatch(o.id)} />
                  <span className="text-slate-700">Due {o.occurrenceDate}</span>
                </label>
              ))}
            </div>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder={prompt} className="w-full border border-slate-300 rounded-lg p-2 text-sm h-20 outline-none" />
            <button disabled={!note.trim() || batchIds.size === 0} onClick={() => onBatchComplete([...batchIds], note)} className="mt-3 w-full inline-flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white font-black uppercase tracking-widest text-xs py-2.5 rounded-lg"><Layers className="w-4 h-4" /> Catch up {batchIds.size}</button>
          </>)}

          {mode === 'reassign' && isAdmin && (<>
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-500 block mb-1">Reassign this instance to</label>
            <select value={reassignId} onChange={e => setReassignId(e.target.value)} className="w-full border border-slate-300 rounded-lg p-2 text-sm">
              <option value="">Pick an employee…</option>
              {assignable.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <button disabled={!reassignId} onClick={() => onReassign(reassignId)} className="mt-3 w-full inline-flex items-center justify-center gap-1.5 bg-slate-700 hover:bg-slate-800 disabled:bg-slate-300 text-white font-black uppercase tracking-widest text-xs py-2.5 rounded-lg"><UserCog className="w-4 h-4" /> Reassign (role unchanged)</button>
          </>)}

          {mode === 'void' && isAdmin && (<>
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-500 block mb-1">Reason to void <span className="text-rose-500">*required</span></label>
            <textarea value={note} onChange={e => setNote(e.target.value)} className="w-full border border-slate-300 rounded-lg p-2 text-sm h-20 outline-none" />
            <div className="text-[11px] text-slate-400 mt-1">Void keeps the record in history — never deletes it.</div>
            <button disabled={!note.trim()} onClick={() => onVoid(note)} className="mt-3 w-full inline-flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white font-black uppercase tracking-widest text-xs py-2.5 rounded-lg"><Ban className="w-4 h-4" /> Void</button>
          </>)}
        </div>
      </div>
    </div>
  );
}

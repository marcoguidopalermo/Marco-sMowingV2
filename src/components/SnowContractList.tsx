// SNOWMASTER · CONTRACT LIST — every contract for a season, at a glance.
import { useMemo, useState } from 'react';
import { Plus, Search, FileText } from 'lucide-react';
import type { SnowContract, SnowContractStatus } from '../types';
import { headlinePrice, STATUS_LABEL, seasonFor } from '../lib/snowContracts';

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_CHIP: Record<SnowContractStatus, string> = {
  draft: 'bg-slate-100 text-slate-600 border-slate-300',
  sent: 'bg-sky-50 text-sky-700 border-sky-300',
  signed: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  declined: 'bg-rose-50 text-rose-700 border-rose-300',
  expired: 'bg-amber-50 text-amber-800 border-amber-300',
};

export default function SnowContractList({
  contracts, onOpen, onNew, canEdit, today,
}: {
  contracts: Record<string, SnowContract>;
  onOpen: (id: string) => void;
  onNew: () => void;
  canEdit: boolean;
  today: string;
}) {
  const all = useMemo(() => Object.values(contracts), [contracts]);
  const seasons = useMemo(() => {
    const s = new Set(all.map(c => c.season));
    s.add(seasonFor(new Date(`${today}T12:00:00`)));
    return [...s].sort().reverse();
  }, [all, today]);

  const [season, setSeason] = useState<string>(seasons[0] || '');
  const [status, setStatus] = useState<'all' | SnowContractStatus>('all');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter(c => (season === 'all' || c.season === season))
      .filter(c => (status === 'all' || c.status === status))
      .filter(c => !needle
        || c.client.businessName.toLowerCase().includes(needle)
        || c.client.serviceAddress.toLowerCase().includes(needle))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [all, season, status, q]);

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 mr-auto">
          <FileText className="w-5 h-5 text-slate-700" />
          <h3 className="text-lg font-black text-slate-900">Commercial contracts</h3>
        </div>
        <select value={season} onChange={e => setSeason(e.target.value)}
          className="text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg px-2 py-2">
          <option value="all">All seasons</option>
          {seasons.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value as any)}
          className="text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg px-2 py-2">
          <option value="all">All statuses</option>
          {(Object.keys(STATUS_LABEL) as SnowContractStatus[]).map(s =>
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="business or address"
            className="text-xs border border-slate-300 rounded-lg pl-7 pr-2 py-2 outline-none w-52" />
        </div>
        {canEdit && (
          <button type="button" onClick={onNew}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest bg-slate-800 text-white">
            <Plus className="w-3.5 h-3.5" /> New contract
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
              <th className="py-2 px-3 text-left">Business</th>
              <th className="py-2 px-3 text-left">Address</th>
              <th className="py-2 px-3 text-left">Status</th>
              <th className="py-2 px-3 text-right">Price</th>
              <th className="py-2 px-3 text-right">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="py-8 text-center text-sm text-slate-500">
                No contracts{season !== 'all' ? ` for ${season}` : ''} yet.
              </td></tr>
            )}
            {rows.map(c => {
              const p = headlinePrice(c);
              return (
                <tr key={c.id} onClick={() => onOpen(c.id)}
                  className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer">
                  <td className="py-2 px-3 text-left font-bold text-slate-800">
                    {c.client.businessName || <span className="text-slate-400">Untitled</span>}
                    <div className="text-[10px] font-bold text-slate-400">{c.season}</div>
                  </td>
                  <td className="py-2 px-3 text-left text-slate-600">{c.client.serviceAddress || '—'}</td>
                  <td className="py-2 px-3 text-left">
                    <span className={`text-[10px] font-black uppercase tracking-widest border px-1.5 py-0.5 rounded ${STATUS_CHIP[c.status]}`}>
                      {STATUS_LABEL[c.status]}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-black text-slate-800">
                    {p.kind === null ? <span className="text-slate-300">—</span> : money(p.amount)}
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                      {p.kind === 'seasonal' ? 'seasonal' : p.kind === 'perVisit' ? 'per visit' : ''}
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right text-[11px] text-slate-500">
                    {c.updatedAt ? new Date(c.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

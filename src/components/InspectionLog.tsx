import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Filter, FileSignature, AlertCircle, CheckCircle, Flame, Printer, Trash2 } from 'lucide-react';
import { Inspection, FleetItem } from '../types';
import { fleetItemLabel } from '../lib/fleetUtils';

interface InspectionLogProps {
  inspections: Inspection[];
  fleet: FleetItem[];
  onView: (inspectionId: string) => void;
  // Admin-only in practice (canDeleteInspectionLog). When false, the
  // delete column doesn't render at all — a mechanic/manager looking at
  // the log sees zero affordance, not a disabled button.
  canDelete?: boolean;
  onDelete?: (inspectionId: string) => void;
}

type DateRange = 'today' | 'week' | 'month' | 'custom';
type TypeFilter = 'all' | 'DVIR' | 'CircleCheck' | 'Trailer' | 'Maintenance';
type ResultFilter = 'all' | 'Pass' | 'Minor' | 'Major';

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfWeek(d: Date) { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; }
function startOfMonth(d: Date) { const x = startOfDay(d); x.setDate(1); return x; }

function inspectorLabel(i: Inspection): string {
  return i.inspectorName || i.inspectorEmail || i.driverName || '';
}

function odometerLabel(i: Inspection, unit: FleetItem | undefined): string {
  if (i.type === 'Trailer') return '—';
  if (typeof i.odometer !== 'number') return '—';
  const suffix = unit?.type === 'equipment' ? 'hrs' : 'km';
  return `${i.odometer.toLocaleString()} ${suffix}`;
}

export default function InspectionLog({ inspections, fleet, onView, canDelete, onDelete }: InspectionLogProps) {
  const [dateRange, setDateRange] = useState<DateRange>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [unitFilter, setUnitFilter] = useState<string>('all');
  const [inspectorFilter, setInspectorFilter] = useState<string>('all');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [printMode, setPrintMode] = useState<null | 'summary' | 'full'>(null);
  const printedRef = useRef(false);

  // Trigger window.print() once the print-only DOM is rendered
  useEffect(() => {
    if (printMode && !printedRef.current) {
      printedRef.current = true;
      const t = setTimeout(() => {
        window.print();
        setPrintMode(null);
        printedRef.current = false;
      }, 100);
      return () => clearTimeout(t);
    }
  }, [printMode]);

  const filterDescription = useMemo(() => {
    const parts: string[] = [];
    if (dateRange === 'today') parts.push('Today');
    else if (dateRange === 'week') parts.push('This Week');
    else if (dateRange === 'month') parts.push('This Month');
    else if (dateRange === 'custom') parts.push(`${customStart || '…'} → ${customEnd || '…'}`);
    if (typeFilter !== 'all') parts.push(`Type: ${typeFilter === 'CircleCheck' ? 'Circle Check' : typeFilter}`);
    if (unitFilter !== 'all') {
      const u = fleet.find(f => f.id === unitFilter);
      if (u) parts.push(`Unit: ${u.name}`);
    }
    if (inspectorFilter !== 'all') parts.push(`Inspector: ${inspectorFilter}`);
    if (resultFilter !== 'all') parts.push(`Result: ${resultFilter}`);
    if (parts.length === 0) return 'All inspections';
    return `Filtered: ${parts.join(' · ')}`;
  }, [dateRange, customStart, customEnd, typeFilter, unitFilter, inspectorFilter, resultFilter, fleet]);

  const inspectorOptions = useMemo(() => {
    const set = new Set<string>();
    inspections.forEach(i => {
      const label = inspectorLabel(i);
      if (label) set.add(label);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [inspections]);

  const filtered = useMemo(() => {
    const now = new Date();
    let from: Date | null = null;
    let to: Date | null = null;
    if (dateRange === 'today') { from = startOfDay(now); }
    else if (dateRange === 'week') { from = startOfWeek(now); }
    else if (dateRange === 'month') { from = startOfMonth(now); }
    else if (dateRange === 'custom') {
      if (customStart) from = startOfDay(new Date(customStart));
      if (customEnd) { to = new Date(customEnd); to.setHours(23, 59, 59, 999); }
    }

    return inspections
      .filter(i => {
        const ts = new Date(i.timestamp);
        if (from && ts < from) return false;
        if (to && ts > to) return false;
        if (typeFilter !== 'all' && i.type !== typeFilter) return false;
        if (unitFilter !== 'all' && i.unitId !== unitFilter) return false;
        if (inspectorFilter !== 'all' && inspectorLabel(i) !== inspectorFilter) return false;
        if (resultFilter !== 'all') {
          const minor = i.defects.filter(d => d.severity === 'minor').length;
          const major = i.defects.filter(d => d.severity === 'major').length;
          if (resultFilter === 'Pass' && (minor + major) > 0) return false;
          if (resultFilter === 'Minor' && minor === 0) return false;
          if (resultFilter === 'Major' && major === 0) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [inspections, dateRange, customStart, customEnd, typeFilter, unitFilter, inspectorFilter, resultFilter]);

  const totals = useMemo(() => {
    let pass = 0, minor = 0, major = 0;
    filtered.forEach(i => {
      const mn = i.defects.filter(d => d.severity === 'minor').length;
      const mj = i.defects.filter(d => d.severity === 'major').length;
      if (mj > 0) major++;
      else if (mn > 0) minor++;
      else pass++;
    });
    return { total: filtered.length, pass, minor, major };
  }, [filtered]);

  const generatedAt = new Date();

  return (
    <>
    <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden print:hidden">
      {/* FILTER BAR */}
      <div className="p-4 border-b border-gray-200 bg-slate-50 flex flex-wrap gap-3 items-end">
        <div className="flex items-center gap-2 mr-2">
          <Filter className="w-4 h-4 text-slate-500" />
          <span className="text-xs font-black uppercase tracking-widest text-slate-500">Filters</span>
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Date</label>
          <select value={dateRange} onChange={e => setDateRange(e.target.value as DateRange)} className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-sm font-medium text-slate-800 outline-none">
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        {dateRange === 'custom' && (
          <>
            <div className="flex flex-col">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">From</label>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-sm font-medium text-slate-800 outline-none" />
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">To</label>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-sm font-medium text-slate-800 outline-none" />
            </div>
          </>
        )}
        <div className="flex flex-col">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Type</label>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as TypeFilter)} className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-sm font-medium text-slate-800 outline-none">
            <option value="all">All</option>
            <option value="DVIR">DVIR</option>
            <option value="CircleCheck">Circle Check</option>
            <option value="Trailer">Trailer</option>
            <option value="Maintenance">Maintenance</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Unit</label>
          <select value={unitFilter} onChange={e => setUnitFilter(e.target.value)} className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-sm font-medium text-slate-800 outline-none min-w-[140px]">
            <option value="all">All Units</option>
            {fleet.map(f => <option key={f.id} value={f.id}>{fleetItemLabel(f)}</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Inspector</label>
          <select value={inspectorFilter} onChange={e => setInspectorFilter(e.target.value)} className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-sm font-medium text-slate-800 outline-none min-w-[160px]">
            <option value="all">All Inspectors</option>
            {inspectorOptions.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Result</label>
          <select value={resultFilter} onChange={e => setResultFilter(e.target.value as ResultFilter)} className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-sm font-medium text-slate-800 outline-none">
            <option value="all">All</option>
            <option value="Pass">Pass</option>
            <option value="Minor">Has Minor</option>
            <option value="Major">Has Major</option>
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setPrintMode('summary')}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest bg-slate-800 text-white px-3 py-1.5 rounded-md hover:bg-slate-900 disabled:bg-slate-300 disabled:cursor-not-allowed shadow-sm"
            title="Print a summary table of the filtered inspections"
          >
            <Printer className="w-3.5 h-3.5" /> Print Summary
          </button>
          <button
            onClick={() => setPrintMode('full')}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest bg-emerald-600 text-white px-3 py-1.5 rounded-md hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed shadow-sm"
            title="Print full per-page records for each inspection"
          >
            <Printer className="w-3.5 h-3.5" /> Print Full Records
          </button>
          <div className="text-xs font-bold text-slate-500 bg-white border border-slate-200 px-3 py-1.5 rounded-md">
            <ClipboardList className="w-3.5 h-3.5 inline mr-1.5 text-slate-400" />
            {filtered.length} record{filtered.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      {/* TABLE */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-white border-b border-gray-200 text-[10px] text-gray-500 uppercase tracking-widest">
              <th className="p-3 font-black">Date & Time</th>
              <th className="p-3 font-black">Unit</th>
              <th className="p-3 font-black">Type</th>
              <th className="p-3 font-black text-right">Odometer</th>
              <th className="p-3 font-black">Inspector</th>
              <th className="p-3 font-black">Location</th>
              <th className="p-3 font-black">Result</th>
              <th className="p-3 font-black text-right">Minor</th>
              <th className="p-3 font-black text-right">Major</th>
              <th className="p-3 font-black text-right">Details</th>
              {canDelete && <th className="p-3 font-black text-right w-12">{/* delete */}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <tr><td colSpan={canDelete ? 11 : 10} className="p-12 text-center text-slate-300 italic font-medium">No inspections match the current filters.</td></tr>
            ) : filtered.map(i => {
              const unit = fleet.find(f => f.id === i.unitId);
              const minor = i.defects.filter(d => d.severity === 'minor').length;
              const major = i.defects.filter(d => d.severity === 'major').length;
              const inspectorRaw = inspectorLabel(i);
              const isLegacy = !inspectorRaw;
              const ts = new Date(i.timestamp);
              const result = major > 0 ? 'Major' : minor > 0 ? 'Minor' : 'Pass';
              return (
                <tr key={i.id} onClick={() => onView(i.id)} className="hover:bg-slate-50 cursor-pointer transition-colors">
                  <td className="p-3 align-top">
                    <div className="text-sm font-bold text-slate-800">{i.date}</div>
                    <div className="text-[10px] font-medium text-slate-400">{ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </td>
                  <td className="p-3 align-top text-sm font-bold text-slate-800">{unit?.name || 'Unknown'}</td>
                  <td className="p-3 align-top">
                    <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${i.type === 'DVIR' ? 'bg-slate-800 text-white' : i.type === 'Trailer' ? 'bg-purple-100 text-purple-700' : i.type === 'Maintenance' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
                      {i.type === 'CircleCheck' ? 'Circle' : i.type}
                    </span>
                  </td>
                  <td className="p-3 align-top text-right font-mono text-sm font-medium text-slate-700 whitespace-nowrap">{odometerLabel(i, unit)}</td>
                  <td className="p-3 align-top text-sm">
                    {isLegacy ? (
                      <span className="italic text-slate-400 font-medium">Unknown</span>
                    ) : (
                      <span className="font-medium text-slate-700">{inspectorRaw}</span>
                    )}
                  </td>
                  <td className="p-3 align-top text-sm font-medium text-slate-600">{i.location || <span className="text-slate-300 italic">—</span>}</td>
                  <td className="p-3 align-top">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${result === 'Major' ? 'bg-rose-600 text-white' : result === 'Minor' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {result === 'Major' ? <Flame className="w-3 h-3" /> : result === 'Minor' ? <AlertCircle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                      {result}
                    </span>
                  </td>
                  <td className="p-3 align-top text-right font-mono text-sm font-bold text-amber-700">{minor || ''}</td>
                  <td className="p-3 align-top text-right font-mono text-sm font-bold text-rose-600">{major || ''}</td>
                  <td className="p-3 align-top text-right">
                    <button onClick={e => { e.stopPropagation(); onView(i.id); }} className="text-[10px] font-black uppercase tracking-widest text-emerald-600 hover:bg-emerald-50 px-2 py-1 rounded inline-flex items-center gap-1">
                      <FileSignature className="w-3.5 h-3.5" /> View
                    </button>
                  </td>
                  {canDelete && onDelete && (
                    <td className="p-3 align-top text-right">
                      <button
                        onClick={e => { e.stopPropagation(); onDelete(i.id); }}
                        title="Delete this inspection log"
                        aria-label="Delete this inspection log"
                        className="text-rose-400 hover:text-rose-600 p-1.5 hover:bg-rose-50 rounded min-w-[36px] min-h-[36px] inline-flex items-center justify-center"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>

    {/* PRINT-ONLY: SUMMARY VIEW */}
    {printMode === 'summary' && (
      <div className="hidden print:block bg-white text-slate-900 p-8">
        <div className="border-b-4 border-slate-800 pb-4 mb-6 flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-black tracking-tighter">Marco's Mowing</h1>
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500 mt-1">Inspection Log Summary</p>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Generated</div>
            <div className="text-sm font-bold text-slate-700">{generatedAt.toLocaleString()}</div>
            <div className="text-[10px] font-bold text-slate-500 mt-1">{filterDescription}</div>
          </div>
        </div>

        <table className="w-full text-left border-collapse text-[11px]">
          <thead>
            <tr className="border-b-2 border-slate-800 text-[9px] uppercase tracking-widest text-slate-600">
              <th className="py-2 pr-3 font-black">Date</th>
              <th className="py-2 pr-3 font-black">Unit</th>
              <th className="py-2 pr-3 font-black">Type</th>
              <th className="py-2 pr-3 font-black text-right">Odometer</th>
              <th className="py-2 pr-3 font-black">Inspector</th>
              <th className="py-2 pr-3 font-black">Location</th>
              <th className="py-2 pr-3 font-black">Result</th>
              <th className="py-2 pr-3 font-black text-right">Minor</th>
              <th className="py-2 font-black text-right">Major</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(i => {
              const unit = fleet.find(f => f.id === i.unitId);
              const minor = i.defects.filter(d => d.severity === 'minor').length;
              const major = i.defects.filter(d => d.severity === 'major').length;
              const result = major > 0 ? 'Major' : minor > 0 ? 'Minor' : 'Pass';
              return (
                <tr key={i.id} className="border-b border-slate-200">
                  <td className="py-1.5 pr-3 align-top">
                    <div className="font-bold">{i.date}</div>
                    <div className="text-[9px] text-slate-500">{new Date(i.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </td>
                  <td className="py-1.5 pr-3 align-top font-bold">{unit?.name || 'Unknown'}</td>
                  <td className="py-1.5 pr-3 align-top">{i.type === 'CircleCheck' ? 'Circle' : i.type}</td>
                  <td className="py-1.5 pr-3 align-top text-right font-mono">{odometerLabel(i, unit)}</td>
                  <td className="py-1.5 pr-3 align-top">{inspectorLabel(i) || <span className="italic text-slate-400">Unknown</span>}</td>
                  <td className="py-1.5 pr-3 align-top">{i.location || '—'}</td>
                  <td className="py-1.5 pr-3 align-top font-bold">{result}</td>
                  <td className="py-1.5 pr-3 align-top text-right font-mono">{minor || ''}</td>
                  <td className="py-1.5 align-top text-right font-mono">{major || ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-8 pt-4 border-t-2 border-slate-800 flex justify-between text-[10px] font-bold text-slate-700">
          <div>
            <span className="font-black">{totals.total}</span> total inspections
            <span className="mx-2 text-slate-300">|</span>
            <span className="font-black text-emerald-700">{totals.pass}</span> passed
            <span className="mx-2 text-slate-300">|</span>
            <span className="font-black text-amber-700">{totals.minor}</span> with minor defects
            <span className="mx-2 text-slate-300">|</span>
            <span className="font-black text-rose-700">{totals.major}</span> with major defects
          </div>
          <div className="text-slate-400">Marco's Mowing · Inspection Log</div>
        </div>
      </div>
    )}

    {/* PRINT-ONLY: FULL RECORDS (one per page) */}
    {printMode === 'full' && (
      <div className="hidden print:block bg-white text-slate-900">
        {filtered.map((i, idx) => {
          const unit = fleet.find(f => f.id === i.unitId);
          const minor = i.defects.filter(d => d.severity === 'minor').length;
          const major = i.defects.filter(d => d.severity === 'major').length;
          const inspector = inspectorLabel(i);
          return (
            <div
              key={i.id}
              className="p-8"
              style={{ pageBreakAfter: idx < filtered.length - 1 ? 'always' : 'auto', breakAfter: idx < filtered.length - 1 ? 'page' : 'auto' }}
            >
              <div className="border-b-4 border-slate-800 pb-4 mb-6 flex justify-between items-end">
                <div>
                  <h1 className="text-3xl font-black tracking-tighter">Marco's Mowing</h1>
                  <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500 mt-1">Inspection Record</p>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Inspection Date</div>
                  <div className="text-lg font-black text-slate-800">{i.date}</div>
                  <div className="text-[10px] font-bold text-slate-500">{new Date(i.timestamp).toLocaleTimeString()}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-12 gap-y-6 mb-6">
                <div>
                  <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-400">Unit</h4>
                  <p className="text-lg font-black text-slate-800">{unit?.name || 'Unknown'}</p>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">{unit?.type}</p>
                </div>
                <div>
                  <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-400">Inspector</h4>
                  <p className="text-lg font-black text-slate-800">{inspector || <span className="italic text-slate-400">Unknown</span>}</p>
                </div>
                <div>
                  <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-400">Type</h4>
                  <span className={`inline-block text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${i.type === 'DVIR' ? 'bg-slate-800 text-white' : i.type === 'Trailer' ? 'bg-purple-100 text-purple-800' : i.type === 'Maintenance' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                    {i.type === 'CircleCheck' ? 'Circle Check' : i.type}
                  </span>
                </div>
                <div>
                  <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-400">Odometer</h4>
                  <p className="text-lg font-mono font-black text-slate-800">{odometerLabel(i, unit)}</p>
                </div>
                <div className="col-span-2">
                  <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-400">Location</h4>
                  <p className="text-sm font-bold text-slate-800">{i.location || <span className="italic text-slate-400">Not specified</span>}</p>
                </div>
              </div>

              <div className="mb-6">
                <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-200 pb-1 mb-3">
                  Defects ({minor} minor · {major} major)
                </h4>
                {i.defects.length === 0 ? (
                  <div className="border border-emerald-300 bg-emerald-50 p-4 rounded text-emerald-800 font-bold text-sm">
                    No defects reported. Vehicle/unit passed inspection.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {i.defects.map((d, di) => (
                      <div key={`${d.category}-${di}`} className="border border-slate-200 rounded p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${d.severity === 'major' ? 'bg-rose-700 text-white' : 'bg-amber-100 text-amber-800'}`}>
                            {d.severity}
                          </span>
                          <span className="text-sm font-black uppercase">{d.category}</span>
                        </div>
                        {d.notes && <p className="text-xs text-slate-700 italic ml-1">"{d.notes}"</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-10 pt-6 border-t-2 border-slate-800">
                <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Signature</h4>
                <div className="border border-slate-300 rounded p-4">
                  <p className="text-2xl italic text-slate-800" style={{ fontFamily: 'Dancing Script, cursive' }}>{i.signature || '—'}</p>
                  <div className="h-px w-full bg-slate-400 my-2" />
                  <p className="text-[10px] font-bold text-slate-600">
                    Signed by {inspector || 'Unknown'} on {i.date} at {new Date(i.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>

              <div className="mt-8 text-[9px] text-slate-400 text-center font-bold uppercase tracking-widest">
                Marco's Mowing · Inspection Record · Page {idx + 1} of {filtered.length}
              </div>
            </div>
          );
        })}
      </div>
    )}
    </>
  );
}

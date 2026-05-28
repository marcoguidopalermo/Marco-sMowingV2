import type { Dispatch, SetStateAction } from 'react';
import { Map, X, CheckSquare } from 'lucide-react';
import { Job } from '../types';
import { DIVISIONS, DAYS_OF_WEEK, ROUTE_FREQUENCIES } from '../constants';

interface RouteFilters {
  division: string;
  targetDay: string;
  frequency: string;
}

interface RouteSelectionModalProps {
  crewId: string | null;
  onClose: () => void;
  routeFilters: RouteFilters;
  setRouteFilters: Dispatch<SetStateAction<RouteFilters>>;
  selectedRouteIds: Set<string>;
  setSelectedRouteIds: Dispatch<SetStateAction<Set<string>>>;
  routes: Job[];
  getCompletedRouteIdsForWeek: () => Set<string>;
  onConfirm: () => void;
}

export default function RouteSelectionModal({
  crewId,
  onClose,
  routeFilters,
  setRouteFilters,
  selectedRouteIds,
  setSelectedRouteIds,
  routes,
  getCompletedRouteIdsForWeek,
  onConfirm,
}: RouteSelectionModalProps) {
  if (!crewId) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex md:items-center md:justify-center md:p-4">
      <div className="bg-white md:rounded-xl shadow-2xl h-full md:h-auto w-full md:max-w-3xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-green-50">
          <h2 className="text-xl font-bold flex items-center gap-2 text-green-900"><Map className="w-5 h-5" /> Select Completed Routes</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 min-w-[44px] min-h-[44px] inline-flex items-center justify-center"><X className="w-6 h-6" /></button>
        </div>

        {/* DYNAMIC FILTERS */}
        <div className="flex flex-wrap gap-2 p-3 bg-white border-b border-gray-200">
          <select className="border border-gray-300 rounded p-1.5 text-sm font-bold text-gray-700 outline-none bg-gray-50 flex-1 min-w-[140px]" value={routeFilters.division} onChange={e => setRouteFilters({ ...routeFilters, division: e.target.value })}>
            <option value="All">All Divisions</option>
            {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="border border-gray-300 rounded p-1.5 text-sm font-bold text-gray-700 outline-none bg-gray-50 flex-1 min-w-[140px]" value={routeFilters.targetDay} onChange={e => setRouteFilters({ ...routeFilters, targetDay: e.target.value })}>
            <option value="All">All Days</option>
            {DAYS_OF_WEEK.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <div className="flex bg-gray-100 rounded border border-gray-300 overflow-hidden">
            {ROUTE_FREQUENCIES.map(tab => (
              <button key={tab} onClick={() => setRouteFilters({ ...routeFilters, frequency: tab })} className={`px-3 py-1.5 text-xs font-bold ${routeFilters.frequency === tab ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-200'}`}>{tab}</button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
          <div className="space-y-4">
            {(() => {
              const completedIds = getCompletedRouteIdsForWeek();
              const availableRoutes = routes.filter(r =>
                (routeFilters.division === 'All' || r.division === routeFilters.division) &&
                (routeFilters.targetDay === 'All' || r.targetDay === routeFilters.targetDay) &&
                r.frequency === routeFilters.frequency &&
                !completedIds.has(r.id)
              );

              if (availableRoutes.length === 0) {
                return <div className="text-center p-8 text-gray-400 border-2 border-dashed border-gray-300 rounded-xl">No remaining routes match your filters.</div>;
              }

              return (
                <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                  <div className="bg-gray-100 px-3 py-2 border-b border-gray-200 font-bold text-gray-700 text-sm flex justify-between items-center">
                    Available Routes
                    <button onClick={() => {
                      const newSelection = new Set(selectedRouteIds);
                      const allSelected = availableRoutes.every(r => newSelection.has(r.id));
                      availableRoutes.forEach(r => allSelected ? newSelection.delete(r.id) : newSelection.add(r.id));
                      setSelectedRouteIds(newSelection);
                    }} className="text-xs text-green-600 hover:underline flex items-center gap-1 font-semibold">
                      <CheckSquare className="w-3.5 h-3.5" /> Select All
                    </button>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {availableRoutes.map(route => (
                      <label key={route.id} className="flex items-center gap-3 p-3 hover:bg-green-50 cursor-pointer transition-colors">
                        <input type="checkbox" checked={selectedRouteIds.has(route.id)} onChange={(e) => {
                          const newSelection = new Set(selectedRouteIds);
                          if (e.target.checked) newSelection.add(route.id); else newSelection.delete(route.id);
                          setSelectedRouteIds(newSelection);
                        }} className="w-4 h-4 text-green-600 rounded border-gray-300 focus:ring-green-500" />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-800 text-sm truncate">{route.name}</div>
                          <div className="text-xs text-gray-500 font-medium">{route.division} • Crew {route.crewNumber} • {route.targetDay}</div>
                        </div>
                        <div className="font-mono text-sm font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 flex-shrink-0">
                          {route.bh} BH
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        <div className="p-4 border-t border-gray-200 bg-white flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 font-medium text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
          <button onClick={onConfirm} disabled={selectedRouteIds.size === 0} className="px-6 py-2 font-bold text-white bg-green-600 hover:bg-green-700 rounded shadow disabled:opacity-50 disabled:cursor-not-allowed">
            Add {selectedRouteIds.size} Routes
          </button>
        </div>
      </div>
    </div>
  );
}

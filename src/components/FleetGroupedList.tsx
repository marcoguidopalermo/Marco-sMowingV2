import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { FleetItem, EquipmentSubtypeDefinition, MechanicTask } from '../types';
import { groupFleet, getUnitAttention, openRepairUnitIds, UnitAttention } from '../lib/fleetGrouping';

// Shared status icons for a unit — alert (past due, red), warning
// (coming due / open repair, amber), and a distinct missing-info icon
// (slate/blue), shown alongside any severity icon. Pure presentation.
export function UnitStatusIcons({ att }: { att: UnitAttention }) {
  if (att.level === 'none' && !att.missingInfo) return null;
  const reasons: string[] = [];
  if (att.pastDue) reasons.push('Maintenance past due');
  if (att.comingDue) reasons.push('Maintenance coming due');
  if (att.openRepair) reasons.push('Open repair');
  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      {att.level === 'alert' && (
        <AlertCircle className="w-4 h-4 text-rose-600" aria-label="Past due" />
      )}
      {att.level === 'warning' && (
        <AlertTriangle className="w-4 h-4 text-amber-500" aria-label="Coming due / open repair" />
      )}
      {att.missingInfo && (
        <Info className="w-4 h-4 text-sky-500" aria-label="Missing info" />
      )}
      {/* Accessible tooltip text combining all reasons. */}
      <span className="sr-only">{[...reasons, ...att.missing].join('; ')}</span>
    </span>
  );
}

interface FleetGroupedListProps {
  fleet: FleetItem[];
  subtypes: EquipmentSubtypeDefinition[];
  // Optional — used to flag units with an open repair (warning level).
  mechanicTasks?: MechanicTask[];
  // Left side of the collapsed row: the unit label + chips. Each list
  // supplies its own (the status icons are appended by the shell).
  renderSummary: (unit: FleetItem, att: UnitAttention) => ReactNode;
  // Expanded body: each list supplies its own (read-only cells vs edit
  // forms). Rendered only when the row is expanded.
  renderDetails: (unit: FleetItem) => ReactNode;
  // Optional row to highlight + auto-expand (e.g. from a summary-banner
  // "jump to unit" link). Matches FleetItem.id.
  highlightId?: string | null;
  // Prefix for the row DOM id so callers can scroll to a unit.
  rowIdPrefix?: string;
  // Show a small "(n)" count next to group/subgroup headers.
  showCounts?: boolean;
  // Optional empty message when the whole fleet is empty.
  emptyMessage?: string;
}

export default function FleetGroupedList({
  fleet,
  subtypes,
  mechanicTasks,
  renderSummary,
  renderDetails,
  highlightId,
  rowIdPrefix = 'fleet-row',
  showCounts = true,
  emptyMessage = 'No units.',
}: FleetGroupedListProps) {
  const groups = groupFleet(fleet, subtypes);
  const openRepairs = openRepairUnitIds(mechanicTasks);

  // Groups + subgroups default to OPEN (all vehicle rows visible). Rows
  // default to COLLAPSED. Undefined in the map means "use the default".
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});

  const groupOpen = (key: string) => !closedGroups[key];
  const toggleGroup = (key: string) => setClosedGroups(s => ({ ...s, [key]: !s[key] }));
  const rowOpen = (id: string) => !!openRows[id] || id === highlightId;
  const toggleRow = (id: string) => setOpenRows(s => ({ ...s, [id]: !s[id] }));

  const renderRow = (unit: FleetItem) => {
    const att = getUnitAttention(unit, { hasOpenRepair: openRepairs.has(unit.id) });
    const expanded = rowOpen(unit.id);
    const highlighted = unit.id === highlightId;
    return (
      <div
        key={unit.id}
        id={`${rowIdPrefix}-${unit.id}`}
        className={`bg-white border border-gray-200 rounded-lg overflow-hidden ${highlighted ? 'ring-2 ring-yellow-300' : ''} ${unit.isWinterized ? 'opacity-60' : ''}`}
      >
        <button
          type="button"
          onClick={() => toggleRow(unit.id)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
        >
          <span className="flex-1 min-w-0">{renderSummary(unit, att)}</span>
          <UnitStatusIcons att={att} />
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
        </button>
        {expanded && (
          <div className="border-t border-gray-100 p-3 bg-gray-50/50">
            {renderDetails(unit)}
          </div>
        )}
      </div>
    );
  };

  if (fleet.length === 0) {
    return <div className="text-center text-slate-400 italic py-10">{emptyMessage}</div>;
  }

  return (
    <div className="space-y-3">
      {groups.map(group => {
        const isOpen = groupOpen(group.key);
        return (
          <div key={group.key} className="rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm">
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              className="w-full px-4 py-3 flex items-center justify-between bg-slate-50 hover:bg-slate-100 transition-colors"
            >
              <span className="font-black uppercase tracking-widest text-xs text-slate-700">
                {group.label}{showCounts ? ` (${group.units.length})` : ''}
              </span>
              {isOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
            </button>
            {isOpen && (
              <div className="p-3 space-y-2">
                {group.subgroups ? (
                  // Equipment: render every subtype sub-header, then its rows.
                  group.subgroups.length === 0 ? (
                    <div className="text-xs italic text-slate-400">No equipment.</div>
                  ) : (
                    group.subgroups.map(sub => {
                      const subKey = `${group.key}:${sub.key}`;
                      const subOpen = groupOpen(subKey);
                      return (
                        <div key={sub.key} className="rounded-lg border border-slate-100">
                          <button
                            type="button"
                            onClick={() => toggleGroup(subKey)}
                            className="w-full px-3 py-1.5 flex items-center justify-between bg-white hover:bg-slate-50 transition-colors"
                          >
                            <span className="font-bold uppercase tracking-wider text-[10px] text-slate-500">
                              {sub.label}{showCounts ? ` (${sub.units.length})` : ''}
                            </span>
                            {subOpen ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                          </button>
                          {subOpen && (
                            <div className="p-2 space-y-2">
                              {sub.units.length === 0 ? (
                                <div className="text-[11px] italic text-slate-300 px-1">None</div>
                              ) : (
                                sub.units.map(renderRow)
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )
                ) : group.units.length === 0 ? (
                  <div className="text-xs italic text-slate-400">None.</div>
                ) : (
                  group.units.map(renderRow)
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

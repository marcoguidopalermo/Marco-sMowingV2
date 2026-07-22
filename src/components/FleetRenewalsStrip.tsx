import { AlertTriangle } from 'lucide-react';
import type { FleetItem } from '../types';
import { fleetItemLabel } from '../lib/fleetUtils';
import { fleetDocRenewals, unitDocChip, expiryCountdownLabel } from '../lib/fleetDocuments';

// "Renewals needing attention" — the lease-strip pattern, reused for fleet
// documents. One row per affected DOCUMENT, soonest-first, AMBER ≤30 days /
// RED expired (the 30-day window from docExpiryState — the same source the
// push scan reads). Tapping a row jumps to that unit's documents via onJump.
// Empty state: a quiet "All renewals current ✓".
export default function FleetRenewalsStrip({ fleet, onJump }: { fleet: FleetItem[]; onJump: (unitId: string) => void }) {
  const rows = fleetDocRenewals(fleet);

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-emerald-200 p-3 mb-3">
        <div className="text-xs font-bold text-emerald-600 flex items-center gap-1.5">
          <span className="text-emerald-500">✓</span> All renewals current
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-amber-200 p-3 mb-3">
      <div className="text-xs font-black uppercase tracking-widest mb-1.5 flex items-center gap-1.5 text-amber-700">
        <AlertTriangle className="w-3.5 h-3.5" /> Renewals needing attention ({rows.length})
      </div>
      <div className="space-y-1">
        {rows.map(r => {
          const red = r.state === 'expired';
          return (
            <button
              key={`${r.unit.id}-${r.key}`}
              type="button"
              onClick={() => onJump(r.unit.id)}
              className={`w-full flex items-center justify-between gap-2 text-sm text-left rounded px-1.5 py-1 hover:bg-slate-50 transition-colors ${red ? 'text-red-700' : 'text-amber-800'}`}
              title="Open this unit's documents"
            >
              <span className="truncate min-w-0">
                <span className="font-bold">{fleetItemLabel(r.unit)}</span>
                <span className="text-slate-400"> · {r.typeLabel}</span>
              </span>
              <span className={`shrink-0 text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${red ? 'bg-red-100 text-red-700 border-red-300' : 'bg-amber-100 text-amber-700 border-amber-300'}`}>
                {expiryCountdownLabel(r.expiryDate)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Shared list-level status chip — worst affected doc + "+N more". Rendered on
// a fleet card's summary row so the state is visible without opening the unit.
// Units with all docs current render nothing.
export function DocRenewalChip({ unit }: { unit: FleetItem }) {
  const chip = unitDocChip(unit);
  if (!chip) return null;
  const red = chip.tone === 'red';
  return (
    <span
      className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${red ? 'bg-red-100 text-red-700 border-red-300' : 'bg-amber-100 text-amber-700 border-amber-300'}`}
      title={red ? 'Document expired' : 'Document expiring soon'}
    >
      <span aria-hidden>{red ? '🔴' : '🟠'}</span>{chip.label}
    </span>
  );
}

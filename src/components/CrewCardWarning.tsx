import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { OverrideRecord } from '../types';

interface CrewCardWarningProps {
  message: string;
  isOverridden: boolean;
  canOverride: boolean;
  overrideRecord?: OverrideRecord;
  onOverride: () => void;
}

export default function CrewCardWarning({ message, isOverridden, canOverride, overrideRecord, onOverride }: CrewCardWarningProps) {
  if (isOverridden) {
    return (
      <div className="bg-amber-50 border-b border-amber-100 px-3 py-1.5 flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-amber-900 font-semibold line-through opacity-70">{message}</div>
          {overrideRecord && (
            <div className="text-[10px] font-bold text-amber-700 mt-0.5">
              Overridden by {overrideRecord.overriddenByName}
              {overrideRecord.reason ? ` · "${overrideRecord.reason}"` : ''}
            </div>
          )}
        </div>
        <span className="text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded">Override</span>
      </div>
    );
  }

  return (
    <div className="bg-rose-50 border-b border-rose-100 px-3 py-1.5 flex items-start gap-2">
      <AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0 text-xs text-rose-800 font-semibold leading-relaxed">{message}</div>
      {canOverride && (
        <button
          onClick={onOverride}
          className="text-[10px] font-black uppercase tracking-widest bg-white border border-rose-300 text-rose-700 hover:bg-rose-100 px-2 py-1 rounded shrink-0"
        >
          Override
        </button>
      )}
    </div>
  );
}

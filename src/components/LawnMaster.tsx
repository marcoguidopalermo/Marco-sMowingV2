// LawnMaster — placeholder module inside the SalesMaster container. Built next;
// no pricing logic and no placeholder numbers yet, just an empty state.
import { Sprout } from 'lucide-react';

export default function LawnMaster() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center">
      <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto">
        <Sprout className="w-7 h-7 text-emerald-600" />
      </div>
      <div className="text-lg font-black text-slate-800 mt-3">LawnMaster</div>
      <div className="text-sm font-bold text-slate-400 mt-1">Coming soon</div>
    </div>
  );
}

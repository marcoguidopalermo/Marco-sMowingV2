// SalesMaster — the container. Keeps its name in the sidebar and hosts three
// divisional modules: ProjectMaster (the original quoting workbench),
// SnowMaster (driveway snow quoting), and LawnMaster (placeholder, built next).
// This is a UI grouping only — Firestore collections/keys are unchanged
// (salesMasterQuotes, snowQuotes). It just distributes the same props it always
// received to the right module.
import { useState } from 'react';
import { Calculator, Snowflake, Sprout } from 'lucide-react';
import { SalesRates, SalesQuote, SnowQuote } from '../types';
import ProjectMaster from './ProjectMaster';
import SnowMaster from './SnowMaster';
import LawnMaster from './LawnMaster';

interface Props {
  rates: SalesRates;
  quotes: Record<string, SalesQuote>;
  isAdmin: boolean;
  currentUser: { email: string; name: string };
  onSaveRates: (r: SalesRates) => void;
  onSaveQuote: (q: SalesQuote) => void;
  onDeleteQuote: (id: string) => void;
  snowQuotes: Record<string, SnowQuote>;
  onSaveSnowQuote: (q: SnowQuote) => void;
  onDeleteSnowQuote: (id: string) => void;
}

type ModuleKey = 'project' | 'snow' | 'lawn';
const MODULES: { key: ModuleKey; label: string; Icon: typeof Calculator }[] = [
  { key: 'project', label: 'ProjectMaster', Icon: Calculator },
  { key: 'snow', label: 'SnowMaster', Icon: Snowflake },
  { key: 'lawn', label: 'LawnMaster', Icon: Sprout },
];

export default function SalesMaster(props: Props) {
  const {
    rates, quotes, isAdmin, currentUser, onSaveRates, onSaveQuote, onDeleteQuote,
    snowQuotes, onSaveSnowQuote, onDeleteSnowQuote,
  } = props;
  const [module, setModule] = useState<ModuleKey>('project');

  return (
    <div className="flex-1 overflow-y-auto bg-gray-100 p-4 md:p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><Calculator className="w-6 h-6 text-slate-700" /> SalesMaster</h2>
          <div className="flex flex-wrap bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
            {MODULES.map(({ key, label, Icon }) => (
              <button key={key} onClick={() => setModule(key)}
                className={`px-3 py-1.5 text-sm font-bold rounded-md inline-flex items-center gap-1.5 ${module === key ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500'}`}>
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>
        </div>

        {module === 'project' && (
          <ProjectMaster
            rates={rates}
            quotes={quotes}
            isAdmin={isAdmin}
            currentUser={currentUser}
            onSaveRates={onSaveRates}
            onSaveQuote={onSaveQuote}
            onDeleteQuote={onDeleteQuote}
          />
        )}

        {module === 'snow' && (
          <SnowMaster
            quotes={snowQuotes}
            currentUser={currentUser}
            isAdmin={isAdmin}
            onSave={onSaveSnowQuote}
            onDelete={onDeleteSnowQuote}
          />
        )}

        {module === 'lawn' && <LawnMaster />}
      </div>
    </div>
  );
}

// SalesMaster — the container. Keeps its name in the sidebar and hosts three
// divisional modules: ProjectMaster (the original quoting workbench),
// SnowMaster (driveway snow quoting), and LawnMaster (placeholder, built next).
// This is a UI grouping only — Firestore collections/keys are unchanged
// (salesMasterQuotes, snowQuotes). It just distributes the same props it always
// received to the right module.
import { useState } from 'react';
import { Calculator, Snowflake, Sprout, CalendarRange } from 'lucide-react';
import { SalesRates, SalesQuote, SnowQuote, SnowRateConfigVersion, LawnQuote, LawnRateConfigVersion, AppData, CapacityForecast, CapacityScope, CapacitySettings, Employee, JobberUser } from '../types';
import { SnowConfig } from '../lib/snowPricing';
import { LawnConfig } from '../lib/lawnPricing';
import ProjectMaster from './ProjectMaster';
import SnowMaster from './SnowMaster';
import LawnMaster from './LawnMaster';
import CapacityCalendar from './CapacityCalendar';

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
  // Snow rate config (super-admin editable, versioned).
  isSuperAdmin: boolean;
  snowConfigs: Record<string, SnowRateConfigVersion>;
  snowActiveVersion: string;
  snowActiveConfig: SnowConfig;
  onSaveSnowConfig: (next: SnowConfig) => Promise<boolean>;
  onRevertSnowConfig: (versionId: string) => Promise<boolean>;
  lawnQuotes: Record<string, LawnQuote>;
  onSaveLawnQuote: (q: LawnQuote) => void;
  onDeleteLawnQuote: (id: string) => void;
  lawnConfigs: Record<string, LawnRateConfigVersion>;
  lawnActiveVersion: string;
  lawnActiveConfig: LawnConfig;
  onSaveLawnConfig: (next: LawnConfig) => Promise<boolean>;
  onRevertLawnConfig: (versionId: string) => Promise<boolean>;
  // Capacity calendar — the SAME component the schedule board's CAPACITY
  // toggle mounts. Read-only forward view; no second implementation.
  appData: AppData;
  capacityForecasts: Record<CapacityScope, CapacityForecast | null>;
  currentUserEmployee: Employee | null;
  onRefreshCapacity: (scope: CapacityScope) => Promise<void>;
  canRefreshCapacity: boolean;
  onSaveCapacitySettings: (next: CapacitySettings) => Promise<void>;
  jobberUsers: JobberUser[];
}

type ModuleKey = 'project' | 'snow' | 'lawn' | 'capacity';
const MODULES: { key: ModuleKey; label: string; Icon: typeof Calculator }[] = [
  { key: 'project', label: 'ProjectMaster', Icon: Calculator },
  { key: 'snow', label: 'SnowMaster', Icon: Snowflake },
  { key: 'lawn', label: 'LawnMaster', Icon: Sprout },
  { key: 'capacity', label: 'Capacity', Icon: CalendarRange },
];

export default function SalesMaster(props: Props) {
  const {
    rates, quotes, isAdmin, currentUser, onSaveRates, onSaveQuote, onDeleteQuote,
    snowQuotes, onSaveSnowQuote, onDeleteSnowQuote,
    isSuperAdmin, snowConfigs, snowActiveVersion, snowActiveConfig, onSaveSnowConfig, onRevertSnowConfig,
    lawnQuotes, onSaveLawnQuote, onDeleteLawnQuote,
    lawnConfigs, lawnActiveVersion, lawnActiveConfig, onSaveLawnConfig, onRevertLawnConfig,
    appData, capacityForecasts, currentUserEmployee, onRefreshCapacity, canRefreshCapacity, onSaveCapacitySettings, jobberUsers,
  } = props;
  const [module, setModule] = useState<ModuleKey>('project');

  return (
    <div className="flex-1 overflow-y-auto bg-gray-100 p-4 md:p-6">
      {/* The capacity calendar is a wide grid — it gets the full width the
          quoting modules don't need. */}
      <div className={`${module === 'capacity' ? 'max-w-6xl' : 'max-w-3xl'} mx-auto space-y-4`}>
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
            isSuperAdmin={isSuperAdmin}
            config={snowActiveConfig}
            activeVersion={snowActiveVersion}
            configs={snowConfigs}
            onSaveConfig={onSaveSnowConfig}
            onRevertConfig={onRevertSnowConfig}
          />
        )}

        {module === 'lawn' && (
          <LawnMaster
            quotes={lawnQuotes}
            currentUser={currentUser}
            isAdmin={isAdmin}
            onSave={onSaveLawnQuote}
            onDelete={onDeleteLawnQuote}
            isSuperAdmin={isSuperAdmin}
            config={lawnActiveConfig}
            activeVersion={lawnActiveVersion}
            configs={lawnConfigs}
            onSaveConfig={onSaveLawnConfig}
            onRevertConfig={onRevertLawnConfig}
          />
        )}

        {module === 'capacity' && (
          <CapacityCalendar
            appData={appData}
            forecasts={capacityForecasts}
            isAdmin={isAdmin}
            currentUserEmployee={currentUserEmployee}
            onRefresh={onRefreshCapacity}
            canRefresh={canRefreshCapacity}
            onSaveSettings={onSaveCapacitySettings}
            jobberUsers={jobberUsers}
            defaultTool="booking"
          />
        )}
      </div>
    </div>
  );
}

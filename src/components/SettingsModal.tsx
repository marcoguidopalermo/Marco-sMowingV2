import { X, Users, Truck, Package, Hammer, Sliders, ShieldCheck, Link as LinkIcon, HelpCircle, LogOut, ChevronRight, UserCircle, Mail, Eraser } from 'lucide-react';
import { UserRole } from '../types';
import { can } from '../lib/permissions';

export type ManageTab = 'employees' | 'fleet' | 'inventory' | 'supplies' | 'routes' | 'permissions' | 'settings' | 'authorized' | 'equipmentSubtypes';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserEmail: string;
  effectiveRole: UserRole;
  onOpenManageTab: (tab: ManageTab) => void;
  onSignOut: () => void;
  // Super-admin maintenance: remove duplicate repair-log entries created by
  // double-submits. Optional so non-super-admin callers can omit it.
  isSuperAdmin?: boolean;
  onCleanupDuplicateRepairs?: () => void;
}

interface Row {
  key: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  visible: boolean;
}

interface Section {
  title: string;
  rows: Row[];
}

export default function SettingsModal({
  isOpen, onClose, currentUserEmail, effectiveRole, onOpenManageTab, onSignOut,
  isSuperAdmin = false, onCleanupDuplicateRepairs,
}: SettingsModalProps) {
  if (!isOpen) return null;

  const canViewResources = can('canViewManageResources', effectiveRole);
  const canEditSettings = can('canEditAppSettings', effectiveRole);
  const canManageJobber = can('canManageJobberIntegration', effectiveRole);
  const isAdmin = effectiveRole === 'admin';

  // Manager can see App Settings (read-only); admin can edit. Foreman/worker/mechanic don't see it.
  const canSeeAppSettings = isAdmin || canEditSettings || effectiveRole === 'manager';

  const sections: Section[] = [
    {
      title: 'Resources',
      rows: [
        { key: 'personnel', label: 'Manage Personnel', Icon: Users, onClick: () => onOpenManageTab('employees'), visible: canViewResources },
        { key: 'fleet', label: 'Manage Fleet & Equipment', Icon: Truck, onClick: () => onOpenManageTab('fleet'), visible: canViewResources },
        { key: 'inventory', label: 'Manage Inventory', Icon: Package, onClick: () => onOpenManageTab('inventory'), visible: canViewResources },
        { key: 'supplies', label: 'Manage Supplies', Icon: Hammer, onClick: () => onOpenManageTab('supplies'), visible: canViewResources },
        // Routes Database row removed — superseded by Jobber integration.
        // (ManageTab type still includes 'routes' for backward compat.)
      ],
    },
    {
      title: 'System',
      rows: [
        { key: 'settings', label: 'App Settings', Icon: Sliders, onClick: () => onOpenManageTab('settings'), visible: canSeeAppSettings },
        { key: 'permissions', label: 'Role Permissions', Icon: ShieldCheck, onClick: () => onOpenManageTab('permissions'), visible: isAdmin },
        { key: 'authorized', label: 'Authorized Emails', Icon: Mail, onClick: () => onOpenManageTab('authorized'), visible: isAdmin },
        { key: 'jobber', label: 'Jobber Integration', Icon: LinkIcon, onClick: () => onOpenManageTab('settings'), visible: canManageJobber },
      ],
    },
    {
      title: 'Maintenance',
      rows: [
        { key: 'dedupeRepairs', label: 'Clean Up Duplicate Repairs', Icon: Eraser, onClick: () => onCleanupDuplicateRepairs?.(), visible: isSuperAdmin && !!onCleanupDuplicateRepairs },
      ],
    },
    {
      title: 'Support',
      rows: [
        { key: 'help', label: 'Help / Documentation', Icon: HelpCircle, onClick: () => { /* placeholder */ }, visible: true },
      ],
    },
  ].map(s => ({ ...s, rows: s.rows.filter(r => r.visible) })).filter(s => s.rows.length > 0);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex md:items-center md:justify-center md:p-4">
      <div className="bg-white md:rounded-xl shadow-2xl w-full md:max-w-md h-full md:h-auto md:max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Sliders className="w-5 h-5 text-slate-500" /> Settings
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {sections.map(section => (
            <div key={section.title} className="border-b border-slate-100 last:border-b-0">
              <div className="px-5 pt-4 pb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                {section.title}
              </div>
              <ul>
                {section.rows.map(row => (
                  <li key={row.key}>
                    <button
                      type="button"
                      onClick={row.onClick}
                      className="w-full min-h-[48px] flex items-center gap-3 px-5 py-3 text-left hover:bg-slate-50 transition-colors"
                    >
                      <row.Icon className="w-5 h-5 text-slate-500 shrink-0" />
                      <span className="flex-1 text-sm font-bold text-slate-800">{row.label}</span>
                      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="border-t border-slate-200">
            <div className="px-5 pt-4 pb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              Account
            </div>
            <div className="px-5 pb-3 flex items-center gap-3">
              <div className="bg-lime-100 p-1.5 rounded-full shrink-0">
                <UserCircle className="w-5 h-5 text-lime-700" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 leading-none">{effectiveRole}</div>
                <div className="text-xs font-medium text-slate-700 truncate leading-tight">{currentUserEmail}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 shrink-0">
          <button
            onClick={onSignOut}
            className="w-full min-h-[44px] flex items-center justify-center gap-2 text-sm font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-4 py-2.5 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

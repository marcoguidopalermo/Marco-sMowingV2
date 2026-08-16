// SNOWMASTER · CONTRACTS — the module tab.
//
// Owns the list/record switch. No router: the app navigates by state
// everywhere else, and adding routing for one feature would be a larger
// architectural change than the feature justifies.
//
// UNMOUNTED — SnowContractEditor (the two-pane in-app builder) and
// SnowContractDocument (the renderer that backed its preview and the print
// window) are still in the repo but are no longer reachable: nothing imports
// them, there is no route to them and no button opens them. Contracts are
// written in the standalone HTML builder at /snow-contract-builder, printed to
// PDF and attached to the record. The files are kept deliberately in case that
// decision is revisited — along with lib/snowContractText, whose transcription
// guard still verifies the clause constants against the reference HTML that is
// now the live document.
import { useState } from 'react';
import type { SnowContract, SnowContractDocLabel, StoredFile } from '../types';
import SnowContractList from './SnowContractList';
import SnowContractSimple, { applyFields, type SnowContractFields } from './SnowContractSimple';
import SnowContractNewModal from './SnowContractNewModal';

interface Props {
  contracts: Record<string, SnowContract>;
  onSave: (c: SnowContract) => Promise<void>;
  onCreate: () => Promise<string | null>;
  onUploadDocument: (contractId: string, file: File, onProgress: (pct: number) => void) => Promise<StoredFile | null>;
  onDeleteDocument: (path: string) => Promise<void>;
  onDeleteContract: (id: string) => Promise<boolean>;
  onArchiveContract: (id: string, archived: boolean) => Promise<void>;
  canDelete: boolean;
  canEdit: boolean;
  currentUser: { email: string; name: string };
  today: string;
}

export default function SnowContractsModule({
  contracts, onSave, onCreate,
  onUploadDocument, onDeleteDocument, onDeleteContract, onArchiveContract,
  canDelete, canEdit, currentUser, today,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const open = openId ? contracts[openId] : null;

  const save = async (next: SnowContract) => {
    setSaving('saving');
    await onSave(next);
    setSaving('saved');
    window.setTimeout(() => setSaving(s => (s === 'saved' ? 'idle' : s)), 1600);
  };

  // Create → apply the five fields → optionally attach the PDF, all before the
  // modal closes, so a contract never appears in the list half-made.
  const create = async (
    fields: SnowContractFields,
    picked: { file: File; label: SnowContractDocLabel } | null,
    onProgress: (pct: number) => void,
  ): Promise<string | null> => {
    const id = await onCreate();
    if (!id) return null;
    // The snapshot may not have delivered the new record yet. applyFields only
    // needs something contract-shaped to spread over and the listener
    // reconciles after; falling back beats dropping the typed fields.
    const seed = contracts[id] || ({ id, client: {}, serviceTerms: {} } as unknown as SnowContract);
    let next = applyFields(seed, fields, currentUser.name);
    if (picked) {
      const stored = await onUploadDocument(id, picked.file, onProgress);
      if (stored) {
        next = {
          ...next,
          documents: [
            ...(next.documents || []),
            { id: `scd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, label: picked.label, file: stored },
          ],
        };
      }
    }
    await onSave(next);
    return id;
  };

  if (open) {
    return (
      <SnowContractSimple
        contract={open}
        onChange={save}
        onBack={() => setOpenId(null)}
        onUploadDocument={(f, p) => onUploadDocument(open.id, f, p)}
        onDeleteDocument={onDeleteDocument}
        onDeleteContract={async () => { const ok = await onDeleteContract(open.id); if (ok) setOpenId(null); }}
        onArchiveContract={(a) => onArchiveContract(open.id, a)}
        canDelete={canDelete}
        canEdit={canEdit}
        saving={saving}
        currentUser={currentUser}
      />
    );
  }

  return (
    <>
      <SnowContractList
        contracts={contracts}
        onOpen={setOpenId}
        onNew={() => setCreating(true)}
        onRename={async (id, businessName) => {
          const c = contracts[id];
          if (!c) return;
          await onSave({ ...c, client: { ...c.client, businessName }, updatedAt: Date.now() });
        }}
        onDelete={onDeleteContract}
        onArchive={onArchiveContract}
        canDelete={canDelete}
        canEdit={canEdit}
        today={today}
      />
      {creating && (
        <SnowContractNewModal onClose={() => setCreating(false)} onCreate={create} />
      )}
    </>
  );
}

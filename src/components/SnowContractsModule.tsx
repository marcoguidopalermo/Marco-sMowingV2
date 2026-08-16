// SNOWMASTER · CONTRACTS — the module tab.
//
// Owns the list/editor switch. No router: the app navigates by state
// everywhere else, and adding routing for one feature would be a larger
// architectural change than the feature justifies.
//
// PRINT opens a new window rendering the SAME SnowContractDocument in print
// mode — not a second layout, the same component.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SnowContract, StoredFile } from '../types';
import SnowContractList from './SnowContractList';
import SnowContractEditor from './SnowContractEditor';
import SnowContractDocument from './SnowContractDocument';

interface Props {
  contracts: Record<string, SnowContract>;
  onSave: (c: SnowContract) => Promise<void>;
  onCreate: () => Promise<string | null>;
  onDuplicate: (id: string) => Promise<string | null>;
  onUploadMap: (contractId: string, file: File) => Promise<string | null>;
  onUploadDocument: (contractId: string, file: File, onProgress: (pct: number) => void) => Promise<StoredFile | null>;
  onDeleteDocument: (path: string) => Promise<void>;
  canEdit: boolean;
  currentUser: { email: string; name: string };
  today: string;
}

// Renders the document into a fresh window and prints it. Styles ride along in
// the component's own <style> block, so the popup needs no stylesheet link.
export function printContract(c: SnowContract) {
  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) { alert('Allow pop-ups to print the contract.'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8">` +
    `<title>${(c.client.businessName || 'Contract').replace(/[<>]/g, '')} — Snow Agreement</title>` +
    `<style>body{margin:0;background:#fff}</style></head><body><div id="root"></div></body></html>`);
  w.document.close();
  const mount = w.document.getElementById('root')!;
  createRoot(mount).render(<SnowContractDocument contract={c} mode="print" />);
  // Give the map image and the measured-fit pass a beat before printing.
  w.setTimeout(() => { w.focus(); w.print(); }, 900);
}

export default function SnowContractsModule({
  contracts, onSave, onCreate, onDuplicate, onUploadMap,
  onUploadDocument, onDeleteDocument, canEdit, currentUser, today,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const open = openId ? contracts[openId] : null;

  const save = async (next: SnowContract) => {
    setSaving('saving');
    await onSave(next);
    setSaving('saved');
    window.setTimeout(() => setSaving(s => (s === 'saved' ? 'idle' : s)), 1600);
  };

  if (open) {
    return (
      <SnowContractEditor
        contract={open}
        onChange={save}
        onBack={() => setOpenId(null)}
        onPrint={() => printContract(open)}
        onDuplicate={async () => { const id = await onDuplicate(open.id); if (id) setOpenId(id); }}
        onUploadMap={(f) => onUploadMap(open.id, f)}
        onUploadDocument={(f, p) => onUploadDocument(open.id, f, p)}
        onDeleteDocument={onDeleteDocument}
        canEdit={canEdit}
        saving={saving}
        currentUser={currentUser}
      />
    );
  }

  return (
    <SnowContractList
      contracts={contracts}
      onOpen={setOpenId}
      onNew={async () => { const id = await onCreate(); if (id) setOpenId(id); }}
      canEdit={canEdit}
      today={today}
    />
  );
}

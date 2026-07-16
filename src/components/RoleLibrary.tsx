import { useMemo, useRef, useState } from 'react';
import { Search, Plus, Pencil, Trash2, Copy, Check, X, FileText, ExternalLink, Loader2, ClipboardList, FileUp, ArchiveRestore, MessageSquarePlus, CheckCircle2 } from 'lucide-react';
import { RoleMasterTemplate, RoleMasterPolicy, RoleMasterPolicyRequest, StoredFile } from '../types';
import { categoryColor } from '../lib/roleCategories';
import { uploadFile, deleteFile } from '../lib/storage';
import PhotoViewer from './PhotoViewer';

// Shared 3-tier clipboard copy — one implementation, used by the list-row
// quick-copy and the full-view Copy button. Returns true if the text was
// copied; false means both programmatic paths were blocked and the caller
// should fall back to a manual select-all UI.
async function copyToClipboard(text: string): Promise<boolean> {
  // 1) modern async clipboard
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  // 2) execCommand fallback via a temp textarea
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand('copy'); document.body.removeChild(ta);
    if (ok) return true;
  } catch { /* fall through */ }
  return false;
}

interface Props {
  templates: Record<string, RoleMasterTemplate>;
  policies: Record<string, RoleMasterPolicy>;
  policyRequests: Record<string, RoleMasterPolicyRequest>;
  isAdmin: boolean;
  isManager: boolean;                 // admin OR manager — can edit templates + request changes
  currentUser: { id: string; name: string };
  uploadedBy: { email: string; name: string };
  categoryColors: Record<string, string>;
  onSaveTemplate: (t: RoleMasterTemplate) => void;
  onDeleteTemplate: (id: string) => void;
  onSavePolicy: (p: RoleMasterPolicy) => void;
  onDeletePolicy: (id: string) => void;
  onSavePolicyRequest: (id: string, policyId: string, text: string) => void;
  onResolvePolicyRequest: (id: string, note: string) => void;
}

const uid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const fmtWhen = (ms?: number) => ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const Badge = ({ n }: { n: number }) => n > 0 ? <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-black">{n}</span> : null;

// "Updated Jul 15, 2026 · Marco" from the latest save stamp. Null when there's
// no updatedAt (no createdAt field exists to fall back to → omit the line).
function updatedLine(r: { updatedAt?: number; updatedBy?: { name: string } }): string | null {
  if (!r.updatedAt) return null;
  const date = new Date(r.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `Updated ${date}${r.updatedBy?.name ? ` · ${r.updatedBy.name}` : ''}`;
}

export default function RoleLibrary({
  templates, policies, policyRequests, isAdmin, isManager, currentUser, uploadedBy, categoryColors,
  onSaveTemplate, onDeleteTemplate, onSavePolicy, onDeletePolicy, onSavePolicyRequest, onResolvePolicyRequest,
}: Props) {
  const [section, setSection] = useState<'templates' | 'policies'>('templates');
  const [detailPolicyId, setDetailPolicyId] = useState<string | null>(null);
  const canEditTemplates = isManager;   // admin OR manager

  // Open-request counts: per policy + total. Visible to admins + managers.
  const openReqByPolicy = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of Object.values(policyRequests)) if (r.status === 'open') m[r.policyId] = (m[r.policyId] || 0) + 1;
    return m;
  }, [policyRequests]);
  const totalOpenReq = useMemo(() => Object.values(openReqByPolicy).reduce((s, n) => s + n, 0), [openReqByPolicy]);
  const canManagePolicies = isAdmin;

  const [tQuery, setTQuery] = useState('');
  const [tCat, setTCat] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [viewTemplate, setViewTemplate] = useState<RoleMasterTemplate | null>(null);
  const [editTemplate, setEditTemplate] = useState<RoleMasterTemplate | null>(null);
  const [editPolicy, setEditPolicy] = useState<RoleMasterPolicy | null>(null);
  const [viewer, setViewer] = useState<{ files: StoredFile[]; idx: number } | null>(null);

  // Active templates always; archived (active:false) only when a manager/admin
  // flips "Show archived". active:false is the archived state (model unchanged).
  const tList = useMemo(
    () => Object.values(templates).filter(t => t.active || (canEditTemplates && showArchived)).sort((a, b) => a.title.localeCompare(b.title)),
    [templates, canEditTemplates, showArchived],
  );

  // One-tap copy from a list row: shared helper → brief ✓ ack on the icon; on
  // failure, open the full view so the user gets the manual select-all copy.
  const copyRow = async (t: RoleMasterTemplate) => {
    const ok = await copyToClipboard(t.body);
    if (ok) { setCopiedId(t.id); setTimeout(() => setCopiedId(c => (c === t.id ? null : c)), 1500); }
    else { setViewTemplate(t); }
  };
  const tCats = useMemo(() => [...new Set(Object.values(templates).map(t => t.category).filter(Boolean))].sort(), [templates]);
  const tFiltered = tList.filter(t => {
    if (tCat && t.category !== tCat) return false;
    const q = tQuery.trim().toLowerCase();
    if (q && !`${t.title} ${t.body} ${t.notes || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const pList = useMemo(() => Object.values(policies).filter(p => p.active || isAdmin).sort((a, b) => a.title.localeCompare(b.title)), [policies, isAdmin]);

  return (
    <div className="space-y-3">
      <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm w-fit">
        <button onClick={() => setSection('templates')} className={`px-3 py-1.5 text-sm font-bold rounded-md ${section === 'templates' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500'}`}>Templates</button>
        <button onClick={() => setSection('policies')} className={`px-3 py-1.5 text-sm font-bold rounded-md inline-flex items-center gap-1.5 ${section === 'policies' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500'}`}>Policies &amp; Documents {isManager && <Badge n={totalOpenReq} />}</button>
      </div>

      {section === 'templates' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
              <input value={tQuery} onChange={e => setTQuery(e.target.value)} placeholder="Search title or body…" className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm outline-none" />
            </div>
            <select value={tCat} onChange={e => setTCat(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-2 text-sm font-bold bg-white"><option value="">All categories</option>{tCats.map(c => <option key={c} value={c}>{c}</option>)}</select>
            {canEditTemplates && (
              <button onClick={() => setEditTemplate({ id: uid('tpl'), title: '', category: 'Quotes', body: '', notes: '', active: true })} className="inline-flex items-center gap-1.5 text-sm font-black uppercase tracking-widest text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-2 rounded-lg shadow-sm"><Plus className="w-4 h-4" /> Add template</button>
            )}
          </div>
          {canEditTemplates && (
            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-500"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived</label>
          )}
          {tFiltered.length === 0 ? (
            <div className="text-center text-slate-400 py-8">{tList.length === 0 ? 'No templates yet.' : 'No templates match.'}</div>
          ) : (
            <div className="space-y-2">
              {tFiltered.map(t => {
                const cc = categoryColor(t.category, categoryColors);
                return (
                  <div key={t.id} className={`bg-white rounded-xl border shadow-sm p-3 flex items-start justify-between gap-2 ${t.active ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
                    <button onClick={() => setViewTemplate(t)} className="min-w-0 text-left flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-800">{t.title}</span>
                        {t.category && <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${cc.chip}`}>{t.category}</span>}
                        {!t.active && <span className="text-[9px] font-black uppercase bg-slate-200 text-slate-500 px-1 rounded">Archived</span>}
                      </div>
                      <div className="text-[12px] text-slate-500 mt-1 line-clamp-2 whitespace-pre-wrap">{t.body}</div>
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {canEditTemplates && !t.active && (
                        <button onClick={() => onSaveTemplate({ ...t, active: true })} title="Restore from archive" className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-emerald-600"><ArchiveRestore className="w-4 h-4" /></button>
                      )}
                      <button onClick={() => copyRow(t)} title="Copy template body" aria-label="Copy template body" className={`min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg border ${copiedId === t.id ? 'border-emerald-300 bg-emerald-50 text-emerald-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}>
                        {copiedId === t.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {section === 'policies' && (
        <div className="space-y-3">
          {canManagePolicies && (
            <div className="flex justify-end">
              <button onClick={() => setEditPolicy({ id: uid('pol'), title: '', category: '', description: '', active: true })} className="inline-flex items-center gap-1.5 text-sm font-black uppercase tracking-widest text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-2 rounded-lg shadow-sm"><Plus className="w-4 h-4" /> Add policy / doc</button>
            </div>
          )}
          {pList.length === 0 ? (
            <div className="text-center text-slate-400 py-8">No policies or documents yet.</div>
          ) : (
            <div className="space-y-2">
              {pList.map(p => {
                const cc = p.category ? categoryColor(p.category, categoryColors) : null;
                return (
                  <div key={p.id} className={`bg-white rounded-xl border shadow-sm p-3 flex items-center justify-between gap-3 ${p.active ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
                    <button onClick={() => setDetailPolicyId(p.id)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-2 flex-wrap">
                        {p.file ? <FileText className="w-4 h-4 text-slate-400 shrink-0" /> : <ExternalLink className="w-4 h-4 text-slate-400 shrink-0" />}
                        <span className="font-bold text-slate-800 truncate">{p.title}</span>
                        {cc && <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${cc.chip}`}>{p.category}</span>}
                        {!p.active && <span className="text-[9px] font-black uppercase bg-slate-200 text-slate-500 px-1 rounded">Inactive</span>}
                        {isManager && <Badge n={openReqByPolicy[p.id] || 0} />}
                      </div>
                      {p.description && <div className="text-[12px] text-slate-500 mt-0.5">{p.description}</div>}
                      {updatedLine(p) && <div className="text-[10px] text-slate-400 mt-0.5">{updatedLine(p)}</div>}
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      {p.file ? (
                        <button onClick={() => setViewer({ files: [p.file as StoredFile], idx: 0 })} className="text-[11px] font-black uppercase tracking-widest bg-slate-900 text-white px-3 py-1.5 rounded-lg inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> View</button>
                      ) : p.link ? (
                        <a href={p.link} target="_blank" rel="noopener noreferrer" className="text-[11px] font-black uppercase tracking-widest bg-slate-900 text-white px-3 py-1.5 rounded-lg inline-flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> Open</a>
                      ) : null}
                      {canManagePolicies && <button onClick={() => setEditPolicy(p)} className="text-slate-400 hover:text-slate-700"><Pencil className="w-4 h-4" /></button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {viewTemplate && (
        <TemplateViewer
          template={viewTemplate}
          categoryColors={categoryColors}
          canEdit={canEditTemplates}
          canDelete={isAdmin}
          onEdit={() => { setEditTemplate(viewTemplate); setViewTemplate(null); }}
          onDelete={() => { if (confirm(`Delete template "${viewTemplate.title}"?`)) { onDeleteTemplate(viewTemplate.id); setViewTemplate(null); } }}
          onClose={() => setViewTemplate(null)}
        />
      )}
      {editTemplate && <TemplateEditor template={editTemplate} onClose={() => setEditTemplate(null)} onSave={(t) => { onSaveTemplate(t); setEditTemplate(null); }} />}
      {editPolicy && <PolicyEditor policy={editPolicy} uploadedBy={uploadedBy} onClose={() => setEditPolicy(null)} onSave={(p) => { onSavePolicy(p); setEditPolicy(null); }} onDelete={isAdmin ? () => { if (confirm(`Delete "${editPolicy.title}"?`)) { onDeletePolicy(editPolicy.id); setEditPolicy(null); } } : undefined} />}
      {detailPolicyId && policies[detailPolicyId] && (
        <PolicyDetail
          policy={policies[detailPolicyId]}
          requests={Object.values(policyRequests).filter(r => r.policyId === detailPolicyId)}
          categoryColors={categoryColors}
          isAdmin={isAdmin} isManager={isManager} currentUser={currentUser}
          onView={(f) => setViewer({ files: [f], idx: 0 })}
          onSubmitRequest={(text) => onSavePolicyRequest(uid('req'), detailPolicyId, text)}
          onEditRequest={(id, text) => onSavePolicyRequest(id, detailPolicyId, text)}
          onResolve={onResolvePolicyRequest}
          onClose={() => setDetailPolicyId(null)}
        />
      )}
      {viewer && <PhotoViewer files={viewer.files} startIndex={viewer.idx} onClose={() => setViewer(null)} />}
    </div>
  );
}

// ── Template full view + copy ─────────────────────────────────────────────
function TemplateViewer({ template, categoryColors, canEdit, canDelete, onEdit, onDelete, onClose }: {
  template: RoleMasterTemplate; categoryColors: Record<string, string>; canEdit: boolean; canDelete: boolean; onEdit: () => void; onDelete: () => void; onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const cc = categoryColor(template.category, categoryColors);

  const doCopy = async () => {
    const ok = await copyToClipboard(template.body);   // shared 3-tier helper
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); return; }
    // manual select-all fallback (clipboard API unavailable / blocked)
    setManual(true);
    setTimeout(() => taRef.current?.select(), 0);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex md:items-center md:justify-center md:p-4" onClick={onClose}>
      <div className="bg-white md:rounded-2xl shadow-2xl h-[100dvh] md:h-auto md:max-h-[92dvh] w-full md:max-w-lg overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-slate-800">{template.title}</h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {template.category && <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${cc.chip}`}>{template.category}</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 min-w-[44px] min-h-[44px] inline-flex items-center justify-center"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-4 space-y-3 flex-1 min-h-0 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
          {template.notes && <div className="text-[12px] text-slate-500 bg-slate-50 border border-slate-100 rounded-lg p-2"><span className="font-black uppercase tracking-widest text-[10px] text-slate-400">When to use</span><div className="mt-0.5 whitespace-pre-wrap">{template.notes}</div></div>}
          <div className="whitespace-pre-wrap text-sm text-slate-800 bg-white border border-slate-200 rounded-lg p-3 font-sans">{template.body}</div>
          {updatedLine(template) && <div className="text-[10px] text-slate-400">{updatedLine(template)}</div>}
          {manual && (
            <div>
              <div className="text-[11px] text-amber-700 font-bold mb-1">Clipboard blocked — select all below and copy (Ctrl/Cmd+C):</div>
              <textarea ref={taRef} readOnly value={template.body} onFocus={e => e.currentTarget.select()} className="w-full h-40 border border-slate-300 rounded-lg p-2 text-xs font-mono" />
            </div>
          )}
        </div>
        <div className="p-4 border-t border-slate-200 flex items-center gap-2 shrink-0">
          <button onClick={doCopy} className={`flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl font-black uppercase tracking-widest text-sm ${copied ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white hover:bg-slate-800'}`}>
            {copied ? <><Check className="w-4 h-4" /> Copied ✓</> : <><Copy className="w-4 h-4" /> Copy</>}
          </button>
          {canEdit && <button onClick={onEdit} className="min-h-[44px] px-3 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 text-sm font-bold"><Pencil className="w-4 h-4" /></button>}
          {canDelete && <button onClick={onDelete} className="min-h-[44px] px-3 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 inline-flex items-center gap-1.5 text-sm font-bold"><Trash2 className="w-4 h-4" /></button>}
        </div>
      </div>
    </div>
  );
}

// ── Template editor ───────────────────────────────────────────────────────
function TemplateEditor({ template, onClose, onSave }: { template: RoleMasterTemplate; onClose: () => void; onSave: (t: RoleMasterTemplate) => void }) {
  const [t, setT] = useState<RoleMasterTemplate>({ ...template });
  return (
    <LibModal title={template.title ? 'Edit template' : 'New template'} onClose={onClose}>
      <LibField label="Title"><input value={t.title} onChange={e => setT({ ...t, title: e.target.value })} className="libinp" /></LibField>
      <LibField label="Category"><input value={t.category} onChange={e => setT({ ...t, category: e.target.value })} className="libinp" placeholder="Quotes, Billing, Scheduling, Customer Service…" /></LibField>
      <LibField label="Body (line breaks preserved; [Placeholders] stay literal)"><textarea value={t.body} onChange={e => setT({ ...t, body: e.target.value })} className="libinp h-56 font-sans" placeholder="Hi [Customer Name], …" /></LibField>
      <LibField label="Notes — when to use it (optional)"><input value={t.notes || ''} onChange={e => setT({ ...t, notes: e.target.value })} className="libinp" /></LibField>
      <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={!t.active} onChange={e => setT({ ...t, active: !e.target.checked })} /> Archived (hidden from the default list)</label>
      <LibSaveBar onClose={onClose} disabled={!t.title.trim() || !t.body.trim()} onSave={() => onSave(t)} />
    </LibModal>
  );
}

// ── Policy editor (file upload OR link) ───────────────────────────────────
function PolicyEditor({ policy, uploadedBy, onClose, onSave, onDelete }: { policy: RoleMasterPolicy; uploadedBy: { email: string; name: string }; onClose: () => void; onSave: (p: RoleMasterPolicy) => void; onDelete?: () => void }) {
  const [p, setP] = useState<RoleMasterPolicy>({ ...policy });
  const [mode, setMode] = useState<'file' | 'link'>(policy.link && !policy.file ? 'link' : 'file');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (files: FileList | null) => {
    if (!files || !files[0]) return;
    setError(null); setBusy(true); setProgress(0);
    try {
      const stored = await uploadFile(`policies/${p.id}`, files[0], { uploadedBy, onProgress: setProgress });
      // Replace any prior file (best-effort delete of the old bytes).
      const old = p.file;
      setP(s => ({ ...s, file: stored, link: undefined }));
      if (old?.path) { try { await deleteFile(old.path); } catch { /* orphan cleanup best-effort */ } }
    } catch (e: any) { setError(e?.message || 'Upload failed.'); }
    finally { setBusy(false); setProgress(null); }
  };

  const modeBtn = (active: boolean) => `text-xs font-bold px-3 py-1.5 rounded-lg border ${active ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`;
  const valid = p.title.trim() && ((mode === 'file' && p.file) || (mode === 'link' && (p.link || '').trim()));

  return (
    <LibModal title={policy.title ? 'Edit policy / doc' : 'New policy / doc'} onClose={onClose}>
      <LibField label="Title"><input value={p.title} onChange={e => setP({ ...p, title: e.target.value })} className="libinp" /></LibField>
      <LibField label="Category (optional)"><input value={p.category || ''} onChange={e => setP({ ...p, category: e.target.value })} className="libinp" placeholder="HR, Safety, Operations…" /></LibField>
      <LibField label="Description (optional)"><textarea value={p.description || ''} onChange={e => setP({ ...p, description: e.target.value })} className="libinp h-16" /></LibField>
      <LibField label="Source">
        <div className="flex gap-1.5 mb-2">
          <button type="button" onClick={() => setMode('file')} className={modeBtn(mode === 'file')}>Upload file</button>
          <button type="button" onClick={() => setMode('link')} className={modeBtn(mode === 'link')}>External link</button>
        </div>
        {mode === 'file' ? (
          <div className="space-y-2">
            {p.file && <div className="text-[12px] text-slate-600 flex items-center gap-1.5"><FileText className="w-4 h-4 text-slate-400" /> {p.file.name} · {(p.file.size / 1024).toFixed(0)} KB</div>}
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="min-h-[44px] inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />} {p.file ? 'Replace file' : 'Choose PDF / image'}
            </button>
            <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={e => { handleFile(e.target.files); e.target.value = ''; }} />
            {busy && progress !== null && <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} /></div>}
            {error && <div className="text-[11px] font-bold text-rose-600">{error}</div>}
          </div>
        ) : (
          <input value={p.link || ''} onChange={e => setP({ ...p, link: e.target.value, file: undefined })} className="libinp" placeholder="https://docs.google.com/… or https://scribehow.com/…" />
        )}
      </LibField>
      <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={p.active} onChange={e => setP({ ...p, active: e.target.checked })} /> Active</label>
      <div className="flex justify-between gap-2 mt-4 pt-3 border-t border-slate-100">
        {onDelete ? <button onClick={onDelete} className="px-3 py-2 text-sm font-bold text-rose-600 hover:bg-rose-50 rounded-lg inline-flex items-center gap-1.5"><Trash2 className="w-4 h-4" /> Delete</button> : <span />}
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button onClick={() => onSave({ ...p, link: mode === 'link' ? p.link : undefined, file: mode === 'file' ? p.file : undefined })} disabled={!valid || busy} className="px-5 py-2 text-sm font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:bg-slate-300">Save</button>
        </div>
      </div>
    </LibModal>
  );
}

// ── Policy detail — view/download + change requests ───────────────────────
function PolicyDetail({ policy, requests, categoryColors, isAdmin, isManager, currentUser, onView, onSubmitRequest, onEditRequest, onResolve, onClose }: {
  policy: RoleMasterPolicy; requests: RoleMasterPolicyRequest[]; categoryColors: Record<string, string>;
  isAdmin: boolean; isManager: boolean; currentUser: { id: string; name: string };
  onView: (f: StoredFile) => void;
  onSubmitRequest: (text: string) => void; onEditRequest: (id: string, text: string) => void; onResolve: (id: string, note: string) => void;
  onClose: () => void;
}) {
  const cc = policy.category ? categoryColor(policy.category, categoryColors) : null;
  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState('');
  const open = requests.filter(r => r.status === 'open').sort((a, b) => b.createdAt - a.createdAt);
  const resolved = requests.filter(r => r.status === 'resolved').sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0));

  return (
    <LibModal title={policy.title} onClose={onClose}>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {cc && <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${cc.chip}`}>{policy.category}</span>}
        {!policy.active && <span className="text-[9px] font-black uppercase bg-slate-200 text-slate-500 px-1 rounded">Inactive</span>}
      </div>
      {policy.description && <div className="text-sm text-slate-600 mb-2">{policy.description}</div>}
      {policy.file ? (
        <button onClick={() => onView(policy.file as StoredFile)} className="min-h-[40px] inline-flex items-center gap-1.5 px-3 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest"><FileText className="w-4 h-4" /> View / download</button>
      ) : policy.link ? (
        <a href={policy.link} target="_blank" rel="noopener noreferrer" className="min-h-[40px] inline-flex items-center gap-1.5 px-3 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest"><ExternalLink className="w-4 h-4" /> Open link</a>
      ) : null}
      {updatedLine(policy) && <div className="text-[10px] text-slate-400 mt-1.5">{updatedLine(policy)}</div>}

      {/* CHANGE REQUESTS */}
      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 inline-flex items-center gap-1.5">Change requests {open.length > 0 && <Badge n={open.length} />}</div>
          {isManager && !showForm && <button onClick={() => { setShowForm(true); setText(''); }} className="text-[11px] font-bold text-emerald-700 inline-flex items-center gap-1"><MessageSquarePlus className="w-3.5 h-3.5" /> Request a change</button>}
        </div>
        {showForm && (
          <div className="mb-3 space-y-2">
            <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="Describe the change you'd like…" className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={() => { if (text.trim()) { onSubmitRequest(text.trim()); setShowForm(false); setText(''); } }} disabled={!text.trim()} className="px-4 py-1.5 text-xs font-black uppercase tracking-widest bg-emerald-600 text-white rounded-lg disabled:bg-slate-300">Submit</button>
            </div>
          </div>
        )}

        {open.length === 0 && !showForm && <div className="text-xs text-slate-400 italic">No open requests.</div>}
        <div className="space-y-2">
          {open.map(r => (
            <div key={r.id} className="border border-slate-200 rounded-lg p-2 bg-white">
              {editId === r.id ? (
                <div className="space-y-2">
                  <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={3} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none" />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditId(null)} className="px-3 py-1 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                    <button onClick={() => { if (editText.trim()) { onEditRequest(r.id, editText.trim()); setEditId(null); } }} disabled={!editText.trim()} className="px-3 py-1 text-xs font-black uppercase tracking-widest bg-emerald-600 text-white rounded-lg disabled:bg-slate-300">Save</button>
                  </div>
                </div>
              ) : (<>
                <div className="text-sm text-slate-700 whitespace-pre-wrap">{r.text}</div>
                <div className="text-[10px] text-slate-400 mt-1">{r.createdBy?.name} · {fmtWhen(r.createdAt)} · <span className="font-bold text-amber-600 uppercase">Open</span></div>
                <div className="flex gap-2 mt-1.5 flex-wrap">
                  {r.createdBy?.id === currentUser.id && <button onClick={() => { setEditId(r.id); setEditText(r.text); }} className="text-[11px] font-bold text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"><Pencil className="w-3 h-3" /> Edit</button>}
                  {isAdmin && (resolveId === r.id ? (
                    <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                      <input value={resolveNote} onChange={e => setResolveNote(e.target.value)} placeholder="Resolution note (optional)" className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs" />
                      <button onClick={() => { onResolve(r.id, resolveNote); setResolveId(null); setResolveNote(''); }} className="text-[11px] font-black uppercase tracking-widest bg-emerald-600 text-white px-2 py-1 rounded">Resolve</button>
                      <button onClick={() => { setResolveId(null); setResolveNote(''); }} className="text-slate-400"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <button onClick={() => { setResolveId(r.id); setResolveNote(''); }} className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Mark resolved</button>
                  ))}
                </div>
              </>)}
            </div>
          ))}
        </div>

        {resolved.length > 0 && (
          <details className="mt-3">
            <summary className="text-[11px] font-black uppercase tracking-widest text-slate-400 cursor-pointer">Resolved ({resolved.length})</summary>
            <div className="space-y-2 mt-2">
              {resolved.map(r => (
                <div key={r.id} className="border border-slate-100 rounded-lg p-2 bg-slate-50/60 opacity-80">
                  <div className="text-[13px] text-slate-600 whitespace-pre-wrap">{r.text}</div>
                  <div className="text-[10px] text-slate-400 mt-1">{r.createdBy?.name} · {fmtWhen(r.createdAt)}</div>
                  <div className="text-[10px] text-emerald-700 mt-0.5 font-medium">✓ Resolved by {r.resolvedBy?.name || '—'} · {fmtWhen(r.resolvedAt)}{r.resolutionNote ? ` — “${r.resolutionNote}”` : ''}</div>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </LibModal>
  );
}

// ── Shared modal shell (mobile-safe: dvh + inner scroll) ──────────────────
const LibField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="mb-3"><label className="text-[11px] font-black uppercase tracking-widest text-slate-500 block mb-1">{label}</label>{children}</div>
);
const LibModal = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => (
  <div className="fixed inset-0 bg-black/60 z-50 flex md:items-center md:justify-center md:p-4" onClick={onClose}>
    <div className="bg-white md:rounded-2xl shadow-2xl h-[100dvh] md:h-auto md:max-h-[92dvh] w-full md:max-w-md overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
      <div className="p-4 border-b border-slate-200 flex items-center justify-between shrink-0">
        <h3 className="text-lg font-bold text-slate-800 inline-flex items-center gap-2"><ClipboardList className="w-5 h-5 text-slate-400" /> {title}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 min-w-[44px] min-h-[44px] inline-flex items-center justify-center"><X className="w-6 h-6" /></button>
      </div>
      <div className="p-4 flex-1 min-h-0 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
        <style>{`.libinp{width:100%;border:1px solid #cbd5e1;border-radius:.5rem;padding:.5rem;font-size:.875rem;outline:none}`}</style>
        {children}
      </div>
    </div>
  </div>
);
const LibSaveBar = ({ onClose, onSave, disabled }: { onClose: () => void; onSave: () => void; disabled?: boolean }) => (
  <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
    <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
    <button onClick={onSave} disabled={disabled} className="px-5 py-2 text-sm font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:bg-slate-300">Save</button>
  </div>
);

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle2, Download, FolderOpen, FolderPlus, History, Pencil, Search, Trash2, Upload, X } from 'lucide-react';
import { apiJson, downloadFile, fetchBlobUrl } from '../api';
import { useUploadLimits, sizeProblem } from '../uploadLimits';

interface Folder { id: number; name: string; items: number }
interface Version {
  id: number; version: number; file_name: string; content_type: string | null; size_bytes: number | null;
  note: string | null; uploaded_by: string | null; uploaded_at: string | null;
}
interface Item {
  id: number; name: string; folder_id: number; tags: string[]; is_approved_final: boolean; usage_rights_note: string | null;
  expiry_date: string | null; versions: number; latest: Version | null;
}

const size = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const isImage = (v: Version | null) => !!v?.content_type?.startsWith('image/');

/** The team's shared library: folders of logos, brand assets, templates and finished designs. Designers and Design
 *  Leads can add, edit, replace (keeping old versions) and delete. */
export default function LibraryPage() {
  const limits = useUploadLimits();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState<number | null>(null);   // null = all files
  const [items, setItems] = useState<Item[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [history, setHistory] = useState<{ item: Item; versions: Version[] } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const replacer = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<Item | null>(null);

  const loadFolders = useCallback(async () => {
    const f = await apiJson<Folder[]>('/api/library/folders');
    setFolders(f);
    return f;
  }, []);
  const loadItems = useCallback(async () => {
    const params = new URLSearchParams();
    if (folderId !== null) params.set('folder_id', String(folderId));
    if (q.trim()) params.set('q', q.trim());
    setItems(await apiJson<Item[]>(`/api/library/items?${params}`));
  }, [folderId, q]);

  useEffect(() => { loadFolders().catch(e => setError(e instanceof Error ? e.message : 'Could not load the library.')); }, [loadFolders]);
  useEffect(() => {
    const t = setTimeout(() => { loadItems().catch(e => setError(e instanceof Error ? e.message : 'Could not load the files.')); }, 250);
    return () => clearTimeout(t);
  }, [loadItems]);

  const act = async (op: () => Promise<unknown>, done?: string) => {
    setBusy(true); setError(null); setInfo(null);
    try {
      await op();
      if (done) setInfo(done);
      await Promise.all([loadFolders(), loadItems()]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(false); }
  };

  const current = folders.find(f => f.id === folderId) ?? null;

  const newFolder = () => {
    const name = window.prompt('Name of the new folder (e.g. Logos, Brand guidelines, Event templates)');
    if (!name?.trim()) return;
    void act(async () => {
      const f = await apiJson<Folder>('/api/library/folders', { method: 'POST', json: { name } });
      setFolderId(f.id);
    }, `Folder "${name.trim()}" created.`);
  };
  const renameFolder = () => {
    if (!current) return;
    const name = window.prompt('New name for this folder', current.name);
    if (!name?.trim() || name.trim() === current.name) return;
    void act(() => apiJson(`/api/library/folders/${current.id}`, { method: 'PATCH', json: { name } }), 'Folder renamed.');
  };
  const deleteFolder = () => {
    if (!current || !window.confirm(`Delete the folder "${current.name}"? It must be empty.`)) return;
    void act(async () => { await apiJson(`/api/library/folders/${current.id}`, { method: 'DELETE' }); setFolderId(null); }, 'Folder deleted.');
  };

  const uploadFiles = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (picker.current) picker.current.value = '';
    if (!files.length || folderId === null) return;
    const tooBig = files.map(f => sizeProblem(f, limits.max_cdr_upload_mb)).find(Boolean);
    if (tooBig) { setError(tooBig); return; }
    void act(async () => {
      for (const file of files) {
        const body = new FormData();
        body.append('folder_id', String(folderId));
        body.append('file', file);
        await apiJson('/api/library/items', { method: 'POST', body });
      }
    }, `${files.length} file${files.length === 1 ? '' : 's'} added to ${current?.name ?? 'the library'}.`);
  };

  const replaceFile = (list: FileList | null) => {
    const file = list?.[0];
    if (replacer.current) replacer.current.value = '';
    const item = replacing;
    setReplacing(null);
    if (!file || !item) return;
    const tooBig = sizeProblem(file, limits.max_cdr_upload_mb);
    if (tooBig) { setError(tooBig); return; }
    const note = window.prompt('What changed in this version? (optional)') ?? '';
    const body = new FormData();
    body.append('file', file);
    body.append('note', note);
    void act(() => apiJson(`/api/library/items/${item.id}/versions`, { method: 'POST', body }), `"${item.name}" updated to version ${item.versions + 1}.`);
  };

  const remove = (item: Item) => {
    if (!window.confirm(`Delete "${item.name}" and all ${item.versions} version${item.versions === 1 ? '' : 's'}? This can't be undone.`)) return;
    void act(() => apiJson(`/api/library/items/${item.id}`, { method: 'DELETE' }), `"${item.name}" deleted.`);
  };

  const openHistory = (item: Item) => {
    setError(null);
    apiJson<Version[]>(`/api/library/items/${item.id}/versions`).then(versions => setHistory({ item, versions }))
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load the history.'));
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 230px) minmax(0, 1fr)', gap: '1.25rem', alignItems: 'start', paddingBottom: '2rem' }} className="library-layout">
      <aside className="glass-card" style={{ padding: '0.75rem' }} aria-label="Folders">
        <button type="button" className="btn-ghost" onClick={newFolder} disabled={busy} style={{ width: '100%', justifyContent: 'center', gap: 6, marginBottom: 8 }}>
          <FolderPlus size={14} aria-hidden="true" /> New folder
        </button>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[{ id: null as number | null, name: 'All files', items: folders.reduce((n, f) => n + f.items, 0) }, ...folders].map(f => (
            <button key={f.id ?? 'all'} type="button" onClick={() => setFolderId(f.id)} aria-current={folderId === f.id ? 'page' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0.6rem', borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left',
                       background: folderId === f.id ? 'rgba(11,31,58,0.08)' : 'transparent', color: folderId === f.id ? '#0B1F3A' : '#0B1F3A',
                       fontWeight: folderId === f.id ? 700 : 500, fontSize: '0.85rem' }}>
              <FolderOpen size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <span style={{ fontSize: '0.72rem', color: '#737373' }}>{f.items}</span>
            </button>
          ))}
        </nav>
        {folders.length === 0 && <p style={{ fontSize: '0.78rem', color: '#737373', padding: '0.5rem' }}>No folders yet. Create one to start adding files.</p>}
      </aside>

      <section style={{ minWidth: 0 }} aria-label="Files">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0B1F3A', marginRight: 'auto' }}>{current?.name ?? 'All files'}</h2>
          {current && (<>
            <button type="button" className="chip" onClick={renameFolder} disabled={busy}><Pencil size={11} aria-hidden="true" /> Rename</button>
            <button type="button" className="chip" onClick={deleteFolder} disabled={busy} style={{ color: '#B91C1C' }}><Trash2 size={11} aria-hidden="true" /> Delete folder</button>
          </>)}
          <label style={{ position: 'relative' }}>
            <span className="sr-only">Search the library</span>
            <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#737373' }} />
            <input type="search" className="input-field" placeholder="Search name or tag" value={q} onChange={e => setQ(e.target.value)} style={{ paddingLeft: 30, width: 220 }} />
          </label>
          <button type="button" className="btn-primary" disabled={busy || folderId === null} onClick={() => picker.current?.click()} style={{ gap: 6 }}
            title={folderId === null ? 'Open a folder to upload into it' : undefined}>
            <Upload size={14} aria-hidden="true" /> {busy ? 'Working…' : 'Upload files'}
          </button>
          <input ref={picker} type="file" multiple hidden aria-label="Choose files to upload" onChange={e => uploadFiles(e.target.files)} />
          <input ref={replacer} type="file" hidden aria-label="Choose the new version" onChange={e => replaceFile(e.target.files)} />
        </div>
        {folderId === null && folders.length > 0 && <p style={{ fontSize: '0.8rem', color: '#737373', marginBottom: 10 }}>Open a folder on the left to upload into it.</p>}
        {error && <p role="alert" style={{ fontSize: '0.82rem', color: '#B91C1C', marginBottom: 10 }}>{error}</p>}
        {info && <p role="status" style={{ fontSize: '0.82rem', color: '#047857', marginBottom: 10 }}>{info}</p>}
        {items === null && !error && <p role="status" style={{ color: '#737373' }}>Loading…</p>}
        {items?.length === 0 && (
          <div className="glass-card" style={{ padding: '2.5rem 1rem', textAlign: 'center', color: '#737373', fontSize: '0.88rem' }}>
            {q ? 'Nothing matches your search.' : current ? 'This folder is empty. Use Upload files to add some.' : 'The library is empty.'}
          </div>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {items?.map(item => (
            <li key={item.id} className="glass-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Preview item={item} />
              <div style={{ padding: '0.75rem 0.85rem', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#0B1F3A', flex: 1, overflowWrap: 'anywhere' }}>{item.name}</h3>
                  {item.is_approved_final && <span title="Approved final" style={{ color: '#047857' }}><CheckCircle2 size={15} aria-label="Approved final" /></span>}
                </div>
                <p style={{ fontSize: '0.72rem', color: '#737373' }}>
                  v{item.latest?.version ?? 1} · {item.latest?.file_name} {item.latest?.size_bytes ? `· ${size(item.latest.size_bytes)}` : ''}
                  {folderId === null && <> · {folders.find(f => f.id === item.folder_id)?.name}</>}
                </p>
                {item.tags.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{item.tags.map(t => <span key={t} className="chip" style={{ fontSize: '0.68rem' }}>{t}</span>)}</div>}
                {item.usage_rights_note && <p style={{ fontSize: '0.74rem', color: '#92400E' }}>{item.usage_rights_note}</p>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 'auto', paddingTop: 4 }}>
                  {item.latest && <button type="button" className="chip" onClick={() => void act(() => downloadFile(`/api/library/versions/${item.latest!.id}/file`, item.latest!.file_name))}><Download size={11} aria-hidden="true" /> Download</button>}
                  <button type="button" className="chip" onClick={() => setEditing(item)}><Pencil size={11} aria-hidden="true" /> Edit</button>
                  <button type="button" className="chip" onClick={() => { setReplacing(item); replacer.current?.click(); }} disabled={busy}><Upload size={11} aria-hidden="true" /> New version</button>
                  {item.versions > 1 && <button type="button" className="chip" onClick={() => openHistory(item)}><History size={11} aria-hidden="true" /> {item.versions} versions</button>}
                  <button type="button" className="chip" onClick={() => remove(item)} disabled={busy} style={{ color: '#B91C1C' }} aria-label={`Delete ${item.name}`}><Trash2 size={11} aria-hidden="true" /></button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {editing && <EditDialog item={editing} folders={folders} onClose={() => setEditing(null)}
        onSave={changes => act(async () => { await apiJson(`/api/library/items/${editing.id}`, { method: 'PATCH', json: changes }); setEditing(null); }, 'Saved.')} />}

      {history && (
        <Dialog title={`${history.item.name}: versions`} onClose={() => setHistory(null)}>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.versions.map(v => (
              <li key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0.6rem', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 8, fontSize: '0.8rem' }}>
                <strong style={{ color: '#0B1F3A' }}>v{v.version}</strong>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {v.file_name} · {size(v.size_bytes)}<br />
                  <span style={{ color: '#737373' }}>{v.uploaded_by} · {day(v.uploaded_at)}{v.note ? ` · ${v.note}` : ''}</span>
                </span>
                <button type="button" className="chip" onClick={() => void downloadFile(`/api/library/versions/${v.id}/file`, v.file_name).catch(e => setError(e instanceof Error ? e.message : 'Download failed.'))}>
                  <Download size={11} aria-hidden="true" /> Download
                </button>
              </li>
            ))}
          </ol>
        </Dialog>
      )}
    </div>
  );
}

function Preview({ item }: { item: Item }) {
  const [url, setUrl] = useState<string | null>(null);
  const id = item.latest?.id;
  const image = isImage(item.latest);
  useEffect(() => {
    if (!id || !image) return;
    let live = true, made: string | null = null;
    fetchBlobUrl(`/api/library/versions/${id}/file`).then(u => { made = u; if (live) setUrl(u); else URL.revokeObjectURL(u); }).catch(() => {});
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [id, image]);
  const ext = item.latest?.file_name.split('.').pop()?.toUpperCase() ?? 'FILE';
  return (
    <div style={{ height: 130, background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        : <span style={{ fontSize: '1rem', fontWeight: 800, color: '#94A3B8', letterSpacing: '0.05em' }}>{ext}</span>}
    </div>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="glass-card" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, padding: '1.25rem', background: 'white', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 800, flex: 1 }}>{title}</h2>
          <button type="button" className="chip" onClick={onClose} aria-label="Close"><X size={12} aria-hidden="true" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EditDialog({ item, folders, onClose, onSave }: {
  item: Item; folders: Folder[]; onClose: () => void; onSave: (changes: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(item.name);
  const [folder, setFolder] = useState(item.folder_id);
  const [tags, setTags] = useState(item.tags.join(', '));
  const [note, setNote] = useState(item.usage_rights_note ?? '');
  const [approved, setApproved] = useState(item.is_approved_final);
  const [expiry, setExpiry] = useState(item.expiry_date ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onSave({ name: name.trim(), folder_id: folder, tags: tags.split(',').map(t => t.trim()).filter(Boolean),
                  usage_rights_note: note, is_approved_final: approved, expiry_date: expiry || null });
  };
  const label = { display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: 4 } as const;
  return (
    <Dialog title="Edit file details" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><label htmlFor="li-name" style={label}>Name</label><input id="li-name" className="input-field" required maxLength={120} value={name} onChange={e => setName(e.target.value)} style={{ width: '100%' }} /></div>
        <div><label htmlFor="li-folder" style={label}>Folder</label>
          <select id="li-folder" className="input-field" value={folder} onChange={e => setFolder(Number(e.target.value))} style={{ width: '100%' }}>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select></div>
        <div><label htmlFor="li-tags" style={label}>Tags (comma separated)</label><input id="li-tags" className="input-field" value={tags} onChange={e => setTags(e.target.value)} placeholder="logo, blue, print" style={{ width: '100%' }} /></div>
        <div><label htmlFor="li-note" style={label}>Usage notes</label><textarea id="li-note" className="input-field" rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Use on white backgrounds only" style={{ width: '100%', resize: 'vertical' }} /></div>
        <div><label htmlFor="li-exp" style={label}>Use until (optional)</label><input id="li-exp" type="date" className="input-field" value={expiry} onChange={e => setExpiry(e.target.value)} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
          <input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} style={{ accentColor: '#047857' }} /> Approved final version
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!name.trim()}>Save</button>
        </div>
      </form>
    </Dialog>
  );
}

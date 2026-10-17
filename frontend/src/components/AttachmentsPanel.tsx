import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Paperclip, Plus, Trash2 } from 'lucide-react';
import { apiJson, downloadFile } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { sizeProblem, useUploadLimits } from '../uploadLimits';

interface Attachment {
  id: number; file_name: string; content_type: string | null; size_bytes: number | null;
  uploaded_by_id: number | null; uploaded_at: string | null;
}

const size = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** The files sent with a request (circulars, logos, briefs) and any added later: everyone on the ticket can download
 *  them; the person who added a file, or a Design Lead, can remove it. */
export default function AttachmentsPanel({ ticketId }: { ticketId: string }) {
  const { user } = useAuth();
  const limits = useUploadLimits();
  const [files, setFiles] = useState<Attachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    apiJson<Attachment[]>(`/api/tickets/${ticketId}/attachments`).then(setFiles)
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load the files.'));
  }, [ticketId]);
  useEffect(load, [load]);

  const act = async (op: () => Promise<unknown>, fallback: string) => {
    setError(null); setBusy(true);
    try { await op(); } catch (e) { setError(e instanceof Error ? e.message : fallback); } finally { setBusy(false); }
  };

  const add = (picked: FileList | null) => {
    const file = picked?.[0];
    if (picker.current) picker.current.value = '';
    if (!file) return;
    const tooBig = sizeProblem(file, limits.max_upload_mb);
    if (tooBig) { setError(tooBig); return; }
    const body = new FormData();
    body.append('file', file);
    void act(async () => { await apiJson(`/api/tickets/${ticketId}/attachments`, { method: 'POST', body }); load(); }, 'Could not add the file.');
  };

  const remove = (a: Attachment) => {
    if (!window.confirm(`Remove ${a.file_name}?`)) return;
    void act(async () => { await apiJson(`/api/attachments/${a.id}`, { method: 'DELETE' }); load(); }, 'Could not remove the file.');
  };

  const canRemove = (a: Attachment) => user?.role === 'Design Lead' || String(a.uploaded_by_id) === user?.id;

  return (
    <div className="glass-card" style={{ padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Paperclip size={14} aria-hidden="true" style={{ color: '#003F8A' }} />
        <h3 className="section-label">Files{files?.length ? ` (${files.length})` : ''}</h3>
        <button type="button" className="btn-ghost" style={{ marginLeft: 'auto', gap: 5, padding: '0.3rem 0.7rem', fontSize: '0.78rem' }}
          disabled={busy} onClick={() => picker.current?.click()}>
          <Plus size={13} aria-hidden="true" /> {busy ? 'Working…' : 'Add a file'}
        </button>
        <input ref={picker} type="file" hidden onChange={e => add(e.target.files)} aria-label="Add a file" />
      </div>
      {error && <p role="alert" style={{ fontSize: '0.78rem', color: '#b91c1c', marginBottom: 8 }}>{error}</p>}
      {files === null && !error && <p role="status" style={{ fontSize: '0.8rem', color: '#64748B' }}>Loading…</p>}
      {files?.length === 0 && <p style={{ fontSize: '0.8rem', color: '#64748B' }}>No files were attached.</p>}
      {!!files?.length && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {files.map(a => (
            <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.45rem 0.6rem', borderRadius: 8, border: '1px solid rgba(226,232,240,0.85)', fontSize: '0.8rem' }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, color: '#0F172A' }} title={a.file_name}>{a.file_name}</span>
              <span style={{ color: '#64748B', whiteSpace: 'nowrap' }}>{size(a.size_bytes)}</span>
              <button type="button" className="chip" aria-label={`Download ${a.file_name}`}
                onClick={() => void act(() => downloadFile(`/api/attachments/${a.id}/download`, a.file_name), 'Download failed.')}>
                <Download size={11} aria-hidden="true" /> Download
              </button>
              {canRemove(a) && (
                <button type="button" className="chip" aria-label={`Remove ${a.file_name}`} style={{ color: '#B91C1C' }} disabled={busy} onClick={() => remove(a)}>
                  <Trash2 size={11} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileLock2, Upload } from 'lucide-react';
import { apiJson, authFetch, downloadFile } from '../api';
import { useAuth } from '../contexts/AuthContext';
import type { Ticket } from '../types';

interface CdrRequest {
  id: number; status: 'Requested' | 'Approved' | 'Declined' | 'Uploaded';
  requested_by: string | null; decided_by: string | null; has_file: boolean; created_at: string | null;
}

const RELEASABLE = ['Delivered', 'Closed', 'Closed without approval'];
const BADGE: Record<CdrRequest['status'], string> = { Requested: 'badge-blue', Approved: 'badge-blue', Declined: 'badge-red', Uploaded: 'badge-green' };
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** Source-file (CDR) requests: client asks, a lead approves, a designer uploads, the client downloads. */
export default function CdrPanel({ ticket }: { ticket: Ticket }) {
  const { user } = useAuth();
  const isClient = user?.role === 'Client';
  const isLead = user?.role === 'Design Lead';
  const [requests, setRequests] = useState<CdrRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploadFor = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setRequests(await apiJson<CdrRequest[]>(`/api/tickets/${ticket.id}/cdr-requests`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load source file requests.'); }
    finally { setLoading(false); }
  }, [ticket.id]);
  useEffect(() => { void load(); }, [load]);

  const act = async (op: () => Promise<unknown>, fallback: string) => {
    setBusy(true); setError(null);
    try { await op(); await load(); } catch (e) { setError(e instanceof Error ? e.message : fallback); }
    finally { setBusy(false); }
  };

  const post = (path: string) => apiJson(path, { method: 'POST' });
  const upload = (file: File) => act(async () => {
    const body = new FormData();
    body.append('file', file);
    const res = await authFetch(`/api/cdr-requests/${uploadFor.current}/upload`, { method: 'POST', body });
    if (!res.ok) throw new Error(((await res.json().catch(() => null))?.detail as string | undefined) ?? 'Upload failed.');
  }, 'Upload failed.');

  const releasable = RELEASABLE.includes(ticket.status);
  const hasOpen = requests.some(r => r.status === 'Requested' || r.status === 'Approved');

  return (
    <div className="glass-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h3 className="section-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileLock2 size={14} /> Source files</h3>
        {releasable && !hasOpen && (
          <button type="button" className="btn-primary" disabled={busy}
            onClick={() => void act(() => apiJson('/api/cdr-requests', { method: 'POST', json: { ticket_id: Number(ticket.id) } }), 'Could not send the request.')}>
            Request source file
          </button>
        )}
      </div>

      {!releasable && <p style={{ fontSize: '0.8rem', color: '#64748B' }}>The editable source file can be requested once the design is approved.</p>}
      {error && <p role="alert" style={{ fontSize: '0.8rem', color: '#b91c1c' }}>{error}</p>}
      {loading && <p role="status" style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Loading…</p>}
      {!loading && releasable && requests.length === 0 && <p style={{ fontSize: '0.8rem', color: '#64748B' }}>No source file requested yet.</p>}

      <input ref={fileRef} type="file" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />

      {requests.map(r => (
        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '0.6rem 0.75rem', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 8 }}>
          <div>
            <span className={BADGE[r.status]}>{r.status === 'Requested' ? 'Awaiting lead approval' : r.status === 'Approved' ? 'Approved, awaiting upload' : r.status}</span>
            <p style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 4 }}>
              {r.requested_by ?? 'Someone'} · {fmt(r.created_at)}{r.decided_by ? ` · decided by ${r.decided_by}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {isLead && r.status === 'Requested' && (
              <>
                <button type="button" className="btn-primary" disabled={busy} onClick={() => void act(() => post(`/api/cdr-requests/${r.id}/approve`), 'Could not approve.')}>Approve</button>
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => void act(() => post(`/api/cdr-requests/${r.id}/decline`), 'Could not decline.')}>Decline</button>
              </>
            )}
            {!isClient && r.status === 'Approved' && (
              <button type="button" className="btn-primary" disabled={busy} onClick={() => { uploadFor.current = r.id; fileRef.current?.click(); }}>
                <Upload size={14} /> Upload file
              </button>
            )}
            {r.status === 'Uploaded' && (
              <button type="button" className="btn-primary" disabled={busy}
                onClick={() => void act(() => downloadFile(`/api/cdr-requests/${r.id}/download`, `${ticket.number}-source`), 'Download failed.')}>
                <Download size={14} /> Download
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

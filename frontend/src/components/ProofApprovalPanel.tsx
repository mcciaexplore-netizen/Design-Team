import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clipboard, Columns2, Download, Link2, RotateCcw, Send, Upload, XCircle } from 'lucide-react';
import { apiJson, authFetch, downloadFile } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useTickets } from '../contexts/TicketsContext';
import { DONE_STATUSES, type Ticket } from '../types';
import { ProofCompare, RevisionTimeline } from './ProofCompare';
import PinnableImage, { type PinItem } from './PinnableImage';

interface Proof { id: number; version: number; file_name: string; content_type: string | null; size_bytes: number; note: string | null; created_at: string | null }
interface ApiPin { id: number; image_url: string; x_pct: string; y_pct: string; content: string; is_resolved: boolean; author_name: string | null }
interface ApprovalReq {
  id: number; proof_version_id?: number; proof_version: number | null; status: 'pending' | 'approved' | 'changes_requested' | 'expired' | 'revoked';
  expires_at: string; decided_at: string | null; decided_by_name: string | null; decision_comment: string | null; created_at: string | null;
}
interface Created extends ApprovalReq { review_url: string }

const STATUS_LABEL: Record<ApprovalReq['status'], { text: string; cls: string }> = {
  pending: { text: 'Awaiting client', cls: 'badge-blue' },
  approved: { text: 'Approved', cls: 'badge-green' },
  changes_requested: { text: 'Changes requested', cls: 'badge-red' },
  expired: { text: 'Link expired', cls: 'badge-red' },
  revoked: { text: 'Withdrawn', cls: 'badge-red' },
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

export default function ProofApprovalPanel({ ticket }: { ticket: Ticket }) {
  const { user } = useAuth();
  const { refresh, tickets } = useTickets();
  const isClient = user?.role === 'Client';
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [requests, setRequests] = useState<ApprovalReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [sendNow, setSendNow] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [pins, setPins] = useState<ApiPin[]>([]);
  // When this ticket is a later version (V2, V3...), the version it grew from: its designs, decisions and marked spots.
  const [parentData, setParentData] = useState<{ proofs: Proof[]; requests: ApprovalReq[]; pins: ApiPin[] } | null>(null);
  const [nextVersion, setNextVersion] = useState<{ id: number; ticket_number: string } | null>(null);
  const autoCompared = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [sendFor, setSendFor] = useState<number | null>(null);
  const [days, setDays] = useState('7');
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  const [deciding, setDeciding] = useState<{ id: number; mode: 'approve' | 'request_changes' } | null>(null);
  const [comment, setComment] = useState('');

  const load = useCallback(async () => {
    try {
      const [p, r, marks] = await Promise.all([
        apiJson<Proof[]>(`/api/tickets/${ticket.id}/proofs`),
        apiJson<ApprovalReq[]>(`/api/tickets/${ticket.id}/approval-requests`),
        apiJson<ApiPin[]>(`/api/tickets/${ticket.id}/pinpoints`),
      ]);
      setProofs(p); setRequests(r); setPins(marks); setError(null);
      if (ticket.parent_id) {
        const [pp, pr, pm] = await Promise.all([
          apiJson<Proof[]>(`/api/tickets/${ticket.parent_id}/proofs`),
          apiJson<ApprovalReq[]>(`/api/tickets/${ticket.parent_id}/approval-requests`),
          apiJson<ApiPin[]>(`/api/tickets/${ticket.parent_id}/pinpoints`),
        ]).catch(() => [[], [], []] as [Proof[], ApprovalReq[], ApiPin[]]);
        setParentData({ proofs: pp, requests: pr, pins: pm });
      } else setParentData(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load proofs.'); }
    finally { setLoading(false); }
  }, [ticket.id, ticket.parent_id]);

  useEffect(() => {
    setLoading(true); setCreated(null); setSendFor(null); setDeciding(null); setInfo(null); setNextVersion(null); autoCompared.current = false;
    void load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 20_000);
    return () => clearInterval(id);
  }, [load]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError(null); setInfo(null);
    try {
      const body = new FormData();
      body.append('file', file);
      if (note.trim()) body.append('note', note.trim());
      body.append('send_for_approval', String(sendNow));
      const res = await authFetch(`/api/tickets/${ticket.id}/proofs`, { method: 'POST', body });
      if (!res.ok) {
        let detail = `Upload failed (HTTP ${res.status})`;
        try { detail = (await res.json()).detail ?? detail; } catch { /* keep default */ }
        throw new Error(detail);
      }
      const out = await res.json() as Proof & { approval: Created | null };
      setNote('');
      if (out.approval) {
        setCreated(out.approval); setSendFor(null);
        setInfo(`Version ${out.version} was sent to the client for approval. They have been notified.`);
      } else {
        setInfo(`Version ${out.version} saved as a draft. It has not been sent to the client.`);
      }
      await load(); void refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed.'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const sendForApproval = async (proof: Proof) => {
    setBusy(true); setError(null); setInfo(null);
    try {
      const res = await apiJson<Created>(`/api/tickets/${ticket.id}/approval-requests`, {
        method: 'POST', json: { proof_version_id: proof.id, ttl_hours: Number(days) * 24 },
      });
      setCreated(res); setSendFor(null);
      await load(); void refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create the review link.'); }
    finally { setBusy(false); }
  };

  const copyLink = async () => {
    if (!created) return;
    try { await navigator.clipboard.writeText(created.review_url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError('Copy failed — select the link and copy it manually.'); }
  };

  const revoke = async (id: number) => {
    setError(null);
    try { await apiJson(`/api/approval-requests/${id}/revoke`, { method: 'POST' }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not withdraw the link.'); }
  };

  const pinItems = (proofId: number): PinItem[] =>
    pins.filter(x => x.image_url === `proof:${proofId}`)
      .map(x => ({ id: x.id, x: parseFloat(x.x_pct), y: parseFloat(x.y_pct), content: x.content, author: x.author_name ?? 'Someone', resolved: x.is_resolved }));

  const addPin = async (proofId: number, x: number, y: number, text: string) => {
    const made = await apiJson<ApiPin>(`/api/tickets/${ticket.id}/pinpoints`, {
      method: 'POST', json: { image_url: `proof:${proofId}`, x_pct: x.toFixed(2), y_pct: y.toFixed(2), content: text },
    });
    setPins(prev => [...prev, made]);
  };

  const toggleOn = async (ticketId: string, pin: PinItem) => {
    const flip = (all: ApiPin[]) => all.map(x => (x.id === pin.id ? { ...x, is_resolved: !pin.resolved } : x));   // optimistic
    if (ticketId === ticket.id) setPins(flip); else setParentData(d => (d ? { ...d, pins: flip(d.pins) } : d));
    try { await apiJson(`/api/tickets/${ticketId}/pinpoints/${pin.id}?resolved=${!pin.resolved}`, { method: 'PATCH' }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update that spot.'); void load(); }
  };
  const togglePin = (pin: PinItem) => toggleOn(ticket.id, pin);

  const decide = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deciding) return;
    setBusy(true); setError(null);
    try {
      // Marked spots can stand in for a written note.
      const marked = pending?.proof_version_id ? pinItems(pending.proof_version_id).length : 0;
      const text = comment.trim() || (deciding.mode === 'request_changes' && marked ? `Please see the ${marked} marked spot${marked > 1 ? 's' : ''} on the design.` : null);
      const res = await apiJson<{ new_ticket?: { id: number; ticket_number: string } }>(`/api/approval-requests/${deciding.id}/decision`, { method: 'POST', json: { decision: deciding.mode, comment: text } });
      setNextVersion(res.new_ticket ?? null);
      setDeciding(null); setComment('');
      setInfo(deciding.mode === 'approve' ? 'Thank you — the design is approved.' : 'Thanks — your feedback was sent to the design team.');
      await load(); void refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not record your decision.'); }
    finally { setBusy(false); }
  };

  const pending = requests.find(r => r.status === 'pending');
  const latest = proofs[0];
  const pendingMarks = pending?.proof_version_id ? pinItems(pending.proof_version_id).length : 0;

  // "What changed": on a later version, show the client's feedback on the version before as a checklist and open
  // the comparison. Designs of both versions are numbered as one series so they can be compared.
  const parentNumber = tickets.find(t => t.id === ticket.parent_id)?.number ?? 'the previous version';
  const askedForChanges = parentData?.requests.filter(r => r.status === 'changes_requested').sort((a, b) => b.id - a.id)[0];
  const earlierProofVersion = new Map((parentData?.proofs ?? []).map(x => [x.id, x.version]));
  const isRedo = !!askedForChanges && !DONE_STATUSES.includes(ticket.status);

  const ownAsc = [...proofs].sort((a, b) => a.version - b.version);
  const parentAsc = [...(parentData?.proofs ?? [])].sort((a, b) => a.version - b.version);
  const series = new Map([...parentAsc, ...ownAsc].map((x, idx) => [x.id, idx + 1] as [number, number]));
  const chainProofs = [...parentAsc, ...ownAsc].map(x => ({ ...x, version: series.get(x.id) ?? x.version }));
  const chainRequests = [...(parentData?.requests ?? []), ...requests]
    .map(r => ({ ...r, proof_version: (r.proof_version_id ? series.get(r.proof_version_id) : undefined) ?? r.proof_version }));
  const chainImages = chainProofs.filter(x => x.content_type?.startsWith('image/')).length;
  const ownImages = proofs.filter(x => x.content_type?.startsWith('image/')).length;

  useEffect(() => {
    if (isRedo && ownImages >= 1 && chainImages >= 2 && !autoCompared.current) { autoCompared.current = true; setComparing(true); }
  }, [isRedo, ownImages, chainImages]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {error && <p role="alert" style={{ fontSize: '0.8rem', color: '#b91c1c', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '0.5rem 0.75rem' }}>{error}</p>}
      {nextVersion && (
        <p style={{ fontSize: '0.82rem', color: '#1e3a8a', background: 'rgba(37,99,235,0.07)', border: '1px solid rgba(37,99,235,0.22)', borderRadius: 8, padding: '0.5rem 0.75rem' }}>
          The team continues on a new version: <Link to={`/tickets/${nextVersion.id}`} style={{ fontWeight: 800 }}>{nextVersion.ticket_number}</Link>
        </p>
      )}
      {info && <p role="status" style={{ fontSize: '0.8rem', color: '#047857', background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8, padding: '0.5rem 0.75rem' }}>{info}</p>}

      {/* Client decision (signed-in portal) */}
      {isClient && pending && latest && (
        <div className="glass-card" style={{ padding: '1.1rem', borderColor: 'rgba(24,24,27,0.25)' }}>
          <p style={{ fontWeight: 800, fontFamily: 'var(--font-body)', color: '#0F172A', marginBottom: 4 }}>Your review is needed</p>
          <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 10 }}>Please review version {pending.proof_version ?? latest.version} below, then approve it or tell us what to change. You can click the design to mark exactly where.</p>
          {!deciding ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn-primary" style={{ background: '#059669', borderColor: '#059669' }} onClick={() => setDeciding({ id: pending.id, mode: 'approve' })}><CheckCircle2 size={14} /> Approve</button>
              <button type="button" className="btn-ghost" onClick={() => setDeciding({ id: pending.id, mode: 'request_changes' })}><RotateCcw size={14} /> Request changes</button>
            </div>
          ) : (
            <form onSubmit={decide} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label htmlFor="decision-comment" className="section-label">{deciding.mode === 'approve' ? 'Comment (optional)' : 'What should we change?'}</label>
              <textarea id="decision-comment" className="input-field" rows={3} maxLength={2000} required={deciding.mode === 'request_changes' && pendingMarks === 0} value={comment} onChange={e => setComment(e.target.value)} />
              {deciding.mode === 'approve' && <p style={{ fontSize: '0.74rem', color: '#64748b' }}>Approving tells the team this design is final.</p>}
              {deciding.mode === 'request_changes' && pendingMarks > 0 && <p style={{ fontSize: '0.74rem', color: '#64748b' }}>Your {pendingMarks} marked spot{pendingMarks > 1 ? 's' : ''} will be sent with this. A note is optional.</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn-primary" disabled={busy} style={deciding.mode === 'approve' ? { background: '#059669', borderColor: '#059669' } : undefined}>{busy ? 'Sending…' : deciding.mode === 'approve' ? 'Confirm approval' : 'Send feedback'}</button>
                <button type="button" className="btn-ghost" onClick={() => { setDeciding(null); setComment(''); }}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Staff: upload */}
      {!isClient && (
        <div className="glass-card" style={{ padding: '1rem', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="proof-note" className="section-label" style={{ display: 'block', marginBottom: 4 }}>Note for this version (optional)</label>
            <input id="proof-note" className="input-field" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Updated logo size" />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: '#475569', width: '100%' }}>
            <input type="checkbox" checked={sendNow} onChange={e => setSendNow(e.target.checked)} style={{ accentColor: '#18181b' }} />
            Send to the client for approval when uploaded
          </label>
          <input ref={fileRef} type="file" hidden aria-label="Choose proof file" accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.zip,.psd,.ai" onChange={e => void upload(e.target.files?.[0])} />
          <button type="button" className="btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={14} /> {busy ? 'Uploading…' : sendNow ? 'Upload & send for approval' : 'Upload draft'}</button>
        </div>
      )}

      {/* One-time link */}
      {created && (
        <div className="glass-card" style={{ padding: '1rem', borderColor: 'rgba(16,185,129,0.35)' }}>
          <p style={{ fontWeight: 800, color: '#047857', fontSize: '0.85rem', marginBottom: 4 }}><Link2 size={13} style={{ display: 'inline', marginRight: 5 }} />Review link</p>
          <p style={{ fontSize: '0.74rem', color: '#64748b', marginBottom: 8 }}>The client can review in their portal. This link is only for people without an account. For security it is shown once — if you lose it, create a new one.</p>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input-field" readOnly aria-label="Review link" value={created.review_url} onFocus={e => e.currentTarget.select()} style={{ fontSize: '0.76rem' }} />
            <button type="button" className="btn-ghost" onClick={() => void copyLink()}><Clipboard size={13} /> {copied ? 'Copied' : 'Copy'}</button>
          </div>
          <button type="button" className="chip" style={{ marginTop: 8 }} onClick={() => setCreated(null)}>Dismiss</button>
        </div>
      )}

      {loading && <p role="status" style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Loading proofs…</p>}
      {!loading && proofs.length === 0 && (
        <div className="glass-card" style={{ padding: '2rem', textAlign: 'center', border: '2px dashed rgba(226,232,240,0.9)' }}>
          <p style={{ fontWeight: 700, color: '#0F172A' }}>No proofs yet</p>
          <p style={{ fontSize: '0.82rem', color: '#64748b', marginTop: 4 }}>{isClient ? 'The design team will share work for your review here.' : 'Upload the first version of the design to start the approval process.'}</p>
        </div>
      )}

      {isRedo && askedForChanges && parentData && (
        <div className="glass-card" style={{ padding: '1rem' }} aria-labelledby={`chg-${ticket.id}`}>
          <h3 id={`chg-${ticket.id}`} className="section-label" style={{ marginBottom: 4 }}>
            Changes requested on {parentNumber}
          </h3>
          <p style={{ fontSize: '0.76rem', color: '#64748b', marginBottom: 8 }}>
            This version carries those changes out. {isClient ? 'Tick each item off as you check it.' : 'Tick each item off as you finish it.'}
          </p>
          {askedForChanges.decision_comment && (
            <p style={{ fontSize: '0.82rem', color: '#334155', fontStyle: 'italic', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginBottom: 8 }}>
              “{askedForChanges.decision_comment}”{askedForChanges.decided_by_name ? ` — ${askedForChanges.decided_by_name}` : ''}
            </p>
          )}
          {parentData.pins.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {parentData.pins.map(m => (
                <li key={m.id}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.82rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={m.is_resolved} onChange={() => void toggleOn(ticket.parent_id as string, { id: m.id, x: 0, y: 0, content: m.content, author: m.author_name ?? '', resolved: m.is_resolved })} style={{ marginTop: 3, accentColor: '#059669' }} />
                    <span style={{ textDecoration: m.is_resolved ? 'line-through' : 'none', color: m.is_resolved ? '#94a3b8' : '#334155', overflowWrap: 'anywhere' }}>
                      <span style={{ color: '#94a3b8' }}>Version {earlierProofVersion.get(Number(m.image_url.slice(6)))}:</span> {m.content}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {chainImages >= 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <button type="button" className="btn-ghost" aria-expanded={comparing} onClick={() => setComparing(c => !c)}>
              <Columns2 size={14} aria-hidden="true" /> {comparing ? 'Hide comparison' : 'Compare versions'}
            </button>
          </div>
          {comparing && <ProofCompare proofs={chainProofs} requests={chainRequests} />}
        </div>
      )}

      {proofs.map(p => (
        <div key={p.id} className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '0.75rem 1rem', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', borderBottom: '1px solid rgba(226,232,240,0.8)' }}>
            <span className="badge-blue">Version {p.version}</span>
            {p.id === latest?.id && <span className="badge-green">Latest</span>}
            <span style={{ fontSize: '0.78rem', color: '#475569', flex: 1, minWidth: 120, overflowWrap: 'anywhere' }}>{p.file_name}{p.note ? ` — ${p.note}` : ''}</span>
            <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{fmt(p.created_at)}</span>
            <button type="button" className="chip" onClick={() => downloadFile(`/api/proofs/${p.id}/file`, p.file_name).catch(e => setError(e instanceof Error ? e.message : 'Download failed'))}><Download size={11} /> Download</button>
            {!isClient && (
              <button type="button" className="chip" onClick={() => { setSendFor(sendFor === p.id ? null : p.id); setCreated(null); }}><Send size={11} /> {p.id === latest?.id ? 'Share link' : 'Send this version'}</button>
            )}
          </div>
          {sendFor === p.id && (
            <form onSubmit={e => { e.preventDefault(); void sendForApproval(p); }} style={{ padding: '0.75rem 1rem', background: '#F8FAFC', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
              <div>
                <label htmlFor={`ttl-${p.id}`} className="section-label" style={{ display: 'block', marginBottom: 4 }}>Link valid for</label>
                <select id={`ttl-${p.id}`} className="input-field" value={days} onChange={e => setDays(e.target.value)}>
                  {['3', '7', '14', '30'].map(d => <option key={d} value={d}>{d} days</option>)}
                </select>
              </div>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create link'}</button>
            </form>
          )}
          {p.content_type?.startsWith('image/') ? (
            <div style={{ padding: '0.75rem', background: '#F1F5F9' }}>
              <PinnableImage proofId={p.id} name={p.file_name} pins={pinItems(p.id)}
                canAdd={isClient && pending?.proof_version_id === p.id} canToggle
                onAdd={(x, y, text) => addPin(p.id, x, y, text)} onToggle={pin => void togglePin(pin)} />
            </div>
          ) : (
            <p style={{ padding: '0.75rem 1rem', fontSize: '0.78rem', color: '#64748b' }}>This file type can't be previewed — use Download to open it.</p>
          )}
        </div>
      ))}

      {(chainProofs.length > 1 || chainRequests.length > 0) && <RevisionTimeline proofs={chainProofs} requests={chainRequests} />}

      {requests.length > 0 && (
        <div className="glass-card" style={{ padding: '1rem' }}>
          <h3 className="section-label" style={{ marginBottom: 8 }}>Approval history</h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {requests.map(r => {
              const st = STATUS_LABEL[r.status];
              return (
                <li key={r.id} style={{ fontSize: '0.78rem', color: '#475569', borderLeft: '2px solid rgba(24,24,27,0.2)', paddingLeft: 10 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <span className={st.cls}>{st.text}</span>
                    <strong>Version {r.proof_version ?? '?'}</strong>
                    {r.decided_by_name && <span>by {r.decided_by_name} · {fmt(r.decided_at)}</span>}
                    {r.status === 'pending' && <span style={{ color: '#94a3b8' }}>expires {fmt(r.expires_at)}</span>}
                    {!isClient && r.status === 'pending' && <button type="button" className="chip" style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={() => void revoke(r.id)}><XCircle size={11} /> Withdraw link</button>}
                  </div>
                  {r.decision_comment && <p style={{ marginTop: 4, fontStyle: 'italic', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>“{r.decision_comment}”</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

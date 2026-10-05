import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, Download, FileWarning, Loader2, MessageSquare, Ban, WifiOff } from 'lucide-react';
import { publicJson, ApiError, API_BASE } from '../api';

type Status = 'pending' | 'approved' | 'changes_requested' | 'revoked' | 'expired';
interface Review {
  status: Status;
  expires_at: string;
  decided_at: string | null;
  decision_comment: string | null;
  ticket: { ticket_number: string; title: string; brief: string };
  proof: { version: number; file_name: string; content_type: string | null; note: string | null } | null;
}

const BLUE = '#18181b';
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const MAX = 2000;

const cardStyle: CSSProperties = {
  background: '#fff', borderRadius: 16, padding: 'clamp(16px, 5vw, 32px)',
  boxShadow: '0 1px 3px rgba(15,23,42,0.08), 0 8px 24px rgba(15,23,42,0.06)', border: '1px solid #e2e8f0',
};
const btn: CSSProperties = {
  minHeight: 48, padding: '0 20px', borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', border: '2px solid transparent',
};
const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: 48, padding: '10px 12px', fontSize: 16,
  border: '1px solid #94a3b8', borderRadius: 10, fontFamily: 'inherit', color: '#0f172a', background: '#fff',
};
const labelStyle: CSSProperties = { display: 'block', fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 6 };

function Shell({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f9', color: '#0f172a', overflowX: 'hidden' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '10px 16px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <img src="/mccia_logo.png" alt="MCCIA Applied AI Studio" style={{ height: 40, maxWidth: '100%', objectFit: 'contain' }} />
        </div>
      </header>
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '20px 16px 48px' }}>{children}</main>
    </div>
  );
}

function Notice({ icon, color, title, children, action }: { icon: ReactNode; color: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ ...cardStyle, textAlign: 'center' }}>
      <div style={{ color, display: 'flex', justifyContent: 'center', marginBottom: 12 }} aria-hidden="true">{icon}</div>
      <h1 style={{ fontFamily: 'var(--font-body)', fontSize: 22, margin: '0 0 8px', color: '#0f172a' }}>{title}</h1>
      <div style={{ color: '#475569', fontSize: 16, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{children}</div>
      {action && <div style={{ marginTop: 20, maxWidth: 240, marginInline: 'auto' }}>{action}</div>}
    </div>
  );
}

export default function ReviewPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<{ status: number; message: string } | null>(null);

  const [name, setName] = useState('');
  const [mode, setMode] = useState<'none' | 'approve' | 'changes'>('none');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [done, setDone] = useState<null | 'approved' | 'changes_requested'>(null);
  const [imgErr, setImgErr] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const r = await publicJson<Review>(`/api/public/review/${encodeURIComponent(token ?? '')}`);
      setData(r);
    } catch (e) {
      const err = e as ApiError;
      setLoadErr({ status: err.status ?? 0, message: err.message });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { setLoading(true); void load(); }, [load]);

  async function submit(decision: 'approve' | 'request_changes') {
    if (busy.current) return;
    setFormErr('');
    const n = name.trim();
    if (!n) { setFormErr('Please enter your name.'); return; }
    if (decision === 'request_changes' && !comment.trim()) { setFormErr('Please describe what you would like changed.'); return; }
    busy.current = true;
    setSubmitting(true);
    try {
      const body: { decision: string; name: string; comment?: string } = { decision, name: n };
      if (comment.trim()) body.comment = comment.trim();
      const r = await publicJson<{ ok: boolean; status: 'approved' | 'changes_requested' }>(
        `/api/public/review/${encodeURIComponent(token ?? '')}/decision`, { method: 'POST', json: body });
      setDone(r.status);
    } catch (e) {
      const err = e as ApiError;
      setFormErr(err.status === 429 ? 'Too many requests. Please wait a minute and try again.' : err.message || 'Something went wrong.');
      if (err.status === 409 || err.status === 410) void load();
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Shell>
        <div role="status" aria-live="polite" style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12, color: '#475569' }}>
          <Loader2 size={22} style={{ animation: 'app-spin 1s linear infinite' }} aria-hidden="true" />
          <span>Loading your review…</span>
        </div>
      </Shell>
    );
  }

  if (loadErr || !data) {
    const s = loadErr?.status ?? 0;
    if (s === 404) return <Shell><Notice icon={<FileWarning size={44} />} color="#EF4444" title="This review link isn't valid">Please check the link in your email, or ask the design team to send it again.</Notice></Shell>;
    if (s === 429) return <Shell><Notice icon={<Clock size={44} />} color="#f59e0b" title="Too many requests" action={<button type="button" onClick={() => { setLoading(true); void load(); }} style={{ ...btn, background: BLUE, color: '#fff' }}>Retry</button>}>Please wait a minute and try again.</Notice></Shell>;
    return (
      <Shell>
        <Notice icon={<WifiOff size={44} />} color="#EF4444" title="Can't reach the server"
          action={<button type="button" onClick={() => { setLoading(true); void load(); }} style={{ ...btn, background: BLUE, color: '#fff' }}>Retry</button>}>
          Check your internet connection and try again.
        </Notice>
      </Shell>
    );
  }

  const { ticket, proof } = data;
  const fileUrl = `${API_BASE}/api/public/review/${encodeURIComponent(token ?? '')}/file`;
  const isImage = !!proof?.content_type?.startsWith('image/');
  const effective: Status | 'just_done' = done ? 'just_done' : data.status;

  const header = (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: BLUE, letterSpacing: 0.3 }}>{ticket.ticket_number}</div>
      <h1 style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(20px, 6vw, 26px)', margin: '4px 0 0', color: '#0f172a', overflowWrap: 'anywhere' }}>{ticket.title}</h1>
    </div>
  );

  const terminal = (): ReactNode => {
    if (effective === 'just_done') {
      const ok = done === 'approved';
      return (
        <div role="status" style={{ textAlign: 'center', padding: '8px 0' }}>
          <div style={{ color: ok ? '#10B981' : '#f59e0b' }} aria-hidden="true">{ok ? <CheckCircle2 size={44} /> : <MessageSquare size={44} />}</div>
          <h2 style={{ fontFamily: 'var(--font-body)', fontSize: 20, margin: '8px 0' }}>{ok ? 'Thanks — approved' : "Thanks — we've sent your feedback to the design team"}</h2>
          <p style={{ color: '#475569', margin: 0 }}>You can now close this page.</p>
        </div>
      );
    }
    const quote = data.decision_comment && (
      <blockquote style={{ margin: '12px 0 0', padding: '10px 14px', background: '#f8fafc', borderLeft: `4px solid ${BLUE}`, textAlign: 'left', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#0f172a' }}>{data.decision_comment}</blockquote>
    );
    if (effective === 'approved') return (
      <div style={{ textAlign: 'center' }}><div style={{ color: '#10B981' }} aria-hidden="true"><CheckCircle2 size={40} /></div>
        <h2 style={{ fontFamily: 'var(--font-body)', fontSize: 20, margin: '8px 0' }}>Approved</h2>
        <p style={{ color: '#475569', margin: 0 }}>This design was approved on {fmt(data.decided_at)}.</p>{quote}</div>
    );
    if (effective === 'changes_requested') return (
      <div style={{ textAlign: 'center' }}><div style={{ color: '#f59e0b' }} aria-hidden="true"><MessageSquare size={40} /></div>
        <h2 style={{ fontFamily: 'var(--font-body)', fontSize: 20, margin: '8px 0' }}>Changes requested</h2>
        <p style={{ color: '#475569', margin: 0 }}>Changes were requested on {fmt(data.decided_at)}.</p>{quote}</div>
    );
    if (effective === 'expired') return (
      <div style={{ textAlign: 'center' }}><div style={{ color: '#f59e0b' }} aria-hidden="true"><Clock size={40} /></div>
        <h2 style={{ fontFamily: 'var(--font-body)', fontSize: 20, margin: '8px 0' }}>This link has expired</h2>
        <p style={{ color: '#475569', margin: 0 }}>Please ask the design team for a new one.</p></div>
    );
    return (
      <div style={{ textAlign: 'center' }}><div style={{ color: '#EF4444' }} aria-hidden="true"><Ban size={40} /></div>
        <h2 style={{ fontFamily: 'var(--font-body)', fontSize: 20, margin: '8px 0' }}>This link was withdrawn</h2>
        <p style={{ color: '#475569', margin: 0 }}>Please use the latest link from the design team.</p></div>
    );
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'changes') void submit('request_changes');
    else if (mode === 'none') setFormErr('Please choose Approve or Request changes.');
  };

  return (
    <Shell>
      <div style={cardStyle}>
        {header}
        {ticket.brief && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#475569', fontSize: 15, lineHeight: 1.55, margin: '0 0 20px' }}>{ticket.brief}</p>}

        {proof && (
          <section aria-label="Design proof" style={{ marginBottom: 20 }}>
            <span style={{ display: 'inline-block', background: '#e0ecfb', color: BLUE, fontWeight: 700, fontSize: 13, padding: '4px 10px', borderRadius: 999 }}>Version {proof.version}</span>
            {proof.note && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#fffbeb', border: '1px solid #fde68a', color: '#78350f', borderRadius: 10, padding: '10px 12px', margin: '12px 0 0', fontSize: 15 }}><strong>Note from the designer:</strong> {proof.note}</p>}
            <div style={{ marginTop: 12 }}>
              {isImage ? (imgErr ? (
                <p role="alert" style={{ color: '#B91C1C', background: '#fef2f2', borderRadius: 10, padding: 12, margin: 0 }}>We couldn't load the preview. Try refreshing, or ask the design team to resend the link.</p>
              ) : (
                <a href={fileUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${proof.file_name} full size in a new tab`}>
                  <img src={fileUrl} alt={proof.file_name} onError={() => setImgErr(true)} style={{ maxWidth: '100%', height: 'auto', display: 'block', margin: '0 auto', borderRadius: 10, border: '1px solid #e2e8f0' }} />
                </a>
              )) : (
                <a href={fileUrl} target="_blank" rel="noopener noreferrer" style={{ ...btn, background: BLUE, color: '#fff', textDecoration: 'none', boxSizing: 'border-box', overflowWrap: 'anywhere' }}>
                  <Download size={18} aria-hidden="true" /> Download {proof.file_name}
                </a>
              )}
            </div>
          </section>
        )}

        <hr style={{ border: 0, borderTop: '1px solid #e2e8f0', margin: '0 0 20px' }} />

        {effective !== 'pending' ? terminal() : (
          <form onSubmit={onSubmit} noValidate>
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="rv-name" style={labelStyle}>Your name</label>
              <input id="rv-name" style={inputStyle} value={name} maxLength={80} required autoComplete="name" onChange={(e) => setName(e.target.value)} disabled={submitting} />
            </div>

            {mode === 'changes' && (
              <div style={{ marginBottom: 16 }}>
                <label htmlFor="rv-changes" style={labelStyle}>What would you like changed?</label>
                <textarea id="rv-changes" style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }} value={comment} maxLength={MAX} required onChange={(e) => setComment(e.target.value)} disabled={submitting} />
                <div style={{ textAlign: 'right', fontSize: 13, color: comment.length > MAX - 100 ? '#B91C1C' : '#475569' }}>{comment.length} / {MAX}</div>
              </div>
            )}
            {mode === 'approve' && (
              <div style={{ marginBottom: 16 }}>
                <label htmlFor="rv-comment" style={labelStyle}>Comment (optional)</label>
                <textarea id="rv-comment" style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={comment} maxLength={MAX} onChange={(e) => setComment(e.target.value)} disabled={submitting} />
                <div style={{ textAlign: 'right', fontSize: 13, color: '#475569' }}>{comment.length} / {MAX}</div>
              </div>
            )}

            {formErr && (
              <p role="alert" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: '#B91C1C', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 12px', margin: '0 0 16px', fontSize: 15 }}>
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" /><span style={{ overflowWrap: 'anywhere' }}>{formErr}</span>
              </p>
            )}

            {mode === 'approve' ? (
              <div style={{ background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 12, padding: 16 }}>
                <p style={{ margin: '0 0 12px', color: '#065f46', fontWeight: 600 }}>Approve version {proof?.version ?? ''}? This tells the team the design is final.</p>
                <div style={{ display: 'grid', gap: 10 }}>
                  <button type="button" disabled={submitting} onClick={() => void submit('approve')} style={{ ...btn, background: '#047857', color: '#fff', opacity: submitting ? 0.7 : 1 }}>
                    {submitting ? <Loader2 size={18} style={{ animation: 'app-spin 1s linear infinite' }} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />} Yes, approve
                  </button>
                  <button type="button" disabled={submitting} onClick={() => setMode('none')} style={{ ...btn, background: '#fff', color: '#0f172a', borderColor: '#94a3b8' }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                <button type="button" disabled={submitting} onClick={() => { setFormErr(''); if (!name.trim()) { setFormErr('Please enter your name.'); return; } setMode('approve'); }} style={{ ...btn, background: '#047857', color: '#fff' }}>
                  <CheckCircle2 size={18} aria-hidden="true" /> Approve this design
                </button>
                {mode === 'changes' ? (
                  <button type="submit" disabled={submitting} style={{ ...btn, background: '#fffbeb', color: '#78350f', borderColor: '#f59e0b', opacity: submitting ? 0.7 : 1 }}>
                    {submitting && <Loader2 size={18} style={{ animation: 'app-spin 1s linear infinite' }} aria-hidden="true" />} Send change request
                  </button>
                ) : (
                  <button type="button" disabled={submitting} onClick={() => { setFormErr(''); setMode('changes'); }} style={{ ...btn, background: '#fff', color: '#0f172a', borderColor: '#f59e0b' }}>
                    <MessageSquare size={18} aria-hidden="true" /> Request changes
                  </button>
                )}
              </div>
            )}
          </form>
        )}
      </div>
      <p style={{ textAlign: 'center', color: '#475569', fontSize: 13, marginTop: 16 }}>Link valid until {fmt(data.expires_at)}</p>
    </Shell>
  );
}

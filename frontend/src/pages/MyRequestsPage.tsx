import { useEffect, useState, type FormEvent } from 'react';
import { Inbox } from 'lucide-react';
import { publicJson } from '../api';

interface MyRequest {
  ticket_number: string; title: string; design_type: string | null; status: string; current_step: number;
  awaiting_review: boolean; due_at: string | null; created_at: string | null; tracking_url: string;
}
interface MyRequests { name: string; steps: string[]; requests: MyRequest[] }

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/**
 * Everything one person has asked for, without signing in. /my-requests asks for an email and sends a link
 * (the client link now opens /client/<token>, which exchanges for a session); a request with ?token= here
 * still works directly against the no-login list. Only the inbox owner gets the link.
 */
export default function MyRequestsPage() {
  const token = new URLSearchParams(window.location.search).get('token');
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app, #FAFAFA)', padding: '2rem 1rem' }}>
      <main style={{ maxWidth: 760, margin: '0 auto' }}>
        <img src="/mccia_logo.png" alt="MCCIA Applied AI Studio" style={{ height: 44, marginBottom: 16 }} />
        {token ? <RequestList token={token} /> : <AskForLink />}
      </main>
    </div>
  );
}

function AskForLink() {
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const body: { email: string; company?: string } = { email: email.trim() };
      if (company.trim()) body.company = company.trim();
      setSent((await publicJson<{ detail: string }>('/api/public/client-link', { method: 'POST', json: body })).detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <div className="glass-card" style={{ padding: '1.75rem', maxWidth: 480 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div className="icon-tile" aria-hidden="true"><Inbox size={18} /></div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-strong)' }}>See your requests &amp; campaigns</h1>
      </div>
      {sent ? (
        <p role="status" style={{ fontSize: '0.9rem', color: 'var(--text-soft)', lineHeight: 1.6 }}>{sent} Open it from your inbox to see every request, and to add campaigns and posts.</p>
      ) : (
        <form onSubmit={e => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-soft)', lineHeight: 1.6 }}>
            No account or password needed. Enter your email and we'll send you a link to your requests and campaigns.
          </p>
          <div>
            <label htmlFor="mr-email" className="login-label">Email address</label>
            <input id="mr-email" type="email" required autoComplete="email" autoFocus className="input-field" style={{ width: '100%' }}
              value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div>
            <label htmlFor="mr-company" className="login-label">Company <span style={{ fontWeight: 400, color: 'var(--text-hint)' }}>(only needed the first time)</span></label>
            <input id="mr-company" type="text" autoComplete="organization" className="input-field" style={{ width: '100%' }}
              value={company} onChange={e => setCompany(e.target.value)} placeholder="Only if you haven't requested a design yet" />
          </div>
          {error && <p role="alert" style={{ fontSize: '0.84rem', color: 'var(--danger-text)', fontWeight: 600 }}>{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy} style={{ justifyContent: 'center' }}>
            {busy ? 'Sending…' : 'Email me the link'}
          </button>
        </form>
      )}
      <p style={{ fontSize: '0.85rem', marginTop: '1.25rem' }}><a className="login-link-btn" href="/request">Submit a new request</a></p>
    </div>
  );
}

function RequestList({ token }: { token: string }) {
  const [data, setData] = useState<MyRequests | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    publicJson<MyRequests>(`/api/public/my-requests?token=${encodeURIComponent(token)}`).then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load your requests.'));
  }, [token]);

  if (error) {
    return (
      <div className="glass-card" style={{ padding: '1.5rem' }}>
        <p role="alert" style={{ color: 'var(--danger-text)', fontWeight: 600 }}>{error}</p>
        <p style={{ fontSize: '0.85rem', marginTop: 10 }}><a className="login-link-btn" href="/my-requests">Get a new link</a></p>
      </div>
    );
  }
  if (!data) return <p role="status" style={{ color: 'var(--text-hint)' }}>Loading…</p>;

  const open = data.requests.filter(r => r.current_step < data.steps.length - 1).length;
  return (
    <>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-strong)' }}>Hi {data.name}, here are your requests</h1>
      <p style={{ fontSize: '0.88rem', color: 'var(--text-soft)', margin: '4px 0 18px' }}>
        {data.requests.length === 0 ? 'You have no requests yet.' : `${data.requests.length} in total, ${open} still in progress.`}{' '}
        <a className="login-link-btn" href="/request">Submit a new request</a>
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.requests.map(r => (
          <li key={r.ticket_number} className="glass-card" style={{ padding: '1rem 1.15rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: '0.72rem', fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-hint)' }}>
                  {r.ticket_number}{r.design_type ? ` · ${r.design_type}` : ''}
                </p>
                <h2 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-strong)', margin: '2px 0' }}>{r.title}</h2>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-soft)' }}>
                  <strong>{r.status}</strong> · Expected by {day(r.due_at)} · Sent {day(r.created_at)}
                </p>
                {r.awaiting_review && (
                  <p style={{ fontSize: '0.8rem', color: '#92400e', marginTop: 4, fontWeight: 600 }}>
                    A design is waiting for your approval: use the review link in your email.
                  </p>
                )}
              </div>
              <a href={r.tracking_url} className="btn-ghost" style={{ whiteSpace: 'nowrap', textDecoration: 'none' }}>Track</a>
            </div>
            <div aria-hidden="true" style={{ display: 'flex', gap: 4, marginTop: 10 }}>
              {data.steps.map((s, i) => (
                <span key={s} title={s} style={{ flex: 1, height: 5, borderRadius: 99, background: i <= r.current_step ? '#0B1F3A' : '#E2E8F0' }} />
              ))}
            </div>
          </li>
        ))}
      </ul>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-hint)', marginTop: 16 }}>This link is personal: don't forward it.</p>
    </>
  );
}

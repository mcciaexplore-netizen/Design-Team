import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { publicJson } from '../api';

interface Tracking {
  ticket_number: string; title: string; status: string; steps: string[]; current_step: number;
  design_type: string | null; due_at: string | null; created_at: string | null;
  history: { at: string | null; text: string }[];
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** Public page behind the tracking link in the confirmation email: no sign-in, nothing personal shown. */
export default function TrackPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [data, setData] = useState<Tracking | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    publicJson<Tracking>(`/api/public/track/${encodeURIComponent(token)}`).then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load this request.'));
  }, [token]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app, #f4f4f5)', padding: '2rem 1rem' }}>
      <main style={{ maxWidth: 640, margin: '0 auto' }}>
        <img src="/mccia_logo.png" alt="MCCIA Applied AI Studio" style={{ height: 44, marginBottom: 16 }} />
        {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
        {!data && !error && <p role="status" style={{ color: '#94a3b8' }}>Loading…</p>}
        {data && (
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <p style={{ fontSize: '0.72rem', fontFamily: 'monospace', fontWeight: 700, color: '#64748b' }}>{data.ticket_number}{data.design_type ? ` · ${data.design_type}` : ''}</p>
            <h1 style={{ fontSize: '1.3rem', fontWeight: 800, margin: '4px 0 2px' }}>{data.title}</h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-soft)' }}>
              Status: <strong>{data.status}</strong>{data.due_at ? ` · Expected by ${fmt(data.due_at)}` : ''}
            </p>

            <ol aria-label="Progress" style={{ listStyle: 'none', display: 'flex', gap: 6, padding: 0, margin: '1.25rem 0', flexWrap: 'wrap' }}>
              {data.steps.map((step, i) => {
                const done = i < data.current_step, current = i === data.current_step;
                return (
                  <li key={step} aria-current={current ? 'step' : undefined}
                    style={{ flex: '1 1 90px', textAlign: 'center', fontSize: '0.72rem', fontWeight: 700, padding: '0.5rem 0.25rem', borderRadius: 8,
                             background: current ? '#18181b' : done ? 'rgba(16,185,129,0.12)' : '#F1F5F9', color: current ? 'white' : done ? '#047857' : '#94a3b8' }}>
                    {done && <Check size={12} aria-hidden="true" style={{ marginRight: 3, verticalAlign: '-1px' }} />}{step}
                  </li>
                );
              })}
            </ol>

            <h2 className="section-label" style={{ marginBottom: 8 }}>Activity</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.history.map((h, i) => (
                <li key={`${h.at}-${i}`} style={{ fontSize: '0.84rem', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>{h.text}</span><span style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmt(h.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}

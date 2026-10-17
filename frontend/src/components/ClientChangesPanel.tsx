import { useState, type FormEvent } from 'react';
import { MessageSquareDiff } from 'lucide-react';
import { apiJson } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useTickets } from '../contexts/TicketsContext';
import type { Ticket } from '../types';

interface ClientChange { text: string; at: string; by: string }

const when = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Changes the client asked for outside the app (a call, an email, a meeting), written down by the team so the
 *  designer works from them. Everyone on the ticket sees them; only the team can add them. */
export default function ClientChangesPanel({ ticket }: { ticket: Ticket }) {
  const { user } = useAuth();
  const { refresh } = useTickets();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isStaff = user?.role === 'Design Lead' || user?.role === 'Designer';
  const raw = ticket.type_specific_fields?.client_changes;
  const changes = (Array.isArray(raw) ? raw : []) as ClientChange[];

  if (!isStaff && changes.length === 0) return null;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setError(null);
    try {
      await apiJson(`/api/tickets/${ticket.id}/client-changes`, { method: 'POST', json: { text: text.trim() } });
      setText('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the changes.');
    } finally { setBusy(false); }
  };

  return (
    <div className="glass-card" style={{ padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <MessageSquareDiff size={14} aria-hidden="true" style={{ color: '#B45309' }} />
        <h3 className="section-label">Changes from the client{changes.length ? ` (${changes.length})` : ''}</h3>
      </div>

      {changes.length > 0 && (
        <ol style={{ listStyle: 'none', padding: 0, margin: '0 0 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {changes.map((c, i) => (
            <li key={`${c.at}-${i}`} style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
              <p style={{ fontSize: '0.85rem', color: '#0F172A', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.55 }}>{c.text}</p>
              <p style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 4 }}>Added by {c.by} · {when(c.at)}</p>
            </li>
          ))}
        </ol>
      )}

      {isStaff && (ticket.is_locked ? (
        <p style={{ fontSize: '0.8rem', color: '#64748B' }}>This request is closed. Further changes need a new request.</p>
      ) : (
        <form onSubmit={e => void add(e)} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label htmlFor={`cc-${ticket.id}`} style={{ fontSize: '0.8rem', color: '#475569' }}>
            The client asked for changes by phone, email or in person? Write them here: the designer is notified.
          </label>
          <textarea id={`cc-${ticket.id}`} className="input-field" rows={3} maxLength={2000} value={text} onChange={e => setText(e.target.value)}
            placeholder="e.g. Use the new logo, change the date to 25 Oct, make the title bigger" style={{ resize: 'vertical' }} />
          {error && <p role="alert" style={{ fontSize: '0.78rem', color: '#b91c1c' }}>{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy || !text.trim()} style={{ alignSelf: 'flex-start' }}>
            {busy ? 'Saving…' : 'Add changes'}
          </button>
        </form>
      ))}
    </div>
  );
}

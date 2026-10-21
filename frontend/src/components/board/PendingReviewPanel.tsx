import { Check, Clock, X } from 'lucide-react';
import type { Ticket } from '../../types';

interface Props {
  tickets: Ticket[];
  onAccept: (t: Ticket) => void;
  onDecline: (t: Ticket) => void;
}

/** Design-Lead-only queue: requests a client submitted, not yet accepted into the board. */
export default function PendingReviewPanel({ tickets, onAccept, onDecline }: Props) {
  if (!tickets.length) return null;
  return (
    <section aria-labelledby="pending-review-h" className="glass-card"
      style={{ padding: '0.9rem 1.1rem', marginBottom: '0.9rem', border: '1px solid rgba(180,83,9,0.25)', background: 'rgba(180,83,9,0.04)' }}>
      <h2 id="pending-review-h" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.92rem', fontWeight: 800, color: '#92400e', marginBottom: 8 }}>
        <Clock size={15} aria-hidden="true" /> Pending review ({tickets.length})
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tickets.map(t => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '0.6rem 0.75rem', background: 'white', borderRadius: 10, border: '1px solid rgba(226,232,240,0.9)' }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <p style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#475569', fontWeight: 700 }}>{t.number}{t.design_type ? ` · ${t.design_type}` : ''}</p>
              <p style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0F172A', overflowWrap: 'anywhere' }}>{t.title}</p>
              <p style={{ fontSize: '0.76rem', color: '#64748B' }}>From {t.requester_name ?? 'a client'}{t.client_org ? ` · ${t.client_org}` : ''}</p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn-primary" style={{ gap: 5, padding: '0.4rem 0.75rem', fontSize: '0.78rem' }} onClick={() => onAccept(t)}>
                <Check size={13} aria-hidden="true" /> Accept
              </button>
              <button type="button" className="btn-ghost" style={{ gap: 5, padding: '0.4rem 0.75rem', fontSize: '0.78rem' }} onClick={() => onDecline(t)}>
                <X size={13} aria-hidden="true" /> Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

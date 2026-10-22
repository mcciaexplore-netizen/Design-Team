import { useState } from 'react';
import { Check, Clock, X } from 'lucide-react';
import { PRIORITY_STYLE, type Ticket } from '../../types';
import { SLABadge } from './TicketCard';

interface Props {
  tickets: Ticket[];
  onAccept: (t: Ticket) => void;
  onDecline: (t: Ticket) => void;
  onBulkAccept: (tickets: Ticket[]) => void;
}

/** Design-Lead-only queue: requests a client submitted, not yet accepted into the board. */
export default function PendingReviewPanel({ tickets, onAccept, onDecline, onBulkAccept }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  if (!tickets.length) return null;

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allSelected = tickets.every(t => selected.has(t.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(tickets.map(t => t.id)));
  const acceptSelected = () => {
    onBulkAccept(tickets.filter(t => selected.has(t.id)));
    setSelected(new Set());
  };

  return (
    <section aria-labelledby="pending-review-h" className="glass-card"
      style={{ padding: '0.9rem 1.1rem', marginBottom: '0.9rem', border: '1px solid rgba(180,83,9,0.25)', background: 'rgba(180,83,9,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <h2 id="pending-review-h" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.92rem', fontWeight: 800, color: '#92400e' }}>
          <Clock size={15} aria-hidden="true" /> Pending review ({tickets.length})
        </h2>
        {selected.size > 0 && (
          <button type="button" className="btn-primary" style={{ gap: 5, padding: '0.35rem 0.7rem', fontSize: '0.76rem' }} onClick={acceptSelected}>
            <Check size={13} aria-hidden="true" /> Accept {selected.size} selected
          </button>
        )}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.74rem', fontWeight: 700, color: '#64748B', marginBottom: 6, cursor: 'pointer' }}>
        <input type="checkbox" checked={allSelected} onChange={toggleAll} /> Select all
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tickets.map(t => {
          const department = t.type_specific_fields?.department;
          return (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '0.6rem 0.75rem', background: 'white', borderRadius: 10, border: '1px solid rgba(226,232,240,0.9)' }}>
              <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ${t.number}`} />
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <p style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#475569', fontWeight: 700 }}>{t.number}{t.design_type ? ` · ${t.design_type}` : ''}</p>
                <p style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0F172A', overflowWrap: 'anywhere' }}>{t.title}</p>
                <p style={{ fontSize: '0.76rem', color: '#64748B' }}>
                  From {t.requester_name ?? 'a client'}{t.client_org ? ` · ${t.client_org}` : ''}{typeof department === 'string' && department ? ` · ${department}` : ''}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <SLABadge dueAt={t.due_at} />
                <span className="badge-blue" style={PRIORITY_STYLE[t.priority] ?? {}}>{t.priority}</span>
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
          );
        })}
      </div>
    </section>
  );
}

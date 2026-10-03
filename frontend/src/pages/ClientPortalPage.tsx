import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Ticket as TicketIcon, CheckCircle, Clock, ChevronDown, ChevronUp, MessageSquare } from 'lucide-react';
import { useTickets } from '../contexts/TicketsContext';
import ProofApprovalPanel from '../components/ProofApprovalPanel';
import CommentsPanel from '../components/CommentsPanel';

const DONE = ['Delivered', 'Closed', 'Closed without approval'];

function when(due: string, status: string): string {
  if (DONE.includes(status)) return status === 'Delivered' ? 'Delivered' : status;
  if (!due) return 'Date to be confirmed';
  const d = new Date(due);
  return `Expected by ${d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`;
}

const ClientPortalPage = ({ onNewRequest }: { onNewRequest?: () => void }) => {
  const { tickets, loading, error, refresh } = useTickets();
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');

  const shown = tickets.filter(t => (filter === 'all' ? true : filter === 'done' ? DONE.includes(t.status) : !DONE.includes(t.status)));
  const needsYou = tickets.filter(t => t.status === 'In Review').length;

  return (
    <div style={{ padding: '0.25rem 0 2rem' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <div>
            <h1 style={{ fontSize: 'clamp(1.4rem,3vw,2rem)', fontFamily: 'var(--font-heading)', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>My requests</h1>
            <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: 4 }}>Track progress, review designs and talk to the team.</p>
          </div>
          <button type="button" className="btn-primary" style={{ fontSize: '0.82rem' }} onClick={onNewRequest}>+ New request</button>
        </div>

        {needsYou > 0 && (
          <p role="status" style={{ background: 'rgba(0,63,138,0.06)', border: '1px solid rgba(0,63,138,0.18)', color: '#003F8A', borderRadius: 10, padding: '0.6rem 0.9rem', fontSize: '0.84rem', fontWeight: 600, marginBottom: '1rem' }}>
            {needsYou} design{needsYou > 1 ? 's are' : ' is'} waiting for your review.
          </p>
        )}

        <div role="group" aria-label="Show requests" style={{ display: 'inline-flex', border: '1px solid rgba(226,232,240,0.9)', borderRadius: 9, overflow: 'hidden', background: 'white', marginBottom: '1rem' }}>
          {([['open', 'In progress'], ['done', 'Completed'], ['all', 'All']] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
              style={{ padding: '0.4rem 0.9rem', fontSize: '0.78rem', fontWeight: 700, border: 'none', cursor: 'pointer', background: filter === k ? 'var(--brand-soft)' : 'transparent', color: filter === k ? 'var(--brand)' : '#64748b' }}>{label}</button>
          ))}
        </div>

        {error && <p role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem', marginBottom: 12 }}>{error} <button type="button" className="chip" onClick={() => void refresh()}>Retry</button></p>}
        {loading && tickets.length === 0 && <p role="status" style={{ color: '#94a3b8' }}>Loading your requests…</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {shown.map((ticket, i) => {
            const done = DONE.includes(ticket.status);
            const open = openId === ticket.id;
            const reviewing = ticket.status === 'In Review';
            return (
              <div key={ticket.id} className="glass-card animate-fade-in-up" style={{ overflow: 'hidden', animationDelay: `${i * 60}ms`, animationFillMode: 'both', padding: 0, borderColor: reviewing ? 'rgba(0,63,138,0.3)' : undefined }}>
                <div style={{ padding: '1.1rem 1.4rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-btn)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                  background: done ? 'rgba(16,185,129,0.08)' : 'rgba(0,63,138,0.06)', border: done ? '1px solid rgba(16,185,129,0.15)' : '1px solid rgba(0,63,138,0.12)', color: done ? '#059669' : '#003F8A' }}>
                      {done ? <CheckCircle size={18} /> : <Clock size={18} />}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: '#64748b', fontWeight: 600 }}>{ticket.number}</span>
                        <h3 style={{ fontSize: '0.92rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: '#0F172A', overflowWrap: 'anywhere' }}>
                          <Link to={`/tickets/${ticket.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{ticket.title}</Link>
                        </h3>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: '#64748B', marginTop: 3 }}>{when(ticket.due_at, ticket.status)}{ticket.assignee ? ` · with ${ticket.assignee}` : ''}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={done ? 'badge-green' : reviewing ? 'badge-red' : 'badge-blue'}>{reviewing ? 'Needs your review' : ticket.status}</span>
                    <button type="button" className="chip" aria-expanded={open} onClick={() => setOpenId(open ? null : ticket.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {open ? <>Hide <ChevronUp size={12} /></> : <>{reviewing ? 'Review' : 'Details'} <ChevronDown size={12} /></>}
                      {(ticket.comment_count ?? 0) > 0 && !open && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: '#64748b' }}><MessageSquare size={10} />{ticket.comment_count}</span>}
                    </button>
                  </div>
                </div>

                {open && (
                  <div style={{ padding: '1.25rem 1.4rem', background: '#F8FAFC', borderTop: '1px solid rgba(226,232,240,0.85)', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    <ProofApprovalPanel ticket={ticket} />
                    <CommentsPanel ticketId={ticket.id} compact />
                  </div>
                )}
              </div>
            );
          })}

          {!loading && shown.length === 0 && (
            <div className="glass-card" style={{ textAlign: 'center', padding: '4rem 2rem', border: '2px dashed rgba(226,232,240,0.85)' }}>
              <div style={{ width: 56, height: 56, borderRadius: 'var(--radius-btn)', background: 'rgba(0,63,138,0.06)', border: '1px solid rgba(0,63,138,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', color: '#003F8A' }}>
                <TicketIcon size={24} />
              </div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: '#0F172A' }}>{filter === 'done' ? 'Nothing completed yet' : 'No active requests'}</h3>
              <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: 6 }}>{filter === 'done' ? 'Finished designs will appear here.' : 'Start a new request and the design team will pick it up.'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClientPortalPage;

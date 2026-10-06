import { useMemo, useState } from 'react';
import { DONE_STATUSES } from '../types';
import { Link } from 'react-router-dom';
import { Ticket as TicketIcon, CheckCircle, Clock, ChevronDown, ChevronUp, MessageSquare, Search, X } from 'lucide-react';
import { useTickets } from '../contexts/TicketsContext';
import ProofApprovalPanel from '../components/ProofApprovalPanel';
import CommentsPanel from '../components/CommentsPanel';
import { useNewRequest } from '../contexts/NewRequestContext';
import { prefillFromTicket } from '../requestForm';

const DONE = DONE_STATUSES;

const CLIENT_STATUS: Record<string, string> = {
  'New': 'Received',
  'Assigned': 'Queued with a designer',
  'In Progress': 'Design in progress',
  'Waiting on Requester': 'We need your input',
  'In Review': 'Needs your review',
  'Delivered': 'Delivered',
};

function when(due: string, status: string): string {
  if (DONE.includes(status)) return status === 'Delivered' ? 'Delivered' : status;
  if (!due) return 'Date to be confirmed';
  const d = new Date(due);
  return `Expected by ${d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`;
}

const ClientPortalPage = ({ onNewRequest }: { onNewRequest?: () => void }) => {
  const { tickets, loading, error, refresh } = useTickets();
  const { openNewRequest } = useNewRequest();
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [designType, setDesignType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const designTypes = useMemo(() => [...new Set(tickets.map(t => t.design_type).filter((d): d is string => !!d))].sort(), [tickets]);
  const statuses = useMemo(() => [...new Set(tickets.map(t => t.status))], [tickets]);

  const q = query.trim().toLowerCase();
  const day = (iso: string | undefined) => (iso ? iso.slice(0, 10) : '');
  const shown = tickets.filter(t => {
    if (filter === 'done' ? !DONE.includes(t.status) : filter === 'open' ? DONE.includes(t.status) : false) return false;
    if (status && t.status !== status) return false;
    if (designType && t.design_type !== designType) return false;
    const created = day(t.created_at);
    if (from && (!created || created < from)) return false;
    if (to && (!created || created > to)) return false;
    if (q && !`${t.number} ${t.title} ${t.tags.join(' ')} ${t.description ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const hasFilters = !!(q || status || designType || from || to);
  const clearFilters = () => { setQuery(''); setStatus(''); setDesignType(''); setFrom(''); setTo(''); };
  const needsYou = tickets.filter(t => t.status === 'In Review').length;

  return (
    <div style={{ padding: '0.25rem 0 2rem' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <div>
            <h1 style={{ fontSize: 'clamp(1.4rem,3vw,2rem)', fontFamily: 'var(--font-body)', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>My requests</h1>
            <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: 4 }}>Track progress, review designs and talk to the team.</p>
          </div>
          <button type="button" className="btn-primary" style={{ fontSize: '0.82rem' }} onClick={onNewRequest}>+ New request</button>
        </div>

        {needsYou > 0 && (
          <p role="status" style={{ background: 'rgba(24,24,27,0.06)', border: '1px solid rgba(24,24,27,0.18)', color: '#18181b', borderRadius: 10, padding: '0.6rem 0.9rem', fontSize: '0.84rem', fontWeight: 600, marginBottom: '1rem' }}>
            {needsYou} design{needsYou > 1 ? 's are' : ' is'} waiting for your review.
          </p>
        )}

        <div role="group" aria-label="Show requests" style={{ display: 'inline-flex', border: '1px solid rgba(226,232,240,0.9)', borderRadius: 9, overflow: 'hidden', background: 'white', marginBottom: '1rem' }}>
          {([['open', 'In progress'], ['done', 'Completed'], ['all', 'All']] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
              style={{ padding: '0.4rem 0.9rem', fontSize: '0.78rem', fontWeight: 700, border: 'none', cursor: 'pointer', background: filter === k ? 'var(--brand-soft)' : 'transparent', color: filter === k ? 'var(--brand)' : '#64748b' }}>{label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: '1rem' }}>
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
            <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-hint)' }} />
            <input className="input-field" aria-label="Search requests" placeholder="Search by number, title or tag" value={query} onChange={e => setQuery(e.target.value)} style={{ width: '100%', paddingLeft: '2rem' }} />
          </div>
          <select className="input-field" aria-label="Status" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {statuses.map(s => <option key={s} value={s}>{CLIENT_STATUS[s] ?? s}</option>)}
          </select>
          <select className="input-field" aria-label="Design type" value={designType} onChange={e => setDesignType(e.target.value)}>
            <option value="">All design types</option>
            {designTypes.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-soft)' }}>Requested from
            <input className="input-field" type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} style={{ display: 'block', marginTop: 3 }} />
          </label>
          <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-soft)' }}>to
            <input className="input-field" type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} style={{ display: 'block', marginTop: 3 }} />
          </label>
          {hasFilters && <button type="button" className="chip" onClick={clearFilters} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><X size={12} aria-hidden="true" /> Clear filters</button>}
        </div>
        <p role="status" aria-live="polite" style={{ fontSize: '0.78rem', color: 'var(--text-soft)', marginBottom: 10 }}>{shown.length} request{shown.length === 1 ? '' : 's'}{hasFilters ? ' match your filters' : ''}</p>

        {error && <p role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem', marginBottom: 12 }}>{error} <button type="button" className="chip" onClick={() => void refresh()}>Retry</button></p>}
        {loading && tickets.length === 0 && <p role="status" style={{ color: '#94a3b8' }}>Loading your requests…</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {shown.map((ticket, i) => {
            const done = DONE.includes(ticket.status);
            const open = openId === ticket.id;
            const reviewing = ticket.status === 'In Review';
            return (
              <div key={ticket.id} className="glass-card animate-fade-in-up" style={{ overflow: 'hidden', animationDelay: `${i * 60}ms`, animationFillMode: 'both', padding: 0, borderColor: reviewing ? 'rgba(24,24,27,0.3)' : undefined }}>
                <div style={{ padding: '1.1rem 1.4rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-btn)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                  background: done ? 'rgba(16,185,129,0.08)' : 'rgba(24,24,27,0.06)', border: done ? '1px solid rgba(16,185,129,0.15)' : '1px solid rgba(24,24,27,0.12)', color: done ? '#059669' : '#18181b' }}>
                      {done ? <CheckCircle size={18} /> : <Clock size={18} />}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: '#64748b', fontWeight: 600 }}>{ticket.number}</span>
                        <h3 style={{ fontSize: '0.92rem', fontWeight: 700, fontFamily: 'var(--font-body)', color: '#0F172A', overflowWrap: 'anywhere' }}>
                          <Link to={`/tickets/${ticket.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{ticket.title}</Link>
                        </h3>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: '#64748B', marginTop: 3 }}>{when(ticket.due_at, ticket.status)}{ticket.assignee ? ` · with ${ticket.assignee}` : ''}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={done ? 'badge-green' : reviewing || ticket.status === 'Waiting on Requester' ? 'badge-red' : 'badge-blue'}>{CLIENT_STATUS[ticket.status] ?? ticket.status}</span>
                    {done && <button type="button" className="chip" aria-label={`Request again: ${ticket.title}`} onClick={() => openNewRequest(prefillFromTicket(ticket))}>Request again</button>}
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
              <div style={{ width: 56, height: 56, borderRadius: 'var(--radius-btn)', background: 'rgba(24,24,27,0.06)', border: '1px solid rgba(24,24,27,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', color: '#18181b' }}>
                <TicketIcon size={24} />
              </div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'var(--font-body)', color: '#0F172A' }}>{hasFilters ? 'No requests match your filters' : filter === 'done' ? 'Nothing completed yet' : 'No active requests'}</h3>
              <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: 6 }}>{hasFilters ? 'Try removing a filter or searching for something else.' : filter === 'done' ? 'Finished designs will appear here.' : 'Start a new request and the design team will pick it up.'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClientPortalPage;

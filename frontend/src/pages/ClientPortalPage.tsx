import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronUp, Eye, MessageSquare, Plus, RotateCcw, Search, SlidersHorizontal, Ticket as TicketIcon, X } from 'lucide-react';
import { DONE_STATUSES, type Ticket } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useTickets } from '../contexts/TicketsContext';
import ProofApprovalPanel from '../components/ProofApprovalPanel';
import CommentsPanel from '../components/CommentsPanel';
import { useNewRequest } from '../contexts/NewRequestContext';
import { prefillFromTicket } from '../requestForm';

const DONE = DONE_STATUSES;

/** What the client sees instead of our internal status names. */
const CLIENT_STATUS: Record<string, string> = {
  'New': 'Received',
  'Assigned': 'Queued with a designer',
  'In Progress': 'Design in progress',
  'Waiting on Requester': 'We need your input',
  'In Review': 'Needs your review',
  'Delivered': 'Delivered',
  'Revision Requested': 'Changes requested',
};

const STEPS = ['Received', 'Assigned', 'In progress', 'In review', 'Delivered'];
const STEP_OF: Record<string, number> = {
  'New': 0, 'Assigned': 1, 'In Progress': 2, 'Waiting on Requester': 2, 'In Review': 3,
  'Delivered': 4, 'Closed': 4, 'Closed without approval': 4, 'Revision Requested': 2,
};

const DAY = 86_400_000;

/** "Due Thu 8 Oct · in 2 days", or a red "Overdue" once it has passed. */
function dueLine(due: string, status: string): { text: string; tone: 'ok' | 'soon' | 'late' | 'done' | 'none' } {
  if (status === 'Revision Requested') return { text: 'Changes requested: the work continues in a new version', tone: 'done' };
  if (DONE.includes(status)) return { text: status === 'Delivered' ? 'Delivered' : status, tone: 'done' };
  if (!due) return { text: 'Date to be confirmed', tone: 'none' };
  const d = new Date(due);
  const nice = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const days = Math.ceil((d.getTime() - Date.now()) / DAY);
  if (days < 0) return { text: `Was due ${nice}`, tone: 'late' };
  if (days === 0) return { text: `Due today, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`, tone: 'soon' };
  if (days === 1) return { text: `Due tomorrow, ${nice}`, tone: 'soon' };
  return { text: `Due ${nice} · in ${days} days`, tone: 'ok' };
}

const TONE: Record<string, string> = { ok: '#475569', soon: '#b45309', late: '#b91c1c', done: '#047857', none: '#94a3b8' };

/** The one thing the client most likely wants to do next, per request. */
function accent(t: Ticket): { color: string; label: string } | null {
  if (t.status === 'In Review') return { color: '#2563eb', label: 'Your review is needed' };
  if (t.status === 'Waiting on Requester') return { color: '#d97706', label: 'We need your reply' };
  return null;
}

function Progress({ status }: { status: string }) {
  const current = STEP_OF[status] ?? 0;
  return (
    <ol aria-label="Progress" style={{ listStyle: 'none', display: 'flex', gap: 4, margin: 0, padding: 0 }}>
      {STEPS.map((step, i) => {
        const reached = i <= current;
        return (
          <li key={step} className="portal-step" aria-current={i === current ? 'step' : undefined} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ height: 5, borderRadius: 99, background: reached ? (i === 4 ? '#059669' : '#18181b') : '#E2E8F0', opacity: i === current && i !== 4 ? 1 : reached ? 0.85 : 1 }} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 6, fontSize: '0.66rem', fontWeight: i === current ? 800 : 600, color: reached ? '#0F172A' : '#94a3b8', whiteSpace: 'nowrap' }}>
              {i < current && <Check size={10} aria-hidden="true" style={{ color: '#059669', flexShrink: 0 }} />}
              <span className="portal-step-text" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{step}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const ClientPortalPage = ({ onNewRequest }: { onNewRequest?: () => void }) => {
  const { user } = useAuth();
  const { tickets, loading, error, refresh } = useTickets();
  const { openNewRequest } = useNewRequest();
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'review' | 'open' | 'done' | 'all'>('open');
  const [showFilters, setShowFilters] = useState(false);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [designType, setDesignType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const designTypes = useMemo(() => [...new Set(tickets.map(t => t.design_type).filter((d): d is string => !!d))].sort(), [tickets]);
  const statuses = useMemo(() => [...new Set(tickets.map(t => t.status))], [tickets]);

  const counts = useMemo(() => ({
    review: tickets.filter(t => t.status === 'In Review' || t.status === 'Waiting on Requester').length,
    open: tickets.filter(t => !DONE.includes(t.status)).length,
    done: tickets.filter(t => DONE.includes(t.status)).length,
    all: tickets.length,
  }), [tickets]);

  const q = query.trim().toLowerCase();
  const day = (iso: string | undefined) => (iso ? iso.slice(0, 10) : '');
  const shown = tickets.filter(t => {
    if (filter === 'review' && !(t.status === 'In Review' || t.status === 'Waiting on Requester')) return false;
    if (filter === 'done' && !DONE.includes(t.status)) return false;
    if (filter === 'open' && DONE.includes(t.status)) return false;
    if (status && t.status !== status) return false;
    if (designType && t.design_type !== designType) return false;
    const created = day(t.created_at);
    if (from && (!created || created < from)) return false;
    if (to && (!created || created > to)) return false;
    if (q && !`${t.number} ${t.title} ${t.tags.join(' ')} ${t.description ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const rank = (t: Ticket) => (t.status === 'In Review' ? 0 : t.status === 'Waiting on Requester' ? 1 : DONE.includes(t.status) ? 3 : 2);
  shown.sort((a, b) => rank(a) - rank(b) || (rank(a) === 3
    ? (b.created_at ?? '').localeCompare(a.created_at ?? '')
    : (a.due_at || '9').localeCompare(b.due_at || '9')));
  const advanced = [status, designType, from, to].filter(Boolean).length;
  const hasFilters = !!q || advanced > 0;
  const clearFilters = () => { setQuery(''); setStatus(''); setDesignType(''); setFrom(''); setTo(''); };
  const firstName = user?.name?.split(' ')[0] ?? '';

  const tabs: [typeof filter, string, number][] = [
    ...(counts.review > 0 ? [['review', 'Needs you', counts.review] as [typeof filter, string, number]] : []),
    ['open', 'In progress', counts.open],
    ['done', 'Completed', counts.done],
    ['all', 'All', counts.all],
  ];

  return (
    <div style={{ padding: '0.5rem 0 3rem' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        {/* Greeting and the one primary action */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <div>
            <h1 style={{ fontSize: 'clamp(1.4rem,3vw,1.9rem)', fontFamily: 'var(--font-body)', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              {firstName ? `Hi ${firstName}, here are your requests` : 'My requests'}
            </h1>
            <p style={{ fontSize: '0.86rem', color: '#64748B', marginTop: 6 }}>Track progress, review designs and talk to the design team.</p>
          </div>
          <button type="button" className="btn-primary" style={{ fontSize: '0.86rem', padding: '0.6rem 1.1rem', gap: 6 }} onClick={onNewRequest}>
            <Plus size={15} aria-hidden="true" /> New request
          </button>
        </div>

        {/* Tabs with counts, search, and the rarely-needed filters tucked away */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <div role="group" aria-label="Show requests" className="portal-tabs" style={{ display: 'inline-flex', maxWidth: '100%', overflowX: 'auto', border: '1px solid rgba(226,232,240,0.9)', borderRadius: 10, background: 'white' }}>
            {tabs.map(([k, label, n]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem', fontWeight: 700, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0,
                         background: filter === k ? '#18181b' : 'transparent', color: filter === k ? 'white' : '#64748b' }}>
                {label}
                <span aria-label={`${n} request${n === 1 ? '' : 's'}`} style={{ fontSize: '0.68rem', fontWeight: 800, borderRadius: 99, padding: '0 6px', minWidth: 18, textAlign: 'center',
                  background: filter === k ? 'rgba(255,255,255,0.2)' : '#F1F5F9', color: filter === k ? 'white' : '#64748b' }}>{n}</span>
              </button>
            ))}
          </div>

          <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 180 }}>
            <Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-hint)' }} />
            <input className="input-field" aria-label="Search requests" placeholder="Search your requests" value={query} onChange={e => setQuery(e.target.value)} style={{ width: '100%', paddingLeft: '2.2rem' }} />
          </div>

          <button type="button" className="btn-ghost" aria-expanded={showFilters} aria-controls="portal-filters" onClick={() => setShowFilters(v => !v)} style={{ gap: 6 }}>
            <SlidersHorizontal size={14} aria-hidden="true" /> Filters{advanced > 0 && <span style={{ background: '#18181b', color: 'white', borderRadius: 99, fontSize: '0.66rem', fontWeight: 800, padding: '0 6px' }}>{advanced}</span>}
          </button>
        </div>

        {showFilters && (
          <div id="portal-filters" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, padding: '0.9rem', background: 'white', border: '1px solid rgba(226,232,240,0.9)', borderRadius: 12, marginBottom: 10 }}>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-soft)' }}>Status
              <select className="input-field" value={status} onChange={e => setStatus(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }}>
                <option value="">All statuses</option>
                {statuses.map(s => <option key={s} value={s}>{CLIENT_STATUS[s] ?? s}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-soft)' }}>Design type
              <select className="input-field" value={designType} onChange={e => setDesignType(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }}>
                <option value="">All design types</option>
                {designTypes.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-soft)' }}>Requested from
              <input className="input-field" type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }} />
            </label>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-soft)' }}>Requested to
              <input className="input-field" type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }} />
            </label>
          </div>
        )}

        {hasFilters && (
          <p role="status" aria-live="polite" style={{ fontSize: '0.8rem', color: 'var(--text-soft)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {shown.length} request{shown.length === 1 ? '' : 's'} match your filters
            <button type="button" className="chip" onClick={clearFilters} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><X size={12} aria-hidden="true" /> Clear filters</button>
          </p>
        )}

        {error && <p role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem', marginBottom: 12 }}>{error} <button type="button" className="chip" onClick={() => void refresh()}>Retry</button></p>}
        {loading && tickets.length === 0 && <p role="status" style={{ color: '#94a3b8' }}>Loading your requests…</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', marginTop: 4 }}>
          {shown.map((ticket, i) => {
            const done = DONE.includes(ticket.status);
            const open = openId === ticket.id;
            const note = accent(ticket);
            const next = tickets.find(t => t.parent_id === ticket.id);   // the version that took over, if changes were requested
            const due = dueLine(ticket.due_at, ticket.status);
            return (
              <article key={ticket.id} aria-label={`${ticket.number} ${ticket.title}`} className="glass-card animate-fade-in-up"
                style={{ overflow: 'hidden', animationDelay: `${i * 50}ms`, animationFillMode: 'both', padding: 0, borderLeft: `4px solid ${note?.color ?? (done ? '#10B981' : 'rgba(24,24,27,0.18)')}` }}>
                <div style={{ padding: '1.1rem 1.3rem 1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                      <p style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: '#64748b', fontWeight: 700, marginBottom: 3 }}>
                        {ticket.number}{ticket.design_type ? ` · ${ticket.design_type}` : ''}
                      </p>
                      <h3 style={{ fontSize: '1.02rem', fontWeight: 800, fontFamily: 'var(--font-body)', color: '#0F172A', overflowWrap: 'anywhere', lineHeight: 1.3 }}>
                        <Link to={`/tickets/${ticket.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{ticket.title}</Link>
                      </h3>
                      <p style={{ fontSize: '0.8rem', marginTop: 5, color: TONE[due.tone], fontWeight: due.tone === 'late' || due.tone === 'soon' ? 700 : 500 }}>
                        {due.text}{ticket.assignee && !done ? <span style={{ color: '#64748b', fontWeight: 500 }}> · with {ticket.assignee}</span> : null}
                      </p>
                    </div>
                    <span className={done ? 'badge-green' : note ? undefined : 'badge-blue'}
                      style={{ flexShrink: 0, ...(note ? { background: `${note.color}14`, color: note.color, border: `1px solid ${note.color}40`, borderRadius: 99, padding: '0.2rem 0.65rem', fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' as const } : {}) }}>
                      {CLIENT_STATUS[ticket.status] ?? ticket.status}
                    </span>
                  </div>

                  {!done && <div style={{ marginTop: 14 }}><Progress status={ticket.status} /></div>}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                    {note && (
                      <button type="button" className="btn-primary" aria-expanded={open} onClick={() => setOpenId(open ? null : ticket.id)}
                        style={{ background: note.color, borderColor: note.color, gap: 6 }}>
                        {ticket.status === 'In Review' ? <Eye size={14} aria-hidden="true" /> : <MessageSquare size={14} aria-hidden="true" />} {ticket.status === 'In Review' ? 'Review design' : 'Reply to the team'}
                      </button>
                    )}
                    {next && (
                      <Link to={`/tickets/${next.id}`} className="btn-primary" style={{ gap: 6, textDecoration: 'none' }}>
                        Open {next.number}
                      </Link>
                    )}
                    {done && !next && (
                      <button type="button" className="btn-ghost" aria-label={`Request again: ${ticket.title}`} onClick={() => openNewRequest(prefillFromTicket(ticket))} style={{ gap: 6 }}>
                        <RotateCcw size={13} aria-hidden="true" /> Request again
                      </button>
                    )}
                    <button type="button" className="chip" aria-expanded={open} onClick={() => setOpenId(open ? null : ticket.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: note || done ? 'auto' : 0 }}>
                      {open ? <>Hide details <ChevronUp size={12} aria-hidden="true" /></> : <>Details <ChevronDown size={12} aria-hidden="true" /></>}
                      {(ticket.comment_count ?? 0) > 0 && !open && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: '#64748b' }}><MessageSquare size={10} aria-hidden="true" />{ticket.comment_count}</span>}
                    </button>
                  </div>
                </div>

                {open && (
                  <div style={{ padding: '1.25rem 1.3rem', background: '#F8FAFC', borderTop: '1px solid rgba(226,232,240,0.85)', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    <ProofApprovalPanel ticket={ticket} />
                    <CommentsPanel ticketId={ticket.id} compact />
                  </div>
                )}
              </article>
            );
          })}

          {!loading && shown.length === 0 && (
            <div className="glass-card" style={{ textAlign: 'center', padding: '3.5rem 2rem', border: '2px dashed rgba(226,232,240,0.85)' }}>
              <div style={{ width: 56, height: 56, borderRadius: 'var(--radius-btn)', background: 'rgba(24,24,27,0.06)', border: '1px solid rgba(24,24,27,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', color: '#18181b' }}>
                <TicketIcon size={24} aria-hidden="true" />
              </div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'var(--font-body)', color: '#0F172A' }}>
                {hasFilters ? 'No requests match your filters' : filter === 'done' ? 'Nothing completed yet' : filter === 'review' ? 'Nothing needs you right now' : tickets.length === 0 ? 'Make your first request' : 'No active requests'}
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#64748B', margin: '6px auto 0', maxWidth: 360 }}>
                {hasFilters ? 'Try removing a filter or searching for something else.' : filter === 'done' ? 'Finished designs will appear here.' : filter === 'review' ? 'When the team needs your review or a reply, it shows up here.' : 'Tell the design team what you need and they will pick it up.'}
              </p>
              {!hasFilters && filter !== 'done' && filter !== 'review' && (
                <button type="button" className="btn-primary" onClick={onNewRequest} style={{ marginTop: 16, gap: 6 }}><Plus size={14} aria-hidden="true" /> New request</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClientPortalPage;

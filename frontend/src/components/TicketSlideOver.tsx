import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, ChevronDown, Tag, CheckSquare, Square, ExternalLink, Plus } from 'lucide-react';
import { type Ticket, STATUSES, PRIORITIES, PRIORITY_STYLE } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useTickets } from '../contexts/TicketsContext';
import CommentsPanel from './CommentsPanel';
import TimeTracker from './TimeTracker';

interface Props {
  ticket:  Ticket | null;
  onClose: () => void;
}

const TicketSlideOver: React.FC<Props> = ({ ticket, onClose }) => {
  const { user } = useAuth();
  const { updateTicket, toggleSubtask, addSubtask } = useTickets();
  const isLead = user?.role === 'Design Lead';
  const [error, setError] = useState<string | null>(null);
  const [newSub, setNewSub] = useState('');

  useEffect(() => { setError(null); setNewSub(''); }, [ticket?.id]);

  /* ESC to close. The listener is registered once and reads the latest onClose from a ref: re-registering on every
     render lets another keydown listener's state update swap it out mid-dispatch, so the browser skips it. */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!ticket) return null;

  const run = async (op: () => Promise<void>, fallback: string) => {
    setError(null);
    try { await op(); } catch (e) { setError(e instanceof Error ? e.message : fallback); }
  };

  const prioStyle = PRIORITY_STYLE[ticket.priority] ?? {};
  const statusOptions = STATUSES.includes(ticket.status) ? STATUSES : [...STATUSES, ticket.status];
  const done = ticket.subtasks.filter(s => s.is_completed).length;

  return (
    <>
      <div className="animate-fade-in" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.3)', backdropFilter: 'blur(3px)', zIndex: 40 }} />

      <div
        role="dialog" aria-modal="true" aria-label={`${ticket.number} ${ticket.title}`}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, maxWidth: '92vw',
          background: 'rgba(255,255,255,0.98)', backdropFilter: 'blur(20px)',
          borderLeft: '1px solid rgba(226,232,240,0.85)', boxShadow: '-16px 0 48px rgba(24,24,27,0.1)',
          zIndex: 45, display: 'flex', flexDirection: 'column',
          animation: 'slideInRight 0.28s cubic-bezier(0.4,0,0.2,1) both',
        }}
      >
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(226,232,240,0.85)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: '#F8FAFC' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: '0.68rem', fontFamily: 'monospace', color: '#64748b', fontWeight: 700, marginBottom: 3 }}>
              {ticket.number}{ticket.client_org ? ` · ${ticket.client_org}` : ''}
            </p>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 800, fontFamily: 'var(--font-body)', color: '#0F172A', lineHeight: 1.35, letterSpacing: '-0.01em' }}>{ticket.title}</h2>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            <Link to={`/tickets/${ticket.id}`} title="Open full page" aria-label="Open full page" onClick={onClose}
              style={{ color: '#64748B', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 8, padding: '4px 6px', display: 'flex', alignItems: 'center' }}>
              <ExternalLink size={14} />
            </Link>
            <button type="button" onClick={onClose} aria-label="Close" style={{ color: '#64748B', background: 'none', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 8, padding: 5, cursor: 'pointer', display: 'flex' }}>
              <X size={15} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1.1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {error && <p role="alert" style={{ fontSize: '0.78rem', color: '#b91c1c', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '0.5rem 0.75rem' }}>{error}</p>}

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <div style={{ flex: 1 }}>
              <label className="section-label" htmlFor="so-status" style={{ marginBottom: 6, display: 'block' }}>Status</label>
              <div style={{ position: 'relative' }}>
                <select id="so-status" value={ticket.status} className="input-field" style={{ width: '100%', paddingRight: '2rem', fontSize: '0.82rem' }}
                  onChange={e => void run(() => updateTicket(ticket.id, { status: e.target.value }), 'Could not change status.')}>
                  {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none' }} />
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <label className="section-label" htmlFor="so-prio" style={{ marginBottom: 6, display: 'block' }}>Priority</label>
              <div style={{ position: 'relative' }}>
                <select id="so-prio" value={ticket.priority} disabled={!isLead} title={isLead ? undefined : 'Only a Design Lead can change priority'}
                  className="input-field" style={{ width: '100%', paddingRight: '2rem', fontSize: '0.82rem', ...prioStyle }}
                  onChange={e => void run(() => updateTicket(ticket.id, { priority: e.target.value }), 'Could not change priority.')}>
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none' }} />
              </div>
            </div>
          </div>

          {ticket.tags?.length > 0 && (
            <div>
              <p className="section-label" style={{ marginBottom: 6 }}><Tag size={11} style={{ display: 'inline', marginRight: 4 }} />Tags</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{ticket.tags.map(t => <span key={t} className="chip">{t}</span>)}</div>
            </div>
          )}

          {ticket.description && (
            <div>
              <p className="section-label" style={{ marginBottom: 6 }}>Brief</p>
              <p style={{ fontSize: '0.82rem', color: '#475569', lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#F8FAFC', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 'var(--radius-sm)', padding: '0.625rem 0.75rem' }}>
                {ticket.description}
              </p>
            </div>
          )}

          <TimeTracker ticket={ticket} showEntries={false} />

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <p className="section-label">Subtasks</p>
              {ticket.subtasks.length > 0 && <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#047857' }}>{done}/{ticket.subtasks.length} done</span>}
            </div>
            {ticket.subtasks.length > 0 && (
              <>
                <div style={{ height: 4, background: 'rgba(226,232,240,0.7)', borderRadius: 99, marginBottom: 10, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(done / ticket.subtasks.length) * 100}%`, background: 'linear-gradient(90deg,#059669,#10B981)', borderRadius: 99, transition: 'width 0.4s' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {ticket.subtasks.map(sub => (
                    <button key={sub.id} type="button" role="checkbox" aria-checked={sub.is_completed}
                      onClick={() => void run(() => toggleSubtask(ticket.id, sub.id), 'Could not update the subtask.')}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.45rem 0.625rem', background: 'none', border: `1px solid ${sub.is_completed ? 'rgba(16,185,129,0.2)' : 'rgba(226,232,240,0.85)'}`, borderRadius: 8, cursor: 'pointer', textAlign: 'left' }}>
                      {sub.is_completed ? <CheckSquare size={15} style={{ color: '#059669', flexShrink: 0 }} /> : <Square size={15} style={{ color: '#94a3b8', flexShrink: 0 }} />}
                      <span style={{ fontSize: '0.8rem', color: sub.is_completed ? '#94a3b8' : '#0F172A', textDecoration: sub.is_completed ? 'line-through' : 'none' }}>{sub.title}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <form style={{ display: 'flex', gap: 6, marginTop: 8 }} onSubmit={e => { e.preventDefault(); const t = newSub.trim(); if (t) void run(async () => { await addSubtask(ticket.id, t); setNewSub(''); }, 'Could not add the subtask.'); }}>
              <input className="input-field" aria-label="New subtask" placeholder="Add a subtask…" value={newSub} maxLength={200} onChange={e => setNewSub(e.target.value)} style={{ flex: 1, fontSize: '0.8rem', padding: '0.4rem 0.7rem' }} />
              <button type="submit" className="btn-ghost" disabled={!newSub.trim()} style={{ padding: '0.4rem 0.7rem' }} aria-label="Add subtask"><Plus size={13} /></button>
            </form>
          </div>

          <CommentsPanel ticketId={ticket.id} compact />
        </div>
      </div>
    </>
  );
};

export default TicketSlideOver;

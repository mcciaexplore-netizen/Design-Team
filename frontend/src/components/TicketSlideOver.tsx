import React, { useState, useEffect, useRef } from 'react';
import {
  X, Clock, Play, Pause, ChevronDown,
  MessageSquare, Send, Tag, CheckSquare, Square,
  ExternalLink,
} from 'lucide-react';
import { type Ticket, STATUSES, PRIORITIES, PRIORITY_STYLE } from '../types';

interface Props {
  ticket:   Ticket | null;
  onClose:  () => void;
  onUpdate: (id: string, patch: Partial<Ticket>) => void;
}

/* ── Format elapsed seconds → hh:mm:ss ── */
function fmtElapsed(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

const TicketSlideOver: React.FC<Props> = ({ ticket, onClose, onUpdate }) => {
  const [comment,      setComment]      = useState('');
  const [elapsed,      setElapsed]      = useState(0);
  const [localSubtasks, setLocalSubtasks] = useState(ticket?.subtasks ?? []);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* sync local subtask copy when ticket changes */
  useEffect(() => {
    setLocalSubtasks(ticket?.subtasks ?? []);
  }, [ticket?.id]);

  /* live timer */
  useEffect(() => {
    if (!ticket) return;
    if (intervalRef.current) clearInterval(intervalRef.current);

    const computeElapsed = () => {
      if (ticket.timer_started_at) {
        const diff = Math.floor((Date.now() - new Date(ticket.timer_started_at).getTime()) / 1000);
        setElapsed(ticket.time_spent_seconds + diff);
      } else {
        setElapsed(ticket.time_spent_seconds);
      }
    };

    computeElapsed();
    if (ticket.timer_started_at) {
      intervalRef.current = setInterval(computeElapsed, 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [ticket?.timer_started_at, ticket?.time_spent_seconds, ticket?.id]);

  /* ESC to close */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!ticket) return null;

  const isRunning = !!ticket.timer_started_at;
  const prioStyle = PRIORITY_STYLE[ticket.priority] ?? {};
  const completedSubs = localSubtasks.filter(s => s.is_completed).length;

  const handleStartStop = () => {
    if (isRunning) {
      const spent = Math.floor((Date.now() - new Date(ticket.timer_started_at!).getTime()) / 1000);
      onUpdate(ticket.id, { timer_started_at: null, time_spent_seconds: ticket.time_spent_seconds + spent });
    } else {
      onUpdate(ticket.id, { timer_started_at: new Date().toISOString() });
    }
  };

  const handleToggleSub = (subId: number) => {
    const updated = localSubtasks.map(s => s.id === subId ? { ...s, is_completed: !s.is_completed } : s);
    setLocalSubtasks(updated);
    onUpdate(ticket.id, { subtasks: updated });
  };

  const handlePostComment = () => {
    if (!comment.trim()) return;
    const newComment = {
      id:        Date.now().toString(),
      author:    'You',
      text:      comment.trim(),
      createdAt: new Date().toISOString(),
    };
    onUpdate(ticket.id, { comments: [...(ticket.comments ?? []), newComment] });
    setComment('');
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="animate-fade-in"
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(15,23,42,0.3)',
          backdropFilter: 'blur(3px)',
          zIndex: 40,
        }}
      />

      {/* Panel */}
      <div
        style={{
          position:     'fixed', top: 0, right: 0, bottom: 0,
          width:        420, maxWidth: '90vw',
          background:   'rgba(255,255,255,0.98)',
          backdropFilter: 'blur(20px)',
          borderLeft:   '1px solid rgba(226,232,240,0.85)',
          boxShadow:    '-16px 0 48px rgba(0,63,138,0.1)',
          zIndex:       45,
          display:      'flex', flexDirection: 'column',
          animation:    'slideInRight 0.28s cubic-bezier(0.4,0,0.2,1) both',
        }}
      >
        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(226,232,240,0.85)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: '#F8FAFC' }}>
          <div>
            <p style={{ fontSize: '0.68rem', fontFamily: 'monospace', color: '#94a3b8', fontWeight: 700, marginBottom: 3 }}>{ticket.number}</p>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: '#0F172A', lineHeight: 1.35, letterSpacing: '-0.01em' }}>{ticket.title}</h2>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <a
              href={`/tickets/${ticket.id}`}
              title="Open full page"
              style={{ color: '#64748B', background: 'none', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 8, padding: '4px 6px', display: 'flex', alignItems: 'center', textDecoration: 'none' }}
            >
              <ExternalLink size={14} />
            </a>
            <button
              onClick={onClose}
              style={{ color: '#64748B', background: 'none', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 8, padding: 5, cursor: 'pointer', display: 'flex' }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body (scrollable) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Status + Priority row */}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <div style={{ flex: 1 }}>
              <label className="section-label" style={{ marginBottom: 6, display: 'block' }}>Status</label>
              <div style={{ position: 'relative' }}>
                <select
                  value={ticket.status}
                  onChange={e => onUpdate(ticket.id, { status: e.target.value })}
                  className="input-field"
                  style={{ width: '100%', paddingRight: '2rem', fontSize: '0.82rem' }}
                >
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none' }} />
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <label className="section-label" style={{ marginBottom: 6, display: 'block' }}>Priority</label>
              <div style={{ position: 'relative' }}>
                <select
                  value={ticket.priority}
                  onChange={e => onUpdate(ticket.id, { priority: e.target.value })}
                  className="input-field"
                  style={{ width: '100%', paddingRight: '2rem', fontSize: '0.82rem', ...prioStyle }}
                >
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none' }} />
              </div>
            </div>
          </div>

          {/* Tags */}
          {ticket.tags?.length > 0 && (
            <div>
              <label className="section-label" style={{ marginBottom: 6, display: 'block' }}>
                <Tag size={11} style={{ display: 'inline', marginRight: 4 }} />Tags
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {ticket.tags.map(t => <span key={t} className="chip">{t}</span>)}
              </div>
            </div>
          )}

          {/* Description */}
          {ticket.description && (
            <div>
              <label className="section-label" style={{ marginBottom: 6, display: 'block' }}>Description</label>
              <p style={{ fontSize: '0.82rem', color: '#475569', lineHeight: 1.65, background: '#F8FAFC', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 'var(--radius-sm)', padding: '0.625rem 0.75rem' }}>
                {ticket.description}
              </p>
            </div>
          )}

          {/* ── Timer ── */}
          <div style={{ background: isRunning ? 'rgba(16,185,129,0.05)' : '#F8FAFC', border: `1px solid ${isRunning ? 'rgba(16,185,129,0.2)' : 'rgba(226,232,240,0.85)'}`, borderRadius: 'var(--radius-md)', padding: '0.875rem 1rem', transition: 'all 0.3s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: isRunning ? 'rgba(16,185,129,0.12)' : 'rgba(0,63,138,0.06)', border: `1px solid ${isRunning ? 'rgba(16,185,129,0.2)' : 'rgba(0,63,138,0.12)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isRunning ? '#059669' : '#003F8A' }}>
                  <Clock size={15} />
                </div>
                <div>
                  <p className="section-label">Time Logged</p>
                  <p style={{ fontSize: '1.1rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: isRunning ? '#059669' : '#0F172A', letterSpacing: '-0.02em', lineHeight: 1 }}>
                    {fmtElapsed(elapsed)}
                  </p>
                </div>
              </div>
              <button
                onClick={handleStartStop}
                style={{
                  display:    'flex', alignItems: 'center', gap: 6,
                  padding:    '0.5rem 1rem',
                  borderRadius: 'var(--radius-btn)', border: 'none', cursor: 'pointer',
                  background: isRunning ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
                  color:      isRunning ? '#EF4444' : '#059669',
                  fontSize:   '0.78rem', fontWeight: 800, fontFamily: 'var(--font-body)',
                  transition: 'all 0.2s',
                }}
              >
                {isRunning ? <><Pause size={13} /> Stop</> : <><Play size={13} /> Start</>}
              </button>
            </div>
            {isRunning && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: '0.7rem', color: '#059669', fontWeight: 700, fontFamily: 'var(--font-body)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '99px', background: '#10B981', display: 'inline-block', animation: 'pulse-dot 1.2s ease-in-out infinite' }} />
                Timer running…
              </div>
            )}
          </div>

          {/* ── Subtasks ── */}
          {localSubtasks.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label className="section-label">Subtasks</label>
                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#059669' }}>{completedSubs}/{localSubtasks.length} done</span>
              </div>
              {/* Progress bar */}
              <div style={{ height: 4, background: 'rgba(226,232,240,0.7)', borderRadius: 99, marginBottom: 10, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(completedSubs / localSubtasks.length) * 100}%`, background: 'linear-gradient(90deg,#059669,#10B981)', borderRadius: 99, transition: 'width 0.4s cubic-bezier(0.4,0,0.2,1)' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {localSubtasks.map(sub => (
                  <button
                    key={sub.id}
                    onClick={() => handleToggleSub(sub.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.45rem 0.625rem', background: 'none', border: `1px solid ${sub.is_completed ? 'rgba(16,185,129,0.2)' : 'rgba(226,232,240,0.85)'}`, borderRadius: 8, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}
                  >
                    {sub.is_completed
                      ? <CheckSquare size={15} style={{ color: '#059669', flexShrink: 0 }} />
                      : <Square size={15} style={{ color: '#94a3b8', flexShrink: 0 }} />
                    }
                    <span style={{ fontSize: '0.8rem', color: sub.is_completed ? '#94a3b8' : '#0F172A', textDecoration: sub.is_completed ? 'line-through' : 'none', fontFamily: 'var(--font-body)' }}>{sub.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Comments ── */}
          <div>
            <label className="section-label" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
              <MessageSquare size={11} /> Comments ({ticket.comments?.length ?? 0})
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
              {(ticket.comments ?? []).map(c => (
                <div key={c.id} style={{ background: '#F8FAFC', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 8, padding: '0.625rem 0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#003F8A', fontFamily: 'var(--font-body)' }}>{c.author}</span>
                    <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>{new Date(c.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.55 }}>{c.text}</p>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="input-field"
                style={{ flex: 1, fontSize: '0.82rem' }}
                placeholder="Add a comment…"
                value={comment}
                onChange={e => setComment(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePostComment(); } }}
              />
              <button
                onClick={handlePostComment}
                disabled={!comment.trim()}
                className="btn-primary"
                style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem' }}
              >
                <Send size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default TicketSlideOver;

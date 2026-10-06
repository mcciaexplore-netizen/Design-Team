import React, { useEffect, useRef, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { AlertTriangle, Copy, CheckSquare, MessageCircle } from 'lucide-react';
import { type Ticket, PRIORITY_STYLE } from '../../types';
import { colorFor } from '../../contexts/TicketsContext';

/* ── helpers ─────────────────────────────────── */
function fmtElapsed(totalSecs: number, startedAt: string | null): string {
  const secs = startedAt
    ? totalSecs + Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
    : totalSecs;
  if (secs <= 0) return '0m';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ── SLA badge ─────────────────────────────── */
export function SLABadge({ dueAt }: { dueAt?: string }) {
  const [label, setLabel] = useState('');
  const [over,  setOver]  = useState(false);

  useEffect(() => {
    if (!dueAt) return;
    const tick = () => {
      const diff = new Date(dueAt).getTime() - Date.now();
      if (diff <= 0) { setOver(true); setLabel('Overdue'); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      setLabel(`${h}h ${m}m`);
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [dueAt]);

  if (!dueAt || !label) return null;
  return (
    <span className={over ? 'badge-red' : 'badge-green'} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <AlertTriangle size={9} style={{ flexShrink: 0, display: over ? 'inline' : 'none' }} />
      {label}
    </span>
  );
}

/* ── Ticket Card ─────────────────────────────── */
export function TicketCard({
  ticket, isSelected = false, isDragging = false,
  now, showSelect = false, onToggleSelect,
  onSingleClick, onDoubleClickTitle,
  editingTitle, onEditTitle, onSaveTitle, onDuplicate,
}: {
  ticket: Ticket; isSelected?: boolean; isDragging?: boolean;
  now: number; showSelect?: boolean; onToggleSelect?: () => void;
  onSingleClick:     (e: React.MouseEvent) => void;
  onDoubleClickTitle: () => void;
  editingTitle:   string | null;
  onEditTitle:    (v: string) => void;
  onSaveTitle:    () => void;
  onDuplicate:    () => void;
}) {
  const ps  = PRIORITY_STYLE[ticket.priority] ?? {};
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editingTitle !== null) ref.current?.select(); }, [editingTitle]);

  const elapsed = ticket.timer_started_at
    ? ticket.time_spent_seconds + Math.floor((now - new Date(ticket.timer_started_at).getTime()) / 1000)
    : ticket.time_spent_seconds;

  return (
    <div
      className="glass-card"
      onClick={onSingleClick}
      style={{
        background:     isDragging ? 'rgba(255, 255, 255, 1)' : undefined,
        border:         isSelected ? '1px solid #52525b' : isDragging ? '1px solid rgba(24,24,27,0.4)' : undefined,
        padding:        '1rem',
        boxShadow:      isDragging ? '0 24px 48px rgba(24,24,27,0.1)' : isSelected ? '0 0 0 2px rgba(24,24,27,0.3)' : undefined,
        transform:      isDragging ? 'rotate(2deg) scale(1.03)' : 'none',
        cursor:         isDragging ? 'grabbing' : 'grab',
        transition:     isDragging ? 'none' : 'box-shadow 0.2s, border-color 0.2s, transform 0.15s',
        userSelect:     'none',
        position:       'relative',
      }}
    >
      {/* Ticket number + badges */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
        {onToggleSelect && (
          <input
            type="checkbox"
            className="card-select"
            aria-label={`Select ${ticket.number}`}
            checked={isSelected}
            data-visible={showSelect || isSelected}
            onChange={onToggleSelect}
            onClick={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
          />
        )}
        <span style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.08em', color: '#64748b', textTransform: 'uppercase', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', flexShrink: 0, paddingTop: 3 }}>{ticket.number}</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', minWidth: 0 }}>
          {ticket.info_score !== undefined && (
            <span className={ticket.info_score < 90 ? 'badge-red' : 'badge-green'} title="AI Info Score">
              AI {ticket.info_score}%
            </span>
          )}
          <button
            onClick={e => { e.stopPropagation(); onDuplicate(); }}
            title="Duplicate Ticket"
            style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: 2, marginRight: 2 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#18181b'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#94a3b8'}
          >
            <Copy size={13} />
          </button>
          {ticket.status === 'Waiting on Requester' && <span className="badge-red" title="Waiting on the requester">Blocked</span>}
          <SLABadge dueAt={ticket.due_at} />
          <span className="badge-blue" style={ps}>{ticket.priority}</span>
        </div>
      </div>

      {/* Inline-editable title */}
      {editingTitle !== null ? (
        <input
          ref={ref}
          className="input-field"
          value={editingTitle}
          onChange={e => onEditTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSaveTitle(); if (e.key === 'Escape') onSaveTitle(); }}
          onBlur={onSaveTitle}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          style={{ fontSize: '0.85rem', fontWeight: 700, padding: '0.25rem 0.5rem', marginBottom: '0.5rem', width: '100%' }}
        />
      ) : (
        <h4
          onDoubleClick={e => { e.stopPropagation(); onDoubleClickTitle(); }}
          title="Double-click to edit"
          style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-body)', color: '#0f172a', lineHeight: 1.35, marginBottom: '0.5rem', letterSpacing: '-0.01em' }}
        >
          {ticket.title}
        </h4>
      )}

      {/* Tags */}
      {ticket.tags?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: '0.5rem' }}>
          {ticket.tags.map(tag => (
            <span key={tag} style={{ fontSize: '0.62rem', fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'rgba(24,24,27,0.07)', border: '1px solid rgba(24,24,27,0.18)', color: '#7c3aed', fontFamily: 'var(--font-body)' }}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Assignee avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.625rem' }}>
        <div style={{ width: 20, height: 20, borderRadius: '99px', background: colorFor(ticket.assignee), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem', fontWeight: 800, color: 'white', flexShrink: 0 }}>
          {(ticket.assignee || 'U').slice(0, 1)}
        </div>
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748B' }}>{ticket.assignee || 'Unassigned'}</span>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.5rem', borderTop: '1px solid rgba(226, 232, 240, 0.7)' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {ticket.subtasks?.length > 0 && (
            <span className="ticket-meta-chip">
              <CheckSquare size={10} />
              {ticket.subtasks.filter(s => s.is_completed).length}/{ticket.subtasks.length}
            </span>
          )}
          {(ticket.comment_count ?? 0) > 0 && (
            <span className="ticket-meta-chip">
              <MessageCircle size={10} />
              {ticket.comment_count}
            </span>
          )}
        </div>
        <div>
          {ticket.timer_started_at ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#059669', fontWeight: 700, background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 6, padding: '2px 8px', fontSize: '0.65rem' }}>
              <span style={{ width: 5, height: 5, borderRadius: '99px', background: '#10B981', display: 'inline-block', animation: 'pulse-dot 1.2s ease-in-out infinite' }} />
              {fmtElapsed(elapsed, null)}
            </span>
          ) : elapsed > 0 ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(24,24,27,0.04)', border: '1px solid rgba(24,24,27,0.08)', borderRadius: 6, padding: '2px 8px', fontSize: '0.65rem', fontWeight: 600, color: '#64748B' }}>
              {fmtElapsed(elapsed, null)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Draggable wrapper ─────────────────────── */
export function DraggableTicket({ ticket, isSelected, showSelect, onToggleSelect, now, onSingleClick, onDoubleClickTitle, editingTicketId, editingTitle, onEditTitle, onSaveTitle, onDuplicate }: {
  ticket: Ticket; isSelected: boolean; showSelect: boolean; onToggleSelect: () => void; now: number;
  onSingleClick: (e: React.MouseEvent) => void;
  onDoubleClickTitle: () => void;
  editingTicketId: string | null; editingTitle: string;
  onEditTitle: (v: string) => void; onSaveTitle: () => void;
  onDuplicate: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: ticket.id, data: { ticket } });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.3 : 1, transition: 'opacity 0.15s', touchAction: 'none' }}
    >
      <TicketCard
        ticket={ticket} isSelected={isSelected} isDragging={false}
        now={now} showSelect={showSelect} onToggleSelect={onToggleSelect}
        onSingleClick={onSingleClick}
        onDoubleClickTitle={onDoubleClickTitle}
        editingTitle={editingTicketId === ticket.id ? editingTitle : null}
        onEditTitle={onEditTitle}
        onSaveTitle={onSaveTitle}
        onDuplicate={onDuplicate}
      />
    </div>
  );
}

/* Status color map for column header dots */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCenter,
  useSensor, useSensors, useDroppable, useDraggable,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Search, X, AlertTriangle, Copy, CheckSquare, MessageCircle } from 'lucide-react';
import {
  type Ticket, STATUSES, DESIGNERS, PRIORITIES, PRIORITY_STYLE, DEFAULT_WIP_LIMITS, SEED_TICKETS,
} from '../types';
import TicketSlideOver from './TicketSlideOver';
import { ToastContainer, useToast } from './Toast';

/* ── Assignee color map ──────────────────────── */
const ASSIGNEE_COLORS: Record<string, string> = {
  Alice:   '#8B5CF6',
  Bob:     '#059669',
  Charlie: '#f97316',
};

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
function SLABadge({ dueAt }: { dueAt?: string }) {
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
function TicketCard({
  ticket, isSelected = false, isDragging = false,
  now,
  onSingleClick, onDoubleClickTitle,
  editingTitle, onEditTitle, onSaveTitle, onDuplicate,
}: {
  ticket: Ticket; isSelected?: boolean; isDragging?: boolean;
  now: number;
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
        border:         isSelected ? '1px solid #3b82f6' : isDragging ? '1px solid rgba(59,130,246,0.4)' : undefined,
        padding:        '1rem',
        boxShadow:      isDragging ? '0 24px 48px rgba(0,63,138,0.1)' : isSelected ? '0 0 0 2px rgba(59,130,246,0.3)' : undefined,
        transform:      isDragging ? 'rotate(2deg) scale(1.03)' : 'none',
        cursor:         isDragging ? 'grabbing' : 'grab',
        transition:     isDragging ? 'none' : 'box-shadow 0.2s, border-color 0.2s, transform 0.15s',
        userSelect:     'none',
        position:       'relative',
      }}
    >
      {/* Ticket number + badges */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
        <span style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.1em', color: '#94a3b8', textTransform: 'uppercase', fontFamily: 'var(--font-body)' }}>{ticket.number}</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
          {ticket.info_score !== undefined && (
            <span className={ticket.info_score < 90 ? 'badge-red' : 'badge-green'} title="AI Info Score">
              AI {ticket.info_score}%
            </span>
          )}
          <button
            onClick={e => { e.stopPropagation(); onDuplicate(); }}
            title="Duplicate Ticket"
            style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: 2, marginRight: 2 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#003F8A'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#94a3b8'}
          >
            <Copy size={13} />
          </button>
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
          style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: '#0f172a', lineHeight: 1.35, marginBottom: '0.5rem', letterSpacing: '-0.01em' }}
        >
          {ticket.title}
        </h4>
      )}

      {/* Tags */}
      {ticket.tags?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: '0.5rem' }}>
          {ticket.tags.map(tag => (
            <span key={tag} style={{ fontSize: '0.62rem', fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'rgba(139,92,246,0.07)', border: '1px solid rgba(139,92,246,0.18)', color: '#7c3aed', fontFamily: 'var(--font-body)' }}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Assignee avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.625rem' }}>
        <div style={{ width: 20, height: 20, borderRadius: '99px', background: ASSIGNEE_COLORS[ticket.assignee] ?? '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem', fontWeight: 800, color: 'white', flexShrink: 0 }}>
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
          {ticket.comments?.length > 0 && (
            <span className="ticket-meta-chip">
              <MessageCircle size={10} />
              {ticket.comments.length}
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
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(0,63,138,0.04)', border: '1px solid rgba(0,63,138,0.08)', borderRadius: 6, padding: '2px 8px', fontSize: '0.65rem', fontWeight: 600, color: '#64748B' }}>
              {fmtElapsed(elapsed, null)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Draggable wrapper ─────────────────────── */
function DraggableTicket({ ticket, isSelected, now, onSingleClick, onDoubleClickTitle, editingTicketId, editingTitle, onEditTitle, onSaveTitle, onDuplicate }: {
  ticket: Ticket; isSelected: boolean; now: number;
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
        now={now}
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
const STATUS_COLORS: Record<string, string> = {
  'New':                  '#94a3b8',
  'Assigned':             '#3b82f6',
  'In Progress':          '#8b5cf6',
  'Waiting on Requester': '#f59e0b',
  'In Review':            '#06b6d4',
  'Delivered':            '#10b981',
  'Closed':               '#475569',
};

/* ── Droppable Column ─────────────────────── */
function DroppableColumn({ id, label, count, wipLimit, isOver, children }: {
  id: string; label: string; count: number; wipLimit?: number; isOver: boolean; children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id });
  const exceeded = wipLimit !== undefined && count > wipLimit;
  const dotColor = STATUS_COLORS[label] ?? '#94a3b8';
  return (
    <div ref={setNodeRef} className="glass-card" style={{
      flexShrink: 0, width: 276,
      display: 'flex', flexDirection: 'column',
      background: isOver ? 'rgba(59,130,246,0.015)' : undefined,
      border: isOver ? '1px solid rgba(59,130,246,0.18)' : undefined,
      maxHeight: '100%', transition: 'border-color 0.2s, background 0.2s',
    }}>
      {/* Column header */}
      <div style={{
        padding: '0.75rem 0.875rem 0.65rem',
        borderBottom: '1px solid rgba(226, 232, 240, 0.7)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderRadius: '12px 12px 0 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: dotColor, flexShrink: 0, opacity: isOver ? 1 : 0.85 }} />
          <h3 style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: isOver ? '#2563eb' : '#374151' }}>{label}</h3>
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {exceeded && (
            <span title={`WIP limit: ${wipLimit}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: 6, padding: '1px 6px', color: '#EF4444', fontSize: '0.62rem', fontWeight: 800 }}>
              <AlertTriangle size={9} /> {count}/{wipLimit}
            </span>
          )}
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, borderRadius: 6, background: isOver ? 'rgba(59,130,246,0.12)' : '#f1f5f9', border: `1px solid ${isOver ? 'rgba(59,130,246,0.2)' : '#e2e8f0'}`, fontSize: '0.65rem', fontWeight: 800, color: isOver ? '#2563eb' : '#64748B', padding: '0 5px' }}>{count}</span>
        </div>
      </div>
      <div style={{ padding: '0.625rem', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {children}
        {count === 0 && (
          <div className={`empty-drop-zone${isOver ? ' is-over' : ''}`}>
            {isOver ? '↓ Drop here' : 'No tickets'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main KanbanBoard ─────────────────────── */
const KanbanBoard = () => {
  const [tickets,       setTickets]       = useState<Ticket[]>(SEED_TICKETS);
  const [groupBy]                 = useState<'status' | 'assignee' | 'priority'>('assignee');
  const [searchQuery,   setSearchQuery]   = useState('');
  const [filterPrio,    setFilterPrio]    = useState('');
  const [filterAssignee,setFilterAssignee]= useState('');
  const [filterSLA,     setFilterSLA]     = useState<'all' | 'overdue' | 'ok'>('all');
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set());
  const [slideOverId,   setSlideOverId]   = useState<string | null>(null);
  const [editingId,     setEditingId]     = useState<string | null>(null);
  const [editingTitle,  setEditingTitle]  = useState('');
  const [wipLimits]                       = useState(DEFAULT_WIP_LIMITS);
  const [activeTicket,  setActiveTicket]  = useState<Ticket | null>(null);
  const [overColId,     setOverColId]     = useState<string | null>(null);
  const [now,           setNow]           = useState(Date.now());

  const { toasts, addToast, removeToast } = useToast();

  /* 1-second clock for real-time timers */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /* ── Computed ── */
  const getGroupKey = (t: Ticket) =>
    groupBy === 'assignee' ? (t.assignee || 'Unassigned') :
    groupBy === 'priority' ? t.priority : t.status;

  const getGroupings = () =>
    groupBy === 'assignee' ? DESIGNERS :
    groupBy === 'priority' ? PRIORITIES : STATUSES;

  /* Filtered tickets (opacity-fade rather than hide) */
  const matchesFilter = useCallback((t: Ticket) => {
    const q = searchQuery.toLowerCase();
    if (q && !t.title.toLowerCase().includes(q) && !t.number.toLowerCase().includes(q)) return false;
    if (filterPrio && t.priority !== filterPrio) return false;
    if (filterAssignee && (t.assignee || 'Unassigned') !== filterAssignee) return false;
    if (filterSLA === 'overdue' && new Date(t.due_at) > new Date()) return false;
    if (filterSLA === 'ok'      && new Date(t.due_at) <= new Date()) return false;
    return true;
  }, [searchQuery, filterPrio, filterAssignee, filterSLA]);

  const activeFilters = !!(searchQuery || filterPrio || filterAssignee || filterSLA !== 'all');

  const slideOverTicket = tickets.find(t => t.id === slideOverId) ?? null;

  const updateTicket = useCallback((id: string, patch: Partial<Ticket>) => {
    setTickets(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  /* ── Inline edit ── */
  const startEdit = (t: Ticket) => { setEditingId(t.id); setEditingTitle(t.title); };
  const saveEdit  = () => {
    if (editingId && editingTitle.trim()) updateTicket(editingId, { title: editingTitle.trim() });
    setEditingId(null);
  };

  const handleDuplicateTicket = (ticket: Ticket) => {
    const nextNumber = Math.max(...tickets.map(t => parseInt(t.number.split('-')[1] || '0'))) + 1;
    const newTicket: Ticket = {
      ...ticket,
      id: Date.now().toString(),
      number: `DF-${String(nextNumber).padStart(4, '0')}`,
      title: `${ticket.title} (Copy)`,
      status: 'New',
      timer_started_at: null,
      time_spent_seconds: 0,
    };
    setTickets(prev => [...prev, newTicket]);
    addToast(`Duplicated as ${newTicket.number}`, 'success');
  };

  /* ── Click logic ── */
  const handleCardClick = (e: React.MouseEvent, ticket: Ticket) => {
    if (editingId === ticket.id) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      setSelectedIds(prev => {
        const n = new Set(prev);
        n.has(ticket.id) ? n.delete(ticket.id) : n.add(ticket.id);
        return n;
      });
    } else {
      setSlideOverId(ticket.id);
    }
  };

  /* ── DnD ── */
  const handleDragStart  = (e: DragStartEvent)  => setActiveTicket(tickets.find(t => t.id === e.active.id) ?? null);
  const handleDragOver   = (e: any)             => setOverColId(e.over?.id ?? null);
  const handleDragEnd    = (e: DragEndEvent)    => {
    const { active, over } = e;
    setActiveTicket(null); setOverColId(null);
    if (!over) return;

    const ticketId  = String(active.id);
    const targetCol = String(over.id);
    const ticket    = tickets.find(t => t.id === ticketId);
    if (!ticket) return;

    let patch: Partial<Ticket> = {};
    if (groupBy === 'status')   patch = { status:   targetCol };
    if (groupBy === 'assignee') patch = { assignee: targetCol === 'Unassigned' ? '' : targetCol };
    if (groupBy === 'priority') patch = { priority: targetCol };

    if (!Object.keys(patch).length) return;
    updateTicket(ticketId, patch);

    const to = patch.status ?? patch.assignee ?? patch.priority ?? targetCol;
    addToast(`DF-${ticket.number.split('-')[1]} moved to "${to || 'Unassigned'}"`, 'success');
  };

  /* ── Render board column list ── */
  const renderBoardColumns = () => {
    const GROUPINGS = getGroupings();
    return GROUPINGS.map(group => {
      const colTickets = tickets.filter(t => getGroupKey(t) === group);
      return (
        <DroppableColumn
          key={group} id={group} label={group}
          count={colTickets.length}
          wipLimit={wipLimits[group]}
          isOver={overColId === group}
        >
          {colTickets.map(ticket => (
            <div
              key={ticket.id}
              style={{ opacity: matchesFilter(ticket) ? 1 : 0.2, transition: 'opacity 0.25s' }}
            >
              <DraggableTicket
                ticket={ticket}
                isSelected={selectedIds.has(ticket.id)}
                now={now}
                onSingleClick={e => handleCardClick(e, ticket)}
                onDoubleClickTitle={() => startEdit(ticket)}
                editingTicketId={editingId}
                editingTitle={editingTitle}
                onEditTitle={setEditingTitle}
                onSaveTitle={saveEdit}
                onDuplicate={() => handleDuplicateTicket(ticket)}
              />
            </div>
          ))}
        </DroppableColumn>
      );
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Filter / Controls Bar ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.625rem', alignItems: 'center', marginBottom: '1rem' }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 160, maxWidth: 300 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            className="input-field"
            placeholder="Search tickets…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '2.1rem', paddingRight: searchQuery ? '2rem' : undefined, width: '100%' }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 2 }}><X size={13} /></button>
          )}
        </div>

        {/* Priority filter */}
        <select className="input-field" value={filterPrio} onChange={e => setFilterPrio(e.target.value)} style={{ width: 'auto', padding: '0.4rem 0.75rem', fontSize: '0.78rem' }}>
          <option value="">All Priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        {/* Assignee filter */}
        <select className="input-field" value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} style={{ width: 'auto', padding: '0.4rem 0.75rem', fontSize: '0.78rem' }}>
          <option value="">All Designers</option>
          {DESIGNERS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>

        {/* SLA filter */}
        <select className="input-field" value={filterSLA} onChange={e => setFilterSLA(e.target.value as any)} style={{ width: 'auto', padding: '0.4rem 0.75rem', fontSize: '0.78rem' }}>
          <option value="all">All SLA</option>
          <option value="overdue">Overdue</option>
          <option value="ok">On Track</option>
        </select>

        {activeFilters && (
          <button
            onClick={() => { setSearchQuery(''); setFilterPrio(''); setFilterAssignee(''); setFilterSLA('all'); }}
            className="chip"
            style={{ color: '#EF4444', borderColor: 'rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <X size={11} /> Clear filters
          </button>
        )}

      </div>

      {/* Bulk action floating bar */}
      {selectedIds.size > 0 && (
        <div className="animate-fade-in" style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          zIndex: 50, display: 'flex', alignItems: 'center', gap: '0.5rem',
          background: '#0f172a', borderRadius: 14, padding: '0.6rem 1rem',
          boxShadow: '0 8px 32px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.15)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'rgba(255,255,255,0.7)', paddingRight: '0.5rem', borderRight: '1px solid rgba(255,255,255,0.12)' }}>
            {selectedIds.size} ticket{selectedIds.size > 1 ? 's' : ''} selected
          </span>

          {/* Move to status */}
          <select
            className="input-field"
            onChange={e => {
              if (!e.target.value) return;
              selectedIds.forEach(id => updateTicket(id, { status: e.target.value }));
              addToast(`Moved ${selectedIds.size} ticket${selectedIds.size > 1 ? 's' : ''} to "${e.target.value}"`, 'success');
              setSelectedIds(new Set());
              e.target.value = '';
            }}
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)', borderRadius: 8, fontSize: '0.75rem', padding: '0.3rem 0.6rem', cursor: 'pointer', width: 'auto' }}
            defaultValue=""
          >
            <option value="" disabled>Move to…</option>
            {STATUSES.map(s => <option key={s} value={s} style={{ background: '#0f172a' }}>{s}</option>)}
          </select>

          {/* Reassign */}
          <select
            className="input-field"
            onChange={e => {
              if (!e.target.value) return;
              const assignee = e.target.value === 'Unassigned' ? '' : e.target.value;
              selectedIds.forEach(id => updateTicket(id, { assignee }));
              addToast(`Reassigned ${selectedIds.size} ticket${selectedIds.size > 1 ? 's' : ''} to ${e.target.value}`, 'success');
              setSelectedIds(new Set());
              e.target.value = '';
            }}
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)', borderRadius: 8, fontSize: '0.75rem', padding: '0.3rem 0.6rem', cursor: 'pointer', width: 'auto' }}
            defaultValue=""
          >
            <option value="" disabled>Reassign to…</option>
            {DESIGNERS.map(d => <option key={d} value={d} style={{ background: '#0f172a' }}>{d}</option>)}
          </select>

          {/* Delete */}
          <button
            onClick={() => {
              if (!confirm(`Delete ${selectedIds.size} ticket${selectedIds.size > 1 ? 's' : ''}?`)) return;
              setTickets(prev => prev.filter(t => !selectedIds.has(t.id)));
              addToast(`Deleted ${selectedIds.size} ticket${selectedIds.size > 1 ? 's' : ''}`, 'error');
              setSelectedIds(new Set());
            }}
            style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', borderRadius: 8, padding: '0.3rem 0.7rem', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
          >
            Delete
          </button>

          {/* Clear */}
          <button
            onClick={() => setSelectedIds(new Set())}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: '0.3rem', display: 'flex', alignItems: 'center' }}
            title="Clear selection"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* ── Board ── */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
        <div style={{ display: 'flex', flex: 1, gap: '0.75rem', overflowX: 'auto', paddingBottom: '0.5rem', alignItems: 'flex-start' }}>
          {renderBoardColumns()}
        </div>

        <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.4,0,0.2,1)' }}>
          {activeTicket && (
            <TicketCard
              ticket={activeTicket} isDragging={true} now={now}
              onSingleClick={() => {}} onDoubleClickTitle={() => {}}
              editingTitle={null} onEditTitle={() => {}} onSaveTitle={() => {}}
              onDuplicate={() => {}}
            />
          )}
        </DragOverlay>
      </DndContext>

      {/* Slide-over */}
      <TicketSlideOver
        ticket={slideOverTicket}
        onClose={() => setSlideOverId(null)}
        onUpdate={updateTicket}
      />

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
};

export default KanbanBoard;


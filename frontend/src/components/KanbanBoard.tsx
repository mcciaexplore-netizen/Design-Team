import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCenter,
  useSensor, useSensors, useDroppable, useDraggable,
  type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Search, X, AlertTriangle, Copy, CheckSquare, MessageCircle, Bookmark, Save, Trash2 } from 'lucide-react';
import {
  type Ticket, STATUSES, PRIORITIES, PRIORITY_STYLE, DEFAULT_WIP_LIMITS,
} from '../types';
import TicketSlideOver from './TicketSlideOver';
import { ToastContainer, useToast } from './Toast';
import { useTickets, colorFor } from '../contexts/TicketsContext';
import { useAuth } from '../contexts/AuthContext';
import { apiJson } from '../api';

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
function DraggableTicket({ ticket, isSelected, showSelect, onToggleSelect, now, onSingleClick, onDoubleClickTitle, editingTicketId, editingTitle, onEditTitle, onSaveTitle, onDuplicate }: {
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
const STATUS_COLORS: Record<string, string> = {
  'New':                  '#94a3b8',
  'Assigned':             '#52525b',
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
      background: isOver ? 'rgba(24,24,27,0.015)' : undefined,
      border: isOver ? '1px solid rgba(24,24,27,0.18)' : undefined,
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
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, borderRadius: 6, background: isOver ? 'rgba(24,24,27,0.12)' : '#f1f5f9', border: `1px solid ${isOver ? 'rgba(24,24,27,0.2)' : '#e2e8f0'}`, fontSize: '0.65rem', fontWeight: 800, color: isOver ? '#2563eb' : '#64748B', padding: '0 5px' }}>{count}</span>
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

/* ── Filters & views ─────────────────────────── */
interface BoardFilters {
  search:     string;
  statuses:   string[];
  priorities: string[];
  assignee:   string | null;       // 'me' | 'unassigned' | user id
  requester:  'me' | null;
  sla:        'any' | 'overdue' | 'breaching_soon' | 'on_track';
  tags:       string[];
}

interface SavedView { id: number; name: string; filters: BoardFilters; is_shared: boolean; owner: string; is_mine: boolean }

const EMPTY_FILTERS: BoardFilters = { search: '', statuses: [], priorities: [], assignee: null, requester: null, sla: 'any', tags: [] };
const DONE_STATUSES = ['Delivered', 'Closed', 'Closed without approval'];
const SOON_MS = 4 * 3_600_000;

const QUICK_VIEWS: { id: string; name: string; filters: Partial<BoardFilters> }[] = [
  { id: 'q:all',      name: 'All tickets',      filters: {} },
  { id: 'q:mine',     name: 'My tickets',       filters: { assignee: 'me' } },
  { id: 'q:soon',     name: 'Breaching soon',   filters: { sla: 'breaching_soon' } },
  { id: 'q:overdue',  name: 'Overdue',          filters: { sla: 'overdue' } },
  { id: 'q:urgent',   name: 'Urgent & high',    filters: { priorities: ['Urgent', 'High'] } },
  { id: 'q:waiting',  name: 'Waiting on client', filters: { statuses: ['Waiting on Requester'] } },
  { id: 'q:review',   name: 'In review',        filters: { statuses: ['In Review'] } },
];

function ticketMatches(t: Ticket, f: BoardFilters, myId: number | null, nowMs: number): boolean {
  const q = f.search.trim().toLowerCase();
  if (q && ![t.title, t.number, t.assignee, ...(t.tags ?? [])].some(x => x?.toLowerCase().includes(q))) return false;
  if (f.statuses.length && !f.statuses.includes(t.status)) return false;
  if (f.priorities.length && !f.priorities.includes(t.priority)) return false;
  if (f.assignee === 'me' && (myId === null || t.assignee_id !== myId)) return false;
  if (f.assignee === 'unassigned' && t.assignee_id) return false;
  if (f.assignee && f.assignee !== 'me' && f.assignee !== 'unassigned' && String(t.assignee_id ?? '') !== f.assignee) return false;
  if (f.requester === 'me' && (myId === null || t.requester_id !== myId)) return false;
  if (f.tags.length && !f.tags.some(x => (t.tags ?? []).includes(x))) return false;
  if (f.sla !== 'any') {
    const open = !DONE_STATUSES.includes(t.status);
    const due = t.due_at ? new Date(t.due_at).getTime() : NaN;
    if (!open || Number.isNaN(due)) return false;
    const left = due - nowMs;
    if (f.sla === 'overdue' && left > 0) return false;
    if (f.sla === 'breaching_soon' && !(left > 0 && left <= SOON_MS)) return false;
    if (f.sla === 'on_track' && left <= SOON_MS) return false;
  }
  return true;
}

const sameFilters = (a: BoardFilters, b: BoardFilters) => JSON.stringify(a) === JSON.stringify(b);

/* ── Main KanbanBoard ─────────────────────── */
type GroupBy = 'status' | 'assignee';

const KanbanBoard = () => {
  const { user } = useAuth();
  const { tickets, staff, loading, error, refresh, updateTicket, bulkUpdate } = useTickets();
  const isLead = user?.role === 'Design Lead';
  const myId = user ? Number(user.id) : null;

  const [groupBy, setGroupBy] = useState<GroupBy>(() => (localStorage.getItem('board_group') === 'assignee' ? 'assignee' : 'status'));
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const [activeView, setActiveView] = useState<string>('q:all');
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [savingView, setSavingView] = useState(false);
  const [viewName, setViewName] = useState('');
  const [viewShared, setViewShared] = useState(false);
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set());
  const [slideOverId,   setSlideOverId]   = useState<string | null>(null);
  const [editingId,     setEditingId]     = useState<string | null>(null);
  const [editingTitle,  setEditingTitle]  = useState('');
  const [wipLimits]                       = useState(DEFAULT_WIP_LIMITS);
  const [activeTicket,  setActiveTicket]  = useState<Ticket | null>(null);
  const [overColId,     setOverColId]     = useState<string | null>(null);
  const [now,           setNow]           = useState(Date.now());
  const [bulkTag,       setBulkTag]       = useState('');

  const { toasts, addToast, removeToast } = useToast();
  const fail = useCallback((e: unknown, fallback: string) => addToast(e instanceof Error ? e.message : fallback, 'error'), [addToast]);

  /* 1-second clock for real-time timers */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { try { localStorage.setItem('board_group', groupBy); } catch { /* private mode */ } }, [groupBy]);

  /* Saved views */
  const loadViews = useCallback(async () => {
    try { setSavedViews(await apiJson<SavedView[]>('/api/views')); } catch { /* views are optional */ }
  }, []);
  useEffect(() => { void loadViews(); }, [loadViews]);

  /* Escape clears the selection */
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedIds(prev => (prev.size ? new Set() : prev)); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /* ── Computed ── */
  const visible = useMemo(() => tickets.filter(t => ticketMatches(t, filters, myId, now)), [tickets, filters, myId, Math.floor(now / 30_000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const assigneeColumns = useMemo(() => {
    const names = ['Unassigned', ...staff.map(s => s.name)];
    for (const t of tickets) if (t.assignee && !names.includes(t.assignee)) names.push(t.assignee);
    return names;
  }, [staff, tickets]);

  const getGroupKey = (t: Ticket) => (groupBy === 'assignee' ? (t.assignee || 'Unassigned') : t.status);
  const groupings = groupBy === 'assignee' ? assigneeColumns : STATUSES;

  const filtersActive = !sameFilters(filters, EMPTY_FILTERS);
  const currentSaved = savedViews.find(v => `s:${v.id}` === activeView);
  const slideOverTicket = tickets.find(t => t.id === slideOverId) ?? null;

  /* ── View handling ── */
  const applyFilters = (patch: Partial<BoardFilters>) => {
    setFilters(prev => ({ ...prev, ...patch }));
    setActiveView('custom');
  };

  const chooseView = (id: string) => {
    setSavingView(false);
    if (id === 'custom') return;
    if (id.startsWith('q:')) {
      const v = QUICK_VIEWS.find(x => x.id === id);
      setFilters({ ...EMPTY_FILTERS, ...(v?.filters ?? {}) });
    } else {
      const v = savedViews.find(x => `s:${x.id}` === id);
      if (v) setFilters({ ...EMPTY_FILTERS, ...v.filters });
    }
    setActiveView(id);
  };

  const saveView = async () => {
    const name = viewName.trim();
    if (!name) return;
    try {
      const v = await apiJson<SavedView>('/api/views', { method: 'POST', json: { name, filters, is_shared: viewShared } });
      await loadViews();
      setActiveView(`s:${v.id}`);
      setSavingView(false); setViewName(''); setViewShared(false);
      addToast(`Saved view "${v.name}"`, 'success');
    } catch (e) { fail(e, 'Could not save the view.'); }
  };

  const deleteView = async (v: SavedView) => {
    try {
      await apiJson(`/api/views/${v.id}`, { method: 'DELETE' });
      await loadViews();
      chooseView('q:all');
      addToast(`Deleted view "${v.name}"`, 'info');
    } catch (e) { fail(e, 'Could not delete the view.'); }
  };

  /* ── Inline edit ── */
  const startEdit = (t: Ticket) => { setEditingId(t.id); setEditingTitle(t.title); };
  const saveEdit  = () => {
    const id = editingId, title = editingTitle.trim();
    setEditingId(null);
    if (id && title && title !== tickets.find(t => t.id === id)?.title) {
      updateTicket(id, { title }).catch(e => fail(e, 'Could not rename the ticket.'));
    }
  };

  const handleDuplicateTicket = async (ticket: Ticket) => {
    try {
      const copy = await apiJson<{ ticket_number: string }>(`/api/tickets/${ticket.id}/duplicate`, { method: 'POST' });
      await refresh();
      addToast(`Duplicated as ${copy.ticket_number}`, 'success');
    } catch (e) { fail(e, 'Could not duplicate the ticket.'); }
  };

  /* ── Click logic ── */
  const toggleSelect = (id: string) =>
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const handleCardClick = (e: React.MouseEvent, ticket: Ticket) => {
    if (editingId === ticket.id) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) toggleSelect(ticket.id);
    else if (selectedIds.size > 0) toggleSelect(ticket.id);
    else setSlideOverId(ticket.id);
  };

  /* ── DnD ── */
  const handleDragStart  = (e: DragStartEvent)  => setActiveTicket(tickets.find(t => t.id === e.active.id) ?? null);
  const handleDragOver   = (e: DragOverEvent)   => setOverColId(e.over ? String(e.over.id) : null);
  const handleDragEnd    = (e: DragEndEvent)    => {
    const { active, over } = e;
    setActiveTicket(null); setOverColId(null);
    if (!over) return;

    const ticketId  = String(active.id);
    const targetCol = String(over.id);
    const ticket    = tickets.find(t => t.id === ticketId);
    if (!ticket || getGroupKey(ticket) === targetCol) return;
    if (groupBy === 'assignee' && !isLead) { addToast('Only a Design Lead can reassign tickets.', 'warning'); return; }

    const patch: Partial<Ticket> = groupBy === 'status' ? { status: targetCol } : { assignee: targetCol === 'Unassigned' ? '' : targetCol };
    updateTicket(ticketId, patch)
      .then(() => addToast(`${ticket.number} moved to "${targetCol}"`, 'success'))
      .catch(e => fail(e, 'Could not move the ticket.'));
  };

  /* ── Bulk actions (server-side, with per-ticket results) ── */
  const runBulk = async (change: Parameters<typeof bulkUpdate>[1], label: string) => {
    const ids = [...selectedIds];
    try {
      const res = await bulkUpdate(ids, change);
      if (res.updated.length) addToast(`${label}: ${res.updated.length} ticket${res.updated.length > 1 ? 's' : ''} updated`, 'success');
      if (res.failed.length) addToast(`${res.failed.length} could not be changed (${[...new Set(res.failed.map(f => f.reason))].join(', ')})`, 'warning');
      setSelectedIds(new Set());
    } catch (e) { fail(e, 'Bulk update failed.'); }
  };

  /* ── Render board column list ── */
  const renderBoardColumns = () =>
    groupings.map(group => {
      const colTickets = visible.filter(t => getGroupKey(t) === group);
      return (
        <DroppableColumn
          key={group} id={group} label={group}
          count={colTickets.length}
          wipLimit={groupBy === 'status' ? wipLimits[group] : undefined}
          isOver={overColId === group}
        >
          {colTickets.map(ticket => (
            <DraggableTicket
              key={ticket.id}
              ticket={ticket}
              isSelected={selectedIds.has(ticket.id)}
              showSelect={selectedIds.size > 0}
              onToggleSelect={() => toggleSelect(ticket.id)}
              now={now}
              onSingleClick={e => handleCardClick(e, ticket)}
              onDoubleClickTitle={() => startEdit(ticket)}
              editingTicketId={editingId}
              editingTitle={editingTitle}
              onEditTitle={setEditingTitle}
              onSaveTitle={saveEdit}
              onDuplicate={() => handleDuplicateTicket(ticket)}
            />
          ))}
        </DroppableColumn>
      );
    });

  const ctl = { width: 'auto', padding: '0.4rem 0.75rem', fontSize: '0.78rem' } as const;
  const darkSelect = { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)', borderRadius: 8, fontSize: '0.75rem', padding: '0.3rem 0.6rem', cursor: 'pointer', width: 'auto' } as const;
  const mine = savedViews.filter(v => v.is_mine);
  const shared = savedViews.filter(v => !v.is_mine);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {error && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: '#b91c1c', borderRadius: 10, padding: '0.5rem 0.875rem', marginBottom: '0.75rem', fontSize: '0.8rem' }}>
          {error}
          <button type="button" className="btn-ghost" style={{ padding: '0.25rem 0.7rem', fontSize: '0.75rem', marginLeft: 'auto' }} onClick={() => void refresh()}>Retry</button>
        </div>
      )}

      {/* ── Views + filters ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
        <label className="section-label" htmlFor="board-view" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Bookmark size={12} /> View</label>
        <select id="board-view" className="input-field" value={activeView} onChange={e => chooseView(e.target.value)} style={{ ...ctl, minWidth: 170 }}>
          {activeView === 'custom' && <option value="custom">Custom filters</option>}
          <optgroup label="Quick views">
            {QUICK_VIEWS.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </optgroup>
          {mine.length > 0 && <optgroup label="My views">{mine.map(v => <option key={v.id} value={`s:${v.id}`}>{v.name}</option>)}</optgroup>}
          {shared.length > 0 && <optgroup label="Shared by the team">{shared.map(v => <option key={v.id} value={`s:${v.id}`}>{v.name} ({v.owner})</option>)}</optgroup>}
        </select>

        {filtersActive && !savingView && activeView === 'custom' && (
          <button type="button" className="btn-ghost" style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }} onClick={() => setSavingView(true)}>
            <Save size={12} /> Save view
          </button>
        )}
        {currentSaved && (currentSaved.is_mine || isLead) && (
          <button type="button" className="chip" onClick={() => void deleteView(currentSaved)} style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Delete this saved view">
            <Trash2 size={11} /> Delete view
          </button>
        )}

        <div role="group" aria-label="Group board by" style={{ marginLeft: 'auto', display: 'inline-flex', border: '1px solid rgba(226,232,240,0.9)', borderRadius: 9, overflow: 'hidden', background: 'white' }}>
          {(['status', 'assignee'] as GroupBy[]).map(g => (
            <button key={g} type="button" onClick={() => setGroupBy(g)} aria-pressed={groupBy === g}
              style={{ padding: '0.35rem 0.8rem', fontSize: '0.74rem', fontWeight: 700, border: 'none', cursor: 'pointer',
                       background: groupBy === g ? 'var(--brand-soft)' : 'transparent', color: groupBy === g ? 'var(--brand)' : '#64748b' }}>
              {g === 'status' ? 'By stage' : 'By person'}
            </button>
          ))}
        </div>
      </div>

      {savingView && (
        <form onSubmit={e => { e.preventDefault(); void saveView(); }} className="animate-fade-in"
          style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem', padding: '0.5rem 0.75rem', background: '#f8fafc', border: '1px solid rgba(226,232,240,0.9)', borderRadius: 10 }}>
          <label htmlFor="view-name" className="section-label">Name this view</label>
          <input id="view-name" className="input-field" autoFocus maxLength={60} value={viewName} onChange={e => setViewName(e.target.value)} placeholder="e.g. Urgent for TATA" style={{ ...ctl, width: 220 }} />
          {isLead && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.76rem', color: '#475569' }}>
              <input type="checkbox" checked={viewShared} onChange={e => setViewShared(e.target.checked)} /> Share with the team
            </label>
          )}
          <button type="submit" className="btn-primary" style={{ padding: '0.35rem 0.9rem', fontSize: '0.76rem' }} disabled={!viewName.trim()}>Save</button>
          <button type="button" className="btn-ghost" style={{ padding: '0.35rem 0.9rem', fontSize: '0.76rem' }} onClick={() => setSavingView(false)}>Cancel</button>
        </form>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 160, maxWidth: 300 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            className="input-field"
            aria-label="Search tickets"
            placeholder="Search tickets…"
            value={filters.search}
            onChange={e => applyFilters({ search: e.target.value })}
            style={{ paddingLeft: '2.1rem', paddingRight: filters.search ? '2rem' : undefined, width: '100%' }}
          />
          {filters.search && (
            <button type="button" aria-label="Clear search" onClick={() => applyFilters({ search: '' })} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 2 }}><X size={13} /></button>
          )}
        </div>

        <select className="input-field" aria-label="Priority" value={filters.priorities.join(',')} onChange={e => applyFilters({ priorities: e.target.value ? e.target.value.split(',') : [] })} style={ctl}>
          <option value="">All priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          <option value="Urgent,High">Urgent + High</option>
        </select>

        <select className="input-field" aria-label="Assignee" value={filters.assignee ?? ''} onChange={e => applyFilters({ assignee: e.target.value || null })} style={ctl}>
          <option value="">Everyone</option>
          <option value="me">Me</option>
          <option value="unassigned">Unassigned</option>
          {staff.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
        </select>

        <select className="input-field" aria-label="SLA" value={filters.sla} onChange={e => applyFilters({ sla: e.target.value as BoardFilters['sla'] })} style={ctl}>
          <option value="any">Any SLA</option>
          <option value="overdue">Overdue</option>
          <option value="breaching_soon">Breaching in 4h</option>
          <option value="on_track">On track</option>
        </select>

        {filtersActive && (
          <button type="button" onClick={() => chooseView('q:all')} className="chip" style={{ color: '#EF4444', borderColor: 'rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <X size={11} /> Clear filters
          </button>
        )}
        <span aria-live="polite" style={{ marginLeft: 'auto', fontSize: '0.74rem', color: '#64748b' }}>
          {filtersActive ? `${visible.length} of ${tickets.length} tickets` : `${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {/* Bulk action floating bar */}
      {selectedIds.size > 0 && (
        <div className="animate-fade-in" role="toolbar" aria-label="Bulk actions" style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          zIndex: 50, display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center',
          maxWidth: 'calc(100vw - 2rem)',
          background: '#0f172a', borderRadius: 14, padding: '0.6rem 1rem',
          boxShadow: '0 8px 32px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.15)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'rgba(255,255,255,0.7)', paddingRight: '0.5rem', borderRight: '1px solid rgba(255,255,255,0.12)' }}>
            {selectedIds.size} selected
          </span>

          <select aria-label="Move selected to stage" className="input-field" defaultValue="" style={darkSelect}
            onChange={e => { const v = e.target.value; e.target.value = ''; if (v) void runBulk({ status: v }, `Moved to ${v}`); }}>
            <option value="" disabled>Move to…</option>
            {STATUSES.map(s => <option key={s} value={s} style={{ background: '#0f172a' }}>{s}</option>)}
          </select>

          {isLead && (
            <>
              <select aria-label="Assign selected to" className="input-field" defaultValue="" style={darkSelect}
                onChange={e => { const v = e.target.value; e.target.value = ''; if (!v) return; void runBulk({ assignee_id: v === 'none' ? null : Number(v) }, 'Reassigned'); }}>
                <option value="" disabled>Assign to…</option>
                <option value="none" style={{ background: '#0f172a' }}>Unassigned</option>
                {staff.map(s => <option key={s.id} value={s.id} style={{ background: '#0f172a' }}>{s.name}</option>)}
              </select>
              <select aria-label="Set priority of selected" className="input-field" defaultValue="" style={darkSelect}
                onChange={e => { const v = e.target.value; e.target.value = ''; if (v) void runBulk({ priority: v }, `Priority ${v}`); }}>
                <option value="" disabled>Priority…</option>
                {PRIORITIES.map(p => <option key={p} value={p} style={{ background: '#0f172a' }}>{p}</option>)}
              </select>
            </>
          )}

          <form style={{ display: 'flex', gap: 4 }} onSubmit={e => { e.preventDefault(); const tag = bulkTag.trim(); if (tag) { void runBulk({ add_tags: [tag] }, `Tagged "${tag}"`); setBulkTag(''); } }}>
            <input aria-label="Add tag to selected" className="input-field" value={bulkTag} maxLength={30} onChange={e => setBulkTag(e.target.value)} placeholder="Add tag…" style={{ ...darkSelect, width: 110, cursor: 'text' }} />
            <button type="submit" disabled={!bulkTag.trim()} style={{ ...darkSelect, fontWeight: 700 }}>Add</button>
          </form>

          <button type="button" onClick={() => setSelectedIds(new Set())}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', padding: '0.3rem', display: 'flex', alignItems: 'center' }}
            title="Clear selection (Esc)" aria-label="Clear selection">
            <X size={15} />
          </button>
        </div>
      )}

      {/* ── Board ── */}
      {loading && tickets.length === 0 ? (
        <div role="status" style={{ display: 'flex', gap: '0.75rem' }}>
          {[0, 1, 2, 3].map(i => <div key={i} className="glass-card" style={{ width: 276, height: 220, opacity: 0.5 }} />)}
        </div>
      ) : (
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
      )}

      {/* Slide-over */}
      <TicketSlideOver ticket={slideOverTicket} onClose={() => setSlideOverId(null)} />

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
};

export default KanbanBoard;

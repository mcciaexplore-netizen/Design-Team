import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCenter,
  useSensor, useSensors,
  type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Search, X, Bookmark, Save, Trash2 } from 'lucide-react';
import {
  type Ticket, STATUSES, PRIORITIES, DEFAULT_WIP_LIMITS,
} from '../types';
import TicketSlideOver from './TicketSlideOver';
import { ToastContainer, useToast } from './Toast';
import { useTickets } from '../contexts/TicketsContext';
import { useAuth } from '../contexts/AuthContext';
import { apiJson } from '../api';

/* ── helpers ─────────────────────────────────── */
import { DraggableTicket, TicketCard } from './board/TicketCard';
import { DroppableColumn } from './board/BoardColumn';
import { EMPTY_FILTERS, QUICK_VIEWS, sameFilters, ticketMatches, type BoardFilters, type GroupBy, type SavedView } from './board/boardFilters';

/* ── Main KanbanBoard ─────────────────────── */

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

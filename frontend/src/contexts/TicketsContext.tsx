import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiJson } from '../api';
import { useAuth } from './AuthContext';
import type { Subtask, Ticket } from '../types';

/* ── API shapes ───────────────────────────────── */
interface ApiUser { id: number; email: string; full_name: string; role: 'Requester' | 'Designer' | 'Design Lead' | 'Admin'; is_active: boolean }

export interface DesignType {
  id: number;
  name: string;
  default_sla_hours: number;
  default_effort_hours?: number;
  edit_window_hours?: number | null;
  required_fields: { name: string; label: string; type: string; options?: string[] }[];
}

interface ApiTicket {
  id: number; ticket_number: string; title: string; brief: string; status: string; priority: string;
  tags: string[]; figma_url: string | null; assignee_id: number | null; requester_id: number;
  assignee: ApiUser | null; requester: ApiUser; design_type: DesignType;
  type_specific_fields: Record<string, unknown>;
  created_at?: string; due_at: string | null; is_overdue: boolean; is_locked: boolean; parent_id: number | null; version_number: number;
  reason_for_change: string | null; revision_count: number; client_org: string | null; estimate_hours: number | null;
  timer_started_at: string | null; time_spent_seconds: number;
  subtasks: { id: number; title: string; is_completed: boolean }[];
}

export interface StaffUser { id: number; name: string; role: ApiUser['role']; email: string }
export interface ClientUser { id: number; name: string; email: string }

export interface NewTicketInput {
  title: string;
  brief: string;
  design_type_id: number;
  priority: string;
  tags: string[];
  type_specific_fields: Record<string, unknown>;
  figma_url?: string | null;
  estimate_hours?: number | null;
}

export interface BulkChange {
  status?: string;
  priority?: string;
  assignee_id?: number | null;
  add_tags?: string[];
  remove_tags?: string[];
}

/* ── Mapping ──────────────────────────────────── */
export function mapTicket(b: ApiTicket): Ticket {
  return {
    id: String(b.id),
    number: b.ticket_number,
    title: b.title,
    status: b.status,
    priority: b.priority,
    assignee: b.assignee?.full_name ?? '',
    assignee_id: b.assignee_id,
    requester_id: b.requester_id,
    requester_name: b.requester?.full_name,
    client_org: b.client_org,
    due_at: b.due_at ?? '',
    created_at: b.created_at,
    timer_started_at: b.timer_started_at,
    time_spent_seconds: b.time_spent_seconds,
    subtasks: (b.subtasks ?? []) as Subtask[],
    tags: b.tags ?? [],
    description: b.brief,
    figma_url: b.figma_url ?? undefined,
    parent_id: b.parent_id != null ? String(b.parent_id) : undefined,
    version_number: b.version_number,
    reason_for_change: b.reason_for_change ?? undefined,
    revision_count: b.revision_count,
    is_overdue: b.is_overdue,
    is_locked: b.is_locked,
    estimate_hours: b.estimate_hours,
    design_type: b.design_type?.name,
    type_specific_fields: b.type_specific_fields,
  };
}

/* ── Context ──────────────────────────────────── */
export type TicketChange =
  | { type: 'ticket_moved'; ticketNumber: string; to: string }
  | { type: 'ticket_created'; ticketNumber: string; title: string }
  | { type: 'client_changes'; ticketNumber: string; text: string };

interface TicketsContextValue {
  tickets: Ticket[];
  staff: StaffUser[];            // people tickets can be assigned to
  clients: ClientUser[];         // client (requester) accounts — staff only
  designTypes: DesignType[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Called with what other people changed, as the regular poll notices it. Returns an unsubscribe function. */
  onChanges: (fn: (changes: TicketChange[]) => void) => () => void;
  getTicket: (id: string) => Ticket | undefined;
  createTicket: (input: NewTicketInput) => Promise<Ticket>;
  /** Optimistic update; rolls back and rethrows an ApiError if the server refuses. */
  updateTicket: (id: string, patch: Partial<Ticket>) => Promise<void>;
  bulkUpdate: (ids: string[], change: BulkChange) => Promise<{ updated: number[]; failed: { id: number; reason: string }[] }>;
  toggleSubtask: (ticketId: string, subtaskId: number) => Promise<void>;
  addSubtask: (ticketId: string, title: string) => Promise<void>;
  startTimer: (ticketId: string) => Promise<void>;
  stopTimer: (ticketId: string) => Promise<void>;
}

const TicketsContext = createContext<TicketsContextValue | undefined>(undefined);
const POLL_MS = 15_000;

export function TicketsProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const isStaff = user?.role === 'Design Lead' || user?.role === 'Designer';

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [designTypes, setDesignTypes] = useState<DesignType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(0);         // optimistic mutations running; polling must not clobber them
  const primed = useRef(false);       // the first list has loaded, so later polls can tell what changed
  const listeners = useRef(new Set<(changes: TicketChange[]) => void>());
  const ticketsRef = useRef<Ticket[]>([]);
  ticketsRef.current = tickets;

  const load = useCallback(async (announce: boolean) => {
    try {
      const list = await apiJson<ApiTicket[]>('/api/tickets');
      if (inFlight.current > 0) return;
      if (announce && primed.current) {
        const before = new Map(ticketsRef.current.map(t => [t.id, t]));
        const changes: TicketChange[] = [];
        for (const b of list) {
          const old = before.get(String(b.id));
          if (!old) changes.push({ type: 'ticket_created', ticketNumber: b.ticket_number, title: b.title });
          else if (old.status !== b.status) changes.push({ type: 'ticket_moved', ticketNumber: b.ticket_number, to: b.status });
          const notes = (f: Record<string, unknown> | undefined) => (Array.isArray(f?.client_changes) ? f.client_changes as { text: string }[] : []);
          const now = notes(b.type_specific_fields);
          if (old && now.length > notes(old.type_specific_fields).length) {
            changes.push({ type: 'client_changes', ticketNumber: b.ticket_number, text: now[now.length - 1].text });
          }
        }
        if (changes.length) listeners.current.forEach(fn => fn(changes));
      }
      primed.current = true;
      setTickets(list.map(b => mapTicket(b)));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      setError(e instanceof Error ? e.message : 'Could not load tickets.');
    }
  }, []);
  const refresh = useCallback(() => load(false), [load]);

  const onChanges = useCallback((fn: (changes: TicketChange[]) => void) => {
    listeners.current.add(fn);
    return () => { listeners.current.delete(fn); };
  }, []);

  /* Initial load + reference data once signed in */
  useEffect(() => {
    if (!isAuthenticated) { setTickets([]); setUsers([]); setDesignTypes([]); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      await refresh();
      try {
        const [types, people] = await Promise.all([
          apiJson<DesignType[]>('/api/design-types'),
          isStaff ? apiJson<ApiUser[]>('/api/users') : Promise.resolve([] as ApiUser[]),
        ]);
        if (!cancelled) { setDesignTypes(types); setUsers(people); }
      } catch { /* reference data is best-effort; the board still works */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, isStaff, refresh]);

  /* Keep the board fresh: poll while the tab is visible and refetch on focus */
  useEffect(() => {
    if (!isAuthenticated) return;
    const tick = () => { if (document.visibilityState === 'visible') void load(true); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [isAuthenticated, load]);

  // Removed or deactivated accounts drop out of these lists; KanbanBoard still gives one a column if they
  // hold a ticket (keyed off the tickets themselves), so past work stays visible without cluttering the
  // person filter with accounts nobody can pick anymore.
  const staff = useMemo<StaffUser[]>(
    () => users.filter(u => u.role !== 'Requester' && u.is_active).map(u => ({ id: u.id, name: u.full_name, role: u.role, email: u.email })),
    [users],
  );
  const clients = useMemo<ClientUser[]>(
    () => users.filter(u => u.role === 'Requester' && u.is_active).map(u => ({ id: u.id, name: u.full_name, email: u.email })),
    [users],
  );

  const replace = useCallback((b: ApiTicket) => {
    setTickets(prev => {
      const t = mapTicket(b);
      return prev.some(x => x.id === t.id) ? prev.map(x => (x.id === t.id ? t : x)) : [t, ...prev];
    });
  }, []);

  const getTicket = useCallback((id: string) => ticketsRef.current.find(t => t.id === id), []);

  const createTicket = useCallback(async (input: NewTicketInput) => {
    const b = await apiJson<ApiTicket>('/api/tickets', { method: 'POST', json: input });
    replace(b);
    return mapTicket(b);
  }, [replace]);

  const updateTicket = useCallback(async (id: string, patch: Partial<Ticket>) => {
    const before = ticketsRef.current.find(t => t.id === id);
    if (!before) return;

    /* Translate UI field names to API fields */
    const body: Record<string, unknown> = {};
    const optimistic: Partial<Ticket> = { ...patch };
    if ('status' in patch) body.status = patch.status;
    if ('priority' in patch) body.priority = patch.priority;
    if ('title' in patch) body.title = patch.title;
    if ('tags' in patch) body.tags = patch.tags;
    if ('description' in patch) body.brief = patch.description;
    if ('figma_url' in patch) body.figma_url = patch.figma_url || null;
    if ('estimate_hours' in patch) body.estimate_hours = patch.estimate_hours;
    if ('assignee' in patch || 'assignee_id' in patch) {
      const person = patch.assignee_id != null
        ? staff.find(s => s.id === patch.assignee_id)
        : staff.find(s => s.name === patch.assignee);
      const wantsNone = patch.assignee === '' || patch.assignee_id === null;
      if (!person && !wantsNone) throw new ApiError('Unknown assignee.', 422);
      body.assignee_id = person ? person.id : null;
      optimistic.assignee = person?.name ?? '';
      optimistic.assignee_id = person?.id ?? null;
    }
    if (!Object.keys(body).length) return;

    inFlight.current += 1;
    setTickets(prev => prev.map(t => (t.id === id ? { ...t, ...optimistic } : t)));
    try {
      const b = await apiJson<ApiTicket>(`/api/tickets/${id}`, { method: 'PATCH', json: body });
      replace(b);
    } catch (e) {
      setTickets(prev => prev.map(t => (t.id === id ? before : t)));
      throw e;
    } finally {
      inFlight.current -= 1;
    }
  }, [replace, staff]);

  const bulkUpdate = useCallback(async (ids: string[], change: BulkChange) => {
    inFlight.current += 1;
    try {
      const res = await apiJson<{ updated: number[]; failed: { id: number; reason: string }[] }>('/api/tickets/bulk', {
        method: 'POST', json: { ticket_ids: ids.map(Number), ...change },
      });
      return res;
    } finally {
      inFlight.current -= 1;
      await refresh();
    }
  }, [refresh]);

  const mutateTicket = useCallback(async (path: string, init?: RequestInit & { json?: unknown }) => {
    inFlight.current += 1;
    try {
      await apiJson(path, init);
    } finally {
      inFlight.current -= 1;
    }
    await refresh();
  }, [refresh]);

  const toggleSubtask = useCallback(async (ticketId: string, subtaskId: number) => {
    const t = ticketsRef.current.find(x => x.id === ticketId);
    const sub = t?.subtasks.find(s => s.id === subtaskId);
    if (!t || !sub) return;
    setTickets(prev => prev.map(x => (x.id === ticketId
      ? { ...x, subtasks: x.subtasks.map(s => (s.id === subtaskId ? { ...s, is_completed: !s.is_completed } : s)) } : x)));
    try {
      await mutateTicket(`/api/tickets/${ticketId}/subtasks/${subtaskId}`, { method: 'PATCH', json: { is_completed: !sub.is_completed } });
    } catch (e) {
      setTickets(prev => prev.map(x => (x.id === ticketId ? t : x)));
      throw e;
    }
  }, [mutateTicket]);

  const addSubtask = useCallback(async (ticketId: string, title: string) => {
    await mutateTicket(`/api/tickets/${ticketId}/subtasks`, { method: 'POST', json: { title } });
  }, [mutateTicket]);

  const startTimer = useCallback(async (ticketId: string) => {
    await mutateTicket(`/api/tickets/${ticketId}/timer/start`, { method: 'POST' });
  }, [mutateTicket]);

  const stopTimer = useCallback(async (ticketId: string) => {
    await mutateTicket(`/api/tickets/${ticketId}/timer/stop`, { method: 'POST' });
  }, [mutateTicket]);

  const value = useMemo<TicketsContextValue>(() => ({
    tickets, staff, clients, designTypes, loading, error, refresh, onChanges, getTicket, createTicket, updateTicket,
    bulkUpdate, toggleSubtask, addSubtask, startTimer, stopTimer,
  }), [tickets, staff, clients, designTypes, loading, error, refresh, onChanges, getTicket, createTicket, updateTicket,
    bulkUpdate, toggleSubtask, addSubtask, startTimer, stopTimer]);

  return <TicketsContext.Provider value={value}>{children}</TicketsContext.Provider>;
}

export function useTickets() {
  const ctx = useContext(TicketsContext);
  if (!ctx) throw new Error('useTickets must be used inside TicketsProvider');
  return ctx;
}

/** Deterministic avatar colour for a person's name. */
const PALETTE = ['#7C3AED', '#256B45', '#f97316', '#0ea5e9', '#EF4444', '#ca8a04', '#0d9488'];
export function colorFor(name: string): string {
  if (!name) return '#94a3b8';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

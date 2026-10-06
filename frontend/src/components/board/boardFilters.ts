import { type Ticket, DONE_STATUSES } from '../../types';

/* ── Filters & views ─────────────────────────── */
export interface BoardFilters {
  search:     string;
  statuses:   string[];
  priorities: string[];
  assignee:   string | null;       // 'me' | 'unassigned' | user id
  requester:  'me' | null;
  sla:        'any' | 'overdue' | 'breaching_soon' | 'on_track';
  tags:       string[];
}

export interface SavedView { id: number; name: string; filters: BoardFilters; is_shared: boolean; owner: string; is_mine: boolean }

export const EMPTY_FILTERS: BoardFilters = { search: '', statuses: [], priorities: [], assignee: null, requester: null, sla: 'any', tags: [] };
const SOON_MS = 4 * 3_600_000;

export const QUICK_VIEWS: { id: string; name: string; filters: Partial<BoardFilters> }[] = [
  { id: 'q:all',      name: 'All tickets',      filters: {} },
  { id: 'q:mine',     name: 'My tickets',       filters: { assignee: 'me' } },
  { id: 'q:soon',     name: 'Breaching soon',   filters: { sla: 'breaching_soon' } },
  { id: 'q:overdue',  name: 'Overdue',          filters: { sla: 'overdue' } },
  { id: 'q:urgent',   name: 'Urgent & high',    filters: { priorities: ['Urgent', 'High'] } },
  { id: 'q:waiting',  name: 'Waiting on client', filters: { statuses: ['Waiting on Requester'] } },
  { id: 'q:review',   name: 'In review',        filters: { statuses: ['In Review'] } },
];

export function ticketMatches(t: Ticket, f: BoardFilters, myId: number | null, nowMs: number): boolean {
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

export const sameFilters = (a: BoardFilters, b: BoardFilters) => JSON.stringify(a) === JSON.stringify(b);

export type GroupBy = 'status' | 'assignee';

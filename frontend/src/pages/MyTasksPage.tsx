import { Link } from 'react-router-dom';
import { DONE_STATUSES } from '../types';
import { AlertCircle, CheckCircle2, Clock, PauseCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTickets } from '../contexts/TicketsContext';
import { PRIORITY_STYLE, type Ticket } from '../types';

const DONE = DONE_STATUSES;
const DAY = 86_400_000;
const PRIORITY_RANK: Record<string, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

type Bucket = 'overdue' | 'today' | 'week' | 'later';
const BUCKETS: { key: Bucket; title: string }[] = [
  { key: 'overdue', title: 'Overdue' },
  { key: 'today',   title: 'Due in the next 24 hours' },
  { key: 'week',    title: 'This week' },
  { key: 'later',   title: 'Later / no date' },
];

function bucketOf(t: Ticket, now: number): Bucket {
  if (t.is_overdue) return 'overdue';
  if (!t.due_at) return 'later';
  const diff = new Date(t.due_at).getTime() - now;
  if (diff < 0) return 'overdue';
  if (diff <= DAY) return 'today';
  if (diff <= 7 * DAY) return 'week';
  return 'later';
}

const dueMs = (t: Ticket) => (t.due_at ? new Date(t.due_at).getTime() : Infinity);
const fmtDue = (iso: string) =>
  iso ? new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'No due date';

const MyTasksPage = () => {
  const { user } = useAuth();
  const { tickets, loading, error, refresh } = useTickets();
  const myId = user ? Number(user.id) : null;
  const now = Date.now();

  const mine = tickets
    .filter(t => t.assignee_id === myId && !DONE.includes(t.status))
    .sort((a, b) => dueMs(a) - dueMs(b) || (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9));
  const blocked = mine.filter(t => t.status === 'Waiting on Requester').length;

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '0.25rem 0 2rem' }}>
      <h1 style={{ fontSize: 'clamp(1.4rem,3vw,2rem)', fontWeight: 800 }}>
        Hi {user?.name.split(' ')[0] ?? 'there'}, here's your queue
      </h1>
      <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: 4, marginBottom: '1.25rem' }}>
        {mine.length} open task{mine.length === 1 ? '' : 's'}, soonest deadline first
        {blocked > 0 && ` · ${blocked} waiting on the requester`}.
      </p>

      {error && <p role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{error} <button type="button" className="chip" onClick={() => void refresh()}>Retry</button></p>}
      {loading && tickets.length === 0 && <p role="status" style={{ color: '#94a3b8' }}>Loading your tasks…</p>}

      {!loading && mine.length === 0 && (
        <div className="glass-card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <CheckCircle2 size={28} style={{ color: '#059669', margin: '0 auto 0.75rem' }} />
          <h3 style={{ fontWeight: 700 }}>You're all caught up</h3>
          <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: 6 }}>
            Nothing is assigned to you. <Link to="/" style={{ color: 'var(--brand)', fontWeight: 700 }}>Pick something up from the board →</Link>
          </p>
        </div>
      )}

      {BUCKETS.map(({ key, title }) => {
        const rows = mine.filter(t => bucketOf(t, now) === key);
        if (!rows.length) return null;
        return (
          <section key={key} style={{ marginBottom: '1.5rem' }} aria-label={title}>
            <h2 style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: key === 'overdue' ? '#EF4444' : '#64748B', marginBottom: 8 }}>
              {title} · {rows.length}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rows.map(t => {
                const isBlocked = t.status === 'Waiting on Requester';
                return (
                  <Link key={t.id} to={`/tickets/${t.id}`} className="glass-card"
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.85rem 1.1rem', textDecoration: 'none', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.06em' }}>{t.number}{t.client_org ? ` · ${t.client_org}` : ''}</div>
                      <div style={{ fontSize: '0.92rem', fontWeight: 600, color: '#0F172A', overflowWrap: 'anywhere' }}>{t.title}</div>
                      <div style={{ fontSize: '0.75rem', color: key === 'overdue' ? '#EF4444' : '#64748B', marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={12} /> {fmtDue(t.due_at)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {isBlocked && <span className="badge-red" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><PauseCircle size={11} /> Blocked</span>}
                      {key === 'overdue' && <span className="badge-red" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><AlertCircle size={11} /> Overdue</span>}
                      <span className="badge-blue" style={PRIORITY_STYLE[t.priority] ?? {}}>{t.priority}</span>
                      <span className="badge-blue">{t.status}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default MyTasksPage;

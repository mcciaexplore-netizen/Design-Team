import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiJson } from '../api';
import ActivityFeed from '../components/ActivityFeed';
import PendingReviewPanel from '../components/board/PendingReviewPanel';
import { ToastContainer, useToast } from '../components/Toast';
import { DONE_STATUSES } from '../types';
import { CheckCircle2, Mail, PauseCircle, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTickets } from '../contexts/TicketsContext';
import { type Ticket } from '../types';

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

function DeadlineBadge({ dueAt }: { dueAt: string | null }) {
  if (!dueAt) return <span style={{ fontSize: '0.74rem', color: '#737373' }}>No deadline</span>;
  const ms = new Date(dueAt).getTime() - Date.now();
  const d = new Date(dueAt);
  const timeStr = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const dateStr = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  if (ms < 0) {
    const hoursOver = Math.max(1, Math.round(Math.abs(ms) / 3_600_000));
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0.2rem 0.55rem', borderRadius: 99, background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C', fontSize: '0.72rem', fontWeight: 700 }}>
        🔴 Overdue (by {hoursOver >= 24 ? `${Math.round(hoursOver / 24)}d` : `${hoursOver}h`})
      </span>
    );
  }
  if (ms <= DAY) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0.2rem 0.55rem', borderRadius: 99, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#B45309', fontSize: '0.72rem', fontWeight: 700 }}>
        🟡 Due today at {timeStr}
      </span>
    );
  }
  const daysLeft = Math.ceil(ms / DAY);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0.2rem 0.55rem', borderRadius: 99, background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#15803D', fontSize: '0.72rem', fontWeight: 700 }}>
      🟢 On track (due in {daysLeft}d · {dateStr})
    </span>
  );
}

const MyTasksPage = () => {
  const { user } = useAuth();
  const { tickets, loading, error, refresh } = useTickets();
  const myId = user ? Number(user.id) : null;
  const now = Date.now();
  const isLead = user?.role === 'Design Lead';
  const { toasts, addToast, removeToast } = useToast();
  const pendingReview = tickets.filter(t => t.status === 'Pending Review');

  const handleAcceptRequest = async (ticket: Ticket, assigneeId?: number) => {
    try {
      await apiJson(`/api/tickets/${ticket.id}/accept`, {
        method: 'POST',
        json: assigneeId ? { assignee_id: assigneeId } : {}
      });
      await refresh();
      addToast(`${ticket.number} accepted`, 'success');
    } catch (e) { addToast(e instanceof Error ? e.message : 'Could not accept this request.', 'error'); }
  };

  const handleClarification = async (ticket: Ticket, question: string) => {
    try {
      await apiJson(`/api/tickets/${ticket.id}/clarify`, {
        method: 'POST',
        json: { question }
      });
      await refresh();
      addToast(`Clarification requested for ${ticket.number}`, 'success');
    } catch (e) { addToast(e instanceof Error ? e.message : 'Could not send clarification request.', 'error'); }
  };

  const handleDeclineRequest = async (ticket: Ticket) => {
    if (!window.confirm(`Decline ${ticket.number}: "${ticket.title}"?`)) return;
    const reason = window.prompt('Reason for the client (optional)') ?? '';
    try {
      await apiJson(`/api/tickets/${ticket.id}/decline`, { method: 'POST', json: { reason: reason.trim() || null } });
      await refresh();
      addToast(`${ticket.number} declined`, 'success');
    } catch (e) { addToast(e instanceof Error ? e.message : 'Could not decline this request.', 'error'); }
  };

  const handleBulkAcceptRequest = async (toAccept: Ticket[]) => {
    let count = 0;
    for (const t of toAccept) {
      try {
        await apiJson(`/api/tickets/${t.id}/accept`, { method: 'POST' });
        count++;
      } catch (e) {
        addToast(e instanceof Error ? e.message : `Could not accept ${t.number}.`, 'error');
      }
    }
    if (count > 0) {
      await refresh();
      addToast(`Accepted ${count} request${count === 1 ? '' : 's'}`, 'success');
    }
  };

  const mine = tickets
    .filter(t => t.assignee_id === myId && !DONE.includes(t.status))
    .sort((a, b) => dueMs(a) - dueMs(b) || (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9));
  const blocked = mine.filter(t => t.status === 'Waiting on Requester').length;
  const tiles: [string, number, string][] = [
    ['Open tasks', mine.length, '#0B1F3A'],
    ['Due in 24 hours', mine.filter(t => bucketOf(t, now) === 'today').length, '#B45309'],
    ['Overdue', mine.filter(t => bucketOf(t, now) === 'overdue').length, '#B91C1C'],
    ['With the client for review', mine.filter(t => t.status === 'In Review').length, '#047857'],
  ];

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0.25rem 0 2rem' }}>
      <h1 style={{ fontSize: 'clamp(1.4rem,3vw,2rem)', fontWeight: 800 }}>
        Hi {user?.name.split(' ')[0] ?? 'there'}, here's your dashboard
      </h1>
      <p style={{ fontSize: '0.85rem', color: '#737373', marginTop: 4, marginBottom: '1.25rem' }}>
        {mine.length} open task{mine.length === 1 ? '' : 's'}, soonest deadline first
        {blocked > 0 && ` · ${blocked} waiting on the requester`}.
      </p>

      <section aria-label="Summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: '1.25rem' }}>
        {tiles.map(([label, value, color]) => (
          <div key={label} className="glass-card" style={{ padding: '0.85rem 1rem' }}>
            <p style={{ fontSize: '1.6rem', fontWeight: 800, color, lineHeight: 1.1 }}>{value}</p>
            <p style={{ fontSize: '0.78rem', color: '#525252', fontWeight: 600 }}>{label}</p>
          </div>
        ))}
      </section>

      {isLead && (
        <PendingReviewPanel
          tickets={pendingReview}
          onAccept={(t, assigneeId) => void handleAcceptRequest(t, assigneeId)}
          onDecline={t => void handleDeclineRequest(t)}
          onBulkAccept={ts => void handleBulkAcceptRequest(ts)}
          onClarify={(t, q) => handleClarification(t, q)}
        />
      )}

      {/* Focus Mode / Next Up Hero Banner */}
      {mine.length > 0 && (
        <section aria-label="Focus Mode" className="glass-card" style={{ marginBottom: '1.25rem', padding: '1.25rem', border: '1px solid rgba(11,31,58,0.25)', background: 'linear-gradient(135deg, rgba(11,31,58,0.06), rgba(11,31,58,0.01))', borderRadius: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.74rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--brand)' }}>
              <Sparkles size={14} /> Focus Mode · Next Up
            </span>
            <DeadlineBadge dueAt={mine[0].due_at} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <p style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#737373', fontWeight: 700 }}>
                {mine[0].number}{mine[0].client_org ? ` · ${mine[0].client_org}` : ''}
              </p>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0B1F3A', marginTop: 2, marginBottom: 4 }}>
                {mine[0].title}
              </h2>
              <p style={{ fontSize: '0.84rem', color: '#525252', maxWidth: 640 }}>
                {mine[0].description ? `${mine[0].description.slice(0, 140)}...` : 'Ready to work. Click below to open ticket or drag proofs.'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link to={`/tickets/${mine[0].id}`} className="btn-primary" style={{ textDecoration: 'none', gap: 6, padding: '0.5rem 1rem' }}>
                Open Ticket Details →
              </Link>
            </div>
          </div>
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: '1.25rem', alignItems: 'start' }}>
      <div style={{ minWidth: 0 }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 800, color: '#0B1F3A', marginBottom: 10 }}>My queue</h2>
      {error && <p role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{error} <button type="button" className="chip" onClick={() => void refresh()}>Retry</button></p>}
      {loading && tickets.length === 0 && <p role="status" style={{ color: '#737373' }}>Loading your tasks…</p>}

      {!loading && mine.length === 0 && (
        <div className="glass-card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <CheckCircle2 size={28} style={{ color: '#256B45', margin: '0 auto 0.75rem' }} />
          <h3 style={{ fontWeight: 700 }}>You're all caught up</h3>
          <p style={{ fontSize: '0.85rem', color: '#737373', marginTop: 6 }}>
            Nothing is assigned to you. <Link to="/" style={{ color: 'var(--brand)', fontWeight: 700 }}>Pick something up from the Visual Board →</Link>
          </p>
        </div>
      )}

      {BUCKETS.map(({ key, title }) => {
        const rows = mine.filter(t => bucketOf(t, now) === key);
        if (!rows.length) return null;
        return (
          <section key={key} style={{ marginBottom: '1.5rem' }} aria-label={title}>
            <h2 style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: key === 'overdue' ? '#EF4444' : '#737373', marginBottom: 8 }}>
              {title} · {rows.length}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rows.map(t => {
                const isBlocked = t.status === 'Waiting on Requester';
                return (
                  <div key={t.id} className="glass-card"
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.85rem 1.1rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.06em' }}>{t.number}{t.client_org ? ` · ${t.client_org}` : ''}</div>
                      <Link to={`/tickets/${t.id}`} style={{ textDecoration: 'none', color: '#0B1F3A' }}>
                        <div style={{ fontSize: '0.92rem', fontWeight: 600, overflowWrap: 'anywhere' }}>{t.title}</div>
                      </Link>
                      <div style={{ marginTop: 4 }}>
                        <DeadlineBadge dueAt={t.due_at} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {isBlocked && <span className="badge-red" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><PauseCircle size={11} /> Blocked</span>}
                      <span className="badge-blue">{t.status}</span>
                      <Link to={`/tickets/${t.id}`} className="btn-ghost" style={{ padding: '0.35rem 0.65rem', fontSize: '0.76rem', textDecoration: 'none' }}>
                        Open →
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      </div>

      <aside style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>
        <EmailCard />
        <ActivityFeed mine title="Latest on my work" limit={12} />
      </aside>
      </div>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
};

interface EmailPrefs { email_enabled: boolean; email: string; email_available: boolean }

/** Where this designer's emails go (their account address), with a switch to turn them off. */
function EmailCard() {
  const [prefs, setPrefs] = useState<EmailPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiJson<EmailPrefs>('/api/me/preferences').then(setPrefs).catch(() => setError('Could not load your email setting.')); }, []);
  const toggle = (on: boolean) => {
    setError(null);
    apiJson<EmailPrefs>('/api/me/preferences', { method: 'PUT', json: { email_enabled: on } }).then(setPrefs)
      .catch(e => setError(e instanceof Error ? e.message : 'Could not save.'));
  };
  if (!prefs) return error ? <p role="alert" style={{ fontSize: '0.8rem', color: '#B91C1C' }}>{error}</p> : null;
  return (
    <section className="glass-card" style={{ padding: '1rem 1.25rem' }} aria-labelledby="email-card-h">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Mail size={15} aria-hidden="true" style={{ color: '#0B1F3A' }} />
        <h2 id="email-card-h" style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0B1F3A' }}>Email</h2>
        <span className={prefs.email_available && prefs.email_enabled ? 'badge-green' : 'badge-red'} style={{ marginLeft: 'auto' }}>
          {!prefs.email_available ? 'Not set up' : prefs.email_enabled ? 'On' : 'Off'}
        </span>
      </div>
      <p style={{ fontSize: '0.8rem', color: '#525252', lineHeight: 1.55 }}>
        Emails go to <strong>{prefs.email}</strong> when work is assigned to you, the client sends changes, approves or asks for
        changes, and when a ticket is about to be late.
      </p>
      {!prefs.email_available && <p style={{ fontSize: '0.76rem', color: '#92400E', marginTop: 6 }}>Email isn't connected yet: your Design Lead sets it up (Zoho Mail). You still get every update in the bell.</p>}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', marginTop: 10, cursor: 'pointer' }}>
        <input type="checkbox" checked={prefs.email_enabled} onChange={e => toggle(e.target.checked)} style={{ accentColor: '#0B1F3A' }} />
        Email me about my work
      </label>
      {error && <p role="alert" style={{ fontSize: '0.78rem', color: '#B91C1C', marginTop: 6 }}>{error}</p>}
    </section>
  );
}

export default MyTasksPage;

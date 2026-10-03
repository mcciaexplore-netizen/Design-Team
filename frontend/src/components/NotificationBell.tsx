import { useCallback, useEffect, useRef, useState } from 'react';
import { AtSign, Bell, CheckCircle2, Info, MessageSquare, AlertTriangle, UserPlus } from 'lucide-react';
import { apiJson } from '../api';

interface Item { id: number; content: string; type: string; is_read: boolean; created_at: string | null }
interface Feed { unread: number; items: Item[] }

const TYPE_CONFIG: Record<string, { icon: typeof Info; color: string; bg: string; border: string }> = {
  sla_breach:        { icon: AlertTriangle, color: '#EF4444', bg: 'rgba(239,68,68,0.07)',  border: 'rgba(239,68,68,0.15)' },
  mention:           { icon: AtSign,        color: '#7c3aed', bg: 'rgba(124,58,237,0.07)', border: 'rgba(124,58,237,0.15)' },
  comment_added:     { icon: MessageSquare, color: '#003F8A', bg: 'rgba(0,63,138,0.06)',   border: 'rgba(0,63,138,0.12)' },
  ticket_assigned:   { icon: UserPlus,      color: '#003F8A', bg: 'rgba(0,63,138,0.06)',   border: 'rgba(0,63,138,0.12)' },
  approval_decision: { icon: CheckCircle2,  color: '#059669', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.15)' },
};
const DEFAULT_CFG = { icon: Info, color: '#003F8A', bg: 'rgba(0,63,138,0.06)', border: 'rgba(0,63,138,0.12)' };

function ago(iso: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

const NotificationBell = () => {
  const [feed, setFeed] = useState<Feed>({ unread: 0, items: [] });
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try { setFeed(await apiJson<Feed>('/api/notifications?limit=30')); setError(false); }
    catch { setError(true); }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000);
    return () => clearInterval(id);
  }, [load]);

  /* Close on outside click / Escape */
  useEffect(() => {
    if (!isOpen) return;
    const click = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setIsOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key); };
  }, [isOpen]);

  const markAllRead = async () => {
    setFeed(f => ({ unread: 0, items: f.items.map(i => ({ ...i, is_read: true })) }));
    try { await apiJson('/api/notifications/read-all', { method: 'POST' }); } catch { void load(); }
  };

  const markRead = async (n: Item) => {
    if (n.is_read) return;
    setFeed(f => ({ unread: Math.max(0, f.unread - 1), items: f.items.map(i => (i.id === n.id ? { ...i, is_read: true } : i)) }));
    try { await apiJson(`/api/notifications/${n.id}/read`, { method: 'POST' }); } catch { void load(); }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => { setIsOpen(o => !o); if (!isOpen) void load(); }}
        aria-label={feed.unread ? `Notifications, ${feed.unread} unread` : 'Notifications'}
        aria-expanded={isOpen}
        style={{ position: 'relative', padding: '0.5rem', background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', borderRadius: 'var(--radius-sm)' }}
      >
        <Bell size={20} />
        {feed.unread > 0 && (
          <span aria-hidden="true" style={{ position: 'absolute', top: 2, right: 0, minWidth: 17, height: 17, padding: '0 3px', background: '#EF4444', color: 'white', borderRadius: 99, fontSize: '0.6rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid white' }}>
            {feed.unread > 9 ? '9+' : feed.unread}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="animate-fade-in-up" role="dialog" aria-label="Notifications"
          style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 340, maxWidth: 'calc(100vw - 1.5rem)', background: 'rgba(255,255,255,0.98)', backdropFilter: 'blur(16px)', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 'var(--radius-lg)', boxShadow: '0 20px 40px rgba(0,63,138,0.1)', zIndex: 50, overflow: 'hidden' }}>
          <div style={{ padding: '0.875rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(226,232,240,0.85)', background: '#F8FAFC' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Bell size={14} style={{ color: '#003F8A' }} />
              <h3 style={{ fontSize: '0.82rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: '#0F172A' }}>Notifications</h3>
              {feed.unread > 0 && <span className="badge-red">{feed.unread} new</span>}
            </div>
            <button type="button" onClick={() => void markAllRead()} disabled={feed.unread === 0}
              style={{ fontSize: '0.72rem', fontWeight: 700, color: feed.unread ? '#003F8A' : '#94a3b8', background: 'none', border: 'none', cursor: feed.unread ? 'pointer' : 'default' }}>
              Mark all read
            </button>
          </div>

          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {error && <p role="alert" style={{ padding: '1rem', fontSize: '0.8rem', color: '#b91c1c' }}>Couldn't load notifications. <button type="button" className="chip" onClick={() => void load()}>Retry</button></p>}
            {!error && feed.items.length === 0 && <p style={{ padding: '1.5rem 1rem', fontSize: '0.82rem', color: '#94a3b8', textAlign: 'center' }}>You're all caught up.</p>}
            {feed.items.map(n => {
              const cfg = TYPE_CONFIG[n.type] ?? DEFAULT_CFG;
              const Icon = cfg.icon;
              return (
                <button key={n.id} type="button" onClick={() => void markRead(n)}
                  style={{ display: 'flex', width: '100%', textAlign: 'left', alignItems: 'flex-start', gap: '0.75rem', padding: '0.8rem 1rem', border: 'none', borderBottom: '1px solid rgba(226,232,240,0.6)', background: n.is_read ? 'white' : cfg.bg, cursor: n.is_read ? 'default' : 'pointer' }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: cfg.bg, border: `1px solid ${cfg.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: cfg.color }}>
                    <Icon size={14} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '0.8rem', color: '#0F172A', lineHeight: 1.5, fontWeight: n.is_read ? 400 : 600, overflowWrap: 'anywhere' }}>{n.content}</p>
                    <p style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 3 }}>{ago(n.created_at)}</p>
                  </div>
                  {!n.is_read && <span aria-label="Unread" style={{ width: 7, height: 7, borderRadius: 99, background: '#003F8A', flexShrink: 0, marginTop: 6 }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;

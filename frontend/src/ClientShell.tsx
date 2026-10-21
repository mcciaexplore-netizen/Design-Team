import { Link } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LogOut, Plus, Settings } from 'lucide-react';
import NotificationBell from './components/NotificationBell';
import TicketCreateModal from './components/TicketCreateModal';
import { ToastContainer, useToast } from './components/Toast';
import { useAuth } from './contexts/AuthContext';
import { NewRequestContext } from './contexts/NewRequestContext';
import { useTickets } from './contexts/TicketsContext';
import { useTicketSocket } from './hooks/useTicketSocket';
import type { RequestPrefill } from './requestForm';

/** The client-only chrome: brand header, notifications, new-request action — no staff sidebar or tools. */
export default function ClientShell({ children }: { children: ReactNode }) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [prefill, setPrefill] = useState<RequestPrefill | null>(null);
  const { user, logout } = useAuth();
  const { toasts, addToast, removeToast } = useToast();
  const { refresh } = useTickets();
  const openNewRequest = useCallback((answers?: RequestPrefill) => { setPrefill(answers ?? null); setIsCreateModalOpen(true); }, []);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSocketMessage = useCallback((msg: import('./hooks/useTicketSocket').SocketMessage) => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void refresh(), 600);
    if ('by' in msg && msg.by === user?.name) return;
    if (msg.type === 'ticket_moved') addToast(`${msg.by} moved ${msg.ticketNumber} → ${msg.to}`, 'info');
  }, [addToast, refresh, user?.name]);
  useTicketSocket({ userId: user?.id ?? 'guest', onMessage: handleSocketMessage });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return;
      if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); openNewRequest(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openNewRequest]);

  return (
    <NewRequestContext.Provider value={{ openNewRequest }}>
      <div className="app-shell flex h-screen font-body">
        <a href="#main-content" className="skip-link">Skip to content</a>
        <main className="flex-1 flex flex-col relative z-0 min-w-0">
          <header className="app-header h-16 flex items-center px-8 justify-between sticky top-0 z-20 client-header">
            <Link to="/client-portal" aria-label="MCCIA Applied AI Studio, my requests" style={{ display: 'inline-flex', alignItems: 'center' }}>
              <img src="/mccia_logo.png" alt="" style={{ height: 34, width: 'auto', maxWidth: 160, objectFit: 'contain', display: 'block' }} />
            </Link>
            <div className="flex items-center gap-3">
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><NotificationBell /></div>
              <button type="button" className="app-header-create btn-primary" onClick={() => openNewRequest()} aria-label="New request" style={{ gap: '0.4rem' }}>
                <Plus size={14} strokeWidth={2.5} />
                <span>New request</span>
              </button>
              {user && (
                <div className="app-header-user" style={{ borderLeft: '1px solid var(--border-soft)', paddingLeft: '0.875rem', marginLeft: '0.125rem' }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold" style={{ background: user.color, fontSize: '0.68rem', boxShadow: '0 2px 6px rgba(0,0,0,0.15)', cursor: 'default' }} title={`${user.name} · ${user.role}`}>
                    {user.initials}
                  </div>
                </div>
              )}
              <Link to="/settings" aria-label="Settings" title="Settings" className="app-header-search" style={{ padding: '0.45rem', minWidth: 0 }}><Settings size={16} /></Link>
              <button type="button" className="btn-ghost" onClick={logout} style={{ gap: '0.4rem', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}><LogOut size={14} /> <span className="client-signout-label">Sign out</span></button>
            </div>
          </header>

          <div id="main-content" tabIndex={-1} className="app-content flex-1 overflow-auto px-8 py-7 relative">
            <div className="h-full animate-fade-in-up" style={{ maxWidth: 980, margin: '0 auto', width: '100%' }}>
              {children}
            </div>
          </div>

          <TicketCreateModal isOpen={isCreateModalOpen} prefill={prefill} onClose={() => setIsCreateModalOpen(false)} />
          <ToastContainer toasts={toasts} onRemove={removeToast} />
        </main>
      </div>
    </NewRequestContext.Provider>
  );
}

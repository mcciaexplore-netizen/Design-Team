import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import KanbanBoard from './components/KanbanBoard';
import CalendarPage from './pages/CalendarPage';
import NotificationBell from './components/NotificationBell';
import Dashboard from './components/Dashboard';
import LibraryPage from './pages/LibraryPage';
import ClientPortalPage from './pages/ClientPortalPage';
import TicketDetailPage from './pages/TicketDetailPage';
import TicketCreateModal from './components/TicketCreateModal';
import CommandPalette from './components/CommandPalette';
import LoginPage from './pages/LoginPage';
import SettingsPage from './pages/SettingsPage';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastContainer, useToast } from './components/Toast';
import { useState, useEffect, useCallback } from 'react';
import { useTicketSocket } from './hooks/useTicketSocket';
import {
  LayoutDashboard, Calendar as CalendarIcon,
  BarChart3, Image as ImageIcon, Plus, Users, Zap, LogOut, Search, ChevronRight, Settings
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/',              label: 'Kanban Board',        icon: LayoutDashboard },
  { to: '/calendar',      label: 'SLA Calendar',        icon: CalendarIcon    },
  { to: '/dashboard',     label: 'Performance',         icon: BarChart3       },
  { to: '/library',       label: 'Asset Library',       icon: ImageIcon       },
];

const PAGE_TITLES: Record<string, string> = {
  '/':              'Board Overview',
  '/calendar':      'SLA Calendar',
  '/dashboard':     'Performance Dashboard',
  '/library':       'Asset Library',
  '/client-portal': 'Client Portal',
  '/tickets':       'Ticket Detail',
  '/settings':      'Integrations & Alerts',
};

const PAGE_SUBTITLES: Record<string, string> = {
  '/':              'Drag tickets between stages to keep work moving',
  '/calendar':      'Deadlines and SLA windows at a glance',
  '/dashboard':     'Throughput, turnaround and team load',
  '/library':       'Approved designs and reusable assets',
  '/client-portal': 'Submit and track design requests',
  '/settings':      'Slack, email and escalation thresholds',
};

function Sidebar({ onNewTicket }: { onNewTicket: () => void }) {
  const location  = useLocation();
  const { logout, user } = useAuth();

  return (
    <aside className="app-sidebar w-64 flex-shrink-0 flex flex-col z-10">
      {/* Logo */}
      <div className="app-brand flex items-center gap-3 mb-6 px-2">
        <img
          src="/mccia_logo.jpg"
          alt="MCCIA Applied AI Studio"
          className="h-14 object-contain"
          style={{ maxWidth: 180 }}
        />
      </div>

      {/* Subtitle */}
      <div className="app-subtitle px-2 mb-5">
        <p className="section-label" style={{ color: '#0f172a', fontSize: '0.68rem' }}>Applied AI Studio</p>
        <p className="text-[0.7rem] mt-0.5" style={{ color: '#94a3b8' }}>Design Workflow Platform</p>
      </div>

      {/* New Ticket CTA */}
      <button
        onClick={onNewTicket}
        className="app-create-ticket btn-primary w-full mb-5 justify-center"
        style={{ borderRadius: 'var(--radius-btn)', gap: '0.5rem' }}
      >
        <Plus size={14} strokeWidth={2.5} />
        New Ticket
      </button>

      {/* Navigation */}
      <nav className="app-side-nav space-y-0.5 flex-1" aria-label="Main navigation">
        <p className="sidebar-section-title mb-2">Workspace</p>
        {NAV_ITEMS.filter(item => {
          if (user?.role === 'Designer' && item.label !== 'Kanban Board') return false;
          return true;
        }).map(({ to, label, icon: Icon }) => {
          const active = location.pathname === to;
          return (
            <Link
              key={to}
              to={to}
              className={`app-nav-link flex items-center gap-3 px-3 py-2.5 text-sm rounded-md transition-all duration-200${active ? ' is-active' : ''}`}
              style={{ fontWeight: active ? 700 : 600 }}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={16} strokeWidth={active ? 2.5 : 2} />
              <span style={{ flex: 1 }}>{label}</span>
              {active && <ChevronRight size={13} style={{ opacity: 0.4 }} />}
            </Link>
          );
        })}

        <div className="app-nav-divider" style={{ margin: '0.875rem 0 0.5rem' }} />
        <p className="sidebar-section-title mb-2">Portals</p>

        <Link
          to="/client-portal"
          className={`app-nav-link flex items-center gap-3 px-3 py-2.5 text-sm rounded-md transition-all duration-200${location.pathname === '/client-portal' ? ' is-active' : ''}`}
          style={{ fontWeight: location.pathname === '/client-portal' ? 700 : 600 }}
          aria-current={location.pathname === '/client-portal' ? 'page' : undefined}
        >
          <Users size={16} strokeWidth={location.pathname === '/client-portal' ? 2.5 : 2} />
          <span style={{ flex: 1 }}>Client Portal</span>
          {location.pathname === '/client-portal' && <ChevronRight size={13} style={{ opacity: 0.4 }} />}
        </Link>

        {user?.role === 'Design Lead' && (
          <>
            <div className="app-nav-divider" style={{ margin: '0.875rem 0 0.5rem' }} />
            <p className="sidebar-section-title mb-2">Admin</p>
            <Link
              to="/settings"
              className={`app-nav-link flex items-center gap-3 px-3 py-2.5 text-sm rounded-md transition-all duration-200${location.pathname === '/settings' ? ' is-active' : ''}`}
              style={{ fontWeight: location.pathname === '/settings' ? 700 : 600 }}
              aria-current={location.pathname === '/settings' ? 'page' : undefined}
            >
              <Settings size={16} strokeWidth={location.pathname === '/settings' ? 2.5 : 2} />
              <span style={{ flex: 1 }}>Integrations</span>
              {location.pathname === '/settings' && <ChevronRight size={13} style={{ opacity: 0.4 }} />}
            </Link>
          </>
        )}
      </nav>

      {/* User + Logout */}
      <div className="app-user-area">
        {user && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '0.625rem 0.75rem', borderRadius: 10,
            background: 'var(--brand-soft)',
            border: '1px solid rgba(0,63,138,0.1)',
            marginBottom: 8,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '99px',
              background: user.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.68rem', fontWeight: 800, color: 'white', flexShrink: 0,
              boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
            }}>
              {user.initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.25 }}>{user.name}</p>
              <p style={{ fontSize: '0.65rem', color: 'var(--brand)', fontWeight: 600, marginTop: 1 }}>{user.role}</p>
            </div>
          </div>
        )}
        <button
          onClick={logout}
          className="app-nav-link"
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '0.5rem 0.75rem', background: 'none',
            border: '1px solid rgba(226, 232, 240, 0.8)',
            borderRadius: 8, cursor: 'pointer', color: '#64748B',
            fontSize: '0.78rem', fontWeight: 600,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(239,68,68,0.3)';
            (e.currentTarget as HTMLElement).style.color = '#EF4444';
            (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.04)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(226, 232, 240, 0.8)';
            (e.currentTarget as HTMLElement).style.color = '#64748B';
            (e.currentTarget as HTMLElement).style.background = 'none';
          }}
        >
          <LogOut size={14} /> Sign out
        </button>
      </div>

      {/* Footer */}
      <div
        className="app-brand-footer mt-3 px-3 py-2.5 rounded-lg"
        style={{ background: 'rgba(0,63,138,0.03)', border: '1px solid rgba(0,63,138,0.07)' }}
      >
        <div className="flex items-center gap-2">
          <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Zap size={13} color="white" />
          </div>
          <div>
            <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>AI Studio</p>
            <p style={{ fontSize: '0.6rem', color: '#94a3b8' }}>Powered by MCCIA</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function AppShell() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuth();
  const pageTitle = PAGE_TITLES[location.pathname] ?? 'DesignDesk';
  const { toasts, addToast, removeToast } = useToast();

  /* Live ticket event messages from backend WebSocket */
  const handleSocketMessage = useCallback((msg: import('./hooks/useTicketSocket').SocketMessage) => {
    if (msg.type === 'ticket_moved')
      addToast(`${msg.by} moved ${msg.ticketNumber} → ${msg.to}`, 'info');
    else if (msg.type === 'ticket_created')
      addToast(`${msg.by} created ${msg.ticketNumber}: ${msg.title}`, 'info');
    else if (msg.type === 'sla_breach')
      addToast(`SLA breach: ${msg.ticketNumber} — ${msg.title}`, 'warning');
    else if (msg.type === 'comment_added')
      addToast(`${msg.by} commented on ${msg.ticketNumber}`, 'info');
  }, [addToast]);

  useTicketSocket({ userId: user?.id ?? 'guest', onMessage: handleSocketMessage });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setIsCreateModalOpen(true);
      } else if (e.key === 'Escape') {
        setIsCommandPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="app-shell flex h-screen font-body">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <Sidebar onNewTicket={() => setIsCreateModalOpen(true)} />

      <main className="flex-1 flex flex-col relative z-0 min-w-0">
        {/* Top Header */}
        <header className="app-header h-16 flex items-center px-8 justify-between sticky top-0 z-20">
          <div className="app-header-title">
            <h2
              className="font-heading font-bold"
              style={{ fontSize: 'clamp(1.1rem, 2vw, 1.35rem)', letterSpacing: '-0.02em', color: '#0f172a' }}
            >
              {pageTitle}
            </h2>
            {PAGE_SUBTITLES[location.pathname] && (
              <p className="app-header-subtitle">{PAGE_SUBTITLES[location.pathname]}</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              className="app-header-search"
              onClick={() => setIsCommandPaletteOpen(true)}
              aria-label="Search the workspace"
              title="Search (Ctrl+K)"
            >
              <Search size={15} />
              <span>Search anything…</span>
              <kbd>Ctrl K</kbd>
            </button>

            <div style={{ width: 1, height: 24, background: 'rgba(226,232,240,0.85)' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <NotificationBell />
            </div>

            <button
              className="app-header-create btn-primary"
              onClick={() => setIsCreateModalOpen(true)}
              style={{ gap: '0.4rem' }}
            >
              <Plus size={14} strokeWidth={2.5} />
              <span>New ticket</span>
            </button>

            {user && (
              <div className="flex items-center gap-2.5" style={{ borderLeft: '1px solid rgba(226,232,240,0.85)', paddingLeft: '0.875rem', marginLeft: '0.125rem' }}>
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold"
                  style={{ background: user.color, fontSize: '0.68rem', boxShadow: '0 2px 6px rgba(0,0,0,0.15)', cursor: 'default' }}
                  title={`${user.name} · ${user.role}`}
                >
                  {user.initials}
                </div>
                <div className="hidden sm:block text-right" style={{ lineHeight: 1.2 }}>
                  <p style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0f172a' }}>{user.name}</p>
                  <p style={{ fontSize: '0.62rem', color: '#94a3b8', fontWeight: 500 }}>{user.role}</p>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Content Area */}
        <div id="main-content" tabIndex={-1} className="app-content flex-1 overflow-auto px-8 py-7 relative">
          <div className="h-full animate-fade-in-up">
            <Routes>
              <Route path="/"              element={<KanbanBoard />}      />
              <Route path="/calendar"      element={<CalendarPage />}     />
              <Route path="/dashboard"     element={<Dashboard />}        />
              <Route path="/library"       element={<LibraryPage />}      />
              <Route path="/client-portal" element={<ClientPortalPage onNewRequest={() => setIsCreateModalOpen(true)} />} />
              <Route path="/tickets/:id"   element={<TicketDetailPage />} />
              <Route path="/settings"      element={<SettingsPage />}     />
            </Routes>
          </div>
        </div>

        <TicketCreateModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
        <CommandPalette    isOpen={isCommandPaletteOpen} onClose={() => setIsCommandPaletteOpen(false)} />
        <ToastContainer    toasts={toasts} onRemove={removeToast} />
      </main>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
      </Router>
    </AuthProvider>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(140deg,#001f5c,#003F8A)' }}>
        <div style={{ textAlign: 'center', color: 'white' }}>
          <div className="app-spinner" role="status" aria-label="Loading" />
          <p style={{ fontSize: '0.9rem', fontFamily: 'var(--font-body)', opacity: 0.7, marginTop: 14 }}>Loading MCCIA Studio…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <LoginPage />;

  return <AppShell />;
}

export default App;

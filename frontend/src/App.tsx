import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import KanbanBoard from './components/KanbanBoard';
import NotificationBell from './components/NotificationBell';
import Dashboard from './components/Dashboard';
import ClientPortalPage from './pages/ClientPortalPage';
import TicketDetailPage from './pages/TicketDetailPage';
import TicketCreateModal from './components/TicketCreateModal';
import CommandPalette from './components/CommandPalette';
import LoginPage from './pages/LoginPage';
import SettingsPage from './pages/SettingsPage';
import MyTasksPage from './pages/MyTasksPage';
import WorkloadPage from './pages/WorkloadPage';
import ReviewPage from './pages/ReviewPage';
import { AuthProvider, useAuth, type UserRole } from './contexts/AuthContext';
import { TicketsProvider, useTickets } from './contexts/TicketsContext';
import { ToastContainer, useToast } from './components/Toast';
import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useTicketSocket } from './hooks/useTicketSocket';
import {
  LayoutDashboard, BarChart3, Plus, Users, Zap, LogOut, Search,
  ChevronRight, Settings, Gauge, ListChecks, type LucideIcon,
} from 'lucide-react';

interface NavItem { to: string; label: string; icon: LucideIcon; roles: UserRole[] }
interface NavGroup { title: string; items: NavItem[] }

const STAFF: UserRole[] = ['Design Lead', 'Designer'];
const NAV_GROUPS: NavGroup[] = [
  { title: 'Workspace', items: [
    { to: '/my-tasks', label: 'My Tasks',     icon: ListChecks,      roles: STAFF },
    { to: '/',         label: 'Kanban Board', icon: LayoutDashboard, roles: STAFF },
    { to: '/workload', label: 'Workload',     icon: Gauge,           roles: STAFF },
  ] },
  { title: 'Insights', items: [
    { to: '/dashboard', label: 'Performance', icon: BarChart3, roles: ['Design Lead'] },
  ] },
  { title: 'Portals', items: [
    { to: '/client-portal', label: 'Client Portal', icon: Users, roles: ['Design Lead', 'Designer', 'Client'] },
  ] },
  { title: 'Account', items: [
    { to: '/settings', label: 'Settings', icon: Settings, roles: ['Design Lead', 'Designer', 'Client'] },
  ] },
];

const PAGE_TITLES: [string, string][] = [
  ['/client-portal', 'My requests'],
  ['/my-tasks',      'My tasks'],
  ['/dashboard',     'Performance'],
  ['/workload',      'Team workload'],
  ['/tickets',       'Ticket'],
  ['/settings',      'Settings'],
  ['/',              'Board'],
];

const PAGE_SUBTITLES: Record<string, string> = {
  '/':              'Drag tickets between stages to keep work moving',
  '/dashboard':     'The last 30 days of delivery and this week’s load',
  '/workload':      'Who has capacity, and who is about to fall behind',
  '/client-portal': 'Track requests and review designs',
  '/settings':      'Notifications and integrations',
};

function titleFor(pathname: string): string {
  const hit = PAGE_TITLES.find(([prefix]) => (prefix === '/' ? pathname === '/' : pathname.startsWith(prefix)));
  return hit ? hit[1] : 'DesignDesk';
}

function Sidebar({ onNewTicket }: { onNewTicket: () => void }) {
  const location  = useLocation();
  const { logout, user } = useAuth();
  const role = user?.role;

  return (
    <aside className="app-sidebar w-64 flex-shrink-0 flex flex-col z-10">
      <div className="app-brand flex items-center gap-3 mb-6 px-2">
        <img src="/mccia_logo.jpg" alt="MCCIA Applied AI Studio" className="h-14 object-contain" style={{ maxWidth: 180 }} />
      </div>

      <div className="app-subtitle px-2 mb-5">
        <p className="section-label" style={{ color: 'var(--text-strong)', fontSize: '0.68rem' }}>Applied AI Studio</p>
        <p className="text-[0.7rem] mt-0.5" style={{ color: 'var(--text-hint)' }}>Design Workflow Platform</p>
      </div>

      <button type="button" onClick={onNewTicket} className="app-create-ticket btn-primary w-full mb-5 justify-center" style={{ borderRadius: 'var(--radius-btn)', gap: '0.5rem' }}>
        <Plus size={14} strokeWidth={2.5} />
        {role === 'Client' ? 'New Request' : 'New Ticket'}
      </button>

      <nav className="app-side-nav space-y-0.5 flex-1" aria-label="Main navigation">
        {NAV_GROUPS.map((group, gi) => {
          const items = group.items.filter(i => role && i.roles.includes(role));
          if (!items.length) return null;
          return (
            <div key={group.title} style={{ display: 'contents' }}>
              {gi > 0 && <div className="app-nav-divider" style={{ margin: '0.875rem 0 0.5rem' }} />}
              <p className="sidebar-section-title mb-2">{group.title}</p>
              {items.map(({ to, label, icon: Icon }) => {
                const active = location.pathname === to
                  || (to === '/client-portal' && location.pathname.startsWith('/tickets/') && role === 'Client')
                  || (to === '/' && location.pathname.startsWith('/tickets/') && role !== 'Client');
                return (
                  <Link
                    key={to} to={to}
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
            </div>
          );
        })}
      </nav>

      <div className="app-user-area">
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.625rem 0.75rem', borderRadius: 10, background: 'var(--brand-soft)', border: '1px solid rgba(24,24,27,0.1)', marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: '99px', background: user.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', fontWeight: 800, color: 'white', flexShrink: 0, boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
              {user.initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.25 }}>{user.name}</p>
              <p style={{ fontSize: '0.65rem', color: 'var(--brand)', fontWeight: 600, marginTop: 1 }}>{user.role}</p>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={logout}
          className="app-nav-link app-signout"
        >
          <LogOut size={14} /> Sign out
        </button>
      </div>

      <div className="app-brand-footer mt-3 px-3 py-2.5 rounded-lg" style={{ background: 'rgba(24,24,27,0.03)', border: '1px solid rgba(24,24,27,0.07)' }}>
        <div className="flex items-center gap-2">
          <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Zap size={13} color="white" />
          </div>
          <div>
            <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-strong)', lineHeight: 1.2 }}>AI Studio</p>
            <p style={{ fontSize: '0.6rem', color: 'var(--text-hint)' }}>Powered by MCCIA</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** Renders children only for allowed roles; everyone else is sent to their home page. */
function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!roles.includes(user.role)) return <Navigate to={user.role === 'Client' ? '/client-portal' : '/'} replace />;
  return <>{children}</>;
}

function AppShell() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuth();
  const pageTitle = titleFor(location.pathname);
  const subtitle = PAGE_SUBTITLES[location.pathname];
  const { toasts, addToast, removeToast } = useToast();
  const { refresh } = useTickets();

  const handleSocketMessage = useCallback((msg: import('./hooks/useTicketSocket').SocketMessage) => {
    void refresh();
    const mine = 'by' in msg && msg.by === user?.name;
    if (mine) return;
    if (msg.type === 'ticket_moved') addToast(`${msg.by} moved ${msg.ticketNumber} → ${msg.to}`, 'info');
    else if (msg.type === 'ticket_created') addToast(`${msg.by} created ${msg.ticketNumber}: ${msg.title}`, 'info');
    else if (msg.type === 'sla_breach') addToast(`SLA breach: ${msg.ticketNumber} — ${msg.title}`, 'warning');
    else if (msg.type === 'comment_added') addToast(`${msg.by} commented on ${msg.ticketNumber}`, 'info');
  }, [addToast, refresh, user?.name]);

  useTicketSocket({ userId: user?.id ?? 'guest', onMessage: handleSocketMessage });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        setIsCreateModalOpen(true);
      } else if (e.key === 'Escape') {
        setIsCommandPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const home = user?.role === 'Client' ? '/client-portal' : user?.role === 'Designer' ? '/my-tasks' : '/';

  return (
    <div className="app-shell flex h-screen font-body">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <Sidebar onNewTicket={() => setIsCreateModalOpen(true)} />

      <main className="flex-1 flex flex-col relative z-0 min-w-0">
        <header className="app-header h-16 flex items-center px-8 justify-between sticky top-0 z-20">
          <div className="app-header-title">
            <h2 className="font-heading font-bold" style={{ fontSize: 'clamp(1.1rem, 2vw, 1.35rem)', letterSpacing: '-0.02em', color: 'var(--text-strong)' }}>{pageTitle}</h2>
            {subtitle && <p className="app-header-subtitle">{subtitle}</p>}
          </div>

          <div className="flex items-center gap-3">
            <button type="button" className="app-header-search" onClick={() => setIsCommandPaletteOpen(true)} aria-label="Search the workspace" title="Search (Ctrl+K)">
              <Search size={15} />
              <span>Search anything…</span>
              <kbd>Ctrl K</kbd>
            </button>

            <div style={{ width: 1, height: 24, background: 'var(--border-soft)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><NotificationBell /></div>

            <button type="button" className="app-header-create btn-primary" onClick={() => setIsCreateModalOpen(true)} aria-label={user?.role === 'Client' ? 'New request' : 'New ticket'} style={{ gap: '0.4rem' }}>
              <Plus size={14} strokeWidth={2.5} />
              <span>{user?.role === 'Client' ? 'New request' : 'New ticket'}</span>
            </button>

            {user && (
              <div className="app-header-user" style={{ borderLeft: '1px solid var(--border-soft)', paddingLeft: '0.875rem', marginLeft: '0.125rem' }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold" style={{ background: user.color, fontSize: '0.68rem', boxShadow: '0 2px 6px rgba(0,0,0,0.15)', cursor: 'default' }} title={`${user.name} · ${user.role}`}>
                  {user.initials}
                </div>
              </div>
            )}
          </div>
        </header>

        <div id="main-content" tabIndex={-1} className="app-content flex-1 overflow-auto px-8 py-7 relative">
          <div className="h-full animate-fade-in-up">
            <Routes>
              <Route path="/" element={<RequireRole roles={STAFF}><KanbanBoard /></RequireRole>} />
              <Route path="/my-tasks" element={<RequireRole roles={STAFF}><MyTasksPage /></RequireRole>} />
              <Route path="/workload" element={<RequireRole roles={STAFF}><WorkloadPage /></RequireRole>} />
              <Route path="/dashboard" element={<RequireRole roles={['Design Lead']}><Dashboard /></RequireRole>} />
              <Route path="/client-portal" element={<ClientPortalPage onNewRequest={() => setIsCreateModalOpen(true)} />} />
              <Route path="/tickets/:id" element={<TicketDetailPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to={home} replace />} />
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
  const location = useLocation();

  /* The client review link works without signing in. */
  if (location.pathname.startsWith('/review/')) {
    return (
      <Routes>
        <Route path="/review/:token" element={<ReviewPage />} />
      </Routes>
    );
  }

  if (isLoading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#18181b' }}>
        <div style={{ textAlign: 'center', color: 'white' }}>
          <div className="app-spinner" role="status" aria-label="Loading" />
          <p style={{ fontSize: '0.9rem', fontFamily: 'var(--font-body)', opacity: 0.7, marginTop: 14 }}>Loading MCCIA Studio…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <LoginPage />;

  return (
    <TicketsProvider>
      <AppShell />
    </TicketsProvider>
  );
}

export default App;

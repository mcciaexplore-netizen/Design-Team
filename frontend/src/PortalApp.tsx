import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import ClientPortalPage from './pages/ClientPortalPage';
import LoginPage from './pages/LoginPage';
import ClientShell from './ClientShell';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { TicketsProvider } from './contexts/TicketsContext';
import { useNewRequest } from './contexts/NewRequestContext';

const CampaignsPage = lazy(() => import('./pages/CampaignsPage'));
const TicketDetailPage = lazy(() => import('./pages/TicketDetailPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ForcePasswordChangePage = lazy(() => import('./pages/ForcePasswordChangePage'));

const PageLoading = () => <p role="status" style={{ color: 'var(--text-hint)', padding: '1rem' }}>Loading…</p>;

function ClientPortalRoutes() {
  const { openNewRequest } = useNewRequest();
  return (
    <Routes>
      <Route path="/client-portal" element={<ClientPortalPage onNewRequest={() => openNewRequest()} />} />
      <Route path="/campaigns" element={<CampaignsPage />} />
      <Route path="/tickets/:id" element={<TicketDetailPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/client-portal" replace />} />
    </Routes>
  );
}

/** Not every account should land here: this portal is for the Client role only. */
function WrongRole({ role }: { role: string }) {
  const { logout } = useAuth();
  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, textAlign: 'center', padding: '2rem' }}>
      <p style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-strong)' }}>This portal is for clients</p>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-soft)', maxWidth: 360 }}>
        Your account is a {role} account. Use the main DesignDesk app instead.
      </p>
      <div style={{ display: 'flex', gap: 10 }}>
        <a href="/" className="btn-primary" style={{ textDecoration: 'none' }}>Go to DesignDesk</a>
        <button type="button" className="btn-ghost" onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}

function PortalContent() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0B1F3A' }}>
        <div style={{ textAlign: 'center', color: 'white' }}>
          <div className="app-spinner" role="status" aria-label="Loading" />
          <p style={{ fontSize: '0.9rem', fontFamily: 'var(--font-body)', opacity: 0.7, marginTop: 14 }}>Loading your portal…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <LoginPage />;
  if (user?.mustChangePassword) return <Suspense fallback={<PageLoading />}><ForcePasswordChangePage /></Suspense>;
  if (user?.role !== 'Client') return <WrongRole role={user?.role ?? 'staff'} />;

  return (
    <TicketsProvider>
      <ClientShell>
        <Suspense fallback={<PageLoading />}>
          <ClientPortalRoutes />
        </Suspense>
      </ClientShell>
    </TicketsProvider>
  );
}

export default function PortalApp() {
  return (
    <AuthProvider>
      <Router basename="/portal">
        <PortalContent />
      </Router>
    </AuthProvider>
  );
}

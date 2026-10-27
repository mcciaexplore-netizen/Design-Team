import { BrowserRouter as Router, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';

const RequestsBoardPage = lazy(() => import('./pages/RequestsBoardPage'));
const RequestFormPage = lazy(() => import('./pages/RequestFormPage'));
const CampaignsPage = lazy(() => import('./pages/CampaignsPage'));
const TrackPage = lazy(() => import('./pages/TrackPage'));
const ReviewPage = lazy(() => import('./pages/ReviewPage'));

const PageLoading = () => <p role="status" style={{ color: 'var(--text-hint)', padding: '1rem' }}>Loading…</p>;

const NAV = [
  { to: '/', label: 'Requests', end: true },
  { to: '/request', label: 'Submit a request', end: false },
  { to: '/campaigns', label: 'Campaigns', end: false },
];

/** The public User app's top bar: MCCIA logo and the three places a requester goes. No sign-in anywhere. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app, #FAFAFA)' }}>
      <header style={{ background: 'white', borderBottom: '1px solid var(--border-soft, #E2E8F0)', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ maxWidth: 1040, margin: '0 auto', padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <NavLink to="/" aria-label="MCCIA design requests: home" style={{ display: 'flex' }}>
            <img src="/mccia_logo.png" alt="MCCIA Applied AI Studio" style={{ height: 36, objectFit: 'contain' }} />
          </NavLink>
          <nav aria-label="Main" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {NAV.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end}
                style={({ isActive }) => ({
                  padding: '0.45rem 0.8rem', borderRadius: 8, fontSize: '0.85rem', fontWeight: 700, textDecoration: 'none',
                  color: isActive ? 'white' : 'var(--text-strong)', background: isActive ? 'var(--brand)' : 'transparent',
                })}>
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <Suspense fallback={<PageLoading />}>{children}</Suspense>
    </div>
  );
}

/** The User app: for anyone at MCCIA who needs a design. No accounts, no sign-in. */
export default function UserApp() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Shell><RequestsBoardPage /></Shell>} />
        <Route path="/request" element={<Shell><RequestFormPage /></Shell>} />
        <Route path="/campaigns" element={<Shell><div style={{ padding: '1.5rem 1rem 0' }}><CampaignsPage /></div></Shell>} />
        {/* Opened from links in emails; each is a complete page of its own. */}
        <Route path="/track/:token" element={<Suspense fallback={<PageLoading />}><TrackPage /></Suspense>} />
        <Route path="/review/:token" element={<Suspense fallback={<PageLoading />}><ReviewPage /></Suspense>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

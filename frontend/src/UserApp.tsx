import { BrowserRouter as Router, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';

const RequestsBoardPage = lazy(() => import('./pages/RequestsBoardPage'));
const RequestFormPage = lazy(() => import('./pages/RequestFormPage'));
const CampaignsPage = lazy(() => import('./pages/CampaignsPage'));
const TrackPage = lazy(() => import('./pages/TrackPage'));
const ReviewPage = lazy(() => import('./pages/ReviewPage'));

const PageLoading = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: '2rem' }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div className="user-spinner" aria-hidden="true" />
      <p role="status" style={{ color: 'var(--text-hint)', fontSize: '0.85rem' }}>Loading…</p>
    </div>
  </div>
);

const NAV = [
  { to: '/', label: 'Requests', end: true },
  { to: '/request', label: 'Submit a request', end: false },
  { to: '/campaigns', label: 'Campaigns', end: false },
];

/** The public User app's top bar: MCCIA logo and the three places a requester goes. No sign-in anywhere. */
function Shell({ children, heroTitle, heroSub }: { children: ReactNode; heroTitle?: string; heroSub?: string }) {
  return (
    <div className="user-shell">
      {/* ── Sticky glassy header ── */}
      <header className="user-header">
        <div className="user-header-inner">
          <NavLink to="/" aria-label="MCCIA design requests: home" className="user-logo-link">
            <img src="/mccia_logo.png" alt="MCCIA Applied AI Studio" className="user-logo" />
          </NavLink>
          <nav aria-label="Main" className="user-nav">
            {NAV.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end}
                className={({ isActive }) => `user-nav-link${isActive ? ' active' : ''}`}>
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {/* ── Optional hero band ── */}
      {(heroTitle || heroSub) && (
        <div className="user-hero">
          <div className="user-hero-inner">
            {heroTitle && <h1 className="user-hero-title">{heroTitle}</h1>}
            {heroSub && <p className="user-hero-sub">{heroSub}</p>}
          </div>
        </div>
      )}

      {/* ── Page content ── */}
      <div className="user-content">
        <Suspense fallback={<PageLoading />}>{children}</Suspense>
      </div>

      <footer className="user-footer">
        <p>MCCIA Design Team &nbsp;·&nbsp; Requests refresh every minute &nbsp;·&nbsp; No sign-in needed</p>
      </footer>
    </div>
  );
}

/** The User app: for anyone at MCCIA who needs a design. No accounts, no sign-in. */
export default function UserApp() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Shell><RequestsBoardPage /></Shell>} />
        <Route path="/request" element={
          <Shell heroTitle="Submit a design request" heroSub="Fill in the form below and the design team will be in touch.">
            <RequestFormPage />
          </Shell>
        } />
        <Route path="/campaigns" element={
          <Shell heroTitle="Campaigns & posts" heroSub="Social media campaigns and scheduled posts.">
            <CampaignsPage />
          </Shell>
        } />
        {/* Opened from links in emails; each is a complete page of its own. */}
        <Route path="/track/:token" element={<Suspense fallback={<PageLoading />}><TrackPage /></Suspense>} />
        <Route path="/review/:token" element={<Suspense fallback={<PageLoading />}><ReviewPage /></Suspense>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

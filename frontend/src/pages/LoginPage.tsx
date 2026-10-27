import React, { useState } from 'react';
import GridBackground from '../components/GridBackground';
import { Eye, EyeOff, LogIn, RotateCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const FEATURES = ['Visual Board', 'SLA Tracking', 'CDR Approval', 'Design Proofing', 'Capacity Forecast', 'Client Portal'];

const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [email,     setEmail]    = useState('');
  const [password,  setPassword] = useState('');
  const [showPass,  setShowPass] = useState(false);
  const [loading,   setLoading]  = useState(false);
  const [errorMsg,  setErrorMsg] = useState('');

  const unreachable = errorMsg.startsWith('Cannot reach the server');

  const submit = async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit();
  };

  const field = { width: '100%' } as const;

  return (
    <div className="login-shell">

      {/* ── Left Panel: Brand (hidden on narrow screens) ── */}
      <div className="login-brand">
        <GridBackground stroke="rgba(255,255,255,0.06)" fill="rgba(255,255,255,0.08)" />
        <div style={{ position: 'absolute', top: '-10%',  left: '-10%', width: 400, height: 400, borderRadius: '50%', background: 'rgba(46,139,87,0.08)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '40%', right: '5%',   width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />

        <div style={{ position: 'relative', textAlign: 'center', maxWidth: 400 }}>
          <h1 style={{ fontSize: 'clamp(2rem, 4vw, 2.8rem)', fontWeight: 800, color: 'white', lineHeight: 1.15, letterSpacing: '-0.03em', marginBottom: '1.25rem' }}>
            Design Workflow<br />
            <span style={{ color: '#6ee7b7' }}>Reimagined.</span>
          </h1>

          <p style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.75)', lineHeight: 1.7, marginBottom: '2.5rem' }}>
            AI-powered design request management, SLA tracking, and real-time collaboration — all in one place.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {FEATURES.map(f => (
              <span key={f} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 99, padding: '4px 12px', fontSize: '0.75rem', color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>
                {f}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right Panel: Form ── */}
      <div className="login-panel">
        <div style={{ width: '100%', maxWidth: 400 }}>

          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-strong)', letterSpacing: '-0.03em', marginBottom: 6 }}>
              Welcome back
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-soft)', lineHeight: 1.5 }}>
              Sign in to your DesignDesk workspace
            </p>
          </div>


          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} noValidate={false}>
            <div>
              <label htmlFor="auth-email" className="login-label">Email address</label>
              <input
                id="auth-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@mcciapune.com"
                className="input-field"
                style={field}
                autoFocus
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label htmlFor="auth-password" className="login-label" style={{ marginBottom: 0 }}>Password</label>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  id="auth-password"
                  type={showPass ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input-field"
                  style={{ ...field, paddingRight: '2.75rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(p => !p)}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                  aria-pressed={showPass}
                  style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: 'var(--text-hint)', cursor: 'pointer' }}
                >
                  {showPass ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
              <p style={{ fontSize: '0.78rem', marginTop: 6 }}>
                <a className="login-link-btn" href="/forgot-password">Forgot your password?</a>
              </p>
            </div>

            {errorMsg && (
              <div role="alert" style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', borderRadius: 10, padding: '0.625rem 0.875rem', fontSize: '0.82rem', color: 'var(--danger-text)', fontWeight: 600 }}>
                <span aria-hidden="true">⚠ </span>{errorMsg}
                {unreachable && (
                  <div style={{ marginTop: 8 }}>
                    <button type="button" onClick={() => void submit()} disabled={loading}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'white', border: '1px solid var(--danger-border)', borderRadius: 8, padding: '0.35rem 0.7rem', color: 'var(--danger-text)', fontWeight: 700, fontSize: '0.78rem', cursor: loading ? 'not-allowed' : 'pointer' }}>
                      <RotateCw size={13} aria-hidden="true" /> Retry
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              aria-busy={loading}
              className="btn-primary"
              style={{ justifyContent: 'center', padding: '0.8rem', fontSize: '0.9rem', opacity: loading ? 0.75 : 1, cursor: loading ? 'not-allowed' : 'pointer', marginTop: 4 }}
            >
              {loading ? (
                <><span className="app-spinner app-spinner--sm" role="status" aria-label="Please wait" /> Signing in…</>
              ) : (
                <><LogIn size={16} aria-hidden="true" /> Sign In</>
              )}
            </button>
            {loading && (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-soft)', textAlign: 'center', marginTop: -4 }}>
                First sign-in after a quiet period can take up to a minute while the server wakes up.
              </p>
            )}
          </form>

          <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-soft)', marginTop: '1.25rem' }}>
            This sign-in is for the design team. Requested a design? You don't need a password:{' '}
            <a className="login-link-btn" href="/my-requests">get a sign-in link by email</a>.
          </p>

          <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-soft)', marginTop: '0.75rem' }}>
            Need a design but don't have an account? <a className="login-link-btn" href="/request">Submit a request</a>
          </p>
          <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-soft)', marginTop: '0.5rem' }}>
            Already requested a design? <a className="login-link-btn" href="/requests">See all requests</a>, no sign-in needed
          </p>

        </div>
      </div>
    </div>
  );
};

export default LoginPage;

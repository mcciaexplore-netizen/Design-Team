import React, { useState } from 'react';
import { Eye, EyeOff, Zap, LogIn, ArrowRight, RotateCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const DEMO_ACCOUNTS = [
  { label: 'Design Lead',  email: 'lead@mccia.in',    password: 'mccia123', color: '#18181b', desc: 'Full admin + analytics access'  },
  { label: 'Designer',     email: 'alice@mccia.in',   password: 'mccia123', color: '#8B5CF6', desc: 'Ticket management + timers'      },
  { label: 'Client View',  email: 'client@tata.com',  password: 'client123',color: '#f97316', desc: 'View-only + approval workflow'   },
];

/** Demo shortcuts only exist in local dev builds; the deployed seed passwords are generated. */
const SHOW_DEMO = import.meta.env.DEV;

const FEATURES = ['Kanban Board', 'SLA Tracking', 'CDR Approval', 'Design Proofing', 'Capacity Forecast', 'Client Portal'];

const LoginPage: React.FC = () => {
  const { login, register } = useAuth();
  const [mode,      setMode]     = useState<'login' | 'register'>('login');
  const [fullName,  setFullName] = useState('');
  const [company,   setCompany]  = useState('');
  const signup = mode === 'register';
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
      if (signup) await register({ fullName: fullName.trim(), email: email.trim(), company: company.trim(), password });
      else await login(email.trim(), password);
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

  const fillDemo = (acc: typeof DEMO_ACCOUNTS[0]) => {
    setEmail(acc.email);
    setPassword(acc.password);
    setErrorMsg('');
  };

  const field = { width: '100%' } as const;

  return (
    <div className="login-shell">

      {/* ── Left Panel: Brand (hidden on narrow screens) ── */}
      <div className="login-brand">
        <div style={{ position: 'absolute', top: '-10%',  left: '-10%', width: 400, height: 400, borderRadius: '50%', background: 'rgba(16,185,129,0.08)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '40%', right: '5%',   width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />

        <div style={{ position: 'relative', textAlign: 'center', maxWidth: 400 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: '2rem' }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={24} color="white" aria-hidden="true" />
            </div>
            <div style={{ textAlign: 'left' }}>
              <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 1 }}>MCCIA</p>
              <p style={{ color: 'white', fontSize: '0.9rem', fontWeight: 800, letterSpacing: '-0.01em' }}>Applied AI Studio</p>
            </div>
          </div>

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

          <div className="login-mobile-brand">
            <img src="/mccia_logo.png" alt="MCCIA Applied AI Studio" style={{ height: 40, objectFit: 'contain' }} />
          </div>

          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-strong)', letterSpacing: '-0.03em', marginBottom: 6 }}>
              {signup ? 'Create your account' : 'Welcome back'}
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-soft)', lineHeight: 1.5 }}>
              {signup ? 'Request designs and track them in one place.' : 'Sign in to your MCCIA DesignDesk workspace'}
            </p>
          </div>

          {SHOW_DEMO && !signup && (
            <>
              <div style={{ marginBottom: '1.5rem' }}>
                <p style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>Try a demo account (dev only)</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {DEMO_ACCOUNTS.map(acc => (
                    <button
                      key={acc.label}
                      type="button"
                      className="login-demo-btn"
                      onClick={() => fillDemo(acc)}
                      style={{
                        '--demo-bg': `${acc.color}06`, '--demo-border': `${acc.color}18`,
                        '--demo-bg-hover': `${acc.color}12`, '--demo-border-hover': `${acc.color}35`,
                      } as React.CSSProperties}
                    >
                      <div aria-hidden="true" style={{ width: 32, height: 32, borderRadius: 9, background: acc.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 800, color: 'white', flexShrink: 0 }}>
                        {acc.label[0]}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-strong)', lineHeight: 1.2 }}>{acc.label}</p>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-hint)', marginTop: 2 }}>{acc.desc}</p>
                      </div>
                      <ArrowRight size={14} aria-hidden="true" style={{ color: 'var(--text-hint)', flexShrink: 0 }} />
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.25rem' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border-soft)' }} />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-hint)', fontWeight: 600 }}>or sign in with email</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border-soft)' }} />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} noValidate={false}>
            {signup && (
              <>
                <div>
                  <label htmlFor="su-name" className="login-label">Full name</label>
                  <input id="su-name" type="text" required minLength={2} maxLength={80} autoComplete="name" value={fullName}
                    onChange={e => setFullName(e.target.value)} className="input-field" style={field} autoFocus />
                </div>
                <div>
                  <label htmlFor="su-company" className="login-label">Company</label>
                  <input id="su-company" type="text" required minLength={2} maxLength={80} autoComplete="organization" value={company}
                    onChange={e => setCompany(e.target.value)} className="input-field" style={field} />
                </div>
              </>
            )}
            <div>
              <label htmlFor="auth-email" className="login-label">Email address</label>
              <input
                id="auth-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@mccia.in"
                className="input-field"
                style={field}
                autoFocus={!signup}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label htmlFor="auth-password" className="login-label" style={{ marginBottom: 0 }}>Password</label>
                {signup && <span id="pw-hint" style={{ fontSize: '0.75rem', color: 'var(--text-hint)' }}>At least 8 characters</span>}
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  id="auth-password"
                  type={showPass ? 'text' : 'password'}
                  required
                  minLength={signup ? 8 : undefined}
                  autoComplete={signup ? 'new-password' : 'current-password'}
                  aria-describedby={signup ? 'pw-hint' : undefined}
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
              {!signup && (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-hint)', marginTop: 6 }}>
                  Forgot your password? Ask your Design Lead to reset it.
                </p>
              )}
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
                <><span className="app-spinner app-spinner--sm" role="status" aria-label="Please wait" /> {signup ? 'Creating account…' : 'Signing in…'}</>
              ) : (
                <><LogIn size={16} aria-hidden="true" /> {signup ? 'Create account' : 'Sign In'}</>
              )}
            </button>
            {loading && (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-soft)', textAlign: 'center', marginTop: -4 }}>
                First sign-in after a quiet period can take up to a minute while the server wakes up.
              </p>
            )}
          </form>

          <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-soft)', marginTop: '1.25rem' }}>
            {signup ? 'Already have an account?' : 'New client?'}{' '}
            <button type="button" className="login-link-btn" onClick={() => { setMode(signup ? 'login' : 'register'); setErrorMsg(''); }}>
              {signup ? 'Sign in' : 'Create an account'}
            </button>
          </p>

          <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-hint)', marginTop: '1.5rem', lineHeight: 1.6 }}>
            Protected by MCCIA Applied AI Studio.
          </p>

          {SHOW_DEMO && (
            <div style={{ background: '#F8FAFC', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '0.75rem 1rem', marginTop: '1.25rem' }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-soft)', lineHeight: 1.6 }}>
                <strong style={{ color: 'var(--text-strong)' }}>Dev demo credentials:</strong>{' '}
                <code>lead@mccia.in</code> / <code>mccia123</code>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

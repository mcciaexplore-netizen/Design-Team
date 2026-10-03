import React, { useState } from 'react';
import { Eye, EyeOff, Zap, LogIn, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const DEMO_ACCOUNTS = [
  { label: 'Design Lead',  email: 'lead@mccia.in',    password: 'mccia123', color: '#18181b', desc: 'Full admin + analytics access'  },
  { label: 'Designer',     email: 'alice@mccia.in',   password: 'mccia123', color: '#8B5CF6', desc: 'Ticket management + timers'      },
  { label: 'Client View',  email: 'client@tata.com',  password: 'client123',color: '#f97316', desc: 'View-only + approval workflow'   },
];

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

  const fillDemo = (acc: typeof DEMO_ACCOUNTS[0]) => {
    setEmail(acc.email);
    setPassword(acc.password);
    setErrorMsg('');
  };

  return (
    <div style={{
      minHeight:   '100vh',
      display:     'grid',
      gridTemplateColumns: '1fr 1fr',
      fontFamily:  'var(--font-body)',
    }}>

      {/* ── Left Panel: Brand ── */}
      <div style={{
        background:  '#18181b',
        display:     'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center',
        padding:     '3rem',
        position:    'relative', overflow: 'hidden',
      }}>
        {/* Decorative blobs */}
        <div style={{ position: 'absolute', top: '-10%',  left: '-10%', width: 400, height: 400, borderRadius: '50%', background: 'rgba(16,185,129,0.08)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '-8%', right: '-8%', width: 350, height: 350, borderRadius: '50%', background: 'rgba(24,24,27,0.08)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '40%', right: '5%',   width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />

        {/* Content */}
        <div style={{ position: 'relative', textAlign: 'center', maxWidth: 400 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: '2rem' }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={24} color="white" />
            </div>
            <div style={{ textAlign: 'left' }}>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 1 }}>MCCIA</p>
              <p style={{ color: 'white', fontSize: '0.9rem', fontWeight: 800, letterSpacing: '-0.01em' }}>Applied AI Studio</p>
            </div>
          </div>

          <h1 style={{
            fontSize:    'clamp(2rem, 4vw, 2.8rem)',
            fontFamily:  'var(--font-body)',
            fontWeight:  800, color: 'white',
            lineHeight:  1.15, letterSpacing: '-0.03em', marginBottom: '1.25rem',
          }}>
            Design Workflow<br />
            <span style={{ color: '#6ee7b7' }}>Reimagined.</span>
          </h1>

          <p style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.7, marginBottom: '2.5rem' }}>
            AI-powered design request management, SLA tracking, and real-time collaboration — all in one place.
          </p>

          {/* Feature pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {['Kanban Board', 'SLA Tracking', 'CDR Approval', 'Design Proofing', 'Capacity Forecast', 'Client Portal'].map(f => (
              <span key={f} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 99, padding: '4px 12px', fontSize: '0.72rem', color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>
                {f}
              </span>
            ))}
          </div>

          {/* Stats row */}
          <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center', marginTop: '2.5rem' }}>
            {[['98%', 'SLA Met'], ['2.4h', 'Avg. Turnaround'], ['∞', 'Scalable']].map(([val, label]) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '1.4rem', fontWeight: 800, color: 'white', fontFamily: 'var(--font-body)', letterSpacing: '-0.02em' }}>{val}</p>
                <p style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.5)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right Panel: Login Form ── */}
      <div style={{
        background:     'rgba(255,255,255,0.98)',
        display:        'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center',
        padding:        '3rem 2.5rem',
        overflowY:      'auto',
      }}>
        <div style={{ width: '100%', maxWidth: 400 }}>

          {/* Header */}
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.75rem', fontFamily: 'var(--font-body)', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.03em', marginBottom: 6 }}>
              {signup ? 'Create your account' : 'Welcome back'}
            </h2>
            <p style={{ fontSize: '0.88rem', color: '#64748B', lineHeight: 1.5 }}>{signup ? 'Request designs and track them in one place.' : 'Sign in to your MCCIA DesignDesk workspace'}</p>
          </div>

          {/* Demo accounts (dev builds only) */}
          {import.meta.env.DEV && !signup && <div style={{ marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>Try a demo account</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {DEMO_ACCOUNTS.map(acc => (
                <button
                  key={acc.label}
                  onClick={() => fillDemo(acc)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '0.625rem 0.875rem',
                    background: `${acc.color}06`,
                    border: `1px solid ${acc.color}18`,
                    borderRadius: 10, cursor: 'pointer',
                    textAlign: 'left', transition: 'all 0.15s',
                    width: '100%',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = `${acc.color}12`;
                    (e.currentTarget as HTMLElement).style.borderColor = `${acc.color}35`;
                    (e.currentTarget as HTMLElement).style.transform = 'translateX(2px)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = `${acc.color}06`;
                    (e.currentTarget as HTMLElement).style.borderColor = `${acc.color}18`;
                    (e.currentTarget as HTMLElement).style.transform = 'none';
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 9, background: acc.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.72rem', fontWeight: 800, color: 'white', flexShrink: 0,
                    boxShadow: `0 2px 8px ${acc.color}30`,
                  }}>
                    {acc.label[0]}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0F172A', lineHeight: 1.2 }}>{acc.label}</p>
                    <p style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 2 }}>{acc.desc}</p>
                  </div>
                  <ArrowRight size={14} style={{ color: '#cbd5e1', flexShrink: 0 }} />
                </button>
              ))}
            </div>
          </div>}

          {/* Divider */}
          {!signup && <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.25rem' }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(226,232,240,0.85)' }} />
            <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>or sign in with email</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(226,232,240,0.85)' }} />
          </div>}

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {signup && (
              <>
                <div>
                  <label htmlFor="su-name" style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0F172A', display: 'block', marginBottom: 6 }}>Full name</label>
                  <input id="su-name" type="text" required minLength={2} maxLength={80} autoComplete="name" value={fullName}
                    onChange={e => setFullName(e.target.value)} className="input-field" style={{ width: '100%' }} autoFocus />
                </div>
                <div>
                  <label htmlFor="su-company" style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0F172A', display: 'block', marginBottom: 6 }}>Company</label>
                  <input id="su-company" type="text" required minLength={2} maxLength={80} autoComplete="organization" value={company}
                    onChange={e => setCompany(e.target.value)} className="input-field" style={{ width: '100%' }} />
                </div>
              </>
            )}
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0F172A', display: 'block', marginBottom: 6 }}>Email address</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@mccia.in"
                className="input-field"
                style={{ width: '100%' }}
                autoFocus={!signup}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0F172A' }}>Password</label>
                {signup
                  ? <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>At least 8 characters</span>
                  : <button type="button" style={{ fontSize: '0.72rem', color: '#18181b', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>Forgot password?</button>}
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'}
                  required
                  minLength={signup ? 8 : undefined}
                  autoComplete={signup ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input-field"
                  style={{ width: '100%', paddingRight: '2.5rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(p => !p)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {errorMsg && (
              <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '0.625rem 0.875rem', fontSize: '0.8rem', color: '#EF4444', fontWeight: 600 }}>
                ⚠ {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
              style={{ justifyContent: 'center', padding: '0.8rem', fontSize: '0.88rem', opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer', marginTop: 4 }}
            >
              {loading ? (
                <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</span> {signup ? 'Creating account…' : 'Signing in…'}</>
              ) : (
                <><LogIn size={16} /> {signup ? 'Create account' : 'Sign In'}</>
              )}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: '0.82rem', color: '#64748B', marginTop: '1.25rem' }}>
            {signup ? 'Already have an account?' : 'New client?'}{' '}
            <button type="button" onClick={() => { setMode(signup ? 'login' : 'register'); setErrorMsg(''); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#18181b', fontWeight: 700, fontSize: 'inherit', padding: 0 }}>
              {signup ? 'Sign in' : 'Create an account'}
            </button>
          </p>

          {/* Footer note */}
          <p style={{ textAlign: 'center', fontSize: '0.72rem', color: '#94a3b8', marginTop: '1.5rem', lineHeight: 1.6 }}>
            Protected by MCCIA Applied AI Studio.<br />
            Your session is encrypted and secured.
          </p>

          {import.meta.env.DEV && (
          <div style={{ background: '#F8FAFC', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 10, padding: '0.75rem 1rem', marginTop: '1.25rem' }}>
            <p style={{ fontSize: '0.7rem', color: '#64748B', lineHeight: 1.6 }}>
              <strong style={{ color: '#18181b' }}>Demo credentials:</strong>{' '}
              Use the quick-login buttons above or: <code style={{ background: 'white', padding: '1px 5px', borderRadius: 4, fontSize: '0.68rem' }}>lead@mccia.in</code> / <code style={{ background: 'white', padding: '1px 5px', borderRadius: 4, fontSize: '0.68rem' }}>mccia123</code>
            </p>
          </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

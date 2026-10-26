import React, { useState } from 'react';
import { KeyRound, Mail } from 'lucide-react';
import { publicJson } from '../api';

/**
 * /forgot-password asks for an email and sends a reset link; that link opens /reset-password?token=…,
 * where the person chooses a new password. Both work without signing in.
 */
export default function PasswordResetPage() {
  const token = new URLSearchParams(window.location.search).get('token');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (token && password !== confirm) { setError('The two passwords do not match.'); return; }
    setLoading(true);
    try {
      const res = token
        ? await publicJson<{ detail: string }>('/api/auth/reset-password', { method: 'POST', json: { token, new_password: password } })
        : await publicJson<{ detail: string }>('/api/auth/forgot-password', { method: 'POST', json: { email: email.trim() } });
      setDone(res.detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const field = { width: '100%' } as const;

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1.25rem', background: 'var(--app-bg, #FAFAFA)' }}>
      <div className="glass-card" style={{ width: '100%', maxWidth: 460, padding: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div className="icon-tile" aria-hidden="true">{token ? <KeyRound size={18} /> : <Mail size={18} />}</div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-strong)' }}>
            {token ? 'Choose a new password' : 'Forgot your password?'}
          </h1>
        </div>

        {done ? (
          <p role="status" style={{ fontSize: '0.88rem', color: 'var(--text-soft)', lineHeight: 1.6 }}>{done}</p>
        ) : (
          <>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-soft)', lineHeight: 1.6, marginBottom: '1.25rem' }}>
              {token
                ? 'Enter your new password twice. Other devices signed in to your account will be signed out.'
                : "Enter your account's email address and we'll send you a link to choose a new password."}
            </p>
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {token ? (
                <>
                  <div>
                    <label htmlFor="rp-new" className="login-label">New password</label>
                    <input id="rp-new" type="password" required minLength={8} maxLength={128} autoComplete="new-password" autoFocus
                      aria-describedby="rp-hint" value={password} onChange={e => setPassword(e.target.value)} className="input-field" style={field} />
                    <p id="rp-hint" style={{ fontSize: '0.75rem', color: 'var(--text-hint)', marginTop: 6 }}>At least 8 characters</p>
                  </div>
                  <div>
                    <label htmlFor="rp-confirm" className="login-label">Repeat new password</label>
                    <input id="rp-confirm" type="password" required minLength={8} maxLength={128} autoComplete="new-password"
                      value={confirm} onChange={e => setConfirm(e.target.value)} className="input-field" style={field} />
                  </div>
                </>
              ) : (
                <div>
                  <label htmlFor="fp-email" className="login-label">Email address</label>
                  <input id="fp-email" type="email" required autoComplete="email" autoFocus placeholder="you@mccia.in"
                    value={email} onChange={e => setEmail(e.target.value)} className="input-field" style={field} />
                </div>
              )}

              {error && (
                <div role="alert" style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', borderRadius: 10, padding: '0.625rem 0.875rem', fontSize: '0.82rem', color: 'var(--danger-text)', fontWeight: 600 }}>
                  <span aria-hidden="true">⚠ </span>{error}
                </div>
              )}

              <button type="submit" disabled={loading} aria-busy={loading} className="btn-primary"
                style={{ justifyContent: 'center', padding: '0.8rem', fontSize: '0.9rem', opacity: loading ? 0.75 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
                {loading
                  ? <><span className="app-spinner app-spinner--sm" role="status" aria-label="Please wait" /> {token ? 'Saving…' : 'Sending…'}</>
                  : token ? 'Save new password' : 'Send reset link'}
              </button>
            </form>
          </>
        )}

        <p style={{ fontSize: '0.85rem', color: 'var(--text-soft)', marginTop: '1.25rem' }}>
          <a className="login-link-btn" href="/">Back to sign in</a>
          {token && !done && <> · <a className="login-link-btn" href="/forgot-password">Send a new link</a></>}
        </p>
      </div>
    </main>
  );
}

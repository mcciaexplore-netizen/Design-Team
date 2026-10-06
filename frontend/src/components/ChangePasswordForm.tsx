import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

/** Current + new password. Used in Settings and on the forced "set a new password" screen. */
export default function ChangePasswordForm({ onDone, submitLabel = 'Change password' }: { onDone?: () => void; submitLabel?: string }) {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const mismatch = confirm.length > 0 && next !== confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) { setResult({ ok: false, text: 'The new passwords do not match.' }); return; }
    setBusy(true); setResult(null);
    try {
      await changePassword(current, next);
      setCurrent(''); setNext(''); setConfirm('');
      setResult({ ok: true, text: 'Password changed. Other devices have been signed out.' });
      onDone?.();
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : 'Could not change the password.' });
    } finally { setBusy(false); }
  };

  const label: React.CSSProperties = { fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-strong)', display: 'block', marginBottom: 6 };

  return (
    <form onSubmit={e => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 380 }}>
      <div>
        <label htmlFor="cp-current" style={label}>Current password</label>
        <input id="cp-current" className="input-field" type="password" required autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} style={{ width: '100%' }} />
      </div>
      <div>
        <label htmlFor="cp-new" style={label}>New password</label>
        <input id="cp-new" className="input-field" type="password" required minLength={8} maxLength={128} autoComplete="new-password" aria-describedby="cp-hint" value={next} onChange={e => setNext(e.target.value)} style={{ width: '100%' }} />
        <p id="cp-hint" style={{ fontSize: '0.75rem', color: 'var(--text-hint)', marginTop: 5 }}>At least 8 characters, and different from your current password.</p>
      </div>
      <div>
        <label htmlFor="cp-confirm" style={label}>Confirm new password</label>
        <input id="cp-confirm" className="input-field" type="password" required autoComplete="new-password" aria-invalid={mismatch} value={confirm} onChange={e => setConfirm(e.target.value)} style={{ width: '100%' }} />
        {mismatch && <p style={{ fontSize: '0.75rem', color: 'var(--danger-text)', marginTop: 5 }}>Passwords do not match.</p>}
      </div>
      {result && (
        <p role={result.ok ? 'status' : 'alert'} style={{ fontSize: '0.82rem', fontWeight: 600, color: result.ok ? '#047857' : 'var(--danger-text)' }}>{result.text}</p>
      )}
      <div>
        <button type="submit" className="btn-primary" disabled={busy || mismatch}><KeyRound size={14} aria-hidden="true" /> {busy ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  );
}

import { LogOut, ShieldAlert } from 'lucide-react';
import ChangePasswordForm from '../components/ChangePasswordForm';
import { useAuth } from '../contexts/AuthContext';

/** Shown instead of the app while the account still has an admin-issued temporary password. */
export default function ForcePasswordChangePage() {
  const { user, logout } = useAuth();
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1.25rem', background: 'var(--app-bg, #f4f6f9)' }}>
      <div className="glass-card" style={{ width: '100%', maxWidth: 460, padding: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div className="icon-tile" aria-hidden="true"><ShieldAlert size={18} /></div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-strong)' }}>Set a new password</h1>
        </div>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-soft)', lineHeight: 1.6, marginBottom: '1.25rem' }}>
          {user ? `Hi ${user.name.split(' ')[0]}, you` : 'You'} signed in with a temporary password. Choose your own to continue. Enter the temporary password as your current password.
        </p>
        <ChangePasswordForm submitLabel="Save and continue" />
        <button type="button" onClick={logout} className="login-link-btn" style={{ marginTop: '1.25rem', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}>
          <LogOut size={13} aria-hidden="true" /> Sign out
        </button>
      </div>
    </main>
  );
}

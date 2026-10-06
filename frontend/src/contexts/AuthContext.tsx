import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API_BASE, TOKEN_KEY, apiJson } from '../api';

/* ─── Types ───────────────────────────────── */
export type UserRole = 'Design Lead' | 'Designer' | 'Client';

export interface AuthUser {
  id:     string;
  name:   string;
  email:  string;
  role:   UserRole;
  initials: string;
  color:  string;
  mustChangePassword: boolean;
}

interface AuthContextType {
  user:            AuthUser | null;
  isAuthenticated: boolean;
  isLoading:       boolean;
  login:           (email: string, password: string) => Promise<void>;
  register:        (input: { fullName: string; email: string; company: string; password: string }) => Promise<void>;
  logout:          () => void;
  changePassword:  (currentPassword: string, newPassword: string) => Promise<void>;
  error:           string | null;
}

/* ─── Context ─────────────────────────────── */
const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_KEY = 'mccia_auth_user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,      setUser]      = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  /* Restore session from localStorage */
  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored && localStorage.getItem(TOKEN_KEY)) {
      try { setUser(JSON.parse(stored)); } catch {}
    }
    setIsLoading(false);
  }, []);

  const startSession = (data: { access_token: string; user: { id: number; full_name: string; email: string; role: string; must_change_password?: boolean } }) => {
    const u = data.user;
    const role: UserRole = u.role === 'Design Lead' || u.role === 'Client' ? u.role : 'Designer';
    const authUser: AuthUser = {
      id:       String(u.id),
      name:     u.full_name,
      email:    u.email,
      role,
      initials: u.full_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase(),
      color:    role === 'Design Lead' ? '#18181b' : role === 'Client' ? '#f97316' : '#8B5CF6',
      mustChangePassword: !!u.must_change_password,
    };
    localStorage.setItem(TOKEN_KEY, data.access_token);
    localStorage.setItem(SESSION_KEY, JSON.stringify(authUser));
    setUser(authUser);
  };

  const register = async (input: { fullName: string; email: string; company: string; password: string }) => {
    setError(null);
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: input.fullName, email: input.email, company: input.company, password: input.password }),
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw new Error('Cannot reach the server. It may be waking up (free hosting can take about a minute), or the backend may be down.');
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).detail; } catch { /* non-JSON error body */ }
      throw new Error(res.status === 409 && typeof detail === 'string' ? detail
        : res.status === 422 ? 'Please check your details. The password needs at least 8 characters.'
        : 'Could not create the account. Please try again.');
    }
    startSession(await res.json());
  };

  const login = async (email: string, password: string) => {
    setError(null);
    try {
      const form = new URLSearchParams();
      form.append('username', email.trim());
      form.append('password', password);

      let res: Response;
      try {
        res = await fetch(`${API_BASE}/api/auth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
          signal: AbortSignal.timeout(60000),
        });
      } catch {
        throw new Error('Cannot reach the server. It may be waking up (free hosting can take about a minute), or the backend may be down.');
      }

      if (res.status === 401) throw new Error('Invalid email or password.');
      if (!res.ok) throw new Error('Sign-in failed. Please try again.');

      startSession(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
      throw e;
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    const data = await apiJson<Parameters<typeof startSession>[0]>('/api/auth/change-password', {
      method: 'POST',
      json: { current_password: currentPassword, new_password: newPassword },
    });
    startSession(data); // the old token is revoked by the server; this swaps in the new one
  };

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setError(null);
  }, []);

  useEffect(() => {
    window.addEventListener('auth:expired', logout);
    return () => window.removeEventListener('auth:expired', logout);
  }, [logout]);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, register, logout, changePassword, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

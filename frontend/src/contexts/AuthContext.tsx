import React, { createContext, useContext, useState, useEffect } from 'react';

/* ─── Types ───────────────────────────────── */
export type UserRole = 'Design Lead' | 'Designer' | 'Client';

export interface AuthUser {
  id:     string;
  name:   string;
  email:  string;
  role:   UserRole;
  initials: string;
  color:  string;
}

interface AuthContextType {
  user:            AuthUser | null;
  isAuthenticated: boolean;
  isLoading:       boolean;
  login:           (email: string, password: string) => Promise<void>;
  logout:          () => void;
  error:           string | null;
}

/* ─── Mock users ──────────────────────────── */
const MOCK_USERS: (AuthUser & { password: string })[] = [
  { id: '1', name: 'Priya Sharma',   email: 'lead@mccia.in',     password: 'mccia123', role: 'Design Lead', initials: 'PS', color: '#003F8A' },
  { id: '2', name: 'Alice Fernandez',email: 'alice@mccia.in',    password: 'mccia123', role: 'Designer',    initials: 'AF', color: '#8B5CF6' },
  { id: '3', name: 'Bob Mehta',      email: 'bob@mccia.in',      password: 'mccia123', role: 'Designer',    initials: 'BM', color: '#059669' },
  { id: '4', name: 'Client (TATA)',   email: 'client@tata.com',  password: 'client123',role: 'Client',      initials: 'CL', color: '#f97316' },
];

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
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch {}
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    setError(null);
    setIsLoading(true);

    /* Try real backend first; fall back to mock if unreachable */
    try {
      const form = new URLSearchParams();
      form.append('username', email);
      form.append('password', password);

      const res = await fetch('http://127.0.0.1:8000/api/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: AbortSignal.timeout(3000),
      });

      if (res.ok) {
        const data = await res.json();
        /* Map backend response to AuthUser shape */
        const authUser: AuthUser = {
          id:       String(data.user?.id ?? data.sub ?? email),
          name:     data.user?.full_name ?? data.user?.email ?? email,
          email:    data.user?.email ?? email,
          role:     data.user?.role ?? 'Designer',
          initials: (data.user?.full_name ?? email).split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase(),
          color:    data.user?.role === 'Design Lead' ? '#003F8A' : data.user?.role === 'Client' ? '#f97316' : '#8B5CF6',
        };
        if (data.access_token) {
          localStorage.setItem('mccia_access_token', data.access_token);
        }
        localStorage.setItem(SESSION_KEY, JSON.stringify(authUser));
        setUser(authUser);
        setIsLoading(false);
        return;
      }
    } catch {
      /* Backend unreachable — fall through to mock */
    }

    /* Mock fallback */
    await new Promise(r => setTimeout(r, 600));
    const found = MOCK_USERS.find(
      u => u.email.toLowerCase() === email.toLowerCase() && u.password === password
    );
    if (!found) {
      setIsLoading(false);
      throw new Error('Invalid email or password.');
    }
    const { password: _pw, ...authUser } = found;
    localStorage.setItem(SESSION_KEY, JSON.stringify(authUser));
    setUser(authUser);
    setIsLoading(false);
  };

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
    setError(null);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

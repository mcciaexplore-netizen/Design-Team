import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiJson } from '../api';

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
  user:      AuthUser | null;
  isLoading: boolean;
  error:     string | null;
  retry:     () => void;
}

/* ─── Context ─────────────────────────────── */
const AuthContext = createContext<AuthContextType | undefined>(undefined);

const RETRY_DELAYS_MS = [500, 1500, 3000];   // a few quick retries ride out a cold serverless start

/** There is no login: the backend resolves every request to one shared staff identity. This just fetches
 *  who that is, retrying a few times before giving up, so the UI can show a name and role-based navigation. */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,       setUser]       = useState<AuthUser | null>(null);
  const [isLoading,  setIsLoading]  = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const fetchMe = (attempt: number): void => {
      apiJson<{ id: number; full_name: string; email: string; role: string }>('/api/auth/me')
        .then(u => {
          if (cancelled) return;
          const role: UserRole = u.role === 'Design Lead' || u.role === 'Client' ? u.role : 'Designer';
          setUser({
            id:       String(u.id),
            name:     u.full_name,
            email:    u.email,
            role,
            initials: u.full_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase(),
            color:    role === 'Design Lead' ? '#003F8A' : role === 'Client' ? '#f97316' : '#8B5CF6',
          });
          setIsLoading(false);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          if (attempt < RETRY_DELAYS_MS.length) {
            setTimeout(() => { if (!cancelled) fetchMe(attempt + 1); }, RETRY_DELAYS_MS[attempt]);
            return;
          }
          setError(e instanceof Error ? e.message : 'Could not load the workspace. Please try again.');
          setIsLoading(false);
        });
    };
    fetchMe(0);

    return () => { cancelled = true; };
  }, [retryToken]);

  return (
    <AuthContext.Provider value={{ user, isLoading, error, retry: () => setRetryToken(t => t + 1) }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

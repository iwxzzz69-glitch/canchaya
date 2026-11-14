'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, sessionStore } from './api';
import type { Session, User } from './types';

interface Ctx {
  user: User | null;
  ready: boolean; // false hasta leer localStorage: evita mostrar "Ingresar" un instante a quien ya tiene sesión
  login(email: string, password: string): Promise<void>;
  register(name: string, email: string, password: string): Promise<void>;
  logout(): void;
}
const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setUser(sessionStore.read()?.user ?? null);
    sync();
    setReady(true);
    window.addEventListener('canchaya:session', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('canchaya:session', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const start = useCallback((s: Session) => {
    sessionStore.write(s);
    setUser(s.user);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      user,
      ready,
      async login(email, password) {
        start(await api<Session>('/auth/login', { method: 'POST', body: { email, password }, auth: false }));
      },
      async register(name, email, password) {
        start(await api<Session>('/auth/register', { method: 'POST', body: { name, email, password, role: 'player' }, auth: false }));
      },
      logout() {
        sessionStore.write(null);
        setUser(null);
      },
    }),
    [user, ready, start],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession debe usarse dentro de SessionProvider');
  return ctx;
}

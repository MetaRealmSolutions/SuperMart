import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { loadToken, onSessionExpired, rpc, setToken } from './api';

export interface SessionUser {
  id: number;
  username: string;
  name: string;
  role: string;
}

interface SessionState {
  ready: boolean;
  user: SessionUser | null;
  permissions: string[];
  modules: string[];
  can: (perm: string) => boolean;
  hasModule: (m: string) => boolean;
  signIn: (username: string, pin: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [modules, setModules] = useState<string[]>(['core']);

  const refresh = useCallback(async () => {
    if (!loadToken()) {
      setUser(null);
      setReady(true);
      return;
    }
    try {
      const me = await rpc('auth.me');
      setUser(me.user);
      setPermissions(me.permissions);
      setModules(me.modules);
    } catch {
      setUser(null);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    refresh();
    return onSessionExpired(() => setUser(null));
  }, [refresh]);

  const signIn = useCallback(
    async (username: string, pin: string) => {
      const r = await rpc('auth.login', { username, pin });
      setToken(r.token);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    try {
      await rpc('auth.logout');
    } catch {
      /* already gone */
    }
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      ready,
      user,
      permissions,
      modules,
      can: (p) => permissions.includes(p),
      hasModule: (m) => m === 'core' || modules.includes(m),
      signIn,
      signOut,
      refresh,
    }),
    [ready, user, permissions, modules, signIn, signOut, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { authClient } from '@/api/auth-client';
import type { Session, User } from 'better-auth';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

/** 认证提供者 — 基于 better-auth session cookie */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // 挂载时检查 session
  useEffect(() => {
    authClient.getSession().then(({ data, error }) => {
      if (!error && data) {
        setUser(data.user as User);
        setSession(data.session as Session);
      }
    }).finally(() => setLoading(false));
  }, []);

  /** 用户名密码登录 */
  const login = useCallback(async (username: string, password: string) => {
    const { data, error } = await authClient.signIn.username({
      username,
      password,
    });
    if (error) throw new Error(error.message || '登录失败');

    // 登录后拉取完整 session
    const sessionRes = await authClient.getSession();
    if (sessionRes.data) {
      setUser(sessionRes.data.user as User);
      setSession(sessionRes.data.session as Session);
    }
  }, []);

  /** 登出 */
  const logout = useCallback(async () => {
    await authClient.signOut().catch(() => {});
    setUser(null);
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      session,
      loading,
      login,
      logout,
      isAuthenticated: !!user,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// 1. React
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { usePersistedState } from '@/hooks/use-persisted-state';

type Theme = 'light' | 'dark';

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void } | null>(null);

/** 主题提供者 — 切换 <html>.dark class，localStorage 持久化，默认 light */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // 主题持久化（裸字符串存储，默认 light）
  const [theme, setTheme] = usePersistedState<Theme>('theme', 'light', {
    serialize: (t) => t,
    deserialize: (raw) => (raw === 'dark' ? 'dark' : 'light'),
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

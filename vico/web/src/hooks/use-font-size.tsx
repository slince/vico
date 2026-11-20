// 1. React
import { createContext, useContext, type ReactNode } from 'react';
import { usePersistedState } from '@/hooks/use-persisted-state';

/** 会话区默认字体大小（px） */
export const DEFAULT_FONT_SIZE = 12;

/** 基准字号（px）— 会话区 rem 文本的默认大小，缩放系数 = 目标字号 / 基准字号 */
export const BASE_FONT_SIZE = 16;

const FontSizeContext = createContext<{
  fontSize: number;
  setFontSize: (px: number) => void;
} | null>(null);

/** 会话区字体大小提供者 — 仅影响 chat 会话区域，localStorage 持久化，默认 12px */
export function FontSizeProvider({ children }: { children: ReactNode }) {
  // 字号持久化（数字转字符串存储，非法值回退默认 12px）
  const [fontSize, setFontSize] = usePersistedState<number>(
    'chat-font-size',
    DEFAULT_FONT_SIZE,
    {
      serialize: (px) => String(px),
      deserialize: (raw) => {
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : DEFAULT_FONT_SIZE;
      },
    },
  );

  return (
    <FontSizeContext.Provider value={{ fontSize, setFontSize }}>
      {children}
    </FontSizeContext.Provider>
  );
}

export function useFontSize() {
  const ctx = useContext(FontSizeContext);
  if (!ctx) throw new Error('useFontSize must be used within FontSizeProvider');
  return ctx;
}

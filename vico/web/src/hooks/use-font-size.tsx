// 1. React
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'chat-font-size';

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
  const [fontSize, setFontSizeState] = useState<number>(() => {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_FONT_SIZE;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(fontSize));
  }, [fontSize]);

  const setFontSize = (px: number) => setFontSizeState(px);

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

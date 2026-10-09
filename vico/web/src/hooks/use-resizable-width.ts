/**
 * 可拖动调节 + localStorage 持久化的宽度 hook。
 *
 * 用于实现两栏布局中「拖动中轴线分配宽度」的交互：拖动期间实时更新宽度，
 * 拖动结束（pointerup）时把最终宽度写入 localStorage，刷新后还原。
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export interface UseResizableWidthOptions {
  /** localStorage 存储键，用于记住宽度 */
  storageKey: string;
  /** 无缓存时的默认宽度（px） */
  defaultWidth: number;
  /** 允许的最小宽度（px） */
  minWidth: number;
  /** 允许的最大宽度（px） */
  maxWidth: number;
}

/** 将宽度收敛到 [min, max] 区间 */
function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 从 localStorage 读取缓存宽度，非法/越界时回退默认值 */
function readStoredWidth(storageKey: string, defaultWidth: number, min: number, max: number): number {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) {
      const n = Number(saved);
      if (Number.isFinite(n)) return clampWidth(n, min, max);
    }
  } catch { /* localStorage 不可用时忽略 */ }
  return defaultWidth;
}

/**
 * 可拖动调节宽度的 hook。
 *
 * @param options - 配置（存储键、默认/最小/最大宽度）
 * @returns `width` 当前宽度、`dragging` 是否拖动中、`onPointerDown` 绑定到分隔条的按下回调
 */
export function useResizableWidth(options: UseResizableWidthOptions) {
  const { storageKey, defaultWidth, minWidth, maxWidth } = options;

  const [width, setWidth] = useState<number>(() =>
    readStoredWidth(storageKey, defaultWidth, minWidth, maxWidth),
  );
  const [dragging, setDragging] = useState(false);

  // ref 同步持有最新宽度：拖动中实时更新，供 pointerup 时持久化最终值
  const widthRef = useRef(width);

  /**
   * 分隔条 pointerdown 处理器 — 记录起点后监听 window 的 pointermove/pointerup，
   * 根据鼠标横向位移实时调整宽度；拖动期间锁定全局光标并禁止文本选中，
   * 拖动结束（pointerup）时把最终宽度写入 localStorage。
   */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    // 动态上限：不超过窗口宽度的 80%，保证聊天区始终留有空间
    const effectiveMax = Math.max(minWidth, Math.round(window.innerWidth * 0.8));
    setDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (ev: PointerEvent) => {
      // 向左拖动（startX - clientX > 0）→ 面板变宽
      const next = clampWidth(startWidth + (startX - ev.clientX), minWidth, effectiveMax);
      widthRef.current = next;
      setWidth(next);
    };
    const handleUp = () => {
      setDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      try {
        localStorage.setItem(storageKey, String(widthRef.current));
      } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  return { width, dragging, onPointerDown };
}

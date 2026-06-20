import * as React from 'react';
import { useSelected, useFocused, type RenderElementProps } from 'slate-react';
import { cn } from '@/lib/utils';
import type { ImageElement } from './types';

/**
 * 图片 void 元素渲染器 — 显示图片并支持选中高亮。
 */
export function ImageElementRenderer({
  attributes,
  children,
  element,
}: RenderElementProps) {
  const selected = useSelected();
  const focused = useFocused();
  const img = element as unknown as ImageElement;

  return (
    <div {...attributes} data-slot="richtext-editor-image" className="inline-block relative my-2">
      <div
        contentEditable={false}
        className={cn(
          'inline-block rounded-md overflow-hidden border border-border',
          selected && focused && 'ring-2 ring-ring ring-offset-2',
        )}
      >
        <img
          src={img.url}
          alt={img.alt || ''}
          className="max-w-full max-h-80 object-contain"
          onError={(e) => {
            // 图片加载失败时显示占位
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            const parent = target.parentElement;
            if (parent) {
              const fallback = document.createElement('div');
              fallback.className = 'p-4 text-sm text-muted-foreground bg-muted rounded-md';
              fallback.textContent = `[Image: ${img.url}]`;
              parent.appendChild(fallback);
            }
          }}
        />
      </div>
      {children}
    </div>
  );
}

/**
 * FileLink — 可点击的文件引用。
 *
 * 在 markdown 文本与工具卡片中渲染文件路径为带图标的可点击链接，
 * 点击后通过 FileReferenceContext 打开右侧文件预览面板。
 * 无 threadId（新会话 / 非聊天场景）时退化为纯文本，保证不报错。
 */
'use client';

import type { ComponentProps } from 'react';

import { getFileIcon } from '@/components/file-explorer/FileExplorer';
import { useFileReference } from '@/components/assistant-ui/file-reference-context';
import { cn } from '@/lib/utils';

export interface FileLinkProps extends Omit<ComponentProps<'button'>, 'children' | 'onClick'> {
  /** 文件路径（相对或绝对，展示原样，点击时透传给预览面板） */
  path: string;
}

/**
 * 文件引用链接组件。
 *
 * @param path - 文件路径
 * @param className - 额外样式（工具卡片可传入其字号/颜色）
 */
export function FileLink({ path, className, ...props }: FileLinkProps) {
  const { threadId, openFileReference } = useFileReference();
  const { Icon, cls } = getFileIcon(path);

  // 无真实线程 ID（尚未创建会话 / 无 Provider）时不可点击，渲染为纯文本
  if (!threadId) {
    return (
      <span className={cn('font-mono break-all', className)}>{path}</span>
    );
  }

  return (
    <button
      type="button"
      title={`打开 ${path}`}
      aria-label={`打开文件 ${path}`}
      onClick={() => openFileReference(path)}
      className={cn(
        'inline-flex max-w-full cursor-pointer items-center gap-1 rounded-sm px-0.5 align-baseline font-mono text-[0.85em] text-blue-600 dark:text-blue-400 transition-colors hover:bg-accent hover:underline underline-offset-2',
        className,
      )}
      {...props}
    >
      <Icon className={cn('size-3.5 shrink-0', cls)} />
      <span className="min-w-0 break-all">{path}</span>
    </button>
  );
}

'use client';

import { Check, Folder, FolderSync, RefreshCw, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import {
  FileExplorer,
  type FileExplorerRef,
} from '@/components/file-explorer/FileExplorer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import { useResizableWidth } from '@/hooks/use-resizable-width';

/**
 * 线程文件浏览器面板适配器。
 *
 * 将可复用的 FileExplorer（目录树）嵌入面板外壳：负责渲染分隔条、头部
 * （标题 / 切换目录 / 刷新 / 关闭）、当前工作目录展示与切换目录输入区，
 * 并通过 zustand store 与 FileTabBar/FileTabContent 通信（打开文件为 tab）。
 * 面板宽度通过 useResizableWidth 拖动调节并持久化到 localStorage（刷新后还原）。
 */
export function FileExplorerPanel({ threadId }: { threadId: string }) {
  const open = useFileExplorerStore((s) => s.fileExplorerOpen);
  const toggle = useFileExplorerStore((s) => s.toggleFileExplorer);
  const openFile = useFileExplorerStore((s) => s.openFile);

  // 目录树命令式句柄，供刷新 / 切换目录后触发重载
  const explorerRef = useRef<FileExplorerRef>(null);

  const [cwd, setCwd] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [chdirOpen, setChdirOpen] = useState(false);
  const [chdirInput, setChdirInput] = useState('');
  const [chdirLoading, setChdirLoading] = useState(false);

  // 面板宽度可拖动调节，并持久化到 localStorage（刷新后还原）
  const { width, dragging, onPointerDown } = useResizableWidth({
    storageKey: 'chat_file_explorer_width',
    defaultWidth: 320,
    minWidth: 260,
    maxWidth: 800,
  });

  /** 刷新目录树 */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await explorerRef.current?.reload();
    } finally {
      setRefreshing(false);
    }
  }, []);

  /** 切换工作目录（workspace 绑定），成功后重载目录树 */
  const handleChdir = useCallback(async () => {
    const p = chdirInput.trim();
    if (!p) return;
    setChdirLoading(true);
    try {
      const res = await fetch(`/api/v1/threads/${threadId}/fs/chdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ path: p }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCwd(data.cwd);
      setChdirOpen(false);
      setChdirInput('');
      await explorerRef.current?.reload();
    } catch {
      // 保持输入区打开，便于用户修正
    } finally {
      setChdirLoading(false);
    }
  }, [threadId, chdirInput]);

  /** 打开/关闭切换目录输入区，打开时回填当前 cwd */
  const toggleChdir = useCallback(() => {
    setChdirOpen((v) => !v);
    setChdirInput(cwd ?? '');
  }, [cwd]);

  if (!open) return null;

  return (
    <>
      {/* 分隔条 — 拖动调节文件浏览器与聊天区之间的宽度分配 */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调节文件浏览器宽度"
        onPointerDown={onPointerDown}
        className={cn(
          'w-1.5 shrink-0 cursor-col-resize transition-colors',
          dragging ? 'bg-primary/40' : 'hover:bg-primary/30',
        )}
      />
      <aside className="flex shrink-0 flex-col border-l bg-card" style={{ width }}>
        <header className="flex shrink-0 items-center justify-between border-b px-3 py-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Folder className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">文件</span>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              onClick={toggleChdir}
              title="切换目录"
            >
              <FolderSync className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => void refresh()}
              title="刷新"
              disabled={refreshing}
            >
              <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
            </Button>
            <Button size="icon" variant="ghost" onClick={toggle} title="关闭">
              <X className="size-4" />
            </Button>
          </div>
        </header>

        {/* 切换工作目录输入区 */}
        {chdirOpen && (
          <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
            <Input
              value={chdirInput}
              onChange={(e) => setChdirInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleChdir();
                if (e.key === 'Escape') setChdirOpen(false);
              }}
              placeholder="输入目录路径，如 ~/project"
              className="h-7 flex-1 font-mono text-xs"
              autoFocus
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={() => void handleChdir()}
              disabled={chdirLoading || !chdirInput.trim()}
              className="size-7 shrink-0"
            >
              <Check className="size-3.5" />
            </Button>
          </div>
        )}

        {/* 当前工作目录路径 */}
        {cwd && (
          <div className="shrink-0 truncate border-b px-3 py-1 font-mono text-[10px] text-muted-foreground/70">
            {cwd}
          </div>
        )}

        {/* 目录树 — 由可复用 FileExplorer 自行查询目录内容 */}
        <FileExplorer
          ref={explorerRef}
          directory={threadId}
          onOpenFile={(p, name) => openFile(threadId, p, name)}
          onCwdChange={setCwd}
        />
      </aside>
    </>
  );
}

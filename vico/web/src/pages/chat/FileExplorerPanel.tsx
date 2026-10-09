'use client';

import { Check, FileText, FolderSync, FolderTree, RefreshCw, Terminal, X } from 'lucide-react';
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
import { FilePreviewView } from '@/pages/chat/FilePreviewView';
import { TerminalView } from '@/pages/chat/TerminalView';

/** 右侧边栏三个视图的标识 */
type ViewId = 'files' | 'preview' | 'terminal';

/** 顶部 Tab 配置（文件树 / 文件预览 / 终端） */
const VIEWS: { id: ViewId; label: string; icon: typeof FolderTree }[] = [
  { id: 'files', label: '文件', icon: FolderTree },
  { id: 'preview', label: '预览', icon: FileText },
  { id: 'terminal', label: '终端', icon: Terminal },
];

/**
 * 线程右侧边栏面板 — 多视图容器。
 *
 * 将「文件树 / 文件预览 / 终端」三个视图收敛到同一面板，顶部 Tab 切换。
 * 三个视图同时挂载、用 CSS 隐藏切换可见性，避免切 tab 丢失状态（尤其是
 * 终端的 WebSocket 连接与文件树的展开状态）。面板宽度通过 useResizableWidth
 * 拖动调节并持久化到 localStorage（刷新后还原）。
 *
 * 文件树视图复用可复用的 FileExplorer（仅负责目录树渲染与自查询），本组件
 * 负责其头部工具条（切换目录 / 刷新）与当前工作目录展示。
 */
export function FileExplorerPanel({ threadId }: { threadId: string }) {
  const open = useFileExplorerStore((s) => s.fileExplorerOpen);
  const toggle = useFileExplorerStore((s) => s.toggleFileExplorer);
  const openFile = useFileExplorerStore((s) => s.openFile);

  // 目录树命令式句柄，供刷新 / 切换目录后触发重载
  const explorerRef = useRef<FileExplorerRef>(null);

  const [activeView, setActiveView] = useState<ViewId>('files');
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

  /** 点击文件树中的文件：打开 tab 并自动切到「预览」视图 */
  const handleOpenFile = useCallback(
    (path: string, name: string) => {
      openFile(threadId, path, name);
      setActiveView('preview');
    },
    [threadId, openFile],
  );

  if (!open) return null;

  return (
    <>
      {/* 分隔条 — 拖动调节右侧面板与聊天区之间的宽度分配 */}
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
        {/* 顶部 Tab 栏 — 文件 / 预览 / 终端 */}
        <div className="flex shrink-0 items-center border-b bg-muted/30">
          {VIEWS.map((v) => {
            const isActive = activeView === v.id;
            const Icon = v.icon;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActiveView(v.id)}
                className={cn(
                  'flex items-center gap-1.5 border-r px-3 py-2 text-xs transition-colors',
                  isActive
                    ? '-mb-[1px] border-b-2 border-b-primary bg-background font-medium'
                    : 'text-muted-foreground hover:bg-accent/50',
                )}
              >
                <Icon className="size-3.5" />
                {v.label}
              </button>
            );
          })}
          <div className="ml-auto flex shrink-0 items-center pr-1">
            <Button
              size="icon"
              variant="ghost"
              onClick={toggle}
              title="关闭"
              className="size-7"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* 文件树视图 */}
        <div className={cn('min-h-0 flex-1 flex-col', activeView === 'files' ? 'flex' : 'hidden')}>
          {/* 工具条：切换目录 / 刷新 */}
          <div className="flex shrink-0 items-center gap-0.5 border-b px-2 py-1">
            <span className="truncate text-xs font-medium">文件</span>
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <Button
                size="icon"
                variant="ghost"
                onClick={toggleChdir}
                title="切换目录"
                className="size-7"
              >
                <FolderSync className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void refresh()}
                title="刷新"
                disabled={refreshing}
                className="size-7"
              >
                <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
              </Button>
            </div>
          </div>

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
            onOpenFile={handleOpenFile}
            onCwdChange={setCwd}
          />
        </div>

        {/* 文件预览视图 */}
        <div
          className={cn('min-h-0 flex-1 flex-col', activeView === 'preview' ? 'flex' : 'hidden')}
        >
          <FilePreviewView threadId={threadId} />
        </div>

        {/* 终端视图 */}
        <div
          className={cn('min-h-0 flex-1 flex-col', activeView === 'terminal' ? 'flex' : 'hidden')}
        >
          <TerminalView threadId={threadId} active={activeView === 'terminal'} />
        </div>
      </aside>
    </>
  );
}

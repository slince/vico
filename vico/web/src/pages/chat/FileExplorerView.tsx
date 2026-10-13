'use client';

import { FolderSync, RefreshCw } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { FileExplorer, type FileExplorerRef } from '@/components/file-explorer/FileExplorer';
import { FolderPickerDialog } from '@/components/file-explorer/FolderPickerDialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';

/**
 * 文件树视图 — 右侧 Sidebar 中的文件浏览子视图。
 *
 * 负责工作目录路径展示、切换目录（文件夹选择弹窗）、刷新，以及目录树渲染。
 * 点击文件通过 store 的 openFile 在顶层 tab 模型中创建文件 tab。
 * 视图的显示/隐藏由上层 ChatSidebar 控制（始终挂载以保留目录树展开态）。
 */
export function FileExplorerView({ threadId }: { threadId: string }) {
  const openFile = useFileExplorerStore((s) => s.openFile);

  // 目录树命令式句柄，供刷新 / 切换目录后触发重载
  const explorerRef = useRef<FileExplorerRef>(null);

  const [cwd, setCwd] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [chdirOpen, setChdirOpen] = useState(false);

  /** 刷新目录树 */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await explorerRef.current?.reload();
    } finally {
      setRefreshing(false);
    }
  }, []);

  /** 选中目录后切换工作目录（workspace 绑定），成功后重载目录树 */
  const handleSelectDir = useCallback(
    async (path: string) => {
      try {
        const res = await fetch(`/api/v1/threads/${threadId}/fs/chdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ path }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setCwd(data.cwd);
        setChdirOpen(false);
        await explorerRef.current?.reload();
      } catch {
        // 保持弹窗打开，便于用户重新选择
      }
    },
    [threadId],
  );

  /** 打开/关闭目录选择弹窗 */
  const toggleChdir = useCallback(() => {
    setChdirOpen((v) => !v);
  }, []);

  /** 点击文件树中的文件：打开 tab（store 内部会激活该文件 tab） */
  const handleOpenFile = useCallback(
    (path: string, name: string) => {
      openFile(threadId, path, name);
    },
    [threadId, openFile],
  );

  return (
    <>
      {/* 工具条：工作目录路径 + 切换目录 / 刷新 */}
      <div className="flex shrink-0 items-center gap-0.5 border-b px-2 py-1">
        <span className="min-w-0 flex-1 truncate px-1 font-mono text-[10px] text-muted-foreground/70">
          {cwd}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
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

      {/* 目录树 — 由可复用 FileExplorer 自行查询目录内容 */}
      <FileExplorer
        ref={explorerRef}
        directory={threadId}
        onOpenFile={handleOpenFile}
        onCwdChange={setCwd}
      />

      {/* 目录选择弹窗 — 浏览服务器文件系统切换工作目录 */}
      <FolderPickerDialog
        threadId={threadId}
        open={chdirOpen}
        onOpenChange={setChdirOpen}
        initialPath={cwd}
        onSelect={handleSelectDir}
      />
    </>
  );
}

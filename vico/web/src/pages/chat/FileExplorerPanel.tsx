'use client';

import { useCallback, useEffect, useState } from 'react';

import { FileExplorer, type DirNode } from '@/components/file-explorer/FileExplorer';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import { useResizableWidth } from '@/hooks/use-resizable-width';

/**
 * 线程文件浏览器面板适配器。
 *
 * 将线程 workspace 的 fs 接口（listdir / chdir）接入可复用的 FileExplorer 组件：
 * 负责按 threadId 加载目录树、维护节点状态、切换工作目录、刷新，
 * 并通过 zustand store 与 FileTabBar/FileTabContent 通信（打开文件为 tab）。
 * 面板宽度通过 useResizableWidth 拖动调节并持久化到 localStorage（刷新后还原）。
 */
export function FileExplorerPanel({ threadId }: { threadId: string }) {
  const open = useFileExplorerStore((s) => s.fileExplorerOpen);
  const toggle = useFileExplorerStore((s) => s.toggleFileExplorer);
  const openFile = useFileExplorerStore((s) => s.openFile);

  const [nodes, setNodes] = useState<Record<string, DirNode>>({});
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [cwd, setCwd] = useState<string | null>(null);
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

  const loadDir = useCallback(
    async (relPath: string) => {
      setNodes((prev) => ({
        ...prev,
        [relPath]: {
          ...(prev[relPath] ?? { relPath }),
          relPath,
          expanded: true,
          loaded: false,
        },
      }));
      try {
        const qs = relPath ? `?path=${encodeURIComponent(relPath)}` : '';
        const res = await fetch(
          `/api/v1/threads/${threadId}/fs/listdir${qs}`,
          { credentials: 'include' },
        );
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (!relPath && data.cwd) setCwd(data.cwd);
        setNodes((prev) => ({
          ...prev,
          [relPath]: {
            relPath,
            loaded: true,
            expanded: true,
            entries: data.entries,
          },
        }));
      } catch (err) {
        setNodes((prev) => ({
          ...prev,
          [relPath]: {
            relPath,
            loaded: true,
            expanded: true,
            error: err instanceof Error ? err.message : String(err),
          },
        }));
      }
    },
    [threadId],
  );

  const toggleDir = (relPath: string) => {
    const cur = nodes[relPath];
    if (cur?.expanded) {
      setNodes((prev) => ({ ...prev, [relPath]: { ...prev[relPath], expanded: false } }));
    } else if (!cur || !cur.loaded) {
      void loadDir(relPath);
    } else {
      setNodes((prev) => ({ ...prev, [relPath]: { ...prev[relPath], expanded: true } }));
    }
  };

  const refresh = useCallback(() => {
    setNodes({});
    setLoadingRoot(true);
    void loadDir('').finally(() => setLoadingRoot(false));
  }, [loadDir]);

  /** 切换工作目录 */
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
      refresh();
    } catch {
      // 保持输入区打开，便于用户修正
    } finally {
      setChdirLoading(false);
    }
  }, [threadId, chdirInput, refresh]);

  /** 打开/关闭切换目录输入区，打开时回填当前 cwd */
  const toggleChdir = useCallback(() => {
    setChdirOpen((v) => !v);
    setChdirInput(cwd ?? '');
  }, [cwd]);

  // 面板打开或 threadId 变化时加载根目录
  useEffect(() => {
    if (!open) return;
    setNodes({});
    setLoadingRoot(true);
    void loadDir('').finally(() => setLoadingRoot(false));
  }, [open, threadId, loadDir]);

  if (!open) return null;

  return (
    <FileExplorer
      width={width}
      dragging={dragging}
      onPointerDown={onPointerDown}
      nodes={nodes}
      onToggleDir={toggleDir}
      onOpenFile={(p, name) => openFile(threadId, p, name)}
      cwd={cwd}
      chdirOpen={chdirOpen}
      chdirInput={chdirInput}
      chdirLoading={chdirLoading}
      onChdirInputChange={setChdirInput}
      onChdirSubmit={() => void handleChdir()}
      onToggleChdir={toggleChdir}
      onRefresh={refresh}
      refreshing={loadingRoot}
      onClose={toggle}
    />
  );
}

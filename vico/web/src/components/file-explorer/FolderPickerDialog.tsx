'use client';

import { ArrowUp, Folder, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

/** browse 接口返回的目录条目 */
interface BrowseEntry {
  name: string;
  isDirectory: boolean;
}

/** 父目录拼接：根目录下直接拼，否则用 / 连接 */
function joinPath(parent: string, name: string): string {
  return parent === '/' ? `/${name}` : `${parent}/${name}`;
}

export interface FolderPickerDialogProps {
  /** 线程 ID（workspace 标识） */
  threadId: string;
  /** 弹窗开关 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 起始目录（当前 cwd，可能为 null，此时由后端回退到 workspace/home） */
  initialPath: string | null;
  /** 选中目录后的回调（内部调用 chdir） */
  onSelect: (path: string) => void;
}

/**
 * 文件夹选择器弹窗 — 浏览服务器文件系统并选择目录。
 *
 * 通过 GET /fs/browse 逐级下钻目录，支持「上一级」返回父目录，
 * 底部「选择此目录」将当前浏览目录作为结果回传，由父组件执行 chdir。
 */
export function FolderPickerDialog({
  threadId,
  open,
  onOpenChange,
  initialPath,
  onSelect,
}: FolderPickerDialogProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 加载指定目录；path 省略时由后端决定起始目录 */
  const loadDir = useCallback(
    async (path?: string) => {
      setLoading(true);
      setError(null);
      try {
        const qs = path ? `?path=${encodeURIComponent(path)}` : '';
        const res = await fetch(`/api/v1/threads/${threadId}/fs/browse${qs}`, {
          credentials: 'include',
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setCurrentPath(data.path);
        // 根目录无父级（parent === path），此时禁用「上一级」
        setParentPath(data.parent !== data.path ? data.parent : null);
        setEntries(data.entries ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [threadId],
  );

  // 打开时初始化浏览起始目录
  useEffect(() => {
    if (open) void loadDir(initialPath ?? undefined);
  }, [open, initialPath, loadDir]);

  /** 进入子目录 */
  const enterDir = useCallback(
    (name: string) => {
      void loadDir(joinPath(currentPath, name));
    },
    [currentPath, loadDir],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>选择目录</DialogTitle>
          <DialogDescription>浏览服务器文件系统，选择要切换的工作目录</DialogDescription>
        </DialogHeader>

        {/* 当前路径栏 + 上一级 */}
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => void loadDir(parentPath ?? undefined)}
            disabled={!parentPath || loading}
            title="上一级"
            className="size-7 shrink-0"
          >
            <ArrowUp className="size-4" />
          </Button>
          <span className="min-w-0 flex-1 truncate rounded bg-muted/50 px-2 py-1 font-mono text-xs text-muted-foreground">
            {currentPath || '加载中...'}
          </span>
        </div>

        {/* 目录列表 */}
        <ScrollArea className="h-72 rounded-md border">
          <div className="py-1">
            {loading && (
              <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                加载中...
              </div>
            )}
            {!loading && error && (
              <div className="px-3 py-1 text-xs text-red-600">{error}</div>
            )}
            {!loading && !error && entries.length === 0 && (
              <div className="px-3 py-1 text-xs text-muted-foreground">(空)</div>
            )}
            {!loading &&
              !error &&
              entries.map((e) => (
                <button
                  key={e.name}
                  type="button"
                  onClick={() => enterDir(e.name)}
                  className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs hover:bg-accent"
                >
                  <Folder className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
                  <span className="truncate">{e.name}</span>
                </button>
              ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => onSelect(currentPath)} disabled={!currentPath || loading}>
            选择此目录
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

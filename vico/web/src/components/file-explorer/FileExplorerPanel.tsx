'use client';

import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileKey,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideo,
  Folder,
  FolderOpen,
  FolderSync,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';

interface DirEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
}

interface DirNode {
  relPath: string;
  loaded: boolean;
  expanded: boolean;
  entries?: DirEntry[];
  error?: string;
}

/**
 * 右侧文件浏览器面板。
 *
 * - 列出当前 thread workspace 的文件树
 * - 点击文件夹展开 / 收起；点击文件打开为中间 tab
 * - 通过 zustand store 与 FileTabBar/FileTabContent 通信
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
  const inputRef = useRef<HTMLInputElement>(null);

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
    } catch (err) {
      // keep input open so user can fix
    } finally {
      setChdirLoading(false);
    }
  }, [threadId, chdirInput, refresh]);

  // 面板打开或 threadId 变化时加载根目录
  useEffect(() => {
    if (!open) return;
    setNodes({});
    setLoadingRoot(true);
    void loadDir('').finally(() => setLoadingRoot(false));
  }, [open, threadId, loadDir]);

  if (!open) return null;

  return (
    <aside className="flex w-80 min-w-[260px] shrink-0 flex-col border-l bg-card">
      <header className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">文件</span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => { setChdirOpen((v) => !v); setChdirInput(cwd ?? ''); }}
            title="切换目录"
          >
            <FolderSync className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={refresh}
            title="刷新"
            disabled={loadingRoot}
          >
            <RefreshCw className={cn('size-4', loadingRoot && 'animate-spin')} />
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
            ref={inputRef}
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

      <ScrollArea className="min-h-0 flex-1">
        <div className="py-1">
          <DirTreeNode
            relPath=""
            indent={0}
            nodes={nodes}
            onToggleDir={toggleDir}
            onOpenFile={(p, name) => openFile(threadId, p, name)}
          />
        </div>
      </ScrollArea>
    </aside>
  );
}

function DirTreeNode({
  relPath,
  indent,
  nodes,
  onToggleDir,
  onOpenFile,
}: {
  relPath: string;
  indent: number;
  nodes: Record<string, DirNode>;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string, name: string) => void;
}) {
  const node = nodes[relPath];
  if (!node) return null;

  return (
    <>
      {/* root 自身不渲染行，从子条目开始 */}
      {node.expanded && (
        <>
          {!node.loaded && (
            <div
              className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground"
              style={{ paddingLeft: 12 + indent * 14 }}
            >
              <Loader2 className="size-3 animate-spin" />
              加载中...
            </div>
          )}
          {node.error && (
            <div
              className="px-3 py-1 text-xs text-red-600"
              style={{ paddingLeft: 12 + indent * 14 }}
            >
              {node.error}
            </div>
          )}
          {node.entries?.length === 0 && (
            <div
              className="px-3 py-1 text-xs text-muted-foreground"
              style={{ paddingLeft: 12 + indent * 14 }}
            >
              (空)
            </div>
          )}
          {node.entries?.map((e) => {
            const childPath = relPath === '' ? e.name : `${relPath}/${e.name}`;
            const childNode = nodes[childPath];
            if (e.isDirectory) {
              const expanded = !!childNode?.expanded;
              return (
                <div key={childPath}>
                  <button
                    type="button"
                    onClick={() => onToggleDir(childPath)}
                    className="flex w-full items-center gap-1 px-3 py-1 text-left text-xs hover:bg-accent"
                    style={{ paddingLeft: 12 + indent * 14 }}
                  >
                    {expanded ? (
                      <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    {expanded ? (
                      <FolderOpen className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
                    ) : (
                      <Folder className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
                    )}
                    <span className="truncate">{e.name}</span>
                  </button>
                  {expanded && (
                    <DirTreeNode
                      relPath={childPath}
                      indent={indent + 1}
                      nodes={nodes}
                      onToggleDir={onToggleDir}
                      onOpenFile={onOpenFile}
                    />
                  )}
                </div>
              );
            }
            const { Icon: FileIcon, cls } = getFileIcon(e.name);
            return (
              <button
                key={childPath}
                type="button"
                onClick={() => onOpenFile(childPath, e.name)}
                className="flex w-full items-center gap-1 px-3 py-1 text-left text-xs hover:bg-accent"
                style={{ paddingLeft: 12 + indent * 14 + 14 }}
              >
                <FileIcon className={cn('size-3.5 shrink-0', cls)} />
                <span className="truncate">{e.name}</span>
              </button>
            );
          })}
        </>
      )}
    </>
  );
}

// ─── 文件图标映射（VS Code 风格）───

type FileIconSpec = { Icon: LucideIcon; cls: string };

const EXT_ICON: Record<string, FileIconSpec> = {
  ts: { Icon: FileCode, cls: 'text-blue-500' },
  tsx: { Icon: FileCode, cls: 'text-blue-500' },
  mts: { Icon: FileCode, cls: 'text-blue-500' },
  cts: { Icon: FileCode, cls: 'text-blue-500' },
  js: { Icon: FileCode, cls: 'text-yellow-500' },
  jsx: { Icon: FileCode, cls: 'text-yellow-500' },
  mjs: { Icon: FileCode, cls: 'text-yellow-500' },
  cjs: { Icon: FileCode, cls: 'text-yellow-500' },
  json: { Icon: FileJson, cls: 'text-amber-500' },
  jsonc: { Icon: FileJson, cls: 'text-amber-500' },
  json5: { Icon: FileJson, cls: 'text-amber-500' },
  yaml: { Icon: FileCog, cls: 'text-muted-foreground' },
  yml: { Icon: FileCog, cls: 'text-muted-foreground' },
  toml: { Icon: FileCog, cls: 'text-muted-foreground' },
  env: { Icon: FileKey, cls: 'text-amber-500' },
  gitignore: { Icon: FileCode, cls: 'text-orange-500' },
  md: { Icon: FileText, cls: 'text-sky-400' },
  mdx: { Icon: FileText, cls: 'text-sky-400' },
  markdown: { Icon: FileText, cls: 'text-sky-400' },
  txt: { Icon: FileText, cls: 'text-muted-foreground' },
  log: { Icon: FileText, cls: 'text-muted-foreground' },
  html: { Icon: FileCode, cls: 'text-orange-500' },
  htm: { Icon: FileCode, cls: 'text-orange-500' },
  css: { Icon: FileCog, cls: 'text-sky-500' },
  scss: { Icon: FileCog, cls: 'text-pink-500' },
  sass: { Icon: FileCog, cls: 'text-pink-500' },
  less: { Icon: FileCog, cls: 'text-blue-500' },
  vue: { Icon: FileCode, cls: 'text-emerald-500' },
  svelte: { Icon: FileCode, cls: 'text-orange-600' },
  py: { Icon: FileCode, cls: 'text-sky-500' },
  rb: { Icon: FileCode, cls: 'text-red-500' },
  go: { Icon: FileCode, cls: 'text-cyan-500' },
  rs: { Icon: FileCode, cls: 'text-orange-600' },
  java: { Icon: FileCode, cls: 'text-red-600' },
  kt: { Icon: FileCode, cls: 'text-purple-500' },
  c: { Icon: FileCode, cls: 'text-blue-600' },
  h: { Icon: FileCode, cls: 'text-blue-600' },
  cpp: { Icon: FileCode, cls: 'text-blue-600' },
  cc: { Icon: FileCode, cls: 'text-blue-600' },
  hpp: { Icon: FileCode, cls: 'text-blue-600' },
  cs: { Icon: FileCode, cls: 'text-violet-500' },
  php: { Icon: FileCode, cls: 'text-indigo-500' },
  swift: { Icon: FileCode, cls: 'text-orange-500' },
  sql: { Icon: Database, cls: 'text-sky-600' },
  sh: { Icon: FileTerminal, cls: 'text-green-500' },
  bash: { Icon: FileTerminal, cls: 'text-green-500' },
  zsh: { Icon: FileTerminal, cls: 'text-green-500' },
  ps1: { Icon: FileTerminal, cls: 'text-blue-400' },
  png: { Icon: FileImage, cls: 'text-purple-500' },
  jpg: { Icon: FileImage, cls: 'text-purple-500' },
  jpeg: { Icon: FileImage, cls: 'text-purple-500' },
  gif: { Icon: FileImage, cls: 'text-purple-500' },
  webp: { Icon: FileImage, cls: 'text-purple-500' },
  svg: { Icon: FileImage, cls: 'text-pink-500' },
  ico: { Icon: FileImage, cls: 'text-purple-500' },
  avif: { Icon: FileImage, cls: 'text-purple-500' },
  mp4: { Icon: FileVideo, cls: 'text-rose-500' },
  mov: { Icon: FileVideo, cls: 'text-rose-500' },
  mkv: { Icon: FileVideo, cls: 'text-rose-500' },
  webm: { Icon: FileVideo, cls: 'text-rose-500' },
  mp3: { Icon: FileAudio, cls: 'text-amber-600' },
  wav: { Icon: FileAudio, cls: 'text-amber-600' },
  flac: { Icon: FileAudio, cls: 'text-amber-600' },
  ogg: { Icon: FileAudio, cls: 'text-amber-600' },
  zip: { Icon: FileArchive, cls: 'text-yellow-600' },
  tar: { Icon: FileArchive, cls: 'text-yellow-600' },
  gz: { Icon: FileArchive, cls: 'text-yellow-600' },
  tgz: { Icon: FileArchive, cls: 'text-yellow-600' },
  rar: { Icon: FileArchive, cls: 'text-yellow-600' },
  '7z': { Icon: FileArchive, cls: 'text-yellow-600' },
  csv: { Icon: FileSpreadsheet, cls: 'text-green-600' },
  xls: { Icon: FileSpreadsheet, cls: 'text-green-600' },
  xlsx: { Icon: FileSpreadsheet, cls: 'text-green-600' },
  ttf: { Icon: FileType, cls: 'text-pink-400' },
  otf: { Icon: FileType, cls: 'text-pink-400' },
  woff: { Icon: FileType, cls: 'text-pink-400' },
  woff2: { Icon: FileType, cls: 'text-pink-400' },
  pem: { Icon: FileKey, cls: 'text-amber-500' },
  key: { Icon: FileKey, cls: 'text-amber-500' },
  crt: { Icon: FileKey, cls: 'text-amber-500' },
  cert: { Icon: FileKey, cls: 'text-amber-500' },
  lock: { Icon: FileLock, cls: 'text-muted-foreground' },
  pdf: { Icon: FileText, cls: 'text-red-500' },
  dockerfile: { Icon: FileCode, cls: 'text-sky-500' },
  makefile: { Icon: FileCog, cls: 'text-muted-foreground' },
};

const NAME_ICON: Record<string, FileIconSpec> = {
  'package.json': { Icon: FileJson, cls: 'text-red-500' },
  'package-lock.json': { Icon: FileLock, cls: 'text-muted-foreground' },
  'pnpm-lock.yaml': { Icon: FileLock, cls: 'text-muted-foreground' },
  'yarn.lock': { Icon: FileLock, cls: 'text-muted-foreground' },
  'tsconfig.json': { Icon: FileCog, cls: 'text-blue-500' },
  dockerfile: { Icon: FileCode, cls: 'text-sky-500' },
  makefile: { Icon: FileCog, cls: 'text-muted-foreground' },
};

const DEFAULT_FILE_ICON: FileIconSpec = { Icon: File, cls: 'text-muted-foreground' };

/** 根据文件名挑选图标：完整文件名 > 特例前缀 > 扩展名 > 默认 */
export function getFileIcon(name: string): FileIconSpec {
  const lower = name.toLowerCase();
  if (NAME_ICON[lower]) return NAME_ICON[lower];
  if (lower.startsWith('readme')) return { Icon: BookOpen, cls: 'text-sky-500' };
  if (lower.startsWith('license') || lower.startsWith('licence'))
    return { Icon: FileText, cls: 'text-amber-500' };
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  return EXT_ICON[ext] ?? DEFAULT_FILE_ICON;
}

'use client';

import {
  BookOpen,
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
  Loader2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

/** 目录中的一个条目（文件或子目录） */
export interface DirEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
}

/** 文件树中某个目录节点的加载/展开状态 */
export interface DirNode {
  relPath: string;
  loaded: boolean;
  expanded: boolean;
  entries?: DirEntry[];
  error?: string;
}

/** 文件图标规格：Lucide 图标 + 颜色类名 */
export interface FileIconSpec {
  Icon: LucideIcon;
  cls: string;
}

/**
 * FileExplorer 的 props。
 *
 * 组件自身负责调用服务端 listdir 接口查询目录内容，调用方只需给出目录标识
 * 和打开文件回调，无需关心节点状态与数据加载。
 */
export interface FileExplorerProps {
  /**
   * 目录参数 — 线程 ID（workspace 标识）。
   * 组件据此调用 `GET /api/v1/threads/:directory/fs/listdir` 列出目录下的条目。
   */
  directory: string;
  /** 打开文件回调（相对路径 + 文件名） */
  onOpenFile: (path: string, name: string) => void;
  /** 工作目录变化回调（listdir 返回 cwd 时上报，供上层展示/回填） */
  onCwdChange?: (cwd: string) => void;
}

/** FileExplorer 暴露给父组件的命令式句柄 */
export interface FileExplorerRef {
  /** 清空并重新加载根目录，返回加载完成的 Promise */
  reload: () => Promise<void>;
}

/**
 * 文件目录树组件 — 可复用通用能力。
 *
 * 仅负责目录树的递归渲染与懒加载：展开目录时调用 listdir 查询其子条目，
 * 点击文件触发 onOpenFile。面板头部、宽度调节、工作目录切换等均不属于本组件，
 * 由上层适配组件负责。
 */
export const FileExplorer = forwardRef<FileExplorerRef, FileExplorerProps>(
  function FileExplorer({ directory, onOpenFile, onCwdChange }, ref) {
    const [nodes, setNodes] = useState<Record<string, DirNode>>({});

    // ref 持有最新 onCwdChange，避免 loadDir 闭包捕获旧引用
    const onCwdChangeRef = useRef(onCwdChange);
    onCwdChangeRef.current = onCwdChange;

    /** 加载指定目录（相对路径），空串 = 根目录 */
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
            `/api/v1/threads/${directory}/fs/listdir${qs}`,
            { credentials: 'include' },
          );
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          if (!relPath && data.cwd) onCwdChangeRef.current?.(data.cwd);
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
      [directory],
    );

    /** 展开/收起目录：收起直接折叠，未加载则懒加载 */
    const toggleDir = useCallback(
      (relPath: string) => {
        const cur = nodes[relPath];
        if (cur?.expanded) {
          setNodes((prev) => ({ ...prev, [relPath]: { ...prev[relPath], expanded: false } }));
        } else if (!cur || !cur.loaded) {
          void loadDir(relPath);
        } else {
          setNodes((prev) => ({ ...prev, [relPath]: { ...prev[relPath], expanded: true } }));
        }
      },
      [nodes, loadDir],
    );

    /** 清空并重新加载根目录 */
    const reload = useCallback(() => {
      setNodes({});
      return loadDir('');
    }, [loadDir]);

    // 暴露 reload 给父组件（刷新 / 切换目录后重载）
    useImperativeHandle(ref, () => ({ reload }), [reload]);

    // 挂载或目录变化时加载根目录
    useEffect(() => {
      void reload();
    }, [reload]);

    return (
      <ScrollArea className="min-h-0 flex-1">
        <div className="py-1">
          <DirTreeNode
            relPath=""
            indent={0}
            nodes={nodes}
            onToggleDir={toggleDir}
            onOpenFile={onOpenFile}
          />
        </div>
      </ScrollArea>
    );
  },
);

/** 递归渲染文件树节点：目录可展开/收起，文件点击触发打开回调 */
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

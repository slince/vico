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
import type { PointerEvent as ReactPointerEvent } from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
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
 * 可复用的文件浏览器面板组件。
 *
 * 纯展示组件：负责渲染左侧分隔条、面板头部（标题 / 切换目录 / 刷新 / 关闭）、
 * 当前工作目录路径、以及递归文件树。目录数据、展开状态、工作目录、宽度等
 * 全部由调用方通过 props 传入，组件自身不持有业务状态。
 */
export interface FileExplorerProps {
  /** 面板宽度（px） */
  width: number;
  /** 是否正在拖动分隔条（用于高亮） */
  dragging: boolean;
  /** 分隔条 pointerdown 回调（绑定到 useResizableWidth 的 onPointerDown） */
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  /** 文件树节点状态：relPath -> DirNode */
  nodes: Record<string, DirNode>;
  /** 展开/收起目录回调 */
  onToggleDir: (path: string) => void;
  /** 打开文件回调（路径 + 文件名） */
  onOpenFile: (path: string, name: string) => void;
  /** 当前工作目录，null 时不显示路径栏 */
  cwd?: string | null;
  /** 是否显示「切换目录」输入区 */
  chdirOpen: boolean;
  /** 切换目录输入值 */
  chdirInput: string;
  /** 切换目录请求中 */
  chdirLoading?: boolean;
  /** 切换目录输入值变化回调 */
  onChdirInputChange: (value: string) => void;
  /** 提交切换目录 */
  onChdirSubmit: () => void;
  /** 打开/关闭切换目录输入区（并回填当前 cwd） */
  onToggleChdir: () => void;
  /** 刷新文件树 */
  onRefresh: () => void;
  /** 是否正在刷新（加载根目录） */
  refreshing?: boolean;
  /** 关闭面板 */
  onClose: () => void;
  /** 面板标题，默认「文件」 */
  title?: string;
}

/**
 * 文件浏览器面板 — 通用能力组件。
 *
 * 渲染可拖拽分隔条 + 文件树面板外壳，目录树与图标选择逻辑内聚于此。
 * 具体的数据来源（线程 workspace 的 listdir/chdir 等）由上层适配组件提供。
 */
export function FileExplorer({
  width,
  dragging,
  onPointerDown,
  nodes,
  onToggleDir,
  onOpenFile,
  cwd,
  chdirOpen,
  chdirInput,
  chdirLoading = false,
  onChdirInputChange,
  onChdirSubmit,
  onToggleChdir,
  onRefresh,
  refreshing = false,
  onClose,
  title = '文件',
}: FileExplorerProps) {
  return (
    <>
      {/* 分隔条 — 拖动调节文件浏览器与相邻区域之间的宽度分配 */}
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
            <span className="truncate text-sm font-medium">{title}</span>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              onClick={onToggleChdir}
              title="切换目录"
            >
              <FolderSync className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={onRefresh}
              title="刷新"
              disabled={refreshing}
            >
              <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
            </Button>
            <Button size="icon" variant="ghost" onClick={onClose} title="关闭">
              <X className="size-4" />
            </Button>
          </div>
        </header>

        {/* 切换工作目录输入区 */}
        {chdirOpen && (
          <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
            <Input
              value={chdirInput}
              onChange={(e) => onChdirInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onChdirSubmit();
                if (e.key === 'Escape') onToggleChdir();
              }}
              placeholder="输入目录路径，如 ~/project"
              className="h-7 flex-1 font-mono text-xs"
              autoFocus
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={onChdirSubmit}
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
              onToggleDir={onToggleDir}
              onOpenFile={onOpenFile}
            />
          </div>
        </ScrollArea>
      </aside>
    </>
  );
}

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

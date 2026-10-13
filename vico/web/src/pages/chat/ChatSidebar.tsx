'use client';

import {FolderTree, PanelRight, Plus, Terminal, X} from 'lucide-react';

import {getFileIcon} from '@/components/file-explorer/FileExplorer';
import {Button} from '@/components/ui/button';
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,} from '@/components/ui/context-menu';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {cn} from '@/lib/utils';
import {
  MAX_TERMINALS,
  type OpenFileTab,
  type PanelTab,
  sameTab,
  useFileExplorerStore
} from '@/stores/fileExplorerStore';
import {useResizableWidth} from '@/hooks/use-resizable-width';
import {FileContentView} from '@/pages/chat/FileContentView';
import {FileExplorerView} from '@/pages/chat/FileExplorerView';
import {TerminalView} from '@/pages/chat/TerminalView';

/** 无打开文件时的稳定空数组 — 避免 selector 每次返回新引用触发无限渲染 */
const EMPTY_FILES: OpenFileTab[] = [];
const EMPTY_TERMINALS: string[] = [];

/**
 * 聊天区右侧 Sidebar — 多视图容器。
 *
 * 顶层 Tab 栏将「文件树 / 已打开文件 / 终端」三类视图合并到同一行：
 * - 文件树视图（FileExplorerView）可关闭，关闭后可通过右上角「+」菜单重新打开
 * - 每个已打开文件对应一个 tab，支持关闭与右键批量关闭（左/右/全部），内容由 FileContentView 渲染
 * - 每个终端对应一个 tab（可多个），由 TerminalView 渲染，通过「+」菜单新建
 *
 * 视图渲染：文件树与所有终端同时挂载、CSS 隐藏切换，避免切 tab 丢状态
 * （终端 WS 连接、目录树展开态）；文件内容按需挂载（内容缓存在 store）。
 * 面板宽度通过 useResizableWidth 拖动调节并持久化到 localStorage。
 */
export function ChatSidebar({ threadId }: { threadId: string }) {
  const open = useFileExplorerStore((s) => s.fileExplorerOpen);
  const filesOpen = useFileExplorerStore((s) => s.filesOpenByThread[threadId]);
  const openTabs = useFileExplorerStore((s) => s.openTabsByThread[threadId] ?? EMPTY_FILES);
  const terminalIds = useFileExplorerStore((s) => s.terminalTabsByThread[threadId] ?? EMPTY_TERMINALS);
  const activeTab = useFileExplorerStore((s) => s.activeTabByThread[threadId] ?? null);

  const setActiveTab = useFileExplorerStore((s) => s.setActiveTab);
  const closeTab = useFileExplorerStore((s) => s.closeTab);
  const closeTabsToLeft = useFileExplorerStore((s) => s.closeTabsToLeft);
  const closeTabsToRight = useFileExplorerStore((s) => s.closeTabsToRight);
  const closeAllTabs = useFileExplorerStore((s) => s.closeAllTabs);
  const createTerminal = useFileExplorerStore((s) => s.createTerminal);
  const openFilesTab = useFileExplorerStore((s) => s.openFilesTab);
  const toggleFileExplorer = useFileExplorerStore((s) => s.toggleFileExplorer);

  // 面板宽度可拖动调节，并持久化到 localStorage（刷新后还原）
  const { width, dragging, onPointerDown } = useResizableWidth({
    storageKey: 'chat_file_explorer_width',
    defaultWidth: 320,
    minWidth: 260,
    maxWidth: 800,
  });

  // 顶层有序 tab 列表：[文件树?] + [文件...] + [终端...]
  const tabs: PanelTab[] = [];
  if (filesOpen) tabs.push({ kind: 'files' });
  for (const f of openTabs) tabs.push({ kind: 'file', filePath: f.filePath });
  for (const id of terminalIds) tabs.push({ kind: 'terminal', terminalId: id });

  // 无活跃 tab 时默认回退到文件树（若打开），保证首屏有内容
  const active: PanelTab | null = activeTab ?? (filesOpen ? { kind: 'files' } : null);
  const activeFile =
    active?.kind === 'file' ? openTabs.find((t) => t.filePath === active.filePath) : undefined;

  // 是否还能新建终端（未达上限）
  const canCreateTerminal = terminalIds.length < MAX_TERMINALS;
  // 「+」菜单是否有可选项：文件树未打开，或还能新建终端；都不可用时隐藏整个「+」按钮
  const showAddMenu = !filesOpen || canCreateTerminal;

  if (!open) return null;

  return (
    <>
      {/* 分隔条 — 1px 细线，伪元素向两侧外扩命中区，保持拖动易用 */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调节文件浏览器宽度"
        onPointerDown={onPointerDown}
        className={cn(
          'relative w-px shrink-0 cursor-col-resize transition-colors after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-[""]',
          dragging ? 'bg-primary/40' : 'hover:bg-primary/30',
        )}
      />
      <aside className="flex shrink-0 flex-col border-l bg-card" style={{ width }}>
        {/* 顶层 Tab 栏 — 文件树 / 文件 / 终端 + 右上角「+」菜单 */}
        <div className="flex h-12 shrink-0 items-center overflow-x-auto overflow-y-hidden border-b bg-muted/30 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((tab, idx) => {
            const isActive = sameTab(active, tab);
            const hasLeft = idx > 0;
            const hasRight = idx < tabs.length - 1;
            const { icon: Icon, label } = tabMeta(tab, terminalIds, openTabs);

            return (
              <ContextMenu key={tabKey(tab)}>
                <ContextMenuTrigger asChild>
                  <div
                    className={cn(
                      'group flex shrink-0 cursor-pointer items-center gap-1 border-r px-3 py-1.5 text-xs transition-colors max-w-[180px]',
                      isActive
                        ? 'bg-background border-b-2 border-b-primary -mb-[1px]'
                        : 'hover:bg-accent/50 text-muted-foreground',
                    )}
                    onClick={() => setActiveTab(threadId, tab)}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="truncate">{label}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(threadId, tab);
                      }}
                      className={cn(
                        'ml-0.5 shrink-0 rounded-sm p-0.5 transition-opacity hover:bg-accent',
                        isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                      )}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-36">
                  <ContextMenuItem onClick={() => closeTab(threadId, tab)}>
                    关闭当前
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={!hasLeft}
                    onClick={() => closeTabsToLeft(threadId, tab)}
                  >
                    关闭左侧
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={!hasRight}
                    onClick={() => closeTabsToRight(threadId, tab)}
                  >
                    关闭右侧
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => closeAllTabs(threadId)}>
                    关闭全部
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}

          {/* 右侧操作区 — 「+」菜单（条件渲染）+ 收起面板按钮（始终显示在最右） */}
          <div className="ml-auto flex shrink-0 items-center pr-1">
            {showAddMenu && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="icon" variant="ghost" title="新建" className="size-7">
                    <Plus className="size-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-40 p-1">
                  {!filesOpen && (
                    <button
                      type="button"
                      onClick={() => openFilesTab(threadId)}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
                    >
                      <FolderTree className="size-3.5" />
                      文件树
                    </button>
                  )}
                  {canCreateTerminal && (
                    <button
                      type="button"
                      onClick={() => createTerminal(threadId)}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
                    >
                      <Terminal className="size-3.5" />
                      终端
                    </button>
                  )}
                </PopoverContent>
              </Popover>
            )}
            <Button
              size="icon"
              variant="ghost"
              title="收起右侧面板"
              onClick={toggleFileExplorer}
              className="size-7"
            >
              <PanelRight className="size-4" />
            </Button>
          </div>
        </div>

        {/* 文件树视图 — 始终挂载，隐藏以保留展开态 */}
        <div className={cn('min-h-0 flex-1 flex-col', active?.kind === 'files' ? 'flex' : 'hidden')}>
          <FileExplorerView threadId={threadId} />
        </div>

        {/* 文件内容视图 — 仅渲染活跃文件（内容缓存在 store） */}
        {activeFile && (
          <div className="flex min-h-0 flex-1 flex-col">
            <FileContentView threadId={threadId} tab={activeFile} />
          </div>
        )}

        {/* 终端视图 — 全部挂载、隐藏以保留 WS 连接 */}
        {terminalIds.map((id) => (
          <div
            key={id}
            className={cn(
              'min-h-0 flex-1 flex-col',
              active?.kind === 'terminal' && active.terminalId === id ? 'flex' : 'hidden',
            )}
          >
            <TerminalView
              threadId={threadId}
              terminalId={id}
              active={active?.kind === 'terminal' && active.terminalId === id}
            />
          </div>
        ))}

        {/* 空态 — 无任何 tab 时提示 */}
        {!active && (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
            点击右上角「+」新建终端，或打开文件树浏览文件
          </div>
        )}
      </aside>
    </>
  );
}

/** 顶层 tab 的展示元数据：图标 + 标签 */
function tabMeta(
  tab: PanelTab,
  terminalIds: string[],
  openTabs: OpenFileTab[],
): { icon: typeof FolderTree; label: string } {
  if (tab.kind === 'files') {
    return { icon: FolderTree, label: '文件' };
  }
  if (tab.kind === 'file') {
    const file = openTabs.find((f) => f.filePath === tab.filePath);
    const { Icon } = getFileIcon(file?.fileName ?? tab.filePath);
    return { icon: Icon, label: file?.fileName ?? tab.filePath };
  }
  const idx = terminalIds.indexOf(tab.terminalId);
  return { icon: Terminal, label: `终端 ${idx + 1}` };
}

/** 顶层 tab 的稳定 key（用于 React 列表渲染与 ContextMenu） */
function tabKey(tab: PanelTab): string {
  if (tab.kind === 'files') return 'files';
  if (tab.kind === 'file') return `file:${tab.filePath}`;
  return `terminal:${tab.terminalId}`;
}

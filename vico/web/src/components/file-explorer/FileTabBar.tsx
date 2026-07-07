'use client';

import { MessageSquare, X } from 'lucide-react';

import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import { getFileIcon } from './FileExplorerPanel';
import { cn } from '@/lib/utils';

/**
 * 水平 tab 条 — 最左侧常驻「会话」tab，右侧显示已打开的文件 tabs。
 *
 * activeTab === null 时表示会话 tab 激活，否则为对应文件路径的 tab 激活。
 */
export function FileTabBar({ threadId }: { threadId: string }) {
  const openTabs = useFileExplorerStore((s) => s.openTabsByThread[threadId] ?? []);
  const activeTab = useFileExplorerStore((s) => s.activeTabByThread[threadId] ?? null);
  const setActiveTab = useFileExplorerStore((s) => s.setActiveTab);
  const closeTab = useFileExplorerStore((s) => s.closeTab);

  return (
    <div className="flex shrink-0 items-center border-b bg-muted/30 overflow-x-auto overflow-y-hidden">
      {/* 会话 tab — 最左侧常驻，不可关闭 */}
      <div
        className={cn(
          'flex items-center gap-1 shrink-0 cursor-pointer border-r px-3 py-1.5 text-xs transition-colors',
          activeTab === null
            ? 'bg-background border-b-2 border-b-primary -mb-[1px]'
            : 'hover:bg-accent/50 text-muted-foreground',
        )}
        onClick={() => setActiveTab(threadId, null)}
      >
        <MessageSquare className="size-3 shrink-0" />
        <span className="truncate">会话</span>
      </div>

      {openTabs.map((tab) => {
        const isActive = tab.filePath === activeTab;
        const { Icon, cls } = getFileIcon(tab.fileName);
        return (
          <div
            key={tab.filePath}
            className={cn(
              'flex items-center gap-1 shrink-0 cursor-pointer border-r px-3 py-1.5 text-xs transition-colors max-w-[180px]',
              isActive
                ? 'bg-background border-b-2 border-b-primary -mb-[1px]'
                : 'hover:bg-accent/50 text-muted-foreground',
            )}
            onClick={() => setActiveTab(threadId, tab.filePath)}
          >
            <Icon className={cn('size-3 shrink-0', cls)} />
            <span className="truncate">{tab.fileName}</span>
            {tab.isLoading && (
              <span className="size-2 shrink-0 rounded-full bg-amber-500 animate-pulse" />
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(threadId, tab.filePath);
              }}
              className="ml-0.5 rounded-sm p-0.5 hover:bg-accent shrink-0"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

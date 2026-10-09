'use client';

import {AlertCircle, Eye, FileText, Loader2, PenLine, RefreshCw, Save, X} from 'lucide-react';
import {useEffect, useState} from 'react';

import {Button} from '@/components/ui/button';
import {getFileIcon} from '@/components/file-explorer/FileExplorer';
import {SyntaxHighlighter} from '@/components/assistant-ui/elements/shiki-highlighter';
import {cn} from '@/lib/utils';
import {useFileExplorerStore, type OpenFileTab} from '@/stores/fileExplorerStore';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

/**
 * 文件预览视图 — 右侧边栏「预览」tab 的内容。
 *
 * 顶部为已打开文件 tabs（可关闭、右键批量关闭），下方为当前文件的预览/编辑区
 * （Shiki 语法高亮浏览 + 编辑保存）。原 FileTabBar / FileTabContent 的能力合并于此。
 */
export function FilePreviewView({ threadId }: { threadId: string }) {
  const openTabs = useFileExplorerStore((s) => s.openTabsByThread[threadId] ?? []);
  const activeTab = useFileExplorerStore((s) => s.activeTabByThread[threadId] ?? null);
  const setActiveTab = useFileExplorerStore((s) => s.setActiveTab);
  const closeTab = useFileExplorerStore((s) => s.closeTab);
  const closeTabsToLeft = useFileExplorerStore((s) => s.closeTabsToLeft);
  const closeTabsToRight = useFileExplorerStore((s) => s.closeTabsToRight);
  const closeAllTabs = useFileExplorerStore((s) => s.closeAllTabs);

  const activeFile = openTabs.find((t) => t.filePath === activeTab);

  if (openTabs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <FileText className="size-6" />
        <div className="text-sm">点击文件树中的文件以预览</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 文件 tabs 条 */}
      <div className="flex shrink-0 items-center overflow-x-auto overflow-y-hidden border-b bg-muted/30">
        {openTabs.map((tab, idx) => {
          const isActive = tab.filePath === activeTab;
          const { Icon, cls } = getFileIcon(tab.fileName);
          const hasLeft = idx > 0;
          const hasRight = idx < openTabs.length - 1;

          return (
            <ContextMenu key={tab.filePath}>
              <ContextMenuTrigger asChild>
                <div
                  className={cn(
                    'flex shrink-0 cursor-pointer items-center gap-1 border-r px-3 py-1.5 text-xs transition-colors max-w-[180px]',
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
                    className="ml-0.5 shrink-0 rounded-sm p-0.5 hover:bg-accent"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-36">
                <ContextMenuItem onClick={() => closeTab(threadId, tab.filePath)}>
                  关闭当前
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!hasLeft}
                  onClick={() => closeTabsToLeft(threadId, tab.filePath)}
                >
                  关闭左侧
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!hasRight}
                  onClick={() => closeTabsToRight(threadId, tab.filePath)}
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
      </div>

      {/* 当前文件内容 */}
      {activeFile && <PreviewContent threadId={threadId} tab={activeFile} />}
    </div>
  );
}

/** 单个文件的预览/编辑内容区 */
function PreviewContent({ threadId, tab }: { threadId: string; tab: OpenFileTab }) {
  const setFileContent = useFileExplorerStore((s) => s.setFileContent);
  const setFileError = useFileExplorerStore((s) => s.setFileError);
  const setFileLoading = useFileExplorerStore((s) => s.setFileLoading);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditing(false);
    setDraft('');
  }, [tab.filePath]);

  const reload = () => {
    setFileLoading(threadId, tab.filePath, true);
    fetch(
      `/api/v1/threads/${threadId}/fs/read?path=${encodeURIComponent(tab.filePath)}`,
      { credentials: 'include' },
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setFileContent(threadId, tab.filePath, data.content);
      })
      .catch((err) => {
        setFileError(threadId, tab.filePath, err.message);
      });
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/threads/${threadId}/fs/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ path: tab.filePath, content: draft }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setFileContent(threadId, tab.filePath, draft);
      setEditing(false);
    } catch (err) {
      setFileError(threadId, tab.filePath, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const dirty = editing && draft !== (tab.content ?? '');

  if (tab.isLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        加载 {tab.fileName}...
      </div>
    );
  }

  if (tab.error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="size-6 text-red-500" />
        <div className="text-sm font-medium">无法打开文件</div>
        <div className="font-mono text-xs text-muted-foreground">{tab.error}</div>
        <Button size="sm" variant="outline" onClick={reload}>
          <RefreshCw className="mr-1 size-3.5" />
          重试
        </Button>
      </div>
    );
  }

  const lang = guessLanguage(tab.filePath);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs">
        <code className="min-w-0 flex-1 truncate font-mono">{tab.filePath}</code>
        {dirty && <span className="font-mono text-[10px] text-amber-600">●未保存</span>}
        <Button size="sm" variant="ghost" onClick={reload} title="重新加载">
          <RefreshCw className="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant={editing ? 'default' : 'outline'}
          onClick={() => {
            if (editing) {
              if (dirty && !window.confirm('放弃未保存的修改？')) return;
              setDraft(tab.content ?? '');
              setEditing(false);
            } else {
              setDraft(tab.content ?? '');
              setEditing(true);
            }
          }}
        >
          {editing ? <Eye className="mr-1 size-3.5" /> : <PenLine className="mr-1 size-3.5" />}
          {editing ? '浏览' : '编辑'}
        </Button>
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className={cn(dirty && 'bg-primary')}
        >
          <Save className="mr-1 size-3.5" />
          {saving ? '保存中...' : '保存'}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                void save();
              }
            }}
            spellCheck={false}
            className="size-full resize-none border-0 bg-background px-4 py-3 font-mono text-xs leading-relaxed outline-none"
          />
        ) : (
          <div className="px-2 py-2">
            <SyntaxHighlighter code={tab.content ?? ''} language={lang} />
          </div>
        )}
      </div>
    </div>
  );
}

/** 根据文件扩展名猜测语言标识 */
function guessLanguage(relPath: string): string {
  const ext = relPath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', mdx: 'mdx', html: 'html', css: 'css', scss: 'scss',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    kt: 'kotlin', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
    php: 'php', swift: 'swift', sql: 'sql', sh: 'bash', bash: 'bash',
    zsh: 'bash', xml: 'xml', svg: 'xml', vue: 'vue', svelte: 'svelte',
  };
  return map[ext] ?? 'text';
}

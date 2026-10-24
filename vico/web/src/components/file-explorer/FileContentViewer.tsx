'use client';

import { useEffect, useState } from 'react';

import { AlertCircle, Eye, Loader2, PenLine, RefreshCw, Save } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { SyntaxHighlighter } from '@/components/assistant-ui/elements/shiki-highlighter';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * 可复用文件内容查看器的 props。
 *
 * 组件为纯展示 + 本地编辑态：内容加载、保存均通过回调交由父组件完成，
 * 加载态与错误信息也由父组件注入，方便在不同文件源（线程 workspace / 其它后端）复用。
 */
export interface FileContentViewerProps {
  /** 文件相对路径 — 用于顶部展示与语言猜测 */
  filePath: string;
  /** 文件名 — 加载态提示用 */
  fileName?: string;
  /** 文件内容；undefined 表示尚未加载 */
  content?: string;
  /** 是否正在加载 */
  isLoading?: boolean;
  /** 加载 / 保存错误信息 */
  error?: string;
  /** 重新从后端读取文件内容的回调 */
  onReload: () => void;
  /** 保存草稿到后端的回调（成功后父组件应同步 content prop） */
  onSave: (content: string) => Promise<void>;
}

/**
 * 文件内容查看 / 编辑组件 — 通用可复用能力。
 *
 * 顶部为文件路径 + 操作按钮（重载 / 编辑切换 / 保存），下方为内容区：
 * 浏览态 markdown 文件用富文本渲染，其余用 Shiki 语法高亮；
 * 编辑态用 textarea 直接编辑并支持 Cmd/Ctrl+S 保存。
 * 不直接依赖任何 store / API，加载与保存均通过 props 回调交由上层适配。
 */
export function FileContentViewer({
  filePath,
  fileName,
  content,
  isLoading = false,
  error,
  onReload,
  onSave,
}: FileContentViewerProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // 切换文件时退出编辑态并清空草稿
  useEffect(() => {
    setEditing(false);
    setDraft('');
  }, [filePath]);

  /** 保存草稿；成功后退出编辑态，失败则由父组件注入 error 展示 */
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const dirty = editing && draft !== (content ?? '');

  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        加载 {fileName}...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="size-6 text-red-500" />
        <div className="text-sm font-medium">无法打开文件</div>
        <div className="font-mono text-xs text-muted-foreground">{error}</div>
        <Button size="sm" variant="outline" onClick={onReload}>
          <RefreshCw className="mr-1 size-3.5" />
          重试
        </Button>
      </div>
    );
  }

  const lang = guessLanguage(filePath);
  // markdown 文件走富文本渲染，其余文件走语法高亮
  const renderMarkdown = lang === 'markdown';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs">
        <code className="min-w-0 flex-1 truncate font-mono">{filePath}</code>
        {dirty && <span className="font-mono text-[10px] text-amber-600">●未保存</span>}
        <Button size="sm" variant="ghost" onClick={onReload} title="重新加载">
          <RefreshCw className="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant={editing ? 'default' : 'outline'}
          onClick={() => {
            if (editing) {
              if (dirty && !window.confirm('放弃未保存的修改？')) return;
              setDraft(content ?? '');
              setEditing(false);
            } else {
              setDraft(content ?? '');
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
        ) : renderMarkdown ? (
          <div data-aui="markdown" className="px-4 py-3">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content ?? ''}</ReactMarkdown>
          </div>
        ) : (
          <div className="px-2 py-2">
            <SyntaxHighlighter code={content ?? ''} language={lang} />
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
    md: 'markdown', markdown: 'markdown', mdx: 'mdx', html: 'html', css: 'css', scss: 'scss',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    kt: 'kotlin', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
    php: 'php', swift: 'swift', sql: 'sql', sh: 'bash', bash: 'bash',
    zsh: 'bash', xml: 'xml', svg: 'xml', vue: 'vue', svelte: 'svelte',
  };
  return map[ext] ?? 'text';
}

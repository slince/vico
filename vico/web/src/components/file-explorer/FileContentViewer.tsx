'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { keymap } from '@codemirror/view';
import { AlertCircle, Eye, Loader2, PenLine, RefreshCw, Save } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { SyntaxHighlighter } from '@/components/assistant-ui/elements/shiki-highlighter';
import { getCodeMirrorExtensions, guessLanguage } from '@/components/file-explorer/codemirror-language';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
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
 * 编辑态用 CodeMirror 提供带语法高亮的编辑器，并支持 Cmd/Ctrl+S 保存。
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
  const { theme } = useTheme();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // 记录最新编辑态，供内容同步 effect 读取（避免把 editing 加进依赖，导致退出编辑态时覆盖草稿）
  const editingRef = useRef(editing);
  editingRef.current = editing;

  // 记录上一个文件路径，用于区分「切换文件」与「同一文件内容变化」
  const prevFilePathRef = useRef(filePath);

  // 切换文件时退出编辑态并重置草稿到新文件内容；同一文件内容就绪/变化时，非编辑态下同步草稿
  useEffect(() => {
    const pathChanged = prevFilePathRef.current !== filePath;
    prevFilePathRef.current = filePath;

    if (pathChanged) {
      setEditing(false);
      setDraft(content ?? '');
    } else if (!editingRef.current) {
      setDraft(content ?? '');
    }
  }, [filePath, content]);

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

  // 保存最新 save 引用供 keymap 调用，避免 extensions 随 draft 变化而重建编辑器
  const saveRef = useRef(save);
  saveRef.current = save;

  // 编辑态扩展：语言高亮 + Cmd/Ctrl+S 保存快捷键；仅在切换文件时重建
  const extensions = useMemo(
    () => [
      ...getCodeMirrorExtensions(filePath),
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            void saveRef.current();
            return true;
          },
        },
      ]),
    ],
    [filePath],
  );

  const dirty = draft !== (content ?? '');

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
            // 预览与编辑间自由切换：未保存的草稿始终保留，切回编辑态继续编辑
            setEditing((v) => !v);
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
          <CodeMirror
            value={draft}
            onChange={(value) => setDraft(value)}
            extensions={extensions}
            theme={theme}
            className="text-xs"
          />
        ) : renderMarkdown ? (
          <div data-aui="markdown" className="px-4 py-3">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
          </div>
        ) : (
          <div className="px-2 py-2">
            <SyntaxHighlighter code={draft} language={lang} />
          </div>
        )}
      </div>
    </div>
  );
}

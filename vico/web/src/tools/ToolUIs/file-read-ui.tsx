/**
 * 文件读取工具 UI — 渲染 read / glob / grep 三个只读工具。
 *
 * 单个组件按 toolName 分支：
 *   read → 文件内容（text=按扩展名语法高亮，image=图片，binary=占位）
 *   glob → 匹配文件列表
 *   grep → 搜索结果文本
 */
import {useEffect, useState} from 'react';
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';
import {Check, Copy, FileSearch, FileText, Search} from 'lucide-react';
import {guessLanguage} from '@/components/file-explorer/codemirror-language';
import {SyntaxHighlighter} from '@/components/assistant-ui/elements/shiki-highlighter';
import {ToolCard} from './tool-card';
import type {
  GlobArgs,
  GlobResult,
  GrepArgs,
  GrepResult,
  ReadArgs,
  ReadResult
} from '../filesystem.tool';

/** 工具名 → 图标 */
const TOOL_ICON: Record<string, React.ElementType> = {
  read: FileText,
  glob: FileSearch,
  grep: Search,
};

/** 复制按钮 — 点击将文本写入剪贴板，成功后短暂显示对勾 */
function CopyButton({text, label}: {text: string; label: string}) {
  const [copied, setCopied] = useState(false);

  // 复制成功后显示对勾，1.5s 后恢复；effect 里清理定时器避免重复触发
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // 剪贴板不可用（非 https 等）时静默忽略
    }
  };

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => void copy()}
      className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
    >
      {copied ? (
        <Check size={13} className="text-emerald-500" />
      ) : (
        <Copy size={13} />
      )}
    </button>
  );
}

/** read 结果视图 — 按文件类型分支渲染 */
function ReadView({result, args}: {result: ReadResult; args: ReadArgs}) {
  const {t} = useTranslation('assistant');
  // 仅按行读取（传了 offset）时展示起始行号，紧跟路径行右侧、复制按钮之前
  const startLine = args.offset;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] text-muted-foreground min-w-0 truncate">{result.path}</p>
        <div className="flex items-center gap-2 shrink-0">
          {startLine != null && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {t('tool.fileRead.startLine', {line: startLine})}
            </span>
          )}
          <CopyButton text={result.content} label={t('tool.fileRead.copy')} />
        </div>
      </div>
      {result.type === 'image' ? (
        <img
          src={result.content}
          alt={result.path}
          className="max-h-64 rounded border"
        />
      ) : result.type === 'binary' ? (
        <p className="text-xs text-muted-foreground">{result.content}</p>
      ) : (
        <SyntaxHighlighter
          code={result.content}
          language={guessLanguage(result.path)}
        />
      )}
    </div>
  );
}

/** glob 结果视图 — 文件路径列表 */
function GlobView({result}: {result: GlobResult}) {
  return (
    <ul className="space-y-0.5">
      {result.files.map((file, i) => (
        <li key={i} className="flex items-center gap-1.5 text-xs">
          <FileText size={12} className="text-muted-foreground shrink-0" />
          <span className="font-mono truncate">{file}</span>
        </li>
      ))}
    </ul>
  );
}

/** grep 结果视图 — 搜索结果文本 */
function GrepView({result}: {result: GrepResult}) {
  const {t} = useTranslation('assistant');
  return (
    <div className="space-y-1">
      {result.count > 0 ? (
        <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all bg-background/50 rounded p-2">
          {result.matches}
        </pre>
      ) : (
        <p className="text-xs text-muted-foreground">{t('tool.fileRead.noMatch')}</p>
      )}
    </div>
  );
}

/** 只读工具参数/结果的联合类型（read/glob/grep 共用一个渲染器） */
type FileReadArgs = ReadArgs | GlobArgs | GrepArgs;
type FileReadResult = ReadResult | GlobResult | GrepResult;

/**
 * 文件读取渲染器 — 统一处理 read/glob/grep 三个只读工具。
 */
export const FileReadRenderer: ToolCallMessagePartComponent<FileReadArgs, FileReadResult> = ({
  toolName,
  status,
  args,
  result,
  isError,
  approval,
  interrupt,
  resume,
  addResult,
  respondToApproval,
}) => {
  const {t} = useTranslation('assistant');
  const title = t(`tool.fileRead.title.${toolName}`, {defaultValue: toolName});
  const Icon = TOOL_ICON[toolName] ?? FileText;
  // 只读工具统一从 args.path 提取文件/目录路径，展示在标题行
  const path = args?.path;

  return (
    <ToolCard
      title={title}
      subtitle={path}
      icon={Icon}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      interrupt={interrupt}
      resume={resume}
      addResult={addResult}
      respondToApproval={respondToApproval}
    >
      {result &&
        (toolName === 'read' ? (
          <ReadView result={result as ReadResult} args={args as ReadArgs} />
        ) : toolName === 'glob' ? (
          <GlobView result={result as GlobResult} />
        ) : toolName === 'grep' ? (
          <GrepView result={result as GrepResult} />
        ) : null)}
    </ToolCard>
  );
};

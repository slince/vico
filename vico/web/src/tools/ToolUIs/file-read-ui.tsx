/**
 * 文件读取工具 UI — 渲染 read / glob / grep 三个只读工具。
 *
 * 单个组件按 toolName 分支：
 *   read → 文件内容（text=行号 pre，image=图片，binary=占位）
 *   glob → 匹配文件列表
 *   grep → 搜索结果文本
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';
import {FileSearch, FileText, Search} from 'lucide-react';
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

/** read 结果视图 — 按文件类型分支渲染 */
function ReadView({result}: {result: ReadResult}) {
  return (
    <div className="space-y-1.5">
      <p className="font-mono text-[11px] text-muted-foreground">{result.path}</p>
      {result.type === 'image' ? (
        <img
          src={result.content}
          alt={result.path}
          className="max-h-64 rounded border"
        />
      ) : result.type === 'binary' ? (
        <p className="text-xs text-muted-foreground">{result.content}</p>
      ) : (
        <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all bg-background/50 rounded p-2">
          {result.content}
        </pre>
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
          <ReadView result={result as ReadResult} />
        ) : toolName === 'glob' ? (
          <GlobView result={result as GlobResult} />
        ) : toolName === 'grep' ? (
          <GrepView result={result as GrepResult} />
        ) : null)}
    </ToolCard>
  );
};

/**
 * 文件读取工具 UI — 渲染 read / ls / find / grep 四个只读工具。
 *
 * 单个组件按 toolName 分支：
 *   read → 文件内容（text=行号 pre，image=图片，binary=占位）
 *   ls   → 目录条目列表（目录加 "/" 标记）
 *   find → 匹配文件列表
 *   grep → 搜索结果文本
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';
import {FileSearch, FileText, FolderOpen, Search} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {
  FindArgs,
  FindResult,
  GrepArgs,
  GrepResult,
  LsArgs,
  LsResult,
  ReadArgs,
  ReadResult
} from '../filesystem.tool';

/** 工具名 → 图标 */
const TOOL_ICON: Record<string, React.ElementType> = {
  read: FileText,
  ls: FolderOpen,
  find: FileSearch,
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

/** ls 结果视图 — 目录条目列表 */
function LsView({result}: {result: LsResult}) {

  console.log(result);

  return (
    <div className="space-y-1">
      <p className="font-mono text-[11px] text-muted-foreground">{result.path}</p>
      <ul className="grid grid-cols-1 gap-0.5">
        {result?.entries?.map((entry, i) => {
          const isDir = entry.endsWith('/');
          return (
            <li key={i} className="flex items-center gap-1.5 text-xs">
              {isDir ? (
                <FolderOpen size={12} className="text-amber-500 shrink-0" />
              ) : (
                <FileText size={12} className="text-muted-foreground shrink-0" />
              )}
              <span className="font-mono truncate">{entry}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** find 结果视图 — 文件路径列表 */
function FindView({result}: {result: FindResult}) {
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

/** 只读工具参数/结果的联合类型（read/ls/find/grep 共用一个渲染器） */
type FileReadArgs = ReadArgs | LsArgs | FindArgs | GrepArgs;
type FileReadResult = ReadResult | LsResult | FindResult | GrepResult;

/**
 * 文件读取渲染器 — 统一处理 read/ls/find/grep 四个只读工具。
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
      renderResult={(r) => {
        switch (toolName) {
          case 'read':
            return <ReadView result={r as ReadResult} />;
          case 'ls':
            return <LsView result={r as LsResult} />;
          case 'find':
            return <FindView result={r as FindResult} />;
          case 'grep':
            return <GrepView result={r as GrepResult} />;
          default:
            return null;
        }
      }}
    />
  );
};

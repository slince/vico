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
import {FileText, FolderOpen, Search, FileSearch} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {ReadResult, LsResult, FindResult, GrepResult} from '../filesystem.tool';

/** 工具名 → 中文标题 */
const TOOL_TITLE: Record<string, string> = {
  read: '读取文件',
  ls: '列出目录',
  find: '查找文件',
  grep: '搜索内容',
};

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
  return (
    <div className="space-y-1">
      <p className="font-mono text-[11px] text-muted-foreground">{result.path}</p>
      <ul className="grid grid-cols-1 gap-0.5">
        {result.entries.map((entry, i) => {
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
  return (
    <div className="space-y-1">
      {result.count > 0 ? (
        <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all bg-background/50 rounded p-2">
          {result.matches}
        </pre>
      ) : (
        <p className="text-xs text-muted-foreground">未找到匹配</p>
      )}
    </div>
  );
}

/**
 * 文件读取渲染器 — 统一处理 read/ls/find/grep 四个只读工具。
 */
export const FileReadRenderer: ToolCallMessagePartComponent = ({
  toolName,
  status,
  result,
  isError,
  approval,
  respondToApproval,
}) => {
  const title = TOOL_TITLE[toolName] ?? toolName;
  const Icon = TOOL_ICON[toolName] ?? FileText;

  return (
    <ToolCard
      title={title}
      icon={Icon}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
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

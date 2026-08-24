/**
 * 文件写入工具 UI — 渲染 write / edit 两个变更类工具（需审批）。
 *
 *   write → action（created/updated）+ path + lines + size
 *   edit  → path + replacements + diff（行级着色）
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import {FilePlus, FilePen} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {WriteArgs, WriteResult, EditArgs, EditResult} from '../filesystem.tool';

/** 工具名 → 图标 */
const TOOL_ICON: Record<string, React.ElementType> = {
  write: FilePlus,
  edit: FilePen,
};

/** edit 的 simple diff（+/- 行）着色 */
function DiffLines({diff}: {diff: string}) {
  return (
    <pre className="text-[11px] leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all bg-background/50 rounded p-2">
      {diff.split('\n').map((line, i) => {
        let cls = 'text-muted-foreground';
        if (line.startsWith('+')) cls = 'text-green-600 dark:text-green-400';
        else if (line.startsWith('-')) cls = 'text-red-600 dark:text-red-400';
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

/** write 结果视图 */
function WriteView({result}: {result: WriteResult}) {
  const {t} = useTranslation('assistant');
  const actionText = result.action === 'created' ? t('tool.fileWrite.created') : t('tool.fileWrite.updated');
  return (
    <div className="space-y-1 text-xs">
      <p className="font-mono text-muted-foreground">{result.path}</p>
      <p className="text-muted-foreground">
        {actionText} · {t('tool.fileWrite.lines', {n: result.lines})} · {t('tool.fileWrite.bytes', {n: result.size})}
      </p>
    </div>
  );
}

/** edit 结果视图 */
function EditView({result}: {result: EditResult}) {
  const {t} = useTranslation('assistant');
  return (
    <div className="space-y-1.5">
      <p className="font-mono text-[11px] text-muted-foreground">{result.path}</p>
      {result.replacements > 0 && (
        <p className="text-xs text-muted-foreground">{t('tool.fileWrite.replacements', {n: result.replacements})}</p>
      )}
      <DiffLines diff={result.diff} />
    </div>
  );
}

/** 变更类工具参数/结果的联合类型（write/edit 共用一个渲染器） */
type FileWriteArgs = WriteArgs | EditArgs;
type FileWriteResult = WriteResult | EditResult;

/**
 * 文件写入渲染器 — 统一处理 write/edit 两个变更类工具（走审批）。
 */
export const FileWriteRenderer: ToolCallMessagePartComponent<FileWriteArgs, FileWriteResult> = ({
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
  const title = t(`tool.fileWrite.title.${toolName}`, {defaultValue: toolName});
  const Icon = TOOL_ICON[toolName] ?? FilePlus;

  // 变更类工具从 args.path 提取目标文件路径，展示在标题行并用于审批描述
  const path = args?.path;
  const approvalDescription = t('tool.fileWrite.path', {path: path ?? ''});

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
      approvalDescription={approvalDescription}
      renderResult={(r) => {
        if (toolName === 'write') return <WriteView result={r as WriteResult} />;
        if (toolName === 'edit') return <EditView result={r as EditResult} />;
        return null;
      }}
    />
  );
};
